# Custom Fields & Form Builder (WS-8)

Lets an organization add its own structured data to approved record types, and
compose those fields into data-entry forms — **without a customer-specific
source-code fork**.

Authoritative scope: `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §24.

This is **organization configuration**, not an extension framework. It is not a
plugin system, not code execution, not dynamic schema generation, not a
scripting engine and not a workflow engine. OD #3's deferral of a general
third-party plugin framework is untouched.

---

## The distinction that shapes everything

| | Classification | Where it lives |
| --- | --- | --- |
| Field/form **definition** | organization **configuration** | `custom_field_definitions` (+ versions), `custom_forms` (+ versions) |
| Field **value** / form **submission** | tenant-isolated **business data** | `custom_field_values`, `custom_form_submissions` |

Business values are never stored inside configuration JSON, and definitions
carry stable organization-local keys so they can be reproduced in another
organization as a template without dragging data along.

**Use a custom field** when the requirement is data/configuration shaped.
**Use organization extension code** only when genuinely new business logic is
required. "Church Membership Status" is a good custom field; "Employee Salary"
is not — Payroll already owns compensation authoritatively.

---

## Architecture

```
routes/customFields.ts
  └── lib/customFields/definitions.ts   identity, versioning, safe/breaking classification
  └── lib/customFields/values.ts        typed storage, visibility enforcement, masking, reporting
  └── lib/customFields/forms.ts         composition, publishing, submissions
        ├── fieldTypes.ts   the type registry + declarative validation
        ├── visibility.ts   the constrained condition evaluator
        └── scopes.ts       the scope → authoritative table allow-list
```

Six tables, migration `0064`, all RLS-enabled with zero policies. **No dynamic
DDL anywhere**: a custom field never becomes a physical column and no domain
table is ever `ALTER`ed.

---

## Scopes

A definition binds to a **scope**, never a table name. The scope enum *is* the
allow-list, so the prohibited domains are unreachable by construction rather
than by a rule someone has to remember.

| Scope | Bindable | Authoritative table |
| --- | --- | --- |
| `employee` | yes | `employees` |
| `candidate` | yes | `candidates` |
| `application` | yes | `applications` |
| `position` | yes | `positions` |
| `organization_profile` | yes | the caller's own organization |
| `onboarding` | **no — definitions only** | none yet (see WS-10 contract) |

**Not reachable**: payroll transactions and runs, leave, attendance, asset and
office-inventory movements, disciplinary findings, audit records, security
identities.

Before any read or write, the server proves the target record exists *and*
belongs to the caller's organization. A `(scope, entityId)` pair is never
trusted on its own.

---

## Field types

`short_text`, `long_text`, `integer`, `decimal`, `boolean`, `date`,
`datetime`, `single_select`, `multi_select`, `email`, `phone`, `url`,
plus both optional reference types — **`employee_reference` and
`master_data_reference` were implemented**, since the repository already had
cheap, safe, org-scoped lookups for each (`employees`, `master_data_items`
with its system-vs-org row model). Both validate the referenced record belongs
to the same organization.

**Deliberately absent**: formulas, calculated fields, JavaScript, SQL
expressions, scripts, arbitrary HTML, and **file uploads** (those remain with
Documents & Records).

There is no expression evaluator in the codebase for this feature. Validation
is declarative bounds only — min/max length, min/max value, date bounds,
allowed options — so organization-supplied content has no execution path.

### Value storage

Values are stored as a typed envelope, never a bare string:

```json
{ "type": "integer", "value": 42 }
```

`null` stays `null` and is never coerced to `""` — "not answered" and
"answered with nothing" are different facts. Decimals round-trip as strings to
avoid float re-printing. Reporting flattens the envelope while preserving type.

---

## Versioning, and what happens to old data

A field has a **stable identity** (`id`, `fieldKey`) that survives every
revision. Editing creates the **next version**; it never rewrites one. Each
stored value records the `definitionVersionId` it was captured under, so
reading an old value never reinterprets it through today's configuration.

Exactly one version per field is `isCurrent`, enforced by a partial unique
index — the same database-level guarantee `employee_compensation_components`
already uses for its open row.

| Safe (creates a new version) | Breaking (**refused** once values exist) |
| --- | --- |
| label, help text, display order | changing the field type |
| optional → required (prospective) | removing a choice already in use |
| adding a new choice | changing the master-data domain |

Breaking changes return `409` with the reason. The organization creates a new
field instead. **Old values are never mutated to fit a changed type.**

### Required is prospective

Turning a field required never rewrites history and never fabricates a value.
Existing records simply report `missingRequired: true`, surfaced in the UI as
*“Missing required custom data”*. A field hidden by its own conditions, or an
archived one, is never reported as missing.

### Archive

Archiving stops new entry and **preserves every stored value and submission**.
There is no delete path once values exist.

---

## Conditional visibility

A declarative rule with a fixed operator set — `equals`, `not_equals`,
`contains`, `is_empty`, `is_not_empty`, `in`, `not_in` — referencing only
sibling fields in the same scope. Self-reference is rejected at configuration
time, which removes the whole cycle class without a graph walk.

**Conditions are evaluated on the server, on the write path.** A field that is
not applicable cannot be set by crafting an API request; the write is refused
with `422`. Visibility is evaluated against the state the record will be in
*after* the write, so a field made applicable by another value in the same
request is accepted, and one made inapplicable is refused.

---

## Sensitivity, permissions and audit

A field is `normal` or `sensitive`. Sensitive values are **masked by default**
and revealed only to a caller holding `custom_fields.sensitive.read` — and a
reveal is audited as a sensitive read, following the payroll banking precedent.
Sensitive values never enter audit metadata or logs.

There are deliberately **no per-field ACLs**. Two planes:

| Plane | Permission |
| --- | --- |
| Configuration (defining fields/forms) | `custom_fields.read` / `.manage`, `custom_forms.read` / `.manage` |
| Values on a record | the **target domain's** own permission (`employee.read`/`.write`, `candidate.*`, `position.*`, `organization.*`) |
| Revealing a sensitive value | `custom_fields.sensitive.read` |

Seeded: `org_admin` gets configuration authority; `hr_manager` gets
`custom_fields.read` plus form read/manage. **`custom_fields.sensitive.read` is
registered but granted to no role** — revealing sensitive data is an explicit
per-organization delegation, following the payroll precedent.

Audited: field created / version created / archived / restored, form created /
version created / published / archived, sensitive value revealed, values
updated, values exported. Ordinary form rendering is **not** audited.

Audit categories: `custom_field.*` and `custom_form.*` are
`platform_configuration` (they are configuration); `custom_field_value.*` and
`custom_form_submission.*` are `hr` (they are people data).

---

## Reporting, export and search

Custom values are reportable and exportable via a reusable backend contract,
using the platform's formula-injection-safe CSV writer (WS-1). Sensitive
columns are **omitted entirely** unless authorized — never masked-but-present,
which would look authoritative in a spreadsheet.

**Global search is out of scope.** Custom values are deliberately not indexed
for search, avoiding performance cost, accidental sensitive exposure and
inconsistent indexing. A future workstream may design it.

### Performance

Values are batch-loaded for entity lists in a single query
(`getValuesForEntities`), indexed on `(organizationId, scope, entityId)` —
avoiding the classic EAV N+1. Only those dimensions plus `definitionId` are
indexed; arbitrary values are not.

---

## Form Builder

Forms compose custom fields into ordered **sections** with headings and help
text. Layout is a validated JSONB document — an ordered-section editor, not a
page designer. No drag-and-drop, no arbitrary HTML or CSS, no scripting, no
pixel positioning.

**Repeating and nested groups are out of scope.** Qualifications,
certifications, dependants and employment periods use their proper normalized
domain tables; a form builder must not be used to recreate them.

Form types: `internal_hr`, `employee_ess`, `onboarding`,
`candidate_application`.

**Core platform fields are not exposed to the builder.** Only custom fields can
be placed on a form, which is the strictest reading of §24.20 and avoids the
"administrator types `employees.bankAccountNumber`" hazard entirely. Exposing a
narrow, allow-listed set of core fields is a natural later extension.

### Versioning and submissions

Publishing freezes a version; at most one version per form is published
(partial unique index). Editing creates the next **draft** — it never changes
what has already been submitted.

A submission snapshots the field **label, type and definition version**
alongside each answer, so a historical submission renders exactly as submitted
even after the live definitions are renamed or re-optioned. Submissions are
append-oriented and never silently mutated.

### Server-side submission validation

Nothing is trusted from the client. The server re-derives the published
version, its field membership, each field's type and validation, and each
field's visibility. It **rejects** extra or unrecognized fields (no mass
assignment) and rejects a submission whose `formVersionId` is not the currently
published one — so a stale or forged client cannot write against a layout the
server did not authorize.

### ESS and candidate forms

- **ESS**: the target employee is resolved **server-side** from the caller's
  own identity (reusing the established `resolveOwnEmployeeId`). A
  client-supplied `entityId` is ignored rather than validated, so there is
  nothing to manipulate.
- **Candidate**: form *definitions* are supported. **No anonymous or public
  access exists.** Public candidate-facing recruitment integration belongs to
  WS-9.
- **No generic approval workflow.** A submission may later feed a specialized
  domain workflow; WS-8 does not build a second workflow engine.

---

## Integration contracts for later workstreams

**WS-10 (Onboarding)** — `onboarding` exists as a definable scope with
`bindable: false`. When WS-10 ships an authoritative onboarding record, flip
that flag and add the entity lookup in `lib/customFields/scopes.ts`. Nothing
else changes. WS-8 deliberately does not fabricate onboarding records.

**WS-9 (Recruitment)** — candidate/application scopes and the
`candidate_application` form type already exist. WS-9 owns any public,
unauthenticated application flow.

**WS-7 (Migration)** — `setValuesForEntity` is the stable import contract:
org-scoped, type-validated, visibility-enforced, entity-verified. A WS-7
adapter was **deliberately not wired in this workstream**: adding one is
straightforward against that contract, but it was not required to close WS-8
and doing it here would mean touching WS-7's registry for a capability nobody
has yet asked to import. The contract is what §24.18 required; the adapter
remains a small, safe follow-on.

**Configuration portability** — definitions and forms carry stable
organization-local keys (`fieldKey`, `formKey`) precisely so a future
configuration export/import can reproduce them elsewhere without copying
values or submissions. The transfer service itself is not built here.
