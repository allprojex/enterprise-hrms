import { and, eq } from "drizzle-orm";
import { db, modulesTable, organizationModulesTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class ModuleNotFoundError extends Error {
  constructor(moduleKey: string) {
    super(`Unknown module key "${moduleKey}"`);
    this.name = "ModuleNotFoundError";
  }
}

export class ModuleNotEnableableError extends Error {
  constructor(moduleKey: string, status: string) {
    super(`Module "${moduleKey}" cannot be enabled while its registry status is "${status}"`);
    this.name = "ModuleNotEnableableError";
  }
}

export class MissingRequiredModulesError extends Error {
  constructor(moduleKey: string, readonly missingModuleKeys: string[]) {
    super(`Cannot enable module "${moduleKey}": required module(s) not enabled: ${missingModuleKeys.join(", ")}`);
    this.name = "MissingRequiredModulesError";
  }
}

export class ModuleRequiredByEnabledModulesError extends Error {
  constructor(moduleKey: string, readonly dependentModuleKeys: string[]) {
    super(`Cannot disable module "${moduleKey}": required by enabled module(s): ${dependentModuleKeys.join(", ")}`);
    this.name = "ModuleRequiredByEnabledModulesError";
  }
}

export interface OrganizationModuleView {
  id: number;
  key: string;
  name: string;
  description: string;
  category: string;
  version: string;
  status: "active" | "beta" | "hidden" | "deprecated";
  defaultEnabled: boolean;
  requiredModuleKeys: string[];
  optionalModuleKeys: string[];
  enabled: boolean;
}

function toView(module: typeof modulesTable.$inferSelect, enabled: boolean): OrganizationModuleView {
  return {
    id: module.id,
    key: module.key,
    name: module.name,
    description: module.description,
    category: module.category,
    version: module.version,
    status: module.status,
    defaultEnabled: module.defaultEnabled,
    requiredModuleKeys: module.requiredModuleKeys as string[],
    optionalModuleKeys: module.optionalModuleKeys as string[],
    enabled,
  };
}

/** A module with no override row falls back to its registry `defaultEnabled`. */
function effectiveEnabled(
  module: typeof modulesTable.$inferSelect,
  overrideByModuleId: Map<number, typeof organizationModulesTable.$inferSelect>,
): boolean {
  const override = overrideByModuleId.get(module.id);
  return override ? override.enabled : module.defaultEnabled;
}

export interface ModuleAccess {
  /** False if moduleKey isn't in the registry at all — a route-wiring bug, not a tenant state. */
  found: boolean;
  /** Effectively enabled for this organization AND every requiredModuleKeys entry, transitively. */
  enabled: boolean;
}

/**
 * Backend gate check (W5) for a single module: is it usable, right now, for
 * this organization? Distinct from W4's setModuleEnabled — this never
 * writes, and independently re-walks the required-dependency chain rather
 * than trusting the target module's own `enabled` override in isolation, so
 * a route stays correctly gated even if an upstream dependency is disabled
 * later (W4 also prevents that from happening at write time, but the
 * request-time check does not rely on that being the only safeguard).
 */
export async function getModuleAccess(organizationId: number, moduleKey: string): Promise<ModuleAccess> {
  const [modules, overrides] = await Promise.all([
    db.select().from(modulesTable),
    db.select().from(organizationModulesTable).where(eq(organizationModulesTable.organizationId, organizationId)),
  ]);

  const overrideByModuleId = new Map(overrides.map((o) => [o.moduleId, o]));
  const byKey = new Map(modules.map((m) => [m.key, m]));

  if (!byKey.has(moduleKey)) {
    return { found: false, enabled: false };
  }

  const visited = new Set<string>();
  function chainEnabled(key: string): boolean {
    if (visited.has(key)) return true; // registry is validated acyclic at seed time; guard is defensive only
    visited.add(key);
    const module = byKey.get(key);
    if (!module || !effectiveEnabled(module, overrideByModuleId)) return false;
    return (module.requiredModuleKeys as string[]).every(chainEnabled);
  }

  return { found: true, enabled: chainEnabled(moduleKey) };
}

/** Merges the platform module registry with this organization's enablement overrides. */
export async function listOrganizationModules(organizationId: number): Promise<OrganizationModuleView[]> {
  const [modules, overrides] = await Promise.all([
    db.select().from(modulesTable),
    db.select().from(organizationModulesTable).where(eq(organizationModulesTable.organizationId, organizationId)),
  ]);

  const overrideByModuleId = new Map(overrides.map((o) => [o.moduleId, o]));
  return modules.map((module) => toView(module, effectiveEnabled(module, overrideByModuleId)));
}

/**
 * Enables or disables one module for an organization, walking the registry's
 * dependency graph (see lib/db/src/seed/module-definitions.ts for the
 * integrity checks run on that graph at seed time):
 *  - Enabling requires the module's status to be "active" or "beta" — a
 *    "hidden" or "deprecated" module has no owning workstream shipped yet
 *    and cannot be turned on. It also requires every one of the module's
 *    requiredModuleKeys to already be enabled for this organization.
 *  - Disabling is rejected if another currently-enabled module in this
 *    organization lists it as required.
 * Does not enforce anything at request time elsewhere — gating
 * routes/navigation on this flag is a later workstream (W5/W6).
 */
export async function setModuleEnabled(params: {
  organizationId: number;
  moduleKey: string;
  enabled: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OrganizationModuleView> {
  const { organizationId, moduleKey, enabled, actorApplicationUserId, actorMembershipId } = params;

  const allModules = await db.select().from(modulesTable);
  const targetModule = allModules.find((m) => m.key === moduleKey);
  if (!targetModule) {
    throw new ModuleNotFoundError(moduleKey);
  }

  const overrides = await db
    .select()
    .from(organizationModulesTable)
    .where(eq(organizationModulesTable.organizationId, organizationId));
  const overrideByModuleId = new Map(overrides.map((o) => [o.moduleId, o]));
  const byKey = new Map(allModules.map((m) => [m.key, m]));

  if (enabled) {
    if (targetModule.status !== "active" && targetModule.status !== "beta") {
      throw new ModuleNotEnableableError(moduleKey, targetModule.status);
    }

    const requiredKeys = targetModule.requiredModuleKeys as string[];
    const missing = requiredKeys.filter((key) => {
      const dep = byKey.get(key);
      return !dep || !effectiveEnabled(dep, overrideByModuleId);
    });
    if (missing.length > 0) {
      throw new MissingRequiredModulesError(moduleKey, missing);
    }
  } else {
    const dependents = allModules.filter(
      (m) =>
        m.id !== targetModule.id &&
        effectiveEnabled(m, overrideByModuleId) &&
        (m.requiredModuleKeys as string[]).includes(moduleKey),
    );
    if (dependents.length > 0) {
      throw new ModuleRequiredByEnabledModulesError(moduleKey, dependents.map((m) => m.key));
    }
  }

  const existing = overrideByModuleId.get(targetModule.id);
  const beforeState = { enabled: existing ? existing.enabled : targetModule.defaultEnabled };

  if (existing) {
    await db
      .update(organizationModulesTable)
      .set({ enabled })
      .where(eq(organizationModulesTable.id, existing.id))
      .returning();
  } else {
    const [created] = await db
      .insert(organizationModulesTable)
      .values({ organizationId, moduleId: targetModule.id, enabled })
      .onConflictDoNothing({ target: [organizationModulesTable.organizationId, organizationModulesTable.moduleId] })
      .returning();

    if (!created) {
      // Lost a race with a concurrent first write for this (org, module) pair.
      await db
        .update(organizationModulesTable)
        .set({ enabled })
        .where(
          and(
            eq(organizationModulesTable.organizationId, organizationId),
            eq(organizationModulesTable.moduleId, targetModule.id),
          ),
        )
        .returning();
    }
  }

  await recordAuditEvent({
    actorApplicationUserId,
    actorMembershipId,
    organizationId,
    eventType: enabled ? "module.enabled" : "module.disabled",
    targetType: "module",
    targetId: moduleKey,
    beforeState,
    afterState: { enabled },
  });

  return toView(targetModule, enabled);
}
