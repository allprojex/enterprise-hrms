/**
 * Reference Checks (Phase 3A, W56 — Reference & Background Checks):
 * status-tracked, no vendor integration. Never automatically rejects an
 * application, moves the pipeline, creates an offer, or hires/converts a
 * candidate — a check informs later decisions, it does not make them.
 *
 * No dedicated `reference_check.*` permission exists in §7's matrix —
 * visibility/write reuse the existing `application.read`/`.manage` pair
 * (assigned recruiter/hiring manager + organization-wide), reusing
 * `applicationPipeline.ts`'s own visibility resolver directly rather than
 * re-deriving the candidate->vacancy->requisition chain a second time.
 *
 * Status model (§4.7, shared with background_checks):
 * `requested -> in_progress -> (completed | flagged | unable_to_complete)`.
 * Terminal once completed/flagged/unable_to_complete — no further
 * transition, matching "a submitted scorecard cannot be silently replaced"
 * (W55) discipline extended to this resource: no result changes after
 * finalization.
 */
import { and, eq } from "drizzle-orm";
import { db, referenceChecksTable, type ReferenceCheck } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getVisibleApplicationById, type ApplicationVisibilityContext } from "./applicationPipeline";

export class ApplicationNotFoundForCheckError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundForCheckError";
  }
}

export class ReferenceCheckNotFoundError extends Error {
  constructor() {
    super("Reference check not found");
    this.name = "ReferenceCheckNotFoundError";
  }
}

export class InvalidReferenceCheckError extends Error {}

export class DuplicateReferenceCheckError extends Error {
  constructor() {
    super("An active reference check for this referee already exists on this application");
    this.name = "DuplicateReferenceCheckError";
  }
}

export class ReferenceCheckNotEditableError extends Error {
  constructor() {
    super("A completed, flagged, or unable-to-complete reference check is immutable");
    this.name = "ReferenceCheckNotEditableError";
  }
}

export type ReferenceBackgroundCheckStatus = "requested" | "in_progress" | "completed" | "flagged" | "unable_to_complete";

const TERMINAL_STATUSES: ReferenceBackgroundCheckStatus[] = ["completed", "flagged", "unable_to_complete"];
const ACTIVE_STATUSES: ReferenceBackgroundCheckStatus[] = ["requested", "in_progress"];

async function assertApplicationVisible(organizationId: number, applicationId: number, visibility: ApplicationVisibilityContext): Promise<void> {
  const application = await getVisibleApplicationById(organizationId, applicationId, visibility);
  if (!application) throw new ApplicationNotFoundForCheckError();
}

async function findOwnReferenceCheck(organizationId: number, checkId: number): Promise<ReferenceCheck | null> {
  const [row] = await db
    .select()
    .from(referenceChecksTable)
    .where(and(eq(referenceChecksTable.id, checkId), eq(referenceChecksTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listReferenceChecks(params: { organizationId: number; applicationId: number; visibility: ApplicationVisibilityContext }): Promise<ReferenceCheck[]> {
  await assertApplicationVisible(params.organizationId, params.applicationId, params.visibility);
  return db
    .select()
    .from(referenceChecksTable)
    .where(and(eq(referenceChecksTable.organizationId, params.organizationId), eq(referenceChecksTable.applicationId, params.applicationId)));
}

export async function createReferenceCheck(params: {
  organizationId: number;
  applicationId: number;
  visibility: ApplicationVisibilityContext;
  refereeName: string;
  refereeContact: string;
  refereeRelationship?: string | null;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ReferenceCheck> {
  await assertApplicationVisible(params.organizationId, params.applicationId, params.visibility);

  if (!params.refereeName.trim() || !params.refereeContact.trim()) {
    throw new InvalidReferenceCheckError("refereeName and refereeContact are required");
  }

  const existingActive = await db
    .select()
    .from(referenceChecksTable)
    .where(
      and(
        eq(referenceChecksTable.organizationId, params.organizationId),
        eq(referenceChecksTable.applicationId, params.applicationId),
        eq(referenceChecksTable.refereeContact, params.refereeContact),
      ),
    );
  if (existingActive.some((r) => ACTIVE_STATUSES.includes(r.status as ReferenceBackgroundCheckStatus))) {
    throw new DuplicateReferenceCheckError();
  }

  const [row] = await db
    .insert(referenceChecksTable)
    .values({
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      refereeName: params.refereeName,
      refereeContact: params.refereeContact,
      refereeRelationship: params.refereeRelationship ?? null,
      notes: params.notes ?? null,
      status: "requested",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "reference_check.created",
    targetType: "reference_check",
    targetId: String(row.id),
    afterState: { applicationId: row.applicationId, status: row.status },
  });

  return row;
}

export async function updateReferenceCheckStatus(params: {
  organizationId: number;
  applicationId: number;
  checkId: number;
  visibility: ApplicationVisibilityContext;
  status: "in_progress" | "completed" | "flagged" | "unable_to_complete";
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ReferenceCheck> {
  await assertApplicationVisible(params.organizationId, params.applicationId, params.visibility);

  const before = await findOwnReferenceCheck(params.organizationId, params.checkId);
  if (!before || before.applicationId !== params.applicationId) throw new ReferenceCheckNotFoundError();
  if (TERMINAL_STATUSES.includes(before.status as ReferenceBackgroundCheckStatus)) throw new ReferenceCheckNotEditableError();

  const isTerminal = TERMINAL_STATUSES.includes(params.status);
  const patch: Record<string, unknown> = { status: params.status };
  if (params.notes !== undefined) patch.notes = params.notes;
  if (isTerminal) patch.completedAt = new Date();

  const [updated] = await db.update(referenceChecksTable).set(patch).where(eq(referenceChecksTable.id, params.checkId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "reference_check.status_changed",
    targetType: "reference_check",
    targetId: String(params.checkId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}
