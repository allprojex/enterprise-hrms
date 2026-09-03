import type { Response, NextFunction } from "express";
import type { organizationMembershipsTable } from "@workspace/db";
import { getActiveMembership } from "../lib/membership";
import { hostnameOrganizationMismatch, shouldFailClosedForTenantResolution } from "../lib/organizationDomains";
import { isSuperAdmin } from "../lib/authorization";
import { getActiveGrantForActorAndOrg, type BreakGlassGrant } from "../lib/breakGlass";
import { setCurrentBreakGlassGrantId, bindTenantContext } from "../lib/requestContext";
import type { AuthenticatedRequest } from "./requireAuth";
import type { TenantAwareRequest } from "./resolveTenantHost";

export interface MembershipRequest extends AuthenticatedRequest, TenantAwareRequest {
  membership?: typeof organizationMembershipsTable.$inferSelect;
  // WS-4 (Break-Glass Access Foundation, Owner Decision #31): set instead of
  // `membership` when the caller has no real organization_memberships row
  // but does hold an active, unexpired, non-revoked break-glass grant for
  // this exact organization. requirePermission.ts checks the grant's scope
  // in this case rather than a role's permissions; requireModuleEnabled.ts
  // resolves the organization id from here when `membership` is absent.
  breakGlassGrant?: BreakGlassGrant;
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
 * implicit super_admin exemption here: every org-scoped route retains an
 * explicit tenant context regardless of platform role (super_admin's
 * cross-org bypass is reserved to routes that are deliberately
 * platform-scoped, e.g. organizationDomains.ts's own requireSuperAdmin gate,
 * and to the two explicit entry points — login, switch-organization — that
 * manage which tenant a session is even scoped to in the first place).
 *
 * WS-4 (Break-Glass Access Foundation, Owner Decision #31) adds exactly one
 * narrow exception to that rule, and only as a last resort: a super_admin
 * who has no real membership here may still proceed if — and only if — they
 * hold an active, unexpired, non-revoked break-glass grant for this exact
 * organization (getActiveGrantForActorAndOrg, re-checked live on every
 * request, never cached). This is the one place OD #31's "explicit,
 * reason-bound, organization-scoped, permission-scoped, time-limited,
 * revocable, fully audited" elevation actually takes effect — everywhere
 * else, platform-owner status still grants zero standing customer-data
 * access. req.membership stays undefined in this path; requirePermission.ts
 * and requireModuleEnabled.ts both know to fall back to req.breakGlassGrant.
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
    if (membership) {
      req.membership = membership;
      // Tenant identity hardening: this request is now bound to exactly one
      // authorized tenant for logging/audit correlation (lib/requestContext.ts).
      bindTenantContext(organizationId, "membership");
      next();
      return;
    }

    if (isSuperAdmin(req.user!)) {
      const grant = await getActiveGrantForActorAndOrg(req.userId!, organizationId);
      if (grant) {
        req.breakGlassGrant = grant;
        setCurrentBreakGlassGrantId(grant.id);
        bindTenantContext(organizationId, "break_glass");
        next();
        return;
      }
    }

    res.status(403).json({ error: "Forbidden" });
  };
}

/**
 * WS-4 (Break-Glass Access Foundation): the organization id a request is
 * scoped to, whether that came from a real membership or an active
 * break-glass grant. Route handlers that read `req.membership!.organizationId`
 * directly will throw under elevation (req.membership is undefined there) —
 * this is the safe accessor for any handler that needs to work correctly in
 * both cases. Throws only if requireMembership itself was somehow bypassed
 * (a route wiring bug, not a request the caller can trigger).
 */
export function resolveOrganizationId(req: MembershipRequest): number {
  const organizationId = req.membership?.organizationId ?? req.breakGlassGrant?.targetOrganizationId;
  if (organizationId == null) {
    throw new Error("resolveOrganizationId called on a request with neither a membership nor a break-glass grant");
  }
  return organizationId;
}

/**
 * The membership id to attribute an audit event's actorMembershipId to, or
 * null under break-glass elevation (there is no real membership row for a
 * platform actor acting under a grant — audit_events.actorMembershipId is
 * nullable specifically for cases like this; actorApplicationUserId still
 * identifies the true actor, per Owner Decision #31's true-actor
 * requirement).
 */
export function resolveActorMembershipId(req: MembershipRequest): number | null {
  return req.membership?.id ?? null;
}
