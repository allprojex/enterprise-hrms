/**
 * Office Inventory, Workstream 8 — Employee Self-Service routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §33, Workstream 8's own
 * objective text: "no new backend authority beyond what Workstreams 3-6
 * already built"). Own request submission/viewing (officeInventoryRequests.ts),
 * receipt confirmation (officeInventoryIssuing.ts), and damage/missing
 * reporting (officeInventoryIncidents.ts) already exist as own-scoped ESS
 * routes from earlier workstreams and are reused unchanged by the frontend —
 * this file adds only the genuinely new own-scoped routes.
 *
 * Permission design (disclosed, no new permission key added):
 *   - GET my/custody, GET my/history: no office_inventory.* permission
 *     required — module-enabled + authenticated membership only. Owning
 *     your own data is not an operational grant, mirroring GET /me/employee's
 *     own no-permission precedent (routes/me.ts), not Asset Management's
 *     dedicated `asset_management.read.own` key — no equivalent
 *     `office_inventory.custody.read.own` key exists in the frozen 21-key
 *     list, and this workstream is expressly forbidden from adding one.
 *   - POST my/returns, POST my/handovers: reuse the EXISTING general
 *     `office_inventory.return`/`.handover` keys unchanged — "initiate a
 *     return/handover where permitted" (§33's own wording) — with ownership
 *     of the FROM side enforced server-side via `assertOwnCustodyAuthority`
 *     (officeInventoryIncidents.ts), never a client-asserted holder.
 *
 * Every route resolves "who am I" via `resolveOwnEmployeeId` exclusively —
 * no client-supplied employeeId ever establishes authority for any route
 * in this file.
 */
import { Router } from "express";
import { CreateOfficeInventoryReturnBody, CreateOfficeInventoryHandoverBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { resolveOwnEmployeeId, toIsoDate } from "../lib/leaveRequests";
import { getMyCustody, getMyInventoryHistory, returnOwnItem, handoverOwnItem } from "../lib/officeInventoryEss";
import {
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryHolderNotFoundError,
  OfficeInventoryExpectedReturnDateNotAllowedError,
  OfficeInventoryInvalidQuantityError,
  OfficeInventoryConsumableNotEligibleError,
  OfficeInventorySameHolderError,
  OfficeInventoryDepartmentHandoverAuthorityError,
} from "../lib/officeInventoryTransfers";
import { OfficeInventoryNotOwnCustodyError } from "../lib/officeInventoryIncidents";
import { InsufficientStockError, InsufficientCustodyError } from "../lib/officeInventoryLedger";

const router = Router();

// GET /organizations/:organizationId/office-inventory/my/custody
router.get(
  "/organizations/:organizationId/office-inventory/my/custody",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const custody = await getMyCustody(organizationId, employeeId);
    res.json(custody);
  },
);

// GET /organizations/:organizationId/office-inventory/my/history
router.get(
  "/organizations/:organizationId/office-inventory/my/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const history = await getMyInventoryHistory(organizationId, employeeId);
    res.json(history);
  },
);

// POST /organizations/:organizationId/office-inventory/my/returns
router.post(
  "/organizations/:organizationId/office-inventory/my/returns",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.return"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryReturnBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const actorEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    try {
      const result = await returnOwnItem({
        organizationId,
        itemId: parsed.data.itemId,
        holderType: parsed.data.holderType,
        holderId: parsed.data.holderId,
        destinationStoreId: parsed.data.destinationStoreId,
        quantity: parsed.data.quantity,
        condition: parsed.data.condition ?? null,
        notes: parsed.data.notes ?? null,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
        actorEmployeeId,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryNotOwnCustodyError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryStoreNotFoundError || err instanceof OfficeInventoryHolderNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError || err instanceof OfficeInventoryConsumableNotEligibleError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof InsufficientCustodyError || err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/my/handovers
router.post(
  "/organizations/:organizationId/office-inventory/my/handovers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.handover"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryHandoverBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const actorEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    try {
      const result = await handoverOwnItem({
        organizationId,
        itemId: parsed.data.itemId,
        fromHolderType: parsed.data.fromHolderType,
        fromHolderId: parsed.data.fromHolderId,
        toHolderType: parsed.data.toHolderType,
        toHolderId: parsed.data.toHolderId,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason ?? null,
        condition: parsed.data.condition ?? null,
        expectedReturnDate: parsed.data.expectedReturnDate ? toIsoDate(parsed.data.expectedReturnDate) : null,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
        actorEmployeeId,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryNotOwnCustodyError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryHolderNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (
        err instanceof OfficeInventoryInvalidQuantityError ||
        err instanceof OfficeInventoryConsumableNotEligibleError ||
        err instanceof OfficeInventorySameHolderError ||
        err instanceof OfficeInventoryExpectedReturnDateNotAllowedError
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryDepartmentHandoverAuthorityError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof InsufficientCustodyError || err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
