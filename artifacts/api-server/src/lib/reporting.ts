import { eq } from "drizzle-orm";
// Type-only: erased at runtime, so this import pulls in no module code.
import type { ReportParams } from "./reporting/moduleAdapters";
import { db, reportsTable, employeesTable, branchesTable, auditEventsTable } from "@workspace/db";

export class ReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown report "${key}"`);
    this.name = "ReportNotFoundError";
  }
}

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: ReportColumn[];
  // WS-15 P3 (§31.30): widened to admit `null`. Several module reports have
  // genuinely empty cells — an unassigned branch, a review with no score yet —
  // and coercing those to "" would change what the report says. Booleans are
  // admitted for the same reason. This exactly matches what `toCsv` already
  // accepts, and the OpenAPI row schema is a free-form object, so it is
  // additive rather than a contract change.
  rows: Record<string, string | number | boolean | null>[];
}

export async function listReports() {
  return db.select().from(reportsTable);
}

export async function getReportDefinition(key: string) {
  const [row] = await db.select().from(reportsTable).where(eq(reportsTable.key, key)).limit(1);
  return row ?? null;
}

/** Headcount grouped by branch, tenant-scoped. Employees with no branch fall under "Unassigned". */
async function runHeadcount(organizationId: number): Promise<Pick<ReportResult, "columns" | "rows">> {
  const [employees, branches] = await Promise.all([
    db.select({ branchId: employeesTable.branchId }).from(employeesTable).where(eq(employeesTable.organizationId, organizationId)),
    db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.organizationId, organizationId)),
  ]);

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const counts = new Map<string, number>();
  for (const employee of employees) {
    const label = employee.branchId != null ? (branchNameById.get(employee.branchId) ?? "Unassigned") : "Unassigned";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return {
    columns: [
      { key: "branch", label: "Branch" },
      { key: "count", label: "Employees" },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([branch, count]) => ({ branch, count })),
  };
}

/** Employee count grouped by employment status, tenant-scoped. */
async function runWorkforceStatus(organizationId: number): Promise<Pick<ReportResult, "columns" | "rows">> {
  const employees = await db
    .select({ employmentStatus: employeesTable.employmentStatus })
    .from(employeesTable)
    .where(eq(employeesTable.organizationId, organizationId));

  const counts = new Map<string, number>();
  for (const employee of employees) {
    counts.set(employee.employmentStatus, (counts.get(employee.employmentStatus) ?? 0) + 1);
  }

  return {
    columns: [
      { key: "status", label: "Status" },
      { key: "count", label: "Employees" },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count })),
  };
}

/** Audit event count grouped by event type, tenant-scoped. */
async function runAuditSummary(organizationId: number): Promise<Pick<ReportResult, "columns" | "rows">> {
  const events = await db
    .select({ eventType: auditEventsTable.eventType })
    .from(auditEventsTable)
    .where(eq(auditEventsTable.organizationId, organizationId));

  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }

  return {
    columns: [
      { key: "eventType", label: "Event Type" },
      { key: "count", label: "Events" },
    ],
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([eventType, count]) => ({ eventType, count })),
  };
}

const RUNNERS: Record<string, (organizationId: number) => Promise<Pick<ReportResult, "columns" | "rows">>> = {
  headcount: runHeadcount,
  workforce_status: runWorkforceStatus,
  audit_summary: runAuditSummary,
};

/**
 * Who is asking, so a consolidated report can resolve its module's own scope.
 *
 * WS-15 P3 (§31.30): eight shipped module routes documented that a module key
 * "can never be executed through the generic, NON-SCOPE-AWARE" endpoint and
 * "safely 404s instead". That guard was correct while this function knew only
 * an organization id — a generic runner ignoring scope would have shown an
 * employee the whole organization's attendance. Passing the actor lets each
 * adapter call its module's own `resolve*ReportScope`, which is what makes the
 * generic path scope-aware and retires the guard's premise honestly.
 */
export interface ReportExecutionActor {
  applicationUserId: number;
  membershipId: number;
}

export async function runReport(
  key: string,
  organizationId: number,
  actor?: ReportExecutionActor,
  params: ReportParams = {},
): Promise<ReportResult> {
  const definition = await getReportDefinition(key);
  if (!definition) throw new ReportNotFoundError(key);

  const runner = RUNNERS[key];
  if (!runner) {
    // WS-15 P3 — consolidated execution (§31.30). The three built-in runners
    // above are organization-only aggregates over shared tables; every other
    // registered report belongs to a module, and is executed by DELEGATING to
    // that module's own reporting service rather than re-querying here.
    // Loaded LAZILY, and deliberately so. The adapter layer imports all eight
    // module reporting services, and `lib/reporting.ts` is imported by many
    // routes — pulling that whole graph in eagerly would make every consumer
    // (and every test that mocks a narrow slice of the database) load the
    // entire reporting surface. A dynamic import keeps this module as light as
    // it was before consolidation.
    const { findAdapter } = await import("./reporting/moduleAdapters");
    const adapter = actor ? findAdapter(definition.category, key) : null;
    if (!adapter) throw new ReportNotFoundError(key);

    const delegated = await adapter.run({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      organizationId,
      applicationUserId: actor!.applicationUserId,
      membershipId: actor!.membershipId,
      params,
    });
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      generatedAt: new Date(),
      columns: delegated.columns,
      rows: delegated.rows,
    };
  }

  const { columns, rows } = await runner(organizationId);
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    generatedAt: new Date(),
    columns,
    rows,
  };
}

/**
 * Formula-injection-safe CSV cell serialization (WS-1, Engineering & Security
 * Foundation). Every reporting route on this platform used to define its own
 * local copy of this exact escaping logic — some hardened (Office Inventory,
 * Payroll payment batches — the two routes that had already independently
 * adopted a leading `'` guard), most not (this file's own prior `toCsv`
 * included). This is now the ONE shared primitive: every CSV-producing route
 * imports it from here rather than redefining it, closing the platform-wide
 * gap in one place instead of per-file. A cell whose string form begins with
 * `=`, `+`, `-`, `@`, a tab, or a carriage return — the character set a
 * spreadsheet application treats as "this cell is a formula" — is prefixed
 * with a single leading `'`, which every mainstream spreadsheet application
 * renders as a literal apostrophe-quoted string, never as a formula trigger.
 * A genuine `number`-typed cell (as opposed to a string that merely looks
 * numeric) is never guarded, even if it's negative — a real negative amount
 * (e.g. `-42`) is exported as the plain numeral `-42`, preserving its numeric
 * type in the spreadsheet. Only string/boolean values are tested against the
 * dangerous-leading-character pattern, since those are the values that can
 * actually originate as free-text a user typed (a name, a note, an address);
 * a `number` can never be a formula-injection vector regardless of sign, so
 * guarding it would only ever destroy legitimate numeric data for no
 * security benefit. (This refines, rather than copies byte-for-byte, the
 * existing Office Inventory/Payroll-payment-batch precedent, which applies
 * the guard by stringified leading character only and does not make this
 * type distinction — kept local to those two already-shipped, already-
 * reviewed files rather than changed retroactively here.)
 */
export function safeCsvCell(value: string | number | boolean | null | undefined): string {
  let str = String(value ?? "");
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Export abstraction (ADR-016): the same {columns, rows} shape every report produces serializes to CSV uniformly, with no per-report special-casing. */
export function toCsv(columns: ReportColumn[], rows: Record<string, string | number | boolean | null | undefined>[]): string {
  const header = columns.map((c) => safeCsvCell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => safeCsvCell(row[c.key])).join(","));
  return [header, ...body].join("\n");
}

/** WS-15 P3 — re-exported so a caller needs one reporting import, not two. */
export type { ReportParams } from "./reporting/moduleAdapters";
export { ReportParameterError } from "./reporting/errors";
