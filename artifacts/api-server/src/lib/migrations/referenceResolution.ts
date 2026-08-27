/**
 * WS-7 (§16/§26) — cross-entity reference resolution shared by every entity
 * adapter, in two deliberately different modes:
 *
 *   "dry_run" — used during validation. A reference is valid if the target
 *   either already exists in the live authoritative table, OR has a
 *   corresponding staged row from an EARLIER source in the same batch with
 *   a passing validation status (proving "this will exist once the batch
 *   executes, in dependency order" — structure always executes before
 *   employees, employees always execute before employee-dependent
 *   entities, per lib/migrations/entityAdapters.ts's own `dependsOn`
 *   ordering). No id is resolved yet in this mode — only existence.
 *
 *   "execute" — used immediately before mutation. By execution time,
 *   every dependency source has ALREADY fully executed and committed (small
 *   migrations: earlier in the same transaction; large/chunked migrations:
 *   in an earlier, already-committed chunk) — so this mode ONLY ever
 *   checks the live table, never staged rows, and always resolves a real
 *   id. This is what makes execution "revalidate critical references
 *   immediately before mutation" rather than trusting dry-run's own
 *   resolution, which could have gone stale (§26).
 */
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  db,
  branchesTable,
  departmentsTable,
  positionsTable,
  employeeNumberAllocationsTable,
  migrationSourcesTable,
  migrationStagedRowsTable,
} from "@workspace/db";

export type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ResolutionMode = "dry_run" | "execute";

export interface ResolutionResult {
  found: boolean;
  /** Only ever set in "execute" mode — see this file's own header. */
  id: number | null;
}

async function existsInEarlierStagedSource(
  tx: QueryClient,
  batchId: number,
  entityType: string,
  keyField: string,
  keyValue: string,
): Promise<boolean> {
  const rows = await tx
    .select({ normalizedData: migrationStagedRowsTable.normalizedData })
    .from(migrationStagedRowsTable)
    .innerJoin(migrationSourcesTable, eq(migrationSourcesTable.id, migrationStagedRowsTable.sourceId))
    .where(
      and(
        eq(migrationSourcesTable.batchId, batchId),
        eq(migrationSourcesTable.entityType, entityType),
        sql`${migrationStagedRowsTable.validationStatus} IN ('valid', 'warning')`,
      ),
    );
  return rows.some((r) => (r.normalizedData as Record<string, unknown>)[keyField] === keyValue);
}

export async function resolveBranchRef(
  tx: QueryClient,
  organizationId: number,
  batchId: number,
  mode: ResolutionMode,
  code: string,
): Promise<ResolutionResult> {
  const [row] = await tx
    .select({ id: branchesTable.id })
    .from(branchesTable)
    .where(and(eq(branchesTable.organizationId, organizationId), eq(branchesTable.code, code)))
    .limit(1);
  if (row) return { found: true, id: row.id };
  if (mode === "execute") return { found: false, id: null };
  return { found: await existsInEarlierStagedSource(tx, batchId, "branch", "code", code), id: null };
}

export async function resolveDepartmentRef(
  tx: QueryClient,
  organizationId: number,
  batchId: number,
  mode: ResolutionMode,
  code: string,
): Promise<ResolutionResult> {
  const [row] = await tx
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.organizationId, organizationId), eq(departmentsTable.code, code)))
    .limit(1);
  if (row) return { found: true, id: row.id };
  if (mode === "execute") return { found: false, id: null };
  return { found: await existsInEarlierStagedSource(tx, batchId, "department", "code", code), id: null };
}

export async function resolvePositionRef(
  tx: QueryClient,
  organizationId: number,
  batchId: number,
  mode: ResolutionMode,
  title: string,
): Promise<ResolutionResult> {
  const [row] = await tx
    .select({ id: positionsTable.id })
    .from(positionsTable)
    .where(and(eq(positionsTable.organizationId, organizationId), eq(positionsTable.title, title)))
    .limit(1);
  if (row) return { found: true, id: row.id };
  if (mode === "execute") return { found: false, id: null };
  return { found: await existsInEarlierStagedSource(tx, batchId, "position", "title", title), id: null };
}

/**
 * Resolves an employee by their CURRENT (open) staff/PIF number allocation
 * — the natural key every dependent entity (qualifications, certifications,
 * leave balances, payroll opening balances, employment history) references
 * an employee by, matching how a real HR spreadsheet identifies a person
 * (§14: "staff/PIF number" is the conservative evidence this workstream
 * matches on — never a name).
 */
export async function resolveEmployeeRef(
  tx: QueryClient,
  organizationId: number,
  batchId: number,
  mode: ResolutionMode,
  employeeNumber: string,
): Promise<ResolutionResult> {
  const [row] = await tx
    .select({ employeeId: employeeNumberAllocationsTable.employeeId })
    .from(employeeNumberAllocationsTable)
    .where(
      and(
        eq(employeeNumberAllocationsTable.organizationId, organizationId),
        eq(employeeNumberAllocationsTable.employeeNumber, employeeNumber),
        isNull(employeeNumberAllocationsTable.validTo),
      ),
    )
    .limit(1);
  if (row) return { found: true, id: row.employeeId };
  if (mode === "execute") return { found: false, id: null };
  return { found: await existsInEarlierStagedSource(tx, batchId, "employee", "employeeNumber", employeeNumber), id: null };
}
