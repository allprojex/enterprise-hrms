/**
 * Manager Portal (Phase 3G, W109 — Foundation & Team Overview): shared
 * server-side authorization primitives Manager Portal's own new endpoints
 * compose against, mirroring assetManagementAuthorization.ts's/
 * learningAuthorization.ts's/performanceAuthorization.ts's own shape.
 *
 * MANAGER ELIGIBILITY IS DELIBERATELY LIVE, NEVER SNAPSHOTTED (frozen plan
 * §20, Decision 2) — a user is a manager for Manager Portal purposes only
 * while their employee record is currently referenced as reportingManagerId
 * by at least one current employee. There is no `manager_portal.read`/
 * `manager.read.team` permission key (frozen plan §13/§37 — zero new
 * permissions) — access is resolved from module enablement plus this live
 * relationship, exactly like Assets' own `asset_management.read.own` +
 * live-relationship model, except Manager Portal has no permission gate at
 * all (mirroring GET /me/employee's own zero-permission precedent).
 *
 * This file introduces exactly ONE new shared helper for live
 * current-direct-report resolution (frozen plan §21) — `listLiveDirectReports`
 * — for Manager Portal's own new endpoints only. It also must never be
 * substituted for Performance's/Learning's own snapshot/workflow authority
 * helpers (frozen plan §19/§20) — this helper is for genuinely live
 * reportingManagerId semantics only.
 *
 * WS-16 Pass 2A UPDATE (§32.8, §32.9). Two corrections to the paragraph this
 * replaces, both established by direct inspection:
 *
 *   1. It listed `leaveApprovals.ts` among the direct-report implementations.
 *      That was never true — leaveApprovals.ts contains no reportingManagerId
 *      query, and its own comment states that a Department Head's queue is
 *      "never derived from reportingManagerId". Leave approval authority is
 *      department-headship authority, which is a different relationship.
 *   2. Its "no broad refactor" instruction has been superseded by OD #14, and
 *      the six genuinely equivalent implementations (assetReporting.ts,
 *      assets.ts, attendanceReporting.ts, routes/attendanceRegister.ts,
 *      routes/leaveCalendar.ts, routes/users.ts) now share one canonical
 *      helper, `listLiveDirectReportEmployeeIds` in lib/directReports.ts.
 *
 * `listLiveDirectReports` below is deliberately NOT one of them, and is frozen
 * as RETAIN — DIFFERENT SEMANTICS (§32.9 #7). See its own comment for why.
 */
import { and, eq, ne } from "drizzle-orm";
import { db, employeesTable, type Employee } from "@workspace/db";
import { resolveOwnEmployeeId } from "./leaveRequests";

export const MANAGER_PORTAL_MODULE_KEY = "manager_portal";

/**
 * "Which employee is me" for the caller, scoped to their active
 * organization — reuses W33's resolveOwnEmployeeId (employee_user_links)
 * unchanged, so Manager Portal never introduces a second "which employee is
 * me" mechanism (the same reuse pattern as resolveAssetActorEmployeeId/
 * resolveLearningActorEmployeeId/resolvePerformanceActorEmployeeId).
 */
export async function resolveManagerPortalActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
): Promise<number | null> {
  return resolveOwnEmployeeId(organizationId, applicationUserId);
}

/**
 * Live current direct reports for `managerEmployeeId` — a fresh query every
 * call, never cached, never a snapshot. Excludes employmentStatus
 * "terminated" only (employeeExitProcess.ts's own authoritative exit
 * marker, always paired with a separationDate — see W25/W... employee exit
 * process): a terminated employee's reportingManagerId is never
 * automatically cleared anywhere in this codebase (confirmed by direct
 * inspection — no exit-process code touches reportingManagerId), so without
 * this exclusion a former employee could still appear on a live manager's
 * "My Team" roster. "active"/"probation"/"on_leave"/"suspended" all remain
 * included — every one of those is still a current employee, matching this
 * endpoint's "employment status" field actually needing to distinguish them.
 * This is a deliberate, narrower filter than the six consolidated
 * direct-report scope resolvers (none of which filters by employmentStatus at
 * all, since their own purpose — bounding a workflow or report scope —
 * differs from Team Overview's own purpose of showing a live team roster).
 *
 * DO NOT "TIDY" THIS ONTO THE SHARED HELPER (§32.9 #7). WS-16 Pass 2A
 * consolidated six equivalent implementations onto
 * `listLiveDirectReportEmployeeIds` and deliberately left this one alone,
 * because the two are not the same question. Routing this through the shared
 * helper would put terminated employees back onto a live team roster;
 * teaching the shared helper this filter would silently narrow six shipped
 * scopes at once. Under Owner Decision Q4 neither is permitted, and a
 * regression test asserts the difference so a future refactor cannot erase
 * it quietly.
 * Deterministic ordering: lastName, then firstName, then id (a stable
 * tie-break) — never database natural order.
 */
export async function listLiveDirectReports(organizationId: number, managerEmployeeId: number): Promise<Employee[]> {
  const rows = await db
    .select()
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.organizationId, organizationId),
        eq(employeesTable.reportingManagerId, managerEmployeeId),
        ne(employeesTable.employmentStatus, "terminated"),
      ),
    );
  return [...rows].sort((a, b) => {
    const lastName = a.lastName.localeCompare(b.lastName);
    if (lastName !== 0) return lastName;
    const firstName = a.firstName.localeCompare(b.firstName);
    if (firstName !== 0) return firstName;
    return a.id - b.id;
  });
}
