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
import { createTemplate, publishVersion } from "./templates";
import type { FormDefinition } from "./definition";
import type { StageInput, SignaturePolicy } from "./templates";

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
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });
    let published = false;
    if (publish) {
      await publishVersion({ organizationId, versionId: version.id, actorApplicationUserId: params.actorApplicationUserId, actorMembershipId: params.actorMembershipId });
      published = true;
    }
    results.push({ templateKey: seed.templateKey, action: "installed", templateId: template.id, versionId: version.id, published });
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
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
