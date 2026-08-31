# Reporting Execution Consolidation (WS-15 P3)

Implements §31.30 of `ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md`. Read that section
first: where the two disagree, §31.30 governs.

---

## The gap, and the corrected numbers

| | Before | After |
|---|---|---|
| Seeded report definitions | **46** | 46 |
| Generically executable | **3** | **46** |
| Returning `404` from the generic endpoint | **43** | **0** |
| Deliberately excluded | — | **0** |

**A recorded correction.** §31.30 originally said "47 definitions… the remaining
44". The true figure is **46 / 43**, verified in Pass 3C against
`report-definitions.ts` and confirmed by the seeder's own output — *"Seeded 46
report registry entries"*. The file has been unchanged since `f8fa5b8`, so
nothing moved; the Pass-1 figure was simply a miscount. §31.30 and §31.3(8) now
carry the corrected numbers with a note saying so.

---

## Consolidation is routing, not re-querying

`lib/reporting/moduleAdapters.ts` contains **zero SQL** — verified by a grep
that finds no `db.`, `.select(`, or `sql\`` anywhere in it. Each adapter calls
the owning module's own `run*Report` service, which already returned exactly the
`{columns, rows}` shape the generic surface serializes.

That convergence was not built here; it was already true. All eight modules
shipped an `isKnown*ReportKey` + `run*Report` pair, so consolidation was a
routing problem rather than a rewrite.

| Adapter | Category | Delegates to |
|---|---|---|
| Recruitment | `recruitment` | `runRecruitmentReport` |
| Attendance | `attendance` | `runAttendanceReport` |
| Performance | `performance` | `runPerformanceReport` |
| Learning | `learning` | `runLearningReport` |
| Assets | `asset_management` | `runAssetReport` |
| Personnel Records | `personnel_records` | `runPersonnelReport` |
| Office Inventory | `office_inventory` | `runOfficeInventoryReport` |
| Payroll | `payroll` | `runPayrollReport` |

Routing is by the definition's own `category` **and** the module's own key
predicate, so a mis-categorised definition fails closed rather than reaching the
wrong module.

---

## The safety concern the module routes raised — answered, not ignored

Eight shipped routes carried this comment:

> an attendance key "can never be executed through the generic, **non-scope-aware**
> `GET .../reports/:reportKey/run` (that route's RUNNERS map has no entries for
> these keys and **safely 404s instead**)."

That was **correct, and it was a real guard**. A generic runner that ignored
scope would have shown an ordinary employee the whole organization's attendance.

So the generic path was made scope-aware rather than the concern being waved
away. `runReport` now takes the acting user, and every adapter resolves its
module's own `resolve*ReportScope({organizationId, applicationUserId,
membershipId})` — the same call the bespoke route makes — before executing. A
live test proves it: an actor with no org-wide grant gets zero rows from a report
that would be organization-wide for HR.

The eight comments were then **corrected**, because leaving a false statement in
shipped code is worse than the drift it warned about.

Two consequences worth knowing:

- **Without an actor, a module report is not executable at all.** The legacy
  two-argument `runReport(key, organizationId)` call cannot reach an adapter and
  raises `ReportNotFoundError` — it fails closed rather than running unscoped.
  The three built-in organization-level aggregates still work without one.
- **Module routes are unchanged.** Nothing was removed, and both paths converge
  on the same source logic.

---

## Permission parity was verified, not assumed

Every definition's `requiredPermissionKey` is byte-identical to its bespoke
route's `requirePermission` gate, across all eight modules. The generic endpoint
already enforced the definition's key, so consolidation is neither a weaker nor
a stronger gate — it is the same gate.

There is no `reporting.execute_all` and no bypass.

### Payroll carries a second gate, and it survives

`payroll.report.read` is the definition's key. But the pension schedule can also
carry SSNIT statutory identifiers, which the bespoke route gates on a separate,
narrower `payroll.statutory_identifiers.read` and records as a sensitive read.
Both are reproduced exactly on the generic path — omitting either would have
made it a **quieter route to the same protected data**.

The gate is duplicated rather than extracted: `routes/payrollReports.ts` is the
most sensitive reporting route on the platform, and §31.30 asks for a generic
path *beside* the module routes, not a refactor of them. A live test asserts an
actor without the narrower key gets no statutory identifiers here either.

---

## Typed parameters

Every supported parameter is named and coerced individually in
`routes/reports.ts`. Nothing is spread from the query string into a module's
filter object, so an invented parameter cannot reach a query builder — an
unknown key is simply never read, and a malformed number is dropped rather than
becoming `NaN`.

Each adapter then picks only the fields its own module supports.

Two reports genuinely require a parameter:

- **Attendance** — a date range. Supplied dates are validated *before* any
  default is resolved. This ordering matters: the default is the organization's
  own civil today, and that lookup throws when `general.timezone` is unset (a
  deliberate W66 choice, since a silent UTC fallback would produce
  systematically wrong "late" figures). Resolving it eagerly made an
  explicitly-dated request fail for an unrelated reason — **caught by the live
  suite and fixed**.
- **Payroll** — `runId`. Reports are per locked run and there is no meaningful
  default, so a missing one is a `400`.

### Three distinct outcomes

| Situation | Result |
|---|---|
| Report matched nothing | **200** with zero rows — a valid result |
| Required parameter missing or malformed | **400** `ReportParameterError` |
| Unknown or unroutable key | **404** `ReportNotFoundError` |

An operational failure is never converted into an empty report.

---

## The completeness guard

§31.30's consolidation is only true if it stays true. A live test asserts that
**every seeded definition is either generically executable or listed in an
explicit exclusion map with a reason**. That map is currently empty.

This is the drift guard: add a definition without a runner, and the guard fails
rather than the report silently 404ing in production.

---

## CSV

The one shared primitive is unchanged. `safeCsvCell` still guards `=`, `+`, `-`,
`@`, tab and carriage return, still leaves genuine negative numbers numeric, and
`toCsv` remains the only encoder — no second one was written.

Export carries **exactly the parameters the interactive result used**. The
frontend passes the same `reportParams` object to both, and a test asserts the
CSV URL receives them.

The row type was widened from `string | number` to `string | number | boolean |
null`, matching what `toCsv` already accepted. Several module reports have
genuinely empty cells, and coercing those to `""` would have changed what the
report says.

---

## Frontend

The Admin → Reports tab already listed every registered definition and ran the
selected one through the generic endpoint, so **43 previously-404ing reports now
work with no UI change**.

What was added is typed controls for the two categories that need them — a date
range for Attendance, a run id for Payroll — and nothing else. There is no
generic JSON input box, and a report that takes no parameters shows no controls.
A Payroll report is not requested until its run id is supplied, since a `400` is
correct from the API but pointless to trigger on every keystroke.

---

## Not built here

No new tables — ledger stays `0070`. No report result, snapshot, cache or export
table (a live test asserts none exists). No scheduling, no email delivery, no
background subscriptions. No arbitrary SQL, expression evaluator or query
builder. No new audit subsystem. No Global Search. No Employee 360, Action
Centre or Manager Portal change.

---

## Testing

```bash
docker compose up -d db
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run migrate
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:roles
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:modules
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:reports
cd artifacts/api-server && WS15_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
  npx vitest run src/test/reportingConsolidationLive.test.ts --pool=threads --maxWorkers=1
```

- **`reportingConsolidationLive.test.ts`** — 15 live tests: the completeness
  guard, adapter routing safety, every definition executing and returning the
  uniform shape, zero-row versus error versus parameter error, scope awareness,
  Payroll's second gate, CSV injection safety and parity, tenant isolation, and
  that no stored-result or scheduling table was introduced.
- **`admin-reports-tab.test.tsx`** — 5 frontend tests covering the typed
  controls and CSV parameter parity.
