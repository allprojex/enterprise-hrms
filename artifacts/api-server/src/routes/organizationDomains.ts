import { Router } from "express";
import type { OrganizationDomain } from "@workspace/db";
import { CreateOrganizationDomainBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { recordAuditEvent } from "../lib/auditLog";
import {
  listDomainsForOrganization,
  createDomain,
  activateDomain,
  disableDomain,
  setPrimaryDomain,
  DomainNotFoundError,
  InvalidHostnameError,
  DomainNotActiveError,
} from "../lib/organizationDomains";

const router = Router();

function formatDomain(domain: OrganizationDomain) {
  return {
    id: domain.id,
    organizationId: domain.organizationId,
    hostname: domain.hostname,
    domainType: domain.domainType,
    status: domain.status,
    isPrimary: domain.isPrimary,
    verifiedAt: domain.verifiedAt,
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt,
  };
}

function parseDomainId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value as string, 10);
  return isNaN(id) ? null : id;
}

function parseOrganizationId(raw: unknown): number | null {
  return parseDomainId(raw);
}

// GET /organizations/:organizationId/domains
router.get(
  "/organizations/:organizationId/domains",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req.params.organizationId);
    if (organizationId == null) {
      res.status(400).json({ error: "Invalid organization ID" });
      return;
    }
    const domains = await listDomainsForOrganization(organizationId);
    res.json(domains.map(formatDomain));
  },
);

// POST /organizations/:organizationId/domains
router.post(
  "/organizations/:organizationId/domains",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req.params.organizationId);
    if (organizationId == null) {
      res.status(400).json({ error: "Invalid organization ID" });
      return;
    }

    const parsed = CreateOrganizationDomainBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const domain = await createDomain({
        organizationId,
        hostname: parsed.data.hostname,
        domainType: parsed.data.domainType,
      });
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        organizationId,
        eventType: "organization_domain.created",
        targetType: "organization_domain",
        targetId: String(domain.id),
        afterState: formatDomain(domain),
      });
      res.status(201).json(formatDomain(domain));
    } catch (err) {
      if (err instanceof InvalidHostnameError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/domains/:id/activate
router.post(
  "/organizations/:organizationId/domains/:id/activate",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req.params.organizationId);
    const domainId = parseDomainId(req.params.id);
    if (organizationId == null || domainId == null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    try {
      const domain = await activateDomain(organizationId, domainId);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        organizationId,
        eventType: "organization_domain.activated",
        targetType: "organization_domain",
        targetId: String(domain.id),
        afterState: formatDomain(domain),
      });
      res.json(formatDomain(domain));
    } catch (err) {
      if (err instanceof DomainNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/domains/:id/disable
router.post(
  "/organizations/:organizationId/domains/:id/disable",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req.params.organizationId);
    const domainId = parseDomainId(req.params.id);
    if (organizationId == null || domainId == null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    try {
      const domain = await disableDomain(organizationId, domainId);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        organizationId,
        eventType: "organization_domain.disabled",
        targetType: "organization_domain",
        targetId: String(domain.id),
        afterState: formatDomain(domain),
      });
      res.json(formatDomain(domain));
    } catch (err) {
      if (err instanceof DomainNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/domains/:id/set-primary
router.post(
  "/organizations/:organizationId/domains/:id/set-primary",
  requireAuth as any,
  requireSuperAdmin,
  async (req: AuthenticatedRequest, res): Promise<void> => {
    const organizationId = parseOrganizationId(req.params.organizationId);
    const domainId = parseDomainId(req.params.id);
    if (organizationId == null || domainId == null) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    try {
      const domain = await setPrimaryDomain(organizationId, domainId);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        organizationId,
        eventType: "organization_domain.primary_set",
        targetType: "organization_domain",
        targetId: String(domain.id),
        afterState: formatDomain(domain),
      });
      res.json(formatDomain(domain));
    } catch (err) {
      if (err instanceof DomainNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof DomainNotActiveError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
