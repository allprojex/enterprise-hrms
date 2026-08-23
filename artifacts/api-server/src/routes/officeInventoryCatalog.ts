/**
 * Office Inventory, Workstream 1 — Item & Store catalog routes
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.1, §7.2). Every route is
 * gated by requireModuleEnabled("office_inventory") — unlike Department
 * Head routes, this is genuinely Inventory-specific.
 */
import { Router } from "express";
import { CreateOfficeInventoryItemBody, UpdateOfficeInventoryItemBody, CreateOfficeInventoryStoreBody, UpdateOfficeInventoryStoreBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import {
  createOfficeInventoryItem,
  updateOfficeInventoryItem,
  listOfficeInventoryItems,
  getOfficeInventoryItem,
  createOfficeInventoryStore,
  updateOfficeInventoryStore,
  listOfficeInventoryStores,
  getOfficeInventoryStore,
  OfficeInventoryItemNotFoundError,
  OfficeInventoryStoreNotFoundError,
  OfficeInventoryStoreCodeCollisionError,
  OfficeInventoryItemCodeGenerationError,
} from "../lib/officeInventoryCatalog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/office-inventory/items
router.get(
  "/organizations/:organizationId/office-inventory/items",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.item.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const items = await listOfficeInventoryItems(req.membership!.organizationId);
    res.json(items);
  },
);

// POST /organizations/:organizationId/office-inventory/items
router.post(
  "/organizations/:organizationId/office-inventory/items",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.item.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const item = await createOfficeInventoryItem({
        organizationId: req.membership!.organizationId,
        ...parsed.data,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof OfficeInventoryItemCodeGenerationError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/items/:id
router.get(
  "/organizations/:organizationId/office-inventory/items/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.item.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid item ID" });
      return;
    }
    try {
      const item = await getOfficeInventoryItem(req.membership!.organizationId, id);
      res.json(item);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/office-inventory/items/:id
router.patch(
  "/organizations/:organizationId/office-inventory/items/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.item.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid item ID" });
      return;
    }
    const parsed = UpdateOfficeInventoryItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const item = await updateOfficeInventoryItem({
        organizationId: req.membership!.organizationId,
        itemId: id,
        ...parsed.data,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(item);
    } catch (err) {
      if (err instanceof OfficeInventoryItemNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/stores
router.get(
  "/organizations/:organizationId/office-inventory/stores",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.store.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stores = await listOfficeInventoryStores(req.membership!.organizationId);
    res.json(stores);
  },
);

// POST /organizations/:organizationId/office-inventory/stores
router.post(
  "/organizations/:organizationId/office-inventory/stores",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.store.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOfficeInventoryStoreBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const store = await createOfficeInventoryStore({
        organizationId: req.membership!.organizationId,
        ...parsed.data,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.status(201).json(store);
    } catch (err) {
      if (err instanceof OfficeInventoryStoreCodeCollisionError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/office-inventory/stores/:id
router.get(
  "/organizations/:organizationId/office-inventory/stores/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.store.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid store ID" });
      return;
    }
    try {
      const store = await getOfficeInventoryStore(req.membership!.organizationId, id);
      res.json(store);
    } catch (err) {
      if (err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/office-inventory/stores/:id
router.patch(
  "/organizations/:organizationId/office-inventory/stores/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("office_inventory"),
  requirePermission("office_inventory.store.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid store ID" });
      return;
    }
    const parsed = UpdateOfficeInventoryStoreBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const store = await updateOfficeInventoryStore({
        organizationId: req.membership!.organizationId,
        storeId: id,
        ...parsed.data,
        actorMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
      });
      res.json(store);
    } catch (err) {
      if (err instanceof OfficeInventoryStoreNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
