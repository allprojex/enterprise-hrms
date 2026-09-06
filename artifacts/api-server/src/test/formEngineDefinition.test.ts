/**
 * WS-26A — template definition contract, answer validation and computation.
 * Pure functions; no database.
 */
import { describe, it, expect } from "vitest";
import { validateFormDefinition, definitionSha256, canonicalJson, FormDefinitionError } from "../lib/formEngine/definition";
import { validateAnswers, computeValues, FormAnswersError, sectionKeysEditableBy } from "../lib/formEngine/answers";
import { readonlyKeys } from "../lib/formEngine/bindings";
import { WWM_FORM_TEMPLATES } from "../formTemplates/wwm";
import { wwmStaffEvaluationDefinition } from "../formTemplates/wwm/staffEvaluation";
import { wwmLeaveApplicationDefinition } from "../formTemplates/wwm/leaveApplication";
import { wwmProbationaryAssessmentDefinition } from "../formTemplates/wwm/probationaryAssessment";

describe("validateFormDefinition", () => {
  it("accepts all four WWM definitions unchanged and hashes them deterministically", () => {
    for (const seed of WWM_FORM_TEMPLATES) {
      const validated = validateFormDefinition(seed.definition);
      expect(canonicalJson(validated)).toBe(canonicalJson(seed.definition));
      expect(definitionSha256(validated)).toBe(definitionSha256(seed.definition));
      expect(definitionSha256(validated)).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rejects duplicate item keys, unknown kinds, bad bindings and dangling computed refs", () => {
    const base = { header: { lines: ["X"], logo: "none" } };
    expect(() =>
      validateFormDefinition({ ...base, sections: [{ key: "a", layout: "stack", items: [{ kind: "field", key: "f", label: "F", type: "short_text" }, { kind: "field", key: "f", label: "F2", type: "short_text" }] }] }),
    ).toThrow(FormDefinitionError);
    expect(() => validateFormDefinition({ ...base, sections: [{ key: "a", layout: "stack", items: [{ kind: "script", key: "x" }] }] })).toThrow(/not supported/);
    expect(() =>
      validateFormDefinition({ ...base, sections: [{ key: "a", layout: "stack", items: [{ kind: "field", key: "f", label: "F", type: "short_text", binding: { source: "sql", ref: "x", mode: "readonly" } }] }] }),
    ).toThrow(/not allowed/);
    expect(() =>
      validateFormDefinition({ ...base, sections: [{ key: "a", layout: "stack", items: [{ kind: "computed", key: "c", label: "Total", op: "sum", of: ["missing"] }] }] }),
    ).toThrow(/not a matrix or rated_table/);
    expect(() => validateFormDefinition({ ...base, sections: [{ key: "a", layout: "stack", items: [{ kind: "computed", key: "c", label: "T", op: "avg", of: ["x"] }] }] })).toThrow(/op must be/);
  });

  it("rejects exclusive pairs that do not name options and keys that are not lower_snake_case", () => {
    const base = { header: { lines: ["X"], logo: "none" } };
    expect(() =>
      validateFormDefinition({
        ...base,
        sections: [{ key: "a", layout: "stack", items: [{ kind: "choice_group", key: "g", mode: "multi", options: [{ value: "a", label: "A" }], exclusivePairs: [["a", "zzz"]] }] }],
      }),
    ).toThrow(/not an option/);
    expect(() => validateFormDefinition({ ...base, sections: [{ key: "Bad-Key", layout: "stack", items: [] }] })).toThrow(/lower_snake_case/);
  });

  it("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});

describe("validateAnswers / computeValues", () => {
  const evaluation = validateFormDefinition(wwmStaffEvaluationDefinition);
  const leave = validateFormDefinition(wwmLeaveApplicationDefinition);
  const probation = validateFormDefinition(wwmProbationaryAssessmentDefinition);

  it("rejects keys that are not on the form and never accepts a readonly-bound key from the client", () => {
    expect(() => validateAnswers(leave, { not_a_field: "x" }, { strict: false })).toThrow(FormAnswersError);
    const out = validateAnswers(leave, { employee_name: "Forged", from_date: "2026-10-01" }, { strict: false, readonlyKeys: readonlyKeys(leave) });
    expect(out.employee_name).toBeUndefined();
    expect(out.from_date).toBe("2026-10-01");
  });

  it("draft mode tolerates missing required answers; strict mode does not", () => {
    expect(() => validateAnswers(leave, {}, { strict: false, readonlyKeys: readonlyKeys(leave) })).not.toThrow();
    expect(() => validateAnswers(leave, {}, { strict: true, readonlyKeys: readonlyKeys(leave), editableSections: sectionKeysEditableBy(leave, "employee") })).toThrow(/From is required|requires a selection/);
  });

  it("'Other (specify)' satisfies the leave-type requirement on its own", () => {
    const out = validateAnswers(
      leave,
      { leave_type_other: "Study leave", from_date: "2026-10-01", to_date: "2026-10-03", days_requested: 3 },
      { strict: true, readonlyKeys: readonlyKeys(leave), editableSections: sectionKeysEditableBy(leave, "employee") },
    );
    expect(out.leave_type_other).toBe("Study leave");
  });

  it("only the stage's editable sections may change; other sections keep their previous values", () => {
    const previous = { from_date: "2026-10-01", to_date: "2026-10-02", days_requested: 2, leave_type: "annual_leave" };
    const out = validateAnswers(leave, { from_date: "1999-01-01", decision: "approved", approved_by: "A. Manager" }, { strict: false, readonlyKeys: readonlyKeys(leave), editableSections: new Set(["approval"]), previous });
    expect(out.from_date).toBe("2026-10-01");
    expect(out.decision).toBe("approved");
    expect(out.approved_by).toBe("A. Manager");
  });

  it("enforces the evaluation recommendation as two independent exclusive pairs", () => {
    const editable = new Set(["recommendation"]);
    expect(() => validateAnswers(evaluation, { recommendation: ["recommended_higher_position", "not_recommended_higher_position"] }, { strict: true, editableSections: editable })).toThrow(/cannot both be selected/);
    const ok = validateAnswers(evaluation, { recommendation: ["recommended_higher_position", "not_recommended_salary_increment"] }, { strict: true, editableSections: editable });
    expect(ok.recommendation).toEqual(["recommended_higher_position", "not_recommended_salary_increment"]);
  });

  it("rates each goal once and sums half-year and full-year totals separately", () => {
    const answers = validateAnswers(
      evaluation,
      {
        half_year_goals: { goal_1: { description: "Grow", actions: "Do", rating: 5 }, goal_2: { rating: 4 }, goal_3: { rating: 3 } },
        half_year_ratings: { attitude: 5, skill_improvement: 4 },
      },
      { strict: false, editableSections: new Set(["section_a", "section_b"]) },
    );
    const computed = computeValues(evaluation, answers);
    expect(computed.half_year_goals_total).toBe(12);
    expect(computed.half_year_ratings_total).toBe(9);
    expect(computed.full_year_goals_total).toBeNull();
  });

  it("rejects a rating off the 5–1 scale and a rating for the un-rated Overall Evaluation row", () => {
    expect(() => validateAnswers(probation, { ratings: { attitude: 7 } }, { strict: false, editableSections: new Set(["assessment"]) })).toThrow(/not a rating on the scale/);
    const out = validateAnswers(probation, { ratings: { attitude: 5, responsiveness_to_change: 4, overall_evaluation: 5 } }, { strict: false, editableSections: new Set(["assessment"]) });
    // The un-rated row is ignored, never counted.
    expect((out.ratings as Record<string, unknown>).overall_evaluation).toBeUndefined();
    expect(computeValues(probation, out).total_ratings).toBe(9);
  });

  it("drops blank dependant rows and validates table cells as text", () => {
    const pif = validateFormDefinition(WWM_FORM_TEMPLATES[1].definition);
    const out = validateAnswers(pif, { dependants: [{ name: "Ama", relationship: "Daughter" }, { name: "", relationship: "" }] }, { strict: false, readonlyKeys: readonlyKeys(pif) });
    expect(out.dependants).toEqual([{ name: "Ama", relationship: "Daughter" }]);
    expect(() => validateAnswers(pif, { dependants: [{ name: 42 }] }, { strict: false })).toThrow(/must be text/);
  });
});
