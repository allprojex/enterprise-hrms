import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { listInstallationsForOrganization } from "../lib/installations";
import { SetTenantFeatureFlagBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import type { TenantAwareRequest } from "../middlewares/resolveTenantHost";
import {
  hostnameOrganizationMismatch,
  shouldFailClosedForTenantResolution,
  listDomainsForOrganization,
} from "../lib/organizationDomains";
import { listOrganizationModules } from "../lib/organizationModules";
import { featureFlags, UnknownFeatureFlagError } from "../lib/featureFlags";
import { classifyOperation, auditScopeMetadata } from "../lib/platformOperations/blastRadius";
import { recordAuditEvent } from "../lib/auditLog";
import { bindTenantContext } from "../lib/requestContext";
import { releaseInfo } from "../lib/releaseInfo";
import { FEATURE_FLAG_KEY_PATTERN } from "../lib/featureFlagRegistry";

/**
 * Platform (super_admin) tenant surface — tenant identity hardening, Phases
 * 6 and 7.
 *
 * Every route here is PLATFORM-scoped: it requires the platform super_admin
 * role, never a membership, because its purpose is for the platform owner to
 * identify and operate on a specific tenant they may not be a member of.
 * The target tenant is always an explicit path parameter — never the
 * session's active organization, never a hostname — and every mutation is
 * audited against that explicit target with its blast radius.
 *
 * Nothing here reads HR data. The identity card is organization metadata,
 * hosting/deployment identity, hostnames, module and flag state — what an
 * operator needs to say "I am about to act on THIS tenant" and nothing else.
 *
 * Tenant-hostname consistency (Multi-Organization Tenant Infrastructure) is
 * enforced exactly as routes/organizations.ts does for the organization
 * record: from the platform's own base domain (no resolved tenant) these
 * routes work for any organization; from a hostname bound to organization A
 * they refuse to operate on organization B, super_admin or not.
 */
const router = Router();

type PlatformTenantRequest = AuthenticatedRequest & TenantAwareRequest;

function parseOrganizationId(req: PlatformTenantRequest, res: Response): number | null {
  const raw = Array.isArray(req.params.organizationId) ? req.params.organizationId[0] : req.params.organizationId;
  const organizationId = parseInt(raw, 10);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    res.status(400).json({ error: "Invalid organization ID" });
    return null;
  }
  if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, false)) {
    res.status(503).json({ error: "Tenant resolution is temporarily unavailable" });
    return null;
  }
  if (hostnameOrganizationMismatch(req.resolvedTenantOrganizationId, organizationId)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return organizationId;
}

async function loadOrganization(organizationId: number) {
  const [organization] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);
  return organization ?? null;
}

// GET /platform/organizations/:organizationId/identity
router.get(
  "/platform/organizations/:organizationId/identity",
  requireAuth as any,
  requireSuperAdmin as any,
  async (req: PlatformTenantRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req, res);
    if (organizationId == null) return;

    const organization = await loadOrganization(organizationId);
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    bindTenantContext(organizationId, "platform_authority");

    const [installations, domains, modules, flags] = await Promise.all([
      listInstallationsForOrganization(organizationId),
      listDomainsForOrganization(organizationId),
      listOrganizationModules(organizationId),
      featureFlags.list(organizationId),
    ]);

    res.json({
      organization: {
        id: organization.id,
        tenantUuid: organization.tenantUuid,
        slug: organization.slug,
        name: organization.name,
        type: organization.type,
        status: organization.status,
        createdAt: organization.createdAt,
      },
      runtime: releaseInfo(),
      installations,
      domains: domains.map((domain) => ({
        id: domain.id,
        hostname: domain.hostname,
        domainType: domain.domainType,
        status: domain.status,
        isPrimary: domain.isPrimary,
      })),
      modules: modules.map((module) => ({ key: module.key, name: module.name, status: module.status, enabled: module.enabled })),
      featureFlags: flags,
    });
  },
);

// GET /platform/organizations/:organizationId/feature-flags
router.get(
  "/platform/organizations/:organizationId/feature-flags",
  requireAuth as any,
  requireSuperAdmin as any,
  async (req: PlatformTenantRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req, res);
    if (organizationId == null) return;
    const organization = await loadOrganization(organizationId);
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    bindTenantContext(organizationId, "platform_authority");
    res.json(await featureFlags.list(organizationId));
  },
);

// PUT /platform/organizations/:organizationId/feature-flags/:flagKey
router.put(
  "/platform/organizations/:organizationId/feature-flags/:flagKey",
  requireAuth as any,
  requireSuperAdmin as any,
  async (req: PlatformTenantRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req, res);
    if (organizationId == null) return;

    const flagKey = Array.isArray(req.params.flagKey) ? req.params.flagKey[0] : req.params.flagKey;
    if (!FEATURE_FLAG_KEY_PATTERN.test(flagKey)) {
      res.status(400).json({ error: "Invalid feature flag key" });
      return;
    }

    const parsed = SetTenantFeatureFlagBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organization = await loadOrganization(organizationId);
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    bindTenantContext(organizationId, "platform_authority");

    // Classified BEFORE anything changes: a tenant-scoped operation with an
    // explicit target organization. If this ever throws, nothing was written.
    const scope = classifyOperation("organization.feature_flag.set", { organizationId });

    try {
      const before = await featureFlags.isEnabled(organizationId, flagKey);
      const state = await featureFlags.set(organizationId, flagKey, parsed.data.enabled);

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        organizationId,
        eventType: state.enabled ? "feature_flag.enabled" : "feature_flag.disabled",
        targetType: "feature_flag",
        targetId: flagKey,
        beforeState: { enabled: before },
        afterState: { enabled: state.enabled, level: state.level },
        metadata: {
          reason: parsed.data.reason,
          tenantSlug: organization.slug,
          tenantUuid: organization.tenantUuid,
          ...auditScopeMetadata(scope),
        },
        outcome: "success",
      });

      res.json(state);
    } catch (err) {
      if (err instanceof UnknownFeatureFlagError) {
        res.status(404).json({ error: `Unknown feature flag: ${flagKey}` });
        return;
      }
      throw err;
    }
  },
);

export default router;
