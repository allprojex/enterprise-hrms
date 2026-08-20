/**
 * Performance Self-Assessment (Phase 3C, W77 — Self-Assessment / ESS):
 * the authoritative `self_assessment -> manager_review` transition
 * (§10.1 row 2) plus the employee-side entry points it depends on —
 * competency self-rating and (via performanceReviewGoals.ts's own
 * path-3 addition) goal self-comments.
 *
 * §27 NAMES NO COMPETENCY-RATING ROUTE — a genuine gap in the frozen
 * route table, reconciled here rather than silently guessed: §14 is
 * explicit that self_assessment includes "enter self-ratings/comments on
 * competencies," and W73's own schema already carries
 * employeeRatingValue/employeeComment on performance_review_competencies
 * for exactly this purpose, with no route ever built to write them. The
 * smallest reconciling addition is one new route, shaped identically to
 * the goal PATCH route W76 already built:
 * `PATCH .../reviews/:id/competencies/:competencyId`, own review only,
 * `self_assessment` only, `performance.write.own`.
 *
 * SUBMISSION READINESS (§10.1 row 2, §11.5) — validated at submission,
 * not on every autosave PATCH:
 *   - every competency has `employeeRatingValue` set (row 2's own literal
 *     text — no N/A carve-out is written there, and N/A cannot yet be set
 *     by anyone at this stage since it's manager-only during
 *     manager_review, so this is moot in practice but written generally).
 *   - every `accepted`, non-`qualitative` goal has a non-empty
 *     `employeeComment` (row 2's own literal text; `notApplicable` is
 *     excluded from this requirement for the same reason as above).
 *   - §11.5's own second bullet: "Individual goal weights ... among
 *     accepted goals must sum to 100 — validated at self-assessment
 *     submission and again at manager-review submission (defense in
 *     depth)" — applied here ONLY when at least one applicable
 *     (accepted, non-qualitative, non-N/A) goal exists; §11.3 makes an
 *     entirely-empty/qualitative-only goal section a legitimate state
 *     (its weight redistributes to competencies), so this workstream
 *     does not require goals to exist at all.
 * §11.6's "not both sections may be entirely empty" check is NOT applied
 * here — its own text scopes it explicitly to "Manager submission
 * (manager_review -> hr_review)," a later workstream's (W78's) gate, not
 * this one. Competency weight-sum-to-100 is NOT re-validated here either
 * — §11.5's own third bullet says it is "validated at review creation
 * (snapshot time) and unaffected thereafter," already guaranteed by W75's
 * snapshot step.
 *
 * VISIBILITY (§14): "they cannot see the manager's rating until the
 * manager submits" — read narrowly as the competency-level
 * managerRatingValue/managerComment (the numeric "rating" the sentence
 * names), NOT a goal's managerComment, which frequently carries a
 * reject-reason the employee needs to see immediately (§12) and is
 * therefore never redacted. Redaction applies only to an own-employee
 * viewer without performance.manage/.finalize, only while the review's
 * status is `self_assessment` or `manager_review` (i.e., before
 * `hr_review`) — implemented in the route layer (getReviewWithCompetencies
 * consumers), not here.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  performanceReviewsTable,
  performanceReviewGoalsTable,
  performanceReviewCompetenciesTable,
  type PerformanceReview,
  type PerformanceReviewCompetency,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getRatingScaleWithLevels } from "./performanceRatingScales";
import { PerformanceReviewNotFoundError } from "./performanceCycles";

export { PerformanceReviewNotFoundError };

export class PerformanceCompetencyNotFoundError extends Error {
  constructor() {
    super("Performance competency not found");
    this.name = "PerformanceCompetencyNotFoundError";
  }
}

export class InvalidPerformanceCompetencyRatingError extends Error {}

export class PerformanceSelfAssessmentForbiddenError extends Error {
  constructor(message = "Not authorized to act on this review's self-assessment") {
    super(message);
    this.name = "PerformanceSelfAssessmentForbiddenError";
  }
}

export class PerformanceSelfAssessmentStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceSelfAssessmentStageError";
  }
}

export class PerformanceSelfAssessmentNotReadyError extends Error {
  public readonly problems: string[];
  constructor(problems: string[]) {
    super(`Self-assessment is not ready to submit: ${problems.join("; ")}`);
    this.name = "PerformanceSelfAssessmentNotReadyError";
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

/** ESS: the caller's own reviews only — employeeId is always server-resolved by the route, never client-supplied. */
export async function listMyReviews(organizationId: number, employeeId: number): Promise<PerformanceReview[]> {
  return db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.organizationId, organizationId), eq(performanceReviewsTable.employeeId, employeeId)));
}

export interface RateCompetencyParams {
  organizationId: number;
  reviewId: number;
  competencyId: number;
  callerEmployeeId: number | null;
  employeeRatingValue: number;
  employeeComment?: string;
}

/** Employee self-rates a snapshotted competency — own review, self_assessment only. Rating must match one of the review's own rating-scale levels (never an arbitrary value). Never touches managerRatingValue/managerComment. */
export async function rateCompetency(params: RateCompetencyParams): Promise<PerformanceReviewCompetency> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.employeeId !== params.callerEmployeeId) {
    throw new PerformanceSelfAssessmentForbiddenError("You may only rate competencies on your own review");
  }
  if (review.status !== "self_assessment") {
    throw new PerformanceSelfAssessmentStageError("Competencies can only be self-rated while the review is in self_assessment status");
  }
  const competency = await findOwnCompetency(params.organizationId, params.reviewId, params.competencyId);
  if (!competency) throw new PerformanceCompetencyNotFoundError();

  const scaleResult = await getRatingScaleWithLevels(params.organizationId, review.ratingScaleId);
  const validValues = new Set((scaleResult?.levels ?? []).map((l) => Number(l.value)));
  if (!validValues.has(params.employeeRatingValue)) {
    throw new InvalidPerformanceCompetencyRatingError("employeeRatingValue must match one of this review's configured rating-scale levels");
  }

  const [updated] = await db
    .update(performanceReviewCompetenciesTable)
    .set({
      employeeRatingValue: params.employeeRatingValue.toString(),
      employeeComment: params.employeeComment ?? null,
      updatedAt: new Date(),
    })
    .where(eq(performanceReviewCompetenciesTable.id, params.competencyId))
    .returning();
  return updated;
}

export interface SubmitSelfAssessmentParams {
  organizationId: number;
  reviewId: number;
  callerEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * The authoritative self_assessment -> manager_review transition
 * (§10.1 row 2). Readiness-validated first (400, listing every problem
 * at once — never a raw constraint error), then an atomic conditional
 * UPDATE ... WHERE status = 'self_assessment' performs the transition —
 * a concurrent or repeat submission affects zero rows and returns a
 * controlled 409, never a silent double-transition.
 */
export async function submitSelfAssessment(params: SubmitSelfAssessmentParams): Promise<PerformanceReview> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.employeeId !== params.callerEmployeeId) {
    throw new PerformanceSelfAssessmentForbiddenError("You may only submit your own self-assessment");
  }
  if (review.status !== "self_assessment") {
    throw new PerformanceSelfAssessmentStageError("This review is not awaiting self-assessment");
  }

  const [goals, competencies] = await Promise.all([
    db.select().from(performanceReviewGoalsTable).where(eq(performanceReviewGoalsTable.reviewId, params.reviewId)),
    db.select().from(performanceReviewCompetenciesTable).where(eq(performanceReviewCompetenciesTable.reviewId, params.reviewId)),
  ]);

  const problems: string[] = [];

  for (const competency of competencies) {
    if (competency.employeeRatingValue == null) {
      problems.push(`Competency "${competency.label}" is missing your self-rating`);
    }
  }

  const applicableGoals = goals.filter((g) => g.approvalStatus === "accepted" && g.measurementType !== "qualitative" && !g.notApplicable);
  for (const goal of applicableGoals) {
    if (!goal.employeeComment || !goal.employeeComment.trim()) {
      problems.push(`Goal "${goal.title}" is missing your self-assessment comment`);
    }
  }
  if (applicableGoals.length > 0) {
    const totalWeight = applicableGoals.reduce((sum, g) => sum + g.weight, 0);
    if (totalWeight !== 100) {
      problems.push(`Accepted, scoreable goal weights must sum to 100 (currently ${totalWeight})`);
    }
  }

  if (problems.length > 0) {
    throw new PerformanceSelfAssessmentNotReadyError(problems);
  }

  const [updated] = await db
    .update(performanceReviewsTable)
    .set({ status: "manager_review", selfAssessmentSubmittedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(performanceReviewsTable.id, params.reviewId), eq(performanceReviewsTable.organizationId, params.organizationId), eq(performanceReviewsTable.status, "self_assessment")))
    .returning();
  if (!updated) {
    // Lost a race against a concurrent submission between the read above and this write.
    throw new PerformanceSelfAssessmentStageError("This review is not awaiting self-assessment");
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review.self_assessment_submitted",
    targetType: "performance_review",
    targetId: String(params.reviewId),
    metadata: { employeeId: review.employeeId },
  });

  return updated;
}
