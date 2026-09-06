/**
 * The four Worldwide Word Ministries templates (organization id 3 in
 * Production) as DATA. They are seeded into an organization through the
 * governed template service by an explicit, audited act — never on boot,
 * never into Production by this workstream (brief §23) — and referenced by
 * the fidelity tests. No reusable service imports this module.
 */
import type { FormDefinition } from "../../lib/formEngine/definition";
import type { StageInput } from "../../lib/formEngine/templates";
import type { FormTemplateType } from "@workspace/db";
import { WWM_LEAVE_APPLICATION_KEY, wwmLeaveApplicationDefinition, wwmLeaveApplicationStages } from "./leaveApplication";
import { WWM_PERSONAL_INFORMATION_KEY, wwmPersonalInformationDefinition, wwmPersonalInformationStages } from "./personalInformation";
import { WWM_STAFF_EVALUATION_KEY, wwmStaffEvaluationDefinition, wwmStaffEvaluationStages } from "./staffEvaluation";
import { WWM_PROBATIONARY_ASSESSMENT_KEY, wwmProbationaryAssessmentDefinition, wwmProbationaryAssessmentStages } from "./probationaryAssessment";

export interface WwmTemplateSeed {
  templateKey: string;
  formType: FormTemplateType;
  moduleKey: string | null;
  title: string;
  description: string;
  fixture: string;
  definition: FormDefinition;
  stages: StageInput[];
}

export const WWM_FORM_TEMPLATES: readonly WwmTemplateSeed[] = [
  {
    templateKey: WWM_LEAVE_APPLICATION_KEY,
    formType: "leave_application",
    moduleKey: "leave",
    title: "Employee Leave Application Form",
    description: "Official WWM leave application form.",
    fixture: "leave-application",
    definition: wwmLeaveApplicationDefinition,
    stages: wwmLeaveApplicationStages,
  },
  {
    templateKey: WWM_PERSONAL_INFORMATION_KEY,
    formType: "personal_information",
    moduleKey: null,
    title: "Staff Personal Information Form",
    description: "Official WWM staff personal information form (PIF).",
    fixture: "personal-information",
    definition: wwmPersonalInformationDefinition,
    stages: wwmPersonalInformationStages,
  },
  {
    templateKey: WWM_STAFF_EVALUATION_KEY,
    formType: "staff_evaluation",
    moduleKey: "performance",
    title: "Staff Evaluation Form",
    description: "Official WWM staff evaluation form.",
    fixture: "staff-evaluation",
    definition: wwmStaffEvaluationDefinition,
    stages: wwmStaffEvaluationStages,
  },
  {
    templateKey: WWM_PROBATIONARY_ASSESSMENT_KEY,
    formType: "probationary_assessment",
    moduleKey: null,
    title: "Staff Probationary Assessment Form",
    description: "Official WWM staff probationary assessment form.",
    fixture: "probationary-assessment",
    definition: wwmProbationaryAssessmentDefinition,
    stages: wwmProbationaryAssessmentStages,
  },
];
