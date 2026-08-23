/**
 * Idempotent seed for the Master Data domain registry and a representative
 * set of system-defined items (not exhaustive real-world catalogs like full
 * country/language lists — that's a content task, not infrastructure).
 * Safe to re-run. Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:master-data
 */
import { eq, and, isNull } from "drizzle-orm";
import { db, masterDataDomainsTable, masterDataItemsTable } from "../index";
import { validateMasterDataDomains, MASTER_DATA_DOMAINS } from "./master-data-definitions";

const SYSTEM_ITEMS: Record<string, { code: string; label: string; sortOrder: number }[]> = {
  gender: [
    { code: "male", label: "Male", sortOrder: 1 },
    { code: "female", label: "Female", sortOrder: 2 },
    { code: "other", label: "Other", sortOrder: 3 },
  ],
  marital_status: [
    { code: "single", label: "Single", sortOrder: 1 },
    { code: "married", label: "Married", sortOrder: 2 },
    { code: "divorced", label: "Divorced", sortOrder: 3 },
    { code: "widowed", label: "Widowed", sortOrder: 4 },
  ],
  language: [
    { code: "en", label: "English", sortOrder: 1 },
    { code: "fr", label: "French", sortOrder: 2 },
  ],
  // Phase 3C, W82 — Performance Evidence/Attachments (§8.9/§35 of the
  // frozen plan): "a new document_category Master Data code registered."
  // A system-wide default item, visible to every organization, matching
  // this file's own established organizationId: null convention.
  document_category: [{ code: "performance_evidence", label: "Performance Evidence", sortOrder: 1 }],
  // Payroll, Workstream 2 (docs/PAYROLL_IMPLEMENTATION_PLAN.md §D — basic
  // salary is a distinguished, system-seeded component type, not a second
  // competing salary source). Deliberately the only default seeded here —
  // no allowance/deduction is assumed for any organization; each org adds
  // its own via the existing organization-overridable master-data route.
  payroll_earning_component_type: [{ code: "basic_salary", label: "Basic Salary", sortOrder: 1 }],
};

async function main() {
  validateMasterDataDomains(MASTER_DATA_DOMAINS);

  await db
    .insert(masterDataDomainsTable)
    .values([...MASTER_DATA_DOMAINS])
    .onConflictDoNothing({ target: masterDataDomainsTable.key });

  for (const [domain, items] of Object.entries(SYSTEM_ITEMS)) {
    for (const item of items) {
      const [existing] = await db
        .select()
        .from(masterDataItemsTable)
        .where(
          and(
            eq(masterDataItemsTable.domain, domain),
            isNull(masterDataItemsTable.organizationId),
            eq(masterDataItemsTable.code, item.code),
          ),
        )
        .limit(1);

      if (!existing) {
        await db.insert(masterDataItemsTable).values({ domain, organizationId: null, ...item });
      }
    }
  }

  console.log("Seeded master data domains and items.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
