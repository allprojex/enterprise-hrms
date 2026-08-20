/**
 * Unit tests for the pure Performance scoring model (Phase 3C, W78,
 * §11) — no DB, no mocks, exercising performanceScoring.ts's exported
 * functions directly against the frozen formula.
 */
import { describe, it, expect } from "vitest";
import { computeOverallScore, goalItemScore, competencyItemScore, roundHalfUp, isScoreableGoal, isUndefinedScore, type ScorableGoal, type ScorableCompetency } from "../lib/performanceScoring";

function goal(overrides: Partial<ScorableGoal> = {}): ScorableGoal {
  return { id: 1, measurementType: "numeric", target: "10", actualResult: "10", weight: 100, approvalStatus: "accepted", notApplicable: false, ...overrides };
}
function competency(overrides: Partial<ScorableCompetency> = {}): ScorableCompetency {
  return { id: 1, managerRatingValue: "5", weight: 100, notApplicable: false, ...overrides };
}

describe("roundHalfUp", () => {
  it("rounds a clean half up at precision 0", () => {
    expect(roundHalfUp(2.5, 0)).toBe(3);
    expect(roundHalfUp(3.5, 0)).toBe(4);
  });

  it("rounds correctly at precision 2 despite binary floating-point representation error", () => {
    // 1.005 * 100 naively evaluates to 100.49999999999999 in IEEE754 —
    // a plain Math.round would silently round this down to 1.00.
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
  });

  it("rounds down when below the half boundary", () => {
    expect(roundHalfUp(2.49, 0)).toBe(2);
  });
});

describe("goalItemScore — §11.1 per measurement type", () => {
  it("numeric: clamp(actualResult/target * 100, 0, 100)", () => {
    expect(goalItemScore(goal({ measurementType: "numeric", target: "10", actualResult: "5" }), 5)).toBe(50);
  });

  it("numeric: overachievement is clamped at 100, never a bonus", () => {
    expect(goalItemScore(goal({ measurementType: "numeric", target: "10", actualResult: "20" }), 5)).toBe(100);
  });

  it("percentage: same clamp formula as numeric", () => {
    expect(goalItemScore(goal({ measurementType: "percentage", target: "80", actualResult: "40" }), 5)).toBe(50);
  });

  it("currency: same clamp formula as numeric", () => {
    expect(goalItemScore(goal({ measurementType: "currency", target: "1000", actualResult: "750" }), 5)).toBe(75);
  });

  it("boolean: actualResult >= 1 scores 100", () => {
    expect(goalItemScore(goal({ measurementType: "boolean", target: null, actualResult: "1" }), 5)).toBe(100);
  });

  it("boolean: actualResult 0 scores 0", () => {
    expect(goalItemScore(goal({ measurementType: "boolean", target: null, actualResult: "0" }), 5)).toBe(0);
  });

  it("rating: chosen level value over the review's own max level value", () => {
    expect(goalItemScore(goal({ measurementType: "rating", target: null, actualResult: "4" }), 5)).toBe(80);
  });
});

describe("competencyItemScore — §11.1, managerRatingValue only", () => {
  it("scores managerRatingValue / max level value x 100", () => {
    expect(competencyItemScore(competency({ managerRatingValue: "3" }), 5)).toBe(60);
  });

  it("never reads employeeRatingValue (not part of the interface at all — Owner Decision 1 enforced by construction)", () => {
    // ScorableCompetency intentionally carries no employeeRatingValue field.
    expect(competencyItemScore(competency({ managerRatingValue: "5" }), 5)).toBe(100);
  });
});

describe("isScoreableGoal — §11.2", () => {
  it("counts only accepted, non-qualitative, non-N/A goals", () => {
    expect(isScoreableGoal(goal({ approvalStatus: "accepted", measurementType: "numeric", notApplicable: false }))).toBe(true);
    expect(isScoreableGoal(goal({ approvalStatus: "proposed" }))).toBe(false);
    expect(isScoreableGoal(goal({ approvalStatus: "rejected" }))).toBe(false);
    expect(isScoreableGoal(goal({ measurementType: "qualitative", weight: 0 }))).toBe(false);
    expect(isScoreableGoal(goal({ notApplicable: true }))).toBe(false);
  });
});

describe("computeOverallScore — §11.4 weighted average and both-sections-null handling", () => {
  it("computes a simple single-goal, single-competency review", () => {
    // goal: numeric 10/10 = 100; competency: rating 5/5 = 100. Both full weight -> overall 100.
    const result = computeOverallScore({
      goals: [goal({ target: "10", actualResult: "10", weight: 100 })],
      competencies: [competency({ managerRatingValue: "5", weight: 100 })],
      goalsWeight: 60,
      competenciesWeight: 40,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(100);
    expect(result.goalScores.get(1)).toBe(100);
  });

  it("weights the two sections by the review's own snapshotted goalsWeight/competenciesWeight", () => {
    // goal scores 100 (full), competency scores 0 (managerRatingValue 0-equivalent via min level).
    const result = computeOverallScore({
      goals: [goal({ target: "10", actualResult: "10", weight: 100 })],
      competencies: [competency({ managerRatingValue: "0", weight: 100 })],
      goalsWeight: 70,
      competenciesWeight: 30,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(70); // 100*0.7 + 0*0.3
  });

  it("redistributes weight to competencies when the goals section is entirely N/A", () => {
    const result = computeOverallScore({
      goals: [goal({ weight: 100, notApplicable: true })],
      competencies: [competency({ managerRatingValue: "5", weight: 100 })],
      goalsWeight: 60,
      competenciesWeight: 40,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(100); // competencies get 100% of the weight
  });

  it("redistributes weight to goals when the competencies section is entirely N/A", () => {
    const result = computeOverallScore({
      goals: [goal({ target: "10", actualResult: "10", weight: 100 })],
      competencies: [competency({ weight: 100, notApplicable: true })],
      goalsWeight: 60,
      competenciesWeight: 40,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(100);
  });

  it("redistributes proportionally within a section when only some items are N/A", () => {
    // Two goals, 50/50 weight; one is N/A. The remaining goal's effective weight becomes 100.
    const result = computeOverallScore({
      goals: [
        goal({ id: 1, target: "10", actualResult: "10", weight: 50 }), // scores 100
        goal({ id: 2, weight: 50, notApplicable: true }),
      ],
      competencies: [],
      goalsWeight: 100,
      competenciesWeight: 0,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(100);
    expect(result.goalScores.get(1)).toBe(100);
    expect(result.goalScores.has(2)).toBe(false); // N/A goal never gets a persisted computedScore
  });

  it("excludes proposed and rejected goals from the goals average entirely", () => {
    const result = computeOverallScore({
      goals: [
        goal({ id: 1, target: "10", actualResult: "10", weight: 100 }),
        goal({ id: 2, approvalStatus: "proposed", weight: 999 }),
        goal({ id: 3, approvalStatus: "rejected", weight: 999 }),
      ],
      competencies: [],
      goalsWeight: 100,
      competenciesWeight: 0,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(100);
    expect(result.goalScores.size).toBe(1);
  });

  it("excludes qualitative goals from the goals average entirely (zero weight, no score)", () => {
    const result = computeOverallScore({
      goals: [
        goal({ id: 1, target: "10", actualResult: "10", weight: 100 }),
        goal({ id: 2, measurementType: "qualitative", target: null, actualResult: null, weight: 0 }),
      ],
      competencies: [],
      goalsWeight: 100,
      competenciesWeight: 0,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(100);
    expect(result.goalScores.has(2)).toBe(false);
  });

  it("applies scoringPrecisionSnapshot at the final rounding step only", () => {
    const result = computeOverallScore({
      goals: [goal({ target: "3", actualResult: "1", weight: 100 })], // 33.333...
      competencies: [],
      goalsWeight: 100,
      competenciesWeight: 0,
      scoringPrecision: 2,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(33.33);
  });

  it("rounds to a whole number when scoringPrecisionSnapshot is 0", () => {
    const result = computeOverallScore({
      goals: [goal({ target: "3", actualResult: "2", weight: 100 })], // 66.666...
      competencies: [],
      goalsWeight: 100,
      competenciesWeight: 0,
      scoringPrecision: 0,
      ratingScaleMaxLevel: 5,
    });
    expect(result.overallScore).toBe(67);
  });
});

describe("isUndefinedScore — §11.6 pathological case", () => {
  it("is true when both sections have zero scoreable items", () => {
    expect(isUndefinedScore([goal({ approvalStatus: "proposed" })], [competency({ notApplicable: true })])).toBe(true);
  });

  it("is false when at least one section has a scoreable item", () => {
    expect(isUndefinedScore([goal()], [competency({ notApplicable: true })])).toBe(false);
    expect(isUndefinedScore([goal({ approvalStatus: "rejected" })], [competency()])).toBe(false);
  });
});
