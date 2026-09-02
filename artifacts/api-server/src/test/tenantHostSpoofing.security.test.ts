/**
 * WS-18 Pass 4, finding WS18-P4-01 — tenant identity must come from the
 * connection, never from a header the caller controls.
 *
 * `GET /tenant-context` is public and unauthenticated, and its own doc comment
 * states the security property explicitly: resolution is "always ... from the
 * caller's own request hostname ... never from a client-supplied hostname
 * string", because accepting one "would turn this into a tenant directory
 * ('do not expose a public tenant directory'), which the brief explicitly
 * disallows".
 *
 * Two client-controlled inputs broke that invariant:
 *
 *   1. `X-Tenant-Hostname` — accepted unconditionally. It exists only for the
 *      split-port dev setup, but nothing confined it to development.
 *   2. `X-Forwarded-Host` — Express derives `req.hostname` from it whenever
 *      `trust proxy` is on, which is the frozen intended Production setting
 *      (OD-WS18-9, `TRUST_PROXY=1`).
 *
 * Either let an anonymous caller name any tenant's hostname and receive that
 * organization's id, name, slug, type, logo and branding. Confirmed live in
 * both configurations before the fix.
 *
 * These tests run the middleware directly rather than through supertest,
 * because the property under test is which INPUTS resolution is willing to read
 * — and `NODE_ENV` has to be varied per case, which a module-level app import
 * cannot express.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const resolved = vi.hoisted(() => ({ byHostname: new Map<string, number>() }));

vi.mock("../lib/organizationDomains", () => ({
  resolveTenantByHostname: async (hostname: string) => {
    const organizationId = resolved.byHostname.get(hostname);
    return organizationId == null ? null : { organizationId };
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));

const { resolveTenantHost } = await import("../middlewares/resolveTenantHost");

const VICTIM_HOST = "victim-tenant.hrms.test";
const VICTIM_ORG = 42;

/** Minimal Express-request stand-in: raw headers plus Express's own `hostname`. */
function makeReq(opts: { host?: string; hostname?: string; headers?: Record<string, string> }) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.host) headers.host = opts.host;
  return {
    headers,
    // Express computes this from X-Forwarded-Host when `trust proxy` is on.
    hostname: opts.hostname ?? opts.host?.replace(/:\d+$/, ""),
    header: (name: string) => headers[name.toLowerCase()],
  } as never;
}

async function run(req: unknown) {
  const r = req as { resolvedTenantOrganizationId?: number | null };
  await resolveTenantHost(r as never, {} as never, () => {});
  return r.resolvedTenantOrganizationId ?? null;
}

const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  resolved.byHostname.clear();
  resolved.byHostname.set(VICTIM_HOST, VICTIM_ORG);
});

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  delete process.env.ALLOW_TENANT_HOSTNAME_HEADER;
});

describe("WS18-P4-01 — production ignores caller-supplied tenant hostnames", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  it("positive control: the real Host header still resolves a tenant", async () => {
    // Without this, every refusal below would prove only that resolution is
    // broken, not that spoofing is blocked.
    expect(await run(makeReq({ host: VICTIM_HOST }))).toBe(VICTIM_ORG);
  });

  it("positive control: a Host with a port still resolves", async () => {
    expect(await run(makeReq({ host: `${VICTIM_HOST}:8443` }))).toBe(VICTIM_ORG);
  });

  it("X-Tenant-Hostname cannot name a tenant", async () => {
    const org = await run(
      makeReq({ host: "api.platform.test", headers: { "x-tenant-hostname": VICTIM_HOST } }),
    );
    expect(org).toBeNull();
  });

  it("X-Forwarded-Host cannot name a tenant, even when trust proxy makes it req.hostname", async () => {
    // Simulates `TRUST_PROXY=1`: Express has already rewritten req.hostname
    // from the forwarded header. Resolution must ignore that and use raw Host.
    const org = await run(
      makeReq({
        host: "api.platform.test",
        hostname: VICTIM_HOST,
        headers: { "x-forwarded-host": VICTIM_HOST },
      }),
    );
    expect(org).toBeNull();
  });

  it("a spoofed header cannot override a legitimately resolved Host", async () => {
    resolved.byHostname.set("legit.hrms.test", 7);
    const org = await run(
      makeReq({ host: "legit.hrms.test", headers: { "x-tenant-hostname": VICTIM_HOST } }),
    );
    expect(org).toBe(7);
  });

  it("an IPv6 literal Host with a port is parsed without corrupting the address", async () => {
    resolved.byHostname.set("[::1]", 9);
    expect(await run(makeReq({ host: "[::1]:3001" }))).toBe(9);
  });

  it("no Host header at all resolves to no tenant", async () => {
    expect(await run(makeReq({}))).toBeNull();
  });
});

describe("WS18-P4-01 — the dev escape hatch stays available where it is needed", () => {
  it("non-production still honours X-Tenant-Hostname (split-port dev proxy)", async () => {
    process.env.NODE_ENV = "development";
    const org = await run(
      makeReq({ host: "localhost", headers: { "x-tenant-hostname": VICTIM_HOST } }),
    );
    expect(org).toBe(VICTIM_ORG);
  });

  it("production honours it only behind an explicit opt-in", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_TENANT_HOSTNAME_HEADER = "true";
    const org = await run(
      makeReq({ host: "api.platform.test", headers: { "x-tenant-hostname": VICTIM_HOST } }),
    );
    expect(org).toBe(VICTIM_ORG);
  });

  it("the opt-in is exact — any other value keeps the header disabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_TENANT_HOSTNAME_HEADER = "1";
    const org = await run(
      makeReq({ host: "api.platform.test", headers: { "x-tenant-hostname": VICTIM_HOST } }),
    );
    expect(org).toBeNull();
  });
});
