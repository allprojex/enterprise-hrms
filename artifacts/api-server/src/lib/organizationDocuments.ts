/**
 * WS-5 (§9-11, §18, §50-51) — the organization-level digital document
 * repository: documents owned by the organization itself (handbook, policy,
 * forms, procedures) rather than by one employee or candidate, and
 * emphatically not Personnel Files (physical custody stays in its own
 * domain — see personnel-files.ts).
 *
 * Storage reuses the existing fileStorage.ts abstraction unchanged; every
 * object lands under the organization's own private directory tree with a
 * freshly generated, unguessable key, so there is no cross-organization
 * object path to construct and no traversal surface (the `subdir` below is a
 * fixed code literal, per writeOrgFile's own contract).
 *
 * Version integrity is enforced by the database, not by convention:
 * organization_document_versions carries a partial unique index on
 * (documentId) WHERE status = 'current', so two concurrent uploads cannot
 * both leave a "current" row behind — the loser gets a unique violation and
 * retries against the new head, rather than silently corrupting history
 * (§51).
 */
import { and, eq, desc, sql, type SQL } from "drizzle-orm";
import {
  db,
  organizationDocumentsTable,
  organizationDocumentVersionsTable,
  documentRetentionRecordsTable,
  type OrganizationDocument,
  type OrganizationDocumentVersion,
} from "@workspace/db";
import { writeOrgFile, deleteOrgFile } from "./fileStorage";
import { validateDocumentUpload } from "./documentValidation";
import { assertUsableCategory, getCategoryBehavior } from "./documentCategories";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

/** Fixed, code-controlled storage subdirectory — never derived from input. */
const STORAGE_SUBDIR = "organization-documents";

/** The `document_table` discriminator this domain writes into shared document tables. */
export const ORGANIZATION_DOCUMENT_VERSION_TABLE = "organization_document_versions";

export class OrganizationDocumentNotFoundError extends Error {
  constructor() {
    super("Document not found");
    this.name = "OrganizationDocumentNotFoundError";
  }
}

export class OrganizationDocumentVersionNotFoundError extends Error {
  constructor() {
    super("Document version not found");
    this.name = "OrganizationDocumentVersionNotFoundError";
  }
}

export class DocumentArchivedError extends Error {
  constructor() {
    super("This document is archived and cannot accept new versions");
    this.name = "DocumentArchivedError";
  }
}

export class VersionConflictError extends Error {
  constructor() {
    super("Another version was created concurrently; retry the upload");
    this.name = "VersionConflictError";
  }
}

export interface UploadedFile {
  mimetype: string;
  size: number;
  buffer: Buffer;
  originalname: string;
}

export interface ListFilters {
  categoryCode?: string;
  status?: "active" | "archived";
  search?: string;
  expiringBefore?: string;
}

/**
 * Documents with their current version, in one query — never N+1 across
 * versions, and never touching object storage (§57: listing metadata must
 * not read file blobs).
 */
export async function listDocuments(organizationId: number, filters: ListFilters = {}) {
  const conditions: SQL[] = [eq(organizationDocumentsTable.organizationId, organizationId)];

  if (filters.categoryCode) conditions.push(eq(organizationDocumentsTable.categoryCode, filters.categoryCode));
  if (filters.status) conditions.push(eq(organizationDocumentsTable.status, filters.status));
  if (filters.search) {
    const pattern = `%${filters.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`${organizationDocumentsTable.title} ILIKE ${pattern}`);
  }
  if (filters.expiringBefore) {
    conditions.push(sql`${organizationDocumentVersionsTable.expiryDate} <= ${filters.expiringBefore}`);
  }

  const rows = await db
    .select({ document: organizationDocumentsTable, currentVersion: organizationDocumentVersionsTable })
    .from(organizationDocumentsTable)
    .leftJoin(
      organizationDocumentVersionsTable,
      eq(organizationDocumentVersionsTable.id, organizationDocumentsTable.currentVersionId),
    )
    .where(and(...conditions))
    .orderBy(desc(organizationDocumentsTable.updatedAt));

  return rows;
}

/** A document, scoped to the organization — the only way this module loads one. */
export async function getDocument(organizationId: number, documentId: number): Promise<OrganizationDocument | null> {
  const [row] = await db
    .select()
    .from(organizationDocumentsTable)
    .where(and(eq(organizationDocumentsTable.organizationId, organizationId), eq(organizationDocumentsTable.id, documentId)))
    .limit(1);
  return row ?? null;
}

/** Full version history, newest first. */
export async function listVersions(organizationId: number, documentId: number): Promise<OrganizationDocumentVersion[]> {
  return db
    .select()
    .from(organizationDocumentVersionsTable)
    .where(
      and(
        eq(organizationDocumentVersionsTable.organizationId, organizationId),
        eq(organizationDocumentVersionsTable.documentId, documentId),
      ),
    )
    .orderBy(desc(organizationDocumentVersionsTable.versionNumber));
}

/**
 * One version, re-proved to belong to both the document and the organization
 * — the guard behind every download. Knowing a version id is never enough
 * (§30/§54: version IDOR).
 */
export async function getVersion(
  organizationId: number,
  documentId: number,
  versionId: number,
): Promise<OrganizationDocumentVersion | null> {
  const [row] = await db
    .select()
    .from(organizationDocumentVersionsTable)
    .where(
      and(
        eq(organizationDocumentVersionsTable.organizationId, organizationId),
        eq(organizationDocumentVersionsTable.documentId, documentId),
        eq(organizationDocumentVersionsTable.id, versionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Creates a document and its version 1 in one transaction, after the file is
 * already safely on disk.
 *
 * Ordering is deliberate (§50): validate, then write the object, then open
 * the transaction. If the transaction fails, the just-written object is the
 * only orphan possible and is deleted in the catch — whereas writing inside
 * the transaction would leave an object referenced by a rolled-back row, or
 * a row referencing an object that was never written. The cleanup delete is
 * itself best-effort (deleteOrgFile already swallows a missing file); a
 * failure there leaves an unreferenced blob, which is inert, rather than a
 * dangling database reference, which is not.
 */
export async function createDocument(params: {
  organizationId: number;
  categoryCode: string;
  title: string;
  description?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  file: UploadedFile;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<{ document: OrganizationDocument; version: OrganizationDocumentVersion }> {
  await assertUsableCategory(params.organizationId, params.categoryCode);
  const behavior = await getCategoryBehavior(params.organizationId, params.categoryCode);
  const extension = validateDocumentUpload(params.file);

  const storageKey = await writeOrgFile(params.organizationId, STORAGE_SUBDIR, extension, params.file.buffer);

  try {
    const result = await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(organizationDocumentsTable)
        .values({
          organizationId: params.organizationId,
          categoryCode: params.categoryCode,
          title: params.title,
          description: params.description ?? null,
          createdBy: params.actorApplicationUserId,
        })
        .returning();

      const [version] = await tx
        .insert(organizationDocumentVersionsTable)
        .values({
          organizationId: params.organizationId,
          documentId: document.id,
          versionNumber: 1,
          storageKey,
          fileName: params.file.originalname,
          mimeType: params.file.mimetype,
          fileSize: params.file.size,
          status: "current",
          effectiveDate: params.effectiveDate ?? null,
          expiryDate: params.expiryDate ?? null,
          uploadedBy: params.actorApplicationUserId,
        })
        .returning();

      const [updated] = await tx
        .update(organizationDocumentsTable)
        .set({ currentVersionId: version.id })
        .where(eq(organizationDocumentsTable.id, document.id))
        .returning();

      // Every document instance gets a retention record from birth, seeded
      // from its category's configured basis — so §45's retention queries
      // never have to reason about documents that simply have no record,
      // and applying a legal hold later never needs to create one first.
      await tx.insert(documentRetentionRecordsTable).values({
        organizationId: params.organizationId,
        documentTable: ORGANIZATION_DOCUMENT_VERSION_TABLE,
        documentId: version.id,
        retentionBasis: behavior.retentionBasis,
        retainUntil: computeRetainUntil(behavior.retentionPeriodMonths),
      });

      return { document: updated, version };
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "organization_document.uploaded",
      targetType: "organization_document",
      targetId: String(result.document.id),
      afterState: { ...result.document, versionNumber: result.version.versionNumber },
    });

    return result;
  } catch (err) {
    await deleteOrgFile(params.organizationId, storageKey);
    throw err;
  }
}

/** retainUntil = today + N months, or null when the category sets no period. */
function computeRetainUntil(retentionPeriodMonths: number | null): string | null {
  if (retentionPeriodMonths == null) return null;
  const date = new Date();
  date.setMonth(date.getMonth() + retentionPeriodMonths);
  return date.toISOString().slice(0, 10);
}

/**
 * Adds a new current version and supersedes the previous one.
 *
 * The prior version's row and its stored object are both left completely
 * intact (§10: "prefer immutable historical document versions", "do not
 * overwrite the same storage object in a way that destroys history") — it is
 * only marked superseded, and stays downloadable through version history by
 * anyone authorized to read the document.
 */
export async function addVersion(params: {
  organizationId: number;
  documentId: number;
  file: UploadedFile;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  changeNote?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OrganizationDocumentVersion> {
  const document = await getDocument(params.organizationId, params.documentId);
  if (!document) throw new OrganizationDocumentNotFoundError();
  // A disposed/archived document must not silently accept new content —
  // that would resurrect a record its retention decision already closed.
  if (document.status === "archived") throw new DocumentArchivedError();

  const behavior = await getCategoryBehavior(params.organizationId, document.categoryCode);
  const extension = validateDocumentUpload(params.file);
  const storageKey = await writeOrgFile(params.organizationId, STORAGE_SUBDIR, extension, params.file.buffer);

  try {
    const version = await db.transaction(async (tx) => {
      // Read the current head inside the transaction so two concurrent
      // uploads cannot both compute the same next version number from a
      // stale read.
      const [head] = await tx
        .select()
        .from(organizationDocumentVersionsTable)
        .where(
          and(
            eq(organizationDocumentVersionsTable.documentId, params.documentId),
            eq(organizationDocumentVersionsTable.status, "current"),
          ),
        )
        .limit(1);

      if (head) {
        await tx
          .update(organizationDocumentVersionsTable)
          .set({ status: "superseded", supersededAt: new Date(), supersededBy: params.actorApplicationUserId })
          .where(eq(organizationDocumentVersionsTable.id, head.id));
      }

      const [created] = await tx
        .insert(organizationDocumentVersionsTable)
        .values({
          organizationId: params.organizationId,
          documentId: params.documentId,
          versionNumber: (head?.versionNumber ?? 0) + 1,
          storageKey,
          fileName: params.file.originalname,
          mimeType: params.file.mimetype,
          fileSize: params.file.size,
          status: "current",
          effectiveDate: params.effectiveDate ?? null,
          expiryDate: params.expiryDate ?? null,
          changeNote: params.changeNote ?? null,
          uploadedBy: params.actorApplicationUserId,
        })
        .returning();

      await tx
        .update(organizationDocumentsTable)
        .set({ currentVersionId: created.id, updatedAt: new Date() })
        .where(eq(organizationDocumentsTable.id, params.documentId));

      await tx.insert(documentRetentionRecordsTable).values({
        organizationId: params.organizationId,
        documentTable: ORGANIZATION_DOCUMENT_VERSION_TABLE,
        documentId: created.id,
        retentionBasis: behavior.retentionBasis,
        retainUntil: computeRetainUntil(behavior.retentionPeriodMonths),
      });

      return created;
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "organization_document.version_created",
      targetType: "organization_document",
      targetId: String(params.documentId),
      afterState: { versionId: version.id, versionNumber: version.versionNumber, changeNote: version.changeNote },
    });

    return version;
  } catch (err) {
    await deleteOrgFile(params.organizationId, storageKey);
    // The unique index on (documentId) WHERE status='current' is what a
    // concurrent second upload trips; surface it as a retryable conflict
    // rather than a 500.
    if (isUniqueViolation(err)) throw new VersionConflictError();
    throw err;
  }
}

export async function updateDocumentMetadata(params: {
  organizationId: number;
  documentId: number;
  title?: string;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OrganizationDocument> {
  const existing = await getDocument(params.organizationId, params.documentId);
  if (!existing) throw new OrganizationDocumentNotFoundError();

  const [row] = await db
    .update(organizationDocumentsTable)
    .set({
      title: params.title ?? existing.title,
      description: params.description !== undefined ? params.description : existing.description,
    })
    .where(eq(organizationDocumentsTable.id, params.documentId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "organization_document.updated",
    targetType: "organization_document",
    targetId: String(row.id),
    beforeState: existing,
    afterState: row,
  });

  return row;
}

/**
 * Records that a confidential document's content was actually read (§34).
 * Only called on download/full view, and only for a category the
 * organization marked confidential — an ordinary list view is never audited
 * (§33: "do not audit every harmless list view"). breakGlassGrantId is
 * attached automatically by recordAuditEvent when the read happens under a
 * WS-4 elevation, so no separate elevated-read event is produced.
 */
export async function auditDocumentRead(params: {
  organizationId: number;
  documentId: number;
  version: OrganizationDocumentVersion;
  categoryCode: string;
  sensitivity: "standard" | "confidential";
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<void> {
  if (params.sensitivity !== "confidential") return;

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "organization_document.downloaded",
    targetType: "organization_document",
    targetId: String(params.documentId),
    // Metadata only — never document contents (§33).
    metadata: {
      versionId: params.version.id,
      versionNumber: params.version.versionNumber,
      categoryCode: params.categoryCode,
    },
  });
}
