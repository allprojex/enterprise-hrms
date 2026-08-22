import { Router } from "express";
import {
  AddEmployeeSkillBody,
  UpdateEmployeeSkillBody,
  AddEmployeeQualificationBody,
  UpdateEmployeeQualificationBody,
  AddEmployeeCertificationBody,
  UpdateEmployeeCertificationBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getEmployeeById } from "../lib/employees";
import {
  listEmployeeSkills,
  addEmployeeSkill,
  updateEmployeeSkill,
  removeEmployeeSkill,
  EmployeeSkillNotFoundError,
  listEmployeeQualifications,
  addEmployeeQualification,
  updateEmployeeQualification,
  removeEmployeeQualification,
  EmployeeQualificationNotFoundError,
  listEmployeeCertifications,
  addEmployeeCertification,
  updateEmployeeCertification,
  removeEmployeeCertification,
  EmployeeCertificationNotFoundError,
} from "../lib/employeeSkillsQualifications";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

async function requireEmployee(req: MembershipRequest, res: import("express").Response, employeeId: number) {
  if (isNaN(employeeId)) {
    res.status(400).json({ error: "Invalid employee ID" });
    return null;
  }
  const employee = await getEmployeeById(req.membership!.organizationId, employeeId);
  if (!employee) {
    res.status(404).json({ error: "Employee not found" });
    return null;
  }
  return employee;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

// Phase 3F, W105: gated on employee.write, not employee.read — this is an
// HR-administration route (org-wide, any employeeId), not an own-scope
// employee-facing read; the employee role holds employee.read but not
// employee.write, so this closes a genuine pre-existing gap (an ordinary
// employee could otherwise GET any coworker's skills through this route).
// An employee's own read access is served separately by GET /me/skills
// (W106), which is own-scoped and server-derived, never permission-gated
// the same way an HR-administration route is.
router.get(
  "/organizations/:organizationId/employees/:employeeId/skills",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const skills = await listEmployeeSkills(req.membership!.organizationId, employeeId);
    res.json(skills);
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/skills",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const parsed = AddEmployeeSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const skill = await addEmployeeSkill({
      organizationId: req.membership!.organizationId,
      employeeId,
      skillCode: parsed.data.skillCode,
      proficiencyLevel: parsed.data.proficiencyLevel,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(201).json(skill);
  },
);

router.patch(
  "/organizations/:organizationId/employees/:employeeId/skills/:skillId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const skillId = parseId(req.params.skillId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(skillId)) {
      res.status(400).json({ error: "Invalid skill ID" });
      return;
    }

    const parsed = UpdateEmployeeSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateEmployeeSkill({
        organizationId: req.membership!.organizationId,
        employeeId,
        skillId,
        skillCode: parsed.data.skillCode,
        proficiencyLevel: parsed.data.proficiencyLevel,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof EmployeeSkillNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/organizations/:organizationId/employees/:employeeId/skills/:skillId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const skillId = parseId(req.params.skillId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(skillId)) {
      res.status(400).json({ error: "Invalid skill ID" });
      return;
    }

    try {
      await removeEmployeeSkill({
        organizationId: req.membership!.organizationId,
        employeeId,
        skillId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ message: "Skill removed" });
    } catch (err) {
      if (err instanceof EmployeeSkillNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------

// Phase 3F, W105: gated on employee.write — see the identical rationale on
// the Skills GET route above; GET /me/qualifications (W106) serves own-scope
// employee reads separately.
router.get(
  "/organizations/:organizationId/employees/:employeeId/qualifications",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const qualifications = await listEmployeeQualifications(req.membership!.organizationId, employeeId);
    res.json(qualifications);
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/qualifications",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const parsed = AddEmployeeQualificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const qualification = await addEmployeeQualification({
      organizationId: req.membership!.organizationId,
      employeeId,
      qualificationTypeCode: parsed.data.qualificationTypeCode,
      institution: parsed.data.institution,
      fieldOfStudy: parsed.data.fieldOfStudy,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      grade: parsed.data.grade,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(201).json(qualification);
  },
);

router.patch(
  "/organizations/:organizationId/employees/:employeeId/qualifications/:qualificationId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const qualificationId = parseId(req.params.qualificationId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(qualificationId)) {
      res.status(400).json({ error: "Invalid qualification ID" });
      return;
    }

    const parsed = UpdateEmployeeQualificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateEmployeeQualification({
        organizationId: req.membership!.organizationId,
        employeeId,
        qualificationId,
        qualificationTypeCode: parsed.data.qualificationTypeCode,
        institution: parsed.data.institution,
        fieldOfStudy: parsed.data.fieldOfStudy,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        grade: parsed.data.grade,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof EmployeeQualificationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/organizations/:organizationId/employees/:employeeId/qualifications/:qualificationId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const qualificationId = parseId(req.params.qualificationId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(qualificationId)) {
      res.status(400).json({ error: "Invalid qualification ID" });
      return;
    }

    try {
      await removeEmployeeQualification({
        organizationId: req.membership!.organizationId,
        employeeId,
        qualificationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ message: "Qualification removed" });
    } catch (err) {
      if (err instanceof EmployeeQualificationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

// Phase 3F, W105: gated on employee.write — see the identical rationale on
// the Skills GET route above; GET /me/certifications (W106) serves own-scope
// employee reads separately.
router.get(
  "/organizations/:organizationId/employees/:employeeId/certifications",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const certifications = await listEmployeeCertifications(req.membership!.organizationId, employeeId);
    res.json(certifications);
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/certifications",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    if (!(await requireEmployee(req, res, employeeId))) return;

    const parsed = AddEmployeeCertificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const certification = await addEmployeeCertification({
      organizationId: req.membership!.organizationId,
      employeeId,
      certificationTypeCode: parsed.data.certificationTypeCode,
      issuingOrganization: parsed.data.issuingOrganization,
      issueDate: parsed.data.issueDate,
      expiryDate: parsed.data.expiryDate,
      credentialId: parsed.data.credentialId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(201).json(certification);
  },
);

router.patch(
  "/organizations/:organizationId/employees/:employeeId/certifications/:certificationId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const certificationId = parseId(req.params.certificationId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(certificationId)) {
      res.status(400).json({ error: "Invalid certification ID" });
      return;
    }

    const parsed = UpdateEmployeeCertificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateEmployeeCertification({
        organizationId: req.membership!.organizationId,
        employeeId,
        certificationId,
        certificationTypeCode: parsed.data.certificationTypeCode,
        issuingOrganization: parsed.data.issuingOrganization,
        issueDate: parsed.data.issueDate,
        expiryDate: parsed.data.expiryDate,
        credentialId: parsed.data.credentialId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof EmployeeCertificationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/organizations/:organizationId/employees/:employeeId/certifications/:certificationId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = parseId(req.params.employeeId);
    const certificationId = parseId(req.params.certificationId);
    if (!(await requireEmployee(req, res, employeeId))) return;
    if (isNaN(certificationId)) {
      res.status(400).json({ error: "Invalid certification ID" });
      return;
    }

    try {
      await removeEmployeeCertification({
        organizationId: req.membership!.organizationId,
        employeeId,
        certificationId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ message: "Certification removed" });
    } catch (err) {
      if (err instanceof EmployeeCertificationNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
