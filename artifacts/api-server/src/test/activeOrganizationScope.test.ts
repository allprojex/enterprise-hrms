/**
 * P1a — lib/activeOrganizationScope.ts decision table, without a database.
 * The live suite (notificationIsolationLive) proves the real resolution; this
 * pins the branches a race can reach but a live fixture cannot stage, such as
 * a membership revoked between resolving the organization and re-checking it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveActiveOrganizationId = vi.fn();
const getActiveMembership = vi.fn();

vi.mock("../lib/membership", () => ({
  resolveActiveOrganizationId: (...args: unknown[]) => resolveActiveOrganizationId(...args),
  getActiveMembership: (...args: unknown[]) => getActiveMembership(...args),
}));

const { resolveActiveOrganizationScope } = await import("../lib/activeOrganizationScope");

const req = (extra: Record<string, unknown> = {}) =>
  ({ userId: 7, user: { id: 7, organizationId: 1 }, session: { activeOrganizationId: 5 }, ...extra }) as any;

beforeEach(() => {
  resolveActiveOrganizationId.mockReset().mockResolvedValue(5);
  getActiveMembership.mockReset().mockResolvedValue({ id: 50, organizationId: 5 });
});

describe("resolveActiveOrganizationScope", () => {
  it("scopes to the resolved organization when its membership is live", async () => {
    expect(await resolveActiveOrganizationScope(req())).toMatchObject({ kind: "organization", organizationId: 5 });
  });

  it("fails closed with 503 before any lookup when tenant resolution failed", async () => {
    expect(await resolveActiveOrganizationScope(req({ tenantResolutionFailed: true }))).toMatchObject({ kind: "denied", status: 503 });
    expect(resolveActiveOrganizationId).not.toHaveBeenCalled();
  });

  it("is none when the caller has no live membership anywhere", async () => {
    resolveActiveOrganizationId.mockResolvedValue(null);
    expect(await resolveActiveOrganizationScope(req())).toEqual({ kind: "none" });
  });

  it("refuses (403) a host pinned to a different organization than the resolved one", async () => {
    expect(await resolveActiveOrganizationScope(req({ resolvedTenantOrganizationId: 9 }))).toMatchObject({ kind: "denied", status: 403 });
  });

  it("is none when the membership was revoked between resolution and the re-check", async () => {
    getActiveMembership.mockResolvedValue(null);
    expect(await resolveActiveOrganizationScope(req())).toEqual({ kind: "none" });
    expect(getActiveMembership).toHaveBeenCalledWith(7, 5);
  });
});
