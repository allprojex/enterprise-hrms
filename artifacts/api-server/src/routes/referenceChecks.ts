import { Router } from "express";
import { CreateReferenceCheckBody, UpdateReferenceCheckStatusBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { resolveApplicationVisibilityContext } from "../lib/applicationPipeline";
import {
  listReferenceChecks,
  createReferenceCheck,
  updateReferenceCheckStatus,
  ApplicationNotFoundForCheckError,
  ReferenceCheckNotFoundError,
  InvalidReferenceCheckError,
  DuplicateReferenceCheckError,
  ReferenceCheckNotEditableError,
} from "../lib/referenceChecks";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleReferenceCheckError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof ApplicationNotFoundForCheckError || err instanceof ReferenceCheckNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidReferenceCheckError || err instanceof DuplicateReferenceCheckError || err instanceof ReferenceCheckNotEditableError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/applications/:applicationId/reference-checks
router.get(
  "/organizations/:organizationId/applications/:applicationId/reference-checks",
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
      const checks = await listReferenceChecks({ organizationId, applicationId, visibility });
      res.json(checks);
    } catch (err) {
      if (handleReferenceCheckError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:applicationId/reference-checks
router.post(
  "/organizations/:organizationId/applications/:applicationId/reference-checks",
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
    const parsed = CreateReferenceCheckBody.safeParse(req.body);
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
      const check = await createReferenceCheck({
        organizationId,
        applicationId,
        visibility,
        refereeName: parsed.data.refereeName,
        refereeContact: parsed.data.refereeContact,
        refereeRelationship: parsed.data.refereeRelationship,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(check);
    } catch (err) {
      if (handleReferenceCheckError(err, res)) return;
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/applications/:applicationId/reference-checks/:id
router.patch(
  "/organizations/:organizationId/applications/:applicationId/reference-checks/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    const checkId = parseId(req.params.id);
    if (isNaN(applicationId) || isNaN(checkId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const parsed = UpdateReferenceCheckStatusBody.safeParse(req.body);
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
      const check = await updateReferenceCheckStatus({
        organizationId,
        applicationId,
        checkId,
        visibility,
        status: parsed.data.status,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(check);
    } catch (err) {
      if (handleReferenceCheckError(err, res)) return;
      throw err;
    }
  },
);

export default router;
