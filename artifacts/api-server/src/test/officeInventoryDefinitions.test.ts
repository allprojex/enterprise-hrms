/**
 * Office Inventory, Workstream 1 — module registry & master-data domain
 * registration (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §50). Pure
 * data-definition assertions, no database. seed-roles-permissions.ts is
 * deliberately NOT imported here — that file runs a real seed against
 * `db` and calls `process.exit()` at module scope, so its 23-key
 * permission set and default role mapping (none of employee/hr_manager/
 * org_admin, only super_admin's existing blanket grant) is verified live
 * against the development database instead — see PROJECT_STATUS.md's
 * Workstream 1 entry.
 */
import { describe, it, expect } from "vitest";
import { MODULE_DEFINITIONS, validateModuleDefinitions } from "@workspace/db/seed/module-definitions";
import { MASTER_DATA_DOMAINS, validateMasterDataDomains } from "@workspace/db/seed/master-data-definitions";

describe("office_inventory module registration", () => {
  it("is registered with the exact frozen Workstream 1 metadata", () => {
    const mod = MODULE_DEFINITIONS.find((m) => m.key === "office_inventory");
    expect(mod).toBeDefined();
    expect(mod?.category).toBe("hr-operations");
    expect(mod?.status).toBe("hidden");
    expect(mod?.defaultEnabled).toBe(false);
    expect(mod?.requiredModuleKeys).toEqual([]);
  });

  it("passes the full module-definition validator (no circular/dangling dependencies)", () => {
    expect(() => validateModuleDefinitions(MODULE_DEFINITIONS)).not.toThrow();
  });
});

describe("office_inventory_category master data domain", () => {
  it("is registered as organization-defined, mirroring asset_category's precedent", () => {
    const domain = MASTER_DATA_DOMAINS.find((d) => d.key === "office_inventory_category");
    expect(domain).toBeDefined();
    expect(domain?.classification).toBe("organization-defined");
  });

  it("passes the full master-data-domain validator (no duplicate keys)", () => {
    expect(() => validateMasterDataDomains(MASTER_DATA_DOMAINS)).not.toThrow();
  });
});
