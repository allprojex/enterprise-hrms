# Employee 360 (WS-15 P2/P3)

Implements the Employee 360 half of §31.29 in
`ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md`. Read that section first: where the two
disagree, §31.29 governs.

**Global Search is not implemented, and that is the frozen answer** — see the
last section.

---

## What this is, and what it deliberately is not

Employee 360 is **read composition**. It asks eight modules "what do you hold
about this person that this caller may see?" and shows a small summary of each,
plus a link into the module that owns it.

It is not a data model, not a migration, not a second source of truth, and not
an action surface. There are **zero writes** in the entire path — no `insert`,
no `update`, no `delete` in any file under `lib/employee360/` or its route.

Ledger stays at **`0070`**. No schema, no migration.

---

## The eight sections

§31.29's discovery is the specification: the employee page already showed the
core record, numbering, qualifications, certifications, documents, employment
history, personnel file and custody, exit processes, performance reviews and an
asset report. It was missing these, and these are what shipped:

| Section | Source | Gate |
|---|---|---|
| Employment terms and lifecycle | WS-11 terms + acting/secondment assignments | `employment_lifecycle.read` |
| Employee Relations | WS-12 structured cases (+ labelled legacy notes) | `employee_relations.read` |
| Requests | WS-13 data-change + service requests | `data_change.read` and/or `service_request.read`, each gated separately |
| Skills and capability | WS-14 typed records (+ labelled legacy entries) | `employee_skill.read` |
| Leave | Requests + balances | `leave_request.manage`, module enabled |
| Learning | Enrolments | `learning.manage`, module enabled |
| Attendance | 30-day counts only | `attendance.manage`, module enabled |
| Onboarding | Latest instance + outstanding tasks | `onboarding.read`, module enabled |

### Two sections that deliberately do not exist

**Succession.** §30.17 is explicit: an employee's standing in a succession plan
**never** appears on their 360 view — not to an authorized reader, not to
anyone. There is no provider and none may be added.

**Payroll.** §31.29's missing-section list does not name it, and a general
employee page is the wrong place for pay, bank details or statutory identifiers.

**Grievances are also absent** from the Employee Relations section. `grievance.read`
is withheld from `org_admin` by default (§28.17), and a grievance concerning
this employee is not something a general HR page should surface. The Employee
Relations workspace remains the only route to it — a live test asserts that even
an `hr_manager` who *does* hold the key sees no grievance here.

---

## Omission is the confidentiality mechanism

A section the caller may not read is **omitted from the response entirely** —
never returned empty, never returned redacted-but-present.

That matters because an empty section is an assertion: "this module exists, and
this person has nothing in it." For a grievance that sentence is itself the
disclosure. Omission makes *unauthorized*, *module disabled* and *genuinely
nothing recorded* indistinguishable from outside, which is what makes it safe.

The provider contract enforces it structurally, following §31.5:

```
authorize() false or throws  →  omitted      (section vanishes)
authorize() true, query null →  omitted      (module holds nothing)
authorize() true, query throws → unavailable (named)
authorize() true, section     →  present
```

An error thrown *inside* an authorization check collapses to **omitted**, so an
operational fault in a permission lookup can never disclose that a protected
module exists. Only a failure of the data query — reached solely once the caller
is known to be authorized — may be named.

`org_admin` gains nothing from Employee 360 existing. A live test seeds a
confidential grievance and a succession candidacy and asserts neither string
appears for `org_admin` or `hr_manager`.

---

## The legacy reconciliation — the risky part

Two shipped sections showed **superseded models**, so the page was not merely
incomplete but in two places out of date:

| Legacy | Current | Disposition |
|---|---|---|
| `employee_skills` — free-text code and free-text proficiency string, no scale, no verification, no assessor, no evidence, no expiry, no history | WS-14 `employee_skill_records` — typed, with claim/assessment/verification kept distinct | **RETAIN AS LEGACY.** Shown beside the current model, badged `Legacy`, with a plain note |
| `employee_disciplinary_records` — a flat note | WS-12 `disciplinary_cases` — stages, append-only chronology, confidentiality tier | **RETAIN AS LEGACY.** Same treatment |

**Nothing was migrated, converted, inferred from, or deleted** (§31.37).
A live test writes a legacy row, reads the 360 view, and then re-reads the
legacy row to assert it is byte-for-byte unchanged.

Two specific rules follow from this:

- **A legacy proficiency string is never surfaced as a status.** It has no scale
  behind it, so nothing may be inferred from it. The legacy row shows its skill
  code and a `Legacy` badge; its `status` is `null`.
- **A legacy disciplinary note is never presented as a structured case.** Its
  body never reaches the page at all — the row reads "Legacy disciplinary
  record".

The two shipped cards on `employee-detail.tsx` were **labelled, not removed**.
Deleting them would erase genuine history somebody may need to explain later;
silently leaving them unlabelled would let old data look authoritative. Each now
carries a `Legacy` badge and a description pointing at the current model.

---

## What a row may contain

A label, a status and a date. That is all.

Never: grievance narrative · disciplinary evidence or the legacy note's body ·
succession candidacy or readiness · Payroll figures · a proposed National ID or
passport value · a leave reason · another person's content of any kind.

Where naming the thing would itself be a disclosure, the row carries a
reference: `Disciplinary case #12`, `Data change request` (naming neither the
field nor the proposed value), `Service request #7`.

Sections are bounded to **five rows**; `truncated` tells the UI the module holds
more. Attendance carries **counts only and no rows at all**, so no movement
pattern is reconstructable from this page.

---

## Provider failure

A section the caller was entitled to that could not be loaded is **named** in
`unavailableSections` and rendered as a banner — never as "nothing recorded".
The real error goes to the server log through the existing observability
convention; the client never sees it.

One documented exception: Attendance's own service hard-errors when the
organization has not set `general.timezone`, because a silent UTC fallback would
produce systematically wrong "late" figures. `managerPortalDashboard.ts` already
catches exactly this and treats the tile as unavailable. Employee 360 treats it
as **omission** rather than a named failure — "enabled but not yet configured"
is a state, not an outage, and a permanent warning banner on every 360 page
would be noise rather than honesty.

---

## API

`GET /organizations/{id}/employees/{employeeId}/360-sections`

**This is not the giant employee DTO §31.29 forbids.** It returns a bounded
summary per module — a few headline figures, at most five rows, a deep link —
with detail left where it lives. What it gives that eight separate endpoints
could not is the omission semantics above: eight endpoints would each have to
answer 403 or 404 for a hidden section, and either answer confirms the module
exists.

No permission is minted. `requireAuth` + `requireMembership` only; each provider
enforces its own module's key, so a caller with no eligible section receives an
empty array rather than a 403. The employee is proved to belong to the caller's
organization **once, before any provider runs**, so a forged cross-tenant id
fails cleanly.

No OD #18 sensitive-read event is recorded: every section is a redacted summary,
and auditing a pointer would double-count a read that never happened. The owning
module's own path remains authoritative at the deep link.

---

## Global Search — not implemented, by the freeze

§31.29 says this in its own words:

> **Global Search is P3 and is not required by Employee 360.** `app-shell.tsx`'s
> existing comment — declining to render a search control because nothing backs
> it — remains correct until a real capability exists. **No cross-module
> sensitive full-text search** is authorized (§31.37).

So Global Search was **not built**. `app-shell.tsx` is untouched and still
declines to render a search box it cannot back. Building one would have meant
either a bounded employee-directory search that §31.29 does not ask for, or the
cross-module full-text search §31.37 explicitly forbids.

**Employee 360 (P2) is complete. Global Search (P3) remains frozen and
unauthorized**, and needs its own Owner Decision before anything is built.

---

## Testing

```bash
docker compose up -d db
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run migrate
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:roles
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:modules
cd artifacts/api-server && WS15_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
  npx vitest run src/test/employee360Live.test.ts --pool=threads --maxWorkers=1
```

- **`employee360Live.test.ts`** — 15 live tests: the exact section set, omission
  versus empty, the grievance and succession absences, both legacy
  reconciliations including the not-migrated assertion, WS-13 masking, the leave
  reason, attendance counts-only, the row shape, cross-tenant refusal, provider
  failure isolation, and that resolving a 360 view writes nothing.
- **`employee-360-sections.test.tsx`** — 8 frontend tests, including that the
  page invents no section the server omitted and that every affordance is a
  link.
