/**
 * WS-9 — Recruitment Completion routes
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25).
 *
 * SECURITY NOTE worth stating plainly, because it shaped every gate below:
 * the seeded `employee` role holds `offer.manage`. Record-level narrowing for
 * the pre-existing offer routes lives in the service layer, but any NEW route
 * gated only on `offer.manage` would be reachable by every employee in the
 * organization. So the consequential actions here are gated on narrower,
 * already-seeded keys — `offer.approve`, `offer.issue`, `offer.withdraw`,
 * `candidate.manage`, `candidate.convert_to_employee`,
 * `recruitment_settings.manage` — and never on `offer.manage` alone.
 *
 * No new permission key is minted: §25.19 asks for new keys only where a
 * genuinely new authority cannot be represented, and every action here maps
 * onto an authority the platform already names.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { recordAuditEvent } from "../lib/auditLog";
import {
  createApprovalStage,
  deleteApprovalStage,
  listApprovalStages,
  RecruitmentApprovalConfigError,
  NotAuthorizedForStageError,
} from "../lib/recruitmentApprovalStages";
import {
  decideHireAuthorizationStage,
  getHireAuthorizationDetail,
  requestHireAuthorization,
  HireAuthorizationNotFoundError,
  HireAuthorizationStateError,
  NoHireApprovalStagesConfiguredError,
} from "../lib/hireAuthorization";
import {
  captureCandidateManually,
  listRecruitmentSources,
  DuplicateApplicationError,
  ManualCaptureError,
} from "../lib/manualCandidateCapture";
import {
  consumeResponseToken,
  getCandidateOfferView,
  getOfferVersionState,
  issueResponseToken,
  recordOfferResponse,
  recordOfferWithdrawal,
  resolveResponseToken,
  OfferResponseNotAllowedError,
  OfferResponseTokenInvalidError,
} from "../lib/offerResponses";
import {
  getParticularsByOfferVersion,
  issueParticulars,
  saveParticulars,
  suggestParticulars,
  buildParticularsMergeContext,
  EmploymentParticularsIssuedError,
  EmploymentParticularsNotFoundError,
} from "../lib/employmentParticulars";
import { generateDocument } from "../lib/documentGeneration";
import { db, candidateEmployeeLinksTable, offersTable, offerVersionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const router = Router();

/**
 * Public offer-response endpoints are unauthenticated by nature, so they carry
 * their own limiter — matching the precedent already set by
 * `applyRateLimiter`/`statusCheckRateLimiter` on the careers portal. Tight,
 * because guessing a 256-bit token is the only way in.
 */
const offerResponseRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof HireAuthorizationNotFoundError || err instanceof EmploymentParticularsNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof OfferResponseTokenInvalidError) {
    // Uniform 404 for every token failure — a prober learns nothing.
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof NotAuthorizedForStageError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (
    err instanceof RecruitmentApprovalConfigError ||
    err instanceof ManualCaptureError ||
    err instanceof NoHireApprovalStagesConfiguredError ||
    err instanceof EmploymentParticularsIssuedError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof HireAuthorizationStateError || err instanceof OfferResponseNotAllowedError || err instanceof DuplicateApplicationError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

// --- recruitment sources -----------------------------------------------------

// GET /organizations/:organizationId/recruitment/sources
router.get(
  "/organizations/:organizationId/recruitment/sources",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("candidate.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ sources: await listRecruitmentSources(req.membership!.organizationId) });
  },
);

// --- approval stage configuration --------------------------------------------

// GET /organizations/:organizationId/recruitment/approval-stages?purpose=hire
router.get(
  "/organizations/:organizationId/recruitment/approval-stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("recruitment_settings.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const purpose = req.query.purpose === "requisition" ? "requisition" : "hire";
    res.json({ purpose, stages: await listApprovalStages(req.membership!.organizationId, purpose) });
  },
);

// POST /organizations/:organizationId/recruitment/approval-stages
router.post(
  "/organizations/:organizationId/recruitment/approval-stages",
  requireAuth as any,
  requireMembership("organizationId"),
  // Configuring who approves is an administrative act, deliberately distinct
  // from operational approval authority (§25.19).
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const stage = await createApprovalStage({
        organizationId: req.membership!.organizationId,
        input: {
          purpose: req.body?.purpose === "requisition" ? "requisition" : "hire",
          stageOrder: Number(req.body?.stageOrder),
          name: String(req.body?.name ?? ""),
          resolverType: req.body?.resolverType,
          resolverConfig: req.body?.resolverConfig ?? null,
        },
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "recruitment_approval_stage.created",
        targetType: "recruitment_approval_stage",
        targetId: String(stage.id),
        afterState: { purpose: stage.purpose, stageOrder: stage.stageOrder, name: stage.name, resolverType: stage.resolverType },
      });

      res.status(201).json(stage);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/recruitment/approval-stages/:stageId
router.delete(
  "/organizations/:organizationId/recruitment/approval-stages/:stageId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const stageId = Number(req.params.stageId);
    await deleteApprovalStage(req.membership!.organizationId, stageId);

    await recordAuditEvent({
      organizationId: req.membership!.organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      eventType: "recruitment_approval_stage.deleted",
      targetType: "recruitment_approval_stage",
      targetId: String(stageId),
    });

    res.status(204).send();
  },
);

// --- hire authorization ------------------------------------------------------

// GET /organizations/:organizationId/applications/:applicationId/hire-authorization
router.get(
  "/organizations/:organizationId/applications/:applicationId/hire-authorization",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("application.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(await getHireAuthorizationDetail(req.membership!.organizationId, Number(req.params.applicationId)));
  },
);

// POST /organizations/:organizationId/applications/:applicationId/hire-authorization
router.post(
  "/organizations/:organizationId/applications/:applicationId/hire-authorization",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("application.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const authorization = await requestHireAuthorization({
        organizationId: req.membership!.organizationId,
        applicationId: Number(req.params.applicationId),
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "hire_authorization.requested",
        targetType: "application",
        targetId: String(authorization.applicationId),
        afterState: { totalStages: authorization.totalStages },
      });

      res.status(201).json(authorization);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

/**
 * Decide one stage. Deliberately NOT gated on a broad permission: authority is
 * resolved per-stage from the organization's own configuration, so the route
 * only requires the caller to be able to see the application at all. The real
 * gate is `resolveStageAuthority`, which cannot be satisfied by holding a role.
 */
// POST /organizations/:organizationId/hire-authorizations/:id/decide
router.post(
  "/organizations/:organizationId/hire-authorizations/:id/decide",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("application.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const decision = req.body?.decision === "rejected" ? "rejected" : "approved";
      const updated = await decideHireAuthorizationStage({
        organizationId: req.membership!.organizationId,
        hireAuthorizationId: Number(req.params.id),
        actorMembershipId: req.membership!.id,
        actorUserId: req.userId!,
        decision,
        reason: req.body?.reason ?? null,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "hire_authorization.decided",
        targetType: "application",
        targetId: String(updated.applicationId),
        afterState: { decision, status: updated.status, currentStageOrder: updated.currentStageOrder },
      });

      res.json(updated);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// --- manual candidate capture ------------------------------------------------

// POST /organizations/:organizationId/recruitment/manual-candidates
router.post(
  "/organizations/:organizationId/recruitment/manual-candidates",
  requireAuth as any,
  requireMembership("organizationId"),
  // Authorization replaces publication as the control on this path (§25.6).
  requirePermission("candidate.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const result = await captureCandidateManually({
        organizationId: req.membership!.organizationId,
        vacancyId: Number(req.body?.vacancyId),
        sourceCode: String(req.body?.sourceCode ?? ""),
        firstName: String(req.body?.firstName ?? ""),
        lastName: String(req.body?.lastName ?? ""),
        email: String(req.body?.email ?? ""),
        phone: req.body?.phone ?? null,
        capturedAt: req.body?.capturedAt ? new Date(req.body.capturedAt) : null,
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "candidate.manually_captured",
        targetType: "application",
        targetId: String(result.application.id),
        // Identity and provenance only — never the candidate's personal detail.
        afterState: {
          candidateId: result.candidate.id,
          vacancyId: result.application.vacancyId,
          sourceCode: result.application.sourceCode,
          reusedExistingCandidate: result.reusedExistingCandidate,
        },
      });

      res.status(201).json(result);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// --- offer lifecycle ---------------------------------------------------------

// GET /organizations/:organizationId/offer-versions/:versionId/state
router.get(
  "/organizations/:organizationId/offer-versions/:versionId/state",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offer.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const state = await getOfferVersionState(req.membership!.organizationId, Number(req.params.versionId));
    if (!state) {
      res.status(404).json({ error: "Offer version not found" });
      return;
    }
    res.json(state);
  },
);

/** Staff-recorded acceptance/decline — the candidate replied by phone, email or in person. */
// POST /organizations/:organizationId/offer-versions/:versionId/record-response
router.post(
  "/organizations/:organizationId/offer-versions/:versionId/record-response",
  requireAuth as any,
  requireMembership("organizationId"),
  // `offer.issue` rather than `offer.manage`: recording a candidate's decision
  // is an offer-desk action, and `offer.manage` is held by every employee.
  requirePermission("offer.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const responseType = req.body?.responseType === "declined" ? "declined" : "accepted";
      const response = await recordOfferResponse({
        organizationId: req.membership!.organizationId,
        offerVersionId: Number(req.params.versionId),
        responseType,
        channel: "recorded_by_staff",
        reason: req.body?.reason ?? null,
        evidence: req.body?.evidence ?? null,
        respondedByMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: responseType === "accepted" ? "offer.accepted" : "offer.declined",
        targetType: "offer_version",
        targetId: String(response.offerVersionId),
        afterState: { channel: response.channel, responseType },
      });

      res.status(201).json(response);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/offer-versions/:versionId/withdraw-response
router.post(
  "/organizations/:organizationId/offer-versions/:versionId/withdraw-response",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offer.withdraw"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const versionId = Number(req.params.versionId);

      // §25.11 — withdrawal is prevented once conversion has completed.
      const [converted] = await db
        .select({ id: candidateEmployeeLinksTable.id })
        .from(candidateEmployeeLinksTable)
        .innerJoin(offersTable, eq(offersTable.applicationId, candidateEmployeeLinksTable.applicationId))
        .innerJoin(offerVersionsTable, eq(offerVersionsTable.offerId, offersTable.id))
        .where(and(eq(offerVersionsTable.id, versionId), eq(candidateEmployeeLinksTable.organizationId, organizationId)))
        .limit(1);

      const response = await recordOfferWithdrawal({
        organizationId,
        offerVersionId: versionId,
        reason: String(req.body?.reason ?? ""),
        respondedByMembershipId: req.membership!.id,
        conversionCompleted: !!converted,
      });

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "offer.withdrawn_with_reason",
        targetType: "offer_version",
        targetId: String(versionId),
        afterState: { reason: response.reason },
      });

      res.status(201).json(response);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

/** Issues a single-purpose candidate response link. The plaintext is returned once. */
// POST /organizations/:organizationId/offer-versions/:versionId/response-link
router.post(
  "/organizations/:organizationId/offer-versions/:versionId/response-link",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offer.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const { token, expiresAt } = await issueResponseToken({
        organizationId: req.membership!.organizationId,
        offerVersionId: Number(req.params.versionId),
        actorMembershipId: req.membership!.id,
      });

      await recordAuditEvent({
        organizationId: req.membership!.organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "offer.response_link_issued",
        targetType: "offer_version",
        targetId: String(req.params.versionId),
        // The token itself is NEVER audited or logged — only that one was issued.
        afterState: { expiresAt: expiresAt.toISOString() },
      });

      res.status(201).json({ token, expiresAt });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// --- public candidate response (unauthenticated, token-gated) ----------------

// GET /offer-response/:token
router.get("/offer-response/:token", offerResponseRateLimiter, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveResponseToken(String(req.params.token));
    const view = await getCandidateOfferView(resolved.offerVersionId, resolved.organizationId);
    if (!view) {
      res.status(404).json({ error: "This response link is no longer valid" });
      return;
    }
    // Minimal, candidate-safe projection (§25.16) — no internal approval data,
    // no scorecards, no notes, no other candidates.
    res.json(view);
  } catch (err) {
    if (err instanceof OfferResponseTokenInvalidError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// POST /offer-response/:token
router.post("/offer-response/:token", offerResponseRateLimiter, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveResponseToken(String(req.params.token));
    const responseType = req.body?.responseType === "declined" ? "declined" : "accepted";

    // Consume first: replay protection is a conditional UPDATE, so a second
    // concurrent submission finds nothing to consume and is refused before it
    // can record a second response.
    await consumeResponseToken(resolved.tokenId);

    const response = await recordOfferResponse({
      organizationId: resolved.organizationId,
      offerVersionId: resolved.offerVersionId,
      responseType,
      channel: "candidate_token",
      reason: typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null,
      respondedByMembershipId: null,
    });

    await recordAuditEvent({
      organizationId: resolved.organizationId,
      eventType: responseType === "accepted" ? "offer.accepted" : "offer.declined",
      targetType: "offer_version",
      targetId: String(resolved.offerVersionId),
      afterState: { channel: "candidate_token", responseType },
    });

    res.status(201).json({ responseType: response.responseType, respondedAt: response.respondedAt });
  } catch (err) {
    if (err instanceof OfferResponseTokenInvalidError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof OfferResponseNotAllowedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// --- employment particulars --------------------------------------------------

// GET /organizations/:organizationId/offer-versions/:versionId/particulars
router.get(
  "/organizations/:organizationId/offer-versions/:versionId/particulars",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offer.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const versionId = Number(req.params.versionId);
      const particulars = await getParticularsByOfferVersion(organizationId, versionId);
      // Suggestions are only meaningful for a draft; an issued record is shown as-is.
      const suggested = particulars?.issuedAt ? null : await suggestParticulars(organizationId, versionId);
      res.json({ particulars, suggested });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

// PUT /organizations/:organizationId/offer-versions/:versionId/particulars
router.put(
  "/organizations/:organizationId/offer-versions/:versionId/particulars",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offer.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const saved = await saveParticulars({
        organizationId: req.membership!.organizationId,
        offerVersionId: Number(req.params.versionId),
        fields: {
          employerName: req.body?.employerName ?? null,
          workerName: req.body?.workerName ?? null,
          dateOfFirstAppointment: req.body?.dateOfFirstAppointment ? new Date(req.body.dateOfFirstAppointment) : null,
          jobTitleOrGrade: req.body?.jobTitleOrGrade ?? null,
          payRate: req.body?.payRate ?? null,
          payMethod: req.body?.payMethod ?? null,
          payInterval: req.body?.payInterval ?? null,
          hoursOfWork: req.body?.hoursOfWork ?? null,
          holidayTerms: req.body?.holidayTerms ?? null,
          sickPayTerms: req.body?.sickPayTerms ?? null,
          pensionTerms: req.body?.pensionTerms ?? null,
          noticeByEmployer: req.body?.noticeByEmployer ?? null,
          noticeByWorker: req.body?.noticeByWorker ?? null,
          disciplinaryRules: req.body?.disciplinaryRules ?? null,
          grievanceProcedure: req.body?.grievanceProcedure ?? null,
          overtimeTerms: req.body?.overtimeTerms ?? null,
          probationTerms: req.body?.probationTerms ?? null,
        },
        derivedFrom: req.body?.derivedFrom ?? null,
        actorMembershipId: req.membership!.id,
      });
      res.json(saved);
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

/**
 * Freezes the particulars and, when a template is supplied, generates the
 * immutable artifact through WS-5. Generation reads only the frozen snapshot,
 * so regenerating produces the same content.
 */
// POST /organizations/:organizationId/offer-versions/:versionId/particulars/issue
router.post(
  "/organizations/:organizationId/offer-versions/:versionId/particulars/issue",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offer.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const versionId = Number(req.params.versionId);

      const particulars = await issueParticulars({
        organizationId,
        offerVersionId: versionId,
        actorMembershipId: req.membership!.id,
      });

      let generated = null;
      const templateId = req.body?.templateId != null ? Number(req.body.templateId) : null;
      if (templateId) {
        const result = await generateDocument({
          organizationId,
          templateId,
          entityContext: buildParticularsMergeContext(particulars),
          // Generic linkage WS-5 already indexes — no parallel reference table.
          sourceType: "offer_version",
          sourceId: versionId,
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
        });
        generated = result.generated;

        // Wire the reserved column rather than inventing a parallel reference (§25.10).
        await db
          .update(offerVersionsTable)
          .set({ generatedDocumentStorageKey: result.generated.storageKey, letterTemplateId: templateId })
          .where(eq(offerVersionsTable.id, versionId));
      }

      await recordAuditEvent({
        organizationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        eventType: "employment_particulars.issued",
        targetType: "offer_version",
        targetId: String(versionId),
        // Lineage only — never rendered document text.
        afterState: { particularsId: particulars.id, generatedDocumentId: generated?.id ?? null },
      });

      res.json({ particulars, generated });
    } catch (err) {
      if (handleError(err, res)) return;
      throw err;
    }
  },
);

export default router;
