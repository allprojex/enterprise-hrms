/**
 * Idempotent seed for the Module Registry (modules table). Safe to re-run —
 * every insert conflicts harmlessly on the table's unique `key` via
 * onConflictDoNothing. Never touches per-organization enablement (that's
 * W4's organization_modules table).
 *
 * MODULE_DEFINITIONS (in ./module-definitions.ts) is the single, typed,
 * centralized source of truth for what modules exist on the platform —
 * mirrors MODULES.md's "HR Modules" list. Core Platform / HR Foundation
 * capabilities (Authentication, Employees, Branches, ...) are not modules;
 * every organization always has them, per ARCHITECTURE.md. A module starts
 * at `status: "hidden"` until its owning workstream ships, then flips to
 * "active" (or "beta") — a one-line change in module-definitions.ts.
 *
 * IMPORTANT — onConflictDoNothing means this seed only ever INSERTS a
 * missing row; it never updates an existing one's `status` (or any other
 * field). Editing MODULE_DEFINITIONS and re-running this command has no
 * effect on a database that was already seeded before the edit — the
 * existing row must be updated separately (a one-time data correction, the
 * same way `recruitment`/`employee_self_service` were flipped after
 * Phase 3A/W60 shipped against an already-seeded database). This mirrors
 * every other seed file's own onConflictDoNothing convention
 * (seed-organization-types.ts, seed-master-data.ts, seed-reports.ts,
 * seed-roles-permissions.ts) — intentionally not changed here, since
 * switching to onConflictDoUpdate would alter every seed's "safe to re-run"
 * guarantee, a much larger change than this file needs.
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
