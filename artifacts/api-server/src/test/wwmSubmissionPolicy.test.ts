/**
 * WWM template submission policy (Owner Decision D5).
 *
 * PIF v2 is v1 unchanged EXCEPT that it opts into assisted completion. These
 * tests pin that delta precisely: the policy is present on the PIF and on
 * nothing else, and no other seed property moved. Content fidelity itself is
 * covered by wwmFormFidelity.test.ts, which still passes unchanged.
 */
import { describe, it, expect } from "vitest";
import { WWM_FORM_TEMPLATES } from "../formTemplates/wwm";
import { allowsOnBehalfSubmission } from "../lib/formEngine/assistedSubmission";

const byKey = Object.fromEntries(WWM_FORM_TEMPLATES.map((t) => [t.templateKey, t]));

describe("WWM submission policy", () => {
  it("still declares exactly the four approved templates", () => {
    expect(WWM_FORM_TEMPLATES).toHaveLength(4);
    expect(Object.keys(byKey).sort()).toEqual([
      "wwm_leave_application",
      "wwm_personal_information",
      "wwm_probationary_assessment",
      "wwm_staff_evaluation",
    ]);
  });

  it("opts the Staff Personal Information Form into assisted completion", () => {
    expect(byKey.wwm_personal_information.submissionPolicy).toEqual({ allowOnBehalfSubmission: true });
    expect(allowsOnBehalfSubmission({ submissionPolicy: byKey.wwm_personal_information.submissionPolicy } as never)).toBe(true);
  });

  it("leaves the other three closed — an evaluation, a probation assessment and a leave application are first-person acts", () => {
    for (const key of ["wwm_leave_application", "wwm_staff_evaluation", "wwm_probationary_assessment"]) {
      expect(byKey[key].submissionPolicy).toBeUndefined();
      expect(allowsOnBehalfSubmission({ submissionPolicy: byKey[key].submissionPolicy ?? null } as never)).toBe(false);
    }
  });

  it("changes nothing else about the PIF: title, type, module, fixture, stages and signature policy are untouched", () => {
    const pif = byKey.wwm_personal_information;
    expect(pif.title).toBe("Staff Personal Information Form");
    expect(pif.formType).toBe("personal_information");
    expect(pif.moduleKey).toBeNull();
    expect(pif.fixture).toBe("personal-information");
    // HR review, single stage — unchanged.
    expect(pif.stages).toHaveLength(1);
    expect(pif.stages[0]).toMatchObject({ stageOrder: 1, participant: "hr" });
    // The employee signature requirement is NOT relaxed by assisted completion.
    expect(pif.signaturePolicy).toEqual({
      slots: [
        { key: "employee_signature", role: "employee", required: true, methods: ["drawn", "uploaded", "device"] },
      ],
    });
  });

  it("keeps the Leave form's single stage — the HOD→HR chain belongs to the Leave module, not the form (D1)", () => {
    const leave = byKey.wwm_leave_application;
    expect(leave.stages).toHaveLength(1);
    expect(leave.stages[0]).toMatchObject({ stageOrder: 1, participant: "supervisor" });
    expect(leave.moduleKey).toBe("leave");
  });
});
