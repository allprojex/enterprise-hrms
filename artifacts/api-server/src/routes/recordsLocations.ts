/**
 * Phase 3H, W116 — Records Locations. All routes gated by
 * personnel_file.manage (create/update/retire) or personnel_file.read
 * (list) — never a new permission, per the frozen plan's own §13 grants.
 */
import { Router } from "express";
import { CreateRecordsLocationBody, UpdateRecordsLocationBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import {
  listRecordsLocations,
  createRecordsLocation,
  updateRecordsLocation,
  retireRecordsLocation,
  reactivateRecordsLocation,
  RecordsLocationNotFoundError,
  RecordsLocationCycleError,
  CrossOrganizationReferenceError,
} from "../lib/recordsLocations";
import type { RecordsLocation } from "@workspace/db";

const router = Router();

function formatLocation(l: RecordsLocation) {
  return {
    id: l.id,
    organizationId: l.organizationId,
    parentId: l.parentId,
    name: l.name,
    description: l.description,
    status: l.status,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

// GET /organizations/:organizationId/records-locations
router.get(
  "/organizations/:organizationId/records-locations",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const locations = await listRecordsLocations(req.membership!.organizationId);
    res.json(locations.map(formatLocation));
  },
);

// POST /organizations/:organizationId/records-locations
router.post(
  "/organizations/:organizationId/records-locations",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateRecordsLocationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const location = await createRecordsLocation({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        parentId: parsed.data.parentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatLocation(location));
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError || err instanceof RecordsLocationCycleError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/records-locations/:id
router.patch(
  "/organizations/:organizationId/records-locations/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const locationId = parseInt(raw, 10);
    if (isNaN(locationId)) {
      res.status(400).json({ error: "Invalid records location ID" });
      return;
    }

    const parsed = UpdateRecordsLocationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const location = await updateRecordsLocation({
        organizationId: req.membership!.organizationId,
        locationId,
        name: parsed.data.name,
        description: parsed.data.description,
        parentId: parsed.data.parentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatLocation(location));
    } catch (err) {
      if (err instanceof RecordsLocationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof CrossOrganizationReferenceError || err instanceof RecordsLocationCycleError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/records-locations/:id/retire
router.post(
  "/organizations/:organizationId/records-locations/:id/retire",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const locationId = parseInt(raw, 10);
    if (isNaN(locationId)) {
      res.status(400).json({ error: "Invalid records location ID" });
      return;
    }

    try {
      const location = await retireRecordsLocation({
        organizationId: req.membership!.organizationId,
        locationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatLocation(location));
    } catch (err) {
      if (err instanceof RecordsLocationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/records-locations/:id/reactivate
router.post(
  "/organizations/:organizationId/records-locations/:id/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const locationId = parseInt(raw, 10);
    if (isNaN(locationId)) {
      res.status(400).json({ error: "Invalid records location ID" });
      return;
    }

    try {
      const location = await reactivateRecordsLocation({
        organizationId: req.membership!.organizationId,
        locationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatLocation(location));
    } catch (err) {
      if (err instanceof RecordsLocationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
