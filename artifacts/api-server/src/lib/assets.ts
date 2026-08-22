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
import { and, eq, or, ilike, isNull, count, desc, inArray } from "drizzle-orm";
import {
  db,
  assetsTable,
  assetAssignmentsTable,
  assetIncidentsTable,
  assetMaintenanceTable,
  assetEvidenceTable,
  employeeDocumentsTable,
  branchesTable,
  employeesTable,
  type Asset,
  type AssetAssignment,
  type AssetIncident,
  type AssetMaintenance,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { isUniqueViolation } from "./dbErrors";
import { writeOrgFile, deleteOrgFile } from "./fileStorage";
import { validateDocumentUpload, InvalidDocumentError } from "./documentValidation";

export { CrossOrganizationReferenceError, InvalidDocumentError };

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
export class AssetAssignmentNotFoundError extends Error {
  constructor() {
    super("Asset assignment not found");
    this.name = "AssetAssignmentNotFoundError";
  }
}
export class AssetAssignmentConflictError extends Error {}
export class AssetNotCurrentlyAssignedToCallerError extends Error {
  constructor() {
    super("You may only report an issue on an asset currently assigned to you");
    this.name = "AssetNotCurrentlyAssignedToCallerError";
  }
}
export class AssetIncidentNotFoundError extends Error {
  constructor() {
    super("Asset incident not found");
    this.name = "AssetIncidentNotFoundError";
  }
}
export class AssetIncidentConflictError extends Error {}
export class AssetMaintenanceNotFoundError extends Error {
  constructor() {
    super("Asset maintenance record not found");
    this.name = "AssetMaintenanceNotFoundError";
  }
}
export class AssetMaintenanceConflictError extends Error {}
export class AssetEvidenceNotFoundError extends Error {
  constructor() {
    super("Asset evidence not found");
    this.name = "AssetEvidenceNotFoundError";
  }
}

type AssetCondition = "new" | "good" | "fair" | "poor" | "damaged";

async function findOwnAsset(organizationId: number, assetId: number): Promise<Asset | null> {
  const [row] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.id, assetId), eq(assetsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** Fetches the full employee row (for snapshot capture), scoped to the organization — never trusts a client-supplied employeeId across tenants. */
async function findOrgEmployee(
  organizationId: number,
  employeeId: number,
): Promise<{ id: number; departmentId: number | null; positionId: number | null } | null> {
  const [row] = await db
    .select({ id: employeesTable.id, organizationId: employeesTable.organizationId, departmentId: employeesTable.departmentId, positionId: employeesTable.positionId })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId))
    .limit(1);
  if (!row || row.organizationId !== organizationId) return null;
  return row;
}

async function findOrgAssignment(organizationId: number, assignmentId: number): Promise<AssetAssignment | null> {
  const [row] = await db
    .select()
    .from(assetAssignmentsTable)
    .where(and(eq(assetAssignmentsTable.id, assignmentId), eq(assetAssignmentsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOrgIncident(organizationId: number, incidentId: number): Promise<AssetIncident | null> {
  const [row] = await db
    .select()
    .from(assetIncidentsTable)
    .where(and(eq(assetIncidentsTable.id, incidentId), eq(assetIncidentsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOrgMaintenance(organizationId: number, maintenanceId: number): Promise<AssetMaintenance | null> {
  const [row] = await db
    .select()
    .from(assetMaintenanceTable)
    .where(and(eq(assetMaintenanceTable.id, maintenanceId), eq(assetMaintenanceTable.organizationId, organizationId)))
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

/**
 * ============================================================================
 * Asset Management (Phase 3E, W97 — Assignment, Custody, Return &
 * Acknowledgement): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §8/§9/§14/
 * §20/§24's own frozen W97 scope. `asset_assignments` business logic —
 * issue/return, snapshot capture at issue, the acknowledgement route. The
 * dedicated `asset_assignments` history table (W95) remains the sole
 * custody source of truth — no mutable `assets.employeeId` pointer exists or
 * is ever added; a transfer always closes the old row and creates a new one,
 * never rewriting a historical row's own employeeId (§8).
 *
 * SCOPE BOUNDARY (§24's own W97 line): no incident reporting (W98/W99), no
 * maintenance (W100), no evidence (W100), no ESS/manager self-service
 * surfaces, no acknowledgement UI control (§24's own W97 frontend-impact
 * line: "the acknowledgement control itself ships in W98 alongside the ESS
 * surface that renders it — this workstream ships the route, not the
 * employee-facing control"). `my-assets`/`team-assets`/`report-issue` are
 * NOT built here — they belong to the "Employee own assets / manager team
 * view" API group, which §24 assigns to W98, not to W97's own "Assignments"
 * group.
 *
 * MAINTENANCE-ROUTING DISCLOSURE: §9's own text says return is "assigned →
 * available, or → maintenance in the same call if return notes indicate a
 * service need." This is not implemented — the parenthetical names no
 * concrete request field or mechanism (no literal free-text parsing exists
 * anywhere on this platform), W97's own §24 scope line never mentions
 * maintenance, and no maintenance route/table logic is wired yet (W100).
 * Per this workstream's own explicit instruction not to invent a
 * caller-selectable resulting status unless the frozen plan unambiguously
 * allows it, `returnAsset` here only ever performs the unambiguous
 * `assigned → available` transition. The separate `assigned → maintenance`
 * transition (§7 — custody stays OPEN, a recall for service, not a return at
 * all) is also not built here, for the same reason and because it is not a
 * custody-closing action in the first place.
 *
 * SNAPSHOTS (§14): `assetTagSnapshot`/`assetNameSnapshot`/`categorySnapshot`/
 * `departmentIdSnapshot`/`positionIdSnapshot` are captured ONCE at issue
 * time from the asset's and employee's own current server-side rows —
 * never client-supplied, never re-derived or rewritten by a later
 * asset/employee/department/position edit. `employeeId` itself is a LIVE
 * reference (§14) — current identity, needed for manager-scope resolution
 * elsewhere; this is why closing/re-issuing custody always creates a new
 * row rather than mutating the employeeId of an existing one (§7's own
 * "assignment lifecycle" — a closed row is never reopened).
 *
 * CONCURRENCY (§23): every mutation here is an atomic conditional UPDATE (or
 * an UPDATE nested with an INSERT inside one `db.transaction`), guarded by
 * the expected prior state — never a pre-check trusted alone. The
 * `asset_assignments_one_active_per_asset` partial unique index (W95) is
 * the final database-level backstop for "one active assignment per asset,"
 * independent of and in addition to the `assets.status='available'` guard
 * on assignment.
 *
 * ACKNOWLEDGEMENT (§9, Owner Decision 1): `asset_management.write.own`
 * authorizes exactly this action (and, later, W98's own report-issue) and
 * nothing else — never asset status, condition, custody, assignment, or
 * return, under any circumstance (§15's own explicit, permanent invariant).
 * Identity is always server-resolved from the caller's own linked employee
 * record, never client-supplied. A non-owner attempting to acknowledge
 * someone else's assignment receives the same 404 as a nonexistent
 * assignment id — never a distinguishing signal that would leak existence.
 * ============================================================================
 */

export interface AssignAssetParams {
  organizationId: number;
  assetId: number;
  employeeId: number;
  issueCondition?: AssetCondition;
  expectedReturnDate?: string;
  issueNotes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * available -> assigned (§7, §9). Atomic — the conditional status UPDATE and
 * the new asset_assignments INSERT happen in one transaction, mirroring
 * Learning's own W90 certificate-issuance-inside-completion transaction
 * shape (completeEnrollment, lib/learningEnrollments.ts). The status UPDATE's
 * own `WHERE status = 'available'` guard is the primary race protection;
 * the partial unique index is the final database-level backstop if that
 * guard is ever somehow bypassed.
 */
export async function assignAsset(params: AssignAssetParams): Promise<Asset> {
  const existingAsset = await findOwnAsset(params.organizationId, params.assetId);
  if (!existingAsset) throw new AssetNotFoundError();

  const employee = await findOrgEmployee(params.organizationId, params.employeeId);
  if (!employee) throw new CrossOrganizationReferenceError("Employee");

  let assignment: AssetAssignment | undefined;
  const updatedAsset = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(assetsTable)
      .set({ status: "assigned", updatedAt: new Date() })
      .where(and(eq(assetsTable.id, params.assetId), eq(assetsTable.organizationId, params.organizationId), eq(assetsTable.status, "available")))
      .returning();
    if (!row) return null;

    try {
      const [inserted] = await tx
        .insert(assetAssignmentsTable)
        .values({
          organizationId: params.organizationId,
          assetId: params.assetId,
          employeeId: params.employeeId,
          assetTagSnapshot: existingAsset.assetTag,
          assetNameSnapshot: existingAsset.name,
          categorySnapshot: existingAsset.categoryCode,
          departmentIdSnapshot: employee.departmentId,
          positionIdSnapshot: employee.positionId,
          issuedAt: new Date(),
          issuedByMembershipId: params.actorMembershipId,
          expectedReturnDate: params.expectedReturnDate ?? null,
          issueCondition: params.issueCondition ?? existingAsset.condition,
          issueNotes: params.issueNotes ?? null,
          acknowledgedAt: null,
          acknowledgementNote: null,
          custodyEndedAt: null,
          endReason: null,
          receivedByMembershipId: null,
          returnCondition: null,
          returnNotes: null,
        })
        .returning();
      assignment = inserted;
    } catch (err) {
      // Defense-in-depth: the status='available' guard above is the primary
      // race protection, but if the one-active-assignment partial unique
      // index (W95) is ever the one that actually fires, it must still
      // surface as a controlled conflict, never a raw DB error.
      if (isUniqueViolation(err)) throw new AssetLifecycleConflictError("This asset already has an active assignment");
      throw err;
    }

    return row;
  });

  if (!updatedAsset) {
    throw new AssetLifecycleConflictError("This asset is not currently available for assignment");
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.assigned",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { status: existingAsset.status },
    afterState: { status: "assigned" },
    metadata: { employeeId: params.employeeId, assignmentId: assignment?.id },
  });

  return updatedAsset;
}

export interface ReturnAssetParams {
  organizationId: number;
  assetId: number;
  returnCondition?: AssetCondition;
  returnNotes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * assigned -> available (§7, §9) only — see the file header's own
 * maintenance-routing disclosure for what is deliberately NOT implemented
 * here. Closes the active assignment row (custodyEndedAt, endReason=
 * 'returned', receivedByMembershipId, returnCondition/returnNotes) and
 * atomically flips the asset back to available, one transaction. The
 * assignment-closing UPDATE's own `WHERE ... custodyEndedAt IS NULL` guard
 * is what makes a second concurrent return call affect zero rows and 409,
 * identical discipline to markAssetLost's own existing closing pattern.
 */
export async function returnAsset(params: ReturnAssetParams): Promise<Asset> {
  const existingAsset = await findOwnAsset(params.organizationId, params.assetId);
  if (!existingAsset) throw new AssetNotFoundError();

  const updatedAsset = await db.transaction(async (tx) => {
    const [closedAssignment] = await tx
      .update(assetAssignmentsTable)
      .set({
        custodyEndedAt: new Date(),
        endReason: "returned",
        receivedByMembershipId: params.actorMembershipId,
        returnCondition: params.returnCondition ?? null,
        returnNotes: params.returnNotes ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(assetAssignmentsTable.assetId, params.assetId),
          eq(assetAssignmentsTable.organizationId, params.organizationId),
          isNull(assetAssignmentsTable.custodyEndedAt),
        ),
      )
      .returning();
    if (!closedAssignment) return null;

    const [row] = await tx
      .update(assetsTable)
      .set({ status: "available", updatedAt: new Date() })
      .where(and(eq(assetsTable.id, params.assetId), eq(assetsTable.organizationId, params.organizationId), eq(assetsTable.status, "assigned")))
      .returning();
    // Defensive only — status='assigned' and an open assignment row are
    // always mutated together by every transition in this file, so this
    // should never actually diverge; still guarded rather than assumed.
    if (!row) throw new AssetLifecycleConflictError("This asset's status is inconsistent with its custody state");

    return row;
  });

  if (!updatedAsset) {
    throw new AssetLifecycleConflictError("This asset has no active assignment to return");
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset.returned",
    targetType: "asset",
    targetId: String(params.assetId),
    beforeState: { status: "assigned" },
    afterState: { status: "available" },
  });

  return updatedAsset;
}

export interface AcknowledgeAssetAssignmentParams {
  organizationId: number;
  assignmentId: number;
  employeeId: number;
  acknowledgementNote?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * Decision 1, §9: sets acknowledgedAt (server-generated) on the caller's own
 * currently-open assignment. A non-owner gets the identical 404 a
 * nonexistent id would (never leaks existence, §12). Atomic conditional
 * UPDATE guarded by `employeeId=:caller AND custodyEndedAt IS NULL AND
 * acknowledgedAt IS NULL` — a repeat or concurrent call affects 0 rows and
 * 409s. acknowledgedAt is never cleared by a later return (§9's own "after
 * return" rule) — nothing here or in returnAsset ever touches it once set.
 */
export async function acknowledgeAssetAssignment(params: AcknowledgeAssetAssignmentParams): Promise<AssetAssignment> {
  const existing = await findOrgAssignment(params.organizationId, params.assignmentId);
  if (!existing || existing.employeeId !== params.employeeId) {
    throw new AssetAssignmentNotFoundError();
  }

  const [updated] = await db
    .update(assetAssignmentsTable)
    .set({ acknowledgedAt: new Date(), acknowledgementNote: params.acknowledgementNote ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(assetAssignmentsTable.id, params.assignmentId),
        eq(assetAssignmentsTable.organizationId, params.organizationId),
        eq(assetAssignmentsTable.employeeId, params.employeeId),
        isNull(assetAssignmentsTable.custodyEndedAt),
        isNull(assetAssignmentsTable.acknowledgedAt),
      ),
    )
    .returning();

  if (!updated) {
    throw new AssetAssignmentConflictError("This assignment has already been acknowledged or is no longer open");
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset_assignment.acknowledged",
    targetType: "asset_assignment",
    targetId: String(params.assignmentId),
    metadata: { assetId: existing.assetId },
  });

  return updated;
}

export type AssetAssignmentVisibilityScope = "organization_wide" | "own";

export interface ListAssetAssignmentsParams {
  organizationId: number;
  assetId: number;
  scope: AssetAssignmentVisibilityScope;
  callerEmployeeId?: number | null;
}

/**
 * GET .../assets/:id/assignments (§20): org-wide reach returns this asset's
 * full custody history; own-scope returns only the caller's own rows for
 * this asset (current + historical) — never another employee's rows, and no
 * manager tier exists for this specific route (Decision 3's own
 * current-only manager reach is a separate dedicated route, `team-assets`,
 * explicitly owned by W98, not this one). Read-only, never audited.
 */
export async function listAssetAssignments(params: ListAssetAssignmentsParams): Promise<AssetAssignment[]> {
  const conditions = [eq(assetAssignmentsTable.assetId, params.assetId), eq(assetAssignmentsTable.organizationId, params.organizationId)];
  if (params.scope === "own") {
    if (params.callerEmployeeId == null) return [];
    conditions.push(eq(assetAssignmentsTable.employeeId, params.callerEmployeeId));
  }
  return db
    .select()
    .from(assetAssignmentsTable)
    .where(and(...conditions))
    .orderBy(desc(assetAssignmentsTable.issuedAt));
}

/**
 * ============================================================================
 * Asset Management (Phase 3E, W98 — Employee & Manager Asset Views, Incident
 * Reporting): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §9/§20/§24's own
 * frozen W98 scope — the "Employee own assets / manager team view" route
 * group: `my-assets`, `team-assets`, `report-issue`. No HR-side incident
 * review/dismiss (W99, `asset_incident.reviewed`/`.dismissed` are not
 * emitted anywhere in this file), no maintenance, no evidence.
 *
 * OWN INCIDENT VISIBILITY — DISCLOSED, NOT BUILT: the frozen §20 contract
 * has exactly one incident-related route in this workstream's own API-impact
 * line ("POST .../assets/:id/report-issue"). The only incident LIST route
 * anywhere in §20 is `GET .../asset-incidents`, which lives under the
 * separate "Incident handling (HR/Asset-Officer)" group, gated
 * `asset_management.manage` — not this workstream's own group, and not
 * `asset_management.read.own`-reachable at all. No own-scoped incident list/
 * detail route is built here; this is the frozen contract's own literal
 * shape, not an oversight.
 *
 * REPORT-ONLY INVARIANT (Owner Decision 2, permanent): `reportAssetIssue`
 * below inserts exactly one `asset_incidents` row and touches nothing else —
 * no write to `assetsTable` (status/condition), no write to
 * `assetAssignmentsTable` (custodyEndedAt/endReason), anywhere in this
 * function. An incident always starts `status='open'`; the `reviewed`/
 * `dismissed` transitions belong exclusively to W99's own HR-side routes,
 * which do not exist in this codebase yet.
 *
 * `asset_management.write.own` PERMANENT INVARIANT (§15): authorizes exactly
 * two own-scoped actions across this entire module — W97's own acknowledge
 * (already shipped) and this workstream's own report-issue. It is never
 * checked anywhere else, and neither function it gates ever mutates asset or
 * custody state.
 *
 * MANAGER SCOPE IS LIVE, NEVER SNAPSHOTTED (Owner Decision 3): `listTeamAssetAssignments`
 * below joins `asset_assignments` against `employees.reportingManagerId` at
 * query time — the *current* relationship, re-evaluated on every call, never
 * a stored/cached value. Current-custody only (`custodyEndedAt IS NULL`) —
 * no historical reach through this function, matching the frozen plan's own
 * explicit "no organization-wide fallback, no manager snapshot" text. The
 * permission floor is the same uniform `asset_management.read.own` every
 * role already holds (§15's own text: "the single coarse-floor read
 * permission... fine-grained scope... resolved server-side from... live
 * relationships") — manager authority here comes from the relationship
 * query itself, never from a separate permission tier.
 * ============================================================================
 */

export interface ReportAssetIssueParams {
  organizationId: number;
  assetId: number;
  employeeId: number;
  incidentType: "damage" | "loss";
  description: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * Decision 2: only on an asset with an active assignment belonging to the
 * caller. Creates exactly one asset_incidents row (status='open',
 * server-derived reportedByEmployeeId/reportedAt) — never mutates the asset
 * or the assignment. Free-text description is never placed in audit
 * metadata.
 */
export async function reportAssetIssue(params: ReportAssetIssueParams): Promise<AssetIncident> {
  const asset = await findOwnAsset(params.organizationId, params.assetId);
  if (!asset) throw new AssetNotFoundError();

  const [activeAssignment] = await db
    .select()
    .from(assetAssignmentsTable)
    .where(
      and(
        eq(assetAssignmentsTable.organizationId, params.organizationId),
        eq(assetAssignmentsTable.assetId, params.assetId),
        eq(assetAssignmentsTable.employeeId, params.employeeId),
        isNull(assetAssignmentsTable.custodyEndedAt),
      ),
    )
    .limit(1);
  if (!activeAssignment) throw new AssetNotCurrentlyAssignedToCallerError();

  const [incident] = await db
    .insert(assetIncidentsTable)
    .values({
      organizationId: params.organizationId,
      assetId: params.assetId,
      assignmentId: activeAssignment.id,
      reportedByEmployeeId: params.employeeId,
      incidentType: params.incidentType,
      description: params.description,
      status: "open",
      reviewedByMembershipId: null,
      reviewedAt: null,
      resolutionNotes: null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset_incident.reported",
    targetType: "asset_incident",
    targetId: String(incident.id),
    metadata: { assetId: params.assetId, assignmentId: activeAssignment.id, incidentType: params.incidentType },
  });

  return incident;
}

/**
 * GET .../assets/my-assets: the caller's own current + full historical
 * assignments across every asset, newest first. A caller with no linked
 * employee record gets an empty list, never an error.
 */
export async function listMyAssetAssignments(organizationId: number, employeeId: number | null): Promise<AssetAssignment[]> {
  if (employeeId == null) return [];
  return db
    .select()
    .from(assetAssignmentsTable)
    .where(and(eq(assetAssignmentsTable.organizationId, organizationId), eq(assetAssignmentsTable.employeeId, employeeId)))
    .orderBy(desc(assetAssignmentsTable.issuedAt));
}

/**
 * GET .../assets/team-assets (Decision 3): current custody only, for
 * current direct reports only — the reportingManagerId join is evaluated
 * live on every call. A caller with no linked employee record, or with zero
 * current direct reports, gets an empty list, never an error and never an
 * organization-wide fallback.
 */
export async function listTeamAssetAssignments(organizationId: number, managerEmployeeId: number | null): Promise<AssetAssignment[]> {
  if (managerEmployeeId == null) return [];

  // Two simple queries rather than a join: first resolve the caller's
  // CURRENT direct reports (a live query against employees.reportingManagerId,
  // never cached/snapshotted — re-evaluated fresh on every call), then fetch
  // only THEIR currently-active assignments. A direct-report set that has
  // shrunk since a previous call is reflected immediately, by construction.
  const directReports = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.organizationId, organizationId), eq(employeesTable.reportingManagerId, managerEmployeeId)));
  if (directReports.length === 0) return [];
  const directReportIds = directReports.map((e) => e.id);

  return db
    .select()
    .from(assetAssignmentsTable)
    .where(
      and(
        eq(assetAssignmentsTable.organizationId, organizationId),
        isNull(assetAssignmentsTable.custodyEndedAt),
        inArray(assetAssignmentsTable.employeeId, directReportIds),
      ),
    )
    .orderBy(desc(assetAssignmentsTable.issuedAt));
}

/**
 * ============================================================================
 * Asset Management (Phase 3E, W99 — Incident Review, Loss & Retirement
 * (HR-Side)): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §7/§20/§24's own
 * frozen W99 scope — the "Incident handling (HR/Asset-Officer)" route group:
 * org-wide incident listing, review, dismiss. No maintenance-table work
 * (W100), no dashboard/reporting (W102).
 *
 * INTENTIONALLY LIGHTWEIGHT, NOT CASE MANAGEMENT (§5's own explicit
 * instruction): review/dismiss set exactly status + reviewedByMembershipId +
 * reviewedAt + an OPTIONAL resolutionNotes — nothing else. No multi-stage
 * workflow, no linkage to "what action was separately taken." §5's own
 * `resolutionNotes` field comment: "may reference what asset-level action
 * (if any) was separately taken; no hard FK to a 'resulting action,'
 * deliberately, to avoid drifting into case management."
 *
 * INCIDENT DISPOSITION IS DELIBERATELY SEPARATE FROM ASSET LIFECYCLE:
 * reviewAssetIncident/dismissAssetIncident below NEVER call
 * updateAssetCondition/markAssetLost/recoverAsset/retireAsset, and vice
 * versa — no automatic coupling exists anywhere in this file. If HR decides
 * a reviewed incident means the asset is damaged/lost/retired, they invoke
 * the already-existing, independent W96 actions themselves, as a separate
 * decision. This is the frozen plan's own explicit design, not an
 * oversight: "the incident may be reviewed while the resulting
 * administrative action is handled separately."
 *
 * NO SECOND STATUS-TRANSITION ENGINE: mark-lost/recover/retire/condition
 * (all already shipped in W96, unchanged here) remain the sole authoritative
 * paths to change assets.status/.condition. This file adds no new asset- or
 * assignment-mutating function — only asset_incidents' own review/dismiss.
 *
 * TERMINAL, NO REOPEN (§7's own "Incident lifecycle (NEW)"): open ->
 * reviewed | dismissed, both terminal. Every transition here is an atomic
 * conditional UPDATE guarded by `status = 'open'` — a second review, a
 * second dismiss, or dismissing an already-reviewed incident (or vice
 * versa) all affect zero rows and throw a controlled conflict, never a
 * silent no-op or an implicit reopen.
 * ============================================================================
 */

export interface ListAssetIncidentsFilters {
  organizationId: number;
  status?: string;
}

/** GET .../asset-incidents (§20): org-wide, optionally filtered by status. Read-only, never audited. */
export async function listAssetIncidents(filters: ListAssetIncidentsFilters): Promise<AssetIncident[]> {
  const conditions = [eq(assetIncidentsTable.organizationId, filters.organizationId)];
  if (filters.status != null) conditions.push(eq(assetIncidentsTable.status, filters.status as never));
  return db
    .select()
    .from(assetIncidentsTable)
    .where(and(...conditions))
    .orderBy(desc(assetIncidentsTable.reportedAt));
}

export interface ReviewAssetIncidentParams {
  organizationId: number;
  incidentId: number;
  resolutionNotes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** open -> reviewed (§7, §20) — optional resolutionNotes (never mandatory; the frozen route table's own text). Atomic conditional UPDATE guarded by status='open'. */
export async function reviewAssetIncident(params: ReviewAssetIncidentParams): Promise<AssetIncident> {
  const existing = await findOrgIncident(params.organizationId, params.incidentId);
  if (!existing) throw new AssetIncidentNotFoundError();

  const [updated] = await db
    .update(assetIncidentsTable)
    .set({
      status: "reviewed",
      reviewedByMembershipId: params.actorMembershipId,
      reviewedAt: new Date(),
      resolutionNotes: params.resolutionNotes ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(assetIncidentsTable.id, params.incidentId), eq(assetIncidentsTable.organizationId, params.organizationId), eq(assetIncidentsTable.status, "open")))
    .returning();
  if (!updated) {
    throw new AssetIncidentConflictError(existing.status === "open" ? "This incident is no longer open" : `This incident has already been ${existing.status}`);
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset_incident.reviewed",
    targetType: "asset_incident",
    targetId: String(params.incidentId),
    beforeState: { status: "open" },
    afterState: { status: "reviewed" },
    metadata: { assetId: existing.assetId },
  });

  return updated;
}

export interface DismissAssetIncidentParams {
  organizationId: number;
  incidentId: number;
  resolutionNotes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** open -> dismissed (§7, §20) — same shape as review, opposite terminal outcome. Atomic conditional UPDATE guarded by status='open'. */
export async function dismissAssetIncident(params: DismissAssetIncidentParams): Promise<AssetIncident> {
  const existing = await findOrgIncident(params.organizationId, params.incidentId);
  if (!existing) throw new AssetIncidentNotFoundError();

  const [updated] = await db
    .update(assetIncidentsTable)
    .set({
      status: "dismissed",
      reviewedByMembershipId: params.actorMembershipId,
      reviewedAt: new Date(),
      resolutionNotes: params.resolutionNotes ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(assetIncidentsTable.id, params.incidentId), eq(assetIncidentsTable.organizationId, params.organizationId), eq(assetIncidentsTable.status, "open")))
    .returning();
  if (!updated) {
    throw new AssetIncidentConflictError(existing.status === "open" ? "This incident is no longer open" : `This incident has already been ${existing.status}`);
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "asset_incident.dismissed",
    targetType: "asset_incident",
    targetId: String(params.incidentId),
    beforeState: { status: "open" },
    afterState: { status: "dismissed" },
    metadata: { assetId: existing.assetId },
  });

  return updated;
}

/**
 * ============================================================================
 * Asset Management (Phase 3E, W100 — Maintenance & Documents/Evidence):
 * docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md §5/§7/§11/§13/§20/§24's own
 * frozen W100 scope. Simple maintenance HISTORY only (no scheduling engine,
 * no work orders, no vendor management, no parts inventory, no SLA/reminder
 * functionality — §11) plus asset evidence/document attachment reusing the
 * EXISTING employee_documents/fileStorage/documentValidation layer verbatim
 * (§13, Owner Decision 9) — no second storage subsystem, no public URLs.
 *
 * MAINTENANCE ROUTE SHAPE (§20's own literal table): exactly two routes —
 * `GET, POST .../assets/:id/maintenance` (list/create) and a SINGLE
 * `PATCH .../asset-maintenance/:id` for every lifecycle transition. "No
 * status-smuggling through generic PATCH" (this workstream's own explicit
 * instruction) does not mean a second route per transition — the frozen
 * table names exactly one PATCH route — it means that route's own request
 * body never accepts a raw target `status` field; it accepts a closed
 * `action` enum (`start`/`complete`/`cancel`) that this file alone maps to
 * the correct validated conditional UPDATE. A client can never smuggle an
 * arbitrary status value through it.
 *
 * MAINTENANCE LIFECYCLE (§7): `scheduled -> in_progress -> completed |
 * cancelled`. `completed` and `cancelled` are both terminal — no reopen; a
 * further service need creates a new asset_maintenance row. `cancel` is
 * accepted from EITHER `scheduled` (never touched assets.status — nothing to
 * revert) or `in_progress` (assets.status was set to 'maintenance' at start
 * time and must be restored via the identical derivation logic completion
 * uses) — the frozen lifecycle diagram itself is silent on which prior
 * states cancel is reachable from; permitting both is the only reading that
 * never corrupts assets.status either way, disclosed here as a reasoned
 * interpretation, not a frozen-literal one.
 *
 * ASSET STATUS DURING MAINTENANCE (§7, this workstream's own central
 * invariant): creating (`scheduled`) a maintenance record never touches
 * assets.status. Only `start` (`available|assigned -> maintenance`, atomic
 * with the maintenance row's own `scheduled -> in_progress` transition) and
 * `complete`/`cancel-from-in_progress` (deriving `available` or `assigned`
 * from whether an active, `custodyEndedAt IS NULL`, asset_assignments row
 * still exists — queried fresh, inside the same transaction, never trusted
 * from any caller input or stale snapshot) touch it, always in the same
 * transaction as the maintenance row's own transition. The caller can never
 * supply a target asset status — `completeAssetMaintenance`/
 * `cancelAssetMaintenance` accept no such field anywhere in their params.
 *
 * A REAL RACE, NOT MERELY DEFENSIVE: because markAssetLost's own existing
 * W96 transition already accepts 'maintenance' as a valid source status
 * (§7: "available/assigned/maintenance -> lost"), an asset can genuinely be
 * marked lost out from under an in_progress maintenance record. The
 * asset-side conditional UPDATE inside `completeAssetMaintenance`/
 * `cancelAssetMaintenance` (`WHERE status = 'maintenance'`) is this file's
 * real protection against that — if it has fired, the maintenance
 * transition itself is rolled back and a controlled 409 is returned
 * ("this asset is no longer in a maintenance state"), never a silent asset
 * status overwrite.
 *
 * CUSTODY INTEGRITY: nothing here ever creates, closes, or rewrites an
 * asset_assignments row — `completeAssetMaintenance`/`cancelAssetMaintenance`
 * only ever READ the open assignment row (if any) to decide the derived
 * target status; the row itself, and its own snapshots, are untouched by
 * this file, identical discipline to every other W96-W99 action that reads
 * but never mutates custody history incidentally.
 *
 * MAINTENANCE AUTHORIZATION (§15, §20): `asset_management.manage` only,
 * every route, no exception — never reachable through `read.own`/
 * `write.own`/`reports.read`/manager-of-record. `write.own` is untouched by
 * this file (still exactly acknowledge + report-issue, §15's permanent
 * invariant).
 *
 * EVIDENCE VISIBILITY (§20's own literal table row, "same visibility tier as
 * the asset itself" for BOTH the GET/POST evidence row and the download
 * row): the exact same two-tier dual-floor GET .../assets/:id already
 * resolves — organization-wide (`asset_management.manage`) OR own-scope
 * (the caller currently holds this specific asset via an open
 * asset_assignments row, `callerHasActiveAssignment`) — reused verbatim,
 * zero new authorization primitives. There is no manager tier for evidence
 * (Assets' own asset-detail dispatch has never had one — `team-assets` is a
 * separate, bespoke, read-only route, not reused here). This resolves an
 * apparent tension against this workstream's own scope-entry text
 * ("Permissions used: asset_management.manage, plus the existing
 * evidence-visibility-tier resolution") — that text is satisfied because
 * the org-wide half of the dual-floor dispatch itself checks
 * `asset_management.manage`; it does not mean upload is restricted to
 * `.manage` alone while GET/download use a broader tier. This mirrors the
 * proven Learning W90 precedent exactly (`learningEnrollmentEvidence.ts`'s
 * own `addEvidence`/`resolveEvidenceEnrollmentRelationship`), which also
 * permits upload at the identical tier as read — not merely list/download.
 * Employee own-scope evidence access here is NOT authorized through
 * `write.own` (still exactly acknowledge + report-issue) — the route-level
 * permission floor is `asset_management.read.own`, matching GET
 * .../assets/:id's own existing floor exactly.
 *
 * DOCUMENT OWNERSHIP (§13, W95's own nullable employeeId change): every
 * employee_documents row this file creates has `employeeId: null` — an
 * asset has no natural single-employee owner, and no uploader/custodian/
 * manager is ever fabricated into that field to populate it.
 *
 * FILE/DB CONSISTENCY: identical compensating-deletion discipline to
 * performanceReviewEvidence.ts's/learningEnrollmentEvidence.ts's own W82/
 * W90 precedent — the file is written first; if the subsequent transaction
 * (both inserts) fails for any reason, the already-written physical file is
 * deleted before the error propagates, so storage and the database can
 * never disagree.
 *
 * NO DELETE ROUTE: §20 names no delete/remove contract for evidence, so
 * none is built here — attach/list/download only, identical to Learning's
 * own "no delete route" precedent.
 * ============================================================================
 */

export type AssetMaintenanceAction = "start" | "complete" | "cancel";

export interface CreateAssetMaintenanceParams {
  organizationId: number;
  assetId: number;
  maintenanceType: string;
  description?: string;
  providerText?: string;
  cost?: number;
  notes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * GET/POST .../assets/:id/maintenance's own POST half (§20). Creates a new
 * `scheduled` maintenance row — never touches assets.status (see file
 * header). Blocked only on a `retired` asset (permanently terminal, §7's
 * own universal "no further transitions" rule) — every other asset status
 * may be scheduled ahead; the `start` transition's own atomic guard is the
 * real enforcement point for which of those statuses can actually begin
 * (§7's own literal "available/assigned -> maintenance" transitions).
 */
export async function createAssetMaintenance(params: CreateAssetMaintenanceParams): Promise<AssetMaintenance> {
  const asset = await findOwnAsset(params.organizationId, params.assetId);
  if (!asset) throw new AssetNotFoundError();
  if (asset.status === "retired") {
    throw new AssetLifecycleConflictError("This asset is retired and cannot be scheduled for maintenance");
  }
  if (params.cost != null && params.cost < 0) {
    throw new InvalidAssetError("cost must not be negative");
  }

  const [maintenance] = await db
    .insert(assetMaintenanceTable)
    .values({
      organizationId: params.organizationId,
      assetId: params.assetId,
      maintenanceType: params.maintenanceType,
      description: params.description ?? null,
      providerText: params.providerText ?? null,
      status: "scheduled",
      startedAt: null,
      completedAt: null,
      cost: params.cost != null ? String(params.cost) : null,
      notes: params.notes ?? null,
      createdByMembershipId: params.actorMembershipId,
    })
    .returning();

  return maintenance;
}

/** GET .../assets/:id/maintenance (§20): org-wide only — no own/manager visibility is frozen for maintenance history, so none is invented here. Read-only, never audited. */
export async function listAssetMaintenance(organizationId: number, assetId: number): Promise<AssetMaintenance[]> {
  return db
    .select()
    .from(assetMaintenanceTable)
    .where(and(eq(assetMaintenanceTable.organizationId, organizationId), eq(assetMaintenanceTable.assetId, assetId)))
    .orderBy(desc(assetMaintenanceTable.createdAt));
}

/** Live "does an active custody row still exist" check — queried fresh at completion/cancellation time, never trusted from a snapshot (§7's own explicit derivation rule). */
async function hasActiveAssignmentForAsset(organizationId: number, assetId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: assetAssignmentsTable.id })
    .from(assetAssignmentsTable)
    .where(and(eq(assetAssignmentsTable.organizationId, organizationId), eq(assetAssignmentsTable.assetId, assetId), isNull(assetAssignmentsTable.custodyEndedAt)))
    .limit(1);
  return !!row;
}

export interface UpdateAssetMaintenanceParams {
  organizationId: number;
  maintenanceId: number;
  action: AssetMaintenanceAction;
  cost?: number;
  notes?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * PATCH .../asset-maintenance/:id (§20) — the single frozen route for every
 * maintenance lifecycle transition, dispatched by the caller-supplied
 * `action` (never a raw target status). The maintenance record's own
 * `assetId` (never a caller-supplied one — the route carries no separate
 * asset id) is what the asset-side atomic update targets.
 */
export async function updateAssetMaintenance(params: UpdateAssetMaintenanceParams): Promise<AssetMaintenance> {
  const existing = await findOrgMaintenance(params.organizationId, params.maintenanceId);
  if (!existing) throw new AssetMaintenanceNotFoundError();
  const assetId = existing.assetId;
  if (params.cost != null && params.cost < 0) {
    throw new InvalidAssetError("cost must not be negative");
  }

  const optionalPatch: Record<string, unknown> = {};
  if (params.cost !== undefined) optionalPatch.cost = String(params.cost);
  if (params.notes !== undefined) optionalPatch.notes = params.notes;

  if (params.action === "start") {
    const updated = await db.transaction(async (tx) => {
      const [maintenanceRow] = await tx
        .update(assetMaintenanceTable)
        .set({ status: "in_progress", startedAt: new Date(), updatedAt: new Date(), ...optionalPatch })
        .where(and(eq(assetMaintenanceTable.id, params.maintenanceId), eq(assetMaintenanceTable.organizationId, params.organizationId), eq(assetMaintenanceTable.status, "scheduled")))
        .returning();
      if (!maintenanceRow) return null;

      const [assetRow] = await tx
        .update(assetsTable)
        .set({ status: "maintenance", updatedAt: new Date() })
        .where(and(eq(assetsTable.id, assetId), eq(assetsTable.organizationId, params.organizationId), or(eq(assetsTable.status, "available"), eq(assetsTable.status, "assigned"))!))
        .returning();
      if (!assetRow) {
        throw new AssetLifecycleConflictError("This asset is not currently in a state that can enter maintenance");
      }

      return maintenanceRow;
    });
    if (!updated) {
      throw new AssetMaintenanceConflictError(existing.status === "scheduled" ? "This maintenance record is no longer scheduled" : `This maintenance record has already been ${existing.status === "in_progress" ? "started" : existing.status}`);
    }

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "asset_maintenance.started",
      targetType: "asset_maintenance",
      targetId: String(params.maintenanceId),
      beforeState: { status: "scheduled" },
      afterState: { status: "in_progress" },
      metadata: { assetId },
    });

    return updated;
  }

  if (params.action === "complete" || params.action === "cancel") {
    const terminalStatus = params.action === "complete" ? "completed" : "cancelled";

    if (existing.status === "scheduled") {
      // cancel-from-scheduled: assets.status was never touched (see file
      // header) — a pure maintenance-row transition, no asset-side update.
      if (params.action === "complete") {
        throw new AssetMaintenanceConflictError("This maintenance record has not been started yet");
      }
      const [updated] = await db
        .update(assetMaintenanceTable)
        .set({ status: "cancelled", updatedAt: new Date(), ...optionalPatch })
        .where(and(eq(assetMaintenanceTable.id, params.maintenanceId), eq(assetMaintenanceTable.organizationId, params.organizationId), eq(assetMaintenanceTable.status, "scheduled")))
        .returning();
      if (!updated) {
        throw new AssetMaintenanceConflictError(`This maintenance record has already been ${existing.status}`);
      }
      await recordAuditEvent({
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
        organizationId: params.organizationId,
        eventType: "asset_maintenance.cancelled",
        targetType: "asset_maintenance",
        targetId: String(params.maintenanceId),
        beforeState: { status: "scheduled" },
        afterState: { status: "cancelled" },
        metadata: { assetId },
      });
      return updated;
    }

    if (existing.status !== "in_progress") {
      throw new AssetMaintenanceConflictError(`This maintenance record has already been ${existing.status}`);
    }

    // in_progress -> completed | cancelled: both derive the asset's own
    // post-maintenance status live, inside the same transaction as the
    // maintenance row's own transition — never caller-supplied (§7).
    const updated = await db.transaction(async (tx) => {
      const stillAssigned = await hasActiveAssignmentForAsset(params.organizationId, assetId);
      const derivedAssetStatus = stillAssigned ? "assigned" : "available";

      const maintenancePatch: Record<string, unknown> = { status: terminalStatus, updatedAt: new Date(), ...optionalPatch };
      if (params.action === "complete") maintenancePatch.completedAt = new Date();

      const [maintenanceRow] = await tx
        .update(assetMaintenanceTable)
        .set(maintenancePatch)
        .where(and(eq(assetMaintenanceTable.id, params.maintenanceId), eq(assetMaintenanceTable.organizationId, params.organizationId), eq(assetMaintenanceTable.status, "in_progress")))
        .returning();
      if (!maintenanceRow) return null;

      const [assetRow] = await tx
        .update(assetsTable)
        .set({ status: derivedAssetStatus, updatedAt: new Date() })
        .where(and(eq(assetsTable.id, assetId), eq(assetsTable.organizationId, params.organizationId), eq(assetsTable.status, "maintenance")))
        .returning();
      if (!assetRow) {
        // A real race (see file header) — e.g. the asset was marked lost
        // while this maintenance record was in_progress — not merely
        // defensive. Rolls back both updates; a controlled 409, never a
        // silent asset-status overwrite.
        throw new AssetMaintenanceConflictError("This asset is no longer in a maintenance state");
      }

      return maintenanceRow;
    });
    if (!updated) {
      throw new AssetMaintenanceConflictError(`This maintenance record has already been ${existing.status}`);
    }

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: params.action === "complete" ? "asset_maintenance.completed" : "asset_maintenance.cancelled",
      targetType: "asset_maintenance",
      targetId: String(params.maintenanceId),
      beforeState: { status: "in_progress" },
      afterState: { status: terminalStatus },
      metadata: { assetId },
    });

    return updated;
  }

  throw new InvalidAssetError("Unknown maintenance action");
}

export interface AssetEvidenceWithDocument {
  id: number;
  organizationId: number;
  assetId: number;
  employeeDocumentId: number;
  addedByMembershipId: number | null;
  addedAt: Date;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: number | null;
}

/** The document_category Master Data code Assets' own evidence uploads register under — a free string, not validated against the domain's item list, identical precedent to Learning's own LEARNING_EVIDENCE_CATEGORY. */
export const ASSET_EVIDENCE_CATEGORY = "asset_evidence";

/** GET .../assets/:id/evidence (§20): org-scoped, asset-scoped, most recently added first. */
export async function listAssetEvidence(organizationId: number, assetId: number): Promise<AssetEvidenceWithDocument[]> {
  return db
    .select({
      id: assetEvidenceTable.id,
      organizationId: assetEvidenceTable.organizationId,
      assetId: assetEvidenceTable.assetId,
      employeeDocumentId: assetEvidenceTable.employeeDocumentId,
      addedByMembershipId: assetEvidenceTable.addedByMembershipId,
      addedAt: assetEvidenceTable.addedAt,
      fileName: employeeDocumentsTable.fileName,
      mimeType: employeeDocumentsTable.mimeType,
      fileSize: employeeDocumentsTable.fileSize,
      uploadedBy: employeeDocumentsTable.uploadedBy,
    })
    .from(assetEvidenceTable)
    .innerJoin(employeeDocumentsTable, eq(assetEvidenceTable.employeeDocumentId, employeeDocumentsTable.id))
    .where(and(eq(assetEvidenceTable.organizationId, organizationId), eq(assetEvidenceTable.assetId, assetId)))
    .orderBy(desc(assetEvidenceTable.addedAt));
}

/** A single evidence row's document metadata + storage key — for the authorization-checked download route only (storageKey never otherwise leaves this file). */
export async function getAssetEvidenceForDownload(organizationId: number, assetId: number, evidenceId: number) {
  const [row] = await db
    .select({
      id: assetEvidenceTable.id,
      fileName: employeeDocumentsTable.fileName,
      mimeType: employeeDocumentsTable.mimeType,
      storageKey: employeeDocumentsTable.storageKey,
    })
    .from(assetEvidenceTable)
    .innerJoin(employeeDocumentsTable, eq(assetEvidenceTable.employeeDocumentId, employeeDocumentsTable.id))
    .where(and(eq(assetEvidenceTable.id, evidenceId), eq(assetEvidenceTable.assetId, assetId), eq(assetEvidenceTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface AddAssetEvidenceParams {
  organizationId: number;
  assetId: number;
  file: { mimetype: string; size: number; buffer: Buffer; originalname: string };
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * Validates the upload (identical rigor to every other document upload on
 * this platform — file-signature-checked, 10MB cap, allowlisted MIME
 * types), writes the file, then creates the employee_documents row
 * (`employeeId: null` — see file header) and the asset_evidence join row
 * together in one transaction. If the transaction fails, the already-
 * written file is deleted (compensating cleanup).
 */
export async function addAssetEvidence(params: AddAssetEvidenceParams): Promise<AssetEvidenceWithDocument> {
  const asset = await findOwnAsset(params.organizationId, params.assetId);
  if (!asset) throw new AssetNotFoundError();

  const extension = validateDocumentUpload(params.file);
  const storageKey = await writeOrgFile(params.organizationId, "documents", extension, params.file.buffer);

  try {
    const { document, evidence } = await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(employeeDocumentsTable)
        .values({
          organizationId: params.organizationId,
          employeeId: null,
          categoryCode: ASSET_EVIDENCE_CATEGORY,
          fileName: params.file.originalname,
          storageKey,
          mimeType: params.file.mimetype,
          fileSize: params.file.size,
          uploadedBy: params.actorApplicationUserId,
        })
        .returning();

      const [evidence] = await tx
        .insert(assetEvidenceTable)
        .values({
          organizationId: params.organizationId,
          assetId: params.assetId,
          employeeDocumentId: document.id,
          addedByMembershipId: params.actorMembershipId,
        })
        .returning();

      return { document, evidence };
    });

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "employee_document.uploaded",
      targetType: "asset",
      targetId: String(params.assetId),
      metadata: { documentId: document.id, categoryCode: document.categoryCode, fileName: document.fileName },
    });
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "asset_evidence.attached",
      targetType: "asset",
      targetId: String(params.assetId),
      metadata: { evidenceId: evidence.id, employeeDocumentId: document.id, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.fileSize },
    });

    return {
      id: evidence.id,
      organizationId: evidence.organizationId,
      assetId: evidence.assetId,
      employeeDocumentId: evidence.employeeDocumentId,
      addedByMembershipId: evidence.addedByMembershipId,
      addedAt: evidence.addedAt,
      fileName: document.fileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      uploadedBy: document.uploadedBy,
    };
  } catch (err) {
    await deleteOrgFile(params.organizationId, storageKey);
    throw err;
  }
}
