/**
 * Worldwide Word Ministries — STAFF PERSONAL INFORMATION FORM.
 *
 * Verbatim transcription of the official document (fixture:
 * src/test/fixtures/wwm-forms/personal-information.structure.json).
 * Authoritative employee data is bound read-only or prefilled from the
 * employee record; WWM-specific answers (spouse, ministry, office called to,
 * skills, languages, medical conditions, dependants) live in the submission.
 * Owner decisions applied: "Office Called To" allows several selections
 * (decision 5); dependants are a repeatable collection with the four official
 * printed rows as the minimum print height (decision 6).
 */
import type { FormDefinition } from "../../lib/formEngine/definition";
import type { StageInput } from "../../lib/formEngine/templates";

export const WWM_PERSONAL_INFORMATION_KEY = "wwm_personal_information";

export const wwmPersonalInformationDefinition: FormDefinition = {
  header: {
    logo: "organization",
    lines: ["WORLDWIDE WORD MINISTRIES", "STAFF PERSONAL INFORMATION FORM"],
  },
  intro: ["Please complete all sections. All information will be kept confidential."],
  sections: [
    {
      key: "personal_information",
      title: "SECTION A: PERSONAL INFORMATION",
      layout: "key_value",
      items: [
        { kind: "field", key: "full_name", label: "Full Name", type: "short_text", binding: { source: "employee", ref: "fullName", mode: "readonly" } },
        { kind: "field", sensitive: true, key: "date_of_birth", label: "Date of Birth", type: "date", binding: { source: "employee", ref: "dateOfBirth", mode: "readonly" } },
        { kind: "field", key: "gender", label: "Gender", type: "short_text", binding: { source: "employee", ref: "gender", mode: "readonly" } },
        { kind: "field", key: "marital_status", label: "Marital Status", type: "short_text", binding: { source: "employee", ref: "maritalStatus", mode: "prefill" } },
        { kind: "field", key: "nationality", label: "Nationality", type: "short_text", binding: { source: "employee", ref: "nationality", mode: "prefill" } },
        { kind: "field", key: "residential_address", label: "Residential Address", type: "long_text", binding: { source: "employee", ref: "residentialAddress", mode: "prefill" } },
        { kind: "field", key: "phone_number", label: "Phone Number", type: "phone", binding: { source: "employee", ref: "phoneNumber", mode: "prefill" } },
        { kind: "field", key: "email_address", label: "Email Address", type: "email", binding: { source: "employee", ref: "email", mode: "prefill" } },
        { kind: "field", key: "spouse_name", label: "Spouse's Name", type: "short_text" },
        { kind: "field", key: "spouse_employer", label: "Spouse's Employer", type: "short_text" },
        { kind: "field", key: "spouse_work_phone", label: "Spouse's Work Phone", type: "phone" },
      ],
    },
    {
      key: "church_ministry",
      title: "SECTION B: CHURCH & MINISTRY",
      layout: "key_value",
      items: [
        { kind: "field", key: "current_ministry_role", label: "Current Ministry Role", type: "short_text" },
        { kind: "field", key: "previous_ministry_experience", label: "Previous Ministry Experience", type: "long_text" },
      ],
    },
    {
      key: "office_called_to",
      title: "OFFICE CALLED TO: (For Clergy Only)",
      layout: "stack",
      items: [
        {
          kind: "choice_group",
          key: "office_called_to",
          mode: "multi",
          columns: 2,
          options: [
            { value: "apostle", label: "APOSTLE" },
            { value: "prophet", label: "PROPHET" },
            { value: "evangelist", label: "EVANGELIST" },
            { value: "pastor", label: "PASTOR" },
            { value: "teacher", label: "TEACHER" },
          ],
        },
      ],
    },
    {
      key: "education",
      title: "SECTION C: EDUCATION",
      layout: "key_value",
      items: [
        { kind: "field", key: "highest_qualification", label: "Highest Qualification", type: "short_text" },
        { kind: "field", key: "institution_attended", label: "Institution Attended", type: "short_text" },
      ],
    },
    {
      key: "employment_details",
      title: "SECTION D: EMPLOYMENT DETAILS",
      layout: "key_value",
      items: [
        { kind: "field", key: "date_of_first_appointment", label: "Date of First Appointment", type: "date", binding: { source: "employee", ref: "hireDate", mode: "prefill" } },
        { kind: "field", key: "position_on_first_appointment", label: "Position on First Appointment", type: "short_text" },
        { kind: "field", key: "date_of_current_position", label: "Date of Current Position", type: "date" },
        { kind: "field", key: "position_on_current_appointment", label: "Position on Current Appointment", type: "short_text", binding: { source: "position", ref: "title", mode: "prefill" } },
        { kind: "field", sensitive: true, key: "ghana_card_no", label: "Ghana Card No.", type: "short_text", binding: { source: "employee", ref: "nationalId", mode: "readonly" } },
        { kind: "field", sensitive: true, key: "ssnit_no", label: "Social Security (SSNIT) No.", type: "short_text", binding: { source: "statutory", ref: "ssnitNumber", mode: "readonly" } },
        { kind: "field", key: "employee_no", label: "Employee No.", type: "short_text", binding: { source: "employee", ref: "employeeNumber", mode: "readonly" } },
      ],
    },
    {
      key: "emergency_contact",
      title: "SECTION E: EMERGENCY CONTACT",
      layout: "key_value",
      items: [
        { kind: "field", key: "emergency_contact_name", label: "Contact Name", type: "short_text", binding: { source: "employee", ref: "emergencyContact.name", mode: "prefill" } },
        { kind: "field", key: "emergency_relationship", label: "Relationship", type: "short_text", binding: { source: "employee", ref: "emergencyContact.relationship", mode: "prefill" } },
        { kind: "field", key: "emergency_phone", label: "Phone Number", type: "phone", binding: { source: "employee", ref: "emergencyContact.phone", mode: "prefill" } },
        { kind: "field", key: "emergency_address", label: "Address", type: "long_text" },
      ],
    },
    {
      key: "dependent_information",
      title: "DEPENDENT INFORMATION",
      layout: "stack",
      items: [
        {
          kind: "table",
          key: "dependants",
          columns: [
            { key: "name", label: "Name(s) of Dependent(s)", type: "short_text" },
            { key: "relationship", label: "Relationship to Employee", type: "short_text" },
          ],
          printedRows: 4,
        },
      ],
    },
    {
      key: "additional_information",
      title: "SECTION F: ADDITIONAL INFORMATION",
      layout: "key_value",
      items: [
        { kind: "field", key: "skills_talents", label: "Skills & Talents", type: "long_text" },
        { kind: "field", key: "languages_spoken", label: "Languages Spoken", type: "short_text" },
        { kind: "field", sensitive: true, key: "medical_conditions", label: "Medical Conditions (if any)", type: "long_text" },
        { kind: "field", key: "other_information", label: "Any Other Relevant Information", type: "long_text" },
      ],
    },
    {
      key: "declaration",
      title: "DECLARATION",
      layout: "stack",
      items: [
        { kind: "note", text: "I confirm that the information provided above is accurate to the best of my knowledge.", style: "declaration" },
        { kind: "signature", key: "employee_signature", label: "Signature", role: "employee", dateLabel: "Date", required: true },
      ],
    },
  ],
};

/** The employee completes and signs; HR reviews and approves. */
export const wwmPersonalInformationStages: StageInput[] = [
  {
    stageOrder: 1,
    name: "HR review",
    participant: "hr",
    resolver: "permission_holder",
    resolverConfig: { permissionKey: "form.approve" },
    editableSectionKeys: [],
    allowedActions: ["approve", "return", "reject"],
  },
];
