/**
 * Leave Requests (Phase 2B, W33): create/view/withdraw an employee's own
 * leave requests. Approval/rejection lives in leaveApprovals.ts (W35, to
 * avoid a circular import with leaveBalances.ts). Public holiday exclusion
 * (W37) is resolved via publicHolidays.ts's `resolveHolidayDatesInRange`
 * and fed into `calculateLeaveDays` below — exactly the extension point
 * this function was built with, no schema or signature change needed.
 * Reuses lib/employees.ts's `getEmployeeById` and W32's `leave_types`/
 * `leave_policies` rather than re-deriving eligibility from scratch.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  leaveRequestsTable,
  leaveTypesTable,
  leavePoliciesTable,
  employeeDocumentsTable,
  employeeUserLinksTable,
  type LeaveRequest,
  type LeavePolicy,
  type Employee,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getEmployeeById } from "./employees";
import { resolveHolidayDatesInRange } from "./publicHolidays";

export class InvalidLeaveRequestError extends Error {}

export class LeaveRequestNotFoundError extends Error {
  constructor() {
    super("Leave request not found");
    this.name = "LeaveRequestNotFoundError";
  }
}

export class LeaveRequestNotCancellableError extends Error {
  constructor() {
    super("Only a pending leave request can be withdrawn");
    this.name = "LeaveRequestNotCancellableError";
  }
}

/** Resolves "which employee is me" via W14's employee_user_links, scoped to this organization — never trusts a client-supplied employee ID. */
export async function resolveOwnEmployeeId(organizationId: number, applicationUserId: number): Promise<number | null> {
  const [link] = await db
    .select({ employeeId: employeeUserLinksTable.employeeId })
    .from(employeeUserLinksTable)
    .where(eq(employeeUserLinksTable.applicationUserId, applicationUserId))
    .limit(1);
  if (!link) return null;
  const employee = await getEmployeeById(organizationId, link.employeeId);
  return employee ? employee.id : null;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/**
 * Server-side day count — never trusts a client-supplied value. Weekend
 * exclusion is driven by the policy's own `countWeekends` flag; holiday
 * exclusion by `countPublicHolidays` (W37 always passes the organization's
 * active holidays here now — see createLeaveRequest). A day matching either
 * exclusion only ever `continue`s the loop once, so a day that's both a
 * weekend and a holiday is never double-subtracted.
 */
export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  policy: Pick<LeavePolicy, "countWeekends" | "countPublicHolidays">,
  publicHolidayDates: ReadonlySet<string> = new Set(),
): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const dayOfWeek = d.getUTCDay();
    if (!policy.countWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) continue;
    if (!policy.countPublicHolidays && publicHolidayDates.has(toIsoDate(d))) continue;
    count++;
  }
  return count;
}

/**
 * Phase 3H, W117 (frozen plan Decision 11). Calendar-day mode (the
 * pre-existing, unchanged default): `today + noticePeriodDays` calendar
 * days, exactly as before. Working-day mode (only when
 * `policy.noticePeriodCountsWorkingDaysOnly === true`): walks forward from
 * today one calendar day at a time, counting a day toward the threshold
 * only when it is neither a weekend (Saturday/Sunday — the frozen plan's
 * own literal "weekends skipped," not this codebase's separate,
 * Attendance-module-scoped configurable workDays, which would make Leave's
 * own hard-block depend on a different module being enabled) nor an
 * organization holiday. The returned date is the earliest allowed start
 * date either way — the caller's own `<` comparison is unchanged.
 */
export function resolveEarliestAllowedStartDate(
  today: string,
  noticePeriodDays: number,
  countWorkingDaysOnly: boolean,
  holidayDates: ReadonlySet<string> = new Set(),
): string {
  const d = new Date(`${today}T00:00:00Z`);
  if (!countWorkingDaysOnly) {
    d.setUTCDate(d.getUTCDate() + noticePeriodDays);
    return toIsoDate(d);
  }

  let counted = 0;
  while (counted < noticePeriodDays) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dayOfWeek = d.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (!isWeekend && !holidayDates.has(toIsoDate(d))) counted++;
  }
  return toIsoDate(d);
}

function policySpecificity(policy: LeavePolicy): number {
  let score = 0;
  if (policy.positionId != null) score += 8;
  if (policy.departmentId != null) score += 4;
  if (policy.branchId != null) score += 2;
  if (policy.employmentType != null) score += 1;
  return score;
}

function policyMatchesEmployee(policy: LeavePolicy, employee: Employee): boolean {
  if (policy.status !== "active") return false;
  if (policy.employmentType != null && policy.employmentType !== employee.employmentType) return false;
  if (policy.branchId != null && policy.branchId !== employee.branchId) return false;
  if (policy.departmentId != null && policy.departmentId !== employee.departmentId) return false;
  if (policy.positionId != null && policy.positionId !== employee.positionId) return false;
  if (policy.gender != null && policy.gender !== employee.gender) return false;
  if (policy.minimumServiceMonths != null) {
    if (!employee.hireDate) return false;
    if (monthsBetween(new Date(employee.hireDate), new Date()) < policy.minimumServiceMonths) return false;
  }
  if (policy.probationRestricted && employee.employmentStatus === "probation") return false;
  return true;
}

/** Resolves the single most specific policy (position > department > branch > employment type > org-wide default) the employee is eligible for under this leave type. */
export async function resolveApplicablePolicy(
  organizationId: number,
  leaveTypeId: number,
  employee: Employee,
): Promise<LeavePolicy | null> {
  const policies = await db
    .select()
    .from(leavePoliciesTable)
    .where(and(eq(leavePoliciesTable.organizationId, organizationId), eq(leavePoliciesTable.leaveTypeId, leaveTypeId)));
  const matches = policies.filter((p) => policyMatchesEmployee(p, employee));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => policySpecificity(b) - policySpecificity(a))[0];
}

export async function listLeaveRequests(organizationId: number, employeeId: number): Promise<LeaveRequest[]> {
  return db
    .select()
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.organizationId, organizationId), eq(leaveRequestsTable.employeeId, employeeId)))
    .orderBy(desc(leaveRequestsTable.createdAt));
}

export async function createLeaveRequest(params: {
  organizationId: number;
  employeeId: number;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  reason?: string | null;
  attachmentDocumentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveRequest> {
  const employee = await getEmployeeById(params.organizationId, params.employeeId);
  if (!employee) throw new InvalidLeaveRequestError("Employee not found in this organization");

  const [leaveType] = await db
    .select()
    .from(leaveTypesTable)
    .where(and(eq(leaveTypesTable.id, params.leaveTypeId), eq(leaveTypesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!leaveType) throw new InvalidLeaveRequestError("Leave type not found in this organization");
  if (leaveType.status !== "active") throw new InvalidLeaveRequestError("Leave type is archived");

  if (params.startDate > params.endDate) throw new InvalidLeaveRequestError("startDate cannot be after endDate");

  const policy = await resolveApplicablePolicy(params.organizationId, params.leaveTypeId, employee);
  if (!policy) throw new InvalidLeaveRequestError("Employee is not eligible for any policy under this leave type");

  const today = toIsoDate(new Date());
  // Compared as plain "YYYY-MM-DD" strings throughout — ISO date strings sort
  // lexicographically in chronological order, avoiding the Date/string
  // relational-comparison pitfall (`Date > string` coerces via ToNumber,
  // which doesn't parse ISO text and silently yields NaN).
  const policyEffectiveFrom = toIsoDate(new Date(policy.effectiveFrom));
  const policyEffectiveTo = policy.effectiveTo ? toIsoDate(new Date(policy.effectiveTo)) : null;
  if (policyEffectiveFrom > params.startDate || (policyEffectiveTo && policyEffectiveTo < params.startDate)) {
    throw new InvalidLeaveRequestError("The applicable policy is not effective for the requested dates");
  }

  // W37: resolves active organization holidays overlapping the requested
  // range; calculateLeaveDays itself decides whether to actually exclude
  // them, per the policy's own countPublicHolidays flag — this call always
  // fetches them so that decision is never skipped.
  const holidayDates = await resolveHolidayDatesInRange(params.organizationId, params.startDate, params.endDate);
  const daysRequested = calculateLeaveDays(params.startDate, params.endDate, policy, holidayDates);

  const minDuration = policy.minRequestDurationDays != null ? Number(policy.minRequestDurationDays) : null;
  const maxDuration = policy.maxRequestDurationDays != null ? Number(policy.maxRequestDurationDays) : null;
  if (minDuration != null && daysRequested < minDuration) {
    throw new InvalidLeaveRequestError(`Request duration is below the policy minimum of ${minDuration} day(s)`);
  }
  if (maxDuration != null && daysRequested > maxDuration) {
    throw new InvalidLeaveRequestError(`Request duration exceeds the policy maximum of ${maxDuration} day(s)`);
  }

  if (policy.noticePeriodDays != null && policy.noticePeriodDays > 0) {
    const countWorkingDaysOnly = policy.noticePeriodCountsWorkingDaysOnly === true;
    // Working-day mode needs holiday coverage across the whole notice
    // window, not just [startDate, endDate] — a generous, cheap-to-fetch
    // year-plus lookahead from today comfortably covers any realistic
    // noticePeriodDays value; calendar-day mode never needs this at all.
    const noticeHolidayDates = countWorkingDaysOnly
      ? await resolveHolidayDatesInRange(params.organizationId, today, toIsoDate(new Date(Date.now() + 400 * 86400000)))
      : new Set<string>();
    const earliestAllowedIso = resolveEarliestAllowedStartDate(today, policy.noticePeriodDays, countWorkingDaysOnly, noticeHolidayDates);
    if (params.startDate < earliestAllowedIso) {
      const unit = countWorkingDaysOnly ? "working day(s)" : "day(s)";
      throw new InvalidLeaveRequestError(`This leave type requires at least ${policy.noticePeriodDays} ${unit} notice`);
    }
  }

  if (policy.attachmentRequired) {
    if (!params.attachmentDocumentId) {
      throw new InvalidLeaveRequestError("This leave type requires a supporting document");
    }
    const [document] = await db
      .select({ id: employeeDocumentsTable.id })
      .from(employeeDocumentsTable)
      .where(
        and(
          eq(employeeDocumentsTable.id, params.attachmentDocumentId),
          eq(employeeDocumentsTable.organizationId, params.organizationId),
          eq(employeeDocumentsTable.employeeId, params.employeeId),
        ),
      )
      .limit(1);
    if (!document) throw new InvalidLeaveRequestError("Attachment does not belong to this employee");
  }

  const existing = await db
    .select({ startDate: leaveRequestsTable.startDate, endDate: leaveRequestsTable.endDate })
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.employeeId, params.employeeId),
        eq(leaveRequestsTable.organizationId, params.organizationId),
        inArray(leaveRequestsTable.status, ["pending", "approved"]),
      ),
    );
  const overlaps = existing.some((row) => row.startDate <= params.endDate && row.endDate >= params.startDate);
  if (overlaps) {
    throw new InvalidLeaveRequestError("Employee already has a pending or approved request overlapping these dates");
  }

  const [request] = await db
    .insert(leaveRequestsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      leaveTypeId: params.leaveTypeId,
      leavePolicyId: policy.id,
      startDate: params.startDate,
      endDate: params.endDate,
      daysRequested: daysRequested.toString(),
      reason: params.reason ?? null,
      attachmentDocumentId: params.attachmentDocumentId ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  // Notification extension point (Architecture Principle 8): "submitted" —
  // wire into the existing Notifications capability here once a workstream
  // needs it live; not implemented in W33.
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_request.submitted",
    targetType: "leave_request",
    targetId: String(request.id),
    afterState: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, startDate: request.startDate, endDate: request.endDate, daysRequested: request.daysRequested },
  });

  return request;
}

export async function cancelLeaveRequest(params: {
  organizationId: number;
  employeeId: number;
  leaveRequestId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<LeaveRequest> {
  const [before] = await db
    .select()
    .from(leaveRequestsTable)
    .where(
      and(
        eq(leaveRequestsTable.id, params.leaveRequestId),
        eq(leaveRequestsTable.organizationId, params.organizationId),
        eq(leaveRequestsTable.employeeId, params.employeeId),
      ),
    )
    .limit(1);
  if (!before) throw new LeaveRequestNotFoundError();
  if (before.status !== "pending") throw new LeaveRequestNotCancellableError();

  const [updated] = await db
    .update(leaveRequestsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: params.actorApplicationUserId })
    .where(eq(leaveRequestsTable.id, params.leaveRequestId))
    .returning();

  // Notification extension point (Architecture Principle 8): "cancelled".
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "leave_request.cancelled",
    targetType: "leave_request",
    targetId: String(params.leaveRequestId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}
