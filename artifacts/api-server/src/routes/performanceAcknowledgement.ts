/**
 * Performance Employee Acknowledgement (Phase 3C, W83A):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27's own frozen route —
 * `POST .../reviews/:id/acknowledge`, `performance.write.own`. Server-
 * derived identity throughout, exactly like performanceSelfAssessment.ts's
 * own submit route (resolvePerformanceActorEmployeeId, never a client-
 * supplied employeeId).
 */
import { Router, type Response } from "express";
import { AcknowledgePerformanceReviewBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY, resolvePerformanceActorEmployeeId } from "../lib/performanceAuthorization";
import {
  acknowledgeReview,
  PerformanceReviewNotFoundError,
  PerformanceAcknowledgementForbiddenError,
  PerformanceAcknowledgementStageError,
} from "../lib/performanceAcknowledgement";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleAcknowledgementError(err: unknown, res: Response): void {
  if (err instanceof PerformanceReviewNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceAcknowledgementForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceAcknowledgementStageError) {
    res.status(409).json({ error: err.message });
    return;
  }
  throw err;
}

// POST /organizations/:organizationId/performance/reviews/:id/acknowledge
router.post(
  "/organizations/:organizationId/performance/reviews/:id/acknowledge",
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
    const parsed = AcknowledgePerformanceReviewBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await acknowledgeReview({
        organizationId,
        reviewId,
        callerEmployeeId,
        employeeFinalComment: parsed.data.employeeFinalComment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleAcknowledgementError(err, res);
    }
  },
);

export default router;
