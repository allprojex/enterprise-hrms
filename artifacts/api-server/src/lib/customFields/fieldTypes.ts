/**
 * WS-8 — the field-type registry and value validation (§24.5, §24.6).
 *
 * This is a server-defined allow-list, exactly like WS-6's job-handler registry
 * and WS-7's entity-adapter registry. A field type is never client-executable
 * content: an unrecognized type is rejected before anything is stored.
 *
 * There is deliberately no expression evaluator anywhere in this file. Every
 * validation rule is a declarative bound (min/max/length/options), so there is
 * no code path that can execute organization-supplied content — which is what
 * makes "no formulas, no JavaScript, no SQL, no scripts" a structural property
 * rather than a policy someone has to remember.
 */
import type { CustomFieldType } from "@workspace/db";

export class CustomFieldValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "CustomFieldValidationError";
  }
}

/** A stored value is always this envelope, never a bare scalar — see custom-fields.ts. */
export interface TypedValue {
  type: CustomFieldType;
  value: unknown;
}

export type ValueKind = "string" | "number" | "boolean" | "date" | "string[]" | "reference";

export interface FieldTypeSpec {
  type: CustomFieldType;
  label: string;
  kind: ValueKind;
  /** Whether this type draws its permitted values from `options` on the definition version. */
  usesOptions: boolean;
  /** Whether this type resolves against another table, requiring an org-scoped existence check. */
  usesReference: boolean;
}

export const FIELD_TYPES: readonly FieldTypeSpec[] = [
  { type: "short_text", label: "Short text", kind: "string", usesOptions: false, usesReference: false },
  { type: "long_text", label: "Long text", kind: "string", usesOptions: false, usesReference: false },
  { type: "integer", label: "Whole number", kind: "number", usesOptions: false, usesReference: false },
  { type: "decimal", label: "Decimal number", kind: "number", usesOptions: false, usesReference: false },
  { type: "boolean", label: "Yes / No", kind: "boolean", usesOptions: false, usesReference: false },
  { type: "date", label: "Date", kind: "date", usesOptions: false, usesReference: false },
  { type: "datetime", label: "Date and time", kind: "date", usesOptions: false, usesReference: false },
  { type: "single_select", label: "Single choice", kind: "string", usesOptions: true, usesReference: false },
  { type: "multi_select", label: "Multiple choice", kind: "string[]", usesOptions: true, usesReference: false },
  { type: "email", label: "Email address", kind: "string", usesOptions: false, usesReference: false },
  { type: "phone", label: "Phone number", kind: "string", usesOptions: false, usesReference: false },
  { type: "url", label: "Web address", kind: "string", usesOptions: false, usesReference: false },
  { type: "employee_reference", label: "Employee", kind: "reference", usesOptions: false, usesReference: true },
  { type: "master_data_reference", label: "Master data item", kind: "reference", usesOptions: true, usesReference: true },
] as const;

const BY_TYPE = new Map(FIELD_TYPES.map((f) => [f.type, f]));

export function getFieldTypeSpec(type: string): FieldTypeSpec | undefined {
  return BY_TYPE.get(type as CustomFieldType);
}

export function isKnownFieldType(type: string): boolean {
  return BY_TYPE.has(type as CustomFieldType);
}

// --- validation config -------------------------------------------------------

export interface ValidationConfig {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  earliest?: string;
  latest?: string;
}

/** Hard ceiling on any stored text, independent of a per-field maxLength. */
export const MAX_TEXT_LENGTH = 10_000;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_OPTIONS = 200;

export interface SelectOption {
  value: string;
  label: string;
}

export interface OptionsConfig {
  /** For single_select / multi_select. */
  choices?: SelectOption[];
  /** For master_data_reference — the Master Data domain key its values must belong to. */
  masterDataDomain?: string;
}

/**
 * Validates a definition version's own configuration before it is stored.
 * Rejecting a malformed config here is what keeps every later read cheap and
 * total — a stored definition is always well-formed.
 */
export function assertValidFieldConfig(params: {
  fieldType: string;
  validation: unknown;
  options: unknown;
}): { validation: ValidationConfig | null; options: OptionsConfig | null } {
  const spec = getFieldTypeSpec(params.fieldType);
  if (!spec) throw new CustomFieldValidationError(`"${params.fieldType}" is not a supported field type`);

  const validation = normalizeValidation(spec, params.validation);
  const options = normalizeOptions(spec, params.options);
  return { validation, options };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  // Rejects arrays AND anything with a non-Object prototype, which is what
  // keeps a crafted `__proto__`/`constructor` payload from being treated as a
  // config object at all.
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Strips prototype-pollution vectors from any organization-supplied object before it is stored. */
export function sanitizeConfigObject(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = value;
  }
  return { ...out };
}

function normalizeValidation(spec: FieldTypeSpec, raw: unknown): ValidationConfig | null {
  if (raw == null) return null;
  if (!isPlainObject(raw)) throw new CustomFieldValidationError("Validation configuration must be an object");
  const src = sanitizeConfigObject(raw);
  const out: ValidationConfig = {};

  if (spec.kind === "string" || spec.kind === "string[]") {
    const ceiling = spec.type === "short_text" ? MAX_SHORT_TEXT_LENGTH : MAX_TEXT_LENGTH;
    if (src.minLength != null) out.minLength = requireInt(src.minLength, "minLength", 0, ceiling);
    if (src.maxLength != null) out.maxLength = requireInt(src.maxLength, "maxLength", 1, ceiling);
    if (out.minLength != null && out.maxLength != null && out.minLength > out.maxLength) {
      throw new CustomFieldValidationError("minLength cannot be greater than maxLength");
    }
  }
  if (spec.kind === "number") {
    if (src.min != null) out.min = requireFiniteNumber(src.min, "min");
    if (src.max != null) out.max = requireFiniteNumber(src.max, "max");
    if (out.min != null && out.max != null && out.min > out.max) {
      throw new CustomFieldValidationError("min cannot be greater than max");
    }
  }
  if (spec.kind === "date") {
    if (src.earliest != null) out.earliest = requireDateString(src.earliest, "earliest");
    if (src.latest != null) out.latest = requireDateString(src.latest, "latest");
    if (out.earliest && out.latest && new Date(out.earliest) > new Date(out.latest)) {
      throw new CustomFieldValidationError("earliest cannot be after latest");
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function normalizeOptions(spec: FieldTypeSpec, raw: unknown): OptionsConfig | null {
  if (!spec.usesOptions) {
    // Silently dropping stray config would hide a client bug; refusing it makes
    // the mismatch visible at configuration time rather than at data-entry time.
    if (raw != null && isPlainObject(raw) && Object.keys(raw).length > 0) {
      throw new CustomFieldValidationError(`Field type "${spec.type}" does not take options`);
    }
    return null;
  }
  if (!isPlainObject(raw)) throw new CustomFieldValidationError(`Field type "${spec.type}" requires options`);
  const src = sanitizeConfigObject(raw);

  if (spec.type === "master_data_reference") {
    const domain = src.masterDataDomain;
    if (typeof domain !== "string" || !domain.trim()) {
      throw new CustomFieldValidationError("A Master Data domain is required for this field type");
    }
    return { masterDataDomain: domain.trim() };
  }

  const choices = src.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new CustomFieldValidationError("At least one choice is required");
  }
  if (choices.length > MAX_OPTIONS) {
    throw new CustomFieldValidationError(`A field may not have more than ${MAX_OPTIONS} choices`);
  }
  const seen = new Set<string>();
  const normalized: SelectOption[] = choices.map((c) => {
    if (!isPlainObject(c)) throw new CustomFieldValidationError("Each choice must be an object");
    const value = typeof c.value === "string" ? c.value.trim() : "";
    const label = typeof c.label === "string" && c.label.trim() ? c.label.trim() : value;
    if (!value) throw new CustomFieldValidationError("Each choice needs a value");
    if (value.length > MAX_SHORT_TEXT_LENGTH) throw new CustomFieldValidationError("Choice value is too long");
    if (seen.has(value)) throw new CustomFieldValidationError(`Duplicate choice value "${value}"`);
    seen.add(value);
    return { value, label };
  });
  return { choices: normalized };
}

function requireInt(raw: unknown, name: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CustomFieldValidationError(`${name} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function requireFiniteNumber(raw: unknown, name: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new CustomFieldValidationError(`${name} must be a number`);
  return n;
}

function requireDateString(raw: unknown, name: string): string {
  if (typeof raw !== "string") throw new CustomFieldValidationError(`${name} must be a date`);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new CustomFieldValidationError(`${name} must be a valid date`);
  return d.toISOString();
}

// --- value coercion / validation ---------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const PHONE_RE = /^\+?[0-9\s()-]{6,32}$/;

/**
 * Coerces and validates one submitted value against its definition version.
 * Returns the typed envelope to store, or null for "no value".
 *
 * Null is preserved as null and never coerced to "" — §24.27 requires null to
 * stay distinguishable from empty, because "not answered" and "answered with
 * nothing" are different facts about a record.
 */
export function coerceAndValidateValue(params: {
  fieldType: string;
  label: string;
  required: boolean;
  validation: ValidationConfig | null;
  options: OptionsConfig | null;
  raw: unknown;
}): TypedValue | null {
  const spec = getFieldTypeSpec(params.fieldType);
  if (!spec) throw new CustomFieldValidationError(`"${params.fieldType}" is not a supported field type`);

  const isEmpty =
    params.raw == null ||
    (typeof params.raw === "string" && params.raw.trim() === "") ||
    (Array.isArray(params.raw) && params.raw.length === 0);

  if (isEmpty) {
    if (params.required) throw new CustomFieldValidationError(`${params.label} is required`, params.label);
    return null;
  }

  const v = params.validation ?? {};
  switch (spec.kind) {
    case "string": {
      if (typeof params.raw !== "string") throw new CustomFieldValidationError(`${params.label} must be text`, params.label);
      const value = params.raw.trim();
      const ceiling = spec.type === "short_text" ? MAX_SHORT_TEXT_LENGTH : MAX_TEXT_LENGTH;
      if (value.length > ceiling) throw new CustomFieldValidationError(`${params.label} is too long`, params.label);
      if (v.minLength != null && value.length < v.minLength) {
        throw new CustomFieldValidationError(`${params.label} must be at least ${v.minLength} characters`, params.label);
      }
      if (v.maxLength != null && value.length > v.maxLength) {
        throw new CustomFieldValidationError(`${params.label} must be at most ${v.maxLength} characters`, params.label);
      }
      if (spec.type === "email" && !EMAIL_RE.test(value)) {
        throw new CustomFieldValidationError(`${params.label} must be a valid email address`, params.label);
      }
      if (spec.type === "url" && !URL_RE.test(value)) {
        throw new CustomFieldValidationError(`${params.label} must be a valid http(s) address`, params.label);
      }
      if (spec.type === "phone" && !PHONE_RE.test(value)) {
        throw new CustomFieldValidationError(`${params.label} must be a valid phone number`, params.label);
      }
      if (spec.type === "single_select") {
        const allowed = params.options?.choices?.map((c) => c.value) ?? [];
        if (!allowed.includes(value)) {
          throw new CustomFieldValidationError(`${params.label} must be one of the configured choices`, params.label);
        }
      }
      return { type: spec.type, value };
    }
    case "string[]": {
      if (!Array.isArray(params.raw)) throw new CustomFieldValidationError(`${params.label} must be a list`, params.label);
      const allowed = new Set(params.options?.choices?.map((c) => c.value) ?? []);
      const seen = new Set<string>();
      const values: string[] = [];
      for (const item of params.raw) {
        if (typeof item !== "string") throw new CustomFieldValidationError(`${params.label} contains an invalid choice`, params.label);
        const value = item.trim();
        if (!allowed.has(value)) {
          throw new CustomFieldValidationError(`${params.label} contains a choice that is not configured`, params.label);
        }
        if (seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
      if (values.length === 0 && params.required) throw new CustomFieldValidationError(`${params.label} is required`, params.label);
      return { type: spec.type, value: values };
    }
    case "number": {
      const n = typeof params.raw === "number" ? params.raw : Number(String(params.raw).replace(/,/g, ""));
      if (!Number.isFinite(n)) throw new CustomFieldValidationError(`${params.label} must be a number`, params.label);
      if (spec.type === "integer" && !Number.isInteger(n)) {
        throw new CustomFieldValidationError(`${params.label} must be a whole number`, params.label);
      }
      if (v.min != null && n < v.min) throw new CustomFieldValidationError(`${params.label} must be at least ${v.min}`, params.label);
      if (v.max != null && n > v.max) throw new CustomFieldValidationError(`${params.label} must be at most ${v.max}`, params.label);
      // Decimals are stored as a string so a value that survives Postgres
      // numeric semantics is not silently re-rounded by JS float printing.
      return { type: spec.type, value: spec.type === "decimal" ? n.toString() : n };
    }
    case "boolean": {
      if (typeof params.raw === "boolean") return { type: spec.type, value: params.raw };
      const s = String(params.raw).trim().toLowerCase();
      if (["true", "yes", "1"].includes(s)) return { type: spec.type, value: true };
      if (["false", "no", "0"].includes(s)) return { type: spec.type, value: false };
      throw new CustomFieldValidationError(`${params.label} must be yes or no`, params.label);
    }
    case "date": {
      const d = params.raw instanceof Date ? params.raw : new Date(String(params.raw));
      if (Number.isNaN(d.getTime())) throw new CustomFieldValidationError(`${params.label} must be a valid date`, params.label);
      if (v.earliest && d < new Date(v.earliest)) {
        throw new CustomFieldValidationError(`${params.label} is earlier than allowed`, params.label);
      }
      if (v.latest && d > new Date(v.latest)) {
        throw new CustomFieldValidationError(`${params.label} is later than allowed`, params.label);
      }
      const iso = d.toISOString();
      return { type: spec.type, value: spec.type === "date" ? iso.slice(0, 10) : iso };
    }
    case "reference": {
      if (spec.type === "employee_reference") {
        const id = Number(params.raw);
        if (!Number.isInteger(id) || id <= 0) {
          throw new CustomFieldValidationError(`${params.label} must reference an employee`, params.label);
        }
        // Existence and organization ownership are checked by the value
        // service against the live table — this layer cannot see the database.
        return { type: spec.type, value: id };
      }
      if (typeof params.raw !== "string" || !params.raw.trim()) {
        throw new CustomFieldValidationError(`${params.label} must reference a master data item`, params.label);
      }
      return { type: spec.type, value: params.raw.trim() };
    }
  }
}

/** Flattens a stored envelope into a scalar suitable for CSV/report output, preserving type semantics. */
export function typedValueToReportCell(stored: unknown): string | number | boolean | null {
  if (stored == null) return null;
  if (typeof stored !== "object" || Array.isArray(stored)) return null;
  const envelope = stored as TypedValue;
  const value = envelope.value;
  if (value == null) return null;
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return String(value);
}
