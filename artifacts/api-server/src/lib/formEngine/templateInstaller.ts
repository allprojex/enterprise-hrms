/**
 * WS-26C — governed, generic template activation.
 *
 * Installs a set of form-template definitions into ONE explicitly-named
 * organization through the normal governed template service (createTemplate →
 * publishVersion), so activation is versioned and audited like any other
 * template creation. Organization-neutral: it takes whatever seeds and org id
 * the caller supplies — it has no WWM knowledge. The WWM activation is just a
 * caller that passes org 3 and the four WWM seeds.
 *
 * Deterministic + idempotent + safe to rerun: a template whose organization_id
 * + template_key already exists is SKIPPED (never duplicated); the unique index
 * form_templates_org_key_unique is the backstop. It never runs on boot or from
 * seed:roles — only from an explicit, authorized act.
 */
import { and, eq } from "drizzle-orm";
import { db, formTemplatesTable } from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { authorizeActor } from "../actorAuthorization";
import { createTemplate, createDraftVersion, getPublishedVersion, listStages, listVersions, publishVersion, validateStages } from "./templates";
import { definitionSha256, validateFormDefinition, type FormDefinition } from "./definition";
import type { StageInput, SignaturePolicy } from "./templates";

/**
 * The authority installing templates requires — deliberately the SAME keys the
 * governed routes enforce (routes/formTemplates.ts): creating a template needs
 * `form_template.manage`, and publishing a version additionally needs
 * `form_template.publish`. Draft-only installation (`publish: false`) therefore
 * needs manage alone, exactly as it would through the API.
 */
export const TEMPLATE_INSTALL_PERMISSION = "form_template.manage";
export const TEMPLATE_PUBLISH_PERMISSION = "form_template.publish";

/** The minimum a seed must provide to be installed. WwmTemplateSeed satisfies this. */
export interface InstallableTemplateSeed {
  templateKey: string;
  formType: Parameters<typeof createTemplate>[0]["formType"];
  moduleKey: string | null;
  title: string;
  description?: string;
  definition: FormDefinition;
  stages: StageInput[];
  signaturePolicy?: SignaturePolicy;
  /** Version-level submission rules, e.g. { allowOnBehalfSubmission: true }. Absent = fail closed. */
  submissionPolicy?: Record<string, unknown>;
  /**
   * Workflows this seed has previously been PUBLISHED with, as frozen history.
   * prepareSubmissionPolicyVersions only prepares a new version when the
   * published workflow equals the current seed or one of these known baselines.
   */
  priorPublishedStages?: readonly StageInput[][];
}

export interface TemplateInstallResult {
  templateKey: string;
  action: "installed" | "already_present";
  templateId: number;
  versionId?: number;
  published?: boolean;
}

async function existingTemplateId(organizationId: number, templateKey: string): Promise<number | null> {
  const [row] = await db
    .select({ id: formTemplatesTable.id })
    .from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.organizationId, organizationId), eq(formTemplatesTable.templateKey, templateKey)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Install (and by default publish) each seed into `organizationId`. Idempotent:
 * an already-present template_key is left untouched and reported. Returns a
 * per-template summary. Publishing failures propagate (nothing is left in a
 * half-activated state beyond what createTemplate/publishVersion already commit).
 */
export async function installTemplates(params: {
  organizationId: number;
  seeds: readonly InstallableTemplateSeed[];
  actorApplicationUserId: number;
  /** A real governed actor membership (activation is never anonymous/break-glass). */
  actorMembershipId: number;
  publish?: boolean;
}): Promise<TemplateInstallResult[]> {
  const { organizationId, seeds } = params;
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error("installTemplates requires an explicit target organizationId");
  const publish = params.publish !== false;

  // Authorization BEFORE any mutation. The actor ids are not a label on the
  // audit record — they are the authority for this act, so they are proven
  // against the same membership/permission services the governed routes use
  // (lib/actorAuthorization.ts). Nothing below runs for an actor who could not
  // perform the equivalent action through the API: no template, no version, no
  // stage, no audit event. Publishing demands the publish key in addition to
  // manage, so a manage-only actor can still install drafts but can never
  // publish them.
  const actor = await authorizeActor({
    organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    requiredPermissions: publish ? [TEMPLATE_INSTALL_PERMISSION, TEMPLATE_PUBLISH_PERMISSION] : [TEMPLATE_INSTALL_PERMISSION],
  });

  const results: TemplateInstallResult[] = [];

  for (const seed of seeds) {
    const existing = await existingTemplateId(organizationId, seed.templateKey);
    if (existing !== null) {
      results.push({ templateKey: seed.templateKey, action: "already_present", templateId: existing });
      continue;
    }
    const { template, version } = await createTemplate({
      organizationId,
      templateKey: seed.templateKey,
      formType: seed.formType,
      moduleKey: seed.moduleKey,
      title: seed.title,
      description: seed.description ?? null,
      definition: seed.definition,
      stages: seed.stages,
      signaturePolicy: seed.signaturePolicy,
      submissionPolicy: seed.submissionPolicy,
      actorApplicationUserId: actor.applicationUserId,
      actorMembershipId: actor.membershipId,
    });
    let published = false;
    if (publish) {
      await publishVersion({ organizationId, versionId: version.id, actorApplicationUserId: actor.applicationUserId, actorMembershipId: actor.membershipId });
      published = true;
    }
    results.push({ templateKey: seed.templateKey, action: "installed", templateId: template.id, versionId: version.id, published });
  }

  await recordAuditEvent({
    actorApplicationUserId: actor.applicationUserId,
    actorMembershipId: actor.membershipId,
    organizationId,
    eventType: "form_template.activation_run",
    targetType: "organization",
    targetId: String(organizationId),
    metadata: {
      installed: results.filter((r) => r.action === "installed").map((r) => r.templateKey),
      alreadyPresent: results.filter((r) => r.action === "already_present").map((r) => r.templateKey),
      published: publish,
    },
  });
  return results;
}

// ---------------------------------------------------------------------------
// Submission-policy versioning for ALREADY-INSTALLED templates
// ---------------------------------------------------------------------------

export type PolicyVersionAction =
  | "not_installed"
  | "blocked_no_published_version"
  | "unchanged"
  | "blocked_content_changed"
  | "blocked_existing_draft"
  | "draft_already_prepared"
  | "would_prepare_draft"
  | "draft_prepared";

export interface PolicyVersionResult {
  templateKey: string;
  action: PolicyVersionAction;
  templateId?: number;
  publishedVersionId?: number;
  publishedVersionNumber?: number;
  draftVersionId?: number;
  /** Human-readable delta between the published version and the prepared (or proposed) draft. */
  proposedChanges?: string[];
}

/** Lists what a prepared draft changes relative to the published version: policy keys and stage moves/additions/removals. */
function describeVersionChanges(
  publishedPolicy: unknown,
  desiredPolicy: Record<string, unknown> | null,
  publishedStages: Parameters<typeof stageShape>[0][],
  desiredStages: Parameters<typeof stageShape>[0][],
): string[] {
  const changes: string[] = [];
  const before = (publishedPolicy && typeof publishedPolicy === "object" && !Array.isArray(publishedPolicy) ? publishedPolicy : {}) as Record<string, unknown>;
  const after = desiredPolicy ?? {};
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (canonicalJson(before[key]) !== canonicalJson(after[key])) changes.push(`submissionPolicy.${key} = ${JSON.stringify(after[key] ?? null)}`);
  }
  const withoutOrder = (s: Parameters<typeof stageShape>[0]) => stageShape({ ...s, stageOrder: 0 });
  for (const stage of desiredStages) {
    const prior = publishedStages.find((p) => p.name === stage.name);
    if (!prior) changes.push(`stage ${stage.stageOrder} added: "${stage.name}" (resolver ${stage.resolver})`);
    else if (prior.stageOrder !== stage.stageOrder) changes.push(`"${stage.name}" moves from stage ${prior.stageOrder} to stage ${stage.stageOrder}`);
    if (prior && withoutOrder(prior) !== withoutOrder(stage)) changes.push(`"${stage.name}" configuration changed`);
  }
  for (const prior of publishedStages) {
    if (!desiredStages.some((s) => s.name === prior.name)) changes.push(`stage ${prior.stageOrder} removed: "${prior.name}"`);
  }
  return changes;
}

/** Stable JSON: object keys sorted, undefined treated as null — for equality only. */
function canonicalJson(value: unknown): string {
  const normalise = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v)) return v.map(normalise);
    if (typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, normalise((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(normalise(value));
}

/** Accepts both a validated seed StageInput and a stored workflow-stage row. */
function stageShape(s: {
  stageOrder: number;
  name: string;
  participant: string;
  resolver: string;
  resolverConfig?: unknown;
  editableSectionKeys: unknown;
  allowedActions: unknown;
  signatureSlotKey?: string | null;
}): string {
  return canonicalJson({
    stageOrder: s.stageOrder,
    name: s.name,
    participant: s.participant,
    resolver: s.resolver,
    resolverConfig: s.resolverConfig ?? null,
    editableSectionKeys: s.editableSectionKeys,
    allowedActions: s.allowedActions,
    signatureSlotKey: s.signatureSlotKey ?? null,
  });
}

/**
 * Prepares — never publishes — a new DRAFT version for an already-installed
 * template whose seed now declares a different `submissionPolicy`.
 *
 * WHY THIS EXISTS. installTemplates skips any template that is already present,
 * so changing a seed's policy can never reach a tenant that installed and
 * published v1 earlier; and a published version is immutable, so the policy
 * cannot be edited in place. The only correct path is a new version, and this
 * is the governed way to create it.
 *
 * CONTENT-LOCKED. The draft is built from the CURRENTLY PUBLISHED version's
 * own definition, signature policy, render config and stages — not from the
 * seed — and it is only built when the seed's definition, signature policy and
 * stages are identical to what is published. Any other difference is reported
 * as `blocked_content_changed`: content changes go through normal template
 * authoring, never through a policy switch.
 *
 * NEVER TOUCHES v1. The published version, its stages and every submission
 * already pointing at it are left exactly as they are. Publishing the draft is
 * a separate governed act (form_template.publish) that this function does not
 * perform, so preparing needs `form_template.manage` only.
 *
 * Idempotent: an existing draft that already matches is reported as
 * `draft_already_prepared`; any other open draft blocks rather than being
 * overwritten. `dryRun` reports what would happen and writes nothing.
 */
export async function prepareSubmissionPolicyVersions(params: {
  organizationId: number;
  seeds: readonly InstallableTemplateSeed[];
  actorApplicationUserId: number;
  actorMembershipId: number;
  dryRun?: boolean;
}): Promise<PolicyVersionResult[]> {
  const { organizationId, seeds } = params;
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error("prepareSubmissionPolicyVersions requires an explicit target organizationId");
  }
  const actor = await authorizeActor({
    organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    requiredPermissions: [TEMPLATE_INSTALL_PERMISSION],
  });

  const results: PolicyVersionResult[] = [];
  for (const seed of seeds) {
    const templateId = await existingTemplateId(organizationId, seed.templateKey);
    if (templateId === null) {
      results.push({ templateKey: seed.templateKey, action: "not_installed" });
      continue;
    }
    const published = await getPublishedVersion(organizationId, templateId);
    if (!published) {
      results.push({ templateKey: seed.templateKey, action: "blocked_no_published_version", templateId });
      continue;
    }
    const base = { templateKey: seed.templateKey, templateId, publishedVersionId: published.id, publishedVersionNumber: published.versionNumber };
    const desiredPolicy = seed.submissionPolicy ?? null;
    const seedDefinition = validateFormDefinition(seed.definition);
    const publishedStages = await listStages(organizationId, published.id);
    const publishedShape = canonicalJson(publishedStages.map(stageShape));
    const seedStages = await validateStages(organizationId, seedDefinition, seed.stages);
    const seedShape = canonicalJson(seedStages.map(stageShape));
    const knownPriorShapes: string[] = [];
    for (const prior of seed.priorPublishedStages ?? []) {
      knownPriorShapes.push(canonicalJson((await validateStages(organizationId, seedDefinition, prior)).map(stageShape)));
    }

    // FAIL CLOSED. The definition and signature policy must be exactly what the
    // seed declares, and the published workflow must be either the current seed
    // workflow or a frozen, known prior one. Anything else means the live
    // version differs unexpectedly and nothing is prepared.
    const sameFixedContent =
      definitionSha256(seedDefinition) === published.definitionSha256 &&
      canonicalJson(seed.signaturePolicy ?? null) === canonicalJson(published.signaturePolicy);
    const stagesCurrent = publishedShape === seedShape;
    if (!sameFixedContent || (!stagesCurrent && !knownPriorShapes.includes(publishedShape))) {
      results.push({ ...base, action: "blocked_content_changed" });
      continue;
    }
    if (stagesCurrent && canonicalJson(published.submissionPolicy) === canonicalJson(desiredPolicy)) {
      results.push({ ...base, action: "unchanged" });
      continue;
    }
    const proposedChanges = describeVersionChanges(published.submissionPolicy, desiredPolicy, publishedStages, seedStages);

    const draft = (await listVersions(organizationId, templateId)).find((v) => v.status === "draft");
    if (draft) {
      const matches =
        draft.definitionSha256 === published.definitionSha256 &&
        canonicalJson(draft.signaturePolicy) === canonicalJson(published.signaturePolicy) &&
        canonicalJson(draft.submissionPolicy) === canonicalJson(desiredPolicy) &&
        canonicalJson((await listStages(organizationId, draft.id)).map(stageShape)) === seedShape;
      results.push({ ...base, action: matches ? "draft_already_prepared" : "blocked_existing_draft", draftVersionId: draft.id, proposedChanges });
      continue;
    }

    if (params.dryRun) {
      results.push({ ...base, action: "would_prepare_draft", proposedChanges });
      continue;
    }
    // Content (definition, signature policy, render config) comes from the
    // PUBLISHED version; only the approved workflow and policy come from the seed.
    const version = await createDraftVersion({
      organizationId,
      templateId,
      definition: published.definition,
      signaturePolicy: published.signaturePolicy ?? undefined,
      submissionPolicy: desiredPolicy ?? undefined,
      renderConfig: published.renderConfig ?? undefined,
      stages: seedStages,
      changeNote: `Prepared from published v${published.versionNumber}: ${proposedChanges.join("; ")}`,
      actorApplicationUserId: actor.applicationUserId,
      actorMembershipId: actor.membershipId,
    });
    results.push({ ...base, action: "draft_prepared", draftVersionId: version.id, proposedChanges });
  }

  if (!params.dryRun) {
    await recordAuditEvent({
      actorApplicationUserId: actor.applicationUserId,
      actorMembershipId: actor.membershipId,
      organizationId,
      eventType: "form_template.submission_policy_versions_prepared",
      targetType: "organization",
      targetId: String(organizationId),
      metadata: { results: results.map((r) => ({ templateKey: r.templateKey, action: r.action, draftVersionId: r.draftVersionId ?? null })) },
    });
  }
  return results;
}
