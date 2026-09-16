/**
 * Office Inventory, Workstream 1 — Department Head routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §5). Deliberately NOT gated
 * by requireModuleEnabled("office_inventory") — Department Headship is a
 * general organizational-authority relationship, not an Inventory feature.
 *
 * READ AND MANAGE ARE SEPARATE CAPABILITIES (ROLE-02, 2026-09-15). The
 * original design followed primaryHr.ts in letting one `manage` key gate
 * both, which left the role that owns organizational structure — org_admin,
 * holder of department.manage, branch.manage, position.manage and
 * membership.manage — unable to find out who leads a department it can
 * itself create and rename. In Production that surfaced as a burst of 403s
 * from the departments page, one per department, for an org_admin caller.
 *
 * Knowing who currently heads a department is not Department Head authority,
 * so the reads below take a narrower `department.head.read`. The writes are
 * unchanged and still require `department.head.manage`: this fixes a read
 * requirement without widening anyone's ability to assign or revoke a Head.
 *
 * The reads accept EITHER key. `department.head.manage` has been assignable
 * since Office Inventory W1 and organizations may have granted it to roles
 * this codebase cannot see; gating the reads on the new key alone would have
 * revoked read access from those existing holders. Manage keeps implying its
 * own read.
 *
 * The three reads resolve their organization through `resolveOrganizationId`
 * rather than `req.membership!`. Both keys are read-only and so may legitimately
 * appear in a WS-4 break-glass grant's scope, and under such a grant there is no
 * membership row — dereferencing it would have thrown a 500 on exactly the path
 * the grant exists to serve. The writes keep `req.membership!`: a grant's scope
 * is validated to contain only read-only keys, so `department.head.manage` can
 * never reach them.
 */
import { Router } from "express";
import { AssignDepartmentHeadBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireAnyPermission } from "../middlewares/requireAnyPermission";
import {
  assignDepartmentHead,
  revokeDepartmentHead,
  getCurrentDepartmentHead,
  listDepartmentHeadHistory,
  resolveDepartmentHeadAsOf,
  DepartmentNotFoundError,
  DepartmentHeadNotFoundError,
} from "../lib/departmentHeads";

const router = Router();

/**
 * Either key may read a Department Head assignment: the dedicated read
 * capability, or the manage capability that implies it. Writes below stay
 * manage-only.
 */
const DEPARTMENT_HEAD_READ_KEYS = ["department.head.read", "department.head.manage"] as const;

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/departments/:departmentId/head
router.get(
  "/organizations/:organizationId/departments/:departmentId/head",
  requireAuth as any,
  requireMembership("organizationId"),
  requireAnyPermission(DEPARTMENT_HEAD_READ_KEYS),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const current = await getCurrentDepartmentHead(resolveOrganizationId(req), departmentId);
    res.json(current);
  },
);

// POST /organizations/:organizationId/departments/:departmentId/head
router.post(
  "/organizations/:organizationId/departments/:departmentId/head",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("department.head.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const parsed = AssignDepartmentHeadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const record = await assignDepartmentHead({
        organizationId: req.membership!.organizationId,
        departmentId,
        headMembershipId: parsed.data.headMembershipId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(record);
    } catch (err) {
      if (err instanceof DepartmentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/departments/:departmentId/head
router.delete(
  "/organizations/:organizationId/departments/:departmentId/head",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("department.head.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    try {
      const revoked = await revokeDepartmentHead({
        organizationId: req.membership!.organizationId,
        departmentId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(revoked);
    } catch (err) {
      if (err instanceof DepartmentNotFoundError || err instanceof DepartmentHeadNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/departments/:departmentId/head/history
router.get(
  "/organizations/:organizationId/departments/:departmentId/head/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requireAnyPermission(DEPARTMENT_HEAD_READ_KEYS),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const history = await listDepartmentHeadHistory(resolveOrganizationId(req), departmentId);
    res.json(history);
  },
);

// GET /organizations/:organizationId/departments/:departmentId/head/as-of
router.get(
  "/organizations/:organizationId/departments/:departmentId/head/as-of",
  requireAuth as any,
  requireMembership("organizationId"),
  requireAnyPermission(DEPARTMENT_HEAD_READ_KEYS),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const raw = Array.isArray(req.query.date) ? req.query.date[0] : req.query.date;
    const asOfDate = new Date(String(raw ?? ""));
    if (!raw || isNaN(asOfDate.getTime())) {
      res.status(400).json({ error: "Invalid or missing 'date' query parameter" });
      return;
    }
    const head = await resolveDepartmentHeadAsOf(resolveOrganizationId(req), departmentId, asOfDate);
    res.json(head);
  },
);

export default router;
