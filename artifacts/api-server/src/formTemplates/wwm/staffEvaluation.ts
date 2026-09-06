/**
 * Worldwide Word Ministries — STAFF EVALUATION FORM.
 *
 * Verbatim transcription of the official document (fixture:
 * src/test/fixtures/wwm-forms/staff-evaluation.structure.json), including the
 * rating-scale sentence, the ten criteria of Sections B and D with their
 * descriptions, and the recommendation boxes. Owner decisions applied: each
 * goal carries exactly one 5–1 rating (decision 2); the four recommendation
 * boxes are two independent exclusive pairs (decision 3). Totals are plain
 * sums of the ratings given; no threshold or interpretation is attached.
 */
import type { FormDefinition, MatrixRow, RatingColumn } from "../../lib/formEngine/definition";
import type { StageInput } from "../../lib/formEngine/templates";

export const WWM_STAFF_EVALUATION_KEY = "wwm_staff_evaluation";

const RATING_COLUMNS: RatingColumn[] = [
  { value: 5, label: "5" },
  { value: 4, label: "4" },
  { value: 3, label: "3" },
  { value: 2, label: "2" },
  { value: 1, label: "1" },
];

const RATING_SCALE_TEXT =
  "Rating Scale: 5. Outstanding 4. Excellent—exceeds requirements 3. Competent—acceptable proficiency 2. Below Average—Does not meet requirements 1. Unable to determine / not applicable";

const CRITERIA: MatrixRow[] = [
  { key: "attitude", label: "Staff attitude towards work: Overall assessment of staff attitude toward work." },
  { key: "skill_improvement", label: "Improvement of Skill: Assess staff improvement on the job in terms of skill and willingness to learn." },
  { key: "timelines", label: "Timelines: Overall assessment of staff ability to meet deadlines." },
  { key: "achievements", label: "Achievements: Assess staff achievement for the season of assessment." },
  { key: "professional_impression", label: "Professional Impression: Consider self-confidence, maturity, and presence to assess the staff level of professionalism." },
  { key: "motivation", label: "Motivation/Initiative: Analyze staff ability to think and act independently, and goal orientation." },
  { key: "communication", label: "Interpersonal/Communication Skills: Assess staff ability to express ideas and thoughts clearly, as well as experiences involving teamwork." },
  { key: "cost_consciousness", label: "Cost Cutting Consciousness: Assess staff attitude toward cost cutting." },
  { key: "flexibility", label: "Flexibility: Assess staff responsiveness to change, tolerance for ambiguity." },
  { key: "organizational_fit", label: "Organizational Fit: Review the staff potential to fit the unique assignment of Worldwide Word Ministry." },
];

const GOAL_ROWS = [
  { key: "goal_1", label: "Goal 1" },
  { key: "goal_2", label: "Goal 2" },
  { key: "goal_3", label: "Goal 3" },
];

export const wwmStaffEvaluationDefinition: FormDefinition = {
  header: {
    logo: "organization",
    lines: ["WORLDWIDE WORD MINISTRIES", "Mailing Address: Box AN11908", "STAFF EVALUATION FORM"],
  },
  sections: [
    {
      key: "staff_details",
      layout: "grid",
      items: [
        { kind: "field", key: "staff_name", label: "Staff Name", type: "short_text", width: "half", binding: { source: "employee", ref: "fullName", mode: "readonly" } },
        { kind: "field", key: "position", label: "Position", type: "short_text", width: "half", binding: { source: "position", ref: "title", mode: "readonly" } },
        { kind: "field", key: "department", label: "Department", type: "short_text", width: "half", binding: { source: "department", ref: "name", mode: "readonly" } },
        { kind: "field", key: "review_period", label: "Review Period", type: "short_text", width: "half", required: true },
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
      key: "section_a",
      title: "SECTION A — Half-Year Goals(January-June)",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        {
          kind: "rated_table",
          key: "half_year_goals",
          textColumns: [
            { key: "description", label: "Goals Description", type: "long_text" },
            { key: "actions", label: "Specific Actions", type: "long_text" },
          ],
          ratingHeader: "Ratings",
          ratingColumns: RATING_COLUMNS,
          rows: GOAL_ROWS,
          printedLinesPerRow: 3,
          total: { key: "half_year_goals_total", label: "Total Ratings (Half Year)" },
        },
      ],
    },
    {
      key: "section_b",
      title: "SECTION B- Half-Year Ratings",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        {
          kind: "matrix",
          key: "half_year_ratings",
          scaleText: RATING_SCALE_TEXT,
          criteriaHeader: "Criteria",
          columns: RATING_COLUMNS,
          rows: CRITERIA,
          total: { key: "half_year_ratings_total", label: "Total Ratings (Half Year)" },
        },
      ],
    },
    {
      key: "section_c",
      title: "SECTION C — Full-Year Goals(July-December)",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        {
          kind: "rated_table",
          key: "full_year_goals",
          textColumns: [
            { key: "description", label: "Goals Description", type: "long_text" },
            { key: "actions", label: "Specific Actions", type: "long_text" },
          ],
          ratingHeader: "Ratings",
          ratingColumns: RATING_COLUMNS,
          rows: GOAL_ROWS,
          printedLinesPerRow: 3,
          total: { key: "full_year_goals_total", label: "Total Ratings (Full Year)" },
        },
      ],
    },
    {
      key: "section_d",
      title: "SECTION D – Full Year Evaluation",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        {
          kind: "matrix",
          key: "full_year_ratings",
          scaleText: RATING_SCALE_TEXT,
          criteriaHeader: "Criteria",
          columns: RATING_COLUMNS,
          rows: CRITERIA,
          total: { key: "full_year_ratings_total", label: "Total Ratings (Full Year)" },
        },
      ],
    },
    {
      key: "assessment",
      layout: "grid",
      editableBy: ["assessor"],
      items: [
        { kind: "field", key: "assessed_by", label: "Assessed by", type: "short_text", width: "half", binding: { source: "reporting_manager", ref: "fullName", mode: "prefill" } },
        { kind: "field", key: "assessor_position", label: "Position", type: "short_text", width: "half", binding: { source: "reporting_manager", ref: "positionTitle", mode: "prefill" } },
        {
          kind: "field",
          key: "comments",
          label: "Comments",
          type: "long_text",
          width: "full",
          helpText: "(Please summarize your perceptions of the staff strengths and any concerns that should be considered)",
        },
      ],
    },
    {
      key: "recommendation",
      title: "Recommendation:",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        {
          kind: "choice_group",
          key: "recommendation",
          mode: "multi",
          columns: 4,
          options: [
            { value: "not_recommended_higher_position", label: "Not recommended for higher position" },
            { value: "recommended_higher_position", label: "Recommended for higher position" },
            { value: "recommended_salary_increment", label: "Recommended for salary increment" },
            { value: "not_recommended_salary_increment", label: "Not recommended for salary increment" },
          ],
          exclusivePairs: [
            ["recommended_higher_position", "not_recommended_higher_position"],
            ["recommended_salary_increment", "not_recommended_salary_increment"],
          ],
        },
      ],
    },
    {
      key: "summary",
      title: "Summary",
      layout: "stack",
      editableBy: ["assessor"],
      items: [
        { kind: "field", key: "overall_objectives", label: "Overall Objectives", type: "long_text", helpText: "Summarize the overarching objectives these goals aim to achieve." },
        { kind: "field", key: "support_needed", label: "Support Needed", type: "long_text", helpText: "Identify any resources or support needed from management or colleagues to accomplish these goals." },
        { kind: "field", key: "review_mechanisms", label: "Review Mechanisms", type: "long_text", helpText: "Indicate how and when progress will be reviewed (e.g., monthly check-ins)." },
      ],
    },
    {
      key: "employee_comments",
      layout: "stack",
      editableBy: ["employee"],
      items: [{ kind: "field", key: "employee_comments", label: "Employee Comments", type: "long_text" }],
    },
    {
      key: "supervisor_comments",
      layout: "stack",
      editableBy: ["assessor"],
      items: [{ kind: "field", key: "supervisor_comments", label: "Supervisor Comments", type: "long_text" }],
    },
  ],
};

/** Assessor (reporting manager) rates → employee comments → HR finalizes. */
export const wwmStaffEvaluationStages: StageInput[] = [
  {
    stageOrder: 1,
    name: "Assessor evaluation",
    participant: "assessor",
    resolver: "reporting_manager",
    editableSectionKeys: ["section_a", "section_b", "section_c", "section_d", "assessment", "recommendation", "summary", "supervisor_comments"],
    allowedActions: ["complete"],
  },
  {
    stageOrder: 2,
    name: "Employee comments",
    participant: "employee",
    resolver: "subject_employee",
    editableSectionKeys: ["employee_comments"],
    allowedActions: ["complete"],
  },
  {
    stageOrder: 3,
    name: "HR review",
    participant: "hr",
    resolver: "permission_holder",
    resolverConfig: { permissionKey: "form.approve" },
    editableSectionKeys: [],
    allowedActions: ["approve", "return", "reject"],
  },
];
