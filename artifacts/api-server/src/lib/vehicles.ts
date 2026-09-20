/**
 * VR-01 — Vehicle Foundation: the organizational vehicle register.
 *
 * Scope is deliberately the REGISTER only: which vehicles the organization has,
 * how they are identified, who normally drives them, and whether they are
 * administratively usable. The request → approval → release → return flow is
 * VR-02 and owns its own tables; nothing here reserves a vehicle, records a
 * movement, or asks whether a vehicle is currently out — that question has no
 * answer until VR-02 exists, so the register never pretends to hold one.
 *
 * Every read and write is scoped by organizationId taken from the caller's
 * membership, never from the body; `branchId`, `defaultDriverEmployeeId` and
 * the optional `assetId` link are each verified to belong to the same
 * organization before they can be attached.
 */
import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, vehiclesTable, branchesTable, employeesTable, assetsTable, type Vehicle } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation, uniqueViolationConstraint } from "./dbErrors";
import { assertBelongsToOrganization } from "./orgScopedRefs";

export class VehicleNotFoundError extends Error {
  constructor() {
    super("Vehicle not found");
    this.name = "VehicleNotFoundError";
  }
}

export class InvalidVehicleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVehicleError";
  }
}

export class DuplicateVehicleRegistrationError extends Error {
  constructor() {
    super("A vehicle with that registration number already exists in this organization");
    this.name = "DuplicateVehicleRegistrationError";
  }
}

export class DuplicateVehicleAssetLinkError extends Error {
  constructor() {
    super("That asset is already linked to another vehicle in this organization");
    this.name = "DuplicateVehicleAssetLinkError";
  }
}

/**
 * The register's administrative statuses — the whole enum, because VR-01 has no
 * state the register itself may not set.
 */
export type VehicleStatus = Vehicle["status"];

/**
 * `vehicles` carries two unique indexes, so a 23505 has to be attributed before
 * it can be reported: a duplicate asset link and a duplicate registration
 * number fail for completely different reasons. The index name is the
 * attribution; when the driver does not supply one, the registration number is
 * the safe fallback, since it is the only one of the two that every write
 * always touches.
 */
function translateUniqueViolation(err: unknown): Error {
  return uniqueViolationConstraint(err) === "vehicles_org_asset_unique"
    ? new DuplicateVehicleAssetLinkError()
    : new DuplicateVehicleRegistrationError();
}

/**
 * Registration numbers are stored and shown as the organization entered them,
 * with only safe whitespace normalization: surrounding space is trimmed and
 * internal runs collapse to a single space. Case is DELIBERATELY preserved —
 * a registration is an external identifier the organization already uses on
 * paper, and silently rewriting its casing changes their own record of it.
 *
 * Consequence for V1: uniqueness is over the stored value, so "GR 1234-20" and
 * "gr 1234-20" are two distinct registrations. Case-insensitive registration
 * semantics would need a deliberate decision and a functional index; neither
 * is in scope here.
 */
export function normalizeRegistrationNumber(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized) throw new InvalidVehicleError("registrationNumber is required");
  if (normalized.length > 32) throw new InvalidVehicleError("registrationNumber must be 32 characters or fewer");
  return normalized;
}

function optionalText(value: string | null | undefined, label: string, max = 120): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new InvalidVehicleError(`${label} must be ${max} characters or fewer`);
  return trimmed;
}

export interface VehicleListFilters {
  status?: Vehicle["status"];
  /** Matches registration number, make or model. */
  search?: string;
}

export async function listVehicles(organizationId: number, filters: VehicleListFilters = {}): Promise<Vehicle[]> {
  const conditions: SQL[] = [eq(vehiclesTable.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(vehiclesTable.status, filters.status));
  if (filters.search?.trim()) {
    const term = `%${filters.search.trim()}%`;
    const match = or(
      ilike(vehiclesTable.registrationNumber, term),
      ilike(vehiclesTable.make, term),
      ilike(vehiclesTable.model, term),
    );
    if (match) conditions.push(match);
  }
  return db
    .select()
    .from(vehiclesTable)
    .where(and(...conditions))
    .orderBy(vehiclesTable.registrationNumber);
}

/** Org-scoped fetch. A vehicle id from another organization is simply not found. */
export async function getVehicleById(organizationId: number, vehicleId: number): Promise<Vehicle | null> {
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, vehicleId), eq(vehiclesTable.organizationId, organizationId)))
    .limit(1);
  return vehicle ?? null;
}

async function assertReferencesValid(params: {
  organizationId: number;
  branchId?: number | null;
  defaultDriverEmployeeId?: number | null;
  assetId?: number | null;
}): Promise<void> {
  if (params.branchId != null) {
    await assertBelongsToOrganization(branchesTable, params.branchId, params.organizationId, "Branch");
  }
  if (params.defaultDriverEmployeeId != null) {
    await assertBelongsToOrganization(employeesTable, params.defaultDriverEmployeeId, params.organizationId, "Employee");
  }
  if (params.assetId != null) {
    await assertBelongsToOrganization(assetsTable, params.assetId, params.organizationId, "Asset");
  }
}

export interface CreateVehicleParams {
  organizationId: number;
  registrationNumber: string;
  make?: string | null;
  model?: string | null;
  description?: string | null;
  defaultDriverEmployeeId?: number | null;
  branchId?: number | null;
  /** Optional link to the same organization's capital-asset register. */
  assetId?: number | null;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function createVehicle(params: CreateVehicleParams): Promise<Vehicle> {
  const registrationNumber = normalizeRegistrationNumber(params.registrationNumber);
  await assertReferencesValid(params);

  try {
    const [vehicle] = await db
      .insert(vehiclesTable)
      .values({
        organizationId: params.organizationId,
        registrationNumber,
        make: optionalText(params.make, "make"),
        model: optionalText(params.model, "model"),
        description: optionalText(params.description, "description", 500),
        defaultDriverEmployeeId: params.defaultDriverEmployeeId ?? null,
        branchId: params.branchId ?? null,
        assetId: params.assetId ?? null,
        status: "available",
        notes: optionalText(params.notes, "notes", 500),
        createdByMembershipId: params.actorMembershipId,
        updatedByMembershipId: params.actorMembershipId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "vehicle.created",
      targetType: "vehicle",
      targetId: String(vehicle!.id),
      afterState: {
        registrationNumber: vehicle!.registrationNumber,
        make: vehicle!.make,
        model: vehicle!.model,
        status: vehicle!.status,
        assetId: vehicle!.assetId,
      },
    });
    return vehicle!;
  } catch (err) {
    // The unique indexes are the real guarantee, so a concurrent insert of the
    // same registration number or the same asset link surfaces here rather than
    // through a check-then-insert race.
    if (isUniqueViolation(err)) throw translateUniqueViolation(err);
    throw err;
  }
}

export interface UpdateVehicleParams {
  organizationId: number;
  vehicleId: number;
  registrationNumber?: string;
  make?: string | null;
  model?: string | null;
  description?: string | null;
  defaultDriverEmployeeId?: number | null;
  branchId?: number | null;
  assetId?: number | null;
  notes?: string | null;
  status?: VehicleStatus;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function updateVehicle(params: UpdateVehicleParams): Promise<Vehicle> {
  const existing = await getVehicleById(params.organizationId, params.vehicleId);
  if (!existing) throw new VehicleNotFoundError();

  await assertReferencesValid(params);

  const patch: Partial<typeof vehiclesTable.$inferInsert> = { updatedByMembershipId: params.actorMembershipId };
  if (params.registrationNumber !== undefined) patch.registrationNumber = normalizeRegistrationNumber(params.registrationNumber);
  if (params.make !== undefined) patch.make = optionalText(params.make, "make");
  if (params.model !== undefined) patch.model = optionalText(params.model, "model");
  if (params.description !== undefined) patch.description = optionalText(params.description, "description", 500);
  if (params.defaultDriverEmployeeId !== undefined) patch.defaultDriverEmployeeId = params.defaultDriverEmployeeId;
  if (params.branchId !== undefined) patch.branchId = params.branchId;
  if (params.assetId !== undefined) patch.assetId = params.assetId;
  if (params.notes !== undefined) patch.notes = optionalText(params.notes, "notes", 500);
  if (params.status !== undefined) patch.status = params.status;

  let updated: Vehicle | undefined;
  try {
    [updated] = await db
      .update(vehiclesTable)
      .set(patch)
      .where(and(eq(vehiclesTable.id, params.vehicleId), eq(vehiclesTable.organizationId, params.organizationId)))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw translateUniqueViolation(err);
    throw err;
  }
  if (!updated) throw new VehicleNotFoundError();

  const changedFields = (Object.keys(patch) as (keyof typeof patch)[]).filter((key) => key !== "updatedByMembershipId");
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: existing.status !== updated.status ? "vehicle.status_changed" : "vehicle.updated",
    targetType: "vehicle",
    targetId: String(updated.id),
    beforeState: { registrationNumber: existing.registrationNumber, status: existing.status },
    afterState: { registrationNumber: updated.registrationNumber, status: updated.status },
    metadata: { changedFields },
  });
  return updated;
}
