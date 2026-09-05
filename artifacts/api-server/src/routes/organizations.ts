import { Router, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { CreateOrganizationBody, UpdateOrganizationBody, SuspendOrganizationBody } from "@workspace/api-zod";
import { bindTenantContext } from "../lib/requestContext";
import { classifyOperation, auditScopeMetadata } from "../lib/platformOperations/blastRadius";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
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

/**
 * Tenant identity hardening: once a caller is authorized on an organization
 * RECORD (authorizeOrganizationAction — a member holding the permission, or
 * the platform super_admin), the request is bound to that one tenant for log
 * and audit correlation. Recording only; authorization already happened.
 */
function bindOrganizationRecordContext(req: OrganizationScopedRequest, organizationId: number): void {
  bindTenantContext(organizationId, isSuperAdmin(req.user!) ? "platform_authority" : "membership");
}

function formatOrg(org: typeof organizationsTable.$inferSelect) {
  return {
    id: org.id,
    // Immutable, globally unique tenant identity — see lib/db organizations.ts.
    tenantUuid: org.tenantUuid,
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
// Platform control plane: creating a tenant is Super-Admin-only. A tenant
// user (org_admin, hr_administrator, Primary HR, custom admin, employee) must
// never provision a new organisation merely by being authenticated -- doing so
// would hand the creator org_admin + Primary HR of a brand-new tenant
// (onboardOrganization). Authority is the platform super_admin role only,
// never a tenant role name, membership or legacy users.organizationId.
router.post("/organizations", requireAuth as any, requireSuperAdmin as any, async (req: AuthenticatedRequest, res): Promise<void> => {
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
  bindOrganizationRecordContext(req, id);

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
  bindOrganizationRecordContext(req, id);

  // Tenant identity contract: the slug is the tenant CODE and is immutable
  // after creation (docs/TENANT_IDENTITY_AND_CUSTOMIZATION.md §2). It is no
  // longer part of UpdateOrganizationInput, and a client that still sends
  // one is told so explicitly rather than having it silently dropped —
  // a support engineer must be able to trust that the code they were
  // quoted yesterday still names the same tenant today. `id` and
  // `tenantUuid` are never accepted here at all (and the database refuses
  // to change them regardless — migration 0075).
  if (req.body && typeof req.body === "object" && "slug" in req.body) {
    res.status(400).json({ error: "The organization slug (tenant code) is immutable after creation" });
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
    metadata: auditScopeMetadata(classifyOperation("organization.update", { organizationId: id })),
  });

  res.json(formatOrg(updated));
});

// POST /organizations/:id/suspend
// Platform tenant lifecycle: activation/suspension of a tenant is a
// control-plane action reserved to the platform super_admin -- a tenant
// administrator cannot suspend even its own organisation.
router.post("/organizations/:id/suspend", requireAuth as any, requireSuperAdmin as any, async (req: OrganizationScopedRequest, res): Promise<void> => {
  await setOrganizationStatus(req, res, "suspended", "organization.suspended");
});

// POST /organizations/:id/reactivate
router.post("/organizations/:id/reactivate", requireAuth as any, requireSuperAdmin as any, async (req: OrganizationScopedRequest, res): Promise<void> => {
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
  bindOrganizationRecordContext(req, id);

  // Tenant identity hardening (Phase 7): suspending or reactivating a tenant
  // is a dangerous tenant-specific action, so the caller must name the
  // target twice — the id in the path AND the tenant code in the body — and
  // the two must agree. A stale screen, a mis-clicked row or a wrong id can
  // no longer suspend the wrong customer. The typed-confirmation shape is the
  // same one physical restore already uses (lib/platformOperations/restore.ts).
  const parsed = SuspendOrganizationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [before] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id)).limit(1);
  if (!before) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  if (parsed.data.confirmSlug !== before.slug) {
    res.status(400).json({ error: "confirmSlug does not match the target organization's slug" });
    return;
  }

  // Classified before anything changes: tenant-scoped, explicit target.
  const scope = classifyOperation(status === "suspended" ? "organization.suspend" : "organization.reactivate", {
    organizationId: id,
  });

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
    metadata: {
      reason: parsed.data.reason ?? null,
      tenantSlug: before.slug,
      tenantUuid: before.tenantUuid,
      ...auditScopeMetadata(scope),
    },
    outcome: "success",
  });

  res.json(formatOrg(updated));
}

export default router;
