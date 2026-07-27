import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, organizationMembershipsTable } from "@workspace/db";
import { SetPrimaryHrBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getActivePrimaryHr, transferPrimaryHr } from "../lib/primaryHr";

const router = Router();

function formatAssignment(assignment: Awaited<ReturnType<typeof getActivePrimaryHr>>) {
  if (!assignment) return null;
  return {
    id: assignment.id,
    organizationId: assignment.organizationId,
    membershipId: assignment.membershipId,
    assignedAt: assignment.assignedAt,
    assignedBy: assignment.assignedBy,
    revokedAt: assignment.revokedAt,
    revokedBy: assignment.revokedBy,
  };
}

// GET /organizations/:organizationId/primary-hr
router.get(
  "/organizations/:organizationId/primary-hr",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("primary_hr.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const assignment = await getActivePrimaryHr(req.membership!.organizationId);
    res.json(formatAssignment(assignment));
  },
);

// POST /organizations/:organizationId/primary-hr
router.post(
  "/organizations/:organizationId/primary-hr",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("primary_hr.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = SetPrimaryHrBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;

    const [targetMembership] = await db
      .select()
      .from(organizationMembershipsTable)
      .where(eq(organizationMembershipsTable.id, parsed.data.membershipId))
      .limit(1);

    if (!targetMembership || targetMembership.organizationId !== organizationId) {
      res.status(400).json({ error: "Target membership does not belong to this organization" });
      return;
    }

    const assignment = await transferPrimaryHr({
      organizationId,
      newMembershipId: parsed.data.membershipId,
      actedBy: req.userId!,
    });

    res.json(formatAssignment(assignment));
  },
);

export default router;
