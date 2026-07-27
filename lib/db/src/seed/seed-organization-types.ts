/**
 * Idempotent seed for organization_types, matching the existing
 * organizations.type enum values. Safe to re-run (onConflictDoNothing).
 * Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:organization-types
 */
import { db, organizationTypesTable } from "../index";

const ORGANIZATION_TYPES = [
  { key: "business", label: "Business" },
  { key: "church", label: "Church" },
  { key: "ngo", label: "NGO" },
  { key: "school", label: "School" },
  { key: "hospital", label: "Hospital" },
  { key: "hotel", label: "Hotel" },
  { key: "government", label: "Government" },
  { key: "other", label: "Other" },
] as const;

async function main() {
  await db
    .insert(organizationTypesTable)
    .values([...ORGANIZATION_TYPES])
    .onConflictDoNothing({ target: organizationTypesTable.key });

  console.log("Seeded organization_types.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
