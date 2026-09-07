/**
 * Office Inventory, Workstream 1 — Item Catalog & Store Foundation
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §7.1, §7.2). No stock
 * ledger, no quantity, no receiving/request/issue logic exists here or
 * anywhere yet — this file owns only the catalog (item type definitions) and
 * store (location) registries, both of which are referenced-but-not-yet-
 * consumed by every later workstream.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  officeInventoryItemsTable,
  officeInventoryStoresTable,
  type OfficeInventoryItem,
  type OfficeInventoryStore,
} from "@workspace/db";
import { getNamespaceConfig } from "../services/organizationConfig";
// Reuses numbering.ts's own generic counter/format primitives directly —
// `EmployeeNumberFormatConfig`'s shape (prefix/suffix/separator/
// sequenceLength/startingSequence/branch+department tokens/resetPolicy) is
// identical to what an item-code format needs, so it is imported and
// aliased here rather than duplicated as a second, structurally-identical
// type.
import { lockAndIncrementSequence, resolvePeriodKey, formatGeneratedNumber, type EmployeeNumberFormatConfig as ItemNumberFormatConfig } from "./numbering";
import { isUniqueViolation } from "./dbErrors";
import { recordAuditEvent } from "./auditLog";

export class OfficeInventoryItemNotFoundError extends Error {
  constructor() {
    super("Office Inventory item not found");
  }
}
export class OfficeInventoryStoreNotFoundError extends Error {
  constructor() {
    super("Office Inventory store not found");
  }
}
export class OfficeInventoryStoreCodeCollisionError extends Error {
  constructor() {
    super("A store with this code already exists for this organization");
  }
}
export class OfficeInventoryItemCodeGenerationError extends Error {
  constructor() {
    super("Could not generate a unique item code after several attempts");
  }
}

const ITEM_NUMBER_SEQUENCE_KEY = "office_inventory_item";
const MAX_ITEM_CODE_ATTEMPTS = 20;

async function getItemNumberConfig(organizationId: number): Promise<ItemNumberFormatConfig> {
  const config = await getNamespaceConfig(organizationId, "office_inventory");
  return (config.data.itemNumber as ItemNumberFormatConfig | undefined) ?? {};
}

// --- Items ---

export interface CreateOfficeInventoryItemParams {
  organizationId: number;
  name: string;
  description?: string | null;
  categoryCode: string;
  unitOfMeasure: string;
  classification: "consumable" | "returnable";
  reorderLevel?: string | null;
  unitCost?: string | null;
  currency?: string | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

/**
 * Item codes are always server-generated (never client-supplied), permanent,
 * and never released or reused (Owner Decision 20) — reusing the exact
 * generation/retry-on-collision primitive numbering.ts already proves for
 * employee numbers, with a new, independent `office_inventory_item`
 * sequenceKey. No branch/department tokens are used for item codes.
 */
export async function createOfficeInventoryItem(params: CreateOfficeInventoryItemParams): Promise<OfficeInventoryItem> {
  const config = await getItemNumberConfig(params.organizationId);
  const periodKey = resolvePeriodKey(config.resetPolicy, new Date());

  for (let attempt = 1; attempt <= MAX_ITEM_CODE_ATTEMPTS; attempt++) {
    const sequenceValue = await lockAndIncrementSequence({
      organizationId: params.organizationId,
      sequenceKey: ITEM_NUMBER_SEQUENCE_KEY,
      periodKey,
      startingSequence: config.startingSequence ?? 1,
    });
    const now = new Date();
    const itemCode = formatGeneratedNumber(config, sequenceValue, { branchCode: null, departmentCode: null, year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });

    try {
      const [created] = await db
        .insert(officeInventoryItemsTable)
        .values({
          organizationId: params.organizationId,
          itemCode,
          name: params.name,
          description: params.description ?? null,
          categoryCode: params.categoryCode,
          unitOfMeasure: params.unitOfMeasure,
          classification: params.classification,
          reorderLevel: params.reorderLevel ?? null,
          unitCost: params.unitCost ?? null,
          currency: params.currency ?? null,
          createdByMembershipId: params.actorMembershipId,
        })
        .returning();

      await recordAuditEvent({
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
        organizationId: params.organizationId,
        eventType: "office_inventory_item.created",
        targetType: "office_inventory_item",
        targetId: String(created.id),
        afterState: { itemCode: created.itemCode, name: created.name, classification: created.classification },
      });

      return created;
    } catch (err) {
      if (isUniqueViolation(err)) {
        if (attempt < MAX_ITEM_CODE_ATTEMPTS) continue;
        throw new OfficeInventoryItemCodeGenerationError();
      }
      throw err;
    }
  }
  throw new OfficeInventoryItemCodeGenerationError();
}

export interface UpdateOfficeInventoryItemParams {
  organizationId: number;
  itemId: number;
  name?: string;
  description?: string | null;
  categoryCode?: string;
  unitOfMeasure?: string;
  reorderLevel?: string | null;
  unitCost?: string | null;
  currency?: string | null;
  status?: "active" | "inactive";
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

/** Never accepts itemCode or classification — itemCode is permanent (§7.1); classification is fixed at creation to avoid silently reclassifying historical movements once a later workstream introduces them. */
export async function updateOfficeInventoryItem(params: UpdateOfficeInventoryItemParams): Promise<OfficeInventoryItem> {
  const [before] = await db
    .select()
    .from(officeInventoryItemsTable)
    .where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!before) throw new OfficeInventoryItemNotFoundError();

  const patch: Partial<typeof officeInventoryItemsTable.$inferInsert> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.categoryCode !== undefined) patch.categoryCode = params.categoryCode;
  if (params.unitOfMeasure !== undefined) patch.unitOfMeasure = params.unitOfMeasure;
  if (params.reorderLevel !== undefined) patch.reorderLevel = params.reorderLevel;
  if (params.unitCost !== undefined) patch.unitCost = params.unitCost;
  if (params.currency !== undefined) patch.currency = params.currency;
  if (params.status !== undefined) patch.status = params.status;

  const [updated] = await db.update(officeInventoryItemsTable).set(patch).where(eq(officeInventoryItemsTable.id, params.itemId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_item.updated",
    targetType: "office_inventory_item",
    targetId: String(params.itemId),
    beforeState: { name: before.name, categoryCode: before.categoryCode, status: before.status },
    afterState: { name: updated.name, categoryCode: updated.categoryCode, status: updated.status },
  });

  return updated;
}

export async function listOfficeInventoryItems(organizationId: number): Promise<OfficeInventoryItem[]> {
  return db.select().from(officeInventoryItemsTable).where(eq(officeInventoryItemsTable.organizationId, organizationId)).orderBy(officeInventoryItemsTable.name);
}

/**
 * WWM Employee Access Remediation (2026-09-07): what a REQUESTER may see of
 * the catalogue — just enough to name what they are asking for. Active
 * items only, and only display identity (no unit cost, currency, reorder
 * level, status management or ids of anything else). Gated
 * office_inventory.request at the route; the full catalogue (GET
 * .../office-inventory/items) stays office_inventory.item.manage.
 */
export interface OfficeInventoryRequestableItem {
  id: number;
  itemCode: string;
  name: string;
  unitOfMeasure: string;
  classification: OfficeInventoryItem["classification"];
}

export async function listRequestableOfficeInventoryItems(organizationId: number): Promise<OfficeInventoryRequestableItem[]> {
  const rows = await db
    .select({
      id: officeInventoryItemsTable.id,
      itemCode: officeInventoryItemsTable.itemCode,
      name: officeInventoryItemsTable.name,
      unitOfMeasure: officeInventoryItemsTable.unitOfMeasure,
      classification: officeInventoryItemsTable.classification,
    })
    .from(officeInventoryItemsTable)
    .where(and(eq(officeInventoryItemsTable.organizationId, organizationId), eq(officeInventoryItemsTable.status, "active")))
    .orderBy(officeInventoryItemsTable.name);
  // Explicit projection on top of the column selection: the wire shape is
  // the contract, whatever the row source hands back.
  return rows.map((r) => ({ id: r.id, itemCode: r.itemCode, name: r.name, unitOfMeasure: r.unitOfMeasure, classification: r.classification }));
}

export async function getOfficeInventoryItem(organizationId: number, itemId: number): Promise<OfficeInventoryItem> {
  const [row] = await db
    .select()
    .from(officeInventoryItemsTable)
    .where(and(eq(officeInventoryItemsTable.id, itemId), eq(officeInventoryItemsTable.organizationId, organizationId)));
  if (!row) throw new OfficeInventoryItemNotFoundError();
  return row;
}

// --- Stores ---

export interface CreateOfficeInventoryStoreParams {
  organizationId: number;
  name: string;
  code: string;
  branchId?: number | null;
  responsibleMembershipId?: number | null;
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

export async function createOfficeInventoryStore(params: CreateOfficeInventoryStoreParams): Promise<OfficeInventoryStore> {
  try {
    const [created] = await db
      .insert(officeInventoryStoresTable)
      .values({
        organizationId: params.organizationId,
        name: params.name,
        code: params.code,
        branchId: params.branchId ?? null,
        responsibleMembershipId: params.responsibleMembershipId ?? null,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_store.created",
      targetType: "office_inventory_store",
      targetId: String(created.id),
      afterState: { code: created.code, name: created.name },
    });

    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new OfficeInventoryStoreCodeCollisionError();
    throw err;
  }
}

export interface UpdateOfficeInventoryStoreParams {
  organizationId: number;
  storeId: number;
  name?: string;
  branchId?: number | null;
  responsibleMembershipId?: number | null;
  status?: "active" | "inactive";
  actorMembershipId: number | null;
  actorApplicationUserId: number | null;
}

/** Never accepts `code` — the store's stable, permanent identity (§7.2). */
export async function updateOfficeInventoryStore(params: UpdateOfficeInventoryStoreParams): Promise<OfficeInventoryStore> {
  const [before] = await db
    .select()
    .from(officeInventoryStoresTable)
    .where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!before) throw new OfficeInventoryStoreNotFoundError();

  const patch: Partial<typeof officeInventoryStoresTable.$inferInsert> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.branchId !== undefined) patch.branchId = params.branchId;
  if (params.responsibleMembershipId !== undefined) patch.responsibleMembershipId = params.responsibleMembershipId;
  if (params.status !== undefined) patch.status = params.status;

  const [updated] = await db.update(officeInventoryStoresTable).set(patch).where(eq(officeInventoryStoresTable.id, params.storeId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_store.updated",
    targetType: "office_inventory_store",
    targetId: String(params.storeId),
    beforeState: { name: before.name, status: before.status },
    afterState: { name: updated.name, status: updated.status },
  });

  return updated;
}

export async function listOfficeInventoryStores(organizationId: number): Promise<OfficeInventoryStore[]> {
  return db.select().from(officeInventoryStoresTable).where(eq(officeInventoryStoresTable.organizationId, organizationId)).orderBy(officeInventoryStoresTable.name);
}

export async function getOfficeInventoryStore(organizationId: number, storeId: number): Promise<OfficeInventoryStore> {
  const [row] = await db
    .select()
    .from(officeInventoryStoresTable)
    .where(and(eq(officeInventoryStoresTable.id, storeId), eq(officeInventoryStoresTable.organizationId, organizationId)));
  if (!row) throw new OfficeInventoryStoreNotFoundError();
  return row;
}
