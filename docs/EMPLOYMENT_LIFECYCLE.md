# Employment Lifecycle Events Expansion (WS-11)

Implements the architecture frozen as **§27** of `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` (Owner Decisions #2, #6, #8).

WS-11 extends the employment lifecycle that already existed. It rebuilds nothing: `confirmEmployee()`, `transferEmployee()`, `promoteEmployee()`, `separateEmployee()`, `rehireEmployee()`, employee numbering, PIF, Recruitment conversion and the Performance probation linkage are all untouched in behaviour.

---

## The two histories, and why they are not the same thing

| | `employment_periods` | `audit_events` |
| --- | --- | --- |
| Answers | *What happened to this person's employment?* | *Who did what in this system, when?* |
| Audience | HR, the employee, an employment record | Security, compliance, incident review |
| Written by | Lifecycle services and WS-7 imports | Everything |

They are complementary and are never conflated. `recordEmploymentPeriodEvent` writes **both** — a lifecycle row plus a mirrored `employment_period.${eventType}` audit row — and that pre-existing behaviour is preserved.

### The gap WS-11 closed

Before WS-11, `employment_periods` received only `transfer`, `promotion` and `confirmation`. **Separation and rehire wrote an audit event but no lifecycle event**, so the Employment History surface omitted the two most consequential events in an employment relationship. That was a deliberate W15-predates-W22 artifact, not a defect.

WS-11 closes it **forward only**. New separations and rehires append a lifecycle event alongside their unchanged audit event. Nothing is backfilled: an employee already terminated without an event keeps that honest absence rather than gaining an invented date. A backfill, if ever wanted, is an explicit authorized reconciliation against real source evidence — never an automatic migration.

---

## Event vocabulary

`employment_periods.eventType` is `text` and **stays** `text`. It is deliberately not a database enum, because WS-7's import adapter accepts arbitrary historical event strings by design — its own comment refuses to *"force an imported history row into a stricter taxonomy than the domain itself enforces"* — so real customer history already contains values no enum could anticipate.

Control lives on the **write path** instead (`lib/employmentLifecycle/eventTypes.ts`):

| Registered system events | |
| --- | --- |
| Pre-existing | `transfer`, `promotion`, `confirmation` |
| Added by WS-11 | `separation`, `rehire`, `probation_extension`, `probation_unsuccessful`, `contract_renewal`, `acting_start`, `acting_end`, `secondment_start`, `secondment_end` |

`recordEmploymentPeriodEvent` takes a `source` discriminator:

- **`"system"` (default)** — the event type must be registered and its `newState` shape is validated. This is what stops a caller inventing, say, a `confirmation` through some other route.
- **`"import"`** — WS-7 only. Stored exactly as supplied, never rejected, never rewritten.

**Imported history is inert.** `isSystemEventType()` returns false for it, and only registered system events participate in state derivation. A row whose imported `eventType` happens to read `probation_extension_from_old_system` is historical evidence — it cannot move a live probation date, and there is a test that proves exactly that.

**Contract expiry is not an event.** A date passing is not an act. Expiry is derived state; an event is written only when an authorized person records an action.

**Hire/commencement is deliberately deferred.** `createEmployee` is shared by Recruitment conversion, manual creation, legacy import and WS-7 migration. Emitting a hire event there would fabricate hundreds of events with imported or unknown dates on every bulk import — the fabrication this workstream exists to avoid.

---

## Employment terms

Migration `0067` adds `employment_terms`. §27.22's first open item is resolved as **one table, not an envelope/version pair**: the offers/offer_versions shape models *revisions of one thing*, but a renewal is not a revision — the old term genuinely ended and a new one genuinely began, with its own dates and its own legal meaning. The chain is a linked list via `renewedFromTermId`.

Why not somewhere existing:

- **`employment_periods`** is an append-only event log with no current-state fields, so it cannot answer "when does this contract expire?"
- **A single `employees.contractEndDate`** destroys history, which OD #8's "historical integrity" forbids.
- **`employment_particulars`** is the *written statement of terms*, keyed to an offer version and frozen at issuance. It cannot serve an employee who never had an offer.

`status` stores only what cannot be derived — `active`, `superseded`, `closed`. Whether a term is `current`, `expiring_soon` or `expired` is **computed** from its dates and an explicit `asOf`, never stored: a persisted "expired" flag would be wrong the moment the clock moved.

One active term per employee is a **partial unique index**, so two concurrent creations cannot both succeed.

### Renewal

Supersedes the prior term and creates a new one linked back to it, in one transaction, plus a `contract_renewal` event. The prior term's dates, type and reason are never touched.

### Expiry — the frozen boundary

**Contract expiry never terminates employment.** Nothing in WS-11 calls `separateEmployee` from an expiry path, and nothing may be added that does.

An expiry date reaching today does not prove employment ceased: renewal, extension, administrative delay, a statutory requirement or an organizational decision may all intervene, and the system cannot know which. Expiry is surfaced — in `GET /employment-terms/expiring`, in the reminder, and in the UI — as **information for a human**, with wording that says employment is unchanged until an authorized action is recorded.

**§27.22 item 3 resolved: `employment_particulars`' pre-recorded second-owner column is deferred.** Taking it up means adding a nullable owner column to a WS-9 table and changing its unique index — real risk for a capability nothing in WS-11 needs, since renewal letters generate through WS-5 directly. The option remains open exactly as WS-9 recorded it.

---

## Probation

**No second probation mechanism, and no new probation table.** `confirmEmployee()` is untouched and remains authoritative for the successful path; `employees.probationEndDate` remains current state; `employment_periods` carries history. WS-11 adds only the two capabilities §21 recorded as missing.

**Extension** is an effective-dated event capturing the previous expected end, the new one, the effective date, a required reason, the actor and an optional probation-review reference (validated exactly as `confirmEmployee()` validates it — same organization, same employee, `cycleType='probation'`). The column moves; the event preserves what it was.

Current expected end resolves from the latest **registered** extension event, falling back to `employees.probationEndDate`. The registered-only filter is the point: an imported string cannot move a live date.

**Unsuccessful outcome — the sharpest boundary.** Recording it:

- writes a `probation_unsuccessful` event with the reason and any review reference;
- surfaces an HR action;
- **does not separate the employee**, does not change `employmentStatus`, and schedules nothing that would.

If employment ends, it ends through the authoritative separation service as an explicit authorized act. There is no hidden `probation failed → terminate` coupling, and a test asserts that no separation event or `employee.separated` audit event exists afterwards.

---

## Acting appointments and secondments

Migration `0067` adds `employment_assignments`. §27.22's second open item is resolved as **one table with an `assignmentType` discriminator**: acting and secondment differ in only a few payload columns, but their lifecycle — start, expected end, actual end, overlap, point-in-time resolution, history, reminders — is identical, and duplicating that machinery twice for a handful of columns is the larger cost. §27.14's "four distinct concepts" is about semantics, which the discriminator and per-type validation preserve.

### The rule the table exists to enforce

**Nothing writes `employees.positionId`, `departmentId` or `employmentStatus`.** A temporary assignment sits *beside* the substantive appointment. This is why ending an acting appointment restores nothing — nothing was overwritten.

**`acting` and `seconded` are not `employmentStatus` values and must never become any.** That enum answers *whether* someone is employed; these rows answer *where they are working*. Conflating them would corrupt every existing consumer of employment status.

Effective dating follows `department_heads`: an open row has a null `actualEndDate`, and a partial unique index allows at most one open row **per type**. That deliberately permits someone to be acting and seconded at once — a legitimate arrangement the frozen scope does not forbid — while preventing two concurrent appointments of the same kind.

### Secondment V1

Descriptive destination only. **Cross-organization secondment inside the platform is out of scope**: moving a person between tenants would cross the isolation boundary every other part of this platform enforces, so there is deliberately no destination-organization reference to validate.

**No ownership transfers.** Leave, Attendance, Performance, Assets, Office Inventory and Personnel Files stay with the home organization, attached to the same `employees.id`. A secondment is an assignment fact, not a data migration.

---

## Scheduled jobs — observers, not decision-makers

Two allow-listed job types, registered through WS-6: `employment.probation_reminder` and `employment.contract_expiry_reminder`. **In-app only** — no email or SMS capability exists in this platform.

Each handler re-fetches authoritative state and returns a permanent no-op when stale: after confirmation, after separation, after a renewal that superseded the term, after an extension that moved the end beyond the reminder window, or when the term is no longer active.

**§27.11, frozen platform-wide:** scheduled jobs may calculate, detect, remind, notify and queue. They must **not** independently terminate, confirm, promote, transfer, accept a renewal, or end an acting appointment or secondment. This deliberately qualifies OD #13's "auto-revert" phrasing — a job may notice an expected end has passed and surface it, but ending it is an authorized human act. A test asserts no such mutating job type exists.

---

## Cross-module boundary

A lifecycle event never silently mutates another module's authoritative records.

`GET /employees/{id}/separation-readiness` reports outstanding asset custody, inventory custody and personnel-file state as **warnings only**. It performs reads exclusively: it returns no asset, moves no stock, closes no file, and its response carries `blocksSeparation: false` because these warnings are advisory and never prevent separation.

---

## Permissions

Three keys — `employment_lifecycle.read`, `.manage`, `.configure`.

Confirmation, transfer, promotion, separation and rehire **keep their existing `employee.write` gate untouched**: §27.21 forbids redesigning those services, and re-gating them would be a silent authorization change to shipped behaviour.

`org_admin` holds all three. `hr_manager` holds `read` and `manage` but **not** `configure` — configuration authority is not the same thing as operational authority, mirroring the WS-8 and WS-10 splits.

---

## Organization configuration

Namespace `employment_lifecycle`:

| Setting | Default |
| --- | --- |
| `defaultProbationDurationDays` | **none** |
| `maxProbationExtensions` | **none** |
| `probationReminderDaysBefore` | 14 |
| `probationExtensionsAllowed` | true |
| `contractExpiryReminderDaysBefore` | 30 |
| `actingAppointmentsEnabled` | true |
| `secondmentsEnabled` | true |

**No probation duration is defaulted, and none may be hard-coded.** §27.18 records that Ghana's Act 651 requires only a *"reasonable duration determined in advance"* with no verifiable numeric maximum, and that the widely repeated "six months" figure is **uncorroborated**. Encoding it would turn an unverified claim into product behaviour for every organization. Reminder lead times are ordinary operational defaults, not statutory claims, and remain fully overridable.

---

## Legal, practice, product and configuration

| Classification | Items |
| --- | --- |
| **LEGAL (Ghana)** | Probation of "reasonable duration determined in advance" (Act 651 §66(b)/§98(d); LI 1833 Reg. 5) — secondary-sourced, no verifiable numeric maximum. Notice periods (§17(1)). |
| **PROFESSIONAL PRACTICE** | Structured confirmation and probation review. **Nothing on record for acting appointments or secondment.** |
| **PRODUCT CAPABILITY** | The event registry, effective dating, the term model, reminders, document integration. |
| **ORGANIZATION CONFIGURATION** | Everything in the table above. |

The product is **Enterprise HRMS**. No UI string says "Ghana HR", "Ghana mode" or "CIHRM compliant", and no CIHRM certification or compliance is claimed.

---

## Documents

WS-5 only; no template table, file store, version system or renderer is rebuilt. `document_templates.categoryCode` is free text and organization-scoped, so WS-11 needs no new template-type enum, and `generated_documents` already carries a polymorphic `sourceType`/`sourceId` — a generated letter points at the lifecycle record rather than the record carrying a document FK. Organizations decide the template, the wording, the branding and whether a document is required at all. **No statutory form wording is hard-coded.**

---

## Testing

25 live tests in `employmentLifecycleLive.test.ts`, opt-in behind `WS11_LIVE_DATABASE_URL` and fail-closed against non-local hosts:

```
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
WS11_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
pnpm --filter @workspace/api-server test
```

They cover the §52–§58 matrices, and the negative assertions are the point: an expired contract leaves the employee active with no separation event; an unsuccessful probation outcome leaves status and separation date untouched; an acting appointment leaves `positionId` unchanged before, during and after; imported history cannot move a probation date; and no lifecycle-mutating job type exists.

---

## Known limitations

- **No hire/commencement event** (deferred with reason, above).
- **No cross-tenant secondment** — V1 is descriptive.
- **No automatic auto-revert** of acting appointments or secondments; overdue ones are surfaced for an authorized decision.
- **No email or SMS reminders** — the platform has no such capability.
- **Separation and rehire history is forward-only.** Employees separated before WS-11 have no lifecycle event, by design.
- **`employment_particulars` second-owner column deferred** — the WS-9 option remains open and unused.
- **No WWM configuration** was performed. QA used disposable synthetic organizations only.
