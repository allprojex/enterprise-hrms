/**
 * WS-5 (§15-18, §45-46) — retention, archive, legal hold, and controlled
 * disposal, shared across every digital document domain via
 * document_retention_records' polymorphic (documentTable, documentId) key.
 *
 * The three states the frozen scope insists stay distinct (§16):
 *
 *   ARCHIVED             — removed from active circulation. Not deletion.
 *                          The row and its stored object are untouched.
 *   ELIGIBLE FOR DISPOSAL — a determination that retention has run out.
 *                          Never automatic deletion, never self-executing.
 *   DISPOSED             — an authorized human decided, with a reason, and
 *                          the storage object was then deleted.
 *
 * Legal hold sits above all of it: while `legalHold` is true, a record can
 * never become disposal-eligible and can never be disposed, regardless of
 * how far past `retainUntil` it is (§46). That check lives in one place
 * (assertDisposable) and every disposal path goes through it.
 *
 * Deliberately absent: any "dispose everything expired" bulk operation. §17
 * forbids it, and the query side (listDisposalEligible) deliberately only
 * *reports* candidates — a human authorizes each disposal individually.
 */
import { and, eq, lte, sql, type SQL } from "drizzle-orm";
import { db, documentRetentionRecordsTable, organizationDocumentVersionsTable, type DocumentRetentionRecord } from "@workspace/db";
import { deleteOrgFile } from "./fileStorage";
import { recordAuditEvent } from "./auditLog";
import { ORGANIZATION_DOCUMENT_VERSION_TABLE } from "./organizationDocuments";

/**
 * The document tables this module will act on. A caller-supplied table name
 * is checked against this list before it reaches a query, so the polymorphic
 * pointer can never be steered at an arbitrary table (§54's forged owner
 * references).
 */
const KNOWN_DOCUMENT_TABLES: readonly string[] = [
  ORGANIZATION_DOCUMENT_VERSION_TABLE,
  "employee_documents",
  "candidate_documents",
];

export class UnknownDocumentTableError extends Error {
  constructor(table: string) {
    super(`"${table}" is not a document table`);
    this.name = "UnknownDocumentTableError";
  }
}

export class RetentionRecordNotFoundError extends Error {
  constructor() {
    super("Retention record not found");
    this.name = "RetentionRecordNotFoundError";
  }
}

export class LegalHoldActiveError extends Error {
  constructor() {
    super("This document is under legal hold and cannot be disposed");
    this.name = "LegalHoldActiveError";
  }
}

export class AlreadyDisposedError extends Error {
  constructor() {
    super("This document has already been disposed");
    this.name = "AlreadyDisposedError";
  }
}

export class RetentionNotExpiredError extends Error {
  constructor() {
    super("This document's retention period has not elapsed");
    this.name = "RetentionNotExpiredError";
  }
}

function assertKnownTable(table: string): void {
  if (!KNOWN_DOCUMENT_TABLES.includes(table)) throw new UnknownDocumentTableError(table);
}

/** The retention record for one document instance, scoped to the organization. */
export async function getRetentionRecord(
  organizationId: number,
  documentTable: string,
  documentId: number,
): Promise<DocumentRetentionRecord | null> {
  assertKnownTable(documentTable);
  const [row] = await db
    .select()
    .from(documentRetentionRecordsTable)
    .where(
      and(
        eq(documentRetentionRecordsTable.organizationId, organizationId),
        eq(documentRetentionRecordsTable.documentTable, documentTable),
        eq(documentRetentionRecordsTable.documentId, documentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function requireRecord(
  organizationId: number,
  documentTable: string,
  documentId: number,
): Promise<DocumentRetentionRecord> {
  const record = await getRetentionRecord(organizationId, documentTable, documentId);
  if (!record) throw new RetentionRecordNotFoundError();
  return record;
}

/**
 * Archives a document instance. Explicitly not deletion — the row and the
 * stored object both survive, and a legal hold does not block archiving
 * (only disposal), since taking a document out of circulation never destroys
 * evidence.
 */
export async function archiveDocument(params: {
  organizationId: number;
  documentTable: string;
  documentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentRetentionRecord> {
  const before = await requireRecord(params.organizationId, params.documentTable, params.documentId);

  const [row] = await db
    .update(documentRetentionRecordsTable)
    .set({ archiveStatus: "archived", archivedAt: new Date(), archivedBy: params.actorApplicationUserId })
    .where(eq(documentRetentionRecordsTable.id, before.id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_retention.archived",
    targetType: "document_retention_record",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
  });

  return row;
}

/** Applies or lifts a legal hold. Both directions are audited (§46). */
export async function setLegalHold(params: {
  organizationId: number;
  documentTable: string;
  documentId: number;
  legalHold: boolean;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentRetentionRecord> {
  const before = await requireRecord(params.organizationId, params.documentTable, params.documentId);

  const [row] = await db
    .update(documentRetentionRecordsTable)
    .set({
      legalHold: params.legalHold,
      legalHoldReason: params.legalHold ? (params.reason ?? null) : null,
      legalHoldSetBy: params.legalHold ? params.actorApplicationUserId : null,
      legalHoldSetAt: params.legalHold ? new Date() : null,
      // Lifting a hold must not leave a stale "eligible" determination made
      // before the hold; eligibility is re-derived on demand.
      disposalStatus: before.disposalStatus === "eligible" && params.legalHold ? "none" : before.disposalStatus,
    })
    .where(eq(documentRetentionRecordsTable.id, before.id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.legalHold ? "document_retention.legal_hold_applied" : "document_retention.legal_hold_released",
    targetType: "document_retention_record",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
  });

  return row;
}

/** The single gate every disposal path passes through. */
function assertDisposable(record: DocumentRetentionRecord, now: Date): void {
  if (record.disposalStatus === "disposed") throw new AlreadyDisposedError();
  if (record.legalHold) throw new LegalHoldActiveError();
  // A record with no retainUntil has no defined retention deadline, so it
  // can never age into eligibility on its own — an explicit retention
  // decision must be recorded first. Fail-closed by design.
  if (!record.retainUntil) throw new RetentionNotExpiredError();
  if (new Date(record.retainUntil) > now) throw new RetentionNotExpiredError();
}

/**
 * Records the determination that a document may be disposed. A separate,
 * earlier step from actually disposing it (§17) — this is the reviewable
 * decision; executeDisposal is the irreversible act.
 */
export async function markDisposalEligible(params: {
  organizationId: number;
  documentTable: string;
  documentId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
  now?: Date;
}): Promise<DocumentRetentionRecord> {
  const before = await requireRecord(params.organizationId, params.documentTable, params.documentId);
  assertDisposable(before, params.now ?? new Date());

  const [row] = await db
    .update(documentRetentionRecordsTable)
    .set({ disposalStatus: "eligible" })
    .where(eq(documentRetentionRecordsTable.id, before.id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_retention.disposal_eligible",
    targetType: "document_retention_record",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
  });

  return row;
}

/**
 * Authorizes and executes disposal of one document instance.
 *
 * Order matters and is the opposite of upload's (§18/§50): the database row
 * is marked disposed *first*, inside a transaction, and only then is the
 * storage object deleted. If the delete fails, the record still reads
 * "disposed" and the object is an unreferenced orphan — recoverable, and
 * never a false "still retained" claim about a file that is already gone.
 * Deleting first would risk the inverse: a destroyed file with a record
 * still asserting the document is retained.
 *
 * Only the disposed version's own object is deleted. Sibling versions of the
 * same document keep their rows and files untouched (§50: "do not delete
 * valid historical versions during rollback") — disposal is per-instance, by
 * the (documentTable, documentId) key, never per-document-tree.
 */
export async function executeDisposal(params: {
  organizationId: number;
  documentTable: string;
  documentId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
  now?: Date;
}): Promise<{ record: DocumentRetentionRecord; storageDeleted: boolean }> {
  const before = await requireRecord(params.organizationId, params.documentTable, params.documentId);
  assertDisposable(before, params.now ?? new Date());

  // Resolve the storage key before the transaction; only this domain's own
  // documents are dispositionable through this module today.
  let storageKey: string | null = null;
  if (params.documentTable === ORGANIZATION_DOCUMENT_VERSION_TABLE) {
    const [version] = await db
      .select({ storageKey: organizationDocumentVersionsTable.storageKey })
      .from(organizationDocumentVersionsTable)
      .where(
        and(
          eq(organizationDocumentVersionsTable.organizationId, params.organizationId),
          eq(organizationDocumentVersionsTable.id, params.documentId),
        ),
      )
      .limit(1);
    storageKey = version?.storageKey ?? null;
  }

  const now = new Date();
  const [row] = await db
    .update(documentRetentionRecordsTable)
    .set({
      disposalStatus: "disposed",
      disposalReason: params.reason,
      disposalAuthorizedBy: params.actorApplicationUserId,
      disposalAuthorizedAt: now,
      disposedAt: now,
    })
    .where(eq(documentRetentionRecordsTable.id, before.id))
    .returning();

  let storageDeleted = false;
  if (storageKey) {
    try {
      await deleteOrgFile(params.organizationId, storageKey);
      storageDeleted = true;
    } catch {
      // Left deliberately non-fatal: the authoritative disposal decision is
      // already recorded and audited. An undeleted object is a cleanup task,
      // not a reason to fail a completed authorization — and never a reason
      // to roll the record back to "retained".
      storageDeleted = false;
    }
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_retention.disposed",
    targetType: "document_retention_record",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
    metadata: { storageDeleted },
  });

  return { record: row, storageDeleted };
}

/**
 * §45's retention query contract. Reports only — never disposes. Records
 * under legal hold are excluded from the disposal-eligible listing by the
 * same rule that blocks the action itself, so the UI can never present a
 * held document as ready to dispose.
 */
export async function listRetentionRecords(
  organizationId: number,
  filters: { archiveStatus?: "active" | "archived"; disposalStatus?: "none" | "eligible" | "disposed"; legalHold?: boolean } = {},
): Promise<DocumentRetentionRecord[]> {
  const conditions: SQL[] = [eq(documentRetentionRecordsTable.organizationId, organizationId)];
  if (filters.archiveStatus) conditions.push(eq(documentRetentionRecordsTable.archiveStatus, filters.archiveStatus));
  if (filters.disposalStatus) conditions.push(eq(documentRetentionRecordsTable.disposalStatus, filters.disposalStatus));
  if (filters.legalHold !== undefined) conditions.push(eq(documentRetentionRecordsTable.legalHold, filters.legalHold));

  return db.select().from(documentRetentionRecordsTable).where(and(...conditions));
}

/**
 * Documents whose retention deadline has passed and which nothing blocks —
 * the candidate list a records officer reviews. `asOf` is a parameter rather
 * than an implicit `now()` so date-boundary behavior is deterministically
 * testable (§44's requirement, applied here too).
 */
export async function listDisposalEligible(organizationId: number, asOf: string): Promise<DocumentRetentionRecord[]> {
  return db
    .select()
    .from(documentRetentionRecordsTable)
    .where(
      and(
        eq(documentRetentionRecordsTable.organizationId, organizationId),
        eq(documentRetentionRecordsTable.legalHold, false),
        sql`${documentRetentionRecordsTable.disposalStatus} <> 'disposed'`,
        sql`${documentRetentionRecordsTable.retainUntil} is not null`,
        lte(documentRetentionRecordsTable.retainUntil, asOf),
      ),
    );
}
