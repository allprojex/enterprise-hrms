/**
 * Performance (Phase 3C, W73 — Performance Foundation): shared server-side
 * authorization primitives every later Performance workstream (self-
 * assessment, manager review, HR finalization, dashboard/reports, ...)
 * composes against, mirroring the frozen plan's three-tier model
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §7): own / reviewer-of-
 * record / organization-wide. There is no separate "team" or ".review"
 * permission-tier key — `performance.read.own`/`performance.write.own`/
 * `performance.review.write` cover own and reviewer-of-record; only
 * `performance.manage`/`performance.finalize` grant organization-wide
 * reach.
 *
 * "Reviewer of record" here is a *snapshotted* column
 * (`performance_reviews.reviewerEmployeeId`, fixed at review-assignment
 * time) — not a live `employees.reportingManagerId` comparison the way
 * Attendance's "team" tier is, since a later manager change must never
 * reassign an in-flight or historical review (§9). The comparison shape is
 * otherwise identical to `attendanceAuthorization.ts`'s
 * `isReportingManagerOf`.
 *
 * No Performance route or service function exists yet (that's a later
 * workstream) — every helper here is generic, taking already-resolved
 * identifiers rather than querying any Performance business table
 * directly. Mirrors attendanceAuthorization.ts's shape so every module on
 * this platform shares one authorization pattern rather than each
 * inventing its own.
 */
import { hasPermission } from "./permissions";
import { resolveOwnEmployeeId } from "./leaveRequests";

export const PERFORMANCE_MODULE_KEY = "performance";

export type PerformanceVisibilityScope = "own" | "reviewer" | "organization_wide";

/**
 * "Which employee is me" for the caller, scoped to their active
 * organization — reuses W33's resolveOwnEmployeeId (employee_user_links,
 * W14) unchanged, so Performance never introduces a second "which employee
 * is me" mechanism.
 */
export async function resolvePerformanceActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
): Promise<number | null> {
  return resolveOwnEmployeeId(organizationId, applicationUserId);
}

/** Organization-wide reach for a given performance permission — a thin, named wrapper over the existing hasPermission, not a new authorization mechanism. */
export async function hasOrgWidePerformanceAccess(membershipId: number, permissionKey: string): Promise<boolean> {
  return hasPermission(membershipId, permissionKey);
}

/** The "own" tier — a pure comparison, not a query. */
export function isOwnPerformanceRecord(actorEmployeeId: number | null, targetEmployeeId: number | null): boolean {
  return actorEmployeeId != null && targetEmployeeId != null && actorEmployeeId === targetEmployeeId;
}

/**
 * The "reviewer of record" tier — a pure comparison against a review's own
 * *snapshotted* reviewerEmployeeId column, never a live reportingManagerId
 * lookup. This function has no dependency on any Performance business
 * table.
 */
export function isReviewerOfRecord(
  actorEmployeeId: number | null,
  reviewReviewerEmployeeId: number | null,
): boolean {
  return actorEmployeeId != null && reviewReviewerEmployeeId != null && actorEmployeeId === reviewReviewerEmployeeId;
}

/**
 * Resolves which visibility tier applies, in the frozen plan's priority
 * order — organization-wide reach beats a narrower tier when both would
 * apply. Callers supply which narrower tiers already match via
 * already-resolved booleans; this function makes no query of its own.
 * Returns null when none apply (no visibility).
 */
export function resolvePerformanceVisibilityScope(params: {
  isOrgWide: boolean;
  isOwn: boolean;
  isReviewerOfRecord: boolean;
}): PerformanceVisibilityScope | null {
  if (params.isOrgWide) return "organization_wide";
  if (params.isOwn) return "own";
  if (params.isReviewerOfRecord) return "reviewer";
  return null;
}
