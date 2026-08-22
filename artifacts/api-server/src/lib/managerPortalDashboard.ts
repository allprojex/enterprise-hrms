/**
 * Manager Portal — Dashboard (Phase 3G, W110). Frozen tile set (frozen plan
 * §26/Decision 9, refined in this workstream's own W110 charter): Direct
 * Reports, Attendance "Absent or Late Today", Pending Leave Actions,
 * Pending Performance Actions, Pending Learning Actions, Team Assets In
 * Custody. No invented score/percentage/KPI tile.
 *
 * CROSS-MODULE AUTHORIZATION INVARIANT (frozen plan §19/§23 of the W110
 * charter): this file never redefines who is authorized for a module's own
 * data. Every tile reuses that module's own existing, unmodified
 * service/authorization functions — W109's `listLiveDirectReports` is used
 * ONLY for Direct Reports/Attendance/Assets (all three already use a live
 * reportingManagerId model in their own right, per the frozen plan's own
 * §20 "Live vs Snapshot" table). Performance and Learning each resolve
 * their OWN authoritative relationship (reviewer-of-record snapshot /
 * manager-of-record snapshot) via their own existing actor-resolvers and
 * list functions — never via listLiveDirectReports, which would silently
 * substitute a live relationship for a snapshot one.
 *
 * UNAVAILABLE vs ZERO (mirrors routes/users.ts's own established
 * `resolveLeaveDashboardMetrics` convention exactly — "Returns null (never
 * zero-filled) when the module is disabled"): a tile is `null` when its
 * underlying module is disabled for the organization, OR when the caller
 * lacks that module's own existing permission (frozen plan §28's own "each
 * tile independently requires whatever permission its own underlying
 * module already requires" — silently omitted, never a 403 for the whole
 * dashboard). A tile is a real number — including 0 — whenever the module
 * is enabled, the caller is authorized, and the query genuinely found
 * nothing. This is the one signal the DTO needs; no further per-tile status
 * structure is invented.
 *
 * ATTENDANCE TIMEZONE EDGE CASE (disclosed, not a STOP): Attendance's own
 * `getAttendanceRegisterForEmployees` hard-errors
 * (OrganizationTimezoneNotConfiguredError) when the organization's
 * general.timezone config is unset — a deliberate pre-existing W66 design
 * choice ("a silent UTC fallback risks systematically wrong 'late'
 * calculations"). Rather than letting that error take down the entire
 * dashboard response, this file catches it and treats the Attendance tile
 * as unavailable (`null`) — the same signal already used for
 * disabled/unauthorized, since "attendance enabled but not yet
 * operationally configured" is functionally the same "nothing safe to show
 * yet" state from this endpoint's own perspective. This is an engineering
 * choice about error isolation, not a business-rule ambiguity — disclosed
 * here and in the W110 final report rather than silently absorbed.
 */
import { getModuleAccess } from "./organizationModules";
import { hasPermission } from "./permissions";
import { resolveManagerPortalActorEmployeeId, listLiveDirectReports } from "./managerPortalAuthorization";
import {
  getAttendanceRegisterForEmployees,
  OrganizationTimezoneNotConfiguredError,
} from "./attendanceDailySummary";
import { resolveOrganizationTodayCivilDate } from "./attendanceReporting";
import { listPendingApprovals } from "./leaveApprovals";
import { resolvePerformanceActorEmployeeId } from "./performanceAuthorization";
import { listTeamReviews } from "./performanceManagerReview";
import { resolveLearningActorEmployeeId } from "./learningAuthorization";
import { listTeamEnrollments } from "./learningEnrollments";
import { resolveAssetActorEmployeeId, ASSET_MANAGEMENT_MODULE_KEY } from "./assetManagementAuthorization";
import { listTeamAssetAssignments } from "./assets";

export interface ManagerPortalDashboard {
  linked: boolean;
  directReportsCount: number;
  attendanceAbsentOrLateTodayCount: number | null;
  pendingLeaveActionsCount: number | null;
  pendingPerformanceActionsCount: number | null;
  pendingLearningActionsCount: number | null;
  teamAssetsInCustodyCount: number | null;
}

async function resolveAttendanceAbsentOrLateTodayCount(
  organizationId: number,
  membershipId: number,
  directReportIds: number[],
): Promise<number | null> {
  const moduleAccess = await getModuleAccess(organizationId, "attendance");
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "attendance.read.own"))) return null;
  if (directReportIds.length === 0) return 0;

  try {
    const today = await resolveOrganizationTodayCivilDate(organizationId);
    const rows = await getAttendanceRegisterForEmployees(organizationId, directReportIds, today, today);
    let count = 0;
    for (const row of rows) {
      const status = row.summaries[0]?.status;
      if (status === "absent" || status === "late") count += 1;
    }
    return count;
  } catch (err) {
    if (err instanceof OrganizationTimezoneNotConfiguredError) return null;
    throw err;
  }
}

/**
 * Direct-reports-only for a plain manager; org-wide if the caller separately
 * holds leave_request.manage — reuses listPendingApprovals's own existing
 * isOrgWide branch verbatim (frozen plan §31, explicit Decision-4 carve-out
 * for Leave specifically, unlike Attendance/Assets/Learning which stay
 * strictly direct-report scoped even for HR/admin).
 */
async function resolvePendingLeaveActionsCount(organizationId: number, membershipId: number, managerEmployeeId: number | null): Promise<number | null> {
  const moduleAccess = await getModuleAccess(organizationId, "leave");
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "leave_request.approve"))) return null;

  const isOrgWide = await hasPermission(membershipId, "leave_request.manage");
  const requests = await listPendingApprovals(organizationId, managerEmployeeId, isOrgWide);
  return requests.length;
}

/** reviewerEmployeeId is a snapshot, never live — never substituted with listLiveDirectReports (frozen plan §19/§32). */
async function resolvePendingPerformanceActionsCount(organizationId: number, membershipId: number, applicationUserId: number): Promise<number | null> {
  const moduleAccess = await getModuleAccess(organizationId, "performance");
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "performance.review.write"))) return null;

  const reviewerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, applicationUserId);
  if (reviewerEmployeeId == null) return 0;
  const reviews = await listTeamReviews(organizationId, reviewerEmployeeId);
  return reviews.filter((r) => r.status === "manager_review").length;
}

/** managerEmployeeIdSnapshot is a snapshot, never live. Instructor-of-record work is a separate relationship, never counted here (frozen plan §33). */
async function resolvePendingLearningActionsCount(organizationId: number, membershipId: number, applicationUserId: number): Promise<number | null> {
  const moduleAccess = await getModuleAccess(organizationId, "learning");
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "learning.review.write"))) return null;

  const managerEmployeeId = await resolveLearningActorEmployeeId(organizationId, applicationUserId);
  if (managerEmployeeId == null) return 0;
  const enrollments = await listTeamEnrollments(organizationId, managerEmployeeId);
  return enrollments.filter((e) => e.approvalStatus === "pending").length;
}

/** Current custody only, live direct-report scope — reuses Assets' own listTeamAssetAssignments (W98, Decision 3) verbatim, never re-implemented here. */
async function resolveTeamAssetsInCustodyCount(organizationId: number, membershipId: number, applicationUserId: number): Promise<number | null> {
  const moduleAccess = await getModuleAccess(organizationId, ASSET_MANAGEMENT_MODULE_KEY);
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "asset_management.read.own"))) return null;

  const assetActorEmployeeId = await resolveAssetActorEmployeeId(organizationId, applicationUserId);
  const assignments = await listTeamAssetAssignments(organizationId, assetActorEmployeeId);
  return assignments.length;
}

/**
 * Resolves the caller's own Manager Portal dashboard. `linked: false` (all
 * counts zero/null as appropriate) mirrors Team Overview's own not-linked
 * precedent, never an error. Direct reports are resolved once (W109's own
 * listLiveDirectReports) and reused for Attendance's own scope; Performance/
 * Learning/Assets each resolve their own authoritative relationship
 * independently, per this file's own header note.
 */
export async function resolveManagerPortalDashboard(
  organizationId: number,
  applicationUserId: number,
  membershipId: number,
): Promise<ManagerPortalDashboard> {
  const managerEmployeeId = await resolveManagerPortalActorEmployeeId(organizationId, applicationUserId);

  const directReportIds =
    managerEmployeeId != null ? (await listLiveDirectReports(organizationId, managerEmployeeId)).map((e) => e.id) : [];

  const [attendanceAbsentOrLateTodayCount, pendingLeaveActionsCount, pendingPerformanceActionsCount, pendingLearningActionsCount, teamAssetsInCustodyCount] =
    await Promise.all([
      resolveAttendanceAbsentOrLateTodayCount(organizationId, membershipId, directReportIds),
      resolvePendingLeaveActionsCount(organizationId, membershipId, managerEmployeeId),
      resolvePendingPerformanceActionsCount(organizationId, membershipId, applicationUserId),
      resolvePendingLearningActionsCount(organizationId, membershipId, applicationUserId),
      resolveTeamAssetsInCustodyCount(organizationId, membershipId, applicationUserId),
    ]);

  return {
    linked: managerEmployeeId != null,
    directReportsCount: directReportIds.length,
    attendanceAbsentOrLateTodayCount,
    pendingLeaveActionsCount,
    pendingPerformanceActionsCount,
    pendingLearningActionsCount,
    teamAssetsInCustodyCount,
  };
}
