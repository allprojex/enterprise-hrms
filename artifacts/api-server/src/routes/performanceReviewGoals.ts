/**
 * Performance Review Goals (Phase 3C, W76 — Goals/Objectives Management):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27's own frozen route
 * list. No new permission key (§7 unchanged) — every route below is
 * gated by the union of the two existing "own"/"reviewer" keys
 * (performance.write.own, performance.review.write), coarse route-level
 * gate + fine-grained review-employee/reviewer-of-record scoping inside
 * the handler, mirroring leaveRequests.ts's own established "coarse gate
 * + fine-grained check" precedent rather than a single blanket
 * permission. Identity is always server-derived via
 * resolvePerformanceActorEmployeeId (W73) — never a client-supplied
 * employeeId.
 */
import { Router, type Response } from "express";
import { CreatePerformanceReviewGoalBody, UpdatePerformanceReviewGoalBody, AcceptPerformanceReviewGoalBody, RejectPerformanceReviewGoalBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import { PERFORMANCE_MODULE_KEY, resolvePerformanceActorEmployeeId } from "../lib/performanceAuthorization";
import { toIsoDate } from "../lib/leaveRequests";
import {
  proposeGoal,
  createManagerGoal,
  updateGoal,
  acceptGoal,
  rejectGoal,
  resolveReviewRelationship,
  PerformanceReviewNotFoundError,
  PerformanceGoalNotFoundError,
  InvalidPerformanceGoalError,
  PerformanceGoalForbiddenError,
  PerformanceGoalStageError,
  PerformanceGoalDecisionConflictError,
} from "../lib/performanceReviewGoals";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function iso(d: Date | null | undefined): string | undefined | null {
  if (d === undefined) return undefined;
  if (d === null) return null;
  return toIsoDate(d);
}

function handleGoalError(err: unknown, res: Response): void {
  if (err instanceof PerformanceReviewNotFoundError || err instanceof PerformanceGoalNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceGoalForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceGoalStageError || err instanceof PerformanceGoalDecisionConflictError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidPerformanceGoalError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

/** Coarse floor: every role holds at least one of these two keys (§7); the real own-vs-reviewer scoping happens per-route below. */
async function requireOwnOrReviewerPermission(req: MembershipRequest, res: Response, next: () => void): Promise<void> {
  const allowed = (await hasPermission(req.membership!.id, "performance.write.own")) || (await hasPermission(req.membership!.id, "performance.review.write"));
  if (!allowed) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// POST /organizations/:organizationId/performance/reviews/:id/goals
// Employee proposes (performance.write.own, own review, self_assessment)
// or the reviewer of record creates an official goal
// (performance.review.write, draft/manager_review) — server-derived from
// caller identity, never a client-supplied flag.
router.post(
  "/organizations/:organizationId/performance/reviews/:id/goals",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requireOwnOrReviewerPermission as any,
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }
    const parsed = CreatePerformanceReviewGoalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    const fields = {
      title: parsed.data.title,
      description: parsed.data.description,
      measurementType: parsed.data.measurementType,
      target: parsed.data.target,
      unit: parsed.data.unit,
      weight: parsed.data.weight,
      dueDate: iso(parsed.data.dueDate) ?? undefined,
    };

    try {
      // Intent is resolved from the caller's actual relationship to the
      // review, never a client-supplied flag: their own review ->
      // propose; the review they're the reviewer-of-record for ->
      // manager-create. proposeGoal/createManagerGoal each re-derive and
      // re-check this same relationship internally (defense in depth).
      const relationship = await resolveReviewRelationship(organizationId, reviewId, callerEmployeeId);
      if (!relationship) throw new PerformanceReviewNotFoundError();

      const actor = { organizationId, reviewId, callerEmployeeId, actorApplicationUserId: req.userId!, actorMembershipId: req.membership!.id, ...fields };
      let goal;
      if (relationship.isOwn) {
        goal = await proposeGoal(actor);
      } else if (relationship.isReviewer) {
        goal = await createManagerGoal(actor);
      } else {
        throw new PerformanceGoalForbiddenError("You are neither this review's employee nor its reviewer of record");
      }
      res.status(201).json(goal);
    } catch (err) {
      handleGoalError(err, res);
    }
  },
);

// PATCH /organizations/:organizationId/performance/reviews/:id/goals/:goalId
router.patch(
  "/organizations/:organizationId/performance/reviews/:id/goals/:goalId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requireOwnOrReviewerPermission as any,
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    const goalId = parseId(req.params.goalId);
    if (isNaN(reviewId) || isNaN(goalId)) {
      res.status(400).json({ error: "Invalid review or goal ID" });
      return;
    }
    const parsed = UpdatePerformanceReviewGoalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await updateGoal({
        organizationId,
        reviewId,
        goalId,
        callerEmployeeId,
        title: parsed.data.title,
        description: parsed.data.description,
        target: parsed.data.target,
        unit: parsed.data.unit,
        weight: parsed.data.weight,
        dueDate: iso(parsed.data.dueDate),
        employeeComment: parsed.data.employeeComment,
        actualResult: parsed.data.actualResult,
        managerComment: parsed.data.managerComment,
        notApplicable: parsed.data.notApplicable,
        notApplicableReason: parsed.data.notApplicableReason,
      });
      res.json(updated);
    } catch (err) {
      handleGoalError(err, res);
    }
  },
);

// POST /organizations/:organizationId/performance/reviews/:id/goals/:goalId/accept
router.post(
  "/organizations/:organizationId/performance/reviews/:id/goals/:goalId/accept",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const allowed = await hasPermission(req.membership!.id, "performance.review.write");
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const reviewId = parseId(req.params.id);
    const goalId = parseId(req.params.goalId);
    if (isNaN(reviewId) || isNaN(goalId)) {
      res.status(400).json({ error: "Invalid review or goal ID" });
      return;
    }
    const parsed = AcceptPerformanceReviewGoalBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await acceptGoal({
        organizationId,
        reviewId,
        goalId,
        callerEmployeeId,
        title: parsed.data.title,
        description: parsed.data.description,
        target: parsed.data.target,
        unit: parsed.data.unit,
        weight: parsed.data.weight,
        dueDate: iso(parsed.data.dueDate),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleGoalError(err, res);
    }
  },
);

// POST /organizations/:organizationId/performance/reviews/:id/goals/:goalId/reject
router.post(
  "/organizations/:organizationId/performance/reviews/:id/goals/:goalId/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const allowed = await hasPermission(req.membership!.id, "performance.review.write");
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const reviewId = parseId(req.params.id);
    const goalId = parseId(req.params.goalId);
    if (isNaN(reviewId) || isNaN(goalId)) {
      res.status(400).json({ error: "Invalid review or goal ID" });
      return;
    }
    const parsed = RejectPerformanceReviewGoalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await rejectGoal({
        organizationId,
        reviewId,
        goalId,
        callerEmployeeId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleGoalError(err, res);
    }
  },
);

export default router;
