/**
 * Office Inventory, Workstream 6 — quantity-affecting disposition actions:
 * mark missing, recover, write off (direct and incident-linked), store
 * adjustment (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §13, §25, §26,
 * §27, §47, §50). Every action here is the ONLY place its own movement
 * type is ever produced — there is no generic ledger-write API anywhere in
 * this codebase (§20 of this workstream's own instructions).
 *
 * MARK MISSING: a holder-decreasing `missing` row, referencing an open
 * incident. Reporting an incident (officeInventoryIncidents.ts) has ZERO
 * ledger effect on its own — this is the SEPARATE, deliberate action that
 * actually removes the quantity from the holder's live custody (§25).
 *
 * RECOVER: a store-increasing `recovered` row, referencing the SAME
 * incident, validated against that incident's own derived "outstanding
 * missing" tally (SUM of missing rows minus SUM of recovered/written-off
 * rows already referencing it) — never against the holder's own balance,
 * since the quantity already left holder custody the moment it was marked
 * missing. A found item re-enters a STORE, never silently back into the
 * original holder's own custody (which would need a fresh issue).
 *
 * WRITE OFF (incident-linked): closes out an incident's own already-missing
 * quantity — an UNSCOPED ledger row (no store, no holder; see
 * `appendUnscopedMovement`'s own header), since there is no live balance
 * left anywhere to decrement a second time.
 *
 * WRITE OFF (direct): a DIRECT, single-actor authoritative disposition of
 * quantity still nominally accountable somewhere (a store OR a holder) —
 * completely independent of any incident, though one may optionally be
 * referenced purely for traceability.
 *
 * ADJUSTMENT: STORE ONLY, by design (§17's own explicit boundary) — an
 * employee/department custody discrepancy is never resolved by adjustment,
 * only by return/handover/incident/write-off. This file's own adjustment
 * function structurally cannot target a holder at all (its params shape
 * has no holder fields), rather than accepting one and rejecting it.
 */
import { and, eq } from "drizzle-orm";
import { db, officeInventoryItemsTable, officeInventoryStoresTable, officeInventoryStockMovementsTable, employeesTable, departmentsTable, type OfficeInventoryStockMovement } from "@workspace/db";
import { sql } from "drizzle-orm";
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as NumberFormatConfig } from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { toMinorUnits, InvalidMoneyStringError } from "./payrollMoney";
import { appendStoreMovement, appendHolderMovement, appendUnscopedMovement, acquireIncidentLock, getOutstandingMissingForIncident } from "./officeInventoryLedger";
import { getIncident, OfficeInventoryIncidentNotFoundError } from "./officeInventoryIncidents";
import { recordAuditEvent } from "./auditLog";
import { OfficeInventoryStoreNotFoundError, OfficeInventoryItemNotFoundError, OfficeInventoryHolderNotFoundError } from "./officeInventoryIssuing";

export { OfficeInventoryStoreNotFoundError, OfficeInventoryItemNotFoundError, OfficeInventoryHolderNotFoundError, OfficeInventoryIncidentNotFoundError };

export class OfficeInventoryInvalidQuantityError extends Error {
  constructor() {
    super("Quantity must be a positive number with at most 2 decimal places");
  }
}
export class OfficeInventoryReasonRequiredError extends Error {
  constructor() {
    super("A reason is required for this action");
  }
}
export class OfficeInventoryIncidentNotOpenError extends Error {
  constructor() {
    super("This incident is not open");
  }
}
export class OfficeInventoryOverRecoveryError extends Error {
  constructor(readonly outstanding: string, readonly requested: string) {
    super(`Only ${outstanding} remains outstanding-missing on this incident — ${requested} was requested`);
  }
}

const WRITEOFF_NUMBER_SEQUENCE_KEY = "office_inventory_writeoff";
const ADJUSTMENT_NUMBER_SEQUENCE_KEY = "office_inventory_adjustment";

async function generateReference(organizationId: number, sequenceKey: string, configField: "writeoffNumber" | "adjustmentNumber", fallbackPrefix: string): Promise<string> {
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

async function existingByIdempotencyKey(organizationId: number, idempotencyKey: string | undefined | null): Promise<OfficeInventoryStockMovement | null> {
  if (!idempotencyKey) return null;
  const [existing] = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, idempotencyKey)));
  return existing ?? null;
}

// --- Mark missing ---

export interface MarkIncidentMissingParams {
  organizationId: number;
  incidentId: number;
  quantity: string;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function markIncidentMissing(params: MarkIncidentMissingParams): Promise<{ movement: OfficeInventoryStockMovement; replay: boolean }> {
  validateQuantity(params.quantity);
  const incident = await getIncident(params.organizationId, params.incidentId);
  if (!incident) throw new OfficeInventoryIncidentNotFoundError();
  if (incident.status !== "open") throw new OfficeInventoryIncidentNotOpenError();
  if (incident.holderType === null || incident.holderId === null) throw new OfficeInventoryHolderNotFoundError();

  const preCheck = await existingByIdempotencyKey(params.organizationId, params.idempotencyKey);
  if (preCheck) return { movement: preCheck, replay: true };

  const { movement, replay } = await db.transaction(async (tx) => {
    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_missing:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
      if (existing) return { movement: existing, replay: true };
    }

    const movement = await appendHolderMovement(tx, {
      organizationId: params.organizationId,
      itemId: incident.itemId,
      holderType: incident.holderType!,
      holderId: incident.holderId!,
      movementType: "missing",
      quantity: params.quantity,
      sourceReferenceType: "incident",
      sourceReferenceId: incident.id,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
    });

    return { movement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_incident.marked_missing",
      targetType: "office_inventory_stock_movement",
      targetId: String(movement.id),
      afterState: { incidentId: incident.id, itemId: incident.itemId, holderType: incident.holderType, holderId: incident.holderId, quantity: params.quantity },
    });
  }

  return { movement, replay };
}

// --- Recover ---

export interface RecoverFromIncidentParams {
  organizationId: number;
  incidentId: number;
  quantity: string;
  destinationStoreId: number;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function recoverFromIncident(params: RecoverFromIncidentParams): Promise<{ movement: OfficeInventoryStockMovement; replay: boolean }> {
  validateQuantity(params.quantity);
  const incident = await getIncident(params.organizationId, params.incidentId);
  if (!incident) throw new OfficeInventoryIncidentNotFoundError();
  const [store] = await db.select({ id: officeInventoryStoresTable.id }).from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.destinationStoreId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();

  const preCheck = await existingByIdempotencyKey(params.organizationId, params.idempotencyKey);
  if (preCheck) return { movement: preCheck, replay: true };

  const { movement, replay } = await db.transaction(async (tx) => {
    await acquireIncidentLock(tx, params.organizationId, params.incidentId);

    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_recovery:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
      if (existing) return { movement: existing, replay: true };
    }

    const outstanding = await getOutstandingMissingForIncident(tx, params.organizationId, params.incidentId);
    const outstandingMinor = toMinorUnits(outstanding);
    const requestedMinor = toMinorUnits(params.quantity);
    if (requestedMinor > outstandingMinor) throw new OfficeInventoryOverRecoveryError(outstanding, params.quantity);

    const movement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: incident.itemId,
      storeId: params.destinationStoreId,
      movementType: "recovered",
      quantity: params.quantity,
      sourceReferenceType: "incident",
      sourceReferenceId: incident.id,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
    });

    return { movement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_incident.recovered",
      targetType: "office_inventory_stock_movement",
      targetId: String(movement.id),
      afterState: { incidentId: incident.id, itemId: incident.itemId, destinationStoreId: params.destinationStoreId, quantity: params.quantity },
    });
  }

  return { movement, replay };
}

// --- Write off, incident-linked (closes out already-missing quantity) ---

export interface WriteOffFromIncidentParams {
  organizationId: number;
  incidentId: number;
  quantity: string;
  reason: string;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function writeOffFromIncident(params: WriteOffFromIncidentParams): Promise<{ movement: OfficeInventoryStockMovement; replay: boolean }> {
  if (!params.reason.trim()) throw new OfficeInventoryReasonRequiredError();
  validateQuantity(params.quantity);
  const incident = await getIncident(params.organizationId, params.incidentId);
  if (!incident) throw new OfficeInventoryIncidentNotFoundError();

  const preCheck = await existingByIdempotencyKey(params.organizationId, params.idempotencyKey);
  if (preCheck) return { movement: preCheck, replay: true };

  const { movement, replay } = await db.transaction(async (tx) => {
    await acquireIncidentLock(tx, params.organizationId, params.incidentId);

    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_writeoff_incident:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
      if (existing) return { movement: existing, replay: true };
    }

    const outstanding = await getOutstandingMissingForIncident(tx, params.organizationId, params.incidentId);
    const outstandingMinor = toMinorUnits(outstanding);
    const requestedMinor = toMinorUnits(params.quantity);
    if (requestedMinor > outstandingMinor) throw new OfficeInventoryOverRecoveryError(outstanding, params.quantity);

    const movement = await appendUnscopedMovement(tx, {
      organizationId: params.organizationId,
      itemId: incident.itemId,
      movementType: "written_off",
      quantity: params.quantity,
      reason: params.reason,
      sourceReferenceType: "incident",
      sourceReferenceId: incident.id,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
    });

    return { movement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_writeoff.created",
      targetType: "office_inventory_stock_movement",
      targetId: String(movement.id),
      afterState: { incidentId: incident.id, itemId: incident.itemId, quantity: params.quantity, reason: params.reason },
    });
  }

  return { movement, replay };
}

// --- Write off, direct (store or holder) ---

export type WriteOffSource = { type: "store"; storeId: number } | { type: "employee"; holderId: number } | { type: "department"; holderId: number };

export interface WriteOffParams {
  organizationId: number;
  itemId: number;
  source: WriteOffSource;
  quantity: string;
  reason: string;
  incidentId?: number | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function writeOff(params: WriteOffParams): Promise<{ movement: OfficeInventoryStockMovement; replay: boolean }> {
  if (!params.reason.trim()) throw new OfficeInventoryReasonRequiredError();
  validateQuantity(params.quantity);

  const [item] = await db.select({ id: officeInventoryItemsTable.id }).from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();

  if (params.source.type === "store") {
    const [store] = await db.select({ id: officeInventoryStoresTable.id }).from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.source.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
    if (!store) throw new OfficeInventoryStoreNotFoundError();
  } else if (params.source.type === "employee") {
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(eq(employeesTable.id, params.source.holderId), eq(employeesTable.organizationId, params.organizationId)));
    if (!employee) throw new OfficeInventoryHolderNotFoundError();
  } else {
    const [department] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(and(eq(departmentsTable.id, params.source.holderId), eq(departmentsTable.organizationId, params.organizationId)));
    if (!department) throw new OfficeInventoryHolderNotFoundError();
  }

  if (params.incidentId != null) {
    const incident = await getIncident(params.organizationId, params.incidentId);
    if (!incident) throw new OfficeInventoryIncidentNotFoundError();
  }

  const preCheck = await existingByIdempotencyKey(params.organizationId, params.idempotencyKey);
  if (preCheck) return { movement: preCheck, replay: true };

  const { movement, replay } = await db.transaction(async (tx) => {
    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_writeoff:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
      if (existing) return { movement: existing, replay: true };
    }

    const referenceNumber = await generateReference(params.organizationId, WRITEOFF_NUMBER_SEQUENCE_KEY, "writeoffNumber", "WOF");

    const movement =
      params.source.type === "store"
        ? await appendStoreMovement(tx, {
            organizationId: params.organizationId,
            itemId: params.itemId,
            storeId: params.source.storeId,
            movementType: "written_off",
            quantity: params.quantity,
            referenceNumber,
            reason: params.reason,
            sourceReferenceType: params.incidentId != null ? "incident" : undefined,
            sourceReferenceId: params.incidentId ?? undefined,
            idempotencyKey: params.idempotencyKey ?? null,
            actorMembershipId: params.actorMembershipId,
          })
        : await appendHolderMovement(tx, {
            organizationId: params.organizationId,
            itemId: params.itemId,
            holderType: params.source.type,
            holderId: params.source.holderId,
            movementType: "written_off",
            quantity: params.quantity,
            referenceNumber,
            reason: params.reason,
            sourceReferenceType: params.incidentId != null ? "incident" : undefined,
            sourceReferenceId: params.incidentId ?? undefined,
            idempotencyKey: params.idempotencyKey ?? null,
            actorMembershipId: params.actorMembershipId,
          });

    return { movement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_writeoff.created",
      targetType: "office_inventory_stock_movement",
      targetId: movement.referenceNumber ?? String(movement.id),
      afterState: { itemId: params.itemId, source: params.source, quantity: params.quantity, reason: params.reason, incidentId: params.incidentId ?? null },
    });
  }

  return { movement, replay };
}

// --- Adjustment (store only) ---

export interface AdjustStoreParams {
  organizationId: number;
  storeId: number;
  itemId: number;
  direction: "in" | "out";
  quantity: string;
  reason: string;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function adjustStore(params: AdjustStoreParams): Promise<{ movement: OfficeInventoryStockMovement; replay: boolean }> {
  if (!params.reason.trim()) throw new OfficeInventoryReasonRequiredError();
  validateQuantity(params.quantity);

  const [item] = await db.select({ id: officeInventoryItemsTable.id }).from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();
  const [store] = await db.select({ id: officeInventoryStoresTable.id }).from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();

  const preCheck = await existingByIdempotencyKey(params.organizationId, params.idempotencyKey);
  if (preCheck) return { movement: preCheck, replay: true };

  const { movement, replay } = await db.transaction(async (tx) => {
    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_adjustment:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existing] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
      if (existing) return { movement: existing, replay: true };
    }

    const referenceNumber = await generateReference(params.organizationId, ADJUSTMENT_NUMBER_SEQUENCE_KEY, "adjustmentNumber", "ADJ");

    const movement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      storeId: params.storeId,
      movementType: params.direction === "in" ? "adjustment_in" : "adjustment_out",
      quantity: params.quantity,
      referenceNumber,
      reason: params.reason,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
    });

    return { movement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_adjustment.created",
      targetType: "office_inventory_stock_movement",
      targetId: movement.referenceNumber ?? String(movement.id),
      afterState: { itemId: params.itemId, storeId: params.storeId, direction: params.direction, quantity: params.quantity, reason: params.reason },
    });
  }

  return { movement, replay };
}
