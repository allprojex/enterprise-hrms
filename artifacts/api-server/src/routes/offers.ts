import { Router } from "express";
import { CreateOfferBody, UpdateDraftOfferVersionBody, CreateNewOfferVersionBody, ApproveOfferVersionBody, WithdrawOfferVersionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import {
  listOffers,
  getVisibleOfferById,
  getVisibleOfferByApplicationId,
  getVisibleOfferVersionById,
  createOffer,
  updateDraftOfferVersion,
  createNewOfferVersion,
  submitOfferVersionForApproval,
  issueOfferVersion,
  withdrawOfferVersion,
  resolveOfferVisibilityContext,
  toPublicOfferVersion,
  OfferNotFoundError,
  ApplicationNotFoundForOfferError,
  OfferVersionNotFoundError,
  DuplicateOfferError,
  OfferVersionNotEditableError,
  InvalidOfferTransitionError,
} from "../lib/offers";
import { listOfferApprovalHistory, approveOfferVersion, OfferApprovalNotPendingError, OfferApprovalTargetNotFoundError } from "../lib/offerApprovals";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import { toIsoDate } from "../lib/leaveRequests";

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

function handleOfferError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof OfferNotFoundError || err instanceof ApplicationNotFoundForOfferError || err instanceof OfferVersionNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof DuplicateOfferError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (err instanceof OfferVersionNotEditableError || err instanceof InvalidOfferTransitionError || err instanceof CrossOrganizationReferenceError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/offers
router.get(
  "/organizations/:organizationId/offers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });

    const page = Math.max(1, parseOptionalId(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseOptionalId(req.query.pageSize) ?? 20));

    const result = await listOffers({ organizationId, visibility, page, pageSize });
    res.json({ ...result, page, pageSize });
  },
);

// GET /organizations/:organizationId/offers/:id
router.get(
  "/organizations/:organizationId/offers/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerId = parseId(req.params.id);
    if (isNaN(offerId)) {
      res.status(400).json({ error: "Invalid offer ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const offer = await getVisibleOfferById(organizationId, offerId, visibility);
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    res.json(offer);
  },
);

// GET /organizations/:organizationId/applications/:applicationId/offers
router.get(
  "/organizations/:organizationId/applications/:applicationId/offers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const offer = await getVisibleOfferByApplicationId(organizationId, applicationId, visibility);
    if (!offer) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    res.json(offer);
  },
);

// POST /organizations/:organizationId/applications/:applicationId/offers
router.post(
  "/organizations/:organizationId/applications/:applicationId/offers",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const applicationId = parseId(req.params.applicationId);
    if (isNaN(applicationId)) {
      res.status(400).json({ error: "Invalid application ID" });
      return;
    }
    const parsed = CreateOfferBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const offer = await createOffer({
        organizationId,
        applicationId,
        fields: {
          ...parsed.data,
          proposedStartDate: parsed.data.proposedStartDate ? toIsoDate(parsed.data.proposedStartDate) : parsed.data.proposedStartDate,
          expiryDate: parsed.data.expiryDate ? toIsoDate(parsed.data.expiryDate) : parsed.data.expiryDate,
        },
        visibility,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(offer);
    } catch (err) {
      if (handleOfferError(err, res)) return;
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/offers/:id
router.patch(
  "/organizations/:organizationId/offers/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerId = parseId(req.params.id);
    if (isNaN(offerId)) {
      res.status(400).json({ error: "Invalid offer ID" });
      return;
    }
    const parsed = UpdateDraftOfferVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const offer = await updateDraftOfferVersion({
        organizationId,
        offerId,
        fields: {
          ...parsed.data,
          proposedStartDate: parsed.data.proposedStartDate ? toIsoDate(parsed.data.proposedStartDate) : parsed.data.proposedStartDate,
          expiryDate: parsed.data.expiryDate ? toIsoDate(parsed.data.expiryDate) : parsed.data.expiryDate,
        },
        visibility,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(offer);
    } catch (err) {
      if (handleOfferError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/offers/:id/versions
router.post(
  "/organizations/:organizationId/offers/:id/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerId = parseId(req.params.id);
    if (isNaN(offerId)) {
      res.status(400).json({ error: "Invalid offer ID" });
      return;
    }
    const parsed = CreateNewOfferVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const offer = await createNewOfferVersion({
        organizationId,
        offerId,
        fields: {
          ...parsed.data,
          proposedStartDate: parsed.data.proposedStartDate ? toIsoDate(parsed.data.proposedStartDate) : parsed.data.proposedStartDate,
          expiryDate: parsed.data.expiryDate ? toIsoDate(parsed.data.expiryDate) : parsed.data.expiryDate,
        },
        visibility,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(offer);
    } catch (err) {
      if (handleOfferError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/offers/versions/:id/submit-for-approval
router.post(
  "/organizations/:organizationId/offers/versions/:id/submit-for-approval",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerVersionId = parseId(req.params.id);
    if (isNaN(offerVersionId)) {
      res.status(400).json({ error: "Invalid offer version ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    try {
      const version = await submitOfferVersionForApproval({
        organizationId,
        offerVersionId,
        visibility,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(version);
    } catch (err) {
      if (handleOfferError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/offers/versions/:id/approvals
router.get(
  "/organizations/:organizationId/offers/versions/:id/approvals",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerVersionId = parseId(req.params.id);
    if (isNaN(offerVersionId)) {
      res.status(400).json({ error: "Invalid offer version ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveOfferVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const version = await getVisibleOfferVersionById(organizationId, offerVersionId, visibility);
    if (!version) {
      res.status(404).json({ error: "Offer version not found" });
      return;
    }
    const history = await listOfferApprovalHistory(organizationId, offerVersionId);
    res.json(history);
  },
);

// POST /organizations/:organizationId/offers/versions/:id/approve
router.post(
  "/organizations/:organizationId/offers/versions/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerVersionId = parseId(req.params.id);
    if (isNaN(offerVersionId)) {
      res.status(400).json({ error: "Invalid offer version ID" });
      return;
    }
    const parsed = ApproveOfferVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const version = await approveOfferVersion({
        organizationId: req.membership!.organizationId,
        offerVersionId,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(toPublicOfferVersion(version));
    } catch (err) {
      if (err instanceof OfferApprovalTargetNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof OfferApprovalNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/offers/versions/:id/issue
router.post(
  "/organizations/:organizationId/offers/versions/:id/issue",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.issue"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerVersionId = parseId(req.params.id);
    if (isNaN(offerVersionId)) {
      res.status(400).json({ error: "Invalid offer version ID" });
      return;
    }
    try {
      const version = await issueOfferVersion({
        organizationId: req.membership!.organizationId,
        offerVersionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(version);
    } catch (err) {
      if (handleOfferError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/offers/versions/:id/withdraw
router.post(
  "/organizations/:organizationId/offers/versions/:id/withdraw",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("offer.withdraw"),
  async (req: MembershipRequest, res): Promise<void> => {
    const offerVersionId = parseId(req.params.id);
    if (isNaN(offerVersionId)) {
      res.status(400).json({ error: "Invalid offer version ID" });
      return;
    }
    const parsed = WithdrawOfferVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const version = await withdrawOfferVersion({
        organizationId: req.membership!.organizationId,
        offerVersionId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(version);
    } catch (err) {
      if (handleOfferError(err, res)) return;
      throw err;
    }
  },
);

export default router;
