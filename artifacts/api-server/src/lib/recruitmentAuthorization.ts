/**
 * Recruitment (Phase 3A, W43 — Recruitment Foundation): shared server-side
 * authorization primitives every later Recruitment workstream (requisitions,
 * vacancies, candidates, applications, interviews, offers, ...) composes
 * against, mirroring the five-tier visibility model the frozen plan defines
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §7): own / assigned
 * (recruiter or hiring manager) / department / branch / organization-wide.
 *
 * No recruitment business table exists yet (that's the next workstream) —
 * every helper here is generic, taking already-resolved identifiers rather
 * than querying a requisition, vacancy, candidate, or application row
 * directly. "own" (a candidate acting on their own application) is a
 * separate authorization path entirely — a candidate session, not an
 * organization membership — and is intentionally not modeled by
 * `resolveRecruitmentVisibilityScope` below, which is for staff-side
 * (membership-based) scope resolution only.
 */
import { hasPermission } from "./permissions";
import { resolveOwnEmployeeId } from "./leaveRequests";

export const RECRUITMENT_MODULE_KEY = "recruitment";

export type RecruitmentVisibilityScope = "own" | "assigned" | "department" | "branch" | "organization_wide";

/**
 * "Which employee is me" for the caller, scoped to their active
 * organization — reuses W33's resolveOwnEmployeeId (employee_user_links,
 * W14) unchanged, so Recruitment never introduces a second "which employee
 * is me" mechanism.
 */
export async function resolveRecruitmentActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
): Promise<number | null> {
  return resolveOwnEmployeeId(organizationId, applicationUserId);
}

/** Organization-wide reach for a given recruitment permission — a thin, named wrapper over the existing hasPermission, not a new authorization mechanism. */
export async function hasOrgWideRecruitmentAccess(membershipId: number, permissionKey: string): Promise<boolean> {
  return hasPermission(membershipId, permissionKey);
}

/**
 * "Assigned" tier (recruiter or hiring manager) — a pure comparison, not a
 * query. A later workstream resolves the record's own recruiterId/
 * hiringManagerId column and passes it here; this function has no
 * dependency on any recruitment business table.
 */
export function isAssignedRecruitmentActor(
  actorEmployeeId: number | null,
  assigneeEmployeeId: number | null,
): boolean {
  return actorEmployeeId != null && assigneeEmployeeId != null && actorEmployeeId === assigneeEmployeeId;
}

/** Department-scope comparison — same "pure comparison, no query" shape as isAssignedRecruitmentActor. */
export function isSameDepartmentScope(
  actorDepartmentId: number | null,
  recordDepartmentId: number | null,
): boolean {
  return actorDepartmentId != null && recordDepartmentId != null && actorDepartmentId === recordDepartmentId;
}

/** Branch-scope comparison — same shape as isSameDepartmentScope. */
export function isSameBranchScope(actorBranchId: number | null, recordBranchId: number | null): boolean {
  return actorBranchId != null && recordBranchId != null && actorBranchId === recordBranchId;
}

/**
 * Resolves which staff-side visibility tier applies, in the frozen plan's
 * priority order — organization-wide reach beats a narrower tier when both
 * would apply. Callers supply which narrower tiers already match via
 * already-resolved booleans; this function makes no query of its own.
 * Returns null when none apply (no visibility).
 */
export function resolveRecruitmentVisibilityScope(params: {
  isOrgWide: boolean;
  isAssigned: boolean;
  isSameDepartment: boolean;
  isSameBranch: boolean;
}): RecruitmentVisibilityScope | null {
  if (params.isOrgWide) return "organization_wide";
  if (params.isAssigned) return "assigned";
  if (params.isSameDepartment) return "department";
  if (params.isSameBranch) return "branch";
  return null;
}
