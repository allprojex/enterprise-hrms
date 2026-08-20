/**
 * Performance Scoring (Phase 3C, W78 — Manager Review): pure, DB-free
 * implementation of the frozen scoring model
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §11). No invented
 * formula — every branch below traces to an exact §11 sentence, cited
 * inline. Kept dependency-free and unit-testable in isolation from
 * performanceManagerReview.ts's own DB/route plumbing.
 *
 * §11.1 Per-item normalization (0-100):
 *   numeric/percentage/currency: clamp(actualResult/target x 100, 0, 100)
 *   boolean: 100 if actualResult indicates complete (>=1), else 0
 *   rating: (chosen level value / max level value in the review's rating
 *     scale) x 100 — "chosen level value" is stored in actualResult,
 *     reusing the same column other types use for their raw achieved
 *     value (no separate "chosen level" column exists in §8.7's schema).
 *   qualitative: no score — excluded before any of this runs.
 *   Competency: (managerRatingValue / max level value) x 100.
 *     employeeRatingValue is never used in this formula (Owner Decision 1).
 *
 * §11.2 Which items count: a goal counts only if approvalStatus='accepted',
 * not qualitative, and not notApplicable. A competency counts unless
 * notApplicable (no approval concept).
 *
 * §11.3 N/A redistribution — proportional, within the same section,
 * computed at calculation time, never by mutating stored weights:
 *   effectiveWeight(item) = storedWeight(item) / (100 - SUM(storedWeight
 *     of N/A items in this section)) x 100
 * If a whole section has zero counting items, its average is null and its
 * weight contributes 0 to the overall score; the other section's weight
 * is redistributed to 100%.
 *
 * §11.4 Weighted averages and rounding:
 *   goalsAvg = SUM(goalScore x effectiveGoalWeight) / 100
 *   competenciesAvg = SUM(competencyScore x effectiveCompetencyWeight) / 100
 *   effectiveGoalsWeight/effectiveCompetenciesWeight = the review's own
 *     stored goalsWeight/competenciesWeight, UNLESS one section's average
 *     is null (§11.3), in which case 0/100 respectively.
 *   overallScore = round(goalsAvg*effectiveGoalsWeight/100 +
 *     competenciesAvg*effectiveCompetenciesWeight/100, scoringPrecision)
 *   Rounding is round-half-up, applied ONCE, at the final overallScore
 *   only — intermediate averages/per-item scores are never separately
 *   rounded (except each per-item goal computedScore, which the DB
 *   column's own numeric(5,2) scale naturally bounds to 2dp on write —
 *   this module itself does not round per-item scores).
 *
 * §11.6 guarantees a defined denominator reaches computeOverallScore: it
 * is the CALLER's responsibility (performanceManagerReview.ts's own
 * readiness check) to block submission before calling this function
 * whenever both sections would end up with zero counting items — this
 * module assumes that precondition already holds and does not itself
 * throw a business error for it (it would simply produce a 0 score,
 * which the readiness check exists specifically to prevent from ever
 * being reached).
 */

export interface ScorableGoal {
  id: number;
  measurementType: "numeric" | "percentage" | "currency" | "boolean" | "rating" | "qualitative" | string;
  target: string | number | null;
  actualResult: string | number | null;
  weight: number;
  approvalStatus: "accepted" | "proposed" | "rejected" | string;
  notApplicable: boolean;
}

export interface ScorableCompetency {
  id: number;
  managerRatingValue: string | number | null;
  weight: number;
  notApplicable: boolean;
}

/** §11.2 — a goal counts toward scoring only if accepted, non-qualitative, and not N/A. Distinct from "official" (weight-sum-validated) status, which does NOT exclude N/A — see performanceManagerReview.ts's own readiness check. */
export function isScoreableGoal(goal: ScorableGoal): boolean {
  return goal.approvalStatus === "accepted" && goal.measurementType !== "qualitative" && !goal.notApplicable;
}

/** §11.1 — the per-item 0-100 normalized score for a single scoreable goal. Never called for a qualitative or N/A goal (callers filter via isScoreableGoal first). */
export function goalItemScore(goal: ScorableGoal, ratingScaleMaxLevel: number): number {
  const target = goal.target != null ? Number(goal.target) : null;
  const actual = goal.actualResult != null ? Number(goal.actualResult) : null;
  switch (goal.measurementType) {
    case "numeric":
    case "percentage":
    case "currency": {
      if (target == null || actual == null || target === 0) return 0;
      return clamp((actual / target) * 100, 0, 100);
    }
    case "boolean":
      return actual != null && actual >= 1 ? 100 : 0;
    case "rating": {
      if (actual == null || ratingScaleMaxLevel === 0) return 0;
      return (actual / ratingScaleMaxLevel) * 100;
    }
    default:
      return 0;
  }
}

/** §11.1 — the per-item 0-100 normalized score for a single (non-N/A) competency, from managerRatingValue only — employeeRatingValue never contributes (Owner Decision 1). */
export function competencyItemScore(competency: ScorableCompetency, ratingScaleMaxLevel: number): number {
  const rating = competency.managerRatingValue != null ? Number(competency.managerRatingValue) : null;
  if (rating == null || ratingScaleMaxLevel === 0) return 0;
  return (rating / ratingScaleMaxLevel) * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Round-half-up at an exact decimal precision, correcting for standard
 * IEEE754 binary floating-point representation error (e.g. 1.005 * 100
 * naively evaluates to 100.49999999999999, which would silently round
 * down under a plain Math.round — this pre-rounds the scaled value to a
 * generous 8 extra decimal digits first, absorbing that representation
 * error without needing a decimal/bignum dependency).
 */
export function roundHalfUp(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, precision);
  const scaled = value * factor;
  const errorCorrected = Math.sign(scaled) * Math.round(Math.abs(scaled) * 1e8) / 1e8;
  return Math.round(errorCorrected) / factor;
}

interface SectionResult {
  average: number | null;
  /** Per-item scores, keyed by goal id — only populated for the goals section (competencies have no persisted per-item score column, §8.8 vs §8.7). */
  itemScores: Map<number, number>;
}

function scoreGoalsSection(goals: ScorableGoal[], ratingScaleMaxLevel: number): SectionResult {
  const scoreable = goals.filter(isScoreableGoal);
  const itemScores = new Map<number, number>();
  if (scoreable.length === 0) return { average: null, itemScores };

  const naWeightSum = goals
    .filter((g) => g.approvalStatus === "accepted" && g.measurementType !== "qualitative" && g.notApplicable)
    .reduce((sum, g) => sum + g.weight, 0);
  const denominator = 100 - naWeightSum;
  if (denominator <= 0) return { average: null, itemScores };

  let weightedSum = 0;
  for (const goal of scoreable) {
    const score = goalItemScore(goal, ratingScaleMaxLevel);
    itemScores.set(goal.id, score);
    const effectiveWeight = (goal.weight / denominator) * 100;
    weightedSum += score * effectiveWeight;
  }
  return { average: weightedSum / 100, itemScores };
}

function scoreCompetenciesSection(competencies: ScorableCompetency[], ratingScaleMaxLevel: number): SectionResult {
  const scoreable = competencies.filter((c) => !c.notApplicable);
  const itemScores = new Map<number, number>();
  if (scoreable.length === 0) return { average: null, itemScores };

  const naWeightSum = competencies.filter((c) => c.notApplicable).reduce((sum, c) => sum + c.weight, 0);
  const denominator = 100 - naWeightSum;
  if (denominator <= 0) return { average: null, itemScores };

  let weightedSum = 0;
  for (const competency of scoreable) {
    const score = competencyItemScore(competency, ratingScaleMaxLevel);
    const effectiveWeight = (competency.weight / denominator) * 100;
    weightedSum += score * effectiveWeight;
  }
  return { average: weightedSum / 100, itemScores };
}

export interface OverallScoreResult {
  overallScore: number;
  /** goalId -> normalized 0-100 score, for persisting each scoreable goal's computedScore column (§8.7). */
  goalScores: Map<number, number>;
}

/** §11.4 — the full overall-score computation. Callers must have already run the §11.6 readiness check (both sections null is a business error, not something this function itself rejects). */
export function computeOverallScore(params: {
  goals: ScorableGoal[];
  competencies: ScorableCompetency[];
  goalsWeight: number;
  competenciesWeight: number;
  scoringPrecision: number;
  ratingScaleMaxLevel: number;
}): OverallScoreResult {
  const goalsSection = scoreGoalsSection(params.goals, params.ratingScaleMaxLevel);
  const competenciesSection = scoreCompetenciesSection(params.competencies, params.ratingScaleMaxLevel);

  let effectiveGoalsWeight: number;
  let effectiveCompetenciesWeight: number;
  if (goalsSection.average == null && competenciesSection.average == null) {
    effectiveGoalsWeight = 0;
    effectiveCompetenciesWeight = 0;
  } else if (goalsSection.average == null) {
    effectiveGoalsWeight = 0;
    effectiveCompetenciesWeight = 100;
  } else if (competenciesSection.average == null) {
    effectiveGoalsWeight = 100;
    effectiveCompetenciesWeight = 0;
  } else {
    effectiveGoalsWeight = params.goalsWeight;
    effectiveCompetenciesWeight = params.competenciesWeight;
  }

  const raw = (goalsSection.average ?? 0) * (effectiveGoalsWeight / 100) + (competenciesSection.average ?? 0) * (effectiveCompetenciesWeight / 100);

  return {
    overallScore: roundHalfUp(raw, params.scoringPrecision),
    goalScores: goalsSection.itemScores,
  };
}

/** §11.6 — true when neither section has any scoreable item (the pathological case manager submission must block before it can ever reach computeOverallScore). */
export function isUndefinedScore(goals: ScorableGoal[], competencies: ScorableCompetency[]): boolean {
  return !goals.some(isScoreableGoal) && !competencies.some((c) => !c.notApplicable);
}
