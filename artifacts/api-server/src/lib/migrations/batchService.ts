/**
 * WS-7 (§20-31) — the single migration orchestration layer. Every entity
 * type flows through exactly these functions; adapters supply per-entity
 * behavior but never own the lifecycle, the staging table, the idempotency
 * guard, or the audit trail.
 *
 * Lifecycle, enforced by `assertTransition` below rather than by callers:
 *
 *   draft ──(upload + map every source)──> mapped
 *   mapped ──(validate/dry run)──> validated
 *   validated ──(approve, snapshots source digests)──> approved
 *   approved ──(execute)──> running ──> completed | completed_with_errors | failed
 *   draft|mapped|validated|approved ──(cancel)──> cancelled
 *
 * Anything that changes a source (re-upload, re-map) drops the batch back to
 * `draft` and clears any prior approval — §25's "an approved migration whose
 * source changed is no longer approved", enforced structurally rather than
 * by asking the user not to do it.
 */
import { createHash } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  migrationBatchesTable,
  migrationSourcesTable,
  migrationStagedRowsTable,
  type MigrationBatch,
  type MigrationSource,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "../fileStorage";
import { getEntityAdapter, isKnownEntityType } from "./adapterRegistry";
import { applyMapping, assertValidColumnMapping, autoMapColumns, type ColumnMapping } from "./columnMapping";
import { detectFormat, parseMigrationFile, MIGRATION_FILE_LIMITS, MigrationFileParseError, type MigrationFileFormat } from "./fileParsing";

export class MigrationNotFoundError extends Error {}
export class InvalidMigrationStateError extends Error {}
export class UnknownEntityTypeError extends Error {
  constructor(entityType: string) {
    super(`"${entityType}" is not a supported migration entity type`);
    this.name = "UnknownEntityTypeError";
  }
}
export class SourceIntegrityError extends Error {}

export type BatchStatus = MigrationBatch["status"];

/** The only legal status transitions. Anything else throws — no caller can move a batch sideways. */
const ALLOWED_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  draft: ["mapped", "cancelled"],
  mapped: ["draft", "validated", "cancelled"],
  validated: ["draft", "mapped", "approved", "cancelled"],
  approved: ["draft", "running", "cancelled"],
  running: ["completed", "completed_with_errors", "failed"],
  completed: [],
  completed_with_errors: [],
  failed: [],
  cancelled: [],
};

function assertTransition(from: BatchStatus, to: BatchStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidMigrationStateError(`A migration in "${from}" cannot move to "${to}"`);
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// --- batch CRUD ------------------------------------------------------------

export async function createBatch(params: { organizationId: number; name: string; actorApplicationUserId: number; actorMembershipId: number }): Promise<MigrationBatch> {
  const [batch] = await db
    .insert(migrationBatchesTable)
    .values({ organizationId: params.organizationId, name: params.name, status: "draft", createdBy: params.actorApplicationUserId })
    .returning();

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "migration.batch.created",
    targetType: "migration_batch",
    targetId: String(batch.id),
    afterState: { name: batch.name, status: batch.status },
  });

  return batch;
}

/** Always org-scoped — a batch id from another organization is indistinguishable from a nonexistent one. */
export async function getBatch(organizationId: number, batchId: number): Promise<MigrationBatch> {
  const [batch] = await db
    .select()
    .from(migrationBatchesTable)
    .where(and(eq(migrationBatchesTable.id, batchId), eq(migrationBatchesTable.organizationId, organizationId)))
    .limit(1);
  if (!batch) throw new MigrationNotFoundError("Migration not found");
  return batch;
}

export async function listBatches(organizationId: number): Promise<MigrationBatch[]> {
  return db
    .select()
    .from(migrationBatchesTable)
    .where(eq(migrationBatchesTable.organizationId, organizationId))
    .orderBy(sql`${migrationBatchesTable.createdAt} DESC`);
}

export async function listSources(organizationId: number, batchId: number): Promise<MigrationSource[]> {
  return db
    .select()
    .from(migrationSourcesTable)
    .where(and(eq(migrationSourcesTable.organizationId, organizationId), eq(migrationSourcesTable.batchId, batchId)))
    .orderBy(asc(migrationSourcesTable.id));
}

/**
 * Any source-affecting change invalidates a prior validation/approval. Called
 * by every upload/remap/delete path — §25.
 */
async function invalidateDownstreamState(batch: MigrationBatch): Promise<void> {
  if (batch.status === "draft") return;
  if (!["mapped", "validated", "approved"].includes(batch.status)) {
    throw new InvalidMigrationStateError(`A migration in "${batch.status}" can no longer be modified`);
  }
  await db
    .update(migrationBatchesTable)
    .set({ status: "draft", approvedBy: null, approvedAt: null, approvedSourcesSnapshot: null })
    .where(eq(migrationBatchesTable.id, batch.id));
}

// --- source upload / mapping -----------------------------------------------

export interface UploadSourceParams {
  organizationId: number;
  batchId: number;
  entityType: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  sheetName?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export interface UploadSourceResult {
  source: MigrationSource;
  headers: string[];
  rowCount: number;
  /** A short preview so the mapping UI can show real data next to each column, without shipping the whole file back. */
  sampleRows: string[][];
  autoMapping: ColumnMapping;
  unmappedHeaders: string[];
  missingRequiredFields: string[];
}

/**
 * Stores an uploaded source file and parses it far enough to offer a column
 * mapping. Replacing an existing source for the same entityType is allowed
 * and is the supported "I uploaded the wrong file" path — the old blob is
 * deleted and any staged rows from it cascade away with it.
 */
export async function uploadSource(params: UploadSourceParams): Promise<UploadSourceResult> {
  if (!isKnownEntityType(params.entityType)) throw new UnknownEntityTypeError(params.entityType);
  const adapter = getEntityAdapter(params.entityType)!;

  const batch = await getBatch(params.organizationId, params.batchId);
  await invalidateDownstreamState(batch);

  if (params.buffer.length === 0) throw new MigrationFileParseError("The uploaded file is empty");
  if (params.buffer.length > MIGRATION_FILE_LIMITS.maxFileBytes) {
    throw new MigrationFileParseError(`File exceeds the ${MIGRATION_FILE_LIMITS.maxFileBytes / 1024 / 1024}MB limit`);
  }

  const format: MigrationFileFormat = detectFormat(params.mimeType, params.fileName);
  const parsed = await parseMigrationFile(params.buffer, format, params.sheetName);

  const digest = sha256(params.buffer);
  const storageKey = await writeOrgFile(params.organizationId, "migrations", format, params.buffer);

  // Replace-in-place: UNIQUE(batchId, entityType) makes at most one source
  // per entity type per batch, so an existing one is superseded, not added to.
  const [existing] = await db
    .select()
    .from(migrationSourcesTable)
    .where(and(eq(migrationSourcesTable.batchId, params.batchId), eq(migrationSourcesTable.entityType, params.entityType)))
    .limit(1);

  let source: MigrationSource;
  if (existing) {
    await deleteOrgFile(params.organizationId, existing.storageKey);
    [source] = await db
      .update(migrationSourcesTable)
      .set({
        fileName: params.fileName,
        storageKey,
        mimeType: params.mimeType,
        fileSize: params.buffer.length,
        sha256Digest: digest,
        sheetName: params.sheetName ?? null,
        columnMapping: null,
        rowCount: parsed.rows.length,
        status: "uploaded",
      })
      .where(eq(migrationSourcesTable.id, existing.id))
      .returning();
    // Staged rows from the superseded file are meaningless now.
    await db.delete(migrationStagedRowsTable).where(eq(migrationStagedRowsTable.sourceId, source.id));
  } else {
    [source] = await db
      .insert(migrationSourcesTable)
      .values({
        organizationId: params.organizationId,
        batchId: params.batchId,
        entityType: params.entityType,
        fileName: params.fileName,
        storageKey,
        mimeType: params.mimeType,
        fileSize: params.buffer.length,
        sha256Digest: digest,
        sheetName: params.sheetName ?? null,
        rowCount: parsed.rows.length,
        status: "uploaded",
        createdBy: params.actorApplicationUserId,
      })
      .returning();
  }

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "migration.source.uploaded",
    targetType: "migration_source",
    targetId: String(source.id),
    // Deliberately records the file's identity and digest, never its contents —
    // a source file is full of personal data and the audit table is not a
    // place to duplicate it.
    afterState: { batchId: params.batchId, entityType: params.entityType, fileName: params.fileName, sha256: digest, rowCount: parsed.rows.length },
  });

  const auto = autoMapColumns(adapter, parsed.headers);
  return {
    source,
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    sampleRows: parsed.rows.slice(0, 5),
    autoMapping: auto.mapping,
    unmappedHeaders: auto.unmappedHeaders,
    missingRequiredFields: auto.missingRequiredFields,
  };
}

/**
 * Persists a confirmed column mapping and stages every row: parse -> apply
 * mapping -> `normalizeRow` -> one `migration_staged_rows` row. Staging is
 * pure and offline — no cross-entity resolution and no live-data reads
 * happen here (that is `validateBatch`'s job), so staging the same file
 * twice always produces the same rows.
 */
export async function setSourceMapping(params: {
  organizationId: number;
  batchId: number;
  sourceId: number;
  mapping: ColumnMapping;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ source: MigrationSource; stagedRowCount: number; rowsWithErrors: number }> {
  const batch = await getBatch(params.organizationId, params.batchId);
  const [source] = await db
    .select()
    .from(migrationSourcesTable)
    .where(
      and(
        eq(migrationSourcesTable.id, params.sourceId),
        eq(migrationSourcesTable.batchId, params.batchId),
        eq(migrationSourcesTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!source) throw new MigrationNotFoundError("Migration source not found");

  await invalidateDownstreamState(batch);

  const adapter = getEntityAdapter(source.entityType);
  if (!adapter) throw new UnknownEntityTypeError(source.entityType);

  const buffer = await readOrgFile(params.organizationId, source.storageKey);
  if (sha256(buffer) !== source.sha256Digest) {
    throw new SourceIntegrityError(`The stored file for "${source.fileName}" no longer matches its recorded checksum`);
  }
  const parsed = await parseMigrationFile(buffer, detectFormat(source.mimeType, source.fileName), source.sheetName ?? undefined);

  assertValidColumnMapping(adapter, parsed.headers, params.mapping);

  const staged = parsed.rows.map((row, index) => {
    const mapped = applyMapping(parsed.headers, row, params.mapping);
    const { data, messages } = adapter.normalizeRow(mapped);
    const hasError = messages.some((m) => m.severity === "error");
    return {
      organizationId: params.organizationId,
      sourceId: source.id,
      // 1-based, and offset past the header row, so it matches what the
      // user sees in their own spreadsheet.
      rowNumber: index + 2,
      normalizedData: data,
      validationStatus: hasError ? ("error" as const) : ("pending" as const),
      validationMessages: messages,
    };
  });

  await db.transaction(async (tx) => {
    await tx.delete(migrationStagedRowsTable).where(eq(migrationStagedRowsTable.sourceId, source.id));
    // Chunked to stay well clear of the parameter limit on a wide insert.
    for (let i = 0; i < staged.length; i += 500) {
      await tx.insert(migrationStagedRowsTable).values(staged.slice(i, i + 500));
    }
    await tx
      .update(migrationSourcesTable)
      .set({ columnMapping: params.mapping, rowCount: staged.length, status: "mapped" })
      .where(eq(migrationSourcesTable.id, source.id));
  });

  await refreshBatchMappedStatus(params.organizationId, params.batchId);

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "migration.source.mapped",
    targetType: "migration_source",
    targetId: String(source.id),
    afterState: { batchId: params.batchId, entityType: source.entityType, mapping: params.mapping, stagedRowCount: staged.length },
  });

  const [updated] = await db.select().from(migrationSourcesTable).where(eq(migrationSourcesTable.id, source.id)).limit(1);
  return { source: updated, stagedRowCount: staged.length, rowsWithErrors: staged.filter((s) => s.validationStatus === "error").length };
}

/** draft -> mapped once every source in the batch has a mapping (and there is at least one). */
async function refreshBatchMappedStatus(organizationId: number, batchId: number): Promise<void> {
  const sources = await listSources(organizationId, batchId);
  const allMapped = sources.length > 0 && sources.every((s) => s.columnMapping != null);
  const batch = await getBatch(organizationId, batchId);
  if (allMapped && batch.status === "draft") {
    assertTransition(batch.status, "mapped");
    await db.update(migrationBatchesTable).set({ status: "mapped" }).where(eq(migrationBatchesTable.id, batchId));
  }
}
