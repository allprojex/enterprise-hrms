/**
 * Phase 3H, W116 — Physical Filing: Records Locations.
 *
 * A dedicated, self-referencing, organization-owned hierarchy (frozen plan
 * Decision 6) — deliberately not a Master Data extension. Cycle-prevention
 * mirrors organizationStructureService.ts's own assertValidDepartmentPlacement
 * exactly (ancestor-walk from the proposed parent, rejecting if it reaches
 * the node being moved) — the same established pattern, not reinvented.
 */
import { and, eq } from "drizzle-orm";
import { db, recordsLocationsTable, type RecordsLocation } from "@workspace/db";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { recordAuditEvent } from "./auditLog";

export { CrossOrganizationReferenceError };

export class RecordsLocationNotFoundError extends Error {
  constructor() {
    super("Records location not found");
    this.name = "RecordsLocationNotFoundError";
  }
}

export class RecordsLocationCycleError extends Error {
  constructor() {
    super("A records location cannot be its own ancestor");
    this.name = "RecordsLocationCycleError";
  }
}

export class RecordsLocationRetiredError extends Error {
  constructor() {
    super("This records location is retired and cannot receive new files");
    this.name = "RecordsLocationRetiredError";
  }
}

async function getLocation(organizationId: number, locationId: number): Promise<RecordsLocation | null> {
  const [row] = await db
    .select()
    .from(recordsLocationsTable)
    .where(and(eq(recordsLocationsTable.organizationId, organizationId), eq(recordsLocationsTable.id, locationId)))
    .limit(1);
  return row ?? null;
}

/**
 * parentId (if given) must belong to this organization; when moving an
 * existing location (locationId given), the new parent must not be the
 * location itself or one of its own descendants.
 */
async function assertValidLocationPlacement(params: {
  organizationId: number;
  locationId?: number;
  parentId?: number | null;
}): Promise<void> {
  await assertBelongsToOrganization(recordsLocationsTable, params.parentId, params.organizationId, "Parent location");

  if (params.locationId == null || params.parentId == null) return;

  let ancestorId: number | null = params.parentId;
  const visited = new Set<number>();
  while (ancestorId != null) {
    if (ancestorId === params.locationId) throw new RecordsLocationCycleError();
    if (visited.has(ancestorId)) break;
    visited.add(ancestorId);
    const [row] = await db
      .select({ parentId: recordsLocationsTable.parentId })
      .from(recordsLocationsTable)
      .where(eq(recordsLocationsTable.id, ancestorId))
      .limit(1);
    ancestorId = row?.parentId ?? null;
  }
}

export async function listRecordsLocations(organizationId: number): Promise<RecordsLocation[]> {
  return db.select().from(recordsLocationsTable).where(eq(recordsLocationsTable.organizationId, organizationId));
}

export async function createRecordsLocation(params: {
  organizationId: number;
  name: string;
  description?: string | null;
  parentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecordsLocation> {
  await assertValidLocationPlacement({ organizationId: params.organizationId, parentId: params.parentId });

  const [location] = await db
    .insert(recordsLocationsTable)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      description: params.description ?? null,
      parentId: params.parentId ?? null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "records_location.created",
    targetType: "records_location",
    targetId: String(location.id),
    afterState: { name: location.name, parentId: location.parentId },
  });

  return location;
}

export async function updateRecordsLocation(params: {
  organizationId: number;
  locationId: number;
  name?: string;
  description?: string | null;
  parentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecordsLocation> {
  const before = await getLocation(params.organizationId, params.locationId);
  if (!before) throw new RecordsLocationNotFoundError();

  if (params.parentId !== undefined) {
    await assertValidLocationPlacement({ organizationId: params.organizationId, locationId: params.locationId, parentId: params.parentId });
  }

  const patch: Partial<typeof recordsLocationsTable.$inferInsert> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.parentId !== undefined) patch.parentId = params.parentId;

  const [updated] = await db
    .update(recordsLocationsTable)
    .set(patch)
    .where(eq(recordsLocationsTable.id, params.locationId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "records_location.updated",
    targetType: "records_location",
    targetId: String(params.locationId),
    beforeState: { name: before.name, description: before.description, parentId: before.parentId },
    afterState: { name: updated.name, description: updated.description, parentId: updated.parentId },
  });

  return updated;
}

async function setLocationStatus(params: {
  organizationId: number;
  locationId: number;
  status: "active" | "retired";
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecordsLocation> {
  const before = await getLocation(params.organizationId, params.locationId);
  if (!before) throw new RecordsLocationNotFoundError();

  const [updated] = await db
    .update(recordsLocationsTable)
    .set({ status: params.status })
    .where(eq(recordsLocationsTable.id, params.locationId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "records_location",
    targetId: String(params.locationId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

/**
 * Retiring never cascades — a retired location's existing occupants (files/
 * volumes still pointing at it) are untouched; retirement only blocks it
 * from being chosen for a NEW custody assignment going forward
 * (enforced in lib/personnelFileCustody.ts, not here).
 */
export async function retireRecordsLocation(params: {
  organizationId: number;
  locationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecordsLocation> {
  return setLocationStatus({ ...params, status: "retired", eventType: "records_location.retired" });
}

export async function reactivateRecordsLocation(params: {
  organizationId: number;
  locationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecordsLocation> {
  return setLocationStatus({ ...params, status: "active", eventType: "records_location.reactivated" });
}

export { getLocation as getRecordsLocationById };
