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
  const visiting = new Set<string>();
  const resolved = new Map<string, boolean>();

  function chainEnabled(key: string): boolean {
    if (resolved.has(key)) return resolved.get(key)!;
    if (visiting.has(key)) return false; // dependency cycle -> fail closed, not open

    visiting.add(key);
    const module = byKey.get(key);
    const result = !!module && module.enabled && module.requiredModuleKeys.every(chainEnabled);
    visiting.delete(key);
    resolved.set(key, result);

    return result;
  }

  return byKey.has(moduleKey) && chainEnabled(moduleKey);
}
