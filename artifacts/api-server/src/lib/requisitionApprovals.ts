/**
 * Requisition Approval Workflow (Phase 3A — the frozen plan's own W47;
 * this session's W46): a single required approval step per submitted job
 * requisition, mirroring W35's transactional conditional-update decision
 * pattern exactly (a conditional `UPDATE ... WHERE decision = 'pending'`
 * takes the row lock; a concurrent or repeated decision sees zero rows
 * affected and fails as RequisitionApprovalNotPendingError rather than
 * double-processing). Lives in its own file rather than jobRequisitions.ts
 * for the same reason leaveApprovals.ts is separate from leaveRequests.ts.
 * jobRequisitions.ts's submitJobRequisition calls createPendingApprovalStep
 * here; this file deliberately never imports from jobRequisitions.ts (it
 * queries job_requisitions directly instead) so that one-directional
 * dependency never becomes a circular one.
 *
 * Approver model — a deliberate, transparently-documented simplification of
 * the frozen plan's §7 permission matrix. That matrix names both an
 * "assigned" tier (recruiter/hiring manager, "where explicitly delegated")
 * and an organization-wide tier for requisition.approve. No delegated-
 * approver assignment mechanism exists anywhere in Recruitment yet (W43-45
 * built no such configuration) — only the organization-wide tier is
 * implemented here. `approverMembershipId` on requisition_approvals records
 * who actually decided, resolved at decision time from the authenticated
 * caller — never a pre-assigned approver, since there is nothing to
 * pre-assign yet. A future workstream can add a delegated tier without
 * changing this table's shape.
 */
import { and, eq, desc, asc } from "drizzle-orm";
import { db, jobRequisitionsTable, requisitionApprovalsTable, type JobRequisition, type RequisitionApproval } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class RequisitionApprovalNotPendingError extends Error {
  constructor() {
    super("This requisition is no longer awaiting a decision — it may already have been decided or cancelled");
    this.name = "RequisitionApprovalNotPendingError";
  }
}

/** A distinct not-found error, not jobRequisitions.ts's JobRequisitionNotFoundError — this file deliberately has no import from jobRequisitions.ts (see module header) to keep the dependency one-directional. The route layer catches both as 404. */
export class RequisitionApprovalTargetNotFoundError extends Error {
  constructor() {
    super("Job requisition not found");
    this.name = "RequisitionApprovalTargetNotFoundError";
  }
}

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx` — lets step creation run inside submitJobRequisition's
// own transaction without a second query-client type (same pattern
// leaveBalances.ts's QueryClient established for W35).
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findRequisitionInOrg(organizationId: number, requisitionId: number): Promise<JobRequisition | null> {
  const [row] = await db
    .select()
    .from(jobRequisitionsTable)
    .where(and(eq(jobRequisitionsTable.id, requisitionId), eq(jobRequisitionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Creates the single pending approval step (sequence 1) for a
 * just-submitted requisition. Must be called with the same transaction
 * client that flips job_requisitions.status to pending_approval (see
 * submitJobRequisition) — the (requisitionId, sequence) unique index is the
 * structural guarantee that a concurrent or repeated submit can never
 * create a second active approval instance for the same requisition.
 */
export async function createPendingApprovalStep(
  client: QueryClient,
  params: { organizationId: number; requisitionId: number },
): Promise<RequisitionApproval> {
  const [row] = await client
    .insert(requisitionApprovalsTable)
    .values({
      organizationId: params.organizationId,
      requisitionId: params.requisitionId,
      sequence: 1,
      decision: "pending",
    })
    .returning();
  return row;
}

/**
 * Every pending-approval requisition in the organization — the only
 * visibility tier this workstream implements for the approval inbox
 * (organization-wide requisition.approve holders; no delegated-approver
 * tier exists yet, per the module-level note above).
 */
export async function listPendingRequisitionApprovals(organizationId: number): Promise<JobRequisition[]> {
  return db
    .select()
    .from(jobRequisitionsTable)
    .where(and(eq(jobRequisitionsTable.organizationId, organizationId), eq(jobRequisitionsTable.status, "pending_approval")))
    .orderBy(desc(jobRequisitionsTable.createdAt));
}

/**
 * Immutable decision history for one requisition, oldest sequence first.
 * The caller is responsible for independently confirming the requisition
 * itself is visible to the caller (getVisibleJobRequisitionById) before
 * calling this — it does not re-check visibility, since approval history
 * carries no sensitivity beyond the requisition it belongs to (the frozen
 * plan's table marks requisition_approvals' sensitive-data column "none").
 */
export async function listRequisitionApprovalHistory(organizationId: number, requisitionId: number): Promise<RequisitionApproval[]> {
  return db
    .select()
    .from(requisitionApprovalsTable)
    .where(and(eq(requisitionApprovalsTable.requisitionId, requisitionId), eq(requisitionApprovalsTable.organizationId, organizationId)))
    .orderBy(asc(requisitionApprovalsTable.sequence));
}

async function decide(params: {
  organizationId: number;
  requisitionId: number;
  decision: "approved" | "rejected";
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  const before = await findRequisitionInOrg(params.organizationId, params.requisitionId);
  if (!before) throw new RequisitionApprovalTargetNotFoundError();

  const finalStatus: JobRequisition["status"] = params.decision === "approved" ? "approved" : "rejected";

  const requisition = await db.transaction(async (tx) => {
    const [approval] = await tx
      .update(requisitionApprovalsTable)
      .set({
        decision: params.decision,
        decidedAt: new Date(),
        approverMembershipId: params.actorMembershipId,
        comment: params.comment ?? null,
      })
      .where(
        and(
          eq(requisitionApprovalsTable.requisitionId, params.requisitionId),
          eq(requisitionApprovalsTable.organizationId, params.organizationId),
          eq(requisitionApprovalsTable.sequence, 1),
          eq(requisitionApprovalsTable.decision, "pending"),
        ),
      )
      .returning();
    if (!approval) throw new RequisitionApprovalNotPendingError();

    // Single-step chain: this decision is always the final outcome, so the
    // requisition's own status transitions atomically in the same
    // transaction — no intermediate "workflow completed but requisition not
    // yet updated" state is ever observable.
    const [row] = await tx
      .update(jobRequisitionsTable)
      .set({ status: finalStatus, updatedBy: params.actorApplicationUserId })
      .where(
        and(
          eq(jobRequisitionsTable.id, params.requisitionId),
          eq(jobRequisitionsTable.organizationId, params.organizationId),
          eq(jobRequisitionsTable.status, "pending_approval"),
        ),
      )
      .returning();
    if (!row) throw new RequisitionApprovalNotPendingError();

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.decision === "approved" ? "job_requisition.approved" : "job_requisition.rejected",
    targetType: "job_requisition",
    targetId: String(params.requisitionId),
    beforeState: { status: before.status },
    afterState: { status: requisition.status, comment: params.comment ?? null },
  });

  return requisition;
}

/** Approves the single pending approval step, finalizing the requisition as approved in the same transaction. */
export async function approveJobRequisition(params: {
  organizationId: number;
  requisitionId: number;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  return decide({ ...params, decision: "approved" });
}

/**
 * Rejects the single pending approval step, finalizing the requisition as
 * rejected. Terminal — no reopening or resubmission is implemented in this
 * workstream's frozen scope; a rejected requisition stays rejected.
 */
export async function rejectJobRequisition(params: {
  organizationId: number;
  requisitionId: number;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<JobRequisition> {
  return decide({ ...params, decision: "rejected" });
}
