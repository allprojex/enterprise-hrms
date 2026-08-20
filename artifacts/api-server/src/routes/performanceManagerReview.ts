/**
 * Performance Manager Review (Phase 3C, W78): docs/PHASE_3C_PERFORMANCE_
 * IMPLEMENTATION_PLAN.md §27's own frozen route list. Both routes are
 * `performance.review.write`, reviewer-of-record-only — no HR override,
 * matching W76's own goal-route precedent (§27 names none here either).
 */
import { Router, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY, resolvePerformanceActorEmployeeId } from "../lib/performanceAuthorization";
import {
  listTeamReviews,
  submitManagerReview,
  PerformanceReviewNotFoundError,
  PerformanceManagerReviewForbiddenError,
  PerformanceManagerReviewStageError,
  PerformanceManagerReviewNotReadyError,
} from "../lib/performanceManagerReview";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleManagerReviewError(err: unknown, res: Response): void {
  if (err instanceof PerformanceReviewNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceManagerReviewForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceManagerReviewStageError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceManagerReviewNotReadyError) {
    res.status(400).json({ error: err.message, problems: err.problems });
    return;
  }
  throw err;
}

// GET /organizations/:organizationId/performance/team-reviews
router.get(
  "/organizations/:organizationId/performance/team-reviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.review.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const reviewerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    if (reviewerEmployeeId == null) {
      res.json([]);
      return;
    }
    const reviews = await listTeamReviews(organizationId, reviewerEmployeeId);
    res.json(reviews);
  },
);

// POST /organizations/:organizationId/performance/reviews/:id/manager-review
router.post(
  "/organizations/:organizationId/performance/reviews/:id/manager-review",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.review.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await submitManagerReview({
        organizationId,
        reviewId,
        callerEmployeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleManagerReviewError(err, res);
    }
  },
);

export default router;
