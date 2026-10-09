/**
 * VR-02A — Vehicle Request approval-stage configuration.
 *
 * Every route runs requireAuth → requireMembership(:organizationId) →
 * requireModuleEnabled(asset_management) → requirePermission. The organization
 * always comes from the caller's membership, never the body, and a stage id
 * belonging to another organization answers 404 rather than confirming that it
 * exists.
 *
 * GATED ON `asset_management.manage`, DELIBERATELY. Configuring who may approve
 * a vehicle request is administration of the vehicle domain, so it reuses the
 * register's existing administrative permission rather than adding a fifth
 * `vehicle_request.*` key. None of the four `vehicle_request.*` keys grants
 * access here: an approver may decide requests without being able to rewrite
 * the chain that appointed them.
 */
import { Router } from "express";
import {
  CreateVehicleRequestApprovalStageBody,
  UpdateVehicleRequestApprovalStageBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { ASSET_MANAGEMENT_MODULE_KEY } from "../lib/assetManagementAuthorization";
import {
  listApprovalCandidates,
  listStages,
  getStageById,
  createStage,
  updateStage,
  deleteStage,
  VehicleRequestStageNotFoundError,
  InvalidVehicleRequestStageError,
  DuplicateVehicleRequestStageOrderError,
} from "../lib/vehicleRequestStages";
import type { VehicleRequestApprovalStage } from "@workspace/db";

const router = Router();

function formatStage(stage: VehicleRequestApprovalStage) {
  return {
    id: stage.id,
    organizationId: stage.organizationId,
    purpose: stage.purpose,
    stageOrder: stage.stageOrder,
    name: stage.name,
    resolverType: stage.resolverType,
    resolverConfig: stage.resolverConfig ?? {},
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

function parseStageId(raw: unknown): number {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof VehicleRequestStageNotFoundError) {
    res.status(404).json({ error: "Approval stage not found" });
    return true;
  }
  if (err instanceof DuplicateVehicleRequestStageOrderError) {
    res.status(409).json({ error: (err as Error).message });
    return true;
  }
  if (err instanceof InvalidVehicleRequestStageError) {
    res.status(400).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/vehicle-request-approval-stages
router.get(
  "/organizations/:organizationId/vehicle-request-approval-stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stages = await listStages(req.membership!.organizationId);
    res.json(stages.map(formatStage));
  },
);

// GET /organizations/:organizationId/vehicle-request-approval-stages/candidates
//
// ORDERING IS LOAD-BEARING: this literal sub-path is registered BEFORE
// /:stageId below, or Express matches "candidates" as a stage id and this
// route becomes unreachable. Same rule VR-01 recorded for /vehicles.
//
// Who may legitimately be named by a `specific_membership` stage. Same
// authorization as the rest of this configuration surface — an administrator
// choosing an approver, not a second door onto the membership directory:
// `membership.read` neither grants access here nor is required for it.
//
// Response is the minimum identity the picker needs. No email, no roles, no
// Primary HR flag, no user id, no employee record. There is deliberately no
// lookup-by-id form, so this cannot be used to probe whether a given
// membership id exists.
router.get(
  "/organizations/:organizationId/vehicle-request-approval-stages/candidates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    // The organization is the caller's own resolved membership, never a
    // client-supplied value.
    const candidates = await listApprovalCandidates(req.membership!.organizationId);
    res.json(candidates);
  },
);

// GET /organizations/:organizationId/vehicle-request-approval-stages/:stageId
router.get(
  "/organizations/:organizationId/vehicle-request-approval-stages/:stageId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stageId = parseStageId(req.params["stageId"]);
    if (Number.isNaN(stageId)) {
      res.status(400).json({ error: "Invalid stage ID" });
      return;
    }
    const stage = await getStageById(req.membership!.organizationId, stageId);
    if (!stage) {
      res.status(404).json({ error: "Approval stage not found" });
      return;
    }
    res.json(formatStage(stage));
  },
);

// POST /organizations/:organizationId/vehicle-request-approval-stages
router.post(
  "/organizations/:organizationId/vehicle-request-approval-stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateVehicleRequestApprovalStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const stage = await createStage({
        organizationId: req.membership!.organizationId,
        stageOrder: parsed.data.stageOrder,
        name: parsed.data.name,
        resolverType: parsed.data.resolverType,
        resolverConfig: parsed.data.resolverConfig ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatStage(stage));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// PATCH /organizations/:organizationId/vehicle-request-approval-stages/:stageId
router.patch(
  "/organizations/:organizationId/vehicle-request-approval-stages/:stageId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stageId = parseStageId(req.params["stageId"]);
    if (Number.isNaN(stageId)) {
      res.status(400).json({ error: "Invalid stage ID" });
      return;
    }
    const parsed = UpdateVehicleRequestApprovalStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const stage = await updateStage({
        organizationId: req.membership!.organizationId,
        stageId,
        ...(parsed.data.stageOrder !== undefined ? { stageOrder: parsed.data.stageOrder } : {}),
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.resolverType !== undefined ? { resolverType: parsed.data.resolverType } : {}),
        ...(parsed.data.resolverConfig !== undefined ? { resolverConfig: parsed.data.resolverConfig } : {}),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatStage(stage));
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

// DELETE /organizations/:organizationId/vehicle-request-approval-stages/:stageId
router.delete(
  "/organizations/:organizationId/vehicle-request-approval-stages/:stageId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stageId = parseStageId(req.params["stageId"]);
    if (Number.isNaN(stageId)) {
      res.status(400).json({ error: "Invalid stage ID" });
      return;
    }
    try {
      await deleteStage({
        organizationId: req.membership!.organizationId,
        stageId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(204).send();
    } catch (err) {
      if (!handleError(err, res)) throw err;
    }
  },
);

export default router;
