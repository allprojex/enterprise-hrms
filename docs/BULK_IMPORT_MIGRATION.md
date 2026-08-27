# Bulk Import / Multi-Entity Migration (WS-7)

Imports an organization's existing records into the platform — organizational
structure, employees with their historical staff/PIF numbers, employment
history, qualifications, certifications, leave opening balances and payroll
opening balances — from CSV or Excel, with a full dry run before anything is
written.

This is the engine used to onboard an organization that already has years of
records. It is not a general-purpose data-loading tool: every entity type it
can write is a server-defined adapter, and there is no endpoint that accepts
a table name or arbitrary SQL.

---

## Architecture

One orchestration layer, many entity adapters.

```
routes/migrations.ts
  └── lib/migrations/batchService.ts      batch, source upload, column mapping, staging
  └── lib/migrations/executionService.ts  dry run, approval, execution, reconciliation
        └── lib/migrations/adapterRegistry.ts   the allow-list
              └── lib/migrations/entityAdapters/*.ts
```

The orchestration layer owns the lifecycle, the staging table, idempotency,
audit and permissions. An adapter owns only three things for its own entity:

| Method | Purity | Responsibility |
| --- | --- | --- |
| `normalizeRow` | pure, sync | coerce one mapped row's strings into typed values; no database access |
| `planRow` | read-only | resolve duplicates and cross-entity references; never mutates |
| `executeRow` | mutating | perform the actual write, by calling an existing domain service |

An adapter never writes SQL of its own where a domain service exists. Every
one of the nine reuses the platform's real creation paths — the same code the
live UI uses — so an imported record is indistinguishable from a
hand-entered one and inherits that domain's own validation and audit trail.

### Supported entity types

Executed in dependency order, derived from each adapter's `dependsOn` (never
from the order files were uploaded):

| Entity type | Depends on | Reuses |
| --- | --- | --- |
| `branch` | — | direct insert (no service exists; matches the route's own shape) |
| `department` | branch | `assertValidDepartmentPlacement` |
| `position` | department | `assertValidPositionPlacement` |
| `employee` | branch, department, position | `assertEmployeeReferencesValid`, `allocateLegacyEmployeeNumber` / `allocateGeneratedEmployeeNumber`, `createLegacyPersonnelFile` |
| `employment_history` | employee, branch, department, position | `recordEmploymentPeriodEvent` |
| `qualification` | employee | `addEmployeeQualification` |
| `certification` | employee | `addEmployeeCertification` |
| `leave_balance` | employee | `postLedgerEntry` (`opening_balance`) |
| `payroll_opening_balance` | employee | `createCompensationComponent`, `assertComponentTypeKnown` |

---

## Lifecycle

```
draft ──upload + map every source──▶ mapped
mapped ──validate (dry run)──▶ validated
validated ──approve (freezes checksums)──▶ approved
approved ──execute──▶ running ──▶ completed | completed_with_errors
```

Any source-affecting change (re-upload, re-map) drops the batch back to
`draft` and clears its approval. This is enforced structurally, not by asking
users not to do it.

`cancelled` is reachable from any pre-execution state. A running or finished
migration cannot be cancelled, because cancelling would imply undoing
committed rows — see **Rollback boundary**.

---

## File formats and limits

CSV and XLSX. Limits are enforced before parsing and again after:

| Limit | Value |
| --- | --- |
| File size | 20 MB |
| Data rows | 50,000 |
| Columns | 200 |

**Security posture:**

- CSV parsing is a hand-written RFC4180-shaped parser with no dependency. It
  splits characters into strings and does nothing else — it never evaluates
  anything.
- XLSX is read with `exceljs`. Formulas are **never evaluated**: a formula
  cell contributes only its cached `.result` value. This is the only
  dependency WS-7 adds.
- Null bytes and invalid UTF-8 are rejected as "not plain text".
- Text shaped like a formula injection (`=`, `+`, `-`, `@`) is imported as
  inert text. It only becomes dangerous on *export*, which is why every CSV
  this workstream emits (templates, reconciliation reports) goes through the
  platform's existing `safeCsvCell`/`toCsv` helpers.

---

## Column mapping

Auto-mapping is deliberately conservative. A source header maps automatically
only when its normalized form matches exactly **one** canonical field's key,
label or alias. Ambiguous or unrecognized headers are left blank for a human
to resolve.

A wrong silent mapping in a bulk import is far more damaging than an unmapped
column the user has to click once.

Server-side, a submitted mapping is validated before it is stored: every
target must be a real canonical field of that adapter, no field may be mapped
twice, and every required field must be covered. This also means client input
can never introduce an arbitrary key into `normalizeRow`'s input.

---

## Staging, dry run and duplicate handling

Staging is offline and pure: parse → apply mapping → `normalizeRow` → one
`migration_staged_rows` row. Staging the same file twice always produces the
same rows.

The dry run (`validateBatch`) re-plans every staged row against live data and
writes nothing. It resolves references in **`dry_run` mode**, where a
reference is satisfied if the target either already exists live *or* has a
valid staged row from an earlier entity type in the same batch. That is what
lets a single batch import a branch, a department inside it, and employees
inside that department, all at once.

At execution time references are re-resolved in **`execute` mode**, which
only ever checks live data — by then, dependencies have already committed.
Execution never trusts the dry run's resolution, which could have gone stale.

**Duplicate handling is conservative and never silently merges.** A supplied
staff number or PIF number that already has an active allocation is a hard
validation error requiring human resolution. This workstream never guesses
that two records describe the same person, and never matches on a name.

---

## Approval and source integrity

Approval refuses a batch that still has error rows, then snapshots every
source file's sha256 into the batch.

Before execution begins, every stored file is re-read and re-hashed against
that snapshot. A file swapped between approval and execution is refused with
a 409 rather than silently imported.

---

## Execution, idempotency and the rollback boundary

**A migration is not one giant transaction.** It is a sequence of per-row
mutations in dependency order. Each row either succeeds and is marked
`created`, or fails and is marked `failed` with its error text — and the
batch continues. `completed_with_errors` is a first-class, expected outcome.

This is a deliberate choice. A 20,000-row import that dies on row 19,998 and
rolls everything back is useless to an HR team; 19,997 imported rows plus a
precise list of the 3 that need fixing is actionable.

**The consequence is that there is no automatic rollback of a partially
executed migration.** This is a real limitation, stated plainly rather than
papered over. The mitigations are:

1. Nothing executes until a human approves a clean dry run.
2. Every row's fate is individually recorded and reportable.
3. Re-running a batch only ever retries rows still `pending`, so recovery is
   "fix the failed source rows and re-run", never "undo".

**Idempotency** has three layers:

1. `migration_sources` — `UNIQUE(batchId, entityType)`: one file per entity
   type per batch.
2. `migration_staged_rows` — `UNIQUE(sourceId, rowNumber)`, plus
   `executionStatus`, which is the real guard. A row is claimed by a
   conditional `UPDATE ... WHERE executionStatus = 'pending'` before its
   adapter runs, so two concurrent executions cannot both execute the same
   row.
3. Domain-level constraints in the underlying services —
   `employee_number_allocations`' partial unique index, `personnel_files`'
   PIF uniqueness, `leave_balance_entries.sourceReference`'s unique index
   (WS-7 supplies a deterministic `sourceReference` per row so a leave
   opening balance can never double-post).

> **Known gap, disclosed:** `createCompensationComponent` has no
> `sourceReference` equivalent. For `payroll_opening_balance`, the staged
> row's `executionStatus` is the *only* guard against a double import. The
> domain layer provides none, and WS-7 does not invent a parallel one.

### Small vs large migrations

Under 1,000 total rows, execution runs synchronously in the HTTP request and
returns a finished result. Above that, it is handed to the WS-6 job worker as
`migration.execute_chunk` and the route returns 202.

The job follows WS-6's own rules: a narrow payload (batch id and actor ids
only — no HR content, no pre-resolved decisions), authoritative state
re-fetched on every run, chunked at 500 rows per execution with the job
re-scheduling itself while rows remain, and `PermanentJobError` for states
retrying cannot fix.

---

## Reconciliation

Every staged row lands in exactly one bucket — `created`, `matched`,
`skipped`, `failed`, `pending` — and the buckets sum to the source row count.
A silently dropped row is arithmetically impossible to hide.

Available as JSON and as a downloadable CSV report.

---

## Permissions

A dedicated triad, rather than a union of the six domains a migration writes
to (no single existing key is semantically correct, and composing six on
every route would make "who can run an import" impossible to reason about):

| Permission | Grants | Seeded to |
| --- | --- | --- |
| `migration.read` | view batches, staged rows, dry-run results, reconciliation | org_admin, hr_manager |
| `migration.manage` | create, upload, map, validate, cancel — everything except committing | org_admin |
| `migration.execute` | approve and execute against live data | org_admin |

`.execute` is separated from `.manage` on the same least-privilege reasoning
that keeps `personnel_file.movement.write` out of `personnel_file.manage`:
preparing an import is not authorizing it, and a bulk commit is the most
consequential write this platform offers.

`hr_manager` deliberately receives `.read` only — narrower than the WS-5/WS-6
precedent of granting hr_manager the same set as org_admin.

---

## Tenant isolation and security

- Every route derives `organizationId` from the authenticated membership,
  never from a body field.
- A batch id belonging to another organization returns **404, not 403** — the
  routes never confirm that another tenant's id exists.
- `entityType` is validated against the server-side adapter registry
  allow-list before any source row is created. It is never client-executable
  content.
- All four tables have RLS enabled with zero policies (deny-by-default),
  consistent with every other tenant table in this codebase.
- Uploaded files are stored under the organization's private storage tree
  with a random, unguessable filename, never served by static middleware.
- Audit events record a source file's identity and checksum, never its
  contents — a source file is full of personal data and the audit table is
  not a place to duplicate it.

## Audit

`migration.*` events are categorized as `platform_configuration`, not `hr`.
The rows a migration writes are already audited under their own domain
prefixes by the primitives that write them (`employee_number.*`,
`personnel_file.*`, `employee_qualification.*`, `leave_balance.*`,
`payroll_compensation.*`); categorizing the batch envelope as `hr` too would
double-file the same import. What `migration.*` records is the administrative
act of running an import.

Events: `batch.created`, `source.uploaded`, `source.mapped`,
`batch.validated`, `batch.approved`, `batch.execution_started`,
`batch.execution_completed`, `batch.cancelled`.

---

## Relationship to the existing Legacy Import

`routes/legacyImport.ts` and `lib/legacyImport.ts` are **left completely
unmodified.**

That surface (`/personnel-records/import/preview|commit`) is shipped, in use,
and has its own permissions and its own single-file stateless CSV contract.
Breaking it to funnel users into the new engine would be a regression for no
benefit. The two coexist:

- **Legacy Import** — one CSV, employees only, validate-then-commit in a
  single call, gated by `personnel_file.manage` + `employee_number.allocate`.
- **Data Migration** (this workstream) — many files, nine entity types with
  cross-entity references, a persistent reviewable batch, gated by
  `migration.*`.

They do not collide: different paths, different permission keys, different
frontend pages.

---

## Source file retention

Uploaded source files are retained after execution so a completed migration
remains auditable and its checksums remain verifiable. They are stored in the
organization's private tree and are only reachable through authenticated,
permission-checked code paths. Replacing a source deletes the superseded
blob.

---

## Customer-specific mappings

Nothing about an adapter is customer-specific. A customer's own spreadsheet
shape is expressed entirely as a column mapping, which is per-source and
supplied at import time. The `migration_saved_mappings` table exists to let
an organization store and re-use a named mapping across batches without any
code change.

This is what keeps the engine organization-neutral: onboarding a new
customer with an unusual spreadsheet requires a mapping, never a code
change or a per-customer adapter.
