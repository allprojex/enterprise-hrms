/**
 * VR-01 — Vehicle Foundation: the organizational vehicle register.
 *
 * Every route runs requireAuth → requireMembership(:organizationId) →
 * requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY) → requirePermission. The
 * organization always comes from the caller's membership, never the body, and a
 * vehicle id belonging to another organization answers 404 rather than
 * confirming that it exists.
 *
 * The register is Assets administration, not a domain of its own: it is gated by
 * the existing `asset_management` module and the existing
 * `asset_management.manage` permission. VR-01 introduces no permission key and
 * no module key, so no organization grants anything new to use it, and
 * `asset_management.manage` gains no reach anywhere outside this register.
 */
import { Router } from "express";
import { CreateVehicleBody, UpdateVehicleBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { ASSET_MANAGEMENT_MODULE_KEY } from "../lib/assetManagementAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listVehicles,
  getVehicleById,
  createVehicle,
  updateVehicle,
  VehicleNotFoundError,
  InvalidVehicleError,
  DuplicateVehicleRegistrationError,
  DuplicateVehicleAssetLinkError,
  type VehicleStatus,
} from "../lib/vehicles";
import type { Vehicle } from "@workspace/db";

const router = Router();

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
    assetId: v.assetId,
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
  if (err instanceof DuplicateVehicleRegistrationError || err instanceof DuplicateVehicleAssetLinkError) {
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
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
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
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
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
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
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
        assetId: parsed.data.assetId ?? null,
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
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
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
        ...(parsed.data.assetId !== undefined ? { assetId: parsed.data.assetId } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status as VehicleStatus } : {}),
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
