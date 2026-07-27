import { Router } from "express";
import multer from "multer";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  employeesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  organizationMembershipsTable,
  employeeUserLinksTable,
} from "@workspace/db";
import { CreateEmployeeBody, UpdateEmployeeBody, LinkEmployeeToUserBody, ListEmployeesQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { isUniqueViolation } from "../lib/dbErrors";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listEmployees,
  getEmployeeById,
  generateEmployeeNumber,
  assertEmployeeReferencesValid,
} from "../lib/employees";
import { recordAuditEvent } from "../lib/auditLog";
import { validateImageUpload, processAvatarImage, InvalidImageError } from "../lib/imageProcessing";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "../lib/fileStorage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

type Employee = typeof employeesTable.$inferSelect;

interface EmployeeLabels {
  departmentNameById: Map<number, string>;
  branchNameById: Map<number, string>;
  positionTitleById: Map<number, string>;
  managerNameById: Map<number, string>;
}

async function resolveEmployeeLabels(employees: Employee[]): Promise<EmployeeLabels> {
  const departmentIds = [...new Set(employees.map((e) => e.departmentId).filter((id): id is number => id != null))];
  const branchIds = [...new Set(employees.map((e) => e.branchId).filter((id): id is number => id != null))];
  const positionIds = [...new Set(employees.map((e) => e.positionId).filter((id): id is number => id != null))];
  const managerIds = [
    ...new Set(employees.map((e) => e.reportingManagerId).filter((id): id is number => id != null)),
  ];

  const [departments, branches, positions, managers] = await Promise.all([
    departmentIds.length
      ? db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).where(inArray(departmentsTable.id, departmentIds))
      : Promise.resolve([]),
    branchIds.length
      ? db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable).where(inArray(branchesTable.id, branchIds))
      : Promise.resolve([]),
    positionIds.length
      ? db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(inArray(positionsTable.id, positionIds))
      : Promise.resolve([]),
    managerIds.length
      ? db
          .select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName })
          .from(employeesTable)
          .where(inArray(employeesTable.id, managerIds))
      : Promise.resolve([]),
  ]);

  return {
    departmentNameById: new Map(departments.map((d) => [d.id, d.name])),
    branchNameById: new Map(branches.map((b) => [b.id, b.name])),
    positionTitleById: new Map(positions.map((p) => [p.id, p.title])),
    managerNameById: new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`])),
  };
}

function formatEmployee(employee: Employee, labels: EmployeeLabels, canReadNotes: boolean) {
  return {
    id: employee.id,
    organizationId: employee.organizationId,
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
    nationalId: employee.nationalId,
    passportNumber: employee.passportNumber,
    personalEmail: employee.personalEmail,
    workEmail: employee.workEmail,
    phoneNumber: employee.phoneNumber,
    alternatePhoneNumber: employee.alternatePhoneNumber,
    residentialAddress: employee.residentialAddress,
    emergencyContacts: employee.emergencyContacts,
    departmentId: employee.departmentId,
    departmentName: employee.departmentId ? (labels.departmentNameById.get(employee.departmentId) ?? null) : null,
    branchId: employee.branchId,
    branchName: employee.branchId ? (labels.branchNameById.get(employee.branchId) ?? null) : null,
    positionId: employee.positionId,
    positionName: employee.positionId ? (labels.positionTitleById.get(employee.positionId) ?? null) : null,
    reportingManagerId: employee.reportingManagerId,
    reportingManagerName: employee.reportingManagerId
      ? (labels.managerNameById.get(employee.reportingManagerId) ?? null)
      : null,
    employmentType: employee.employmentType,
    hireDate: employee.hireDate,
    probationEndDate: employee.probationEndDate,
    employmentStatus: employee.employmentStatus,
    workLocation: employee.workLocation,
    notes: canReadNotes ? employee.notes : null,
    createdBy: employee.createdBy,
    updatedBy: employee.updatedBy,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
  };
}

// GET /organizations/:organizationId/employees
router.get(
  "/organizations/:organizationId/employees",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ListEmployeesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const { search, departmentId, branchId, positionId, employmentStatus, page, pageSize } = parsed.data;

    const { items, total } = await listEmployees({
      organizationId,
      search,
      departmentId,
      branchId,
      positionId,
      employmentStatus,
      page,
      pageSize,
    });

    const labels = await resolveEmployeeLabels(items);
    const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");

    res.json({
      items: items.map((e) => formatEmployee(e, labels, canReadNotes)),
      total,
      page,
      pageSize,
    });
  },
);

// POST /organizations/:organizationId/employees
router.post(
  "/organizations/:organizationId/employees",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      await assertEmployeeReferencesValid(organizationId, parsed.data);

      const employeeNumber = parsed.data.employeeNumber ?? (await generateEmployeeNumber(organizationId));

      const [employee] = await db
        .insert(employeesTable)
        .values({
          ...parsed.data,
          employeeNumber,
          organizationId,
          createdBy: req.userId!,
          updatedBy: req.userId!,
        })
        .returning();

      const labels = await resolveEmployeeLabels([employee]);
      res.status(201).json(formatEmployee(employee, labels, true));
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "An employee with this employee number already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId
router.get(
  "/organizations/:organizationId/employees/:employeeId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const employee = await getEmployeeById(req.membership!.organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const labels = await resolveEmployeeLabels([employee]);
    const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
    res.json(formatEmployee(employee, labels, canReadNotes));
  },
);

// PATCH /organizations/:organizationId/employees/:employeeId
router.patch(
  "/organizations/:organizationId/employees/:employeeId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const parsed = UpdateEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const existing = await getEmployeeById(organizationId, employeeId);
    if (!existing) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    try {
      await assertEmployeeReferencesValid(organizationId, parsed.data);

      const [updated] = await db
        .update(employeesTable)
        .set({ ...parsed.data, updatedBy: req.userId! })
        .where(eq(employeesTable.id, employeeId))
        .returning();

      if (parsed.data.employmentStatus && parsed.data.employmentStatus !== existing.employmentStatus) {
        await recordAuditEvent({
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
          organizationId,
          eventType: "employee.status_changed",
          targetType: "employee",
          targetId: String(employeeId),
          beforeState: { employmentStatus: existing.employmentStatus },
          afterState: { employmentStatus: updated.employmentStatus },
        });
      }

      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "An employee with this employee number already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/profile-picture
router.post(
  "/organizations/:organizationId/employees/:employeeId/profile-picture",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  upload.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId) || !req.file) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    try {
      validateImageUpload({ mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer });
      const processed = await processAvatarImage(req.file.buffer);
      const key = await writeOrgFile(organizationId, "avatars", "jpg", processed);

      if (employee.profilePictureKey) {
        await deleteOrgFile(organizationId, employee.profilePictureKey);
      }

      const [updated] = await db
        .update(employeesTable)
        .set({ profilePictureKey: key, updatedBy: req.userId! })
        .where(eq(employeesTable.id, employeeId))
        .returning();

      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof InvalidImageError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/profile-picture
router.get(
  "/organizations/:organizationId/employees/:employeeId/profile-picture",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const employee = await getEmployeeById(req.membership!.organizationId, employeeId);
    if (!employee?.profilePictureKey) {
      res.status(404).json({ error: "No profile picture" });
      return;
    }

    try {
      const buffer = await readOrgFile(req.membership!.organizationId, employee.profilePictureKey);
      res.set("Content-Type", "image/jpeg");
      res.set("Cache-Control", "private, max-age=300");
      res.send(buffer);
    } catch {
      res.status(404).json({ error: "No profile picture" });
    }
  },
);

// DELETE /organizations/:organizationId/employees/:employeeId/profile-picture
router.delete(
  "/organizations/:organizationId/employees/:employeeId/profile-picture",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    if (employee.profilePictureKey) {
      await deleteOrgFile(organizationId, employee.profilePictureKey);
    }

    const [updated] = await db
      .update(employeesTable)
      .set({ profilePictureKey: null, updatedBy: req.userId! })
      .where(eq(employeesTable.id, employeeId))
      .returning();

    const labels = await resolveEmployeeLabels([updated]);
    const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
    res.json(formatEmployee(updated, labels, canReadNotes));
  },
);

// POST /organizations/:organizationId/employees/:employeeId/link-user
router.post(
  "/organizations/:organizationId/employees/:employeeId/link-user",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    if (isNaN(employeeId)) {
      res.status(400).json({ error: "Invalid employee ID" });
      return;
    }

    const parsed = LinkEmployeeToUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const [targetMembership] = await db
      .select()
      .from(organizationMembershipsTable)
      .where(
        and(
          eq(organizationMembershipsTable.applicationUserId, parsed.data.applicationUserId),
          eq(organizationMembershipsTable.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!targetMembership || targetMembership.status !== "active") {
      res.status(400).json({ error: "Target user has no active membership in this organization" });
      return;
    }

    try {
      await db.insert(employeeUserLinksTable).values({
        employeeId,
        applicationUserId: parsed.data.applicationUserId,
        organizationMembershipId: targetMembership.id,
        linkedBy: req.userId!,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(400).json({ error: "This employee or user is already linked" });
        return;
      }
      throw err;
    }

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId,
      eventType: "employee.linked_to_user",
      targetType: "employee",
      targetId: String(employeeId),
      metadata: { applicationUserId: parsed.data.applicationUserId },
    });

    res.json({ message: "Employee linked to login account" });
  },
);

export default router;
