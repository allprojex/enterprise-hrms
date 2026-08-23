/**
 * Office Inventory, Workstream 2 — Stock Ledger & Receiving routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §9, §47). Every route is
 * gated by requireModuleEnabled("office_inventory"). Creating a receipt uses
 * the frozen narrow `office_inventory.receive` authority; every read route
 * (receipt history, balance, movement history) uses `office_inventory.custody.read`
 * — the only read-oriented permission among the frozen 23 keys not already
 * claimed by a more specific later-workstream surface (`reports.read` is
 * reserved for the ADR-016 formal reports Workstream 9 owns). This mapping
 * is a disclosed interpretation, not an explicit frozen-plan text mapping —
 * flagged here for confirmation the same way the prior reconciliation round
 * surfaced and resolved an ambiguity, rather than silently assumed.
 *
 * No generic ledger-write endpoint exists here or anywhere — the only way
 * to append a movement row through this API is `POST .../receiving`, which
 * always produces `movementType: "received"` rows via the domain service in
 * lib/officeInventoryReceiving.ts. A client can never specify `movementType`
 * or any other ledger field directly.
 */
import { Router } from "express";
import { CreateOfficeInventoryReceiptBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createOfficeInventoryReceipt,
  getOfficeInventoryReceipt,
  listOfficeInventoryReceipts,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryReceivingItemsNotFoundError,
  OfficeInventoryReceivingNoLinesError,
  OfficeInventoryReceivingInvalidQuantityError,
  OfficeInventoryReceiptNotFoundError,
} from "../lib/officeInventoryReceiving";
import { getStoreBalance, getStoreBalancesForItem, getOrganizationTotalBalance, listStockMovements } from "../lib/officeInventoryLedger";
import { getOfficeInventoryItem, OfficeInventoryItemNotFoundError } from "../lib/officeInventoryCatalog";

const router = Router();

function parseIntParam(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

// GET /organizations/:organizationId/office-inventory/receiving
router.get(
  "/organizations/:organizationId/office-inventory/receiving",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.custody.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const receipts = await listOfficeInventoryReceipts(req.membership!.organizationId);
    res.json(receipts);
  },
);

// POST /organizations/:organizationId/office-inventory/receiving
router.post(
  "/organizations/:organizationId/office-inventory/receiving",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.receive"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryReceiptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const receipt = await createOfficeInventoryReceipt({
        organizationId: req.membership!.organizationId,
        storeId: parsed.data.storeId,
        lines: parsed.data.lines,
        source: parsed.data.source,
        deliveryReference: parsed.data.deliveryReference,
        notes: parsed.data.notes,
        idempotencyKey: parsed.data.idempotencyKey,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(receipt);
    } catch (err) {
      if (err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryReceivingItemsNotFoundError) {
        res.status(400).json({ error: err.message, itemIds: err.itemIds });
        return;
      }
      if (err instanceof OfficeInventoryReceivingNoLinesError || err instanceof OfficeInventoryReceivingInvalidQuantityError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/receiving/:referenceNumber
router.get(
  "/organizations/:organizationId/office-inventory/receiving/:referenceNumber",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.custody.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const receipt = await getOfficeInventoryReceipt(req.membership!.organizationId, req.params.referenceNumber as string);
      res.json(receipt);
    } catch (err) {
      if (err instanceof OfficeInventoryReceiptNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/stock/balance
router.get(
  "/organizations/:organizationId/office-inventory/stock/balance",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.custody.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const itemId = parseIntParam(req.query.itemId as string | undefined);
    const storeId = parseIntParam(req.query.storeId as string | undefined);
    if (itemId === undefined) {
      res.status(400).json({ error: "itemId is required" });
      return;
    }
    try {
      await getOfficeInventoryItem(organizationId, itemId);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (storeId !== undefined) {
      const balance = await getStoreBalance(organizationId, itemId, storeId);
      res.json({ itemId, storeId, total: balance, byStore: [] });
      return;
    }

    const [total, byStore] = await Promise.all([
      getOrganizationTotalBalance(organizationId, itemId),
      getStoreBalancesForItem(organizationId, itemId),
    ]);
    res.json({ itemId, storeId: null, total, byStore });
  },
);

// GET /organizations/:organizationId/office-inventory/stock/movements
router.get(
  "/organizations/:organizationId/office-inventory/stock/movements",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.custody.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const itemId = parseIntParam(req.query.itemId as string | undefined);
    const storeId = parseIntParam(req.query.storeId as string | undefined);
    const movements = await listStockMovements(req.membership!.organizationId, { itemId, storeId });
    res.json(movements);
  },
);

export default router;
