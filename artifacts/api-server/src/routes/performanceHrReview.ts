/**
 * Performance HR Review, Finalization, Override & Reopen (Phase 3C, W79):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27's own frozen route
 * list. Finalize is `performance.finalize`; reopen is `performance.manage`
 * — deliberately different keys, per §10.1 row 6 / §16's own explicit
 * text (see lib/performanceHrReview.ts's own file header). Both are
 * organization-wide HR/admin actions — no reviewer-of-record scoping, no
 * new permission key.
 */
import { Router, type Response } from "express";
import { FinalizePerformanceReviewBody, ReopenPerformanceReviewBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY } from "../lib/performanceAuthorization";
import {
  finalizeReview,
  reopenReview,
  PerformanceReviewNotFoundError,
  PerformanceHrReviewStageError,
  InvalidPerformanceHrReviewError,
} from "../lib/performanceHrReview";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleHrReviewError(err: unknown, res: Response): void {
  if (err instanceof PerformanceReviewNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceHrReviewStageError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidPerformanceHrReviewError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// POST /organizations/:organizationId/performance/reviews/:id/finalize
router.post(
  "/organizations/:organizationId/performance/reviews/:id/finalize",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.finalize"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }
    const parsed = FinalizePerformanceReviewBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await finalizeReview({
        organizationId: req.membership!.organizationId,
        reviewId,
        hrOverrideScore: parsed.data.hrOverrideScore,
        hrOverrideReason: parsed.data.hrOverrideReason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleHrReviewError(err, res);
    }
  },
);

// POST /organizations/:organizationId/performance/reviews/:id/reopen
router.post(
  "/organizations/:organizationId/performance/reviews/:id/reopen",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }
    const parsed = ReopenPerformanceReviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await reopenReview({
        organizationId: req.membership!.organizationId,
        reviewId,
        targetStage: parsed.data.targetStage,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleHrReviewError(err, res);
    }
  },
);

export default router;
