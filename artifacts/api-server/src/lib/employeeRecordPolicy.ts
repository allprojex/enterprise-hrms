/**
 * Employee record write policy — Phase 1 of the WWM employee backend hardening
 * (2026-10-08). Pure, database-free rules shared by every path that writes an
 * employee record from client-supplied input (POST/PATCH .../employees and the
 * service functions behind them), so the HTTP layer, the service layer and the
 * tests all reason about exactly one definition of:
 *
 *   1. WHICH FIELDS ARE SENSITIVE TO WRITE. The set mirrors the read-side
 *      redaction in routes/employees.ts (`employee.sensitive.read`) field for
 *      field: identity, personal contact, residential address and emergency
 *      contacts. `notes` is governed by its own existing key
 *      (`employee.notes.read`) — HR notes are confidential by that rule, so a
 *      writer must at least be allowed to read what they are writing.
 *      Placement and employment fields (department, position, manager, hire
 *      date, type, work location, work email, names) stay on `employee.write`.
 *
 *   2. WHICH STATUS TRANSITIONS THE GENERIC UPDATE MAY PERFORM. Termination,
 *      rehire and probation confirmation are governed lifecycle actions with
 *      their own routes, employment-period history and audit events
 *      (lib/employees.ts separateEmployee/rehireEmployee/confirmEmployee).
 *      The generic update may move a record only between the administrative
 *      states {active, probation, on_leave, suspended}, and never OUT of
 *      `probation` into `active` (that is a confirmation) or into/out of
 *      `terminated` (separation/rehire). An unchanged status is always a no-op.
 *
 *   3. WHAT A VALID RESULTING RECORD LOOKS LIKE. Validation runs on the MERGED
 *      state (existing row + patch), never on the patch alone, so a partial
 *      update cannot leave the record internally inconsistent.
 *
 * No minimum employment age is enforced here: the Owner has not approved one,
 * so it is reported as a configurable policy decision rather than invented.
 */
import type { Employee } from "@workspace/db";
import { maskIdentifier } from "./sensitiveData";

export const EMPLOYEE_SENSITIVE_WRITE_PERMISSION = "employee.sensitive.write";
export const EMPLOYEE_NOTES_PERMISSION = "employee.notes.read";

/** Fields whose write requires `employee.sensitive.write` on top of `employee.write`. */
export const SENSITIVE_EMPLOYEE_WRITE_FIELDS = [
  "gender",
  "dateOfBirth",
  "maritalStatus",
  "nationality",
  "nationalId",
  "passportNumber",
  "personalEmail",
  "phoneNumber",
  "alternatePhoneNumber",
  "residentialAddress",
  "emergencyContacts",
] as const;

export type SensitiveEmployeeWriteField = (typeof SENSITIVE_EMPLOYEE_WRITE_FIELDS)[number];

const SENSITIVE_SET: ReadonlySet<string> = new Set(SENSITIVE_EMPLOYEE_WRITE_FIELDS);

export type EmploymentStatus = Employee["employmentStatus"];

/** Statuses the generic create/update path may set directly. */
export const ADMINISTRATIVE_EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = ["active", "probation", "on_leave", "suspended"];

export class EmployeeSensitiveWriteForbiddenError extends Error {
  readonly fields: readonly string[];
  readonly requiredPermission: string;
  constructor(fields: readonly string[], requiredPermission: string) {
    super(`Changing ${fields.join(", ")} requires the ${requiredPermission} permission`);
    this.name = "EmployeeSensitiveWriteForbiddenError";
    this.fields = fields;
    this.requiredPermission = requiredPermission;
  }
}

export class EmployeeStatusChangeNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeStatusChangeNotAllowedError";
  }
}

export class EmployeeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeeValidationError";
  }
}

/**
 * Splits a client-supplied write into the field names that need the
 * sensitive-write key and whether confidential notes are being written.
 *
 * What counts as a WRITE is decided against the PERSISTED record, never
 * against what the client claims: a sensitive field counts only when the
 * value the body carries differs from the stored value (the Edit form
 * re-sends every field it displays, so an HR user without the sensitive
 * key must still be able to save an unrelated change while an unchanged
 * phone number rides along). Rules, in order:
 *
 *   - omitted (`undefined`)            → not a write;
 *   - supplied and equal to stored     → not a write (null == null, "" == null,
 *                                        strings compared trimmed, dates by
 *                                        instant, json by value);
 *   - supplied and different           → a write, including clearing a value
 *                                        (value → null) and setting one
 *                                        (null → value).
 *
 * With no persisted record (creation) a sensitive field counts when it
 * carries a non-null value.
 */
export function partitionEmployeeWrite(
  fields: Record<string, unknown>,
  existing: Record<string, unknown> | null = null,
): {
  sensitiveFields: string[];
  writesNotes: boolean;
} {
  const isWrite = (key: string): boolean => {
    const value = fields[key];
    if (value === undefined) return false;
    if (existing == null) return value !== null;
    return !sameValue(existing[key], value);
  };
  const sensitiveFields = Object.keys(fields).filter((k) => SENSITIVE_SET.has(k) && isWrite(k));
  const writesNotes = isWrite("notes");
  return { sensitiveFields, writesNotes };
}

export interface EmployeeWriteAuthorization {
  canWriteSensitive: boolean;
  canWriteNotes: boolean;
}

/**
 * Fails closed BEFORE any write: a mixed body carrying one unauthorized
 * effective change is rejected as a whole, so an authorized general edit is
 * never partially applied beside a refused sensitive one. `existing` is the
 * persisted row for an update (so unchanged values are not writes) and null
 * for a creation.
 */
export function assertEmployeeWriteAuthorized(
  fields: Record<string, unknown>,
  authz: EmployeeWriteAuthorization,
  existing: Record<string, unknown> | null = null,
): void {
  const { sensitiveFields, writesNotes } = partitionEmployeeWrite(fields, existing);
  if (sensitiveFields.length > 0 && !authz.canWriteSensitive) {
    throw new EmployeeSensitiveWriteForbiddenError(sensitiveFields, EMPLOYEE_SENSITIVE_WRITE_PERMISSION);
  }
  if (writesNotes && !authz.canWriteNotes) {
    throw new EmployeeSensitiveWriteForbiddenError(["notes"], EMPLOYEE_NOTES_PERMISSION);
  }
}

/**
 * The sensitive fields a server-sourced record (a candidate converted to an
 * employee) carries that the actor may NOT write: these are dropped from the
 * copy, never written, and named in the audit trail so HR can complete them.
 */
export function omitUnauthorizedSensitiveFields<T extends Record<string, unknown>>(
  fields: T,
  authz: EmployeeWriteAuthorization,
): { fields: T; omitted: string[] } {
  if (authz.canWriteSensitive) return { fields, omitted: [] };
  const { sensitiveFields } = partitionEmployeeWrite(fields, null);
  if (sensitiveFields.length === 0) return { fields, omitted: [] };
  const copy: Record<string, unknown> = { ...fields };
  for (const key of sensitiveFields) delete copy[key];
  return { fields: copy as T, omitted: sensitiveFields };
}

/**
 * The generic update's status matrix. Returns normally when the transition is
 * permitted (or is not a change); throws with the action the caller should use
 * otherwise. Deliberately names the governed action rather than silently
 * redirecting into it — separation needs a date and reason, rehire and
 * confirmation need an effective date, and inventing those would fabricate
 * history.
 */
export function assertStatusChangeAllowedViaUpdate(current: EmploymentStatus, next: EmploymentStatus | undefined): void {
  if (next === undefined || next === current) return;
  if (next === "terminated") {
    throw new EmployeeStatusChangeNotAllowedError(
      "An employee cannot be terminated through a profile update. Use the separation action, which records the separation date, reason and employment history.",
    );
  }
  if (current === "terminated") {
    throw new EmployeeStatusChangeNotAllowedError(
      "A separated employee cannot be reactivated through a profile update. Use the rehire action, which records the new employment period.",
    );
  }
  if (current === "probation" && next === "active") {
    throw new EmployeeStatusChangeNotAllowedError(
      "Completing probation is a confirmation. Use the confirmation action, which records the effective date and any probation review.",
    );
  }
  if (!ADMINISTRATIVE_EMPLOYMENT_STATUSES.includes(next)) {
    throw new EmployeeStatusChangeNotAllowedError(`Employment status "${next}" cannot be set through a profile update`);
  }
}

/** On creation only the administrative states are meaningful — a record is never born separated. */
export function assertInitialStatusAllowed(status: EmploymentStatus | undefined): void {
  if (status === undefined) return;
  if (!ADMINISTRATIVE_EMPLOYMENT_STATUSES.includes(status)) {
    throw new EmployeeStatusChangeNotAllowedError(
      `A new employee cannot be created with status "${status}". Create the record and then use the separation action, or the governed legacy import for historical records.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Field-format and date-consistency validation on the merged record.
// ---------------------------------------------------------------------------

// Pragmatic address shape: one "@", no whitespace, a dotted domain. Not a
// full RFC 5322 parser — the point is to stop plainly malformed values
// (missing "@", spaces) reaching the record, not to arbitrate edge cases.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
// Identical shape to custom-field phone values (lib/customFields/fieldTypes.ts)
// and the account-profile phone rule (lib/accountProfile.ts): optional leading
// "+", then 6–32 digits/spaces/()/-. Accepts Ghanaian local (0244123456) and
// international (+233 24 412 3456) forms without pretending to be E.164.
const PHONE_RE = /^\+?[0-9\s()-]{6,32}$/;
const MIN_PHONE_DIGITS = 6;

function isBlank(value: unknown): value is null | undefined | "" {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function isValidEmailAddress(value: string): boolean {
  return value.length <= EMAIL_MAX && EMAIL_RE.test(value);
}

export function isValidPhoneNumber(value: string): boolean {
  return PHONE_RE.test(value) && value.replace(/\D/g, "").length >= MIN_PHONE_DIGITS;
}

/** The subset of the record the date/format rules reason about. */
export interface EmployeeRecordState {
  workEmail?: string | null;
  personalEmail?: string | null;
  phoneNumber?: string | null;
  alternatePhoneNumber?: string | null;
  dateOfBirth?: Date | null;
  hireDate?: Date | null;
  probationEndDate?: Date | null;
  separationDate?: Date | null;
}

function startOfToday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dayOf(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function assertRealDate(value: Date | null | undefined, label: string): void {
  if (value == null) return;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new EmployeeValidationError(`${label} is not a valid date`);
}

/**
 * Format rules for the values a request SUPPLIES. Applied to the request
 * fields only, deliberately: a legacy record holding a malformed phone number
 * from before these rules existed must stay editable (HR can still move that
 * person to a new department) — the stored value is neither rewritten nor
 * allowed to block an unrelated change. The moment that field is itself
 * written, the rule applies.
 */
export function validateEmployeeFieldFormats(fields: EmployeeRecordState): void {
  for (const [key, label] of [
    ["workEmail", "Work email"],
    ["personalEmail", "Personal email"],
  ] as const) {
    const value = fields[key];
    if (!isBlank(value) && !isValidEmailAddress(value)) throw new EmployeeValidationError(`${label} is not a valid email address`);
  }
  for (const [key, label] of [
    ["phoneNumber", "Phone number"],
    ["alternatePhoneNumber", "Alternative phone number"],
  ] as const) {
    const value = fields[key];
    if (!isBlank(value) && !isValidPhoneNumber(value)) throw new EmployeeValidationError(`${label} is not a valid phone number`);
  }
}

/**
 * Cross-field date rules on the RESULTING record. Callers merge the stored
 * row with the patch first, so a request that touches only `hireDate` is
 * still checked against the stored date of birth, probation end and
 * separation date — a partial update can never leave the dates inconsistent.
 */
export function validateEmployeeDateConsistency(state: EmployeeRecordState, now: Date = new Date()): void {
  assertRealDate(state.dateOfBirth, "Date of birth");
  assertRealDate(state.hireDate, "Hire date");
  assertRealDate(state.probationEndDate, "Probation end date");
  assertRealDate(state.separationDate, "Separation date");

  const today = startOfToday(now).getTime();
  if (state.dateOfBirth && dayOf(state.dateOfBirth) > today) {
    throw new EmployeeValidationError("Date of birth cannot be in the future");
  }
  if (state.dateOfBirth && state.hireDate && dayOf(state.hireDate) < dayOf(state.dateOfBirth)) {
    throw new EmployeeValidationError("Hire date cannot be earlier than the date of birth");
  }
  if (state.hireDate && state.probationEndDate && dayOf(state.probationEndDate) < dayOf(state.hireDate)) {
    throw new EmployeeValidationError("Probation end date cannot be earlier than the hire date");
  }
  if (state.hireDate && state.separationDate && dayOf(state.separationDate) < dayOf(state.hireDate)) {
    throw new EmployeeValidationError("Separation date cannot be earlier than the hire date");
  }
}

// ---------------------------------------------------------------------------
// Audit payload shaping. Changed field NAMES are always recorded; VALUES are
// recorded only in a form that cannot disclose a sensitive value.
// ---------------------------------------------------------------------------

/** Fields whose values never appear in general audit metadata in the clear. */
const AUDIT_MASKED_FIELDS: ReadonlySet<string> = new Set([...SENSITIVE_EMPLOYEE_WRITE_FIELDS, "notes", "separationReason"]);

/** Columns that are bookkeeping, never "changes" an actor made. */
const AUDIT_IGNORED_FIELDS: ReadonlySet<string> = new Set(["updatedAt", "updatedBy", "createdAt", "createdBy", "id", "organizationId"]);

export function maskEmployeeAuditValue(field: string, value: unknown): unknown {
  if (value == null) return null;
  if (!AUDIT_MASKED_FIELDS.has(field)) return value;
  if (typeof value === "string") return maskIdentifier(value);
  return "***";
}

/** Blank strings and null are the same absence; strings compare trimmed. */
function normalizeScalar(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  return v;
}

/**
 * Value equality used for both "is this a write?" and the audit diff:
 * dates by instant, json by structural value, strings trimmed with "" ≡ null.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a == null ? null : new Date(String(a)).getTime();
    const tb = b instanceof Date ? b.getTime() : b == null ? null : new Date(String(b)).getTime();
    return ta === tb;
  }
  const na = normalizeScalar(a);
  const nb = normalizeScalar(b);
  if (na == null && nb == null) return true;
  if (typeof na === "object" || typeof nb === "object") return JSON.stringify(na ?? null) === JSON.stringify(nb ?? null);
  return na === nb;
}

export interface EmployeeChangeSummary {
  changedFields: string[];
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
}

/**
 * Diff of a stored row against its updated form, restricted to the fields the
 * caller actually sent, with every sensitive value masked. Used for the
 * `employee.updated` audit event.
 */
export function summarizeEmployeeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  requestedFields: Iterable<string>,
): EmployeeChangeSummary {
  const changedFields: string[] = [];
  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const field of requestedFields) {
    if (AUDIT_IGNORED_FIELDS.has(field)) continue;
    if (sameValue(before[field], after[field])) continue;
    changedFields.push(field);
    beforeState[field] = maskEmployeeAuditValue(field, before[field]);
    afterState[field] = maskEmployeeAuditValue(field, after[field]);
  }
  return { changedFields, beforeState, afterState };
}

/** Masked snapshot of the fields set on a freshly created record, for `employee.created`. */
export function summarizeEmployeeCreation(fields: Record<string, unknown>): { setFields: string[]; afterState: Record<string, unknown> } {
  const setFields: string[] = [];
  const afterState: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (AUDIT_IGNORED_FIELDS.has(field) || value === undefined || value === null) continue;
    setFields.push(field);
    afterState[field] = maskEmployeeAuditValue(field, value);
  }
  return { setFields, afterState };
}
