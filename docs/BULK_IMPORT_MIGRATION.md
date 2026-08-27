# Bulk Import / Multi-Entity Migration (WS-7)

Imports an organization's existing records into the platform — organizational
structure, employees with their historical staff/PIF numbers, employment
history, qualifications, certifications, leave opening balances and payroll
opening balances — from CSV or Excel, with a full dry run before anything is written.

> **Payroll opening balances** are imported as their own domain — brought-forward
> historical totals that are never paid. See
> [Payroll opening balances](#payroll-opening-balances).

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
one of the nine registered adapters reuses the platform's real creation paths — the same code the
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
| `payroll_opening_balance` | employee | `createPayrollOpeningBalance` (dedicated domain — never compensation) |

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

## Execution model: two policies, chosen automatically

A migration executes under one of two models. The model is **decided by the
system**, not chosen by the user, and is **always shown before approval** —
an administrator is never left to assume an import is atomic when it is not.

### ATOMIC

The whole batch runs in **one transaction**, in dependency order. Any failure
rolls everything back and **nothing is written**; the batch ends `failed` and
the API returns `422` with `rolledBack: true`.

Chosen when both hold:

- every entity type in the batch is `transactional` (all its writes thread the
  transaction client it is handed), **and**
- the batch is within `ATOMIC_EXECUTION_ROW_LIMIT` (2,000 rows) — beyond that
  a single transaction would hold locks on core HR tables for minutes, which
  is its own availability problem for a live tenant.

This is not theoretical. The pre-existing legacy importer already commits many
employees plus their number allocations and personnel files in a single
transaction, using exactly the primitives the `employee`/`branch`/`department`/
`position` adapters reuse.

Two disclosed caveats:

- Audit events are written on the global connection — true of every domain
  service in this codebase, not something this workstream introduces — so
  audit rows for a rolled-back batch can survive the rollback. The batch's own
  `execution_failed` event records that the data was not kept.
- A process crash mid-transaction leaves staged rows `pending` while the
  database has already rolled the data back. That is the safe direction: the
  batch can simply be run again.

### BATCHED_RESUMABLE

Per-row, continue-on-failure, in dependency order. Each row is marked
`created` or `failed` with its error text and the batch continues.
`completed_with_errors` is a first-class outcome.

Chosen when either holds:

- the batch contains an entity type whose domain service commits on its own
  connection (`employment_history`, `qualification`, `certification`,
  `leave_balance`), **or**
- the batch exceeds the atomic row limit.

**Why not force a transaction anyway?** Because for those entity types a
rollback could not actually undo the writes. Wrapping them would produce a
*false* atomicity guarantee — the administrator would be told "nothing was
written" while rows had in fact committed. Being honest about partial success
is strictly safer than pretending.

**In this model there is no automatic rollback.** That limitation is surfaced
in the UI before approval — naming the specific entity types responsible — not
merely documented here. The mitigations are:

1. Nothing executes until a human approves a clean dry run.
2. Every row's fate is individually recorded and reportable.
3. Re-running a batch only ever retries rows still `pending`, so recovery is
   "fix the failed source rows and re-run", never "undo".

### Traceability and correction

Every committed record traces back through
`migration_staged_rows.executionResultId` → `migration_sources` (entity type,
file, checksum) → `migration_batches`. The reconciliation report states
precisely what was committed, and its buckets sum to the source row count, so
a silently dropped row is arithmetically impossible to hide.

Retry cannot duplicate a successful row: only `pending` rows are ever
executed, and each is claimed by a conditional `UPDATE ... WHERE
executionStatus = 'pending'` before its adapter runs. A migration therefore
cannot accidentally replay rows that already succeeded.

There is deliberately **no automated reverse-SQL rollback**. Correcting a
partially executed migration is a supervised activity: read the reconciliation
report, fix the offending source rows, and re-run — which picks up only what
has not yet been imported.

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

---

## Payroll opening balances

A payroll opening balance is **brought-forward payroll/statutory history** for
payroll already processed OUTSIDE this HRMS, before the organization's cutover
into it partway through a tax year. It establishes the employee's starting
position for year-to-date reporting and statutory returns.

It is **not** compensation, not a salary, not a payroll run, not a payslip, not
a payment and not a journal. **Nothing here is ever paid.**

### Why not compensation components

An earlier implementation reused `createCompensationComponent` and was
withdrawn. A component is an effective-dated **rate**, not a balance:

- `createCompensationComponent` always inserts an OPEN row (`validTo` unset).
  `resolveCompensationAsOf` treats an open row as `validTo = Infinity`, so it
  matches every future pay date, and `calculateEmployeePayroll` adds its full
  amount to `grossEarnings` on every run. A one-time balance would have been
  **paid again every period, forever**, taxed and pensioned as ordinary income.
- It also closes any earlier open row for the same
  `(employeeId, category, componentTypeCode)`, so a balance mapped onto
  `basic_salary` would have **silently terminated the employee's real salary
  row**.

Opening balances are now their own table and their own service, and the
adapter never touches compensation. A live test asserts that importing one
creates **zero** compensation components.

### Fields, and why exactly these

The six stored measures mirror, one-for-one, the statutory-meaningful columns
`payroll_run_lines` already records per period — `grossEarnings`,
`taxableIncome`, `payeAmount`, `pensionableEarnings`,
`employeePensionDeduction`, `employerPensionContribution`. A year-to-date
figure is the sum of those across a year, so brought-forward values must be
denominated identically or they cannot be added to in-system runs.

`netPay` and `otherDeductions` are deliberately **omitted**: neither is a
statutory return figure and neither has a consumer.

### Tax year and cutover

`taxYear` is a plain integer. No second calendar system was invented —
`payroll_periods` already carries its year in `periodKey` ("2026-01") and
`startDate`. `cutoverDate` is the date from which this HRMS becomes
authoritative; it must fall inside `taxYear`, and a future tax year is
rejected because an opening balance is by definition historical.

### The engine is not modified

Verified against the live engine rather than assumed: **no statutory
calculation in this platform takes a cumulative input.**

- PAYE applies graduated bands to the **current period's** taxable income.
- The SSNIT ceiling clamps the **current period's** pensionable earnings
  (`clampMinor(pensionableEarningsRaw, min, max)`) — it is an insurable-earnings
  bound, not an annual cap.
- Bonus tax annualises the **current** basic salary (`basicSalary × 12`).

A repository-wide search found zero pre-existing year-to-date computation.
`payrollCalculation.ts` is therefore untouched, and that is precisely what
structurally guarantees a brought-forward amount can never leak into
current-period pay. Changing any of those formulas to consume YTD would mean
reinterpreting Ghana statutory rules — a separate Owner decision, explicitly
out of scope here.

### Year-to-date

`getEmployeeYearToDate(org, employee, taxYear)` is the one integration point:

```
year-to-date = brought-forward history + payroll finalized inside this HRMS
```

Only `locked` runs are summed — a draft or merely calculated run is not
finalized payroll and must not inflate a statutory figure. The two halves stay
separately visible (`broughtForward` / `inSystem`) so a reader can always see
what came from before cutover.

Payslips are unchanged: they show current-period figures and do not display
year-to-date, so there is nothing for an opening balance to appear in. No
existing report shows YTD either, so none required modification.

### Lock and correction

Editable while no payroll run for that employee and tax year has reached
`locked`. Once one has, the record is locked, `lockedAt` is stamped, and
amendment is refused with `409`. Finalized payroll history is never silently
rewritten; a correction after lock goes through Payroll's existing correction
mechanism.

### Uniqueness and idempotency

`UNIQUE(organizationId, employeeId, taxYear)` — exactly one authoritative
record per employee per year. This is a database-level guarantee, stronger
than staged-row status alone: a replayed migration collides here rather than
duplicating payroll history. The dry run also surfaces the duplicate as a
validation error before execution.

### Migration traceability

Each record keeps `sourceReferenceType`/`sourceReferenceId` (the migration
batch). The source spreadsheet itself is never stored in the payroll row, and
audit metadata carries scalar summaries only — never row contents.

### Permissions and audit

`payroll.opening_balance.read` / `payroll.opening_balance.manage`.
Deliberately **not** folded into `payroll.compensation.*`: the whole point of
this domain is that an opening balance is not compensation, and reusing those
keys would re-conflate them in the authorization model. Like every other
payroll key, both are registered but granted to **no role** — payroll
authority is an explicit per-organization delegation, never implied by HR
authority. Importing additionally requires WS-7's `migration.execute`.

Audited under the `payroll` category: `payroll_opening_balance.imported`,
`.read`, `.updated`.

### Transaction support

`createPayrollOpeningBalance` accepts the transaction client it is handed and
performs a single insert through it, with no nested `db.transaction`. The
adapter is therefore `transactional: true` and **eligible for ATOMIC
execution** — a live test proves an opening balance is rolled back with the
rest of a failed small batch.

---

## Relationship to the existing Legacy Import — end state

Both importers exist. They are not two competing implementations of the same
thing, and the end state is defined:

| | Legacy Import | Data Migration (WS-7) |
| --- | --- | --- |
| Path | `/personnel-records/import/{preview,commit}` | `/migrations/*` |
| Scope | one CSV, employees only | many files, eight entity types with cross-entity references |
| State | stateless; validate-then-commit in one call | persistent, reviewable batch |
| Execution | always atomic (single transaction) | atomic or batched-resumable, disclosed before approval |
| Permissions | `personnel_file.manage` + `employee_number.allocate` | `migration.read` / `.manage` / `.execute` |

**Authoritative importer:** Data Migration (WS-7). All new work targets it.

**Compatibility importer:** Legacy Import, retained **unmodified**. It is
shipped, in use, has its own permissions and its own contract, and no evidence
was found that removing it would be safe.

**Deprecation condition:** once the Data Migration UI has covered the
single-file employee case in production for one full onboarding cycle, Legacy
Import is marked deprecated in the UI and its OpenAPI operations flagged
`deprecated: true`.

**Removal condition:** removal only after (a) it is deprecated as above, (b)
access logs show no calls for a full release cycle, and (c) the Owner
authorizes removal. Until all three hold it stays, untouched.

Deliberately **not** done: routing the legacy endpoints through the new
orchestration engine. That would change the observable behaviour of a working,
shipped API (stateless single-call commit becomes a multi-step batch) for no
benefit to its existing callers, and would put the compatibility surface at
risk of regressions from future WS-7 changes. Duplication of a ~485-line module
is the cheaper risk.

---

## Development and test database safety

Destructive live-integration suites (`*LiveIntegration.test.ts`, the WS-7
lifecycle suite) create real organizations, users, employees and ledger rows.
Two independent guards apply:

1. **Opt-in by dedicated variable.** Each suite runs only when its own
   `WS5_/WS6_/WS7_LIVE_DATABASE_URL` is set, and skips otherwise — so an
   ordinary `pnpm test` and CI never touch a real database.
2. **Fail-closed host check** (`src/test/liveDbGuard.ts`). Even with the
   variable set, a suite refuses to run against a non-local host. Override
   requires `ALLOW_NONLOCAL_TEST_DB=1`, an explicit and auditable act. An
   unsafe host **throws rather than skipping**, so a misconfiguration is loud.

The guard is host-shaped, not a denylist of any particular deployment: nothing
hard-codes a project reference, hostname or credential, so it stays correct for
every deployment of this platform. Its error message names the offending host
but never echoes credentials.

Recommended local target is the `docker-compose` `db` service on port 5433.
