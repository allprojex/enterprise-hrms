import type { Response, NextFunction } from "express";
import type { organizationMembershipsTable } from "@workspace/db";
import { getActiveMembership } from "../lib/membership";
import { hostnameOrganizationMismatch, shouldFailClosedForTenantResolution } from "../lib/organizationDomains";
import type { AuthenticatedRequest } from "./requireAuth";
import type { TenantAwareRequest } from "./resolveTenantHost";

export interface MembershipRequest extends AuthenticatedRequest, TenantAwareRequest {
  membership?: typeof organizationMembershipsTable.$inferSelect;
}

/**
 * Resolves an active organization_memberships row for the caller against the
 * organization ID found at `req.params[paramName]`, attaching it to the
 * request as `req.membership`. The client-supplied ID is only ever used as a
 * lookup key — access is granted solely because a live, active membership
 * row was found, never because the ID itself looked valid.
 *
 * Additionally enforces tenant-hostname consistency (Multi-Organization
 * Tenant Infrastructure): if the request's hostname resolved to a specific
 * organization (resolveTenantHost), it must match this organizationId — a
 * WWM hostname can never be used to act on Acme's data even by a caller who
 * happens to hold a real membership there, and vice versa. If tenant
 * resolution itself failed (a database error, not a clean "no tenant
 * found"), this fails closed rather than silently treating the request as
 * hostname-neutral — an infrastructure failure must never quietly remove
 * tenant isolation from what may be a genuinely tenant-bound request. No
 * super_admin exemption here: every org-scoped route retains an explicit
 * tenant context regardless of platform role (super_admin's cross-org
 * bypass is reserved to routes that are deliberately platform-scoped, e.g.
 * organizationDomains.ts's own requireSuperAdmin gate, and to the two
 * explicit entry points — login, switch-organization — that manage which
 * tenant a session is even scoped to in the first place).
 */
export function requireMembership(paramName: string = "organizationId") {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    const raw = Array.isArray(req.params[paramName]) ? req.params[paramName][0] : req.params[paramName];
    const organizationId = parseInt(raw, 10);
    if (isNaN(organizationId)) {
      res.status(400).json({ error: "Invalid organization ID" });
      return;
    }

    if (shouldFailClosedForTenantResolution(req.tenantResolutionFailed, false)) {
      res.status(503).json({ error: "Tenant resolution is temporarily unavailable" });
      return;
    }

    if (hostnameOrganizationMismatch(req.resolvedTenantOrganizationId, organizationId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const membership = await getActiveMembership(req.userId!, organizationId);
    if (!membership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    req.membership = membership;
    next();
  };
}
