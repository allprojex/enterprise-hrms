/**
 * Learning (Phase 3D, W85 — Learning Foundation): shared server-side
 * authorization primitives every later Learning workstream (catalog,
 * enrollment/assignment, ESS, manager/instructor actions, certificates,
 * dashboard/reporting, ...) composes against, mirroring the frozen plan's
 * three-tier model (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §7): own /
 * manager-or-instructor-of-record / organization-wide. There is no separate
 * "team" permission tier key — `learning.read.own`/`learning.write.own`/
 * `learning.review.write` cover own and manager-or-instructor-of-record;
 * only `learning.manage`/`learning.reports.read` grant organization-wide
 * reach.
 *
 * TWO DISTINCT "OF RECORD" RELATIONSHIPS share the single
 * `learning.review.write` key (§7, §13), dispatched server-side by the
 * caller, never a client-supplied flag:
 *   - "Manager of record" — a *snapshotted* column
 *     (`learning_enrollments.managerEmployeeIdSnapshot`, fixed at
 *     enrollment-creation time from `employees.reportingManagerId`) — not a
 *     live `reportingManagerId` comparison, since a later manager change
 *     must never reassign an in-flight or historical enrollment (§9).
 *   - "Instructor of record" — a *live* comparison against a session's own
 *     `instructorEmployeeId` (`learning_course_sessions`), since a session's
 *     instructor assignment is itself the live authorization boundary, not
 *     a piece of enrollment history to snapshot.
 * Both comparison shapes are otherwise identical to
 * `performanceAuthorization.ts`'s `isReviewerOfRecord`.
 *
 * No Learning route or service function exists yet (that's a later
 * workstream) — every helper here is generic, taking already-resolved
 * identifiers rather than querying any Learning business table directly.
 * Mirrors performanceAuthorization.ts's shape so every module on this
 * platform shares one authorization pattern rather than each inventing its
 * own.
 */
import { hasPermission } from "./permissions";
import { resolveOwnEmployeeId } from "./leaveRequests";

export const LEARNING_MODULE_KEY = "learning";

export type LearningVisibilityScope = "own" | "manager_of_record" | "instructor_of_record" | "organization_wide";

/**
 * "Which employee is me" for the caller, scoped to their active
 * organization — reuses W33's resolveOwnEmployeeId (employee_user_links)
 * unchanged, so Learning never introduces a second "which employee is me"
 * mechanism.
 */
export async function resolveLearningActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
): Promise<number | null> {
  return resolveOwnEmployeeId(organizationId, applicationUserId);
}

/** Organization-wide reach for a given Learning permission — a thin, named wrapper over the existing hasPermission, not a new authorization mechanism. */
export async function hasOrgWideLearningAccess(membershipId: number, permissionKey: string): Promise<boolean> {
  return hasPermission(membershipId, permissionKey);
}

/** The "own" tier — a pure comparison, not a query. */
export function isOwnLearningRecord(actorEmployeeId: number | null, targetEmployeeId: number | null): boolean {
  return actorEmployeeId != null && targetEmployeeId != null && actorEmployeeId === targetEmployeeId;
}

/**
 * The "manager of record" tier — a pure comparison against an enrollment's
 * own *snapshotted* managerEmployeeIdSnapshot column, never a live
 * reportingManagerId lookup. This function has no dependency on any
 * Learning business table.
 */
export function isManagerOfRecord(actorEmployeeId: number | null, managerEmployeeIdSnapshot: number | null): boolean {
  return actorEmployeeId != null && managerEmployeeIdSnapshot != null && actorEmployeeId === managerEmployeeIdSnapshot;
}

/**
 * The "instructor of record" tier — a pure comparison against a session's
 * own *live* instructorEmployeeId column. Unlike managerEmployeeIdSnapshot,
 * this is intentionally not a snapshot: a session's instructor assignment
 * is itself the current authorization boundary for that session, not a
 * piece of an individual enrollment's history.
 */
export function isInstructorOfRecord(actorEmployeeId: number | null, sessionInstructorEmployeeId: number | null): boolean {
  return actorEmployeeId != null && sessionInstructorEmployeeId != null && actorEmployeeId === sessionInstructorEmployeeId;
}

/**
 * Resolves which visibility tier applies, in the frozen plan's priority
 * order — organization-wide reach beats a narrower tier when both would
 * apply; manager-of-record and instructor-of-record are independent,
 * non-exclusive tiers (an employee who is both is authorized on each
 * relationship separately, per §13). Callers supply which narrower tiers
 * already match via already-resolved booleans; this function makes no
 * query of its own. Returns null when none apply (no visibility).
 */
export function resolveLearningVisibilityScope(params: {
  isOrgWide: boolean;
  isOwn: boolean;
  isManagerOfRecord: boolean;
  isInstructorOfRecord: boolean;
}): LearningVisibilityScope | null {
  if (params.isOrgWide) return "organization_wide";
  if (params.isOwn) return "own";
  if (params.isManagerOfRecord) return "manager_of_record";
  if (params.isInstructorOfRecord) return "instructor_of_record";
  return null;
}
