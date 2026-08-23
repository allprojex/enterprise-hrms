/**
 * Phase 3H, W114. Backfills `employee_number_allocations` for employees
 * that already carry a non-null `employeeNumber` from before this
 * workstream — otherwise, `employee_number_allocations` (the frozen plan's
 * own "authoritative historical source" for staff-number ownership, Decision
 * 1) would show these employees as never having held a number at all, even
 * though `employees.employeeNumber` clearly shows one. Idempotent — an
 * employee that already has an open allocation row (e.g. because it was
 * created after this workstream shipped) is skipped via onConflictDoNothing
 * against the partial unique index. Only reads `employees` and inserts into
 * `employee_number_allocations`; never modifies `employees` itself. Run
 * manually after applying migration 0041:
 *   pnpm --filter @workspace/db run backfill:employee-numbers
 *
 * Deliberately does NOT seed numbering_sequences.currentValue — legacy
 * number formats are not guaranteed to match any organization's numbering
 * configuration, so there is no safe way to infer "the next sequence value"
 * from them. allocateGeneratedEmployeeNumber's own bounded retry-on-
 * collision loop is what actually makes future generation safe regardless
 * of whether this backfill has run — this script exists for historical
 * completeness, not as a prerequisite for correctness.
 */
import { sql } from "drizzle-orm";
import { db, employeesTable, employeeNumberAllocationsTable } from "../index";

async function main() {
  const rows = await db
    .select({
      id: employeesTable.id,
      organizationId: employeesTable.organizationId,
      employeeNumber: employeesTable.employeeNumber,
      createdAt: employeesTable.createdAt,
    })
    .from(employeesTable);

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.employeeNumber) {
      skipped++;
      continue;
    }

    const [inserted] = await db
      .insert(employeeNumberAllocationsTable)
      .values({
        organizationId: row.organizationId,
        employeeId: row.id,
        employeeNumber: row.employeeNumber,
        allocationMethod: "migrated",
        validFrom: row.createdAt,
        allocatedByMembershipId: null,
      })
      .onConflictDoNothing({
        target: [employeeNumberAllocationsTable.organizationId, employeeNumberAllocationsTable.employeeNumber],
        where: sql`${employeeNumberAllocationsTable.validTo} is null`,
      })
      .returning();

    if (inserted) created++;
    else skipped++;
  }

  console.log(`Backfill complete. Created ${created} allocation(s), skipped ${skipped} employee(s) (no number, or already backfilled).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
