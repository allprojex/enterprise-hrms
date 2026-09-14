/**
 * WS-26 — templates, versions and workflow stages.
 *
 * Rules the service holds:
 *   - Every read and write is scoped by the organization id the route proved;
 *     an id from another tenant is "not found", never "forbidden".
 *   - A version is editable only while `status = draft` and no submission
 *     has ever referenced it (`firstUsedAt IS NULL`). Publishing freezes it;
 *     there is no code path that rewrites a published definition.
 *   - Exactly one published version per template (partial unique index);
 *     publishing a new one archives the previous in the same transaction.
 *   - Workflow stages belong to a version and are frozen with it. Stage
 *     resolution reuses the WS-13 vocabulary (department_head /
 *     permission_holder / specific_membership) and adds subject_employee and
 *     reporting_manager, both resolved through employee links.
 */
import { and, eq, asc, desc, sql } from "drizzle-orm";
import {
  db,
  formTemplatesTable,
  formTemplateVersionsTable,
  formWorkflowStagesTable,
  formSubmissionsTable,
  organizationMembershipsTable,
  employeesTable,
  employeeUserLinksTable,
  type FormTemplate,
  type FormTemplateVersion,
  type FormWorkflowStage,
  type FormStageParticipant,
  type FormStageResolver,
  type FormTemplateType,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { getEffectivePermissions } from "../permissions";
import { getCurrentDepartmentHead } from "../departmentHeads";
import { validateFormDefinition, definitionSha256, type FormDefinition, FormDefinitionError } from "./definition";
import { isKnownBinding } from "./bindings";
import { walkItems } from "./definition";

export class FormTemplateNotFoundError extends Error {}
export class FormVersionNotFoundError extends Error {}
export class FormTemplateStateError extends Error {}
export class FormStageConfigError extends Error {}

const PARTICIPANTS = new Set<FormStageParticipant>(["employee", "supervisor", "department_head", "hr", "final_approver", "assessor"]);
const RESOLVERS = new Set<FormStageResolver>(["subject_employee", "reporting_manager", "department_head", "permission_holder", "specific_membership"]);
const ACTIONS = new Set(["complete", "approve", "return", "reject"]);
const TEMPLATE_TYPES = new Set<FormTemplateType>(["leave_application", "personal_information", "staff_evaluation", "probationary_assessment", "generic"]);
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface StageInput {
  stageOrder: number;
  name: string;
  participant: FormStageParticipant;
  resolver: FormStageResolver;
  resolverConfig?: unknown;
  editableSectionKeys: string[];
  allowedActions: string[];
  signatureSlotKey?: string | null;
}

export interface SignaturePolicy {
  slots: { key: string; role: FormStageParticipant; required: boolean; methods: ("drawn" | "uploaded" | "device")[] }[];
}

interface Actor {
  actorApplicationUserId: number;
  actorMembershipId: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validates stages against a definition; returns canonical rows. */
export async function validateStages(organizationId: number, definition: FormDefinition, raw: unknown): Promise<StageInput[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new FormStageConfigError("stages must be a list");
  if (raw.length > 20) throw new FormStageConfigError("too many stages");
  const sectionKeys = new Set(definition.sections.map((s) => s.key));
  const signatureSlots = new Set([...walkItems(definition)].filter((e) => e.item.kind === "signature").map((e) => (e.item as { key: string }).key));
  const stages: StageInput[] = [];
  const orders = new Set<number>();
  for (const [index, s] of raw.entries()) {
    if (!isPlainObject(s)) throw new FormStageConfigError(`stage ${index} must be an object`);
    const stageOrder = Number(s.stageOrder);
    if (!Number.isInteger(stageOrder) || stageOrder < 1 || stageOrder > 20) throw new FormStageConfigError(`stage ${index} stageOrder must be 1–20`);
    if (orders.has(stageOrder)) throw new FormStageConfigError(`stage order ${stageOrder} is duplicated`);
    orders.add(stageOrder);
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (!name || name.length > 200) throw new FormStageConfigError(`stage ${stageOrder} needs a name`);
    const participant = String(s.participant) as FormStageParticipant;
    if (!PARTICIPANTS.has(participant)) throw new FormStageConfigError(`stage ${stageOrder} participant "${participant}" is invalid`);
    const resolver = String(s.resolver) as FormStageResolver;
    if (!RESOLVERS.has(resolver)) throw new FormStageConfigError(`stage ${stageOrder} resolver "${resolver}" is invalid`);
    let resolverConfig: Record<string, unknown> | null = null;
    if (resolver === "permission_holder") {
      const permissionKey = isPlainObject(s.resolverConfig) ? s.resolverConfig.permissionKey : undefined;
      if (typeof permissionKey !== "string" || !/^[a-z_.]+$/.test(permissionKey)) throw new FormStageConfigError(`stage ${stageOrder} needs resolverConfig.permissionKey`);
      resolverConfig = { permissionKey };
    } else if (resolver === "specific_membership") {
      const membershipId = isPlainObject(s.resolverConfig) ? Number(s.resolverConfig.membershipId) : NaN;
      if (!Number.isInteger(membershipId) || membershipId <= 0) throw new FormStageConfigError(`stage ${stageOrder} needs resolverConfig.membershipId`);
      const [m] = await db
        .select({ id: organizationMembershipsTable.id })
        .from(organizationMembershipsTable)
        .where(and(eq(organizationMembershipsTable.id, membershipId), eq(organizationMembershipsTable.organizationId, organizationId)))
        .limit(1);
      if (!m) throw new FormStageConfigError(`stage ${stageOrder} membership is not in this organization`);
      resolverConfig = { membershipId };
    }
    if (!Array.isArray(s.editableSectionKeys)) throw new FormStageConfigError(`stage ${stageOrder} needs editableSectionKeys`);
    const editableSectionKeys = s.editableSectionKeys.map((k) => {
      if (typeof k !== "string" || !sectionKeys.has(k)) throw new FormStageConfigError(`stage ${stageOrder} section "${String(k)}" is not in the definition`);
      return k;
    });
    if (!Array.isArray(s.allowedActions) || s.allowedActions.length === 0) throw new FormStageConfigError(`stage ${stageOrder} needs allowedActions`);
    const allowedActions = [...new Set(s.allowedActions.map((a) => {
      if (typeof a !== "string" || !ACTIONS.has(a)) throw new FormStageConfigError(`stage ${stageOrder} action "${String(a)}" is invalid`);
      return a;
    }))];
    let signatureSlotKey: string | null = null;
    if (s.signatureSlotKey !== undefined && s.signatureSlotKey !== null) {
      if (typeof s.signatureSlotKey !== "string" || !signatureSlots.has(s.signatureSlotKey)) throw new FormStageConfigError(`stage ${stageOrder} signature slot is not in the definition`);
      signatureSlotKey = s.signatureSlotKey;
    }
    stages.push({ stageOrder, name, participant, resolver, resolverConfig, editableSectionKeys, allowedActions, signatureSlotKey });
  }
  stages.sort((a, b) => a.stageOrder - b.stageOrder);
  stages.forEach((s, i) => {
    if (s.stageOrder !== i + 1) throw new FormStageConfigError("stage orders must be contiguous from 1");
  });
  return stages;
}

export function validateSignaturePolicy(definition: FormDefinition, raw: unknown): SignaturePolicy | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw) || !Array.isArray(raw.slots)) throw new FormDefinitionError("signaturePolicy.slots must be a list");
  const slotKeys = new Map<string, FormStageParticipant>();
  for (const e of walkItems(definition)) if (e.item.kind === "signature") slotKeys.set(e.item.key, e.item.role);
  const slots = raw.slots.map((s, i) => {
    if (!isPlainObject(s)) throw new FormDefinitionError(`signaturePolicy.slots[${i}] must be an object`);
    const key = String(s.key);
    if (!slotKeys.has(key)) throw new FormDefinitionError(`signaturePolicy slot "${key}" is not a signature item`);
    const methods = Array.isArray(s.methods) ? s.methods.map(String) : ["drawn"];
    for (const m of methods) if (!["drawn", "uploaded", "device"].includes(m)) throw new FormDefinitionError(`signaturePolicy slot "${key}" method "${m}" is invalid`);
    return { key, role: slotKeys.get(key)!, required: s.required !== false, methods: methods as SignaturePolicy["slots"][number]["methods"] };
  });
  return { slots };
}

function assertBindingsKnown(definition: FormDefinition): void {
  for (const { item } of walkItems(definition)) {
    if (item.kind === "field" && item.binding && !isKnownBinding(item.binding)) {
      throw new FormDefinitionError(`Field "${item.key}" binding ${item.binding.source}.${item.binding.ref} is not a known source`);
    }
  }
}

/* ---------------------------------------------------------------------- */
/* Reads                                                                   */
/* ---------------------------------------------------------------------- */

export async function listTemplates(organizationId: number, filter: { status?: FormTemplate["status"]; formType?: FormTemplateType } = {}) {
  const conditions = [eq(formTemplatesTable.organizationId, organizationId)];
  if (filter.status) conditions.push(eq(formTemplatesTable.status, filter.status));
  if (filter.formType) conditions.push(eq(formTemplatesTable.formType, filter.formType));
  const templates = await db.select().from(formTemplatesTable).where(and(...conditions)).orderBy(asc(formTemplatesTable.title));
  const versions = await db
    .select({
      id: formTemplateVersionsTable.id,
      templateId: formTemplateVersionsTable.templateId,
      versionNumber: formTemplateVersionsTable.versionNumber,
      status: formTemplateVersionsTable.status,
      publishedAt: formTemplateVersionsTable.publishedAt,
      firstUsedAt: formTemplateVersionsTable.firstUsedAt,
      definitionSha256: formTemplateVersionsTable.definitionSha256,
      submissionPolicy: formTemplateVersionsTable.submissionPolicy,
      changeNote: formTemplateVersionsTable.changeNote,
      createdAt: formTemplateVersionsTable.createdAt,
    })
    .from(formTemplateVersionsTable)
    .where(eq(formTemplateVersionsTable.organizationId, organizationId))
    .orderBy(asc(formTemplateVersionsTable.templateId), desc(formTemplateVersionsTable.versionNumber));
  return templates.map((t) => ({ ...t, versions: versions.filter((v) => v.templateId === t.id) }));
}

export async function getTemplate(organizationId: number, templateId: number): Promise<FormTemplate | null> {
  const [t] = await db
    .select()
    .from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.organizationId, organizationId)))
    .limit(1);
  return t ?? null;
}

export async function getTemplateByKey(organizationId: number, templateKey: string): Promise<FormTemplate | null> {
  const [t] = await db
    .select()
    .from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.templateKey, templateKey), eq(formTemplatesTable.organizationId, organizationId)))
    .limit(1);
  return t ?? null;
}

export async function getVersion(organizationId: number, versionId: number): Promise<FormTemplateVersion | null> {
  const [v] = await db
    .select()
    .from(formTemplateVersionsTable)
    .where(and(eq(formTemplateVersionsTable.id, versionId), eq(formTemplateVersionsTable.organizationId, organizationId)))
    .limit(1);
  return v ?? null;
}

export async function listVersions(organizationId: number, templateId: number): Promise<FormTemplateVersion[]> {
  return db
    .select()
    .from(formTemplateVersionsTable)
    .where(and(eq(formTemplateVersionsTable.templateId, templateId), eq(formTemplateVersionsTable.organizationId, organizationId)))
    .orderBy(desc(formTemplateVersionsTable.versionNumber));
}

export async function getPublishedVersion(organizationId: number, templateId: number): Promise<FormTemplateVersion | null> {
  const [v] = await db
    .select()
    .from(formTemplateVersionsTable)
    .where(
      and(
        eq(formTemplateVersionsTable.templateId, templateId),
        eq(formTemplateVersionsTable.organizationId, organizationId),
        eq(formTemplateVersionsTable.status, "published"),
      ),
    )
    .limit(1);
  return v ?? null;
}

export async function listStages(organizationId: number, versionId: number): Promise<FormWorkflowStage[]> {
  return db
    .select()
    .from(formWorkflowStagesTable)
    .where(and(eq(formWorkflowStagesTable.templateVersionId, versionId), eq(formWorkflowStagesTable.organizationId, organizationId)))
    .orderBy(asc(formWorkflowStagesTable.stageOrder));
}

export function parseDefinition(version: FormTemplateVersion): FormDefinition {
  return version.definition as FormDefinition;
}

/* ---------------------------------------------------------------------- */
/* Writes                                                                  */
/* ---------------------------------------------------------------------- */

export async function createTemplate(params: {
  organizationId: number;
  templateKey: string;
  formType: FormTemplateType;
  moduleKey?: string | null;
  title: string;
  description?: string | null;
  definition: unknown;
  signaturePolicy?: unknown;
  /** Version-level submission rules (e.g. allowOnBehalfSubmission). Fail-closed when absent. */
  submissionPolicy?: unknown;
  renderConfig?: unknown;
  stages?: unknown;
  changeNote?: string | null;
} & Actor) {
  if (!KEY_PATTERN.test(params.templateKey) || params.templateKey.length > 64) throw new FormDefinitionError("templateKey must be lower_snake_case");
  if (!TEMPLATE_TYPES.has(params.formType)) throw new FormDefinitionError("formType is invalid");
  const title = params.title.trim();
  if (!title || title.length > 300) throw new FormDefinitionError("title is required");
  if (params.moduleKey && !/^[a-z_]+$/.test(params.moduleKey)) throw new FormDefinitionError("moduleKey is invalid");
  const definition = validateFormDefinition(params.definition);
  assertBindingsKnown(definition);
  const signaturePolicy = validateSignaturePolicy(definition, params.signaturePolicy);
  const stages = await validateStages(params.organizationId, definition, params.stages);
  const existing = await getTemplateByKey(params.organizationId, params.templateKey);
  if (existing) throw new FormTemplateStateError(`A template with key "${params.templateKey}" already exists`);

  const result = await db.transaction(async (tx) => {
    const [template] = await tx
      .insert(formTemplatesTable)
      .values({
        organizationId: params.organizationId,
        templateKey: params.templateKey,
        formType: params.formType,
        moduleKey: params.moduleKey ?? null,
        title,
        description: params.description?.trim() || null,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();
    const [version] = await tx
      .insert(formTemplateVersionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: template.id,
        versionNumber: 1,
        status: "draft",
        definition,
        definitionSha256: definitionSha256(definition),
        signaturePolicy,
        submissionPolicy: isPlainObject(params.submissionPolicy) ? params.submissionPolicy : null,
        renderConfig: isPlainObject(params.renderConfig) ? params.renderConfig : null,
        changeNote: params.changeNote?.trim() || null,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();
    if (stages.length > 0) {
      await tx.insert(formWorkflowStagesTable).values(stages.map((s) => ({ ...s, organizationId: params.organizationId, templateVersionId: version.id })));
    }
    return { template, version };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "form_template.created",
    targetType: "form_template",
    targetId: String(result.template.id),
    metadata: { templateKey: params.templateKey, formType: params.formType, versionId: result.version.id, definitionSha256: result.version.definitionSha256 },
  });
  return result;
}

export async function createDraftVersion(params: {
  organizationId: number;
  templateId: number;
  definition: unknown;
  signaturePolicy?: unknown;
  /** Version-level submission rules (e.g. allowOnBehalfSubmission). Fail-closed when absent. */
  submissionPolicy?: unknown;
  renderConfig?: unknown;
  stages?: unknown;
  changeNote?: string | null;
} & Actor) {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template) throw new FormTemplateNotFoundError();
  if (template.status !== "active") throw new FormTemplateStateError("Template is archived");
  const versions = await listVersions(params.organizationId, params.templateId);
  if (versions.some((v) => v.status === "draft")) throw new FormTemplateStateError("A draft version already exists; edit or publish it first");
  const definition = validateFormDefinition(params.definition);
  assertBindingsKnown(definition);
  const signaturePolicy = validateSignaturePolicy(definition, params.signaturePolicy);
  const stages = await validateStages(params.organizationId, definition, params.stages);
  const nextNumber = (versions[0]?.versionNumber ?? 0) + 1;

  const version = await db.transaction(async (tx) => {
    const [v] = await tx
      .insert(formTemplateVersionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: params.templateId,
        versionNumber: nextNumber,
        status: "draft",
        definition,
        definitionSha256: definitionSha256(definition),
        signaturePolicy,
        submissionPolicy: isPlainObject(params.submissionPolicy) ? params.submissionPolicy : null,
        renderConfig: isPlainObject(params.renderConfig) ? params.renderConfig : null,
        changeNote: params.changeNote?.trim() || null,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();
    if (stages.length > 0) {
      await tx.insert(formWorkflowStagesTable).values(stages.map((s) => ({ ...s, organizationId: params.organizationId, templateVersionId: v.id })));
    }
    return v;
  });
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "form_template.version_created",
    targetType: "form_template_version",
    targetId: String(version.id),
    metadata: { templateId: params.templateId, versionNumber: version.versionNumber, definitionSha256: version.definitionSha256 },
  });
  return version;
}

export async function updateDraftVersion(params: {
  organizationId: number;
  versionId: number;
  definition?: unknown;
  signaturePolicy?: unknown;
  /** Version-level submission rules (e.g. allowOnBehalfSubmission). Fail-closed when absent. */
  submissionPolicy?: unknown;
  renderConfig?: unknown;
  stages?: unknown;
  changeNote?: string | null;
} & Actor) {
  const version = await getVersion(params.organizationId, params.versionId);
  if (!version) throw new FormVersionNotFoundError();
  if (version.status !== "draft") throw new FormTemplateStateError("Only a draft version can be edited");
  if (version.firstUsedAt) throw new FormTemplateStateError("This version has been used by a submission and is frozen");

  const definition = params.definition === undefined ? parseDefinition(version) : validateFormDefinition(params.definition);
  assertBindingsKnown(definition);
  const signaturePolicy = params.signaturePolicy === undefined ? (version.signaturePolicy as SignaturePolicy | null) : validateSignaturePolicy(definition, params.signaturePolicy);
  const stages = params.stages === undefined ? null : await validateStages(params.organizationId, definition, params.stages);
  const sha = definitionSha256(definition);

  const updated = await db.transaction(async (tx) => {
    const [v] = await tx
      .update(formTemplateVersionsTable)
      .set({
        definition,
        definitionSha256: sha,
        signaturePolicy,
        // Only an explicit value changes the policy. Omitting it (e.g. an edit
        // that touches only the change note) must never silently close a draft
        // that was deliberately opened for assisted completion.
        ...(params.submissionPolicy !== undefined
          ? { submissionPolicy: isPlainObject(params.submissionPolicy) ? params.submissionPolicy : null }
          : {}),
        ...(params.renderConfig !== undefined ? { renderConfig: isPlainObject(params.renderConfig) ? params.renderConfig : null } : {}),
        ...(params.changeNote !== undefined ? { changeNote: params.changeNote?.trim() || null } : {}),
      })
      .where(and(eq(formTemplateVersionsTable.id, params.versionId), eq(formTemplateVersionsTable.status, "draft"), sql`${formTemplateVersionsTable.firstUsedAt} IS NULL`))
      .returning();
    if (!v) throw new FormTemplateStateError("Version is no longer editable");
    if (stages) {
      await tx.delete(formWorkflowStagesTable).where(eq(formWorkflowStagesTable.templateVersionId, params.versionId));
      if (stages.length > 0) {
        await tx.insert(formWorkflowStagesTable).values(stages.map((s) => ({ ...s, organizationId: params.organizationId, templateVersionId: params.versionId })));
      }
    }
    return v;
  });
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "form_template.version_updated",
    targetType: "form_template_version",
    targetId: String(updated.id),
    metadata: { templateId: updated.templateId, versionNumber: updated.versionNumber, definitionSha256: sha, stagesReplaced: stages !== null },
  });
  return updated;
}

export async function publishVersion(params: { organizationId: number; versionId: number } & Actor) {
  const version = await getVersion(params.organizationId, params.versionId);
  if (!version) throw new FormVersionNotFoundError();
  if (version.status !== "draft") throw new FormTemplateStateError("Only a draft version can be published");
  const template = await getTemplate(params.organizationId, version.templateId);
  if (!template || template.status !== "active") throw new FormTemplateStateError("Template is archived");
  const stages = await listStages(params.organizationId, version.id);

  const now = new Date();
  const published = await db.transaction(async (tx) => {
    const previous = await tx
      .select({ id: formTemplateVersionsTable.id })
      .from(formTemplateVersionsTable)
      .where(and(eq(formTemplateVersionsTable.templateId, version.templateId), eq(formTemplateVersionsTable.status, "published")));
    for (const p of previous) {
      await tx.update(formTemplateVersionsTable).set({ status: "archived", archivedAt: now }).where(eq(formTemplateVersionsTable.id, p.id));
    }
    const [v] = await tx
      .update(formTemplateVersionsTable)
      .set({ status: "published", publishedAt: now, publishedByMembershipId: params.actorMembershipId })
      .where(and(eq(formTemplateVersionsTable.id, version.id), eq(formTemplateVersionsTable.status, "draft")))
      .returning();
    if (!v) throw new FormTemplateStateError("Version is no longer a draft");
    await tx.update(formTemplatesTable).set({ currentPublishedVersionId: v.id }).where(eq(formTemplatesTable.id, version.templateId));
    return { version: v, previousVersionIds: previous.map((p) => p.id) };
  });
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "form_template.version_published",
    targetType: "form_template_version",
    targetId: String(published.version.id),
    metadata: {
      templateId: version.templateId,
      versionNumber: published.version.versionNumber,
      definitionSha256: published.version.definitionSha256,
      stageCount: stages.length,
      supersededVersionIds: published.previousVersionIds,
    },
  });
  return published.version;
}

export async function archiveTemplate(params: { organizationId: number; templateId: number } & Actor) {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template) throw new FormTemplateNotFoundError();
  if (template.status === "archived") return template;
  const [updated] = await db
    .update(formTemplatesTable)
    .set({ status: "archived", archivedAt: new Date(), archivedByMembershipId: params.actorMembershipId })
    .where(eq(formTemplatesTable.id, template.id))
    .returning();
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "form_template.archived",
    targetType: "form_template",
    targetId: String(template.id),
    metadata: { templateKey: template.templateKey },
  });
  return updated;
}

/** Whether any submission references this version (used by tests and the lock guard). */
export async function versionHasSubmissions(organizationId: number, versionId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: formSubmissionsTable.id })
    .from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.templateVersionId, versionId), eq(formSubmissionsTable.organizationId, organizationId)))
    .limit(1);
  return Boolean(row);
}

/* ---------------------------------------------------------------------- */
/* Stage resolution                                                        */
/* ---------------------------------------------------------------------- */

async function membershipOfEmployee(organizationId: number, employeeId: number): Promise<number | null> {
  const [link] = await db
    .select({ membershipId: employeeUserLinksTable.organizationMembershipId })
    .from(employeeUserLinksTable)
    .innerJoin(employeesTable, eq(employeesTable.id, employeeUserLinksTable.employeeId))
    .where(and(eq(employeeUserLinksTable.employeeId, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  return link?.membershipId ?? null;
}

/**
 * Whether `membershipId` is the actor a stage resolves to for the subject
 * employee. Live on every call — a replaced department head or manager
 * takes over pending work immediately (WS-13 rule), and the frozen stage
 * row only says HOW to resolve, never WHO.
 */
export async function membershipSatisfiesFormStage(params: {
  organizationId: number;
  stage: FormWorkflowStage;
  membershipId: number;
  subjectEmployeeId: number;
}): Promise<boolean> {
  const config = (params.stage.resolverConfig ?? {}) as Record<string, unknown>;
  switch (params.stage.resolver) {
    case "specific_membership":
      return config.membershipId === params.membershipId;
    case "permission_holder": {
      if (typeof config.permissionKey !== "string") return false;
      const permissions = await getEffectivePermissions(params.membershipId);
      return permissions.has(config.permissionKey);
    }
    case "subject_employee":
      return (await membershipOfEmployee(params.organizationId, params.subjectEmployeeId)) === params.membershipId;
    case "reporting_manager": {
      const [subject] = await db
        .select({ reportingManagerId: employeesTable.reportingManagerId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, params.subjectEmployeeId), eq(employeesTable.organizationId, params.organizationId)))
        .limit(1);
      if (!subject?.reportingManagerId) return false;
      return (await membershipOfEmployee(params.organizationId, subject.reportingManagerId)) === params.membershipId;
    }
    case "department_head": {
      const [subject] = await db
        .select({ departmentId: employeesTable.departmentId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, params.subjectEmployeeId), eq(employeesTable.organizationId, params.organizationId)))
        .limit(1);
      if (!subject?.departmentId) return false;
      const head = await getCurrentDepartmentHead(params.organizationId, subject.departmentId);
      return head?.headMembershipId === params.membershipId;
    }
  }
}

export { membershipOfEmployee };
