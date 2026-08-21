/**
 * Asset Management (Phase 3E, W95 — Foundation & Module Activation): shared
 * server-side authorization primitives every later Assets workstream
 * (register, assignment/custody, ESS/manager views, incidents, maintenance,
 * evidence, dashboard/reporting, ...) composes against, mirroring the
 * frozen plan's three-tier model
 * (docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §15): own / manager-current-
 * direct-report / organization-wide. There is no separate "team" permission
 * tier key — `asset_management.read.own`/`.write.own`/`.reports.read` cover
 * own and manager-current-direct-report scope; only `asset_management.manage`
 * grants organization-wide reach.
 *
 * MANAGER SCOPE IS DELIBERATELY LIVE, NEVER SNAPSHOTTED (Owner Decision 3,
 * §0/§15) — unlike Learning's own `isManagerOfRecord` (which compares
 * against a *snapshotted* column, since an enrollment's own historical
 * manager-of-record must never change retroactively), Assets' own manager
 * visibility is resolved from the target employee's *current*
 * `reportingManagerId` at request time. This is why `asset_assignments`
 * (lib/db/src/schema/asset-assignments.ts) has no
 * `managerEmployeeIdSnapshot` column at all — the frozen plan's own §14
 * explicitly forbids snapshotting manager authority here. It also means
 * manager visibility is CURRENT-ASSIGNMENTS-ONLY, not historical (§0,
 * Decision 3) — a manager who stops managing an employee immediately loses
 * visibility, including retroactively into what was previously visible;
 * only the employee's own `.read.own` and org-wide `.manage` ever reach
 * historical (closed) assignment rows.
 *
 * No Assets route or service function exists yet (that's a later
 * workstream) — every helper here is generic, taking already-resolved
 * identifiers rather than querying any Assets business table directly,
 * mirroring learningAuthorization.ts's/performanceAuthorization.ts's own
 * shape exactly.
 */
import { hasPermission } from "./permissions";
import { resolveOwnEmployeeId } from "./leaveRequests";

export const ASSET_MANAGEMENT_MODULE_KEY = "asset_management";

export type AssetVisibilityScope = "own" | "manager_current_direct_report" | "organization_wide";

/**
 * "Which employee is me" for the caller, scoped to their active
 * organization — reuses W33's resolveOwnEmployeeId (employee_user_links)
 * unchanged, so Assets never introduces a second "which employee is me"
 * mechanism.
 */
export async function resolveAssetActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
): Promise<number | null> {
  return resolveOwnEmployeeId(organizationId, applicationUserId);
}

/** Organization-wide reach for a given Assets permission — a thin, named wrapper over the existing hasPermission, not a new authorization mechanism. */
export async function hasOrgWideAssetAccess(membershipId: number, permissionKey: string): Promise<boolean> {
  return hasPermission(membershipId, permissionKey);
}

/** The "own" tier — a pure comparison, not a query. */
export function isOwnAssetRecord(actorEmployeeId: number | null, targetEmployeeId: number | null): boolean {
  return actorEmployeeId != null && targetEmployeeId != null && actorEmployeeId === targetEmployeeId;
}

/**
 * The "manager, current direct report only" tier (Owner Decision 3) — a
 * pure comparison against the target employee's own *live*
 * `reportingManagerId` (resolved by the caller from a fresh `employees`
 * query, never from any Assets table) — never a snapshotted value. This
 * function has no dependency on any Assets business table, and this file
 * makes no query of its own.
 */
export function isCurrentManagerOfEmployee(actorEmployeeId: number | null, targetEmployeeReportingManagerId: number | null): boolean {
  return actorEmployeeId != null && targetEmployeeReportingManagerId != null && actorEmployeeId === targetEmployeeReportingManagerId;
}

/**
 * Resolves which visibility tier applies, in the frozen plan's priority
 * order — organization-wide reach beats a narrower tier when both would
 * apply. Callers supply which narrower tiers already match via
 * already-resolved booleans; this function makes no query of its own.
 * Returns null when none apply (no visibility). Note there is no
 * instructor-of-record-equivalent tier here (unlike Learning) — Assets has
 * no third relationship beyond own/manager/org-wide.
 */
export function resolveAssetVisibilityScope(params: {
  isOrgWide: boolean;
  isOwn: boolean;
  isCurrentManager: boolean;
}): AssetVisibilityScope | null {
  if (params.isOrgWide) return "organization_wide";
  if (params.isOwn) return "own";
  if (params.isCurrentManager) return "manager_current_direct_report";
  return null;
}
