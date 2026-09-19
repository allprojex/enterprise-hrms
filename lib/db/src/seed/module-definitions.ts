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
    key: "onboarding",
    name: "Onboarding",
    description: "Onboarding checklists, induction, and handbook/policy acknowledgement.",
    category: "hr-operations",
    version: "1.0.0",
    status: "active",
    // Consistent with every other module here: no organization silently gains
    // onboarding. It is enabled deliberately, per organization.
    defaultEnabled: false,
    // Deliberately empty. Onboarding references Recruitment, Assets, Office
    // Inventory and Payroll where those modules happen to be enabled, but it
    // must not REQUIRE any of them — §26.35 requires that an existing,
    // migrated or manually created employee can be onboarded with no
    // Recruitment record at all.
    requiredModuleKeys: [],
    optionalModuleKeys: ["recruitment", "asset_management", "office_inventory", "employee_self_service"],
  },
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
    // Fully shipped since Phase 2B (leave types/policies/balances/requests/
    // approvals/calendar/public holidays, working-day notice boundaries,
    // dashboard metrics) and exercised live against real WWM data as far
    // back as the Phase 3H W120 verification pass — the "hidden" status
    // was simply never graduated afterward, the same gap office_inventory
    // had before WWM Readiness Workstream 1 flipped it. Corrected here on
    // the same precedent seed-modules.ts's own docstring documents
    // (recruitment/employee_self_service).
    status: "active",
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
  {
    key: "payroll",
    name: "Payroll",
    description: "Ghana statutory payroll: compensation, PAYE/SSNIT calculation, runs, payslips.",
    category: "financial-operations",
    version: "1.0.0",
    // Payroll, Workstream 1 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §6.1,
    // Decision 7 — new category rather than folded into hr-operations,
    // since compensation/statutory/banking data is conceptually distinct
    // from personnel-record HR operations). "hidden": this workstream ships
    // only the statutory-rule engine foundation — no compensation, no
    // calculation, no runs exist yet, so there is nothing an organization
    // could meaningfully use even if enabled. defaultEnabled: false and no
    // organization_modules override is created for any organization by this
    // workstream — building this platform-wide grants zero access to any
    // organization, including WWM, until a future, separate, deliberate
    // per-organization enablement decision (frozen plan §14/§Owner Review
    // WWM boundary).
    status: "hidden",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "office_inventory",
    name: "Office Inventory",
    description: "Organizational stock/store accountability: items, receiving, requests, custody, and movement history.",
    category: "hr-operations",
    version: "1.0.0",
    // Office Inventory shipped "hidden" at Workstream 1
    // (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §50) because only the
    // catalog/store/Department-Head foundation existed then — nothing an
    // organization could meaningfully use. The epic completed through
    // Workstream 12 (see PROJECT_STATUS.md's Office Inventory Completion
    // Report): item catalog, requests, approvals, custody, movement,
    // stocktake, incidents, reporting, ESS. WWM Readiness Workstream 1 is
    // the first organization to actually turn it on, so the module now
    // graduates to "active" — matching every other completed hr-operations
    // module's convention. defaultEnabled stays false: no organization
    // inherits it automatically, each org's enablement remains its own
    // deliberate organization_modules decision (WWM's is made explicitly by
    // that same workstream, not by this flip). No Payroll or Procurement
    // dependency of any kind.
    status: "active",
    defaultEnabled: false,
    requiredModuleKeys: [],
    optionalModuleKeys: [],
  },
  {
    key: "vehicle_management",
    name: "Vehicle Management",
    description: "Organizational vehicle register, and the request, approval and movement record for releasing a vehicle.",
    category: "hr-operations",
    version: "1.0.0",
    // VR-01 ships "hidden", the same posture Office Inventory took at its own
    // Workstream 1: only the register exists so far, and the request →
    // approval → release → return flow that makes it useful to an
    // organization is VR-02. It graduates to "active" when that lands.
    // defaultEnabled stays false — no organization inherits it; enabling it
    // is each organization's own organization_modules decision. No dependency
    // on Assets or Office Inventory: a vehicle is its own register, not asset
    // custody and not a quantity ledger.
    status: "hidden",
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
