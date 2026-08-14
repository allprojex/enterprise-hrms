import type { Response, NextFunction } from "express";
import { resolveTenantByHostname } from "../lib/organizationDomains";
import type { AuthenticatedRequest } from "./requireAuth";

export interface TenantAwareRequest extends AuthenticatedRequest {
  // The organization a browsed hostname resolves to, or null if the current
  // request's hostname isn't bound to any tenant (the platform's own base
  // domain, an unmapped host, or a plain API-only call). Never treat a
  // non-null value here as authorization by itself — see
  // organizationDomains.ts's module doc comment.
  resolvedTenantOrganizationId?: number | null;
}

/**
 * Global, runs before the router and before requireAuth (login itself needs
 * tenant context). Resolves purely for informational/consistency use
 * downstream (requireMembership, requireActiveOrganizationMembership,
 * /auth/login, /auth/switch-organization) — it never blocks a request on
 * its own.
 *
 * Host precedence: the real `Host` header (req.hostname, what Nginx passes
 * through unmodified in production, so wwm.example-hrms.com and
 * acme.example-hrms.com genuinely differ here) is tried first; the
 * `X-Tenant-Hostname` header is a fallback for this project's split-port
 * dev setup, where the frontend (wwm.localhost:5173) and API
 * (localhost:3001) are different origins and Vite's proxy rewrites the Host
 * header before the API ever sees it — see docs/TENANT_DOMAINS_AND_ACCESS.md.
 *
 * Deliberately fails open: any error (including a test's mocked
 * @workspace/db not knowing about organization_domains) resolves to no
 * tenant context rather than breaking the request, matching "unknown
 * hostname fails safely."
 */
export async function resolveTenantHost(req: TenantAwareRequest, _res: Response, next: NextFunction): Promise<void> {
  try {
    const candidates = [req.hostname, req.header("x-tenant-hostname")].filter(
      (h): h is string => typeof h === "string" && h.length > 0,
    );

    let resolvedOrganizationId: number | null = null;
    for (const candidate of candidates) {
      const resolved = await resolveTenantByHostname(candidate);
      if (resolved) {
        resolvedOrganizationId = resolved.organizationId;
        break;
      }
    }
    req.resolvedTenantOrganizationId = resolvedOrganizationId;
  } catch {
    req.resolvedTenantOrganizationId = null;
  }
  next();
}
