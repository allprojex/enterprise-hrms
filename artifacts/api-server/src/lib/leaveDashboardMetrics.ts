/**
 * HR Operations Dashboard — Leave metrics (Phase 2B, W40). Extends
 * GET /dashboard/summary (W18) with real, tenant-scoped aggregates sourced
 * entirely from W33 (leave_requests), W34 (leave_balance_entries), and W37
 * (public_holidays) — no new table, no cache. Mirrors leaveCalendar.ts's
 * (W36) read-model convention: candidate rows are fetched via a scoped
 * WHERE (organization + optional employeeId scope) and reduced in
 * application code, the same style every Leave read model in this codebase
 * already uses, rather than introducing raw SQL aggregate functions as a
 * new pattern.
 *
 * `employeeIds: null` means org-wide (the caller resolved `leave_request.manage`
 * — HR admin tier); a list means "this viewer's own + direct reports"
 * (manager tier) — the same own+managed scope leaveCalendar.ts's
 * `visibleEmployeeIds` already establishes (Architecture Principle 5:
 * authorization/scope is re-derived at the route, not assumed here).
 * Public holidays are org-wide by definition (W37) and are therefore never
 * scoped by `employeeIds`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, leaveRequestsTable, leaveBalanceEntriesTable, leavePoliciesTable, type LeaveRequest } from "@workspace/db";
import { toIsoDate } from "./leaveRequests";
import { listHolidayOccurrencesInRange } from "./publicHolidays";

// One documented window for every "upcoming"/"expiring" figure here (upcoming
// approved leave, upcoming public holidays, expiring carry-forward balances)
// rather than three separately invented windows.
export const UPCOMING_WINDOW_DAYS = 30;

export interface LeaveRequestsByStatusCounts {
  pending: number;
  pending_hr: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

/**
 * WWM Employee Access Remediation (2026-09-07): which population the
 * figures were computed over, so the dashboard can label them honestly.
 * `organization` = caller holds leave_request.manage (org-wide HR reach);
 * `own_and_reports` = the caller's own record plus live direct reports —
 * an ordinary employee with no reports sees only their own leave.
 */
export type LeaveDashboardScope = "organization" | "own_and_reports";

export interface LeaveDashboardMetrics {
  scope: LeaveDashboardScope;
  employeesOnLeave: number;
  upcomingApprovedLeave: number;
  pendingApprovalCount: number;
  upcomingPublicHolidays: number;
  leaveUtilizationPercent: number;
  expiringCarryForwardBalances: number;
  requestsByStatus: LeaveRequestsByStatusCounts;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function getLeaveDashboardMetrics(params: {
  organizationId: number;
  employeeIds: number[] | null;
  pendingApprovalCount: number;
  today?: string;
}): Promise<LeaveDashboardMetrics> {
  const scope: LeaveDashboardScope = params.employeeIds === null ? "organization" : "own_and_reports";
  const today = params.today ?? toIsoDate(new Date());
  const upcomingTo = addDays(today, UPCOMING_WINDOW_DAYS);

  // Org-wide holidays are unaffected by an empty manager scope, but every
  // other figure genuinely has nothing to count for a manager with no
  // direct reports (and no own linked employee) — an honest empty state,
  // not an error, mirroring listPendingApprovals' own empty-scope handling.
  const upcomingPublicHolidays = (await listHolidayOccurrencesInRange(params.organizationId, today, upcomingTo)).length;

  if (params.employeeIds != null && params.employeeIds.length === 0) {
    return {
      scope,
      employeesOnLeave: 0,
      upcomingApprovedLeave: 0,
      pendingApprovalCount: params.pendingApprovalCount,
      upcomingPublicHolidays,
      leaveUtilizationPercent: 0,
      expiringCarryForwardBalances: 0,
      requestsByStatus: { pending: 0, pending_hr: 0, approved: 0, rejected: 0, cancelled: 0 },
    };
  }

  const requestConditions = [eq(leaveRequestsTable.organizationId, params.organizationId)];
  if (params.employeeIds != null) requestConditions.push(inArray(leaveRequestsTable.employeeId, params.employeeIds));
  const requests: LeaveRequest[] = await db.select().from(leaveRequestsTable).where(and(...requestConditions));

  const requestsByStatus: LeaveRequestsByStatusCounts = { pending: 0, pending_hr: 0, approved: 0, rejected: 0, cancelled: 0 };
  const onLeaveEmployeeIds = new Set<number>();
  let upcomingApprovedLeave = 0;
  for (const r of requests) {
    requestsByStatus[r.status] += 1;
    if (r.status === "approved") {
      if (r.startDate <= today && r.endDate >= today) onLeaveEmployeeIds.add(r.employeeId);
      else if (r.startDate > today && r.startDate <= upcomingTo) upcomingApprovedLeave += 1;
    }
  }

  const ledgerConditions = [eq(leaveBalanceEntriesTable.organizationId, params.organizationId)];
  if (params.employeeIds != null) ledgerConditions.push(inArray(leaveBalanceEntriesTable.employeeId, params.employeeIds));
  const ledgerEntries = await db.select().from(leaveBalanceEntriesTable).where(and(...ledgerConditions));

  // Utilization = days used / days credited, across every leave type in
  // scope, reconstructed from the ledger the same way getEmployeeBalances
  // (W34) reconstructs a balance — never a stored/cached percentage.
  let credited = 0;
  let used = 0;
  const carryForwardEntries = ledgerEntries.filter((e) => e.entryType === "carry_forward");
  for (const entry of ledgerEntries) {
    const amount = Number(entry.amount);
    if (entry.entryType === "opening_balance" || entry.entryType === "accrual" || entry.entryType === "carry_forward") {
      credited += amount;
    } else if (entry.entryType === "usage") {
      used += Math.abs(amount);
    }
  }
  const leaveUtilizationPercent = credited > 0 ? Math.round((used / credited) * 10000) / 100 : 0;

  // Only counts a carry-forward entry whose *own* policy actually supports
  // carry-forward expiry (frozen plan's explicit exclusion) — a policy with
  // carryForwardAllowed but no carryForwardExpiryMonths never expires, so
  // its carry-forward entries are never counted here.
  let expiringCarryForwardBalances = 0;
  if (carryForwardEntries.length > 0) {
    const policyIds = [...new Set(carryForwardEntries.map((e) => e.leavePolicyId))];
    const policies = await db
      .select({
        id: leavePoliciesTable.id,
        carryForwardAllowed: leavePoliciesTable.carryForwardAllowed,
        carryForwardExpiryMonths: leavePoliciesTable.carryForwardExpiryMonths,
      })
      .from(leavePoliciesTable)
      .where(inArray(leavePoliciesTable.id, policyIds));
    const policyById = new Map(policies.map((p) => [p.id, p]));

    for (const entry of carryForwardEntries) {
      const policy = policyById.get(entry.leavePolicyId);
      if (!policy?.carryForwardAllowed || policy.carryForwardExpiryMonths == null) continue;
      const expiresOn = addMonths(entry.effectiveDate, policy.carryForwardExpiryMonths);
      if (expiresOn >= today && expiresOn <= upcomingTo) expiringCarryForwardBalances += 1;
    }
  }

  return {
    scope,
    employeesOnLeave: onLeaveEmployeeIds.size,
    upcomingApprovedLeave,
    pendingApprovalCount: params.pendingApprovalCount,
    upcomingPublicHolidays,
    leaveUtilizationPercent,
    expiringCarryForwardBalances,
    requestsByStatus,
  };
}
