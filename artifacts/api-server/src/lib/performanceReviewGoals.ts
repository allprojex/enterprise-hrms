/**
 * Performance Review Goals (Phase 3C, W76 — Goals/Objectives Management):
 * CRUD + employee-proposal / manager-decision workflow over W73's schema
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.7/§12, §27).
 *
 * ORIGIN/APPROVAL MODEL (§12): a goal is either manager-created
 * (`originType: 'manager'`, inserted `approvalStatus: 'accepted'`
 * immediately — official on save, no separate approval step, Owner
 * Decision 4) or employee-proposed (`originType: 'employee_proposed'`,
 * inserted `approvalStatus: 'proposed'` — becomes official only once the
 * reviewer-of-record explicitly accepts it during `manager_review`). A
 * `proposed` goal is excluded from weighting/scoring (§11.2) until
 * accepted; a `rejected` goal is retained forever, never deleted,
 * permanently excluded.
 *
 * STAGE GATING (§10.1/§10.2/§12/§15 — followed literally, not guessed):
 * employee proposal is `self_assessment`-only, on the caller's own review.
 * Every manager-side action — creating an official goal, editing any
 * goal, and accept/reject of a proposal — additionally requires
 * `reviewerEmployeeId` match AND a specific review stage: creation is
 * allowed while the review is `draft` OR `manager_review` (§27's own
 * literal permission line: "reviewer of record, draft/manager_review");
 * edit/accept/reject are `manager_review`-only, per §10.2's own
 * editability table ("Manager | nothing on this review" while
 * `self_assessment`) and §15's own "While status = 'manager_review' ...
 * accepts, edits-then-accepts, or rejects". §12 itself is explicit: "a
 * proposed goal ... becomes official when the manager explicitly accepts
 * it DURING manager_review."
 *
 * A REAL CONSEQUENCE OF THIS, WORTH FLAGGING: W75 already reconciled
 * cycle generation to create every review directly in `self_assessment`
 * (never leaving an externally-observable `draft` row), and W77 (not yet
 * built — self_assessment -> manager_review is its own transition) is out
 * of this workstream's scope. So in the CURRENT baseline, no review can
 * reach `draft` or `manager_review` through any live route. Every
 * manager-side function below (createManagerGoal, updateGoal's manager
 * path, acceptGoal, rejectGoal) is fully implemented, permission/stage-
 * gated exactly per the frozen text, and covered by fixture-based unit
 * tests that synthetically stage a review at the required status — but is
 * not exercisable through live HTTP QA until W77 exists. This mirrors
 * exactly the situation W74's rating-scale immutability lock was in
 * before W75 could create real reviews, and W75's own reviewer-resolution
 * logic was in before real employees existed to test against.
 *
 * MEASUREMENT-TYPE VALIDATION (§11.1, §8.7): whether `target`/`unit` are
 * meaningful depends entirely on which of the scoring formula's branches
 * applies. `qualitative` goals are unscored (`weight` structurally forced
 * to 0, §8.7) and carry no numeric target. `boolean` goals score from
 * `actualResult` alone ("100 if actualResult indicates complete, else 0")
 * — no target, no unit. `rating` goals score against the review's own
 * rating-scale levels ("chosen level value / max level value"), never
 * against `target`. Only `numeric`/`percentage`/`currency` actually
 * divide `actualResult` by `target` (§11.1), so only those three require
 * a positive `target` (percentage additionally capped at 100, "valid
 * percentage range").
 *
 * WEIGHT-SUM VALIDATION — DELIBERATELY NOT ENFORCED HERE: §11.5 states
 * "Individual goal weights ... among accepted goals must sum to 100 —
 * validated at self-assessment submission and again at manager-review
 * submission (defense in depth)" — both W77/W78 transition functions, not
 * any W76 route. W76 validates only the per-goal, per-type fields below;
 * the section-wide sum check is intentionally left to those later
 * workstreams' own submission gates, exactly as the frozen document
 * itself assigns it.
 *
 * AUDIT: §22's literal goal-event list is only `.proposed`/`.accepted`/
 * `.rejected` — there is no `.created`/`.updated` event for goals
 * anywhere in the frozen list. Since a manager-created goal is inserted
 * directly `accepted` (no separate approval step), its creation is
 * audited as `.accepted` too (metadata distinguishes
 * `action: 'manager_created'` from `action: 'proposal_accepted'`) rather
 * than inventing an unlisted `.created` event — the same "reuse the
 * closest already-frozen name over inventing one" discipline W74 applied
 * to competency-set replacement reusing `.updated`. PATCH/edit generates
 * no audit event, matching W74's own precedent for rating-scale
 * name/description edits (no edit-shaped event is named for goals
 * either).
 */
import { and, eq } from "drizzle-orm";
import { db, performanceReviewsTable, performanceReviewGoalsTable, type PerformanceReview, type PerformanceReviewGoal } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { PerformanceReviewNotFoundError } from "./performanceCycles";

export { PerformanceReviewNotFoundError };

export class PerformanceGoalNotFoundError extends Error {
  constructor() {
    super("Performance goal not found");
    this.name = "PerformanceGoalNotFoundError";
  }
}

export class InvalidPerformanceGoalError extends Error {}

export class PerformanceGoalForbiddenError extends Error {
  constructor(message = "Not authorized to act on this review's goals") {
    super(message);
    this.name = "PerformanceGoalForbiddenError";
  }
}

/** Stage-gate violation (goal proposed/created/edited/decided outside its permitted review status) — a controlled business-rule 409, never a raw failure. */
export class PerformanceGoalStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceGoalStageError";
  }
}

/** The proposal was already accepted or rejected — an atomic conditional update affected zero rows. */
export class PerformanceGoalDecisionConflictError extends Error {
  constructor() {
    super("This goal proposal has already been decided");
    this.name = "PerformanceGoalDecisionConflictError";
  }
}

type MeasurementType = "numeric" | "percentage" | "currency" | "boolean" | "rating" | "qualitative";

async function findOwnReview(organizationId: number, reviewId: number): Promise<PerformanceReview | null> {
  const [row] = await db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.id, reviewId), eq(performanceReviewsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOwnGoal(organizationId: number, reviewId: number, goalId: number): Promise<PerformanceReviewGoal | null> {
  const [row] = await db
    .select()
    .from(performanceReviewGoalsTable)
    .where(
      and(
        eq(performanceReviewGoalsTable.id, goalId),
        eq(performanceReviewGoalsTable.reviewId, reviewId),
        eq(performanceReviewGoalsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listGoalsForReview(organizationId: number, reviewId: number): Promise<PerformanceReviewGoal[]> {
  return db
    .select()
    .from(performanceReviewGoalsTable)
    .where(and(eq(performanceReviewGoalsTable.organizationId, organizationId), eq(performanceReviewGoalsTable.reviewId, reviewId)));
}

/** Resolves the caller's relationship to a review once, so the POST .../goals route can dispatch to proposeGoal vs createManagerGoal by identity — never a client-supplied flag — without fetching the review twice. */
export async function resolveReviewRelationship(
  organizationId: number,
  reviewId: number,
  callerEmployeeId: number | null,
): Promise<{ review: PerformanceReview; isOwn: boolean; isReviewer: boolean } | null> {
  const review = await findOwnReview(organizationId, reviewId);
  if (!review) return null;
  return {
    review,
    isOwn: callerEmployeeId != null && review.employeeId === callerEmployeeId,
    isReviewer: callerEmployeeId != null && review.reviewerEmployeeId === callerEmployeeId,
  };
}

interface GoalFieldInput {
  title: string;
  measurementType: MeasurementType;
  target?: number;
  unit?: string;
  weight: number;
}

/** Per-goal, per-type field validation (§11.1/§8.7) — never the section-wide weight-sum-to-100 rule, see file header. */
function validateGoalFields(input: GoalFieldInput): void {
  if (!input.title || !input.title.trim()) {
    throw new InvalidPerformanceGoalError("title is required");
  }
  if (input.weight < 0) {
    throw new InvalidPerformanceGoalError("weight must not be negative");
  }
  switch (input.measurementType) {
    case "qualitative":
      if (input.weight !== 0) throw new InvalidPerformanceGoalError("weight must be 0 for a qualitative goal");
      if (input.target != null) throw new InvalidPerformanceGoalError("qualitative goals do not use a numeric target");
      break;
    case "boolean":
      if (input.target != null) throw new InvalidPerformanceGoalError("boolean goals do not use a numeric target");
      if (input.unit != null) throw new InvalidPerformanceGoalError("boolean goals do not use a unit");
      break;
    case "rating":
      if (input.target != null) {
        throw new InvalidPerformanceGoalError("rating goals score against the review's rating scale, not a numeric target");
      }
      break;
    case "percentage":
      if (input.target == null || input.target <= 0 || input.target > 100) {
        throw new InvalidPerformanceGoalError("percentage goals require a target greater than 0 and at most 100");
      }
      break;
    case "numeric":
    case "currency":
      if (input.target == null || input.target <= 0) {
        throw new InvalidPerformanceGoalError(`${input.measurementType} goals require a target greater than 0`);
      }
      break;
  }
}

function toTargetColumn(target: number | undefined): string | null {
  return target != null ? target.toString() : null;
}

export interface CreateGoalFields {
  title: string;
  description?: string;
  measurementType: MeasurementType;
  target?: number;
  unit?: string;
  weight?: number;
  dueDate?: string;
}

export interface ProposeGoalParams extends CreateGoalFields {
  organizationId: number;
  reviewId: number;
  callerEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** Employee proposes a goal on their own review — self_assessment only (§12, §14, §27). Never official until a manager accepts it during manager_review. */
export async function proposeGoal(params: ProposeGoalParams): Promise<PerformanceReviewGoal> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.employeeId !== params.callerEmployeeId) {
    throw new PerformanceGoalForbiddenError("You may only propose goals on your own review");
  }
  if (review.status !== "self_assessment") {
    throw new PerformanceGoalStageError("Goals may only be proposed while the review is in self_assessment status");
  }

  const weight = params.weight ?? 0;
  validateGoalFields({ title: params.title, measurementType: params.measurementType, target: params.target, unit: params.unit, weight });

  const [goal] = await db
    .insert(performanceReviewGoalsTable)
    .values({
      organizationId: params.organizationId,
      reviewId: params.reviewId,
      title: params.title,
      description: params.description ?? null,
      measurementType: params.measurementType,
      target: toTargetColumn(params.target),
      unit: params.unit ?? null,
      weight,
      dueDate: params.dueDate ?? null,
      originType: "employee_proposed",
      approvalStatus: "proposed",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review_goal.proposed",
    targetType: "performance_review_goal",
    targetId: String(goal.id),
    metadata: { reviewId: params.reviewId, measurementType: goal.measurementType },
  });

  return goal;
}

export interface CreateManagerGoalParams extends CreateGoalFields {
  organizationId: number;
  reviewId: number;
  callerEmployeeId: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** Manager (reviewer of record) creates an official goal directly — accepted immediately, no approval step (Owner Decision 4). Allowed only while the review is draft or manager_review (§27) — see file header for why this is unreachable via live HTTP in the current baseline. */
export async function createManagerGoal(params: CreateManagerGoalParams): Promise<PerformanceReviewGoal> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.reviewerEmployeeId !== params.callerEmployeeId) {
    throw new PerformanceGoalForbiddenError("Only this review's reviewer of record may create an official goal");
  }
  if (review.status !== "draft" && review.status !== "manager_review") {
    throw new PerformanceGoalStageError("Manager-created goals may only be added while the review is in draft or manager_review status");
  }

  const weight = params.weight ?? 0;
  validateGoalFields({ title: params.title, measurementType: params.measurementType, target: params.target, unit: params.unit, weight });

  const [goal] = await db
    .insert(performanceReviewGoalsTable)
    .values({
      organizationId: params.organizationId,
      reviewId: params.reviewId,
      title: params.title,
      description: params.description ?? null,
      measurementType: params.measurementType,
      target: toTargetColumn(params.target),
      unit: params.unit ?? null,
      weight,
      dueDate: params.dueDate ?? null,
      originType: "manager",
      approvalStatus: "accepted",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review_goal.accepted",
    targetType: "performance_review_goal",
    targetId: String(goal.id),
    metadata: { reviewId: params.reviewId, measurementType: goal.measurementType, action: "manager_created" },
  });

  return goal;
}

export interface UpdateGoalParams {
  organizationId: number;
  reviewId: number;
  goalId: number;
  callerEmployeeId: number | null;
  title?: string;
  description?: string;
  target?: number | null;
  unit?: string | null;
  weight?: number;
  dueDate?: string | null;
}

/**
 * Edits a goal — two disjoint, mutually exclusive paths (§27):
 * employee may edit only their OWN still-`proposed` goal, only while
 * `self_assessment`; the reviewer of record may edit ANY goal on the
 * review, only while `manager_review`. No audit event (see file header).
 */
export async function updateGoal(params: UpdateGoalParams): Promise<PerformanceReviewGoal> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  const goal = await findOwnGoal(params.organizationId, params.reviewId, params.goalId);
  if (!goal) throw new PerformanceGoalNotFoundError();

  const isOwnProposal = params.callerEmployeeId != null && review.employeeId === params.callerEmployeeId;
  const isReviewer = params.callerEmployeeId != null && review.reviewerEmployeeId === params.callerEmployeeId;

  if (isOwnProposal) {
    if (goal.originType !== "employee_proposed" || goal.approvalStatus !== "proposed") {
      throw new PerformanceGoalForbiddenError("You may only edit your own goal proposal before it has been decided");
    }
    if (review.status !== "self_assessment") {
      throw new PerformanceGoalStageError("Your goal proposal can only be edited while the review is in self_assessment status");
    }
  } else if (isReviewer) {
    if (review.status !== "manager_review") {
      throw new PerformanceGoalStageError("Goals can only be edited by the reviewer while the review is in manager_review status");
    }
  } else {
    throw new PerformanceGoalForbiddenError();
  }

  validateGoalFields({
    title: params.title ?? goal.title,
    measurementType: goal.measurementType as MeasurementType,
    target: params.target !== undefined ? (params.target ?? undefined) : goal.target != null ? Number(goal.target) : undefined,
    unit: params.unit !== undefined ? (params.unit ?? undefined) : (goal.unit ?? undefined),
    weight: params.weight ?? goal.weight,
  });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.target !== undefined) patch.target = toTargetColumn(params.target ?? undefined);
  if (params.unit !== undefined) patch.unit = params.unit;
  if (params.weight !== undefined) patch.weight = params.weight;
  if (params.dueDate !== undefined) patch.dueDate = params.dueDate;

  const [updated] = await db.update(performanceReviewGoalsTable).set(patch).where(eq(performanceReviewGoalsTable.id, params.goalId)).returning();
  return updated;
}

export interface DecideGoalParams {
  organizationId: number;
  reviewId: number;
  goalId: number;
  callerEmployeeId: number | null;
  title?: string;
  description?: string;
  target?: number | null;
  unit?: string | null;
  weight?: number;
  dueDate?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** Reviewer of record accepts a proposed goal — optionally editing title/target/weight/dueDate in the same action (§12). Atomic conditional update guards against a concurrent double-decision or a repeat/terminal-state redecision (409, never a silent no-op). */
export async function acceptGoal(params: DecideGoalParams): Promise<PerformanceReviewGoal> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.reviewerEmployeeId !== params.callerEmployeeId) {
    throw new PerformanceGoalForbiddenError("Only this review's reviewer of record may accept a proposed goal");
  }
  if (review.status !== "manager_review") {
    throw new PerformanceGoalStageError("Proposals can only be accepted while the review is in manager_review status");
  }
  const goal = await findOwnGoal(params.organizationId, params.reviewId, params.goalId);
  if (!goal) throw new PerformanceGoalNotFoundError();
  if (goal.originType !== "employee_proposed") {
    throw new InvalidPerformanceGoalError("Only an employee-proposed goal can be accepted");
  }

  const editing = params.title !== undefined || params.target !== undefined || params.unit !== undefined || params.weight !== undefined;
  if (editing) {
    validateGoalFields({
      title: params.title ?? goal.title,
      measurementType: goal.measurementType as MeasurementType,
      target: params.target !== undefined ? (params.target ?? undefined) : goal.target != null ? Number(goal.target) : undefined,
      unit: params.unit !== undefined ? (params.unit ?? undefined) : (goal.unit ?? undefined),
      weight: params.weight ?? goal.weight,
    });
  }

  const patch: Record<string, unknown> = { approvalStatus: "accepted", updatedAt: new Date() };
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.target !== undefined) patch.target = toTargetColumn(params.target ?? undefined);
  if (params.unit !== undefined) patch.unit = params.unit;
  if (params.weight !== undefined) patch.weight = params.weight;
  if (params.dueDate !== undefined) patch.dueDate = params.dueDate;

  const [updated] = await db
    .update(performanceReviewGoalsTable)
    .set(patch)
    .where(and(eq(performanceReviewGoalsTable.id, params.goalId), eq(performanceReviewGoalsTable.approvalStatus, "proposed")))
    .returning();
  if (!updated) throw new PerformanceGoalDecisionConflictError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review_goal.accepted",
    targetType: "performance_review_goal",
    targetId: String(params.goalId),
    metadata: { reviewId: params.reviewId, action: "proposal_accepted" },
  });

  return updated;
}

export interface RejectGoalParams {
  organizationId: number;
  reviewId: number;
  goalId: number;
  callerEmployeeId: number | null;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** Reviewer of record rejects a proposed goal — a managerComment reason is required (§12). Retained forever, never deleted; permanently excluded from weighting/scoring. Same atomic conditional-update guard as acceptGoal. */
export async function rejectGoal(params: RejectGoalParams): Promise<PerformanceReviewGoal> {
  if (!params.reason || !params.reason.trim()) {
    throw new InvalidPerformanceGoalError("A reason is required to reject a proposed goal");
  }
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (params.callerEmployeeId == null || review.reviewerEmployeeId !== params.callerEmployeeId) {
    throw new PerformanceGoalForbiddenError("Only this review's reviewer of record may reject a proposed goal");
  }
  if (review.status !== "manager_review") {
    throw new PerformanceGoalStageError("Proposals can only be rejected while the review is in manager_review status");
  }
  const goal = await findOwnGoal(params.organizationId, params.reviewId, params.goalId);
  if (!goal) throw new PerformanceGoalNotFoundError();
  if (goal.originType !== "employee_proposed") {
    throw new InvalidPerformanceGoalError("Only an employee-proposed goal can be rejected");
  }

  const [updated] = await db
    .update(performanceReviewGoalsTable)
    .set({ approvalStatus: "rejected", managerComment: params.reason, updatedAt: new Date() })
    .where(and(eq(performanceReviewGoalsTable.id, params.goalId), eq(performanceReviewGoalsTable.approvalStatus, "proposed")))
    .returning();
  if (!updated) throw new PerformanceGoalDecisionConflictError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review_goal.rejected",
    targetType: "performance_review_goal",
    targetId: String(params.goalId),
    metadata: { reviewId: params.reviewId },
  });

  return updated;
}
