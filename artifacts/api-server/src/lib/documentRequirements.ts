/**
 * WS-5 (§12-14, §43-44) — the shared required/provided/verified/expiry
 * checklist primitive.
 *
 * This is deliberately a *primitive*, not a workflow. It answers exactly one
 * question per row — "is this category of document required for this owner,
 * and what is its current state?" — and knows nothing about hiring stages,
 * onboarding steps, approval routing, or notifications. WS-9/WS-10/WS-12
 * compose their own checklists out of these rows; WS-6 reads the expiry
 * query below to decide what to remind about. Neither is built here (§12,
 * §14).
 *
 * The central rule (§13): PROVIDED and VERIFIED are different facts, and
 * uploading is never verification. `markProvided` records that a document
 * arrived and links the row that satisfied it; only `verify` — behind its
 * own narrow permission — can move a requirement to `verified`.
 */
import { and, eq, lte, gte, sql, type SQL } from "drizzle-orm";
import { db, documentRequirementsTable, type DocumentRequirement } from "@workspace/db";
import { assertUsableCategory, getCategoryBehavior } from "./documentCategories";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export type RequirementOwnerType = "employee" | "candidate" | "organization";

export class DocumentRequirementNotFoundError extends Error {
  constructor() {
    super("Document requirement not found");
    this.name = "DocumentRequirementNotFoundError";
  }
}

export class DuplicateRequirementError extends Error {
  constructor() {
    super("This owner already has a requirement for that document category");
    this.name = "DuplicateRequirementError";
  }
}

export class ExpiryDateRequiredError extends Error {
  constructor() {
    super("This document category requires an expiry date");
    this.name = "ExpiryDateRequiredError";
  }
}

export class ExpiryNotSupportedError extends Error {
  constructor() {
    super("This document category does not support an expiry date");
    this.name = "ExpiryNotSupportedError";
  }
}

/** Declares that an owner must provide a document of some category. */
export async function createRequirement(params: {
  organizationId: number;
  ownerType: RequirementOwnerType;
  ownerId: number;
  categoryCode: string;
  required?: boolean;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentRequirement> {
  await assertUsableCategory(params.organizationId, params.categoryCode);

  let row: DocumentRequirement;
  try {
    [row] = await db
      .insert(documentRequirementsTable)
      .values({
        organizationId: params.organizationId,
        ownerType: params.ownerType,
        ownerId: params.ownerId,
        categoryCode: params.categoryCode,
        required: params.required ?? true,
        notes: params.notes ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateRequirementError();
    throw err;
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_requirement.created",
    targetType: "document_requirement",
    targetId: String(row.id),
    afterState: row,
  });

  return row;
}

export async function listRequirements(
  organizationId: number,
  filters: { ownerType?: RequirementOwnerType; ownerId?: number; status?: DocumentRequirement["status"] } = {},
): Promise<DocumentRequirement[]> {
  const conditions: SQL[] = [eq(documentRequirementsTable.organizationId, organizationId)];
  if (filters.ownerType) conditions.push(eq(documentRequirementsTable.ownerType, filters.ownerType));
  if (filters.ownerId !== undefined) conditions.push(eq(documentRequirementsTable.ownerId, filters.ownerId));
  if (filters.status) conditions.push(eq(documentRequirementsTable.status, filters.status));
  return db.select().from(documentRequirementsTable).where(and(...conditions));
}

export async function getRequirement(organizationId: number, requirementId: number): Promise<DocumentRequirement | null> {
  const [row] = await db
    .select()
    .from(documentRequirementsTable)
    .where(and(eq(documentRequirementsTable.organizationId, organizationId), eq(documentRequirementsTable.id, requirementId)))
    .limit(1);
  return row ?? null;
}

/**
 * Records that a document was supplied against a requirement, pointing at
 * the row that satisfied it.
 *
 * The resulting status is `provided` — never `verified`, even when the
 * category needs no verification. Whether a `provided` requirement counts as
 * satisfied for a given workflow is that workflow's judgment to make from
 * the category's `verificationRequired` flag, not a state this primitive
 * decides on its behalf (§13).
 */
export async function markProvided(params: {
  organizationId: number;
  requirementId: number;
  fulfilledDocumentTable: string;
  fulfilledDocumentId: number;
  expiryDate?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentRequirement> {
  const before = await getRequirement(params.organizationId, params.requirementId);
  if (!before) throw new DocumentRequirementNotFoundError();

  const behavior = await getCategoryBehavior(params.organizationId, before.categoryCode);
  if (params.expiryDate && !behavior.expirySupported) throw new ExpiryNotSupportedError();
  if (behavior.expiryRequired && !params.expiryDate) throw new ExpiryDateRequiredError();

  const [row] = await db
    .update(documentRequirementsTable)
    .set({
      status: "provided",
      fulfilledDocumentTable: params.fulfilledDocumentTable,
      fulfilledDocumentId: params.fulfilledDocumentId,
      expiryDate: params.expiryDate ?? null,
      // A re-submission after rejection clears the prior decision — the new
      // document has not been judged yet.
      rejectionReason: null,
      verifiedBy: null,
      verifiedAt: null,
    })
    .where(eq(documentRequirementsTable.id, params.requirementId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "document_requirement.provided",
    targetType: "document_requirement",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
  });

  return row;
}

/**
 * The verification decision (§13). Reaching this function at all requires
 * `document.verify`; the caller is recorded, so "who accepted this
 * document" is answerable later.
 */
export async function verifyRequirement(params: {
  organizationId: number;
  requirementId: number;
  approved: boolean;
  rejectionReason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<DocumentRequirement> {
  const before = await getRequirement(params.organizationId, params.requirementId);
  if (!before) throw new DocumentRequirementNotFoundError();

  const [row] = await db
    .update(documentRequirementsTable)
    .set({
      status: params.approved ? "verified" : "rejected",
      verifiedBy: params.actorApplicationUserId,
      verifiedAt: new Date(),
      rejectionReason: params.approved ? null : (params.rejectionReason ?? null),
    })
    .where(eq(documentRequirementsTable.id, params.requirementId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.approved ? "document_requirement.verified" : "document_requirement.rejected",
    targetType: "document_requirement",
    targetId: String(row.id),
    beforeState: before,
    afterState: row,
  });

  return row;
}

export interface ExpiryQueryResult {
  expired: DocumentRequirement[];
  expiringSoon: DocumentRequirement[];
  missing: DocumentRequirement[];
}

/**
 * §44's expiry query contract — the clean service call WS-6 will consume to
 * decide what needs a reminder. It only reports; it sends nothing (§14).
 *
 * `asOf` and `horizonDays` are explicit parameters rather than an implicit
 * `now()` so date-boundary behavior is deterministic and directly testable.
 * The two windows are half-open and disjoint: `expired` is strictly before
 * `asOf`, `expiringSoon` is `asOf` through `asOf + horizonDays` inclusive —
 * so a document expiring exactly today appears in `expiringSoon` and never
 * in both lists.
 */
export async function queryExpiryState(
  organizationId: number,
  asOf: string,
  horizonDays = 30,
): Promise<ExpiryQueryResult> {
  const horizon = new Date(asOf);
  horizon.setDate(horizon.getDate() + horizonDays);
  const horizonDate = horizon.toISOString().slice(0, 10);

  const scoped = (extra: SQL) =>
    and(eq(documentRequirementsTable.organizationId, organizationId), extra) as SQL;

  const [expired, expiringSoon, missing] = await Promise.all([
    db
      .select()
      .from(documentRequirementsTable)
      .where(
        scoped(
          and(
            sql`${documentRequirementsTable.expiryDate} is not null`,
            sql`${documentRequirementsTable.expiryDate} < ${asOf}`,
          ) as SQL,
        ),
      ),
    db
      .select()
      .from(documentRequirementsTable)
      .where(
        scoped(
          and(
            gte(documentRequirementsTable.expiryDate, asOf),
            lte(documentRequirementsTable.expiryDate, horizonDate),
          ) as SQL,
        ),
      ),
    db
      .select()
      .from(documentRequirementsTable)
      .where(
        scoped(
          and(
            eq(documentRequirementsTable.required, true),
            eq(documentRequirementsTable.status, "pending"),
          ) as SQL,
        ),
      ),
  ]);

  return { expired, expiringSoon, missing };
}
