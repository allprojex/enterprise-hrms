/**
 * Recruitment Workflows (Phase 3A, W44): named, org-scoped pipelines. No
 * execution happens here — mirrors leaveTypes.ts's org-scoped archive/
 * reactivate shape, plus a `setDefaultWorkflow` action enforcing the
 * database's own partial-unique-index invariant (at most one default per
 * organization) atomically.
 */
import { and, eq } from "drizzle-orm";
import { db, recruitmentWorkflowsTable, type RecruitmentWorkflow } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class RecruitmentWorkflowNotFoundError extends Error {
  constructor() {
    super("Recruitment workflow not found");
    this.name = "RecruitmentWorkflowNotFoundError";
  }
}

export class DuplicateRecruitmentWorkflowNameError extends Error {
  constructor() {
    super("A recruitment workflow with this name already exists in the organization");
    this.name = "DuplicateRecruitmentWorkflowNameError";
  }
}

export async function listRecruitmentWorkflows(organizationId: number): Promise<RecruitmentWorkflow[]> {
  return db.select().from(recruitmentWorkflowsTable).where(eq(recruitmentWorkflowsTable.organizationId, organizationId));
}

async function findOwnWorkflow(organizationId: number, workflowId: number) {
  const [row] = await db
    .select()
    .from(recruitmentWorkflowsTable)
    .where(and(eq(recruitmentWorkflowsTable.id, workflowId), eq(recruitmentWorkflowsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getRecruitmentWorkflowById(organizationId: number, workflowId: number): Promise<RecruitmentWorkflow | null> {
  return findOwnWorkflow(organizationId, workflowId);
}

export async function createRecruitmentWorkflow(params: {
  organizationId: number;
  name: string;
  description?: string | null;
  displayOrder?: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentWorkflow> {
  try {
    const [workflow] = await db
      .insert(recruitmentWorkflowsTable)
      .values({
        organizationId: params.organizationId,
        name: params.name,
        description: params.description ?? null,
        displayOrder: params.displayOrder ?? 0,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "recruitment_workflow.created",
      targetType: "recruitment_workflow",
      targetId: String(workflow.id),
      afterState: { name: workflow.name },
    });

    return workflow;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateRecruitmentWorkflowNameError();
    throw err;
  }
}

export async function updateRecruitmentWorkflow(params: {
  organizationId: number;
  workflowId: number;
  name?: string;
  description?: string | null;
  displayOrder?: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentWorkflow> {
  const before = await findOwnWorkflow(params.organizationId, params.workflowId);
  if (!before) throw new RecruitmentWorkflowNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.displayOrder !== undefined) patch.displayOrder = params.displayOrder;

  // A body with no recognized fields (e.g. {} or only isDefault, which has
  // its own dedicated set-default action) is a true no-op — return the
  // current row unchanged rather than calling drizzle's .set({}), which
  // throws "No values to set" and would otherwise surface as an unhandled
  // 500. No audit event either, since nothing actually changed.
  if (Object.keys(patch).length === 0) return before;

  try {
    const [updated] = await db
      .update(recruitmentWorkflowsTable)
      .set(patch)
      .where(eq(recruitmentWorkflowsTable.id, params.workflowId))
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "recruitment_workflow.updated",
      targetType: "recruitment_workflow",
      targetId: String(params.workflowId),
      beforeState: { name: before.name, description: before.description },
      afterState: { name: updated.name, description: updated.description },
    });

    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateRecruitmentWorkflowNameError();
    throw err;
  }
}

async function setWorkflowActive(params: {
  organizationId: number;
  workflowId: number;
  isActive: boolean;
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentWorkflow> {
  const before = await findOwnWorkflow(params.organizationId, params.workflowId);
  if (!before) throw new RecruitmentWorkflowNotFoundError();

  const [updated] = await db
    .update(recruitmentWorkflowsTable)
    .set({ isActive: params.isActive })
    .where(eq(recruitmentWorkflowsTable.id, params.workflowId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "recruitment_workflow",
    targetId: String(params.workflowId),
    beforeState: { isActive: before.isActive },
    afterState: { isActive: updated.isActive },
  });

  return updated;
}

export const archiveRecruitmentWorkflow = (params: {
  organizationId: number;
  workflowId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setWorkflowActive({ ...params, isActive: false, eventType: "recruitment_workflow.archived" });

export const reactivateRecruitmentWorkflow = (params: {
  organizationId: number;
  workflowId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) => setWorkflowActive({ ...params, isActive: true, eventType: "recruitment_workflow.reactivated" });

/**
 * Sets exactly one default workflow per organization: unsets the current
 * default (if any) and sets the target, inside one transaction, so the
 * database's own partial-unique-index invariant is never even briefly
 * violated by two sequential statements racing another request.
 */
export async function setDefaultRecruitmentWorkflow(params: {
  organizationId: number;
  workflowId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentWorkflow> {
  const target = await findOwnWorkflow(params.organizationId, params.workflowId);
  if (!target) throw new RecruitmentWorkflowNotFoundError();

  const updated = await db.transaction(async (tx) => {
    await tx
      .update(recruitmentWorkflowsTable)
      .set({ isDefault: false })
      .where(and(eq(recruitmentWorkflowsTable.organizationId, params.organizationId), eq(recruitmentWorkflowsTable.isDefault, true)))
      .returning();

    const [row] = await tx
      .update(recruitmentWorkflowsTable)
      .set({ isDefault: true })
      .where(eq(recruitmentWorkflowsTable.id, params.workflowId))
      .returning();
    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "recruitment_workflow.set_default",
    targetType: "recruitment_workflow",
    targetId: String(params.workflowId),
    afterState: { name: updated.name },
  });

  return updated;
}
