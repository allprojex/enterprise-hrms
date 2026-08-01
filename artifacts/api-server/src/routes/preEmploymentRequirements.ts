import { Router } from "express";
import { CreatePreEmploymentRequirementBody, UpdatePreEmploymentRequirementStatusBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { resolveApplicationVisibilityContext } from "../lib/applicationPipeline";
import {
  listPreEmploymentRequirements,
  createPreEmploymentRequirement,
  updatePreEmploymentRequirementStatus,
  ApplicationNotFoundForRequirementError,
  PreEmploymentRequirementNotFoundError,
  InvalidPreEmploymentRequirementError,
  DuplicatePreEmploymentRequirementError,
} from "../lib/preEmploymentRequirements";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleRequirementError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof ApplicationNotFoundForRequirementError || err instanceof PreEmploymentRequirementNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidPreEmploymentRequirementError || err instanceof DuplicatePreEmploymentRequirementError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/applications/:applicationId/pre-employment-requirements
router.get(
  "/organizations/:organizationId/applications/:applicationId/pre-employment-requirements",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveApplicationVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const result = await listPreEmploymentRequirements({ organizationId, applicationId, visibility });
      res.json(result);
    } catch (err) {
      if (handleRequirementError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:applicationId/pre-employment-requirements
router.post(
  "/organizations/:organizationId/applications/:applicationId/pre-employment-requirements",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = CreatePreEmploymentRequirementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveApplicationVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const requirement = await createPreEmploymentRequirement({
        organizationId,
        applicationId,
        visibility,
        requirementCode: parsed.data.requirementCode,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(requirement);
    } catch (err) {
      if (handleRequirementError(err, res)) return;
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/applications/:applicationId/pre-employment-requirements/:id
router.patch(
  "/organizations/:organizationId/applications/:applicationId/pre-employment-requirements/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    const requirementId = parseId(req.params.id);
    if (isNaN(applicationId) || isNaN(requirementId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const parsed = UpdatePreEmploymentRequirementStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveApplicationVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const requirement = await updatePreEmploymentRequirementStatus({
        organizationId,
        applicationId,
        requirementId,
        visibility,
        status: parsed.data.status,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requirement);
    } catch (err) {
      if (handleRequirementError(err, res)) return;
      throw err;
    }
  },
);

export default router;
