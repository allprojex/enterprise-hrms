import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, notificationsTable, employeesTable } from "@workspace/db";
import { UpdateMyProfileBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { resolveActiveOrganizationId } from "../lib/membership";
import { listOrganizationModules } from "../lib/organizationModules";

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

  const [employees, activeModules] = await Promise.all([
    activeOrganizationId
      ? db.select().from(employeesTable).where(eq(employeesTable.organizationId, activeOrganizationId))
      : Promise.resolve([]),
    activeOrganizationId ? listOrganizationModules(activeOrganizationId) : Promise.resolve([]),
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
  });
});

export default router;
