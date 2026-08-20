/**
 * Performance Rating Scales (Phase 3C, W74 — Rating Scales & Review
 * Templates): docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27's own
 * frozen route list — GET is "read broad" (performance.read.own, seeded
 * to every role); every mutating route requires performance.manage.
 */
import { Router } from "express";
import {
  CreatePerformanceRatingScaleBody,
  UpdatePerformanceRatingScaleBody,
  ReplacePerformanceRatingScaleLevelsBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY } from "../lib/performanceAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listRatingScales,
  getRatingScaleWithLevels,
  createRatingScale,
  updateRatingScale,
  replaceRatingScaleLevels,
  PerformanceRatingScaleNotFoundError,
  InvalidPerformanceRatingScaleLevelsError,
  PerformanceRatingScaleLevelsLockedError,
} from "../lib/performanceRatingScales";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/performance/rating-scales
router.get(
  "/organizations/:organizationId/performance/rating-scales",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const scales = await listRatingScales(req.membership!.organizationId);
    res.json(scales);
  },
);

// POST /organizations/:organizationId/performance/rating-scales
router.post(
  "/organizations/:organizationId/performance/rating-scales",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePerformanceRatingScaleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const scale = await createRatingScale({
      organizationId: req.membership!.organizationId,
      name: parsed.data.name,
      description: parsed.data.description,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(201).json(scale);
  },
);

// GET /organizations/:organizationId/performance/rating-scales/:id
router.get(
  "/organizations/:organizationId/performance/rating-scales/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const ratingScaleId = parseId(req.params.id);
    if (isNaN(ratingScaleId)) {
      res.status(400).json({ error: "Invalid rating scale ID" });
      return;
    }

    const result = await getRatingScaleWithLevels(req.membership!.organizationId, ratingScaleId);
    if (!result) {
      res.status(404).json({ error: "Rating scale not found" });
      return;
    }
    res.json(result);
  },
);

// PATCH /organizations/:organizationId/performance/rating-scales/:id
router.patch(
  "/organizations/:organizationId/performance/rating-scales/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const ratingScaleId = parseId(req.params.id);
    if (isNaN(ratingScaleId)) {
      res.status(400).json({ error: "Invalid rating scale ID" });
      return;
    }

    const parsed = UpdatePerformanceRatingScaleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateRatingScale({
        organizationId: req.membership!.organizationId,
        ratingScaleId,
        name: parsed.data.name,
        description: parsed.data.description,
        status: parsed.data.status,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof PerformanceRatingScaleNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/performance/rating-scales/:id/levels
router.patch(
  "/organizations/:organizationId/performance/rating-scales/:id/levels",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const ratingScaleId = parseId(req.params.id);
    if (isNaN(ratingScaleId)) {
      res.status(400).json({ error: "Invalid rating scale ID" });
      return;
    }

    const parsed = ReplacePerformanceRatingScaleLevelsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const levels = await replaceRatingScaleLevels({
        organizationId: req.membership!.organizationId,
        ratingScaleId,
        levels: parsed.data.levels,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(levels);
    } catch (err) {
      if (err instanceof PerformanceRatingScaleNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidPerformanceRatingScaleLevelsError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PerformanceRatingScaleLevelsLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
