/**
 * WS-7 (§6/§19 recon; Owner clarification S) — qualifications and
 * certifications only, never broader Learning/training history (course
 * enrollments, session attendance) — that stays out of scope, per the
 * frozen extraction's own classification.
 *
 * Reuses `addEmployeeQualification`/`addEmployeeCertification`
 * (lib/employeeSkillsQualifications.ts) directly — both already exist and
 * already accept exactly the fields a migration row supplies.
 * `qualificationTypeCode`/`certificationTypeCode` are free-text codes from
 * their respective Master Data domains, unvalidated against the domain's
 * item list — the exact same precedent `employee_documents.categoryCode`
 * and `employees.separationReason` already establish in this codebase, so
 * this adapter does not invent stricter validation the domain itself
 * doesn't enforce.
 */
import { addEmployeeQualification, addEmployeeCertification } from "../../employeeSkillsQualifications";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, optionalString, parseDate, toDate } from "../normalizeHelpers";
import { resolveEmployeeRef } from "../referenceResolution";

const QUALIFICATION_FIELDS: readonly CanonicalField[] = [
  { key: "employeeNumber", label: "Employee Number", required: true, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number"] },
  { key: "qualificationTypeCode", label: "Qualification Type", required: true, type: "string", aliases: ["Qualification Type", "Qualification"] },
  { key: "institution", label: "Institution", required: false, type: "string", aliases: ["Institution", "School"] },
  { key: "fieldOfStudy", label: "Field of Study", required: false, type: "string", aliases: ["Field of Study", "Major"] },
  { key: "startDate", label: "Start Date", required: false, type: "date", aliases: ["Start Date"] },
  { key: "endDate", label: "End Date", required: false, type: "date", aliases: ["End Date", "Completion Date"] },
  { key: "grade", label: "Grade", required: false, type: "string", aliases: ["Grade", "Classification"] },
];

export const qualificationAdapter: EntityAdapter = {
  entityType: "qualification",
  label: "Qualifications",
  dependsOn: ["employee"],
  // addEmployeeQualification writes via the global db.
  transactional: false,
  fields: QUALIFICATION_FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const employeeNumber = requiredString(raw.employeeNumber, "employeeNumber", "Employee Number", messages);
    const qualificationTypeCode = requiredString(raw.qualificationTypeCode, "qualificationTypeCode", "Qualification Type", messages);
    const institution = optionalString(raw.institution);
    const fieldOfStudy = optionalString(raw.fieldOfStudy);
    const startDate = parseDate(raw.startDate, "startDate", "Start Date", false, messages);
    const endDate = parseDate(raw.endDate, "endDate", "End Date", false, messages);
    const grade = optionalString(raw.grade);
    return { data: { employeeNumber, qualificationTypeCode, institution, fieldOfStudy, startDate, endDate, grade }, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, mode, data.employeeNumber as string);
    if (!employee.found) messages.push({ field: "employeeNumber", message: `Employee "${data.employeeNumber}" was not found`, severity: "error" });
    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, "execute", data.employeeNumber as string);
    if (!employee.found || employee.id == null) throw new Error(`Employee "${data.employeeNumber}" was not found`);

    const qualification = await addEmployeeQualification({
      organizationId: ctx.organizationId,
      employeeId: employee.id,
      qualificationTypeCode: data.qualificationTypeCode as string,
      institution: data.institution as string | null,
      fieldOfStudy: data.fieldOfStudy as string | null,
      startDate: toDate(data.startDate),
      endDate: toDate(data.endDate),
      grade: data.grade as string | null,
      actorApplicationUserId: ctx.actorApplicationUserId,
      actorMembershipId: ctx.actorMembershipId,
    });
    return { status: "created", resultId: qualification.id };
  },
};

const CERTIFICATION_FIELDS: readonly CanonicalField[] = [
  { key: "employeeNumber", label: "Employee Number", required: true, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number"] },
  { key: "certificationTypeCode", label: "Certification Type", required: true, type: "string", aliases: ["Certification Type", "Certification"] },
  { key: "issuingOrganization", label: "Issuing Organization", required: false, type: "string", aliases: ["Issuing Organization", "Issuer"] },
  { key: "issueDate", label: "Issue Date", required: false, type: "date", aliases: ["Issue Date"] },
  { key: "expiryDate", label: "Expiry Date", required: false, type: "date", aliases: ["Expiry Date", "Expiration Date"] },
  { key: "credentialId", label: "Credential ID", required: false, type: "string", aliases: ["Credential ID", "Certificate Number"] },
];

export const certificationAdapter: EntityAdapter = {
  entityType: "certification",
  label: "Certifications",
  dependsOn: ["employee"],
  // addEmployeeCertification writes via the global db.
  transactional: false,
  fields: CERTIFICATION_FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const employeeNumber = requiredString(raw.employeeNumber, "employeeNumber", "Employee Number", messages);
    const certificationTypeCode = requiredString(raw.certificationTypeCode, "certificationTypeCode", "Certification Type", messages);
    const issuingOrganization = optionalString(raw.issuingOrganization);
    const issueDate = parseDate(raw.issueDate, "issueDate", "Issue Date", false, messages);
    const expiryDate = parseDate(raw.expiryDate, "expiryDate", "Expiry Date", false, messages);
    const credentialId = optionalString(raw.credentialId);
    return { data: { employeeNumber, certificationTypeCode, issuingOrganization, issueDate, expiryDate, credentialId }, messages };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, mode, data.employeeNumber as string);
    if (!employee.found) messages.push({ field: "employeeNumber", message: `Employee "${data.employeeNumber}" was not found`, severity: "error" });
    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const employee = await resolveEmployeeRef(tx, ctx.organizationId, ctx.batchId, "execute", data.employeeNumber as string);
    if (!employee.found || employee.id == null) throw new Error(`Employee "${data.employeeNumber}" was not found`);

    const certification = await addEmployeeCertification({
      organizationId: ctx.organizationId,
      employeeId: employee.id,
      certificationTypeCode: data.certificationTypeCode as string,
      issuingOrganization: data.issuingOrganization as string | null,
      issueDate: toDate(data.issueDate),
      expiryDate: toDate(data.expiryDate),
      credentialId: data.credentialId as string | null,
      actorApplicationUserId: ctx.actorApplicationUserId,
      actorMembershipId: ctx.actorMembershipId,
    });
    return { status: "created", resultId: certification.id };
  },
};
