import { and, eq, ne } from "drizzle-orm";
import { db, organizationDomainsTable, organizationsTable, type OrganizationDomain } from "@workspace/db";
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
 * Resolves a normalized hostname to the organization it belongs to, or null
 * for every disqualifying condition alike (no such domain, domain disabled
 * or still pending, organization suspended) — callers must treat all of
 * these the same way, exactly like resolvePublicOrganization in
 * publicCareers.ts does for slugs. Purely informational: the caller decides
 * what (if anything) to enforce with the result.
 */
export async function resolveTenantByHostname(hostname: string): Promise<{ organizationId: number } | null> {
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

  if (!row || row.orgStatus === "suspended") return null;
  return { organizationId: row.organizationId };
}

export interface PublicTenantContext {
  organizationId: number;
  organizationName: string;
  organizationSlug: string;
  organizationType: string;
  logoUrl: string | null;
  systemDisplayName: string | null;
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

  return {
    organizationId: org.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    organizationType: org.type,
    logoUrl: org.logoUrl,
    systemDisplayName: typeof systemDisplayName === "string" ? systemDisplayName : null,
  };
}
