/**
 * Office Inventory, Workstream 4 — Issue, Fulfilment, Confirmation, Direct
 * Issue (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §16, §17, §18, §19,
 * §47, §50). W3's approval authorizes a QUANTITY; this file records what
 * the Store Officer actually RELEASES — a separate event, never
 * conflated. `requested`, `approved`, and `issued` quantities are three
 * permanently distinct facts, never rewritten to match one another.
 *
 * Every fulfilling action appends a PAIRED ledger row (§16): a
 * `storeId`-scoped decrease (`appendStoreMovement`) and a
 * `holderType`/`holderId`-scoped increase (`appendHolderMovement`),
 * sharing one `referenceNumber`. No competing quantity authority exists —
 * `office_inventory_request_lines.quantityIssuedSoFar` is a
 * transactionally-consistent running tally updated in the SAME
 * transaction as the movement pair, never a second source of truth (the
 * frozen plan's own §7.4 disclosure).
 *
 * Direct issue (§17) uses the identical ledger/lock/audit machinery, with
 * `sourceReferenceType` left null (never `'request_line'`) as the
 * historical distinguishing signal from request-based fulfilment — no
 * separate table, no fake approved request is ever synthesized.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  officeInventoryRequestLinesTable,
  officeInventoryRequestsTable,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  employeesTable,
  departmentsTable,
  officeInventoryStockMovementsTable,
  type OfficeInventoryStockMovement,
  type OfficeInventoryRequest,
  type OfficeInventoryRequestLine,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as IssueNumberFormatConfig } from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { toMinorUnits, fromMinorUnits, InvalidMoneyStringError } from "./payrollMoney";
import { appendStoreMovement, appendHolderMovement } from "./officeInventoryLedger";
import { deriveHeaderStatus } from "./officeInventoryRequests";
import { recordAuditEvent } from "./auditLog";

export class OfficeInventoryRequestLineNotFoundError extends Error {
  constructor() {
    super("Request line not found");
  }
}
export class OfficeInventoryLineNotApprovedError extends Error {
  constructor() {
    super("This line has not been approved — nothing may be issued against it");
  }
}
export class OfficeInventoryOverFulfilmentError extends Error {
  constructor(readonly remaining: string, readonly requested: string) {
    super(`Only ${remaining} remains approved and unissued for this line — ${requested} was requested`);
  }
}
export class OfficeInventoryInvalidIssueQuantityError extends Error {
  constructor() {
    super("Issue quantity must be a positive number with at most 2 decimal places");
  }
}
export class OfficeInventoryStoreNotFoundError extends Error {
  constructor() {
    super("Store not found");
  }
}
export class OfficeInventoryItemNotFoundError extends Error {
  constructor() {
    super("Item not found");
  }
}
export class OfficeInventoryHolderNotFoundError extends Error {
  constructor() {
    super("Target employee/department not found for this organization");
  }
}
export class OfficeInventoryExpectedReturnDateNotAllowedError extends Error {
  constructor() {
    super("expectedReturnDate may only be set for a returnable item");
  }
}
export class OfficeInventoryDirectIssueReasonRequiredError extends Error {
  constructor() {
    super("A reason is required for a direct issue");
  }
}
export class OfficeInventoryDirectIssueDisabledError extends Error {
  constructor() {
    super("Direct issue is disabled for this organization");
  }
}
export class OfficeInventoryMovementNotFoundError extends Error {
  constructor() {
    super("Movement not found");
  }
}
export class OfficeInventoryAlreadyConfirmedError extends Error {
  constructor() {
    super("This receipt has already been confirmed");
  }
}
export class OfficeInventoryNotEligibleToConfirmError extends Error {
  constructor() {
    super("You are not the recipient, and not a member (or the original requester) of the receiving department");
  }
}

const ISSUE_NUMBER_SEQUENCE_KEY = "office_inventory_issue";

async function generateIssueReference(organizationId: number): Promise<string> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  const issueNumberConfig = (config.data.issueNumber as IssueNumberFormatConfig | undefined) ?? { prefix: "ISS", sequenceLength: 5 };
  const periodKey = resolvePeriodKey(issueNumberConfig.resetPolicy, new Date());
  const sequenceValue = await lockAndIncrementSequence({
    organizationId,
    sequenceKey: ISSUE_NUMBER_SEQUENCE_KEY,
    periodKey,
    startingSequence: issueNumberConfig.startingSequence ?? 1,
  });
  const now = new Date();
  return formatGeneratedNumber(issueNumberConfig, sequenceValue, { branchCode: null, departmentCode: null, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
}

function validateQuantity(quantity: string): bigint {
  try {
    const minor = toMinorUnits(quantity);
    if (minor <= 0n) throw new OfficeInventoryInvalidIssueQuantityError();
    return minor;
  } catch (err) {
    if (err instanceof InvalidMoneyStringError) throw new OfficeInventoryInvalidIssueQuantityError();
    throw err;
  }
}

/** Both legs of a prior identical submission are found purely by their own derived idempotency keys — no need to correlate via referenceNumber. */
async function existingIdempotentPair(organizationId: number, idempotencyKey: string | undefined | null): Promise<{ storeMovement: OfficeInventoryStockMovement; holderMovement: OfficeInventoryStockMovement } | null> {
  if (!idempotencyKey) return null;
  const [storeMovement] = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${idempotencyKey}#store`)));
  if (!storeMovement) return null;
  const [holderMovement] = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${idempotencyKey}#holder`)));
  return holderMovement ? { storeMovement, holderMovement } : null;
}

// --- Request-based issue ---

export interface IssueAgainstRequestLineParams {
  organizationId: number;
  lineId: number;
  storeId: number;
  quantity: string;
  expectedReturnDate?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export interface IssueResult {
  storeMovement: OfficeInventoryStockMovement;
  holderMovement: OfficeInventoryStockMovement;
  line: OfficeInventoryRequestLine;
  request: OfficeInventoryRequest;
  replay: boolean;
}

export async function issueAgainstRequestLine(params: IssueAgainstRequestLineParams): Promise<IssueResult> {
  const requestedMinor = validateQuantity(params.quantity);

  const [line] = await db
    .select()
    .from(officeInventoryRequestLinesTable)
    .where(and(eq(officeInventoryRequestLinesTable.id, params.lineId), eq(officeInventoryRequestLinesTable.organizationId, params.organizationId)));
  if (!line) throw new OfficeInventoryRequestLineNotFoundError();

  const [request] = await db.select().from(officeInventoryRequestsTable).where(eq(officeInventoryRequestsTable.id, line.requestId));
  const [store] = await db.select().from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();
  const [item] = await db.select().from(officeInventoryItemsTable).where(eq(officeInventoryItemsTable.id, line.itemId));
  if (item.classification === "consumable" && params.expectedReturnDate) throw new OfficeInventoryExpectedReturnDateNotAllowedError();

  const idempotentReplay = await existingIdempotentPair(params.organizationId, params.idempotencyKey);
  if (idempotentReplay) {
    return { ...idempotentReplay, line, request: request!, replay: true };
  }

  const holderType = request!.requestType === "employee" ? "employee" : "department";
  const holderId = request!.requestType === "employee" ? request!.forEmployeeId! : request!.forDepartmentId;

  const { storeMovement, holderMovement, updatedLine, updatedRequest, replay } = await db.transaction(async (tx) => {
    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_issue:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existingStore] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#store`)));
      if (existingStore) {
        const [existingHolder] = await tx
          .select()
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#holder`)));
        const [freshLine] = await tx.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.id, params.lineId));
        const [freshRequest] = await tx.select().from(officeInventoryRequestsTable).where(eq(officeInventoryRequestsTable.id, line.requestId));
        return { storeMovement: existingStore, holderMovement: existingHolder!, updatedLine: freshLine!, updatedRequest: freshRequest!, replay: true };
      }
    }

    const [lockedLine] = await tx.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.id, params.lineId)).for("update");
    if (!lockedLine) throw new OfficeInventoryRequestLineNotFoundError();
    if (lockedLine.approvalStatus !== "approved") throw new OfficeInventoryLineNotApprovedError();

    const approvedMinor = toMinorUnits(lockedLine.approvedQuantity ?? "0");
    const issuedSoFarMinor = toMinorUnits(lockedLine.quantityIssuedSoFar);
    const remainingMinor = approvedMinor - issuedSoFarMinor;
    if (requestedMinor > remainingMinor) {
      throw new OfficeInventoryOverFulfilmentError(fromMinorUnits(remainingMinor), params.quantity);
    }

    const referenceNumber = await generateIssueReference(params.organizationId);

    const storeMovement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: line.itemId,
      storeId: params.storeId,
      movementType: "issued",
      quantity: params.quantity,
      referenceNumber,
      sourceReferenceType: "request_line",
      sourceReferenceId: line.id,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#store` : null,
      actorMembershipId: params.actorMembershipId,
    });

    const holderMovement = await appendHolderMovement(tx, {
      organizationId: params.organizationId,
      itemId: line.itemId,
      holderType,
      holderId: holderId!,
      movementType: "issued",
      quantity: params.quantity,
      referenceNumber,
      sourceReferenceType: "request_line",
      sourceReferenceId: line.id,
      expectedReturnDate: item.classification === "returnable" ? (params.expectedReturnDate ?? null) : null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#holder` : null,
      actorMembershipId: params.actorMembershipId,
    });

    const newIssuedTotal = fromMinorUnits(issuedSoFarMinor + requestedMinor);
    const [updatedLine] = await tx
      .update(officeInventoryRequestLinesTable)
      .set({ quantityIssuedSoFar: newIssuedTotal })
      .where(eq(officeInventoryRequestLinesTable.id, line.id))
      .returning();

    const allLines = await tx.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.requestId, line.requestId));
    const nextStatus = deriveHeaderStatus(allLines);
    const [updatedRequest] = await tx
      .update(officeInventoryRequestsTable)
      .set({ status: nextStatus })
      .where(eq(officeInventoryRequestsTable.id, line.requestId))
      .returning();

    return { storeMovement, holderMovement, updatedLine, updatedRequest, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_request_line.issued",
      targetType: "office_inventory_request_line",
      targetId: String(params.lineId),
      afterState: { quantity: params.quantity, storeId: params.storeId, holderType, holderId, requestStatus: updatedRequest.status },
    });
  }

  return { storeMovement, holderMovement, line: updatedLine, request: updatedRequest, replay };
}

// --- Direct issue ---

export interface DirectIssueParams {
  organizationId: number;
  storeId: number;
  itemId: number;
  quantity: string;
  holderType: "employee" | "department";
  holderId: number;
  reason: string;
  expectedReturnDate?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function directIssue(params: DirectIssueParams): Promise<{ storeMovement: OfficeInventoryStockMovement; holderMovement: OfficeInventoryStockMovement; replay: boolean }> {
  if (!params.reason.trim()) throw new OfficeInventoryDirectIssueReasonRequiredError();
  validateQuantity(params.quantity);

  const config = await getNamespaceConfig(params.organizationId, "office_inventory");
  const directIssueEnabled = (config.data.directIssueEnabled as boolean | undefined) ?? false;
  if (!directIssueEnabled) throw new OfficeInventoryDirectIssueDisabledError();

  const [store] = await db.select().from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();
  const [item] = await db.select().from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();
  if (item.classification === "consumable" && params.expectedReturnDate) throw new OfficeInventoryExpectedReturnDateNotAllowedError();

  if (params.holderType === "employee") {
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(eq(employeesTable.id, params.holderId), eq(employeesTable.organizationId, params.organizationId)));
    if (!employee) throw new OfficeInventoryHolderNotFoundError();
  } else {
    const [department] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(and(eq(departmentsTable.id, params.holderId), eq(departmentsTable.organizationId, params.organizationId)));
    if (!department) throw new OfficeInventoryHolderNotFoundError();
  }

  const idempotentReplay = await existingIdempotentPair(params.organizationId, params.idempotencyKey);
  if (idempotentReplay) return { ...idempotentReplay, replay: true };

  const { storeMovement, holderMovement, replay } = await db.transaction(async (tx) => {
    if (params.idempotencyKey) {
      const lockKey = `${params.organizationId}:idem:office_inventory_direct_issue:${params.idempotencyKey}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const [existingStore] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#store`)));
      if (existingStore) {
        const [existingHolder] = await tx
          .select()
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.referenceNumber, existingStore.referenceNumber!), eq(officeInventoryStockMovementsTable.idempotencyKey, `${params.idempotencyKey}#holder`)));
        return { storeMovement: existingStore, holderMovement: existingHolder!, replay: true };
      }
    }

    const referenceNumber = await generateIssueReference(params.organizationId);

    const storeMovement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      storeId: params.storeId,
      movementType: "issued",
      quantity: params.quantity,
      referenceNumber,
      reason: params.reason,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#store` : null,
      actorMembershipId: params.actorMembershipId,
    });

    const holderMovement = await appendHolderMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      holderType: params.holderType,
      holderId: params.holderId,
      movementType: "issued",
      quantity: params.quantity,
      referenceNumber,
      reason: params.reason,
      expectedReturnDate: item.classification === "returnable" ? (params.expectedReturnDate ?? null) : null,
      idempotencyKey: params.idempotencyKey ? `${params.idempotencyKey}#holder` : null,
      actorMembershipId: params.actorMembershipId,
    });

    return { storeMovement, holderMovement, replay: false };
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_direct_issue.created",
      targetType: "office_inventory_stock_movement",
      targetId: storeMovement.referenceNumber ?? String(storeMovement.id),
      afterState: { itemId: params.itemId, storeId: params.storeId, quantity: params.quantity, holderType: params.holderType, holderId: params.holderId, reason: params.reason },
    });
  }

  return { storeMovement, holderMovement, replay };
}

// --- Receipt confirmation (§18 — non-gating) ---

export interface ConfirmReceiptParams {
  organizationId: number;
  movementId: number;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
  /** The caller's own resolved employee id (via resolveOwnEmployeeId), if any — used for the employee-recipient eligibility check. */
  actorEmployeeId: number | null;
}

export async function confirmReceipt(params: ConfirmReceiptParams): Promise<OfficeInventoryStockMovement> {
  const [movement] = await db
    .select()
    .from(officeInventoryStockMovementsTable)
    .where(
      and(
        eq(officeInventoryStockMovementsTable.id, params.movementId),
        eq(officeInventoryStockMovementsTable.organizationId, params.organizationId),
        eq(officeInventoryStockMovementsTable.movementType, "issued"),
      ),
    );
  if (!movement || movement.holderType === null || movement.holderId === null) throw new OfficeInventoryMovementNotFoundError();
  if (movement.confirmedAt) throw new OfficeInventoryAlreadyConfirmedError();

  const eligible = await isEligibleToConfirm(params.organizationId, movement, params.actorMembershipId, params.actorEmployeeId);
  if (!eligible) throw new OfficeInventoryNotEligibleToConfirmError();

  const [updated] = await db
    .update(officeInventoryStockMovementsTable)
    .set({ confirmedByMembershipId: params.actorMembershipId, confirmedAt: new Date() })
    .where(eq(officeInventoryStockMovementsTable.id, params.movementId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_issue.confirmed",
    targetType: "office_inventory_stock_movement",
    targetId: String(params.movementId),
  });

  return updated;
}

/**
 * §18: confirmed by the recipient employee, or — for department custody —
 * the original requester (via the request behind `sourceReferenceType=
 * 'request_line'`, when traceable) or any membership scoped to that
 * department (an employee whose own current department matches the
 * holder). A direct issue has no request to trace a requester from, so
 * department confirmation there relies on department membership alone.
 */
async function isEligibleToConfirm(organizationId: number, movement: OfficeInventoryStockMovement, actorMembershipId: number, actorEmployeeId: number | null): Promise<boolean> {
  if (movement.holderType === "employee") {
    return actorEmployeeId !== null && actorEmployeeId === movement.holderId;
  }

  // department custody
  if (movement.sourceReferenceType === "request_line" && movement.sourceReferenceId !== null) {
    const [line] = await db.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.id, movement.sourceReferenceId));
    if (line) {
      const [request] = await db.select().from(officeInventoryRequestsTable).where(eq(officeInventoryRequestsTable.id, line.requestId));
      if (request?.requestedByMembershipId === actorMembershipId) return true;
    }
  }
  if (actorEmployeeId !== null) {
    const [employee] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(and(eq(employeesTable.id, actorEmployeeId), eq(employeesTable.organizationId, organizationId)));
    if (employee && employee.departmentId === movement.holderId) return true;
  }
  return false;
}

// --- Store Officer queue ---

export interface AwaitingFulfilmentEntry {
  request: OfficeInventoryRequest;
  lines: OfficeInventoryRequestLine[];
}

/**
 * Every request org-wide with at least one approved-but-not-fully-issued
 * line — the Store Officer's own operational queue (§35), independent of
 * departmental approval authority (`office_inventory.issue` alone gates
 * this, never a Head/delegate relationship check — a Store Officer is not
 * expected to be Head of every department whose stock they issue).
 */
export async function listRequestsAwaitingFulfilment(organizationId: number): Promise<AwaitingFulfilmentEntry[]> {
  const requests = await db
    .select()
    .from(officeInventoryRequestsTable)
    .where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), inArray(officeInventoryRequestsTable.status, ["approved", "partially_approved", "partially_fulfilled"])))
    .orderBy(officeInventoryRequestsTable.submittedAt);

  const entries: AwaitingFulfilmentEntry[] = [];
  for (const request of requests) {
    const lines = await db.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.requestId, request.id));
    const hasIssuableLine = lines.some((l) => l.approvalStatus === "approved" && toMinorUnits(l.quantityIssuedSoFar) < toMinorUnits(l.approvedQuantity ?? "0"));
    if (hasIssuableLine) entries.push({ request, lines });
  }
  return entries;
}
