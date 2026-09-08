/**
 * WS-26 — the template definition contract.
 *
 * A definition is a validated document model: ordered sections of items. It
 * is data, never code: no expressions, no scripts, no HTML. The only
 * computation is `computed` items with `op: "sum"` over rating items, which
 * the server evaluates with a fixed function. Every binding names a source
 * from an allow-list resolved server-side (lib/formEngine/bindings.ts); a
 * definition can never name a database column.
 *
 * The same definition drives the responsive UI (artifacts/hrms) and the
 * structured PDF (lib/formEngine/render.ts), so the official form's wording,
 * section order, options and rating labels live in exactly one place.
 */
import { createHash } from "crypto";

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "date"
  | "number"
  | "phone"
  | "email"
  | "boolean"
  | "single_choice"
  | "multi_choice";

export type SectionLayout = "key_value" | "grid" | "stack";

export interface FormBinding {
  /** Allow-listed source resolved by lib/formEngine/bindings.ts. */
  source: "employee" | "department" | "position" | "statutory" | "organization" | "reporting_manager";
  ref: string;
  /** readonly: value is always the authoritative record; prefill: proposed, the user may change it. */
  mode: "readonly" | "prefill";
}

export interface FormOption {
  value: string;
  label: string;
}

export interface FieldItem {
  kind: "field";
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: FormOption[];
  binding?: FormBinding;
  helpText?: string;
  /** grid layout hint: full | half | third */
  width?: "full" | "half" | "third";
  /**
   * Generic field-level sensitivity (WS-26C). When true, the field's VALUE
   * (answer or autofilled) is disclosed only to the subject employee or a
   * caller holding `readPermission`; everyone else who can otherwise see the
   * submission gets the field with its value redacted (the label/structure is
   * preserved). This is organization-neutral metadata; it does not change the
   * printed form wording or layout.
   */
  sensitive?: boolean;
  /** Effective-permission key that unlocks a sensitive value; defaults to `employee.sensitive.read`. */
  readPermission?: string;
}

/** A row of checkboxes such as "TYPE OF LEAVE REQUESTED" or "OFFICE CALLED TO". */
export interface ChoiceGroupItem {
  kind: "choice_group";
  key: string;
  label?: string;
  mode: "single" | "multi";
  options: FormOption[];
  /** Optional free-text companion, e.g. "Other (specify)". */
  otherField?: { key: string; label: string; requiredWhenValue?: string };
  /** Pairs of option values of which at most one may be selected (multi mode). */
  exclusivePairs?: [string, string][];
  /** Options per printed row. */
  columns?: number;
  required?: boolean;
}

export interface RatingColumn {
  value: number;
  label: string;
}

export interface MatrixRow {
  key: string;
  label: string;
  /** A row that is printed but not rated (e.g. an "Overall Evaluation" comment prompt). */
  rated?: boolean;
  /** Repeat the column header row before this row (the probation form does this once). */
  repeatHeaderBefore?: boolean;
}

/** Criteria × rating columns (5 4 3 2 1). */
export interface MatrixItem {
  kind: "matrix";
  key: string;
  label?: string;
  criteriaHeader?: string;
  ratingHeader?: string;
  scaleText?: string;
  columns: RatingColumn[];
  rows: MatrixRow[];
  total?: { key: string; label: string };
  required?: boolean;
}

/** Fixed rows (Goal 1..3) each with text columns and ONE rating. */
export interface RatedTableItem {
  kind: "rated_table";
  key: string;
  label?: string;
  textColumns: { key: string; label: string; type: "short_text" | "long_text" }[];
  ratingHeader: string;
  ratingColumns: RatingColumn[];
  rows: { key: string; label: string }[];
  /** Blank continuation lines printed under each row on the official form. */
  printedLinesPerRow?: number;
  total?: { key: string; label: string };
  required?: boolean;
}

/** Repeatable structured rows (dependants). */
export interface TableItem {
  kind: "table";
  key: string;
  label?: string;
  columns: { key: string; label: string; type: "short_text" | "long_text" | "date" }[];
  minRows?: number;
  /** Blank rows printed on the official form when fewer rows exist. */
  printedRows?: number;
  required?: boolean;
}

export interface NoteItem {
  kind: "note";
  text: string;
  style?: "instruction" | "note" | "declaration" | "plain";
}

/** Signature slot: WS-26A renders the labelled line; WS-26B captures into it. */
export interface SignatureSlotItem {
  kind: "signature";
  key: string;
  label: string;
  role: "employee" | "supervisor" | "department_head" | "hr" | "final_approver" | "assessor";
  dateLabel?: string;
  required?: boolean;
}

export interface ComputedItem {
  kind: "computed";
  key: string;
  label: string;
  op: "sum";
  /** Keys of matrix / rated_table items whose ratings are summed. */
  of: string[];
}

export type FormItem = FieldItem | ChoiceGroupItem | MatrixItem | RatedTableItem | TableItem | NoteItem | SignatureSlotItem | ComputedItem;

export interface FormSection {
  key: string;
  /** Printed section heading (verbatim), may be empty for an unheaded block. */
  title?: string;
  layout: SectionLayout;
  items: FormItem[];
  /** Participants who may edit this section; empty/undefined = the submitting employee stage. */
  editableBy?: ("employee" | "supervisor" | "department_head" | "hr" | "final_approver" | "assessor")[];
}

export interface FormHeader {
  /** Lines printed beside/under the logo, verbatim and in order. */
  lines: string[];
  logo: "organization" | "none";
}

export interface FormDefinition {
  header: FormHeader;
  /** Introductory sentence(s) printed before the first section. */
  intro?: string[];
  sections: FormSection[];
  /** Closing note printed after the last section. */
  footerNotes?: string[];
}

export class FormDefinitionError extends Error {}

const LIMITS = {
  sections: 40,
  itemsPerSection: 80,
  rows: 200,
  options: 50,
  text: 4000,
  key: 64,
};

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const PARTICIPANTS = new Set(["employee", "supervisor", "department_head", "hr", "final_approver", "assessor"]);
const FIELD_TYPES = new Set<FormFieldType>([
  "short_text",
  "long_text",
  "date",
  "number",
  "phone",
  "email",
  "boolean",
  "single_choice",
  "multi_choice",
]);
const BINDING_SOURCES = new Set(["employee", "department", "position", "statutory", "organization", "reporting_manager"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, what: string, opts: { allowEmpty?: boolean; max?: number } = {}): string {
  if (typeof v !== "string") throw new FormDefinitionError(`${what} must be a string`);
  const t = v.trim();
  if (!opts.allowEmpty && t.length === 0) throw new FormDefinitionError(`${what} must not be empty`);
  if (t.length > (opts.max ?? LIMITS.text)) throw new FormDefinitionError(`${what} is too long`);
  return t;
}

function key(v: unknown, what: string): string {
  const k = str(v, what, { max: LIMITS.key });
  if (!KEY_PATTERN.test(k)) throw new FormDefinitionError(`${what} "${k}" must be lower_snake_case`);
  return k;
}

function optionalStr(v: unknown, what: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  return str(v, what, { allowEmpty: true });
}

function bool(v: unknown, what: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new FormDefinitionError(`${what} must be a boolean`);
  return v;
}

function options(v: unknown, what: string): FormOption[] {
  if (!Array.isArray(v) || v.length === 0) throw new FormDefinitionError(`${what} needs at least one option`);
  if (v.length > LIMITS.options) throw new FormDefinitionError(`${what} has too many options`);
  const seen = new Set<string>();
  return v.map((o, i) => {
    if (!isPlainObject(o)) throw new FormDefinitionError(`${what} option ${i} must be an object`);
    const value = str(o.value, `${what} option value`, { max: LIMITS.key });
    if (seen.has(value)) throw new FormDefinitionError(`${what} option "${value}" is duplicated`);
    seen.add(value);
    return { value, label: str(o.label, `${what} option label`) };
  });
}

function ratingColumns(v: unknown, what: string): RatingColumn[] {
  if (!Array.isArray(v) || v.length === 0) throw new FormDefinitionError(`${what} needs rating columns`);
  const seen = new Set<number>();
  return v.map((c, i) => {
    if (!isPlainObject(c)) throw new FormDefinitionError(`${what} column ${i} must be an object`);
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) throw new FormDefinitionError(`${what} column value must be a number`);
    if (seen.has(c.value)) throw new FormDefinitionError(`${what} column value ${c.value} is duplicated`);
    seen.add(c.value);
    return { value: c.value, label: str(c.label, `${what} column label`, { max: 200 }) };
  });
}

function binding(v: unknown, what: string): FormBinding | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isPlainObject(v)) throw new FormDefinitionError(`${what} binding must be an object`);
  const source = str(v.source, `${what} binding source`, { max: 64 });
  if (!BINDING_SOURCES.has(source)) throw new FormDefinitionError(`${what} binding source "${source}" is not allowed`);
  const ref = str(v.ref, `${what} binding ref`, { max: 128 });
  if (!/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(ref)) throw new FormDefinitionError(`${what} binding ref "${ref}" is malformed`);
  const mode = v.mode === "prefill" ? "prefill" : v.mode === "readonly" ? "readonly" : null;
  if (!mode) throw new FormDefinitionError(`${what} binding mode must be readonly or prefill`);
  return { source: source as FormBinding["source"], ref, mode };
}

/**
 * Validates a raw definition and returns the canonical, typed model. Throws
 * FormDefinitionError with a message a template author can act on. Every
 * item key is unique across the whole definition so answers, computed
 * values and signature slots address one thing each.
 */
export function validateFormDefinition(raw: unknown): FormDefinition {
  if (!isPlainObject(raw)) throw new FormDefinitionError("Definition must be an object");

  if (!isPlainObject(raw.header)) throw new FormDefinitionError("Definition needs a header");
  if (!Array.isArray(raw.header.lines) || raw.header.lines.length === 0) throw new FormDefinitionError("Header needs at least one line");
  const header: FormHeader = {
    lines: raw.header.lines.map((l, i) => str(l, `Header line ${i}`, { max: 400 })),
    logo: raw.header.logo === "none" ? "none" : "organization",
  };

  const intro = raw.intro === undefined ? undefined : arrayOfText(raw.intro, "Intro");
  const footerNotes = raw.footerNotes === undefined ? undefined : arrayOfText(raw.footerNotes, "Footer note");

  if (!Array.isArray(raw.sections) || raw.sections.length === 0) throw new FormDefinitionError("Definition needs at least one section");
  if (raw.sections.length > LIMITS.sections) throw new FormDefinitionError("Too many sections");

  const itemKeys = new Set<string>();
  const sectionKeys = new Set<string>();
  const ratingItemKeys = new Set<string>();
  const computedRefs: { key: string; of: string[] }[] = [];

  const registerKey = (k: string) => {
    if (itemKeys.has(k)) throw new FormDefinitionError(`Item key "${k}" is duplicated`);
    itemKeys.add(k);
  };

  const sections: FormSection[] = raw.sections.map((s, sIndex) => {
    if (!isPlainObject(s)) throw new FormDefinitionError(`Section ${sIndex} must be an object`);
    const sKey = key(s.key, `Section ${sIndex} key`);
    if (sectionKeys.has(sKey)) throw new FormDefinitionError(`Section key "${sKey}" is duplicated`);
    sectionKeys.add(sKey);
    const layout: SectionLayout = s.layout === "grid" ? "grid" : s.layout === "stack" ? "stack" : s.layout === "key_value" ? "key_value" : "stack";
    if (s.layout !== undefined && !["grid", "stack", "key_value"].includes(String(s.layout))) {
      throw new FormDefinitionError(`Section "${sKey}" layout is not supported`);
    }
    const editableBy = s.editableBy === undefined ? undefined : participants(s.editableBy, `Section "${sKey}" editableBy`);
    if (!Array.isArray(s.items)) throw new FormDefinitionError(`Section "${sKey}" needs an items list`);
    if (s.items.length > LIMITS.itemsPerSection) throw new FormDefinitionError(`Section "${sKey}" has too many items`);

    const items: FormItem[] = s.items.map((it, iIndex) => {
      if (!isPlainObject(it)) throw new FormDefinitionError(`Section "${sKey}" item ${iIndex} must be an object`);
      const where = `Section "${sKey}" item ${iIndex}`;
      switch (it.kind) {
        case "field": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          const type = str(it.type, `${where} type`, { max: 32 }) as FormFieldType;
          if (!FIELD_TYPES.has(type)) throw new FormDefinitionError(`${where} type "${type}" is not supported`);
          const item: FieldItem = { kind: "field", key: k, label: str(it.label, `${where} label`, { allowEmpty: true }), type };
          const required = bool(it.required, `${where} required`);
          if (required !== undefined) item.required = required;
          if (type === "single_choice" || type === "multi_choice") item.options = options(it.options, where);
          else if (it.options !== undefined) throw new FormDefinitionError(`${where} only choice fields take options`);
          const b = binding(it.binding, where);
          if (b) item.binding = b;
          const help = optionalStr(it.helpText, `${where} helpText`);
          if (help) item.helpText = help;
          if (it.width !== undefined) {
            if (!["full", "half", "third"].includes(String(it.width))) throw new FormDefinitionError(`${where} width is invalid`);
            item.width = it.width as FieldItem["width"];
          }
          const sensitive = bool(it.sensitive, `${where} sensitive`);
          if (sensitive !== undefined) item.sensitive = sensitive;
          const readPermission = optionalStr(it.readPermission, `${where} readPermission`);
          if (readPermission) {
            if (!sensitive) throw new FormDefinitionError(`${where} readPermission is only valid on a sensitive field`);
            item.readPermission = readPermission;
          }
          return item;
        }
        case "choice_group": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          const mode = it.mode === "multi" ? "multi" : it.mode === "single" ? "single" : null;
          if (!mode) throw new FormDefinitionError(`${where} mode must be single or multi`);
          const item: ChoiceGroupItem = { kind: "choice_group", key: k, mode, options: options(it.options, where) };
          const label = optionalStr(it.label, `${where} label`);
          if (label) item.label = label;
          if (it.otherField !== undefined) {
            if (!isPlainObject(it.otherField)) throw new FormDefinitionError(`${where} otherField must be an object`);
            const ok = key(it.otherField.key, `${where} otherField key`);
            registerKey(ok);
            item.otherField = { key: ok, label: str(it.otherField.label, `${where} otherField label`) };
            if (it.otherField.requiredWhenValue !== undefined) {
              const v = str(it.otherField.requiredWhenValue, `${where} otherField.requiredWhenValue`, { max: LIMITS.key });
              if (!item.options.some((o) => o.value === v)) throw new FormDefinitionError(`${where} requiredWhenValue "${v}" is not an option`);
              item.otherField.requiredWhenValue = v;
            }
          }
          if (it.exclusivePairs !== undefined) {
            if (mode !== "multi") throw new FormDefinitionError(`${where} exclusivePairs only apply to multi mode`);
            if (!Array.isArray(it.exclusivePairs)) throw new FormDefinitionError(`${where} exclusivePairs must be a list`);
            item.exclusivePairs = it.exclusivePairs.map((p, pi) => {
              if (!Array.isArray(p) || p.length !== 2) throw new FormDefinitionError(`${where} exclusivePairs[${pi}] must have two values`);
              const [a, b] = p.map((x) => str(x, `${where} exclusivePairs[${pi}]`, { max: LIMITS.key }));
              for (const v of [a, b]) {
                if (!item.options.some((o) => o.value === v)) throw new FormDefinitionError(`${where} exclusive pair value "${v}" is not an option`);
              }
              if (a === b) throw new FormDefinitionError(`${where} exclusive pair must name two different options`);
              return [a, b] as [string, string];
            });
          }
          if (it.columns !== undefined) {
            if (typeof it.columns !== "number" || !Number.isInteger(it.columns) || it.columns < 1 || it.columns > 6) {
              throw new FormDefinitionError(`${where} columns must be 1–6`);
            }
            item.columns = it.columns;
          }
          const required = bool(it.required, `${where} required`);
          if (required !== undefined) item.required = required;
          return item;
        }
        case "matrix": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          ratingItemKeys.add(k);
          if (!Array.isArray(it.rows) || it.rows.length === 0) throw new FormDefinitionError(`${where} needs rows`);
          if (it.rows.length > LIMITS.rows) throw new FormDefinitionError(`${where} has too many rows`);
          const rowKeys = new Set<string>();
          const rows: MatrixRow[] = it.rows.map((r, ri) => {
            if (!isPlainObject(r)) throw new FormDefinitionError(`${where} row ${ri} must be an object`);
            const rk = key(r.key, `${where} row ${ri} key`);
            if (rowKeys.has(rk)) throw new FormDefinitionError(`${where} row key "${rk}" is duplicated`);
            rowKeys.add(rk);
            const row: MatrixRow = { key: rk, label: str(r.label, `${where} row ${ri} label`) };
            const rated = bool(r.rated, `${where} row ${ri} rated`);
            if (rated !== undefined) row.rated = rated;
            const repeat = bool(r.repeatHeaderBefore, `${where} row ${ri} repeatHeaderBefore`);
            if (repeat !== undefined) row.repeatHeaderBefore = repeat;
            return row;
          });
          const item: MatrixItem = { kind: "matrix", key: k, columns: ratingColumns(it.columns, where), rows };
          for (const [prop, what] of [["label", "label"], ["criteriaHeader", "criteriaHeader"], ["ratingHeader", "ratingHeader"], ["scaleText", "scaleText"]] as const) {
            const v = optionalStr(it[prop], `${where} ${what}`);
            if (v) (item as unknown as Record<string, string>)[prop] = v;
          }
          if (it.total !== undefined) {
            if (!isPlainObject(it.total)) throw new FormDefinitionError(`${where} total must be an object`);
            const tk = key(it.total.key, `${where} total key`);
            registerKey(tk);
            item.total = { key: tk, label: str(it.total.label, `${where} total label`) };
          }
          const required = bool(it.required, `${where} required`);
          if (required !== undefined) item.required = required;
          return item;
        }
        case "rated_table": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          ratingItemKeys.add(k);
          if (!Array.isArray(it.textColumns) || it.textColumns.length === 0) throw new FormDefinitionError(`${where} needs textColumns`);
          const colKeys = new Set<string>();
          const textColumns = it.textColumns.map((c, ci) => {
            if (!isPlainObject(c)) throw new FormDefinitionError(`${where} column ${ci} must be an object`);
            const ck = key(c.key, `${where} column ${ci} key`);
            if (colKeys.has(ck)) throw new FormDefinitionError(`${where} column key "${ck}" is duplicated`);
            colKeys.add(ck);
            const type = c.type === "long_text" ? "long_text" : "short_text";
            return { key: ck, label: str(c.label, `${where} column ${ci} label`), type: type as "short_text" | "long_text" };
          });
          if (!Array.isArray(it.rows) || it.rows.length === 0) throw new FormDefinitionError(`${where} needs rows`);
          if (it.rows.length > LIMITS.rows) throw new FormDefinitionError(`${where} has too many rows`);
          const rowKeys = new Set<string>();
          const rows = it.rows.map((r, ri) => {
            if (!isPlainObject(r)) throw new FormDefinitionError(`${where} row ${ri} must be an object`);
            const rk = key(r.key, `${where} row ${ri} key`);
            if (rowKeys.has(rk)) throw new FormDefinitionError(`${where} row key "${rk}" is duplicated`);
            rowKeys.add(rk);
            return { key: rk, label: str(r.label, `${where} row ${ri} label`) };
          });
          const item: RatedTableItem = {
            kind: "rated_table",
            key: k,
            textColumns,
            ratingHeader: str(it.ratingHeader, `${where} ratingHeader`, { max: 200 }),
            ratingColumns: ratingColumns(it.ratingColumns, where),
            rows,
          };
          const label = optionalStr(it.label, `${where} label`);
          if (label) item.label = label;
          if (it.printedLinesPerRow !== undefined) {
            if (typeof it.printedLinesPerRow !== "number" || !Number.isInteger(it.printedLinesPerRow) || it.printedLinesPerRow < 0 || it.printedLinesPerRow > 20) {
              throw new FormDefinitionError(`${where} printedLinesPerRow must be 0–20`);
            }
            item.printedLinesPerRow = it.printedLinesPerRow;
          }
          if (it.total !== undefined) {
            if (!isPlainObject(it.total)) throw new FormDefinitionError(`${where} total must be an object`);
            const tk = key(it.total.key, `${where} total key`);
            registerKey(tk);
            item.total = { key: tk, label: str(it.total.label, `${where} total label`) };
          }
          const required = bool(it.required, `${where} required`);
          if (required !== undefined) item.required = required;
          return item;
        }
        case "table": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          if (!Array.isArray(it.columns) || it.columns.length === 0) throw new FormDefinitionError(`${where} needs columns`);
          const colKeys = new Set<string>();
          const columns = it.columns.map((c, ci) => {
            if (!isPlainObject(c)) throw new FormDefinitionError(`${where} column ${ci} must be an object`);
            const ck = key(c.key, `${where} column ${ci} key`);
            if (colKeys.has(ck)) throw new FormDefinitionError(`${where} column key "${ck}" is duplicated`);
            colKeys.add(ck);
            const type = c.type === "long_text" ? "long_text" : c.type === "date" ? "date" : "short_text";
            return { key: ck, label: str(c.label, `${where} column ${ci} label`), type: type as "short_text" | "long_text" | "date" };
          });
          const item: TableItem = { kind: "table", key: k, columns };
          const label = optionalStr(it.label, `${where} label`);
          if (label) item.label = label;
          for (const prop of ["minRows", "printedRows"] as const) {
            const v = it[prop];
            if (v !== undefined) {
              if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > LIMITS.rows) throw new FormDefinitionError(`${where} ${prop} is invalid`);
              item[prop] = v;
            }
          }
          const required = bool(it.required, `${where} required`);
          if (required !== undefined) item.required = required;
          return item;
        }
        case "note": {
          const item: NoteItem = { kind: "note", text: str(it.text, `${where} text`) };
          if (it.style !== undefined) {
            if (!["instruction", "note", "declaration", "plain"].includes(String(it.style))) throw new FormDefinitionError(`${where} style is invalid`);
            item.style = it.style as NoteItem["style"];
          }
          return item;
        }
        case "signature": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          const role = str(it.role, `${where} role`, { max: 32 });
          if (!PARTICIPANTS.has(role)) throw new FormDefinitionError(`${where} role "${role}" is not a participant`);
          const item: SignatureSlotItem = { kind: "signature", key: k, label: str(it.label, `${where} label`), role: role as SignatureSlotItem["role"] };
          const dateLabel = optionalStr(it.dateLabel, `${where} dateLabel`);
          if (dateLabel) item.dateLabel = dateLabel;
          const required = bool(it.required, `${where} required`);
          if (required !== undefined) item.required = required;
          return item;
        }
        case "computed": {
          const k = key(it.key, `${where} key`);
          registerKey(k);
          if (it.op !== "sum") throw new FormDefinitionError(`${where} op must be "sum"`);
          if (!Array.isArray(it.of) || it.of.length === 0) throw new FormDefinitionError(`${where} needs "of" keys`);
          const of = it.of.map((x) => key(x, `${where} of`));
          computedRefs.push({ key: k, of });
          return { kind: "computed", key: k, label: str(it.label, `${where} label`), op: "sum", of };
        }
        default:
          throw new FormDefinitionError(`${where} kind "${String(it.kind)}" is not supported`);
      }
    });

    const section: FormSection = { key: sKey, layout, items };
    const title = optionalStr(s.title, `Section "${sKey}" title`);
    if (title) section.title = title;
    if (editableBy) section.editableBy = editableBy;
    return section;
  });

  for (const c of computedRefs) {
    for (const ref of c.of) {
      if (!ratingItemKeys.has(ref)) throw new FormDefinitionError(`Computed "${c.key}" references "${ref}", which is not a matrix or rated_table`);
    }
  }

  const definition: FormDefinition = { header, sections };
  if (intro) definition.intro = intro;
  if (footerNotes) definition.footerNotes = footerNotes;
  return definition;
}

function arrayOfText(v: unknown, what: string): string[] {
  if (!Array.isArray(v)) throw new FormDefinitionError(`${what} must be a list of text`);
  return v.map((t, i) => str(t, `${what} ${i}`));
}

function participants(v: unknown, what: string): FormSection["editableBy"] {
  if (!Array.isArray(v)) throw new FormDefinitionError(`${what} must be a list`);
  return v.map((p) => {
    const s = str(p, what, { max: 32 });
    if (!PARTICIPANTS.has(s)) throw new FormDefinitionError(`${what} "${s}" is not a participant`);
    return s as NonNullable<FormSection["editableBy"]>[number];
  });
}

/** Stable, key-sorted JSON so the same definition always hashes identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function definitionSha256(definition: FormDefinition): string {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}

/** Every item that can hold an answer or a computed value, in document order. */
export function* walkItems(definition: FormDefinition): Generator<{ section: FormSection; item: FormItem }> {
  for (const section of definition.sections) {
    for (const item of section.items) yield { section, item };
  }
}

export function findItem(definition: FormDefinition, itemKey: string): { section: FormSection; item: FormItem } | null {
  for (const entry of walkItems(definition)) {
    if ("key" in entry.item && entry.item.key === itemKey) return entry;
  }
  return null;
}
