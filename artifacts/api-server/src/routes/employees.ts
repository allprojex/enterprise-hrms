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
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { effectivePermissionsForRequest } from "../lib/roleDelegation";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { isUniqueViolation } from "../lib/dbErrors";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
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
  EmployeeSelfManagerError,
  EmployeeReportingCycleError,
  EmployeeManagerIneligibleError,
  DuplicateEmployeeIdentifierError,
} from "../lib/employees";
import {
  EMPLOYEE_SENSITIVE_WRITE_PERMISSION,
  EMPLOYEE_NOTES_PERMISSION,
  EmployeeSensitiveWriteForbiddenError,
  EmployeeStatusChangeNotAllowedError,
  EmployeeValidationError,
  type EmployeeWriteAuthorization,
} from "../lib/employeeRecordPolicy";
import {
  EmployeeNumberReuseDisabledError,
  EmployeeNumberCollisionError,
  EmployeeNumberMissingTokenDataError,
  InvalidManualEmployeeNumberError,
} from "../lib/numbering";
import { listEmploymentPeriods } from "../lib/employmentLifecycleService";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { recordAuditEvent } from "../lib/auditLog";
import {
  applyEmployeeProfilePicture,
  readEmployeeProfilePictureBuffer,
  clearEmployeeProfilePicture,
  InvalidImageError,
} from "../lib/employeeProfilePicture";
import { InvalidDocumentError } from "../lib/documentValidation";
import {
  listEmployeeDocuments,
  uploadEmployeeDocument,
  removeEmployeeDocument,
  EmployeeDocumentNotFoundError,
} from "../lib/employeeDocuments";
import { listEmployeeFinalizedForms } from "../lib/employeeFormDocuments";
import { forbidSelfAdministration, SELF_ADMINISTRATION_ERROR_CODE } from "../lib/employeeSelfAdministration";

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

/**
 * Release-gate fix (2026-10-10): the directory, detail, create and update
 * handlers resolve the caller's keys through `effectivePermissionsForRequest`
 * — membership roles, or under a break-glass grant the grant's explicit
 * scope — and the organization through `resolveOrganizationId`, so a platform
 * actor acting under an active grant no longer crashes these routes with a
 * membership dereference. Nothing is widened: the grant must already name
 * every key, exactly as requirePermission demands, and the self-
 * administration guard keys on the user, not on the membership.
 */
async function resolveEmployeeVisibility(req: MembershipRequest): Promise<EmployeeVisibility> {
  const [keys, ownEmployeeId] = await Promise.all([
    effectivePermissionsForRequest(req),
    resolveOwnEmployeeId(resolveOrganizationId(req), req.userId!),
  ]);
  return { canReadNotes: keys.has(EMPLOYEE_NOTES_PERMISSION), canReadSensitive: keys.has("employee.sensitive.read"), ownEmployeeId };
}

/**
 * Phase 1 hardening (2026-10-08): what the caller may WRITE, over and above
 * `employee.write` (already enforced by the route middleware). Resolved from
 * effective permissions, never from the body. See lib/employeeRecordPolicy.ts
 * for the field sets each key governs.
 */
async function resolveEmployeeWriteAuthorization(req: MembershipRequest): Promise<EmployeeWriteAuthorization> {
  const keys = await effectivePermissionsForRequest(req);
  return { canWriteSensitive: keys.has(EMPLOYEE_SENSITIVE_WRITE_PERMISSION), canWriteNotes: keys.has(EMPLOYEE_NOTES_PERMISSION) };
}

/**
 * One mapping for every policy/validation failure the create and update
 * paths can raise, so both routes answer identically. Messages name fields
 * and rules — never a stored value, never another employee.
 */
function respondToEmployeeWriteError(res: { status: (code: number) => { json: (body: unknown) => void } }, err: unknown): boolean {
  if (err instanceof EmployeeSensitiveWriteForbiddenError) {
    res.status(403).json({ error: err.message, fields: err.fields, requiredPermission: err.requiredPermission });
    return true;
  }
  if (
    err instanceof EmployeeStatusChangeNotAllowedError ||
    err instanceof EmployeeValidationError ||
    err instanceof EmployeeSelfManagerError ||
    err instanceof EmployeeReportingCycleError ||
    err instanceof EmployeeManagerIneligibleError ||
    err instanceof CrossOrganizationReferenceError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof DuplicateEmployeeIdentifierError) {
    res.status(409).json({ error: err.message, field: err.field });
    return true;
  }
  return false;
}

/**
 * WWM Employee Access Remediation (2026-09-07). `employee.read` is the
 * directory grant every role holds; it must never by itself reveal a
 * colleague's personal identity data. The fields below are returned only
 * when the caller holds `employee.sensitive.read` OR the record is the
 * caller's own (resolved server-side via employee_user_links, never from a
 * client-supplied id). Otherwise they are nulled and
 * `sensitiveFieldsRedacted: true` tells the UI honestly that the values
 * are withheld rather than absent. Same shape as the pre-existing
 * `employee.notes.read` gate on `notes`.
 *
 * `phoneNumber` joined this set on 2026-09-15 (owner decision): the column is
 * not constrained to a work line and in practice holds personal mobile
 * numbers, so it is treated like `alternatePhoneNumber`, not as directory
 * contact data. `workEmail` remains the directory contact field.
 */
interface EmployeeVisibility {
  canReadNotes: boolean;
  canReadSensitive: boolean;
  /** The caller's own employee id in this organization, or null when unlinked. */
  ownEmployeeId: number | null;
}

function formatEmployee(employee: Employee, labels: EmployeeLabels, visibility: EmployeeVisibility) {
  const { canReadNotes } = visibility;
  const revealSensitive = visibility.canReadSensitive || (visibility.ownEmployeeId !== null && visibility.ownEmployeeId === employee.id);
  return {
    id: employee.id,
    organizationId: employee.organizationId,
    employeeNumber: employee.employeeNumber,
    hasProfilePicture: employee.profilePictureKey != null,
    firstName: employee.firstName,
    middleName: employee.middleName,
    lastName: employee.lastName,
    preferredName: employee.preferredName,
    gender: revealSensitive ? employee.gender : null,
    dateOfBirth: revealSensitive ? employee.dateOfBirth : null,
    maritalStatus: revealSensitive ? employee.maritalStatus : null,
    nationality: revealSensitive ? employee.nationality : null,
    nationalId: revealSensitive ? employee.nationalId : null,
    passportNumber: revealSensitive ? employee.passportNumber : null,
    personalEmail: revealSensitive ? employee.personalEmail : null,
    workEmail: employee.workEmail,
    phoneNumber: revealSensitive ? employee.phoneNumber : null,
    alternatePhoneNumber: revealSensitive ? employee.alternatePhoneNumber : null,
    residentialAddress: revealSensitive ? employee.residentialAddress : null,
    emergencyContacts: revealSensitive ? employee.emergencyContacts : null,
    sensitiveFieldsRedacted: !revealSensitive,
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
    separationReason: revealSensitive ? employee.separationReason : null,
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

    const organizationId = resolveOrganizationId(req);
    const { search, departmentId, branchId, positionId, employmentStatus, page, pageSize } = parsed.data;

    // Visibility is resolved BEFORE the query: the search predicate itself
    // depends on whether the caller may read private contact fields.
    const visibility = await resolveEmployeeVisibility(req);

    const { items, total } = await listEmployees({
      organizationId,
      search,
      departmentId,
      branchId,
      positionId,
      employmentStatus,
      page,
      pageSize,
      includePrivateContactFields: visibility.canReadSensitive,
    });

    const labels = await resolveEmployeeLabels(items);

    res.json({
      items: items.map((e) => formatEmployee(e, labels, visibility)),
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

    const organizationId = resolveOrganizationId(req);

    try {
      const employee = await createEmployee(db, {
        organizationId,
        fields: parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
        authorization: await resolveEmployeeWriteAuthorization(req),
      });

      const labels = await resolveEmployeeLabels([employee]);
      res.status(201).json(formatEmployee(employee, labels, { canReadNotes: true, canReadSensitive: true, ownEmployeeId: null }));
    } catch (err) {
      if (respondToEmployeeWriteError(res, err)) return;
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

    const employee = await getEmployeeById(resolveOrganizationId(req), employeeId);
    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const labels = await resolveEmployeeLabels([employee]);
    res.json(formatEmployee(employee, labels, await resolveEmployeeVisibility(req)));
  },
);

// PATCH /organizations/:organizationId/employees/:employeeId
router.patch(
  "/organizations/:organizationId/employees/:employeeId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  forbidSelfAdministration("employee.update"),
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

    const organizationId = resolveOrganizationId(req);

    try {
      // Phase 1 hardening: the whole update runs through lib/employees.ts
      // updateEmployee — field authorization, the lifecycle status matrix,
      // merged-state validation, reporting-line checks and the audit trail
      // all live there, so no second code path can drift from it.
      const updated = await updateEmployee({
        organizationId,
        employeeId,
        fields: parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: resolveActorMembershipId(req),
        authorization: await resolveEmployeeWriteAuthorization(req),
      });

      const labels = await resolveEmployeeLabels([updated]);
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: "Employee not found" });
        return;
      }
      if (respondToEmployeeWriteError(res, err)) return;
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
  forbidSelfAdministration("employee.profile_picture.update"),
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
      const updated = await applyEmployeeProfilePicture(
        organizationId,
        employee,
        { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer },
        { applicationUserId: req.userId!, membershipId: req.membership!.id, via: "hr_admin" },
      );

      const labels = await resolveEmployeeLabels([updated]);
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
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
    const buffer = employee ? await readEmployeeProfilePictureBuffer(req.membership!.organizationId, employee) : null;
    if (!buffer) {
      res.status(404).json({ error: "No profile picture" });
      return;
    }

    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "private, max-age=300");
    res.send(buffer);
  },
);

// DELETE /organizations/:organizationId/employees/:employeeId/profile-picture
router.delete(
  "/organizations/:organizationId/employees/:employeeId/profile-picture",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  forbidSelfAdministration("employee.profile_picture.remove"),
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

    const updated = await clearEmployeeProfilePicture(organizationId, employee, {
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
      via: "hr_admin",
    });

    const labels = await resolveEmployeeLabels([updated]);
    const visibility = await resolveEmployeeVisibility(req);
    res.json(formatEmployee(updated, labels, visibility));
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

    // Self-administration boundary (owner policy, 2026-10-09): linking YOUR OWN
    // login to an employee record is the act that makes that record yours and
    // grants you its self-service surface. It is an administrative change to
    // your own standing, so another authorized HR officer or organisation
    // administrator performs it. Linking a colleague is unaffected.
    if (parsed.data.applicationUserId === req.userId!) {
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "employee.self_administration_denied",
        targetType: "employee",
        targetId: String(employeeId),
        metadata: { action: "employee.link_self" },
        outcome: "denied",
      });
      res.status(403).json({
        error: "You cannot link your own login account to an employee record. Ask another authorized HR officer or organisation administrator to link it.",
        code: SELF_ADMINISTRATION_ERROR_CODE,
        employeeId,
      });
      return;
    }

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
  forbidSelfAdministration("employee.unlink_user"),
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
  forbidSelfAdministration("employee.separate"),
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
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
    } catch (err) {
      if (err instanceof EmployeeNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof EmployeeAlreadySeparatedError || err instanceof EmployeeValidationError) {
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
  forbidSelfAdministration("employee.rehire"),
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
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
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
  forbidSelfAdministration("employee.transfer"),
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
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
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
  forbidSelfAdministration("employee.promote"),
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
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
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
  forbidSelfAdministration("employee.confirm"),
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
      const visibility = await resolveEmployeeVisibility(req);
      res.json(formatEmployee(updated, labels, visibility));
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

    // WWM Employee Access Remediation (2026-09-07): the directory grant
    // (employee.read, held by every role) is not enough to list ANOTHER
    // employee's personnel-document metadata. Own documents (ESS "My
    // Documents") resolve through employee_user_links; everyone else needs
    // employee.documents.read. Existence was already confirmed above, so a
    // colleague probing ids learns nothing new from this 403 vs the 404.
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const isOwn = ownEmployeeId !== null && ownEmployeeId === employeeId;
    const canReadDocuments = await hasPermission(req.membership!.id, "employee.documents.read");
    if (!isOwn && !canReadDocuments) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Reaching the list only through "it is my own record" is not the
    // document permission: confidential/restricted documents stay with holders
    // of employee.documents.read (see listEmployeeDocuments).
    const documents = await listEmployeeDocuments(organizationId, employeeId, { includeConfidential: canReadDocuments });
    res.json(documents.map(formatEmployeeDocument));
  },
);

// GET /organizations/:organizationId/employees/:employeeId/form-documents
// WS-26C (U4): the employee's FINALIZED WS-26 forms surfaced through the existing
// generated_documents store. Same authorization boundary as personnel documents:
// own (server-resolved) or employee.documents.read; a colleague/guessed id fails
// closed. Metadata only — the download link points at the existing forms route,
// which enforces final.read/subject AND sensitivity redaction (no raw bypass).
router.get(
  "/organizations/:organizationId/employees/:employeeId/form-documents",
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
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const isOwn = ownEmployeeId !== null && ownEmployeeId === employeeId;
    if (!isOwn && !(await hasPermission(req.membership!.id, "employee.documents.read"))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(await listEmployeeFinalizedForms(organizationId, employeeId));
  },
);

// POST /organizations/:organizationId/employees/:employeeId/documents
router.post(
  "/organizations/:organizationId/employees/:employeeId/documents",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee.write"),
  forbidSelfAdministration("employee_document.upload"),
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
  forbidSelfAdministration("employee_document.remove"),
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
