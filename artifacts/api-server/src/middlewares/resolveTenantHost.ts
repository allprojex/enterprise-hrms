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
/**
 * WS-18 Pass 4, finding WS18-P4-01 — the tenant hostname must come from the
 * connection, not from a header the caller controls.
 *
 * Two client-controlled inputs were feeding tenant resolution:
 *
 *   1. `X-Tenant-Hostname`, accepted unconditionally. It exists only for this
 *      project's split-port dev setup (Vite proxy rewrites Host), but nothing
 *      confined it to development.
 *   2. `req.hostname` itself. Express derives it from `X-Forwarded-Host` — not
 *      the real Host header — whenever `trust proxy` is enabled, which is the
 *      frozen intended Production setting (OD-WS18-9, `TRUST_PROXY=1`). Unless
 *      the edge proxy overwrites that header, the caller controls it.
 *
 * Either one made `GET /tenant-context` — public and unauthenticated — into the
 * "public tenant directory" its own doc comment explicitly forbids: an
 * anonymous caller could name any tenant's hostname and receive that
 * organization's id, name, slug, type, logo and branding. Confirmed live
 * against both configurations before this fix.
 *
 * Resolution now reads the raw `Host` header, which reflects the connection the
 * client actually made and is unaffected by `X-Forwarded-Host` regardless of
 * proxy trust. This matches the documented production topology, where Nginx
 * passes `Host` through unmodified (see `nginx-dast.conf` and
 * docs/TENANT_DOMAINS_AND_ACCESS.md).
 *
 * Note this narrows an input; it cannot grant access. Tenant context only ever
 * *restricts* (hostnameOrganizationMismatch, and the membership checks in
 * /auth/login and /auth/switch-organization) — verified during this pass — so a
 * request that previously resolved via a spoofed header now resolves to no
 * tenant, which is the safe direction.
 */
function tenantHostnameCandidates(req: TenantAwareRequest): string[] {
  // Raw Host header, port stripped. NOT req.hostname: that follows
  // X-Forwarded-Host under `trust proxy`. IPv6 literals arrive bracketed
  // ("[::1]:3001"), so only strip a port that follows the closing bracket.
  const rawHost = req.headers.host;
  const host =
    typeof rawHost === "string"
      ? rawHost.startsWith("[")
        ? rawHost.replace(/^(\[[^\]]*\])(:\d+)?$/, "$1")
        : rawHost.replace(/:\d+$/, "")
      : undefined;

  const candidates = [host];

  // Development-only escape hatch for the split-port dev setup, where the Vite
  // proxy rewrites Host before the API ever sees it. Deliberately unavailable
  // in production: it is, by construction, a caller-supplied tenant identity.
  // ALLOW_TENANT_HOSTNAME_HEADER exists for the rare non-production environment
  // that genuinely needs it (a preview stack behind a rewriting proxy) and must
  // never be set in production.
  const headerAllowed =
    process.env.NODE_ENV !== "production" || process.env.ALLOW_TENANT_HOSTNAME_HEADER === "true";
  if (headerAllowed) candidates.push(req.header("x-tenant-hostname"));

  return candidates.filter((h): h is string => typeof h === "string" && h.length > 0);
}

export async function resolveTenantHost(req: TenantAwareRequest, _res: Response, next: NextFunction): Promise<void> {
  const candidates = tenantHostnameCandidates(req);

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
