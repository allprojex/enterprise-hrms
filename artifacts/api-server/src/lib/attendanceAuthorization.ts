/**
 * Attendance (Phase 3B, W64 — Attendance Foundation): shared server-side
 * authorization primitives every later Attendance workstream (self-service
 * clocking, manual entry, register, correction requests, ...) composes
 * against, mirroring the frozen plan's three-tier model
 * (docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md §4): own / team (direct
 * reports, via employees.reportingManagerId) / organization-wide. There is
 * no separate "team" permission key — `attendance.read.own` covers both the
 * own and team tiers per the frozen plan's permission matrix; only
 * `attendance.manage` grants organization-wide reach.
 *
 * No Attendance route or service function exists yet (that's a later
 * workstream) — every helper here is generic, taking already-resolved
 * identifiers rather than querying attendance_events/attendance_adjustments
 * directly. Mirrors recruitmentAuthorization.ts's shape so both modules
 * share one authorization pattern rather than each inventing its own.
 */
import { hasPermission } from "./permissions";
import { resolveOwnEmployeeId } from "./leaveRequests";

export const ATTENDANCE_MODULE_KEY = "attendance";

export type AttendanceVisibilityScope = "own" | "team" | "organization_wide";

/**
 * "Which employee is me" for the caller, scoped to their active
 * organization — reuses W33's resolveOwnEmployeeId (employee_user_links,
 * W14) unchanged, so Attendance never introduces a second "which employee is
 * me" mechanism.
 */
export async function resolveAttendanceActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
): Promise<number | null> {
  return resolveOwnEmployeeId(organizationId, applicationUserId);
}

/** Organization-wide reach for a given attendance permission — a thin, named wrapper over the existing hasPermission, not a new authorization mechanism. */
export async function hasOrgWideAttendanceAccess(membershipId: number, permissionKey: string): Promise<boolean> {
  return hasPermission(membershipId, permissionKey);
}

/** The "own" tier — a pure comparison, not a query. */
export function isOwnAttendanceRecord(actorEmployeeId: number | null, targetEmployeeId: number | null): boolean {
  return actorEmployeeId != null && targetEmployeeId != null && actorEmployeeId === targetEmployeeId;
}

/**
 * The "team" tier (direct reports only — no multi-level hierarchy walk) — a
 * pure comparison against the target employee's already-resolved
 * reportingManagerId column. This function has no dependency on any
 * Attendance business table.
 */
export function isReportingManagerOf(
  actorEmployeeId: number | null,
  targetReportingManagerId: number | null,
): boolean {
  return actorEmployeeId != null && targetReportingManagerId != null && actorEmployeeId === targetReportingManagerId;
}

/**
 * Resolves which visibility tier applies, in the frozen plan's priority
 * order — organization-wide reach beats a narrower tier when both would
 * apply. Callers supply which narrower tiers already match via
 * already-resolved booleans; this function makes no query of its own.
 * Returns null when none apply (no visibility).
 */
export function resolveAttendanceVisibilityScope(params: {
  isOrgWide: boolean;
  isOwn: boolean;
  isManagerOfTarget: boolean;
}): AttendanceVisibilityScope | null {
  if (params.isOrgWide) return "organization_wide";
  if (params.isOwn) return "own";
  if (params.isManagerOfTarget) return "team";
  return null;
}
