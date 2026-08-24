/**
 * Office Inventory, Workstream 10 — Assets Handoff
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §4 Owner Decision 1). A
 * single, explicit, permission-gated (`office_inventory.asset_handoff`)
 * conversion from Inventory into an individually-identifiable Asset —
 * calling Assets' own existing `createAsset` API directly, never a second
 * asset model. One-directional only; Asset -> Inventory is out of scope.
 *
 * QUANTITY SEMANTICS (disclosed interpretation): the frozen decision text
 * is singular throughout — "A distinct movementType: asset_handoff ledger
 * row... points directly at the newly created assets.id row" (one row, one
 * asset) — and the workstream's own instructions explicitly warn against
 * "one Asset record representing an unexplained bulk quantity." This
 * function therefore converts exactly ONE unit per call, always. Converting
 * N units means N separate calls, each producing its own distinct Asset —
 * the correct shape for "individually identifiable" property, never a loop
 * invented here.
 *
 * SOURCE STATE (disclosed, derived from the schema itself, not invented):
 * `asset_handoff` is a STORE-decreasing movement type only — it is absent
 * from `HOLDER_DECREASING_TYPES` (officeInventoryLedger.ts's own
 * authoritative direction table). A unit currently issued to an employee or
 * department is therefore NOT eligible for direct handoff; it must first be
 * returned to a store through the existing, unmodified return mechanism
 * (Workstream 5) — this function never invents a silent transfer out of
 * holder custody.
 *
 * CLASSIFICATION (disclosed): only `returnable` items are eligible. A
 * `consumable` item is, by definition, consumed on issue — never a durable,
 * individually-trackable candidate for Assets.
 *
 * ATOMICITY / CONCURRENCY: `assets.createAsset` manages its own DB calls on
 * the top-level `db` handle and cannot join a caller-supplied transaction —
 * reused exactly as-is, per the frozen instruction to call it directly
 * rather than refactor it. To still guarantee "exactly one authoritative
 * conversion" under a genuine race, this function acquires the SAME
 * (organizationId, itemId, storeId) advisory lock every other store
 * movement already uses (`acquireStoreLock`), re-validates sufficient
 * balance UNDER that lock, and only THEN calls `createAsset` and appends
 * the ledger row — all before the lock's owning transaction commits. A
 * second concurrent caller blocks on the same lock until the first
 * transaction completes, then re-reads the now-reduced balance and fails
 * BEFORE ever creating an Asset — never an orphan Asset, never a duplicate.
 */
import { and, eq } from "drizzle-orm";
import { db, officeInventoryItemsTable, officeInventoryStoresTable, officeInventoryStockMovementsTable, assetsTable, type OfficeInventoryStockMovement, type Asset } from "@workspace/db";

type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";
import { toMinorUnits } from "./payrollMoney";
import { acquireStoreLock, getStoreBalanceIn, appendStoreMovement } from "./officeInventoryLedger";
import { createAsset } from "./assets";
import { recordAuditEvent } from "./auditLog";
import { OfficeInventoryItemNotFoundError, OfficeInventoryStoreNotFoundError } from "./officeInventoryIssuing";

export { OfficeInventoryItemNotFoundError, OfficeInventoryStoreNotFoundError };

export class OfficeInventoryNotEligibleForHandoffError extends Error {
  constructor() {
    super("Only a returnable item currently held in a store is eligible for Assets handoff");
  }
}
export class OfficeInventoryHandoffInsufficientStockError extends Error {
  constructor(readonly available: string) {
    super(`Insufficient store stock for handoff: ${available} available, 1 unit requested`);
  }
}

export interface HandoffToAssetParams {
  organizationId: number;
  itemId: number;
  storeId: number;
  assetCategoryCode: string;
  assetName?: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string | null;
  purchaseDate?: string;
  purchaseCost?: number;
  purchaseCurrency?: string;
  warrantyExpiryDate?: string;
  condition?: AssetCondition;
  notes?: string;
  idempotencyKey?: string | null;
  actorMembershipId: number;
  actorApplicationUserId: number;
}

export interface HandoffToAssetResult {
  asset: Asset;
  movement: OfficeInventoryStockMovement;
  replay: boolean;
}

const ONE_UNIT = "1.00";

export async function handoffOfficeInventoryItemToAsset(params: HandoffToAssetParams): Promise<HandoffToAssetResult> {
  const [item] = await db.select().from(officeInventoryItemsTable).where(and(eq(officeInventoryItemsTable.id, params.itemId), eq(officeInventoryItemsTable.organizationId, params.organizationId)));
  if (!item) throw new OfficeInventoryItemNotFoundError();
  if (item.classification !== "returnable") throw new OfficeInventoryNotEligibleForHandoffError();

  const [store] = await db.select().from(officeInventoryStoresTable).where(and(eq(officeInventoryStoresTable.id, params.storeId), eq(officeInventoryStoresTable.organizationId, params.organizationId)));
  if (!store) throw new OfficeInventoryStoreNotFoundError();

  if (params.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(officeInventoryStockMovementsTable)
      .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
    if (existing) {
      const [existingAsset] = await db.select().from(assetsTable).where(eq(assetsTable.id, existing.sourceReferenceId!));
      return { asset: existingAsset, movement: existing, replay: true };
    }
  }

  let asset!: Asset;
  let movement!: OfficeInventoryStockMovement;
  let replay = false;

  await db.transaction(async (tx) => {
    // Acquire the exact same advisory-lock domain every other store
    // movement for this (org, item, store) uses — serializes this handoff
    // against a concurrent handoff/issue/adjustment/receipt/stocktake, and
    // critically, against a SECOND concurrent handoff attempt: only the
    // lock-holder may create an Asset for this unit.
    await acquireStoreLock(tx, params.organizationId, params.itemId, params.storeId);

    if (params.idempotencyKey) {
      const [existingUnderLock] = await tx
        .select()
        .from(officeInventoryStockMovementsTable)
        .where(and(eq(officeInventoryStockMovementsTable.organizationId, params.organizationId), eq(officeInventoryStockMovementsTable.idempotencyKey, params.idempotencyKey)));
      if (existingUnderLock) {
        const [existingAsset] = await db.select().from(assetsTable).where(eq(assetsTable.id, existingUnderLock.sourceReferenceId!));
        asset = existingAsset;
        movement = existingUnderLock;
        replay = true;
        return;
      }
    }

    const balance = await getStoreBalanceIn(tx, params.organizationId, params.itemId, params.storeId);
    if (toMinorUnits(balance) < toMinorUnits(ONE_UNIT)) throw new OfficeInventoryHandoffInsufficientStockError(balance);

    // Only now, still holding the lock, is the Asset created — the
    // "smallest legitimate integration point" into Assets' own existing
    // creation API, called exactly as any other Assets caller would.
    asset = await createAsset({
      organizationId: params.organizationId,
      categoryCode: params.assetCategoryCode,
      name: params.assetName ?? item.name,
      description: params.description ?? item.description ?? undefined,
      manufacturer: params.manufacturer,
      model: params.model,
      serialNumber: params.serialNumber,
      branchId: store.branchId ?? undefined,
      purchaseDate: params.purchaseDate,
      purchaseCost: params.purchaseCost,
      purchaseCurrency: params.purchaseCurrency,
      warrantyExpiryDate: params.warrantyExpiryDate,
      condition: params.condition,
      notes: params.notes ?? `Converted from Office Inventory item ${item.itemCode} (${item.name}), store ${store.name}.`,
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
    });

    movement = await appendStoreMovement(tx, {
      organizationId: params.organizationId,
      itemId: params.itemId,
      storeId: params.storeId,
      movementType: "asset_handoff",
      quantity: ONE_UNIT,
      sourceReferenceType: "asset",
      sourceReferenceId: asset.id,
      reason: `Converted to Asset ${asset.assetTag}`,
      idempotencyKey: params.idempotencyKey ?? null,
      actorMembershipId: params.actorMembershipId,
    });
  });

  if (!replay) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "office_inventory_asset_handoff.created",
      targetType: "office_inventory_stock_movement",
      targetId: String(movement.id),
      afterState: { itemId: params.itemId, storeId: params.storeId, quantity: ONE_UNIT, assetId: asset.id, assetTag: asset.assetTag },
    });
  }

  return { asset, movement, replay };
}
