/**
 * Tenant identity hardening — Phase 6 (customization hierarchy levels 2/3)
 * and Phase 9 tests 2 and 4:
 *
 *   2. Tenant A's feature flag does not enable the feature for Tenant B.
 *   4. A tenant-specific (controlled) extension defaults OFF everywhere else.
 *
 * The service is exercised against an in-memory per-organization store with
 * the SAME read/merge semantics the real organization_settings engine has
 * (one row per organization per namespace; defaults when no row exists), so
 * the isolation proven here is the isolation the production wiring inherits.
 * A test registry is used because the production registry is deliberately
 * empty until the first tenant-selective capability is approved.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFeatureFlagService, UnknownFeatureFlagError, FEATURE_FLAGS_NAMESPACE } from "../lib/featureFlags";
import type { FeatureFlagDefinition } from "../lib/featureFlagRegistry";
import type { OrganizationConfigResult } from "../services/organizationConfig";

const REGISTRY: readonly FeatureFlagDefinition[] = [
  { key: "reports.early_access", level: "feature", description: "Early access to the new reports" },
  { key: "ext.custom_payslip_footer", level: "tenant_extension", description: "Tenant-specific payslip footer", moduleKey: "payroll" },
];

const ORG_A = 101;
const ORG_B = 202;

function makeStore() {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (organizationId: number, namespace: string) => `${organizationId}:${namespace}`;

  const getConfig = async (organizationId: number, namespace: string): Promise<OrganizationConfigResult> => ({
    organizationId,
    namespace,
    schemaVersion: 1,
    data: rows.get(key(organizationId, namespace)) ?? { flags: {} },
    updatedAt: null,
  });

  const updateConfig = async (organizationId: number, namespace: string, patch: Record<string, unknown>) => {
    const existing = (rows.get(key(organizationId, namespace)) ?? { flags: {} }) as { flags: Record<string, boolean> };
    const merged = { ...existing, flags: { ...existing.flags, ...((patch.flags as Record<string, boolean>) ?? {}) } };
    rows.set(key(organizationId, namespace), merged);
    return getConfig(organizationId, namespace);
  };

  return { rows, getConfig, updateConfig };
}

describe("feature flags / controlled extensions", () => {
  let store: ReturnType<typeof makeStore>;
  let service: ReturnType<typeof createFeatureFlagService>;

  beforeEach(() => {
    store = makeStore();
    service = createFeatureFlagService({ registry: REGISTRY, getConfig: store.getConfig, updateConfig: store.updateConfig });
  });

  it("every registered flag defaults OFF for every organization", async () => {
    for (const org of [ORG_A, ORG_B]) {
      for (const definition of REGISTRY) {
        expect(await service.isEnabled(org, definition.key)).toBe(false);
      }
      expect((await service.list(org)).every((state) => state.enabled === false)).toBe(true);
    }
  });

  it("test 2 — enabling a flag for Tenant A does not enable it for Tenant B", async () => {
    await service.set(ORG_A, "reports.early_access", true);

    expect(await service.isEnabled(ORG_A, "reports.early_access")).toBe(true);
    expect(await service.isEnabled(ORG_B, "reports.early_access")).toBe(false);
    // Only Tenant A's own row was written; Tenant B has no row at all.
    expect(store.rows.has(`${ORG_A}:${FEATURE_FLAGS_NAMESPACE}`)).toBe(true);
    expect(store.rows.has(`${ORG_B}:${FEATURE_FLAGS_NAMESPACE}`)).toBe(false);
  });

  it("test 4 — a controlled tenant extension enabled for one tenant stays OFF everywhere else", async () => {
    await service.set(ORG_B, "ext.custom_payslip_footer", true);

    expect(await service.isEnabled(ORG_B, "ext.custom_payslip_footer")).toBe(true);
    expect(await service.isEnabled(ORG_A, "ext.custom_payslip_footer")).toBe(false);
    const stateA = (await service.list(ORG_A)).find((s) => s.key === "ext.custom_payslip_footer");
    expect(stateA).toMatchObject({ level: "tenant_extension", moduleKey: "payroll", enabled: false });
  });

  it("disabling is per tenant too and reports the resulting state", async () => {
    await service.set(ORG_A, "reports.early_access", true);
    await service.set(ORG_B, "reports.early_access", true);
    const state = await service.set(ORG_A, "reports.early_access", false);

    expect(state.enabled).toBe(false);
    expect(await service.isEnabled(ORG_A, "reports.early_access")).toBe(false);
    expect(await service.isEnabled(ORG_B, "reports.early_access")).toBe(true);
  });

  it("an unregistered key fails loudly on read and on write — never silently 'off'", async () => {
    await expect(service.isEnabled(ORG_A, "reports.early_acess")).rejects.toBeInstanceOf(UnknownFeatureFlagError);
    await expect(service.set(ORG_A, "not.registered", true)).rejects.toBeInstanceOf(UnknownFeatureFlagError);
    expect(store.rows.size).toBe(0);
  });

  it("a stale stored value that is not exactly `true` never enables a flag", async () => {
    store.rows.set(`${ORG_A}:${FEATURE_FLAGS_NAMESPACE}`, { flags: { "reports.early_access": "yes" } });
    expect(await service.isEnabled(ORG_A, "reports.early_access")).toBe(false);
  });

  it("the registry rejects malformed or duplicate keys at construction", () => {
    expect(() =>
      createFeatureFlagService({
        registry: [{ key: "Bad Key", level: "feature", description: "x" }],
        getConfig: store.getConfig,
        updateConfig: store.updateConfig,
      }),
    ).toThrow(/does not match/);
    expect(() =>
      createFeatureFlagService({
        registry: [REGISTRY[0], REGISTRY[0]],
        getConfig: store.getConfig,
        updateConfig: store.updateConfig,
      }),
    ).toThrow(/registered twice/);
  });
});
