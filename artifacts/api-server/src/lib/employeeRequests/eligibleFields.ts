import { z } from "zod/v4";
import { employeesTable } from "@workspace/db";
import { maskIdentifier } from "../sensitiveData";

/**
 * WS-13 — the eligible-field registry (§29.3).
 *
 * THIS FILE IS THE WHOLE SECURITY BOUNDARY OF EMPLOYEE DATA CHANGE, so read the
 * reasoning before adding to it.
 *
 * `employees` mixes three ownership classes in a single row (§29.1(9)):
 * personal and contact fields; WS-11 lifecycle fields (`employmentStatus`,
 * `positionId`, `departmentId`, `separationDate`, `probationEndDate`); and
 * pointers to payroll-owned sensitive records. A registry keyed on "this column
 * exists" would therefore hand WS-13 a route into separation, promotion and
 * banking. So the registry is an explicit ALLOW-LIST of personal/profile fields,
 * and everything else is excluded BY CONSTRUCTION rather than by a rule someone
 * could misconfigure.
 *
 * NO ORGANIZATION CONFIGURATION CAN ADD A FIELD HERE (§29.4). Configuration only
 * chooses, for a field already in this list, whether changing it needs approval.
 * A stored policy row naming a key that is not registered is inert — it is not
 * an escape hatch.
 *
 * §29.26 ITEM 3 RESOLVED — THIS LIVES BESIDE THE SERVICE, NOT IN @workspace/db.
 * It governs what the platform may WRITE, not what the column may hold. Putting
 * it next to the schema would imply a database constraint that deliberately
 * does not exist, and would invite someone to "finish the job" by generating it
 * from the table definition — which is exactly the "any column" mechanism §29.3
 * forbids. WS-11's event-type registry sits beside its service for the same
 * reason (§27.22 item 4).
 *
 * WHAT IS DELIBERATELY ABSENT, and must stay absent:
 *   employmentStatus, separationDate, separationReason, probationEndDate,
 *   hireDate, positionId, departmentId, branchId, reportingManagerId,
 *   workLocation, employmentType   — WS-11 owns these transitions.
 *   employeeNumber                 — identity; the numbering service owns it.
 *   profilePictureKey              — has its own self-service path already.
 *   notes                          — HR free text, not a personnel data point.
 *   banking / statutory identifiers— Payroll-owned, in their own tables.
 *   anything in roles, permissions, MFA or administrator status.
 */

export type EligibleFieldValueKind = "string" | "date" | "enum" | "json";

export interface EligibleField {
  /** Stable key used by the API, configuration, audit and reporting. Never a raw column name from a client. */
  key: string;
  /** Human label for UI and audit readability. */
  label: string;
  /** The authoritative column this key maps to. The mapping lives here, not in a request. */
  column: keyof typeof employeesTable.$inferSelect;
  kind: EligibleFieldValueKind;
  /** Validation applied to the REQUESTED value before a request is ever stored. */
  schema: z.ZodType;
  /** May an employee request this on their own record? */
  essEligible: boolean;
  /** May HR propose this on another employee's record? */
  hrEligible: boolean;
  /**
   * The product default when an organization has configured nothing. `true`
   * means approval is required unless an organization deliberately relaxes it.
   */
  defaultApprovalRequired: boolean;
  /**
   * Sensitive values are masked in approval DTOs, chronology `details`, audit
   * metadata, notifications and reports (§29.7, §29.16, §29.19). The full value
   * still reaches the authoritative column on application — masking governs who
   * may SEE it, not what is stored.
   */
  sensitive: boolean;
}

const optionalText = (max: number) => z.string().trim().max(max).nullable();

/**
 * The emergency-contact shape. Validated rather than accepted as free JSON,
 * because "it is a jsonb column" is not a reason to let a client store anything.
 */
const emergencyContactSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(200),
    relationship: z.string().trim().max(100).optional(),
    phoneNumber: z.string().trim().max(50).optional(),
    alternatePhoneNumber: z.string().trim().max(50).optional(),
    address: z.string().trim().max(500).optional(),
  }),
);

const residentialAddressSchema = z.object({
  line1: z.string().trim().max(300).optional(),
  line2: z.string().trim().max(300).optional(),
  city: z.string().trim().max(150).optional(),
  region: z.string().trim().max(150).optional(),
  postalCode: z.string().trim().max(50).optional(),
  country: z.string().trim().max(150).optional(),
});

export const ELIGIBLE_FIELDS: readonly EligibleField[] = [
  {
    key: "firstName",
    label: "First name",
    column: "firstName",
    kind: "string",
    schema: z.string().trim().min(1).max(200),
    essEligible: true,
    hrEligible: true,
    // A legal-name change is exactly the kind of thing that should be checked.
    defaultApprovalRequired: true,
    sensitive: false,
  },
  {
    key: "middleName",
    label: "Middle name",
    column: "middleName",
    kind: "string",
    schema: optionalText(200),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: true,
    sensitive: false,
  },
  {
    key: "lastName",
    label: "Last name",
    column: "lastName",
    kind: "string",
    schema: z.string().trim().min(1).max(200),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: true,
    sensitive: false,
  },
  {
    key: "preferredName",
    label: "Preferred name",
    column: "preferredName",
    kind: "string",
    schema: optionalText(200),
    essEligible: true,
    hrEligible: true,
    // What somebody wishes to be called is not a control point.
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "dateOfBirth",
    label: "Date of birth",
    column: "dateOfBirth",
    kind: "date",
    schema: z.iso.datetime({ offset: true }).or(z.iso.date()),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: true,
    sensitive: false,
  },
  {
    key: "gender",
    label: "Gender",
    column: "gender",
    kind: "enum",
    schema: z.enum(["male", "female", "other", "prefer_not_to_say"]).nullable(),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "maritalStatus",
    label: "Marital status",
    column: "maritalStatus",
    kind: "enum",
    schema: z.enum(["single", "married", "divorced", "widowed", "other"]).nullable(),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "nationality",
    label: "Nationality",
    column: "nationality",
    kind: "string",
    schema: optionalText(150),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: true,
    sensitive: false,
  },
  {
    key: "nationalId",
    label: "National ID",
    column: "nationalId",
    kind: "string",
    schema: optionalText(100),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: true,
    // A statutory identifier. Masked everywhere it is displayed, using WS-3's
    // existing helper rather than a second implementation (OD #23).
    sensitive: true,
  },
  {
    key: "passportNumber",
    label: "Passport number",
    column: "passportNumber",
    kind: "string",
    schema: optionalText(100),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: true,
    sensitive: true,
  },
  {
    key: "personalEmail",
    label: "Personal email",
    column: "personalEmail",
    kind: "string",
    schema: z.email().max(320).nullable(),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "workEmail",
    label: "Work email",
    column: "workEmail",
    kind: "string",
    schema: z.email().max(320).nullable(),
    // HR-owned: an employee does not assign themselves a work address.
    essEligible: false,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "phoneNumber",
    label: "Phone number",
    column: "phoneNumber",
    kind: "string",
    schema: optionalText(50),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "alternatePhoneNumber",
    label: "Alternate phone number",
    column: "alternatePhoneNumber",
    kind: "string",
    schema: optionalText(50),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "residentialAddress",
    label: "Residential address",
    column: "residentialAddress",
    kind: "json",
    schema: residentialAddressSchema.nullable(),
    essEligible: true,
    hrEligible: true,
    defaultApprovalRequired: false,
    sensitive: false,
  },
  {
    key: "emergencyContacts",
    label: "Emergency contacts",
    column: "emergencyContacts",
    kind: "json",
    schema: emergencyContactSchema.nullable(),
    essEligible: true,
    hrEligible: true,
    // The one an employee most needs to fix quickly, and the least consequential
    // to the organization if they do.
    defaultApprovalRequired: false,
    sensitive: false,
  },
] as const;

const BY_KEY = new Map(ELIGIBLE_FIELDS.map((f) => [f.key, f]));

export class UnknownEligibleFieldError extends Error {
  constructor(key: string) {
    super(
      `"${key}" is not a field this platform allows to be changed through a data-change request. ` +
        `Employment, payroll, leave, access and other specialist-module fields are owned by their own modules.`,
    );
    this.name = "UnknownEligibleFieldError";
  }
}

export class FieldNotEligibleForOriginError extends Error {
  constructor(key: string, origin: string) {
    super(`"${key}" cannot be requested through ${origin}.`);
    this.name = "FieldNotEligibleForOriginError";
  }
}

export function isEligibleField(key: string): boolean {
  return BY_KEY.has(key);
}

export function getEligibleField(key: string): EligibleField | undefined {
  return BY_KEY.get(key);
}

/**
 * The write-path guard. Every request, every policy write and every application
 * passes through here, so a caller cannot name a column the registry does not
 * list — which is what stops a request becoming a route into another module.
 */
export function requireEligibleField(key: string): EligibleField {
  const field = BY_KEY.get(key);
  if (!field) throw new UnknownEligibleFieldError(key);
  return field;
}

export function assertOriginAllowed(field: EligibleField, origin: "employee_self_service" | "hr_originated"): void {
  if (origin === "employee_self_service" && !field.essEligible) {
    throw new FieldNotEligibleForOriginError(field.key, "employee self-service");
  }
  if (origin === "hr_originated" && !field.hrEligible) {
    throw new FieldNotEligibleForOriginError(field.key, "an HR-originated request");
  }
}

/**
 * Masks a value for any surface that is not the authoritative record: approval
 * DTOs, chronology details, audit metadata, notifications and reports.
 *
 * Reuses WS-3's `maskIdentifier` rather than reimplementing OD #23 (§29.16).
 * A non-sensitive value is returned unchanged; a sensitive one never leaves
 * this function in the clear.
 */
export function maskForDisplay(field: EligibleField, value: unknown): unknown {
  if (!field.sensitive || value == null) return value;
  return typeof value === "string" ? maskIdentifier(value) : "***";
}

/** Convenience for audit and chronology writes, which must never carry a raw sensitive value. */
export function maskFieldPayload(key: string, value: unknown): unknown {
  const field = BY_KEY.get(key);
  return field ? maskForDisplay(field, value) : "***";
}
