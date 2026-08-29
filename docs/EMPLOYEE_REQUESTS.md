# Employee Data Change Approval & HR Service Requests (WS-13)

Implements the architecture frozen as **§29** of `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` (Owner Decisions #10 and #11, constrained by #14, #16, #17, #18 and #23).

WS-13 extends what already existed. It rebuilds nothing: WS-8 Custom Forms, WS-5 Documents, the WS-6 scheduler, WS-3 audit and OD #23 masking, WS-9's Recruitment approval configuration, Leave's approval chain and Office Inventory's delegation are all untouched in behaviour.

---

## The repository fact that shaped everything

**An employee could not change their own record at all.** `PATCH /employees/:id` is gated on `employee.write` (HR), and the only self-service writes in the platform were profile-picture upload and delete.

So a data-change request is not a gate placed over an existing self-service path. **It is the path.** That is why the ESS surface is a first-class part of this workstream rather than a convenience.

**WS-8 had already pre-recorded a contract for this**: §24.23 names "Employee Data Change" as a future consumer of form submissions, and `custom_form_submissions` is deliberately a bare record with no status and no lifecycle. WS-8 supplies the form layer; WS-13 adds the lifecycle above it and adds no workflow columns to WS-8's tables.

---

## One architecture, two origins

| Origin | Subject resolved from | Route sets origin |
| --- | --- | --- |
| `employee_self_service` | The caller's own `employee_user_links` record | `/my-data-change-requests` |
| `hr_originated` | The `:employeeId` path parameter | `/employees/:employeeId/data-change-requests` |

**Origin is decided by the route, never by the body.** The ESS body carries no employee identifier at all, so tampering with it cannot make a request somebody else's. A frontend test asserts the client sends none, and a live test asserts a cross-tenant employee id is refused.

---

## The eligible-field registry

`lib/employeeRequests/eligibleFields.ts` is an explicit **allow-list of 16 personal and profile fields**. There is no "any employee column" mechanism, and configuration cannot introduce one.

**Excluded by construction** — and a live test proves each is refused: `employmentStatus`, `separationDate`, `separationReason`, `positionId`, `departmentId`, `branchId`, `reportingManagerId`, `hireDate`, `probationEndDate`, `employmentType`, `employeeNumber`, `notes`, plus everything in Payroll's banking and statutory tables, Leave, Assets, Office Inventory, disciplinary and grievance state, and Identity & Access.

The reason is concrete: `employees` mixes three ownership classes in one row, so a registry keyed on "this column exists" would hand WS-13 a route into separation, promotion and banking.

**§29.26 item 3 resolved** — the registry lives beside the service, not in `@workspace/db`. It governs what the platform may *write*, not what the column may hold; placing it next to the schema would invite someone to generate it from the table definition, which is exactly the mechanism §29.3 forbids.

---

## The four rules the service holds

**Maker-checker.** `requester != approving actor`, checked by **both user id and membership id**, on every decision path. The obvious evasion — holding a second membership in the same organization — is impossible: `organization_memberships` is unique on `(application_user_id, organization_id)`, so the loophole is closed by the schema. A live test proves both halves.

**Stale protection, per field.** The previous value of each field is captured when the request is raised and re-compared against the live value at decision time *and again* at application time. A moved value marks the request `stale` and it is never silently applied — it waits for an audited re-confirmation. Crucially, **an edit to an unrelated column does not invalidate an untouched request**, which is why `employees.updatedAt` is only a coarse signal and never the concurrency authority. Both behaviours are tested.

**One active request per (employee, field).** A partial unique index over the active statuses only, so history is fully preserved: an employee may have twenty rejected requests for the same field and still raise a new one.

**No scheduled application.** `effectiveDate` is recorded as a business fact. There is deliberately no "apply due changes" job handler, and `applyRequest` is unreachable from any job — §29.11's rule that a future effective date does not licence a scheduled write.

---

## Application

Transactional and idempotent. The status guard is re-asserted **inside** the transaction, so two concurrent applies cannot both pass and a partially applied multi-field change is not representable. A retried apply returns the same `appliedAt` and produces exactly one `applied` event.

A failure is recorded as `application_failed` with its reason rather than swallowed — §29.10 forbids a request that claims to be applied when the write did not succeed.

Four instants are kept apart: `requestedAt`, `decidedAt`, `effectiveDate`, `appliedAt`. `createdAt` is none of them.

---

## Approval stages

WS-13's **own** namespaced configuration, modelled on WS-9's proven design: ordered stages, three server-defined resolvers (`department_head`, `permission_holder`, `specific_membership`), and a **stage count frozen at request time** so reconfiguring a chain cannot retroactively change whether an in-flight request is complete.

**Shipped Recruitment is not refactored and is not made to depend on WS-13** (§29.8). Duplication is deliberately preferred to destabilising a completed workstream, and **OD #14 and OD #15 are expressly not claimed** — there is no cross-product approval engine and no delegation framework here. Assignment for fulfilment is routing, not delegation.

Authority is never inferred from a role name. A `department_head` stage resolves through the live `department_heads` relationship, so a replacement Head takes over pending work and a former Head stops being able to decide.

---

## Sensitive values

`nationalId` and `passportNumber` are marked sensitive and masked using **WS-3's existing `maskIdentifier`** — OD #23 is reused, never reimplemented.

Masking applies in the approval DTO, the chronology `details`, audit metadata, notifications and reports. The authoritative column still receives the real value: **masking governs who may see it, not what is stored.** A live test asserts the secret appears in `employees` and in none of the four surfaces.

**Being an approver expands no data visibility** (§29.7). `toApprovalView` is built field by field and never spreads the employee record, so a column added to `employees` tomorrow cannot start leaking through an approval screen.

---

## HR Service Requests

A configurable catalogue, not a process designer. A type carries a stable code, name, active and employee-visible flags, whether approval is required, a fulfilment kind (`acknowledgement` or `document`), an optional WS-8 form, a responsible department and an informational target.

**Approval and fulfilment are separate states.** An approved request is not thereby fulfilled — folding them into one enum would make "approved but not yet done" unrepresentable.

**WS-13 generates no documents.** An employment-letter request is fulfilled by generating through WS-5 and pointing `generatedDocumentId` at the result; a document-fulfilled type cannot be fulfilled without one. This stays distinct from **WS-11.1's deferred lifecycle-letter automation**: a request *for* a letter is a person asking, not an event firing.

Specialized workflows stay specialized (§29.5): Leave, Recruitment, Onboarding, Employment Lifecycle, Employee Relations, Payroll, Assets, Office Inventory and Identity & Access keep their own flows. A service request may refer; it never becomes an alternate source of truth.

---

## Employee Self-Service visibility

`serviceRequestEvents.visibleToEmployee` defaults to **false at the database**, so an internal note written by a service that has never heard of ESS is private by construction. The ESS query filters in SQL and `toEssView` filters again.

Both ESS views are allow-lists built by construction — no assignee, no stage configuration, no internal notes, no event `details`. Somebody else's request returns **404, not 403**, because a 403 would confirm it exists.

---

## Permissions

Eight new keys: `data_change.read` / `.request` / `.approve` / `.configure`, and `service_request.read` / `.manage` / `.approve` / `.configure`.

**Self-service mints no key** — an employee's right to ask about their own record comes from their employee link, the WS-10 and WS-12 precedent. Organization Admin holds all eight (maker-checker still stops them approving their *own* request, which is a per-request rule, not a per-role one); `hr_manager` is withheld both `configure` keys.

---

## Scheduled jobs

Four types, all observers: `data_change.approval_pending`, `service_request.approval_pending`, `service_request.overdue`, `service_request.awaiting_employee`.

**No job may approve, reject, apply or fulfil anything.** Each re-fetches authoritative state and returns a permanent no-op when stale, and notification bodies carry no requested value — a notification list is a wider audience than the record's own permission. A live test asserts no registered job type anywhere matches an approve/apply/fulfil shape.

---

## Schema

Migration **`0069`**, **purely additive**: eight new tables, nine new enum types, zero drops and zero altered columns. All eight RLS-enabled with zero policies. Up/down/up verified on a fresh database, with `employees` confirmed unchanged at 36 columns throughout.

**§29.26 item 2 resolved** — one chronology table per request kind, each with a real foreign key. A shared decision table would need a polymorphic `(requestKind, requestId)` pair, which this repository can only express *without* a foreign key — the shape `document_requirements`' owner pair took, which WS-10 then had to validate in application code.

Two columns on `data_change_request_fields` are denormalized purely so the partial unique index can be expressed: a unique constraint cannot reach through a join.

---

## Tests

`artifacts/api-server/src/test/employeeRequestsLive.test.ts` — **26 live integration tests, all executed and passing** against a disposable local PostgreSQL (the `docker-compose` `db` service on 5433):

```
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
WS13_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
pnpm --filter @workspace/api-server test
```

Running them found a real defect: the duplicate-pending unique violation was not being recognized, because drizzle wraps the driver error and the SQLSTATE sits on `cause` rather than on the thrown object. Reading only the outer `code` silently missed every violation. Fixed by walking the cause chain.

Frontend: `my-requests.test.tsx` and `requests.test.tsx` — 17 tests covering the §29.17 write paths, including that neither ESS form sends an employee identifier, that a 403 hides a surface rather than showing an error, and that the workspace does not aggregate other modules.

---

## Known limitations

- **No SLA escalation engine.** A configured target and a *derived* overdue state ship; nothing reassigns or auto-decides (§29.22).
- **Approval delegation is deferred** to OD #15's future owner. Assignment for fulfilment is not delegation.
- **No WS-7 import adapters** — deferred, with no fabrication of historical requests or decisions.
- **No AI of any kind.**
- **No email or SMS** — the platform has no such capability.
- **The WS-12 future-separation-basis dependency is not solved here.** A resignation service request is a request, never a separation basis, and lifecycle fields are excluded by construction.
- **WS-11.1 remains deferred in full**, including lifecycle-letter automation.
- **No WWM configuration** was performed. QA used disposable synthetic organizations only.
