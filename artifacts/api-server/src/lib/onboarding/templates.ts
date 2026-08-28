import { and, eq, desc, sql, isNull, or } from "drizzle-orm";
import {
  db,
  onboardingTemplatesTable,
  onboardingTemplateVersionsTable,
  onboardingTemplateTasksTable,
  organizationDocumentsTable,
  organizationMembershipsTable,
  type OnboardingTemplate,
  type OnboardingTemplateVersion,
  type OnboardingTemplateTask,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { assertUsableCategory } from "../documentCategories";
import { ONBOARDING_TASK_KINDS, type OnboardingTaskKind } from "./kinds";
import type { OnboardingResponsibilityResolver } from "./responsibility";

/**
 * WS-10 — onboarding template configuration (§26.6, §26.7, §26.27).
 *
 * A template is organization configuration; an instance is business data. That
 * split is the same one WS-8 drew for custom fields, and it is why editing a
 * template can never reach into onboarding already issued.
 */

export class OnboardingTemplateNotFoundError extends Error {
  constructor() {
    super("Onboarding template not found.");
    this.name = "OnboardingTemplateNotFoundError";
  }
}
export class OnboardingTemplateVersionNotFoundError extends Error {
  constructor() {
    super("Onboarding template version not found.");
    this.name = "OnboardingTemplateVersionNotFoundError";
  }
}
export class TemplateVersionNotEditableError extends Error {
  constructor() {
    super("Only a draft version may be edited. Create a new version instead.");
    this.name = "TemplateVersionNotEditableError";
  }
}
export class TemplateVersionNotActivatableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateVersionNotActivatableError";
  }
}
export class InvalidTaskDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskDefinitionError";
  }
}

export interface TemplateApplicability {
  branchId?: number | null;
  departmentId?: number | null;
  positionId?: number | null;
  employmentType?: OnboardingTemplate["employmentType"];
}

export async function listTemplates(organizationId: number): Promise<
  { template: OnboardingTemplate; activeVersion: OnboardingTemplateVersion | null; versionCount: number }[]
> {
  const templates = await db
    .select()
    .from(onboardingTemplatesTable)
    .where(eq(onboardingTemplatesTable.organizationId, organizationId))
    .orderBy(onboardingTemplatesTable.name);

  const result: { template: OnboardingTemplate; activeVersion: OnboardingTemplateVersion | null; versionCount: number }[] = [];
  for (const template of templates) {
    const versions = await db
      .select()
      .from(onboardingTemplateVersionsTable)
      .where(eq(onboardingTemplateVersionsTable.templateId, template.id));
    result.push({
      template,
      activeVersion: versions.find((v) => v.status === "active") ?? null,
      versionCount: versions.length,
    });
  }
  return result;
}

export async function getTemplate(organizationId: number, templateId: number): Promise<OnboardingTemplate | null> {
  const [row] = await db
    .select()
    .from(onboardingTemplatesTable)
    .where(and(eq(onboardingTemplatesTable.id, templateId), eq(onboardingTemplatesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function createTemplate(params: {
  organizationId: number;
  name: string;
  description?: string | null;
  applicability?: TemplateApplicability;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<{ template: OnboardingTemplate; version: OnboardingTemplateVersion }> {
  const created = await db.transaction(async (tx) => {
    const [template] = await tx
      .insert(onboardingTemplatesTable)
      .values({
        organizationId: params.organizationId,
        name: params.name,
        description: params.description ?? null,
        branchId: params.applicability?.branchId ?? null,
        departmentId: params.applicability?.departmentId ?? null,
        positionId: params.applicability?.positionId ?? null,
        employmentType: params.applicability?.employmentType ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    // A template is never useful without a version, so version 1 is created in
    // the same transaction — the same envelope-plus-first-version move
    // organization_documents makes.
    const [version] = await tx
      .insert(onboardingTemplateVersionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: template.id,
        versionNumber: 1,
        status: "draft",
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    return { template, version };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.template_created",
    targetType: "onboarding_template",
    targetId: String(created.template.id),
    afterState: { name: created.template.name, versionNumber: 1 },
  });

  return created;
}

export async function updateTemplate(params: {
  organizationId: number;
  templateId: number;
  name?: string;
  description?: string | null;
  applicability?: TemplateApplicability;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingTemplate> {
  const existing = await getTemplate(params.organizationId, params.templateId);
  if (!existing) throw new OnboardingTemplateNotFoundError();

  const [updated] = await db
    .update(onboardingTemplatesTable)
    .set({
      name: params.name ?? existing.name,
      description: params.description === undefined ? existing.description : params.description,
      branchId: params.applicability ? (params.applicability.branchId ?? null) : existing.branchId,
      departmentId: params.applicability ? (params.applicability.departmentId ?? null) : existing.departmentId,
      positionId: params.applicability ? (params.applicability.positionId ?? null) : existing.positionId,
      employmentType: params.applicability ? (params.applicability.employmentType ?? null) : existing.employmentType,
    })
    .where(eq(onboardingTemplatesTable.id, params.templateId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.template_updated",
    targetType: "onboarding_template",
    targetId: String(params.templateId),
    beforeState: { name: existing.name },
    afterState: { name: updated.name },
  });
  return updated;
}

export async function listVersions(organizationId: number, templateId: number): Promise<OnboardingTemplateVersion[]> {
  return db
    .select()
    .from(onboardingTemplateVersionsTable)
    .where(
      and(
        eq(onboardingTemplateVersionsTable.organizationId, organizationId),
        eq(onboardingTemplateVersionsTable.templateId, templateId),
      ),
    )
    .orderBy(desc(onboardingTemplateVersionsTable.versionNumber));
}

export async function getVersion(organizationId: number, versionId: number): Promise<OnboardingTemplateVersion | null> {
  const [row] = await db
    .select()
    .from(onboardingTemplateVersionsTable)
    .where(
      and(eq(onboardingTemplateVersionsTable.id, versionId), eq(onboardingTemplateVersionsTable.organizationId, organizationId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Starts a new draft, optionally copying the tasks of an existing version so an
 * organization can revise rather than retype. The source version is never
 * modified — that is the whole point of versioning (§26.7).
 */
export async function createVersion(params: {
  organizationId: number;
  templateId: number;
  copyFromVersionId?: number | null;
  changeNote?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingTemplateVersion> {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template) throw new OnboardingTemplateNotFoundError();

  const version = await db.transaction(async (tx) => {
    const [{ maxNumber }] = await tx
      .select({ maxNumber: sql<number>`coalesce(max(${onboardingTemplateVersionsTable.versionNumber}), 0)` })
      .from(onboardingTemplateVersionsTable)
      .where(eq(onboardingTemplateVersionsTable.templateId, params.templateId));

    const [created] = await tx
      .insert(onboardingTemplateVersionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: params.templateId,
        versionNumber: Number(maxNumber) + 1,
        status: "draft",
        changeNote: params.changeNote ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    if (params.copyFromVersionId) {
      const source = await tx
        .select()
        .from(onboardingTemplateTasksTable)
        .where(
          and(
            eq(onboardingTemplateTasksTable.templateVersionId, params.copyFromVersionId),
            eq(onboardingTemplateTasksTable.organizationId, params.organizationId),
          ),
        )
        .orderBy(onboardingTemplateTasksTable.displayOrder);

      // Task dependencies are self-references, so they are remapped from old id
      // to new id rather than copied verbatim — a copied dependency pointing at
      // the SOURCE version's task would silently cross versions.
      const idMap = new Map<number, number>();
      for (const task of source) {
        const [inserted] = await tx
          .insert(onboardingTemplateTasksTable)
          .values({
            organizationId: params.organizationId,
            templateVersionId: created.id,
            displayOrder: task.displayOrder,
            title: task.title,
            description: task.description,
            taskKind: task.taskKind,
            required: task.required,
            responsibleResolver: task.responsibleResolver,
            responsiblePermissionKey: task.responsiblePermissionKey,
            responsibleMembershipId: task.responsibleMembershipId,
            dueBasis: task.dueBasis,
            dueOffsetDays: task.dueOffsetDays,
            dependsOnTemplateTaskId: null,
            documentCategoryCode: task.documentCategoryCode,
            acknowledgementDocumentId: task.acknowledgementDocumentId,
          })
          .returning();
        idMap.set(task.id, inserted.id);
      }
      for (const task of source) {
        if (task.dependsOnTemplateTaskId && idMap.has(task.dependsOnTemplateTaskId)) {
          await tx
            .update(onboardingTemplateTasksTable)
            .set({ dependsOnTemplateTaskId: idMap.get(task.dependsOnTemplateTaskId)! })
            .where(eq(onboardingTemplateTasksTable.id, idMap.get(task.id)!));
        }
      }
    }

    return created;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.template_versioned",
    targetType: "onboarding_template_version",
    targetId: String(version.id),
    afterState: { templateId: params.templateId, versionNumber: version.versionNumber },
  });
  return version;
}

export async function listVersionTasks(organizationId: number, versionId: number): Promise<OnboardingTemplateTask[]> {
  return db
    .select()
    .from(onboardingTemplateTasksTable)
    .where(
      and(
        eq(onboardingTemplateTasksTable.templateVersionId, versionId),
        eq(onboardingTemplateTasksTable.organizationId, organizationId),
      ),
    )
    .orderBy(onboardingTemplateTasksTable.displayOrder);
}

export interface TaskDefinitionInput {
  title: string;
  description?: string | null;
  taskKind?: OnboardingTaskKind;
  required?: boolean;
  responsibleResolver?: OnboardingResponsibilityResolver;
  responsiblePermissionKey?: string | null;
  responsibleMembershipId?: number | null;
  dueBasis?: "onboarding_start" | "commencement_date" | "dependency_completion" | null;
  dueOffsetDays?: number | null;
  dependsOnTemplateTaskId?: number | null;
  documentCategoryCode?: string | null;
  acknowledgementDocumentId?: number | null;
}

/** Bounded so a configuration mistake cannot schedule a reminder years away. */
const MAX_DUE_OFFSET_DAYS = 365;

async function validateTaskDefinition(organizationId: number, input: TaskDefinitionInput): Promise<void> {
  if (!input.title?.trim()) throw new InvalidTaskDefinitionError("A task needs a title.");

  const kind = input.taskKind ?? "general";
  if (!ONBOARDING_TASK_KINDS.includes(kind)) {
    throw new InvalidTaskDefinitionError(`Unknown task kind: ${kind}`);
  }

  if (input.responsibleResolver === "permission_holder" && !input.responsiblePermissionKey?.trim()) {
    throw new InvalidTaskDefinitionError("A permission-holder task needs a permission key.");
  }
  if (input.responsibleResolver === "specific_membership") {
    if (!input.responsibleMembershipId) {
      throw new InvalidTaskDefinitionError("A named-person task needs a member.");
    }
    // Cross-tenant guard: a membership id from another organization must never
    // be storable, even by a caller with valid configuration rights here.
    const [membership] = await db
      .select({ id: organizationMembershipsTable.id })
      .from(organizationMembershipsTable)
      .where(
        and(
          eq(organizationMembershipsTable.id, input.responsibleMembershipId),
          eq(organizationMembershipsTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!membership) throw new InvalidTaskDefinitionError("That member does not belong to this organization.");
  }

  if (input.dueOffsetDays != null) {
    if (!Number.isInteger(input.dueOffsetDays) || Math.abs(input.dueOffsetDays) > MAX_DUE_OFFSET_DAYS) {
      throw new InvalidTaskDefinitionError(`Due offset must be a whole number of days within ±${MAX_DUE_OFFSET_DAYS}.`);
    }
  }
  if (input.dueBasis === "dependency_completion" && !input.dependsOnTemplateTaskId) {
    throw new InvalidTaskDefinitionError("A dependency-based due date needs a predecessor task.");
  }

  if (kind === "document") {
    if (!input.documentCategoryCode?.trim()) {
      throw new InvalidTaskDefinitionError("A document task needs a document category.");
    }
    // Delegated to WS-5, which owns what a valid category is for this org.
    await assertUsableCategory(organizationId, input.documentCategoryCode);
  }

  if (kind === "acknowledgement") {
    if (!input.acknowledgementDocumentId) {
      throw new InvalidTaskDefinitionError("An acknowledgement task needs a document.");
    }
    const [doc] = await db
      .select({ id: organizationDocumentsTable.id })
      .from(organizationDocumentsTable)
      .where(
        and(
          eq(organizationDocumentsTable.id, input.acknowledgementDocumentId),
          eq(organizationDocumentsTable.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!doc) throw new InvalidTaskDefinitionError("That document does not belong to this organization.");
  }
}

async function assertVersionEditable(organizationId: number, versionId: number): Promise<OnboardingTemplateVersion> {
  const version = await getVersion(organizationId, versionId);
  if (!version) throw new OnboardingTemplateVersionNotFoundError();
  if (version.status !== "draft") throw new TemplateVersionNotEditableError();
  return version;
}

export async function addVersionTask(params: {
  organizationId: number;
  versionId: number;
  definition: TaskDefinitionInput;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingTemplateTask> {
  await assertVersionEditable(params.organizationId, params.versionId);
  await validateTaskDefinition(params.organizationId, params.definition);

  const existing = await listVersionTasks(params.organizationId, params.versionId);
  const [created] = await db
    .insert(onboardingTemplateTasksTable)
    .values({
      organizationId: params.organizationId,
      templateVersionId: params.versionId,
      displayOrder: existing.length > 0 ? Math.max(...existing.map((t) => t.displayOrder)) + 1 : 1,
      title: params.definition.title.trim(),
      description: params.definition.description ?? null,
      taskKind: params.definition.taskKind ?? "general",
      required: params.definition.required ?? true,
      responsibleResolver: params.definition.responsibleResolver ?? "employee_self",
      responsiblePermissionKey: params.definition.responsiblePermissionKey ?? null,
      responsibleMembershipId: params.definition.responsibleMembershipId ?? null,
      dueBasis: params.definition.dueBasis ?? null,
      dueOffsetDays: params.definition.dueOffsetDays ?? null,
      dependsOnTemplateTaskId: params.definition.dependsOnTemplateTaskId ?? null,
      documentCategoryCode: params.definition.documentCategoryCode ?? null,
      acknowledgementDocumentId: params.definition.acknowledgementDocumentId ?? null,
    })
    .returning();
  return created;
}

export async function deleteVersionTask(params: {
  organizationId: number;
  versionId: number;
  taskId: number;
}): Promise<void> {
  await assertVersionEditable(params.organizationId, params.versionId);
  await db
    .delete(onboardingTemplateTasksTable)
    .where(
      and(
        eq(onboardingTemplateTasksTable.id, params.taskId),
        eq(onboardingTemplateTasksTable.templateVersionId, params.versionId),
        eq(onboardingTemplateTasksTable.organizationId, params.organizationId),
      ),
    );
}

/**
 * Publishes a draft. Any previously active version of the same template is
 * archived in the same transaction, so the partial unique index guaranteeing
 * one active version per template is never violated — and instances that
 * snapshotted the outgoing version keep running untouched (§26.7).
 */
export async function activateVersion(params: {
  organizationId: number;
  versionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingTemplateVersion> {
  const version = await getVersion(params.organizationId, params.versionId);
  if (!version) throw new OnboardingTemplateVersionNotFoundError();
  if (version.status === "active") return version;
  if (version.status === "archived") {
    throw new TemplateVersionNotActivatableError("An archived version cannot be reactivated. Create a new version.");
  }

  const tasks = await listVersionTasks(params.organizationId, params.versionId);
  if (tasks.length === 0) {
    throw new TemplateVersionNotActivatableError("A version needs at least one task before it can be activated.");
  }

  const activated = await db.transaction(async (tx) => {
    await tx
      .update(onboardingTemplateVersionsTable)
      .set({ status: "archived", archivedAt: new Date(), archivedBy: params.actorApplicationUserId })
      .where(
        and(
          eq(onboardingTemplateVersionsTable.templateId, version.templateId),
          eq(onboardingTemplateVersionsTable.status, "active"),
        ),
      );

    const [row] = await tx
      .update(onboardingTemplateVersionsTable)
      .set({ status: "active", activatedAt: new Date(), activatedBy: params.actorApplicationUserId })
      .where(eq(onboardingTemplateVersionsTable.id, params.versionId))
      .returning();
    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.template_activated",
    targetType: "onboarding_template_version",
    targetId: String(params.versionId),
    afterState: { templateId: version.templateId, versionNumber: version.versionNumber, taskCount: tasks.length },
  });
  return activated;
}

export async function archiveVersion(params: {
  organizationId: number;
  versionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingTemplateVersion> {
  const version = await getVersion(params.organizationId, params.versionId);
  if (!version) throw new OnboardingTemplateVersionNotFoundError();

  const [row] = await db
    .update(onboardingTemplateVersionsTable)
    .set({ status: "archived", archivedAt: new Date(), archivedBy: params.actorApplicationUserId })
    .where(eq(onboardingTemplateVersionsTable.id, params.versionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.template_archived",
    targetType: "onboarding_template_version",
    targetId: String(params.versionId),
    afterState: { templateId: version.templateId, versionNumber: version.versionNumber },
  });
  return row;
}

/**
 * Picks the active template version that best fits an employee.
 *
 * Specificity wins: a template naming this employee's position beats one naming
 * only their department, which beats an organization-wide default. This is a
 * deterministic score over four nullable columns, NOT a rules engine (§26.6) —
 * there is nothing here an organization can write an expression into.
 *
 * Returns null when no active template applies, which is a legitimate state:
 * onboarding is not started automatically for organizations that configured none.
 */
export async function resolveApplicableVersion(params: {
  organizationId: number;
  branchId: number | null;
  departmentId: number | null;
  positionId: number | null;
  employmentType: OnboardingTemplate["employmentType"];
}): Promise<{ template: OnboardingTemplate; version: OnboardingTemplateVersion } | null> {
  const rows = await db
    .select({ template: onboardingTemplatesTable, version: onboardingTemplateVersionsTable })
    .from(onboardingTemplateVersionsTable)
    .innerJoin(onboardingTemplatesTable, eq(onboardingTemplatesTable.id, onboardingTemplateVersionsTable.templateId))
    .where(
      and(
        eq(onboardingTemplateVersionsTable.organizationId, params.organizationId),
        eq(onboardingTemplateVersionsTable.status, "active"),
        or(isNull(onboardingTemplatesTable.branchId), eq(onboardingTemplatesTable.branchId, params.branchId ?? -1)),
        or(isNull(onboardingTemplatesTable.departmentId), eq(onboardingTemplatesTable.departmentId, params.departmentId ?? -1)),
        or(isNull(onboardingTemplatesTable.positionId), eq(onboardingTemplatesTable.positionId, params.positionId ?? -1)),
        params.employmentType
          ? or(isNull(onboardingTemplatesTable.employmentType), eq(onboardingTemplatesTable.employmentType, params.employmentType))
          : isNull(onboardingTemplatesTable.employmentType),
      ),
    );

  if (rows.length === 0) return null;

  const score = (t: OnboardingTemplate): number =>
    (t.positionId != null ? 8 : 0) + (t.departmentId != null ? 4 : 0) + (t.branchId != null ? 2 : 0) + (t.employmentType != null ? 1 : 0);

  // Ties broken by lowest template id so the choice is stable across calls
  // rather than dependent on row order.
  return rows.sort((a, b) => score(b.template) - score(a.template) || a.template.id - b.template.id)[0];
}
