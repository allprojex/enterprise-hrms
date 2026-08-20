/**
 * Performance Cycles & Review Assignment (Phase 3C, W75, amended W76):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27 (as reconciled by
 * this workstream — see lib/performanceCycles.ts's own file header for the
 * row-0/row-1 and goal-snapshot reconciliation notes). Cycle/assignment
 * configuration routes are HR/admin-only territory per W75's own brief
 * ("Expected primary permission: performance.manage") and remain
 * performance.manage-only, unchanged. The single-review detail route
 * (`GET .../reviews/:id`) is widened by W76 to match §27's own literal
 * permission line — "performance.read.own (own/reviewer-of-record) or
 * performance.manage" — since W76's goal routes need an employee/reviewer
 * to be able to see their own review (and its goals) without org-wide
 * access; this is "the smallest W76-owned route/access adjustment
 * required by the frozen plan" (W76's own master brief), not a general
 * widening — the list route (`GET .../reviews`) stays performance.manage-
 * only, since no W76 surface needs it. Response now also carries `goals`
 * (empty for any review W75 alone created; populated once W76 routes act
 * on it).
 */
import { Router } from "express";
import {
  CreatePerformanceCycleBody,
  UpdatePerformanceCycleBody,
  GeneratePerformanceReviewsBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY, resolvePerformanceActorEmployeeId, hasOrgWidePerformanceAccess, isOwnPerformanceRecord, isReviewerOfRecord } from "../lib/performanceAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import { toIsoDate } from "../lib/leaveRequests";
import { listGoalsForReview } from "../lib/performanceReviewGoals";
import {
  listCycles,
  getCycleById,
  createCycle,
  updateCycle,
  generateReviews,
  listReviews,
  getReviewWithCompetencies,
  PerformanceCycleNotFoundError,
  PerformanceReviewNotFoundError,
  InvalidPerformanceCycleError,
  PerformanceCycleNotEditableError,
  InvalidPerformanceCycleTransitionError,
  PerformanceCycleNotDraftError,
  InvalidPerformanceReviewAssignmentError,
} from "../lib/performanceCycles";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

/** The generated Zod body schema coerces `format: date` fields to real Date objects (orval.config.ts's `coerce.body: ['date']`) — Drizzle's own `date` column and this workstream's own string-based date comparisons expect a plain ISO 'YYYY-MM-DD' string instead, so every date field is converted at this one route boundary via leaveRequests.ts's own established toIsoDate helper (reused, not re-implemented). */
function iso(d: Date | undefined): string | undefined {
  return d === undefined ? undefined : toIsoDate(d);
}

function handleCycleError(err: unknown, res: import("express").Response): void {
  if (err instanceof PerformanceCycleNotFoundError || err instanceof PerformanceReviewNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof PerformanceCycleNotEditableError || err instanceof PerformanceCycleNotDraftError || err instanceof InvalidPerformanceCycleTransitionError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (
    err instanceof InvalidPerformanceCycleError ||
    err instanceof InvalidPerformanceReviewAssignmentError ||
    err instanceof CrossOrganizationReferenceError
  ) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /organizations/:organizationId/performance/cycles
router.get(
  "/organizations/:organizationId/performance/cycles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const cycles = await listCycles(req.membership!.organizationId);
    res.json(cycles);
  },
);

// POST /organizations/:organizationId/performance/cycles
router.post(
  "/organizations/:organizationId/performance/cycles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePerformanceCycleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const cycle = await createCycle({
        organizationId: req.membership!.organizationId,
        ...parsed.data,
        startDate: toIsoDate(parsed.data.startDate),
        endDate: toIsoDate(parsed.data.endDate),
        selfAssessmentWindowStart: iso(parsed.data.selfAssessmentWindowStart),
        selfAssessmentWindowEnd: iso(parsed.data.selfAssessmentWindowEnd),
        managerReviewWindowStart: iso(parsed.data.managerReviewWindowStart),
        managerReviewWindowEnd: iso(parsed.data.managerReviewWindowEnd),
        hrFinalizationWindowStart: iso(parsed.data.hrFinalizationWindowStart),
        hrFinalizationWindowEnd: iso(parsed.data.hrFinalizationWindowEnd),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(cycle);
    } catch (err) {
      handleCycleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/performance/cycles/:id
router.get(
  "/organizations/:organizationId/performance/cycles/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const cycleId = parseId(req.params.id);
    if (isNaN(cycleId)) {
      res.status(400).json({ error: "Invalid cycle ID" });
      return;
    }
    const cycle = await getCycleById(req.membership!.organizationId, cycleId);
    if (!cycle) {
      res.status(404).json({ error: "Performance cycle not found" });
      return;
    }
    res.json(cycle);
  },
);

// PATCH /organizations/:organizationId/performance/cycles/:id
router.patch(
  "/organizations/:organizationId/performance/cycles/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const cycleId = parseId(req.params.id);
    if (isNaN(cycleId)) {
      res.status(400).json({ error: "Invalid cycle ID" });
      return;
    }
    const parsed = UpdatePerformanceCycleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await updateCycle({
        organizationId: req.membership!.organizationId,
        cycleId,
        ...parsed.data,
        startDate: iso(parsed.data.startDate),
        endDate: iso(parsed.data.endDate),
        selfAssessmentWindowStart: iso(parsed.data.selfAssessmentWindowStart),
        selfAssessmentWindowEnd: iso(parsed.data.selfAssessmentWindowEnd),
        managerReviewWindowStart: iso(parsed.data.managerReviewWindowStart),
        managerReviewWindowEnd: iso(parsed.data.managerReviewWindowEnd),
        hrFinalizationWindowStart: iso(parsed.data.hrFinalizationWindowStart),
        hrFinalizationWindowEnd: iso(parsed.data.hrFinalizationWindowEnd),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleCycleError(err, res);
    }
  },
);

// POST /organizations/:organizationId/performance/cycles/:id/generate-reviews
router.post(
  "/organizations/:organizationId/performance/cycles/:id/generate-reviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const cycleId = parseId(req.params.id);
    if (isNaN(cycleId)) {
      res.status(400).json({ error: "Invalid cycle ID" });
      return;
    }
    const parsed = GeneratePerformanceReviewsBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await generateReviews({
        organizationId: req.membership!.organizationId,
        cycleId,
        employeeIds: parsed.data.employeeIds,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(result);
    } catch (err) {
      handleCycleError(err, res);
    }
  },
);

// GET /organizations/:organizationId/performance/reviews
router.get(
  "/organizations/:organizationId/performance/reviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const cycleId = req.query.cycleId != null ? parseId(req.query.cycleId as string) : undefined;
    const employeeId = req.query.employeeId != null ? parseId(req.query.employeeId as string) : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const reviews = await listReviews({
      organizationId: req.membership!.organizationId,
      cycleId: cycleId != null && !isNaN(cycleId) ? cycleId : undefined,
      employeeId: employeeId != null && !isNaN(employeeId) ? employeeId : undefined,
      status,
    });
    res.json(reviews);
  },
);

// GET /organizations/:organizationId/performance/reviews/:id
// Widened by W76 (see file header): performance.read.own is the coarse
// floor (broadest of the two relevant keys, seeded to every role);
// fine-grained scope (own/reviewer-of-record/org-wide) is resolved below,
// mirroring leaveRequests.ts's own established coarse-gate-plus-
// fine-grained-check precedent rather than a single blanket permission.
router.get(
  "/organizations/:organizationId/performance/reviews/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reviewId = parseId(req.params.id);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "Invalid review ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const result = await getReviewWithCompetencies(organizationId, reviewId);
    if (!result) {
      res.status(404).json({ error: "Performance review not found" });
      return;
    }

    const ownEmployeeId = await resolvePerformanceActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWidePerformanceAccess(req.membership!.id, "performance.manage");
    const isOwn = isOwnPerformanceRecord(ownEmployeeId, result.review.employeeId);
    const isReviewer = isReviewerOfRecord(ownEmployeeId, result.review.reviewerEmployeeId);
    if (!isOrgWide && !isOwn && !isReviewer) {
      res.status(403).json({ error: "Not authorized to view this review" });
      return;
    }

    const goals = await listGoalsForReview(organizationId, reviewId);
    res.json({ ...result, goals });
  },
);

export default router;
