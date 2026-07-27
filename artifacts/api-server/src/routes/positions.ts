import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, positionsTable } from "@workspace/db";
import { CreatePositionBody, RestructurePositionBody, UpdatePositionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { isUniqueViolation } from "../lib/dbErrors";
import {
  assertValidPositionPlacement,
  restructurePosition,
  updatePosition,
  archivePosition,
  reactivatePosition,
  CrossOrganizationReferenceError,
  StructureNotFoundError,
} from "../lib/organizationStructureService";

const router = Router();

function formatPosition(position: typeof positionsTable.$inferSelect) {
  return {
    id: position.id,
    organizationId: position.organizationId,
    title: position.title,
    departmentId: position.departmentId,
    status: position.status,
    createdAt: position.createdAt,
  };
}

// GET /organizations/:organizationId/positions
router.get(
  "/organizations/:organizationId/positions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const positions = await db
      .select()
      .from(positionsTable)
      .where(eq(positionsTable.organizationId, req.membership!.organizationId));
    res.json(positions.map(formatPosition));
  },
);

// POST /organizations/:organizationId/positions
router.post(
  "/organizations/:organizationId/positions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePositionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      await assertValidPositionPlacement({ organizationId, departmentId: parsed.data.departmentId });

      const [position] = await db
        .insert(positionsTable)
        .values({ organizationId, ...parsed.data })
        .returning();
      res.status(201).json(formatPosition(position));
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A position with this title already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/positions/:id/restructure
router.patch(
  "/organizations/:organizationId/positions/:id/restructure",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const positionId = parseInt(raw, 10);
    if (isNaN(positionId)) {
      res.status(400).json({ error: "Invalid position ID" });
      return;
    }

    const parsed = RestructurePositionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await restructurePosition({
        organizationId: req.membership!.organizationId,
        positionId,
        departmentId: parsed.data.departmentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatPosition(updated));
    } catch (err) {
      if (err instanceof StructureNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/positions/:id
router.patch(
  "/organizations/:organizationId/positions/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const positionId = parseInt(raw, 10);
    if (isNaN(positionId)) {
      res.status(400).json({ error: "Invalid position ID" });
      return;
    }

    const parsed = UpdatePositionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updatePosition({
        organizationId: req.membership!.organizationId,
        positionId,
        title: parsed.data.title,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatPosition(updated));
    } catch (err) {
      if (err instanceof StructureNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A position with this title already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/positions/:id/archive
router.post(
  "/organizations/:organizationId/positions/:id/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const positionId = parseInt(raw, 10);
    if (isNaN(positionId)) {
      res.status(400).json({ error: "Invalid position ID" });
      return;
    }

    try {
      const updated = await archivePosition({
        organizationId: req.membership!.organizationId,
        positionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatPosition(updated));
    } catch (err) {
      if (err instanceof StructureNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/positions/:id/reactivate
router.post(
  "/organizations/:organizationId/positions/:id/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const positionId = parseInt(raw, 10);
    if (isNaN(positionId)) {
      res.status(400).json({ error: "Invalid position ID" });
      return;
    }

    try {
      const updated = await reactivatePosition({
        organizationId: req.membership!.organizationId,
        positionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatPosition(updated));
    } catch (err) {
      if (err instanceof StructureNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
