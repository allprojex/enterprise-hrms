/**
 * Module Registry data + integrity checks, split out from seed-modules.ts so
 * they have no dependency on `../index` (which requires DATABASE_URL to
 * import at all). That keeps validateModuleDefinitions runnable — and
 * eventually unit-testable — without a live database connection.
 */

export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  version: string;
  status: "active" | "beta" | "hidden" | "deprecated";
  defaultEnabled: boolean;
  requiredModuleKeys: string[];
  optionalModuleKeys: string[];
}

export const MODULE_DEFINITIONS: readonly ModuleDefinition[] = [
  {
    key: "recruitment",
    name: "Recruitment",
    description: "Job requisitions, candidate pipelines, and hiring workflows.",
    category: "hr-operations",
    version: "1.0.0",
    // Phase 3A (W43-W62) shipped and verified end to end — flipped from
    // "hidden" per this file's own documented convention ("a one-line
    // change here once its workstream lands"). See PROJECT_STATUS.md's
    // Phase 3A Completion Report.
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "attendance",
    name: "Attendance",
    description: "Clock-in/out tracking and attendance records.",
    category: "hr-operations",
    version: "1.0.0",
    // Phase 3B W64 foundation shipped (schema, permissions, authorization
    // primitives) — flipped from "hidden" per this file's own documented
    // convention. See status note on "recruitment" above. No capture route
    // or self-service clocking exists yet; module availability does not by
    // itself grant any organization access (see organization_modules).
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "leave",
    name: "Leave",
    description: "Leave types, balances, requests, and approvals.",
    category: "hr-operations",
    version: "1.0.0",
    status: "hidden",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "performance",
    name: "Performance",
    description: "Performance reviews and goal tracking.",
    category: "hr-operations",
    version: "1.0.0",
    // Phase 3C W73 foundation shipped (schema, permissions, authorization
    // primitives) — flipped from "hidden" per this file's own documented
    // convention. See status note on "recruitment"/"attendance" above. No
    // route or frontend exists yet; module availability does not by itself
    // grant any organization access (see organization_modules).
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "learning",
    name: "Learning & Development",
    description: "Training courses and completion tracking.",
    category: "hr-operations",
    version: "1.0.0",
    // Phase 3D W85 foundation shipped (schema, permissions, authorization
    // primitives) — flipped from "hidden" per this file's own documented
    // convention. See status note on "recruitment"/"attendance"/
    // "performance" above. No route or frontend exists yet; module
    // availability does not by itself grant any organization access (see
    // organization_modules).
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "asset_management",
    name: "Asset Management",
    description: "Company asset inventory and employee assignment tracking.",
    category: "hr-operations",
    version: "1.0.0",
    // Phase 3E W95 foundation shipped (schema, permissions, authorization
    // primitives) — flipped from "hidden" per this file's own documented
    // convention. See status note on "recruitment"/"attendance"/
    // "performance"/"learning" above. No route or frontend exists yet;
    // module availability does not by itself grant any organization access
    // (see organization_modules).
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "employee_self_service",
    name: "Employee Self Service",
    description: "Employee-facing portal for self-managed requests and records.",
    category: "hr-operations",
    version: "1.0.0",
    // Shipped and verified (W39, W60) — see status note on "recruitment" above.
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "manager_portal",
    name: "Manager Portal",
    description: "Manager-facing views and approvals for their reports.",
    category: "hr-operations",
    version: "1.0.0",
    // Phase 3G W109 foundation shipped (module activation, authorization
    // primitives, Team Overview) — flipped from "hidden" per this file's own
    // documented convention. See status note on "recruitment"/"attendance"/
    // "performance"/"learning"/"asset_management" above. No frontend page
    // exists yet (W111); module availability does not by itself grant any
    // organization access (see organization_modules) — zero organizations
    // are auto-enabled by this change.
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
] as const;

/**
 * Throws on: duplicate keys, a required/optional key that isn't in the
 * registry, a module depending on itself, or a dependency cycle (walking
 * required + optional edges together). Called before every seed insert so a
 * bad hand-edit to MODULE_DEFINITIONS fails fast instead of writing a
 * corrupt graph.
 */
export function validateModuleDefinitions(definitions: readonly ModuleDefinition[]): void {
  const byKey = new Map<string, ModuleDefinition>();
  for (const module of definitions) {
    if (byKey.has(module.key)) {
      throw new Error(`Duplicate module key "${module.key}" in MODULE_DEFINITIONS.`);
    }
    byKey.set(module.key, module);
  }

  for (const module of definitions) {
    for (const depKey of [...module.requiredModuleKeys, ...module.optionalModuleKeys]) {
      if (depKey === module.key) {
        throw new Error(`Module "${module.key}" cannot depend on itself.`);
      }
      if (!byKey.has(depKey)) {
        throw new Error(`Module "${module.key}" depends on unknown module key "${depKey}".`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string, path: readonly string[]): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new Error(`Circular module dependency: ${[...path, key].join(" -> ")}`);
    }
    visiting.add(key);
    const module = byKey.get(key)!;
    for (const depKey of [...module.requiredModuleKeys, ...module.optionalModuleKeys]) {
      visit(depKey, [...path, key]);
    }
    visiting.delete(key);
    visited.add(key);
  }

  for (const module of definitions) {
    visit(module.key, []);
  }
}
