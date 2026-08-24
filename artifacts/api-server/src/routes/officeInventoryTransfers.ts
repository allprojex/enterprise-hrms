/**
 * Office Inventory, Workstream 5 — Returns, Handovers, Store Transfers
 * routes (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §21-§23, §47, §50).
 * Every route composes `requireModuleEnabled("office_inventory")`.
 * Permissions reused unchanged from the frozen 22-key list —
 * `office_inventory.return`, `office_inventory.handover`,
 * `office_inventory.transfer` — zero new keys. No generic movement-write
 * route, no arbitrary `movementType` selection, no generic status-PATCH —
 * each action is its own dedicated, narrowly-typed route.
 */
import { Router } from "express";
import { CreateOfficeInventoryReturnBody, CreateOfficeInventoryHandoverBody, CreateOfficeInventoryTransferBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { toIsoDate } from "../lib/leaveRequests";
import {
  returnFromHolder,
  handover,
  transferBetweenStores,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryHolderNotFoundError,
  OfficeInventoryExpectedReturnDateNotAllowedError,
  OfficeInventoryInvalidQuantityError,
  OfficeInventoryConsumableNotEligibleError,
  OfficeInventorySameHolderError,
  OfficeInventorySameStoreError,
  OfficeInventoryDepartmentHandoverAuthorityError,
} from "../lib/officeInventoryTransfers";
import { InsufficientStockError, InsufficientCustodyError } from "../lib/officeInventoryLedger";

const router = Router();

// POST /organizations/:organizationId/office-inventory/returns
router.post(
  "/organizations/:organizationId/office-inventory/returns",
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
    try {
      const result = await returnFromHolder({
        organizationId: req.membership!.organizationId,
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
      });
      res.status(201).json(result);
    } catch (err) {
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

// POST /organizations/:organizationId/office-inventory/handovers
router.post(
  "/organizations/:organizationId/office-inventory/handovers",
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
    try {
      const result = await handover({
        organizationId: req.membership!.organizationId,
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
      });
      res.status(201).json(result);
    } catch (err) {
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

// POST /organizations/:organizationId/office-inventory/transfers
router.post(
  "/organizations/:organizationId/office-inventory/transfers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.transfer"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryTransferBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await transferBetweenStores({
        organizationId: req.membership!.organizationId,
        itemId: parsed.data.itemId,
        fromStoreId: parsed.data.fromStoreId,
        toStoreId: parsed.data.toStoreId,
        quantity: parsed.data.quantity,
        notes: parsed.data.notes ?? null,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError || err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidQuantityError || err instanceof OfficeInventorySameStoreError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof InsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
