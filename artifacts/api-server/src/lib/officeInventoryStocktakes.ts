/**
 * Office Inventory, Workstream 7 — Stocktaking
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.8, §28, §29, Owner
 * Decision 14, §50). Store-scoped physical count reconciled against the
 * ledger's own live-derived balance — never a way to silently replace
 * system stock with a physical count.
 *
 * LIFECYCLE: draft -> counting -> finalized. `expectedQuantitySnapshot` is
 * captured, once, the moment a stocktake transitions from draft to
 * counting (`startStocktake`) — permanently frozen from then on. Normal
 * store operations are NEVER blocked while a stocktake is open (§28); this
 * file's own job is reconciling them, not preventing them.
 *
 * RECONCILIATION: a physical count is never compared against the raw
 * snapshot directly. `reconciledExpectedQuantity = expectedQuantitySnapshot
 * + netMovementsSinceSnapshot` (via `getNetStoreMovementsSince`, cutoff at
 * the stocktake's own `startedAt`) — a legitimate receipt/issue/return/
 * transfer/adjustment/write-off that happens during an open count is
 * therefore never mistaken for unexplained variance.
 * `variance = countedQuantity - reconciledExpectedQuantity` is
 * recalculated (and re-persisted) on every count/recount, and recomputed
 * FRESH, live, immediately before every finalization eligibility check —
 * a line's stored `resolutionType` is cleared back to null the instant a
 * fresh recompute shows a non-zero variance again, so a stale resolution
 * from an earlier movement can never quietly cover for a newer one.
 *
 * RESOLUTION: `recount` is set automatically the moment a re-count brings
 * a previously non-zero variance to exactly zero — no separate action, no
 * stock movement. `adjustment` and `missing` are each a THIN pass-through
 * to Workstream 6's own existing domain services
 * (`officeInventoryDisposition.ts`'s `adjustStore`/`markStoreMissing`) —
 * this file never appends a ledger row of its own; `resolutionMovementId`
 * simply records the id of whatever those services produced.
 *
 * FINALIZATION never mutates stock — every stock effect a stocktake ever
 * causes already happened through an explicit adjustment/missing action,
 * strictly before finalization is attempted.
 */
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  officeInventoryStocktakesTable,
  officeInventoryStocktakeLinesTable,
  officeInventoryStoresTable,
  officeInventoryStockMovementsTable,
  type OfficeInventoryStocktake,
  type OfficeInventoryStocktakeLine,
} from "@workspace/db";
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as NumberFormatConfig } from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { toMinorUnits, fromMinorUnits, InvalidMoneyStringError } from "./payrollMoney";
import { acquireStoreLock, getStoreBalanceIn, getNetStoreMovementsSince } from "./officeInventoryLedger";
import { adjustStore, markStoreMissing } from "./officeInventoryDisposition";
import { OfficeInventoryStoreNotFoundError } from "./officeInventoryIssuing";
import { recordAuditEvent } from "./auditLog";

export { OfficeInventoryStoreNotFoundError };

export class OfficeInventoryStocktakeNotFoundError extends Error {
  constructor() {
    super("Stocktake not found");
  }
}
export class OfficeInventoryStocktakeLineNotFoundError extends Error {
  constructor() {
    super("Stocktake line not found");
  }
}
export class OfficeInventoryStocktakeInvalidStateError extends Error {
  constructor(expected: string, actual: string) {
    super(`This action requires the stocktake to be "${expected}", but it is "${actual}"`);
  }
}
export class OfficeInventoryInvalidCountError extends Error {
  constructor() {
    super("Counted quantity must be a non-negative number with at most 2 decimal places");
  }
}
export class OfficeInventoryNotYetCountedError extends Error {
  constructor() {
    super("This line has not been counted yet");
  }
}
export class OfficeInventoryNoVarianceError extends Error {
  constructor() {
    super("This line has no variance to resolve");
  }
}
export class OfficeInventoryMissingResolutionRequiresShortageError extends Error {
  constructor() {
    super("A \"missing\" resolution only applies to a shortage (negative variance) — a surplus must be resolved as an adjustment");
  }
}
export class OfficeInventoryStocktakeIncompleteError extends Error {
  constructor(readonly blockingLines: { lineId: number; itemId: number; reason: "not_counted" | "unresolved_variance" }[]) {
    super(`Cannot finalize — ${blockingLines.length} line(s) are not yet counted or have unresolved variance`);
  }
}

const STOCKTAKE_NUMBER_SEQUENCE_KEY = "office_inventory_stocktake";

async function generateStocktakeReference(organizationId: number): Promise<string> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  const numberConfig = (config.data.stocktakeNumber as NumberFormatConfig | undefined) ?? { prefix: "STK", sequenceLength: 5 };
  const periodKey = resolvePeriodKey(numberConfig.resetPolicy, new Date());
  const sequenceValue = await lockAndIncrementSequence({
    organizationId,
    sequenceKey: STOCKTAKE_NUMBER_SEQUENCE_KEY,
    periodKey,
    startingSequence: numberConfig.startingSequence ?? 1,
  });
  const now = new Date();
  return formatGeneratedNumber(numberConfig, sequenceValue, { branchCode: null, departmentCode: null, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
}

function validateCount(quantity: string): void {
  try {
    const minor = toMinorUnits(quantity);
    if (minor < 0n) throw new OfficeInventoryInvalidCountError();
  } catch (err) {
    if (err instanceof InvalidMoneyStringError) throw new OfficeInventoryInvalidCountError();
    throw err;
  }
}

// --- Reads ---

export async function getStocktake(organizationId: number, stocktakeId: number): Promise<OfficeInventoryStocktake | null> {
  const [row] = await db.select().from(officeInventoryStocktakesTable).where(and(eq(officeInventoryStocktakesTable.id, stocktakeId), eq(officeInventoryStocktakesTable.organizationId, organizationId)));
  return row ?? null;
}

export interface ListStocktakesFilter {
  storeId?: number;
  status?: "draft" | "counting" | "finalized";
}

export async function listStocktakes(organizationId: number, filter: ListStocktakesFilter = {}): Promise<OfficeInventoryStocktake[]> {
  const conditions = [eq(officeInventoryStocktakesTable.organizationId, organizationId)];
  if (filter.storeId !== undefined) conditions.push(eq(officeInventoryStocktakesTable.storeId, filter.storeId));
  if (filter.status !== undefined) conditions.push(eq(officeInventoryStocktakesTable.status, filter.status));
  return db.select().from(officeInventoryStocktakesTable).where(and(...conditions)).orderBy(desc(officeInventoryStocktakesTable.createdAt));
}

export interface StocktakeLineView extends OfficeInventoryStocktakeLine {
  /** Live-recomputed, not the possibly-stale persisted value — the net signed movement against this item/store strictly after the stocktake's own startedAt. */
  movementsSinceSnapshot: string;
  /** Live-recomputed: expectedQuantitySnapshot + movementsSinceSnapshot. */
  reconciledExpectedQuantity: string;
  /** Live-recomputed variance against the reconciled expected quantity — may differ from the persisted `variance` column if a movement occurred since the last count/resolve/finalize action touched this line. */
  currentVariance: string | null;
}

async function toLineView(organizationId: number, storeId: number, startedAt: Date | null, line: OfficeInventoryStocktakeLine): Promise<StocktakeLineView> {
  if (!startedAt) {
    return { ...line, movementsSinceSnapshot: "0.00", reconciledExpectedQuantity: line.expectedQuantitySnapshot, currentVariance: null };
  }
  const movementsSinceSnapshot = await getNetStoreMovementsSince(organizationId, line.itemId, storeId, startedAt);
  const reconciledExpectedQuantity = fromMinorUnits(toMinorUnits(line.expectedQuantitySnapshot) + toMinorUnits(movementsSinceSnapshot));
  const currentVariance = line.countedQuantity === null ? null : fromMinorUnits(toMinorUnits(line.countedQuantity) - toMinorUnits(reconciledExpectedQuantity));
  return { ...line, movementsSinceSnapshot, reconciledExpectedQuantity, currentVariance };
}

export async function listStocktakeLines(organizationId: number, stocktakeId: number): Promise<StocktakeLineView[]> {
  const stocktake = await getStocktake(organizationId, stocktakeId);
  if (!stocktake) throw new OfficeInventoryStocktakeNotFoundError();
  const lines = await db.select().from(officeInventoryStocktakeLinesTable).where(and(eq(officeInventoryStocktakeLinesTable.stocktakeId, stocktakeId), eq(officeInventoryStocktakeLinesTable.organizationId, organizationId)));
  return Promise.all(lines.map((line) => toLineView(organizationId, stocktake.storeId, stocktake.startedAt, line)));
}

// --- Create (draft) ---

export interface CreateStocktakeParams {
  organizationId: number;
  storeId: number;
  notes?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function createStocktake(params: CreateStocktakeParams): Promise<OfficeInventoryStocktake> {
  const [store] = await db.select({ id: officeInventoryStoresTable.id }).from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();

  const stocktakeReference = await generateStocktakeReference(params.organizationId);
  const [stocktake] = await db
    .insert(officeInventoryStocktakesTable)
    .values({
      organizationId: params.organizationId,
      storeId: params.storeId,
      stocktakeReference,
      status: "draft",
      notes: params.notes ?? null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_stocktake.created",
    targetType: "office_inventory_stocktake",
    targetId: stocktakeReference,
    afterState: { storeId: params.storeId },
  });

  return stocktake;
}

// --- Start counting (snapshot-at-start) ---

export interface StartStocktakeParams {
  organizationId: number;
  stocktakeId: number;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function startStocktake(params: StartStocktakeParams): Promise<OfficeInventoryStocktake> {
  const existing = await getStocktake(params.organizationId, params.stocktakeId);
  if (!existing) throw new OfficeInventoryStocktakeNotFoundError();
  if (existing.status !== "draft") throw new OfficeInventoryStocktakeInvalidStateError("draft", existing.status);

  const updated = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(officeInventoryStocktakesTable).where(eq(officeInventoryStocktakesTable.id, params.stocktakeId)).for("update");
    if (!locked || locked.status !== "draft") throw new OfficeInventoryStocktakeInvalidStateError("draft", locked?.status ?? "unknown");

    // §28: item population — every item with any movement history in this
    // store (not merely a currently non-zero balance), so a fully-issued
    // (zero-balance) item required for control is never silently excluded.
    const itemRows = await tx
      .selectDistinct({ itemId: officeInventoryStockMovementsTable.itemId })
      .from(officeInventoryStockMovementsTable)
      .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.storeId, locked.storeId)));

    for (const { itemId } of itemRows) {
      // Same advisory-lock domain an ordinary movement against this store's
      // item would acquire (§28's own explicit requirement) — serializes a
      // stocktake-start against an in-flight receipt/issue for the same item.
      await acquireStoreLock(tx, params.organizationId, itemId, locked.storeId);
      const balance = await getStoreBalanceIn(tx, params.organizationId, itemId, locked.storeId);
      await tx.insert(officeInventoryStocktakeLinesTable).values({
        organizationId: params.organizationId,
        stocktakeId: params.stocktakeId,
        itemId,
        expectedQuantitySnapshot: balance,
      });
    }

    // `startedAt` MUST be the DATABASE's own clock (Postgres `now()`), not
    // the application server's (`new Date()`) — every ledger row's own
    // `occurredAt` default is likewise computed by Postgres. Comparing an
    // app-clock cutoff against DB-clock movement timestamps is unsound the
    // instant the two clocks drift even slightly (confirmed live during
    // this workstream's own QA: a real ~9.5s skew between this session's
    // Node process and its Postgres host caused the ORIGINAL receipt —
    // which happened seconds before the snapshot in true wall-clock time —
    // to appear to have occurred AFTER it, corrupting the reconciliation).
    const [result] = await tx
      .update(officeInventoryStocktakesTable)
      .set({ status: "counting", startedAt: sql`now()`, startedByMembershipId: params.actorMembershipId ?? null })
      .where(eq(officeInventoryStocktakesTable.id, params.stocktakeId))
      .returning();
    return result;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_stocktake.started",
    targetType: "office_inventory_stocktake",
    targetId: updated.stocktakeReference,
    afterState: { storeId: updated.storeId, startedAt: updated.startedAt },
  });

  return updated;
}

// --- Count entry / recount ---

export interface RecordCountParams {
  organizationId: number;
  stocktakeId: number;
  lineId: number;
  countedQuantity: string;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function recordCount(params: RecordCountParams): Promise<StocktakeLineView> {
  validateCount(params.countedQuantity);

  const stocktake = await getStocktake(params.organizationId, params.stocktakeId);
  if (!stocktake) throw new OfficeInventoryStocktakeNotFoundError();
  if (stocktake.status !== "counting") throw new OfficeInventoryStocktakeInvalidStateError("counting", stocktake.status);

  const updatedLine = await db.transaction(async (tx) => {
    const [line] = await tx
      .select()
      .from(officeInventoryStocktakeLinesTable)
      .where(and(eq(officeInventoryStocktakeLinesTable.id, params.lineId), eq(officeInventoryStocktakeLinesTable.stocktakeId, params.stocktakeId), eq(officeInventoryStocktakeLinesTable.organizationId, params.organizationId)))
      .for("update");
    if (!line) throw new OfficeInventoryStocktakeLineNotFoundError();

    const movementsSinceSnapshot = await getNetStoreMovementsSince(params.organizationId, line.itemId, stocktake.storeId, stocktake.startedAt!);
    const reconciledExpected = toMinorUnits(line.expectedQuantitySnapshot) + toMinorUnits(movementsSinceSnapshot);
    const newVarianceMinor = toMinorUnits(params.countedQuantity) - reconciledExpected;
    const newVariance = fromMinorUnits(newVarianceMinor);

    const wasAlreadyCounted = line.countedQuantity !== null;
    const previousVarianceMinor = line.variance !== null ? toMinorUnits(line.variance) : null;
    const isRecountResolvingToZero = wasAlreadyCounted && newVarianceMinor === 0n && previousVarianceMinor !== null && previousVarianceMinor !== 0n;

    const [updated] = await tx
      .update(officeInventoryStocktakeLinesTable)
      .set({
        countedQuantity: params.countedQuantity,
        countedByMembershipId: params.actorMembershipId,
        countedAt: new Date(),
        variance: newVariance,
        resolutionType: isRecountResolvingToZero ? "recount" : newVarianceMinor !== 0n ? null : line.resolutionType,
        resolvedAt: isRecountResolvingToZero ? new Date() : newVarianceMinor !== 0n ? null : line.resolvedAt,
      })
      .where(eq(officeInventoryStocktakeLinesTable.id, params.lineId))
      .returning();
    return updated;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_stocktake_line.counted",
    targetType: "office_inventory_stocktake_line",
    targetId: String(params.lineId),
    afterState: { countedQuantity: params.countedQuantity, variance: updatedLine.variance, resolutionType: updatedLine.resolutionType },
  });

  return toLineView(params.organizationId, stocktake.storeId, stocktake.startedAt, updatedLine);
}

// --- Variance resolution ---

async function loadCountedLineForResolution(organizationId: number, stocktakeId: number, lineId: number): Promise<{ stocktake: OfficeInventoryStocktake; line: OfficeInventoryStocktakeLine; freshVariance: bigint }> {
  const stocktake = await getStocktake(organizationId, stocktakeId);
  if (!stocktake) throw new OfficeInventoryStocktakeNotFoundError();
  if (stocktake.status !== "counting") throw new OfficeInventoryStocktakeInvalidStateError("counting", stocktake.status);

  const [line] = await db
    .select()
    .from(officeInventoryStocktakeLinesTable)
    .where(and(eq(officeInventoryStocktakeLinesTable.id, lineId), eq(officeInventoryStocktakeLinesTable.stocktakeId, stocktakeId), eq(officeInventoryStocktakeLinesTable.organizationId, organizationId)));
  if (!line) throw new OfficeInventoryStocktakeLineNotFoundError();
  if (line.countedQuantity === null) throw new OfficeInventoryNotYetCountedError();

  const movementsSinceSnapshot = await getNetStoreMovementsSince(organizationId, line.itemId, stocktake.storeId, stocktake.startedAt!);
  const reconciledExpected = toMinorUnits(line.expectedQuantitySnapshot) + toMinorUnits(movementsSinceSnapshot);
  const freshVariance = toMinorUnits(line.countedQuantity) - reconciledExpected;
  if (freshVariance === 0n) throw new OfficeInventoryNoVarianceError();

  return { stocktake, line, freshVariance };
}

export interface ResolveWithAdjustmentParams {
  organizationId: number;
  stocktakeId: number;
  lineId: number;
  reason: string;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function resolveWithAdjustment(params: ResolveWithAdjustmentParams): Promise<StocktakeLineView> {
  const { stocktake, line, freshVariance } = await loadCountedLineForResolution(params.organizationId, params.stocktakeId, params.lineId);

  const direction = freshVariance > 0n ? "in" : "out";
  const quantity = fromMinorUnits(freshVariance > 0n ? freshVariance : -freshVariance);

  const { movement } = await adjustStore({
    organizationId: params.organizationId,
    storeId: stocktake.storeId,
    itemId: line.itemId,
    direction,
    quantity,
    reason: params.reason,
    sourceReferenceType: "stocktake_line",
    sourceReferenceId: line.id,
    actorMembershipId: params.actorMembershipId,
    actorApplicationUserId: params.actorApplicationUserId,
  });

  const [updated] = await db
    .update(officeInventoryStocktakeLinesTable)
    .set({ resolutionType: "adjustment", resolutionMovementId: movement.id, resolvedAt: new Date(), variance: fromMinorUnits(freshVariance) })
    .where(eq(officeInventoryStocktakeLinesTable.id, params.lineId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_stocktake_line.resolved",
    targetType: "office_inventory_stocktake_line",
    targetId: String(params.lineId),
    afterState: { resolutionType: "adjustment", resolutionMovementId: movement.id, variance: updated.variance },
  });

  return toLineView(params.organizationId, stocktake.storeId, stocktake.startedAt, updated);
}

export interface ResolveWithMissingParams {
  organizationId: number;
  stocktakeId: number;
  lineId: number;
  reason: string;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function resolveWithMissing(params: ResolveWithMissingParams): Promise<StocktakeLineView> {
  const { stocktake, line, freshVariance } = await loadCountedLineForResolution(params.organizationId, params.stocktakeId, params.lineId);
  if (freshVariance > 0n) throw new OfficeInventoryMissingResolutionRequiresShortageError();

  const quantity = fromMinorUnits(-freshVariance);

  const { movement } = await markStoreMissing({
    organizationId: params.organizationId,
    storeId: stocktake.storeId,
    itemId: line.itemId,
    quantity,
    reason: params.reason,
    sourceReferenceType: "stocktake_line",
    sourceReferenceId: line.id,
    actorMembershipId: params.actorMembershipId,
    actorApplicationUserId: params.actorApplicationUserId,
  });

  const [updated] = await db
    .update(officeInventoryStocktakeLinesTable)
    .set({ resolutionType: "missing", resolutionMovementId: movement.id, resolvedAt: new Date(), variance: fromMinorUnits(freshVariance) })
    .where(eq(officeInventoryStocktakeLinesTable.id, params.lineId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_stocktake_line.resolved",
    targetType: "office_inventory_stocktake_line",
    targetId: String(params.lineId),
    afterState: { resolutionType: "missing", resolutionMovementId: movement.id, variance: updated.variance },
  });

  return toLineView(params.organizationId, stocktake.storeId, stocktake.startedAt, updated);
}

// --- Finalization ---

export interface FinalizeStocktakeParams {
  organizationId: number;
  stocktakeId: number;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function finalizeStocktake(params: FinalizeStocktakeParams): Promise<OfficeInventoryStocktake> {
  const existing = await getStocktake(params.organizationId, params.stocktakeId);
  if (!existing) throw new OfficeInventoryStocktakeNotFoundError();
  if (existing.status !== "counting") throw new OfficeInventoryStocktakeInvalidStateError("counting", existing.status);

  const finalized = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(officeInventoryStocktakesTable).where(eq(officeInventoryStocktakesTable.id, params.stocktakeId)).for("update");
    if (!locked || locked.status !== "counting") throw new OfficeInventoryStocktakeInvalidStateError("counting", locked?.status ?? "unknown");

    // FOR UPDATE — closes a finalize-vs-count/resolve gap: every one of
    // those actions also locks its own line row, so this serializes
    // finalization against any in-flight count/recount/resolution for the
    // same stocktake rather than reading a value that's about to be
    // superseded a moment later.
    const lines = await tx.select().from(officeInventoryStocktakeLinesTable).where(eq(officeInventoryStocktakeLinesTable.stocktakeId, params.stocktakeId)).for("update");
    const blocking: { lineId: number; itemId: number; reason: "not_counted" | "unresolved_variance" }[] = [];

    for (const line of lines) {
      if (line.countedQuantity === null) {
        blocking.push({ lineId: line.id, itemId: line.itemId, reason: "not_counted" });
        continue;
      }

      const movementsSinceSnapshot = await getNetStoreMovementsSince(params.organizationId, line.itemId, locked.storeId, locked.startedAt!);
      const reconciledExpected = toMinorUnits(line.expectedQuantitySnapshot) + toMinorUnits(movementsSinceSnapshot);
      const freshVarianceMinor = toMinorUnits(line.countedQuantity) - reconciledExpected;
      const freshVariance = fromMinorUnits(freshVarianceMinor);

      if (freshVarianceMinor !== 0n) {
        // A fresh recompute reopening a previously-resolved line's variance
        // must clear the stale resolution — an old adjustment/missing/
        // recount can never silently cover for a newer discrepancy.
        await tx
          .update(officeInventoryStocktakeLinesTable)
          .set({ variance: freshVariance, resolutionType: null, resolvedAt: null })
          .where(eq(officeInventoryStocktakeLinesTable.id, line.id));
        blocking.push({ lineId: line.id, itemId: line.itemId, reason: "unresolved_variance" });
      } else if (line.variance === null || toMinorUnits(line.variance) !== 0n) {
        await tx.update(officeInventoryStocktakeLinesTable).set({ variance: freshVariance }).where(eq(officeInventoryStocktakeLinesTable.id, line.id));
      }
    }

    if (blocking.length > 0) throw new OfficeInventoryStocktakeIncompleteError(blocking);

    const [result] = await tx
      .update(officeInventoryStocktakesTable)
      .set({ status: "finalized", finalizedAt: new Date(), finalizedByMembershipId: params.actorMembershipId ?? null })
      .where(eq(officeInventoryStocktakesTable.id, params.stocktakeId))
      .returning();
    return result;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_stocktake.finalized",
    targetType: "office_inventory_stocktake",
    targetId: finalized.stocktakeReference,
    afterState: { finalizedAt: finalized.finalizedAt },
  });

  return finalized;
}
