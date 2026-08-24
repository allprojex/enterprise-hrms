/**
 * Office Inventory, Workstream 9 — Reporting & Dashboard
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §43, §44). Purely read-only
 * aggregation over Workstreams 2-8's own authoritative tables — no second
 * lifecycle engine, no persisted dashboard/report table, nothing mutated by
 * any function here. Every balance/custody figure reuses the EXACT
 * authoritative direction-table constants `officeInventoryLedger.ts` already
 * exports (`STORE_INCREASING_TYPES`/`STORE_DECREASING_TYPES`/
 * `HOLDER_INCREASING_TYPES`/`HOLDER_DECREASING_TYPES`) — never a
 * re-invented or duplicated direction table — batched via GROUP BY across
 * every item/holder in one query, rather than looping
 * `getOrganizationTotalBalance`/`getHolderBalance`/`listCurrentCustody` once
 * per item/employee/department (which would be a real N+1 regression at
 * organization scale).
 *
 * §44'S EXACT 13-REPORT SET: "Current Stock (by store, with organization-wide
 * totals)" is ONE combined report, not two — this file's own faithful
 * reading of the frozen text, disclosed explicitly because a differently
 * phrased 13-report list (splitting it into "Current Stock" and "Stock by
 * Store" and omitting the conditional 13th report) was given alongside this
 * workstream's own instructions; the actual frozen plan document governs.
 *
 * HISTORICAL STAFF-NUMBER SCOPE (§30, §46 QA): only `office_inventory_
 * employee_custody`/`office_inventory_outstanding_returns` show a staff
 * number at all, and both are explicitly CURRENT-accountability reports —
 * they show the employee's CURRENT `employees.employeeNumber` (a live join),
 * documented here as intentional current-state semantics, never resolved
 * through a released/reused historical number. No other report in this file
 * shows a staff-number column; every historical event report (Movement
 * Ledger, Issues, Receipts) identifies an employee only by name, resolved
 * from `holderId`/`employees.id` — the platform's own permanent,
 * number-reuse-proof identity — so a released-and-reused staff number can
 * never misattribute a historical row (§47's own QA requirement, satisfied
 * structurally rather than by an as-of resolver, since no report here ever
 * joins through `employeeNumber`).
 *
 * COST BOUNDARY (§45, §17 of this workstream's own instructions): the one
 * cost-bearing report (`office_inventory_received_cost_summary`) is a plain
 * SQL SUM of `unitCost × quantity` for `received` rows only — labeled
 * "reference/historical received cost" throughout, never "valuation".
 */
import { and, eq, gte, lte, inArray, desc, sql } from "drizzle-orm";
import {
  db,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  officeInventoryStockMovementsTable,
  officeInventoryRequestsTable,
  officeInventoryRequestLinesTable,
  officeInventoryIncidentsTable,
  officeInventoryStocktakesTable,
  officeInventoryStocktakeLinesTable,
  departmentHeadsTable,
  employeesTable,
  departmentsTable,
  organizationMembershipsTable,
  usersTable,
  type OfficeInventoryItem,
} from "@workspace/db";
import {
  STORE_INCREASING_TYPES,
  STORE_DECREASING_TYPES,
  HOLDER_INCREASING_TYPES,
  HOLDER_DECREASING_TYPES,
  type OfficeInventoryMovementType,
} from "./officeInventoryLedger";
import { getNamespaceConfig } from "../services/organizationConfig";

export class OfficeInventoryReportNotFoundError extends Error {
  constructor(key: string) {
    super(`Unknown Office Inventory report "${key}"`);
    this.name = "OfficeInventoryReportNotFoundError";
  }
}

export interface ReportColumn {
  key: string;
  label: string;
}
export interface OfficeInventoryReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: Date;
  columns: ReportColumn[];
  rows: Record<string, string | number | boolean | null>[];
}

export interface OfficeInventoryReportFilters {
  itemId?: number;
  storeId?: number;
  employeeId?: number;
  departmentId?: number;
  movementType?: OfficeInventoryMovementType;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

// --- Shared batched helpers (no N+1: one query per lookup, regardless of row count) ---

function signedCase(increasing: readonly OfficeInventoryMovementType[], decreasing: readonly OfficeInventoryMovementType[]) {
  return sql<string>`case
    when ${officeInventoryStockMovementsTable.movementType}::text in ${[...increasing]} then ${officeInventoryStockMovementsTable.quantity}
    when ${officeInventoryStockMovementsTable.movementType}::text in ${[...decreasing]} then -${officeInventoryStockMovementsTable.quantity}
    else 0 end`;
}

async function batchItems(organizationId: number): Promise<Map<number, OfficeInventoryItem>> {
  const items = await db.select().from(officeInventoryItemsTable).where(eq(officeInventoryItemsTable.organizationId, organizationId));
  return new Map(items.map((i) => [i.id, i]));
}

async function batchStoreNames(organizationId: number): Promise<Map<number, string>> {
  const stores = await db.select({ id: officeInventoryStoresTable.id, name: officeInventoryStoresTable.name }).from(officeInventoryStoresTable).where(eq(officeInventoryStoresTable.organizationId, organizationId));
  return new Map(stores.map((s) => [s.id, s.name]));
}

async function batchEmployeeDisplay(organizationId: number, employeeIds: number[]): Promise<Map<number, { name: string; employeeNumber: string | null; departmentId: number | null }>> {
  const map = new Map<number, { name: string; employeeNumber: string | null; departmentId: number | null }>();
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName, employeeNumber: employeesTable.employeeNumber, departmentId: employeesTable.departmentId })
    .from(employeesTable)
    .where(and(eq(employeesTable.organizationId, organizationId), inArray(employeesTable.id, ids)));
  for (const r of rows) map.set(r.id, { name: `${r.firstName} ${r.lastName}`, employeeNumber: r.employeeNumber, departmentId: r.departmentId });
  return map;
}

async function batchDepartmentNames(organizationId: number, departmentIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const ids = [...new Set(departmentIds)];
  if (ids.length === 0) return map;
  const rows = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(and(eq(departmentsTable.organizationId, organizationId), inArray(departmentsTable.id, ids)));
  for (const r of rows) map.set(r.id, r.name);
  return map;
}

async function batchMembershipNames(membershipIds: (number | null)[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const ids = [...new Set(membershipIds.filter((id): id is number => id != null))];
  if (ids.length === 0) return map;
  const rows = await db
    .select({ membershipId: organizationMembershipsTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(organizationMembershipsTable)
    .innerJoin(usersTable, eq(organizationMembershipsTable.applicationUserId, usersTable.id))
    .where(inArray(organizationMembershipsTable.id, ids));
  for (const r of rows) map.set(r.membershipId, `${r.firstName} ${r.lastName}`);
  return map;
}

function holderDisplay(
  holderType: "employee" | "department" | null,
  holderId: number | null,
  employees: Map<number, { name: string; employeeNumber: string | null; departmentId: number | null }>,
  departments: Map<number, string>,
): string {
  if (holderType === "employee" && holderId != null) return employees.get(holderId)?.name ?? `Employee #${holderId}`;
  if (holderType === "department" && holderId != null) return departments.get(holderId) ?? `Department #${holderId}`;
  return "";
}

function dateFilterConditions(dateFrom?: string, dateTo?: string) {
  const conditions = [];
  if (dateFrom) conditions.push(gte(officeInventoryStockMovementsTable.occurredAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(officeInventoryStockMovementsTable.occurredAt, new Date(`${dateTo}T23:59:59.999Z`)));
  return conditions;
}

// --- 1. Current Stock (by store, with organization-wide totals) ---

async function runCurrentStock(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const items = await batchItems(organizationId);
  const storeNames = await batchStoreNames(organizationId);

  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));

  const byStoreRows = await db
    .select({
      itemId: officeInventoryStockMovementsTable.itemId,
      storeId: officeInventoryStockMovementsTable.storeId,
      balance: sql<string>`coalesce(sum(${signedCase(STORE_INCREASING_TYPES, STORE_DECREASING_TYPES)}), 0)::numeric(12,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(...conditions, sql`${officeInventoryStockMovementsTable.storeId} is not null`))
    .groupBy(officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.storeId);

  const orgTotalByItem = new Map<number, number>();
  for (const r of byStoreRows) orgTotalByItem.set(r.itemId, (orgTotalByItem.get(r.itemId) ?? 0) + parseFloat(r.balance));

  const rows = byStoreRows
    .filter((r) => r.storeId !== null && parseFloat(r.balance) !== 0)
    .filter((r) => filters.storeId === undefined || r.storeId === filters.storeId)
    .map((r) => {
      const item = items.get(r.itemId);
      return {
        itemId: r.itemId,
        itemCode: item?.itemCode ?? "",
        itemName: item?.name ?? "",
        classification: item?.classification ?? "",
        unitOfMeasure: item?.unitOfMeasure ?? "",
        storeId: r.storeId,
        storeName: storeNames.get(r.storeId!) ?? "",
        storeBalance: r.balance,
        organizationTotal: (orgTotalByItem.get(r.itemId) ?? 0).toFixed(2),
        belowReorderLevel: item?.reorderLevel != null && (orgTotalByItem.get(r.itemId) ?? 0) <= parseFloat(item.reorderLevel),
      };
    })
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.storeName.localeCompare(b.storeName));

  return {
    columns: [
      { key: "itemId", label: "Item ID" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "classification", label: "Classification" },
      { key: "unitOfMeasure", label: "Unit" },
      { key: "storeId", label: "Store ID" },
      { key: "storeName", label: "Store" },
      { key: "storeBalance", label: "Store Balance" },
      { key: "organizationTotal", label: "Organization Total" },
      { key: "belowReorderLevel", label: "Below Reorder Level" },
    ],
    rows,
  };
}

// --- 2. Stock Movement Ledger ---

async function runMovementLedger(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId), ...dateFilterConditions(filters.dateFrom, filters.dateTo)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));
  if (filters.storeId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.storeId, filters.storeId));
  if (filters.movementType !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.movementType, filters.movementType));
  if (filters.employeeId !== undefined) conditions.push(and(eq(officeInventoryStockMovementsTable.holderType, "employee"), eq(officeInventoryStockMovementsTable.holderId, filters.employeeId))!);
  if (filters.departmentId !== undefined) conditions.push(and(eq(officeInventoryStockMovementsTable.holderType, "department"), eq(officeInventoryStockMovementsTable.holderId, filters.departmentId))!);

  const movements = await db.select().from(officeInventoryStockMovementsTable).where(and(...conditions)).orderBy(desc(officeInventoryStockMovementsTable.occurredAt)).limit(2000);

  const items = await batchItems(organizationId);
  const storeNames = await batchStoreNames(organizationId);
  const employeeIds = movements.filter((m) => m.holderType === "employee" && m.holderId !== null).map((m) => m.holderId!);
  const departmentIds = movements.filter((m) => m.holderType === "department" && m.holderId !== null).map((m) => m.holderId!);
  const employees = await batchEmployeeDisplay(organizationId, employeeIds);
  const departments = await batchDepartmentNames(organizationId, departmentIds);
  const actors = await batchMembershipNames(movements.map((m) => m.actorMembershipId));

  const rows = movements.map((m) => {
    const item = items.get(m.itemId);
    return {
      id: m.id,
      occurredAt: m.occurredAt.toISOString(),
      referenceNumber: m.referenceNumber ?? "",
      movementType: m.movementType,
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      quantity: m.quantity,
      storeId: m.storeId,
      storeName: m.storeId != null ? (storeNames.get(m.storeId) ?? "") : "",
      holderType: m.holderType ?? "",
      holderDisplay: holderDisplay(m.holderType, m.holderId, employees, departments),
      sourceReferenceType: m.sourceReferenceType ?? "",
      sourceReferenceId: m.sourceReferenceId,
      reason: m.reason ?? "",
      notes: m.notes ?? "",
      actorMembershipId: m.actorMembershipId,
      actorDisplay: m.actorMembershipId != null ? (actors.get(m.actorMembershipId) ?? "") : "",
      condition: m.condition ?? "",
      expectedReturnDate: m.expectedReturnDate ?? "",
      confirmedAt: m.confirmedAt ? m.confirmedAt.toISOString() : "",
    };
  });

  return {
    columns: [
      { key: "id", label: "ID" },
      { key: "occurredAt", label: "Occurred At" },
      { key: "referenceNumber", label: "Reference" },
      { key: "movementType", label: "Movement Type" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "quantity", label: "Quantity" },
      { key: "storeId", label: "Store ID" },
      { key: "storeName", label: "Store" },
      { key: "holderType", label: "Holder Type" },
      { key: "holderDisplay", label: "Holder" },
      { key: "sourceReferenceType", label: "Source Type" },
      { key: "sourceReferenceId", label: "Source ID" },
      { key: "reason", label: "Reason" },
      { key: "notes", label: "Notes" },
      { key: "actorMembershipId", label: "Actor Membership ID" },
      { key: "actorDisplay", label: "Actor" },
      { key: "condition", label: "Condition" },
      { key: "expectedReturnDate", label: "Expected Return Date" },
      { key: "confirmedAt", label: "Confirmed At" },
    ],
    rows,
  };
}

// --- 3. Receipts ---

async function runReceipts(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.movementType, "received"), ...dateFilterConditions(filters.dateFrom, filters.dateTo)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));
  if (filters.storeId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.storeId, filters.storeId));

  const movements = await db.select().from(officeInventoryStockMovementsTable).where(and(...conditions)).orderBy(desc(officeInventoryStockMovementsTable.occurredAt)).limit(2000);
  const items = await batchItems(organizationId);
  const storeNames = await batchStoreNames(organizationId);
  const actors = await batchMembershipNames(movements.map((m) => m.actorMembershipId));

  const rows = movements.map((m) => {
    const item = items.get(m.itemId);
    return {
      id: m.id,
      referenceNumber: m.referenceNumber ?? "",
      occurredAt: m.occurredAt.toISOString(),
      storeId: m.storeId,
      storeName: m.storeId != null ? (storeNames.get(m.storeId) ?? "") : "",
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      quantity: m.quantity,
      source: m.source ?? "",
      deliveryReference: m.deliveryReference ?? "",
      unitCost: m.unitCost ?? "",
      actorMembershipId: m.actorMembershipId,
      receivingOfficer: m.actorMembershipId != null ? (actors.get(m.actorMembershipId) ?? "") : "",
    };
  });

  return {
    columns: [
      { key: "id", label: "ID" },
      { key: "referenceNumber", label: "Receiving Reference" },
      { key: "occurredAt", label: "Date" },
      { key: "storeId", label: "Store ID" },
      { key: "storeName", label: "Store" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "quantity", label: "Quantity" },
      { key: "source", label: "Source" },
      { key: "deliveryReference", label: "Delivery Reference" },
      { key: "unitCost", label: "Reference Unit Cost" },
      { key: "actorMembershipId", label: "Receiving Officer ID" },
      { key: "receivingOfficer", label: "Receiving Officer" },
    ],
    rows,
  };
}

// --- 4. Issues ---

async function runIssues(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [
    eq(officeInventoryStockMovementsTable.organizationId, organizationId),
    eq(officeInventoryStockMovementsTable.movementType, "issued"),
    sql`${officeInventoryStockMovementsTable.holderType} is not null`,
    ...dateFilterConditions(filters.dateFrom, filters.dateTo),
  ];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));
  if (filters.employeeId !== undefined) conditions.push(and(eq(officeInventoryStockMovementsTable.holderType, "employee"), eq(officeInventoryStockMovementsTable.holderId, filters.employeeId))!);
  if (filters.departmentId !== undefined) conditions.push(and(eq(officeInventoryStockMovementsTable.holderType, "department"), eq(officeInventoryStockMovementsTable.holderId, filters.departmentId))!);

  const holderIssuesRaw = await db.select().from(officeInventoryStockMovementsTable).where(and(...conditions)).orderBy(desc(officeInventoryStockMovementsTable.occurredAt)).limit(2000);

  // The paired store-side leg (same referenceNumber) carries the storeId —
  // one batched lookup, never per-row. A genuine issue (request-based or
  // direct) ALWAYS has a matching store-decrease leg sharing this exact
  // referenceNumber; a handover's DESTINATION leg (§22) is also recorded as
  // an ordinary holder-increasing `issued` row but never touches a store at
  // all — so the absence of a matching store leg is the reliable signal
  // that excludes a handover-in from this report, which is scoped to
  // genuine W4 issue actions only.
  const refNumbers = [...new Set(holderIssuesRaw.map((m) => m.referenceNumber).filter((r): r is string => r != null))];
  const storeLegs =
    refNumbers.length === 0
      ? []
      : await db
          .select({ referenceNumber: officeInventoryStockMovementsTable.referenceNumber, storeId: officeInventoryStockMovementsTable.storeId })
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.movementType, "issued"), inArray(officeInventoryStockMovementsTable.referenceNumber, refNumbers), sql`${officeInventoryStockMovementsTable.storeId} is not null`));
  const storeIdByRef = new Map(storeLegs.map((s) => [s.referenceNumber!, s.storeId]));
  const holderIssues = holderIssuesRaw.filter((m) => m.referenceNumber != null && storeIdByRef.has(m.referenceNumber));

  const items = await batchItems(organizationId);
  const storeNames = await batchStoreNames(organizationId);
  const employeeIds = holderIssues.filter((m) => m.holderType === "employee" && m.holderId !== null).map((m) => m.holderId!);
  const departmentIds = holderIssues.filter((m) => m.holderType === "department" && m.holderId !== null).map((m) => m.holderId!);
  const employees = await batchEmployeeDisplay(organizationId, employeeIds);
  const departments = await batchDepartmentNames(organizationId, departmentIds);
  const actors = await batchMembershipNames(holderIssues.map((m) => m.actorMembershipId));

  const rows = holderIssues.map((m) => {
    const item = items.get(m.itemId);
    const storeId = m.referenceNumber ? storeIdByRef.get(m.referenceNumber) : null;
    return {
      id: m.id,
      occurredAt: m.occurredAt.toISOString(),
      referenceNumber: m.referenceNumber ?? "",
      issueType: m.sourceReferenceType === "request_line" ? "request_based" : "direct",
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      classification: item?.classification ?? "",
      quantity: m.quantity,
      storeId: storeId ?? null,
      storeName: storeId != null ? (storeNames.get(storeId) ?? "") : "",
      holderType: m.holderType ?? "",
      holderDisplay: holderDisplay(m.holderType, m.holderId, employees, departments),
      expectedReturnDate: m.expectedReturnDate ?? "",
      sourceReferenceId: m.sourceReferenceId,
      reason: m.reason ?? "",
      issuingOfficer: m.actorMembershipId != null ? (actors.get(m.actorMembershipId) ?? "") : "",
    };
  });

  return {
    columns: [
      { key: "id", label: "ID" },
      { key: "occurredAt", label: "Issue Date" },
      { key: "referenceNumber", label: "Reference" },
      { key: "issueType", label: "Issue Type" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "classification", label: "Classification" },
      { key: "quantity", label: "Quantity" },
      { key: "storeId", label: "Store ID" },
      { key: "storeName", label: "Store" },
      { key: "holderType", label: "Holder Type" },
      { key: "holderDisplay", label: "Recipient" },
      { key: "expectedReturnDate", label: "Expected Return Date" },
      { key: "sourceReferenceId", label: "Request Line ID" },
      { key: "reason", label: "Direct-Issue Reason" },
      { key: "issuingOfficer", label: "Issuing Officer" },
    ],
    rows,
  };
}

// --- 5/6. Employee / Department Custody (live-derived, batched) ---

async function runHolderCustody(organizationId: number, holderType: "employee" | "department", filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.holderType, holderType)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));
  const idFilter = holderType === "employee" ? filters.employeeId : filters.departmentId;
  if (idFilter !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.holderId, idFilter));

  const balances = await db
    .select({
      itemId: officeInventoryStockMovementsTable.itemId,
      holderId: officeInventoryStockMovementsTable.holderId,
      balance: sql<string>`coalesce(sum(${signedCase(HOLDER_INCREASING_TYPES, HOLDER_DECREASING_TYPES)}), 0)::numeric(12,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(...conditions))
    .groupBy(officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderId);

  const outstanding = balances.filter((b) => b.holderId !== null && parseFloat(b.balance) !== 0);
  if (outstanding.length === 0) return { columns: holderCustodyColumns(holderType), rows: [] };

  // Batched most-recent-issue lookup per (item, holder) for expectedReturnDate/overdue — one query, not one per row.
  const mostRecentIssues = await db
    .selectDistinctOn([officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderId], {
      itemId: officeInventoryStockMovementsTable.itemId,
      holderId: officeInventoryStockMovementsTable.holderId,
      expectedReturnDate: officeInventoryStockMovementsTable.expectedReturnDate,
      referenceNumber: officeInventoryStockMovementsTable.referenceNumber,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.holderType, holderType), eq(officeInventoryStockMovementsTable.movementType, "issued")))
    .orderBy(officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderId, sql`${officeInventoryStockMovementsTable.occurredAt} desc`);
  const dueByKey = new Map(mostRecentIssues.map((r) => [`${r.itemId}:${r.holderId}`, { expectedReturnDate: r.expectedReturnDate, referenceNumber: r.referenceNumber }]));

  const items = await batchItems(organizationId);
  const now = new Date();
  const employees = holderType === "employee" ? await batchEmployeeDisplay(organizationId, outstanding.map((o) => o.holderId!)) : new Map();
  const departments = holderType === "department" ? await batchDepartmentNames(organizationId, outstanding.map((o) => o.holderId!)) : new Map();

  const rows = outstanding.map((o) => {
    const item = items.get(o.itemId);
    const due = dueByKey.get(`${o.itemId}:${o.holderId}`);
    const expectedReturnDate = due?.expectedReturnDate ?? null;
    const overdue = expectedReturnDate !== null && new Date(expectedReturnDate) < now;
    const base = {
      itemId: o.itemId,
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      classification: item?.classification ?? "",
      quantity: o.balance,
      referenceNumber: due?.referenceNumber ?? "",
      expectedReturnDate: expectedReturnDate ?? "",
      overdue,
    };
    if (holderType === "employee") {
      const emp = employees.get(o.holderId!);
      return { employeeId: o.holderId, employeeName: emp?.name ?? "", staffNumber: emp?.employeeNumber ?? "", ...base };
    }
    return { departmentId: o.holderId, departmentName: departments.get(o.holderId!) ?? "", ...base };
  });

  return { columns: holderCustodyColumns(holderType), rows };
}

function holderCustodyColumns(holderType: "employee" | "department"): ReportColumn[] {
  const identity: ReportColumn[] =
    holderType === "employee"
      ? [
          { key: "employeeId", label: "Employee ID" },
          { key: "employeeName", label: "Employee" },
          { key: "staffNumber", label: "Staff Number (current)" },
        ]
      : [
          { key: "departmentId", label: "Department ID" },
          { key: "departmentName", label: "Department" },
        ];
  return [
    ...identity,
    { key: "itemId", label: "Item ID" },
    { key: "itemCode", label: "Item Code" },
    { key: "itemName", label: "Item Name" },
    { key: "classification", label: "Classification" },
    { key: "quantity", label: "Quantity Held" },
    { key: "referenceNumber", label: "Issue Reference" },
    { key: "expectedReturnDate", label: "Expected Return Date" },
    { key: "overdue", label: "Overdue" },
  ];
}

// --- 7. Outstanding / Overdue Returns (returnable-only union of both holder types) ---

interface OutstandingReturnRow {
  holderType: "employee" | "department";
  holderId: number;
  holderDisplay: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  outstandingQuantity: string;
  expectedReturnDate: string;
  overdue: boolean;
  referenceNumber: string;
}

async function runOutstandingReturns(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const [employeeCustody, departmentCustody] = await Promise.all([runHolderCustody(organizationId, "employee", filters), runHolderCustody(organizationId, "department", filters)]);
  const items = await batchItems(organizationId);
  const now = new Date();

  const combined: OutstandingReturnRow[] = [
    ...employeeCustody.rows.map(
      (r): OutstandingReturnRow => ({
        holderType: "employee",
        holderId: r.employeeId as number,
        holderDisplay: r.employeeName as string,
        itemId: r.itemId as number,
        itemCode: r.itemCode as string,
        itemName: r.itemName as string,
        outstandingQuantity: r.quantity as string,
        expectedReturnDate: (r.expectedReturnDate as string) ?? "",
        overdue: r.overdue as boolean,
        referenceNumber: (r.referenceNumber as string) ?? "",
      }),
    ),
    ...departmentCustody.rows.map(
      (r): OutstandingReturnRow => ({
        holderType: "department",
        holderId: r.departmentId as number,
        holderDisplay: r.departmentName as string,
        itemId: r.itemId as number,
        itemCode: r.itemCode as string,
        itemName: r.itemName as string,
        outstandingQuantity: r.quantity as string,
        expectedReturnDate: (r.expectedReturnDate as string) ?? "",
        overdue: r.overdue as boolean,
        referenceNumber: (r.referenceNumber as string) ?? "",
      }),
    ),
  ];

  const rows = combined
    .filter((r) => items.get(r.itemId)?.classification === "returnable")
    .map((r) => {
      const daysOverdue = r.overdue && r.expectedReturnDate ? Math.floor((now.getTime() - new Date(r.expectedReturnDate).getTime()) / 86400000) : null;
      return { ...r, daysOverdue };
    });

  return {
    columns: [
      { key: "holderType", label: "Holder Type" },
      { key: "holderId", label: "Holder ID" },
      { key: "holderDisplay", label: "Holder" },
      { key: "itemId", label: "Item ID" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "outstandingQuantity", label: "Outstanding Quantity" },
      { key: "expectedReturnDate", label: "Expected Return Date" },
      { key: "overdue", label: "Overdue" },
      { key: "daysOverdue", label: "Days Overdue" },
      { key: "referenceNumber", label: "Source Reference" },
    ],
    rows,
  };
}

// --- 8. Missing / Damaged Items ---

async function runMissingDamaged(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryIncidentsTable.organizationId, organizationId)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryIncidentsTable.itemId, filters.itemId));
  if (filters.status !== undefined) conditions.push(eq(officeInventoryIncidentsTable.status, filters.status as "open" | "reviewed" | "dismissed"));

  const incidents = await db.select().from(officeInventoryIncidentsTable).where(and(...conditions)).orderBy(desc(officeInventoryIncidentsTable.reportedAt)).limit(2000);
  const items = await batchItems(organizationId);
  const employeeIds = incidents.filter((i) => i.holderType === "employee" && i.holderId !== null).map((i) => i.holderId!);
  const departmentIds = incidents.filter((i) => i.holderType === "department" && i.holderId !== null).map((i) => i.holderId!);
  const employees = await batchEmployeeDisplay(organizationId, employeeIds);
  const departments = await batchDepartmentNames(organizationId, departmentIds);
  const reporters = await batchMembershipNames(incidents.map((i) => i.reportedByMembershipId));
  const reviewers = await batchMembershipNames(incidents.map((i) => i.reviewedByMembershipId));

  // Batched recovered/written-off linkage — one query for every incident's own resolution movements.
  const incidentIds = incidents.map((i) => i.id);
  const resolutionMovements =
    incidentIds.length === 0
      ? []
      : await db
          .select({ sourceReferenceId: officeInventoryStockMovementsTable.sourceReferenceId, movementType: officeInventoryStockMovementsTable.movementType, quantity: officeInventoryStockMovementsTable.quantity })
          .from(officeInventoryStockMovementsTable)
          .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.sourceReferenceType, "incident"), inArray(officeInventoryStockMovementsTable.sourceReferenceId, incidentIds)));
  const recoveredByIncident = new Map<number, number>();
  const writtenOffByIncident = new Map<number, number>();
  for (const m of resolutionMovements) {
    if (m.sourceReferenceId === null) continue;
    if (m.movementType === "recovered") recoveredByIncident.set(m.sourceReferenceId, (recoveredByIncident.get(m.sourceReferenceId) ?? 0) + parseFloat(m.quantity));
    if (m.movementType === "written_off") writtenOffByIncident.set(m.sourceReferenceId, (writtenOffByIncident.get(m.sourceReferenceId) ?? 0) + parseFloat(m.quantity));
  }

  const rows = incidents.map((i) => {
    const item = items.get(i.itemId);
    return {
      id: i.id,
      reportedAt: i.reportedAt.toISOString(),
      incidentType: i.incidentType,
      status: i.status,
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      holderType: i.holderType ?? "",
      holderDisplay: holderDisplay(i.holderType, i.holderId, employees, departments),
      description: i.description,
      reportedBy: reporters.get(i.reportedByMembershipId) ?? "",
      reviewedAt: i.reviewedAt ? i.reviewedAt.toISOString() : "",
      reviewedBy: i.reviewedByMembershipId != null ? (reviewers.get(i.reviewedByMembershipId) ?? "") : "",
      resolutionNotes: i.resolutionNotes ?? "",
      recoveredQuantity: (recoveredByIncident.get(i.id) ?? 0).toFixed(2),
      writtenOffQuantity: (writtenOffByIncident.get(i.id) ?? 0).toFixed(2),
    };
  });

  return {
    columns: [
      { key: "id", label: "ID" },
      { key: "reportedAt", label: "Reported At" },
      { key: "incidentType", label: "Type" },
      { key: "status", label: "Status" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "holderType", label: "Holder Type" },
      { key: "holderDisplay", label: "Holder" },
      { key: "description", label: "Description" },
      { key: "reportedBy", label: "Reported By" },
      { key: "reviewedAt", label: "Reviewed At" },
      { key: "reviewedBy", label: "Reviewed By" },
      { key: "resolutionNotes", label: "Resolution Notes" },
      { key: "recoveredQuantity", label: "Recovered Quantity" },
      { key: "writtenOffQuantity", label: "Written-Off Quantity" },
    ],
    rows,
  };
}

// --- 9. Adjustments & Write-Offs (kept as two distinct categories in one report) ---

async function runAdjustmentsWriteOffs(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId), inArray(officeInventoryStockMovementsTable.movementType, ["adjustment_in", "adjustment_out", "written_off"]), ...dateFilterConditions(filters.dateFrom, filters.dateTo)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));

  const movements = await db.select().from(officeInventoryStockMovementsTable).where(and(...conditions)).orderBy(desc(officeInventoryStockMovementsTable.occurredAt)).limit(2000);
  const items = await batchItems(organizationId);
  const storeNames = await batchStoreNames(organizationId);
  const employeeIds = movements.filter((m) => m.holderType === "employee" && m.holderId !== null).map((m) => m.holderId!);
  const departmentIds = movements.filter((m) => m.holderType === "department" && m.holderId !== null).map((m) => m.holderId!);
  const employees = await batchEmployeeDisplay(organizationId, employeeIds);
  const departments = await batchDepartmentNames(organizationId, departmentIds);
  const actors = await batchMembershipNames(movements.map((m) => m.actorMembershipId));

  const rows = movements.map((m) => {
    const item = items.get(m.itemId);
    const sourceDisplay = m.storeId != null ? `Store: ${storeNames.get(m.storeId) ?? m.storeId}` : holderDisplay(m.holderType, m.holderId, employees, departments);
    return {
      id: m.id,
      occurredAt: m.occurredAt.toISOString(),
      category: m.movementType === "written_off" ? "write-off" : "adjustment",
      movementType: m.movementType,
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      quantity: m.quantity,
      source: sourceDisplay,
      reason: m.reason ?? "",
      actor: m.actorMembershipId != null ? (actors.get(m.actorMembershipId) ?? "") : "",
      incidentId: m.sourceReferenceType === "incident" ? m.sourceReferenceId : null,
      stocktakeLineId: m.sourceReferenceType === "stocktake_line" ? m.sourceReferenceId : null,
    };
  });

  return {
    columns: [
      { key: "id", label: "ID" },
      { key: "occurredAt", label: "Date" },
      { key: "category", label: "Category" },
      { key: "movementType", label: "Movement Type" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "quantity", label: "Quantity" },
      { key: "source", label: "Store / Holder Source" },
      { key: "reason", label: "Reason" },
      { key: "actor", label: "Actor" },
      { key: "incidentId", label: "Incident ID" },
      { key: "stocktakeLineId", label: "Stocktake Line ID" },
    ],
    rows,
  };
}

// --- 10. Stocktake Variances ---

async function runStocktakeVariances(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryStocktakeLinesTable.organizationId, organizationId)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStocktakeLinesTable.itemId, filters.itemId));

  const lines = await db.select().from(officeInventoryStocktakeLinesTable).where(and(...conditions)).limit(5000);
  const stocktakeIds = [...new Set(lines.map((l) => l.stocktakeId))];
  const stocktakes = stocktakeIds.length === 0 ? [] : await db.select().from(officeInventoryStocktakesTable).where(and(eq(officeInventoryStocktakesTable.organizationId, organizationId), inArray(officeInventoryStocktakesTable.id, stocktakeIds)));
  const stocktakeById = new Map(stocktakes.map((s) => [s.id, s]));
  const items = await batchItems(organizationId);
  const storeNames = await batchStoreNames(organizationId);

  let filtered = lines;
  if (filters.storeId !== undefined) filtered = filtered.filter((l) => stocktakeById.get(l.stocktakeId)?.storeId === filters.storeId);
  if (filters.status !== undefined) filtered = filtered.filter((l) => stocktakeById.get(l.stocktakeId)?.status === filters.status);

  // Reconciled expected is derived algebraically from the already-recorded
  // counted/variance columns (reconciled = counted - variance), never
  // re-queried live against the ledger — a finalized stocktake's historical
  // figures must stay exactly as resolved, unaffected by movements that
  // happened afterward.
  const rows = filtered
    .sort((a, b) => b.stocktakeId - a.stocktakeId || a.itemId - b.itemId)
    .map((l) => {
      const stocktake = stocktakeById.get(l.stocktakeId);
      const item = items.get(l.itemId);
      const counted = l.countedQuantity !== null ? parseFloat(l.countedQuantity) : null;
      const variance = l.variance !== null ? parseFloat(l.variance) : null;
      const reconciledExpected = counted !== null && variance !== null ? (counted - variance).toFixed(2) : null;
      return {
        stocktakeId: l.stocktakeId,
        stocktakeReference: stocktake?.stocktakeReference ?? "",
        stocktakeStatus: stocktake?.status ?? "",
        storeId: stocktake?.storeId ?? null,
        storeName: stocktake?.storeId != null ? (storeNames.get(stocktake.storeId) ?? "") : "",
        itemCode: item?.itemCode ?? "",
        itemName: item?.name ?? "",
        expectedQuantitySnapshot: l.expectedQuantitySnapshot,
        reconciledExpectedQuantity: reconciledExpected,
        countedQuantity: l.countedQuantity,
        variance: l.variance,
        resolutionType: l.resolutionType ?? "",
        resolvedAt: l.resolvedAt ? l.resolvedAt.toISOString() : "",
      };
    });

  return {
    columns: [
      { key: "stocktakeId", label: "Stocktake ID" },
      { key: "stocktakeReference", label: "Stocktake Reference" },
      { key: "stocktakeStatus", label: "Stocktake Status" },
      { key: "storeId", label: "Store ID" },
      { key: "storeName", label: "Store" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "expectedQuantitySnapshot", label: "Expected (Snapshot)" },
      { key: "reconciledExpectedQuantity", label: "Expected (Reconciled)" },
      { key: "countedQuantity", label: "Counted" },
      { key: "variance", label: "Variance" },
      { key: "resolutionType", label: "Resolution" },
      { key: "resolvedAt", label: "Resolved At" },
    ],
    rows,
  };
}

// --- 11. Repeat Request History ---

async function runRepeatRequestHistory(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryRequestLinesTable.organizationId, organizationId)];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryRequestLinesTable.itemId, filters.itemId));

  const lines = await db.select().from(officeInventoryRequestLinesTable).where(and(...conditions)).limit(5000);
  const requestIds = [...new Set(lines.map((l) => l.requestId))];
  const requests = requestIds.length === 0 ? [] : await db.select().from(officeInventoryRequestsTable).where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), inArray(officeInventoryRequestsTable.id, requestIds)));
  const requestById = new Map(requests.map((r) => [r.id, r]));

  let filteredLines = lines;
  if (filters.employeeId !== undefined) filteredLines = filteredLines.filter((l) => requestById.get(l.requestId)?.forEmployeeId === filters.employeeId);
  if (filters.departmentId !== undefined) filteredLines = filteredLines.filter((l) => requestById.get(l.requestId)?.forDepartmentId === filters.departmentId);
  if (filters.dateFrom) filteredLines = filteredLines.filter((l) => (requestById.get(l.requestId)?.submittedAt.getTime() ?? 0) >= new Date(filters.dateFrom!).getTime());
  if (filters.dateTo) filteredLines = filteredLines.filter((l) => (requestById.get(l.requestId)?.submittedAt.getTime() ?? 0) <= new Date(`${filters.dateTo}T23:59:59.999Z`).getTime());

  const items = await batchItems(organizationId);
  const employeeIds = requests.filter((r) => r.forEmployeeId !== null).map((r) => r.forEmployeeId!);
  const employees = await batchEmployeeDisplay(organizationId, employeeIds);
  const departments = await batchDepartmentNames(organizationId, requests.map((r) => r.forDepartmentId));

  // Same review window getRepeatRequestWarning already uses — one config
  // read, reused for every row's own "recent activity" count rather than a
  // per-row call into getRepeatRequestWarning (which itself re-reads config
  // and re-queries per item/employee/department — fine for one line's own
  // approval context, but an N+1 shape at report scale).
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  const windowDays = (config.data.repeatRequestReviewWindowDays as number | undefined) ?? 30;

  const rows = filteredLines
    .map((l) => {
      const request = requestById.get(l.requestId);
      if (!request) return null;
      const item = items.get(l.itemId);
      const since = new Date(request.submittedAt.getTime() - windowDays * 86400000);
      const recentCount = filteredLines.filter((other) => {
        if (other.itemId !== l.itemId || other.id === l.id) return false;
        const otherRequest = requestById.get(other.requestId);
        if (!otherRequest) return false;
        const sameSubject = request.forEmployeeId !== null ? otherRequest.forEmployeeId === request.forEmployeeId : otherRequest.forDepartmentId === request.forDepartmentId && otherRequest.forEmployeeId === null;
        return sameSubject && otherRequest.submittedAt >= since && otherRequest.submittedAt <= request.submittedAt;
      }).length;
      return {
        requestId: request.id,
        requestReference: request.requestReference,
        submittedAt: request.submittedAt.toISOString(),
        requestType: request.requestType,
        employeeId: request.forEmployeeId,
        employeeName: request.forEmployeeId != null ? (employees.get(request.forEmployeeId)?.name ?? "") : "",
        departmentId: request.forDepartmentId,
        departmentName: departments.get(request.forDepartmentId) ?? "",
        itemCode: item?.itemCode ?? "",
        itemName: item?.name ?? "",
        quantityRequested: l.quantityRequested,
        approvalStatus: l.approvalStatus,
        approvedQuantity: l.approvedQuantity ?? "",
        quantityIssuedSoFar: l.quantityIssuedSoFar,
        recentRequestCountForSameItem: recentCount,
        reviewWindowDays: windowDays,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return {
    columns: [
      { key: "requestId", label: "Request ID" },
      { key: "requestReference", label: "Reference" },
      { key: "submittedAt", label: "Submitted At" },
      { key: "requestType", label: "Type" },
      { key: "employeeId", label: "Employee ID" },
      { key: "employeeName", label: "Employee" },
      { key: "departmentId", label: "Department ID" },
      { key: "departmentName", label: "Department" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "quantityRequested", label: "Requested" },
      { key: "approvalStatus", label: "Approval Status" },
      { key: "approvedQuantity", label: "Approved" },
      { key: "quantityIssuedSoFar", label: "Issued So Far" },
      { key: "recentRequestCountForSameItem", label: "Recent Requests (Same Item, Window)" },
      { key: "reviewWindowDays", label: "Review Window (Days)" },
    ],
    rows,
  };
}

// --- 12. Department Consumable Usage ---

async function runDepartmentConsumableUsage(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const items = await batchItems(organizationId);
  const consumableItemIds = [...items.values()].filter((i) => i.classification === "consumable").map((i) => i.id);
  if (consumableItemIds.length === 0) return { columns: consumableUsageColumns(), rows: [] };

  const conditions = [
    eq(officeInventoryStockMovementsTable.organizationId, organizationId),
    eq(officeInventoryStockMovementsTable.movementType, "issued"),
    eq(officeInventoryStockMovementsTable.holderType, "department"),
    inArray(officeInventoryStockMovementsTable.itemId, consumableItemIds),
    ...dateFilterConditions(filters.dateFrom, filters.dateTo),
  ];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));
  if (filters.departmentId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.holderId, filters.departmentId));

  const grouped = await db
    .select({
      itemId: officeInventoryStockMovementsTable.itemId,
      departmentId: officeInventoryStockMovementsTable.holderId,
      quantityIssued: sql<string>`coalesce(sum(${officeInventoryStockMovementsTable.quantity}), 0)::numeric(12,2)`,
      issueCount: sql<number>`count(*)::int`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(...conditions))
    .groupBy(officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderId);

  const departments = await batchDepartmentNames(organizationId, grouped.map((g) => g.departmentId!));

  const rows = grouped
    .filter((g) => g.departmentId !== null)
    .map((g) => {
      const item = items.get(g.itemId);
      return {
        departmentId: g.departmentId,
        departmentName: departments.get(g.departmentId!) ?? "",
        itemId: g.itemId,
        itemCode: item?.itemCode ?? "",
        itemName: item?.name ?? "",
        quantityIssued: g.quantityIssued,
        issueCount: g.issueCount,
      };
    })
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName) || a.itemCode.localeCompare(b.itemCode));

  return { columns: consumableUsageColumns(), rows };
}
function consumableUsageColumns(): ReportColumn[] {
  return [
    { key: "departmentId", label: "Department ID" },
    { key: "departmentName", label: "Department" },
    { key: "itemId", label: "Item ID" },
    { key: "itemCode", label: "Item Code" },
    { key: "itemName", label: "Item Name" },
    { key: "quantityIssued", label: "Quantity Issued" },
    { key: "issueCount", label: "Issue Count" },
  ];
}

// --- 13. Simple Received-Cost Summary ---

async function runReceivedCostSummary(organizationId: number, filters: OfficeInventoryReportFilters): Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">> {
  const conditions = [eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.movementType, "received"), sql`${officeInventoryStockMovementsTable.unitCost} is not null`];
  if (filters.itemId !== undefined) conditions.push(eq(officeInventoryStockMovementsTable.itemId, filters.itemId));

  const grouped = await db
    .select({
      itemId: officeInventoryStockMovementsTable.itemId,
      quantityReceived: sql<string>`coalesce(sum(${officeInventoryStockMovementsTable.quantity}), 0)::numeric(12,2)`,
      referenceCostTotal: sql<string>`coalesce(sum(${officeInventoryStockMovementsTable.unitCost} * ${officeInventoryStockMovementsTable.quantity}), 0)::numeric(14,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(...conditions))
    .groupBy(officeInventoryStockMovementsTable.itemId);

  const items = await batchItems(organizationId);
  const rows = grouped.map((g) => {
    const item = items.get(g.itemId);
    return {
      itemId: g.itemId,
      itemCode: item?.itemCode ?? "",
      itemName: item?.name ?? "",
      quantityReceivedWithCost: g.quantityReceived,
      referenceReceivedCostTotal: g.referenceCostTotal,
    };
  });

  return {
    columns: [
      { key: "itemId", label: "Item ID" },
      { key: "itemCode", label: "Item Code" },
      { key: "itemName", label: "Item Name" },
      { key: "quantityReceivedWithCost", label: "Quantity Received (Cost Recorded)" },
      { key: "referenceReceivedCostTotal", label: "Reference Received Cost Total (historical, not a valuation)" },
    ],
    rows,
  };
}

// --- Dispatcher ---

const REPORT_KEYS = [
  "office_inventory_current_stock",
  "office_inventory_movement_ledger",
  "office_inventory_receipts",
  "office_inventory_issues",
  "office_inventory_employee_custody",
  "office_inventory_department_custody",
  "office_inventory_outstanding_returns",
  "office_inventory_missing_damaged",
  "office_inventory_adjustments_writeoffs",
  "office_inventory_stocktake_variances",
  "office_inventory_repeat_request_history",
  "office_inventory_department_consumable_usage",
  "office_inventory_received_cost_summary",
] as const;
export type OfficeInventoryReportKey = (typeof REPORT_KEYS)[number];

export function isKnownOfficeInventoryReportKey(key: string): key is OfficeInventoryReportKey {
  return (REPORT_KEYS as readonly string[]).includes(key);
}

const RUNNERS: Record<OfficeInventoryReportKey, (organizationId: number, filters: OfficeInventoryReportFilters) => Promise<Pick<OfficeInventoryReportResult, "columns" | "rows">>> = {
  office_inventory_current_stock: runCurrentStock,
  office_inventory_movement_ledger: runMovementLedger,
  office_inventory_receipts: runReceipts,
  office_inventory_issues: runIssues,
  office_inventory_employee_custody: (organizationId, filters) => runHolderCustody(organizationId, "employee", filters),
  office_inventory_department_custody: (organizationId, filters) => runHolderCustody(organizationId, "department", filters),
  office_inventory_outstanding_returns: runOutstandingReturns,
  office_inventory_missing_damaged: runMissingDamaged,
  office_inventory_adjustments_writeoffs: runAdjustmentsWriteOffs,
  office_inventory_stocktake_variances: runStocktakeVariances,
  office_inventory_repeat_request_history: runRepeatRequestHistory,
  office_inventory_department_consumable_usage: runDepartmentConsumableUsage,
  office_inventory_received_cost_summary: runReceivedCostSummary,
};

export async function runOfficeInventoryReport(params: { key: string; label: string; description: string; organizationId: number; filters: OfficeInventoryReportFilters }): Promise<OfficeInventoryReportResult> {
  if (!isKnownOfficeInventoryReportKey(params.key)) throw new OfficeInventoryReportNotFoundError(params.key);
  const runner = RUNNERS[params.key];
  const { columns, rows } = await runner(params.organizationId, params.filters);
  return { key: params.key, label: params.label, description: params.description, generatedAt: new Date(), columns, rows };
}

// --- Dashboard (§43) — live-derived tiles, no persisted aggregate ---

export interface OfficeInventoryDashboard {
  stockItems: number;
  lowStockItems: number;
  outOfStockItems: number;
  itemsWithEmployees: number;
  itemsWithDepartments: number;
  outstandingReturnables: number;
  overdueReturnables: number;
  pendingApprovals: number;
  pendingIssues: number;
  pendingReceiptConfirmations: number;
  openMissingDamagedIncidents: number;
  unresolvedStocktakeVariances: number;
  vacantHeadBlockedDepartments: number;
}

export async function getOfficeInventoryDashboard(organizationId: number): Promise<OfficeInventoryDashboard> {
  const items = await batchItems(organizationId);
  const itemList = [...items.values()];

  // Store balances, batched (one query, grouped by item) — reused for both
  // the total-stock-items count and low/out-of-stock tiles.
  const storeBalanceRows = await db
    .select({ itemId: officeInventoryStockMovementsTable.itemId, balance: sql<string>`coalesce(sum(${signedCase(STORE_INCREASING_TYPES, STORE_DECREASING_TYPES)}), 0)::numeric(12,2)` })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), sql`${officeInventoryStockMovementsTable.storeId} is not null`))
    .groupBy(officeInventoryStockMovementsTable.itemId);
  const orgBalanceByItem = new Map(storeBalanceRows.map((r) => [r.itemId, parseFloat(r.balance)]));

  let lowStockItems = 0;
  let outOfStockItems = 0;
  for (const item of itemList) {
    const balance = orgBalanceByItem.get(item.id) ?? 0;
    if (balance <= 0) outOfStockItems++;
    else if (item.reorderLevel != null && balance <= parseFloat(item.reorderLevel)) lowStockItems++;
  }

  // Holder balances, batched by holderType — reused for the
  // items-with-employees/departments and outstanding/overdue tiles.
  const holderBalanceRows = await db
    .select({
      itemId: officeInventoryStockMovementsTable.itemId,
      holderType: officeInventoryStockMovementsTable.holderType,
      holderId: officeInventoryStockMovementsTable.holderId,
      balance: sql<string>`coalesce(sum(${signedCase(HOLDER_INCREASING_TYPES, HOLDER_DECREASING_TYPES)}), 0)::numeric(12,2)`,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), sql`${officeInventoryStockMovementsTable.holderType} is not null`))
    .groupBy(officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderType, officeInventoryStockMovementsTable.holderId);
  const outstandingHolders = holderBalanceRows.filter((r) => parseFloat(r.balance) > 0 && items.get(r.itemId)?.classification === "returnable");

  let itemsWithEmployees = 0;
  let itemsWithDepartments = 0;
  const distinctItemsHeldByEmployee = new Set<number>();
  const distinctItemsHeldByDepartment = new Set<number>();
  for (const r of holderBalanceRows) {
    if (parseFloat(r.balance) <= 0) continue;
    if (r.holderType === "employee") distinctItemsHeldByEmployee.add(r.itemId);
    if (r.holderType === "department") distinctItemsHeldByDepartment.add(r.itemId);
  }
  itemsWithEmployees = distinctItemsHeldByEmployee.size;
  itemsWithDepartments = distinctItemsHeldByDepartment.size;

  // Overdue requires the most-recent-issue expectedReturnDate per (item, holder) — batched.
  const mostRecentIssues = await db
    .selectDistinctOn([officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderType, officeInventoryStockMovementsTable.holderId], {
      itemId: officeInventoryStockMovementsTable.itemId,
      holderType: officeInventoryStockMovementsTable.holderType,
      holderId: officeInventoryStockMovementsTable.holderId,
      expectedReturnDate: officeInventoryStockMovementsTable.expectedReturnDate,
    })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.movementType, "issued"), sql`${officeInventoryStockMovementsTable.holderType} is not null`))
    .orderBy(officeInventoryStockMovementsTable.itemId, officeInventoryStockMovementsTable.holderType, officeInventoryStockMovementsTable.holderId, sql`${officeInventoryStockMovementsTable.occurredAt} desc`);
  const dueByKey = new Map(mostRecentIssues.map((r) => [`${r.itemId}:${r.holderType}:${r.holderId}`, r.expectedReturnDate]));
  const now = new Date();
  const overdueReturnables = outstandingHolders.filter((r) => {
    const due = dueByKey.get(`${r.itemId}:${r.holderType}:${r.holderId}`);
    return due !== undefined && due !== null && new Date(due) < now;
  }).length;

  // Pending approvals/issues (W3/W4 request state).
  const openRequests = await db.select({ id: officeInventoryRequestsTable.id, status: officeInventoryRequestsTable.status }).from(officeInventoryRequestsTable).where(and(eq(officeInventoryRequestsTable.organizationId, organizationId), inArray(officeInventoryRequestsTable.status, ["pending", "partially_approved", "approved", "partially_fulfilled"])));
  const pendingApprovals = openRequests.filter((r) => r.status === "pending" || r.status === "partially_approved").length;

  const issuableLines = await db
    .select({ approvalStatus: officeInventoryRequestLinesTable.approvalStatus, approvedQuantity: officeInventoryRequestLinesTable.approvedQuantity, quantityIssuedSoFar: officeInventoryRequestLinesTable.quantityIssuedSoFar })
    .from(officeInventoryRequestLinesTable)
    .where(and(eq(officeInventoryRequestLinesTable.organizationId, organizationId), eq(officeInventoryRequestLinesTable.approvalStatus, "approved")));
  const pendingIssues = issuableLines.filter((l) => parseFloat(l.approvedQuantity ?? "0") > parseFloat(l.quantityIssuedSoFar)).length;

  // Pending receipt confirmations (W4, non-gating). Destructured defensively
  // (rows[0]?.count) rather than assumed-present — a bare aggregate always
  // returns exactly one row against real Postgres, but this stays resilient
  // regardless.
  const pendingConfirmationRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(officeInventoryStockMovementsTable)
    .where(and(eq(officeInventoryStockMovementsTable.organizationId, organizationId), eq(officeInventoryStockMovementsTable.movementType, "issued"), sql`${officeInventoryStockMovementsTable.holderType} is not null`, sql`${officeInventoryStockMovementsTable.confirmedAt} is null`));
  const pendingConfirmationsCount = pendingConfirmationRows[0]?.count ?? 0;

  // Open missing/damage incidents (W6).
  const openIncidentRows = await db.select({ count: sql<number>`count(*)::int` }).from(officeInventoryIncidentsTable).where(and(eq(officeInventoryIncidentsTable.organizationId, organizationId), eq(officeInventoryIncidentsTable.status, "open")));
  const openIncidentsCount = openIncidentRows[0]?.count ?? 0;

  // Unresolved stocktake variances (W7) — non-zero variance, not yet resolved, on a not-yet-finalized stocktake.
  const activeStocktakes = await db.select({ id: officeInventoryStocktakesTable.id }).from(officeInventoryStocktakesTable).where(and(eq(officeInventoryStocktakesTable.organizationId, organizationId), sql`${officeInventoryStocktakesTable.status} != 'finalized'`));
  const activeStocktakeIds = activeStocktakes.map((s) => s.id);
  let unresolvedStocktakeVariances = 0;
  if (activeStocktakeIds.length > 0) {
    const varianceRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(officeInventoryStocktakeLinesTable)
      .where(and(inArray(officeInventoryStocktakeLinesTable.stocktakeId, activeStocktakeIds), sql`${officeInventoryStocktakeLinesTable.variance} is not null and ${officeInventoryStocktakeLinesTable.variance} != 0 and ${officeInventoryStocktakeLinesTable.resolutionType} is null`));
    unresolvedStocktakeVariances = varianceRows[0]?.count ?? 0;
  }

  // Departments currently blocked by a vacant Department Head (§5.3).
  const allDepartments = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(eq(departmentsTable.organizationId, organizationId));
  const openHeadRows = await db.select({ departmentId: departmentHeadsTable.departmentId }).from(departmentHeadsTable).where(and(eq(departmentHeadsTable.organizationId, organizationId), sql`${departmentHeadsTable.validTo} is null`));
  const departmentsWithHead = new Set(openHeadRows.map((r) => r.departmentId));
  const vacantHeadBlockedDepartments = allDepartments.filter((d) => !departmentsWithHead.has(d.id)).length;

  return {
    stockItems: itemList.filter((i) => (orgBalanceByItem.get(i.id) ?? 0) > 0).length,
    lowStockItems,
    outOfStockItems,
    itemsWithEmployees,
    itemsWithDepartments,
    outstandingReturnables: outstandingHolders.length,
    overdueReturnables,
    pendingApprovals,
    pendingIssues,
    pendingReceiptConfirmations: pendingConfirmationsCount,
    openMissingDamagedIncidents: openIncidentsCount,
    unresolvedStocktakeVariances,
    vacantHeadBlockedDepartments,
  };
}
