/**
 * WWM template submission policy and PIF v2 workflow (Owner Decisions D5 and
 * the PIF employee-signature decision).
 *
 * PIF v2 = published v1 content EXCEPT exactly two approved changes:
 *   1. submissionPolicy.allowOnBehalfSubmission = true
 *   2. a subject-employee confirmation & signature stage BEFORE HR review,
 *      making the already-declared required employee signature collectable.
 * These tests pin that delta precisely, pin the frozen v1 workflow the
 * preparer must find published, and pin that the other three forms (including
 * the Leave form, whose own signature workflow is a separate workstream) did
 * not move.
 */
import { describe, it, expect } from "vitest";
import { WWM_FORM_TEMPLATES } from "../formTemplates/wwm";
import { wwmPersonalInformationV1Stages } from "../formTemplates/wwm/personalInformation";
import { allowsOnBehalfSubmission } from "../lib/formEngine/assistedSubmission";

const byKey = Object.fromEntries(WWM_FORM_TEMPLATES.map((t) => [t.templateKey, t]));

const HR_REVIEW = {
  name: "HR review",
  participant: "hr",
  resolver: "permission_holder",
  resolverConfig: { permissionKey: "form.approve" },
  editableSectionKeys: [],
  allowedActions: ["approve", "return", "reject"],
};

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

  it("leaves the other three closed and without prior-workflow baselines", () => {
    for (const key of ["wwm_leave_application", "wwm_staff_evaluation", "wwm_probationary_assessment"]) {
      expect(byKey[key].submissionPolicy).toBeUndefined();
      expect(byKey[key].priorPublishedStages).toBeUndefined();
      expect(allowsOnBehalfSubmission({ submissionPolicy: byKey[key].submissionPolicy ?? null } as never)).toBe(false);
    }
  });

  it("PIF v2 has exactly: stage 1 subject-employee confirmation & signature, stage 2 HR review", () => {
    const pif = byKey.wwm_personal_information;
    expect(pif.stages).toEqual([
      {
        stageOrder: 1,
        name: "Employee Confirmation & Signature",
        participant: "employee",
        resolver: "subject_employee",
        editableSectionKeys: [],
        allowedActions: ["complete"],
        signatureSlotKey: "employee_signature",
      },
      { stageOrder: 2, ...HR_REVIEW },
    ]);
  });

  it("pins the frozen v1 workflow (HR review only) as the one known prior baseline", () => {
    expect(wwmPersonalInformationV1Stages).toEqual([{ stageOrder: 1, ...HR_REVIEW }]);
    expect(byKey.wwm_personal_information.priorPublishedStages).toEqual([wwmPersonalInformationV1Stages]);
  });

  it("changes nothing else about the PIF: title, type, module, fixture and signature policy", () => {
    const pif = byKey.wwm_personal_information;
    expect(pif.title).toBe("Staff Personal Information Form");
    expect(pif.formType).toBe("personal_information");
    expect(pif.moduleKey).toBeNull();
    expect(pif.fixture).toBe("personal-information");
    // The required employee signature is neither relaxed nor waived.
    expect(pif.signaturePolicy).toEqual({
      slots: [{ key: "employee_signature", role: "employee", required: true, methods: ["drawn", "uploaded", "device"] }],
    });
  });

  it("keeps the Leave form's single supervisor stage — its signature workflow is the dedicated Leave workstream", () => {
    const leave = byKey.wwm_leave_application;
    expect(leave.stages).toHaveLength(1);
    expect(leave.stages[0]).toMatchObject({ stageOrder: 1, participant: "supervisor", resolver: "reporting_manager", signatureSlotKey: "approver_signature" });
    expect(leave.moduleKey).toBe("leave");
  });
});
