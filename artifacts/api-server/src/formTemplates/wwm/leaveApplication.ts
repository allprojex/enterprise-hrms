/**
 * Worldwide Word Ministries — EMPLOYEE LEAVE APPLICATION FORM.
 *
 * Verbatim transcription of the official document (fixture:
 * src/test/fixtures/wwm-forms/leave-application.structure.json). Wording,
 * section order, options and the 7-working-day note are the organization's;
 * nothing here is generic platform behaviour. This is DATA for organization
 * 3 — it is seeded through the governed template API, never referenced by a
 * reusable service.
 *
 * Owner decisions applied: leave types are exactly the six boxes plus the
 * "Other (specify)" line (decision 8); "Date of Resumption" is confirmed by
 * the approver, never computed from an invented policy (decision 7).
 */
import type { FormDefinition } from "../../lib/formEngine/definition";
import type { StageInput } from "../../lib/formEngine/templates";

export const WWM_LEAVE_APPLICATION_KEY = "wwm_leave_application";

export const wwmLeaveApplicationDefinition: FormDefinition = {
  header: {
    logo: "organization",
    lines: ["WORLDWIDE WORD MINISTRIES", "EMPLOYEE LEAVE APPLICATION FORM"],
  },
  sections: [
    {
      key: "employee_details",
      title: "EMPLOYEE DETAILS",
      layout: "grid",
      items: [
        { kind: "field", key: "employee_name", label: "Employee Name", type: "short_text", width: "half", binding: { source: "employee", ref: "fullName", mode: "readonly" } },
        { kind: "field", key: "department", label: "Department", type: "short_text", width: "half", binding: { source: "department", ref: "name", mode: "readonly" } },
      ],
    },
    {
      key: "leave_type",
      title: "TYPE OF LEAVE REQUESTED",
      layout: "stack",
      items: [
        {
          kind: "choice_group",
          key: "leave_type",
          mode: "single",
          required: true,
          columns: 3,
          options: [
            { value: "annual_leave", label: "Annual Leave" },
            { value: "sick_leave", label: "Sick Leave" },
            { value: "maternity_leave", label: "Maternity Leave" },
            { value: "paternity_leave", label: "Paternity Leave" },
            { value: "bereavement_leave", label: "Bereavement Leave" },
            { value: "leave_without_pay", label: "Leave Without Pay" },
          ],
          otherField: { key: "leave_type_other", label: "Other (specify)" },
        },
      ],
    },
    {
      key: "leave_period",
      title: "LEAVE PERIOD & CONTACT INFORMATION",
      layout: "grid",
      items: [
        { kind: "field", key: "from_date", label: "From", type: "date", required: true, width: "third" },
        { kind: "field", key: "to_date", label: "To", type: "date", required: true, width: "third" },
        { kind: "field", key: "days_requested", label: "No. of Days Requested", type: "number", required: true, width: "third" },
        { kind: "note", text: "Contact Information During Leave (can be an emergency contact)", style: "plain" },
        { kind: "field", key: "contact_phone", label: "Phone Number", type: "phone", width: "half" },
        { kind: "field", key: "contact_email", label: "Email Address", type: "email", width: "half" },
      ],
    },
    {
      key: "employee_declaration",
      title: "EMPLOYEE DECLARATION",
      layout: "stack",
      items: [{ kind: "signature", key: "employee_signature", label: "Employee Signature", role: "employee", dateLabel: "Date", required: true }],
    },
    {
      key: "approval",
      title: "APPROVAL SECTION - TO BE COMPLETED BY MANAGER / SUPERVISOR",
      layout: "grid",
      editableBy: ["supervisor", "department_head", "hr", "final_approver"],
      items: [
        {
          kind: "choice_group",
          key: "decision",
          mode: "single",
          columns: 2,
          options: [
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ],
        },
        { kind: "field", key: "approved_by", label: "Approved By", type: "short_text", width: "half" },
        { kind: "field", key: "date_approved", label: "Date Approved", type: "date", width: "half" },
        { kind: "signature", key: "approver_signature", label: "Signature", role: "supervisor" },
        { kind: "field", key: "days_remaining", label: "No. of Days Remaining", type: "number", width: "half" },
        { kind: "field", key: "date_of_resumption", label: "Date of Resumption", type: "date", width: "half" },
        { kind: "field", key: "rejection_reason", label: "(If Rejected) Reason for Rejection", type: "long_text", width: "full" },
      ],
    },
  ],
  footerNotes: ["NOTE: Please submit this form at least 7 working days prior to your planned leave date."],
};

/** Default routing for WWM: the employee fills and signs, the supervisor decides. Leave-engine delegation lands in WS-26C. */
export const wwmLeaveApplicationStages: StageInput[] = [
  {
    stageOrder: 1,
    name: "Manager / Supervisor approval",
    participant: "supervisor",
    resolver: "reporting_manager",
    editableSectionKeys: ["approval"],
    allowedActions: ["approve", "return", "reject"],
    signatureSlotKey: "approver_signature",
  },
];
