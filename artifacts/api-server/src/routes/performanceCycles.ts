/**
 * Performance Cycles & Review Assignment (Phase 3C, W75):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27 (as reconciled by
 * this workstream — see lib/performanceCycles.ts's own file header for the
 * row-0/row-1 and goal-snapshot reconciliation notes). Every route here is
 * HR/admin configuration-and-assignment territory per this workstream's
 * own brief ("W75 is HR/admin configuration and assignment... Expected
 * primary permission: performance.manage") — unlike W74's rating-scales/
 * templates routes, nothing here is opened to the broader
 * performance.read.own grant; every route, including reads, requires
 * performance.manage.
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
import { PERFORMANCE_MODULE_KEY } from "../lib/performanceAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import { toIsoDate } from "../lib/leaveRequests";
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
router.get(
  "/organizations/:organizationId/performance/reviews/:id",
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
    const result = await getReviewWithCompetencies(req.membership!.organizationId, reviewId);
    if (!result) {
      res.status(404).json({ error: "Performance review not found" });
      return;
    }
    res.json(result);
  },
);

export default router;
