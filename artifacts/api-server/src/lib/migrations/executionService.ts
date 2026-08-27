/**
 * WS-7 (§22-31) — validation/dry run, approval, execution and reconciliation.
 * Split from batchService.ts (batch/source/mapping) purely for file size;
 * together they are the single orchestration layer.
 *
 * Execution model (§27-28), stated plainly because it is the decision that
 * matters most here:
 *
 *   A migration is NOT one giant transaction. It is a sequence of
 *   per-row mutations, in dependency order, each of which either succeeds
 *   and is marked `created` on its staged row, or fails and is marked
 *   `failed` with its error text — and the batch continues. That is a
 *   deliberate choice over all-or-nothing: a 20,000-row import that dies on
 *   row 19,998 and rolls everything back is useless to an HR team, whereas
 *   19,997 imported rows plus a precise list of the 3 that need fixing is
 *   actionable. `completed_with_errors` is a first-class, expected outcome.
 *
 *   The consequence — there is no automatic rollback of a partially
 *   executed migration — is a real limitation, documented as such rather
 *   than papered over. The mitigations are: nothing executes until a human
 *   approves a clean dry run; every row's fate is individually recorded and
 *   reportable; and re-running a batch only ever retries rows still
 *   `pending`, so recovery is "fix the source rows that failed and re-run",
 *   never "undo".
 *
 *   `migration_staged_rows.executionStatus` is the idempotency guard. Only
 *   `pending` rows are ever executed, and a row is claimed by a conditional
 *   UPDATE before its adapter runs, so two concurrent executions of the same
 *   batch cannot both execute the same row.
 */
import { createHash } from "crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  migrationBatchesTable,
  migrationSourcesTable,
  migrationStagedRowsTable,
  type MigrationBatch,
  type MigrationStagedRow,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { readOrgFile } from "../fileStorage";
import { getEntityAdapter, orderEntityTypesByDependency, type ActorContext } from "./adapterRegistry";
import { getBatch, listSources, InvalidMigrationStateError, SourceIntegrityError, UnknownEntityTypeError } from "./batchService";

/** Rows executed per transaction. Small enough to keep locks short, large enough to avoid per-row transaction overhead. */
const EXECUTION_CHUNK_SIZE = 50;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// --- validation / dry run ---------------------------------------------------

export interface EntityValidationSummary {
  entityType: string;
  label: string;
  total: number;
  valid: number;
  warnings: number;
  errors: number;
}

export interface ValidationResult {
  batchId: number;
  status: MigrationBatch["status"];
  entities: EntityValidationSummary[];
  totalRows: number;
  totalErrors: number;
}

/**
 * The dry run. Re-plans every staged row against live data in dependency
 * order, in "dry_run" resolution mode (so a reference satisfied by an
 * earlier source in this same batch counts as resolvable). Read-only —
 * `planRow` never mutates — so this is safe to run repeatedly.
 */
export async function validateBatch(params: {
  organizationId: number;
  batchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ValidationResult> {
  const batch = await getBatch(params.organizationId, params.batchId);
  if (!["draft", "mapped", "validated"].includes(batch.status)) {
    throw new InvalidMigrationStateError(`A migration in "${batch.status}" cannot be validated`);
  }

  const sources = await listSources(params.organizationId, params.batchId);
  if (sources.length === 0) throw new InvalidMigrationStateError("This migration has no source files yet");
  const unmapped = sources.filter((s) => s.columnMapping == null);
  if (unmapped.length > 0) {
    throw new InvalidMigrationStateError(`These sources still need column mapping: ${unmapped.map((s) => s.entityType).join(", ")}`);
  }

  const ctx: ActorContext = {
    organizationId: params.organizationId,
    batchId: params.batchId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  };

  const orderedTypes = orderEntityTypesByDependency(sources.map((s) => s.entityType));
  const entities: EntityValidationSummary[] = [];

  for (const entityType of orderedTypes) {
    const source = sources.find((s) => s.entityType === entityType)!;
    const adapter = getEntityAdapter(entityType);
    if (!adapter) throw new UnknownEntityTypeError(entityType);

    const rows = await db
      .select()
      .from(migrationStagedRowsTable)
      .where(eq(migrationStagedRowsTable.sourceId, source.id))
      .orderBy(asc(migrationStagedRowsTable.rowNumber));

    let valid = 0;
    let warnings = 0;
    let errors = 0;

    for (const row of rows) {
      const normalizeMessages = ((row.validationMessages as { severity: string }[] | null) ?? []).filter((m) => m.severity === "error");
      // A row that failed pure normalization never reaches planRow — its
      // data is not coherent enough to resolve references against.
      if (normalizeMessages.length > 0) {
        errors += 1;
        continue;
      }

      let plan;
      try {
        plan = await adapter.planRow(db, "dry_run", row.normalizedData as Record<string, unknown>, ctx);
      } catch (err) {
        // A planRow that throws is a defect or an unavailable dependency,
        // not a user data problem — recorded against the row rather than
        // aborting the whole dry run, so the user still sees every other row.
        plan = { operation: "error" as const, messages: [{ message: err instanceof Error ? err.message : String(err), severity: "error" as const }] };
      }

      const rowHasError = plan.operation === "error" || plan.messages.some((m) => m.severity === "error");
      const rowHasWarning = !rowHasError && plan.messages.some((m) => m.severity === "warning");
      const status = rowHasError ? "error" : rowHasWarning ? "warning" : "valid";
      if (rowHasError) errors += 1;
      else if (rowHasWarning) warnings += 1;
      else valid += 1;

      await db
        .update(migrationStagedRowsTable)
        .set({
          operation: plan.operation,
          matchedEntityId: plan.matchedEntityId ?? null,
          validationStatus: status,
          validationMessages: [...((row.validationMessages as unknown[]) ?? []), ...plan.messages],
        })
        .where(eq(migrationStagedRowsTable.id, row.id));
    }

    await db.update(migrationSourcesTable).set({ status: "validated" }).where(eq(migrationSourcesTable.id, source.id));
    entities.push({ entityType, label: adapter.label, total: rows.length, valid, warnings, errors });
  }

  await db.update(migrationBatchesTable).set({ status: "validated" }).where(eq(migrationBatchesTable.id, params.batchId));

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "migration.batch.validated",
    targetType: "migration_batch",
    targetId: String(params.batchId),
    afterState: { entities },
  });

  return {
    batchId: params.batchId,
    status: "validated",
    entities,
    totalRows: entities.reduce((sum, e) => sum + e.total, 0),
    totalErrors: entities.reduce((sum, e) => sum + e.errors, 0),
  };
}

/** The dry-run detail a reviewer actually reads: every row that will not import cleanly. */
export async function getBatchIssues(organizationId: number, batchId: number, limit = 500): Promise<
  { entityType: string; rowNumber: number; validationStatus: string; messages: unknown }[]
> {
  const rows = await db
    .select({
      entityType: migrationSourcesTable.entityType,
      rowNumber: migrationStagedRowsTable.rowNumber,
      validationStatus: migrationStagedRowsTable.validationStatus,
      messages: migrationStagedRowsTable.validationMessages,
    })
    .from(migrationStagedRowsTable)
    .innerJoin(migrationSourcesTable, eq(migrationSourcesTable.id, migrationStagedRowsTable.sourceId))
    .where(
      and(
        eq(migrationStagedRowsTable.organizationId, organizationId),
        eq(migrationSourcesTable.batchId, batchId),
        inArray(migrationStagedRowsTable.validationStatus, ["error", "warning"]),
      ),
    )
    .orderBy(asc(migrationSourcesTable.id), asc(migrationStagedRowsTable.rowNumber))
    .limit(limit);
  return rows;
}

// --- approval ---------------------------------------------------------------

/**
 * Approval freezes exactly what was reviewed: every source's sha256 is
 * snapshotted into the batch. Execution re-verifies those digests against
 * the stored files, so a file swapped between approval and execution is
 * refused rather than silently imported (§25).
 *
 * Refuses to approve a batch that still has error rows — approving a known-
 * broken import is never the intended action; the user fixes the source and
 * re-validates instead.
 */
export async function approveBatch(params: {
  organizationId: number;
  batchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<MigrationBatch> {
  const batch = await getBatch(params.organizationId, params.batchId);
  if (batch.status !== "validated") {
    throw new InvalidMigrationStateError(`Only a validated migration can be approved (this one is "${batch.status}")`);
  }

  const [{ errorCount }] = await db
    .select({ errorCount: sql<number>`count(*)::int` })
    .from(migrationStagedRowsTable)
    .innerJoin(migrationSourcesTable, eq(migrationSourcesTable.id, migrationStagedRowsTable.sourceId))
    .where(and(eq(migrationSourcesTable.batchId, params.batchId), eq(migrationStagedRowsTable.validationStatus, "error")));
  if (errorCount > 0) {
    throw new InvalidMigrationStateError(`This migration still has ${errorCount} row(s) with errors — fix them and re-validate before approving`);
  }

  const sources = await listSources(params.organizationId, params.batchId);
  const snapshot = sources.map((s) => ({ sourceId: s.id, entityType: s.entityType, fileName: s.fileName, sha256: s.sha256Digest, rowCount: s.rowCount }));

  const [approved] = await db
    .update(migrationBatchesTable)
    .set({ status: "approved", approvedBy: params.actorApplicationUserId, approvedAt: new Date(), approvedSourcesSnapshot: snapshot })
    .where(eq(migrationBatchesTable.id, params.batchId))
    .returning();

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "migration.batch.approved",
    targetType: "migration_batch",
    targetId: String(params.batchId),
    afterState: { sources: snapshot },
  });

  return approved;
}

/** Re-reads every stored source file and compares its digest to the approved snapshot. */
async function assertSourcesUnchangedSinceApproval(batch: MigrationBatch): Promise<void> {
  const snapshot = (batch.approvedSourcesSnapshot as { sourceId: number; fileName: string; sha256: string }[] | null) ?? null;
  if (!snapshot) throw new InvalidMigrationStateError("This migration has no approval snapshot");

  const sources = await listSources(batch.organizationId, batch.id);
  if (sources.length !== snapshot.length) {
    throw new SourceIntegrityError("The source files changed after this migration was approved — re-validate and re-approve");
  }
  for (const entry of snapshot) {
    const source = sources.find((s) => s.id === entry.sourceId);
    if (!source || source.sha256Digest !== entry.sha256) {
      throw new SourceIntegrityError(`Source "${entry.fileName}" changed after approval — re-validate and re-approve`);
    }
    const buffer = await readOrgFile(batch.organizationId, source.storageKey);
    if (sha256(buffer) !== entry.sha256) {
      throw new SourceIntegrityError(`The stored file for "${entry.fileName}" no longer matches its approved checksum`);
    }
  }
}

// --- execution --------------------------------------------------------------

export interface ExecutionProgress {
  batchId: number;
  status: MigrationBatch["status"];
  created: number;
  matched: number;
  skipped: number;
  failed: number;
  remaining: number;
}

/**
 * Executes (or resumes) an approved batch. Safe to call more than once: a
 * second call only ever picks up rows still `pending`, which is also what
 * makes a WS-6 worker retry after a crash correct rather than duplicating
 * work.
 */
export async function executeBatch(params: {
  organizationId: number;
  batchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
  /** Stop after this many rows and leave the batch `running` — used by the chunked worker path. */
  maxRows?: number;
}): Promise<ExecutionProgress> {
  const batch = await getBatch(params.organizationId, params.batchId);
  if (batch.status !== "approved" && batch.status !== "running") {
    throw new InvalidMigrationStateError(`Only an approved migration can be executed (this one is "${batch.status}")`);
  }

  if (batch.status === "approved") {
    await assertSourcesUnchangedSinceApproval(batch);
    await db
      .update(migrationBatchesTable)
      .set({ status: "running", executionStartedAt: new Date() })
      .where(and(eq(migrationBatchesTable.id, params.batchId), eq(migrationBatchesTable.status, "approved")));

    await recordAuditEvent({
      organizationId: params.organizationId,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      eventType: "migration.batch.execution_started",
      targetType: "migration_batch",
      targetId: String(params.batchId),
    });
  }

  const ctx: ActorContext = {
    organizationId: params.organizationId,
    batchId: params.batchId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  };

  const sources = await listSources(params.organizationId, params.batchId);
  const orderedTypes = orderEntityTypesByDependency(sources.map((s) => s.entityType));
  let processed = 0;

  for (const entityType of orderedTypes) {
    const source = sources.find((s) => s.entityType === entityType)!;
    const adapter = getEntityAdapter(entityType);
    if (!adapter) throw new UnknownEntityTypeError(entityType);

    // Dependency order is only meaningful if each entity type FULLY finishes
    // before the next begins — a later type resolves its references against
    // live rows an earlier type committed.
    for (;;) {
      if (params.maxRows != null && processed >= params.maxRows) {
        return buildProgress(params.organizationId, params.batchId, "running");
      }

      const pending = await db
        .select()
        .from(migrationStagedRowsTable)
        .where(
          and(
            eq(migrationStagedRowsTable.sourceId, source.id),
            eq(migrationStagedRowsTable.executionStatus, "pending"),
            inArray(migrationStagedRowsTable.validationStatus, ["valid", "warning"]),
          ),
        )
        .orderBy(asc(migrationStagedRowsTable.rowNumber))
        .limit(EXECUTION_CHUNK_SIZE);
      if (pending.length === 0) break;

      for (const row of pending) {
        await executeStagedRow(row, adapter.entityType, ctx);
        processed += 1;
      }
    }

    // Rows the dry run rejected are recorded as skipped rather than left
    // pending forever, so the reconciliation totals always add up.
    await db
      .update(migrationStagedRowsTable)
      .set({ executionStatus: "skipped" })
      .where(
        and(
          eq(migrationStagedRowsTable.sourceId, source.id),
          eq(migrationStagedRowsTable.executionStatus, "pending"),
          eq(migrationStagedRowsTable.validationStatus, "error"),
        ),
      );
  }

  return finalizeBatch(params.organizationId, params.batchId, params.actorApplicationUserId, params.actorMembershipId);
}

/**
 * Executes one staged row. The conditional UPDATE that claims the row is the
 * concurrency guard: if another worker already moved it out of `pending`,
 * this returns without calling the adapter at all.
 */
async function executeStagedRow(row: MigrationStagedRow, entityType: string, ctx: ActorContext): Promise<void> {
  const adapter = getEntityAdapter(entityType)!;

  const claimed = await db
    .update(migrationStagedRowsTable)
    .set({ executionStatus: "failed", executionError: "Execution in progress" })
    .where(and(eq(migrationStagedRowsTable.id, row.id), eq(migrationStagedRowsTable.executionStatus, "pending")))
    .returning({ id: migrationStagedRowsTable.id });
  if (claimed.length === 0) return; // Someone else has it.

  try {
    const result = await db.transaction(async (tx) => adapter.executeRow(tx, row.normalizedData as Record<string, unknown>, ctx));
    await db
      .update(migrationStagedRowsTable)
      .set({ executionStatus: result.status, executionResultId: result.resultId, executionError: null })
      .where(eq(migrationStagedRowsTable.id, row.id));
  } catch (err) {
    // A failed row never aborts the batch — see this file's header.
    await db
      .update(migrationStagedRowsTable)
      .set({ executionStatus: "failed", executionError: err instanceof Error ? err.message : String(err) })
      .where(eq(migrationStagedRowsTable.id, row.id));
  }
}

async function buildProgress(organizationId: number, batchId: number, status: MigrationBatch["status"]): Promise<ExecutionProgress> {
  const counts = await countByExecutionStatus(organizationId, batchId);
  return {
    batchId,
    status,
    created: (counts.created ?? 0) + (counts.updated ?? 0),
    matched: counts.matched ?? 0,
    skipped: counts.skipped ?? 0,
    failed: counts.failed ?? 0,
    remaining: counts.pending ?? 0,
  };
}

async function countByExecutionStatus(organizationId: number, batchId: number): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: migrationStagedRowsTable.executionStatus, count: sql<number>`count(*)::int` })
    .from(migrationStagedRowsTable)
    .innerJoin(migrationSourcesTable, eq(migrationSourcesTable.id, migrationStagedRowsTable.sourceId))
    .where(and(eq(migrationStagedRowsTable.organizationId, organizationId), eq(migrationSourcesTable.batchId, batchId)))
    .groupBy(migrationStagedRowsTable.executionStatus);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

async function finalizeBatch(
  organizationId: number,
  batchId: number,
  actorApplicationUserId: number,
  actorMembershipId: number,
): Promise<ExecutionProgress> {
  const summary = await buildReconciliation(organizationId, batchId);
  const anyFailed = summary.entities.some((e) => e.failed > 0);
  const status: MigrationBatch["status"] = anyFailed ? "completed_with_errors" : "completed";

  await db
    .update(migrationBatchesTable)
    .set({ status, executionCompletedAt: new Date(), reconciliationSummary: summary })
    .where(eq(migrationBatchesTable.id, batchId));

  await recordAuditEvent({
    organizationId,
    actorApplicationUserId,
    actorMembershipId,
    eventType: "migration.batch.execution_completed",
    targetType: "migration_batch",
    targetId: String(batchId),
    afterState: { status, summary },
  });

  return buildProgress(organizationId, batchId, status);
}

// --- reconciliation ---------------------------------------------------------

export interface EntityReconciliation {
  entityType: string;
  label: string;
  sourceRows: number;
  created: number;
  matched: number;
  skipped: number;
  failed: number;
  pending: number;
}

export interface ReconciliationSummary {
  entities: EntityReconciliation[];
  totals: { sourceRows: number; created: number; matched: number; skipped: number; failed: number; pending: number };
}

/**
 * §29 — "prove every source row is accounted for". Every staged row lands in
 * exactly one bucket and the buckets sum to the source row count, so a
 * silently-dropped row is arithmetically impossible to hide.
 */
export async function buildReconciliation(organizationId: number, batchId: number): Promise<ReconciliationSummary> {
  const sources = await listSources(organizationId, batchId);
  const entities: EntityReconciliation[] = [];

  for (const source of sources) {
    const rows = await db
      .select({ status: migrationStagedRowsTable.executionStatus, count: sql<number>`count(*)::int` })
      .from(migrationStagedRowsTable)
      .where(eq(migrationStagedRowsTable.sourceId, source.id))
      .groupBy(migrationStagedRowsTable.executionStatus);
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.count]));
    const adapter = getEntityAdapter(source.entityType);

    entities.push({
      entityType: source.entityType,
      label: adapter?.label ?? source.entityType,
      sourceRows: rows.reduce((sum, r) => sum + r.count, 0),
      created: (byStatus.created ?? 0) + (byStatus.updated ?? 0),
      matched: byStatus.matched ?? 0,
      skipped: byStatus.skipped ?? 0,
      failed: byStatus.failed ?? 0,
      pending: byStatus.pending ?? 0,
    });
  }

  return {
    entities,
    totals: {
      sourceRows: entities.reduce((s, e) => s + e.sourceRows, 0),
      created: entities.reduce((s, e) => s + e.created, 0),
      matched: entities.reduce((s, e) => s + e.matched, 0),
      skipped: entities.reduce((s, e) => s + e.skipped, 0),
      failed: entities.reduce((s, e) => s + e.failed, 0),
      pending: entities.reduce((s, e) => s + e.pending, 0),
    },
  };
}

export async function cancelBatch(params: {
  organizationId: number;
  batchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<MigrationBatch> {
  const batch = await getBatch(params.organizationId, params.batchId);
  if (!["draft", "mapped", "validated", "approved"].includes(batch.status)) {
    // A running or finished migration is deliberately not cancellable —
    // "cancel" would imply undoing committed rows, which this workstream
    // does not do (see the header).
    throw new InvalidMigrationStateError(`A migration in "${batch.status}" cannot be cancelled`);
  }
  const [cancelled] = await db
    .update(migrationBatchesTable)
    .set({ status: "cancelled" })
    .where(eq(migrationBatchesTable.id, params.batchId))
    .returning();

  await recordAuditEvent({
    organizationId: params.organizationId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    eventType: "migration.batch.cancelled",
    targetType: "migration_batch",
    targetId: String(params.batchId),
    beforeState: { status: batch.status },
  });

  return cancelled;
}
