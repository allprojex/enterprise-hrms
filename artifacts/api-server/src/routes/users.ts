import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, notificationsTable, employeesTable } from "@workspace/db";
import { UpdateMyProfileBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { resolveActiveOrganizationId, getActiveMembership } from "../lib/membership";
import { listOrganizationModules, getModuleAccess } from "../lib/organizationModules";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { listPendingApprovals } from "../lib/leaveApprovals";
import { getLeaveDashboardMetrics, type LeaveDashboardMetrics } from "../lib/leaveDashboardMetrics";

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

  const pendingApprovals = await listPendingApprovals(organizationId, ownEmployeeId, isOrgWide);

  return getLeaveDashboardMetrics({
    organizationId,
    employeeIds,
    pendingApprovalCount: pendingApprovals.length,
  });
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

  const [employees, activeModules, leaveMetrics] = await Promise.all([
    activeOrganizationId
      ? db.select().from(employeesTable).where(eq(employeesTable.organizationId, activeOrganizationId))
      : Promise.resolve([]),
    activeOrganizationId ? listOrganizationModules(activeOrganizationId) : Promise.resolve([]),
    activeOrganizationId ? resolveLeaveDashboardMetrics(req.userId!, activeOrganizationId) : Promise.resolve(null),
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
  });
});

export default router;
