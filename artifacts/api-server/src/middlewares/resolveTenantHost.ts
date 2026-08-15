import type { Response, NextFunction } from "express";
import { resolveTenantByHostname } from "../lib/organizationDomains";
import { logger } from "../lib/logger";
import type { AuthenticatedRequest } from "./requireAuth";

export interface TenantAwareRequest extends AuthenticatedRequest {
  // The organization a browsed hostname resolves to, or null if resolution
  // completed and found no tenant bound to this hostname (the platform's own
  // base domain, an unmapped host, a plain API-only call — a definite,
  // trustworthy negative). Never treat a non-null value here as
  // authorization by itself — see organizationDomains.ts's module doc
  // comment.
  resolvedTenantOrganizationId?: number | null;
  // True only when resolution itself could not complete (a thrown error —
  // most realistically a database failure) — this is NOT the same as "no
  // tenant found" above, and must never be treated as such. Consumers that
  // enforce tenant-hostname consistency (requireMembership,
  // requireActiveOrganizationMembership, /auth/login,
  // /auth/switch-organization) must fail closed when this is true, since an
  // error means the true tenant status of this request is unknown, not
  // confirmed absent. Routes that don't consult tenant context at all
  // (health checks, platform-admin domain management, GET /tenant-context
  // itself) are unaffected either way — they were never conditioned on
  // resolvedTenantOrganizationId to begin with.
  tenantResolutionFailed?: boolean;
}

/**
 * Global, runs before the router and before requireAuth (login itself needs
 * tenant context). Resolves purely for informational/consistency use
 * downstream — it never blocks a request on its own; only the specific
 * consumers listed above decide what to do with the result, including what
 * to do about tenantResolutionFailed.
 *
 * Host precedence: the real `Host` header (req.hostname, what Nginx passes
 * through unmodified in production, so wwm.example-hrms.com and
 * acme.example-hrms.com genuinely differ here) is tried first; the
 * `X-Tenant-Hostname` header is a fallback for this project's split-port
 * dev setup, where the frontend (wwm.localhost:5173) and API
 * (localhost:3001) are different origins and Vite's proxy rewrites the Host
 * header before the API ever sees it — see docs/TENANT_DOMAINS_AND_ACCESS.md.
 *
 * Never throws and never itself sends a response — a resolution failure is
 * recorded as data (tenantResolutionFailed), not as a crashed request; it is
 * downstream consumers' job to fail closed on it where that matters. This is
 * what keeps this middleware safe to run globally, including inside every
 * pre-existing test's own @workspace/db mock that has never heard of
 * organization_domains: those mocks either don't throw at all (most of
 * them), in which case resolution simply, correctly finds nothing; or they
 * do throw, in which case tenantResolutionFailed is set and only the four
 * tenant-consistency call sites act on it — see
 * resolveTenantHostFailOpen.test.ts and tenantHostSecurity.test.ts.
 */
export async function resolveTenantHost(req: TenantAwareRequest, _res: Response, next: NextFunction): Promise<void> {
  const candidates = [req.hostname, req.header("x-tenant-hostname")].filter(
    (h): h is string => typeof h === "string" && h.length > 0,
  );

  let resolvedOrganizationId: number | null = null;
  let resolutionFailed = false;

  for (const candidate of candidates) {
    try {
      const resolved = await resolveTenantByHostname(candidate);
      if (resolved) {
        resolvedOrganizationId = resolved.organizationId;
        resolutionFailed = false;
        break;
      }
    } catch (err) {
      resolutionFailed = true;
      logger.error({ err, candidate }, "tenant hostname resolution failed");
    }
  }

  req.resolvedTenantOrganizationId = resolvedOrganizationId;
  req.tenantResolutionFailed = resolutionFailed;
  next();
}
