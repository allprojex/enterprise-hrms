/**
 * Phase 3H, W115 — Personnel File Registry & PIF Linkage.
 *
 * `personnel_files` is a permanent, organization-owned, strictly 1:1
 * personnel-record identity (frozen plan §7a) — unlike employee/staff
 * numbers (W114), a PIF number is never released, reassigned, or reused
 * (Decision 4), so there is no allocation-history table here, only the one
 * permanent row. Reuses W114's numbering engine (its own independent
 * `numbering.pifNumber` config/sequence — never the same counter or config
 * as employeeNumber) for both generation and manual-override validation;
 * builds no second generator.
 *
 * Physical filing (location/volumes/movement) is deliberately out of scope
 * here — W116's own additive migration, not a placeholder column on this
 * table ahead of its own workstream.
 */
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import {
  db,
  employeesTable,
  personnelFilesTable,
  employeeNumberAllocationsTable,
  type Employee,
  type PersonnelFile,
} from "@workspace/db";
import { getNamespaceConfig } from "../services/organizationConfig";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";
import {
  type EmployeeNumberFormatConfig,
  resolvePeriodKey,
  formatGeneratedNumber,
  lockAndIncrementSequence,
  resolveTokenCodes,
} from "./numbering";

export class EmployeeNotFoundForPersonnelFileError extends Error {
  constructor() {
    super("Employee not found");
    this.name = "EmployeeNotFoundForPersonnelFileError";
  }
}

export class PersonnelFileAlreadyExistsError extends Error {
  constructor() {
    super("This employee already has a personnel file — exactly one personnel file exists per employee, permanently");
    this.name = "PersonnelFileAlreadyExistsError";
  }
}

export class PifNumberCollisionError extends Error {
  constructor() {
    super("This PIF/personnel-file number is already in use in this organization");
    this.name = "PifNumberCollisionError";
  }
}

export class InvalidManualPifNumberError extends Error {
  constructor() {
    super("A manual PIF/personnel-file number value is required");
    this.name = "InvalidManualPifNumberError";
  }
}

type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const PIF_NUMBER_SEQUENCE_KEY = "pif_number";
const MAX_GENERATED_PIF_ATTEMPTS = 20;

async function getPifNumberFormatConfig(organizationId: number): Promise<EmployeeNumberFormatConfig> {
  const config = await getNamespaceConfig(organizationId, "numbering");
  return (config.data.pifNumber as EmployeeNumberFormatConfig | undefined) ?? {};
}

async function lockEmployeeForPersonnelFile(
  tx: QueryClient,
  organizationId: number,
  employeeId: number,
): Promise<Employee> {
  const [employee] = await tx
    .select()
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .for("update");
  if (!employee) throw new EmployeeNotFoundForPersonnelFileError();

  const [existing] = await tx
    .select({ id: personnelFilesTable.id })
    .from(personnelFilesTable)
    .where(eq(personnelFilesTable.employeeId, employeeId))
    .limit(1);
  if (existing) throw new PersonnelFileAlreadyExistsError();

  return employee;
}

/**
 * Creates the permanent personnel file with an engine-generated PIF number.
 * Bounded retry-on-collision (mirrors allocateGeneratedEmployeeNumber's own
 * fix, W114) — the sequence increment always commits independently of this
 * attempt's own possible rollback, so a retry genuinely advances rather than
 * recomputing the same value. In practice PIF numbers have no legacy-data
 * collision risk (this table is new), but the same robust pattern is reused
 * for consistency rather than a weaker one-shot attempt.
 */
export async function createGeneratedPersonnelFile(
  client: QueryClient,
  params: { organizationId: number; employeeId: number; actorMembershipId: number | null },
): Promise<PersonnelFile> {
  const config = await getPifNumberFormatConfig(params.organizationId);
  const periodKey = resolvePeriodKey(config.resetPolicy, new Date());

  for (let attempt = 1; attempt <= MAX_GENERATED_PIF_ATTEMPTS; attempt++) {
    const sequenceValue = await lockAndIncrementSequence({
      organizationId: params.organizationId,
      sequenceKey: PIF_NUMBER_SEQUENCE_KEY,
      periodKey,
      startingSequence: config.startingSequence ?? 1,
    });

    try {
      return await client.transaction(async (tx) => {
        const employee = await lockEmployeeForPersonnelFile(tx, params.organizationId, params.employeeId);
        const { branchCode, departmentCode } = await resolveTokenCodes(tx, employee);
        const now = new Date();
        const pifNumber = formatGeneratedNumber(config, sequenceValue, {
          branchCode,
          departmentCode,
          year: now.getUTCFullYear(),
          month: now.getUTCMonth() + 1,
        });

        const [personnelFile] = await tx
          .insert(personnelFilesTable)
          .values({
            organizationId: params.organizationId,
            employeeId: params.employeeId,
            pifNumber,
            allocationMethod: "generated",
            allocatedByMembershipId: params.actorMembershipId,
          })
          .returning();

        return personnelFile;
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_GENERATED_PIF_ATTEMPTS) continue;
      if (isUniqueViolation(err)) throw new PifNumberCollisionError();
      throw err;
    }
  }
  throw new PifNumberCollisionError();
}

/** Creates the permanent personnel file with an HR-supplied PIF number — validated for organization-scoped uniqueness, never a weaker path than the generated one. */
export async function createManualPersonnelFile(
  client: QueryClient,
  params: { organizationId: number; employeeId: number; pifNumber: string; actorMembershipId: number | null },
): Promise<PersonnelFile> {
  const pifNumber = params.pifNumber.trim();
  if (!pifNumber) throw new InvalidManualPifNumberError();

  return client.transaction(async (tx) => {
    await lockEmployeeForPersonnelFile(tx, params.organizationId, params.employeeId);

    try {
      const [personnelFile] = await tx
        .insert(personnelFilesTable)
        .values({
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          pifNumber,
          allocationMethod: "manual",
          allocatedByMembershipId: params.actorMembershipId,
        })
        .returning();
      return personnelFile;
    } catch (err) {
      if (isUniqueViolation(err)) throw new PifNumberCollisionError();
      throw err;
    }
  });
}

export async function getPersonnelFileByEmployee(organizationId: number, employeeId: number): Promise<PersonnelFile | null> {
  const [row] = await db
    .select()
    .from(personnelFilesTable)
    .where(and(eq(personnelFilesTable.organizationId, organizationId), eq(personnelFilesTable.employeeId, employeeId)))
    .limit(1);
  return row ?? null;
}

export async function getPersonnelFileById(organizationId: number, personnelFileId: number): Promise<PersonnelFile | null> {
  const [row] = await db
    .select()
    .from(personnelFilesTable)
    .where(and(eq(personnelFilesTable.organizationId, organizationId), eq(personnelFilesTable.id, personnelFileId)))
    .limit(1);
  return row ?? null;
}

/**
 * The HR/records-facing search surface (frozen plan §10), deliberately
 * separate from lib/employees.ts's own listEmployees()/GET .../employees —
 * that route stays exactly as narrow as before (employee.read, held broadly
 * including by the plain "employee" role) and is never extended to expose
 * PIF or historical-number data. This function is reachable only through a
 * route gated by personnel_file.read (org_admin/hr_manager only), per the
 * frozen "do not depend on broad employee.read to expose new personnel-file
 * data" instruction.
 *
 * Each match becomes its own row, tagged by why it matched — a reused staff
 * number therefore never collapses to "the current holder": both a
 * historical and a current allocation matching the same search term appear
 * as two distinct, clearly-labeled results (frozen plan §10's own
 * reuse-ambiguity requirement).
 */
export interface PersonnelSearchResult {
  employeeId: number;
  firstName: string;
  lastName: string;
  employmentStatus: Employee["employmentStatus"];
  matchType: "name" | "employee_number" | "pif_number";
  matchedValue: string;
  isCurrentHolder: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  currentEmployeeNumber: string | null;
  pifNumber: string | null;
}

export async function searchPersonnelRecords(organizationId: number, searchTerm: string): Promise<PersonnelSearchResult[]> {
  const term = `%${searchTerm}%`;
  const nameCondition = or(
    ilike(employeesTable.firstName, term),
    ilike(employeesTable.lastName, term),
    ilike(employeesTable.preferredName, term),
  );

  const [nameMatches, allocationMatches, pifMatches] = await Promise.all([
    nameCondition
      ? db.select().from(employeesTable).where(and(eq(employeesTable.organizationId, organizationId), nameCondition))
      : Promise.resolve([]),
    db
      .select()
      .from(employeeNumberAllocationsTable)
      .where(and(eq(employeeNumberAllocationsTable.organizationId, organizationId), ilike(employeeNumberAllocationsTable.employeeNumber, term))),
    db
      .select()
      .from(personnelFilesTable)
      .where(and(eq(personnelFilesTable.organizationId, organizationId), ilike(personnelFilesTable.pifNumber, term))),
  ]);

  const employeeIds = new Set<number>([
    ...nameMatches.map((e) => e.id),
    ...allocationMatches.map((a) => a.employeeId),
    ...pifMatches.map((p) => p.employeeId),
  ]);
  if (employeeIds.size === 0) return [];

  const [employees, personnelFiles] = await Promise.all([
    db.select().from(employeesTable).where(and(eq(employeesTable.organizationId, organizationId), inArray(employeesTable.id, [...employeeIds]))),
    db
      .select()
      .from(personnelFilesTable)
      .where(and(eq(personnelFilesTable.organizationId, organizationId), inArray(personnelFilesTable.employeeId, [...employeeIds]))),
  ]);
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const pifByEmployeeId = new Map(personnelFiles.map((p) => [p.employeeId, p.pifNumber]));

  const results: PersonnelSearchResult[] = [];

  for (const e of nameMatches) {
    results.push({
      employeeId: e.id,
      firstName: e.firstName,
      lastName: e.lastName,
      employmentStatus: e.employmentStatus,
      matchType: "name",
      matchedValue: `${e.firstName} ${e.lastName}`,
      isCurrentHolder: true,
      validFrom: null,
      validTo: null,
      currentEmployeeNumber: e.employeeNumber,
      pifNumber: pifByEmployeeId.get(e.id) ?? null,
    });
  }
  for (const a of allocationMatches) {
    const e = employeeById.get(a.employeeId);
    if (!e) continue;
    results.push({
      employeeId: a.employeeId,
      firstName: e.firstName,
      lastName: e.lastName,
      employmentStatus: e.employmentStatus,
      matchType: "employee_number",
      matchedValue: a.employeeNumber,
      isCurrentHolder: a.validTo === null,
      validFrom: a.validFrom,
      validTo: a.validTo,
      currentEmployeeNumber: e.employeeNumber,
      pifNumber: pifByEmployeeId.get(a.employeeId) ?? null,
    });
  }
  for (const p of pifMatches) {
    const e = employeeById.get(p.employeeId);
    if (!e) continue;
    results.push({
      employeeId: p.employeeId,
      firstName: e.firstName,
      lastName: e.lastName,
      employmentStatus: e.employmentStatus,
      matchType: "pif_number",
      matchedValue: p.pifNumber,
      isCurrentHolder: true,
      validFrom: null,
      validTo: null,
      currentEmployeeNumber: e.employeeNumber,
      pifNumber: p.pifNumber,
    });
  }

  return results;
}

export async function auditPersonnelFileCreated(params: {
  organizationId: number;
  employeeId: number;
  personnelFile: PersonnelFile;
  actorApplicationUserId: number | null;
  actorMembershipId: number | null;
}): Promise<void> {
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "personnel_file.created",
    targetType: "employee",
    targetId: String(params.employeeId),
    afterState: {
      personnelFileId: params.personnelFile.id,
      pifNumber: params.personnelFile.pifNumber,
      allocationMethod: params.personnelFile.allocationMethod,
    },
  });
}
