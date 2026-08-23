/**
 * Office Inventory, Workstream 3 — Requests & Department Approval
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.4, §10, §11, §14, §15,
 * §47). Employee and department requests, per-line approval decisions, and
 * the repeat-request accountability warning. Approval NEVER appends a
 * ledger movement — `office_inventory_stock_movements` is untouched by
 * every function in this file, proven by an architectural regression test
 * (this file imports nothing from officeInventoryLedger.ts/
 * officeInventoryReceiving.ts). Only Workstream 4's own Issue/Fulfilment
 * action ever appends a movement, later, against an already-approved line.
 *
 * HEADER STATUS DERIVATION (a designed rule, not explicitly spelled out in
 * the frozen plan's own prose — disclosed here): recomputed from the lines'
 * own `approvalStatus` values after every decision, inside the same
 * transaction as that decision:
 *   - no line decided yet                          -> "pending"
 *   - every line "approved"                        -> "approved"
 *   - every line "rejected"                        -> "rejected"
 *   - a mix (some approved and/or rejected and/or
 *     still pending, but not all one outcome)       -> "partially_approved"
 * "fulfilled"/"partially_fulfilled" are never set here — they belong to
 * Workstream 4.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  departmentsTable,
  employeesTable,
  officeInventoryItemsTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  type OfficeInventoryRequest,
  type OfficeInventoryRequestLine,
} from "@workspace/db";
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as RequestNumberFormatConfig } from "./numbering";
import { getNamespaceConfig } from "../services/organizationConfig";
import { toMinorUnits, InvalidMoneyStringError } from "./payrollMoney";
import { resolveApprovalAuthority } from "./officeInventoryDelegations";
import { recordAuditEvent } from "./auditLog";

export class OfficeInventoryEmployeeHasNoDepartmentError extends Error {
  constructor() {
    super("This employee has no current department on file — a request cannot be created without one");
  }
}
export class OfficeInventoryDepartmentNotFoundError extends Error {
  constructor() {
    super("Department not found");
  }
}
export class OfficeInventoryRequesterNotInDepartmentError extends Error {
  constructor() {
    super("A department request may only be submitted by an employee of that department");
  }
}
export class OfficeInventoryRequestNoLinesError extends Error {
  constructor() {
    super("A request must include at least one line");
  }
}
export class OfficeInventoryRequestInvalidQuantityError extends Error {
  constructor(readonly itemId: number) {
    super(`Item ${itemId}: requested quantity must be a positive number with at most 2 decimal places`);
  }
}
export class OfficeInventoryRequestItemsNotFoundError extends Error {
  constructor(readonly itemIds: number[]) {
    super(`One or more items were not found for this organization: ${itemIds.join(", ")}`);
  }
}
export class OfficeInventoryRequestNotFoundError extends Error {
  constructor() {
    super("Request not found");
  }
}
export class OfficeInventoryRequestNotCancellableError extends Error {
  constructor() {
    super("This request can no longer be cancelled — a decision has already been recorded on at least one line");
  }
}
export class OfficeInventoryNotRequesterError extends Error {
  constructor() {
    super("Only the original requester may cancel this request");
  }
}
export class OfficeInventoryRequestLineNotFoundError extends Error {
  constructor() {
    super("Request line not found");
  }
}
export class OfficeInventoryRequestLineAlreadyDecidedError extends Error {
  constructor() {
    super("This line has already been decided");
  }
}
export class OfficeInventoryNoApprovalAuthorityError extends Error {
  constructor() {
    super("You are not the current Department Head or a currently-valid delegate for this request's department");
  }
}
export class OfficeInventoryInvalidApprovedQuantityError extends Error {
  constructor() {
    super("Approved quantity must be greater than 0 and no more than the quantity requested");
  }
}
export class OfficeInventoryRejectionReasonRequiredError extends Error {
  constructor() {
    super("A rejection reason is required");
  }
}

const REQUEST_NUMBER_SEQUENCE_KEY = "office_inventory_request";

async function generateRequestReference(organizationId: number): Promise<string> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  const requestNumberConfig = (config.data.requestNumber as RequestNumberFormatConfig | undefined) ?? { prefix: "REQ", sequenceLength: 5 };
  const periodKey = resolvePeriodKey(requestNumberConfig.resetPolicy, new Date());
  const sequenceValue = await lockAndIncrementSequence({
    organizationId,
    sequenceKey: REQUEST_NUMBER_SEQUENCE_KEY,
    periodKey,
    startingSequence: requestNumberConfig.startingSequence ?? 1,
  });
  const now = new Date();
  return formatGeneratedNumber(requestNumberConfig, sequenceValue, { branchCode: null, departmentCode: null, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
}

export function deriveHeaderStatus(lines: { approvalStatus: string }[]): "pending" | "approved" | "rejected" | "partially_approved" {
  const decided = lines.filter((l) => l.approvalStatus !== "pending");
  if (decided.length === 0) return "pending";
  const approved = lines.filter((l) => l.approvalStatus === "approved");
  const rejected = lines.filter((l) => l.approvalStatus === "rejected");
  if (approved.length === lines.length) return "approved";
  if (rejected.length === lines.length) return "rejected";
  return "partially_approved";
}

export interface RequestLineInput {
  itemId: number;
  quantityRequested: string;
}

async function validateLines(organizationId: number, lines: RequestLineInput[]): Promise<void> {
  if (lines.length === 0) throw new OfficeInventoryRequestNoLinesError();
  for (const line of lines) {
    let minor: bigint;
    try {
      minor = toMinorUnits(line.quantityRequested);
    } catch (err) {
      if (err instanceof InvalidMoneyStringError) throw new OfficeInventoryRequestInvalidQuantityError(line.itemId);
      throw err;
    }
    if (minor <= 0n) throw new OfficeInventoryRequestInvalidQuantityError(line.itemId);
  }
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const items = await db
    .select({ id: officeInventoryItemsTable.id })
    .from(officeInventoryItemsTable)
    .where(and(inArray(officeInventoryItemsTable.id, itemIds), eq(officeInventoryItemsTable.organizationId, organizationId)));
  const foundIds = new Set(items.map((i) => i.id));
  const missing = itemIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) throw new OfficeInventoryRequestItemsNotFoundError(missing);
}

async function insertRequest(
  organizationId: number,
  params: {
    requestedByMembershipId: number;
    requestType: "employee" | "department";
    forEmployeeId: number | null;
    forDepartmentId: number;
    reason: string | null;
    lines: RequestLineInput[];
  },
  actorApplicationUserId: number | null,
): Promise<{ request: OfficeInventoryRequest; lines: OfficeInventoryRequestLine[] }> {
  await validateLines(organizationId, params.lines);
  const requestReference = await generateRequestReference(organizationId);

  const result = await db.transaction(async (tx) => {
    const [request] = await tx
      .insert(officeInventoryRequestsTable)
      .values({
        organizationId,
        requestReference,
        requestedByMembershipId: params.requestedByMembershipId,
        requestType: params.requestType,
        forEmployeeId: params.forEmployeeId,
        forDepartmentId: params.forDepartmentId,
        reason: params.reason,
      })
      .returning();

    const lines = await tx
      .insert(officeInventoryRequestLinesTable)
      .values(
        params.lines.map((l) => ({
          organizationId,
          requestId: request.id,
          itemId: l.itemId,
          quantityRequested: l.quantityRequested,
        })),
      )
      .returning();

    return { request, lines };
  });

  await recordAuditEvent({
    actorApplicationUserId,
    actorMembershipId: params.requestedByMembershipId,
    organizationId,
    eventType: "office_inventory_request.submitted",
    targetType: "office_inventory_request",
    targetId: String(result.request.id),
    afterState: { requestReference, requestType: params.requestType, forDepartmentId: params.forDepartmentId, lineCount: result.lines.length },
  });

  return result;
}

export interface CreateEmployeeRequestParams {
  organizationId: number;
  forEmployeeId: number; // already resolved server-side via resolveOwnEmployeeId by the caller — never client-supplied
  reason?: string | null;
  lines: RequestLineInput[];
  requestedByMembershipId: number;
  actorApplicationUserId: number | null;
}

/** `forEmployeeId` must already be the caller's OWN employee id, resolved by the route via `resolveOwnEmployeeId` — this function trusts its caller, never a client body field. */
export async function createEmployeeRequest(params: CreateEmployeeRequestParams): Promise<{ request: OfficeInventoryRequest; lines: OfficeInventoryRequestLine[] }> {
  const [employee] = await db
    .select({ id: employeesTable.id, departmentId: employeesTable.departmentId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.forEmployeeId), eq(employeesTable.organizationId, params.organizationId)));
  if (!employee || employee.departmentId === null) throw new OfficeInventoryEmployeeHasNoDepartmentError();

  return insertRequest(
    params.organizationId,
    {
      requestedByMembershipId: params.requestedByMembershipId,
      requestType: "employee",
      forEmployeeId: params.forEmployeeId,
      forDepartmentId: employee.departmentId,
      reason: params.reason ?? null,
      lines: params.lines,
    },
    params.actorApplicationUserId,
  );
}

export interface CreateDepartmentRequestParams {
  organizationId: number;
  forDepartmentId: number;
  reason?: string | null;
  lines: RequestLineInput[];
  requestedByMembershipId: number;
  requestedByEmployeeId: number | null; // the submitter's own resolved employee id, if any — used only to verify department membership below
  actorApplicationUserId: number | null;
}

/**
 * A department request's submitting actor must themselves belong to the
 * target department (a disclosed, reasonable interpretation — the frozen
 * plan does not explicitly restrict who may submit "for" a department, but
 * leaving it fully open to any `.request` holder for any department would
 * be a real, undisclosed authorization gap; this mirrors the "own" scoping
 * theme already explicit for employee requests).
 */
export async function createDepartmentRequest(params: CreateDepartmentRequestParams): Promise<{ request: OfficeInventoryRequest; lines: OfficeInventoryRequestLine[] }> {
  const [department] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, params.forDepartmentId), eq(departmentsTable.organizationId, params.organizationId)));
  if (!department) throw new OfficeInventoryDepartmentNotFoundError();

  if (params.requestedByEmployeeId === null) throw new OfficeInventoryRequesterNotInDepartmentError();
  const [employee] = await db
    .select({ departmentId: employeesTable.departmentId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.requestedByEmployeeId), eq(employeesTable.organizationId, params.organizationId)));
  if (!employee || employee.departmentId !== params.forDepartmentId) throw new OfficeInventoryRequesterNotInDepartmentError();

  return insertRequest(
    params.organizationId,
    {
      requestedByMembershipId: params.requestedByMembershipId,
      requestType: "department",
      forEmployeeId: null,
      forDepartmentId: params.forDepartmentId,
      reason: params.reason ?? null,
      lines: params.lines,
    },
    params.actorApplicationUserId,
  );
}

export async function getRequestWithLines(organizationId: number, requestId: number): Promise<{ request: OfficeInventoryRequest; lines: OfficeInventoryRequestLine[] }> {
  const [request] = await db
    .select()
    .from(officeInventoryRequestsTable)
    .where(and(eq(officeInventoryRequestsTable.id, requestId), eq(officeInventoryRequestsTable.organizationId, organizationId)));
  if (!request) throw new OfficeInventoryRequestNotFoundError();
  const lines = await db.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.requestId, requestId));
  return { request, lines };
}

export async function listMyRequests(organizationId: number, requestedByMembershipId: number): Promise<OfficeInventoryRequest[]> {
  return db
    .select()
    .from(officeInventoryRequestsTable)
    .where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), eq(officeInventoryRequestsTable.requestedByMembershipId, requestedByMembershipId)))
    .orderBy(officeInventoryRequestsTable.submittedAt);
}

export async function listRequestsForDepartment(organizationId: number, departmentId: number): Promise<OfficeInventoryRequest[]> {
  return db
    .select()
    .from(officeInventoryRequestsTable)
    .where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), eq(officeInventoryRequestsTable.forDepartmentId, departmentId)))
    .orderBy(officeInventoryRequestsTable.submittedAt);
}

export interface CancelRequestParams {
  organizationId: number;
  requestId: number;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

/** Only the original requester, and only while every line is still "pending" (no decision recorded yet). */
export async function cancelRequest(params: CancelRequestParams): Promise<OfficeInventoryRequest> {
  const { request } = await getRequestWithLines(params.organizationId, params.requestId);
  if (request.requestedByMembershipId !== params.actorMembershipId) throw new OfficeInventoryNotRequesterError();

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(officeInventoryRequestsTable).where(eq(officeInventoryRequestsTable.id, params.requestId)).for("update");
    if (!current || current.status !== "pending") throw new OfficeInventoryRequestNotCancellableError();
    const lines = await tx.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.requestId, params.requestId));
    if (lines.some((l) => l.approvalStatus !== "pending")) throw new OfficeInventoryRequestNotCancellableError();

    const [row] = await tx
      .update(officeInventoryRequestsTable)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelledByMembershipId: params.actorMembershipId })
      .where(eq(officeInventoryRequestsTable.id, params.requestId))
      .returning();
    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_request.cancelled",
    targetType: "office_inventory_request",
    targetId: String(params.requestId),
  });

  return updated;
}

export interface DecideLineParams {
  organizationId: number;
  lineId: number;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

export interface ApproveLineParams extends DecideLineParams {
  approvedQuantity: string;
}

export interface RejectLineParams extends DecideLineParams {
  rejectionReason: string;
}

async function decideLine(
  params: DecideLineParams,
  decide: (tx: unknown, line: OfficeInventoryRequestLine, request: OfficeInventoryRequest, authority: NonNullable<Awaited<ReturnType<typeof resolveApprovalAuthority>>>) => Promise<OfficeInventoryRequestLine>,
): Promise<{ line: OfficeInventoryRequestLine; request: OfficeInventoryRequest }> {
  const [line] = await db
    .select()
    .from(officeInventoryRequestLinesTable)
    .where(and(eq(officeInventoryRequestLinesTable.id, params.lineId), eq(officeInventoryRequestLinesTable.organizationId, params.organizationId)));
  if (!line) throw new OfficeInventoryRequestLineNotFoundError();
  const [request] = await db.select().from(officeInventoryRequestsTable).where(eq(officeInventoryRequestsTable.id, line.requestId));

  const authority = await resolveApprovalAuthority(params.organizationId, request!.forDepartmentId, params.actorMembershipId);
  if (!authority) throw new OfficeInventoryNoApprovalAuthorityError();

  const { updatedLine, updatedRequest } = await db.transaction(async (tx) => {
    const [lockedLine] = await tx.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.id, params.lineId)).for("update");
    if (!lockedLine) throw new OfficeInventoryRequestLineNotFoundError();
    if (lockedLine.approvalStatus !== "pending") throw new OfficeInventoryRequestLineAlreadyDecidedError();

    const decided = await decide(tx, lockedLine, request!, authority);

    const allLines = await tx.select().from(officeInventoryRequestLinesTable).where(eq(officeInventoryRequestLinesTable.requestId, request!.id));
    const nextStatus = deriveHeaderStatus(allLines);
    const [updatedReq] = await tx
      .update(officeInventoryRequestsTable)
      .set({ status: nextStatus })
      .where(eq(officeInventoryRequestsTable.id, request!.id))
      .returning();

    return { updatedLine: decided, updatedRequest: updatedReq };
  });

  return { line: updatedLine, request: updatedRequest };
}

export async function approveRequestLine(params: ApproveLineParams): Promise<{ line: OfficeInventoryRequestLine; request: OfficeInventoryRequest }> {
  let approvedMinor: bigint;
  try {
    approvedMinor = toMinorUnits(params.approvedQuantity);
  } catch (err) {
    if (err instanceof InvalidMoneyStringError) throw new OfficeInventoryInvalidApprovedQuantityError();
    throw err;
  }

  const result = await decideLine(params, async (tx, line, _request, authority) => {
    const requestedMinor = toMinorUnits(line.quantityRequested);
    if (approvedMinor <= 0n || approvedMinor > requestedMinor) throw new OfficeInventoryInvalidApprovedQuantityError();

    const [updated] = await (tx as typeof db)
      .update(officeInventoryRequestLinesTable)
      .set({
        approvalStatus: "approved",
        approvedQuantity: params.approvedQuantity,
        approvedByMembershipId: params.actorMembershipId,
        actedAsDelegate: authority.capacity === "delegate",
        delegatorHeadMembershipId: authority.capacity === "delegate" ? authority.headMembershipId : null,
        delegationId: authority.delegation?.id ?? null,
        approvedAt: new Date(),
      })
      .where(eq(officeInventoryRequestLinesTable.id, line.id))
      .returning();
    return updated;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_request_line.approved",
    targetType: "office_inventory_request_line",
    targetId: String(params.lineId),
    afterState: { approvedQuantity: params.approvedQuantity, requestStatus: result.request.status },
  });

  return result;
}

export async function rejectRequestLine(params: RejectLineParams): Promise<{ line: OfficeInventoryRequestLine; request: OfficeInventoryRequest }> {
  if (!params.rejectionReason.trim()) throw new OfficeInventoryRejectionReasonRequiredError();

  const result = await decideLine(params, async (tx, line, _request, authority) => {
    const [updated] = await (tx as typeof db)
      .update(officeInventoryRequestLinesTable)
      .set({
        approvalStatus: "rejected",
        rejectionReason: params.rejectionReason,
        approvedByMembershipId: params.actorMembershipId,
        actedAsDelegate: authority.capacity === "delegate",
        delegatorHeadMembershipId: authority.capacity === "delegate" ? authority.headMembershipId : null,
        delegationId: authority.delegation?.id ?? null,
        approvedAt: new Date(),
      })
      .where(eq(officeInventoryRequestLinesTable.id, line.id))
      .returning();
    return updated;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_request_line.rejected",
    targetType: "office_inventory_request_line",
    targetId: String(params.lineId),
    afterState: { rejectionReason: params.rejectionReason, requestStatus: result.request.status },
  });

  return result;
}

export interface RepeatRequestWarning {
  itemId: number;
  windowDays: number;
  recentEmployeeRequests: OfficeInventoryRequest[];
  recentDepartmentRequests: OfficeInventoryRequest[];
}

/**
 * Query-time only, never a stored flag (§15). Truthfully derived only from
 * what currently exists — recent request/approval history. Deliberately
 * does NOT fabricate `currentOutstandingCustody`/`recentIssuedCount` fields
 * (those require Workstream 4's issue/custody data, which does not exist
 * yet) — adding them later is additive to this DTO shape, not breaking.
 */
export async function getRepeatRequestWarning(organizationId: number, forEmployeeId: number | null, forDepartmentId: number, itemId: number): Promise<RepeatRequestWarning> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  const windowDays = (config.data.repeatRequestReviewWindowDays as number | undefined) ?? 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const linesForItem = await db.select({ requestId: officeInventoryRequestLinesTable.requestId }).from(officeInventoryRequestLinesTable).where(and(eq(officeInventoryRequestLinesTable.organizationId, organizationId), eq(officeInventoryRequestLinesTable.itemId, itemId)));
  const requestIdsForItem = new Set(linesForItem.map((l) => l.requestId));
  if (requestIdsForItem.size === 0) return { itemId, windowDays, recentEmployeeRequests: [], recentDepartmentRequests: [] };

  const recentDepartmentRequests = await db
    .select()
    .from(officeInventoryRequestsTable)
    .where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), eq(officeInventoryRequestsTable.forDepartmentId, forDepartmentId), gte(officeInventoryRequestsTable.submittedAt, since)));
  const filteredDeptRequests = recentDepartmentRequests.filter((r) => requestIdsForItem.has(r.id));

  let filteredEmployeeRequests: OfficeInventoryRequest[] = [];
  if (forEmployeeId !== null) {
    const recentEmployeeRequests = await db
      .select()
      .from(officeInventoryRequestsTable)
      .where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), eq(officeInventoryRequestsTable.forEmployeeId, forEmployeeId), gte(officeInventoryRequestsTable.submittedAt, since)));
    filteredEmployeeRequests = recentEmployeeRequests.filter((r) => requestIdsForItem.has(r.id));
  }

  return { itemId, windowDays, recentEmployeeRequests: filteredEmployeeRequests, recentDepartmentRequests: filteredDeptRequests };
}
