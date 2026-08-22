/**
 * Employee Self-Service (Phase 2B, W39): resolves "which employee is me" via
 * W14's employee_user_links (reusing W33's resolveOwnEmployeeId, never a
 * client-supplied employee ID) and shapes a deliberately restricted
 * self-view DTO — not the full HR administrator Employee shape formatted by
 * routes/employees.ts's formatEmployee. Excludes notes (employee.notes.read
 * is an HR-only permission, never granted through self-service), nationalId/
 * passportNumber (sensitive identifiers with no self-service read need),
 * linkedApplicationUserId/createdBy/updatedBy/createdAt/updatedAt (internal
 * bookkeeping), and organizationId (redundant — the caller already knows
 * their own active organization).
 */
import { eq } from "drizzle-orm";
import {
  db,
  departmentsTable,
  branchesTable,
  positionsTable,
  employeesTable,
  type EmploymentPeriod,
  type EmployeeSkill,
  type EmployeeQualification,
  type EmployeeCertification,
} from "@workspace/db";
import { getEmployeeById } from "./employees";
import { resolveOwnEmployeeId } from "./leaveRequests";
import { listEmploymentPeriods } from "./employmentLifecycleService";
import { listEmployeeSkills, listEmployeeQualifications, listEmployeeCertifications } from "./employeeSkillsQualifications";

export interface SelfServiceEmployeeProfile {
  id: number;
  employeeNumber: string | null;
  hasProfilePicture: boolean;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  maritalStatus: string | null;
  nationality: string | null;
  personalEmail: string | null;
  workEmail: string | null;
  phoneNumber: string | null;
  alternatePhoneNumber: string | null;
  residentialAddress: unknown;
  emergencyContacts: unknown;
  departmentId: number | null;
  departmentName: string | null;
  branchId: number | null;
  branchName: string | null;
  positionId: number | null;
  positionName: string | null;
  reportingManagerId: number | null;
  reportingManagerName: string | null;
  employmentType: string | null;
  hireDate: Date | null;
  probationEndDate: Date | null;
  employmentStatus: string;
  workLocation: string | null;
  separationDate: Date | null;
  separationReason: string | null;
}

/**
 * Resolves the caller's own linked employee, restricted-DTO shaped, scoped
 * to `organizationId` (the caller's currently active organization — never a
 * client-supplied one). Returns null when unlinked (or the link's employee
 * doesn't belong to this organization) — never 404/500; the caller decides
 * how to render that as a safe "not linked" state.
 */
export async function resolveOwnEmployeeProfile(
  organizationId: number,
  applicationUserId: number,
): Promise<SelfServiceEmployeeProfile | null> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) return null;

  const employee = await getEmployeeById(organizationId, employeeId);
  if (!employee) return null;

  const [departments, branches, positions, managers] = await Promise.all([
    employee.departmentId
      ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(eq(departmentsTable.id, employee.departmentId))
      : Promise.resolve([]),
    employee.branchId
      ? db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable).where(eq(branchesTable.id, employee.branchId))
      : Promise.resolve([]),
    employee.positionId
      ? db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(eq(positionsTable.id, employee.positionId))
      : Promise.resolve([]),
    employee.reportingManagerId
      ? db
          .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
          .from(employeesTable)
          .where(eq(employeesTable.id, employee.reportingManagerId))
      : Promise.resolve([]),
  ]);

  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    hasProfilePicture: employee.profilePictureKey != null,
    firstName: employee.firstName,
    middleName: employee.middleName,
    lastName: employee.lastName,
    preferredName: employee.preferredName,
    gender: employee.gender,
    dateOfBirth: employee.dateOfBirth,
    maritalStatus: employee.maritalStatus,
    nationality: employee.nationality,
    personalEmail: employee.personalEmail,
    workEmail: employee.workEmail,
    phoneNumber: employee.phoneNumber,
    alternatePhoneNumber: employee.alternatePhoneNumber,
    residentialAddress: employee.residentialAddress,
    emergencyContacts: employee.emergencyContacts,
    departmentId: employee.departmentId,
    departmentName: departments[0]?.name ?? null,
    branchId: employee.branchId,
    branchName: branches[0]?.name ?? null,
    positionId: employee.positionId,
    positionName: positions[0]?.title ?? null,
    reportingManagerId: employee.reportingManagerId,
    reportingManagerName: managers[0] ? `${managers[0].firstName} ${managers[0].lastName}` : null,
    employmentType: employee.employmentType,
    hireDate: employee.hireDate,
    probationEndDate: employee.probationEndDate,
    employmentStatus: employee.employmentStatus,
    workLocation: employee.workLocation,
    separationDate: employee.separationDate,
    separationReason: employee.separationReason,
  };
}

export interface SelfServiceEmploymentPeriod {
  id: number;
  eventType: string;
  effectiveDate: Date;
  previousState: unknown;
  newState: unknown;
  createdAt: Date;
}

export interface SelfServiceEmploymentHistory {
  linked: boolean;
  items: SelfServiceEmploymentPeriod[];
}

function toSelfServiceEmploymentPeriod(period: EmploymentPeriod): SelfServiceEmploymentPeriod {
  return {
    id: period.id,
    eventType: period.eventType,
    effectiveDate: period.effectiveDate,
    previousState: period.previousState,
    newState: period.newState,
    createdAt: period.createdAt,
  };
}

/**
 * Phase 3F, W105: the caller's own internal employment history (transfer/
 * promotion/confirmation events), reusing W22's `listEmploymentPeriods`
 * verbatim — no second history engine, no new table. Own employee id is
 * always server-resolved via the same `resolveOwnEmployeeId` GET /me/employee
 * already uses — never a client-supplied employeeId. `linked: false` (with
 * `items: []`) mirrors GET /me/employee's own intentional not-linked state,
 * not an error. Rows are returned exactly as stored — no denormalized
 * department/branch/position *names* are resolved here, since
 * `previousState`/`newState` only ever snapshot ids, and joining those ids to
 * their *current* name would silently replace historical meaning with
 * present-day meaning (the exact behavior the frozen plan's own historical-
 * integrity requirement forbids).
 */
export async function resolveOwnEmploymentHistory(
  organizationId: number,
  applicationUserId: number,
): Promise<SelfServiceEmploymentHistory> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) return { linked: false, items: [] };

  const periods = await listEmploymentPeriods(organizationId, employeeId);
  return { linked: true, items: periods.map(toSelfServiceEmploymentPeriod) };
}

// -----------------------------------------------------------------------------
// Career Profile: Skills / Qualifications / Certifications (Phase 3F, W106)
// -----------------------------------------------------------------------------
// All three follow the identical {linked, items} shape resolveOwnEmploymentHistory
// (W105) already established, and reuse the existing HR-side list functions
// from lib/employeeSkillsQualifications.ts verbatim — no second business
// engine. Each DTO excludes organizationId/employeeId (redundant — the
// caller already knows their own identity) and createdBy (internal
// bookkeeping, a raw user id with no self-service read need), matching the
// same restriction discipline SelfServiceEmployeeProfile's own file header
// already documents. Certification expiry status is deliberately NOT
// computed here — My Learning's own established convention (see
// employee-self-service.tsx's own isCertificateExpired) computes "expired"
// live, client-side, from the raw date, never as a value the API returns;
// Career Profile's own Certifications section follows that exact precedent.

export interface SelfServiceSkill {
  id: number;
  skillCode: string;
  proficiencyLevel: string | null;
  createdAt: Date;
}

export interface SelfServiceSkillsList {
  linked: boolean;
  items: SelfServiceSkill[];
}

function toSelfServiceSkill(skill: EmployeeSkill): SelfServiceSkill {
  return { id: skill.id, skillCode: skill.skillCode, proficiencyLevel: skill.proficiencyLevel, createdAt: skill.createdAt };
}

/** Phase 3F, W106: the caller's own skills — reuses W24's listEmployeeSkills verbatim. */
export async function resolveOwnSkills(organizationId: number, applicationUserId: number): Promise<SelfServiceSkillsList> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) return { linked: false, items: [] };

  const skills = await listEmployeeSkills(organizationId, employeeId);
  return { linked: true, items: skills.map(toSelfServiceSkill) };
}

export interface SelfServiceQualification {
  id: number;
  qualificationTypeCode: string;
  institution: string | null;
  fieldOfStudy: string | null;
  startDate: Date | null;
  endDate: Date | null;
  grade: string | null;
  createdAt: Date;
}

export interface SelfServiceQualificationsList {
  linked: boolean;
  items: SelfServiceQualification[];
}

function toSelfServiceQualification(qualification: EmployeeQualification): SelfServiceQualification {
  return {
    id: qualification.id,
    qualificationTypeCode: qualification.qualificationTypeCode,
    institution: qualification.institution,
    fieldOfStudy: qualification.fieldOfStudy,
    startDate: qualification.startDate,
    endDate: qualification.endDate,
    grade: qualification.grade,
    createdAt: qualification.createdAt,
  };
}

/** Phase 3F, W106: the caller's own qualifications — reuses W24's listEmployeeQualifications verbatim. */
export async function resolveOwnQualifications(organizationId: number, applicationUserId: number): Promise<SelfServiceQualificationsList> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) return { linked: false, items: [] };

  const qualifications = await listEmployeeQualifications(organizationId, employeeId);
  return { linked: true, items: qualifications.map(toSelfServiceQualification) };
}

export interface SelfServiceCertification {
  id: number;
  certificationTypeCode: string;
  issuingOrganization: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  credentialId: string | null;
  createdAt: Date;
}

export interface SelfServiceCertificationsList {
  linked: boolean;
  items: SelfServiceCertification[];
}

function toSelfServiceCertification(certification: EmployeeCertification): SelfServiceCertification {
  return {
    id: certification.id,
    certificationTypeCode: certification.certificationTypeCode,
    issuingOrganization: certification.issuingOrganization,
    issueDate: certification.issueDate,
    expiryDate: certification.expiryDate,
    credentialId: certification.credentialId,
    createdAt: certification.createdAt,
  };
}

/**
 * Phase 3F, W106: the caller's own EXTERNAL/HR-maintained certifications
 * (employee_certifications) — reuses W24's listEmployeeCertifications
 * verbatim. Deliberately never reads learning_certificates (Learning's own
 * frozen Owner Decision 3 keeps the two tables permanently unmerged) — that
 * remains My Learning's own exclusive surface. Expired records are never
 * filtered out here; the caller decides how to render an expiry label.
 */
export async function resolveOwnCertifications(organizationId: number, applicationUserId: number): Promise<SelfServiceCertificationsList> {
  const employeeId = await resolveOwnEmployeeId(organizationId, applicationUserId);
  if (employeeId == null) return { linked: false, items: [] };

  const certifications = await listEmployeeCertifications(organizationId, employeeId);
  return { linked: true, items: certifications.map(toSelfServiceCertification) };
}
