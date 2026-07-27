/**
 * Idempotent seed for the Module Registry (modules table). Safe to re-run —
 * every insert conflicts harmlessly on the table's unique `key`. Never
 * touches per-organization enablement (that's W4's organization_modules
 * table, which doesn't exist yet).
 *
 * MODULE_DEFINITIONS (in ./module-definitions.ts) is the single, typed,
 * centralized source of truth for what modules exist on the platform —
 * mirrors MODULES.md's "HR Modules" list. Core Platform / HR Foundation
 * capabilities (Authentication, Employees, Branches, ...) are not modules;
 * every organization always has them, per ARCHITECTURE.md. Every module
 * here is seeded as `status: "hidden"` because none has an owning
 * workstream shipped yet — flipping a module to "active" (or "beta") is a
 * one-line change here once its workstream lands, not a schema or API
 * change.
 *
 * Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:modules
 */
import { db, modulesTable } from "../index";
import { MODULE_DEFINITIONS, validateModuleDefinitions } from "./module-definitions";

async function main() {
  validateModuleDefinitions(MODULE_DEFINITIONS);

  await db
    .insert(modulesTable)
    .values(MODULE_DEFINITIONS.map((m) => ({ ...m })))
    .onConflictDoNothing({ target: modulesTable.key });

  console.log(`Seeded ${MODULE_DEFINITIONS.length} module registry entries.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
