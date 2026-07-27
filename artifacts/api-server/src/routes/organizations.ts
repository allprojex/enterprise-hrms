import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { CreateOrganizationBody, UpdateOrganizationBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { canAccessOrganization, canManageOrganization, isSuperAdmin } from "../lib/authorization";
import { onboardOrganization } from "../lib/onboarding";
import { isUniqueViolation } from "../lib/dbErrors";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function formatOrg(org: typeof organizationsTable.$inferSelect) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    type: org.type,
    status: org.status,
    logoUrl: org.logoUrl,
    industry: org.industry,
    employeeCount: org.employeeCount,
    createdAt: org.createdAt,
  };
}

// GET /organizations
router.get("/organizations", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = req.user!;
  // Users see only their own organization; super_admins see all
  const orgs = await db
    .select()
    .from(organizationsTable)
    .where(isSuperAdmin(user) ? undefined : eq(organizationsTable.id, user.organizationId));

  res.json(orgs.map(formatOrg));
});

// POST /organizations
router.post("/organizations", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const parsed = CreateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const { organization } = await onboardOrganization({
      ...parsed.data,
      creatorApplicationUserId: req.userId!,
    });
    res.status(201).json(formatOrg(organization));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Slug already in use" });
      return;
    }
    throw err;
  }
});

// GET /organizations/:id
router.get("/organizations/:id", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const user = req.user!;
  if (!canAccessOrganization(user, id)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const orgs = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, id))
    .limit(1);

  if (!orgs.length) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  res.json(formatOrg(orgs[0]));
});

// PATCH /organizations/:id
router.patch("/organizations/:id", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const user = req.user!;
  if (!canManageOrganization(user, id)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = UpdateOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [before] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  try {
    const [updated] = await db
      .update(organizationsTable)
      .set(parsed.data)
      .where(eq(organizationsTable.id, id))
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: user.id,
      organizationId: id,
      eventType: "organization.updated",
      targetType: "organization",
      targetId: String(id),
      beforeState: formatOrg(before),
      afterState: formatOrg(updated),
    });

    res.json(formatOrg(updated));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "Slug already in use" });
      return;
    }
    throw err;
  }
});

// POST /organizations/:id/suspend
router.post("/organizations/:id/suspend", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  await setOrganizationStatus(req, res, "suspended", "organization.suspended");
});

// POST /organizations/:id/reactivate
router.post("/organizations/:id/reactivate", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  await setOrganizationStatus(req, res, "active", "organization.reactivated");
});

async function setOrganizationStatus(
  req: AuthenticatedRequest,
  res: Response,
  status: "active" | "suspended",
  eventType: string,
): Promise<void> {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const user = req.user!;
  if (!canManageOrganization(user, id)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [before] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const [updated] = await db
    .update(organizationsTable)
    .set({ status })
    .where(eq(organizationsTable.id, id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: user.id,
    organizationId: id,
    eventType,
    targetType: "organization",
    targetId: String(id),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  res.json(formatOrg(updated));
}

export default router;
