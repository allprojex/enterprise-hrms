/**
 * Skills & Qualifications (Phase 2A, W24): CRUD of an employee's own list of
 * skills, qualifications, and certifications — sourced from the existing
 * Master Data domains ("skill", "qualification_type", "certification_type",
 * W7). No skill-matching, gap analysis, or recruitment tie-in (Phase 3,
 * out of scope). Mirrors employeeDocuments.ts's shape: each sub-resource
 * gets its own list/add/update/remove, org-scoped, audit-logged.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  employeeSkillsTable,
  employeeQualificationsTable,
  employeeCertificationsTable,
  type EmployeeSkill,
  type EmployeeQualification,
  type EmployeeCertification,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class EmployeeSkillNotFoundError extends Error {
  constructor() {
    super("Skill not found");
    this.name = "EmployeeSkillNotFoundError";
  }
}

export class EmployeeQualificationNotFoundError extends Error {
  constructor() {
    super("Qualification not found");
    this.name = "EmployeeQualificationNotFoundError";
  }
}

export class EmployeeCertificationNotFoundError extends Error {
  constructor() {
    super("Certification not found");
    this.name = "EmployeeCertificationNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function listEmployeeSkills(organizationId: number, employeeId: number): Promise<EmployeeSkill[]> {
  return db
    .select()
    .from(employeeSkillsTable)
    .where(and(eq(employeeSkillsTable.organizationId, organizationId), eq(employeeSkillsTable.employeeId, employeeId)))
    .orderBy(desc(employeeSkillsTable.createdAt));
}

export async function addEmployeeSkill(params: {
  organizationId: number;
  employeeId: number;
  skillCode: string;
  proficiencyLevel?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeSkill> {
  const [skill] = await db
    .insert(employeeSkillsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      skillCode: params.skillCode,
      proficiencyLevel: params.proficiencyLevel ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.added",
    targetType: "employee",
    targetId: String(params.employeeId),
    afterState: { skillId: skill.id, skillCode: skill.skillCode, proficiencyLevel: skill.proficiencyLevel },
  });

  return skill;
}

async function findOwnEmployeeSkill(organizationId: number, employeeId: number, skillId: number) {
  const [row] = await db
    .select()
    .from(employeeSkillsTable)
    .where(
      and(
        eq(employeeSkillsTable.id, skillId),
        eq(employeeSkillsTable.organizationId, organizationId),
        eq(employeeSkillsTable.employeeId, employeeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateEmployeeSkill(params: {
  organizationId: number;
  employeeId: number;
  skillId: number;
  skillCode?: string;
  proficiencyLevel?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeSkill> {
  const before = await findOwnEmployeeSkill(params.organizationId, params.employeeId, params.skillId);
  if (!before) throw new EmployeeSkillNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.skillCode !== undefined) patch.skillCode = params.skillCode;
  if (params.proficiencyLevel !== undefined) patch.proficiencyLevel = params.proficiencyLevel;

  const [updated] = await db.update(employeeSkillsTable).set(patch).where(eq(employeeSkillsTable.id, params.skillId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.updated",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { skillCode: before.skillCode, proficiencyLevel: before.proficiencyLevel },
    afterState: { skillCode: updated.skillCode, proficiencyLevel: updated.proficiencyLevel },
  });

  return updated;
}

export async function removeEmployeeSkill(params: {
  organizationId: number;
  employeeId: number;
  skillId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const existing = await findOwnEmployeeSkill(params.organizationId, params.employeeId, params.skillId);
  if (!existing) throw new EmployeeSkillNotFoundError();

  await db.delete(employeeSkillsTable).where(eq(employeeSkillsTable.id, params.skillId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.removed",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { skillId: existing.id, skillCode: existing.skillCode },
  });
}

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------

export async function listEmployeeQualifications(organizationId: number, employeeId: number): Promise<EmployeeQualification[]> {
  return db
    .select()
    .from(employeeQualificationsTable)
    .where(and(eq(employeeQualificationsTable.organizationId, organizationId), eq(employeeQualificationsTable.employeeId, employeeId)))
    .orderBy(desc(employeeQualificationsTable.createdAt));
}

export async function addEmployeeQualification(params: {
  organizationId: number;
  employeeId: number;
  qualificationTypeCode: string;
  institution?: string | null;
  fieldOfStudy?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  grade?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeQualification> {
  const [qualification] = await db
    .insert(employeeQualificationsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      qualificationTypeCode: params.qualificationTypeCode,
      institution: params.institution ?? null,
      fieldOfStudy: params.fieldOfStudy ?? null,
      startDate: params.startDate ?? null,
      endDate: params.endDate ?? null,
      grade: params.grade ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_qualification.added",
    targetType: "employee",
    targetId: String(params.employeeId),
    afterState: { qualificationId: qualification.id, qualificationTypeCode: qualification.qualificationTypeCode },
  });

  return qualification;
}

async function findOwnEmployeeQualification(organizationId: number, employeeId: number, qualificationId: number) {
  const [row] = await db
    .select()
    .from(employeeQualificationsTable)
    .where(
      and(
        eq(employeeQualificationsTable.id, qualificationId),
        eq(employeeQualificationsTable.organizationId, organizationId),
        eq(employeeQualificationsTable.employeeId, employeeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateEmployeeQualification(params: {
  organizationId: number;
  employeeId: number;
  qualificationId: number;
  qualificationTypeCode?: string;
  institution?: string | null;
  fieldOfStudy?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  grade?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeQualification> {
  const before = await findOwnEmployeeQualification(params.organizationId, params.employeeId, params.qualificationId);
  if (!before) throw new EmployeeQualificationNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.qualificationTypeCode !== undefined) patch.qualificationTypeCode = params.qualificationTypeCode;
  if (params.institution !== undefined) patch.institution = params.institution;
  if (params.fieldOfStudy !== undefined) patch.fieldOfStudy = params.fieldOfStudy;
  if (params.startDate !== undefined) patch.startDate = params.startDate;
  if (params.endDate !== undefined) patch.endDate = params.endDate;
  if (params.grade !== undefined) patch.grade = params.grade;

  const [updated] = await db
    .update(employeeQualificationsTable)
    .set(patch)
    .where(eq(employeeQualificationsTable.id, params.qualificationId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_qualification.updated",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { qualificationTypeCode: before.qualificationTypeCode },
    afterState: { qualificationTypeCode: updated.qualificationTypeCode },
  });

  return updated;
}

export async function removeEmployeeQualification(params: {
  organizationId: number;
  employeeId: number;
  qualificationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const existing = await findOwnEmployeeQualification(params.organizationId, params.employeeId, params.qualificationId);
  if (!existing) throw new EmployeeQualificationNotFoundError();

  await db.delete(employeeQualificationsTable).where(eq(employeeQualificationsTable.id, params.qualificationId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_qualification.removed",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { qualificationId: existing.id, qualificationTypeCode: existing.qualificationTypeCode },
  });
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

export async function listEmployeeCertifications(organizationId: number, employeeId: number): Promise<EmployeeCertification[]> {
  return db
    .select()
    .from(employeeCertificationsTable)
    .where(and(eq(employeeCertificationsTable.organizationId, organizationId), eq(employeeCertificationsTable.employeeId, employeeId)))
    .orderBy(desc(employeeCertificationsTable.createdAt));
}

export async function addEmployeeCertification(params: {
  organizationId: number;
  employeeId: number;
  certificationTypeCode: string;
  issuingOrganization?: string | null;
  issueDate?: Date | null;
  expiryDate?: Date | null;
  credentialId?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeCertification> {
  const [certification] = await db
    .insert(employeeCertificationsTable)
    .values({
      organizationId: params.organizationId,
      employeeId: params.employeeId,
      certificationTypeCode: params.certificationTypeCode,
      issuingOrganization: params.issuingOrganization ?? null,
      issueDate: params.issueDate ?? null,
      expiryDate: params.expiryDate ?? null,
      credentialId: params.credentialId ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_certification.added",
    targetType: "employee",
    targetId: String(params.employeeId),
    afterState: { certificationId: certification.id, certificationTypeCode: certification.certificationTypeCode },
  });

  return certification;
}

async function findOwnEmployeeCertification(organizationId: number, employeeId: number, certificationId: number) {
  const [row] = await db
    .select()
    .from(employeeCertificationsTable)
    .where(
      and(
        eq(employeeCertificationsTable.id, certificationId),
        eq(employeeCertificationsTable.organizationId, organizationId),
        eq(employeeCertificationsTable.employeeId, employeeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateEmployeeCertification(params: {
  organizationId: number;
  employeeId: number;
  certificationId: number;
  certificationTypeCode?: string;
  issuingOrganization?: string | null;
  issueDate?: Date | null;
  expiryDate?: Date | null;
  credentialId?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeCertification> {
  const before = await findOwnEmployeeCertification(params.organizationId, params.employeeId, params.certificationId);
  if (!before) throw new EmployeeCertificationNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.certificationTypeCode !== undefined) patch.certificationTypeCode = params.certificationTypeCode;
  if (params.issuingOrganization !== undefined) patch.issuingOrganization = params.issuingOrganization;
  if (params.issueDate !== undefined) patch.issueDate = params.issueDate;
  if (params.expiryDate !== undefined) patch.expiryDate = params.expiryDate;
  if (params.credentialId !== undefined) patch.credentialId = params.credentialId;

  const [updated] = await db
    .update(employeeCertificationsTable)
    .set(patch)
    .where(eq(employeeCertificationsTable.id, params.certificationId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_certification.updated",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { certificationTypeCode: before.certificationTypeCode },
    afterState: { certificationTypeCode: updated.certificationTypeCode },
  });

  return updated;
}

export async function removeEmployeeCertification(params: {
  organizationId: number;
  employeeId: number;
  certificationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const existing = await findOwnEmployeeCertification(params.organizationId, params.employeeId, params.certificationId);
  if (!existing) throw new EmployeeCertificationNotFoundError();

  await db.delete(employeeCertificationsTable).where(eq(employeeCertificationsTable.id, params.certificationId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_certification.removed",
    targetType: "employee",
    targetId: String(params.employeeId),
    beforeState: { certificationId: existing.id, certificationTypeCode: existing.certificationTypeCode },
  });
}
