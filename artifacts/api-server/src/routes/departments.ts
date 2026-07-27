import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, departmentsTable, branchesTable } from "@workspace/db";
import { CreateDepartmentBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { isUniqueViolation } from "../lib/dbErrors";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "../lib/orgScopedRefs";

const router = Router();

function formatDepartment(department: typeof departmentsTable.$inferSelect) {
  return {
    id: department.id,
    organizationId: department.organizationId,
    branchId: department.branchId,
    parentDepartmentId: department.parentDepartmentId,
    name: department.name,
    code: department.code,
    createdAt: department.createdAt,
  };
}

// GET /organizations/:organizationId/departments
router.get(
  "/organizations/:organizationId/departments",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("department.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const departments = await db
      .select()
      .from(departmentsTable)
      .where(eq(departmentsTable.organizationId, req.membership!.organizationId));
    res.json(departments.map(formatDepartment));
  },
);

// POST /organizations/:organizationId/departments
router.post(
  "/organizations/:organizationId/departments",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("department.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      await assertBelongsToOrganization(branchesTable, parsed.data.branchId, organizationId, "Branch");
      await assertBelongsToOrganization(
        departmentsTable,
        parsed.data.parentDepartmentId,
        organizationId,
        "Parent department",
      );

      const [department] = await db
        .insert(departmentsTable)
        .values({ organizationId, ...parsed.data })
        .returning();
      res.status(201).json(formatDepartment(department));
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A department with this code already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

export default router;
