/**
 * Idempotent seed for the Reporting Foundation registry (reports table).
 * Safe to re-run — every insert conflicts harmlessly on the table's unique
 * `key`. Mirrors seed-modules.ts.
 *
 * Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:reports
 */
import { db, reportsTable } from "../index";
import { REPORT_DEFINITIONS, validateReportDefinitions } from "./report-definitions";

async function main() {
  validateReportDefinitions(REPORT_DEFINITIONS);

  await db
    .insert(reportsTable)
    .values(REPORT_DEFINITIONS.map((r) => ({ ...r })))
    .onConflictDoNothing({ target: reportsTable.key });

  console.log(`Seeded ${REPORT_DEFINITIONS.length} report registry entries.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
