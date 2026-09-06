/**
 * WS-26 — answers: validation and computation.
 *
 * `answers` is a flat object keyed by item key. Value shapes per item kind:
 *   field            string | number | boolean | null (single_choice: option value; multi_choice: string[])
 *   choice_group     single → string | null; multi → string[]; otherField.key → string
 *   matrix           { [rowKey]: number | null }
 *   rated_table      { [rowKey]: { [textColumnKey]: string; rating: number | null } }
 *   table            Array<{ [columnKey]: string }>
 *   signature        (never in answers — WS-26B writes form_signatures rows)
 *   computed         (never in answers — computed by computeValues)
 *
 * Validation has two levels: `validateAnswers(strict=false)` for a draft
 * save (shape only, so a half-filled form can be saved) and strict for
 * submit/stage completion (required, options, exclusive pairs, row minimums).
 */
import type { FormDefinition, FormItem, FormSection, ChoiceGroupItem, MatrixItem, RatedTableItem, TableItem, FieldItem } from "./definition";
import { walkItems } from "./definition";

export type Answers = Record<string, unknown>;
export type ComputedValues = Record<string, number | null>;

export class FormAnswersError extends Error {
  readonly issues: { key: string; message: string }[];
  constructor(issues: { key: string; message: string }[]) {
    super(issues.map((i) => `${i.key}: ${i.message}`).join("; ") || "Invalid answers");
    this.issues = issues;
  }
}

const MAX_TEXT = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

function checkField(item: FieldItem, value: unknown, strict: boolean, issues: { key: string; message: string }[]): unknown {
  if (isEmpty(value)) {
    if (strict && item.required) issues.push({ key: item.key, message: `${item.label || item.key} is required` });
    return value === undefined ? undefined : null;
  }
  switch (item.type) {
    case "short_text":
    case "long_text":
    case "phone":
    case "email":
    case "date": {
      if (typeof value !== "string") {
        issues.push({ key: item.key, message: "must be text" });
        return null;
      }
      const t = value.trim();
      if (t.length > MAX_TEXT) issues.push({ key: item.key, message: "is too long" });
      if (item.type === "date" && strict && !DATE_RE.test(t)) issues.push({ key: item.key, message: "must be a date (YYYY-MM-DD)" });
      if (item.type === "email" && strict && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) issues.push({ key: item.key, message: "must be an email address" });
      return t;
    }
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
      if (!Number.isFinite(n)) {
        issues.push({ key: item.key, message: "must be a number" });
        return null;
      }
      return n;
    }
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push({ key: item.key, message: "must be true or false" });
        return null;
      }
      return value;
    case "single_choice": {
      if (typeof value !== "string" || !item.options?.some((o) => o.value === value)) {
        issues.push({ key: item.key, message: "is not one of the options" });
        return null;
      }
      return value;
    }
    case "multi_choice": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !item.options?.some((o) => o.value === v))) {
        issues.push({ key: item.key, message: "contains a value that is not an option" });
        return [];
      }
      return [...new Set(value as string[])];
    }
  }
}

function checkChoiceGroup(item: ChoiceGroupItem, answers: Answers, strict: boolean, issues: { key: string; message: string }[], out: Answers): void {
  const value = answers[item.key];
  const optionValues = new Set(item.options.map((o) => o.value));
  // "Other (specify)" satisfies a required group on its own — the official
  // forms print it as a written line beside the boxes, not as a box.
  const otherFilled = Boolean(item.otherField && !isEmpty(answers[item.otherField.key]));
  if (item.mode === "single") {
    if (isEmpty(value)) {
      if (strict && item.required && !otherFilled) issues.push({ key: item.key, message: `${item.label ?? item.key} requires a selection` });
      if (value !== undefined) out[item.key] = null;
    } else if (typeof value !== "string" || !optionValues.has(value)) {
      issues.push({ key: item.key, message: "is not one of the options" });
    } else {
      out[item.key] = value;
    }
  } else {
    if (isEmpty(value)) {
      if (strict && item.required && !otherFilled) issues.push({ key: item.key, message: `${item.label ?? item.key} requires a selection` });
      if (value !== undefined) out[item.key] = [];
    } else if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !optionValues.has(v))) {
      issues.push({ key: item.key, message: "contains a value that is not an option" });
    } else {
      const selected = [...new Set(value as string[])];
      for (const [a, b] of item.exclusivePairs ?? []) {
        if (selected.includes(a) && selected.includes(b)) {
          issues.push({ key: item.key, message: `"${item.options.find((o) => o.value === a)?.label}" and "${item.options.find((o) => o.value === b)?.label}" cannot both be selected` });
        }
      }
      out[item.key] = selected;
    }
  }
  if (item.otherField) {
    const other = answers[item.otherField.key];
    if (!isEmpty(other)) {
      if (typeof other !== "string") issues.push({ key: item.otherField.key, message: "must be text" });
      else out[item.otherField.key] = other.trim().slice(0, MAX_TEXT);
    } else if (other !== undefined) {
      out[item.otherField.key] = null;
    }
    if (strict && item.otherField.requiredWhenValue) {
      const selected = out[item.key];
      const chosen = Array.isArray(selected) ? selected.includes(item.otherField.requiredWhenValue) : selected === item.otherField.requiredWhenValue;
      if (chosen && isEmpty(other)) issues.push({ key: item.otherField.key, message: `${item.otherField.label} is required` });
    }
  }
}

function checkMatrix(item: MatrixItem, value: unknown, strict: boolean, issues: { key: string; message: string }[]): Record<string, number | null> | undefined {
  if (value === undefined) {
    if (strict && item.required) issues.push({ key: item.key, message: "ratings are required" });
    return undefined;
  }
  if (!isPlainObject(value)) {
    issues.push({ key: item.key, message: "must be an object of row ratings" });
    return undefined;
  }
  const allowed = new Set(item.columns.map((c) => c.value));
  const out: Record<string, number | null> = {};
  for (const row of item.rows) {
    if (row.rated === false) continue;
    const v = value[row.key];
    if (v === undefined || v === null || v === "") {
      if (strict && item.required) issues.push({ key: `${item.key}.${row.key}`, message: `${row.label} needs a rating` });
      out[row.key] = null;
      continue;
    }
    const n = typeof v === "number" ? v : Number(v);
    if (!allowed.has(n)) {
      issues.push({ key: `${item.key}.${row.key}`, message: "is not a rating on the scale" });
      out[row.key] = null;
      continue;
    }
    out[row.key] = n;
  }
  for (const k of Object.keys(value)) {
    if (!item.rows.some((r) => r.key === k)) issues.push({ key: `${item.key}.${k}`, message: "is not a row of this matrix" });
  }
  return out;
}

function checkRatedTable(item: RatedTableItem, value: unknown, strict: boolean, issues: { key: string; message: string }[]): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) {
    if (strict && item.required) issues.push({ key: item.key, message: "is required" });
    return undefined;
  }
  if (!isPlainObject(value)) {
    issues.push({ key: item.key, message: "must be an object of rows" });
    return undefined;
  }
  const allowed = new Set(item.ratingColumns.map((c) => c.value));
  const out: Record<string, Record<string, unknown>> = {};
  for (const row of item.rows) {
    const raw = value[row.key];
    const rowOut: Record<string, unknown> = {};
    if (raw !== undefined && !isPlainObject(raw)) {
      issues.push({ key: `${item.key}.${row.key}`, message: "must be an object" });
      continue;
    }
    const r = (raw ?? {}) as Record<string, unknown>;
    for (const col of item.textColumns) {
      const t = r[col.key];
      if (t === undefined || t === null) rowOut[col.key] = "";
      else if (typeof t !== "string") issues.push({ key: `${item.key}.${row.key}.${col.key}`, message: "must be text" });
      else rowOut[col.key] = t.trim().slice(0, MAX_TEXT);
    }
    const rating = r.rating;
    if (rating === undefined || rating === null || rating === "") {
      if (strict && item.required) issues.push({ key: `${item.key}.${row.key}.rating`, message: `${row.label} needs a rating` });
      rowOut.rating = null;
    } else {
      const n = typeof rating === "number" ? rating : Number(rating);
      if (!allowed.has(n)) {
        issues.push({ key: `${item.key}.${row.key}.rating`, message: "is not a rating on the scale" });
        rowOut.rating = null;
      } else rowOut.rating = n;
    }
    out[row.key] = rowOut;
  }
  return out;
}

function checkTable(item: TableItem, value: unknown, strict: boolean, issues: { key: string; message: string }[]): Record<string, string>[] | undefined {
  if (value === undefined) {
    if (strict && (item.required || (item.minRows ?? 0) > 0)) issues.push({ key: item.key, message: "needs at least one row" });
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push({ key: item.key, message: "must be a list of rows" });
    return undefined;
  }
  if (value.length > 500) issues.push({ key: item.key, message: "has too many rows" });
  const rows: Record<string, string>[] = [];
  value.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      issues.push({ key: `${item.key}[${i}]`, message: "must be an object" });
      return;
    }
    const row: Record<string, string> = {};
    for (const col of item.columns) {
      const t = raw[col.key];
      if (t === undefined || t === null) row[col.key] = "";
      else if (typeof t !== "string") issues.push({ key: `${item.key}[${i}].${col.key}`, message: "must be text" });
      else row[col.key] = t.trim().slice(0, MAX_TEXT);
    }
    // A completely blank row is dropped rather than stored.
    if (Object.values(row).some((v) => v !== "")) rows.push(row);
  });
  if (strict && rows.length < (item.minRows ?? 0)) issues.push({ key: item.key, message: `needs at least ${item.minRows} row(s)` });
  return rows;
}

/**
 * Validates and canonicalises answers. Keys outside the definition are
 * rejected (a client cannot smuggle values), readonly-bound keys are
 * ignored (they come from the autofill snapshot), and only the sections
 * listed in `editableSections` may change when that list is given.
 */
export function validateAnswers(
  definition: FormDefinition,
  raw: unknown,
  options: { strict: boolean; readonlyKeys?: Set<string>; editableSections?: Set<string> | null; previous?: Answers | null },
): Answers {
  if (!isPlainObject(raw)) throw new FormAnswersError([{ key: "", message: "answers must be an object" }]);
  const issues: { key: string; message: string }[] = [];
  const out: Answers = {};
  const knownKeys = new Set<string>();

  const sectionOfKey = new Map<string, FormSection>();
  for (const { section, item } of walkItems(definition)) {
    if ("key" in item) {
      knownKeys.add(item.key);
      sectionOfKey.set(item.key, section);
    }
    if (item.kind === "choice_group" && item.otherField) {
      knownKeys.add(item.otherField.key);
      sectionOfKey.set(item.otherField.key, section);
    }
  }
  for (const k of Object.keys(raw)) {
    if (!knownKeys.has(k)) issues.push({ key: k, message: "is not a field of this form" });
  }

  for (const { section, item } of walkItems(definition)) {
    const editable = !options.editableSections || options.editableSections.has(section.key);
    if (!editable) {
      // Not this actor's section: carry the previous values through untouched,
      // with no validation — another stage owns them.
      const carry = (key: string) => {
        if (options.previous && options.previous[key] !== undefined) out[key] = options.previous[key];
      };
      if ("key" in item) carry(item.key);
      if (item.kind === "choice_group" && item.otherField) carry(item.otherField.key);
      continue;
    }
    const apply = (key: string, value: unknown) => {
      if (!editable) {
        // Not this stage's section: keep the previous value, ignore the client's.
        if (options.previous && options.previous[key] !== undefined) out[key] = options.previous[key];
        return;
      }
      if (value !== undefined) out[key] = value;
      else if (options.previous && options.previous[key] !== undefined) out[key] = options.previous[key];
    };
    const inputFor = (key: string) => (editable ? raw[key] : options.previous?.[key]);

    switch (item.kind) {
      case "field": {
        if (options.readonlyKeys?.has(item.key)) break;
        const value = checkField(item, inputFor(item.key), options.strict, issues);
        apply(item.key, value);
        break;
      }
      case "choice_group": {
        const scratch: Answers = {};
        const source: Answers = editable ? raw : (options.previous ?? {});
        checkChoiceGroup(item, source, options.strict, issues, scratch);
        apply(item.key, scratch[item.key]);
        if (item.otherField) apply(item.otherField.key, scratch[item.otherField.key]);
        break;
      }
      case "matrix":
        apply(item.key, checkMatrix(item, inputFor(item.key), options.strict, issues));
        break;
      case "rated_table":
        apply(item.key, checkRatedTable(item, inputFor(item.key), options.strict, issues));
        break;
      case "table":
        apply(item.key, checkTable(item, inputFor(item.key), options.strict, issues));
        break;
      default:
        break;
    }
  }

  if (issues.length > 0) throw new FormAnswersError(issues);
  return out;
}

/** Sums ratings for every `computed` item and every matrix/rated_table `total`. Null when nothing is rated. */
export function computeValues(definition: FormDefinition, answers: Answers): ComputedValues {
  const computed: ComputedValues = {};
  const sumOf = (itemKey: string): { sum: number; count: number } => {
    const entry = findRatingItem(definition, itemKey);
    if (!entry) return { sum: 0, count: 0 };
    const value = answers[itemKey];
    let sum = 0;
    let count = 0;
    if (entry.kind === "matrix" && isPlainObject(value)) {
      for (const row of entry.rows) {
        if (row.rated === false) continue;
        const v = value[row.key];
        if (typeof v === "number") {
          sum += v;
          count++;
        }
      }
    } else if (entry.kind === "rated_table" && isPlainObject(value)) {
      for (const row of entry.rows) {
        const r = value[row.key];
        const v = isPlainObject(r) ? r.rating : undefined;
        if (typeof v === "number") {
          sum += v;
          count++;
        }
      }
    }
    return { sum, count };
  };

  for (const { item } of walkItems(definition)) {
    if ((item.kind === "matrix" || item.kind === "rated_table") && item.total) {
      const { sum, count } = sumOf(item.key);
      computed[item.total.key] = count > 0 ? sum : null;
    }
    if (item.kind === "computed") {
      let total = 0;
      let count = 0;
      for (const ref of item.of) {
        const s = sumOf(ref);
        total += s.sum;
        count += s.count;
      }
      computed[item.key] = count > 0 ? total : null;
    }
  }
  return computed;
}

function findRatingItem(definition: FormDefinition, key: string): MatrixItem | RatedTableItem | null {
  for (const { item } of walkItems(definition)) {
    if ((item.kind === "matrix" || item.kind === "rated_table") && item.key === key) return item;
  }
  return null;
}

/** Item keys that belong to sections a participant may edit. */
export function sectionKeysEditableBy(definition: FormDefinition, participant: string): Set<string> {
  const keys = new Set<string>();
  for (const section of definition.sections) {
    const editors = section.editableBy ?? ["employee"];
    if (editors.includes(participant as NonNullable<FormSection["editableBy"]>[number])) keys.add(section.key);
  }
  return keys;
}

export function itemsOf(definition: FormDefinition): FormItem[] {
  return [...walkItems(definition)].map((e) => e.item);
}
