/**
 * Learning Enrollment Evidence (Phase 3D, W90 — Certificates & Evidence):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §18/§21/§29 W90.
 *
 * `learning_enrollment_evidence` is, per its own W85 schema-file comment,
 * "a lightweight join table only" — it points into the EXISTING
 * `employee_documents` table (`lib/employeeDocuments.ts`, Phase 2A) via
 * the EXISTING `fileStorage.ts`/`documentValidation.ts` layer, mirroring
 * `performanceReviewEvidence.ts`'s own W82 architecture verbatim: same
 * file-type allowlist, same 10MB cap, same signature validation, same
 * server-generated storage keys, same authenticated-only streamed
 * download. No new storage provider, no new upload/download
 * infrastructure of any kind.
 *
 * VISIBILITY, taken literally from §21's own frozen table row
 * ("GET, POST | same visibility tier as the enrollment itself"): unlike
 * Performance's own W82 (which added a review-stage gate as a disclosed,
 * not-frozen interpretation), Learning's frozen text names no stage/
 * status restriction at all — own / manager-of-record / instructor-of-
 * record / org-wide may both read AND upload, at any enrollment status,
 * identical to the read tier GET .../enrollments/:id already resolves
 * (W87). This is a deliberate divergence from the Performance precedent,
 * not an oversight: the frozen table's own words for Learning simply
 * don't carry a stage qualifier the way Performance's own (not-frozen)
 * discipline invented one.
 *
 * The created `employee_documents` row is always filed under the
 * enrollment's own employeeId (the trainee), regardless of which
 * authorized actor uploaded it — the same "filed under the record's own
 * subject" precedent performanceReviewEvidence.ts already established.
 *
 * NO DELETE ROUTE: §21 names no delete/remove behavior for evidence, so
 * none is built here.
 *
 * AUDIT: reuses the real, already-frozen `employee_document.uploaded`
 * event (Phase 2A) for the document-creation half, plus one new event,
 * `learning_enrollment.evidence_attached`, modeled directly on
 * performanceReviewEvidence.ts's own identical-shaped
 * `performance_review.evidence_attached` sibling precedent — disclosed
 * here as a naming decision, not a frozen-literal one (§21/§29 name no
 * exact event string).
 */
import { and, eq, desc } from "drizzle-orm";
import { db, learningEnrollmentEvidenceTable, employeeDocumentsTable, type LearningEnrollment } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { writeOrgFile, deleteOrgFile } from "./fileStorage";
import { validateDocumentUpload, InvalidDocumentError } from "./documentValidation";
import { isOwnLearningRecord, isManagerOfRecord } from "./learningAuthorization";
import { getEnrollment, isCallerInstructorOfRecord, LearningEnrollmentNotFoundError } from "./learningEnrollments";

export { LearningEnrollmentNotFoundError, InvalidDocumentError };

/** The document_category Master Data code Learning's own evidence uploads register under (§18's own "an implementation detail for the owning workstream" note). */
export const LEARNING_EVIDENCE_CATEGORY = "learning_evidence";

export class LearningEvidenceForbiddenError extends Error {
  constructor(message = "Not authorized to act on this enrollment's evidence") {
    super(message);
    this.name = "LearningEvidenceForbiddenError";
  }
}

export interface EvidenceEnrollmentRelationship {
  enrollment: LearningEnrollment;
  isOrgWide: boolean;
  isOwn: boolean;
  isManager: boolean;
  isInstructor: boolean;
}

/** Resolves the caller's relationship to an enrollment once — shared by list/download/upload, identical dispatch to GET .../enrollments/:id (W87). */
export async function resolveEvidenceEnrollmentRelationship(
  organizationId: number,
  enrollmentId: number,
  callerEmployeeId: number | null,
  isOrgWide: boolean,
): Promise<EvidenceEnrollmentRelationship | null> {
  const enrollment = await getEnrollment(organizationId, enrollmentId);
  if (!enrollment) return null;
  const isOwn = isOwnLearningRecord(callerEmployeeId, enrollment.employeeId);
  const isManager = isManagerOfRecord(callerEmployeeId, enrollment.managerEmployeeIdSnapshot);
  let isInstructor = false;
  if (!isOrgWide && !isOwn && !isManager) {
    isInstructor = await isCallerInstructorOfRecord(organizationId, enrollment, callerEmployeeId);
  }
  return { enrollment, isOrgWide, isOwn, isManager, isInstructor };
}

export interface EvidenceWithDocument {
  id: number;
  organizationId: number;
  enrollmentId: number;
  employeeDocumentId: number;
  addedByMembershipId: number | null;
  addedAt: Date;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: number | null;
}

/** Org-scoped, enrollment-scoped evidence with its joined employee_documents metadata, most recently added first. */
export async function listEvidenceForEnrollment(organizationId: number, enrollmentId: number): Promise<EvidenceWithDocument[]> {
  return db
    .select({
      id: learningEnrollmentEvidenceTable.id,
      organizationId: learningEnrollmentEvidenceTable.organizationId,
      enrollmentId: learningEnrollmentEvidenceTable.enrollmentId,
      employeeDocumentId: learningEnrollmentEvidenceTable.employeeDocumentId,
      addedByMembershipId: learningEnrollmentEvidenceTable.addedByMembershipId,
      addedAt: learningEnrollmentEvidenceTable.addedAt,
      fileName: employeeDocumentsTable.fileName,
      mimeType: employeeDocumentsTable.mimeType,
      fileSize: employeeDocumentsTable.fileSize,
      uploadedBy: employeeDocumentsTable.uploadedBy,
    })
    .from(learningEnrollmentEvidenceTable)
    .innerJoin(employeeDocumentsTable, eq(learningEnrollmentEvidenceTable.employeeDocumentId, employeeDocumentsTable.id))
    .where(and(eq(learningEnrollmentEvidenceTable.organizationId, organizationId), eq(learningEnrollmentEvidenceTable.enrollmentId, enrollmentId)))
    .orderBy(desc(learningEnrollmentEvidenceTable.addedAt));
}

/** A single evidence row, its document metadata, and its storage key — for the authorization-checked download route only (storageKey never otherwise leaves this file). */
export async function getEvidenceForDownload(organizationId: number, enrollmentId: number, evidenceId: number) {
  const [row] = await db
    .select({
      id: learningEnrollmentEvidenceTable.id,
      fileName: employeeDocumentsTable.fileName,
      mimeType: employeeDocumentsTable.mimeType,
      storageKey: employeeDocumentsTable.storageKey,
    })
    .from(learningEnrollmentEvidenceTable)
    .innerJoin(employeeDocumentsTable, eq(learningEnrollmentEvidenceTable.employeeDocumentId, employeeDocumentsTable.id))
    .where(
      and(
        eq(learningEnrollmentEvidenceTable.id, evidenceId),
        eq(learningEnrollmentEvidenceTable.enrollmentId, enrollmentId),
        eq(learningEnrollmentEvidenceTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Validates the upload (identical rigor to every other document upload
 * on this platform), writes the file, then creates the employee_documents
 * row and the learning_enrollment_evidence join row together in one
 * transaction. If the transaction fails, the already-written file is
 * deleted (compensating cleanup) so storage and the database can never
 * disagree.
 */
export async function addEvidence(params: {
  organizationId: number;
  enrollmentId: number;
  callerEmployeeId: number | null;
  isOrgWide: boolean;
  file: { mimetype: string; size: number; buffer: Buffer; originalname: string };
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EvidenceWithDocument> {
  const rel = await resolveEvidenceEnrollmentRelationship(params.organizationId, params.enrollmentId, params.callerEmployeeId, params.isOrgWide);
  if (!rel) throw new LearningEnrollmentNotFoundError();
  if (!rel.isOrgWide && !rel.isOwn && !rel.isManager && !rel.isInstructor) {
    throw new LearningEvidenceForbiddenError();
  }

  const extension = validateDocumentUpload(params.file);
  const storageKey = await writeOrgFile(params.organizationId, "documents", extension, params.file.buffer);

  try {
    const { document, evidence } = await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(employeeDocumentsTable)
        .values({
          organizationId: params.organizationId,
          employeeId: rel.enrollment.employeeId,
          categoryCode: LEARNING_EVIDENCE_CATEGORY,
          fileName: params.file.originalname,
          storageKey,
          mimeType: params.file.mimetype,
          fileSize: params.file.size,
          uploadedBy: params.actorApplicationUserId,
        })
        .returning();

      const [evidence] = await tx
        .insert(learningEnrollmentEvidenceTable)
        .values({
          organizationId: params.organizationId,
          enrollmentId: params.enrollmentId,
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
      targetId: String(rel.enrollment.employeeId),
      metadata: { documentId: document.id, categoryCode: document.categoryCode, fileName: document.fileName },
    });
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "learning_enrollment.evidence_attached",
      targetType: "learning_enrollment",
      targetId: String(params.enrollmentId),
      metadata: { evidenceId: evidence.id, employeeDocumentId: document.id, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.fileSize },
    });

    return {
      id: evidence.id,
      organizationId: evidence.organizationId,
      enrollmentId: evidence.enrollmentId,
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
