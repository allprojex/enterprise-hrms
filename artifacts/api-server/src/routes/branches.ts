import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, branchesTable } from "@workspace/db";
import { CreateBranchBody, UpdateBranchBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { isUniqueViolation } from "../lib/dbErrors";
import {
  updateBranch,
  archiveBranch,
  reactivateBranch,
  StructureNotFoundError,
  StructureDependencyError,
} from "../lib/organizationStructureService";

const router = Router();

function formatBranch(branch: typeof branchesTable.$inferSelect) {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    name: branch.name,
    code: branch.code,
    status: branch.status,
    createdAt: branch.createdAt,
  };
}

// GET /organizations/:organizationId/branches
router.get(
  "/organizations/:organizationId/branches",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("branch.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const branches = await db
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.organizationId, req.membership!.organizationId));
    res.json(branches.map(formatBranch));
  },
);

// POST /organizations/:organizationId/branches
router.post(
  "/organizations/:organizationId/branches",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("branch.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateBranchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const [branch] = await db
        .insert(branchesTable)
        .values({ organizationId: req.membership!.organizationId, ...parsed.data })
        .returning();
      res.status(201).json(formatBranch(branch));
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A branch with this code already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/branches/:id
router.patch(
  "/organizations/:organizationId/branches/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("branch.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const branchId = parseInt(raw, 10);
    if (isNaN(branchId)) {
      res.status(400).json({ error: "Invalid branch ID" });
      return;
    }

    const parsed = UpdateBranchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateBranch({
        organizationId: req.membership!.organizationId,
        branchId,
        name: parsed.data.name,
        code: parsed.data.code,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatBranch(updated));
    } catch (err) {
      if (err instanceof StructureNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A branch with this code already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/branches/:id/archive
router.post(
  "/organizations/:organizationId/branches/:id/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("branch.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const branchId = parseInt(raw, 10);
    if (isNaN(branchId)) {
      res.status(400).json({ error: "Invalid branch ID" });
      return;
    }

    try {
      const updated = await archiveBranch({
        organizationId: req.membership!.organizationId,
        branchId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatBranch(updated));
    } catch (err) {
      if (err instanceof StructureNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof StructureDependencyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/branches/:id/reactivate
router.post(
  "/organizations/:organizationId/branches/:id/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("branch.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const branchId = parseInt(raw, 10);
    if (isNaN(branchId)) {
      res.status(400).json({ error: "Invalid branch ID" });
      return;
    }

    try {
      const updated = await reactivateBranch({
        organizationId: req.membership!.organizationId,
        branchId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(formatBranch(updated));
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
