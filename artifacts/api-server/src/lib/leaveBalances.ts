/**
 * Leave Balance Engine (Phase 2B, W34): an append-only, immutable ledger of
 * balance movements — never a directly editable balance row. `postLedgerEntry`
 * is the general-purpose posting primitive (manual adjustments, and any
 * future accrual/carry-forward/expiry poster); `postApprovedUsageEntry` and
 * `getAvailableBalance` below exist specifically for W35's approval
 * transaction, which already has the leave request's resolved policy/type
 * and needs a client parameter to participate in that same transaction. No
 * accrual scheduler — that's a later workstream's job. Reuses W32's
 * `resolveApplicablePolicy`/`toIsoDate` (leaveRequests.ts) and W22's
 * `getEmployeeById` rather than re-deriving eligibility or lookups.
 */
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  leaveBalanceEntriesTable,
  leaveTypesTable,
  leaveRequestsTable,
  type LeaveBalanceEntry,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getEmployeeById } from "./employees";
import { resolveApplicablePolicy } from "./leaveRequests";
import { isUniqueViolation } from "./dbErrors";

export class LeaveBalanceValidationError extends Error {}

export class DuplicateLedgerEntryError extends Error {
  constructor() {
    super("An equivalent ledger entry has already been posted");
    this.name = "DuplicateLedgerEntryError";
  }
}

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx` — lets balance reads and the approval usage-posting below
// run inside W35's approval transaction without a second query-client type.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type LeaveBalanceEntryType = LeaveBalanceEntry["entryType"];

const POSITIVE_ENTRY_TYPES: ReadonlySet<LeaveBalanceEntryType> = new Set(["opening_balance", "accrual", "carry_forward"]);
const NEGATIVE_ENTRY_TYPES: ReadonlySet<LeaveBalanceEntryType> = new Set(["usage", "expiry"]);
// reversal / manual_adjustment: sign depends on what's being corrected —
// either direction is valid, only zero is rejected.

/**
 * The single idempotent posting primitive for every ledger entry type.
 * `leavePolicyId` is always resolved here, never accepted from a caller:
 * for a request-related posting (usage/reversal) it's taken from the
 * leave request's own already-resolved policy (Historical Consistency — a
 * later policy change must never reinterpret that request); otherwise it's
 * freshly resolved from the employee's current eligibility, same as W33.
 * Duplicate/concurrent posting is guarded by two DB unique indexes
 * (`(relatedLeaveRequestId, entryType)` and
 * `(organizationId, employeeId, leaveTypeId, entryType, sourceReference)`) —
 * a unique-violation here is translated into `DuplicateLedgerEntryError`
 * rather than silently double-posting under a race.
 */
export async function postLedgerEntry(params: {
  organizationId: number;
  employeeId: number;
  entryType: LeaveBalanceEntryType;
  amount: number;
  effectiveDate: string;
  reason?: string | null;
  leaveTypeId?: number;
  relatedLeaveRequestId?: number | null;
  sourceReference?: string | null;
  createdBy?: number | null;
  approvedBy?: number | null;
}): Promise<LeaveBalanceEntry> {
  if (params.amount === 0) {
    throw new LeaveBalanceValidationError("Ledger entry amount cannot be zero");
  }
  if (POSITIVE_ENTRY_TYPES.has(params.entryType) && params.amount <= 0) {
    throw new LeaveBalanceValidationError(`A ${params.entryType} entry must have a positive amount`);
  }
  if (NEGATIVE_ENTRY_TYPES.has(params.entryType) && params.amount >= 0) {
    throw new LeaveBalanceValidationError(`A ${params.entryType} entry must have a negative amount`);
  }
  if (params.entryType === "manual_adjustment" && !params.reason?.trim()) {
    throw new LeaveBalanceValidationError("A reason is required for a manual adjustment");
  }

  const employee = await getEmployeeById(params.organizationId, params.employeeId);
  if (!employee) throw new LeaveBalanceValidationError("Employee not found in this organization");

  let leaveTypeId: number;
  let leavePolicyId: number;

  if (params.relatedLeaveRequestId != null) {
    const [request] = await db
      .select()
      .from(leaveRequestsTable)
      .where(
        and(
          eq(leaveRequestsTable.id, params.relatedLeaveRequestId),
          eq(leaveRequestsTable.organizationId, params.organizationId),
          eq(leaveRequestsTable.employeeId, params.employeeId),
        ),
      )
      .limit(1);
    if (!request) throw new LeaveBalanceValidationError("Related leave request not found for this employee");
    leaveTypeId = request.leaveTypeId;
    leavePolicyId = request.leavePolicyId;
  } else {
    if (params.leaveTypeId == null) throw new LeaveBalanceValidationError("leaveTypeId is required");
    const [leaveType] = await db
      .select()
      .from(leaveTypesTable)
      .where(and(eq(leaveTypesTable.id, params.leaveTypeId), eq(leaveTypesTable.organizationId, params.organizationId)))
      .limit(1);
    if (!leaveType) throw new LeaveBalanceValidationError("Leave type not found in this organization");
    if (leaveType.status !== "active") throw new LeaveBalanceValidationError("Leave type is archived");

    const policy = await resolveApplicablePolicy(params.organizationId, params.leaveTypeId, employee);
    if (!policy) throw new LeaveBalanceValidationError("Employee is not eligible for any policy under this leave type");
    leaveTypeId = params.leaveTypeId;
    leavePolicyId = policy.id;
  }

  try {
    const [entry] = await db
      .insert(leaveBalanceEntriesTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        leaveTypeId,
        leavePolicyId,
        entryType: params.entryType,
        amount: params.amount.toString(),
        effectiveDate: params.effectiveDate,
        reason: params.reason ?? null,
        relatedLeaveRequestId: params.relatedLeaveRequestId ?? null,
        sourceReference: params.sourceReference ?? null,
        createdBy: params.createdBy ?? null,
        approvedBy: params.approvedBy ?? null,
      })
      .returning();
    return entry;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateLedgerEntryError();
    throw err;
  }
}

export interface LeaveBalanceSummary {
  leaveTypeId: number;
  leaveTypeName: string;
  available: string;
}

/** Reconstructs each leave type's available balance by summing the immutable ledger — never reads a mutable balance column. */
export async function getEmployeeBalances(organizationId: number, employeeId: number): Promise<LeaveBalanceSummary[]> {
  const entries = await db
    .select({ leaveTypeId: leaveBalanceEntriesTable.leaveTypeId, amount: leaveBalanceEntriesTable.amount })
    .from(leaveBalanceEntriesTable)
    .where(and(eq(leaveBalanceEntriesTable.organizationId, organizationId), eq(leaveBalanceEntriesTable.employeeId, employeeId)));

  const totals = new Map<number, number>();
  for (const entry of entries) {
    totals.set(entry.leaveTypeId, (totals.get(entry.leaveTypeId) ?? 0) + Number(entry.amount));
  }
  if (totals.size === 0) return [];

  const leaveTypes = await db
    .select({ id: leaveTypesTable.id, name: leaveTypesTable.name })
    .from(leaveTypesTable)
    .where(eq(leaveTypesTable.organizationId, organizationId));
  const nameById = new Map(leaveTypes.map((t) => [t.id, t.name]));

  return Array.from(totals.entries())
    .map(([leaveTypeId, total]) => ({
      leaveTypeId,
      leaveTypeName: nameById.get(leaveTypeId) ?? `Leave type #${leaveTypeId}`,
      available: total.toFixed(2),
    }))
    .sort((a, b) => a.leaveTypeName.localeCompare(b.leaveTypeName));
}

/**
 * Live-summed available balance for a single employee/leave type — the same
 * reconstruction `getEmployeeBalances` does, narrowed to one type and
 * accepting an optional client so W35's approval flow can re-check it
 * inside the same transaction that posts the deduction, closing the race
 * between "is there enough balance" and "post the usage entry."
 */
export async function getAvailableBalance(
  organizationId: number,
  employeeId: number,
  leaveTypeId: number,
  client: QueryClient = db,
): Promise<number> {
  const entries = await client
    .select({ amount: leaveBalanceEntriesTable.amount })
    .from(leaveBalanceEntriesTable)
    .where(
      and(
        eq(leaveBalanceEntriesTable.organizationId, organizationId),
        eq(leaveBalanceEntriesTable.employeeId, employeeId),
        eq(leaveBalanceEntriesTable.leaveTypeId, leaveTypeId),
      ),
    );
  return entries.reduce((sum, entry) => sum + Number(entry.amount), 0);
}

/**
 * Posts the immutable `usage` entry for an approved leave request — called
 * only from within W35's approval transaction, never standalone. Unlike
 * `postLedgerEntry`, `leaveTypeId`/`leavePolicyId` are taken directly from
 * the leave request row the caller already has, not re-resolved: the
 * request snapshot its applicable policy at submission time (W33), and a
 * later policy change must never reinterpret it (Historical Consistency).
 * Guarded by the same `(relatedLeaveRequestId, entryType)` unique index as
 * every other request-related posting.
 */
export async function postApprovedUsageEntry(
  client: QueryClient,
  params: {
    organizationId: number;
    employeeId: number;
    leaveTypeId: number;
    leavePolicyId: number;
    daysRequested: number;
    effectiveDate: string;
    relatedLeaveRequestId: number;
    approvedBy: number;
  },
): Promise<LeaveBalanceEntry> {
  try {
    const [entry] = await client
      .insert(leaveBalanceEntriesTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        leaveTypeId: params.leaveTypeId,
        leavePolicyId: params.leavePolicyId,
        entryType: "usage",
        amount: (-params.daysRequested).toString(),
        effectiveDate: params.effectiveDate,
        relatedLeaveRequestId: params.relatedLeaveRequestId,
        approvedBy: params.approvedBy,
      })
      .returning();
    return entry;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateLedgerEntryError();
    throw err;
  }
}

/** Raw ledger entries — the auditable history a computed balance is reconstructed from. */
export async function getLedgerHistory(
  organizationId: number,
  employeeId: number,
  leaveTypeId?: number,
): Promise<LeaveBalanceEntry[]> {
  const conditions = [
    eq(leaveBalanceEntriesTable.organizationId, organizationId),
    eq(leaveBalanceEntriesTable.employeeId, employeeId),
  ];
  if (leaveTypeId != null) conditions.push(eq(leaveBalanceEntriesTable.leaveTypeId, leaveTypeId));

  return db
    .select()
    .from(leaveBalanceEntriesTable)
    .where(and(...conditions))
    .orderBy(desc(leaveBalanceEntriesTable.effectiveDate), desc(leaveBalanceEntriesTable.createdAt));
}

/** The only write this workstream exposes through the API — HR-only, reason required, always audit-logged (Architecture Principle 6). */
export async function postManualAdjustment(params: {
  organizationId: number;
  employeeId: number;
  leaveTypeId: number;
  amount: number;
  effectiveDate: string;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveBalanceEntry> {
  const entry = await postLedgerEntry({
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    leaveTypeId: params.leaveTypeId,
    entryType: "manual_adjustment",
    amount: params.amount,
    effectiveDate: params.effectiveDate,
    reason: params.reason,
    createdBy: params.actorApplicationUserId,
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_balance.manual_adjustment",
    targetType: "leave_balance_entry",
    targetId: String(entry.id),
    afterState: { employeeId: params.employeeId, leaveTypeId: params.leaveTypeId, amount: entry.amount, reason: params.reason },
  });

  return entry;
}
