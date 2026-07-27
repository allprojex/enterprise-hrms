import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, branchesTable } from "@workspace/db";
import { CreateBranchBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { isUniqueViolation } from "../lib/dbErrors";

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

export default router;
