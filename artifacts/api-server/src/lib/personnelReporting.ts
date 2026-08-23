/**
 * Phase 3H, W119 — Reporting & Legacy Import. The five frozen Decision-18
 * reports (frozen plan §18/§6), executed through a dedicated, scope-aware
 * route (routes/personnelReporting.ts) rather than the generic
 * GET .../reports/:reportKey/run — mirroring assetReporting.ts's/
 * performanceReporting.ts's own established precedent exactly, for the
 * identical reason: these reports must never be reachable through a runner
 * that doesn't know about personnel_file.read's own narrower gate (never
 * the broad employee.read).
 *
 * HISTORICAL vs CURRENT (frozen plan §3/§6, this session's own load-bearing
 * instruction): every report below is explicit in its own description about
 * which it is. "Current Staff-Number Allocations" and "Personnel Files by
 * Location" read CURRENT state only (employees.employeeNumber's own cache,
 * personnel_files.currentLocationId/currentCustodyState's own cache) —
 * legitimate, since both are explicitly current-state reports, never
 * displaying a value as if it were historical truth. "Historical
 * Staff-Number Allocations" and "Separated Employees with Unreleased
 * Numbers" read employee_number_allocations directly — the one authoritative
 * historical source — and never collapse a reused number's separate
 * allocations into one row (frozen plan §10's own reuse-ambiguity
 * requirement, applied here to reporting).
 */
import { and, eq, isNull, inArray, ne } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeNumberAllocationsTable,
  personnelFilesTable,
  personnelFileVolumesTable,
  recordsLocationsTable,
  departmentsTable,
  positionsTable,
  organizationMembershipsTable,
  usersTable,
  type EmployeeNumberAllocation,
  type PersonnelFile,
  type PersonnelFileVolume,
  type RecordsLocation,
} from "@workspace/db";
import { resolveLastCheckoutDetails } from "./personnelFileCustody";

export class PersonnelReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown personnel report "${key}"`);
    this.name = "PersonnelReportNotFoundError";
  }
}

export interface PersonnelReportColumn {
  key: string;
  label: string;
}
export type PersonnelReportRow = Record<string, string | number | null>;
export interface PersonnelReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: PersonnelReportColumn[];
  rows: PersonnelReportRow[];
}

export const PERSONNEL_REPORT_KEYS = [
  "personnel_current_staff_number_allocations",
  "personnel_historical_staff_number_allocations",
  "personnel_files_by_location",
  "personnel_checked_out_overdue_files",
  "personnel_separated_unreleased_numbers",
] as const;
export type PersonnelReportKey = (typeof PERSONNEL_REPORT_KEYS)[number];

export function isKnownPersonnelReportKey(key: string): key is PersonnelReportKey {
  return (PERSONNEL_REPORT_KEYS as readonly string[]).includes(key);
}

export interface PersonnelReportFilters {
  employeeId?: number;
}

// --- Shared, batched lookups (never one query per row — §38) ---

async function resolveEmployeeLabelsAndDepartmentPosition(
  employeeIds: number[],
): Promise<{
  labelById: Map<number, string>;
  statusById: Map<number, string>;
  departmentIdById: Map<number, number | null>;
  positionIdById: Map<number, number | null>;
  currentNumberById: Map<number, string | null>;
}> {
  const labelById = new Map<number, string>();
  const statusById = new Map<number, string>();
  const departmentIdById = new Map<number, number | null>();
  const positionIdById = new Map<number, number | null>();
  const currentNumberById = new Map<number, string | null>();
  if (employeeIds.length === 0) return { labelById, statusById, departmentIdById, positionIdById, currentNumberById };

  const rows = await db
    .select({
      id: employeesTable.id,
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employmentStatus: employeesTable.employmentStatus,
      departmentId: employeesTable.departmentId,
      positionId: employeesTable.positionId,
      employeeNumber: employeesTable.employeeNumber,
    })
    .from(employeesTable)
    .where(inArray(employeesTable.id, employeeIds));

  for (const r of rows) {
    labelById.set(r.id, `${r.firstName} ${r.lastName}`);
    statusById.set(r.id, r.employmentStatus);
    departmentIdById.set(r.id, r.departmentId);
    positionIdById.set(r.id, r.positionId);
    currentNumberById.set(r.id, r.employeeNumber);
  }
  return { labelById, statusById, departmentIdById, positionIdById, currentNumberById };
}

async function resolveDepartmentPositionNames(
  departmentIds: number[],
  positionIds: number[],
): Promise<{ departmentNameById: Map<number, string>; positionNameById: Map<number, string> }> {
  const [departments, positions] = await Promise.all([
    departmentIds.length ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, departmentIds)) : Promise.resolve([]),
    positionIds.length ? db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(inArray(positionsTable.id, positionIds)) : Promise.resolve([]),
  ]);
  return {
    departmentNameById: new Map(departments.map((d) => [d.id, d.name])),
    positionNameById: new Map(positions.map((p) => [p.id, p.title])),
  };
}

async function resolvePifNumbersByEmployee(employeeIds: number[]): Promise<Map<number, string>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await db.select({ employeeId: personnelFilesTable.employeeId, pifNumber: personnelFilesTable.pifNumber }).from(personnelFilesTable).where(inArray(personnelFilesTable.employeeId, employeeIds));
  return new Map(rows.map((r) => [r.employeeId, r.pifNumber]));
}

async function resolveActorNames(membershipIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (membershipIds.length === 0) return result;
  const rows = await db
    .select({ membershipId: organizationMembershipsTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(organizationMembershipsTable)
    .innerJoin(usersTable, eq(organizationMembershipsTable.applicationUserId, usersTable.id))
    .where(inArray(organizationMembershipsTable.id, membershipIds));
  for (const r of rows) result.set(r.membershipId, `${r.firstName} ${r.lastName}`);
  return result;
}

/** Builds "Parent > Child > Grandchild"-style paths for every location in one pass — never a live query per row. */
async function buildLocationPaths(organizationId: number): Promise<Map<number, string>> {
  const locations = await db.select().from(recordsLocationsTable).where(eq(recordsLocationsTable.organizationId, organizationId));
  const byId = new Map<number, RecordsLocation>(locations.map((l) => [l.id, l]));
  const pathById = new Map<number, string>();

  function resolvePath(id: number, seen: Set<number>): string {
    const cached = pathById.get(id);
    if (cached) return cached;
    const location = byId.get(id);
    if (!location) return "—";
    if (seen.has(id)) return location.name; // Defensive only — cycles are rejected at write time (mirrors departments.ts's own precedent).
    seen.add(id);
    const path = location.parentId != null ? `${resolvePath(location.parentId, seen)} > ${location.name}` : location.name;
    pathById.set(id, path);
    return path;
  }

  for (const location of locations) resolvePath(location.id, new Set());
  return pathById;
}

// --- REPORT 1: Current Staff-Number Allocations (CURRENT) ---

async function runCurrentAllocations(organizationId: number, filters: PersonnelReportFilters): Promise<{ columns: PersonnelReportColumn[]; rows: PersonnelReportRow[] }> {
  const columns: PersonnelReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "staffNumber", label: "Staff Number" },
    { key: "allocationDate", label: "Allocation Date" },
    { key: "allocationMethod", label: "Allocation Method" },
    { key: "employmentStatus", label: "Employment Status" },
    { key: "pifNumber", label: "PIF Number" },
    { key: "department", label: "Department" },
    { key: "position", label: "Position" },
  ];

  const conditions = [eq(employeeNumberAllocationsTable.organizationId, organizationId), isNull(employeeNumberAllocationsTable.validTo)];
  if (filters.employeeId != null) conditions.push(eq(employeeNumberAllocationsTable.employeeId, filters.employeeId));
  const allocations = await db.select().from(employeeNumberAllocationsTable).where(and(...conditions));
  if (allocations.length === 0) return { columns, rows: [] };

  const employeeIds = [...new Set(allocations.map((a) => a.employeeId))];
  const [{ labelById, statusById, departmentIdById, positionIdById }, pifByEmployeeId] = await Promise.all([
    resolveEmployeeLabelsAndDepartmentPosition(employeeIds),
    resolvePifNumbersByEmployee(employeeIds),
  ]);
  const departmentIds = [...new Set([...departmentIdById.values()].filter((id): id is number => id != null))];
  const positionIds = [...new Set([...positionIdById.values()].filter((id): id is number => id != null))];
  const { departmentNameById, positionNameById } = await resolveDepartmentPositionNames(departmentIds, positionIds);

  const rows: PersonnelReportRow[] = allocations.map((a) => ({
    employee: labelById.get(a.employeeId) ?? "Unknown employee",
    staffNumber: a.employeeNumber,
    allocationDate: a.validFrom.toISOString(),
    allocationMethod: a.allocationMethod,
    employmentStatus: statusById.get(a.employeeId) ?? "—",
    pifNumber: pifByEmployeeId.get(a.employeeId) ?? null,
    department: (() => {
      const id = departmentIdById.get(a.employeeId);
      return id != null ? (departmentNameById.get(id) ?? "—") : "—";
    })(),
    position: (() => {
      const id = positionIdById.get(a.employeeId);
      return id != null ? (positionNameById.get(id) ?? "—") : "—";
    })(),
  }));
  return { columns, rows };
}

// --- REPORT 2: Historical Staff-Number Allocations (HISTORICAL) ---

async function runHistoricalAllocations(organizationId: number, filters: PersonnelReportFilters): Promise<{ columns: PersonnelReportColumn[]; rows: PersonnelReportRow[] }> {
  const columns: PersonnelReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "staffNumber", label: "Staff Number" },
    { key: "validFrom", label: "Valid From" },
    { key: "validTo", label: "Valid To" },
    { key: "isCurrent", label: "Current Holder" },
    { key: "allocationMethod", label: "Allocation Method" },
    { key: "allocatedBy", label: "Allocated By" },
    { key: "releasedBy", label: "Released By" },
    { key: "pifNumber", label: "PIF Number (current)" },
  ];

  const conditions = [eq(employeeNumberAllocationsTable.organizationId, organizationId)];
  if (filters.employeeId != null) conditions.push(eq(employeeNumberAllocationsTable.employeeId, filters.employeeId));
  // Every allocation is its own row — a reused number never collapses to
  // one row (frozen plan §10's reuse-ambiguity requirement, applied here).
  const allocations = await db.select().from(employeeNumberAllocationsTable).where(and(...conditions));
  if (allocations.length === 0) return { columns, rows: [] };
  allocations.sort((a, b) => (a.employeeNumber === b.employeeNumber ? a.validFrom.getTime() - b.validFrom.getTime() : a.employeeNumber.localeCompare(b.employeeNumber)));

  const employeeIds = [...new Set(allocations.map((a) => a.employeeId))];
  const membershipIds = [
    ...new Set([...allocations.map((a) => a.allocatedByMembershipId), ...allocations.map((a) => a.releasedByMembershipId)].filter((id): id is number => id != null)),
  ];
  const [{ labelById }, pifByEmployeeId, actorNameByMembershipId] = await Promise.all([
    resolveEmployeeLabelsAndDepartmentPosition(employeeIds),
    resolvePifNumbersByEmployee(employeeIds),
    resolveActorNames(membershipIds),
  ]);

  const rows: PersonnelReportRow[] = allocations.map((a: EmployeeNumberAllocation) => ({
    employee: labelById.get(a.employeeId) ?? "Unknown employee",
    staffNumber: a.employeeNumber,
    validFrom: a.validFrom.toISOString(),
    validTo: a.validTo ? a.validTo.toISOString() : null,
    isCurrent: a.validTo === null ? "Yes" : "No",
    allocationMethod: a.allocationMethod,
    allocatedBy: a.allocatedByMembershipId != null ? (actorNameByMembershipId.get(a.allocatedByMembershipId) ?? "—") : "—",
    releasedBy: a.releasedByMembershipId != null ? (actorNameByMembershipId.get(a.releasedByMembershipId) ?? "—") : "—",
    pifNumber: pifByEmployeeId.get(a.employeeId) ?? null,
  }));
  return { columns, rows };
}

// --- REPORT 3: Personnel Files by Location (CURRENT) ---

async function runFilesByLocation(organizationId: number, filters: PersonnelReportFilters): Promise<{ columns: PersonnelReportColumn[]; rows: PersonnelReportRow[] }> {
  const columns: PersonnelReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "pifNumber", label: "PIF Number" },
    { key: "staffNumber", label: "Staff Number (current)" },
    { key: "volume", label: "Volume" },
    { key: "location", label: "Location" },
    { key: "custodyState", label: "Custody State" },
  ];

  const conditions = [eq(personnelFilesTable.organizationId, organizationId)];
  if (filters.employeeId != null) conditions.push(eq(personnelFilesTable.employeeId, filters.employeeId));
  const files = await db.select().from(personnelFilesTable).where(and(...conditions));
  if (files.length === 0) return { columns, rows: [] };

  const fileIds = files.map((f) => f.id);
  const volumes = await db.select().from(personnelFileVolumesTable).where(and(eq(personnelFileVolumesTable.organizationId, organizationId), inArray(personnelFileVolumesTable.personnelFileId, fileIds)));
  const volumesByFileId = new Map<number, PersonnelFileVolume[]>();
  for (const v of volumes) {
    const list = volumesByFileId.get(v.personnelFileId) ?? [];
    list.push(v);
    volumesByFileId.set(v.personnelFileId, list);
  }

  const employeeIds = [...new Set(files.map((f) => f.employeeId))];
  const [{ labelById, currentNumberById }, locationPathById] = await Promise.all([
    resolveEmployeeLabelsAndDepartmentPosition(employeeIds),
    buildLocationPaths(organizationId),
  ]);

  const rows: PersonnelReportRow[] = [];
  for (const file of files as PersonnelFile[]) {
    const volumesForFile = volumesByFileId.get(file.id) ?? [];
    // No volumes in use for this file — custody lives on the file itself.
    if (volumesForFile.length === 0) {
      rows.push({
        employee: labelById.get(file.employeeId) ?? "Unknown employee",
        pifNumber: file.pifNumber,
        staffNumber: currentNumberById.get(file.employeeId) ?? null,
        volume: "—",
        location: file.currentLocationId != null ? (locationPathById.get(file.currentLocationId) ?? "—") : "—",
        custodyState: file.currentCustodyState,
      });
    } else {
      for (const volume of volumesForFile) {
        rows.push({
          employee: labelById.get(file.employeeId) ?? "Unknown employee",
          pifNumber: file.pifNumber,
          staffNumber: currentNumberById.get(file.employeeId) ?? null,
          volume: String(volume.volumeNumber),
          location: volume.currentLocationId != null ? (locationPathById.get(volume.currentLocationId) ?? "—") : "—",
          custodyState: volume.currentCustodyState,
        });
      }
    }
  }
  return { columns, rows };
}

// --- REPORT 4: Checked-Out / Overdue Personnel Files (CURRENT, overdue live-derived) ---

async function runCheckedOutOverdue(organizationId: number, filters: PersonnelReportFilters): Promise<{ columns: PersonnelReportColumn[]; rows: PersonnelReportRow[] }> {
  const columns: PersonnelReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "pifNumber", label: "PIF Number" },
    { key: "volume", label: "Volume" },
    { key: "custodyState", label: "Custody State" },
    { key: "destination", label: "Checked Out To" },
    { key: "expectedReturnDate", label: "Expected Return" },
    { key: "overdue", label: "Overdue" },
  ];

  // All of this org's personnel files (scoped to the employee filter, if
  // any) — the base set both the file-level and volume-level custody rows
  // below are drawn from, fetched once rather than twice.
  const allFilesConditions = [eq(personnelFilesTable.organizationId, organizationId)];
  if (filters.employeeId != null) allFilesConditions.push(eq(personnelFilesTable.employeeId, filters.employeeId));
  const allFiles = await db.select().from(personnelFilesTable).where(and(...allFilesConditions));
  if (allFiles.length === 0) return { columns, rows: [] };

  // File-level custody rows (no volumes in use for that file).
  const files = (allFiles as PersonnelFile[]).filter((f) => f.currentCustodyState !== "in_registry");

  const allFileIds = allFiles.map((f) => f.id);
  const volumes = await db
    .select()
    .from(personnelFileVolumesTable)
    .where(and(eq(personnelFileVolumesTable.organizationId, organizationId), ne(personnelFileVolumesTable.currentCustodyState, "in_registry"), inArray(personnelFileVolumesTable.personnelFileId, allFileIds)));

  if (files.length === 0 && volumes.length === 0) return { columns, rows: [] };

  const allPersonnelFileIds = [...new Set([...files.map((f) => f.id), ...volumes.map((v) => v.personnelFileId)])];
  const parentById = new Map(allFiles.map((f) => [f.id, f]));

  const employeeIds = [...new Set(allFiles.map((f) => f.employeeId))];
  const [{ labelById }, lastCheckoutByKey] = await Promise.all([
    resolveEmployeeLabelsAndDepartmentPosition(employeeIds),
    resolveLastCheckoutDetails(organizationId, allPersonnelFileIds),
  ]);

  const now = new Date();
  const rows: PersonnelReportRow[] = [];
  for (const file of files as PersonnelFile[]) {
    const detail = lastCheckoutByKey.get(`${file.id}:null`);
    const overdue = file.currentCustodyState === "checked_out" && detail?.expectedReturnDate != null && detail.expectedReturnDate.getTime() < now.getTime();
    rows.push({
      employee: labelById.get(file.employeeId) ?? "Unknown employee",
      pifNumber: file.pifNumber,
      volume: "—",
      custodyState: file.currentCustodyState,
      destination: detail?.destination ?? null,
      expectedReturnDate: detail?.expectedReturnDate ? detail.expectedReturnDate.toISOString() : null,
      overdue: overdue ? "Yes" : "No",
    });
  }
  for (const volume of volumes as PersonnelFileVolume[]) {
    const parent = parentById.get(volume.personnelFileId);
    const detail = lastCheckoutByKey.get(`${volume.personnelFileId}:${volume.id}`);
    const overdue = volume.currentCustodyState === "checked_out" && detail?.expectedReturnDate != null && detail.expectedReturnDate.getTime() < now.getTime();
    rows.push({
      employee: parent ? (labelById.get(parent.employeeId) ?? "Unknown employee") : "Unknown employee",
      pifNumber: parent?.pifNumber ?? "—",
      volume: String(volume.volumeNumber),
      custodyState: volume.currentCustodyState,
      destination: detail?.destination ?? null,
      expectedReturnDate: detail?.expectedReturnDate ? detail.expectedReturnDate.toISOString() : null,
      overdue: overdue ? "Yes" : "No",
    });
  }
  return { columns, rows };
}

// --- REPORT 5: Separated Employees with Unreleased Staff Numbers (informational only — never blocks, never auto-releases) ---

async function runSeparatedUnreleased(organizationId: number, filters: PersonnelReportFilters): Promise<{ columns: PersonnelReportColumn[]; rows: PersonnelReportRow[] }> {
  const columns: PersonnelReportColumn[] = [
    { key: "employee", label: "Employee" },
    { key: "staffNumber", label: "Staff Number" },
    { key: "separationDate", label: "Separation Date" },
    { key: "separationReason", label: "Separation Reason" },
    { key: "allocationDate", label: "Allocation Date" },
  ];

  const employeeConditions = [eq(employeesTable.organizationId, organizationId), eq(employeesTable.employmentStatus, "terminated")];
  if (filters.employeeId != null) employeeConditions.push(eq(employeesTable.id, filters.employeeId));
  const separated = await db
    .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, separationDate: employeesTable.separationDate, separationReason: employeesTable.separationReason })
    .from(employeesTable)
    .where(and(...employeeConditions));
  if (separated.length === 0) return { columns, rows: [] };

  const employeeIds = separated.map((e) => e.id);
  const openAllocations = await db
    .select()
    .from(employeeNumberAllocationsTable)
    .where(and(eq(employeeNumberAllocationsTable.organizationId, organizationId), isNull(employeeNumberAllocationsTable.validTo), inArray(employeeNumberAllocationsTable.employeeId, employeeIds)));
  const allocationByEmployeeId = new Map(openAllocations.map((a) => [a.employeeId, a]));

  const rows: PersonnelReportRow[] = [];
  for (const e of separated) {
    const allocation = allocationByEmployeeId.get(e.id);
    if (!allocation) continue; // Released, or never had a number — not this report's concern.
    rows.push({
      employee: `${e.firstName} ${e.lastName}`,
      staffNumber: allocation.employeeNumber,
      separationDate: e.separationDate ? e.separationDate.toISOString() : null,
      separationReason: e.separationReason,
      allocationDate: allocation.validFrom.toISOString(),
    });
  }
  return { columns, rows };
}

const RUNNERS: Record<PersonnelReportKey, (organizationId: number, filters: PersonnelReportFilters) => Promise<{ columns: PersonnelReportColumn[]; rows: PersonnelReportRow[] }>> = {
  personnel_current_staff_number_allocations: runCurrentAllocations,
  personnel_historical_staff_number_allocations: runHistoricalAllocations,
  personnel_files_by_location: runFilesByLocation,
  personnel_checked_out_overdue_files: runCheckedOutOverdue,
  personnel_separated_unreleased_numbers: runSeparatedUnreleased,
};

export async function runPersonnelReport(params: { key: string; label: string; description: string; organizationId: number; filters: PersonnelReportFilters }): Promise<PersonnelReportResult> {
  if (!isKnownPersonnelReportKey(params.key)) throw new PersonnelReportNotFoundError(params.key);
  const { columns, rows } = await RUNNERS[params.key](params.organizationId, params.filters);
  return { key: params.key, label: params.label, description: params.description, generatedAt: new Date(), columns, rows };
}
