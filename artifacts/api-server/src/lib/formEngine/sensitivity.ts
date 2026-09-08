/**
 * WS-26C — generic field-level sensitivity for the form engine.
 *
 * A form-definition field may declare `sensitive: true` (+ optional
 * `readPermission`). The VALUE of such a field — whether typed as an answer or
 * pulled in as autofill — is disclosed only to:
 *   - the subject employee (resolved server-side via the employee link, never a
 *     client-supplied id), or
 *   - a caller holding the field's effective read permission.
 * Every other viewer who can otherwise see the submission gets the field with
 * its value blanked; the label and structure are preserved so the official form
 * never leaks the protected value.
 *
 * Organization-neutral: the engine knows nothing about "WWM PIF" — a tenant
 * marks whichever fields it classifies as sensitive.
 */
import type { FormDefinition, FieldItem } from "./definition";

/** Default gate when a sensitive field does not name its own permission. */
export const DEFAULT_SENSITIVE_READ_PERMISSION = "employee.sensitive.read";

/** Map of sensitive field key → the effective permission that unlocks its value. */
export function sensitiveFieldRequirements(definition: FormDefinition): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of definition.sections) {
    for (const item of section.items) {
      if (item.kind === "field" && (item as FieldItem).sensitive) {
        const f = item as FieldItem;
        out.set(f.key, f.readPermission ?? DEFAULT_SENSITIVE_READ_PERMISSION);
      }
    }
  }
  return out;
}

export interface SensitivityViewer {
  /** Server-resolved employee id of the caller in this org (null when unlinked). NEVER client-supplied. */
  employeeId: number | null;
  /** The caller's effective permission keys. */
  permissions: ReadonlySet<string>;
}

/**
 * The set of field keys whose VALUE must be blanked for this viewer on this
 * submission. The subject employee sees all of their own sensitive values; any
 * other viewer must hold the field's readPermission.
 */
export function redactedSensitiveKeys(
  definition: FormDefinition,
  viewer: SensitivityViewer,
  subjectEmployeeId: number,
): Set<string> {
  const requirements = sensitiveFieldRequirements(definition);
  if (requirements.size === 0) return new Set();
  const isSubject = viewer.employeeId != null && viewer.employeeId === subjectEmployeeId;
  if (isSubject) return new Set();
  const redacted = new Set<string>();
  for (const [fieldKey, permission] of requirements) {
    if (!viewer.permissions.has(permission)) redacted.add(fieldKey);
  }
  return redacted;
}

/** Returns a shallow copy of `values` with the given keys blanked (value → null; key retained). */
export function redactValues<T extends Record<string, unknown>>(values: T, keys: ReadonlySet<string>): T {
  if (keys.size === 0) return values;
  const out: Record<string, unknown> = { ...values };
  for (const k of keys) {
    if (k in out) out[k] = null;
  }
  return out as T;
}
