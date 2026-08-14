import type { Response, NextFunction } from "express";
import type { organizationMembershipsTable } from "@workspace/db";
import { getActiveMembership } from "../lib/membership";
import { hostnameOrganizationMismatch } from "../lib/organizationDomains";
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
 * happens to hold a real membership there, and vice versa.
 */
export function requireMembership(paramName: string = "organizationId") {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    const raw = Array.isArray(req.params[paramName]) ? req.params[paramName][0] : req.params[paramName];
    const organizationId = parseInt(raw, 10);
    if (isNaN(organizationId)) {
      res.status(400).json({ error: "Invalid organization ID" });
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
