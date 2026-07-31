import { Router } from "express";
import { SaveInterviewScorecardBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { hasPermission } from "../lib/permissions";
import {
  listInterviewScorecards,
  saveOwnInterviewScorecard,
  finalizeInterviewScorecard,
  resolveScorecardVisibilityContext,
  InterviewNotFoundForScorecardError,
  ScorecardNotFoundError,
  NotPanelMemberError,
  InterviewCancelledError,
  ScorecardNotEditableError,
  ScorecardNotFinalizableError,
} from "../lib/interviewScorecards";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function handleScorecardError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof InterviewNotFoundForScorecardError || err instanceof ScorecardNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof NotPanelMemberError || err instanceof InterviewCancelledError || err instanceof ScorecardNotEditableError || err instanceof ScorecardNotFinalizableError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/interviews/:id/scorecards
// Gated manually (not via requirePermission) since either scorecard.submit
// OR scorecard.read_all grants entry — requiring submit specifically would
// unfairly block a caller who legitimately holds only read_all oversight
// without ever being a panel-eligible interviewer themselves.
router.get(
  "/organizations/:organizationId/interviews/:id/scorecards",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const interviewId = parseId(req.params.id);
    if (isNaN(interviewId)) {
      res.status(400).json({ error: "Invalid interview ID" });
      return;
    }
    const [canSubmit, canReadAll] = await Promise.all([hasPermission(req.membership!.id, "scorecard.submit"), hasPermission(req.membership!.id, "scorecard.read_all")]);
    if (!canSubmit && !canReadAll) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const visibility = await resolveScorecardVisibilityContext({ membershipId: req.membership!.id });
    try {
      const result = await listInterviewScorecards({ organizationId: req.membership!.organizationId, interviewId, visibility });
      res.json({ scorecards: result.scorecards, panelSummary: result.panelSummary });
    } catch (err) {
      if (handleScorecardError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/interviews/:id/scorecards
router.post(
  "/organizations/:organizationId/interviews/:id/scorecards",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("scorecard.submit"),
  async (req: MembershipRequest, res): Promise<void> => {
    const interviewId = parseId(req.params.id);
    if (isNaN(interviewId)) {
      res.status(400).json({ error: "Invalid interview ID" });
      return;
    }
    const parsed = SaveInterviewScorecardBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const scorecard = await saveOwnInterviewScorecard({
        organizationId: req.membership!.organizationId,
        interviewId,
        membershipId: req.membership!.id,
        recommendation: parsed.data.recommendation,
        overallComment: parsed.data.overallComment,
        responses: parsed.data.responses,
        submit: parsed.data.submit,
      });
      res.json(scorecard);
    } catch (err) {
      if (handleScorecardError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/scorecards/:id/finalize
router.post(
  "/organizations/:organizationId/scorecards/:id/finalize",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("scorecard.finalize"),
  async (req: MembershipRequest, res): Promise<void> => {
    const scorecardId = parseId(req.params.id);
    if (isNaN(scorecardId)) {
      res.status(400).json({ error: "Invalid scorecard ID" });
      return;
    }
    try {
      const scorecard = await finalizeInterviewScorecard({ organizationId: req.membership!.organizationId, scorecardId });
      res.json(scorecard);
    } catch (err) {
      if (handleScorecardError(err, res)) return;
      throw err;
    }
  },
);

export default router;
