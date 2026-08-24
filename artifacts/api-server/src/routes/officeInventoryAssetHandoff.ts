/**
 * Office Inventory, Workstream 10 — Assets Handoff route
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §4 Owner Decision 1). Gated
 * by BOTH `office_inventory` and `asset_management` module enablement — the
 * frozen decision explicitly reuses Assets' own creation API, so an
 * organization that has not enabled Assets must never have this action
 * silently create Asset rows on its behalf. Single frozen permission,
 * `office_inventory.asset_handoff` — no new key, no additional
 * asset_management-side permission required (the one key authorizes the
 * whole cross-module action, per the frozen text's own singular framing).
 */
import { Router } from "express";
import { CreateOfficeInventoryAssetHandoffBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { toIsoDate } from "../lib/leaveRequests";
import { ASSET_MANAGEMENT_MODULE_KEY } from "../lib/assetManagementAuthorization";
import {
  handoffOfficeInventoryItemToAsset,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryNotEligibleForHandoffError,
  OfficeInventoryHandoffInsufficientStockError,
} from "../lib/officeInventoryAssetHandoff";

const router = Router();

// POST /organizations/:organizationId/office-inventory/asset-handoff
router.post(
  "/organizations/:organizationId/office-inventory/asset-handoff",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("office_inventory.asset_handoff"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryAssetHandoffBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await handoffOfficeInventoryItemToAsset({
        organizationId: req.membership!.organizationId,
        itemId: parsed.data.itemId,
        storeId: parsed.data.storeId,
        assetCategoryCode: parsed.data.assetCategoryCode,
        assetName: parsed.data.assetName,
        description: parsed.data.description,
        manufacturer: parsed.data.manufacturer,
        model: parsed.data.model,
        serialNumber: parsed.data.serialNumber,
        purchaseDate: parsed.data.purchaseDate ? toIsoDate(parsed.data.purchaseDate) : undefined,
        purchaseCost: parsed.data.purchaseCost,
        purchaseCurrency: parsed.data.purchaseCurrency,
        warrantyExpiryDate: parsed.data.warrantyExpiryDate ? toIsoDate(parsed.data.warrantyExpiryDate) : undefined,
        condition: parsed.data.condition,
        notes: parsed.data.notes,
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
      if (err instanceof OfficeInventoryNotEligibleForHandoffError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryHandoffInsufficientStockError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
