/**
 * Recruitment Stages (Phase 3A, W44): ordered stages within a workflow. No
 * candidate movement happens here — this is definition only. Mirrors
 * leaveTypes.ts's archive/reactivate shape; `isTerminal` is derived from
 * `category` server-side (never independently settable to a contradictory
 * value), per the frozen plan's stage-category model
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §4.3).
 */
import { and, eq } from "drizzle-orm";
import { db, recruitmentStagesTable, recruitmentWorkflowsTable, type RecruitmentStage } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export type RecruitmentStageCategory =
  | "applied"
  | "screening"
  | "interview"
  | "assessment"
  | "offer"
  | "hired"
  | "rejected"
  | "withdrawn";

const TERMINAL_CATEGORIES: ReadonlySet<RecruitmentStageCategory> = new Set(["hired", "rejected", "withdrawn"]);

export class RecruitmentStageNotFoundError extends Error {
  constructor() {
    super("Recruitment stage not found");
    this.name = "RecruitmentStageNotFoundError";
  }
}

export class RecruitmentWorkflowNotFoundForStageError extends Error {
  constructor() {
    super("Recruitment workflow not found in this organization");
    this.name = "RecruitmentWorkflowNotFoundForStageError";
  }
}

export class DuplicateRecruitmentStageError extends Error {
  constructor() {
    super("A stage with this name or display order already exists in this workflow");
    this.name = "DuplicateRecruitmentStageError";
  }
}

async function assertOwnWorkflow(organizationId: number, workflowId: number): Promise<void> {
  const [row] = await db
    .select({ id: recruitmentWorkflowsTable.id })
    .from(recruitmentWorkflowsTable)
    .where(and(eq(recruitmentWorkflowsTable.id, workflowId), eq(recruitmentWorkflowsTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new RecruitmentWorkflowNotFoundForStageError();
}

export async function listRecruitmentStages(organizationId: number, workflowId: number): Promise<RecruitmentStage[]> {
  await assertOwnWorkflow(organizationId, workflowId);
  return db
    .select()
    .from(recruitmentStagesTable)
    .where(and(eq(recruitmentStagesTable.organizationId, organizationId), eq(recruitmentStagesTable.workflowId, workflowId)));
}

async function findOwnStage(organizationId: number, workflowId: number, stageId: number) {
  const [row] = await db
    .select()
    .from(recruitmentStagesTable)
    .where(
      and(
        eq(recruitmentStagesTable.id, stageId),
        eq(recruitmentStagesTable.organizationId, organizationId),
        eq(recruitmentStagesTable.workflowId, workflowId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createRecruitmentStage(params: {
  organizationId: number;
  workflowId: number;
  name: string;
  category: RecruitmentStageCategory;
  displayOrder: number;
  color?: string | null;
  icon?: string | null;
  isRequired?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentStage> {
  await assertOwnWorkflow(params.organizationId, params.workflowId);

  try {
    const [stage] = await db
      .insert(recruitmentStagesTable)
      .values({
        organizationId: params.organizationId,
        workflowId: params.workflowId,
        name: params.name,
        category: params.category,
        displayOrder: params.displayOrder,
        color: params.color ?? null,
        icon: params.icon ?? null,
        isRequired: params.isRequired ?? false,
        isTerminal: TERMINAL_CATEGORIES.has(params.category),
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "recruitment_stage.created",
      targetType: "recruitment_stage",
      targetId: String(stage.id),
      afterState: { name: stage.name, category: stage.category, displayOrder: stage.displayOrder },
    });

    return stage;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateRecruitmentStageError();
    throw err;
  }
}

export async function updateRecruitmentStage(params: {
  organizationId: number;
  workflowId: number;
  stageId: number;
  name?: string;
  category?: RecruitmentStageCategory;
  displayOrder?: number;
  color?: string | null;
  icon?: string | null;
  isRequired?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentStage> {
  const before = await findOwnStage(params.organizationId, params.workflowId, params.stageId);
  if (!before) throw new RecruitmentStageNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.displayOrder !== undefined) patch.displayOrder = params.displayOrder;
  if (params.color !== undefined) patch.color = params.color;
  if (params.icon !== undefined) patch.icon = params.icon;
  if (params.isRequired !== undefined) patch.isRequired = params.isRequired;
  if (params.category !== undefined) {
    patch.category = params.category;
    patch.isTerminal = TERMINAL_CATEGORIES.has(params.category);
  }

  try {
    const [updated] = await db
      .update(recruitmentStagesTable)
      .set(patch)
      .where(eq(recruitmentStagesTable.id, params.stageId))
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "recruitment_stage.updated",
      targetType: "recruitment_stage",
      targetId: String(params.stageId),
      beforeState: { name: before.name, category: before.category, displayOrder: before.displayOrder },
      afterState: { name: updated.name, category: updated.category, displayOrder: updated.displayOrder },
    });

    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateRecruitmentStageError();
    throw err;
  }
}

async function setStageActive(params: {
  organizationId: number;
  workflowId: number;
  stageId: number;
  isActive: boolean;
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentStage> {
  const before = await findOwnStage(params.organizationId, params.workflowId, params.stageId);
  if (!before) throw new RecruitmentStageNotFoundError();

  const [updated] = await db
    .update(recruitmentStagesTable)
    .set({ isActive: params.isActive })
    .where(eq(recruitmentStagesTable.id, params.stageId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "recruitment_stage",
    targetId: String(params.stageId),
    beforeState: { isActive: before.isActive },
    afterState: { isActive: updated.isActive },
  });

  return updated;
}

export const archiveRecruitmentStage = (params: {
  organizationId: number;
  workflowId: number;
  stageId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setStageActive({ ...params, isActive: false, eventType: "recruitment_stage.archived" });

export const reactivateRecruitmentStage = (params: {
  organizationId: number;
  workflowId: number;
  stageId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setStageActive({ ...params, isActive: true, eventType: "recruitment_stage.reactivated" });
