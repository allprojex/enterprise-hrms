/**
 * Office Inventory, Workstream 5 — Returns, Handovers, Store Transfers
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §19-§23, §32, §47, §50).
 * Extends Workstream 4's own "current holder must change only through a
 * recorded authoritative movement" rule to the three post-issue custody
 * events this workstream owns. No `office_inventory_stock_movements` row
 * is ever edited or deleted by this file, matching every prior workstream.
 *
 * RETURN: a `returned` ledger row pair — holder-side decrease (via the
 * ledger's own `HOLDER_DECREASING_TYPES`, extended by this workstream),
 * store-side increase (via the existing, unchanged `STORE_INCREASING_TYPES`
 * rule from Workstream 2) — sharing one referenceNumber.
 *
 * HANDOVER: represented, per the frozen plan's own §7.3/§22 text, as a
 * paired `issued`/`returned`-style movement between two HOLDERS — no new
 * movementType enum value exists or is needed. The destination side is an
 * ordinary holder-increasing `issued` row (reusing Workstream 4's own
 * direction rule byte-for-byte); the source side is an ordinary
 * holder-decreasing `returned` row (this workstream's own new direction
 * rule). No store is ever touched by a handover.
 *
 * Department-to-department handover authority (Owner Decision 17, the
 * single most load-bearing rule this file owns): gated by the RECEIVING
 * department's current Head (or their currently-valid delegate) —
 * resolved via the exact same `resolveApprovalAuthority` primitive
 * Workstream 3 already proved for ordinary department-request approval,
 * not a second, separately invented authority mechanism. Since the frozen
 * 11-table schema has no "pending handover" table, this is implemented as
 * a single-step, immediate action (mirroring §14's own Department Head
 * self-approval precedent) rather than an INITIATED->ACCEPTED stateful
 * object: the acting membership must themselves resolve as the receiving
 * department's Head/delegate at the moment of the call, or the whole
 * action is rejected — never a separate pending row. This is a disclosed
 * interpretation of Decision 17's own "gated... approving the incoming
 * quantity" language, recorded here and in PROJECT_STATUS.md.
 *
 * TRANSFER: a paired `transferred_out` (source store decrease) /
 * `transferred_in` (destination store increase) row — both movement types
 * already existed in Workstream 2's own store direction table (unused
 * until now), so no direction-table change was needed for transfers at
 * all, only the actual code path that produces them.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryStockMovementsTable,
  employeesTable,
  departmentsTable,
  type OfficeInventoryStockMovement,
} from "@workspace/db";
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as NumberFormatConfig } from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { toMinorUnits, InvalidMoneyStringError } from "./payrollMoney";
import {
  appendStoreMovement,
  appendHolderMovement,
  getHolderBalance,
  acquireStoreThenHolderLock,
  acquireOrderedHolderLocks,
  acquireOrderedStoreLocks,
} from "./officeInventoryLedger";
import { resolveApprovalAuthority } from "./officeInventoryDelegations";
import { recordAuditEvent } from "./auditLog";
import {
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryHolderNotFoundError,
  OfficeInventoryExpectedReturnDateNotAllowedError,
} from "./officeInventoryIssuing";

export { OfficeInventoryStoreNotFoundError, OfficeInventoryItemNotFoundError, OfficeInventoryHolderNotFoundError, OfficeInventoryExpectedReturnDateNotAllowedError };

export class OfficeInventoryInvalidQuantityError extends Error {
  constructor() {
    super("Quantity must be a positive number with at most 2 decimal places");
  }
}
export class OfficeInventoryConsumableNotEligibleError extends Error {
  constructor(action: "return" | "handover") {
    super(`A consumable item cannot be ${action === "return" ? "returned" : "handed over"} — issuing a consumable is itself its consumption (Owner Decision 10), never a reversible or transferable event`);
  }
}
export class OfficeInventorySameHolderError extends Error {
  constructor() {
    super("A handover's source and destination holder must be different");
  }
}
export class OfficeInventorySameStoreError extends Error {
  constructor() {
    super("A transfer's source and destination store must be different");
  }
}
export class OfficeInventoryDepartmentHandoverAuthorityError extends Error {
  constructor() {
    super("A department-to-department handover must be authorized by the RECEIVING department's current Head or a currently-valid delegate (Owner Decision 17)");
  }
}

const RETURN_NUMBER_SEQUENCE_KEY = "office_inventory_return";
const HANDOVER_NUMBER_SEQUENCE_KEY = "office_inventory_handover";
const TRANSFER_NUMBER_SEQUENCE_KEY = "office_inventory_transfer";

async function generateReference(organizationId: number, sequenceKey: string, configField: "returnNumber" | "handoverNumber" | "transferNumber", fallbackPrefix: string): Promise<string> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  const numberConfig = (config.data[configField] as NumberFormatConfig | undefined) ?? { prefix: fallbackPrefix, sequenceLength: 5 };
  const periodKey = resolvePeriodKey(numberConfig.resetPolicy, new Date());
  const sequenceValue = await lockAndIncrementSequence({
    organizationId,
    sequenceKey,
    periodKey,
    startingSequence: numberConfig.startingSequence ?? 1,
  });
  const now = new Date();
  return formatGeneratedNumber(numberConfig, sequenceValue, { branchCode: null, departmentCode: null, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
}

function validateQuantity(quantity: string): void {
  try {
    const minor = toMinorUnits(quantity);
    if (minor <= 0n) throw new OfficeInventoryInvalidQuantityError();
  } catch (err) {
    if (err instanceof InvalidMoneyStringError) throw new OfficeInventoryInvalidQuantityError();
    throw err;
  }
}

async function loadReturnableItem(organizationId: number, itemId: number, action: "return" | "handover"): Promise<{ id: number; classification: "consumable" | "returnable" }> {
  const [item] = await db.select().from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, itemId), eq(officeInventoryItemsTable.organizationId, organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();
  if (item.classification === "consumable") throw new OfficeInventoryConsumableNotEligibleError(action);
  return item;
}

async function assertHolderExists(organizationId: number, holderType: "employee" | "department", holderId: number): Promise<void> {
  if (holderType === "employee") {
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(eq(employeesTable.id, holderId), eq(employeesTable.organizationId, organizationId)));
    if (!employee) throw new OfficeInventoryHolderNotFoundError();
  } else {
    const [department] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(and(eq(departmentsTable.id, holderId), eq(departmentsTable.organizationId, organizationId)));
    if (!department) throw new OfficeInventoryHolderNotFoundError();
  }
}

/** Both legs of a prior identical submission, found purely by their own derived idempotency-key suffix — mirrors Workstream 4's own `existingIdempotentPair` exactly. */
async function existingIdempotentPair(organizationId: number, idempotencyKey: string | undefined | null): Promise<{ first: OfficeInventoryStockMovement; second: OfficeInventoryStockMovement } | null> {
  if (!idempotencyKey) return null;
  const [first] = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${idempotencyKey}#first`)));
  if (!first) return null;
  const [second] = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${idempotencyKey}#second`)));
  return second ? { first, second } : null;
}

// --- Returns (§21) ---

export interface ReturnFromHolderParams {
  organizationId: number;
  itemId: number;
  holderType: "employee" | "department";
  holderId: number;
  destinationStoreId: number;
  quantity: string;
  condition?: "new" | "good" | "fair" | "poor" | "damaged" | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export interface ReturnResult {
  storeMovement: OfficeInventoryStockMovement;
  holderMovement: OfficeInventoryStockMovement;
  replay: boolean;
}

export async function returnFromHolder(params: ReturnFromHolderParams): Promise<ReturnResult> {
  validateQuantity(params.quantity);
  await loadReturnableItem(params.organizationId, params.itemId, "return");

  const [store] = await db.select().from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.destinationStoreId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();
  await assertHolderExists(params.organizationId, params.holderType, params.holderId);

  const preCheckReplay = await existingIdempotentPair(params.organizationId, params.idempotencyKey);
  if (preCheckReplay) return { storeMovement: preCheckReplay.first, holderMovement: preCheckReplay.second, replay: true };

  const { storeMovement, holderMovement, replay } = await db.transaction(async (tx) => {
    await acquireStoreThenHolderLock(tx, params.organizationId, params.itemId, params.destinationStoreId, params.holderType, params.holderId);

    if (params.idempotencyKey) {
      const [existingFirst] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#first`)));
      if (existingFirst) {
        const [existingSecond] = await tx
          .select()
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#second`)));
        return { storeMovement: existingFirst, holderMovement: existingSecond!, replay: true };
      }
    }

    const referenceNumber = await generateReference(params.organizationId, RETURN_NUMBER_SEQUENCE_KEY, "returnNumber", "RET");

    // Store-side append FIRST (an increase, no balance check needed) so the
    // lock acquisition order inside this transaction is store-then-holder —
    // identical to Workstream 4's issue functions — even though the
    // holder-side decrease is the logically "first" half of a return.
    const storeMovement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      storeId: params.destinationStoreId,
      movementType: "returned",
      quantity: params.quantity,
      referenceNumber,
      notes: params.notes ?? null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#first` : null,
      actorMembershipId: params.actorMembershipId,
    });

    const holderMovement = await appendHolderMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      holderType: params.holderType,
      holderId: params.holderId,
      movementType: "returned",
      quantity: params.quantity,
      referenceNumber,
      condition: params.condition ?? null,
      notes: params.notes ?? null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#second` : null,
      actorMembershipId: params.actorMembershipId,
    });

    return { storeMovement, holderMovement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_return.created",
      targetType: "office_inventory_stock_movement",
      targetId: storeMovement.referenceNumber ?? String(storeMovement.id),
      afterState: { itemId: params.itemId, holderType: params.holderType, holderId: params.holderId, destinationStoreId: params.destinationStoreId, quantity: params.quantity },
    });
  }

  return { storeMovement, holderMovement, replay };
}

// --- Handovers (§22, Owner Decision 17) ---

export interface HandoverParams {
  organizationId: number;
  itemId: number;
  fromHolderType: "employee" | "department";
  fromHolderId: number;
  toHolderType: "employee" | "department";
  toHolderId: number;
  quantity: string;
  reason?: string | null;
  condition?: "new" | "good" | "fair" | "poor" | "damaged" | null;
  expectedReturnDate?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export interface HandoverResult {
  sourceMovement: OfficeInventoryStockMovement;
  destinationMovement: OfficeInventoryStockMovement;
  replay: boolean;
}

export async function handover(params: HandoverParams): Promise<HandoverResult> {
  validateQuantity(params.quantity);
  if (params.fromHolderType === params.toHolderType && params.fromHolderId === params.toHolderId) throw new OfficeInventorySameHolderError();

  const item = await loadReturnableItem(params.organizationId, params.itemId, "handover");
  if (item.classification === "consumable" && params.expectedReturnDate) throw new OfficeInventoryExpectedReturnDateNotAllowedError();

  await assertHolderExists(params.organizationId, params.fromHolderType, params.fromHolderId);
  await assertHolderExists(params.organizationId, params.toHolderType, params.toHolderId);

  // Owner Decision 17 — department-to-department handovers are gated by
  // the RECEIVING department's current Head or a currently-valid delegate.
  // Checked before any lock is acquired or any row is written.
  if (params.fromHolderType === "department" && params.toHolderType === "department") {
    if (params.actorMembershipId === null) throw new OfficeInventoryDepartmentHandoverAuthorityError();
    const authority = await resolveApprovalAuthority(params.organizationId, params.toHolderId, params.actorMembershipId);
    if (!authority) throw new OfficeInventoryDepartmentHandoverAuthorityError();
  }

  const preCheckReplay = await existingIdempotentPair(params.organizationId, params.idempotencyKey);
  if (preCheckReplay) return { sourceMovement: preCheckReplay.first, destinationMovement: preCheckReplay.second, replay: true };

  const { sourceMovement, destinationMovement, replay } = await db.transaction(async (tx) => {
    await acquireOrderedHolderLocks(tx, params.organizationId, params.itemId, params.fromHolderType, params.fromHolderId, params.toHolderType, params.toHolderId);

    if (params.idempotencyKey) {
      const [existingFirst] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#first`)));
      if (existingFirst) {
        const [existingSecond] = await tx
          .select()
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#second`)));
        return { sourceMovement: existingFirst, destinationMovement: existingSecond!, replay: true };
      }
    }

    const referenceNumber = await generateReference(params.organizationId, HANDOVER_NUMBER_SEQUENCE_KEY, "handoverNumber", "HAN");

    // Source-side decrease first — this is the leg that needs the current
    // custody re-validated, so failing fast here (rather than after an
    // unnecessary destination insert) is both correct and cheaper.
    const sourceMovement = await appendHolderMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      holderType: params.fromHolderType,
      holderId: params.fromHolderId,
      movementType: "returned",
      quantity: params.quantity,
      referenceNumber,
      reason: params.reason ?? null,
      condition: params.condition ?? null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#first` : null,
      actorMembershipId: params.actorMembershipId,
    });

    const destinationMovement = await appendHolderMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      holderType: params.toHolderType,
      holderId: params.toHolderId,
      movementType: "issued",
      quantity: params.quantity,
      referenceNumber,
      reason: params.reason ?? null,
      expectedReturnDate: item.classification === "returnable" ? (params.expectedReturnDate ?? null) : null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#second` : null,
      actorMembershipId: params.actorMembershipId,
    });

    return { sourceMovement, destinationMovement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_handover.created",
      targetType: "office_inventory_stock_movement",
      targetId: sourceMovement.referenceNumber ?? String(sourceMovement.id),
      afterState: {
        itemId: params.itemId,
        fromHolderType: params.fromHolderType,
        fromHolderId: params.fromHolderId,
        toHolderType: params.toHolderType,
        toHolderId: params.toHolderId,
        quantity: params.quantity,
      },
    });
  }

  return { sourceMovement, destinationMovement, replay };
}

// --- Store transfers (§23) ---

export interface StoreTransferParams {
  organizationId: number;
  itemId: number;
  fromStoreId: number;
  toStoreId: number;
  quantity: string;
  notes?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export interface StoreTransferResult {
  outMovement: OfficeInventoryStockMovement;
  inMovement: OfficeInventoryStockMovement;
  replay: boolean;
}

export async function transferBetweenStores(params: StoreTransferParams): Promise<StoreTransferResult> {
  validateQuantity(params.quantity);
  if (params.fromStoreId === params.toStoreId) throw new OfficeInventorySameStoreError();

  const [item] = await db.select({ id: officeInventoryItemsTable.id }).from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();
  const [fromStore] = await db.select({ id: officeInventoryStoresTable.id }).from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.fromStoreId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!fromStore) throw new OfficeInventoryStoreNotFoundError();
  const [toStore] = await db.select({ id: officeInventoryStoresTable.id }).from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.toStoreId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!toStore) throw new OfficeInventoryStoreNotFoundError();

  const preCheckReplay = await existingIdempotentPair(params.organizationId, params.idempotencyKey);
  if (preCheckReplay) return { outMovement: preCheckReplay.first, inMovement: preCheckReplay.second, replay: true };

  const { outMovement, inMovement, replay } = await db.transaction(async (tx) => {
    await acquireOrderedStoreLocks(tx, params.organizationId, params.itemId, params.fromStoreId, params.toStoreId);

    if (params.idempotencyKey) {
      const [existingFirst] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#first`)));
      if (existingFirst) {
        const [existingSecond] = await tx
          .select()
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#second`)));
        return { outMovement: existingFirst, inMovement: existingSecond!, replay: true };
      }
    }

    const referenceNumber = await generateReference(params.organizationId, TRANSFER_NUMBER_SEQUENCE_KEY, "transferNumber", "TRF");

    const outMovement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      storeId: params.fromStoreId,
      movementType: "transferred_out",
      quantity: params.quantity,
      referenceNumber,
      notes: params.notes ?? null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#first` : null,
      actorMembershipId: params.actorMembershipId,
    });

    const inMovement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      storeId: params.toStoreId,
      movementType: "transferred_in",
      quantity: params.quantity,
      referenceNumber,
      notes: params.notes ?? null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#second` : null,
      actorMembershipId: params.actorMembershipId,
    });

    return { outMovement, inMovement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_transfer.created",
      targetType: "office_inventory_stock_movement",
      targetId: outMovement.referenceNumber ?? String(outMovement.id),
      afterState: { itemId: params.itemId, fromStoreId: params.fromStoreId, toStoreId: params.toStoreId, quantity: params.quantity },
    });
  }

  return { outMovement, inMovement, replay };
}

export async function getOutstandingBalance(organizationId: number, itemId: number, holderType: "employee" | "department", holderId: number): Promise<string> {
  return getHolderBalance(organizationId, itemId, holderType, holderId);
}
