/**
 * Performance Self-Assessment (Phase 3C, W77 — Self-Assessment / ESS,
 * amended W78): docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27
 * plus one reconciled route (see lib/performanceSelfAssessment.ts's own
 * file header for the competency-route gap). The competency PATCH route
 * is dual-purpose since W78: own-employee self-rating
 * (`performance.write.own`, `self_assessment` only) or reviewer-of-record
 * manager rating (`performance.review.write`, `manager_review` only) —
 * dispatched by caller identity via resolveReviewRelationship, exactly
 * mirroring the goal-creation route's own employee-vs-reviewer dispatch
 * (W76). GET/POST self-assessment routes remain own-employee-only,
 * unchanged. Server-derived identity throughout — never a
 * client-supplied employeeId.
 */
import { Router, type Response } from "express";
import { RateCompetencyBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { PERFORMANCE_MODULE_KEY, resolvePerformanceActorEmployeeId } from "../lib/performanceAuthorization";
import { resolveReviewRelationship } from "../lib/performanceReviewGoals";
import {
  listMyReviews,
  rateCompetency,
  submitSelfAssessment,
  PerformanceReviewNotFoundError,
  PerformanceCompetencyNotFoundError,
  InvalidPerformanceCompetencyRatingError,
  PerformanceSelfAssessmentForbiddenError,
  PerformanceSelfAssessmentStageError,
  PerformanceSelfAssessmentNotReadyError,
} from "../lib/performanceSelfAssessment";
import {
  rateCompetencyAsManager,
  PerformanceManagerReviewForbiddenError,
  PerformanceManagerReviewStageError,
} from "../lib/performanceManagerReview";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleSelfAssessmentError(err: unknown, res: Response): void {
  if (err instanceof PerformanceReviewNotFoundError || err instanceof PerformanceCompetencyNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceSelfAssessmentForbiddenError || err instanceof PerformanceManagerReviewForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceSelfAssessmentStageError || err instanceof PerformanceManagerReviewStageError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceSelfAssessmentNotReadyError) {
    res.status(400).json({ error: err.message, problems: err.problems });
    return;
  }
  if (err instanceof InvalidPerformanceCompetencyRatingError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /organizations/:organizationId/performance/my-reviews
router.get(
  "/organizations/:organizationId/performance/my-reviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.json([]);
      return;
    }
    const reviews = await listMyReviews(organizationId, employeeId);
    res.json(reviews);
  },
);

// PATCH /organizations/:organizationId/performance/reviews/:id/competencies/:competencyId
// Coarse floor: either performance.write.own (own-employee self-rating) or
// performance.review.write (reviewer-of-record manager rating, W78) —
// every role holds at least one; the real dispatch happens below.
router.patch(
  "/organizations/:organizationId/performance/reviews/:id/competencies/:competencyId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  async (req: MembershipRequest, res, next): Promise<void> => {
    const allowed = (await hasPermission(req.membership!.id, "performance.write.own")) || (await hasPermission(req.membership!.id, "performance.review.write"));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    const competencyId = parseId(req.params.competencyId);
    if (isNaN(reviewId) || isNaN(competencyId)) {
      res.status(400).json({ error: "Invalid review or competency ID" });
      return;
    }
    const parsed = RateCompetencyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const relationship = await resolveReviewRelationship(organizationId, reviewId, callerEmployeeId);
      if (!relationship) throw new PerformanceReviewNotFoundError();

      let updated;
      if (relationship.isOwn) {
        if (parsed.data.employeeRatingValue === undefined) {
          res.status(400).json({ error: "employeeRatingValue is required" });
          return;
        }
        updated = await rateCompetency({
          organizationId,
          reviewId,
          competencyId,
          callerEmployeeId,
          employeeRatingValue: parsed.data.employeeRatingValue,
          employeeComment: parsed.data.employeeComment,
        });
      } else if (relationship.isReviewer) {
        updated = await rateCompetencyAsManager({
          organizationId,
          reviewId,
          competencyId,
          callerEmployeeId,
          managerRatingValue: parsed.data.managerRatingValue,
          managerComment: parsed.data.managerComment,
          notApplicable: parsed.data.notApplicable,
          notApplicableReason: parsed.data.notApplicableReason,
        });
      } else {
        res.status(403).json({ error: "You are neither this review's employee nor its reviewer of record" });
        return;
      }
      res.json(updated);
    } catch (err) {
      handleSelfAssessmentError(err, res);
    }
  },
);

// POST /organizations/:organizationId/performance/reviews/:id/self-assessment
router.post(
  "/organizations/:organizationId/performance/reviews/:id/self-assessment",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.write.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await submitSelfAssessment({
        organizationId,
        reviewId,
        callerEmployeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleSelfAssessmentError(err, res);
    }
  },
);

export default router;
