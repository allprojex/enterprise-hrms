/**
 * Office Inventory, Workstream 2 — Stock Ledger core
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.3, §8, §47). Owns the
 * single authoritative append-only ledger (`office_inventory_stock_movements`)
 * and the two primitives every future stock-affecting domain service must
 * build on: live balance derivation and the lock→resolve→validate→append
 * sequence for a single movement row. No application code path anywhere in
 * this codebase UPDATEs or DELETEs a row in this table — append-only is
 * enforced entirely by the fact that this file (the sole owner of writes to
 * this table) exposes no update/delete function, mirroring this platform's
 * established convention of disclosed application-layer invariants rather
 * than DB CHECK/trigger-level enforcement (identical in kind to the
 * negative-stock invariant itself, immediately below).
 *
 * DIRECTION TABLE (the one central, authoritative definition of what each
 * `movementType` does to a STORE's balance — every future domain service
 * that appends a store-affecting row must produce a sign consistent with
 * this table by construction; this file is the only place that table is
 * allowed to live):
 *   increases a store's balance: received, transferred_in, adjustment_in,
 *     returned, recovered
 *   decreases a store's balance: issued, transferred_out, adjustment_out,
 *     written_off, missing, asset_handoff
 * Workstream 2 itself only ever appends `received` rows — every other type
 * above exists in this direction table now so later workstreams need no
 * redesign, not because W2 produces them.
 *
 * CONCURRENCY: every store-balance-affecting append acquires
 * `pg_advisory_xact_lock(hashtext('org:item:store'))` — reusing the exact
 * mechanism `payrollRuns.ts`/`payrollPeriods.ts` already prove for
 * period/run-creation races — before computing the current derived balance
 * and before inserting the new movement row, all inside one transaction.
 *
 * NEGATIVE-STOCK INVARIANT: application-layer only, not a DB CHECK
 * constraint, since balance is never a stored column (disclosed explicitly,
 * per §8) — enforced by `appendStoreMovement` re-checking the live balance
 * inside the same locked transaction immediately before any decreasing
 * insert.
 */
import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { db, officeInventoryItemsTable, officeInventoryStockMovementsTable, type OfficeInventoryStockMovement } from "@workspace/db";
import { toMinorUnits, fromMinorUnits } from "./payrollMoney";

// Identical shape to numbering.ts's own (unexported) QueryClient convention —
// either the plain `db` handle or the `tx` handle inside `db.transaction`.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OfficeInventoryMovementType =
  | "received"
  | "issued"
  | "returned"
  | "transferred_out"
  | "transferred_in"
  | "adjustment_in"
  | "adjustment_out"
  | "written_off"
  | "missing"
  | "recovered"
  | "asset_handoff";

export const STORE_INCREASING_TYPES: readonly OfficeInventoryMovementType[] = [
  "received",
  "transferred_in",
  "adjustment_in",
  "returned",
  "recovered",
];
export const STORE_DECREASING_TYPES: readonly OfficeInventoryMovementType[] = [
  "issued",
  "transferred_out",
  "adjustment_out",
  "written_off",
  "missing",
  "asset_handoff",
];

export class InsufficientStockError extends Error {
  constructor(
    readonly itemId: number,
    readonly storeId: number,
    readonly available: string,
    readonly requested: string,
  ) {
    super(`Insufficient stock: item ${itemId} in store ${storeId} has ${available} available, ${requested} requested`);
  }
}

/**
 * The holder-side counterpart to InsufficientStockError — kept distinct
 * (rather than reusing InsufficientStockError with a holderId passed where
 * a storeId is expected) so the error message is accurate. Unreachable
 * until Workstream 5 defines a holder-decreasing movement type (`returned`)
 * — HOLDER_DECREASING_TYPES was empty throughout Workstream 4.
 */
export class InsufficientCustodyError extends Error {
  constructor(
    readonly itemId: number,
    readonly holderType: "employee" | "department",
    readonly holderId: number,
    readonly available: string,
    readonly requested: string,
  ) {
    super(`Insufficient custody: item ${itemId} held by ${holderType} ${holderId} has ${available} outstanding, ${requested} requested`);
  }
}

export function movementSign(movementType: OfficeInventoryMovementType): 1 | -1 {
  if (STORE_INCREASING_TYPES.includes(movementType)) return 1;
  if (STORE_DECREASING_TYPES.includes(movementType)) return -1;
  throw new Error(`Movement type "${movementType}" has no defined store-balance direction`);
}

/**
 * Postgres advisory-lock key for one (organization, item, store) domain —
 * §8's exact frozen formula. Exported (Workstream 7 onward) so
 * officeInventoryStocktakes.ts can serialize a stocktake-start snapshot
 * read against the exact same lock domain an ordinary movement against
 * that store's items would acquire (§28's own explicit requirement) —
 * without needing to append a movement row itself.
 */
export async function acquireStoreLock(tx: QueryClient, organizationId: number, itemId: number, storeId: number): Promise<void> {
  const lockKey = `${organizationId}:${itemId}:${storeId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

// The one shared signed-quantity CASE expression every balance query below
// uses — computed entirely in SQL (never JS floating-point). drizzle-orm's
// `sql` template expands a bound JS array into an individually-parameterized
// tuple (`($1, $2, ...)`), not a true Postgres array value — so this must use
// `IN (...)`, not `= ANY(...)` (which requires a real array on its right
// side and rejects a tuple with error 42809).
//
// Deliberately a FUNCTION, not a module-level constant — building the `sql`
// chunk at import time broke every pre-existing test file whose own
// `vi.mock("drizzle-orm", ...)` doesn't happen to re-export `sql` (it never
// needed to before this file existed), the instant any of them imported
// ../app and pulled this module in transitively through routes/index.ts.
// Building it lazily, inside each function that actually needs it, defers
// the `sql` call to query-construction time instead of module-load time.
function signedQuantitySql() {
  return sql`case
    when ${officeInventoryStockMovementsTable.movementType}::text in ${[...STORE_INCREASING_TYPES]} then ${officeInventoryStockMovementsTable.quantity}
    when ${officeInventoryStockMovementsTable.movementType}::text in ${[...STORE_DECREASING_TYPES]} then -${officeInventoryStockMovementsTable.quantity}
    else 0 end`;
}

/**
 * Live-derived current balance for one (item, store) — SUM of signed
 * quantity, computed entirely in SQL (never JS floating-point), returned as
 * a numeric(12,2)-shaped string. Zero rows -> "0.00". Not itself
 * lock-protected — callers that need a consistent read-then-write must
 * acquire the lock first (see `appendStoreMovement`); this function alone is
 * for plain reads (e.g. a balance display) where a benign race with a
 * concurrent write is acceptable.
 */
export async function getStoreBalance(organizationId: number, itemId: number, storeId: number): Promise<string> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${signedQuantitySql()}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        eq(officeInventoryStockMovementsTable.storeId, storeId),
      ),
    );
  return row?.balance ?? "0.00";
}

/**
 * Net signed quantity moved against one (item, store) STRICTLY AFTER
 * `sinceOccurredAt` — Workstream 7's own reconciliation primitive (§7/§28).
 * A stocktake's `expectedQuantitySnapshot` is frozen the instant counting
 * starts; this is what officeInventoryStocktakes.ts adds back to that
 * snapshot to get the movement-adjusted "reconciled expected quantity" a
 * physical count is actually compared against, so a legitimate
 * receipt/issue/return/transfer/adjustment/write-off that happens DURING
 * an open count is never mistaken for unexplained variance. Uses the same
 * signed-quantity direction table as every other store balance query —
 * `strictly after`, not `>=`, since the snapshot read itself never inserts
 * a row of its own to collide with.
 */
export async function getNetStoreMovementsSince(organizationId: number, itemId: number, storeId: number, sinceOccurredAt: Date): Promise<string> {
  const [row] = await db
    .select({ net: sql<string>`coalesce(sum(${signedQuantitySql()}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        eq(officeInventoryStockMovementsTable.storeId, storeId),
        gt(officeInventoryStockMovementsTable.occurredAt, sinceOccurredAt),
      ),
    );
  return row?.net ?? "0.00";
}

/** Same (item, store) balance, computed inside an already-open transaction — used by appendStoreMovement's own lock-then-read sequence, and by officeInventoryStocktakes.ts's own lock-then-snapshot sequence at stocktake-start (Workstream 7). */
export async function getStoreBalanceIn(tx: QueryClient, organizationId: number, itemId: number, storeId: number): Promise<string> {
  const [row] = await tx
    .select({ balance: sql<string>`coalesce(sum(${signedQuantitySql()}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        eq(officeInventoryStockMovementsTable.storeId, storeId),
      ),
    );
  return row?.balance ?? "0.00";
}

/** One item's balance in every store it has ever moved through (organization-scoped). */
export async function getStoreBalancesForItem(organizationId: number, itemId: number): Promise<{ storeId: number; balance: string }[]> {
  const rows = await db
    .select({
      storeId: officeInventoryStockMovementsTable.storeId,
      balance: sql<string>`coalesce(sum(${signedQuantitySql()}), 0)::numeric(12,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.itemId, itemId)))
    .groupBy(officeInventoryStockMovementsTable.storeId);
  return rows.filter((r): r is { storeId: number; balance: string } => r.storeId !== null);
}

/** One item's organization-wide total across every store — computed directly in SQL rather than re-summed in JS. */
export async function getOrganizationTotalBalance(organizationId: number, itemId: number): Promise<string> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${signedQuantitySql()}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        sql`${officeInventoryStockMovementsTable.storeId} is not null`,
      ),
    );
  return row?.balance ?? "0.00";
}

export interface AppendStoreMovementParams {
  organizationId: number;
  itemId: number;
  storeId: number;
  movementType: OfficeInventoryMovementType;
  quantity: string;
  referenceNumber?: string | null;
  sourceReferenceType?: "request_line" | "incident" | "stocktake_line" | "asset" | null;
  sourceReferenceId?: number | null;
  source?: string | null;
  deliveryReference?: string | null;
  unitCost?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  notes?: string | null;
}

/**
 * The single write primitive every store-affecting movement (in or out) must
 * go through: LOCK the (org, item, store) domain -> resolve the live balance
 * -> validate (only relevant for a decreasing type) -> append -> the caller
 * commits. Must be called with `tx` already inside an open transaction that
 * holds the advisory lock for its own duration — this function acquires the
 * lock itself, so callers should not acquire it a second time for the same
 * key. `quantity` must already be validated as a positive numeric(12,2)
 * string by the caller (receiving does this before calling in).
 */
export interface ListStockMovementsFilter {
  itemId?: number;
  storeId?: number;
  holderType?: "employee" | "department";
  holderId?: number;
}

/** Read-only movement history for an organization, newest first, optionally narrowed to one item and/or one store. */
export async function listStockMovements(organizationId: number, filter: ListStockMovementsFilter = {}): Promise<OfficeInventoryStockMovement[]> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId)];
  if (filter.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filter.itemId));
  if (filter.storeId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.storeId, filter.storeId));
  if (filter.holderType !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.holderType, filter.holderType));
  if (filter.holderId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.holderId, filter.holderId));

  return db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(and(...conditions))
    .orderBy(sql`${officeInventoryStockMovementsTable.occurredAt} desc`);
}

export async function appendStoreMovement(tx: QueryClient, params: AppendStoreMovementParams): Promise<OfficeInventoryStockMovement> {
  await acquireStoreLock(tx, params.organizationId, params.itemId, params.storeId);

  const sign = movementSign(params.movementType);
  if (sign === -1) {
    const currentBalance = await getStoreBalanceIn(tx, params.organizationId, params.itemId, params.storeId);
    const availableMinor = toMinorUnits(currentBalance);
    const requestedMinor = toMinorUnits(params.quantity);
    if (availableMinor - requestedMinor < 0n) {
      throw new InsufficientStockError(params.itemId, params.storeId, fromMinorUnits(availableMinor), params.quantity);
    }
  }

  const [inserted] = await tx
    .insert(officeInventoryStockMovementsTable)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      movementType: params.movementType,
      quantity: params.quantity,
      storeId: params.storeId,
      referenceNumber: params.referenceNumber ?? null,
      sourceReferenceType: params.sourceReferenceType ?? null,
      sourceReferenceId: params.sourceReferenceId ?? null,
      source: params.source ?? null,
      deliveryReference: params.deliveryReference ?? null,
      unitCost: params.unitCost ?? null,
      reason: params.reason ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
      notes: params.notes ?? null,
    })
    .returning();

  return inserted;
}

// --- Holder (employee/department) custody — Workstream 4, extended by 5 ---
//
// A separate direction table from the store one above: the SAME
// `movementType` can mean opposite things to a store's balance and to a
// holder's custody (e.g. `issued` decreases a store's balance but
// increases a holder's custody). Workstream 4 defined only `issued`
// (holder-increasing). Workstream 5 added `returned` (holder-decreasing) —
// reused for BOTH an ordinary holder→store return AND the "from" side of a
// handover. Workstream 6 adds exactly two more holder-decreasing types:
// `missing` (a holder-custody "mark missing" action — §25) and
// `written_off` (a DIRECT write-off of quantity still nominally in a
// holder's custody, never routed through "mark missing" first — §13/§18).
// `recovered` and `adjustment_in`/`adjustment_out` remain deliberately
// undefined on the HOLDER side — recovery always re-enters a STORE (never
// a holder directly, since a "found" item needs a fresh issue if the
// original holder needs it again), and adjustments are store-only by
// design (§17's own explicit custody-discrepancy boundary: an
// employee/department custody discrepancy is never resolved by a direct
// adjustment, only by return/handover/incident/write-off).
export const HOLDER_INCREASING_TYPES: readonly OfficeInventoryMovementType[] = ["issued"];
export const HOLDER_DECREASING_TYPES: readonly OfficeInventoryMovementType[] = ["returned", "missing", "written_off"];

export function holderMovementSign(movementType: OfficeInventoryMovementType): 1 | -1 {
  if (HOLDER_INCREASING_TYPES.includes(movementType)) return 1;
  if (HOLDER_DECREASING_TYPES.includes(movementType)) return -1;
  throw new Error(`Movement type "${movementType}" has no defined holder-custody direction yet`);
}

async function acquireHolderLock(tx: QueryClient, organizationId: number, itemId: number, holderType: "employee" | "department", holderId: number): Promise<void> {
  const lockKey = `${organizationId}:${itemId}:${holderType}:${holderId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

/**
 * Pre-acquires BOTH the store lock and the holder lock, in that fixed
 * order, for one (item, store, holder) domain — Workstream 5's return
 * function calls this before appending its paired rows so its lock order
 * matches Workstream 4's issue functions exactly (which naturally acquire
 * store-then-holder, since they call `appendStoreMovement` before
 * `appendHolderMovement`). Without a single canonical order, a return
 * (holder-then-store) racing a concurrent issue (store-then-holder) for
 * the same item could deadlock — Postgres would detect and abort one side
 * with a raw `deadlock_detected` error instead of the intended clean,
 * controlled application-level conflict (§17 of the frozen plan's own
 * Issue-vs-Return concurrency requirement). Re-acquiring a lock already
 * held by the same transaction is a harmless no-op, so `appendStoreMovement`/
 * `appendHolderMovement`'s own internal lock calls remain safe afterward.
 */
export async function acquireStoreThenHolderLock(tx: QueryClient, organizationId: number, itemId: number, storeId: number, holderType: "employee" | "department", holderId: number): Promise<void> {
  await acquireStoreLock(tx, organizationId, itemId, storeId);
  await acquireHolderLock(tx, organizationId, itemId, holderType, holderId);
}

/**
 * Pre-acquires two HOLDER locks for the same item, in a deterministic
 * sorted order — used by handover, which touches two independent holder
 * domains (source, destination) in one transaction. Without a fixed order,
 * a handover A->B racing a concurrent handover B->A for the same item
 * could deadlock (§19's own concurrency requirement) — sorting by a
 * composite key before acquiring guarantees every caller locks in the
 * same order regardless of which side of the handover it is.
 */
export async function acquireOrderedHolderLocks(
  tx: QueryClient,
  organizationId: number,
  itemId: number,
  holderTypeA: "employee" | "department",
  holderIdA: number,
  holderTypeB: "employee" | "department",
  holderIdB: number,
): Promise<void> {
  const keyA = `${holderTypeA}:${holderIdA}`;
  const keyB = `${holderTypeB}:${holderIdB}`;
  const [first, second] = keyA <= keyB ? [[holderTypeA, holderIdA] as const, [holderTypeB, holderIdB] as const] : [[holderTypeB, holderIdB] as const, [holderTypeA, holderIdA] as const];
  await acquireHolderLock(tx, organizationId, itemId, first[0], first[1]);
  if (keyA !== keyB) await acquireHolderLock(tx, organizationId, itemId, second[0], second[1]);
}

/**
 * Pre-acquires two STORE locks for the same item, in ascending storeId
 * order — the store-transfer analogue of `acquireOrderedHolderLocks`,
 * satisfying §16's explicit "sort lock keys before acquiring" instruction
 * so a transfer A->B never races a concurrent transfer B->A into a
 * deadlock.
 */
export async function acquireOrderedStoreLocks(tx: QueryClient, organizationId: number, itemId: number, storeIdA: number, storeIdB: number): Promise<void> {
  const [first, second] = storeIdA <= storeIdB ? [storeIdA, storeIdB] : [storeIdB, storeIdA];
  await acquireStoreLock(tx, organizationId, itemId, first);
  if (first !== second) await acquireStoreLock(tx, organizationId, itemId, second);
}

// Bug found and fixed during Workstream 5's own live QA (not by the mocked
// test suite): this was written in Workstream 4, when HOLDER_DECREASING_TYPES
// was still empty, so it only ever needed the increasing branch. Workstream 5
// added "returned" as the first holder-decreasing type but this function was
// never updated to match — every getHolderBalance/listCurrentCustody read
// (and appendHolderMovement's own pre-decrease validation query, which reuses
// this same helper) silently ignored every decreasing row, so a return or a
// handover's source-side decrease never reduced the computed balance at all.
// Now mirrors signedQuantitySql's own two-branch shape exactly.
function signedHolderQuantitySql() {
  return sql`case
    when ${officeInventoryStockMovementsTable.movementType}::text in ${[...HOLDER_INCREASING_TYPES]} then ${officeInventoryStockMovementsTable.quantity}
    when ${officeInventoryStockMovementsTable.movementType}::text in ${[...HOLDER_DECREASING_TYPES]} then -${officeInventoryStockMovementsTable.quantity}
    else 0 end`;
}

/** Live-derived current custody for one (item, holder) — same SUM-in-SQL approach as getStoreBalance. */
export async function getHolderBalance(organizationId: number, itemId: number, holderType: "employee" | "department", holderId: number): Promise<string> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${signedHolderQuantitySql()}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        eq(officeInventoryStockMovementsTable.holderType, holderType),
        eq(officeInventoryStockMovementsTable.holderId, holderId),
      ),
    );
  return row?.balance ?? "0.00";
}

export interface HolderCustodyEntry {
  itemId: number;
  balance: string;
  /**
   * Live-derived, never stored (§20 of the frozen plan): true when this
   * holder's outstanding balance for this item is positive AND the most
   * recent holder-increasing (`issued`) row's own `expectedReturnDate` has
   * passed. A handover's destination row is itself an ordinary `issued`
   * row (see the direction-table comment above), so a handover correctly
   * becomes the new "most recent" row and supersedes whatever due date the
   * previous holder was tracking — by design, not an oversight (§13/§20:
   * a handover does not silently carry forward a due date unless the
   * initiator explicitly sets a new one).
   */
  overdue: boolean;
  expectedReturnDate: string | null;
  /**
   * WWM Employee Access Remediation (2026-09-07): the held item's own
   * display identity, resolved here (batched, same org) so a holder can
   * read what they hold WITHOUT the catalogue grant
   * (office_inventory.item.manage) that GET .../office-inventory/items
   * requires. Only items already in this holder's custody are ever named —
   * never the organization's wider catalogue. Null only if the item row is
   * somehow gone.
   */
  itemName: string | null;
  itemCode: string | null;
  classification: "consumable" | "returnable" | null;
}

/** Display identity for the given items, scoped to the organization. Batched; empty input → empty map. */
export async function resolveItemIdentities(organizationId: number, itemIds: number[]): Promise<Map<number, { name: string; itemCode: string; classification: "consumable" | "returnable" }>> {
  const map = new Map<number, { name: string; itemCode: string; classification: "consumable" | "returnable" }>();
  const distinct = [...new Set(itemIds)];
  if (distinct.length === 0) return map;
  const rows = await db
    .select({
      id: officeInventoryItemsTable.id,
      name: officeInventoryItemsTable.name,
      itemCode: officeInventoryItemsTable.itemCode,
      classification: officeInventoryItemsTable.classification,
    })
    .from(officeInventoryItemsTable)
    .where(and(eq(officeInventoryItemsTable.organizationId, organizationId), inArray(officeInventoryItemsTable.id, distinct)));
  for (const row of rows) map.set(row.id, { name: row.name, itemCode: row.itemCode, classification: row.classification });
  return map;
}

/** Every item an employee or department currently holds any outstanding quantity of, derived live from the ledger — never a mutable "current custodian" table. */
export async function listCurrentCustody(organizationId: number, holderType: "employee" | "department", holderId: number): Promise<HolderCustodyEntry[]> {
  const balanceRows = await db
    .select({
      itemId: officeInventoryStockMovementsTable.itemId,
      balance: sql<string>`coalesce(sum(${signedHolderQuantitySql()}), 0)::numeric(12,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.holderType, holderType),
        eq(officeInventoryStockMovementsTable.holderId, holderId),
      ),
    )
    .groupBy(officeInventoryStockMovementsTable.itemId);
  const outstanding = balanceRows.filter((r) => toMinorUnits(r.balance) > 0n);
  if (outstanding.length === 0) return [];

  // Batched (no N+1, per §20's own explicit instruction): the most recent
  // `issued`-type row per item for this holder, whatever its due date.
  const mostRecentIssueRows = await db
    .selectDistinctOn([officeInventoryStockMovementsTable.itemId], {
      itemId: officeInventoryStockMovementsTable.itemId,
      expectedReturnDate: officeInventoryStockMovementsTable.expectedReturnDate,
    })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.holderType, holderType),
        eq(officeInventoryStockMovementsTable.holderId, holderId),
        eq(officeInventoryStockMovementsTable.movementType, "issued"),
      ),
    )
    .orderBy(officeInventoryStockMovementsTable.itemId, sql`${officeInventoryStockMovementsTable.occurredAt} desc`);
  const dueDateByItem = new Map<number, string | null>();
  for (const row of mostRecentIssueRows) dueDateByItem.set(row.itemId, row.expectedReturnDate);
  const identities = await resolveItemIdentities(organizationId, outstanding.map((r) => r.itemId));

  const now = new Date();
  return outstanding.map((r) => {
    const expectedReturnDate = dueDateByItem.get(r.itemId) ?? null;
    const identity = identities.get(r.itemId);
    return {
      itemId: r.itemId,
      balance: r.balance,
      expectedReturnDate,
      overdue: expectedReturnDate !== null && new Date(expectedReturnDate) < now,
      itemName: identity?.name ?? null,
      itemCode: identity?.itemCode ?? null,
      classification: identity?.classification ?? null,
    };
  });
}

/**
 * Workstream 8 (§34) — the single-item version of `listCurrentCustody`'s
 * own per-item balance/overdue derivation, for the Department Head
 * approval-context screen (one item per request line, not "everything this
 * holder has"). Always returns a row, even at zero balance — a Head
 * reviewing a repeat request needs to see "currently holds 0" just as much
 * as "currently holds 2," never a fabricated absence.
 */
export async function getHolderCustodyForItem(organizationId: number, itemId: number, holderType: "employee" | "department", holderId: number): Promise<HolderCustodyEntry> {
  const balance = await getHolderBalance(organizationId, itemId, holderType, holderId);
  const [mostRecentIssue] = await db
    .select({ expectedReturnDate: officeInventoryStockMovementsTable.expectedReturnDate })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        eq(officeInventoryStockMovementsTable.holderType, holderType),
        eq(officeInventoryStockMovementsTable.holderId, holderId),
        eq(officeInventoryStockMovementsTable.movementType, "issued"),
      ),
    )
    .orderBy(sql`${officeInventoryStockMovementsTable.occurredAt} desc`)
    .limit(1);
  const expectedReturnDate = mostRecentIssue?.expectedReturnDate ?? null;
  const identity = (await resolveItemIdentities(organizationId, [itemId])).get(itemId);
  return {
    itemId,
    balance,
    expectedReturnDate,
    overdue: toMinorUnits(balance) > 0n && expectedReturnDate !== null && new Date(expectedReturnDate) < new Date(),
    itemName: identity?.name ?? null,
    itemCode: identity?.itemCode ?? null,
    classification: identity?.classification ?? null,
  };
}

/**
 * Workstream 8 (§15/§34) — sums a holder-side movement type for one item
 * since a cutoff, completing the repeat-request accountability panel with
 * real issue/return quantities (never a stored counter). `returned` here
 * covers both an ordinary return-to-store AND a handover-away-from-holder
 * (§22: a handover's source leg is an ordinary `returned` row) — both
 * equally answer "did this leave their custody," the correct accountability
 * signal, not a narrower "formal returns only" count.
 */
export async function sumHolderMovementsSince(
  organizationId: number,
  itemId: number,
  holderType: "employee" | "department",
  holderId: number,
  movementType: "issued" | "returned",
  since: Date,
): Promise<string> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${officeInventoryStockMovementsTable.quantity}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.itemId, itemId),
        eq(officeInventoryStockMovementsTable.holderType, holderType),
        eq(officeInventoryStockMovementsTable.holderId, holderId),
        eq(officeInventoryStockMovementsTable.movementType, movementType),
        gte(officeInventoryStockMovementsTable.occurredAt, since),
      ),
    );
  return row?.total ?? "0.00";
}

export interface AppendHolderMovementParams {
  organizationId: number;
  itemId: number;
  holderType: "employee" | "department";
  holderId: number;
  movementType: OfficeInventoryMovementType;
  quantity: string;
  referenceNumber?: string | null;
  sourceReferenceType?: "request_line" | "incident" | "stocktake_line" | "asset" | null;
  sourceReferenceId?: number | null;
  condition?: "new" | "good" | "fair" | "poor" | "damaged" | null;
  reason?: string | null;
  expectedReturnDate?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  notes?: string | null;
}

/** The holder-side counterpart to `appendStoreMovement` — same lock→resolve→validate→append shape, on the holder-custody domain instead of the store-balance one. */
export async function appendHolderMovement(tx: QueryClient, params: AppendHolderMovementParams): Promise<OfficeInventoryStockMovement> {
  await acquireHolderLock(tx, params.organizationId, params.itemId, params.holderType, params.holderId);

  const sign = holderMovementSign(params.movementType);
  if (sign === -1) {
    const [row] = await tx
      .select({ balance: sql<string>`coalesce(sum(${signedHolderQuantitySql()}), 0)::numeric(12,2)` })
      .from(officeInventoryStockMovementsTable)
      .where(
        and(
          eq(officeInventoryStockMovementsTable.organizationId, params.organizationId),
          eq(officeInventoryStockMovementsTable.itemId, params.itemId),
          eq(officeInventoryStockMovementsTable.holderType, params.holderType),
          eq(officeInventoryStockMovementsTable.holderId, params.holderId),
        ),
      );
    const availableMinor = toMinorUnits(row?.balance ?? "0.00");
    const requestedMinor = toMinorUnits(params.quantity);
    if (availableMinor - requestedMinor < 0n) {
      throw new InsufficientCustodyError(params.itemId, params.holderType, params.holderId, fromMinorUnits(availableMinor), params.quantity);
    }
  }

  const [inserted] = await tx
    .insert(officeInventoryStockMovementsTable)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      movementType: params.movementType,
      quantity: params.quantity,
      holderType: params.holderType,
      holderId: params.holderId,
      referenceNumber: params.referenceNumber ?? null,
      sourceReferenceType: params.sourceReferenceType ?? null,
      sourceReferenceId: params.sourceReferenceId ?? null,
      condition: params.condition ?? null,
      reason: params.reason ?? null,
      expectedReturnDate: params.expectedReturnDate ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
      notes: params.notes ?? null,
    })
    .returning();

  return inserted;
}

// --- Unscoped movements — Workstream 6 ---
//
// A row with neither `storeId` nor `holderType`/`holderId` set — matched by
// NEITHER `getStoreBalance` nor `getHolderBalance`/`listCurrentCustody`'s
// own WHERE clauses (both filter on one of those columns explicitly), so an
// unscoped row never contributes to any store or holder balance by
// construction. Used for exactly one case: writing off a quantity that a
// prior `missing` row has ALREADY removed from a holder's live custody
// (§14/§25) — there is no live store or holder balance left to decrement a
// second time, only the incident's own derived "outstanding missing"
// tally (owned by officeInventoryDisposition.ts, which acquires its own
// incident-scoped advisory lock before computing and validating that
// tally — this primitive performs no balance validation of its own, since
// it has no balance to validate against).
export interface AppendUnscopedMovementParams {
  organizationId: number;
  itemId: number;
  movementType: OfficeInventoryMovementType;
  quantity: string;
  referenceNumber?: string | null;
  sourceReferenceType?: "request_line" | "incident" | "stocktake_line" | "asset" | null;
  sourceReferenceId?: number | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  notes?: string | null;
}

export async function appendUnscopedMovement(tx: QueryClient, params: AppendUnscopedMovementParams): Promise<OfficeInventoryStockMovement> {
  const [inserted] = await tx
    .insert(officeInventoryStockMovementsTable)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      movementType: params.movementType,
      quantity: params.quantity,
      referenceNumber: params.referenceNumber ?? null,
      sourceReferenceType: params.sourceReferenceType ?? null,
      sourceReferenceId: params.sourceReferenceId ?? null,
      reason: params.reason ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
      notes: params.notes ?? null,
    })
    .returning();

  return inserted;
}

/** Postgres advisory-lock key for one incident's own "outstanding missing" tally — serializes concurrent recover/write-off-from-incident attempts against the same incident (§24). */
export async function acquireIncidentLock(tx: QueryClient, organizationId: number, incidentId: number): Promise<void> {
  const lockKey = `${organizationId}:incident:${incidentId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
}

/**
 * How much of a `missing`-type incident's quantity remains unresolved —
 * SUM(missing rows referencing this incident) - SUM(recovered rows
 * referencing this incident) - SUM(written_off rows referencing this
 * incident), all computed in SQL. Must be called with the incident's own
 * advisory lock (`acquireIncidentLock`) already held for the result to be
 * safely actioned against.
 */
export async function getOutstandingMissingForIncident(tx: QueryClient, organizationId: number, incidentId: number): Promise<string> {
  const [row] = await tx
    .select({
      balance: sql<string>`coalesce(sum(case
        when ${officeInventoryStockMovementsTable.movementType} = 'missing' then ${officeInventoryStockMovementsTable.quantity}
        when ${officeInventoryStockMovementsTable.movementType} in ('recovered', 'written_off') then -${officeInventoryStockMovementsTable.quantity}
        else 0 end), 0)::numeric(12,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.sourceReferenceType, "incident"),
        eq(officeInventoryStockMovementsTable.sourceReferenceId, incidentId),
      ),
    );
  return row?.balance ?? "0.00";
}
