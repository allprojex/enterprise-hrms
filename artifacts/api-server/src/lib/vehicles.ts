/**
 * VR-01 — Vehicle Foundation: the organizational vehicle register.
 *
 * Scope is deliberately the REGISTER only: which vehicles the organization has,
 * how they are identified, who normally drives them, and whether they are
 * currently usable. The request → approval → release → return flow is VR-02 and
 * owns its own tables; nothing here reserves a vehicle or records movement.
 *
 * `in_use` is reachable only from that later flow. The register API refuses to
 * set it, the same separation Office Inventory keeps between approving a
 * request and moving the ledger — so a vehicle can never be shown as out
 * without a movement record explaining why.
 *
 * Every read and write is scoped by organizationId taken from the caller's
 * membership, never from the body; `branchId`/`defaultDriverEmployeeId` are
 * verified to belong to the same organization before they can be attached.
 */
import { and, eq, ilike, or, type SQL } from "drizzle-orm";
import { db, vehiclesTable, branchesTable, employeesTable, type Vehicle } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";
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

/** Statuses the register itself may set. `in_use` belongs to the VR-02 movement flow. */
export const REGISTER_SETTABLE_STATUSES = ["available", "maintenance", "inactive"] as const;
export type RegisterSettableStatus = (typeof REGISTER_SETTABLE_STATUSES)[number];

/**
 * Registration numbers are compared case- and spacing-insensitively so
 * "gr 1234-20" and "GR1234-20" cannot both be registered; the normalized upper
 * case form is what is stored and shown.
 */
export function normalizeRegistrationNumber(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ").toUpperCase();
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
}): Promise<void> {
  if (params.branchId != null) {
    await assertBelongsToOrganization(branchesTable, params.branchId, params.organizationId, "Branch");
  }
  if (params.defaultDriverEmployeeId != null) {
    await assertBelongsToOrganization(employeesTable, params.defaultDriverEmployeeId, params.organizationId, "Employee");
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
      },
    });
    return vehicle!;
  } catch (err) {
    // The (organization_id, registration_number) unique index is the real
    // guarantee, so a concurrent insert of the same number surfaces here
    // rather than through a check-then-insert race.
    if (isUniqueViolation(err)) throw new DuplicateVehicleRegistrationError();
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
  notes?: string | null;
  status?: RegisterSettableStatus;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function updateVehicle(params: UpdateVehicleParams): Promise<Vehicle> {
  const existing = await getVehicleById(params.organizationId, params.vehicleId);
  if (!existing) throw new VehicleNotFoundError();

  if (params.status != null && !REGISTER_SETTABLE_STATUSES.includes(params.status)) {
    throw new InvalidVehicleError(`status must be one of ${REGISTER_SETTABLE_STATUSES.join(", ")}`);
  }
  // A vehicle that is out cannot be edited into another state from the
  // register: the movement record that took it out is what brings it back.
  // Every status the register can set differs from `in_use`, so any status
  // change at all is refused while the vehicle is out.
  if (existing.status === "in_use" && params.status != null) {
    throw new InvalidVehicleError("This vehicle is currently out. Record its return before changing its status.");
  }
  await assertReferencesValid(params);

  const patch: Partial<typeof vehiclesTable.$inferInsert> = { updatedByMembershipId: params.actorMembershipId };
  if (params.registrationNumber !== undefined) patch.registrationNumber = normalizeRegistrationNumber(params.registrationNumber);
  if (params.make !== undefined) patch.make = optionalText(params.make, "make");
  if (params.model !== undefined) patch.model = optionalText(params.model, "model");
  if (params.description !== undefined) patch.description = optionalText(params.description, "description", 500);
  if (params.defaultDriverEmployeeId !== undefined) patch.defaultDriverEmployeeId = params.defaultDriverEmployeeId;
  if (params.branchId !== undefined) patch.branchId = params.branchId;
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
    if (isUniqueViolation(err)) throw new DuplicateVehicleRegistrationError();
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
