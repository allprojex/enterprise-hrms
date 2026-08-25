/**
 * WS-5 (§21-22) — the controlled merge-field system used to turn a
 * document_template_versions row into finished letter text.
 *
 * The security model is "allow-list, not sandbox". Template content is
 * organization-controlled input written by HR users, and the frozen scope is
 * explicit that it must never reach a JavaScript evaluator, a templating
 * language, a file reader, or a network client. So this deliberately is not
 * a template engine: it is a single regular expression that finds
 * `{{field.name}}` tokens and replaces each with a string looked up in a
 * context object built entirely server-side. There is no expression syntax,
 * no conditionals, no loops, no property-path traversal, no helper/filter
 * invocation — which means there is no server-side template injection
 * surface to sandbox in the first place. A token naming a field that is not
 * in MERGE_FIELDS is not resolved, and cannot be: the lookup only ever
 * consults an object whose keys this file defines.
 *
 * Output is plain text and is drawn into a PDF as literal glyphs
 * (lib/pdfWriter.ts, which escapes every byte it writes), so there is no
 * HTML/script sink downstream either — script injection is not mitigated
 * here so much as structurally absent.
 */

/**
 * Every merge field the platform supports, with the human-readable label the
 * template editor UI lists. Organization-neutral by construction (CLAUDE.md
 * §"One Shared Foundation"): these describe an employee, a position, and an
 * organization in general terms, and contain nothing specific to any
 * customer.
 *
 * Adding a field here is the only way to make it resolvable — which is the
 * point. Deliberately excluded, and to stay excluded: anything from
 * employee_banking_details, employee_statutory_identifiers,
 * employee_compensation_components, or any other sensitive payroll/identity
 * record. A letter template is authored by whoever holds
 * `document_template.manage`, which is not and must not become a backdoor
 * read of payroll data through a merge field (see §42 on the same risk in
 * preview).
 */
export const MERGE_FIELDS: readonly { key: string; label: string }[] = [
  { key: "organization.name", label: "Organization name" },
  { key: "organization.address", label: "Organization address" },
  { key: "organization.contactEmail", label: "Organization contact email" },
  { key: "organization.contactPhone", label: "Organization contact phone" },
  { key: "employee.fullName", label: "Employee full name" },
  { key: "employee.firstName", label: "Employee first name" },
  { key: "employee.lastName", label: "Employee last name" },
  { key: "employee.employeeNumber", label: "Employee number" },
  { key: "employee.email", label: "Employee work email" },
  { key: "position.title", label: "Position title" },
  { key: "department.name", label: "Department name" },
  { key: "branch.name", label: "Branch name" },
  { key: "letter.date", label: "Letter date" },
  { key: "letter.effectiveDate", label: "Effective date" },
  { key: "letter.reference", label: "Letter reference" },
];

const MERGE_FIELD_KEYS: ReadonlySet<string> = new Set(MERGE_FIELDS.map((f) => f.key));

export type MergeContext = Record<string, string>;

/**
 * Matches `{{ field.name }}` with optional inner whitespace. The field-name
 * character class is restricted to letters, digits, dot, and underscore —
 * so a token cannot contain the delimiters, whitespace, or anything that
 * could be read as an expression even before the allow-list check runs.
 */
const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

export class UnknownMergeFieldError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Unknown merge field(s): ${fields.join(", ")}`);
  }
}

/** Every distinct token appearing in `content`, in first-appearance order. */
export function extractMergeFields(content: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      found.push(key);
    }
  }
  return found;
}

/** The tokens in `content` that are not in the allow-list. */
export function findUnknownMergeFields(content: string): string[] {
  return extractMergeFields(content).filter((key) => !MERGE_FIELD_KEYS.has(key));
}

/**
 * Rejects template content that references a field the platform cannot
 * resolve. Called when a template version is created/updated, so an
 * unresolvable token is caught while the author is editing it — not silently
 * at generation time, on an official letter, when it is far more expensive
 * to notice (§21: "unknown variables should fail clearly").
 */
export function assertKnownMergeFields(content: string): void {
  const unknown = findUnknownMergeFields(content);
  if (unknown.length > 0) {
    throw new UnknownMergeFieldError(unknown);
  }
}

/**
 * Substitutes every allow-listed token in `content` from `context`.
 *
 * A known field the caller supplied no value for renders as the empty string
 * rather than leaving the raw `{{token}}` visible in a finished official
 * letter — the documented safe policy for this codebase (§21). Validation at
 * authoring time (assertKnownMergeFields) is what catches genuine mistakes;
 * by generation time, a missing optional value (an employee with no middle
 * name, a letter with no reference) is normal and must not disfigure the
 * document. Unknown tokens are left untouched, so if one ever reaches this
 * point it is visible in the output rather than silently swallowed.
 */
export function renderTemplate(content: string, context: MergeContext): string {
  return content.replace(TOKEN_PATTERN, (whole, key: string) => {
    if (!MERGE_FIELD_KEYS.has(key)) return whole;
    return context[key] ?? "";
  });
}

/**
 * The synthetic context used for template preview (§42). Every value is
 * obviously fake, so an authorized template editor previewing their own
 * draft can see the letter's shape without this becoming a way to read real
 * employee records by guessing merge fields — a template editor holds
 * `document_template.manage`, which conveys no entitlement to any
 * individual's data.
 */
export function buildSampleContext(organizationName: string): MergeContext {
  return {
    "organization.name": organizationName,
    "organization.address": "123 Sample Street, Sample City",
    "organization.contactEmail": "hr@example.invalid",
    "organization.contactPhone": "+000 000 0000",
    "employee.fullName": "Sample Employee",
    "employee.firstName": "Sample",
    "employee.lastName": "Employee",
    "employee.employeeNumber": "SAMPLE-0001",
    "employee.email": "sample.employee@example.invalid",
    "position.title": "Sample Position",
    "department.name": "Sample Department",
    "branch.name": "Sample Branch",
    "letter.date": "1 January 2000",
    "letter.effectiveDate": "1 February 2000",
    "letter.reference": "SAMPLE/REF/0001",
  };
}
