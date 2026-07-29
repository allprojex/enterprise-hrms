import { Router } from "express";
import {
  CreateJobRequisitionBody,
  UpdateJobRequisitionBody,
  CancelJobRequisitionBody,
  ApproveJobRequisitionBody,
  RejectJobRequisitionBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import { toIsoDate } from "../lib/leaveRequests";
import {
  listJobRequisitions,
  createJobRequisition,
  getVisibleJobRequisitionById,
  updateJobRequisition,
  submitJobRequisition,
  cancelJobRequisition,
  archiveJobRequisition,
  resolveRequisitionVisibilityContext,
  JobRequisitionNotFoundError,
  JobRequisitionNotEditableError,
  InvalidJobRequisitionError,
  InvalidJobRequisitionTransitionError,
  type JobRequisitionType,
  type JobRequisitionWorkplaceType,
} from "../lib/jobRequisitions";
import {
  listPendingRequisitionApprovals,
  listRequisitionApprovalHistory,
  approveJobRequisition,
  rejectJobRequisition,
  RequisitionApprovalNotPendingError,
  RequisitionApprovalTargetNotFoundError,
} from "../lib/requisitionApprovals";

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

// GET /organizations/:organizationId/job-requisitions
router.get(
  "/organizations/:organizationId/job-requisitions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveRequisitionVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });

    const page = Math.max(1, parseOptionalId(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, parseOptionalId(req.query.pageSize) ?? 20));

    const result = await listJobRequisitions({
      organizationId,
      visibility,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      requisitionType: typeof req.query.requisitionType === "string" ? req.query.requisitionType : undefined,
      departmentId: parseOptionalId(req.query.departmentId),
      branchId: parseOptionalId(req.query.branchId),
      hiringManagerEmployeeId: parseOptionalId(req.query.hiringManagerEmployeeId),
      recruiterEmployeeId: parseOptionalId(req.query.recruiterEmployeeId),
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      page,
      pageSize,
    });

    res.json({ ...result, page, pageSize });
  },
);

// POST /organizations/:organizationId/job-requisitions
router.post(
  "/organizations/:organizationId/job-requisitions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.create"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateJobRequisitionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const requisition = await createJobRequisition({
        organizationId: req.membership!.organizationId,
        fields: {
          ...parsed.data,
          requisitionType: parsed.data.requisitionType as JobRequisitionType,
          workplaceType: parsed.data.workplaceType as JobRequisitionWorkplaceType | null | undefined,
          expectedStartDate: parsed.data.expectedStartDate ? toIsoDate(parsed.data.expectedStartDate) : parsed.data.expectedStartDate,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(requisition);
    } catch (err) {
      if (err instanceof InvalidJobRequisitionError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/job-requisitions/pending-approvals
// Registered before the /:id route below — Express matches routes in
// registration order, and /:id would otherwise swallow "pending-approvals"
// as its id parameter.
router.get(
  "/organizations/:organizationId/job-requisitions/pending-approvals",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const requisitions = await listPendingRequisitionApprovals(organizationId);
    res.json(requisitions);
  },
);

// GET /organizations/:organizationId/job-requisitions/:id
router.get(
  "/organizations/:organizationId/job-requisitions/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveRequisitionVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const requisition = await getVisibleJobRequisitionById(organizationId, requisitionId, visibility);
    if (!requisition) {
      res.status(404).json({ error: "Job requisition not found" });
      return;
    }
    res.json(requisition);
  },
);

// PATCH /organizations/:organizationId/job-requisitions/:id
router.patch(
  "/organizations/:organizationId/job-requisitions/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.update"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    const parsed = UpdateJobRequisitionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const requisition = await updateJobRequisition({
        organizationId: req.membership!.organizationId,
        requisitionId,
        fields: {
          ...parsed.data,
          requisitionType: parsed.data.requisitionType as JobRequisitionType | undefined,
          workplaceType: parsed.data.workplaceType as JobRequisitionWorkplaceType | null | undefined,
          expectedStartDate: parsed.data.expectedStartDate ? toIsoDate(parsed.data.expectedStartDate) : parsed.data.expectedStartDate,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requisition);
    } catch (err) {
      if (err instanceof JobRequisitionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (
        err instanceof JobRequisitionNotEditableError ||
        err instanceof InvalidJobRequisitionError ||
        err instanceof CrossOrganizationReferenceError
      ) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/job-requisitions/:id/submit
router.post(
  "/organizations/:organizationId/job-requisitions/:id/submit",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.update"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    try {
      const requisition = await submitJobRequisition({
        organizationId: req.membership!.organizationId,
        requisitionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requisition);
    } catch (err) {
      if (err instanceof JobRequisitionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidJobRequisitionTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/job-requisitions/:id/cancel
router.post(
  "/organizations/:organizationId/job-requisitions/:id/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.cancel"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    const parsed = CancelJobRequisitionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const requisition = await cancelJobRequisition({
        organizationId: req.membership!.organizationId,
        requisitionId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requisition);
    } catch (err) {
      if (err instanceof JobRequisitionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidJobRequisitionTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/job-requisitions/:id/archive
router.post(
  "/organizations/:organizationId/job-requisitions/:id/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.update"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    try {
      const requisition = await archiveJobRequisition({
        organizationId: req.membership!.organizationId,
        requisitionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requisition);
    } catch (err) {
      if (err instanceof JobRequisitionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidJobRequisitionTransitionError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/job-requisitions/:id/approvals
router.get(
  "/organizations/:organizationId/job-requisitions/:id/approvals",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const visibility = await resolveRequisitionVisibilityContext({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    // Same 404-not-distinguished-from-invisible rule as GET .../job-requisitions/:id
    // — approval history is never visible on a requisition the caller can't see.
    const requisition = await getVisibleJobRequisitionById(organizationId, requisitionId, visibility);
    if (!requisition) {
      res.status(404).json({ error: "Job requisition not found" });
      return;
    }
    const history = await listRequisitionApprovalHistory(organizationId, requisitionId);
    res.json(history);
  },
);

// POST /organizations/:organizationId/job-requisitions/:id/approve
router.post(
  "/organizations/:organizationId/job-requisitions/:id/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    const parsed = ApproveJobRequisitionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const requisition = await approveJobRequisition({
        organizationId: req.membership!.organizationId,
        requisitionId,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requisition);
    } catch (err) {
      if (err instanceof RequisitionApprovalTargetNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof RequisitionApprovalNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/job-requisitions/:id/reject
router.post(
  "/organizations/:organizationId/job-requisitions/:id/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("requisition.approve"),
  async (req: MembershipRequest, res): Promise<void> => {
    const requisitionId = parseId(req.params.id);
    if (isNaN(requisitionId)) {
      res.status(400).json({ error: "Invalid requisition ID" });
      return;
    }
    const parsed = RejectJobRequisitionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const requisition = await rejectJobRequisition({
        organizationId: req.membership!.organizationId,
        requisitionId,
        comment: parsed.data.comment,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(requisition);
    } catch (err) {
      if (err instanceof RequisitionApprovalTargetNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof RequisitionApprovalNotPendingError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
