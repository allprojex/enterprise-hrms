/**
 * Office Inventory, Workstream 1 — Department Head routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §5). Deliberately NOT gated
 * by requireModuleEnabled("office_inventory") — Department Headship is a
 * general organizational-authority relationship, not an Inventory feature,
 * mirroring primaryHr.ts's own precedent (single `manage` permission gates
 * both reads and writes, no separate read permission, no module gate).
 */
import { Router } from "express";
import { AssignDepartmentHeadBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
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

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/departments/:departmentId/head
router.get(
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
    const current = await getCurrentDepartmentHead(req.membership!.organizationId, departmentId);
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
  requirePermission("department.head.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const history = await listDepartmentHeadHistory(req.membership!.organizationId, departmentId);
    res.json(history);
  },
);

// GET /organizations/:organizationId/departments/:departmentId/head/as-of
router.get(
  "/organizations/:organizationId/departments/:departmentId/head/as-of",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("department.head.manage"),
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
    const head = await resolveDepartmentHeadAsOf(req.membership!.organizationId, departmentId, asOfDate);
    res.json(head);
  },
);

export default router;
