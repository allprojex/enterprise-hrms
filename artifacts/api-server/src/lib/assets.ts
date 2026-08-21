/**
 * Asset Management (Phase 3E, W96 — Asset Register):
 * docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §5/§7/§12/§20/§27's own frozen
 * W96 scope. The organization-owned asset register — create/list/detail/
 * edit, plus exactly the non-custody lifecycle transitions §7 assigns to
 * this workstream (retire/mark-lost/recover/condition-update).
 *
 * SCOPE BOUNDARY (§27's own W96 line: "no assignment/custody logic"):
 * assignment/return/acknowledgement (W97), incident reporting/review (W98/
 * W99's own incident half), maintenance (W100), evidence (W100) are all
 * later workstreams — nothing here creates an asset_assignments,
 * asset_incidents, or asset_maintenance row, and no route here mutates one.
 * `getAssetForCaller`'s own-scope dispatch READS asset_assignments (already
 * existing, always-empty schema from W95) only to satisfy §20's own frozen
 * dual-floor detail-route contract — it never writes to that table.
 *
 * CATEGORY VALIDATION (§4, §5, Owner Decision 8): `categoryCode` is
 * free-text from the already-registered `asset_category` Master Data
 * domain — NOT validated against the domain's item list, explicitly per the
 * frozen plan's own text ("identical precedent to learning_courses.
 * categoryCode"). Because it is a plain string column, not a foreign key,
 * there is no cross-organization "ID" to inject or leak — the value lives
 * entirely within the asset's own already organization-scoped row.
 *
 * SERIAL NUMBER EMPTY-STRING NORMALIZATION: an empty string is treated as
 * "no serial number" (stored as null), never as a literal value — required
 * for W95's own partial unique index (`WHERE serialNumber IS NOT NULL`) to
 * mean what it says; storing `""` as a real value would let every
 * asset-with-no-serial collide with every other one on that same partial
 * index. This is not an invented business rule — it is the only reading
 * consistent with the frozen constraint's own stated intent ("unique per
 * organization only when present").
 *
 * PURCHASE COST / CURRENCY: no pairing requirement — the frozen plan states
 * neither field requires the other (mirrors job_requisitions'
 * salaryRangeMin/Max + salaryCurrency, which are also independently
 * nullable with no cross-field constraint). Reference-only; no
 * depreciation, no valuation, no accounting logic anywhere in this file.
 *
 * CONDITION vs STATUS: kept structurally separate per §7. `condition` is
 * settable at creation and via the dedicated `updateAssetCondition` action
 * (mandatory reason, its own audit event) — NEVER via `updateAsset` (base
 * register-field PATCH), so every condition change carries a reason and an
 * audit trail, mirroring the "meaningful state change gets its own
 * dedicated, reasoned, audited action" discipline this platform already
 * established for Learning's certificate revocation / Performance's HR
 * override.
 *
 * LIFECYCLE (§7, exactly the transitions frozen to W96 — retire/mark-lost/
 * recover/condition-update; maintenance transitions are explicitly W100's):
 *   available/maintenance/lost -> retired   (never from assigned directly)
 *   available/assigned/maintenance -> lost  (closes any active assignment,
 *                                             since that is what this
 *                                             transition itself is defined
 *                                             to do — not a W97 behavior
 *                                             pulled forward, see below)
 *   lost -> available                       (recover)
 * Every transition is an atomic conditional UPDATE guarded by the expected
 * prior status — a concurrent or wrong-state attempt affects zero rows and
 * throws a controlled 409, never a silent double-transition.
 */
import { and, eq, or, ilike, isNull, count } from "drizzle-orm";
import { db, assetsTable, assetAssignmentsTable, branchesTable, type Asset } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { isUniqueViolation } from "./dbErrors";

export { CrossOrganizationReferenceError };

export class AssetNotFoundError extends Error {
  constructor() {
    super("Asset not found");
    this.name = "AssetNotFoundError";
  }
}
export class InvalidAssetError extends Error {}
export class DuplicateAssetTagError extends Error {
  constructor() {
    super("This asset tag is already in use in this organization");
    this.name = "DuplicateAssetTagError";
  }
}
export class DuplicateAssetSerialNumberError extends Error {
  constructor() {
    super("This serial number is already registered in this organization");
    this.name = "DuplicateAssetSerialNumberError";
  }
}
export class AssetLifecycleConflictError extends Error {}

type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";

async function findOwnAsset(organizationId: number, assetId: number): Promise<Asset | null> {
  const [row] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.id, assetId), eq(assetsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** Normalizes an empty-string serial number to null (see file header). Leaves undefined (not supplied) untouched. */
function normalizeSerialNumber(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Server-generated, sequential, per-organization ("AST-00001", ...) — never
 * client-supplied (§6). Computed from the current max suffix for this org,
 * with the actual INSERT's own unique constraint as the real concurrency
 * backstop: `createAsset` retries with the next number if two concurrent
 * creates race for the same tag, rather than trusting this pre-check alone.
 */
async function nextAssetTagCandidate(organizationId: number): Promise<string> {
  const rows = await db
    .select({ assetTag: assetsTable.assetTag })
    .from(assetsTable)
    .where(eq(assetsTable.organizationId, organizationId));
  let max = 0;
  for (const row of rows) {
    const match = /^AST-(\d+)$/.exec(row.assetTag);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `AST-${String(max + 1).padStart(5, "0")}`;
}

export interface ListAssetsFilters {
  organizationId: number;
  status?: string;
  condition?: string;
  categoryCode?: string;
  branchId?: number;
  search?: string;
  page: number;
  pageSize: number;
}
export interface ListAssetsResult {
  items: Asset[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Search is deliberately scoped to exactly the fields §13/§20's own field
 * list treats as the register's own human-facing identifiers — asset tag,
 * name, serial number, manufacturer, model — never full-text infrastructure
 * (no frozen requirement calls for one).
 */
export async function listAssets(filters: ListAssetsFilters): Promise<ListAssetsResult> {
  const conditions = [eq(assetsTable.organizationId, filters.organizationId)];
  if (filters.status != null) conditions.push(eq(assetsTable.status, filters.status as never));
  if (filters.condition != null) conditions.push(eq(assetsTable.condition, filters.condition as never));
  if (filters.categoryCode != null) conditions.push(eq(assetsTable.categoryCode, filters.categoryCode));
  if (filters.branchId != null) conditions.push(eq(assetsTable.branchId, filters.branchId));
  if (filters.search != null && filters.search.trim() !== "") {
    const term = `%${filters.search.trim()}%`;
    conditions.push(
      or(
        ilike(assetsTable.assetTag, term),
        ilike(assetsTable.name, term),
        ilike(assetsTable.serialNumber, term),
        ilike(assetsTable.manufacturer, term),
        ilike(assetsTable.model, term),
      )!,
    );
  }
  const where = and(...conditions);

  const [totalRow] = await db.select({ value: count() }).from(assetsTable).where(where);
  const total = totalRow?.value ?? 0;

  const items = await db
    .select()
    .from(assetsTable)
    .where(where)
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return { items, total, page: filters.page, pageSize: filters.pageSize };
}

export async function getAsset(organizationId: number, assetId: number): Promise<Asset | null> {
  return findOwnAsset(organizationId, assetId);
}

/**
 * §20's own frozen dual-floor for GET .../assets/:id: org-wide
 * (asset_management.manage) OR own-scope reach if the caller currently
 * holds this specific asset. Read-only against asset_assignments — see
 * file header.
 */
export async function callerHasActiveAssignment(organizationId: number, assetId: number, employeeId: number | null): Promise<boolean> {
  if (employeeId == null) return false;
  const [row] = await db
    .select({ id: assetAssignmentsTable.id })
    .from(assetAssignmentsTable)
    .where(
      and(
        eq(assetAssignmentsTable.organizationId, organizationId),
        eq(assetAssignmentsTable.assetId, assetId),
        eq(assetAssignmentsTable.employeeId, employeeId),
        isNull(assetAssignmentsTable.custodyEndedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export interface CreateAssetParams {
  organizationId: number;
  categoryCode: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string | null;
  branchId?: number;
  purchaseDate?: string;
  purchaseCost?: number;
  purchaseCurrency?: string;
  warrantyExpiryDate?: string;
  condition?: AssetCondition;
  notes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function createAsset(params: CreateAssetParams): Promise<Asset> {
  if (params.branchId != null) {
    await assertBelongsToOrganization(branchesTable, params.branchId, params.organizationId, "Branch");
  }
  const serialNumber = normalizeSerialNumber(params.serialNumber);
  if (params.purchaseCost != null && params.purchaseCost < 0) {
    throw new InvalidAssetError("purchaseCost must not be negative");
  }

  // A genuine serial-number duplicate is a user-input conflict, never a
  // tag-generation race — it must be rejected immediately, before the
  // tag-retry loop below, so it can never be mistaken for (or masked by)
  // a tag collision. Checked explicitly here because the generic unique-
  // violation error the INSERT can throw doesn't reliably identify which
  // of the two partial unique indexes (tag vs. serial number) fired.
  if (serialNumber != null) {
    const [existing] = await db
      .select({ id: assetsTable.id })
      .from(assetsTable)
      .where(and(eq(assetsTable.organizationId, params.organizationId), eq(assetsTable.serialNumber, serialNumber)))
      .limit(1);
    if (existing) throw new DuplicateAssetSerialNumberError();
  }

  // The pre-check tag is a best-effort starting point; the retry loop below
  // is the real concurrency guarantee (the DB's own unique index, never
  // trusted-around) — mirrors this platform's own established
  // generate-then-insert-with-retry-on-conflict precedent. Because a
  // serial-number duplicate is already ruled out above, any unique
  // violation the INSERT itself throws here can only be a tag race.
  const MAX_TAG_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_TAG_ATTEMPTS; attempt++) {
    const assetTag = await nextAssetTagCandidate(params.organizationId);
    try {
      const [asset] = await db
        .insert(assetsTable)
        .values({
          organizationId: params.organizationId,
          assetTag,
          categoryCode: params.categoryCode,
          name: params.name,
          description: params.description ?? null,
          manufacturer: params.manufacturer ?? null,
          model: params.model ?? null,
          serialNumber: serialNumber ?? null,
          branchId: params.branchId ?? null,
          purchaseDate: params.purchaseDate ?? null,
          purchaseCost: params.purchaseCost != null ? String(params.purchaseCost) : null,
          purchaseCurrency: params.purchaseCurrency ?? null,
          warrantyExpiryDate: params.warrantyExpiryDate ?? null,
          condition: params.condition ?? "good",
          status: "available",
          notes: params.notes ?? null,
          createdBy: params.actorApplicationUserId,
        })
        .returning();

      await recordAuditEvent({
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
        organizationId: params.organizationId,
        eventType: "asset.created",
        targetType: "asset",
        targetId: String(asset.id),
        afterState: { assetTag: asset.assetTag, name: asset.name, categoryCode: asset.categoryCode, status: asset.status },
      });

      return asset;
    } catch (err) {
      if (isUniqueViolation(err)) {
        continue; // tag race — try the next candidate
      }
      throw err;
    }
  }
  // Exhausted all retries — an extremely unlikely sustained tag race. A
  // controlled 409 (never a raw DB error), matching the same discipline
  // the serial-number duplicate check above already guarantees.
  throw new DuplicateAssetTagError();
}

export interface UpdateAssetParams {
  organizationId: number;
  assetId: number;
  categoryCode?: string;
  name?: string;
  description?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string | null;
  branchId?: number | null;
  purchaseDate?: string | null;
  purchaseCost?: number | null;
  purchaseCurrency?: string | null;
  warrantyExpiryDate?: string | null;
  notes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** Base register fields only — never status, never condition (each has its own dedicated, reasoned, audited action). */
export async function updateAsset(params: UpdateAssetParams): Promise<Asset> {
  const before = await findOwnAsset(params.organizationId, params.assetId);
  if (!before) throw new AssetNotFoundError();

  if (params.branchId !== undefined && params.branchId != null) {
    await assertBelongsToOrganization(branchesTable, params.branchId, params.organizationId, "Branch");
  }
  if (params.purchaseCost != null && params.purchaseCost < 0) {
    throw new InvalidAssetError("purchaseCost must not be negative");
  }

  const patch: Record<string, unknown> = {};
  if (params.categoryCode !== undefined) patch.categoryCode = params.categoryCode;
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.manufacturer !== undefined) patch.manufacturer = params.manufacturer;
  if (params.model !== undefined) patch.model = params.model;
  if (params.serialNumber !== undefined) patch.serialNumber = normalizeSerialNumber(params.serialNumber);
  if (params.branchId !== undefined) patch.branchId = params.branchId;
  if (params.purchaseDate !== undefined) patch.purchaseDate = params.purchaseDate;
  if (params.purchaseCost !== undefined) patch.purchaseCost = params.purchaseCost != null ? String(params.purchaseCost) : null;
  if (params.purchaseCurrency !== undefined) patch.purchaseCurrency = params.purchaseCurrency;
  if (params.warrantyExpiryDate !== undefined) patch.warrantyExpiryDate = params.warrantyExpiryDate;
  if (params.notes !== undefined) patch.notes = params.notes;
  patch.updatedAt = new Date();

  let updated: Asset;
  try {
    [updated] = await db.update(assetsTable).set(patch).where(eq(assetsTable.id, params.assetId)).returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Distinguish which constraint fired isn't possible generically here
      // (the DB error doesn't carry a typed field list this mock/driver
      // exposes) — assetTag is server-generated and never editable via this
      // path (see below), so a unique violation from this specific route
      // can only be the serial-number index.
      throw new DuplicateAssetSerialNumberError();
    }
    throw err;
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.updated",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { name: before.name, categoryCode: before.categoryCode, serialNumber: before.serialNumber },
    afterState: { name: updated.name, categoryCode: updated.categoryCode, serialNumber: updated.serialNumber },
  });

  return updated;
}

export interface RetireAssetParams {
  organizationId: number;
  assetId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** available/maintenance/lost -> retired. Never directly from assigned (§7) — the assign-side custody must close first. Permanently terminal, no reopen anywhere. */
export async function retireAsset(params: RetireAssetParams): Promise<Asset> {
  const existing = await findOwnAsset(params.organizationId, params.assetId);
  if (!existing) throw new AssetNotFoundError();

  const [updated] = await db
    .update(assetsTable)
    .set({ status: "retired", updatedAt: new Date() })
    .where(
      and(
        eq(assetsTable.id, params.assetId),
        eq(assetsTable.organizationId, params.organizationId),
        or(eq(assetsTable.status, "available"), eq(assetsTable.status, "maintenance"), eq(assetsTable.status, "lost"))!,
      ),
    )
    .returning();
  if (!updated) {
    throw new AssetLifecycleConflictError(
      existing.status === "assigned"
        ? "This asset is currently assigned — return it before retiring"
        : "This asset is already retired",
    );
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.retired",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { status: existing.status },
    afterState: { status: "retired" },
    metadata: { reason: params.reason },
  });

  return updated;
}

export interface MarkAssetLostParams {
  organizationId: number;
  assetId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * available/assigned/maintenance -> lost (§7). When the asset currently has
 * an active assignment, that custody period is closed in the same
 * transaction (endReason='lost') — this is what the transition itself is
 * defined to do (§7's own literal text), not W97's assign/return
 * functionality pulled forward: no assignment is ever created here, only
 * an already-open one (if any) is closed, exactly mirroring how "retire"
 * itself never creates rows either.
 */
export async function markAssetLost(params: MarkAssetLostParams): Promise<Asset> {
  const existing = await findOwnAsset(params.organizationId, params.assetId);
  if (!existing) throw new AssetNotFoundError();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(assetsTable)
      .set({ status: "lost", updatedAt: new Date() })
      .where(
        and(
          eq(assetsTable.id, params.assetId),
          eq(assetsTable.organizationId, params.organizationId),
          or(eq(assetsTable.status, "available"), eq(assetsTable.status, "assigned"), eq(assetsTable.status, "maintenance"))!,
        ),
      )
      .returning();
    if (!row) return null;

    if (existing.status === "assigned") {
      await tx
        .update(assetAssignmentsTable)
        .set({ custodyEndedAt: new Date(), endReason: "lost", updatedAt: new Date() })
        .where(
          and(
            eq(assetAssignmentsTable.organizationId, params.organizationId),
            eq(assetAssignmentsTable.assetId, params.assetId),
            isNull(assetAssignmentsTable.custodyEndedAt),
          ),
        );
    }
    return row;
  });

  if (!updated) {
    throw new AssetLifecycleConflictError("This asset is already lost or retired and cannot be marked lost again");
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.marked_lost",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { status: existing.status },
    afterState: { status: "lost" },
    metadata: { reason: params.reason },
  });

  return updated;
}

export interface RecoverAssetParams {
  organizationId: number;
  assetId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** lost -> available only (§7) — an explicit, real, audited, mandatory-reason transition, never a hidden correction path. */
export async function recoverAsset(params: RecoverAssetParams): Promise<Asset> {
  const existing = await findOwnAsset(params.organizationId, params.assetId);
  if (!existing) throw new AssetNotFoundError();

  const [updated] = await db
    .update(assetsTable)
    .set({ status: "available", updatedAt: new Date() })
    .where(and(eq(assetsTable.id, params.assetId), eq(assetsTable.organizationId, params.organizationId), eq(assetsTable.status, "lost")))
    .returning();
  if (!updated) {
    throw new AssetLifecycleConflictError("This asset is not currently marked lost");
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.recovered",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { status: "lost" },
    afterState: { status: "available" },
    metadata: { reason: params.reason },
  });

  return updated;
}

export interface UpdateAssetConditionParams {
  organizationId: number;
  assetId: number;
  condition: AssetCondition;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** Dedicated, mandatory-reason, audited condition change — condition is never editable through the base-field PATCH (§7). */
export async function updateAssetCondition(params: UpdateAssetConditionParams): Promise<Asset> {
  const existing = await findOwnAsset(params.organizationId, params.assetId);
  if (!existing) throw new AssetNotFoundError();

  const [updated] = await db
    .update(assetsTable)
    .set({ condition: params.condition, updatedAt: new Date() })
    .where(and(eq(assetsTable.id, params.assetId), eq(assetsTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.condition_updated",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { condition: existing.condition },
    afterState: { condition: params.condition },
    metadata: { reason: params.reason },
  });

  return updated;
}
