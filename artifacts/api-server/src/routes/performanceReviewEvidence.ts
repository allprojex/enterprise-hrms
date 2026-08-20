/**
 * Performance Evidence / Attachments (Phase 3C, W82): see
 * lib/performanceReviewEvidence.ts's own file header for the full
 * architecture (reuses the EXISTING employee_documents storage layer via
 * the W73 join table, no new file-storage code) and the disclosed
 * stage-gating/audit-naming decisions. No new permission key — every route
 * below is gated by the union of performance.write.own / performance.review.write
 * / performance.manage (coarse floor), with fine-grained own/reviewer-of-
 * record/org-wide + review-stage scoping resolved inside the handler,
 * mirroring performanceReviewGoals.ts's own established "coarse gate +
 * fine-grained check" precedent.
 */
import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { readOrgFile } from "../lib/fileStorage";
import { PERFORMANCE_MODULE_KEY, resolvePerformanceActorEmployeeId, hasOrgWidePerformanceAccess } from "../lib/performanceAuthorization";
import {
  addEvidence,
  listEvidenceForReview,
  getEvidenceForDownload,
  resolveEvidenceReviewRelationship,
  PerformanceReviewNotFoundError,
  PerformanceGoalNotFoundError,
  PerformanceEvidenceForbiddenError,
  PerformanceEvidenceStageError,
  InvalidDocumentError,
} from "../lib/performanceReviewEvidence";

const router = Router();

// Same 10MB ceiling as the existing employee-documents upload
// (routes/employees.ts) — validateDocumentUpload enforces the same limit
// again from the actual file bytes; this is just multer's own outer bound.
const uploadEvidence = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * multer emits a MulterError (LIMIT_FILE_SIZE for an oversized file, among
 * others) through Express's error-handling path, not the normal
 * request-handling one — left unhandled, that surfaces as a raw 500
 * instead of a typed 4xx. Wrapping the field-parser like this converts it
 * into the same res.status(400).json({error}) shape every other validation
 * failure on this route already returns.
 */
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
  if (err instanceof PerformanceReviewNotFoundError || err instanceof PerformanceGoalNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceEvidenceForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceEvidenceStageError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidDocumentError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

/** Coarse floor: every role holds at least one of these three keys (§7/§27); the real own/reviewer/org-wide scoping happens per-route below. */
async function requireEvidencePermission(req: MembershipRequest, res: Response, next: () => void): Promise<void> {
  const membershipId = req.membership!.id;
  const allowed = (await hasPermission(membershipId, "performance.write.own")) || (await hasPermission(membershipId, "performance.review.write")) || (await hasPermission(membershipId, "performance.manage"));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// POST /organizations/:organizationId/performance/reviews/:id/evidence
// multipart/form-data: file (required), goalId (optional). Employee
// (performance.write.own, own review, self_assessment), reviewer of record
// (performance.review.write, manager_review), or HR (performance.manage,
// hr_review) — dispatched from the caller's own server-derived relationship
// to the review, never a client-supplied flag.
router.post(
  "/organizations/:organizationId/performance/reviews/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requireEvidencePermission as any,
  handleEvidenceUpload,
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId) || !req.file) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const goalId = req.body?.goalId != null && req.body.goalId !== "" ? parseId(req.body.goalId) : undefined;
    if (goalId !== undefined && isNaN(goalId)) {
      res.status(400).json({ error: "Invalid goal ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWidePerformanceAccess(req.membership!.id, "performance.manage");

    try {
      const evidence = await addEvidence({
        organizationId,
        reviewId,
        goalId,
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

// GET /organizations/:organizationId/performance/reviews/:id/evidence
// Visible to the same own/reviewer-of-record/organization-wide tier as the
// review itself — not stage-gated, unlike upload (evidence stays visible
// after finalization, part of the durable historical record).
router.get(
  "/organizations/:organizationId/performance/reviews/:id/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requireEvidencePermission as any,
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWidePerformanceAccess(req.membership!.id, "performance.manage");

    const rel = await resolveEvidenceReviewRelationship(organizationId, reviewId, callerEmployeeId, isOrgWide);
    if (!rel) {
      res.status(404).json({ error: "Performance review not found" });
      return;
    }
    if (!rel.isOrgWide && !rel.isOwn && !rel.isReviewer) {
      res.status(403).json({ error: "Not authorized to view this review's evidence" });
      return;
    }

    const evidence = await listEvidenceForReview(organizationId, reviewId);
    res.json(evidence);
  },
);

// GET /organizations/:organizationId/performance/reviews/:id/evidence/:evidenceId/download
// Authorization-checked before any storage read: authenticate -> membership
// -> module -> resolve review -> prove the caller's own/reviewer/org-wide
// visibility -> confirm the evidence row belongs to this exact review/org ->
// only then read the file. No public URL is ever generated; the file is
// streamed through this authenticated route on every request.
router.get(
  "/organizations/:organizationId/performance/reviews/:id/evidence/:evidenceId/download",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requireEvidencePermission as any,
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    const evidenceId = parseId(req.params.evidenceId);
    if (isNaN(reviewId) || isNaN(evidenceId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWidePerformanceAccess(req.membership!.id, "performance.manage");

    const rel = await resolveEvidenceReviewRelationship(organizationId, reviewId, callerEmployeeId, isOrgWide);
    if (!rel) {
      res.status(404).json({ error: "Performance review not found" });
      return;
    }
    if (!rel.isOrgWide && !rel.isOwn && !rel.isReviewer) {
      res.status(403).json({ error: "Not authorized to access this review's evidence" });
      return;
    }

    const row = await getEvidenceForDownload(organizationId, reviewId, evidenceId);
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
