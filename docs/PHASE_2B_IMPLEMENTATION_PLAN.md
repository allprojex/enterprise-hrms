# Phase 2B — HR Operations

**Status: DRAFT — NOT FROZEN.** This is a first draft for your review, not an approved plan. Nothing here is authoritative — scope, order, and architecture decisions all require your explicit approval before any workstream begins, in the same style `docs/PHASE_2A_IMPLEMENTATION_PLAN.md` used before it was frozen.

---

## 1. Objectives

Build the first slice of Workforce Operations — Leave, an Attendance configuration layer, and Employee Self-Service — on top of the completed Foundation (W1–W21) and Phase 2A Core Employee Domain (W22–W31). Phase 2B is also the first phase to actually *consume* the Module Management system (W3–W6): the `leave`, `attendance`, and `employee_self_service` modules were seeded in W3 as dormant (`status: "hidden"`), and every route/page this plan adds should be gated through the existing `requireModuleEnabled`/`<ModuleGate>` machinery rather than shipping unconditionally, the way every Foundation and Phase 2A route did.

---

## 2. Scope

Per `ROADMAP.md`'s Phase 3 ("Workforce Operations") list, this plan covers only the Leave/Attendance-configuration/Employee Self-Service slice of that list — Recruitment, Performance, Learning, Asset Management, and Manager Portal are explicitly deferred (see Out-of-Scope). In list form: Leave Types & Policies, Leave Requests, Leave Balances, Leave Approval, a Leave Calendar, Public Holiday Management, Attendance configuration (not attendance capture), an Employee Self-Service surface, and an HR Operations Dashboard.

---

## 3. Architecture Principles

1. **Module Gating goes live.** Every new route composes `requireModuleEnabled("leave" | "attendance" | "employee_self_service")` (W5) after `requireMembership`; every new page is wrapped in `<ModuleGate moduleKey>` (W6). This is the first phase where these mechanisms have anything real to gate.
2. **Reuse the Organization Configuration Engine (W2, ADR-009) for Attendance.** Attendance is configuration-only in this phase (work hours/days), not clock-in capture — it registers a new `attendance` namespace into the existing `organization_settings` engine, not a new table.
3. **Reuse the Services Layer pattern (ADR-011).** New transactional/policy-heavy logic (balance computation, approval transitions) lives in focused service classes, mirroring `lib/employees.ts` and `lib/employmentLifecycleService.ts`.
4. **Reuse the dedicated-route-file-per-resource pattern** established by W23/W24/W28/W29 for genuinely new sub-resource entities (Leave Types, Leave Requests, Public Holidays); reuse the single-action-on-record pattern established by W25–W27 for state transitions (approve/reject).
5. **Establish, for the first time, an "own resource" self-service permission shape.** Every prior permission in this codebase is role-scoped (`employee.read`, `employee.write`, ...); Leave Requests and Employee Self-Service need a caller to act on *their own* linked employee record regardless of role. This reuses W14's `employee_user_links` to resolve "which employee is me," not a new authorization primitive.
6. **Reuse `recordAuditEvent` directly for Leave state changes**, following W29's precedent — a leave request's own status column is its state, and audit_events is its history; do not invent a parallel "leave request periods" table mirroring W22's `employment_periods`, since that pattern belongs to the employee's own placement/status, not to a separate request entity.

---

## 4. Dependencies

- Phase 2A (W22–W31) must be complete — it is, per `PROJECT_STATUS.md`'s Phase 2A Completion Report.
- W37 (Public Holidays) should land before or alongside W33/W34's day-count logic is finalized, since leave day-counting needs to exclude holidays.
- W39 (Employee Self-Service) depends on W33 (Leave Requests) existing and reuses W23 (Employee Documents) and W14 (Employee–User Linking) — it is a consumer, not a new data owner.
- W35 (Approval) depends on W33 (Requests) and W34 (Balances) both existing, since approval both transitions a request and decrements a balance.

---

## 5. Proposed Workstreams

### W32 — Leave Types & Policies

- **Objective:** Let each organization define its own leave types (annual, sick, maternity, ...) with policy fields.
- **Scope:** CRUD for org-defined leave types with accrual rate, max carryover, paid/unpaid flag, and approval-required flag.
- **Architecture reuse:** Not modeled as a `master_data_items` domain (ADR-010) — those fields don't fit the generic label/code/sortOrder shape — but keeps the same organization-overridable *concept*: a dedicated `leave_types` table, org-scoped, mirroring the archive/reactivate lifecycle W13 gave branches/departments/positions.
- **Permissions:** new `leave_type.read` / `leave_type.manage`.
- **API expectations:** `GET/POST .../organizations/:organizationId/leave-types`, `PATCH/POST .../:id/archive|reactivate`.
- **UI expectations:** Admin console "Leave Types" tab.
- **Database impact:** new `leave_types` table (additive migration).
- **Exclusions:** no payroll/compensation linkage.
- **Acceptance criteria:** an org can define, edit, and archive its own leave types; tenant-isolated; gated by the `leave` module.

### W33 — Leave Requests

- **Objective:** Employees can submit, view, and cancel their own leave requests.
- **Scope:** `leave_requests` (employeeId, leaveTypeId, startDate, endDate, daysRequested, status: pending/approved/rejected/cancelled, reason). This workstream only covers create/list/cancel-while-pending — approval/rejection is W35's job, not duplicated here.
- **Architecture reuse:** mirrors the employee-sub-resource shape of `employee_documents`/`employee_skills` (org-scoped, `employeeId` cascades, dedicated route file); introduces the "own resource" permission shape described in Architecture Principle 5.
- **Permissions:** new `leave_request.read.own` (or the caller's own linked employee) / `leave_request.write.own`; `leave_request.manage` for HR/manager org-wide visibility (reused by W35/W36/W40).
- **API expectations:** `POST/GET .../employees/:employeeId/leave-requests`, `POST .../:id/cancel` (self, pending-only).
- **UI expectations:** new "My Leave" self-service page (request form + own history).
- **Database impact:** new `leave_requests` table.
- **Exclusions:** no approval/rejection logic, no balance deduction (that's W34/W35).
- **Acceptance criteria:** an employee can submit and cancel their own pending requests; cannot see or act on another employee's requests without `leave_request.manage`; gated by the `leave` module.

### W34 — Leave Balance Engine

- **Objective:** Compute and track each employee's available leave balance per leave type.
- **Scope:** `leave_balances` (employeeId, leaveTypeId, period, accruedDays, usedDays, carriedOverDays) + a `LeaveBalanceService` that computes available days and decrements on approval (consumed by W35).
- **Architecture reuse:** ADR-011 Services Layer; balance-changing events audit-logged directly via `recordAuditEvent` (Architecture Principle 6), not through `employment_periods`.
- **Permissions:** `leave_request.read.own` for an employee's own balance; `leave_request.manage` for HR to view/adjust any balance.
- **API expectations:** `GET .../employees/:employeeId/leave-balances`, `POST .../:employeeId/leave-balances/adjust` (HR-only manual correction).
- **UI expectations:** balance display on the "My Leave" page; admin adjustment form.
- **Database impact:** new `leave_balances` table.
- **Exclusions:** no payroll integration, no proration engine beyond simple annual accrual.
- **Acceptance criteria:** balance reflects accrual minus approved usage plus carryover; a manual adjustment is audit-logged; tenant-isolated.

### W35 — Leave Approval Workflow

- **Objective:** A manager/HR user approves or rejects a pending leave request.
- **Scope:** `leave_requests` gains `approvedBy`/`approvedAt`/`rejectionReason`; approving decrements W34's balance and locks the request against further transitions.
- **Architecture reuse:** mirrors W25–W27's single-action-on-record shape (a service function per transition, with a `LeaveRequestNotPendingError` guard mirroring `EmployeeTransferNoChangeError`'s precedent) rather than a generic status-PATCH.
- **Permissions:** new `leave_request.approve` (distinct from `leave_request.write.own` — approving someone else's request is never a self-service action).
- **API expectations:** `POST .../leave-requests/:id/approve`, `POST .../leave-requests/:id/reject`.
- **UI expectations:** HR/manager "Pending Approvals" list with approve/reject actions.
- **Database impact:** additive columns on `leave_requests` (no new table).
- **Exclusions:** no multi-level/sequential approval chains, no delegation.
- **Acceptance criteria:** a pending request transitions exactly once; balance updates atomically with approval; both transitions audit-logged.

### W36 — Leave Calendar

- **Objective:** Visual, org-wide view of approved leave for planning.
- **Scope:** a read-only aggregation endpoint over `leave_requests` filtered to `approved` within a date range, optionally by department/branch.
- **Architecture reuse:** mirrors W17's Reporting Foundation approach — computed in application code from existing tables, no new schema or reporting engine.
- **Permissions:** reuses `leave_request.manage` (org-wide) / `leave_request.read.own` (own-team view, if scoped).
- **API expectations:** `GET .../organizations/:organizationId/leave-calendar?from=&to=`.
- **UI expectations:** Admin console "Leave Calendar" tab (month/week view).
- **Database impact:** none.
- **Exclusions:** no external calendar sync (Google/Outlook), no ICS export.
- **Acceptance criteria:** shows only approved requests, correctly tenant-scoped.

### W37 — Public Holiday Management

- **Objective:** Org-configurable public holidays, excluded from leave day-counting.
- **Scope:** CRUD for dated holiday entries (date, name, recurring flag).
- **Architecture reuse:** dedicated `public_holidays` table (dated entries don't fit `master_data_items`' generic shape, same reasoning as W32); CRUD mirrors W13's branch/department/position completion pattern.
- **Permissions:** new `public_holiday.read` / `public_holiday.manage`.
- **API expectations:** `GET/POST/PATCH/DELETE .../organizations/:organizationId/public-holidays`.
- **UI expectations:** Admin console "Public Holidays" tab.
- **Database impact:** new `public_holidays` table.
- **Exclusions:** no per-branch/regional holiday variation — organization-wide only.
- **Acceptance criteria:** day-count logic in W33/W34 correctly excludes configured holidays; tenant-isolated.

### W38 — Attendance Configuration

- **Objective:** Org-configurable attendance policy settings — configuration only, not capture.
- **Scope:** a new `attendance` namespace in the existing Organization Configuration Engine (work start/end time, grace period, work days).
- **Architecture reuse:** directly reuses W2/ADR-009's engine — no new table, same validated/versioned-row pattern as the existing `general`/`terminology` namespaces.
- **Permissions:** reuses whatever the existing `organization_settings` write path uses (`organization.update` or `module.manage`).
- **API expectations:** extends the existing `GET/PATCH .../organization-settings/:namespace` routes for the new `attendance` namespace.
- **UI expectations:** Admin console "Attendance Settings" tab.
- **Database impact:** none — reuses `organization_settings`.
- **Exclusions:** no clock-in/out capture, no biometric/device integration, no timesheets — actual attendance tracking is future scope, not this workstream.
- **Acceptance criteria:** an org can configure and persist attendance policy fields through the existing config engine; gated by the `attendance` module.

### W39 — Employee Self-Service

- **Objective:** A consolidated self-service surface: own profile, own leave, own documents.
- **Scope:** primarily frontend — a new ESS route aggregating existing self-scoped reads (own employee record via W14's link, W33's own leave requests/balance, W23's own documents). Introduces no new data ownership.
- **Architecture reuse:** first production consumer of `<ModuleGate moduleKey="employee_self_service">` (W6) and `requireModuleEnabled("employee_self_service")` (W5); resolves "which employee is me" via the existing `employee_user_links` table (W14).
- **Permissions:** none new — scoped to the caller's own linked employee record, not role-based.
- **API expectations:** possibly a convenience `GET /me/employee` resolving the caller's linked employee record; otherwise reuses W23/W33's existing endpoints scoped to that ID.
- **UI expectations:** new ESS page/route (My Profile, My Leave, My Documents).
- **Database impact:** none.
- **Exclusions:** no self-service editing of core employee fields (name, position, etc.) — read-only plus own leave requests.
- **Acceptance criteria:** a user with a linked employee record sees only their own data; the route is inaccessible when the org hasn't enabled `employee_self_service`.

### W40 — HR Operations Dashboard

- **Objective:** Real, tenant-scoped Leave/Attendance-configuration metrics on the dashboard.
- **Scope:** extends `GET /dashboard/summary` (W18) with pending-approvals count, upcoming holidays, and leave-utilization figures sourced from W33/W34/W37's real tables.
- **Architecture reuse:** follows W18's explicit precedent — no hardcoded values, only real aggregates.
- **Permissions:** reuses the existing dashboard-summary gating.
- **API expectations:** extends `DashboardSummary`'s response shape.
- **UI expectations:** new dashboard tiles for Leave metrics.
- **Database impact:** none — reads existing tables.
- **Exclusions:** no attendance-capture metrics (W38 is configuration-only; there is no clock-in data yet to aggregate).
- **Acceptance criteria:** dashboard reflects real, tenant-scoped Leave data; no hardcoded constants.

### W41 — Phase 2B Verification

- **Objective:** Repo-wide verification, mirroring W20/W30.
- **Scope:** typecheck, lint, full test suite, migration journal/drift check, OpenAPI generation, generated-client sync, production build. Documentation-only unless a genuine regression is found.
- **Architecture reuse:** exact repeat of W20/W30's process and checklist.
- **Permissions / API / UI:** none — verification only.
- **Database impact:** none — drift check only, no migrations applied.
- **Exclusions:** no new features.
- **Acceptance criteria:** all checks green; if a regression is found, it is fixed and re-verified before this workstream is marked complete.

### W42 — Phase 2B Completion Report

- **Objective:** Formal completion report, mirroring W21/W31.
- **Scope:** update `PROJECT_STATUS.md` with completed scope, architecture/reuse decisions, permissions introduced, API/UI additions, the full migration list (unapplied, pending your approval), final verification totals, and known exclusions.
- **Architecture reuse:** mirrors W31's report structure.
- **Permissions / API / UI / Database impact:** none — documentation only.
- **Exclusions:** no implementation.
- **Acceptance criteria:** report declares zero remaining blockers, or lists them explicitly; recommends the next planning step (Phase 2C or Phase 3, pending your go-ahead).

---

## 6. Definition of Done

Phase 2B is complete only when:

- Every workstream (W32–W42) satisfies its acceptance criteria.
- Documentation matches implementation.
- Repository builds successfully; all tests pass.
- No destructive migration risk remains; every migration generated, none applied without your explicit approval (same rule as Foundation and Phase 2A).
- OpenAPI and generated clients are synchronized.
- Multi-tenant isolation, permission enforcement (including the new "own resource" shape), audit logging, and module gating are verified for every new entity and route.
- The `leave`, `attendance`, and `employee_self_service` modules are live-verified: enabled orgs see the feature, disabled orgs get a 403/redirect, not a partial or broken page.
- Phase 2B Completion Report declares zero remaining blockers.

---

## 7. Verification Requirements

Same checklist as W20/W30/W41, plus module-gating-specific checks unique to this phase:

- Backend and frontend test suites pass in full.
- `pnpm run typecheck` clean across every workspace.
- `pnpm --filter @workspace/hrms run lint` clean.
- `drizzle-kit generate` produces zero unexpected drift; every generated migration has a hand-authored `.down.sql`; none applied without approval.
- `orval codegen` against `openapi.yaml` produces zero diff in the generated clients.
- `pnpm run build` succeeds for every package.
- Enabling/disabling each of the three modules (`leave`, `attendance`, `employee_self_service`) per organization is exercised and confirmed to gate access correctly, both backend (`requireModuleEnabled`) and frontend (`<ModuleGate>`).
- Cross-org isolation confirmed for every new table (`leave_types`, `leave_requests`, `leave_balances`, `public_holidays`).
- "Own resource" permission checks confirmed: a caller cannot read or act on another employee's leave request/balance without `leave_request.manage`/`.approve`.

---

## 8. Out-of-Scope

Deferred to later phases, consistent with `ROADMAP.md`'s Phase 3 list and Future Expansion tier:

- Recruitment, Performance, Learning & Development, Asset Management, Manager Portal — none of these modules are touched in this plan.
- Payroll, compensation, salary, grade/pay bands, benefits — no such concept exists in this schema and none is introduced here.
- Actual attendance capture — clock-in/out, biometric or device integration, timesheets. W38 is configuration only.
- Multi-level/sequential leave approval chains, delegation, or escalation.
- External calendar sync (Google/Outlook) or ICS export for the Leave Calendar.
- Per-branch or regional public holiday variation.
- Self-service editing of core employee fields (name, position, compensation, etc.) beyond submitting/cancelling one's own leave requests.

---

## 9. Implementation Rules

Same rules that governed the Foundation and Phase 2A, unchanged:

1. Read before implementing any workstream: `CLAUDE.md`, `PROJECT_STATUS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`, `MODULES.md`, `CONTRIBUTING.md`, `docs/FOUNDATION_IMPLEMENTATION_PLAN.md`, `docs/PHASE_2A_IMPLEMENTATION_PLAN.md`, this document.
2. Treat the repository implementation as the source of truth.
3. Verify documentation against the current code before making changes.
4. Reuse existing Foundation and Phase 2A architecture wherever possible (see Architecture Principles above).
5. Do not introduce unnecessary frameworks or abstractions.
6. Follow the approved dependency order once this plan is frozen.
7. Complete one workstream at a time.
8. Fully test each completed workstream.
9. Update documentation immediately after completion.
10. Commit before starting the next workstream.
11. Stop after each completed workstream and wait for approval.

---

## 10. Token Preservation Rules

The operating discipline used throughout Phase 2A's execution, codified here for whoever executes Phase 2B:

1. Read only the files a given workstream's task explicitly lists, plus files directly required to implement or test that workstream — do not scan the repository or re-read unrelated documentation.
2. Do not summarize existing architecture back to the user; assume it is already known.
3. Reuse existing services, schemas, permissions, audit patterns, API conventions, UI components, and test harness patterns rather than re-deriving them.
4. Do not perform broad refactoring, cleanup, or repository-wide analysis as a side effect of a single workstream.
5. Implement only the workstream in scope; do not begin the next one in the same pass.
6. Keep reasoning internal; output only what the task's stated output format requires.
7. Stage, commit, and push only the files a given workstream actually touched, plus required documentation updates — never unrelated pre-existing changes.
