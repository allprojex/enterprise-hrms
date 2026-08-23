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
import {
  CreateEmployeeBody,
  UpdateEmployeeBody,
  LinkEmployeeToUserBody,
  ListEmployeesQueryParams,
  SeparateEmployeeBody,
  TransferEmployeeBody,
  PromoteEmployeeBody,
  ConfirmEmployeeBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { isUniqueViolation } from "../lib/dbErrors";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  assertEmployeeReferencesValid,
  separateEmployee,
  rehireEmployee,
  transferEmployee,
  promoteEmployee,
  confirmEmployee,
  EmployeeNotFoundError,
  EmployeeAlreadySeparatedError,
  EmployeeNotSeparatedError,
  EmployeeTransferNoChangeError,
  EmployeePromotionNoChangeError,
  EmployeeNotOnProbationError,
  InvalidProbationReviewReferenceError,
} from "../lib/employees";
import {
  EmployeeNumberReuseDisabledError,
  EmployeeNumberCollisionError,
  EmployeeNumberMissingTokenDataError,
  InvalidManualEmployeeNumberError,
} from "../lib/numbering";
import { listEmploymentPeriods } from "../lib/employmentLifecycleService";
import { recordAuditEvent } from "../lib/auditLog";
import { validateImageUpload, processAvatarImage, InvalidImageError } from "../lib/imageProcessing";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "../lib/fileStorage";
import { InvalidDocumentError } from "../lib/documentValidation";
import {
  listEmployeeDocuments,
  uploadEmployeeDocument,
  removeEmployeeDocument,
  EmployeeDocumentNotFoundError,
} from "../lib/employeeDocuments";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDocument = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

type Employee = typeof employeesTable.$inferSelect;

interface EmployeeLabels {
  departmentNameById: Map<number, string>;
  branchNameById: Map<number, string>;
  positionTitleById: Map<number, string>;
  managerNameById: Map<number, string>;
  linkedApplicationUserIdByEmployeeId: Map<number, number>;
}

async function resolveEmployeeLabels(employees: Employee[]): Promise<EmployeeLabels> {
  const departmentIds = [...new Set(employees.map((e) => e.departmentId).filter((id): id is number => id != null))];
  const branchIds = [...new Set(employees.map((e) => e.branchId).filter((id): id is number => id != null))];
  const positionIds = [...new Set(employees.map((e) => e.positionId).filter((id): id is number => id != null))];
  const managerIds = [
    ...new Set(employees.map((e) => e.reportingManagerId).filter((id): id is number => id != null)),
  ];
  const employeeIds = employees.map((e) => e.id);

  const [departments, branches, positions, managers, links] = await Promise.all([
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
    employeeIds.length
      ? db
          .select({ employeeId: employeeUserLinksTable.employeeId, applicationUserId: employeeUserLinksTable.applicationUserId })
          .from(employeeUserLinksTable)
          .where(inArray(employeeUserLinksTable.employeeId, employeeIds))
      : Promise.resolve([]),
  ]);

  return {
    departmentNameById: new Map(departments.map((d) => [d.id, d.name])),
    branchNameById: new Map(branches.map((b) => [b.id, b.name])),
    positionTitleById: new Map(positions.map((p) => [p.id, p.title])),
    managerNameById: new Map(managers.map((m) => [m.id, `${m.firstName} ${m.lastName}`])),
    linkedApplicationUserIdByEmployeeId: new Map(links.map((l) => [l.employeeId, l.applicationUserId])),
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
    separationDate: employee.separationDate,
    separationReason: employee.separationReason,
    notes: canReadNotes ? employee.notes : null,
    linkedApplicationUserId: labels.linkedApplicationUserIdByEmployeeId.get(employee.id) ?? null,
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
      const employee = await createEmployee(db, {
        organizationId,
        fields: parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });

      const labels = await resolveEmployeeLabels([employee]);
      res.status(201).json(formatEmployee(employee, labels, true));
    } catch (err) {
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNumberReuseDisabledError || err instanceof InvalidManualEmployeeNumberError || err instanceof EmployeeNumberMissingTokenDataError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNumberCollisionError || isUniqueViolation(err)) {
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

// DELETE /organizations/:organizationId/employees/:employeeId/link-user
router.delete(
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

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const [existingLink] = await db
      .select()
      .from(employeeUserLinksTable)
      .where(eq(employeeUserLinksTable.employeeId, employeeId))
      .limit(1);
    if (!existingLink) {
      res.status(404).json({ error: "This employee is not linked to a login account" });
      return;
    }

    await db.delete(employeeUserLinksTable).where(eq(employeeUserLinksTable.employeeId, employeeId));

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId,
      eventType: "employee.unlinked_from_user",
      targetType: "employee",
      targetId: String(employeeId),
      metadata: { applicationUserId: existingLink.applicationUserId },
    });

    res.json({ message: "Employee unlinked from login account" });
  },
);

// POST /organizations/:organizationId/employees/:employeeId/separate
router.post(
  "/organizations/:organizationId/employees/:employeeId/separate",
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

    const parsed = SeparateEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await separateEmployee({
        organizationId: req.membership!.organizationId,
        employeeId,
        separationDate: parsed.data.separationDate,
        separationReason: parsed.data.separationReason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeAlreadySeparatedError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/rehire
router.post(
  "/organizations/:organizationId/employees/:employeeId/rehire",
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

    try {
      const updated = await rehireEmployee({
        organizationId: req.membership!.organizationId,
        employeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNotSeparatedError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/transfer
router.post(
  "/organizations/:organizationId/employees/:employeeId/transfer",
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

    const parsed = TransferEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await transferEmployee({
        organizationId: req.membership!.organizationId,
        employeeId,
        departmentId: parsed.data.departmentId,
        branchId: parsed.data.branchId,
        positionId: parsed.data.positionId,
        effectiveDate: parsed.data.effectiveDate,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeTransferNoChangeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/promote
router.post(
  "/organizations/:organizationId/employees/:employeeId/promote",
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

    const parsed = PromoteEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await promoteEmployee({
        organizationId: req.membership!.organizationId,
        employeeId,
        positionId: parsed.data.positionId,
        effectiveDate: parsed.data.effectiveDate,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeePromotionNoChangeError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/employees/:employeeId/confirm
router.post(
  "/organizations/:organizationId/employees/:employeeId/confirm",
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

    const parsed = ConfirmEmployeeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await confirmEmployee({
        organizationId: req.membership!.organizationId,
        employeeId,
        effectiveDate: parsed.data.effectiveDate,
        probationReviewId: parsed.data.probationReviewId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const labels = await resolveEmployeeLabels([updated]);
      const canReadNotes = await hasPermission(req.membership!.id, "employee.notes.read");
      res.json(formatEmployee(updated, labels, canReadNotes));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeNotOnProbationError || err instanceof InvalidProbationReviewReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/employees/:employeeId/employment-history
// Phase 3F, W105: closes the HR-side gap discovered during Phase 3F
// discovery — Transfer/Promote/Confirm have always written to
// employment_periods, but nothing ever rendered it back, not even here.
// employee.write (not employee.read) — matching the HR-authoritative
// permission floor every other HR-administration route in this file
// requires, and the same corrected floor now used by the Skills/
// Qualifications/Certifications GET routes (see
// routes/employeeSkillsQualifications.ts). Org-wide, any employeeId, by
// design — this is HR viewing an employee's record, not own-scope self-
// service (that is GET /me/employment-history, gated entirely differently).
router.get(
  "/organizations/:organizationId/employees/:employeeId/employment-history",
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

    const employee = await getEmployeeById(req.membership!.organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const periods = await listEmploymentPeriods(req.membership!.organizationId, employeeId);
    res.json(
      periods.map((p) => ({
        id: p.id,
        eventType: p.eventType,
        effectiveDate: p.effectiveDate,
        previousState: p.previousState,
        newState: p.newState,
        createdAt: p.createdAt,
      })),
    );
  },
);

function formatEmployeeDocument(doc: { id: number; organizationId: number; employeeId: number | null; categoryCode: string; fileName: string; mimeType: string; fileSize: number; uploadedBy: number | null; createdAt: Date }) {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    employeeId: doc.employeeId,
    categoryCode: doc.categoryCode,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
  };
}

// GET /organizations/:organizationId/employees/:employeeId/documents
router.get(
  "/organizations/:organizationId/employees/:employeeId/documents",
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

    const organizationId = req.membership!.organizationId;
    const employee = await getEmployeeById(organizationId, employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const documents = await listEmployeeDocuments(organizationId, employeeId);
    res.json(documents.map(formatEmployeeDocument));
  },
);

// POST /organizations/:organizationId/employees/:employeeId/documents
router.post(
  "/organizations/:organizationId/employees/:employeeId/documents",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  uploadDocument.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    const categoryCode = typeof req.body?.categoryCode === "string" ? req.body.categoryCode.trim() : "";
    if (isNaN(employeeId) || !req.file || !categoryCode) {
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
      const document = await uploadEmployeeDocument({
        organizationId,
        employeeId,
        categoryCode,
        file: {
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
          originalname: req.file.originalname,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(formatEmployeeDocument(document));
    } catch (err) {
      if (err instanceof InvalidDocumentError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/employees/:employeeId/documents/:documentId
router.delete(
  "/organizations/:organizationId/employees/:employeeId/documents/:documentId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeIdRaw = Array.isArray(req.params.employeeId) ? req.params.employeeId[0] : req.params.employeeId;
    const employeeId = parseInt(employeeIdRaw, 10);
    const documentIdRaw = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
    const documentId = parseInt(documentIdRaw, 10);
    if (isNaN(employeeId) || isNaN(documentId)) {
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
      await removeEmployeeDocument({
        organizationId,
        employeeId,
        documentId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ message: "Document removed" });
    } catch (err) {
      if (err instanceof EmployeeDocumentNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
