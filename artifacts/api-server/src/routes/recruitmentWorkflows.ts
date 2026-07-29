import { Router } from "express";
import {
  CreateRecruitmentWorkflowBody,
  UpdateRecruitmentWorkflowBody,
  CreateRecruitmentStageBody,
  UpdateRecruitmentStageBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { isUniqueViolation } from "../lib/dbErrors";
import {
  listRecruitmentWorkflows,
  createRecruitmentWorkflow,
  updateRecruitmentWorkflow,
  archiveRecruitmentWorkflow,
  reactivateRecruitmentWorkflow,
  setDefaultRecruitmentWorkflow,
  RecruitmentWorkflowNotFoundError,
  DuplicateRecruitmentWorkflowNameError,
} from "../lib/recruitmentWorkflows";
import {
  listRecruitmentStages,
  createRecruitmentStage,
  updateRecruitmentStage,
  archiveRecruitmentStage,
  reactivateRecruitmentStage,
  RecruitmentStageNotFoundError,
  RecruitmentWorkflowNotFoundForStageError,
  DuplicateRecruitmentStageError,
  type RecruitmentStageCategory,
} from "../lib/recruitmentStages";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/recruitment-workflows
router.get(
  "/organizations/:organizationId/recruitment-workflows",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflows = await listRecruitmentWorkflows(req.membership!.organizationId);
    res.json(workflows);
  },
);

// POST /organizations/:organizationId/recruitment-workflows
router.post(
  "/organizations/:organizationId/recruitment-workflows",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateRecruitmentWorkflowBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const workflow = await createRecruitmentWorkflow({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description,
        displayOrder: parsed.data.displayOrder,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(workflow);
    } catch (err) {
      if (err instanceof DuplicateRecruitmentWorkflowNameError || isUniqueViolation(err)) {
        res.status(409).json({ error: "A recruitment workflow with this name already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/recruitment-workflows/:workflowId
router.patch(
  "/organizations/:organizationId/recruitment-workflows/:workflowId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID" });
      return;
    }
    const parsed = UpdateRecruitmentWorkflowBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const workflow = await updateRecruitmentWorkflow({
        organizationId: req.membership!.organizationId,
        workflowId,
        name: parsed.data.name,
        description: parsed.data.description,
        displayOrder: parsed.data.displayOrder,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(workflow);
    } catch (err) {
      if (err instanceof RecruitmentWorkflowNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateRecruitmentWorkflowNameError || isUniqueViolation(err)) {
        res.status(409).json({ error: "A recruitment workflow with this name already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/recruitment-workflows/:workflowId/archive
router.post(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID" });
      return;
    }
    try {
      const workflow = await archiveRecruitmentWorkflow({
        organizationId: req.membership!.organizationId,
        workflowId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(workflow);
    } catch (err) {
      if (err instanceof RecruitmentWorkflowNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/recruitment-workflows/:workflowId/reactivate
router.post(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID" });
      return;
    }
    try {
      const workflow = await reactivateRecruitmentWorkflow({
        organizationId: req.membership!.organizationId,
        workflowId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(workflow);
    } catch (err) {
      if (err instanceof RecruitmentWorkflowNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/recruitment-workflows/:workflowId/set-default
router.post(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/set-default",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID" });
      return;
    }
    try {
      const workflow = await setDefaultRecruitmentWorkflow({
        organizationId: req.membership!.organizationId,
        workflowId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(workflow);
    } catch (err) {
      if (err instanceof RecruitmentWorkflowNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/recruitment-workflows/:workflowId/stages
router.get(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID" });
      return;
    }
    try {
      const stages = await listRecruitmentStages(req.membership!.organizationId, workflowId);
      res.json(stages);
    } catch (err) {
      if (err instanceof RecruitmentWorkflowNotFoundForStageError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/recruitment-workflows/:workflowId/stages
router.post(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/stages",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    if (isNaN(workflowId)) {
      res.status(400).json({ error: "Invalid workflow ID" });
      return;
    }
    const parsed = CreateRecruitmentStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const stage = await createRecruitmentStage({
        organizationId: req.membership!.organizationId,
        workflowId,
        name: parsed.data.name,
        category: parsed.data.category as RecruitmentStageCategory,
        displayOrder: parsed.data.displayOrder,
        color: parsed.data.color,
        icon: parsed.data.icon,
        isRequired: parsed.data.isRequired,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(stage);
    } catch (err) {
      if (err instanceof RecruitmentWorkflowNotFoundForStageError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateRecruitmentStageError || isUniqueViolation(err)) {
        res.status(409).json({ error: "A stage with this name or display order already exists in this workflow" });
        return;
      }
      throw err;
    }
  },
);

// PATCH /organizations/:organizationId/recruitment-workflows/:workflowId/stages/:stageId
router.patch(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/stages/:stageId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    const stageId = parseId(req.params.stageId);
    if (isNaN(workflowId) || isNaN(stageId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const parsed = UpdateRecruitmentStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const stage = await updateRecruitmentStage({
        organizationId: req.membership!.organizationId,
        workflowId,
        stageId,
        name: parsed.data.name,
        category: parsed.data.category as RecruitmentStageCategory | undefined,
        displayOrder: parsed.data.displayOrder,
        color: parsed.data.color,
        icon: parsed.data.icon,
        isRequired: parsed.data.isRequired,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(stage);
    } catch (err) {
      if (err instanceof RecruitmentStageNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof DuplicateRecruitmentStageError || isUniqueViolation(err)) {
        res.status(409).json({ error: "A stage with this name or display order already exists in this workflow" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/recruitment-workflows/:workflowId/stages/:stageId/archive
router.post(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/stages/:stageId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    const stageId = parseId(req.params.stageId);
    if (isNaN(workflowId) || isNaN(stageId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const stage = await archiveRecruitmentStage({
        organizationId: req.membership!.organizationId,
        workflowId,
        stageId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(stage);
    } catch (err) {
      if (err instanceof RecruitmentStageNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/recruitment-workflows/:workflowId/stages/:stageId/reactivate
router.post(
  "/organizations/:organizationId/recruitment-workflows/:workflowId/stages/:stageId/reactivate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment_settings.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const workflowId = parseId(req.params.workflowId);
    const stageId = parseId(req.params.stageId);
    if (isNaN(workflowId) || isNaN(stageId)) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const stage = await reactivateRecruitmentStage({
        organizationId: req.membership!.organizationId,
        workflowId,
        stageId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(stage);
    } catch (err) {
      if (err instanceof RecruitmentStageNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
