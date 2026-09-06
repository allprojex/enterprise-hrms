/**
 * Worldwide Word Ministries — STAFF PROBATIONARY ASSESSMENT FORM.
 *
 * Verbatim transcription of the official document (fixture:
 * src/test/fixtures/wwm-forms/probationary-assessment.structure.json). The
 * official page repeats the 5–1 column header once before "Organizational
 * Fit"; that repetition is reproduced. Owner decisions applied: "Overall
 * Evaluation" is a comments prompt, not a rated criterion, and TOTAL RATINGS
 * sums only the numeric criteria (decision 4); the recommendation is an
 * explicit decision by the final approver and drives no confirmation
 * automatically (brief §12).
 */
import type { FormDefinition, RatingColumn } from "../../lib/formEngine/definition";
import type { StageInput } from "../../lib/formEngine/templates";

export const WWM_PROBATIONARY_ASSESSMENT_KEY = "wwm_probationary_assessment";

const RATING_COLUMNS: RatingColumn[] = [
  { value: 5, label: "5" },
  { value: 4, label: "4" },
  { value: 3, label: "3" },
  { value: 2, label: "2" },
  { value: 1, label: "1" },
];

export const wwmProbationaryAssessmentDefinition: FormDefinition = {
  header: {
    logo: "organization",
    lines: ["WORLDWIDE WORD MINISTRIES", "STAFF PROBATIONARY ASSESSMENT FORM", "Mailing address: Box AN11908"],
  },
  sections: [
    {
      key: "staff_details",
      layout: "grid",
      items: [
        { kind: "field", key: "staff_name", label: "Staff Name", type: "short_text", width: "half", binding: { source: "employee", ref: "fullName", mode: "readonly" } },
        { kind: "field", key: "position", label: "Position", type: "short_text", width: "half", binding: { source: "position", ref: "title", mode: "readonly" } },
      ],
    },
    {
      key: "instruction",
      layout: "stack",
      items: [
        {
          kind: "note",
          style: "instruction",
          text: "Please use this form as a guide to evaluate staff performance for the season. Check the appropriate numeric value corresponding to the staff level of performance and provide appropriate comments in the space below.",
        },
      ],
    },
    {
      key: "assessment",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        {
          kind: "matrix",
          key: "ratings",
          scaleText:
            "Rating Scale: 5. Outstanding 4. Excellent—exceeds requirements 3. Competent—acceptable proficiency 2. Below Average—Does not meet requirements 1. Unable to determine or not applicable to this staff",
          ratingHeader: "Rating",
          columns: RATING_COLUMNS,
          rows: [
            { key: "attitude", label: "Staff attitude towards work: Overall assessment of staff attitude toward work." },
            { key: "skill_improvement", label: "Improvement of skill: Assess staff improvement on the job in terms of skill and willingness to learn on the job." },
            { key: "time_lines", label: "Time Lines: Overall assessment of staff ability to meet deadlines." },
            { key: "achievements", label: "Achievements: Assess staff achievement for the season of assessment." },
            { key: "professional_impression", label: "Professional Impression: Consider self-confidence, maturity, and presence to assess the staff level of professionalism." },
            { key: "motivation", label: "Motivation/Initiative: Analyze staff ability to think and act independently, and goal orientation." },
            { key: "communication", label: "Interpersonal/Communication Skills: Assess staff ability to express ideas and thoughts clearly, as well as experiences involving teamwork." },
            { key: "cost_consciousness", label: "Cost Cutting Consciousness: Assess staff attitude toward cost cutting." },
            { key: "flexibility", label: "Flexibility: Assess staff responsiveness to change, tolerance for ambiguity." },
            { key: "responsiveness_to_change", label: "Responsiveness to Change: Staff adaptability to new trends." },
            { key: "organizational_fit", label: "Organizational Fit: Review the staff potential to fit the unique assignment of Worldwide Word Ministry.", repeatHeaderBefore: true },
            { key: "overall_evaluation", label: "Overall Evaluation: Please add appropriate comments below:", rated: false },
          ],
          total: { key: "total_ratings", label: "TOTAL RATINGS" },
        },
      ],
    },
    {
      key: "probationer_comments",
      title: "Comments (Probationer Staff:",
      layout: "stack",
      editableBy: ["employee"],
      items: [{ kind: "field", key: "probationer_comments", label: "", type: "long_text" }],
    },
    {
      key: "assessor_comments",
      title: "Comments (Please summarize your perceptions of the staff strengths and any concerns that should be considered:",
      layout: "stack",
      editableBy: ["assessor"],
      items: [{ kind: "field", key: "assessor_comments", label: "", type: "long_text" }],
    },
    {
      key: "recommendation",
      title: "RECOMMENDATION",
      layout: "stack",
      editableBy: ["final_approver"],
      items: [
        {
          kind: "choice_group",
          key: "recommendation",
          mode: "single",
          columns: 3,
          options: [
            { value: "staff_confirmed", label: "Staff Confirmed" },
            { value: "staff_not_confirmed", label: "Staff Not Confirmed" },
            { value: "confirmation_extended", label: "Confirmation Extended" },
          ],
        },
      ],
    },
    {
      key: "assessed_by",
      layout: "grid",
      editableBy: ["assessor"],
      items: [
        { kind: "field", key: "assessed_by", label: "Assessed by", type: "short_text", width: "third", binding: { source: "reporting_manager", ref: "fullName", mode: "prefill" } },
        { kind: "field", key: "assessor_position", label: "Position", type: "short_text", width: "third", binding: { source: "reporting_manager", ref: "positionTitle", mode: "prefill" } },
        { kind: "field", key: "assessment_date", label: "Date", type: "date", width: "third" },
      ],
    },
  ],
};

/** Assessor rates → probationer comments → final approver records the recommendation → HR finalizes. */
export const wwmProbationaryAssessmentStages: StageInput[] = [
  {
    stageOrder: 1,
    name: "Assessor rating",
    participant: "assessor",
    resolver: "reporting_manager",
    editableSectionKeys: ["assessment", "assessor_comments", "assessed_by"],
    allowedActions: ["complete"],
  },
  {
    stageOrder: 2,
    name: "Probationer comments",
    participant: "employee",
    resolver: "subject_employee",
    editableSectionKeys: ["probationer_comments"],
    allowedActions: ["complete"],
  },
  {
    stageOrder: 3,
    name: "Recommendation",
    participant: "final_approver",
    resolver: "permission_holder",
    resolverConfig: { permissionKey: "form.approve" },
    editableSectionKeys: ["recommendation"],
    allowedActions: ["approve", "return", "reject"],
  },
];
