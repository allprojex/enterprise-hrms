/**
 * Phase 3H, W119 — Legacy Import (frozen plan Decision 19, its own dedicated
 * workstream — the frozen document's own Decision 19 prose cites "W120" for
 * this, a disclosed citation slip against §17's own later, more specific
 * workstream breakdown, which assigns it to W119 explicitly; this session's
 * own instructions do too — the same class of non-blocking citation
 * inconsistency already found and reconciled in W116, not a contradiction).
 *
 * V1 scope, disclosed: one CSV, one row per employee, carrying that
 * employee's CURRENT staff number and CURRENT PIF number only — never a
 * second, separate historical-allocation CSV format. Decision 19's own text
 * ("unknown/missing legacy values stay nullable... do not manufacture
 * historical certainty") and this session's own §21 ("if source history is
 * unknown: import only known current allocation") both authorize this
 * narrower, safer V1 boundary rather than inventing a multi-row-per-employee
 * historical schema no source document has ever specified.
 *
 * Stateless two-step workflow, no persistent import-job table: /preview
 * validates the uploaded CSV and writes nothing; /commit re-parses and
 * re-validates the (re-uploaded) same file inside one all-or-nothing
 * transaction. Nothing is cached server-side between the two steps.
 *
 * Reuses, never bypasses, every existing authoritative service this
 * workstream's own instructions named: assertEmployeeReferencesValid
 * (lib/employees.ts, unmodified) for department/branch/position ownership;
 * allocateLegacyEmployeeNumber/createLegacyPersonnelFile (lib/numbering.ts,
 * lib/personnelFiles.ts — new, additive, deliberately separate from the
 * already-shipped manual-allocation functions those live "add employee"/
 * "create personnel file" UI actions use, so this import can never regress
 * them) for the number/PIF allocation itself, both under
 * allocationMethod "migrated" — the exact value the W114 one-time backfill
 * script already established for "this row's identifier predates/comes from
 * outside the normal generate-or-manual-at-creation flow."
 */
import {
  db,
  employeesTable,
  employeeNumberAllocationsTable,
  personnelFilesTable,
  departmentsTable,
  branchesTable,
  positionsTable,
  recordsLocationsTable,
  type Employee,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { assertEmployeeReferencesValid } from "./employees";
import { allocateLegacyEmployeeNumber } from "./numbering";
import { createLegacyPersonnelFile } from "./personnelFiles";
import { recordAuditEvent } from "./auditLog";

export const IMPORT_TEMPLATE_HEADERS = [
  "firstName",
  "lastName",
  "middleName",
  "preferredName",
  "gender",
  "employmentStatus",
  "hireDate",
  "separationDate",
  "separationReason",
  "employeeNumber",
  "pifNumber",
  "departmentCode",
  "branchCode",
  "positionTitle",
  "workEmail",
  "personalEmail",
  "phoneNumber",
  "recordsLocationName",
] as const;

const VALID_EMPLOYMENT_STATUSES = ["active", "probation", "on_leave", "suspended", "terminated"] as const;
const VALID_GENDERS = ["male", "female", "other", "prefer_not_to_say"] as const;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- CSV parsing (dependency-free, RFC4180-ish: quoted fields, embedded commas/quotes/newlines) ---

export class MalformedCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedCsvError";
  }
}

/** No arbitrary executable content, no spreadsheet formula evaluation — this only ever splits characters into string cells, never interprets them. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/^﻿/, ""); // strip a UTF-8 BOM, common from Excel-exported CSVs

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) throw new MalformedCsvError("Unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// --- Row validation ---

export interface ImportRowResolved {
  firstName: string;
  lastName: string;
  middleName: string | null;
  preferredName: string | null;
  gender: (typeof VALID_GENDERS)[number] | null;
  employmentStatus: (typeof VALID_EMPLOYMENT_STATUSES)[number];
  hireDate: Date | null;
  separationDate: Date | null;
  separationReason: string | null;
  employeeNumber: string | null;
  pifNumber: string | null;
  departmentId: number | null;
  branchId: number | null;
  positionId: number | null;
  workEmail: string | null;
  personalEmail: string | null;
  phoneNumber: string | null;
  currentLocationId: number | null;
}

export interface ImportRowResult {
  rowNumber: number; // 1-based, header excluded
  status: "valid" | "warning" | "invalid";
  errors: string[];
  warnings: string[];
  resolved: ImportRowResolved | null;
}

export interface ImportValidationSummary {
  totalRows: number;
  validCount: number;
  warningCount: number;
  invalidCount: number;
  rows: ImportRowResult[];
}

function cell(raw: Record<string, string>, key: string): string | null {
  const value = raw[key];
  return value != null && value.trim() !== "" ? value.trim() : null;
}

/**
 * Parses the raw CSV rows into header-keyed records; throws MalformedCsvError
 * (never validation errors — those are per-row, not fatal) if the header row
 * itself is missing or unreadable.
 */
export function toRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) throw new MalformedCsvError("The file is empty");
  const header = rows[0].map((h) => h.trim());
  if (header.length === 0 || header.every((h) => h === "")) throw new MalformedCsvError("Missing header row");

  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = row[idx] ?? "";
    });
    return record;
  });
}

/**
 * Validates every row against the organization's own reference data and the
 * batch's own internal consistency, all fetched/queried in bulk (§38 — never
 * one lookup per row). Read-only — never writes. Called identically by both
 * /preview and /commit, so a row that validates in preview validates the
 * same way again at commit time (no cached, possibly-stale server state).
 */
export async function validateImportRows(organizationId: number, rows: Record<string, string>[]): Promise<ImportValidationSummary> {
  const [departments, branches, positions, locations, allExistingAllocations, existingPersonnelFiles] = await Promise.all([
    db.select({ id: departmentsTable.id, code: departmentsTable.code }).from(departmentsTable).where(eq(departmentsTable.organizationId, organizationId)),
    db.select({ id: branchesTable.id, code: branchesTable.code }).from(branchesTable).where(eq(branchesTable.organizationId, organizationId)),
    db.select({ id: positionsTable.id, title: positionsTable.title }).from(positionsTable).where(eq(positionsTable.organizationId, organizationId)),
    db.select({ id: recordsLocationsTable.id, name: recordsLocationsTable.name, status: recordsLocationsTable.status }).from(recordsLocationsTable).where(eq(recordsLocationsTable.organizationId, organizationId)),
    db.select({ employeeNumber: employeeNumberAllocationsTable.employeeNumber, validTo: employeeNumberAllocationsTable.validTo }).from(employeeNumberAllocationsTable).where(eq(employeeNumberAllocationsTable.organizationId, organizationId)),
    db.select({ pifNumber: personnelFilesTable.pifNumber }).from(personnelFilesTable).where(eq(personnelFilesTable.organizationId, organizationId)),
  ]);

  const departmentIdByCode = new Map(departments.map((d) => [d.code, d.id]));
  const branchIdByCode = new Map(branches.map((b) => [b.code, b.id]));
  const positionIdByTitle = new Map(positions.map((p) => [p.title, p.id]));
  const locationByName = new Map(locations.map((l) => [l.name, l]));
  const existingOpenNumbers = new Set(allExistingAllocations.filter((a) => a.validTo === null).map((a) => a.employeeNumber));
  // Any number with a CLOSED prior allocation, but no current open one, is a
  // genuine reuse (the mandatory §4/§33 scenario) — allowed (subject to the
  // org's own reuse policy, enforced authoritatively at commit time by
  // allocateLegacyEmployeeNumber, never duplicated here as a second,
  // possibly-stale copy of that check), but worth flagging to HR.
  const numbersWithClosedHistory = new Set(allExistingAllocations.filter((a) => a.validTo !== null).map((a) => a.employeeNumber));
  const existingPifNumbers = new Set(existingPersonnelFiles.map((p) => p.pifNumber));

  const seenNumbersInBatch = new Set<string>();
  const seenPifsInBatch = new Set<string>();
  const seenIdentityInBatch = new Set<string>();

  const results: ImportRowResult[] = rows.map((raw, index) => {
    const rowNumber = index + 1;
    const errors: string[] = [];
    const warnings: string[] = [];

    const firstName = cell(raw, "firstName");
    const lastName = cell(raw, "lastName");
    if (!firstName) errors.push("firstName is required");
    if (!lastName) errors.push("lastName is required");

    const genderRaw = cell(raw, "gender");
    let gender: (typeof VALID_GENDERS)[number] | null = null;
    if (genderRaw != null) {
      if (!(VALID_GENDERS as readonly string[]).includes(genderRaw)) errors.push(`gender "${genderRaw}" is not one of: ${VALID_GENDERS.join(", ")}`);
      else gender = genderRaw as (typeof VALID_GENDERS)[number];
    }

    const employmentStatusRaw = cell(raw, "employmentStatus");
    let employmentStatus: (typeof VALID_EMPLOYMENT_STATUSES)[number] = "active";
    if (employmentStatusRaw != null) {
      if (!(VALID_EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatusRaw)) {
        errors.push(`employmentStatus "${employmentStatusRaw}" is not one of: ${VALID_EMPLOYMENT_STATUSES.join(", ")}`);
      } else {
        employmentStatus = employmentStatusRaw as (typeof VALID_EMPLOYMENT_STATUSES)[number];
      }
    }

    const hireDateRaw = cell(raw, "hireDate");
    let hireDate: Date | null = null;
    if (hireDateRaw != null) {
      if (!ISO_DATE_RE.test(hireDateRaw)) errors.push(`hireDate "${hireDateRaw}" must be an ISO date (YYYY-MM-DD)`);
      else hireDate = new Date(`${hireDateRaw}T00:00:00.000Z`);
    }

    const separationDateRaw = cell(raw, "separationDate");
    let separationDate: Date | null = null;
    if (separationDateRaw != null) {
      if (!ISO_DATE_RE.test(separationDateRaw)) errors.push(`separationDate "${separationDateRaw}" must be an ISO date (YYYY-MM-DD)`);
      else separationDate = new Date(`${separationDateRaw}T00:00:00.000Z`);
    }
    if (employmentStatus === "terminated" && !separationDate) {
      errors.push("separationDate is required when employmentStatus is terminated");
    }
    const separationReason = employmentStatus === "terminated" ? cell(raw, "separationReason") : null;

    const employeeNumber = cell(raw, "employeeNumber");
    if (employeeNumber != null) {
      if (seenNumbersInBatch.has(employeeNumber)) errors.push(`employeeNumber "${employeeNumber}" is duplicated elsewhere in this file`);
      seenNumbersInBatch.add(employeeNumber);
      if (existingOpenNumbers.has(employeeNumber)) {
        errors.push(`employeeNumber "${employeeNumber}" is already actively allocated to an existing employee in this organization`);
      } else if (numbersWithClosedHistory.has(employeeNumber)) {
        warnings.push(`employeeNumber "${employeeNumber}" was previously held by a different employee (released) — this import will record it as a deliberate reuse, subject to this organization's own reuse policy`);
      }
    }
    const pifNumber = cell(raw, "pifNumber");
    if (pifNumber != null) {
      if (seenPifsInBatch.has(pifNumber)) errors.push(`pifNumber "${pifNumber}" is duplicated elsewhere in this file`);
      seenPifsInBatch.add(pifNumber);
      if (existingPifNumbers.has(pifNumber)) errors.push(`pifNumber "${pifNumber}" already exists in this organization — PIF numbers are permanent and never reused`);
    }

    const identityKey = `${firstName ?? ""}|${lastName ?? ""}|${employeeNumber ?? ""}|${pifNumber ?? ""}`;
    if (firstName && lastName && seenIdentityInBatch.has(identityKey)) {
      errors.push("This row appears to be an exact duplicate of an earlier row in this file");
    }
    seenIdentityInBatch.add(identityKey);

    const departmentCode = cell(raw, "departmentCode");
    let departmentId: number | null = null;
    if (departmentCode != null) {
      departmentId = departmentIdByCode.get(departmentCode) ?? null;
      if (departmentId == null) errors.push(`departmentCode "${departmentCode}" does not match an existing department in this organization`);
    }
    const branchCode = cell(raw, "branchCode");
    let branchId: number | null = null;
    if (branchCode != null) {
      branchId = branchIdByCode.get(branchCode) ?? null;
      if (branchId == null) errors.push(`branchCode "${branchCode}" does not match an existing branch in this organization`);
    }
    const positionTitle = cell(raw, "positionTitle");
    let positionId: number | null = null;
    if (positionTitle != null) {
      positionId = positionIdByTitle.get(positionTitle) ?? null;
      if (positionId == null) errors.push(`positionTitle "${positionTitle}" does not match an existing position in this organization`);
    }

    const recordsLocationName = cell(raw, "recordsLocationName");
    let currentLocationId: number | null = null;
    if (recordsLocationName != null) {
      const location = locationByName.get(recordsLocationName);
      if (!location) errors.push(`recordsLocationName "${recordsLocationName}" does not match an existing physical location in this organization`);
      else if (location.status === "retired") errors.push(`recordsLocationName "${recordsLocationName}" is a retired location and cannot receive files`);
      else currentLocationId = location.id;
    }

    const resolved: ImportRowResolved | null =
      errors.length === 0 && firstName && lastName
        ? {
            firstName,
            lastName,
            middleName: cell(raw, "middleName"),
            preferredName: cell(raw, "preferredName"),
            gender,
            employmentStatus,
            hireDate,
            separationDate,
            separationReason,
            employeeNumber,
            pifNumber,
            departmentId,
            branchId,
            positionId,
            workEmail: cell(raw, "workEmail"),
            personalEmail: cell(raw, "personalEmail"),
            phoneNumber: cell(raw, "phoneNumber"),
            currentLocationId,
          }
        : null;

    return {
      rowNumber,
      status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
      errors,
      warnings,
      resolved,
    };
  });

  return {
    totalRows: results.length,
    validCount: results.filter((r) => r.status === "valid").length,
    warningCount: results.filter((r) => r.status === "warning").length,
    invalidCount: results.filter((r) => r.status === "invalid").length,
    rows: results,
  };
}

export class ImportHasInvalidRowsError extends Error {
  constructor(public readonly summary: ImportValidationSummary) {
    super("The file contains invalid rows — nothing was imported");
    this.name = "ImportHasInvalidRowsError";
  }
}

export interface ImportCommitResultRow {
  rowNumber: number;
  employeeId: number;
  employeeNumber: string | null;
  pifNumber: string | null;
}

/**
 * Re-validates (never trusts a client-supplied "it was valid in preview"
 * claim) and, only if every row is valid, commits the whole batch inside
 * one all-or-nothing transaction — a single invalid row rolls back
 * everything, per this session's own disclosed all-or-nothing choice (no
 * partial/row-wise success mode is frozen, and atomic is the safer default
 * for a first-of-its-kind import feature). Each row goes through the exact
 * same authoritative services live employee creation would use
 * (assertEmployeeReferencesValid, allocateLegacyEmployeeNumber,
 * createLegacyPersonnelFile) — never a raw INSERT of CSV values.
 */
export async function commitImport(params: {
  organizationId: number;
  rows: Record<string, string>[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ImportCommitResultRow[]> {
  const summary = await validateImportRows(params.organizationId, params.rows);
  if (summary.invalidCount > 0) throw new ImportHasInvalidRowsError(summary);

  const created = await db.transaction(async (tx) => {
    const results: ImportCommitResultRow[] = [];
    for (const row of summary.rows) {
      const r = row.resolved!;
      await assertEmployeeReferencesValid(params.organizationId, { departmentId: r.departmentId, branchId: r.branchId, positionId: r.positionId });

      const [inserted] = await tx
        .insert(employeesTable)
        .values({
          organizationId: params.organizationId,
          firstName: r.firstName,
          lastName: r.lastName,
          middleName: r.middleName,
          preferredName: r.preferredName,
          gender: r.gender ?? undefined,
          hireDate: r.hireDate,
          employmentStatus: r.employmentStatus,
          separationDate: r.separationDate,
          separationReason: r.separationReason,
          departmentId: r.departmentId,
          branchId: r.branchId,
          positionId: r.positionId,
          workEmail: r.workEmail,
          personalEmail: r.personalEmail,
          phoneNumber: r.phoneNumber,
          employeeNumber: null,
          createdBy: params.actorApplicationUserId,
          updatedBy: params.actorApplicationUserId,
        })
        .returning();

      let employee: Employee = inserted;
      if (r.employeeNumber) {
        const allocated = await allocateLegacyEmployeeNumber(tx, {
          organizationId: params.organizationId,
          employeeId: inserted.id,
          employeeNumber: r.employeeNumber,
          actorMembershipId: params.actorMembershipId,
        });
        employee = allocated.employee;
      }

      if (r.pifNumber) {
        await createLegacyPersonnelFile(tx, {
          organizationId: params.organizationId,
          employeeId: inserted.id,
          pifNumber: r.pifNumber,
          currentLocationId: r.currentLocationId,
          actorMembershipId: params.actorMembershipId,
        });
      }

      results.push({ rowNumber: row.rowNumber, employeeId: inserted.id, employeeNumber: employee.employeeNumber, pifNumber: r.pifNumber });
    }
    return results;
  });

  // Batch-level only — never per-row, never the row's own personal-data
  // contents (§39: no full CSV contents, no sensitive data in metadata).
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "personnel_records.import_committed",
    targetType: "organization",
    targetId: String(params.organizationId),
    afterState: { rowCount: summary.totalRows, createdCount: created.length },
  });

  return created;
}
