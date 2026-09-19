/**
 * VR-01 — Vehicle Foundation: the organizational vehicle register.
 *
 * Every route runs requireAuth → requireMembership(:organizationId) →
 * requireModuleEnabled("vehicle_management") → requirePermission. The
 * organization always comes from the caller's membership, never the body, and a
 * vehicle id belonging to another organization answers 404 rather than
 * confirming that it exists.
 *
 * `vehicle.read` sees the register; `vehicle.manage` administers it. Neither is
 * asset_management: enabling Assets must not be the price of managing vehicles,
 * and an asset administrator is not automatically a transport administrator.
 */
import { Router } from "express";
import { CreateVehicleBody, UpdateVehicleBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  VehicleNotFoundError,
  InvalidVehicleError,
  DuplicateVehicleRegistrationError,
  type RegisterSettableStatus,
} from "../lib/vehicles";
import type { Vehicle } from "@workspace/db";

const router = Router();
const VEHICLE_MODULE = "vehicle_management";

function formatVehicle(v: Vehicle) {
  return {
    id: v.id,
    organizationId: v.organizationId,
    registrationNumber: v.registrationNumber,
    make: v.make,
    model: v.model,
    description: v.description,
    defaultDriverEmployeeId: v.defaultDriverEmployeeId,
    branchId: v.branchId,
    status: v.status,
    notes: v.notes,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

function parseVehicleId(raw: unknown): number {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof VehicleNotFoundError) {
    res.status(404).json({ error: "Vehicle not found" });
    return true;
  }
  if (err instanceof DuplicateVehicleRegistrationError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidVehicleError || err instanceof CrossOrganizationReferenceError) {
    res.status(400).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/vehicles
router.get(
  "/organizations/:organizationId/vehicles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(VEHICLE_MODULE),
  requirePermission("vehicle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const statusRaw = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const searchRaw = typeof req.query["search"] === "string" ? req.query["search"] : undefined;
    const vehicles = await listVehicles(req.membership!.organizationId, {
      status: statusRaw as Vehicle["status"] | undefined,
      search: searchRaw,
    });
    res.json(vehicles.map(formatVehicle));
  },
);

// GET /organizations/:organizationId/vehicles/:vehicleId
router.get(
  "/organizations/:organizationId/vehicles/:vehicleId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(VEHICLE_MODULE),
  requirePermission("vehicle.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vehicleId = parseVehicleId(req.params["vehicleId"]);
    if (Number.isNaN(vehicleId)) {
      res.status(400).json({ error: "Invalid vehicle ID" });
      return;
    }
    const vehicle = await getVehicleById(req.membership!.organizationId, vehicleId);
    if (!vehicle) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    res.json(formatVehicle(vehicle));
  },
);

// POST /organizations/:organizationId/vehicles
router.post(
  "/organizations/:organizationId/vehicles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(VEHICLE_MODULE),
  requirePermission("vehicle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateVehicleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const vehicle = await createVehicle({
        organizationId: req.membership!.organizationId,
        registrationNumber: parsed.data.registrationNumber,
        make: parsed.data.make ?? null,
        model: parsed.data.model ?? null,
        description: parsed.data.description ?? null,
        defaultDriverEmployeeId: parsed.data.defaultDriverEmployeeId ?? null,
        branchId: parsed.data.branchId ?? null,
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatVehicle(vehicle));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// PATCH /organizations/:organizationId/vehicles/:vehicleId
router.patch(
  "/organizations/:organizationId/vehicles/:vehicleId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(VEHICLE_MODULE),
  requirePermission("vehicle.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const vehicleId = parseVehicleId(req.params["vehicleId"]);
    if (Number.isNaN(vehicleId)) {
      res.status(400).json({ error: "Invalid vehicle ID" });
      return;
    }
    const parsed = UpdateVehicleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const vehicle = await updateVehicle({
        organizationId: req.membership!.organizationId,
        vehicleId,
        ...(parsed.data.registrationNumber !== undefined ? { registrationNumber: parsed.data.registrationNumber } : {}),
        ...(parsed.data.make !== undefined ? { make: parsed.data.make } : {}),
        ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.defaultDriverEmployeeId !== undefined
          ? { defaultDriverEmployeeId: parsed.data.defaultDriverEmployeeId }
          : {}),
        ...(parsed.data.branchId !== undefined ? { branchId: parsed.data.branchId } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status as RegisterSettableStatus } : {}),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatVehicle(vehicle));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

export default router;
