/**
 * Performance Manager Review (Phase 3C, W78 — Manager Review): the
 * authoritative `manager_review -> hr_review` transition (§10.1 row 3)
 * plus the manager-side competency rating it depends on and the
 * deterministic scoring model it produces
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §11, §15).
 *
 * MANAGER IDENTITY: exactly the same discipline as every other
 * Performance workstream — `reviewerEmployeeId` is the review's own
 * *snapshotted* column (fixed at assignment, §9), and authority is
 * always `resolvePerformanceActorEmployeeId(...) === review
 * .reviewerEmployeeId`, never inferred from a role label or a
 * client-supplied ID. `performance.manage` grants no reviewer authority
 * here — §27 names no HR-override path for goal/competency mutation or
 * for this submission route; that stays exclusively `performance.review
 * .write` + reviewer-of-record, matching W76's own goal-route precedent.
 *
 * COMPETENCY MANAGER RATING: no route existed before this workstream —
 * W77 built only the employee-self-rate path on
 * `PATCH .../reviews/:id/competencies/:competencyId`. This file adds the
 * reviewer path on that SAME route (dispatched by the route layer via
 * resolveReviewRelationship, mirroring the goal-creation route's own
 * employee-vs-reviewer dispatch) — never a second route, never a second
 * approval engine.
 *
 * READINESS (§10.1 row 3 + §11.6, both applied — row 3 adds a
 * requirement §11.6 does not carry, and vice versa):
 *   - every `proposed` goal has been explicitly accepted or rejected
 *     (row 3's own literal text — none may remain pending).
 *   - every accepted, non-qualitative, non-N/A goal has `actualResult`
 *     set (§11.6, read as authoritative over row 3's shorter summary,
 *     which omits the qualitative exclusion that would otherwise make a
 *     qualitative goal — which structurally has no score, §11.1 — an
 *     impossible requirement).
 *   - every non-N/A competency has `managerRatingValue` set (§11.6/row 3).
 *   - accepted, non-qualitative goal weights (regardless of N/A status —
 *     N/A affects only redistribution at *scoring* time, §11.3, never the
 *     stored-weight-sum invariant) sum to exactly 100 — §11.5's own
 *     "validated at self-assessment submission [W77] and again at
 *     manager-review submission [here]" (defense in depth; the manager
 *     can edit weights via updateGoal's path 2, so this can genuinely
 *     drift after W77's own check).
 *   - not both sections end up with zero scoreable items (§11.6's own
 *     pathological-case block).
 * Competency weight-sum-to-100 is NOT re-validated — §11.5's own third
 * bullet: "validated at review creation ... and unaffected thereafter."
 *
 * SCORING: delegated entirely to performanceScoring.ts's pure functions
 * — this file owns only DB I/O (fetching goals/competencies/rating-scale
 * levels, persisting the result) and the readiness gate, never the
 * formula itself.
 *
 * AUDIT: exactly `performance_review.manager_review_submitted` (§22's own
 * literal name) — goal accept/reject/create audit remains entirely
 * W76's own responsibility (never duplicated here); PATCH/autosave calls
 * (competency rating) emit no audit event, matching every prior
 * workstream's "only meaningful named events are audited" discipline.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewCompetenciesTable,
  type PerformanceReview,
  type PerformanceReviewGoal,
  type PerformanceReviewCompetency,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getRatingScaleWithLevels } from "./performanceRatingScales";
import { PerformanceReviewNotFoundError } from "./performanceCycles";
import { computeOverallScore, isScoreableGoal } from "./performanceScoring";
// Reused, not redefined — a duplicate class of the same name in this file
// would not satisfy `instanceof` checks against the one the shared
// competency PATCH route (routes/performanceSelfAssessment.ts) already
// imports from performanceSelfAssessment.ts, silently producing a 500
// instead of the intended 404/400.
import { PerformanceCompetencyNotFoundError, InvalidPerformanceCompetencyRatingError } from "./performanceSelfAssessment";

export { PerformanceReviewNotFoundError, PerformanceCompetencyNotFoundError, InvalidPerformanceCompetencyRatingError };

export class PerformanceManagerReviewForbiddenError extends Error {
  constructor(message = "Not authorized to act on this review as its reviewer") {
    super(message);
    this.name = "PerformanceManagerReviewForbiddenError";
  }
}

export class PerformanceManagerReviewStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceManagerReviewStageError";
  }
}

export class PerformanceManagerReviewNotReadyError extends Error {
  public readonly problems: string[];
  constructor(problems: string[]) {
    super(`Manager review is not ready to submit: ${problems.join("; ")}`);
    this.name = "PerformanceManagerReviewNotReadyError";
    this.problems = problems;
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

async function findOwnCompetency(organizationId: number, reviewId: number, competencyId: number): Promise<PerformanceReviewCompetency | null> {
  const [row] = await db
    .select()
    .from(performanceReviewCompetenciesTable)
    .where(
      and(
        eq(performanceReviewCompetenciesTable.id, competencyId),
        eq(performanceReviewCompetenciesTable.reviewId, reviewId),
        eq(performanceReviewCompetenciesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** GET /performance/team-reviews (§27) — reviews where the caller is the snapshotted reviewerEmployeeId. Server-resolved, never client-supplied. */
export async function listTeamReviews(organizationId: number, reviewerEmployeeId: number): Promise<PerformanceReview[]> {
  return db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.organizationId, organizationId), eq(performanceReviewsTable.reviewerEmployeeId, reviewerEmployeeId)));
}

export interface RateCompetencyAsManagerParams {
  organizationId: number;
  reviewId: number;
  competencyId: number;
  callerEmployeeId: number | null;
  managerRatingValue?: number;
  managerComment?: string | null;
  notApplicable?: boolean;
  notApplicableReason?: string | null;
}

/** Reviewer of record rates/comments a competency, or marks it not applicable — manager_review only. Never touches employeeRatingValue/employeeComment. */
export async function rateCompetencyAsManager(params: RateCompetencyAsManagerParams): Promise<PerformanceReviewCompetency> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.reviewerEmployeeId !== params.callerEmployeeId) {
    throw new PerformanceManagerReviewForbiddenError("Only this review's reviewer of record may record a manager rating");
  }
  if (review.status !== "manager_review") {
    throw new PerformanceManagerReviewStageError("Competencies can only be manager-rated while the review is in manager_review status");
  }
  const competency = await findOwnCompetency(params.organizationId, params.reviewId, params.competencyId);
  if (!competency) throw new PerformanceCompetencyNotFoundError();

  if (params.managerRatingValue !== undefined) {
    const scaleResult = await getRatingScaleWithLevels(params.organizationId, review.ratingScaleId);
    const validValues = new Set((scaleResult?.levels ?? []).map((l) => Number(l.value)));
    if (!validValues.has(params.managerRatingValue)) {
      throw new InvalidPerformanceCompetencyRatingError("managerRatingValue must match one of this review's configured rating-scale levels");
    }
  }
  if (params.notApplicable === true && !(params.notApplicableReason ?? competency.notApplicableReason)?.trim()) {
    throw new InvalidPerformanceCompetencyRatingError("notApplicableReason is required when marking a competency not applicable");
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (params.managerRatingValue !== undefined) patch.managerRatingValue = params.managerRatingValue.toString();
  if (params.managerComment !== undefined) patch.managerComment = params.managerComment;
  if (params.notApplicable !== undefined) {
    patch.notApplicable = params.notApplicable;
    patch.notApplicableReason = params.notApplicableReason !== undefined ? params.notApplicableReason : params.notApplicable ? competency.notApplicableReason : null;
  } else if (params.notApplicableReason !== undefined) {
    patch.notApplicableReason = params.notApplicableReason;
  }

  const [updated] = await db.update(performanceReviewCompetenciesTable).set(patch).where(eq(performanceReviewCompetenciesTable.id, params.competencyId)).returning();
  return updated;
}

function assessReadiness(goals: PerformanceReviewGoal[], competencies: PerformanceReviewCompetency[]): string[] {
  const problems: string[] = [];

  for (const goal of goals) {
    if (goal.approvalStatus === "proposed") {
      problems.push(`Goal "${goal.title}" is still awaiting your accept/reject decision`);
    }
  }

  const officialGoals = goals.filter((g) => g.approvalStatus === "accepted" && g.measurementType !== "qualitative");
  for (const goal of officialGoals) {
    if (!goal.notApplicable && goal.actualResult == null) {
      problems.push(`Goal "${goal.title}" is missing its actual result`);
    }
  }
  if (officialGoals.length > 0) {
    const totalWeight = officialGoals.reduce((sum, g) => sum + g.weight, 0);
    if (totalWeight !== 100) {
      problems.push(`Accepted, official goal weights must sum to 100 (currently ${totalWeight})`);
    }
  }

  for (const competency of competencies) {
    if (!competency.notApplicable && competency.managerRatingValue == null) {
      problems.push(`Competency "${competency.label}" is missing your rating`);
    }
  }

  const anyScoreableGoal = goals.some(isScoreableGoal);
  const anyScoreableCompetency = competencies.some((c) => !c.notApplicable);
  if (!anyScoreableGoal && !anyScoreableCompetency) {
    problems.push("At least one goal or competency must be scoreable — both sections cannot be entirely not-applicable or empty");
  }

  return problems;
}

export interface SubmitManagerReviewParams {
  organizationId: number;
  reviewId: number;
  callerEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * The authoritative manager_review -> hr_review transition. Readiness is
 * validated first (400, every problem listed), the official score is
 * computed (performanceScoring.ts, §11), then a single transaction
 * performs the atomic conditional status UPDATE (the linearization point
 * — a concurrent or repeat submission affects zero rows here and rolls
 * the whole transaction back, 409) followed by persisting each scoreable
 * goal's own computedScore column.
 */
export async function submitManagerReview(params: SubmitManagerReviewParams): Promise<PerformanceReview> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.reviewerEmployeeId !== params.callerEmployeeId) {
    throw new PerformanceManagerReviewForbiddenError("You are not this review's reviewer of record");
  }
  if (review.status !== "manager_review") {
    throw new PerformanceManagerReviewStageError("This review is not awaiting manager review");
  }

  const [goals, competencies, scaleResult] = await Promise.all([
    db.select().from(performanceReviewGoalsTable).where(eq(performanceReviewGoalsTable.reviewId, params.reviewId)),
    db.select().from(performanceReviewCompetenciesTable).where(eq(performanceReviewCompetenciesTable.reviewId, params.reviewId)),
    getRatingScaleWithLevels(params.organizationId, review.ratingScaleId),
  ]);

  const problems = assessReadiness(goals, competencies);
  if (problems.length > 0) throw new PerformanceManagerReviewNotReadyError(problems);

  const ratingScaleMaxLevel = Math.max(0, ...(scaleResult?.levels ?? []).map((l) => Number(l.value)));
  const { overallScore, goalScores } = computeOverallScore({
    goals,
    competencies,
    goalsWeight: review.goalsWeight,
    competenciesWeight: review.competenciesWeight,
    scoringPrecision: review.scoringPrecisionSnapshot,
    ratingScaleMaxLevel,
  });

  const updated = await db.transaction(async (tx) => {
    const [updatedReview] = await tx
      .update(performanceReviewsTable)
      .set({
        status: "hr_review",
        managerReviewSubmittedAt: new Date(),
        computedOverallScore: overallScore.toString(),
        updatedAt: new Date(),
      })
      .where(and(eq(performanceReviewsTable.id, params.reviewId), eq(performanceReviewsTable.organizationId, params.organizationId), eq(performanceReviewsTable.status, "manager_review")))
      .returning();
    if (!updatedReview) {
      throw new PerformanceManagerReviewStageError("This review is not awaiting manager review");
    }

    for (const [goalId, score] of goalScores) {
      await tx.update(performanceReviewGoalsTable).set({ computedScore: score.toString(), updatedAt: new Date() }).where(eq(performanceReviewGoalsTable.id, goalId));
    }

    return updatedReview;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review.manager_review_submitted",
    targetType: "performance_review",
    targetId: String(params.reviewId),
    metadata: { employeeId: review.employeeId, computedOverallScore: overallScore },
  });

  return updated;
}
