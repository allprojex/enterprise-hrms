/**
 * WS-7 (§1-2/§17/§19 recon; Owner clarifications A/F/G/P) — the employee
 * adapter, covering both "employees" and "current staff/PIF numbers" from
 * the frozen entity list (§7 items 2-3) as one adapter, since a staff
 * number and a PIF number are both attributes of the same employee row
 * being created, not separate entities to stage independently.
 *
 * Deliberately bypasses `createEmployee()` (lib/employees.ts) the same way
 * the existing legacy importer already does, and for the same reason: that
 * function always allocates a number itself (manual or generated), with no
 * parameter to route a supplied number through the "migrated" allocation
 * method instead. Rather than add import-specific behavior to a function
 * that backs the live add-employee UI, this adapter mirrors its exact
 * insert shape and reuses the same lower-level, already-import-safe
 * primitives directly: `assertEmployeeReferencesValid` for FK ownership,
 * then `allocateLegacyEmployeeNumber` (a supplied number) or
 * `allocateGeneratedEmployeeNumber` (none supplied) — never
 * `allocateManualEmployeeNumber`, which lacks "migrated" semantics and
 * would misrecord an imported number's provenance.
 *
 * Duplicate handling (§14/§18/Owner G): a supplied employee/PIF number
 * that already has an open allocation anywhere in the organization is
 * treated as a hard validation error, never a silent match — this
 * workstream never guesses whether two records describe the same person.
 *
 * Reporting relationships and PIF custody location are NOT imported here —
 * both were confirmed NOT SPECIFIED in WS-7's frozen scope extraction; a
 * PIF row is created with `currentLocationId: null`, assignable afterward
 * through the existing Personnel File / Records Locations UI.
 */
import { eq, and, isNull } from "drizzle-orm";
import { db, employeesTable, employeeNumberAllocationsTable, personnelFilesTable, employmentTypeEnum, genderEnum, maritalStatusEnum } from "@workspace/db";
import { assertEmployeeReferencesValid } from "../../employees";
import { allocateGeneratedEmployeeNumber, allocateLegacyEmployeeNumber, auditEmployeeNumberAllocated } from "../../numbering";
import { createLegacyPersonnelFile, PifNumberCollisionError } from "../../personnelFiles";
import type { EntityAdapter, CanonicalField, NormalizeResult, PlanResult } from "../adapterRegistry";
import { requiredString, optionalString, parseDate, parseEnum } from "../normalizeHelpers";
import { resolveBranchRef, resolveDepartmentRef, resolvePositionRef } from "../referenceResolution";

const EMPLOYEE_FIELDS: readonly CanonicalField[] = [
  { key: "firstName", label: "First Name", required: true, type: "string", aliases: ["First Name", "Given Name", "Firstname"] },
  { key: "lastName", label: "Last Name", required: true, type: "string", aliases: ["Last Name", "Surname", "Lastname"] },
  { key: "employeeNumber", label: "Employee Number", required: false, type: "string", aliases: ["Employee Number", "Staff No", "Staff Number", "Emp ID", "Employee ID"] },
  { key: "pifNumber", label: "PIF Number", required: false, type: "string", aliases: ["PIF Number", "PIF No", "Personnel File Number"] },
  { key: "workEmail", label: "Work Email", required: false, type: "string", aliases: ["Work Email", "Email"] },
  { key: "phoneNumber", label: "Phone Number", required: false, type: "string", aliases: ["Phone Number", "Phone", "Mobile"] },
  { key: "gender", label: "Gender", required: false, type: "enum", enumValues: genderEnum.enumValues, aliases: ["Gender"] },
  { key: "dateOfBirth", label: "Date of Birth", required: false, type: "date", aliases: ["Date of Birth", "DOB"] },
  { key: "maritalStatus", label: "Marital Status", required: false, type: "enum", enumValues: maritalStatusEnum.enumValues, aliases: ["Marital Status"] },
  { key: "employmentType", label: "Employment Type", required: false, type: "enum", enumValues: employmentTypeEnum.enumValues, aliases: ["Employment Type"] },
  { key: "hireDate", label: "Hire Date", required: false, type: "date", aliases: ["Hire Date", "Date Hired", "Start Date"] },
  { key: "departmentCode", label: "Department Code", required: false, type: "string", aliases: ["Department Code", "Department"] },
  { key: "branchCode", label: "Branch Code", required: false, type: "string", aliases: ["Branch Code", "Branch"] },
  { key: "positionTitle", label: "Position Title", required: false, type: "string", aliases: ["Position Title", "Position", "Designation"] },
];

async function activeAllocationExists(organizationId: number, employeeNumber: string): Promise<boolean> {
  const [row] = await db
    .select({ id: employeeNumberAllocationsTable.id })
    .from(employeeNumberAllocationsTable)
    .where(
      and(
        eq(employeeNumberAllocationsTable.organizationId, organizationId),
        eq(employeeNumberAllocationsTable.employeeNumber, employeeNumber),
        isNull(employeeNumberAllocationsTable.validTo),
      ),
    )
    .limit(1);
  return !!row;
}

async function activePifExists(organizationId: number, pifNumber: string): Promise<boolean> {
  const [row] = await db
    .select({ id: personnelFilesTable.id })
    .from(personnelFilesTable)
    .where(and(eq(personnelFilesTable.organizationId, organizationId), eq(personnelFilesTable.pifNumber, pifNumber)))
    .limit(1);
  return !!row;
}

export const employeeAdapter: EntityAdapter = {
  entityType: "employee",
  label: "Employees",
  dependsOn: ["branch", "department", "position"],
  // tx.insert + allocateLegacy/GeneratedEmployeeNumber(tx) +
  // createLegacyPersonnelFile(tx) — every write is tx-threaded, the same
  // set the (genuinely atomic) legacy importer already commits in one
  // transaction. Audit events are written outside it; see
  // executionService.ts for why that is acceptable and disclosed.
  transactional: true,
  fields: EMPLOYEE_FIELDS,

  normalizeRow(raw): NormalizeResult {
    const messages: NormalizeResult["messages"] = [];
    const firstName = requiredString(raw.firstName, "firstName", "First Name", messages);
    const lastName = requiredString(raw.lastName, "lastName", "Last Name", messages);
    const employeeNumber = optionalString(raw.employeeNumber);
    const pifNumber = optionalString(raw.pifNumber);
    const workEmail = optionalString(raw.workEmail);
    const phoneNumber = optionalString(raw.phoneNumber);
    const gender = parseEnum(raw.gender, "gender", "Gender", genderEnum.enumValues, false, messages);
    const dateOfBirth = parseDate(raw.dateOfBirth, "dateOfBirth", "Date of Birth", false, messages);
    const maritalStatus = parseEnum(raw.maritalStatus, "maritalStatus", "Marital Status", maritalStatusEnum.enumValues, false, messages);
    const employmentType = parseEnum(raw.employmentType, "employmentType", "Employment Type", employmentTypeEnum.enumValues, false, messages);
    const hireDate = parseDate(raw.hireDate, "hireDate", "Hire Date", false, messages);
    const departmentCode = optionalString(raw.departmentCode);
    const branchCode = optionalString(raw.branchCode);
    const positionTitle = optionalString(raw.positionTitle);

    return {
      data: {
        firstName,
        lastName,
        employeeNumber,
        pifNumber,
        workEmail,
        phoneNumber,
        gender,
        dateOfBirth,
        maritalStatus,
        employmentType,
        hireDate,
        departmentCode,
        branchCode,
        positionTitle,
      },
      messages,
    };
  },

  async planRow(tx, mode, data, ctx): Promise<PlanResult> {
    const messages: PlanResult["messages"] = [];

    if (data.employeeNumber && (await activeAllocationExists(ctx.organizationId, data.employeeNumber as string))) {
      messages.push({
        field: "employeeNumber",
        message: `Employee number "${data.employeeNumber}" is already actively allocated in this organization`,
        severity: "error",
      });
    }
    if (data.pifNumber && (await activePifExists(ctx.organizationId, data.pifNumber as string))) {
      messages.push({ field: "pifNumber", message: `PIF number "${data.pifNumber}" already exists in this organization`, severity: "error" });
    }

    for (const [field, resolver, code] of [
      ["branchCode", resolveBranchRef, data.branchCode],
      ["departmentCode", resolveDepartmentRef, data.departmentCode],
      ["positionTitle", resolvePositionRef, data.positionTitle],
    ] as const) {
      if (!code) continue;
      const resolved = await resolver(tx, ctx.organizationId, ctx.batchId, mode, code as string);
      if (!resolved.found) messages.push({ field, message: `"${code}" was not found`, severity: "error" });
    }

    if (messages.some((m) => m.severity === "error")) return { operation: "error", messages };
    return { operation: "create", messages };
  },

  async executeRow(tx, data, ctx) {
    const [branch, department, position] = await Promise.all([
      data.branchCode ? resolveBranchRef(tx, ctx.organizationId, ctx.batchId, "execute", data.branchCode as string) : null,
      data.departmentCode ? resolveDepartmentRef(tx, ctx.organizationId, ctx.batchId, "execute", data.departmentCode as string) : null,
      data.positionTitle ? resolvePositionRef(tx, ctx.organizationId, ctx.batchId, "execute", data.positionTitle as string) : null,
    ]);
    if (data.branchCode && !branch?.found) throw new Error(`Branch "${data.branchCode}" was not found`);
    if (data.departmentCode && !department?.found) throw new Error(`Department "${data.departmentCode}" was not found`);
    if (data.positionTitle && !position?.found) throw new Error(`Position "${data.positionTitle}" was not found`);

    const refs = { branchId: branch?.id ?? null, departmentId: department?.id ?? null, positionId: position?.id ?? null };
    // `tx` is passed so that in atomic execution this cross-organization
    // ownership check can see structure rows created earlier in the SAME
    // transaction. Without it an atomic batch importing a department and its
    // employees together would reject every employee.
    await assertEmployeeReferencesValid(ctx.organizationId, refs, tx);

    const [inserted] = await tx
      .insert(employeesTable)
      .values({
        organizationId: ctx.organizationId,
        firstName: data.firstName as string,
        lastName: data.lastName as string,
        employeeNumber: null,
        workEmail: (data.workEmail as string | null) ?? null,
        phoneNumber: (data.phoneNumber as string | null) ?? null,
        gender: (data.gender as (typeof genderEnum.enumValues)[number] | null) ?? undefined,
        dateOfBirth: (data.dateOfBirth as Date | null) ?? undefined,
        maritalStatus: (data.maritalStatus as (typeof maritalStatusEnum.enumValues)[number] | null) ?? undefined,
        employmentType: (data.employmentType as (typeof employmentTypeEnum.enumValues)[number] | null) ?? undefined,
        hireDate: (data.hireDate as Date | null) ?? undefined,
        ...refs,
        createdBy: ctx.actorApplicationUserId,
        updatedBy: ctx.actorApplicationUserId,
      })
      .returning();

    const employeeNumber = data.employeeNumber as string | null;
    const { allocation } = employeeNumber
      ? await allocateLegacyEmployeeNumber(tx, {
          organizationId: ctx.organizationId,
          employeeId: inserted.id,
          employeeNumber,
          actorMembershipId: ctx.actorMembershipId,
        })
      : await allocateGeneratedEmployeeNumber(tx, {
          organizationId: ctx.organizationId,
          employeeId: inserted.id,
          actorMembershipId: ctx.actorMembershipId,
        });

    await auditEmployeeNumberAllocated({
      organizationId: ctx.organizationId,
      employeeId: inserted.id,
      allocation,
      actorApplicationUserId: ctx.actorApplicationUserId,
      actorMembershipId: ctx.actorMembershipId,
    });

    const pifNumber = data.pifNumber as string | null;
    if (pifNumber) {
      try {
        await createLegacyPersonnelFile(tx, {
          organizationId: ctx.organizationId,
          employeeId: inserted.id,
          pifNumber,
          currentLocationId: null,
          actorMembershipId: ctx.actorMembershipId,
        });
      } catch (err) {
        if (err instanceof PifNumberCollisionError) throw new Error(err.message);
        throw err;
      }
    }

    return { status: "created", resultId: inserted.id };
  },
};
