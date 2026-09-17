import { Router } from "express";
import { and, eq, notInArray } from "drizzle-orm";
import { db, usersTable, notificationsTable, employeesTable, assetsTable, officeInventoryItemsTable } from "@workspace/db";
import { UpdateMyProfileBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { recordAuditEvent } from "../lib/auditLog";
import {
  AccountIdentityManagedByHrError,
  AccountProfileValidationError,
  assertNoHrOwnedChanges,
  computeAccountProfileChanges,
  isLinkedToEmployee,
  type AccountProfilePatch,
} from "../lib/accountProfile";
import { resolveActiveOrganizationId, getActiveMembership } from "../lib/membership";
import { listOrganizationModules, getModuleAccess } from "../lib/organizationModules";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { listPendingApprovals, partitionPendingApprovalsForActor } from "../lib/leaveApprovals";
import { listDepartmentsHeadedByMembership } from "../lib/departmentHeads";
import { listLiveDirectReportEmployeeIds } from "../lib/directReports";
import { getLeaveDashboardMetrics, type LeaveDashboardMetrics } from "../lib/leaveDashboardMetrics";
import {
  resolveAttendanceReportScope,
  buildAttendanceReportContext,
  resolveOrganizationTodayCivilDate,
  getAttendanceDashboard,
} from "../lib/attendanceReporting";
import { OrganizationTimezoneNotConfiguredError } from "../lib/attendanceDailySummary";

/**
 * HR Operations Dashboard (W40): resolves the same own+managed / org-wide
 * scope leaveCalendar.ts (W36) and leaveApprovals.ts (W35) already
 * establish — an HR admin (leave_request.manage) sees every figure
 * org-wide; anyone else sees their own + direct reports' (Architecture
 * Principle 5). Returns null (never zero-filled) when the "leave" module
 * is disabled for the organization, or when there's no resolvable active
 * membership to scope against.
 */
async function resolveLeaveDashboardMetrics(
  userId: number,
  organizationId: number,
): Promise<LeaveDashboardMetrics | null> {
  const moduleAccess = await getModuleAccess(organizationId, "leave");
  if (!moduleAccess.enabled) return null;

  const membership = await getActiveMembership(userId, organizationId);
  if (!membership) return null;

  const isOrgWide = await hasPermission(membership.id, "leave_request.manage");
  const ownEmployeeId = await resolveOwnEmployeeId(organizationId, userId);

  let employeeIds: number[] | null = null;
  if (!isOrgWide) {
    // WS-16 Pass 2A (§32.9 #6): shared live direct-report helper, same
    // predicate and same result as the inline query it replaces.
    const managed = await listLiveDirectReportEmployeeIds(organizationId, ownEmployeeId);
    employeeIds = [...(ownEmployeeId != null ? [ownEmployeeId] : []), ...managed];
  }

  const headedDepartmentIds = isOrgWide ? [] : await listDepartmentsHeadedByMembership(organizationId, membership.id);
  const pendingApprovals = await listPendingApprovals(organizationId, { isOrgWideHr: isOrgWide, headedDepartmentIds });
  // HR sees both approval stages; only the stage this viewer can decide is theirs to act on.
  const split = await partitionPendingApprovalsForActor(organizationId, pendingApprovals, {
    membershipId: membership.id,
    employeeId: ownEmployeeId,
    isHr: isOrgWide,
  });

  return getLeaveDashboardMetrics({
    organizationId,
    employeeIds,
    pendingApprovalCount: pendingApprovals.length,
    awaitingMyActionCount: split.actionable.length,
    awaitingOtherStageCount: split.awaitingOtherStage.length,
  });
}

export interface AttendanceDashboardMetrics {
  presentToday: number;
  totalEmployeesInScope: number;
}

/**
 * WWM Presentation Readiness: reuses W70's existing attendance dashboard
 * aggregation (attendanceReporting.ts) exactly as attendance-dashboard.tsx
 * already does — no second business-rules engine. Same null-when-disabled
 * precedent as resolveLeaveDashboardMetrics. Also returns null (rather than
 * throwing) when the organization hasn't configured a timezone yet
 * (OrganizationTimezoneNotConfiguredError) — an unconfigured attendance
 * setup is "nothing to show yet", not a dashboard-breaking error.
 */
async function resolveAttendanceDashboardMetrics(
  userId: number,
  organizationId: number,
  membershipId: number,
): Promise<AttendanceDashboardMetrics | null> {
  const moduleAccess = await getModuleAccess(organizationId, "attendance");
  if (!moduleAccess.enabled) return null;

  try {
    const scope = await resolveAttendanceReportScope({ organizationId, applicationUserId: userId, membershipId });
    const ctx = await buildAttendanceReportContext(organizationId, scope);
    const today = await resolveOrganizationTodayCivilDate(organizationId);
    const dashboard = await getAttendanceDashboard(ctx, today);
    const presentToday = dashboard.statusBreakdown.find((s) => s.status === "present")?.count ?? 0;
    return { presentToday, totalEmployeesInScope: dashboard.totalEmployeesCount };
  } catch (err) {
    if (err instanceof OrganizationTimezoneNotConfiguredError) return null;
    throw err;
  }
}

/**
 * Permission-Aware Dashboard Reconciliation: org-wide aggregate figures
 * (asset/inventory/employee counts) must never leak to a caller who
 * couldn't otherwise see them — module-enabled alone was never a
 * sufficient gate, since the module can be on for the organization while
 * this specific caller holds no reporting/write authority over it. Reuses
 * the exact permission keys each domain's own dashboard/reporting endpoint
 * already requires (asset_management.reports.read, office_inventory.reports.read)
 * — not a new permission, not a role-name heuristic. Same lightweight
 * `.length`-over-a-filtered-select style the existing totalEmployees field
 * already uses — not a new reporting engine. "Active" excludes
 * retired/lost, matching everyday usage rather than a literal enum value.
 */
async function resolveAssetDashboardMetrics(organizationId: number, membershipId: number): Promise<{ activeAssets: number } | null> {
  const moduleAccess = await getModuleAccess(organizationId, "asset_management");
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "asset_management.reports.read"))) return null;

  const rows = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(and(eq(assetsTable.organizationId, organizationId), notInArray(assetsTable.status, ["retired", "lost"])));
  return { activeAssets: rows.length };
}

async function resolveInventoryDashboardMetrics(organizationId: number, membershipId: number): Promise<{ totalItems: number } | null> {
  const moduleAccess = await getModuleAccess(organizationId, "office_inventory");
  if (!moduleAccess.enabled) return null;
  if (!(await hasPermission(membershipId, "office_inventory.reports.read"))) return null;

  const rows = await db
    .select({ id: officeInventoryItemsTable.id })
    .from(officeInventoryItemsTable)
    .where(and(eq(officeInventoryItemsTable.organizationId, organizationId), eq(officeInventoryItemsTable.status, "active")));
  return { totalItems: rows.length };
}

/**
 * "Organization employee totals" is administrative/aggregate information —
 * gated by employee.write (the same org_admin/hr_manager-only tier that
 * already gates every employee-record mutation), not the broad
 * employee.read every role holds (which only ever implies "may view the
 * directory," never "may see an aggregate headcount"). Null (never zero)
 * for a caller without it — the same "hide, don't fabricate zero" contract
 * every other dashboard metric here already follows.
 */
/**
 * Employment statuses counted as the current workforce. `suspended` and
 * `terminated` are excluded: neither is someone HR expects at work.
 */
export const ACTIVE_WORKFORCE_STATUSES = ["active", "probation", "on_leave"] as const;

async function resolveEmployeeCounts(
  organizationId: number,
  membershipId: number,
): Promise<{ total: number; active: number } | null> {
  if (!(await hasPermission(membershipId, "employee.write"))) return null;
  const rows = await db
    .select({ id: employeesTable.id, employmentStatus: employeesTable.employmentStatus })
    .from(employeesTable)
    .where(eq(employeesTable.organizationId, organizationId));
  const active = rows.filter((r) => (ACTIVE_WORKFORCE_STATUSES as readonly string[]).includes(r.employmentStatus ?? "active")).length;
  return { total: rows.length, active };
}

const router = Router();

// PATCH /users/me
// Account profile only — see lib/accountProfile.ts for why a login linked to
// an employee record may not change its name, job title or department here.
router.patch("/users/me", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = req.user!;
  let changes: AccountProfilePatch;
  try {
    changes = computeAccountProfileChanges(current, parsed.data);
    assertNoHrOwnedChanges(changes, await isLinkedToEmployee(current.id));
  } catch (err) {
    if (err instanceof AccountProfileValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof AccountIdentityManagedByHrError) {
      res.status(403).json({ error: err.message });
      return;
    }
    throw err;
  }

  let user = current;
  if (Object.keys(changes).length > 0) {
    const updated = await db.update(usersTable).set(changes).where(eq(usersTable.id, current.id)).returning();
    if (!updated.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    user = updated[0];
    // Field NAMES only: the account phone is personal data, and the audit
    // trail needs to show that (and which parts of) an identity changed.
    await recordAuditEvent({
      actorApplicationUserId: current.id,
      eventType: "user.profile_updated",
      targetType: "user",
      targetId: String(current.id),
      metadata: { changedFields: Object.keys(changes).sort() },
    });
  }
  const activeOrganizationId = await resolveActiveOrganizationId(
    req.userId!,
    req.session?.activeOrganizationId,
    user.organizationId,
  );
  res.json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
    activeOrganizationId,
    avatarUrl: user.avatarUrl,
    jobTitle: user.jobTitle,
    department: user.department,
    phoneNumber: user.phoneNumber,
    createdAt: user.createdAt,
  });
});

// GET /dashboard/summary
router.get("/dashboard/summary", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = req.user!;
  const activeOrganizationId = await resolveActiveOrganizationId(
    req.userId!,
    req.session?.activeOrganizationId,
    user.organizationId,
  );

  const activeMembership = activeOrganizationId ? await getActiveMembership(req.userId!, activeOrganizationId) : null;

  const [employeeCounts, activeModules, leaveMetrics, attendanceMetrics, assetMetrics, inventoryMetrics] = await Promise.all([
    activeOrganizationId && activeMembership
      ? resolveEmployeeCounts(activeOrganizationId, activeMembership.id)
      : Promise.resolve(null),
    activeOrganizationId ? listOrganizationModules(activeOrganizationId) : Promise.resolve([]),
    activeOrganizationId ? resolveLeaveDashboardMetrics(req.userId!, activeOrganizationId) : Promise.resolve(null),
    activeOrganizationId && activeMembership
      ? resolveAttendanceDashboardMetrics(req.userId!, activeOrganizationId, activeMembership.id)
      : Promise.resolve(null),
    activeOrganizationId && activeMembership
      ? resolveAssetDashboardMetrics(activeOrganizationId, activeMembership.id)
      : Promise.resolve(null),
    activeOrganizationId && activeMembership
      ? resolveInventoryDashboardMetrics(activeOrganizationId, activeMembership.id)
      : Promise.resolve(null),
  ]);

  const unreadNotifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id));

  const unreadCount = unreadNotifications.filter((n) => !n.read).length;

  res.json({
    totalEmployees: employeeCounts?.total ?? null,
    activeEmployees: employeeCounts?.active ?? null,
    activeModules: activeModules.filter((m) => m.enabled).length,
    unreadNotifications: unreadCount,
    leaveMetrics,
    attendanceMetrics,
    assetMetrics,
    inventoryMetrics,
  });
});

export default router;
