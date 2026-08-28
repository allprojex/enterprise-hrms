# Onboarding, Induction & Handbook (WS-10)

Implements the scope frozen as **§26** of `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md`.

Onboarding is an organization-configurable checklist attached to a real employee, plus two specializations of it: **induction** (a task that also has a facilitator, a time and a venue) and **handbook/policy acknowledgement** (an obligation against one exact document version). It is not a workflow engine, and Owner Decision #14 forbids it becoming one — there is no rule language, no expression evaluator and no scripting anywhere in this module.

---

## Lifecycle boundary

```
RECRUITMENT  → candidate selected → approved to hire → offer → offer accepted
PRE-ONBOARDING → permitted preparation, candidate identity still authoritative
EMPLOYEE IDENTITY CREATED → employees.id exists (Recruitment conversion, manual, or import)
FORMAL ONBOARDING → tasks, documents, handbook, induction, references, completion
ACTIVE EMPLOYMENT → Attendance, Leave, Performance, Learning, Assets, Payroll if enabled
```

**Probation is not in this chain.** `confirmEmployee()` and `employment_periods` remain untouched, and probation extension, reminders and unsuccessful outcome belong to WS-11. WS-10 starts no probation, confirms no employment and appends no `employment_periods` event — proven by test.

---

## Pre-onboarding: no new table

§26.38 left open whether the pre-onboarding bridge needed its own storage. It does not, and the reason is that WS-5 already solved every piece of it:

| Pre-onboarding concern | Where it already lives |
| --- | --- |
| Pre-employment document requests | `document_requirements` with `ownerType = 'candidate'` |
| Commencement date and terms | The offer version and `employment_particulars` (WS-9) |
| Required forms | WS-8 custom forms, whose `candidate` scope was already bindable |
| Carry-forward to the employee | `candidate_employee_links` and `candidates.linkedInternalEmployeeId` |

Building a second candidate-side task engine would have duplicated the employee-side one for no gain, which §26.3 explicitly forbids. What WS-10 adds is the handoff, not an engine.

---

## Data model

Seven tables, migration `0066`, additive (plus two defaulted boolean columns on `organization_documents`). All RLS-enabled with zero policies, per repository convention.

```
onboarding_templates            envelope: name + applicability
└── onboarding_template_versions   draft → active → archived (one active per template)
    └── onboarding_template_tasks  the definitions

onboarding_instances            one per employee, snapshots a template version
├── onboarding_tasks            copied from the definitions, never joined to them
│   └── onboarding_induction_details   1:1, only for induction tasks
└── document_acknowledgements   (also used organization-wide, independent of onboarding)
```

### Why these shapes

**Envelope/version split** follows the precedent already set by `offers`/`offer_versions` and `organization_documents`/`organization_document_versions`, rather than inventing a third versioning shape.

**Applicability lives on the template, not the version**, because it answers *which employees is this for* rather than *what does this do* — and editing it cannot affect an in-flight onboarding, whose tasks were already copied.

**Tasks are copied, not referenced.** This is what makes §26.7 true: publishing a new template version cannot rewrite work already issued. `templateTaskId` remains only as a provenance pointer.

**Induction is a linked 1:1 detail row** rather than columns on `onboarding_tasks` (§26.38 item 2). Six-plus fields would be NULL on every non-induction task, and the reschedule fields are the kind that keep growing. This mirrors WS-9's choice to make employment particulars a separate record instead of sixteen columns on `offer_versions`. Induction remains a *kind* of task: its status, requiredness, responsibility, due date and completion all live on the task row.

**Assignment and acknowledgement are one table** (§26.38 item 3). Assigning a document *is* creating the obligation to acknowledge it; the frozen status model has exactly two states, which one row expresses as `pending` then `acknowledged`. Re-acknowledgement of a later version is a new row against the new version, so earlier evidence is preserved by construction rather than by remembering not to overwrite it.

**The table is named `document_acknowledgements`, not `onboarding_acknowledgements`**, because §26.18 requires it to serve the handbook, a Code of Conduct and ordinary HR policies, and §26.21 allows assigning to every employee in the organization. An all-staff policy re-issue has nothing to do with anybody's onboarding, so `onboardingInstanceId` is an optional link rather than the owner of the row. §26.32 explicitly says not to create the listed tables mechanically.

### Database-level guarantees

| Guarantee | Mechanism |
| --- | --- |
| One active version per template | Partial unique index on `(templateId) WHERE status = 'active'` |
| One open onboarding per employee | Partial unique index on `(organizationId, employeeId) WHERE status IN ('not_started','in_progress')` |
| One acknowledgement obligation per employee per version | Unique index on `(organizationId, employeeId, documentVersionId)` |
| One induction detail per task | Unique index on `taskId` |

The second of these is what makes the conversion handoff genuinely idempotent: two concurrent retries cannot both create an instance, because the database refuses the second regardless of timing.

---

## Status models (frozen, §26.8)

| Entity | States |
| --- | --- |
| Instance | `not_started`, `in_progress`, `completed`, `cancelled` |
| Task | `pending`, `completed`, `waived`, `cancelled` |
| Acknowledgement | `pending`, `acknowledged` |
| Template version | `draft`, `active`, `archived` |

**`overdue` is derived, never stored.** It is computed from `dueAt` + an unfinished status + the current instant. A persisted flag would be wrong the moment the clock moved; the test suite proves the same rows report differently for a different "now".

**Completion is server-derived.** An instance completes exactly when every required task is completed or validly waived. There is no settable "completed" flag anywhere in the API. The percentage shown in the UI is informational and decides nothing — a bar at 90% and a bar at 100% can both be incomplete.

---

## Responsibility resolvers

Five server-defined resolvers: `employee_self`, `reporting_manager`, `department_head`, `permission_holder`, `specific_membership`.

Authority is **relationship-derived, never a role-name string** — the ruling WS-9 recorded in §25.2, extended here. Renaming a role must never move authority, and holding a title must never confer it. Department Head resolves through the temporal `department_heads` model.

§26.11 also mentions the organization administrator. It is deliberately **not** a sixth resolver: it is addressed through `permission_holder` with an appropriate key, because a dedicated "org admin" resolver could only be implemented by matching a role name — precisely what the rule forbids.

Pending work **re-resolves** at read time, so replacing a manager or Department Head moves outstanding tasks to whoever now holds the relationship. Completed work does not: `completedBy`/`completedByName` are frozen at the moment of completion and never rewritten. Both halves are proven by test.

An empty resolution is legitimate, not an error — a department may have no current head, and a permission may be held by nobody. The task then shows as unassigned rather than being given to someone arbitrary, and a reminder for it notifies nobody rather than failing.

---

## Due dates

Three bases only: `onboarding_start`, `commencement_date`, `dependency_completion` — plus a whole-day offset bounded to ±365. There is no expression language, and WS-6 owns the scheduler.

`dependency_completion` leaves `dueAt` NULL until the predecessor actually resolves, then computes from its real resolution time. Inventing a date for work that cannot start yet would be a fiction.

`commencementDate` is copied onto the instance at start rather than joined from the employee at read time, because due dates were resolved against the value that was true then; re-reading a later-corrected hire date would silently move historical deadlines.

---

## Task kinds and module boundaries

Onboarding **observes** other domains and never writes to them.

| Kind | Reads | Never does |
| --- | --- | --- |
| `document` | WS-5 `document_requirements` | Store a document, or hold a second opinion on verification |
| `acknowledgement` | `organization_document_versions` | Store a document |
| `asset_reference` | Open `asset_assignments` | Create an assignment or shadow custody |
| `inventory_reference` | Office Inventory custody | Move stock, create a request, or issue anything |
| `access_reference` | `employee_user_links` | Create a user, membership or role — WS-2 is authoritative |
| `payroll_reference` | Only the module flag and the caller's authority | Read a salary, bank detail or statutory identifier |
| `personnel_file_reference` | Whether a PIF exists | Allocate or reassign a PIF number |

**A reference task cannot be ticked into truth.** Completing one is refused when the referenced module does not show the expected state. The deliberate escape hatch is a **waiver**, which requires authority and a reason and is audited — not a silent tick. The test suite proves that attempting to complete unmet reference tasks creates nothing in Assets, Inventory or Personnel Files.

**A `document` task follows WS-5's verification**, not its own: `provided` is not `verified`, and the task stays blocked until WS-5 says otherwise.

**A `payroll_reference` requires Payroll enabled *and* the caller to hold `payroll.compensation.read`.** Note what this does not do: it reads no payroll data at all. Onboarding asks "is this person's payroll setup done?" of somebody already entitled to know, and stores only the yes.

**Neither PIF numbering nor employee numbering is rebuilt.** Onboarding references whether they exist and never generates or reassigns either.

---

## What WS-10 deliberately does not gate

Two gates were frozen **negative** in §26.23, and both are proven by test:

- **ESS access does not depend on onboarding.** Existing behaviour (module + role) is unchanged, and an employee works normally while onboarding is incomplete. WS-10 does not lock anyone out.
- **Probation does not start from onboarding completion.** No second probation mechanism exists, and completing onboarding appends no `employment_periods` event and does not change `employmentStatus`.

---

## Handbook and policy acknowledgement

`HANDBOOK = a WS-5 organization document + a WS-10 assignment/acknowledgement layer.` No second document store exists.

Two additive columns on `organization_documents` carry the configuration, both defaulting to `false` so no existing document silently acquires an obligation:

- `requiresAcknowledgement` — whether this document carries an obligation at all.
- `reacknowledgeOnNewVersion` — whether a newly effective version raises a fresh one. §26.20 forbids forcing every revision to require re-acknowledgement, so this is per-document organization configuration.

Audience is a fixed allow-list — all employees, branch, department, position, employment type, or explicit selection — not a query the caller writes.

### Wording

This records that a person **acknowledged receipt** of an exact version. It is **not an electronic signature**, WS-10 builds no e-signature capability, and no surface says "signed". The UI wording is *Confirm receipt* / *Acknowledged*.

---

## WS-6 reminders

Three allow-listed job types, and no more:

- `onboarding.task_reminder` — due soon
- `onboarding.overdue_reminder` — past due
- `onboarding.acknowledgement_reminder` — outstanding document

**In-app only. No email, no SMS** — no such delivery capability exists anywhere in this platform, and WS-10 did not invent one.

These are separate handlers rather than reuses of `reminder.notify` because §26.14 requires each to re-fetch authoritative onboarding state and no-op when stale, which a domain-neutral notifier cannot do. Each handler:

- re-fetches the task and its instance, scoped by organization;
- throws `PermanentJobError` (never retried) when the task is already resolved, the onboarding is closed, or the due date has moved into the future;
- re-resolves responsibility **at send time**, so a reminder follows whoever currently holds the relationship;
- notifies nobody, without erroring, when nobody is currently responsible.

Idempotency keys embed the task id *and* the due date, so moving a due date schedules a genuinely new occurrence while a retry of the same operation dedupes. Cancelling an onboarding cancels its still-queued jobs; the handlers are stale-safe regardless.

---

## Cancellation and correction

**Cancellation** requires authority and a reason, cancels only *pending* tasks, and leaves completed tasks, their actors, their evidence and all acknowledgements exactly as they were. It stops future reminders. It **does not end employment** — separation is a separate domain, and the test proves `employmentStatus` is untouched.

**Completed onboarding is not casually reopened.** The correction path is a *supplementary task*: it appends one new item and returns the instance to `in_progress`, so completed history stays intact and the correction is visible as its own item rather than as a rewrite.

---

## Permissions

Four keys, exactly as frozen in §26.31 — deliberately not a matrix:

| Key | Gates |
| --- | --- |
| `onboarding.read` | HR-wide visibility |
| `onboarding.manage` | Starting, waiving, cancelling, assigning a handbook |
| `onboarding.configure` | The template surface (organization configuration) |
| `onboarding.task.complete` | Completing a task on another person's behalf |

Granted to `org_admin` (all four) and `hr_manager` (all but `configure`, mirroring the WS-8 split where configuration is an organization-administration act). The `employee` role receives **none of them**.

**No acknowledgement permission key was minted.** An employee acknowledging their own assigned document is authorized by self-scope through `employee_user_links`, never by a grant; assigning is already `onboarding.manage`.

Every route is additionally gated on the `onboarding` module, which is `defaultEnabled: false` like every other module.

---

## Surfaces

| Surface | Route | Scope |
| --- | --- | --- |
| HR list | `/onboarding` | Organization-wide, requires `onboarding.read` |
| HR detail | `/onboarding/:instanceId` | One employee's checklist, documents, acknowledgements, induction |
| Employee | `/my-onboarding` | **Own only** — the employee is resolved server-side from the caller's identity; a supplied id is never read |
| Manager / Department Head | `GET /onboarding-responsibilities` | **Only** tasks the resolvers currently point at the caller |

A manager gains **no** organization-wide onboarding visibility from being a manager. Ordinary employees never see organization-wide onboarding data.

---

## WS-8 integration

WS-8 recorded the contract in advance and WS-10 fulfilled it exactly: `onboarding` flipped to `bindable: true` and one branch was added to the entity lookup in `lib/customFields/scopes.ts`. Nothing else about WS-8 changed, and no second form-submission model was created. Custom values on an onboarding record follow the employee permissions, per §24.15's rule that value authorization follows the target domain.

The WS-8 live suite's assertion that the scope was *not* bindable was updated to assert the new behaviour, with the reason recorded inline.

---

## Conversion handoff

`convertApplicationToEmployee` starts onboarding after its transaction commits, deliberately **non-fatally**: a conversion that has already committed must not be reported as failed because a downstream checklist could not be raised. "No applicable template" is the ordinary case for an organization that has not configured onboarding, and is not surfaced as an error.

The handoff is idempotent at three levels — the open-instance unique index, `document_requirements`' own uniqueness, and `document_acknowledgements`' uniqueness — so a retried callback creates no duplicate employee, instance, requirement, assignment or reminder.

**WS-10 never creates an employee.** Recruitment conversion and the canonical creation paths remain authoritative, and onboarding can be started for a legacy, migrated or manually created employee with **no candidate record at all**.

---

## Testing

36 live tests across two suites, opt-in behind `WS10_LIVE_DATABASE_URL` and fail-closed against non-local hosts:

- `onboardingLive.test.ts` (27) — the §57–§63 matrices: configuration, versioning, snapshot isolation, due dates, derived overdue, required/waiver/completion, responsibility re-resolution vs. frozen history, documents, acknowledgement version-exactness, induction, reference-task safety, cancellation, and the IDOR/abuse set.
- `onboardingRemindersLive.test.ts` (9) — the WS-6 contract and conversion handoff idempotency.

Run them with:

```
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
WS10_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
pnpm --filter @workspace/api-server test
```

---

## Terminology

This is ordinary HR onboarding. It is **not** named "Ghana onboarding" or "CIHRM onboarding". Handbook acknowledgement and induction align with professional HR practice reviewed during the plan, but are **not** statutory requirements, and no CIHRM certification or compliance is claimed.

---

## Known limitations

- **No email or SMS reminders** — the platform has no such delivery capability, and WS-10 did not add one.
- **No e-signature.** Acknowledgement is confirmation of receipt.
- **`reportingManagerId` is still not carried through Recruitment conversion** (ranked gap #11, unchanged by this workstream). A `reporting_manager` resolver therefore returns empty for a freshly converted hire until a manager is set.
- **A single predecessor per task**, not a dependency graph — §26.9 forbids growing this into a project-management system.
- **No WWM configuration** was performed: no templates, no handbook, no policies, no started onboarding, no induction. QA used disposable synthetic organizations only.
