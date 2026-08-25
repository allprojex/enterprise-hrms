import { Router, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { CreateOrganizationBody, UpdateOrganizationBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import type { TenantAwareRequest } from "../middlewares/resolveTenantHost";
import { isSuperAdmin } from "../lib/authorization";
import { authorizeOrganizationAction } from "../lib/organizationAuthorization";
import { getActiveMembershipsForUser } from "../lib/membership";
import { hostnameOrganizationMismatch, shouldFailClosedForTenantResolution } from "../lib/organizationDomains";
import { onboardOrganization } from "../lib/onboarding";
import { isUniqueViolation } from "../lib/dbErrors";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

type OrganizationScopedRequest = AuthenticatedRequest & TenantAwareRequest;

/**
 * Multi-Organization Tenant Infrastructure: the single-organization routes
 * below (GET/PATCH /organizations/:id, suspend, reactivate) authorize via
 * authorizeOrganizationAction rather than the requireMembership middleware,
 * so they never inherited requireMembership's own hostname-consistency
 * guard (773bdb5) — reused here verbatim, not reimplemented, so both
 * authorization paths enforce the identical rule. Same ordering as
 * requireMembership: checked before the permission gate, so a hostname
 * mismatch is denied regardless of what the caller would otherwise be
 * allowed to do. No super_admin exemption — matches requireMembership's own
 * precedent exactly (super_admin's cross-org bypass is reserved for routes
 * that are deliberately platform-scoped, and for login/switch-organization,
 * which manage which tenant a session is scoped to in the first place; a
 * super_admin acting on a specific organization's own record, browsing from
 * a hostname bound to a *different* organization, must still be denied).
 * Never fires at all from the platform's own base domain or an unmapped
 * host, since resolvedTenantOrganizationId is null there — platform
 * administration from that context is unaffected.
 */
function tenantHostnameAllowsOrganization(req: OrganizationScopedRequest, res: Response, organizationId: number): boolean {
  if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, false)) {
    res.status(503).json({ error: "Tenant resolution is temporarily unavailable" });
    return false;
  }
  if (hostnameOrganizationMismatch(req.resolvedTenantOrganizationId, organizationId)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

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
// WS-2 (Owner Decision #1): previously filtered by the legacy
// users.organizationId single-org column, which silently hid every
// organization a multi-membership user belongs to beyond their original
// "home" org — a real, now-fixed discrepancy with GET /me/organizations
// (lib/membership.ts's getActiveMembershipsForUser), which was already
// correctly membership-based. Both routes now agree.
router.get("/organizations", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const user = req.user!;

  if (isSuperAdmin(user)) {
    const orgs = await db.select().from(organizationsTable);
    res.json(orgs.map(formatOrg));
    return;
  }

  const memberships = await getActiveMembershipsForUser(user.id);
  if (!memberships.length) {
    res.json([]);
    return;
  }

  const organizationIds = [...new Set(memberships.map((m) => m.organizationId))];
  const orgs = await db.select().from(organizationsTable).where(inArray(organizationsTable.id, organizationIds));
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
router.get("/organizations/:id", requireAuth as any, async (req: OrganizationScopedRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  if (!tenantHostnameAllowsOrganization(req, res, id)) return;

  const user = req.user!;
  if (!(await authorizeOrganizationAction(user, id, "organization.read"))) {
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
router.patch("/organizations/:id", requireAuth as any, async (req: OrganizationScopedRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }
  if (!tenantHostnameAllowsOrganization(req, res, id)) return;

  const user = req.user!;
  if (!(await authorizeOrganizationAction(user, id, "organization.update"))) {
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
router.post("/organizations/:id/suspend", requireAuth as any, async (req: OrganizationScopedRequest, res): Promise<void> => {
  await setOrganizationStatus(req, res, "suspended", "organization.suspended");
});

// POST /organizations/:id/reactivate
router.post("/organizations/:id/reactivate", requireAuth as any, async (req: OrganizationScopedRequest, res): Promise<void> => {
  await setOrganizationStatus(req, res, "active", "organization.reactivated");
});

async function setOrganizationStatus(
  req: OrganizationScopedRequest,
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
  if (!tenantHostnameAllowsOrganization(req, res, id)) return;

  const user = req.user!;
  if (!(await authorizeOrganizationAction(user, id, "organization.update"))) {
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
