# Employee Relations & Offboarding Clearance (WS-12)

Implements the architecture frozen as **§28** of `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` (Owner Decisions #9, #12, with #14, #16, #17, #18 and #20 constraining it).

WS-12 extends what already existed. It rebuilds nothing: `separateEmployee()`, `rehireEmployee()`, the WS-11 lifecycle services, WS-5 Documents, the WS-6 scheduler, WS-3 audit, WS-8 custom fields, the Assets custody model and the Office Inventory ledger are all untouched in behaviour.

---

## What was already here, and what that changed

Pass-1 reconciliation found the workstream register's "PARTIAL" labels understated the repository. Two of the three pillars were already shipped:

| | Before WS-12 | After |
| --- | --- | --- |
| **Disciplinary** | `employee_disciplinary_records` — append-only, five business columns, free-text `actionType`, its own `employee.disciplinary.read` permission, live routes and UI | Unchanged and **preserved as immutable legacy history**. `disciplinary_cases` + `disciplinary_case_events` added beside it. |
| **Grievance** | Nothing. The only repository hits were `employment_particulars.grievanceProcedure`, a text clause printed into appointment letters | `grievance_cases` + `grievance_case_events`, a genuinely distinct record type |
| **Offboarding** | `employee_exit_processes` — three booleans and a free-text note, correctly keyed per separation cycle | Extended additively with status, separation basis, expected date, final clearance; real clearance items added |
| **Clearance data** | WS-11's `separation-readiness` already read open asset assignments, employee-held inventory and personnel files | Extended, not reinvented — plus the `returnable`-only filter §28.10 requires |

---

## The three boundaries, each proven by test

**A disciplinary outcome separates nobody.** Recording even `dismissal_recommended` leaves `employmentStatus`, `separationDate` and the audit trail untouched. `separateEmployee` is not imported anywhere in `lib/employeeRelations/`. If employment ends it ends through WS-11's own service as a separate authorized act (§28.7).

**Final clearance separates nobody.** Granting final clearance produces `status = completed` and nothing else. The employee remains exactly as employed as they were.

**Completing a clearance item mutates no other module.** Completing an `asset_return` item does not set `custodyEndedAt`, does not change asset condition and does not touch `asset_incidents`; an `inventory_return` item moves no stock. A test asserts the open assignment is byte-for-byte unchanged afterwards, and that custody is still reported as outstanding — because it genuinely is.

---

## Legacy disciplinary history

`employee_disciplinary_records` is frozen. Not one row is migrated, restated or reinterpreted, and no case is fabricated around one. Allegations, hearings, findings, stages, appeals and outcomes that were never recorded are never inferred — the §27.3 forward-only principle applied to the one domain where invented evidence is most damaging.

Both surfaces appear on the employee record, each behind its own permission.

---

## When offboarding may begin

Offboarding may start **before** separation, but only against an authoritative recorded basis. `resolveSeparationBasis()` is the only way in, and a client cannot assert a basis — it is discovered from the employee's own state and from WS-11's employment terms.

Two bases are recognized, and **the shortness of that list is a finding, not an omission**:

| Basis | Authoritative record |
| --- | --- |
| `already_separated` | `employmentStatus = 'terminated'` with a separation date — the shipped precondition, preserved |
| `contract_end` | An active fixed-term `employment_terms` row with an end date (WS-11) |

**Accepted resignation, retirement and approved termination are deliberately absent.** No authoritative record for them exists anywhere in this platform: `employees` carries `employmentStatus`, `separationDate` and a free-text `separationReason`, all describing a separation that has *already* happened, and nothing records an approved future one. Minting a row to stand for "resignation accepted" would be the parallel separation record WS-12 is forbidden to invent, and would let an offboarding case authorize itself — the exact thing §28.6's control exists to prevent. Adding those bases needs an authoritative record first, and therefore its own Owner Decision.

`separation_date` became nullable to make this possible. That is the one non-additive change in migration `0068`, it is a widening, and every existing row keeps its value.

---

## Clearance

Template → instance, **copied at initiation**. Editing or deleting a template item afterwards changes nothing in flight (`sourceTemplateItemId` is `set null` on delete, and a test proves a live obligation survives its template item being deleted). This is the WS-10 snapshot precedent.

**Waiver is the deliberate escape hatch and it costs a reason** — enforced non-empty, stored on the row, and carried into the audit event. An organization that cannot recover a laptop must still be able to close the file, but never silently. A waived required item counts as discharged; refusing that would make the hatch useless.

**Final HR clearance is a distinct terminal act**, not the arithmetic of the item list. It refuses while a required item is outstanding.

**The three legacy booleans are not a second source of truth.** Once an offboarding has clearance items, `clearanceCompleted` is derived and `updateEmployeeExitProcess` refuses to set it (`ClearanceIsDerivedError`). Rows without items — every `legacy` row — keep the booleans as their only record and stay editable exactly as they shipped.

---

## Grievance visibility in ESS

The employee-facing view is an **allow-list built by construction, never by deletion**. `toEssView()` names every field explicitly; the full record is never spread into it. If somebody later adds an `internalRiskAssessment` column, a spread-based view would leak it the day it shipped — this one would not.

`grievance_case_events.visibleToComplainant` defaults to **false at the database**, so a note added by a service that has never heard of ESS is private by construction. The ESS query filters in SQL, and `toEssView` filters again — a caller who forgets the first filter still cannot leak an event.

Omitted from the view: confidentiality tier, assigned investigator, respondent, `createdBy`/`closedBy`, event `details`, and every event not deliberately marked communicated.

A grievance belonging to somebody else returns **404, not 403** — a 403 would confirm the case exists, which is itself a disclosure about a colleague's complaint.

---

## Permissions

Eight new keys: `employee_relations.read` / `.manage`, `grievance.read` / `.manage`, `offboarding.read` / `.manage` / `.configure`, `clearance.act`.

`employee.disciplinary.read` is **not** redefined, renamed or removed, and Organization Admin keeps it exactly as seeded — silently revoking a shipped authorization is the change §27.21 warns against.

**Organization Admin is deliberately not granted grievance access.** A grievance may be about the administrator, or about somebody they line-manage. `hr_manager` gets it, because handling grievances is the HR function; rank alone does not confer it. `offboarding.configure` is withheld from `hr_manager`, mirroring the WS-8/WS-10/WS-11 configuration-versus-operation split.

Waiving is `offboarding.manage`, not `clearance.act` — the desk that cannot recover an item should not also be the party that excuses it.

---

## Owner Decision #18 — sensitive-read auditing

§28.1(9) recorded that OD #18 was **unimplemented for every data class it named**: a repository-wide search for a read-shaped audit event type found none, so all ~340 audit call sites recorded mutations and nothing recorded a look.

`lib/sensitiveRead.ts` closes that for WS-12's scope. It is a thin front door onto WS-3's `recordAuditEvent` — no second audit system (OD #16). Reads land as `<targetType>.read` in the **`hr`** category, deliberately: moving them to `security` would quietly remove them from the HR auditors who hold audit-read for `hr` (OD #17), which would be a silent authorization change.

Risk-based, not noisy. It fires on opening a specific case and on evidence access. It does **not** fire on list endpoints, offboarding or clearance surfaces, reporting read models, or an employee reading their own grievance — auditing somebody for looking at their own complaint would be its own kind of wrong. No before/after state is recorded: a read copies no confidential content into a trail with different read rules.

---

## Scheduled jobs

Six job types, all observers: `employee_relations.response_due`, `employee_relations.hearing_reminder`, `grievance.acknowledgement_due`, `grievance.action_overdue`, `offboarding.clearance_assigned`, `offboarding.clearance_overdue`.

**No job records a finding, decides an outcome, closes a case, waives an item, grants clearance or separates anyone** (§28.20, and §27.11's platform-wide rule). Each re-fetches authoritative state and returns a permanent no-op when stale. Notification bodies are content-free: a notification list is a wider audience than a case's own permission.

Disciplinary reminders go to `employee_relations.manage` holders and grievance reminders to `grievance.manage` holders — routing a grievance reminder to the broader audience would leak the existence of a complaint to people §28.17 withholds access from.

In-app only. No email or SMS capability exists in this platform.

---

## Exit interviews

Questions and answers are **WS-8 Custom Fields** bound to a new `exit_interview` scope; no second questionnaire engine (§28.19). The scope binds to the **interview**, not the employee, so responses stay tied to the correct separation cycle — otherwise an employee who leaves, returns and leaves again would have their second interview overwrite their first.

`exit_interviews` holds only what a form cannot: date, interviewer, and the confidential HR note.

**§24.3's prohibition on custom fields over disciplinary findings stands.** Findings use typed columns. A test asserts `disciplinary_case` and `disciplinary_finding` are not custom-field scopes.

**No rehire eligibility.** No `rehireEligible`, `doNotRehire`, `rehireStatus`, `rehireRecommendation` or equivalent inferred flag exists in the schema, the services, the API or the UI — a test asserts no key on the interview record contains "rehire". `reasonForLeavingCode` is not that flag: it records why someone says they are leaving, which is analysis, not a judgement about their return.

---

## Schema

Migration **`0068`**, additive apart from one deliberate widening.

Eight new tables: `disciplinary_cases`, `disciplinary_case_events`, `grievance_cases`, `grievance_case_events`, `clearance_templates`, `clearance_template_items`, `clearance_items`, `exit_interviews`. All RLS-enabled with zero policies (repository convention).

Additive columns: `employee_documents.confidentiality` (defaults `normal`, so every pre-WS-12 document behaves exactly as before) and seven on `employee_exit_processes`.

The one widening: `employee_exit_processes.separation_date` drops NOT NULL. The down migration restores it and **fails deliberately** if any row still has a null — a running offboarding, which a rollback must not silently destroy.

`custom_field_scope` gains `exit_interview`. The down migration leaves it: PostgreSQL cannot remove an enum value, and rewriting the type would rewrite a live column used by every custom field in the platform.

Database guarantees rather than read-then-write checks: one active clearance template default per organization, one running offboarding per employee, one exit interview per offboarding.

**§28.27 item 1 resolved — separate chronology tables.** A shared table would need a polymorphic `(caseType, caseId)` pair, which this repository can only express *without* a foreign key — the shape `document_requirements`' owner pair took, which WS-10 had to validate in application code. Two small tables keep a real FK on both sides, and the vocabularies genuinely differ.

**§28.27 item 4 resolved — a new WS-8 scope**, for the separation-cycle reason above.

---

## Tests

`artifacts/api-server/src/test/employeeRelationsLive.test.ts` — 28 live integration tests, opt-in:

```
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
WS12_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
pnpm --filter @workspace/api-server test
```

The negative assertions are the point: legacy history unchanged, outcomes separating nobody, clearance returning no asset, consumables never appearing, waivers requiring a reason, ESS never carrying an investigator's note, offboarding refusing without a basis, cross-tenant ids failing safely, and no lifecycle-mutating job type existing.

---

## Known limitations

- **Only two separation bases** — resignation, retirement and approved termination need an authoritative record first (above).
- **No write-side UI for case actions.** The shipped surfaces are read-oriented: an Employee Relations workspace, an Offboarding and clearance workspace, an ESS grievance view and an employee-record panel. Opening cases, recording outcomes and acting on clearance are API-only in this workstream.
- **No lifecycle letters generated.** WS-5 supplies generation and `generated_documents.sourceType`/`sourceId` can already point at a WS-12 record; no WS-12 code wires it.
- **No legacy import adapters** — deferred to the existing WS-7 framework, with no fabrication from incomplete data.
- **No email or SMS reminders** — the platform has no such capability.
- **No WWM configuration** was performed. QA used disposable synthetic organizations only.
