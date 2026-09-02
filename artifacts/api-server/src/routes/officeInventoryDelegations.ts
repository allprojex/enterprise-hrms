/**
 * Office Inventory, Workstream 3 — Approval Delegation routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §6, §5.3). Every route is
 * gated by `office_inventory.delegate.manage` PLUS being the target
 * department's current Head — permission alone is insufficient, enforced
 * inside lib/officeInventoryDelegations.ts, never trusted from the
 * permission grant alone.
 */
import { Router } from "express";
import { CreateOfficeInventoryDelegationBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createDelegation,
  revokeDelegation,
  listDelegationsForDepartment,
  getCurrentDepartmentHeadCheck,
  DepartmentNotFoundError,
  NotCurrentDepartmentHeadError,
  InvalidDelegateError,
  DelegationNotFoundError,
} from "../lib/officeInventoryDelegations";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/office-inventory/departments/:departmentId/delegations
router.get(
  "/organizations/:organizationId/office-inventory/departments/:departmentId/delegations",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.delegate.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const isCurrentHead = await getCurrentDepartmentHeadCheck(organizationId, departmentId, req.membership!.id);
    if (!isCurrentHead) {
      res.status(403).json({ error: "Forbidden — only this department's current Head may view its delegations" });
      return;
    }
    const delegations = await listDelegationsForDepartment(organizationId, departmentId);
    res.json(delegations);
  },
);

// POST /organizations/:organizationId/office-inventory/departments/:departmentId/delegations
router.post(
  "/organizations/:organizationId/office-inventory/departments/:departmentId/delegations",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.delegate.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const departmentId = parseId(req.params.departmentId);
    if (isNaN(departmentId)) {
      res.status(400).json({ error: "Invalid department ID" });
      return;
    }
    const parsed = CreateOfficeInventoryDelegationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const delegation = await createDelegation({
        organizationId: req.membership!.organizationId,
        departmentId,
        delegateMembershipId: parsed.data.delegateMembershipId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(delegation);
    } catch (err) {
      if (err instanceof DepartmentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof NotCurrentDepartmentHeadError) {
        res.status(403).json({ error: err.message });
        return;
      }
      // F-4: an unusable delegate (another tenant, inactive, or the Head
      // themselves) is a bad request, not a permission failure — the caller IS
      // the department Head and is entitled to delegate, they just named
      // someone who cannot hold the authority.
      if (err instanceof InvalidDelegateError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/delegations/:id/revoke
router.post(
  "/organizations/:organizationId/office-inventory/delegations/:id/revoke",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.delegate.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid delegation ID" });
      return;
    }
    try {
      const revoked = await revokeDelegation({
        organizationId: req.membership!.organizationId,
        delegationId: id,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(revoked);
    } catch (err) {
      if (err instanceof DelegationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof NotCurrentDepartmentHeadError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
