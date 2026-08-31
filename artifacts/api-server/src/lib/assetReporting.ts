/**
 * Asset Dashboard & Reporting (Phase 3E, W102 — the frozen plan's own §24
 * numbering; this prompt's own label of "W101" was reconciled with the
 * user before implementation, since the frozen plan's actual W101 is a
 * separate, still-unbuilt, zero-new-backend-logic "Internal Asset
 * Workspace"): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §17/§18/§20.
 * Purely read-only aggregation over W95-W100's existing assets/
 * asset_assignments/asset_maintenance/asset_incidents data — no second
 * lifecycle engine, no persisted dashboard/report table, nothing mutated
 * by any function here.
 *
 * SCOPE (§17, §18, Owner Decision 3): own / manager-of-record-CURRENT-only
 * / organization-wide, resolved from asset_management.reports.read (the
 * floor to reach the route) plus asset_management.manage (org-wide
 * signal) — mirroring performanceReporting.ts's/learningReporting.ts's own
 * {isOrgWide, ownEmployeeId} shape, extended with a live-resolved
 * `directReportEmployeeIds` set. Unlike Performance's reviewer-of-record
 * (per-row snapshot comparison) or Learning's manager-of-record (a
 * *snapshotted* column comparison), Assets' own manager scope is
 * explicitly LIVE (Owner Decision 3, assetManagementAuthorization.ts's own
 * file header) — resolved fresh from employees.reportingManagerId on
 * every request, never cached/snapshotted. This file makes its own direct
 * query for that (mirrors lib/assets.ts's own listTeamAssetAssignments
 * query shape) rather than importing from lib/assets.ts, to avoid touching
 * that file's own business-rule engine for a read-only reporting need.
 *
 * PER-REPORT SCOPE DIFFERS BY REPORT (§17's own literal Scope column,
 * disclosed, not uniform): `asset_register` and `asset_maintenance_history`
 * are **organization-wide only** — a non-`.manage` caller has no narrower
 * tier to fall back to for either, so both deny (403) rather than silently
 * returning an empty or a silently-full result; `asset_unreturned_by_
 * employee` and the dashboard are the full own/manager/org-wide three-tier
 * model. This is the safe, security-preserving reading where the frozen
 * table names exactly one scope value for a report — disclosed as an
 * interpretation, not invented business logic, since the alternative
 * (silently granting org-wide-shaped data to a non-`.manage` caller) would
 * be the unsafe direction to guess.
 *
 * HISTORICAL INTEGRITY (§14): `asset_unreturned_by_employee` always reads
 * the assignment's own SNAPSHOT fields (assetTagSnapshot/assetNameSnapshot/
 * categorySnapshot/departmentIdSnapshot) for display — never a live join to
 * the current asset/employee-department row — per §14's own explicit
 * classification. `asset_register` always reads the asset's own LIVE
 * current fields (it is a current-state report by definition). Current
 * holder resolution in `asset_register` and department-filter resolution
 * in `asset_unreturned_by_employee` both use `asset_assignments.employeeId`
 * as the LIVE reference §14 itself calls out. `asset_maintenance_history`
 * has no snapshot fields at all on asset_maintenance (§14: "No snapshot
 * question — maintenance is inherently tied to current asset identity"),
 * so its own asset-name/tag display column is necessarily a LIVE join.
 *
 * NO FINANCIAL/RATE TILE OR COLUMN ANYWHERE (§3, §7, §18): purchaseCost/
 * purchaseCurrency, where exposed, are always reference-only pass-through
 * fields — never turned into book value, depreciation, replacement value,
 * or any computed financial figure.
 */
import { and, eq, inArray, isNull, gte, lte, count as sqlCount } from "drizzle-orm";
import {
  db,
  assetsTable,
  assetAssignmentsTable,
  assetMaintenanceTable,
  assetIncidentsTable,
  employeesTable,
  type Asset,
  type AssetAssignment,
  type AssetMaintenance,
} from "@workspace/db";
import { resolveAssetActorEmployeeId, hasOrgWideAssetAccess } from "./assetManagementAuthorization";
import { listLiveDirectReportEmployeeIds } from "./directReports";
import { toIsoDate } from "./leaveRequests";

export class AssetReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown asset report "${key}"`);
    this.name = "AssetReportNotFoundError";
  }
}

/** A report whose own frozen Scope column names organization-wide only — a non-.manage caller is denied outright rather than given a silently-narrowed or silently-full result. */
export class AssetReportOrgWideOnlyError extends Error {
  constructor() {
    super("This report requires organization-wide asset access");
    this.name = "AssetReportOrgWideOnlyError";
  }
}

// --- Visibility scope (§17, §18, Owner Decision 3 — manager tier LIVE, never snapshotted) ---

export interface AssetReportScope {
  isOrgWide: boolean;
  ownEmployeeId: number | null;
  /** Current direct reports, live-resolved from employees.reportingManagerId at request time — never cached, never a snapshot. Empty (not null) when org-wide or when ownEmployeeId has no direct reports. */
  directReportEmployeeIds: number[];
}

export async function resolveAssetReportScope(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<AssetReportScope> {
  const isOrgWide = await hasOrgWideAssetAccess(params.membershipId, "asset_management.manage");
  if (isOrgWide) return { isOrgWide: true, ownEmployeeId: null, directReportEmployeeIds: [] };

  const ownEmployeeId = await resolveAssetActorEmployeeId(params.organizationId, params.applicationUserId);
  if (ownEmployeeId == null) return { isOrgWide: false, ownEmployeeId: null, directReportEmployeeIds: [] };

  // WS-16 Pass 2A (§32.9 #1): the identical live reportingManagerId query
  // this file used to spell out inline, now the one shared helper. Same
  // predicate, same ids, same absence of a status filter — the manager tier
  // stays LIVE and never becomes a snapshot (Owner Decision 3).
  const directReportEmployeeIds = await listLiveDirectReportEmployeeIds(params.organizationId, ownEmployeeId);

  return { isOrgWide: false, ownEmployeeId, directReportEmployeeIds };
}

/** The full set of employeeIds the caller may see custody data for — own id plus current direct reports, deduplicated. Empty for org-wide (not applicable — org-wide has no employee-set restriction at all). */
function scopedEmployeeIds(scope: AssetReportScope): number[] {
  if (scope.isOrgWide) return [];
  const ids = new Set<number>();
  if (scope.ownEmployeeId != null) ids.add(scope.ownEmployeeId);
  for (const id of scope.directReportEmployeeIds) ids.add(id);
  return [...ids];
}

// --- Dashboard (GET .../assets/dashboard) ---

const ASSET_STATUS_ORDER = ["available", "assigned", "maintenance", "lost", "retired"] as const;

export interface AssetDashboardStatusItem {
  status: (typeof ASSET_STATUS_ORDER)[number];
  count: number;
}

export interface AssetDashboard {
  totalAssetCount: number;
  /** Zero-filled, all 5 statuses, fixed order (§18). */
  statusBreakdown: AssetDashboardStatusItem[];
  employeesWithAssignedAssetsCount: number;
  overdueReturnCount: number;
  openIncidentCount: number;
}

/**
 * §18's own 5 deterministic tiles, no financial/rate/KPI tile. "In scope"
 * (§18's own literal phrase, applied uniformly to every tile) means: for
 * org-wide, every asset/assignment/incident in the organization; for own/
 * manager, only assets currently under an active (custodyEndedAt IS NULL)
 * assignment to the caller or a current direct report — an employee/
 * manager has no legitimate visibility into an asset they have never held.
 */
export async function getAssetDashboard(organizationId: number, scope: AssetReportScope): Promise<AssetDashboard> {
  if (scope.isOrgWide) {
    const orgAssets = await db.select({ status: assetsTable.status }).from(assetsTable).where(eq(assetsTable.organizationId, organizationId));
    const statusCounts = new Map<string, number>();
    for (const a of orgAssets) statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
    const statusBreakdown = ASSET_STATUS_ORDER.map((status) => ({ status, count: statusCounts.get(status) ?? 0 }));

    const activeAssignmentConditions = and(eq(assetAssignmentsTable.organizationId, organizationId), isNull(assetAssignmentsTable.custodyEndedAt));
    const activeAssignments = await db
      .select({ employeeId: assetAssignmentsTable.employeeId, expectedReturnDate: assetAssignmentsTable.expectedReturnDate })
      .from(assetAssignmentsTable)
      .where(activeAssignmentConditions);

    const today = toIsoDate(new Date());
    const overdueReturnCount = activeAssignments.filter((a) => a.expectedReturnDate != null && a.expectedReturnDate < today).length;

    const [incidentRow] = await db
      .select({ value: sqlCount() })
      .from(assetIncidentsTable)
      .where(and(eq(assetIncidentsTable.organizationId, organizationId), eq(assetIncidentsTable.status, "open")));

    return {
      totalAssetCount: orgAssets.length,
      statusBreakdown,
      employeesWithAssignedAssetsCount: new Set(activeAssignments.map((a) => a.employeeId)).size,
      overdueReturnCount,
      openIncidentCount: Number(incidentRow?.value ?? 0),
    };
  }

  const employeeIds = scopedEmployeeIds(scope);
  if (employeeIds.length === 0) {
    return {
      totalAssetCount: 0,
      statusBreakdown: ASSET_STATUS_ORDER.map((status) => ({ status, count: 0 })),
      employeesWithAssignedAssetsCount: 0,
      overdueReturnCount: 0,
      openIncidentCount: 0,
    };
  }

  const activeAssignments = await db
    .select()
    .from(assetAssignmentsTable)
    .where(and(eq(assetAssignmentsTable.organizationId, organizationId), isNull(assetAssignmentsTable.custodyEndedAt), inArray(assetAssignmentsTable.employeeId, employeeIds)));

  const assetIds = [...new Set(activeAssignments.map((a) => a.assetId))];
  const inScopeAssets: Asset[] = assetIds.length
    ? await db.select().from(assetsTable).where(and(eq(assetsTable.organizationId, organizationId), inArray(assetsTable.id, assetIds)))
    : [];

  const statusCounts = new Map<string, number>();
  for (const a of inScopeAssets) statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1);
  const statusBreakdown = ASSET_STATUS_ORDER.map((status) => ({ status, count: statusCounts.get(status) ?? 0 }));

  const today = toIsoDate(new Date());
  const overdueReturnCount = activeAssignments.filter((a) => a.expectedReturnDate != null && a.expectedReturnDate < today).length;

  const openIncidentCount = assetIds.length
    ? Number(
        (
          await db
            .select({ value: sqlCount() })
            .from(assetIncidentsTable)
            .where(and(eq(assetIncidentsTable.organizationId, organizationId), eq(assetIncidentsTable.status, "open"), inArray(assetIncidentsTable.assetId, assetIds)))
        )[0]?.value ?? 0,
      )
    : 0;

  return {
    totalAssetCount: inScopeAssets.length,
    statusBreakdown,
    employeesWithAssignedAssetsCount: new Set(activeAssignments.map((a) => a.employeeId)).size,
    overdueReturnCount,
    openIncidentCount,
  };
}

// --- Reports (GET .../assets/reports/:reportKey) ---

export interface AssetReportColumn {
  key: string;
  label: string;
}
export type AssetReportRow = Record<string, string | number | null>;
export interface AssetReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: AssetReportColumn[];
  rows: AssetReportRow[];
}

export interface AssetReportFilters {
  categoryCode?: string;
  status?: string;
  branchId?: number;
  employeeId?: number;
  departmentId?: number;
  assetId?: number;
  maintenanceStatus?: string;
  dateFrom?: string;
  dateTo?: string;
}

function isoOrNull(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

/** REPORT 1 (§17) — asset_register. Organization-wide only; one row per in-scope asset; every field is the asset's own current, live value (never a snapshot) — this is a current-state report by definition. */
async function runAssetRegister(organizationId: number, filters: AssetReportFilters): Promise<{ columns: AssetReportColumn[]; rows: AssetReportRow[] }> {
  const conditions = [eq(assetsTable.organizationId, organizationId)];
  if (filters.categoryCode != null) conditions.push(eq(assetsTable.categoryCode, filters.categoryCode));
  if (filters.status != null) conditions.push(eq(assetsTable.status, filters.status as Asset["status"]));
  if (filters.branchId != null) conditions.push(eq(assetsTable.branchId, filters.branchId));

  const assets = await db.select().from(assetsTable).where(and(...conditions));

  const columns: AssetReportColumn[] = [
    { key: "assetTag", label: "Asset Tag" },
    { key: "name", label: "Name" },
    { key: "categoryCode", label: "Category" },
    { key: "status", label: "Status" },
    { key: "condition", label: "Condition" },
    { key: "branchId", label: "Branch ID" },
    { key: "currentHolder", label: "Current Holder" },
    { key: "serialNumber", label: "Serial Number" },
    { key: "purchaseCost", label: "Purchase Cost (reference only)" },
    { key: "purchaseCurrency", label: "Currency" },
  ];
  if (assets.length === 0) return { columns, rows: [] };

  // Current holder — batched, no N+1: one query for every active assignment
  // in the organization, then an assetId -> employee-label map, resolved
  // via one further batched employee lookup.
  const activeAssignments = await db
    .select({ assetId: assetAssignmentsTable.assetId, employeeId: assetAssignmentsTable.employeeId })
    .from(assetAssignmentsTable)
    .where(and(eq(assetAssignmentsTable.organizationId, organizationId), isNull(assetAssignmentsTable.custodyEndedAt)));
  const holderEmployeeIdByAssetId = new Map(activeAssignments.map((a) => [a.assetId, a.employeeId]));
  const holderEmployeeIds = [...new Set(activeAssignments.map((a) => a.employeeId))];
  const holderEmployees = holderEmployeeIds.length
    ? await db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(inArray(employeesTable.id, holderEmployeeIds))
    : [];
  const holderLabelById = new Map(holderEmployees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

  const rows: AssetReportRow[] = assets.map((a) => {
    const holderEmployeeId = holderEmployeeIdByAssetId.get(a.id);
    return {
      assetTag: a.assetTag,
      name: a.name,
      categoryCode: a.categoryCode,
      status: a.status,
      condition: a.condition,
      branchId: a.branchId,
      currentHolder: holderEmployeeId != null ? (holderLabelById.get(holderEmployeeId) ?? "Unknown employee") : "—",
      serialNumber: a.serialNumber,
      purchaseCost: a.purchaseCost,
      purchaseCurrency: a.purchaseCurrency,
    };
  });
  return { columns, rows };
}

/**
 * REPORT 2 (§17) — asset_unreturned_by_employee. Own / manager-of-record-
 * CURRENT-only / organization-wide; one row per ACTIVE (custodyEndedAt IS
 * NULL) asset_assignments record. Every display field reads the
 * assignment's own SNAPSHOT columns (§14) — never a live join to the
 * current asset/employee-department row. `employeeId` is the one LIVE
 * reference (§14) — used both for the employee's current display name and
 * for scope/filter matching, since a snapshot of "who" was never taken.
 * Informational only (§10, Decision 5) — this function never blocks or
 * touches employees/exit-process data of any kind.
 */
async function runAssetUnreturnedByEmployee(
  organizationId: number,
  scope: AssetReportScope,
  filters: AssetReportFilters,
): Promise<{ columns: AssetReportColumn[]; rows: AssetReportRow[] }> {
  const conditions = [eq(assetAssignmentsTable.organizationId, organizationId), isNull(assetAssignmentsTable.custodyEndedAt)];

  if (!scope.isOrgWide) {
    const employeeIds = scopedEmployeeIds(scope);
    if (employeeIds.length === 0) return { columns: unreturnedColumns(), rows: [] };
    conditions.push(inArray(assetAssignmentsTable.employeeId, employeeIds));
  }
  if (filters.employeeId != null) conditions.push(eq(assetAssignmentsTable.employeeId, filters.employeeId));
  if (filters.departmentId != null) conditions.push(eq(assetAssignmentsTable.departmentIdSnapshot, filters.departmentId));

  const assignments: AssetAssignment[] = await db.select().from(assetAssignmentsTable).where(and(...conditions));
  const columns = unreturnedColumns();
  if (assignments.length === 0) return { columns, rows: [] };

  const employeeIds = [...new Set(assignments.map((a) => a.employeeId))];
  const employees = await db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(inArray(employeesTable.id, employeeIds));
  const employeeLabelById = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

  const today = toIsoDate(new Date());
  const rows: AssetReportRow[] = assignments.map((a) => ({
    employee: employeeLabelById.get(a.employeeId) ?? "Unknown employee",
    employeeId: a.employeeId,
    assetTag: a.assetTagSnapshot,
    assetName: a.assetNameSnapshot,
    category: a.categorySnapshot,
    departmentId: a.departmentIdSnapshot,
    issuedAt: isoOrNull(a.issuedAt),
    expectedReturnDate: a.expectedReturnDate,
    overdue: a.expectedReturnDate != null && a.expectedReturnDate < today ? "Yes" : "No",
    issueCondition: a.issueCondition,
  }));
  return { columns, rows };
}
function unreturnedColumns(): AssetReportColumn[] {
  return [
    { key: "employee", label: "Employee" },
    { key: "employeeId", label: "Employee ID" },
    { key: "assetTag", label: "Asset Tag" },
    { key: "assetName", label: "Asset Name" },
    { key: "category", label: "Category" },
    { key: "departmentId", label: "Department ID (at issue time)" },
    { key: "issuedAt", label: "Issued" },
    { key: "expectedReturnDate", label: "Expected Return" },
    { key: "overdue", label: "Overdue" },
    { key: "issueCondition", label: "Issue Condition" },
  ];
}

/**
 * REPORT 3 (§17) — asset_maintenance_history. Organization-wide only.
 * `asset_maintenance` has no snapshot fields at all (§14: "No snapshot
 * question"), so the asset display column is a LIVE, batched join — never
 * per-row. Date range filters `createdAt` (the record's own creation
 * timestamp) — disclosed: §17 says "over a date range" without naming the
 * exact timestamp column; `createdAt` is the only column guaranteed
 * non-null for every record regardless of status (a still-`scheduled`
 * record has `startedAt: null`), so filtering on it is the only reading
 * that never silently excludes a record the caller's own date window was
 * genuinely meant to include. No vendor analytics, cost analytics beyond
 * the record's own reference-only `cost` field, SLA, or downtime KPI —
 * W100's own "simple history only" scope is preserved here (§11).
 */
async function runAssetMaintenanceHistory(organizationId: number, filters: AssetReportFilters): Promise<{ columns: AssetReportColumn[]; rows: AssetReportRow[] }> {
  const columns: AssetReportColumn[] = [
    { key: "assetTag", label: "Asset Tag" },
    { key: "assetName", label: "Asset Name" },
    { key: "maintenanceType", label: "Maintenance Type" },
    { key: "status", label: "Status" },
    { key: "providerText", label: "Provider" },
    { key: "startedAt", label: "Started" },
    { key: "completedAt", label: "Completed" },
    { key: "cost", label: "Cost (reference only)" },
    { key: "description", label: "Description" },
    { key: "notes", label: "Notes" },
  ];

  const records = await fetchMaintenanceRecords(organizationId, filters);
  if (records.length === 0) return { columns, rows: [] };

  const assetIds = [...new Set(records.map((m) => m.assetId))];
  const assets = await db.select({ id: assetsTable.id, assetTag: assetsTable.assetTag, name: assetsTable.name }).from(assetsTable).where(inArray(assetsTable.id, assetIds));
  const assetById = new Map(assets.map((a) => [a.id, a]));

  const rows: AssetReportRow[] = records.map((m) => {
    const asset = assetById.get(m.assetId);
    return {
      assetTag: asset?.assetTag ?? "Unknown asset",
      assetName: asset?.name ?? "Unknown asset",
      maintenanceType: m.maintenanceType,
      status: m.status,
      providerText: m.providerText,
      startedAt: isoOrNull(m.startedAt),
      completedAt: isoOrNull(m.completedAt),
      cost: m.cost,
      description: m.description,
      notes: m.notes,
    };
  });
  return { columns, rows };
}

async function fetchMaintenanceRecords(organizationId: number, filters: AssetReportFilters): Promise<AssetMaintenance[]> {
  const conditions = [eq(assetMaintenanceTable.organizationId, organizationId)];
  if (filters.assetId != null) conditions.push(eq(assetMaintenanceTable.assetId, filters.assetId));
  if (filters.maintenanceStatus != null) conditions.push(eq(assetMaintenanceTable.status, filters.maintenanceStatus as AssetMaintenance["status"]));
  if (filters.dateFrom != null) conditions.push(gte(assetMaintenanceTable.createdAt, new Date(filters.dateFrom)));
  if (filters.dateTo != null) conditions.push(lte(assetMaintenanceTable.createdAt, new Date(filters.dateTo)));
  return db.select().from(assetMaintenanceTable).where(and(...conditions));
}

const ORG_WIDE_ONLY_KEYS = new Set(["asset_register", "asset_maintenance_history"]);

export function isKnownAssetReportKey(key: string): boolean {
  return key === "asset_register" || key === "asset_unreturned_by_employee" || key === "asset_maintenance_history";
}

export async function runAssetReport(params: {
  key: string;
  label: string;
  description: string;
  organizationId: number;
  scope: AssetReportScope;
  filters: AssetReportFilters;
}): Promise<AssetReportResult> {
  if (!isKnownAssetReportKey(params.key)) throw new AssetReportNotFoundError(params.key);
  if (ORG_WIDE_ONLY_KEYS.has(params.key) && !params.scope.isOrgWide) throw new AssetReportOrgWideOnlyError();

  let result: { columns: AssetReportColumn[]; rows: AssetReportRow[] };
  if (params.key === "asset_register") {
    result = await runAssetRegister(params.organizationId, params.filters);
  } else if (params.key === "asset_maintenance_history") {
    result = await runAssetMaintenanceHistory(params.organizationId, params.filters);
  } else {
    result = await runAssetUnreturnedByEmployee(params.organizationId, params.scope, params.filters);
  }

  return {
    key: params.key,
    label: params.label,
    description: params.description,
    generatedAt: new Date(),
    columns: result.columns,
    rows: result.rows,
  };
}
