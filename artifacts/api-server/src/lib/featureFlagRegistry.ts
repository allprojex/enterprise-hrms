/**
 * Feature-flag / controlled-extension REGISTRY (tenant identity hardening,
 * Phase 6 — customization levels 2 and 3). Pure data, no imports, so both the
 * configuration engine and the flag service can depend on it without a cycle.
 *
 * The customization hierarchy this platform commits to:
 *
 *   Level 1 — TENANT CONFIGURATION: organization_settings namespaces
 *             (services/organizationConfig.ts). Policy and settings that
 *             need no code branch.
 *   Level 2 — MODULE / FEATURE FLAG: `modules` × `organization_modules` for
 *             whole capability areas (lib/organizationModules.ts), and the
 *             flags registered HERE for narrower capabilities enabled only
 *             for selected tenants (early access, staged rollout).
 *   Level 3 — CONTROLLED TENANT EXTENSION: also registered HERE, with
 *             `level: "tenant_extension"`. The ONE sanctioned way for shared
 *             code to behave differently for a specific tenant: the branch
 *             is `await isFeatureEnabled(organizationId, key)`, evaluated
 *             per organization, defaulting OFF everywhere, enabled only by a
 *             platform super_admin through an audited, tenant-targeted
 *             operation. Never `if (tenant === "WWM")`.
 *   Level 4 — CORE PLATFORM CHANGE: shared product behaviour; no flag.
 *
 * Rules every entry obeys (enforced by featureFlags.ts and its tests):
 *   - default OFF for every organization that has not enabled it;
 *   - evaluated only against the requesting organization's own row —
 *     enabling a flag for one tenant can never enable it for another;
 *   - unknown keys are rejected at write time AND throw at read time (a typo
 *     must fail loudly, not silently read as "off");
 *   - enabling/disabling is audited with blast radius `tenant_scoped` and
 *     the explicit target organization.
 *
 * Owner Decision #3 (docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md) deferred a
 * plugin framework and named "configuration, optional modules, feature
 * flags" as the mechanisms to use instead. This registry is that mechanism;
 * it loads no code and evaluates nothing dynamic.
 *
 * The registry is EMPTY at the time of the first Production deployment: no
 * tenant-selective capability or tenant-specific extension has been
 * approved yet. That is deliberate and honest — the mechanism, its
 * enforcement and its tests exist so that the first such need is met by
 * adding one entry here, not by a conditional in shared logic.
 */

export type FeatureFlagLevel = "feature" | "tenant_extension";

export interface FeatureFlagDefinition {
  /** Stable key, `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`, e.g. "payroll.early_access_reports". */
  key: string;
  level: FeatureFlagLevel;
  /** What enabling it does, in one sentence — shown to the Super Admin. */
  description: string;
  /** Module that must be enabled for the flag to have any effect (informational). */
  moduleKey?: string;
}

export const FEATURE_FLAG_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagDefinition[] = Object.freeze([]);

export function isRegisteredFeatureFlag(key: string, registry: readonly FeatureFlagDefinition[] = FEATURE_FLAG_REGISTRY): boolean {
  return registry.some((definition) => definition.key === key);
}
