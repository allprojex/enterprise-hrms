/**
 * Feature-flag / controlled-extension SERVICE. See lib/featureFlagRegistry.ts
 * for the customization hierarchy and the rules. Storage is the existing
 * organization_settings namespace `feature_flags` (services/organizationConfig.ts)
 * — no new table, no migration, one row per organization, read exactly like
 * every other per-tenant setting, so isolation is inherited from the
 * configuration engine rather than reimplemented.
 *
 * The service is built from its dependencies so tests can prove the
 * isolation and default-off properties against an in-memory store and a
 * test registry without a database; the exported `featureFlags` instance is
 * the production wiring.
 */
import {
  FEATURE_FLAG_REGISTRY,
  FEATURE_FLAG_KEY_PATTERN,
  type FeatureFlagDefinition,
  type FeatureFlagLevel,
} from "./featureFlagRegistry";
import { getNamespaceConfig, updateNamespaceConfig, type OrganizationConfigResult } from "../services/organizationConfig";

export const FEATURE_FLAGS_NAMESPACE = "feature_flags";

export interface FeatureFlagState {
  key: string;
  level: FeatureFlagLevel;
  description: string;
  moduleKey: string | null;
  enabled: boolean;
}

export class UnknownFeatureFlagError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown feature flag: ${key}`);
    this.name = "UnknownFeatureFlagError";
  }
}

export interface FeatureFlagServiceDeps {
  registry: readonly FeatureFlagDefinition[];
  getConfig: (organizationId: number, namespace: string) => Promise<OrganizationConfigResult>;
  updateConfig: (
    organizationId: number,
    namespace: string,
    patch: Record<string, unknown>,
  ) => Promise<OrganizationConfigResult>;
}

function enabledFlagsFrom(config: OrganizationConfigResult): Record<string, boolean> {
  const flags = config.data.flags;
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(flags as Record<string, unknown>)) {
    if (value === true) out[key] = true;
  }
  return out;
}

export function createFeatureFlagService(deps: FeatureFlagServiceDeps) {
  const byKey = new Map<string, FeatureFlagDefinition>();
  for (const definition of deps.registry) {
    if (!FEATURE_FLAG_KEY_PATTERN.test(definition.key)) {
      throw new Error(`Feature flag key "${definition.key}" does not match ${FEATURE_FLAG_KEY_PATTERN}`);
    }
    if (byKey.has(definition.key)) {
      throw new Error(`Feature flag key "${definition.key}" is registered twice`);
    }
    byKey.set(definition.key, definition);
  }

  function definitionOf(key: string): FeatureFlagDefinition {
    const definition = byKey.get(key);
    if (!definition) throw new UnknownFeatureFlagError(key);
    return definition;
  }

  function toState(definition: FeatureFlagDefinition, enabled: boolean): FeatureFlagState {
    return {
      key: definition.key,
      level: definition.level,
      description: definition.description,
      moduleKey: definition.moduleKey ?? null,
      enabled,
    };
  }

  return {
    definitions(): FeatureFlagDefinition[] {
      return [...byKey.values()];
    },

    /**
     * Whether `key` is enabled for exactly this organization. Default OFF.
     * Throws for an unregistered key — a misspelt flag must never quietly
     * evaluate to "off" in production code.
     */
    async isEnabled(organizationId: number, key: string): Promise<boolean> {
      const definition = definitionOf(key);
      const config = await deps.getConfig(organizationId, FEATURE_FLAGS_NAMESPACE);
      return enabledFlagsFrom(config)[definition.key] === true;
    },

    async list(organizationId: number): Promise<FeatureFlagState[]> {
      const config = await deps.getConfig(organizationId, FEATURE_FLAGS_NAMESPACE);
      const enabled = enabledFlagsFrom(config);
      return [...byKey.values()].map((definition) => toState(definition, enabled[definition.key] === true));
    },

    /** Enables or disables `key` for exactly this organization. Throws for an unregistered key. */
    async set(organizationId: number, key: string, enabled: boolean): Promise<FeatureFlagState> {
      const definition = definitionOf(key);
      const config = await deps.updateConfig(organizationId, FEATURE_FLAGS_NAMESPACE, {
        flags: { [definition.key]: enabled },
      });
      return toState(definition, enabledFlagsFrom(config)[definition.key] === true);
    },
  };
}

export type FeatureFlagService = ReturnType<typeof createFeatureFlagService>;

// The engine functions are wrapped rather than passed by reference so they are
// resolved when first CALLED, not when this module loads — the route index
// imports this module for every test, including suites that stub the
// configuration engine with a partial mock.
export const featureFlags: FeatureFlagService = createFeatureFlagService({
  registry: FEATURE_FLAG_REGISTRY,
  getConfig: (organizationId, namespace) => getNamespaceConfig(organizationId, namespace),
  updateConfig: (organizationId, namespace, patch) => updateNamespaceConfig(organizationId, namespace, patch),
});

/**
 * The evaluation point shared business logic uses for a Level 2 flag or a
 * Level 3 controlled extension. `organizationId` must be the request's
 * authorized tenant (resolveOrganizationId(req)), never a client-supplied id.
 */
export function isFeatureEnabled(organizationId: number, key: string): Promise<boolean> {
  return featureFlags.isEnabled(organizationId, key);
}
