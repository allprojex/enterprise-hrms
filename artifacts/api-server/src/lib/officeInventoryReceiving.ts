/**
 * Office Inventory, Workstream 2 — Receiving
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §9, §47). Receiving means
 * stock has already entered organizational possession — this is NOT
 * Procurement: no purchase requisition, RFQ, quotation, PO, or approval
 * workflow exists here or anywhere in this codebase; `source`/
 * `deliveryReference` are plain descriptive text, never proof of anything.
 * A receiving submission may cover multiple items in one session, all
 * sharing one generated `referenceNumber` and committed atomically — if any
 * line is invalid, the whole submission fails and zero rows are written.
 *
 * There is no separate "receipts" header table in the frozen schema — a
 * receipt IS simply the set of `office_inventory_stock_movements` rows that
 * share one `referenceNumber`; this file assembles that view on read rather
 * than maintaining a second, redundant header record.
 *
 * IDEMPOTENCY: an optional client-supplied `idempotencyKey` represents one
 * submission attempt. Because the DB-level uniqueness guarantee
 * (`office_inventory_stock_movements_idempotency_unique`) is per ROW, each
 * line gets its own derived key (`${idempotencyKey}#${lineIndex}`) so a
 * genuine multi-line submission never collides with itself. A retried
 * submission — sequential or genuinely concurrent — is detected via a
 * `pg_advisory_xact_lock` keyed on `(organizationId, idempotencyKey)`
 * acquired before the existence check, inside the same transaction that
 * would otherwise create the receipt: this serializes two racing identical
 * submissions so the loser observes the winner's already-committed rows and
 * returns them instead of inserting a second time — the DB unique index
 * remains as a defense-in-depth backstop, not the primary mechanism.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, officeInventoryStoresTable, officeInventoryItemsTable, officeInventoryStockMovementsTable, type OfficeInventoryStockMovement } from "@workspace/db";
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as ReceiptNumberFormatConfig } from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { toMinorUnits, InvalidMoneyStringError } from "./payrollMoney";
import { appendStoreMovement } from "./officeInventoryLedger";
import { recordAuditEvent } from "./auditLog";

export class OfficeInventoryStoreNotFoundError extends Error {
  constructor() {
    super("Store not found");
  }
}
export class OfficeInventoryReceivingItemsNotFoundError extends Error {
  constructor(readonly itemIds: number[]) {
    super(`One or more items were not found for this organization: ${itemIds.join(", ")}`);
  }
}
export class OfficeInventoryReceivingNoLinesError extends Error {
  constructor() {
    super("A receiving submission must include at least one line");
  }
}
export class OfficeInventoryReceivingInvalidQuantityError extends Error {
  constructor(readonly itemId: number) {
    super(`Item ${itemId}: quantity must be a positive number with at most 2 decimal places`);
  }
}
export class OfficeInventoryReceiptNotFoundError extends Error {
  constructor() {
    super("Receipt not found");
  }
}

const RECEIPT_NUMBER_SEQUENCE_KEY = "office_inventory_receipt";

async function getReceiptNumberConfig(organizationId: number): Promise<ReceiptNumberFormatConfig> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  return (config.data.receiptNumber as ReceiptNumberFormatConfig | undefined) ?? { prefix: "RCV", sequenceLength: 5 };
}

async function generateReceiptReference(organizationId: number): Promise<string> {
  const config = await getReceiptNumberConfig(organizationId);
  const periodKey = resolvePeriodKey(config.resetPolicy, new Date());
  const sequenceValue = await lockAndIncrementSequence({
    organizationId,
    sequenceKey: RECEIPT_NUMBER_SEQUENCE_KEY,
    periodKey,
    startingSequence: config.startingSequence ?? 1,
  });
  const now = new Date();
  return formatGeneratedNumber(config, sequenceValue, { branchCode: null, departmentCode: null, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
}

export interface ReceiveLineInput {
  itemId: number;
  quantity: string;
  unitCost?: string | null;
}

export interface CreateOfficeInventoryReceiptParams {
  organizationId: number;
  storeId: number;
  lines: ReceiveLineInput[];
  source?: string | null;
  deliveryReference?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export interface OfficeInventoryReceipt {
  referenceNumber: string;
  organizationId: number;
  storeId: number;
  occurredAt: Date;
  lines: OfficeInventoryStockMovement[];
  replay: boolean;
}

function assembleReceipt(rows: OfficeInventoryStockMovement[], replay: boolean): OfficeInventoryReceipt {
  const first = rows[0]!;
  return {
    referenceNumber: first.referenceNumber!,
    organizationId: first.organizationId,
    storeId: first.storeId!,
    occurredAt: rows.reduce((earliest, r) => (r.occurredAt < earliest ? r.occurredAt : earliest), first.occurredAt),
    lines: rows,
    replay,
  };
}

/**
 * Creates one receiving event: N `received` ledger rows sharing one
 * generated reference, committed atomically. Validates the store and every
 * referenced item belong to this organization, and every quantity is a
 * positive numeric(12,2) value, BEFORE opening the transaction or
 * generating a reference number — an obviously-invalid submission never
 * burns a reference value. Receiving is always store-increasing, so the
 * negative-stock guard inside `appendStoreMovement` is structurally never
 * triggered here (proven by its own dedicated unit tests instead, since W2
 * produces no decreasing movement to exercise it against live data).
 */
export async function createOfficeInventoryReceipt(params: CreateOfficeInventoryReceiptParams): Promise<OfficeInventoryReceipt> {
  if (params.lines.length === 0) throw new OfficeInventoryReceivingNoLinesError();

  const [store] = await db
    .select()
    .from(officeInventoryStoresTable)
    .where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();

  for (const line of params.lines) {
    let minor: bigint;
    try {
      minor = toMinorUnits(line.quantity);
    } catch (err) {
      if (err instanceof InvalidMoneyStringError) throw new OfficeInventoryReceivingInvalidQuantityError(line.itemId);
      throw err;
    }
    if (minor <= 0n) throw new OfficeInventoryReceivingInvalidQuantityError(line.itemId);
  }

  const itemIds = [...new Set(params.lines.map((l) => l.itemId))];
  const items = await db
    .select({ id: officeInventoryItemsTable.id })
    .from(officeInventoryItemsTable)
    .where(and(inArray(officeInventoryItemsTable.id, itemIds), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  const foundIds = new Set(items.map((i) => i.id));
  const missingIds = itemIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) throw new OfficeInventoryReceivingItemsNotFoundError(missingIds);

  return db.transaction(async (tx) => {
    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_receipt:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

      const [existing] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(
          and(
            eq(officeInventoryStockMovementsTable.organizationId, params.organizationId),
            eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#0`),
          ),
        );
      if (existing) {
        const rows = await tx
          .select()
          .from(officeInventoryStockMovementsTable)
          .where(
            and(
              eq(officeInventoryStockMovementsTable.organizationId, params.organizationId),
              eq(officeInventoryStockMovementsTable.referenceNumber, existing.referenceNumber!),
            ),
          );
        return assembleReceipt(rows, true);
      }
    }

    const referenceNumber = await generateReceiptReference(params.organizationId);

    const inserted: OfficeInventoryStockMovement[] = [];
    for (let i = 0; i < params.lines.length; i++) {
      const line = params.lines[i]!;
      const row = await appendStoreMovement(tx, {
        organizationId: params.organizationId,
        itemId: line.itemId,
        storeId: params.storeId,
        movementType: "received",
        quantity: line.quantity,
        referenceNumber,
        source: params.source ?? null,
        deliveryReference: params.deliveryReference ?? null,
        unitCost: line.unitCost ?? null,
        idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#${i}` : null,
        actorMembershipId: params.actorMembershipId,
        notes: params.notes ?? null,
      });
      inserted.push(row);
    }

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_receipt.created",
      targetType: "office_inventory_receipt",
      targetId: referenceNumber,
      afterState: {
        referenceNumber,
        storeId: params.storeId,
        lineCount: inserted.length,
        itemIds: inserted.map((r) => r.itemId),
      },
    });

    return assembleReceipt(inserted, false);
  });
}

export async function getOfficeInventoryReceipt(organizationId: number, referenceNumber: string): Promise<OfficeInventoryReceipt> {
  const rows = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.referenceNumber, referenceNumber),
        eq(officeInventoryStockMovementsTable.movementType, "received"),
      ),
    );
  if (rows.length === 0) throw new OfficeInventoryReceiptNotFoundError();
  return assembleReceipt(rows, false);
}

export interface ReceiptSummary {
  referenceNumber: string;
  storeId: number;
  occurredAt: Date;
  lineCount: number;
}

export async function listOfficeInventoryReceipts(organizationId: number): Promise<ReceiptSummary[]> {
  const rows = await db
    .select({
      referenceNumber: officeInventoryStockMovementsTable.referenceNumber,
      storeId: officeInventoryStockMovementsTable.storeId,
      occurredAt: sql<Date>`min(${officeInventoryStockMovementsTable.occurredAt})`,
      lineCount: sql<number>`count(*)::int`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.movementType, "received")))
    .groupBy(officeInventoryStockMovementsTable.referenceNumber, officeInventoryStockMovementsTable.storeId)
    .orderBy(sql`min(${officeInventoryStockMovementsTable.occurredAt}) desc`);

  return rows.map((r) => ({ referenceNumber: r.referenceNumber!, storeId: r.storeId!, occurredAt: r.occurredAt, lineCount: r.lineCount }));
}
