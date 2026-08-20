/**
 * Performance HR Review, Finalization, Override & Reopen (Phase 3C, W79):
 * the authoritative `hr_review -> finalized` transition (§10.1 row 4,
 * §16) plus the controlled HR reopen rule (§10.4)
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md).
 *
 * A REAL, DOUBLY-RESOLVED CONFLICT IN THE FROZEN TEXT, FLAGGED HERE
 * RATHER THAN SILENTLY PICKED: §10.1 row 4 and §16 both literally say
 * `computedOverallScore` is "computed at the hr_review -> finalized
 * transition." W78 (already shipped, commit d667fad) instead computes
 * and persists it at the PRIOR transition (manager_review -> hr_review),
 * matching three independent, mutually-reinforcing pieces of evidence
 * that outweigh that one recurring phrase: (1) §8.7's own schema comment
 * for the per-goal `computedScore` column says it is "computed at
 * manager-submit time" — the review-level aggregate is built from
 * exactly those same per-item scores, so computing the aggregate at the
 * same moment is the only internally-consistent reading; (2) §10.4's own
 * literal reopen-to-`manager_review` worked example lists
 * `computedOverallScore` among the fields that get CLEARED when
 * reopening FROM `hr_review`/`finalized` BACK to `manager_review` — a
 * field can only need clearing if it was already set, which is only
 * possible if it was set before reaching `hr_review`, i.e. at the
 * manager's own submission; (3) this workstream's own master brief
 * treats `computedOverallScore` as an already-existing, must-be-
 * preserved-exactly value throughout ("Preserve: computedOverallScore
 * exactly," an override-QA script reading it as already known before
 * any override is applied). W79 therefore never recomputes it — it is
 * read-only historical input here, exactly as W78 left it; only
 * `hrOverrideScore`/`hrOverrideReason` are ever written by finalize.
 *
 * PERMISSIONS — deliberately NOT what a generic hint might suggest:
 * finalize (+ override) is `performance.finalize`; reopen is
 * `performance.manage`, not `performance.finalize` — per §10.1 row 6's
 * own explicit permission column AND §16's own explicit parenthetical
 * ("performance.manage for cycle/template/config administration and
 * reopen"), two independent, mutually-consistent locations in the frozen
 * document. No new permission key is added for either.
 *
 * FINALIZE + OVERRIDE ARE ONE ROUTE, NOT TWO: §27's own frozen route
 * list names exactly one mutation here — "POST .../finalize | finalize
 * (+ optional override)" — no separate "set override" route exists
 * anywhere in the frozen API table. The override fields are therefore
 * accepted directly in the finalize request body, applied atomically
 * with the status transition in the same call; there is no
 * "draft an override, then finalize separately" flow, and consequently
 * no "clear a standalone override" operation either (there is nothing to
 * clear before finalize — you simply omit the fields on that one call).
 *
 * REOPEN FIELD-CLEARING (§10.4's own general principle — "clears only
 * the timestamp(s) and decision fields strictly downstream of the target
 * stage" — applied to every valid target using its one literal worked
 * example for `manager_review` as the calibrating case):
 *   -> self_assessment: clears selfAssessmentSubmittedAt,
 *      managerReviewSubmittedAt, hrFinalizedAt, acknowledgedAt,
 *      computedOverallScore, hrOverrideScore, hrOverrideReason.
 *   -> manager_review: clears managerReviewSubmittedAt, hrFinalizedAt,
 *      acknowledgedAt, computedOverallScore, hrOverrideScore,
 *      hrOverrideReason — this is §10.4's own literal example, verbatim.
 *   -> hr_review: clears hrFinalizedAt, acknowledgedAt, hrOverrideScore,
 *      hrOverrideReason — computedOverallScore is NOT cleared, since the
 *      manager's own work is not being redone; only HR's own subsequent
 *      decisions (override/finalize) are — resolving the master brief's
 *      own open question ("does a prior override remain active"): no, it
 *      does not, and must be explicitly re-supplied on the next finalize.
 * None of this clears the underlying goal/competency/self-assessment
 * CONTENT fields (§10.4: "does not blank the actual field values ...
 * they remain in place as an editable starting point") — only these
 * review-row timestamp/decision columns. Per-goal `computedScore` is
 * likewise left untouched by reopen itself (§10.4's own worked example
 * is entirely `performance_reviews`-column-scoped) — it is naturally
 * overwritten the next time the manager genuinely resubmits (W78).
 *
 * SELF-APPROVAL: the frozen document contains no rule restricting HR
 * from finalizing a review they were also the reviewer-of-record for —
 * none is invented here; `performance.finalize` + organization scope is
 * the complete authorization check, matching the master brief's own
 * explicit "do not invent... do not omit... follow the source of truth"
 * instruction where the source of truth is simply silent.
 *
 * ACKNOWLEDGEMENT BOUNDARY: finalize transitions only to `finalized`,
 * never automatically to `acknowledged` (§17/a later workstream's own
 * job) — `acknowledgedAt` is read/cleared here only as part of the
 * reopen field-clearing table above, never set by anything in this file.
 */
import { and, eq } from "drizzle-orm";
import { db, performanceReviewsTable, type PerformanceReview } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { PerformanceReviewNotFoundError } from "./performanceCycles";

export { PerformanceReviewNotFoundError };

export class PerformanceHrReviewStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerformanceHrReviewStageError";
  }
}

export class InvalidPerformanceHrReviewError extends Error {}

type ReviewStatus = "draft" | "self_assessment" | "manager_review" | "hr_review" | "finalized" | "acknowledged";
type ReopenTargetStage = "self_assessment" | "manager_review" | "hr_review";

const STAGE_ORDER: Record<ReviewStatus, number> = {
  draft: 0,
  self_assessment: 1,
  manager_review: 2,
  hr_review: 3,
  finalized: 4,
  acknowledged: 5,
};

// §10.4 point 1: reopen is only valid from these three source statuses
// ("acknowledged" is included per the frozen text's own "treated as
// equivalent to finalized" — structurally unreachable in the current
// baseline since no route sets it yet, but implemented correctly for
// forward compatibility, matching this session's established precedent
// for stage-unreachable-but-correctly-built logic).
const REOPENABLE_SOURCE_STATUSES: ReviewStatus[] = ["manager_review", "hr_review", "finalized", "acknowledged"];
const VALID_REOPEN_TARGETS: ReopenTargetStage[] = ["self_assessment", "manager_review", "hr_review"];

async function findOwnReview(organizationId: number, reviewId: number): Promise<PerformanceReview | null> {
  const [row] = await db
    .select()
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.id, reviewId), eq(performanceReviewsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface FinalizeReviewParams {
  organizationId: number;
  reviewId: number;
  hrOverrideScore?: number;
  hrOverrideReason?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * The authoritative hr_review -> finalized transition (§10.1 row 4).
 * computedOverallScore is read-only historical input here (see file
 * header) — never recomputed, never overwritten. An atomic conditional
 * UPDATE ... WHERE status = 'hr_review' performs the transition; a
 * concurrent or repeat finalization affects zero rows and returns a
 * controlled 409.
 */
export async function finalizeReview(params: FinalizeReviewParams): Promise<PerformanceReview> {
  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();
  if (review.status !== "hr_review") {
    throw new PerformanceHrReviewStageError("This review is not awaiting HR review");
  }

  const hasScore = params.hrOverrideScore !== undefined;
  const hasReason = params.hrOverrideReason !== undefined && params.hrOverrideReason.trim() !== "";
  if (hasScore !== hasReason) {
    throw new InvalidPerformanceHrReviewError("hrOverrideScore and hrOverrideReason must both be supplied together, or neither");
  }
  if (hasScore && (params.hrOverrideScore! < 0 || params.hrOverrideScore! > 100)) {
    throw new InvalidPerformanceHrReviewError("hrOverrideScore must be between 0 and 100");
  }

  const patch: Record<string, unknown> = {
    status: "finalized",
    hrFinalizedAt: new Date(),
    updatedAt: new Date(),
  };
  if (hasScore) {
    patch.hrOverrideScore = params.hrOverrideScore!.toString();
    patch.hrOverrideReason = params.hrOverrideReason;
  }

  const [updated] = await db
    .update(performanceReviewsTable)
    .set(patch)
    .where(and(eq(performanceReviewsTable.id, params.reviewId), eq(performanceReviewsTable.organizationId, params.organizationId), eq(performanceReviewsTable.status, "hr_review")))
    .returning();
  if (!updated) {
    throw new PerformanceHrReviewStageError("This review is not awaiting HR review");
  }

  if (hasScore) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "performance_review.score_overridden",
      targetType: "performance_review",
      targetId: String(params.reviewId),
      metadata: { employeeId: review.employeeId, computedOverallScore: review.computedOverallScore, hrOverrideScore: params.hrOverrideScore },
    });
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review.finalized",
    targetType: "performance_review",
    targetId: String(params.reviewId),
    metadata: { employeeId: review.employeeId, effectiveScore: hasScore ? params.hrOverrideScore : review.computedOverallScore },
  });

  return updated;
}

export interface ReopenReviewParams {
  organizationId: number;
  reviewId: number;
  targetStage: string;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/** The controlled HR reopen rule (§10.4) — see file header for the exact field-clearing table per target stage. */
export async function reopenReview(params: ReopenReviewParams): Promise<PerformanceReview> {
  if (!params.reason || !params.reason.trim()) {
    throw new InvalidPerformanceHrReviewError("A reopenReason is required");
  }
  if (!VALID_REOPEN_TARGETS.includes(params.targetStage as ReopenTargetStage)) {
    throw new InvalidPerformanceHrReviewError(`targetStage must be one of: ${VALID_REOPEN_TARGETS.join(", ")}`);
  }
  const targetStage = params.targetStage as ReopenTargetStage;

  const review = await findOwnReview(params.organizationId, params.reviewId);
  if (!review) throw new PerformanceReviewNotFoundError();

  const currentStatus = review.status as ReviewStatus;
  if (!REOPENABLE_SOURCE_STATUSES.includes(currentStatus)) {
    throw new PerformanceHrReviewStageError(`A review in '${currentStatus}' status cannot be reopened`);
  }
  if (STAGE_ORDER[targetStage] >= STAGE_ORDER[currentStatus]) {
    throw new InvalidPerformanceHrReviewError(`Cannot reopen a '${currentStatus}' review to '${targetStage}' — the target must be strictly earlier`);
  }

  const patch: Record<string, unknown> = {
    status: targetStage,
    revisionNumber: review.revisionNumber + 1,
    updatedAt: new Date(),
  };
  // Field-clearing table — see file header for the derivation.
  if (targetStage === "self_assessment") {
    patch.selfAssessmentSubmittedAt = null;
    patch.managerReviewSubmittedAt = null;
    patch.hrFinalizedAt = null;
    patch.acknowledgedAt = null;
    patch.computedOverallScore = null;
    patch.hrOverrideScore = null;
    patch.hrOverrideReason = null;
  } else if (targetStage === "manager_review") {
    patch.managerReviewSubmittedAt = null;
    patch.hrFinalizedAt = null;
    patch.acknowledgedAt = null;
    patch.computedOverallScore = null;
    patch.hrOverrideScore = null;
    patch.hrOverrideReason = null;
  } else if (targetStage === "hr_review") {
    patch.hrFinalizedAt = null;
    patch.acknowledgedAt = null;
    patch.hrOverrideScore = null;
    patch.hrOverrideReason = null;
  }

  const beforeState = {
    status: review.status,
    revisionNumber: review.revisionNumber,
    computedOverallScore: review.computedOverallScore,
    hrOverrideScore: review.hrOverrideScore,
  };

  const [updated] = await db
    .update(performanceReviewsTable)
    .set(patch)
    .where(and(eq(performanceReviewsTable.id, params.reviewId), eq(performanceReviewsTable.organizationId, params.organizationId), eq(performanceReviewsTable.status, currentStatus)))
    .returning();
  if (!updated) {
    throw new PerformanceHrReviewStageError(`A review in '${currentStatus}' status cannot be reopened`);
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review.reopened",
    targetType: "performance_review",
    targetId: String(params.reviewId),
    metadata: { targetStage, reason: params.reason, revisionNumber: updated.revisionNumber },
    beforeState,
    afterState: { status: updated.status, revisionNumber: updated.revisionNumber, computedOverallScore: updated.computedOverallScore, hrOverrideScore: updated.hrOverrideScore },
  });

  return updated;
}
