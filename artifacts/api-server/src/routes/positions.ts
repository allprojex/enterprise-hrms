import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, positionsTable, departmentsTable } from "@workspace/db";
import { CreatePositionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { isUniqueViolation } from "../lib/dbErrors";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "../lib/orgScopedRefs";

const router = Router();

function formatPosition(position: typeof positionsTable.$inferSelect) {
  return {
    id: position.id,
    organizationId: position.organizationId,
    title: position.title,
    departmentId: position.departmentId,
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
      await assertBelongsToOrganization(departmentsTable, parsed.data.departmentId, organizationId, "Department");

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

export default router;
