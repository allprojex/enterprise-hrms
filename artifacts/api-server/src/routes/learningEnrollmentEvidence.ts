/**
 * Learning Enrollment Evidence (Phase 3D, W90 — Certificates & Evidence):
 * see lib/learningEnrollmentEvidence.ts's own file header for the full
 * architecture (reuses the EXISTING employee_documents storage layer,
 * no new file-storage code) and the disclosed visibility/audit-naming
 * decisions. No new permission key — every route below is gated by the
 * union of learning.write.own / learning.review.write / learning.manage
 * (coarse floor), with fine-grained own/manager-of-record/instructor-of-
 * record/org-wide scoping resolved inside the handler, mirroring
 * performanceReviewEvidence.ts's own established "coarse gate +
 * fine-grained check" precedent.
 */
import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { readOrgFile } from "../lib/fileStorage";
import { LEARNING_MODULE_KEY, resolveLearningActorEmployeeId, hasOrgWideLearningAccess } from "../lib/learningAuthorization";
import {
  addEvidence,
  listEvidenceForEnrollment,
  getEvidenceForDownload,
  resolveEvidenceEnrollmentRelationship,
  LearningEnrollmentNotFoundError,
  LearningEvidenceForbiddenError,
  InvalidDocumentError,
} from "../lib/learningEnrollmentEvidence";

const router = Router();

// Same 10MB ceiling as every other document upload on this platform —
// validateDocumentUpload enforces the same limit again from the actual
// file bytes; this is just multer's own outer bound.
const uploadEvidence = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** Converts a MulterError (e.g. LIMIT_FILE_SIZE) into the same res.status(400).json({error}) shape every other validation failure on this route already returns, mirroring performanceReviewEvidence.ts's own identical wrapper. */
function handleEvidenceUpload(req: MembershipRequest, res: Response, next: NextFunction): void {
  uploadEvidence.single("file")(req as never, res as never, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 10MB size limit" : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleEvidenceError(err: unknown, res: Response): void {
  if (err instanceof LearningEnrollmentNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof LearningEvidenceForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidDocumentError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

/** Coarse floor: every role holds at least one of these three keys; the real own/manager/instructor/org-wide scoping happens per-route below. */
async function requireEvidencePermission(req: MembershipRequest, res: Response, next: () => void): Promise<void> {
  const membershipId = req.membership!.id;
  const allowed = (await hasPermission(membershipId, "learning.write.own")) || (await hasPermission(membershipId, "learning.review.write")) || (await hasPermission(membershipId, "learning.manage"));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// POST /organizations/:organizationId/learning/enrollments/:id/evidence
// multipart/form-data: file (required). Own/manager-of-record/instructor-
// of-record/org-wide, no stage/status restriction (§21's own frozen row
// — deliberately no gate the way Performance's own W82 added one).
router.post(
  "/organizations/:organizationId/learning/enrollments/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requireEvidencePermission as any,
  handleEvidenceUpload,
  async (req: MembershipRequest, res): Promise<void> => {
    const enrollmentId = parseId(req.params.id);
    if (isNaN(enrollmentId) || !req.file) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");

    try {
      const evidence = await addEvidence({
        organizationId,
        enrollmentId,
        callerEmployeeId,
        isOrgWide,
        file: { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer, originalname: req.file.originalname },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(evidence);
    } catch (err) {
      handleEvidenceError(err, res);
    }
  },
);

// GET /organizations/:organizationId/learning/enrollments/:id/evidence
router.get(
  "/organizations/:organizationId/learning/enrollments/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requireEvidencePermission as any,
  async (req: MembershipRequest, res): Promise<void> => {
    const enrollmentId = parseId(req.params.id);
    if (isNaN(enrollmentId)) {
      res.status(400).json({ error: "Invalid enrollment ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");

    const rel = await resolveEvidenceEnrollmentRelationship(organizationId, enrollmentId, callerEmployeeId, isOrgWide);
    if (!rel) {
      res.status(404).json({ error: "Enrollment not found" });
      return;
    }
    if (!rel.isOrgWide && !rel.isOwn && !rel.isManager && !rel.isInstructor) {
      res.status(403).json({ error: "Not authorized to view this enrollment's evidence" });
      return;
    }

    res.json(await listEvidenceForEnrollment(organizationId, enrollmentId));
  },
);

// GET /organizations/:organizationId/learning/enrollments/:id/evidence/:evidenceId/download
// Authorization-checked before any storage read: authenticate ->
// membership -> module -> resolve enrollment -> prove the caller's own/
// manager/instructor/org-wide visibility -> confirm the evidence row
// belongs to this exact enrollment/org -> only then read the file. No
// public URL is ever generated; the file streams through this
// authenticated route on every request.
router.get(
  "/organizations/:organizationId/learning/enrollments/:id/evidence/:evidenceId/download",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requireEvidencePermission as any,
  async (req: MembershipRequest, res): Promise<void> => {
    const enrollmentId = parseId(req.params.id);
    const evidenceId = parseId(req.params.evidenceId);
    if (isNaN(enrollmentId) || isNaN(evidenceId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");

    const rel = await resolveEvidenceEnrollmentRelationship(organizationId, enrollmentId, callerEmployeeId, isOrgWide);
    if (!rel) {
      res.status(404).json({ error: "Enrollment not found" });
      return;
    }
    if (!rel.isOrgWide && !rel.isOwn && !rel.isManager && !rel.isInstructor) {
      res.status(403).json({ error: "Not authorized to access this enrollment's evidence" });
      return;
    }

    const row = await getEvidenceForDownload(organizationId, enrollmentId, evidenceId);
    if (!row) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }

    const buffer = await readOrgFile(organizationId, row.storageKey);
    res.set("Content-Type", row.mimeType || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(buffer);
  },
);

export default router;
