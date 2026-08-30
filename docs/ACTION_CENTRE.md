# HR Action Centre and Manager Recruitment Participation (WS-15 P1 + P2)

Implements the P1 and P2 bundles of the architecture frozen in §31 of
`ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md`. Read that section first: where the two
disagree, §31 governs.

**Scope of this document is WS-15 P1 and P2.** The two remaining registered
bundles — Employee 360 / Global Search (§31.29, P2/P3) and Reporting execution
consolidation (§31.30, P3) — are frozen but **not implemented**.

---

## The one-sentence version

The Action Centre asks every module, on every request, "what does this person
need to do?" — and then shows the answer without ever becoming the answer.

---

## No table, no permission, no migration

Three absences define this workstream:

- **No table.** There is no action item table, no projection, no index, no
  synchronization job and no reconciliation queue. Migration ledger stays at
  `0070`.
- **No permission.** No `action_centre.*` key exists. Visibility comes entirely
  from the source modules' own permissions.
- **No second source of truth.** Every row is recomputed from the owning module
  on every request.

The last one is why the first two are possible. Because nothing is stored, a
changed membership, permission, reporting manager, delegation, stage, assignment
or source status is reflected on the very next call — with nothing to
invalidate, no staleness to detect and no rebuild to run.

This follows two aggregators the platform already shipped:
`lib/managerPortalPendingActions.ts` (cross-module action queue) and
`GET /dashboard/summary` (cross-module metrics).

---

## The provider contract

`lib/actionCentre/providers.ts` holds fourteen bounded adapters. Each one, in
this order:

1. scopes to the organization;
2. checks module enablement, where the module is optional;
3. checks the source module's own permission;
4. applies the source module's own live authority resolver;
5. queries current authoritative state;
6. maps to the safe row.

A provider **calls its module's existing service functions**. None reimplements
a module's rules, and **ten different authority resolvers are called and not
unified** — unifying them is OD #14/#15 and belongs to WS-16.

### The `authorize` / `query` split is the confidentiality boundary

```
authorize() false or throws  →  hidden   (source vanishes entirely)
authorize() true, query throws →  failed  (source named as unavailable)
authorize() true, query ok     →  ok      (items; 0 genuinely means nothing to do)
```

**`hidden` contributes nothing at all** — no row, no count, not even a zero. A
zero would assert that the module exists and is empty, which is itself a
disclosure. Disabled and unauthorized are deliberately indistinguishable.

**`failed` is only reachable after authorization succeeded**, which is what
keeps a named unavailable source from disclosing a module the caller may not
see. An error thrown *inside* a permission check collapses to `hidden` for
exactly this reason.

---

## The row

Fourteen fields (`lib/actionCentre/types.ts`), and no others:

`sourceModule` · `sourceType` · `sourceId` · `actionKind` · `title` ·
`employeeId` / `employeeFirstName` / `employeeLastName` · `status` ·
`createdAt` · `dueAt` · `overdue` · `deepLink` · `inlineCommands`

Deliberately absent: metadata blob, source payload passthrough, WS-15 lifecycle,
priority or severity, assignee identity beyond Assigned Work's needs.

**A row is a pointer plus enough to triage, never a copy.** Never in one, under
any permission: grievance narrative, disciplinary evidence, succession candidate
identity or readiness, Payroll amounts or bank details, proposed National ID or
passport values, confidential document content, or a leave reason.

Where naming the subject would itself be the disclosure — grievance and
disciplinary cases — the row carries the case reference and the employee fields
stay `null` even for an authorized reader.

---

## Due and overdue: a tri-state, not a boolean

| | `dueAt` | `overdue` |
|---|---|---|
| Source has an authoritative date | the date | `true` / `false` |
| Source has no due concept | `null` | **`null`** |

`overdue` is **never `false` merely because a date is absent**. "Not overdue" and
"no concept of overdue" are different statements and a UI must be able to tell
them apart.

Sources contributing a real `dueAt`: onboarding tasks, document
acknowledgements, learning enrolments, offer expiry, succession review dates, and
WS-13 service requests (from `targetDays`, per WS-13's own semantics only — never
derived from age). Leave, data-change requests, grievances, disciplinary cases,
clearance items and skill verifications are undated by design.

**Employment Lifecycle contributes no `dueAt`.** A contract end date is a fact
about employment, not a deadline for whoever is reading the row.

---

## Sorting

Four deterministic tiers, from authoritative dates only:

1. overdue, most overdue first;
2. due soon, soonest first;
3. undated, oldest first;
4. tie-break: `createdAt`, then `sourceModule`, then `sourceId`.

This departs from Manager Portal's `createdAt DESC` deliberately — that surface
has no due dates, and showing the newest item above a three-week-overdue one
would be the wrong operational answer. **Undated work is never given fabricated
urgency.** No priority model exists, and no AI is involved.

---

## Scopes

| Scope | Means |
|---|---|
| **My Actions** | Items the caller can currently act on through source authority |
| **Assigned Work** | Items explicitly assigned to the caller's membership |
| **HR Oversight** | Organization-level visibility for authorized HR |

**Assigned Work exists only for the two sources with a genuine assignment
concept** — WS-13 service requests and WS-12 grievances. Assignment is never
fabricated: a Leave approval is not "assigned" to anybody.

**HR Oversight creates no new read authority.** It is the same
permission-filtered providers asked a different question. A user who cannot see a
grievance through Employee Relations sees no grievance row, no grievance count,
and nothing from which to infer one exists.

---

## Organization Admin

`org_admin` gains **nothing** from the Action Centre existing. §28.17 withholds
the grievance keys from it and §30.17 withholds the three succession keys; both
withholdings hold through aggregation, and a live test asserts each — rows and
counts alike.

---

## The four inline actions

| Command | Calls | Authority re-checked at action time |
|---|---|---|
| `leave.approve` / `leave.reject` | `approveLeaveRequest` / `rejectLeaveRequest` | `leave_request.approve`, then Leave re-resolves the Department Head live and refuses self-approval |
| `learning.approve` / `learning.reject` | `decideEnrollmentApproval` | `learning.review.write` or `learning.manage`, then Learning's manager-of-record check |
| `onboarding.complete` | `completeTask` | `onboarding.task.complete` **and** `isCurrentlyResponsible` |
| `skill.verify` / `skill.reject` | `capability.verify` / `capability.reject` | `skill_verification.decide`, then WS-14's own self-verification refusal |

Every handler **calls the owning module's existing service** — it never writes a
source table — so the source transaction, its atomic state guard, its audit
event, its notifications and its maker-checker all happen exactly as if the
action had been taken in the source module.

The command vocabulary is **closed**: a client supplies a name from the frozen
list and a source id, and can never name a module, table or method. There is no
generic command bus.

### Two implementation findings worth knowing

**Onboarding is gated more strictly here than in its own route.** The shipped
completion route gates on `onboarding.task.complete` alone; the Action Centre
requires the permission *and* current responsibility. Stricter is safe — WS-15
must never offer an action the owning module would refuse — and it never blocks
the module's own path.

**WS-14 permits re-verification, so the command path adds a state check.**
`capability.verify` deliberately has no "already verified" guard, because a later
verifier may legitimately confirm capability again. That is correct for WS-14 and
is unchanged. But a repeated Action Centre request would append a second
verification event — the duplicate business effect §31.23 forbids — so the
command refuses a record that is no longer `claimed` or `assessed`. This is a
state check, not a decision, and it is exactly step 4 of the inline-action
sequence.

Everything else deep-links: Recruitment staged approval, Employee Relations
decisions, WS-13 data-change and fulfilment, succession, Payroll, Lifecycle,
Assets/Inventory and Performance scoring.

---

## Module participation

| Included (P1) | Mode |
|---|---|
| Leave, Learning, Onboarding, WS-14 skills | inline |
| Performance, Recruitment (requisition + offer), WS-13 (data change + service request), WS-12 (clearance, grievance, disciplinary), succession, Employment Lifecycle | deep-link |

| Not included | Why |
|---|---|
| **Payroll** | Deferred. Its only actionable state is a run-level administrative step with no employee subject and no due date; a generic row would add nothing over Payroll's own gated pages while putting the most sensitive module one rendering mistake from disclosure |
| **Assets, Office Inventory** | Excluded. Operational rather than HR — and Office Inventory's effective-dated delegation is precisely what WS-16 exists to generalize, so including it risks generalizing OD #15 by accident |
| **Attendance** | Excluded. No approval or task concept |

A module earns a place by having genuinely actionable, safely summarizable,
authority-resolvable work — not by existing.

---

## ESS My Actions

Three allow-listed sources, and the narrowness is the design:

1. onboarding tasks resolved to `employee_self`;
2. document acknowledgements still `pending`;
3. WS-13 service requests `awaiting_employee`.

Deliberately excluded: own Leave history, Learning progress, performance
history, skill claims merely awaiting HR, Payroll, grievances, succession,
notifications. None is work the employee must do, and treating "pending
somewhere else" as "your action" would make it a to-do list nobody can empty.

**The subject is server-derived** from the employee link on every request. No
request carries an employee identifier and none is read if supplied.

---

## Failure, staleness and idempotency

The source of truth wins, always.

- An item completed elsewhere fails at the source's own state guard and the row
  disappears on the next request.
- An actor who lost authority is denied at action time even if the row rendered
  a moment earlier.
- A failing provider is **named as unavailable**, never rendered as zero: *"a
  systemic error is never silently hidden in a way that leads a user to believe
  the queue is complete."* The user sees which source could not be loaded; the
  real error goes to the server log through the existing observability
  convention, never to the client.
- **Nothing is replayed automatically.**
- Idempotency is the sources' — WS-15 adds no persistence to re-solve it.

---

## Sensitive-read auditing

WS-15 records **nothing**. Its rows are generic redacted pointers, and a pointer
is not a read of the sensitive record — auditing it would inflate the trail with
events describing no disclosure. The owning module's OD #18 path remains
authoritative at the deep link, and **no read is double-counted**.

---

## Surfaces

| Route | Audience |
|---|---|
| `/action-centre` | HR and managers — My Actions, Assigned Work, HR Oversight |
| `/my-actions` | Every employee — the three ESS sources |

Nav visibility uses `useIsHrCapable`, which is a **role-name heuristic for
navigation only**. It is never authority: the page shows exactly what the
providers permitted, so a heuristic mismatch has no data consequence.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /organizations/{id}/action-centre` | The federated queue |
| `GET /organizations/{id}/action-centre/counts` | Counts from the same providers as rows |
| `GET /organizations/{id}/my-action-centre` | ESS My Actions |
| `POST /organizations/{id}/action-centre/actions/{command}` | One allow-listed inline command |

There is deliberately **no detail endpoint**. A row's detail is the owning
module's own surface, reached by `deepLink` — adding one would be the first step
toward WS-15 returning sensitive detail.

---

## Testing

```bash
docker compose up -d db
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run migrate
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:roles
cd artifacts/api-server && WS15_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
  npx vitest run src/test/actionCentreLive.test.ts --pool=threads --maxWorkers=1
```

- **`actionCentreLive.test.ts`** — 25 tests against real PostgreSQL, including
  the two Action Centre backdoor tests (`org_admin` sees neither grievances nor
  succession, in rows *or* counts), live authority revocation, cross-tenant
  refusal, double-click idempotency, the closed command vocabulary, the exact
  row shape, and the frozen four-tier sort.
- **`action-centre.test.tsx` / `my-actions.test.tsx`** — 16 tests driving the
  four inline write paths and asserting the page invents no visibility and never
  renders a provider failure as zero.

The `threads` pool matters: the default fork pool silently drops test files on
some Windows machines.

---

## Manager Portal Recruitment participation (WS-15 P2, §31.28)

Manager Portal already aggregated Leave, Performance and Learning. §31.28 named
exactly three absent Recruitment responsibilities, and
`lib/managerPortalRecruitmentParticipation.ts` adds exactly those three:

| Source | Anchor | Kind |
|---|---|---|
| Outstanding own scorecard | `interview_scorecards.submittedAt is null`, or no row yet | `interview_scorecard` — work |
| Interview panel seat | `interview_panel_members.interviewerMembershipId` | `interview_panel` — awareness |
| Hiring-manager standing | `job_requisitions.hiringManagerEmployeeId` | `job_requisition` — awareness |

**Requisition and offer approvals are deliberately not here.** They are approval
*authority* rather than participation, §31.28 does not name them, and they
already ship as P1 Action Centre providers. Adding them would duplicate a live
surface and widen a frozen bundle.

### This is participation, not authority

Every row says "you are involved in this" and links to the Recruitment surface
that already gates the decision. The provider module exports **one read
function** — there is no approve, submit, schedule or decide anywhere in it, and
a live test asserts that public surface. Manager Portal grants no Recruitment
authority it did not already have.

### Authority is live

The two shipped visibility contexts — `resolveInterviewVisibilityContext` and
`resolveScorecardVisibilityContext` — are reused unchanged, and panel membership
and hiring-manager standing are read fresh on every call. There is no cached
assignment and no manager-task table, so removing somebody from a panel or
reassigning a requisition's hiring manager takes effect on the very next
request. Neither `isOrgWide` nor `canReadAll` is used to broaden what is
returned: this surface is own-participation only.

### An additive field, not a contract change

Recruitment participation is returned as a **sibling** of `items` on
`GET /manager-portal/pending-actions`, not merged into it. The shipped item shape
requires an employee id and name, and Recruitment participation has no employee
subject at all — an interview panel seat concerns a candidate, not a direct
report. Merging would have meant either a breaking change to a live contract or
placeholder employee values, and a placeholder is a lie the frontend would
render. The field is optional, so every existing client keeps working unchanged
and the P1 surface stays byte-identical.

### Safety

A row carries a kind, the source row's own id, a generic title, its status, the
source's own date and a deep link. It never carries a candidate name, an
application detail, another panel member's scoring or comments, or offered
compensation. A cancelled or no-show interview asks nothing; a draft, filled or
rejected requisition asks nothing; a disabled Recruitment module contributes
nothing.

An **unlinked** account still sees its own panel work, because panel membership
keys on the membership rather than the employee record — only hiring-manager
standing needs an employee link.

Ordering is soonest/oldest first, then kind, then id. This differs from Manager
Portal's own `createdAt DESC` because these are genuinely dated commitments: an
interview tomorrow matters more than one scheduled a month ago.

### Testing

`managerPortalRecruitmentLive.test.ts` — 12 live tests covering own-scorecard
isolation, submission removing the row, panel removal taking effect immediately,
hiring-manager reassignment, status filtering, the safe row shape, module
disablement, cross-tenant invisibility, the unlinked interviewer, deterministic
ordering, and the no-mutation surface. Six frontend tests in
`manager-portal.test.tsx` cover the additive section without disturbing the
shipped rows.

---

## Not built here

Generic workflow engine · universal approval or task table · process designer ·
**OD #14/#15 generalization (WS-16)** · materialized projection · Action Centre
history store · recent-completed aggregation · cross-module search · export ·
AI prioritization · Payroll/Assets/Inventory/Attendance participation ·
Recruitment requisition and offer approvals in Manager Portal ·
**§31.29 Employee 360 / Global Search (P2/P3)** · **§31.30 Reporting
consolidation (P3)**.
