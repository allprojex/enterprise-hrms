import type { OrganizationModule } from '@workspace/api-client-react';

/**
 * Frontend Module Gating (W6) access check. Mirrors the backend's
 * getModuleAccess (artifacts/api-server/src/lib/organizationModules.ts,
 * W5): a module is accessible only if it, and every one of its
 * requiredModuleKeys transitively, is effectively enabled for the
 * organization. UX-level only -- the real enforcement is server-side.
 */
export function isModuleAccessible(modules: OrganizationModule[], moduleKey: string): boolean {
  const byKey = new Map(modules.map((m) => [m.key, m]));
  const visited = new Set<string>();

  function chainEnabled(key: string): boolean {
    if (visited.has(key)) return true; // registry is validated acyclic at seed time; guard is defensive only
    visited.add(key);
    const module = byKey.get(key);
    if (!module || !module.enabled) return false;
    return module.requiredModuleKeys.every(chainEnabled);
  }

  return byKey.has(moduleKey) && chainEnabled(moduleKey);
}
