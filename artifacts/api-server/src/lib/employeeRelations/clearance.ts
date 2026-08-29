import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  clearanceTemplatesTable,
  clearanceTemplateItemsTable,
  clearanceItemsTable,
  employeeExitProcessesTable,
  employeeDocumentsTable,
  departmentsTable,
  assetAssignmentsTable,
  officeInventoryStockMovementsTable,
  officeInventoryItemsTable,
  personnelFilesTable,
  type ClearanceTemplate,
  type ClearanceTemplateItem,
  type ClearanceItem,
} from "@workspace/db";
import { assertBelongsToOrganization } from "../orgScopedRefs";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-12 — Clearance templates and items (§28.8, §28.9, §28.10).
 *
 * THE OBSERVE-ONLY LINE, stated once and enforced everywhere below.
 *
 * Completing an `asset_return` clearance item does NOT end an asset assignment,
 * does NOT set `custodyEndedAt`, does NOT change asset condition and does NOT
 * touch `asset_incidents`. Completing an `inventory_return` item does NOT move
 * stock, create a request, or issue or receive anything. §28.9 and §28.10 are
 * absolute about this, and the reason is not fussiness: an asset marked returned
 * by a checklist tick is an asset nobody ever looked for again. The Assets and
 * Office Inventory modules own those transitions and perform them through their
 * own services; clearance READS the result and reports it.
 *
 * You will therefore find, in this file, no insert or update against any Assets
 * or Office Inventory table. `summarizeOutstandingCustody` issues selects and
 * nothing else, and a test proves that completing clearance leaves open asset
 * assignments exactly as they were.
 */

export class ClearanceTemplateNotFoundError extends Error {
  constructor() {
    super("Clearance template not found");
    this.name = "ClearanceTemplateNotFoundError";
  }
}

export class ClearanceItemNotFoundError extends Error {
  constructor() {
    super("Clearance item not found");
    this.name = "ClearanceItemNotFoundError";
  }
}

export class InvalidClearanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClearanceError";
  }
}

export class WaiverReasonRequiredError extends Error {
  constructor() {
    super("A waiver requires a reason. Clearance may be waived, but never silently.");
    this.name = "WaiverReasonRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Templates (organization configuration — §28.8, §28.18)
// ---------------------------------------------------------------------------

export async function listTemplates(organizationId: number): Promise<ClearanceTemplate[]> {
  return db
    .select()
    .from(clearanceTemplatesTable)
    .where(eq(clearanceTemplatesTable.organizationId, organizationId))
    .orderBy(clearanceTemplatesTable.name);
}

export async function getTemplate(
  organizationId: number,
  templateId: number,
): Promise<ClearanceTemplate | undefined> {
  const [row] = await db
    .select()
    .from(clearanceTemplatesTable)
    .where(
      and(eq(clearanceTemplatesTable.id, templateId), eq(clearanceTemplatesTable.organizationId, organizationId)),
    )
    .limit(1);
  return row;
}

export async function listTemplateItems(
  organizationId: number,
  templateId: number,
): Promise<ClearanceTemplateItem[]> {
  return db
    .select()
    .from(clearanceTemplateItemsTable)
    .where(
      and(
        eq(clearanceTemplateItemsTable.organizationId, organizationId),
        eq(clearanceTemplateItemsTable.templateId, templateId),
      ),
    )
    .orderBy(clearanceTemplateItemsTable.sequence, clearanceTemplateItemsTable.id);
}

export async function createTemplate(params: {
  organizationId: number;
  name: string;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceTemplate> {
  if (!params.name.trim()) throw new InvalidClearanceError("A template name is required.");

  const [created] = await db
    .insert(clearanceTemplatesTable)
    .values({
      organizationId: params.organizationId,
      name: params.name.trim(),
      description: params.description ?? null,
      status: "draft",
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_template.created",
    targetType: "clearance_template",
    targetId: String(created!.id),
    afterState: { name: created!.name, status: created!.status },
  });

  return created!;
}

export async function updateTemplate(params: {
  organizationId: number;
  templateId: number;
  name?: string;
  description?: string | null;
  status?: ClearanceTemplate["status"];
  isDefault?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceTemplate> {
  const before = await getTemplate(params.organizationId, params.templateId);
  if (!before) throw new ClearanceTemplateNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) {
    if (!params.name.trim()) throw new InvalidClearanceError("A template name is required.");
    patch.name = params.name.trim();
  }
  if (params.description !== undefined) patch.description = params.description;
  if (params.status !== undefined) patch.status = params.status;

  return db.transaction(async (tx) => {
    // At most one default per organization is a database guarantee; clearing the
    // previous holder first keeps that guarantee satisfiable rather than making
    // the caller discover it as a constraint violation.
    if (params.isDefault === true) {
      await tx
        .update(clearanceTemplatesTable)
        .set({ isDefault: false })
        .where(
          and(
            eq(clearanceTemplatesTable.organizationId, params.organizationId),
            eq(clearanceTemplatesTable.isDefault, true),
          ),
        );
      patch.isDefault = true;
    } else if (params.isDefault === false) {
      patch.isDefault = false;
    }

    const [updated] = await tx
      .update(clearanceTemplatesTable)
      .set(patch)
      .where(
        and(
          eq(clearanceTemplatesTable.id, params.templateId),
          eq(clearanceTemplatesTable.organizationId, params.organizationId),
        ),
      )
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "clearance_template.updated",
      targetType: "clearance_template",
      targetId: String(params.templateId),
      beforeState: { name: before.name, status: before.status, isDefault: before.isDefault },
      afterState: { name: updated!.name, status: updated!.status, isDefault: updated!.isDefault },
    });

    return updated!;
  });
}

export async function addTemplateItem(params: {
  organizationId: number;
  templateId: number;
  label: string;
  description?: string | null;
  itemType?: ClearanceTemplateItem["itemType"];
  required?: boolean;
  responsibleDepartmentId?: number | null;
  sequence?: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceTemplateItem> {
  const template = await getTemplate(params.organizationId, params.templateId);
  if (!template) throw new ClearanceTemplateNotFoundError();
  if (!params.label.trim()) throw new InvalidClearanceError("An item label is required.");
  if (params.responsibleDepartmentId != null) {
    await assertBelongsToOrganization(
      departmentsTable,
      params.responsibleDepartmentId,
      params.organizationId,
      "Department",
    );
  }

  const [created] = await db
    .insert(clearanceTemplateItemsTable)
    .values({
      organizationId: params.organizationId,
      templateId: params.templateId,
      sequence: params.sequence ?? 0,
      label: params.label.trim(),
      description: params.description ?? null,
      itemType: params.itemType ?? "general",
      required: params.required ?? true,
      responsibleDepartmentId: params.responsibleDepartmentId ?? null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_template.item_added",
    targetType: "clearance_template",
    targetId: String(params.templateId),
    afterState: { itemId: created!.id, label: created!.label, itemType: created!.itemType },
  });

  return created!;
}

/**
 * Removing a template item does NOT touch clearance already instantiated from
 * it: `clearance_items.sourceTemplateItemId` is `set null` on delete, so a live
 * obligation survives its template being edited (§28.8).
 */
export async function removeTemplateItem(params: {
  organizationId: number;
  templateId: number;
  itemId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const [existing] = await db
    .select({ id: clearanceTemplateItemsTable.id })
    .from(clearanceTemplateItemsTable)
    .where(
      and(
        eq(clearanceTemplateItemsTable.id, params.itemId),
        eq(clearanceTemplateItemsTable.templateId, params.templateId),
        eq(clearanceTemplateItemsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new ClearanceItemNotFoundError();

  await db.delete(clearanceTemplateItemsTable).where(eq(clearanceTemplateItemsTable.id, params.itemId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_template.item_removed",
    targetType: "clearance_template",
    targetId: String(params.templateId),
    beforeState: { itemId: params.itemId },
  });
}

// ---------------------------------------------------------------------------
// Instantiated clearance items
// ---------------------------------------------------------------------------

export async function listItems(organizationId: number, exitProcessId: number): Promise<ClearanceItem[]> {
  return db
    .select()
    .from(clearanceItemsTable)
    .where(
      and(
        eq(clearanceItemsTable.organizationId, organizationId),
        eq(clearanceItemsTable.exitProcessId, exitProcessId),
      ),
    )
    .orderBy(clearanceItemsTable.sequence, clearanceItemsTable.id);
}

export async function getItem(organizationId: number, itemId: number): Promise<ClearanceItem | undefined> {
  const [row] = await db
    .select()
    .from(clearanceItemsTable)
    .where(and(eq(clearanceItemsTable.id, itemId), eq(clearanceItemsTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

/** Adds an ad-hoc item to a running clearance — something the template did not foresee. */
export async function addItem(params: {
  organizationId: number;
  exitProcessId: number;
  label: string;
  description?: string | null;
  itemType?: ClearanceItem["itemType"];
  required?: boolean;
  responsibleDepartmentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceItem> {
  await assertBelongsToOrganization(
    employeeExitProcessesTable,
    params.exitProcessId,
    params.organizationId,
    "Offboarding",
  );
  if (!params.label.trim()) throw new InvalidClearanceError("An item label is required.");
  if (params.responsibleDepartmentId != null) {
    await assertBelongsToOrganization(
      departmentsTable,
      params.responsibleDepartmentId,
      params.organizationId,
      "Department",
    );
  }

  const [created] = await db
    .insert(clearanceItemsTable)
    .values({
      organizationId: params.organizationId,
      exitProcessId: params.exitProcessId,
      label: params.label.trim(),
      description: params.description ?? null,
      itemType: params.itemType ?? "general",
      required: params.required ?? true,
      responsibleDepartmentId: params.responsibleDepartmentId ?? null,
      status: "pending",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_item.added",
    targetType: "clearance_item",
    targetId: String(created!.id),
    afterState: { exitProcessId: params.exitProcessId, label: created!.label, itemType: created!.itemType },
  });

  return created!;
}

/**
 * Marks a clearance item complete.
 *
 * READ THE HEADER OF THIS FILE BEFORE ADDING ANYTHING HERE. This function writes
 * to `clearance_items` and to the audit log. It must never acquire a side effect
 * on Assets, Office Inventory, Personnel Files, Payroll or Identity.
 */
export async function completeItem(params: {
  organizationId: number;
  itemId: number;
  comment?: string | null;
  evidenceDocumentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceItem> {
  const before = await getItem(params.organizationId, params.itemId);
  if (!before) throw new ClearanceItemNotFoundError();
  if (before.status === "waived") throw new InvalidClearanceError("A waived item cannot be completed.");

  if (params.evidenceDocumentId != null) {
    await assertBelongsToOrganization(
      employeeDocumentsTable,
      params.evidenceDocumentId,
      params.organizationId,
      "Evidence document",
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(clearanceItemsTable)
    .set({
      status: "completed",
      comment: params.comment ?? before.comment,
      evidenceDocumentId: params.evidenceDocumentId ?? before.evidenceDocumentId,
      completedAt: now,
      completedBy: params.actorApplicationUserId,
      returnedReason: null,
    })
    .where(
      and(eq(clearanceItemsTable.id, params.itemId), eq(clearanceItemsTable.organizationId, params.organizationId)),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_item.completed",
    targetType: "clearance_item",
    targetId: String(params.itemId),
    beforeState: { status: before.status },
    afterState: { status: updated!.status, completedAt: updated!.completedAt },
  });

  return updated!;
}

/** Sends an item back to its responsible desk. Never deletes what was recorded. */
export async function returnItem(params: {
  organizationId: number;
  itemId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceItem> {
  const before = await getItem(params.organizationId, params.itemId);
  if (!before) throw new ClearanceItemNotFoundError();
  if (!params.reason.trim()) throw new InvalidClearanceError("A reason is required to return a clearance item.");

  const [updated] = await db
    .update(clearanceItemsTable)
    .set({ status: "returned", returnedReason: params.reason.trim(), completedAt: null, completedBy: null })
    .where(
      and(eq(clearanceItemsTable.id, params.itemId), eq(clearanceItemsTable.organizationId, params.organizationId)),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_item.returned",
    targetType: "clearance_item",
    targetId: String(params.itemId),
    beforeState: { status: before.status },
    afterState: { status: updated!.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated!;
}

/**
 * Waives an item — the deliberate escape hatch, and it costs a reason (§28.8).
 *
 * An organization that genuinely cannot recover a laptop must still be able to
 * close the file. It must never be able to do so silently, which is why the
 * reason is mandatory, is stored on the row, AND is carried into the audit event.
 */
export async function waiveItem(params: {
  organizationId: number;
  itemId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ClearanceItem> {
  const before = await getItem(params.organizationId, params.itemId);
  if (!before) throw new ClearanceItemNotFoundError();
  if (!params.reason || !params.reason.trim()) throw new WaiverReasonRequiredError();

  const now = new Date();
  const [updated] = await db
    .update(clearanceItemsTable)
    .set({ status: "waived", waivedReason: params.reason.trim(), waivedAt: now, waivedBy: params.actorApplicationUserId })
    .where(
      and(eq(clearanceItemsTable.id, params.itemId), eq(clearanceItemsTable.organizationId, params.organizationId)),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "clearance_item.waived",
    targetType: "clearance_item",
    targetId: String(params.itemId),
    beforeState: { status: before.status },
    afterState: { status: updated!.status, waivedAt: updated!.waivedAt },
    metadata: { reason: params.reason.trim(), label: before.label, required: before.required },
  });

  return updated!;
}

// ---------------------------------------------------------------------------
// Observe-only custody summary (§28.9, §28.10)
// ---------------------------------------------------------------------------

export interface OutstandingCustody {
  assets: Array<{ assignmentId: number; assetId: number; assetTag: string | null; assetName: string | null }>;
  inventory: Array<{ movementId: number; itemId: number; itemName: string | null }>;
  personnelFileId: number | null;
}

/**
 * Reports what the departing employee still holds. SELECTS ONLY.
 *
 * This extends the reader WS-11 already shipped as `separation-readiness`
 * (§28.1(5)) rather than inventing a second one, and adds the one filter §28.10
 * requires: office inventory is reported only for `returnable` items. A
 * consumable issued months ago is not an outstanding liability, and listing
 * biros as clearance obligations would produce items nobody can ever satisfy.
 */
export async function summarizeOutstandingCustody(
  organizationId: number,
  employeeId: number,
): Promise<OutstandingCustody> {
  const assets = await db
    .select({
      assignmentId: assetAssignmentsTable.id,
      assetId: assetAssignmentsTable.assetId,
      assetTag: assetAssignmentsTable.assetTagSnapshot,
      assetName: assetAssignmentsTable.assetNameSnapshot,
    })
    .from(assetAssignmentsTable)
    .where(
      and(
        eq(assetAssignmentsTable.organizationId, organizationId),
        eq(assetAssignmentsTable.employeeId, employeeId),
        isNull(assetAssignmentsTable.custodyEndedAt),
      ),
    );

  const inventory = await db
    .select({
      movementId: officeInventoryStockMovementsTable.id,
      itemId: officeInventoryStockMovementsTable.itemId,
      itemName: officeInventoryItemsTable.name,
    })
    .from(officeInventoryStockMovementsTable)
    .innerJoin(
      officeInventoryItemsTable,
      eq(officeInventoryItemsTable.id, officeInventoryStockMovementsTable.itemId),
    )
    .where(
      and(
        eq(officeInventoryStockMovementsTable.organizationId, organizationId),
        eq(officeInventoryStockMovementsTable.holderType, "employee"),
        eq(officeInventoryStockMovementsTable.holderId, employeeId),
        // §28.10 — returnable only.
        eq(officeInventoryItemsTable.classification, "returnable"),
      ),
    );

  const [personnelFile] = await db
    .select({ id: personnelFilesTable.id })
    .from(personnelFilesTable)
    .where(
      and(eq(personnelFilesTable.organizationId, organizationId), eq(personnelFilesTable.employeeId, employeeId)),
    )
    .limit(1);


  return {
    assets,
    inventory,
    personnelFileId: personnelFile?.id ?? null,
  };
}
