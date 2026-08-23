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
import { and, eq, sql } from "drizzle-orm";
import { db, officeInventoryStockMovementsTable, type OfficeInventoryStockMovement } from "@workspace/db";
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

export function movementSign(movementType: OfficeInventoryMovementType): 1 | -1 {
  if (STORE_INCREASING_TYPES.includes(movementType)) return 1;
  if (STORE_DECREASING_TYPES.includes(movementType)) return -1;
  throw new Error(`Movement type "${movementType}" has no defined store-balance direction`);
}

/** Postgres advisory-lock key for one (organization, item, store) domain — §8's exact frozen formula. */
async function acquireStoreLock(tx: QueryClient, organizationId: number, itemId: number, storeId: number): Promise<void> {
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

/** Same (item, store) balance, computed inside an already-open transaction — used by appendStoreMovement's own lock-then-read sequence. */
async function getStoreBalanceIn(tx: QueryClient, organizationId: number, itemId: number, storeId: number): Promise<string> {
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
}

/** Read-only movement history for an organization, newest first, optionally narrowed to one item and/or one store. */
export async function listStockMovements(organizationId: number, filter: ListStockMovementsFilter = {}): Promise<OfficeInventoryStockMovement[]> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId)];
  if (filter.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filter.itemId));
  if (filter.storeId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.storeId, filter.storeId));

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
