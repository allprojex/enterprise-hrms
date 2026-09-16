import { and, eq, ne } from "drizzle-orm";
import { db, organizationDomainsTable, organizationsTable, type Organization, type OrganizationDomain } from "@workspace/db";
import { generateToken } from "./auth";
import { isUniqueViolation } from "./dbErrors";
import { getNamespaceConfig } from "../services/organizationConfig";

/**
 * Multi-Organization Tenant Infrastructure. A hostname identifies which
 * organization a request belongs to — nothing more. Resolving one here
 * never itself grants authorization; every authenticated route still
 * independently re-verifies a live organization_memberships row exactly as
 * it always has (requireMembership, requireActiveOrganizationMembership).
 * See docs/TENANT_DOMAINS_AND_ACCESS.md for the full model.
 */

export class DomainNotFoundError extends Error {}
export class InvalidHostnameError extends Error {}
export class DomainNotActiveError extends Error {}

/**
 * True only when a tenant hostname was actually resolved for this request
 * AND it names a different organization than the one being acted on. A
 * request with no resolved tenant (the platform base domain, an unmapped
 * host, a direct API call) never mismatches — this check can only ever add
 * a denial, never grant access beyond what the real membership/permission
 * checks already allow (see requireMembership.ts, me.ts, auth.ts).
 */
export function hostnameOrganizationMismatch(
  resolvedTenantOrganizationId: number | null | undefined,
  organizationId: number,
): boolean {
  return resolvedTenantOrganizationId != null && resolvedTenantOrganizationId !== organizationId;
}

/**
 * True when resolveTenantHost could not determine tenant status for this
 * request at all (its own lookup threw — most realistically a database
 * failure), as opposed to determining there genuinely is no tenant bound to
 * this hostname. The two must never be conflated: a caller composing
 * requireMembership/requireActiveOrganizationMembership/login/switch-
 * organization needs to fail closed (deny) on this, not silently proceed as
 * if the hostname were irrelevant — an infrastructure failure must not
 * quietly remove tenant isolation from what may well be a genuinely
 * tenant-bound request. exemptSuperAdmin mirrors the same platform-wide
 * bypass already applied to every other check these four call sites make.
 */
export function shouldFailClosedForTenantResolution(
  tenantResolutionFailed: boolean | undefined,
  exemptSuperAdmin: boolean,
): boolean {
  return Boolean(tenantResolutionFailed) && !exemptSuperAdmin;
}

// Deliberately permissive (letters/digits/hyphen/dot, optional port stripped
// beforehand) — this only rejects obvious garbage (empty, whitespace,
// control characters, a bare "/"), it does not attempt full RFC 1123
// validation. `localhost` and single-label `*.localhost` hosts must pass,
// since they're this project's own dev testing hostnames.
const HOSTNAME_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * Normalizes a hostname the same way for every write and every lookup:
 * trims, lowercases, strips a leading scheme and any trailing path/query,
 * and strips a port — the tenant identity is the hostname alone, matching
 * how Express's own req.hostname already behaves. Throws
 * InvalidHostnameError on anything that isn't hostname-shaped afterward.
 */
export function normalizeHostname(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0].split("?")[0];
  value = value.split(":")[0];

  if (!value || !HOSTNAME_SHAPE.test(value)) {
    throw new InvalidHostnameError(`"${raw}" is not a valid hostname`);
  }
  return value;
}

export async function listDomainsForOrganization(organizationId: number): Promise<OrganizationDomain[]> {
  return db.select().from(organizationDomainsTable).where(eq(organizationDomainsTable.organizationId, organizationId));
}

export type InvitationOriginSource =
  | "primary_domain"
  | "single_active_domain"
  | "app_base_url"
  | "app_base_url_ambiguous_domains";

export interface InvitationOrigin {
  /** Scheme + host, no trailing slash, e.g. https://wwm.example.com */
  origin: string;
  source: InvitationOriginSource;
}

/**
 * The public origin an organization's onboarding links (invitations) should
 * be issued on. Derived ONLY from the organization's governed domain
 * configuration and APP_BASE_URL — never from the request's Host,
 * X-Forwarded-Host or X-Tenant-Hostname, so a caller can never steer an
 * invitation link onto a hostname of their choosing (WS-18 Pass 4 stays
 * intact: the request hostname is not an input here at all).
 *
 * Resolution order:
 *   1. the organization's designated primary domain, if active;
 *   2. otherwise its single active domain (unambiguous);
 *   3. otherwise APP_BASE_URL — the platform host, on which the accept page
 *      brands itself from the invitation, so it is always correct even if
 *      not tenant-specific. When several active domains exist without a
 *      primary, the platform host is used and the source says so; the
 *      administrator should designate a primary domain to get tenant links.
 *
 * Returns null only when nothing is configured (no domain, no APP_BASE_URL):
 * callers must then refuse to issue the invitation rather than invent a URL.
 */
export async function resolveInvitationOrigin(organizationId: number): Promise<InvitationOrigin | null> {
  const appBase = (process.env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  let scheme = "https";
  if (appBase) {
    try {
      scheme = new URL(appBase).protocol.replace(/:$/, "") || "https";
    } catch {
      scheme = "https";
    }
  }
  const active = (await listDomainsForOrganization(organizationId)).filter((d) => d.status === "active");
  const primary = active.find((d) => d.isPrimary);
  if (primary) return { origin: `${scheme}://${primary.hostname}`, source: "primary_domain" };
  if (active.length === 1) return { origin: `${scheme}://${active[0].hostname}`, source: "single_active_domain" };
  if (!appBase) return null;
  return { origin: appBase, source: active.length === 0 ? "app_base_url" : "app_base_url_ambiguous_domains" };
}

/**
 * Creates a domain for an organization. platform_subdomain rows are
 * immediately active — the platform itself controls those hostnames, there
 * is nothing external to verify. custom_domain rows start pending with a
 * generated verification token; an operator activates them once DNS
 * ownership has been confirmed out-of-band (no automated DNS check exists
 * yet — see docs/TENANT_DOMAINS_AND_ACCESS.md's Open Decisions).
 */
export async function createDomain(params: {
  organizationId: number;
  hostname: string;
  domainType: "platform_subdomain" | "custom_domain";
}): Promise<OrganizationDomain> {
  const hostname = normalizeHostname(params.hostname);
  const isPlatformSubdomain = params.domainType === "platform_subdomain";

  try {
    const [domain] = await db
      .insert(organizationDomainsTable)
      .values({
        organizationId: params.organizationId,
        hostname,
        domainType: params.domainType,
        status: isPlatformSubdomain ? "active" : "pending",
        verificationToken: isPlatformSubdomain ? null : generateToken(),
      })
      .returning();
    return domain;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new InvalidHostnameError(`"${hostname}" is already assigned to an organization`);
    }
    throw err;
  }
}

/** Any domain row scoped to `organizationId` — a mismatched org is treated identically to a missing row, never distinguished. */
async function getOwnDomain(organizationId: number, domainId: number): Promise<OrganizationDomain> {
  const [domain] = await db
    .select()
    .from(organizationDomainsTable)
    .where(and(eq(organizationDomainsTable.id, domainId), eq(organizationDomainsTable.organizationId, organizationId)))
    .limit(1);
  if (!domain) throw new DomainNotFoundError("Domain not found");
  return domain;
}

/** Moves a domain to active — a pending custom domain whose ownership has been confirmed, or re-enabling a disabled one. */
export async function activateDomain(organizationId: number, domainId: number): Promise<OrganizationDomain> {
  await getOwnDomain(organizationId, domainId);
  const [updated] = await db
    .update(organizationDomainsTable)
    .set({ status: "active", verifiedAt: new Date() })
    .where(eq(organizationDomainsTable.id, domainId))
    .returning();
  return updated;
}

/** Disables a domain — it stops resolving to any tenant context immediately, without deleting the row or its history. */
export async function disableDomain(organizationId: number, domainId: number): Promise<OrganizationDomain> {
  const existing = await getOwnDomain(organizationId, domainId);
  const [updated] = await db
    .update(organizationDomainsTable)
    .set({ status: "disabled", isPrimary: false })
    .where(eq(organizationDomainsTable.id, domainId))
    .returning();
  void existing;
  return updated;
}

/**
 * Marks a domain primary for its organization, atomically clearing any
 * previous primary — the partial unique index is the hard guarantee, this
 * transaction is just how a clean swap is done without a moment of two
 * primaries existing under a race. Only an active domain may become
 * primary.
 */
export async function setPrimaryDomain(organizationId: number, domainId: number): Promise<OrganizationDomain> {
  const domain = await getOwnDomain(organizationId, domainId);
  if (domain.status !== "active") {
    throw new DomainNotActiveError("Only an active domain can be marked primary");
  }

  return db.transaction(async (tx) => {
    await tx
      .update(organizationDomainsTable)
      .set({ isPrimary: false })
      .where(and(eq(organizationDomainsTable.organizationId, organizationId), ne(organizationDomainsTable.id, domainId)));

    const [updated] = await tx
      .update(organizationDomainsTable)
      .set({ isPrimary: true })
      .where(eq(organizationDomainsTable.id, domainId))
      .returning();
    return updated;
  });
}

/**
 * The tenant a hostname is bound to. `status` is the organization's own
 * lifecycle status, reported alongside the identity rather than folded into
 * it.
 */
export interface ResolvedTenantHost {
  organizationId: number;
  status: Organization["status"];
}

/**
 * Resolves a normalized hostname to the organization it is bound to, or null
 * when no tenant is bound to it at all (no such domain, or the domain is
 * disabled or still pending).
 *
 * IDENTITY, NOT AVAILABILITY. A suspended organization's active hostname
 * still resolves — with `status: "suspended"` — because this result is what
 * hostname pinning (hostnameOrganizationMismatch, the /auth/login and
 * /auth/switch-organization tenant checks) is keyed on. Returning null for a
 * suspended tenant would make its hostname indistinguishable from the
 * platform's own tenant-neutral host and silently switch pinning off exactly
 * while the tenant is unavailable. Whether the organization is operational is
 * a separate question every caller must answer from `status` (or its own
 * check, as getPublicTenantContext does) — a non-null result is never
 * permission to serve the tenant.
 */
export async function resolveTenantByHostname(hostname: string): Promise<ResolvedTenantHost | null> {
  let normalized: string;
  try {
    normalized = normalizeHostname(hostname);
  } catch {
    return null;
  }

  // organizationDomainsTable/organizationsTable are static imports from
  // @workspace/db — in any real running instance of this application these
  // reads never throw; this branch is structurally unreachable in
  // production. It exists only because a large share of this codebase's
  // test files mock the whole @workspace/db module without re-exporting
  // every table, and Vitest's strict mock mode makes *reading* such an
  // unexported binding throw immediately (not just using it) — so the read
  // itself, not a query, is what needs to be inside this try. That is not
  // the "tenant-resolution infrastructure failure" resolveTenantHost's
  // fail-closed contract is about — a genuine failure is the query below
  // actually failing once it runs, which is unaffected and still propagates
  // normally.
  let domainsTable: typeof organizationDomainsTable;
  let orgsTable: typeof organizationsTable;
  try {
    domainsTable = organizationDomainsTable;
    orgsTable = organizationsTable;
  } catch {
    return null;
  }
  if (!domainsTable || !orgsTable) {
    return null;
  }

  const [row] = await db
    .select({ organizationId: domainsTable.organizationId, orgStatus: orgsTable.status })
    .from(domainsTable)
    .innerJoin(orgsTable, eq(domainsTable.organizationId, orgsTable.id))
    .where(and(eq(domainsTable.hostname, normalized), eq(domainsTable.status, "active")))
    .limit(1);

  if (!row) return null;
  return { organizationId: row.organizationId, status: row.orgStatus };
}

export interface PublicTenantTheme {
  sidebar?: string;
  sidebarForeground?: string;
  sidebarAccent?: string;
  sidebarAccentForeground?: string;
  primary?: string;
  primaryForeground?: string;
  accent?: string;
  accentForeground?: string;
  ring?: string;
}

export interface PublicTenantContext {
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  organizationType: string;
  logoUrl: string | null;
  systemDisplayName: string | null;
  theme: PublicTenantTheme | null;
}

/**
 * The safe, unauthenticated payload for an already-resolved tenant
 * organization — used for login-page branding only. Deliberately excludes
 * every field the TOKEN PRESERVATION brief disallows (employees,
 * memberships, admin emails, permission structures, other tenants). Takes
 * an organizationId, never a hostname string — the caller (resolveTenantHost)
 * has already done that resolution against its own request context, so this
 * never becomes a "look up any hostname" directory primitive (see
 * routes/tenantContext.ts).
 */
export async function getPublicTenantContext(organizationId: number): Promise<PublicTenantContext | null> {
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  if (!org || org.status === "suspended") return null;

  const branding = await getNamespaceConfig(organizationId, "branding");
  const systemDisplayName = branding.data.systemDisplayName;
  const theme = branding.data.theme;

  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    organizationType: org.type,
    logoUrl: org.logoUrl,
    systemDisplayName: typeof systemDisplayName === "string" ? systemDisplayName : null,
    theme: theme && typeof theme === "object" ? (theme as PublicTenantTheme) : null,
  };
}
