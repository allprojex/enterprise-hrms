/**
 * Job Requisitions (Phase 3A, W45): an organization-scoped request/
 * authorization to recruit for one or more openings. Foundation only — no
 * approval execution, vacancy, candidate, or application logic lives here.
 * Mirrors the leave module's "coarse permission + fine-grained visibility
 * tier resolved in the service layer" pattern (Architecture Principle 5)
 * rather than a single blanket permission; reuses W43's authorization
 * primitives for the assigned/department/branch tiers.
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import {
  db,
  jobRequisitionsTable,
  positionsTable,
  departmentsTable,
  branchesTable,
  employeesTable,
  type JobRequisition,
  type Employee,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization } from "./orgScopedRefs";
import { getEmployeeById } from "./employees";
import {
  resolveRecruitmentActorEmployeeId,
  hasOrgWideRecruitmentAccess,
  isAssignedRecruitmentActor,
  isSameDepartmentScope,
  isSameBranchScope,
} from "./recruitmentAuthorization";
import { createPendingApprovalStep } from "./requisitionApprovals";

export class JobRequisitionNotFoundError extends Error {
  constructor() {
    super("Job requisition not found");
    this.name = "JobRequisitionNotFoundError";
  }
}

export class InvalidJobRequisitionError extends Error {}

export class JobRequisitionNotEditableError extends Error {
  constructor() {
    super("Only a draft requisition can be edited");
    this.name = "JobRequisitionNotEditableError";
  }
}

export class InvalidJobRequisitionTransitionError extends Error {}

export type JobRequisitionType =
  | "new_role"
  | "replacement"
  | "temporary"
  | "internship"
  | "volunteer"
  | "contract"
  | "ministry";

export type JobRequisitionWorkplaceType = "onsite" | "remote" | "hybrid";

export interface JobRequisitionFields {
  title?: string;
  requisitionType?: JobRequisitionType;
  positionId?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  hiringManagerEmployeeId?: number | null;
  recruiterEmployeeId?: number | null;
  requestedHeadcount?: number;
  employmentType?: Employee["employmentType"];
  workplaceType?: JobRequisitionWorkplaceType | null;
  expectedStartDate?: string | null;
  salaryRangeMin?: string | null;
  salaryRangeMax?: string | null;
  salaryCurrency?: string | null;
  justification?: string | null;
  replacementEmployeeId?: number | null;
}

async function validateReferences(organizationId: number, fields: JobRequisitionFields): Promise<void> {
  await assertBelongsToOrganization(positionsTable, fields.positionId, organizationId, "Position");
  await assertBelongsToOrganization(departmentsTable, fields.departmentId, organizationId, "Department");
  await assertBelongsToOrganization(branchesTable, fields.branchId, organizationId, "Branch");
  await assertBelongsToOrganization(employeesTable, fields.hiringManagerEmployeeId, organizationId, "Hiring manager");
  await assertBelongsToOrganization(employeesTable, fields.recruiterEmployeeId, organizationId, "Recruiter");
  await assertBelongsToOrganization(employeesTable, fields.replacementEmployeeId, organizationId, "Replacement employee");
}

/** Validates the fully-merged (not partial) requisition state — a partial PATCH is validated against the result of merging it onto the existing row, never in isolation. */
function validateMergedFields(merged: {
  requestedHeadcount: number;
  filledCount: number;
  salaryRangeMin: string | null;
  salaryRangeMax: string | null;
  salaryCurrency: string | null;
  requisitionType: string;
  replacementEmployeeId: number | null;
}): void {
  if (merged.requestedHeadcount <= 0) {
    throw new InvalidJobRequisitionError("requestedHeadcount must be positive");
  }
  if (merged.filledCount > merged.requestedHeadcount) {
    throw new InvalidJobRequisitionError("filledCount cannot exceed requestedHeadcount");
  }
  if (merged.salaryRangeMin != null && merged.salaryRangeMax != null && Number(merged.salaryRangeMin) > Number(merged.salaryRangeMax)) {
    throw new InvalidJobRequisitionError("salaryRangeMin cannot exceed salaryRangeMax");
  }
  if ((merged.salaryRangeMin != null || merged.salaryRangeMax != null) && !merged.salaryCurrency) {
    throw new InvalidJobRequisitionError("salaryCurrency is required when a salary range is provided");
  }
  if (merged.requisitionType === "replacement" && merged.replacementEmployeeId == null) {
    throw new InvalidJobRequisitionError("replacementEmployeeId is required for a replacement requisition");
  }
  if (merged.requisitionType !== "replacement" && merged.replacementEmployeeId != null) {
    throw new InvalidJobRequisitionError("replacementEmployeeId is only allowed for a replacement requisition");
  }
}

async function findOwnRequisition(organizationId: number, requisitionId: number): Promise<JobRequisition | null> {
  const [row] = await db
    .select()
    .from(jobRequisitionsTable)
    .where(and(eq(jobRequisitionsTable.id, requisitionId), eq(jobRequisitionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

// --- Visibility (own/requested-by, assigned recruiter, hiring manager, department, branch, organization-wide) ---

export interface RequisitionVisibilityContext {
  isOrgWide: boolean;
  actorApplicationUserId: number;
  actorEmployeeId: number | null;
  actorDepartmentId: number | null;
  actorBranchId: number | null;
}

/**
 * Org-wide reach is signaled by holding requisition.update (the same
 * org_admin/hr_manager-only permission that can also edit any requisition) —
 * not a separate permission, since every role that can manage requisitions
 * broadly already holds it. Everyone else is scoped to their own
 * requested-by/assigned/department/branch relevance, resolved here once per
 * request rather than per row.
 */
export async function resolveRequisitionVisibilityContext(params: {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}): Promise<RequisitionVisibilityContext> {
  const isOrgWide = await hasOrgWideRecruitmentAccess(params.membershipId, "requisition.update");
  const actorEmployeeId = await resolveRecruitmentActorEmployeeId(params.organizationId, params.applicationUserId);

  let actorDepartmentId: number | null = null;
  let actorBranchId: number | null = null;
  if (actorEmployeeId != null) {
    const employee = await getEmployeeById(params.organizationId, actorEmployeeId);
    actorDepartmentId = employee?.departmentId ?? null;
    actorBranchId = employee?.branchId ?? null;
  }

  return {
    isOrgWide,
    actorApplicationUserId: params.applicationUserId,
    actorEmployeeId,
    actorDepartmentId,
    actorBranchId,
  };
}

function isVisible(row: JobRequisition, ctx: RequisitionVisibilityContext): boolean {
  if (ctx.isOrgWide) return true;
  if (row.createdBy != null && row.createdBy === ctx.actorApplicationUserId) return true;
  if (isAssignedRecruitmentActor(ctx.actorEmployeeId, row.recruiterEmployeeId)) return true;
  if (isAssignedRecruitmentActor(ctx.actorEmployeeId, row.hiringManagerEmployeeId)) return true;
  if (isSameDepartmentScope(ctx.actorDepartmentId, row.departmentId)) return true;
  if (isSameBranchScope(ctx.actorBranchId, row.branchId)) return true;
  return false;
}

// --- Reads ---

export interface ListJobRequisitionsParams {
  organizationId: number;
  visibility: RequisitionVisibilityContext;
  status?: string;
  requisitionType?: string;
  departmentId?: number;
  branchId?: number;
  hiringManagerEmployeeId?: number;
  recruiterEmployeeId?: number;
  search?: string;
  page: number;
  pageSize: number;
}

export async function listJobRequisitions(params: ListJobRequisitionsParams): Promise<{ items: JobRequisition[]; total: number }> {
  const conditions = [eq(jobRequisitionsTable.organizationId, params.organizationId)];
  if (params.status) conditions.push(eq(jobRequisitionsTable.status, params.status as JobRequisition["status"]));
  if (params.requisitionType) conditions.push(eq(jobRequisitionsTable.requisitionType, params.requisitionType as JobRequisition["requisitionType"]));
  if (params.departmentId != null) conditions.push(eq(jobRequisitionsTable.departmentId, params.departmentId));
  if (params.branchId != null) conditions.push(eq(jobRequisitionsTable.branchId, params.branchId));
  if (params.hiringManagerEmployeeId != null) conditions.push(eq(jobRequisitionsTable.hiringManagerEmployeeId, params.hiringManagerEmployeeId));
  if (params.recruiterEmployeeId != null) conditions.push(eq(jobRequisitionsTable.recruiterEmployeeId, params.recruiterEmployeeId));

  const rows = await db
    .select()
    .from(jobRequisitionsTable)
    .where(and(...conditions))
    .orderBy(desc(jobRequisitionsTable.createdAt));

  let visible = rows.filter((r) => isVisible(r, params.visibility));
  if (params.search) {
    const term = params.search.toLowerCase();
    visible = visible.filter((r) => r.title.toLowerCase().includes(term));
  }

  const total = visible.length;
  const start = (params.page - 1) * params.pageSize;
  const items = visible.slice(start, start + params.pageSize);
  return { items, total };
}

/** Returns null both when the requisition doesn't exist and when it exists but isn't visible to this caller — never distinguishing the two, so visibility can't be probed via a 403-vs-404 timing/response difference. */
export async function getVisibleJobRequisitionById(
  organizationId: number,
  requisitionId: number,
  visibility: RequisitionVisibilityContext,
): Promise<JobRequisition | null> {
  const row = await findOwnRequisition(organizationId, requisitionId);
  if (!row) return null;
  if (!isVisible(row, visibility)) return null;
  return row;
}

// --- Writes ---

export async function createJobRequisition(params: {
  organizationId: number;
  fields: Required<Pick<JobRequisitionFields, "title" | "requisitionType" | "requestedHeadcount">> & JobRequisitionFields;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  await validateReferences(params.organizationId, params.fields);
  validateMergedFields({
    requestedHeadcount: params.fields.requestedHeadcount,
    filledCount: 0,
    salaryRangeMin: params.fields.salaryRangeMin ?? null,
    salaryRangeMax: params.fields.salaryRangeMax ?? null,
    salaryCurrency: params.fields.salaryCurrency ?? null,
    requisitionType: params.fields.requisitionType,
    replacementEmployeeId: params.fields.replacementEmployeeId ?? null,
  });

  const [row] = await db
    .insert(jobRequisitionsTable)
    .values({
      organizationId: params.organizationId,
      ...params.fields,
      status: "draft",
      filledCount: 0,
      createdBy: params.actorApplicationUserId,
      updatedBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "job_requisition.created",
    targetType: "job_requisition",
    targetId: String(row.id),
    afterState: { title: row.title, requisitionType: row.requisitionType, status: row.status },
  });

  return row;
}

export async function updateJobRequisition(params: {
  organizationId: number;
  requisitionId: number;
  fields: JobRequisitionFields;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  const before = await findOwnRequisition(params.organizationId, params.requisitionId);
  if (!before) throw new JobRequisitionNotFoundError();
  if (before.status !== "draft") throw new JobRequisitionNotEditableError();

  await validateReferences(params.organizationId, params.fields);

  const merged = { ...before, ...params.fields };
  validateMergedFields({
    requestedHeadcount: merged.requestedHeadcount,
    filledCount: before.filledCount,
    salaryRangeMin: merged.salaryRangeMin,
    salaryRangeMax: merged.salaryRangeMax,
    salaryCurrency: merged.salaryCurrency,
    requisitionType: merged.requisitionType,
    replacementEmployeeId: merged.replacementEmployeeId,
  });

  const [updated] = await db
    .update(jobRequisitionsTable)
    .set({ ...params.fields, updatedBy: params.actorApplicationUserId })
    .where(eq(jobRequisitionsTable.id, params.requisitionId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "job_requisition.updated",
    targetType: "job_requisition",
    targetId: String(params.requisitionId),
    beforeState: { title: before.title, requisitionType: before.requisitionType },
    afterState: { title: updated.title, requisitionType: updated.requisitionType },
  });

  return updated;
}

/**
 * draft -> pending_approval only. A conditional UPDATE ... WHERE status =
 * 'draft' (mirrors W35's exact idempotency shape) — a concurrent double
 * submit sees zero rows affected and fails as already-transitioned, never
 * double-processing. The single pending approval step (W47/this session's
 * W46) is created inside the same transaction as the status transition, so
 * a requisition can never sit in pending_approval without an active
 * approval instance, and a concurrent/repeated submit can never create two
 * (the status guard already ensures only one caller's transaction reaches
 * the insert; the (requisitionId, sequence) unique index is a second,
 * independent guard).
 */
export async function submitJobRequisition(params: {
  organizationId: number;
  requisitionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  const before = await findOwnRequisition(params.organizationId, params.requisitionId);
  if (!before) throw new JobRequisitionNotFoundError();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(jobRequisitionsTable)
      .set({ status: "pending_approval", updatedBy: params.actorApplicationUserId })
      .where(and(eq(jobRequisitionsTable.id, params.requisitionId), eq(jobRequisitionsTable.status, "draft")))
      .returning();
    if (!row) throw new InvalidJobRequisitionTransitionError("Only a draft requisition can be submitted");

    await createPendingApprovalStep(tx, {
      organizationId: params.organizationId,
      requisitionId: params.requisitionId,
    });

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "job_requisition.submitted",
    targetType: "job_requisition",
    targetId: String(params.requisitionId),
    beforeState: { status: "draft" },
    afterState: { status: updated.status },
  });

  return updated;
}

/** draft or pending_approval -> cancelled. Approval execution (approved/rejected) belongs to a later workstream, so cancellation is the only exit this one owns beyond submit. */
export async function cancelJobRequisition(params: {
  organizationId: number;
  requisitionId: number;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  const before = await findOwnRequisition(params.organizationId, params.requisitionId);
  if (!before) throw new JobRequisitionNotFoundError();

  const [updated] = await db
    .update(jobRequisitionsTable)
    .set({ status: "cancelled", cancellationReason: params.reason ?? null, updatedBy: params.actorApplicationUserId })
    .where(and(eq(jobRequisitionsTable.id, params.requisitionId), inArray(jobRequisitionsTable.status, ["draft", "pending_approval"])))
    .returning();
  if (!updated) throw new InvalidJobRequisitionTransitionError("Only a draft or pending requisition can be cancelled");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "job_requisition.cancelled",
    targetType: "job_requisition",
    targetId: String(params.requisitionId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}

/** draft or cancelled -> closed. This workstream's "archive" (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md's "Closure") — a terminal, hidden-from-active-work state; approved/partially_filled/filled closure is a later workstream's concern once fulfillment exists. */
export async function archiveJobRequisition(params: {
  organizationId: number;
  requisitionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  const before = await findOwnRequisition(params.organizationId, params.requisitionId);
  if (!before) throw new JobRequisitionNotFoundError();

  const [updated] = await db
    .update(jobRequisitionsTable)
    .set({ status: "closed", updatedBy: params.actorApplicationUserId })
    .where(and(eq(jobRequisitionsTable.id, params.requisitionId), inArray(jobRequisitionsTable.status, ["draft", "cancelled"])))
    .returning();
  if (!updated) throw new InvalidJobRequisitionTransitionError("Only a draft or cancelled requisition can be archived");

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "job_requisition.archived",
    targetType: "job_requisition",
    targetId: String(params.requisitionId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}
