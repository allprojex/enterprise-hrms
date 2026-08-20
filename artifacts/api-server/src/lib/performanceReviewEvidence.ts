/**
 * Performance Evidence / Attachments (Phase 3C, W82):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.9/§24/§35's own row.
 *
 * `performance_review_evidence` is, per §8.9's own words, "a lightweight
 * join table only" — it points into the EXISTING `employee_documents` table
 * (`lib/employeeDocuments.ts`, Phase 2A) via `employeeDocumentId`. W73
 * created the join table with explicitly "no upload API, no storage-
 * provider behavior" (see that table's own schema-file comment) — this is
 * the workstream that wires it up. There is deliberately no second storage
 * layer, no Performance-specific storage provider, and no new file-storage
 * code anywhere in this file: every byte is written/read through the same
 * `writeOrgFile`/`readOrgFile`/`validateDocumentUpload` primitives every
 * other document upload on this platform already uses.
 *
 * Because a plain employee or a manager (reviewer-of-record) holds neither
 * of the existing `employee.write`/`employee.read` keys the EXISTING
 * `/employees/:employeeId/documents` routes require, this workstream owns
 * its own combined "create the employee_documents row + attach it to the
 * review" action, authorized entirely through Performance's own existing
 * permission keys (no new key). The created `employee_documents` row is
 * filed under the REVIEW'S OWN employeeId (the reviewee) regardless of
 * which authorized actor uploaded it — it is evidence supporting that
 * employee's review, the same way it would read in their personnel file.
 *
 * STAGE GATING — A DISCLOSED INTERPRETATION: §8.9 defines the schema only;
 * no stage-gating rule for evidence appears anywhere in the frozen plan.
 * Absent a frozen rule, this file applies the same "each actor may act only
 * during their own active stage" discipline §10.2's own editability table
 * already establishes for every other actor/field in this review lifecycle
 * (employee edits during self_assessment, reviewer during manager_review) —
 * extended with the one further, symmetric step HR's own active stage
 * implies: employee upload requires performance.write.own + own review +
 * status = self_assessment; reviewer upload requires performance.review.write
 * + reviewer-of-record + status = manager_review; HR upload requires
 * performance.manage (the plan's own "org-wide" signal used everywhere else
 * in Performance, per §27 line 142 — not performance.finalize, which is
 * scoped narrowly to the finalize/override action only) + status =
 * hr_review. Once a review moves to finalized/acknowledged, no actor can
 * add evidence through any route — durable historical record, satisfied
 * structurally by this same stage gate, not a separate rule. Reopening
 * (W79) never touches this table at all (only review-row timestamp/decision
 * columns are cleared), so existing evidence is always preserved, and
 * upload re-opens automatically once status returns to an eligible stage.
 *
 * VIEW ACCESS IS NOT STAGE-GATED — evidence remains visible to every
 * relationship tier (own/reviewer-of-record/org-wide) at every stage,
 * including after finalization, matching every other read surface in this
 * workstream's own review-detail precedent.
 *
 * NO DELETE ROUTE: the frozen plan names no delete/remove behavior for
 * evidence anywhere (§8.9, §22, §27 are all silent), so none is built —
 * matching the master brief's own "if frozen plan contains no delete
 * behavior, do not invent a DELETE route" instruction.
 *
 * AUDIT — TWO EVENTS, NEITHER PURELY INVENTED: §22's own corrected event
 * list has no evidence-specific entry at all. Rather than invent one from
 * nothing, this reuses the REAL, already-frozen `employee_document.uploaded`
 * event (Phase 2A) for the document-creation half of this action (a real
 * employee_documents row IS created), and adds one new event,
 * `performance_review.evidence_attached`, modeled directly on this exact
 * codebase's own sibling precedent for the same concept —
 * `background_check.evidence_attached` (lib/backgroundChecks.ts) — for the
 * genuinely-new "attached to a review" half. Flagged here as a disclosed
 * naming decision, not a frozen-literal one.
 */
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewEvidenceTable,
  employeeDocumentsTable,
  type PerformanceReview,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { writeOrgFile, deleteOrgFile } from "./fileStorage";
import { validateDocumentUpload, InvalidDocumentError } from "./documentValidation";
import { PerformanceReviewNotFoundError } from "./performanceCycles";
import { PerformanceGoalNotFoundError } from "./performanceReviewGoals";
import { isOwnPerformanceRecord, isReviewerOfRecord } from "./performanceAuthorization";

export { PerformanceReviewNotFoundError, PerformanceGoalNotFoundError, InvalidDocumentError };

/** The document_category Master Data code registered for Performance evidence (§8.9's own literal example). */
export const PERFORMANCE_EVIDENCE_CATEGORY = "performance_evidence";

export class PerformanceEvidenceNotFoundError extends Error {
  constructor() {
    super("Evidence not found");
    this.name = "PerformanceEvidenceNotFoundError";
  }
}

export class PerformanceEvidenceForbiddenError extends Error {
  constructor(message = "Not authorized to act on this review's evidence") {
    super(message);
    this.name = "PerformanceEvidenceForbiddenError";
  }
}

/** Stage-gate violation — a controlled business-rule 409, mirroring performanceReviewGoals.ts's identical PerformanceGoalStageError shape. */
export class PerformanceEvidenceStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceEvidenceStageError";
  }
}

export interface EvidenceWithDocument {
  id: number;
  organizationId: number;
  reviewId: number;
  goalId: number | null;
  employeeDocumentId: number;
  addedByMembershipId: number | null;
  addedAt: Date;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: number | null;
}

async function findReview(organizationId: number, reviewId: number): Promise<PerformanceReview | null> {
  const [row] = await db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.id, reviewId), eq(performanceReviewsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface EvidenceReviewRelationship {
  review: PerformanceReview;
  isOrgWide: boolean;
  isOwn: boolean;
  isReviewer: boolean;
}

/** Resolves the caller's relationship to a review once — shared by list/download/upload so each only fetches the review a single time. */
export async function resolveEvidenceReviewRelationship(
  organizationId: number,
  reviewId: number,
  callerEmployeeId: number | null,
  isOrgWide: boolean,
): Promise<EvidenceReviewRelationship | null> {
  const review = await findReview(organizationId, reviewId);
  if (!review) return null;
  return {
    review,
    isOrgWide,
    isOwn: isOwnPerformanceRecord(callerEmployeeId, review.employeeId),
    isReviewer: isReviewerOfRecord(callerEmployeeId, review.reviewerEmployeeId),
  };
}

/** Org-scoped, review-scoped evidence with its joined employee_documents metadata, most recently added first. */
export async function listEvidenceForReview(organizationId: number, reviewId: number): Promise<EvidenceWithDocument[]> {
  return db
    .select({
      id: performanceReviewEvidenceTable.id,
      organizationId: performanceReviewEvidenceTable.organizationId,
      reviewId: performanceReviewEvidenceTable.reviewId,
      goalId: performanceReviewEvidenceTable.goalId,
      employeeDocumentId: performanceReviewEvidenceTable.employeeDocumentId,
      addedByMembershipId: performanceReviewEvidenceTable.addedByMembershipId,
      addedAt: performanceReviewEvidenceTable.addedAt,
      fileName: employeeDocumentsTable.fileName,
      mimeType: employeeDocumentsTable.mimeType,
      fileSize: employeeDocumentsTable.fileSize,
      uploadedBy: employeeDocumentsTable.uploadedBy,
    })
    .from(performanceReviewEvidenceTable)
    .innerJoin(employeeDocumentsTable, eq(performanceReviewEvidenceTable.employeeDocumentId, employeeDocumentsTable.id))
    .where(and(eq(performanceReviewEvidenceTable.organizationId, organizationId), eq(performanceReviewEvidenceTable.reviewId, reviewId)))
    .orderBy(desc(performanceReviewEvidenceTable.addedAt));
}

/** A single evidence row, its document metadata, and its storage key — for the authorization-checked download route only (storageKey never otherwise leaves this file). */
export async function getEvidenceForDownload(organizationId: number, reviewId: number, evidenceId: number) {
  const [row] = await db
    .select({
      id: performanceReviewEvidenceTable.id,
      fileName: employeeDocumentsTable.fileName,
      mimeType: employeeDocumentsTable.mimeType,
      storageKey: employeeDocumentsTable.storageKey,
    })
    .from(performanceReviewEvidenceTable)
    .innerJoin(employeeDocumentsTable, eq(performanceReviewEvidenceTable.employeeDocumentId, employeeDocumentsTable.id))
    .where(
      and(
        eq(performanceReviewEvidenceTable.id, evidenceId),
        eq(performanceReviewEvidenceTable.reviewId, reviewId),
        eq(performanceReviewEvidenceTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function assertUploadStageAllowed(rel: EvidenceReviewRelationship): void {
  const { review, isOrgWide, isOwn, isReviewer } = rel;
  const allowed = (isOwn && review.status === "self_assessment") || (isReviewer && review.status === "manager_review") || (isOrgWide && review.status === "hr_review");
  if (allowed) return;

  if (!isOwn && !isReviewer && !isOrgWide) {
    throw new PerformanceEvidenceForbiddenError();
  }
  throw new PerformanceEvidenceStageError(`Evidence cannot be added while this review is "${review.status}"`);
}

/**
 * Validates the upload (same signature-checked rigor as every other
 * document upload), writes the file, then creates the employee_documents
 * row and the performance_review_evidence join row together in one
 * transaction. If the transaction fails for any reason, the already-written
 * file is deleted (compensating cleanup) so storage and the database can
 * never disagree — no orphaned file, no join row pointing at a document
 * that was never actually created.
 */
export async function addEvidence(params: {
  organizationId: number;
  reviewId: number;
  goalId?: number;
  callerEmployeeId: number | null;
  isOrgWide: boolean;
  file: { mimetype: string; size: number; buffer: Buffer; originalname: string };
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EvidenceWithDocument> {
  const rel = await resolveEvidenceReviewRelationship(params.organizationId, params.reviewId, params.callerEmployeeId, params.isOrgWide);
  if (!rel) throw new PerformanceReviewNotFoundError();
  assertUploadStageAllowed(rel);

  if (params.goalId != null) {
    const [goal] = await db
      .select({ id: performanceReviewGoalsTable.id })
      .from(performanceReviewGoalsTable)
      .where(and(eq(performanceReviewGoalsTable.id, params.goalId), eq(performanceReviewGoalsTable.reviewId, params.reviewId), eq(performanceReviewGoalsTable.organizationId, params.organizationId)))
      .limit(1);
    if (!goal) throw new PerformanceGoalNotFoundError();
  }

  const extension = validateDocumentUpload(params.file);
  const storageKey = await writeOrgFile(params.organizationId, "documents", extension, params.file.buffer);

  try {
    const { document, evidence } = await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(employeeDocumentsTable)
        .values({
          organizationId: params.organizationId,
          employeeId: rel.review.employeeId,
          categoryCode: PERFORMANCE_EVIDENCE_CATEGORY,
          fileName: params.file.originalname,
          storageKey,
          mimeType: params.file.mimetype,
          fileSize: params.file.size,
          uploadedBy: params.actorApplicationUserId,
        })
        .returning();

      const [evidence] = await tx
        .insert(performanceReviewEvidenceTable)
        .values({
          organizationId: params.organizationId,
          reviewId: params.reviewId,
          goalId: params.goalId ?? null,
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
      targetType: "employee",
      targetId: String(rel.review.employeeId),
      metadata: { documentId: document.id, categoryCode: document.categoryCode, fileName: document.fileName },
    });
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "performance_review.evidence_attached",
      targetType: "performance_review",
      targetId: String(params.reviewId),
      metadata: { evidenceId: evidence.id, employeeDocumentId: document.id, goalId: evidence.goalId, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.fileSize },
    });

    return {
      id: evidence.id,
      organizationId: evidence.organizationId,
      reviewId: evidence.reviewId,
      goalId: evidence.goalId,
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
