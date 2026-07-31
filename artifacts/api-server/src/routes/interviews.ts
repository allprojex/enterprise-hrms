import { Router } from "express";
import { ScheduleInterviewBody, UpdateInterviewBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import {
  listInterviews,
  getVisibleInterviewById,
  scheduleInterview,
  updateInterview,
  cancelInterview,
  resolveInterviewVisibilityContext,
  InterviewNotFoundError,
  ApplicationNotFoundForInterviewError,
  InvalidInterviewError,
  InterviewNotEditableError,
  type InterviewStatus,
} from "../lib/interviews";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";

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

function parseOptionalStatus(raw: unknown): InterviewStatus | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value !== "" ? (value as InterviewStatus) : undefined;
}

function handleInterviewError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof InterviewNotFoundError || err instanceof ApplicationNotFoundForInterviewError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidInterviewError || err instanceof InterviewNotEditableError || err instanceof CrossOrganizationReferenceError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/interviews
router.get(
  "/organizations/:organizationId/interviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("interview.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveInterviewVisibilityContext({ membershipId: req.membership!.id });

    const page = Math.max(1, parseOptionalId(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseOptionalId(req.query.pageSize) ?? 20));

    const result = await listInterviews({
      organizationId,
      visibility,
      applicationId: parseOptionalId(req.query.applicationId),
      status: parseOptionalStatus(req.query.status),
      page,
      pageSize,
    });

    res.json({ ...result, page, pageSize });
  },
);

// GET /organizations/:organizationId/interviews/:id
router.get(
  "/organizations/:organizationId/interviews/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("interview.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const interviewId = parseId(req.params.id);
    if (isNaN(interviewId)) {
      res.status(400).json({ error: "Invalid interview ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveInterviewVisibilityContext({ membershipId: req.membership!.id });
    const interview = await getVisibleInterviewById(organizationId, interviewId, visibility);
    if (!interview) {
      res.status(404).json({ error: "Interview not found" });
      return;
    }
    res.json(interview);
  },
);

// POST /organizations/:organizationId/interviews/:id/cancel
router.post(
  "/organizations/:organizationId/interviews/:id/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("interview.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const interviewId = parseId(req.params.id);
    if (isNaN(interviewId)) {
      res.status(400).json({ error: "Invalid interview ID" });
      return;
    }
    try {
      const interview = await cancelInterview({
        organizationId: req.membership!.organizationId,
        interviewId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(interview);
    } catch (err) {
      if (handleInterviewError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/applications/:applicationId/interviews
router.get(
  "/organizations/:organizationId/applications/:applicationId/interviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("interview.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveInterviewVisibilityContext({ membershipId: req.membership!.id });
    const result = await listInterviews({ organizationId, visibility, applicationId, page: 1, pageSize: 100 });
    res.json(result.items);
  },
);

// POST /organizations/:organizationId/applications/:applicationId/interviews
router.post(
  "/organizations/:organizationId/applications/:applicationId/interviews",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("interview.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = ScheduleInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const interview = await scheduleInterview({
        organizationId: req.membership!.organizationId,
        applicationId,
        interviewType: parsed.data.interviewType,
        scheduledAt: parsed.data.scheduledAt,
        durationMinutes: parsed.data.durationMinutes,
        location: parsed.data.location,
        meetingLink: parsed.data.meetingLink,
        panelMembers: parsed.data.panelMembers,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(interview);
    } catch (err) {
      if (handleInterviewError(err, res)) return;
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/applications/:applicationId/interviews/:id
router.patch(
  "/organizations/:organizationId/applications/:applicationId/interviews/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("interview.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    const interviewId = parseId(req.params.id);
    if (isNaN(applicationId) || isNaN(interviewId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const parsed = UpdateInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const interview = await updateInterview({
        organizationId: req.membership!.organizationId,
        applicationId,
        interviewId,
        interviewType: parsed.data.interviewType,
        scheduledAt: parsed.data.scheduledAt,
        durationMinutes: parsed.data.durationMinutes,
        location: parsed.data.location,
        meetingLink: parsed.data.meetingLink,
        status: parsed.data.status,
        outcome: parsed.data.outcome,
        panelMembers: parsed.data.panelMembers,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(interview);
    } catch (err) {
      if (handleInterviewError(err, res)) return;
      throw err;
    }
  },
);

export default router;
