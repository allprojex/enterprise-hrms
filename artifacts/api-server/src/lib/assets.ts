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
  branchesTable,
  employeesTable,
  type Asset,
  type AssetAssignment,
  type AssetIncident,
} from "@workspace/db";
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
