/**
 * Performance Employee Acknowledgement (Phase 3C, W83A — corrective
 * workstream closing the gap W83 verification found): the `finalized ->
 * acknowledged` transition (§10.1 row 5, §17)
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md). §35's own per-
 * workstream scope table never assigned this transition to W73-W82; it is
 * implemented here, in its own smallest dedicated file, rather than
 * folded into performanceHrReview.ts (a different actor and permission —
 * employee, performance.write.own — not HR's performance.finalize/.manage)
 * or performanceSelfAssessment.ts (a different lifecycle stage entirely).
 *
 * MEANING (§0 Owner Decision 2, §17): acknowledgement means "I have seen
 * this review," never "I agree with this review." It does not, and must
 * never, mutate computedOverallScore, hrOverrideScore, hrOverrideReason, or
 * any goal/competency field — the atomic UPDATE below touches only status,
 * acknowledgedAt, and (optionally) employeeFinalComment.
 *
 * acknowledgementRequiredSnapshot IS NOT AN AUTHORIZATION GATE: §10.1 row
 * 5's own prerequisite column reads "review's own acknowledgementRequiredSnapshot
 * — if false, acknowledgement is optional but still permitted." "Optional"
 * describes whether the ESS UI presents it as expected of the employee, not
 * a server-side precondition — the only server-side prerequisite is the
 * review's own `status = 'finalized'` and the caller being that review's
 * own employee. Nothing here reads acknowledgementRequiredSnapshot at all;
 * inventing a second server-side gate on top of status would itself violate
 * the "status is the sole authoritative field" rule (§10, §36).
 *
 * ATOMICITY: identical shape to every other transition in this phase
 * (submitSelfAssessment, submitManagerReview, finalizeReview) — a single
 * atomic conditional UPDATE ... WHERE status = 'finalized' AND
 * employee_id = <server-resolved>. A concurrent or repeat acknowledgement
 * affects zero rows and returns a controlled 409, never a silent double-
 * transition.
 */
import { and, eq } from "drizzle-orm";
import { db, performanceReviewsTable, type PerformanceReview } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { PerformanceReviewNotFoundError } from "./performanceCycles";

export { PerformanceReviewNotFoundError };

export class PerformanceAcknowledgementForbiddenError extends Error {
  constructor(message = "You may only acknowledge your own review") {
    super(message);
    this.name = "PerformanceAcknowledgementForbiddenError";
  }
}

export class PerformanceAcknowledgementStageError extends Error {
  constructor(message = "This review is not awaiting acknowledgement") {
    super(message);
    this.name = "PerformanceAcknowledgementStageError";
  }
}

async function findOwnReview(organizationId: number, reviewId: number): Promise<PerformanceReview | null> {
  const [row] = await db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.id, reviewId), eq(performanceReviewsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface AcknowledgeReviewParams {
  organizationId: number;
  reviewId: number;
  callerEmployeeId: number | null;
  employeeFinalComment?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * The authoritative finalized -> acknowledged transition (§10.1 row 5).
 * Server-derived identity throughout — callerEmployeeId comes from
 * resolvePerformanceActorEmployeeId, never a client-supplied field; the
 * review must be this exact employee's own, and organization-scoped.
 */
export async function acknowledgeReview(params: AcknowledgeReviewParams): Promise<PerformanceReview> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.employeeId !== params.callerEmployeeId) {
    throw new PerformanceAcknowledgementForbiddenError();
  }
  if (review.status !== "finalized") {
    throw new PerformanceAcknowledgementStageError();
  }

  const patch: Record<string, unknown> = {
    status: "acknowledged",
    acknowledgedAt: new Date(),
    updatedAt: new Date(),
  };
  if (params.employeeFinalComment !== undefined && params.employeeFinalComment.trim() !== "") {
    patch.employeeFinalComment = params.employeeFinalComment;
  }

  const [updated] = await db
    .update(performanceReviewsTable)
    .set(patch)
    .where(
      and(
        eq(performanceReviewsTable.id, params.reviewId),
        eq(performanceReviewsTable.organizationId, params.organizationId),
        eq(performanceReviewsTable.employeeId, params.callerEmployeeId),
        eq(performanceReviewsTable.status, "finalized"),
      ),
    )
    .returning();
  if (!updated) {
    // Lost a race against a concurrent acknowledgement, or a stale retry.
    throw new PerformanceAcknowledgementStageError();
  }

  // employeeFinalComment is free text, deliberately excluded from audit
  // metadata — matching finalizeReview's own precedent of never putting
  // hrOverrideReason's free text into audit metadata either.
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review.acknowledged",
    targetType: "performance_review",
    targetId: String(params.reviewId),
    metadata: { employeeId: review.employeeId, acknowledgedAt: updated.acknowledgedAt },
  });

  return updated;
}
