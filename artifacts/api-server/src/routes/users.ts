import { Router } from "express";
import { and, eq, notInArray } from "drizzle-orm";
import { db, usersTable, notificationsTable, employeesTable, assetsTable, officeInventoryItemsTable } from "@workspace/db";
import { UpdateMyProfileBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { resolveActiveOrganizationId, getActiveMembership } from "../lib/membership";
import { listOrganizationModules, getModuleAccess } from "../lib/organizationModules";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { listPendingApprovals } from "../lib/leaveApprovals";
import { listDepartmentsHeadedByMembership } from "../lib/departmentHeads";
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
    const managed = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.reportingManagerId, ownEmployeeId ?? -1)));
    employeeIds = [...(ownEmployeeId != null ? [ownEmployeeId] : []), ...managed.map((e) => e.id)];
  }

  const headedDepartmentIds = isOrgWide ? [] : await listDepartmentsHeadedByMembership(organizationId, membership.id);
  const pendingApprovals = await listPendingApprovals(organizationId, { isOrgWideHr: isOrgWide, headedDepartmentIds });

  return getLeaveDashboardMetrics({
    organizationId,
    employeeIds,
    pendingApprovalCount: pendingApprovals.length,
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

/** Same lightweight `.length`-over-a-filtered-select style the existing totalEmployees field already uses — not a new reporting engine. "Active" excludes retired/lost, matching everyday usage rather than a literal enum value. */
async function resolveAssetDashboardMetrics(organizationId: number): Promise<{ activeAssets: number } | null> {
  const moduleAccess = await getModuleAccess(organizationId, "asset_management");
  if (!moduleAccess.enabled) return null;

  const rows = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(and(eq(assetsTable.organizationId, organizationId), notInArray(assetsTable.status, ["retired", "lost"])));
  return { activeAssets: rows.length };
}

async function resolveInventoryDashboardMetrics(organizationId: number): Promise<{ totalItems: number } | null> {
  const moduleAccess = await getModuleAccess(organizationId, "office_inventory");
  if (!moduleAccess.enabled) return null;

  const rows = await db
    .select({ id: officeInventoryItemsTable.id })
    .from(officeInventoryItemsTable)
    .where(and(eq(officeInventoryItemsTable.organizationId, organizationId), eq(officeInventoryItemsTable.status, "active")));
  return { totalItems: rows.length };
}

const router = Router();

// PATCH /users/me
router.patch("/users/me", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updated = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, req.userId!))
    .returning();

  if (!updated.length) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const user = updated[0];
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

  const [employees, activeModules, leaveMetrics, attendanceMetrics, assetMetrics, inventoryMetrics] = await Promise.all([
    activeOrganizationId
      ? db.select().from(employeesTable).where(eq(employeesTable.organizationId, activeOrganizationId))
      : Promise.resolve([]),
    activeOrganizationId ? listOrganizationModules(activeOrganizationId) : Promise.resolve([]),
    activeOrganizationId ? resolveLeaveDashboardMetrics(req.userId!, activeOrganizationId) : Promise.resolve(null),
    activeOrganizationId && activeMembership
      ? resolveAttendanceDashboardMetrics(req.userId!, activeOrganizationId, activeMembership.id)
      : Promise.resolve(null),
    activeOrganizationId ? resolveAssetDashboardMetrics(activeOrganizationId) : Promise.resolve(null),
    activeOrganizationId ? resolveInventoryDashboardMetrics(activeOrganizationId) : Promise.resolve(null),
  ]);

  const unreadNotifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id));

  const unreadCount = unreadNotifications.filter((n) => !n.read).length;

  res.json({
    totalEmployees: employees.length,
    activeModules: activeModules.filter((m) => m.enabled).length,
    unreadNotifications: unreadCount,
    leaveMetrics,
    attendanceMetrics,
    assetMetrics,
    inventoryMetrics,
  });
});

export default router;
