import { Router, type Response } from "express";
import { MoveApplicationStageBody, RejectApplicationBody, WithdrawApplicationBody, ReopenApplicationBody, SubmitApplicationScoreBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import {
  listApplications,
  getVisibleApplicationById,
  moveApplicationStage,
  rejectApplication,
  withdrawApplication,
  reopenApplication,
  resolveApplicationVisibilityContext,
  ApplicationNotFoundError,
  InvalidStageTransitionError,
} from "../lib/applicationPipeline";
import { submitApplicationScore, ApplicationScoreTargetNotFoundError, InvalidApplicationScoreError } from "../lib/applicationScoring";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function parseOptionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

function parseOptionalString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value !== "" ? value : undefined;
}

// GET /organizations/:organizationId/applications
router.get(
  "/organizations/:organizationId/applications",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveApplicationVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });

    const page = Math.max(1, parseOptionalId(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseOptionalId(req.query.pageSize) ?? 20));

    const result = await listApplications({
      organizationId,
      visibility,
      vacancyId: parseOptionalId(req.query.vacancyId),
      stageCategory: parseOptionalString(req.query.stageCategory),
      search: parseOptionalString(req.query.search),
      page,
      pageSize,
    });

    res.json({ ...result, page, pageSize });
  },
);

// GET /organizations/:organizationId/applications/:id
router.get(
  "/organizations/:organizationId/applications/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.id);
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
    const application = await getVisibleApplicationById(organizationId, applicationId, visibility);
    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    res.json(application);
  },
);

function handleTransitionError(err: unknown, res: Response): boolean {
  if (err instanceof ApplicationNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidStageTransitionError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// POST /organizations/:organizationId/applications/:id/move-stage
router.post(
  "/organizations/:organizationId/applications/:id/move-stage",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.pipeline.move"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.id);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = MoveApplicationStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await moveApplicationStage({
        organizationId: req.membership!.organizationId,
        applicationId,
        toStageId: parsed.data.toStageId,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const visibility = await resolveApplicationVisibilityContext({
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const detail = await getVisibleApplicationById(req.membership!.organizationId, applicationId, visibility);
      res.json(detail);
    } catch (err) {
      if (handleTransitionError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:id/reject
router.post(
  "/organizations/:organizationId/applications/:id/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.pipeline.move"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.id);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = RejectApplicationBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await rejectApplication({
        organizationId: req.membership!.organizationId,
        applicationId,
        reasonCode: parsed.data.reasonCode,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const visibility = await resolveApplicationVisibilityContext({
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const detail = await getVisibleApplicationById(req.membership!.organizationId, applicationId, visibility);
      res.json(detail);
    } catch (err) {
      if (handleTransitionError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:id/withdraw
router.post(
  "/organizations/:organizationId/applications/:id/withdraw",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.pipeline.move"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.id);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = WithdrawApplicationBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await withdrawApplication({
        organizationId: req.membership!.organizationId,
        applicationId,
        reasonCode: parsed.data.reasonCode,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const visibility = await resolveApplicationVisibilityContext({
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const detail = await getVisibleApplicationById(req.membership!.organizationId, applicationId, visibility);
      res.json(detail);
    } catch (err) {
      if (handleTransitionError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:id/reopen
router.post(
  "/organizations/:organizationId/applications/:id/reopen",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.pipeline.move"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.id);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = ReopenApplicationBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await reopenApplication({
        organizationId: req.membership!.organizationId,
        applicationId,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const visibility = await resolveApplicationVisibilityContext({
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const detail = await getVisibleApplicationById(req.membership!.organizationId, applicationId, visibility);
      res.json(detail);
    } catch (err) {
      if (handleTransitionError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/applications/:id/scores
router.post(
  "/organizations/:organizationId/applications/:id/scores",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("application.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.id);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = SubmitApplicationScoreBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      await submitApplicationScore({
        organizationId: req.membership!.organizationId,
        applicationId,
        scoreType: parsed.data.scoreType,
        score: parsed.data.score,
        notes: parsed.data.notes,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const visibility = await resolveApplicationVisibilityContext({
        organizationId: req.membership!.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });
      const detail = await getVisibleApplicationById(req.membership!.organizationId, applicationId, visibility);
      res.status(201).json(detail);
    } catch (err) {
      if (err instanceof ApplicationScoreTargetNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidApplicationScoreError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
