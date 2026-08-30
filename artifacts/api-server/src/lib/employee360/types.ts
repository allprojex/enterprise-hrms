/**
 * WS-15 P2/P3 — Employee 360's bounded section contract (§31.29).
 *
 * THIS IS READ COMPOSITION, NOT A DATA MODEL. Every section below is a small,
 * safe summary of what one module already holds, plus a link into that module.
 * Nothing here is authoritative, nothing here is stored, and nothing here may
 * be written through — §31.29 freezes Employee 360 as "a cross-module employee
 * visibility and read concern, not an action workflow", because conflating the
 * two is how a read surface acquires write authority by accident.
 *
 * NO GIANT EMPLOYEE DTO (§31.29). A section carries a handful of headline
 * figures and at most a few recent rows. It is deliberately not everything a
 * module knows about the person: the module's own surface is one deep link
 * away, and it re-gates there.
 *
 * A SECTION THE CALLER MAY NOT READ IS OMITTED (§31.29, §31.3(2)). It is never
 * returned empty and never returned redacted-but-present, because an empty
 * section asserts that the module exists and holds nothing about this person —
 * which for a grievance is itself the disclosure. Omission is indistinguishable
 * from the module being disabled, which is exactly the property that makes it
 * safe.
 *
 * SUCCESSION IS ABSENT AND MUST STAY ABSENT. §30.17 is explicit: an employee's
 * standing in a succession plan NEVER appears on their 360 view — not to an
 * authorized reader, not to anyone. There is no succession section below and
 * none may be added.
 *
 * PAYROLL IS ABSENT TOO. §31.29's list of missing sections does not name it,
 * and a generic employee page is the wrong place for pay, bank details or
 * statutory identifiers. Adding one is an architecture change.
 */

/** Fixed vocabulary. A section names its owning module, never a table. */
export type Employee360SectionKey =
  | "employment_lifecycle"
  | "employee_relations"
  | "employee_requests"
  | "skills"
  | "leave"
  | "learning"
  | "attendance"
  | "onboarding";

/**
 * How a source's data relates to the platform's current model (§31.29's
 * legacy-versus-successor reconciliation, and §24 of the Pass-3B brief).
 *
 * `current` — the authoritative model today.
 * `legacy`  — genuine history from a superseded model, shown because deleting
 *             or hiding it would erase a record somebody may need to explain.
 *             It is LABELLED, never mixed into the current model's rows, and
 *             never migrated (§31.37).
 */
export type Employee360Provenance = "current" | "legacy";

/** A headline figure. Small, factual, and never a computed judgement. */
export interface Employee360Stat {
  label: string;
  value: string;
}

/**
 * One row inside a section. Deliberately narrow: a label, a status, a date.
 *
 * There is no free-text body, no narrative, no evidence and no proposed value.
 * Where naming the subject or the field would itself be a disclosure — a
 * grievance, a data-change request — the row carries a reference instead.
 */
export interface Employee360Row {
  id: number;
  label: string;
  status: string | null;
  occurredAt: Date | null;
  /** Provenance of THIS row, so a legacy row can sit beside current ones honestly. */
  provenance: Employee360Provenance;
}

export interface Employee360Section {
  key: Employee360SectionKey;
  title: string;
  provenance: Employee360Provenance;
  stats: Employee360Stat[];
  rows: Employee360Row[];
  /**
   * True when the section holds more than `rows` shows. The 360 view is a
   * summary; the owning module has the rest.
   */
  truncated: boolean;
  /** Route into the module that owns and re-gates the detail. */
  deepLink: string;
  /**
   * A short, non-sensitive statement shown beside a legacy section, so a reader
   * is never left to guess why a superseded model is on the page.
   */
  note?: string;
}

export interface Employee360Result {
  sections: Employee360Section[];
  /**
   * Sections the caller IS authorized for whose data could not be loaded
   * (§31.22's convention, applied here). Never contains a section the caller
   * may not see, so it cannot disclose that a module exists.
   */
  unavailableSections: Employee360SectionKey[];
}

export interface Employee360Context {
  organizationId: number;
  employeeId: number;
  applicationUserId: number;
  membershipId: number;
}

/**
 * The same bounded adapter contract the Action Centre uses (§31.5), because
 * §31.29 says to follow it exactly.
 *
 * The `authorize`/`query` split is the confidentiality boundary: an
 * authorization failure collapses to omission and discloses nothing, while only
 * a failure of the data query — reached only once the caller is known to be
 * authorized — may be named as unavailable.
 */
export interface Employee360Provider {
  key: Employee360SectionKey;
  authorize(ctx: Employee360Context): Promise<boolean>;
  /** Returns null when the module genuinely holds nothing for this employee. */
  query(ctx: Employee360Context): Promise<Employee360Section | null>;
}

/** Sections show at most this many rows. The module holds the rest. */
export const SECTION_ROW_LIMIT = 5;

export function limitRows(rows: Employee360Row[]): { rows: Employee360Row[]; truncated: boolean } {
  return { rows: rows.slice(0, SECTION_ROW_LIMIT), truncated: rows.length > SECTION_ROW_LIMIT };
}
