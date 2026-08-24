/**
 * Office Inventory, Workstream 6 — Incident records
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.7, §25, §50). Pure
 * incident CRUD/lifecycle — report, list, review/dismiss. NONE of these
 * functions ever appends a ledger row; every quantity-affecting resolution
 * (mark missing, recover, write off) lives in officeInventoryDisposition.ts,
 * which references a row here via `sourceReferenceType='incident'` but
 * never the reverse. Mirrors `asset_incidents`' own report/review authority
 * split exactly (§10 of this workstream's own instructions): reporting is
 * ALWAYS self-service ("own" custody — an employee's own personal custody
 * or their own current department's custody), reviewing is ALWAYS
 * operational (`office_inventory.incident.review`) — no employee/manager
 * incident-review authority exists, and no operational report-for-others
 * authority exists either, identical in shape to Assets' own established
 * "no employee/manager incident-review authority exists anywhere" boundary.
 */
import { and, eq, desc } from "drizzle-orm";
import { db, officeInventoryIncidentsTable, officeInventoryItemsTable, employeesTable, departmentsTable, type OfficeInventoryIncident } from "@workspace/db";
import { getHolderBalance } from "./officeInventoryLedger";
import { recordAuditEvent } from "./auditLog";
import { OfficeInventoryItemNotFoundError, OfficeInventoryHolderNotFoundError } from "./officeInventoryIssuing";

// Re-exported so routes/other W6 files can import both from one place
// without risking a second, distinct class of the same name (exactly the
// class of bug this reuse avoids — see officeInventoryTransfers.ts's own
// identical precedent from Workstream 5).
export { OfficeInventoryItemNotFoundError, OfficeInventoryHolderNotFoundError };

export class OfficeInventoryNotOwnCustodyError extends Error {
  constructor() {
    super("You may only report an incident for your own current custody or your own current department's custody");
  }
}
export class OfficeInventoryNoCustodyToReportError extends Error {
  constructor() {
    super("The specified holder has no outstanding custody of this item to report an incident about");
  }
}
export class OfficeInventoryIncidentNotFoundError extends Error {
  constructor() {
    super("Incident not found");
  }
}
export class OfficeInventoryIncidentAlreadyResolvedError extends Error {
  constructor() {
    super("This incident has already been reviewed or dismissed");
  }
}

export interface ReportIncidentParams {
  organizationId: number;
  itemId: number;
  holderType: "employee" | "department";
  holderId: number;
  incidentType: "damage" | "missing";
  description: string;
  /** Resolved server-side by the route via resolveOwnEmployeeId — never client-supplied. */
  actorEmployeeId: number | null;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

/** `holderType`/`holderId` must be the reporting employee's own identity, or their own current department — never a client-asserted "on behalf of" target. */
async function assertOwnCustodyAuthority(organizationId: number, holderType: "employee" | "department", holderId: number, actorEmployeeId: number | null): Promise<void> {
  if (actorEmployeeId === null) throw new OfficeInventoryNotOwnCustodyError();
  if (holderType === "employee") {
    if (holderId !== actorEmployeeId) throw new OfficeInventoryNotOwnCustodyError();
    return;
  }
  const [employee] = await db.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(and(eq(employeesTable.id, actorEmployeeId), eq(employeesTable.organizationId, organizationId)));
  if (!employee || employee.departmentId !== holderId) throw new OfficeInventoryNotOwnCustodyError();
}

export async function reportIncident(params: ReportIncidentParams): Promise<OfficeInventoryIncident> {
  const [item] = await db.select({ id: officeInventoryItemsTable.id }).from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();

  if (params.holderType === "employee") {
    const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(and(eq(employeesTable.id, params.holderId), eq(employeesTable.organizationId, params.organizationId)));
    if (!employee) throw new OfficeInventoryHolderNotFoundError();
  } else {
    const [department] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(and(eq(departmentsTable.id, params.holderId), eq(departmentsTable.organizationId, params.organizationId)));
    if (!department) throw new OfficeInventoryHolderNotFoundError();
  }

  await assertOwnCustodyAuthority(params.organizationId, params.holderType, params.holderId, params.actorEmployeeId);

  const balance = await getHolderBalance(params.organizationId, params.itemId, params.holderType, params.holderId);
  if (parseFloat(balance) <= 0) throw new OfficeInventoryNoCustodyToReportError();

  const [incident] = await db
    .insert(officeInventoryIncidentsTable)
    .values({
      organizationId: params.organizationId,
      itemId: params.itemId,
      holderType: params.holderType,
      holderId: params.holderId,
      incidentType: params.incidentType,
      description: params.description,
      reportedByMembershipId: params.actorMembershipId,
      status: "open",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_incident.reported",
    targetType: "office_inventory_incident",
    targetId: String(incident.id),
    afterState: { itemId: params.itemId, holderType: params.holderType, holderId: params.holderId, incidentType: params.incidentType },
  });

  return incident;
}

export interface ListIncidentsFilter {
  status?: "open" | "reviewed" | "dismissed";
  itemId?: number;
  holderType?: "employee" | "department";
  holderId?: number;
}

export async function listIncidents(organizationId: number, filter: ListIncidentsFilter = {}): Promise<OfficeInventoryIncident[]> {
  const conditions = [eq(officeInventoryIncidentsTable.organizationId, organizationId)];
  if (filter.status !== undefined) conditions.push(eq(officeInventoryIncidentsTable.status, filter.status));
  if (filter.itemId !== undefined) conditions.push(eq(officeInventoryIncidentsTable.itemId, filter.itemId));
  if (filter.holderType !== undefined) conditions.push(eq(officeInventoryIncidentsTable.holderType, filter.holderType));
  if (filter.holderId !== undefined) conditions.push(eq(officeInventoryIncidentsTable.holderId, filter.holderId));

  return db
    .select()
    .from(officeInventoryIncidentsTable)
    .where(and(...conditions))
    .orderBy(desc(officeInventoryIncidentsTable.reportedAt));
}

export async function getIncident(organizationId: number, incidentId: number): Promise<OfficeInventoryIncident | null> {
  const [incident] = await db.select().from(officeInventoryIncidentsTable).where(and(eq(officeInventoryIncidentsTable.id, incidentId), eq(officeInventoryIncidentsTable.organizationId, organizationId)));
  return incident ?? null;
}

export interface ReviewIncidentParams {
  organizationId: number;
  incidentId: number;
  outcome: "reviewed" | "dismissed";
  resolutionNotes?: string | null;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

/** Pure status transition — zero ledger effect, mirroring `reviewAssetIncident`/`dismissAssetIncident` exactly. Quantity resolution (mark-missing/recover/write-off) is a fully independent, separately-called action — never triggered by this one. */
export async function reviewIncident(params: ReviewIncidentParams): Promise<OfficeInventoryIncident> {
  const incident = await getIncident(params.organizationId, params.incidentId);
  if (!incident) throw new OfficeInventoryIncidentNotFoundError();
  if (incident.status !== "open") throw new OfficeInventoryIncidentAlreadyResolvedError();

  const [updated] = await db
    .update(officeInventoryIncidentsTable)
    .set({
      status: params.outcome,
      reviewedByMembershipId: params.actorMembershipId,
      reviewedAt: new Date(),
      resolutionNotes: params.resolutionNotes ?? null,
    })
    .where(eq(officeInventoryIncidentsTable.id, params.incidentId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.outcome === "dismissed" ? "office_inventory_incident.dismissed" : "office_inventory_incident.reviewed",
    targetType: "office_inventory_incident",
    targetId: String(params.incidentId),
    afterState: { status: params.outcome },
  });

  return updated;
}
