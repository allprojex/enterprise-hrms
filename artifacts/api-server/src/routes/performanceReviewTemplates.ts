/**
 * Performance Review Templates (Phase 3C, W74 — Rating Scales & Review
 * Templates): docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §27's own
 * frozen route list — GET is "read broad" (performance.read.own); every
 * mutating route requires performance.manage.
 */
import { Router } from "express";
import {
  CreatePerformanceReviewTemplateBody,
  UpdatePerformanceReviewTemplateBody,
  ReplacePerformanceTemplateCompetenciesBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY } from "../lib/performanceAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listReviewTemplates,
  getReviewTemplateWithCompetencies,
  createReviewTemplate,
  updateReviewTemplate,
  replaceTemplateCompetencies,
  PerformanceReviewTemplateNotFoundError,
  InvalidPerformanceReviewTemplateError,
  PerformanceReviewTemplateArchivedError,
} from "../lib/performanceReviewTemplates";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/performance/templates
router.get(
  "/organizations/:organizationId/performance/templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templates = await listReviewTemplates(req.membership!.organizationId);
    res.json(templates);
  },
);

// POST /organizations/:organizationId/performance/templates
router.post(
  "/organizations/:organizationId/performance/templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreatePerformanceReviewTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const template = await createReviewTemplate({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        ratingScaleId: parsed.data.ratingScaleId,
        goalsWeight: parsed.data.goalsWeight,
        competenciesWeight: parsed.data.competenciesWeight,
        applicabilityScope: parsed.data.applicabilityScope,
        applicabilityDepartmentIds: parsed.data.applicabilityDepartmentIds,
        applicabilityPositionIds: parsed.data.applicabilityPositionIds,
        status: parsed.data.status,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof InvalidPerformanceReviewTemplateError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/performance/templates/:id
router.get(
  "/organizations/:organizationId/performance/templates/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.id);
    if (isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }

    const result = await getReviewTemplateWithCompetencies(req.membership!.organizationId, templateId);
    if (!result) {
      res.status(404).json({ error: "Review template not found" });
      return;
    }
    res.json(result);
  },
);

// PATCH /organizations/:organizationId/performance/templates/:id
router.patch(
  "/organizations/:organizationId/performance/templates/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.id);
    if (isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }

    const parsed = UpdatePerformanceReviewTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateReviewTemplate({
        organizationId: req.membership!.organizationId,
        templateId,
        name: parsed.data.name,
        description: parsed.data.description,
        ratingScaleId: parsed.data.ratingScaleId,
        goalsWeight: parsed.data.goalsWeight,
        competenciesWeight: parsed.data.competenciesWeight,
        applicabilityScope: parsed.data.applicabilityScope,
        applicabilityDepartmentIds: parsed.data.applicabilityDepartmentIds,
        applicabilityPositionIds: parsed.data.applicabilityPositionIds,
        status: parsed.data.status,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof PerformanceReviewTemplateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PerformanceReviewTemplateArchivedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidPerformanceReviewTemplateError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/performance/templates/:id/competencies
router.patch(
  "/organizations/:organizationId/performance/templates/:id/competencies",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const templateId = parseId(req.params.id);
    if (isNaN(templateId)) {
      res.status(400).json({ error: "Invalid template ID" });
      return;
    }

    const parsed = ReplacePerformanceTemplateCompetenciesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const competencies = await replaceTemplateCompetencies({
        organizationId: req.membership!.organizationId,
        templateId,
        competencies: parsed.data.competencies,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(competencies);
    } catch (err) {
      if (err instanceof PerformanceReviewTemplateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PerformanceReviewTemplateArchivedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidPerformanceReviewTemplateError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
