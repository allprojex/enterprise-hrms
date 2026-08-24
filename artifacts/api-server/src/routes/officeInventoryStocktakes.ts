/**
 * Office Inventory, Workstream 7 — Stocktaking routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §28, §29, §47, §50). Every
 * route composes `requireModuleEnabled("office_inventory")` and is gated
 * by the single frozen `office_inventory.stocktake` permission — no new
 * keys, and separate from ordinary stock read (`office_inventory.custody.read`)
 * or the operational adjustment/write-off permissions those resolution
 * actions internally reuse. No generic status-PATCH, no generic ledger
 * writer.
 */
import { Router } from "express";
import { CreateOfficeInventoryStocktakeBody, RecordOfficeInventoryStocktakeCountBody, ResolveOfficeInventoryStocktakeLineBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createStocktake,
  listStocktakes,
  getStocktake,
  listStocktakeLines,
  startStocktake,
  recordCount,
  resolveWithAdjustment,
  resolveWithMissing,
  finalizeStocktake,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryStocktakeNotFoundError,
  OfficeInventoryStocktakeLineNotFoundError,
  OfficeInventoryStocktakeInvalidStateError,
  OfficeInventoryInvalidCountError,
  OfficeInventoryNotYetCountedError,
  OfficeInventoryNoVarianceError,
  OfficeInventoryMissingResolutionRequiresShortageError,
  OfficeInventoryStocktakeIncompleteError,
} from "../lib/officeInventoryStocktakes";
import { OfficeInventoryReasonRequiredError } from "../lib/officeInventoryDisposition";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// POST /organizations/:organizationId/office-inventory/stocktakes
router.post(
  "/organizations/:organizationId/office-inventory/stocktakes",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryStocktakeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const stocktake = await createStocktake({
        organizationId: req.membership!.organizationId,
        storeId: parsed.data.storeId,
        notes: parsed.data.notes,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(stocktake);
    } catch (err) {
      if (err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/stocktakes
router.get(
  "/organizations/:organizationId/office-inventory/stocktakes",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const storeId = typeof req.query.storeId === "string" ? parseInt(req.query.storeId, 10) : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as "draft" | "counting" | "finalized") : undefined;
    const stocktakes = await listStocktakes(req.membership!.organizationId, { storeId, status });
    res.json(stocktakes);
  },
);

// GET /organizations/:organizationId/office-inventory/stocktakes/:id
router.get(
  "/organizations/:organizationId/office-inventory/stocktakes/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stocktakeId = parseId(req.params.id);
    if (isNaN(stocktakeId)) {
      res.status(400).json({ error: "Invalid stocktake ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const stocktake = await getStocktake(organizationId, stocktakeId);
    if (!stocktake) {
      res.status(404).json({ error: "Stocktake not found" });
      return;
    }
    const lines = await listStocktakeLines(organizationId, stocktakeId);
    res.json({ stocktake, lines });
  },
);

// POST /organizations/:organizationId/office-inventory/stocktakes/:id/start
router.post(
  "/organizations/:organizationId/office-inventory/stocktakes/:id/start",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stocktakeId = parseId(req.params.id);
    if (isNaN(stocktakeId)) {
      res.status(400).json({ error: "Invalid stocktake ID" });
      return;
    }
    try {
      const stocktake = await startStocktake({
        organizationId: req.membership!.organizationId,
        stocktakeId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(stocktake);
    } catch (err) {
      if (err instanceof OfficeInventoryStocktakeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryStocktakeInvalidStateError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/stocktakes/:id/lines/:lineId/count
router.post(
  "/organizations/:organizationId/office-inventory/stocktakes/:id/lines/:lineId/count",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stocktakeId = parseId(req.params.id);
    const lineId = parseId(req.params.lineId);
    if (isNaN(stocktakeId) || isNaN(lineId)) {
      res.status(400).json({ error: "Invalid stocktake or line ID" });
      return;
    }
    const parsed = RecordOfficeInventoryStocktakeCountBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const line = await recordCount({
        organizationId: req.membership!.organizationId,
        stocktakeId,
        lineId,
        countedQuantity: parsed.data.countedQuantity,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(line);
    } catch (err) {
      if (err instanceof OfficeInventoryStocktakeNotFoundError || err instanceof OfficeInventoryStocktakeLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryInvalidCountError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryStocktakeInvalidStateError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/stocktakes/:id/lines/:lineId/resolve
router.post(
  "/organizations/:organizationId/office-inventory/stocktakes/:id/lines/:lineId/resolve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stocktakeId = parseId(req.params.id);
    const lineId = parseId(req.params.lineId);
    if (isNaN(stocktakeId) || isNaN(lineId)) {
      res.status(400).json({ error: "Invalid stocktake or line ID" });
      return;
    }
    const parsed = ResolveOfficeInventoryStocktakeLineBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const params = {
        organizationId: req.membership!.organizationId,
        stocktakeId,
        lineId,
        reason: parsed.data.reason,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      };
      const line = parsed.data.resolutionType === "adjustment" ? await resolveWithAdjustment(params) : await resolveWithMissing(params);
      res.status(201).json(line);
    } catch (err) {
      if (err instanceof OfficeInventoryStocktakeNotFoundError || err instanceof OfficeInventoryStocktakeLineNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryNotYetCountedError || err instanceof OfficeInventoryMissingResolutionRequiresShortageError || err instanceof OfficeInventoryReasonRequiredError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryStocktakeInvalidStateError || err instanceof OfficeInventoryNoVarianceError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/office-inventory/stocktakes/:id/finalize
router.post(
  "/organizations/:organizationId/office-inventory/stocktakes/:id/finalize",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.stocktake"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stocktakeId = parseId(req.params.id);
    if (isNaN(stocktakeId)) {
      res.status(400).json({ error: "Invalid stocktake ID" });
      return;
    }
    try {
      const stocktake = await finalizeStocktake({
        organizationId: req.membership!.organizationId,
        stocktakeId,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(stocktake);
    } catch (err) {
      if (err instanceof OfficeInventoryStocktakeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfficeInventoryStocktakeIncompleteError) {
        res.status(409).json({ error: err.message, blockingLines: err.blockingLines });
        return;
      }
      if (err instanceof OfficeInventoryStocktakeInvalidStateError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
