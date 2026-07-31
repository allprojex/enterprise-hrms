/**
 * Background Checks (Phase 3A, W56 — Reference & Background Checks):
 * status-tracked tracking, no vendor integration — `vendorReference` is a
 * plain, manually-entered string, never a real provider API call. Never
 * automatically rejects an application, moves the pipeline, creates an
 * offer, or hires/converts a candidate.
 *
 * Deliberately its own dedicated permission pair (`background_check.read`/
 * `.manage`, §7) — organization-wide only, no assigned tier at all (the
 * narrowest row in the whole matrix, §23's own verification line). Holding
 * `application.read`/`.manage` (or even `candidate.read`) never implies
 * background-check access — visibility here is a flat permission check,
 * with no recruiter/hiring-manager narrowing, unlike every other
 * Recruitment resource this phase has built.
 *
 * Status model (§4.7, shared with reference_checks):
 * `requested -> in_progress -> (completed | flagged | unable_to_complete)`.
 * Terminal once completed/flagged/unable_to_complete — no result changes
 * after finalization, and no further evidence upload either.
 */
import { and, eq } from "drizzle-orm";
import { db, applicationsTable, backgroundChecksTable, type BackgroundCheck } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { validateDocumentUpload, InvalidDocumentError } from "./documentValidation";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "./fileStorage";

export class ApplicationNotFoundForBackgroundCheckError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundForBackgroundCheckError";
  }
}

export class BackgroundCheckNotFoundError extends Error {
  constructor() {
    super("Background check not found");
    this.name = "BackgroundCheckNotFoundError";
  }
}

export class InvalidBackgroundCheckError extends Error {}

export class DuplicateBackgroundCheckError extends Error {
  constructor() {
    super("An active background check of this type already exists on this application");
    this.name = "DuplicateBackgroundCheckError";
  }
}

export class BackgroundCheckNotEditableError extends Error {
  constructor() {
    super("A completed, flagged, or unable-to-complete background check is immutable");
    this.name = "BackgroundCheckNotEditableError";
  }
}

export { InvalidDocumentError };

export type ReferenceBackgroundCheckStatus = "requested" | "in_progress" | "completed" | "flagged" | "unable_to_complete";

const TERMINAL_STATUSES: ReferenceBackgroundCheckStatus[] = ["completed", "flagged", "unable_to_complete"];
const ACTIVE_STATUSES: ReferenceBackgroundCheckStatus[] = ["requested", "in_progress"];
const EVIDENCE_SUBDIR = "background-checks";

/**
 * The raw `documentStorageKey` is never exposed to any caller — it's an
 * internal fileStorage.ts reference, not a public URL, and the frontend
 * only ever needs to know whether evidence exists (to show a download
 * link to the dedicated, permission-checked evidence route), never the key
 * itself. Mirrors W55's `PublicInterviewScorecard` precedent of explicitly
 * omitting an internal-only column rather than just spreading the raw row.
 */
export type PublicBackgroundCheck = Omit<BackgroundCheck, "documentStorageKey"> & { hasEvidence: boolean };

function toPublicBackgroundCheck(check: BackgroundCheck): PublicBackgroundCheck {
  const { documentStorageKey, ...rest } = check;
  return { ...rest, hasEvidence: documentStorageKey != null };
}

async function assertApplicationInOrg(organizationId: number, applicationId: number): Promise<void> {
  const [row] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ApplicationNotFoundForBackgroundCheckError();
}

async function findOwnBackgroundCheck(organizationId: number, checkId: number): Promise<BackgroundCheck | null> {
  const [row] = await db
    .select()
    .from(backgroundChecksTable)
    .where(and(eq(backgroundChecksTable.id, checkId), eq(backgroundChecksTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listBackgroundChecks(params: { organizationId: number; applicationId: number }): Promise<PublicBackgroundCheck[]> {
  await assertApplicationInOrg(params.organizationId, params.applicationId);
  const rows = await db
    .select()
    .from(backgroundChecksTable)
    .where(and(eq(backgroundChecksTable.organizationId, params.organizationId), eq(backgroundChecksTable.applicationId, params.applicationId)));
  return rows.map(toPublicBackgroundCheck);
}

export async function createBackgroundCheck(params: {
  organizationId: number;
  applicationId: number;
  checkType: string;
  vendorReference?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicBackgroundCheck> {
  await assertApplicationInOrg(params.organizationId, params.applicationId);

  if (!params.checkType.trim()) {
    throw new InvalidBackgroundCheckError("checkType is required");
  }

  const existing = await db
    .select()
    .from(backgroundChecksTable)
    .where(and(eq(backgroundChecksTable.organizationId, params.organizationId), eq(backgroundChecksTable.applicationId, params.applicationId), eq(backgroundChecksTable.checkType, params.checkType)));
  if (existing.some((c) => ACTIVE_STATUSES.includes(c.status as ReferenceBackgroundCheckStatus))) {
    throw new DuplicateBackgroundCheckError();
  }

  const [row] = await db
    .insert(backgroundChecksTable)
    .values({
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      checkType: params.checkType,
      vendorReference: params.vendorReference ?? null,
      status: "requested",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "background_check.created",
    targetType: "background_check",
    targetId: String(row.id),
    afterState: { applicationId: row.applicationId, checkType: row.checkType, status: row.status },
  });

  return toPublicBackgroundCheck(row);
}

export async function updateBackgroundCheckStatus(params: {
  organizationId: number;
  applicationId: number;
  checkId: number;
  status: "in_progress" | "completed" | "flagged" | "unable_to_complete";
  resultSummary?: string | null;
  vendorReference?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicBackgroundCheck> {
  await assertApplicationInOrg(params.organizationId, params.applicationId);

  const before = await findOwnBackgroundCheck(params.organizationId, params.checkId);
  if (!before || before.applicationId !== params.applicationId) throw new BackgroundCheckNotFoundError();
  if (TERMINAL_STATUSES.includes(before.status as ReferenceBackgroundCheckStatus)) throw new BackgroundCheckNotEditableError();

  const patch: Record<string, unknown> = { status: params.status };
  if (params.resultSummary !== undefined) patch.resultSummary = params.resultSummary;
  if (params.vendorReference !== undefined) patch.vendorReference = params.vendorReference;

  const [updated] = await db.update(backgroundChecksTable).set(patch).where(eq(backgroundChecksTable.id, params.checkId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "background_check.status_changed",
    targetType: "background_check",
    targetId: String(params.checkId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return toPublicBackgroundCheck(updated);
}

export async function attachBackgroundCheckEvidence(params: {
  organizationId: number;
  applicationId: number;
  checkId: number;
  file: { mimetype: string; size: number; buffer: Buffer };
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PublicBackgroundCheck> {
  await assertApplicationInOrg(params.organizationId, params.applicationId);

  const before = await findOwnBackgroundCheck(params.organizationId, params.checkId);
  if (!before || before.applicationId !== params.applicationId) throw new BackgroundCheckNotFoundError();
  if (TERMINAL_STATUSES.includes(before.status as ReferenceBackgroundCheckStatus)) throw new BackgroundCheckNotEditableError();

  const extension = validateDocumentUpload(params.file);
  const storageKey = await writeOrgFile(params.organizationId, EVIDENCE_SUBDIR, extension, params.file.buffer);

  if (before.documentStorageKey) {
    await deleteOrgFile(params.organizationId, before.documentStorageKey);
  }

  const [updated] = await db.update(backgroundChecksTable).set({ documentStorageKey: storageKey }).where(eq(backgroundChecksTable.id, params.checkId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "background_check.evidence_attached",
    targetType: "background_check",
    targetId: String(params.checkId),
    afterState: { hasEvidence: true },
  });

  return toPublicBackgroundCheck(updated);
}

export async function readBackgroundCheckEvidence(params: { organizationId: number; applicationId: number; checkId: number }): Promise<{ buffer: Buffer; storageKey: string } | null> {
  await assertApplicationInOrg(params.organizationId, params.applicationId);
  const check = await findOwnBackgroundCheck(params.organizationId, params.checkId);
  if (!check || check.applicationId !== params.applicationId || !check.documentStorageKey) return null;
  const buffer = await readOrgFile(params.organizationId, check.documentStorageKey);
  return { buffer, storageKey: check.documentStorageKey };
}
