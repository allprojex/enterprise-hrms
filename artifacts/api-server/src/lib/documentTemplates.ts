/**
 * WS-5 (§20-22, §36, §51) — organization-scoped document templates and their
 * immutable version history.
 *
 * Editing model, mirroring offer_versions' own draft/non-draft precedent:
 * a `draft` version is mutable in place; an `active` one is not — editing it
 * creates a new draft version instead. That is what makes §24's guarantee
 * hold: a letter generated from version N always remains explainable by
 * reading version N, which no later edit can alter.
 *
 * At most one version per template may be `active`, enforced by a partial
 * unique index rather than by application convention, so two concurrent
 * activations cannot both succeed (§51's template-activation race).
 */
import { and, eq, desc, type SQL } from "drizzle-orm";
import {
  db,
  documentTemplatesTable,
  documentTemplateVersionsTable,
  type DocumentTemplate,
  type DocumentTemplateVersion,
} from "@workspace/db";
import { assertUsableCategory } from "./documentCategories";
import { assertKnownMergeFields } from "./documentMerge";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class DocumentTemplateNotFoundError extends Error {
  constructor() {
    super("Template not found");
    this.name = "DocumentTemplateNotFoundError";
  }
}

export class DocumentTemplateVersionNotFoundError extends Error {
  constructor() {
    super("Template version not found");
    this.name = "DocumentTemplateVersionNotFoundError";
  }
}

export class TemplateVersionImmutableError extends Error {
  constructor() {
    super("Only a draft version can be edited; create a new version instead");
    this.name = "TemplateVersionImmutableError";
  }
}

export class TemplateActivationConflictError extends Error {
  constructor() {
    super("Another version was activated concurrently; reload and retry");
    this.name = "TemplateActivationConflictError";
  }
}

export class NoActiveTemplateVersionError extends Error {
  constructor() {
    super("This template has no active version to generate from");
    this.name = "NoActiveTemplateVersionError";
  }
}

/** Templates for an organization; never crosses an organization boundary. */
export async function listTemplates(
  organizationId: number,
  filters: { categoryCode?: string; status?: "active" | "inactive" } = {},
): Promise<DocumentTemplate[]> {
  const conditions: SQL[] = [eq(documentTemplatesTable.organizationId, organizationId)];
  if (filters.categoryCode) conditions.push(eq(documentTemplatesTable.categoryCode, filters.categoryCode));
  if (filters.status) conditions.push(eq(documentTemplatesTable.status, filters.status));
  return db.select().from(documentTemplatesTable).where(and(...conditions)).orderBy(desc(documentTemplatesTable.updatedAt));
}

export async function getTemplate(organizationId: number, templateId: number): Promise<DocumentTemplate | null> {
  const [row] = await db
    .select()
    .from(documentTemplatesTable)
    .where(and(eq(documentTemplatesTable.organizationId, organizationId), eq(documentTemplatesTable.id, templateId)))
    .limit(1);
  return row ?? null;
}

export async function listTemplateVersions(organizationId: number, templateId: number): Promise<DocumentTemplateVersion[]> {
  return db
    .select()
    .from(documentTemplateVersionsTable)
    .where(
      and(
        eq(documentTemplateVersionsTable.organizationId, organizationId),
        eq(documentTemplateVersionsTable.templateId, templateId),
      ),
    )
    .orderBy(desc(documentTemplateVersionsTable.versionNumber));
}

/** One version, re-proved against both template and organization (§54: template IDOR). */
export async function getTemplateVersion(
  organizationId: number,
  templateId: number,
  versionId: number,
): Promise<DocumentTemplateVersion | null> {
  const [row] = await db
    .select()
    .from(documentTemplateVersionsTable)
    .where(
      and(
        eq(documentTemplateVersionsTable.organizationId, organizationId),
        eq(documentTemplateVersionsTable.templateId, templateId),
        eq(documentTemplateVersionsTable.id, versionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The version generation uses. Never falls back to a draft. */
export async function getActiveVersion(organizationId: number, templateId: number): Promise<DocumentTemplateVersion | null> {
  const [row] = await db
    .select()
    .from(documentTemplateVersionsTable)
    .where(
      and(
        eq(documentTemplateVersionsTable.organizationId, organizationId),
        eq(documentTemplateVersionsTable.templateId, templateId),
        eq(documentTemplateVersionsTable.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Creates a template plus its version 1 draft in one transaction. */
export async function createTemplate(params: {
  organizationId: number;
  categoryCode: string;
  name: string;
  description?: string | null;
  content: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<{ template: DocumentTemplate; version: DocumentTemplateVersion }> {
  await assertUsableCategory(params.organizationId, params.categoryCode);
  // Caught at authoring time, not at generation time on an official letter.
  assertKnownMergeFields(params.content);

  const result = await db.transaction(async (tx) => {
    const [template] = await tx
      .insert(documentTemplatesTable)
      .values({
        organizationId: params.organizationId,
        categoryCode: params.categoryCode,
        name: params.name,
        description: params.description ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    const [version] = await tx
      .insert(documentTemplateVersionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: template.id,
        versionNumber: 1,
        content: params.content,
        status: "draft",
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    const [updated] = await tx
      .update(documentTemplatesTable)
      .set({ currentVersionId: version.id })
      .where(eq(documentTemplatesTable.id, template.id))
      .returning();

    return { template: updated, version };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_template.created",
    targetType: "document_template",
    targetId: String(result.template.id),
    afterState: result.template,
  });

  return result;
}

/**
 * Edits a draft version in place. Refuses on any non-draft version — that is
 * the immutability guarantee, enforced rather than documented.
 */
export async function updateDraftVersion(params: {
  organizationId: number;
  templateId: number;
  versionId: number;
  content: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentTemplateVersion> {
  const before = await getTemplateVersion(params.organizationId, params.templateId, params.versionId);
  if (!before) throw new DocumentTemplateVersionNotFoundError();
  if (before.status !== "draft") throw new TemplateVersionImmutableError();
  assertKnownMergeFields(params.content);

  const [row] = await db
    .update(documentTemplateVersionsTable)
    .set({ content: params.content })
    .where(eq(documentTemplateVersionsTable.id, params.versionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_template.version_updated",
    targetType: "document_template",
    targetId: String(params.templateId),
    // Template bodies can be long and are not audit content; record which
    // version changed, never the text itself.
    metadata: { versionId: row.id, versionNumber: row.versionNumber },
  });

  return row;
}

/** Starts a new draft version — how an already-active template is "edited". */
export async function createVersion(params: {
  organizationId: number;
  templateId: number;
  content: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentTemplateVersion> {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template) throw new DocumentTemplateNotFoundError();
  assertKnownMergeFields(params.content);

  const version = await db.transaction(async (tx) => {
    const [latest] = await tx
      .select()
      .from(documentTemplateVersionsTable)
      .where(eq(documentTemplateVersionsTable.templateId, params.templateId))
      .orderBy(desc(documentTemplateVersionsTable.versionNumber))
      .limit(1);

    const [created] = await tx
      .insert(documentTemplateVersionsTable)
      .values({
        organizationId: params.organizationId,
        templateId: params.templateId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        content: params.content,
        status: "draft",
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    return created;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_template.version_created",
    targetType: "document_template",
    targetId: String(params.templateId),
    metadata: { versionId: version.id, versionNumber: version.versionNumber },
  });

  return version;
}

/**
 * Promotes a draft to active, superseding whichever version was active.
 * Prior versions keep their content forever — only their status changes, so
 * artifacts generated from them stay explainable (§24).
 */
export async function activateVersion(params: {
  organizationId: number;
  templateId: number;
  versionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentTemplateVersion> {
  const target = await getTemplateVersion(params.organizationId, params.templateId, params.versionId);
  if (!target) throw new DocumentTemplateVersionNotFoundError();

  try {
    const activated = await db.transaction(async (tx) => {
      await tx
        .update(documentTemplateVersionsTable)
        .set({ status: "superseded" })
        .where(
          and(
            eq(documentTemplateVersionsTable.templateId, params.templateId),
            eq(documentTemplateVersionsTable.status, "active"),
          ),
        );

      const [row] = await tx
        .update(documentTemplateVersionsTable)
        .set({ status: "active", approvedBy: params.actorApplicationUserId, approvedAt: new Date() })
        .where(eq(documentTemplateVersionsTable.id, params.versionId))
        .returning();

      await tx
        .update(documentTemplatesTable)
        .set({ currentVersionId: row.id, updatedAt: new Date() })
        .where(eq(documentTemplatesTable.id, params.templateId));

      return row;
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "document_template.version_activated",
      targetType: "document_template",
      targetId: String(params.templateId),
      metadata: { versionId: activated.id, versionNumber: activated.versionNumber },
    });

    return activated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new TemplateActivationConflictError();
    throw err;
  }
}

export async function setTemplateStatus(params: {
  organizationId: number;
  templateId: number;
  status: "active" | "inactive";
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentTemplate> {
  const before = await getTemplate(params.organizationId, params.templateId);
  if (!before) throw new DocumentTemplateNotFoundError();

  const [row] = await db
    .update(documentTemplatesTable)
    .set({ status: params.status })
    .where(eq(documentTemplatesTable.id, params.templateId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_template.updated",
    targetType: "document_template",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
  });

  return row;
}
