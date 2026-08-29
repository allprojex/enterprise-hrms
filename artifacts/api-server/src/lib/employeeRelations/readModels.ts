import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  disciplinaryCasesTable,
  grievanceCasesTable,
  employeeExitProcessesTable,
  clearanceItemsTable,
  assetAssignmentsTable,
  employeesTable,
} from "@workspace/db";

/**
 * WS-12 — the P1 reporting read models (§28.23).
 *
 * THESE ARE COUNTS AND AGEING, NOT CASE CONTENT. Every function here returns
 * aggregates and identifiers; none returns a subject, description, finding,
 * outcome, resolution or note. That is deliberate and it is the point of §28.23's
 * "a report must never become the route by which confidential case content
 * reaches a caller who could not read the case itself". The routes still gate
 * each model behind the same permission as the underlying domain, so the
 * aggregate is a second line rather than the only one.
 *
 * WS-12 IS NOT AN ANALYTICS WORKSTREAM. There is no grouping engine, no
 * date-range DSL, no export. If a richer view is ever wanted it belongs to
 * WS-15's reporting consolidation, not here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function ageInDays(from: Date, asOf: Date): number {
  return Math.max(0, Math.floor((asOf.getTime() - from.getTime()) / DAY_MS));
}

export interface CaseAgeingRow {
  id: number;
  employeeId: number;
  status: string;
  openedAt: Date;
  ageDays: number;
}

/**
 * Open disciplinary cases with their age.
 *
 * Ageing is computed against an explicit `asOf` rather than stored, the same
 * treatment §27.6 gave contract expiry: a persisted "days open" would be wrong
 * the moment the clock moved.
 */
export async function openDisciplinaryCases(
  organizationId: number,
  asOf: Date = new Date(),
): Promise<CaseAgeingRow[]> {
  const rows = await db
    .select({
      id: disciplinaryCasesTable.id,
      employeeId: disciplinaryCasesTable.employeeId,
      status: disciplinaryCasesTable.status,
      openedAt: disciplinaryCasesTable.openedAt,
    })
    .from(disciplinaryCasesTable)
    .where(
      and(eq(disciplinaryCasesTable.organizationId, organizationId), eq(disciplinaryCasesTable.status, "open")),
    )
    .orderBy(disciplinaryCasesTable.openedAt);

  return rows.map((row) => ({ ...row, ageDays: ageInDays(row.openedAt, asOf) }));
}

export interface GrievanceAgeingRow {
  id: number;
  complainantEmployeeId: number;
  status: string;
  submittedAt: Date;
  acknowledgedAt: Date | null;
  ageDays: number;
}

/** Grievances that have not yet reached an outcome, with their age. */
export async function openGrievances(
  organizationId: number,
  asOf: Date = new Date(),
): Promise<GrievanceAgeingRow[]> {
  const rows = await db
    .select({
      id: grievanceCasesTable.id,
      complainantEmployeeId: grievanceCasesTable.complainantEmployeeId,
      status: grievanceCasesTable.status,
      submittedAt: grievanceCasesTable.submittedAt,
      acknowledgedAt: grievanceCasesTable.acknowledgedAt,
    })
    .from(grievanceCasesTable)
    .where(
      and(
        eq(grievanceCasesTable.organizationId, organizationId),
        inArray(grievanceCasesTable.status, ["submitted", "acknowledged", "under_review"]),
      ),
    )
    .orderBy(grievanceCasesTable.submittedAt);

  return rows.map((row) => ({ ...row, ageDays: ageInDays(row.submittedAt, asOf) }));
}

export interface OffboardingRow {
  exitProcessId: number;
  employeeId: number;
  status: string;
  expectedSeparationDate: Date | null;
  separationDate: Date | null;
  requiredOutstanding: number;
  outstandingAssets: number;
}

/**
 * Employees currently offboarding, with what is still outstanding.
 *
 * The outstanding-asset count is a READ of `asset_assignments` — the same
 * observe-only relationship §28.9 requires everywhere else. Nothing here can
 * return an asset or alter custody.
 */
export async function employeesCurrentlyOffboarding(organizationId: number): Promise<OffboardingRow[]> {
  const processes = await db
    .select({
      exitProcessId: employeeExitProcessesTable.id,
      employeeId: employeeExitProcessesTable.employeeId,
      status: employeeExitProcessesTable.status,
      expectedSeparationDate: employeeExitProcessesTable.expectedSeparationDate,
      separationDate: employeeExitProcessesTable.separationDate,
    })
    .from(employeeExitProcessesTable)
    .where(
      and(
        eq(employeeExitProcessesTable.organizationId, organizationId),
        inArray(employeeExitProcessesTable.status, ["initiated", "clearance_in_progress", "ready_for_separation"]),
      ),
    )
    .orderBy(employeeExitProcessesTable.expectedSeparationDate);

  if (processes.length === 0) return [];

  const outstandingByProcess = await db
    .select({
      exitProcessId: clearanceItemsTable.exitProcessId,
      outstanding: sql<number>`cast(count(*) as int)`,
    })
    .from(clearanceItemsTable)
    .where(
      and(
        eq(clearanceItemsTable.organizationId, organizationId),
        eq(clearanceItemsTable.required, true),
        inArray(clearanceItemsTable.status, ["pending", "returned"]),
        inArray(
          clearanceItemsTable.exitProcessId,
          processes.map((p) => p.exitProcessId),
        ),
      ),
    )
    .groupBy(clearanceItemsTable.exitProcessId);

  const assetsByEmployee = await db
    .select({
      employeeId: assetAssignmentsTable.employeeId,
      openAssets: sql<number>`cast(count(*) as int)`,
    })
    .from(assetAssignmentsTable)
    .where(
      and(
        eq(assetAssignmentsTable.organizationId, organizationId),
        isNull(assetAssignmentsTable.custodyEndedAt),
        inArray(
          assetAssignmentsTable.employeeId,
          processes.map((p) => p.employeeId),
        ),
      ),
    )
    .groupBy(assetAssignmentsTable.employeeId);

  const outstandingMap = new Map(outstandingByProcess.map((r) => [r.exitProcessId, r.outstanding]));
  const assetMap = new Map(assetsByEmployee.map((r) => [r.employeeId, r.openAssets]));

  return processes.map((p) => ({
    ...p,
    requiredOutstanding: outstandingMap.get(p.exitProcessId) ?? 0,
    outstandingAssets: assetMap.get(p.employeeId) ?? 0,
  }));
}

export interface OutstandingClearanceRow {
  clearanceItemId: number;
  exitProcessId: number;
  employeeId: number;
  label: string;
  itemType: string;
  required: boolean;
  status: string;
  responsibleDepartmentId: number | null;
}

/**
 * The clearance approver queue: every unresolved item on a running offboarding.
 *
 * `label` is included because an approver cannot act on "item 47" — but note
 * that a clearance label is operational text ("Return laptop"), never case
 * content, so this stays inside §28.23's boundary.
 */
export async function outstandingClearance(
  organizationId: number,
  filters: { responsibleDepartmentId?: number } = {},
): Promise<OutstandingClearanceRow[]> {
  const predicates = [
    eq(clearanceItemsTable.organizationId, organizationId),
    inArray(clearanceItemsTable.status, ["pending", "returned"]),
    inArray(employeeExitProcessesTable.status, ["initiated", "clearance_in_progress", "ready_for_separation"]),
  ];
  if (filters.responsibleDepartmentId != null) {
    predicates.push(eq(clearanceItemsTable.responsibleDepartmentId, filters.responsibleDepartmentId));
  }

  return db
    .select({
      clearanceItemId: clearanceItemsTable.id,
      exitProcessId: clearanceItemsTable.exitProcessId,
      employeeId: employeeExitProcessesTable.employeeId,
      label: clearanceItemsTable.label,
      itemType: clearanceItemsTable.itemType,
      required: clearanceItemsTable.required,
      status: clearanceItemsTable.status,
      responsibleDepartmentId: clearanceItemsTable.responsibleDepartmentId,
    })
    .from(clearanceItemsTable)
    .innerJoin(
      employeeExitProcessesTable,
      eq(employeeExitProcessesTable.id, clearanceItemsTable.exitProcessId),
    )
    .where(and(...predicates))
    .orderBy(clearanceItemsTable.exitProcessId, clearanceItemsTable.sequence);
}

export interface CompletedOffboardingRow {
  exitProcessId: number;
  employeeId: number;
  finalClearedAt: Date | null;
  separationDate: Date | null;
}

export async function completedOffboarding(organizationId: number): Promise<CompletedOffboardingRow[]> {
  return db
    .select({
      exitProcessId: employeeExitProcessesTable.id,
      employeeId: employeeExitProcessesTable.employeeId,
      finalClearedAt: employeeExitProcessesTable.finalClearedAt,
      separationDate: employeeExitProcessesTable.separationDate,
    })
    .from(employeeExitProcessesTable)
    .where(
      and(
        eq(employeeExitProcessesTable.organizationId, organizationId),
        eq(employeeExitProcessesTable.status, "completed"),
      ),
    )
    .orderBy(employeeExitProcessesTable.finalClearedAt);
}

/**
 * Outstanding assigned assets across everyone currently offboarding.
 *
 * A READ, joined to employees only to scope by organization. §28.9 again: this
 * reports, it never returns anything.
 */
export async function outstandingAssetsForOffboarding(
  organizationId: number,
): Promise<Array<{ employeeId: number; assignmentId: number; assetId: number; assetTag: string | null }>> {
  return db
    .select({
      employeeId: assetAssignmentsTable.employeeId,
      assignmentId: assetAssignmentsTable.id,
      assetId: assetAssignmentsTable.assetId,
      assetTag: assetAssignmentsTable.assetTagSnapshot,
    })
    .from(assetAssignmentsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, assetAssignmentsTable.employeeId))
    .innerJoin(
      employeeExitProcessesTable,
      eq(employeeExitProcessesTable.employeeId, assetAssignmentsTable.employeeId),
    )
    .where(
      and(
        eq(assetAssignmentsTable.organizationId, organizationId),
        isNull(assetAssignmentsTable.custodyEndedAt),
        inArray(employeeExitProcessesTable.status, ["initiated", "clearance_in_progress", "ready_for_separation"]),
      ),
    )
    .orderBy(assetAssignmentsTable.employeeId);
}
