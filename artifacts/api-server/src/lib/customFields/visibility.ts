/**
 * WS-8 — conditional visibility (§24.10).
 *
 * A constrained declarative rule model with a fixed operator set, evaluated
 * SERVER-SIDE. There is no expression parser, no `eval`, no template engine and
 * no dynamic property access — a condition is a small tagged object, and the
 * evaluator is a switch over seven known operators.
 *
 * Why server-side matters (§24.24): visibility is not a presentation detail. A
 * field that is hidden by its own condition must not become writable by
 * crafting an API request, so the same evaluator that the renderer's output is
 * derived from is the one the write path consults.
 */
import { CustomFieldValidationError } from "./fieldTypes";

export const VISIBILITY_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "is_empty",
  "is_not_empty",
  "in",
  "not_in",
] as const;

export type VisibilityOperator = (typeof VISIBILITY_OPERATORS)[number];

export interface VisibilityCondition {
  /** The `fieldKey` of another field in the same scope whose value this depends on. */
  fieldKey: string;
  operator: VisibilityOperator;
  value?: unknown;
}

export interface VisibilityRule {
  /** All conditions must hold (`all`) or any one of them (`any`). */
  match: "all" | "any";
  conditions: VisibilityCondition[];
}

const MAX_CONDITIONS = 20;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates a visibility rule at configuration time. `knownFieldKeys` is the
 * set of sibling fields in the same scope — a condition may only reference one
 * of those, which is what keeps rules inside their own context and makes
 * cross-tenant or cross-scope lookups unrepresentable rather than merely
 * forbidden.
 */
export function assertValidVisibilityRule(raw: unknown, knownFieldKeys: ReadonlySet<string>, selfFieldKey: string): VisibilityRule | null {
  if (raw == null) return null;
  if (!isPlainObject(raw)) throw new CustomFieldValidationError("Visibility rule must be an object");

  const match = raw.match;
  if (match !== "all" && match !== "any") {
    throw new CustomFieldValidationError('Visibility rule "match" must be "all" or "any"');
  }
  const conditions = raw.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new CustomFieldValidationError("A visibility rule needs at least one condition");
  }
  if (conditions.length > MAX_CONDITIONS) {
    throw new CustomFieldValidationError(`A visibility rule may not have more than ${MAX_CONDITIONS} conditions`);
  }

  const parsed: VisibilityCondition[] = conditions.map((c) => {
    if (!isPlainObject(c)) throw new CustomFieldValidationError("Each condition must be an object");
    const fieldKey = typeof c.fieldKey === "string" ? c.fieldKey.trim() : "";
    if (!fieldKey) throw new CustomFieldValidationError("Each condition must name a field");
    if (fieldKey === selfFieldKey) {
      // A field whose visibility depends on itself is the simplest possible
      // cycle; refusing it here removes the whole class without needing a
      // graph walk at evaluation time.
      throw new CustomFieldValidationError("A field's visibility cannot depend on itself");
    }
    if (!knownFieldKeys.has(fieldKey)) {
      throw new CustomFieldValidationError(`Visibility condition references unknown field "${fieldKey}"`);
    }
    const operator = c.operator;
    if (typeof operator !== "string" || !(VISIBILITY_OPERATORS as readonly string[]).includes(operator)) {
      throw new CustomFieldValidationError(`"${String(operator)}" is not a supported visibility operator`);
    }
    const op = operator as VisibilityOperator;

    if (op === "in" || op === "not_in") {
      if (!Array.isArray(c.value) || c.value.length === 0) {
        throw new CustomFieldValidationError(`Operator "${op}" needs a non-empty list of values`);
      }
      if (c.value.some((v) => typeof v === "object" && v !== null)) {
        throw new CustomFieldValidationError(`Operator "${op}" only accepts simple values`);
      }
      return { fieldKey, operator: op, value: c.value };
    }
    if (op === "is_empty" || op === "is_not_empty") return { fieldKey, operator: op };
    if (typeof c.value === "object" && c.value !== null) {
      throw new CustomFieldValidationError(`Operator "${op}" only accepts a simple value`);
    }
    return { fieldKey, operator: op, value: c.value };
  });

  return { match, conditions: parsed };
}

function unwrap(stored: unknown): unknown {
  // Values arrive as the `{ type, value }` envelope; conditions compare the
  // inner value.
  if (stored != null && typeof stored === "object" && !Array.isArray(stored) && "value" in (stored as Record<string, unknown>)) {
    return (stored as Record<string, unknown>).value;
  }
  return stored;
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function evaluateCondition(condition: VisibilityCondition, values: Map<string, unknown>): boolean {
  const actual = unwrap(values.get(condition.fieldKey));

  switch (condition.operator) {
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "equals":
      return looseEquals(actual, condition.value);
    case "not_equals":
      return !looseEquals(actual, condition.value);
    case "contains":
      if (Array.isArray(actual)) return actual.some((a) => looseEquals(a, condition.value));
      if (typeof actual === "string") return actual.toLowerCase().includes(String(condition.value ?? "").toLowerCase());
      return false;
    case "in":
      return Array.isArray(condition.value) && condition.value.some((v) => looseEquals(actual, v));
    case "not_in":
      return !(Array.isArray(condition.value) && condition.value.some((v) => looseEquals(actual, v)));
  }
}

/** Compares across the string/number/boolean boundary a form post inevitably blurs, without coercing objects. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") return false;
  return String(a) === String(b);
}

/**
 * Evaluates whether a field is visible given the sibling values in its scope.
 * A field with no rule is always visible.
 */
export function isFieldVisible(rule: VisibilityRule | null | undefined, values: Map<string, unknown>): boolean {
  if (!rule) return true;
  return rule.match === "all"
    ? rule.conditions.every((c) => evaluateCondition(c, values))
    : rule.conditions.some((c) => evaluateCondition(c, values));
}

export function parseStoredVisibility(raw: unknown): VisibilityRule | null {
  if (raw == null) return null;
  if (!isPlainObject(raw)) return null;
  const match = raw.match === "any" ? "any" : "all";
  const conditions = Array.isArray(raw.conditions) ? (raw.conditions as VisibilityCondition[]) : [];
  return conditions.length > 0 ? { match, conditions } : null;
}
