import { z } from 'zod';
import type {
  Address,
  CreateEmployeeInput,
  EmergencyContact,
  Employee,
  UpdateEmployeeInput,
} from '@workspace/api-client-react';

/**
 * Employee registration / editing — the form's contract with the API.
 *
 * Everything here is a pure function of the generated contract
 * (lib/api-client-react CreateEmployeeInput / UpdateEmployeeInput) and the
 * server's record policy (artifacts/api-server/src/lib/employeeRecordPolicy.ts).
 * No field is invented: every key below is a column the API accepts.
 *
 * Two rules from the server shape this file:
 *
 *   1. SENSITIVE FIELDS need `employee.sensitive.write`. The server first drops
 *      every submitted value that equals the stored one, THEN authorizes what is
 *      left, so re-sending an unchanged sensitive value is harmless — but a
 *      value the caller cannot even read (redacted) would arrive as "" and look
 *      like a deliberate erasure. `buildUpdatePatch` therefore sends only fields
 *      that genuinely changed, and never a sensitive field the caller may not
 *      change.
 *
 *   2. DATES are calendar days. The API returns date-times at UTC midnight and
 *      compares on the UTC calendar day; the form works in `YYYY-MM-DD` and
 *      sends exactly that, so a value survives a round trip unchanged.
 */

// ---------------------------------------------------------------------------
// Vocabulary — the API's enums, with labels for people.
// ---------------------------------------------------------------------------

export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
] as const;

export const MARITAL_STATUS_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'other', label: 'Other' },
] as const;

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
  { value: 'temporary', label: 'Temporary' },
] as const;

/**
 * The statuses an HR officer may set directly. `terminated` is reachable only
 * through the Separate action and left only through Rehire; `probation` →
 * `active` only through Confirm (employeeRecordPolicy.assertStatusChangeAllowedViaUpdate).
 */
export const ADMINISTRATIVE_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'probation', label: 'Probation' },
  { value: 'on_leave', label: 'On leave' },
  { value: 'suspended', label: 'Suspended' },
] as const;

export const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  probation: 'Probation',
  on_leave: 'On leave',
  suspended: 'Suspended',
  terminated: 'Terminated',
};

export function labelFor(options: readonly { value: string; label: string }[], value: string | null | undefined): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Exactly employeeRecordPolicy.SENSITIVE_EMPLOYEE_WRITE_FIELDS. */
export const SENSITIVE_FIELDS = [
  'gender',
  'dateOfBirth',
  'maritalStatus',
  'nationality',
  'nationalId',
  'passportNumber',
  'personalEmail',
  'phoneNumber',
  'alternatePhoneNumber',
  'residentialAddress',
  'emergencyContacts',
] as const;
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];
const SENSITIVE_SET: ReadonlySet<string> = new Set(SENSITIVE_FIELDS);
export function isSensitiveField(key: string): key is SensitiveField {
  return SENSITIVE_SET.has(key);
}

/** Human labels for API field names, used when the server names a field. */
export const FIELD_LABEL: Record<string, string> = {
  employeeNumber: 'Employee number',
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  preferredName: 'Preferred name',
  gender: 'Gender',
  dateOfBirth: 'Date of birth',
  maritalStatus: 'Marital status',
  nationality: 'Nationality',
  nationalId: 'National ID',
  passportNumber: 'Passport number',
  personalEmail: 'Personal email',
  workEmail: 'Work email',
  phoneNumber: 'Primary phone',
  alternatePhoneNumber: 'Alternative phone',
  residentialAddress: 'Residential address',
  emergencyContacts: 'Emergency contacts',
  departmentId: 'Department',
  branchId: 'Branch',
  positionId: 'Position',
  reportingManagerId: 'Reporting manager',
  employmentType: 'Employment type',
  hireDate: 'Hire date',
  probationEndDate: 'Probation end date',
  employmentStatus: 'Employment status',
  workLocation: 'Work location',
  notes: 'HR notes',
};

// ---------------------------------------------------------------------------
// Validation — the same format rules the server applies
// (employeeRecordPolicy.validateEmployeeFieldFormats / validateEmployeeDateConsistency).
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9\s()-]{6,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const trimmed = z.string().trim();
const optionalText = trimmed.max(500, 'Keep this under 500 characters');

const optionalEmail = trimmed
  .max(254, 'An email address cannot exceed 254 characters')
  .refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email address, like name@example.com');

const optionalPhone = trimmed.refine(
  (v) => v === '' || (PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 6),
  'Enter a valid phone number with at least 6 digits (digits, spaces, +, (), - only)',
);

/** A calendar day typed into <input type="date">, or empty. */
const optionalDate = trimmed.refine((v) => v === '' || (DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), 'Enter a valid date');

const enumOrEmpty = <T extends readonly { value: string }[]>(options: T) =>
  trimmed.refine((v) => v === '' || options.some((o) => o.value === v), 'Choose one of the listed options');

const optionalId = trimmed.refine((v) => v === '' || /^\d+$/.test(v), 'Choose from the list');

export const emergencyContactSchema = z.object({
  name: trimmed.min(1, 'Enter the contact’s name').max(200),
  relationship: trimmed.min(1, 'Enter the relationship, e.g. Spouse').max(100),
  phone: trimmed
    .min(1, 'Enter a phone number')
    .refine((v) => PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 6, 'Enter a valid phone number with at least 6 digits'),
});

export const addressSchema = z.object({
  line1: optionalText,
  line2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: trimmed.max(32, 'Keep this under 32 characters'),
  country: optionalText,
});

function dayValue(v: string): number | null {
  return v && DATE_RE.test(v) ? Date.parse(`${v}T00:00:00Z`) : null;
}

export const employeeFormSchema = z
  .object({
    employeeNumber: trimmed.max(64, 'Keep this under 64 characters'),
    firstName: trimmed.min(1, 'First name is required').max(200),
    middleName: optionalText,
    lastName: trimmed.min(1, 'Last name is required').max(200),
    preferredName: optionalText,
    gender: enumOrEmpty(GENDER_OPTIONS),
    dateOfBirth: optionalDate,
    maritalStatus: enumOrEmpty(MARITAL_STATUS_OPTIONS),
    nationality: optionalText,
    nationalId: trimmed.max(100, 'Keep this under 100 characters'),
    passportNumber: trimmed.max(100, 'Keep this under 100 characters'),
    personalEmail: optionalEmail,
    workEmail: optionalEmail,
    phoneNumber: optionalPhone,
    alternatePhoneNumber: optionalPhone,
    residentialAddress: addressSchema,
    emergencyContacts: z.array(emergencyContactSchema).max(5, 'Up to five emergency contacts'),
    departmentId: optionalId,
    branchId: optionalId,
    positionId: optionalId,
    reportingManagerId: optionalId,
    employmentType: enumOrEmpty(EMPLOYMENT_TYPE_OPTIONS),
    hireDate: optionalDate,
    probationEndDate: optionalDate,
    employmentStatus: trimmed,
    workLocation: optionalText,
    notes: trimmed.max(5000, 'Keep notes under 5000 characters'),
  })
  .superRefine((v, ctx) => {
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const dob = dayValue(v.dateOfBirth);
    const hire = dayValue(v.hireDate);
    const probation = dayValue(v.probationEndDate);
    if (dob != null && dob > today) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateOfBirth'], message: 'Date of birth cannot be in the future' });
    }
    if (dob != null && hire != null && hire < dob) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hireDate'], message: 'Hire date cannot be before the date of birth' });
    }
    if (hire != null && probation != null && probation < hire) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['probationEndDate'], message: 'Probation end date cannot be before the hire date' });
    }
  });

export type EmployeeFormValues = z.infer<typeof employeeFormSchema>;

export const EMPTY_ADDRESS: EmployeeFormValues['residentialAddress'] = {
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
};

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  employeeNumber: '',
  firstName: '',
  middleName: '',
  lastName: '',
  preferredName: '',
  gender: '',
  dateOfBirth: '',
  maritalStatus: '',
  nationality: '',
  nationalId: '',
  passportNumber: '',
  personalEmail: '',
  workEmail: '',
  phoneNumber: '',
  alternatePhoneNumber: '',
  residentialAddress: { ...EMPTY_ADDRESS },
  emergencyContacts: [],
  departmentId: '',
  branchId: '',
  positionId: '',
  reportingManagerId: '',
  employmentType: '',
  hireDate: '',
  probationEndDate: '',
  employmentStatus: 'active',
  workLocation: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "2026-01-15T00:00:00.000Z" → "2026-01-15"; anything unparseable → "". */
export function toDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const head = value.slice(0, 10);
  return DATE_RE.test(head) ? head : '';
}

/** "2026-01-15" → "15 Jan 2026" for display, without a timezone shift. */
export function formatDateOnly(value: string | null | undefined): string | null {
  const day = toDateOnly(value);
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Prefill
// ---------------------------------------------------------------------------

export function employeeToFormValues(employee: Employee): EmployeeFormValues {
  const a = employee.residentialAddress ?? null;
  return {
    employeeNumber: employee.employeeNumber ?? '',
    firstName: employee.firstName ?? '',
    middleName: employee.middleName ?? '',
    lastName: employee.lastName ?? '',
    preferredName: employee.preferredName ?? '',
    gender: employee.gender ?? '',
    dateOfBirth: toDateOnly(employee.dateOfBirth),
    maritalStatus: employee.maritalStatus ?? '',
    nationality: employee.nationality ?? '',
    nationalId: employee.nationalId ?? '',
    passportNumber: employee.passportNumber ?? '',
    personalEmail: employee.personalEmail ?? '',
    workEmail: employee.workEmail ?? '',
    phoneNumber: employee.phoneNumber ?? '',
    alternatePhoneNumber: employee.alternatePhoneNumber ?? '',
    residentialAddress: {
      line1: a?.line1 ?? '',
      line2: a?.line2 ?? '',
      city: a?.city ?? '',
      state: a?.state ?? '',
      postalCode: a?.postalCode ?? '',
      country: a?.country ?? '',
    },
    emergencyContacts: (employee.emergencyContacts ?? []).map((c) => ({
      name: c.name ?? '',
      relationship: c.relationship ?? '',
      phone: c.phone ?? '',
    })),
    departmentId: employee.departmentId != null ? String(employee.departmentId) : '',
    branchId: employee.branchId != null ? String(employee.branchId) : '',
    positionId: employee.positionId != null ? String(employee.positionId) : '',
    reportingManagerId: employee.reportingManagerId != null ? String(employee.reportingManagerId) : '',
    employmentType: employee.employmentType ?? '',
    hireDate: toDateOnly(employee.hireDate),
    probationEndDate: toDateOnly(employee.probationEndDate),
    employmentStatus: employee.employmentStatus,
    workLocation: employee.workLocation ?? '',
    notes: employee.notes ?? '',
  };
}

// ---------------------------------------------------------------------------
// Normalisation — one canonical shape per field so "unchanged" means what the
// server means (employeeRecordPolicy.sameValue: trimmed strings, null == "",
// dates by day, JSON by structure).
// ---------------------------------------------------------------------------

type Normalised = string | number | null | Address | EmergencyContact[];

function text(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

function id(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function address(a: EmployeeFormValues['residentialAddress'] | Address | null | undefined): Address | null {
  if (!a) return null;
  const out: Address = {
    line1: text(a.line1),
    line2: text(a.line2),
    city: text(a.city),
    state: text(a.state),
    postalCode: text(a.postalCode),
    country: text(a.country),
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

function contacts(list: EmergencyContact[] | null | undefined): EmergencyContact[] | null {
  if (!list || list.length === 0) return null;
  return list.map((c) => ({ name: c.name.trim(), relationship: c.relationship.trim(), phone: c.phone.trim() }));
}

/** Form values → the API's shape, field by field. */
function normaliseForm(v: EmployeeFormValues): Record<keyof UpdateEmployeeInput, Normalised> {
  return {
    firstName: v.firstName.trim(),
    middleName: text(v.middleName),
    lastName: v.lastName.trim(),
    preferredName: text(v.preferredName),
    gender: text(v.gender),
    dateOfBirth: text(v.dateOfBirth),
    maritalStatus: text(v.maritalStatus),
    nationality: text(v.nationality),
    nationalId: text(v.nationalId),
    passportNumber: text(v.passportNumber),
    personalEmail: text(v.personalEmail),
    workEmail: text(v.workEmail),
    phoneNumber: text(v.phoneNumber),
    alternatePhoneNumber: text(v.alternatePhoneNumber),
    residentialAddress: address(v.residentialAddress),
    emergencyContacts: contacts(v.emergencyContacts),
    departmentId: id(v.departmentId),
    branchId: id(v.branchId),
    positionId: id(v.positionId),
    reportingManagerId: id(v.reportingManagerId),
    employmentType: text(v.employmentType),
    hireDate: text(v.hireDate),
    probationEndDate: text(v.probationEndDate),
    employmentStatus: v.employmentStatus,
    workLocation: text(v.workLocation),
    notes: text(v.notes),
  };
}

/** The stored record → the same canonical shape. */
function normaliseEmployee(e: Employee): Record<keyof UpdateEmployeeInput, Normalised> {
  return {
    firstName: e.firstName.trim(),
    middleName: text(e.middleName),
    lastName: e.lastName.trim(),
    preferredName: text(e.preferredName),
    gender: text(e.gender),
    dateOfBirth: text(toDateOnly(e.dateOfBirth)),
    maritalStatus: text(e.maritalStatus),
    nationality: text(e.nationality),
    nationalId: text(e.nationalId),
    passportNumber: text(e.passportNumber),
    personalEmail: text(e.personalEmail),
    workEmail: text(e.workEmail),
    phoneNumber: text(e.phoneNumber),
    alternatePhoneNumber: text(e.alternatePhoneNumber),
    residentialAddress: address(e.residentialAddress),
    emergencyContacts: contacts(e.emergencyContacts),
    departmentId: id(e.departmentId),
    branchId: id(e.branchId),
    positionId: id(e.positionId),
    reportingManagerId: id(e.reportingManagerId),
    employmentType: text(e.employmentType),
    hireDate: text(toDateOnly(e.hireDate)),
    probationEndDate: text(toDateOnly(e.probationEndDate)),
    employmentStatus: e.employmentStatus,
    workLocation: text(e.workLocation),
    notes: text(e.notes),
  };
}

function same(a: Normalised, b: Normalised): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface PayloadOptions {
  /** The caller holds employee.sensitive.write (and, for edits, can see the values). */
  includeSensitive: boolean;
  /** The caller holds employee.notes.read. */
  includeNotes: boolean;
  /** Create only: the caller may enter a manual staff number. */
  includeEmployeeNumber?: boolean;
}

/**
 * Registration body. Empty optional fields are OMITTED rather than sent as
 * null so the audit's `setFields` lists only what was actually entered, and a
 * caller without the sensitive-write key never sends a sensitive field at all.
 */
export function toCreatePayload(values: EmployeeFormValues, opts: PayloadOptions): CreateEmployeeInput {
  const n = normaliseForm(values);
  const body: CreateEmployeeInput = { firstName: n.firstName as string, lastName: n.lastName as string };
  const assign = <K extends keyof CreateEmployeeInput>(key: K, value: CreateEmployeeInput[K] | null) => {
    if (value !== null && value !== undefined) body[key] = value;
  };

  if (opts.includeEmployeeNumber) assign('employeeNumber', text(values.employeeNumber));
  assign('middleName', n.middleName as string | null);
  assign('preferredName', n.preferredName as string | null);
  assign('workEmail', n.workEmail as string | null);
  assign('departmentId', n.departmentId as number | null);
  assign('branchId', n.branchId as number | null);
  assign('positionId', n.positionId as number | null);
  assign('reportingManagerId', n.reportingManagerId as number | null);
  assign('employmentType', n.employmentType as CreateEmployeeInput['employmentType']);
  assign('hireDate', n.hireDate as string | null);
  assign('probationEndDate', n.probationEndDate as string | null);
  if (values.employmentStatus && values.employmentStatus !== 'active') {
    assign('employmentStatus', values.employmentStatus as CreateEmployeeInput['employmentStatus']);
  }
  assign('workLocation', n.workLocation as string | null);

  if (opts.includeSensitive) {
    assign('gender', n.gender as CreateEmployeeInput['gender']);
    assign('dateOfBirth', n.dateOfBirth as string | null);
    assign('maritalStatus', n.maritalStatus as CreateEmployeeInput['maritalStatus']);
    assign('nationality', n.nationality as string | null);
    assign('nationalId', n.nationalId as string | null);
    assign('passportNumber', n.passportNumber as string | null);
    assign('personalEmail', n.personalEmail as string | null);
    assign('phoneNumber', n.phoneNumber as string | null);
    assign('alternatePhoneNumber', n.alternatePhoneNumber as string | null);
    assign('residentialAddress', n.residentialAddress as Address | null);
    assign('emergencyContacts', n.emergencyContacts as EmergencyContact[] | null);
  }
  if (opts.includeNotes) assign('notes', n.notes as string | null);

  return body;
}

export interface UpdatePatch {
  /** Only the fields whose value differs from the stored record. */
  patch: UpdateEmployeeInput;
  /** The API field names in `patch`, for the success toast and tests. */
  changedFields: string[];
  /**
   * Fields that differ but could not be sent: sensitive fields when the caller
   * lacks the key or the values were redacted, notes without the notes key.
   * The inputs are disabled in that case, so this is a safety net, not a path.
   */
  blockedFields: string[];
}

/**
 * The PATCH body for an edit: a diff against the stored record using the
 * server's own notion of equality, so an unchanged sensitive value — or a
 * redacted one that arrived as null — is never sent back.
 */
export function buildUpdatePatch(values: EmployeeFormValues, original: Employee, opts: PayloadOptions): UpdatePatch {
  const next = normaliseForm(values);
  const prev = normaliseEmployee(original);
  const patch: Record<string, unknown> = {};
  const changedFields: string[] = [];
  const blockedFields: string[] = [];

  const nextByKey = next as Record<string, Normalised>;
  const prevByKey = prev as Record<string, Normalised>;
  for (const key of Object.keys(nextByKey)) {
    if (same(nextByKey[key], prevByKey[key])) continue;
    const blocked = (isSensitiveField(key) && !opts.includeSensitive) || (key === 'notes' && !opts.includeNotes);
    if (blocked) {
      blockedFields.push(key);
      continue;
    }
    patch[key] = nextByKey[key];
    changedFields.push(key);
  }

  return { patch: patch as UpdateEmployeeInput, changedFields, blockedFields };
}
