# Phase 3B — Attendance Capture Architecture and Implementation Plan

> **⚠️ ENVIRONMENT CLASSIFICATION CORRECTION.** The Supabase project this
> document calls a *development* environment is the actual **Production**
> project, confirmed by the owner in the Supabase dashboard (WS-18 Pass 1B/1C).
> Historical statements below are preserved as written rather than rewritten,
> but every "development" reference to that project means **Production**. This document
> asserts that "No production environment exists or has been touched at any
> point" — **that assertion is false**.
> See [`ENVIRONMENT_CLASSIFICATION.md`](./ENVIRONMENT_CLASSIFICATION.md).


**Status: DRAFT — NOT FROZEN.** This document is a proposal for review, not yet authoritative. Nothing in it may be implemented until it is explicitly approved and its status line is updated to match `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md`'s own "FROZEN ... APPROVED" convention. No source code, schema, or migration has been created by producing it.

Per `ROADMAP.md`'s Phase 3 ("Workforce Operations") list and the frozen Phase 3A plan's own explicit anticipation ("Performance, Learning, Asset Management, and Manager Portal remain out of scope here, to be planned separately as Phase 3B/3C/etc."), this is the **Phase 3B** slice: Attendance Capture, built on top of the Attendance *configuration* layer W38 already shipped (Phase 2B). Workstream numbering continues directly from Phase 3A's own final workstream (W63), starting at **W64** — confirmed against `PROJECT_STATUS.md`, which has no workstream beyond W63 anywhere.

---

## 1. Current Attendance State (as implemented today)

Read directly from `PROJECT_STATUS.md`'s W38 entry and the live source:

- **What W38 implemented:** configuration only. A new `attendance` namespace registered into the existing Organization Configuration Engine (`CONFIG_NAMESPACES` in `artifacts/api-server/src/services/organizationConfig.ts`, ADR-009) — no new table, reuses `organization_settings` (one validated/versioned row per org/namespace, same as `general`/`terminology`).
- **Fields (frozen, unchanged by this plan):** `workStartTime`/`workEndTime` (`"HH:MM"` 24-hour civil-time strings, regex-validated, `workStartTime < workEndTime` enforced on every merged write), `gracePeriodMinutes` (integer, 0–180), `workDays` (array of weekday name enums). Defaults: `09:00`–`17:00`, 0 minutes grace, Monday–Friday.
- **Database schema for attendance capture:** **none exists.** No `attendance_events`, `attendance_daily_summaries`, `attendance_adjustments`, or any biometric/device table exists anywhere in `lib/db/src/schema`. Confirmed by direct search — zero matches for any attendance-capture-shaped table, route, or lib file.
- **API routes:** only the shared, generic `GET/PATCH .../organization-settings/:namespace` route (serves every namespace, not attendance-specific). No dedicated attendance route file exists.
- **Frontend UI:** one page, `/attendance-settings` (`artifacts/hrms/src/pages/attendance-settings.tsx`), a typed settings form. No clock-in widget, register, dashboard, or report page exists anywhere.
- **Permissions:** **none new.** Reuses the existing `organization.read`/`organization.update` pair the generic config route already enforced — W38's frozen instruction was explicitly to reuse rather than invent, and this plan preserves that same posture for the *configuration* surface (see §4).
- **Module gating:** the `attendance` module already exists in the platform Module Registry (seeded, `status: "hidden"`) and gates the config route via a small local `requireNamespaceModuleEnabled` guard (defined inline in `routes/organizationSettings.ts`, not a shared middleware — dedicated Attendance Capture routes in this plan will use the standard shared `requireModuleEnabled("attendance")` instead, the same middleware every other module uses). **Important, directly relevant finding from this session's live QA:** a module's registry `status` must be `"active"` (or `"beta"`) before *any* organization can ever enable it — `"hidden"` blocks enablement outright (`setModuleEnabled` throws `ModuleNotEnableableError`). `attendance` is still `"hidden"` today, exactly like `recruitment`/`employee_self_service` were before this session's live QA found and fixed that same gap for those two. **W64 (below) must apply the identical fix for `attendance`.**
- **Biometric/device remnants:** none. No prior phase reserved any column, table, or interface for biometric integration. This plan is the first to touch that boundary at all (§3.6).
- **Configuration vs. operational:** everything that exists today is configuration (organization-wide rules). Nothing operational (who actually attended, when, whether they were late) exists. This plan's entire scope is the operational half — it does not modify W38's configuration schema or its route, except to reuse two of its existing fields (`workStartTime`/`workEndTime`/`gracePeriodMinutes`/`workDays`) and the platform's existing `general.timezone` field (§3.3) for interpretation.

---

## 2. Objective

Build real Attendance Capture — attendance events, a derived daily/period summary, and a controlled correction/adjustment path — on top of W38's existing configuration, following the same "one shared foundation, configuration before custom code, module before authorization" principles CLAUDE.md establishes for every module in this platform. Suitable for the full range of organization types this platform serves (businesses, churches, NGOs, schools, hospitals, hotels, professional firms, public-sector bodies) without hard-coding Ghana-specific assumptions anywhere configuration already covers the difference.

---

## 3. Architecture

### 3.1 Core principle: configuration answers rules, capture answers events — never mixed

W38's `organization_settings` "attendance" namespace stays exactly as-is and answers *organization-wide rules* (start/end time, grace period, work days). This plan's new tables answer *what actually happened* (who, when, from where, whether corrected). Neither is extended to hold the other's concern — no rule field is added to an event row, and no event data is ever written into `organization_settings`.

### 3.2 Event model — `attendance_events` (append-only, source of truth)

One row per clock action. **Never edited or deleted** — mirrors this codebase's existing immutable-log precedent exactly (`application_stage_history`, `requisition_approvals`, `candidate_consents`, `leave_balance_entries`). A correction never rewrites a raw event; it is recorded separately (§3.4) and the *read-model* (§3.3) accounts for it.

Key columns (illustrative, not final — frozen at W64):
- `organizationId`, `employeeId`
- `eventType`: `clock_in` | `clock_out`
- `occurredAt`: `timestamptz` — the actual instant, always server-authoritative (§3.5)
- `source`: `self_service` | `hr_manual` | `biometric` | `import` — `biometric` is a **reserved, schema-valid value from day one** (§3.6); no biometric writer exists yet
- `recordedByMembershipId` (nullable — null for a genuine self-service punch, set for an HR-entered event)
- `branchId` (nullable — only meaningful for a multi-branch org)
- `deviceReference` (nullable text — reserved for a future biometric device identifier; unused until a device integration exists)
- `notes` (nullable)

No unique constraint forcing exactly one clock-in/clock-out pair per day — a genuine multi-segment day (e.g., a lunch-break out/in) is a valid sequence of events, not an error. The **daily summary** (§3.3) is what decides how those events are interpreted, not the table's own constraints. See Open Decision 1 (§8) for how far that interpretation goes in W64's first cut.

### 3.3 Summary model — a computed read-model, not a stored table

Per this platform's own established discipline (leave balances are *always* reconstructed from the `leave_balance_entries` ledger, never stored as a "current balance" column; W40's dashboard metrics and every Recruitment reporting figure from W61 are computed live, never cached) — **"Daily Attendance Summary" is a read-model function, not a physical `attendance_daily_summaries` table.** Storing it would create exactly the "second source of truth" CLAUDE.md's Database Rules and this plan's own instructions warn against: a late-arriving correction or a late-arriving biometric event would otherwise require an explicit cache-invalidation step; a pure read-model has none, by construction — the next read simply reflects the current truth.

`getAttendanceDailySummary(organizationId, employeeId, date)` computes, per calendar date:
- `firstClockIn` / `lastClockOut` (from `attendance_events`, civil-date-scoped per §3.5)
- `workedMinutes` (derived from the pair above; W64's first cut, per Open Decision 1)
- `lateMinutes` (only when a work day and `firstClockIn` is later than `workStartTime + gracePeriodMinutes`)
- `earlyDepartureMinutes` (only when a work day and `lastClockOut` is earlier than `workEndTime`)
- `status`: **computed**, one of `present | late | partial | absent | on_leave | holiday | non_working_day` — resolved in a fixed precedence order (date-level exclusions first, then person-level, then event-derived):
  1. `holiday` — the date matches a `public_holidays` occurrence (reused, W37's existing `listHolidayOccurrencesInRange` — **no second holiday model created**)
  2. `non_working_day` — the date's weekday is not in the org's configured `workDays` (W38, reused unchanged)
  3. `on_leave` — an **approved** `leave_requests` row spans this date for this employee (reused, same `startDate <= date && endDate >= date` pattern `leaveDashboardMetrics.ts`/`leaveCalendar.ts` already established — **no duplication of Leave's own business logic**, this only reads the existing table)
  4. Otherwise, derived from `attendance_events` (+ any `attendance_adjustments`, which take precedence over raw-event derivation when present): `present`, `late`, `partial`, or `absent` (no events at all, on an otherwise-eligible work day, for an eligible employee — §3.7)

Status is never persisted anywhere. Any register, dashboard, or report reads through this same function (or a batched equivalent), so there is exactly one place attendance status logic lives.

### 3.4 Correction model — `attendance_adjustments` (append-only, immutable once decided)

A single table serves both scope items 4 ("HR Manual Attendance Entry") and 5 ("Attendance Adjustments") from the brief, avoiding two competing correction mechanisms:

- `organizationId`, `employeeId`, `date` (the civil date being corrected)
- `adjustmentType`: e.g. `manual_clock_in` | `manual_clock_out` | `mark_present` | `mark_absent` | `excuse_absence` (kept minimal; exact enum frozen at W64)
- `correctedClockIn` / `correctedClockOut` (nullable `timestamptz`, as applicable to the type)
- `reason` (required, text — never optional, per the brief's explicit "reason required")
- `status`: `pending | approved | rejected` — mirrors `leave_requests`' own exact status shape
- `requestedByMembershipId`
- `decidedByMembershipId` / `decidedAt` (nullable until decided)
- `createdAt`

**An HR-privileged direct entry** (the person making it already holds `attendance.manage`) is auto-decided in the same transaction it's created — `status: "approved"`, `decidedByMembershipId = requestedByMembershipId`, immediately. **An employee-initiated correction request** (§3.4, W67) is created `pending` and requires a holder of `attendance.adjustment.approve` to decide it — mirroring Leave's own request→approve precedent (W33/W35) exactly, rather than inventing a new pattern.

Original raw events are **never** rewritten by an adjustment — both remain visible in history, matching this codebase's "a decision, once recorded, is corrected by a new compensating row, never an edit in place" discipline (`ADR-013`-style, restated in the Phase 3A plan's own §9 note on immutable tables).

### 3.5 Time model

- Every event's `occurredAt` is a real `timestamptz` instant, stored exactly as received server-side (the server clock, or an explicitly-supplied instant for `hr_manual`/`import` sources — never trusted blindly from an untrusted client for `self_service`, see §3.7).
- **Civil-date derivation** (which calendar day an event belongs to, for grouping into a daily summary) happens **server-side only**, converting the UTC instant into the organization's configured timezone before taking the date part — never a browser-local calculation. This reuses the **existing** `general.timezone` config field (`organizationConfig.ts`'s `general` namespace, already shipped, currently optional with no default) rather than adding a second, attendance-specific timezone field. See Open Decision 2 (§8) — this field is not currently required to be set.
- Civil work-time fields (`workStartTime`/`workEndTime`/`gracePeriodMinutes`) remain exactly as W38 defined them — `HH:MM` strings with no attached zone, interpreted against the organization's timezone at read time, never converted or stored as instants.
- **Cross-midnight / overnight shifts are explicitly out of scope for W64–W70**, exactly as W38 already excluded them for configuration. A clock-out event is always paired with clock-in events sharing its own civil date. Night-shift/rostered-shift support is a later, separately-scoped extension (matches the brief's own "shift-based work later if needed" framing).
- DST is not a manual concern: real IANA-timezone conversion (via Postgres `AT TIME ZONE` or an equivalent library-level conversion, never hand-rolled fixed-offset arithmetic) is inherently DST-correct. This is a mandate on *how* the conversion is implemented, not a new mechanism.

### 3.6 Biometric integration boundary (interface only, no implementation)

Exactly two reserved points, nothing more: `attendance_events.source` includes `"biometric"` as a schema-valid enum value (mirrors `offer_versions.status` including `accepted`/`declined` as reserved-but-currently-unreachable values, an established precedent in this codebase for "the shape exists, no route reaches it yet"), and `attendance_events.deviceReference` (nullable text). No device protocol, vendor SDK, polling job, or webhook route is built in this plan. A future phase can add e.g. `POST .../attendance-events/import` writing into this same table with `source: "biometric"` — zero schema change required when that day comes.

### 3.7 Employee-status interaction

| Employee state | Attendance capture eligibility | Summary behavior |
|---|---|---|
| `active` (or `probation`) | Eligible — can self-clock, generates a real summary | Normal `present/late/partial/absent` derivation |
| `on_leave`, `suspended` (employmentStatus) | **Not eligible to self-clock** (rejected, mirrors W60's own "narrowest literal reading" precedent for ESS eligibility — no frozen rule distinguishes these sub-states further) | No `absent` ever generated for these days |
| `terminated` / past `separationDate` | Not eligible | No summary generated after separation |
| Future `hireDate` (not yet started) | Not eligible | No summary generated before hire date |
| Approved leave for the date (`leave_requests`) | N/A — status resolves to `on_leave` regardless of clocking | Never `absent` |
| Holiday / non-working day for the date | N/A — status resolves to `holiday`/`non_working_day` | Never `absent` |

An employee who is eligible, on a work day, with no exclusion, and **no attendance events at all** for that date is the only case that ever produces `absent` — never fabricated for an ineligible or excluded day.

### 3.8 Concurrency / integrity

- **Duplicate clock-in / multiple sessions per day:** not blocked at the database level — a genuine multi-segment day (break out/in) is valid. W64's summary only uses the day's *first* clock-in and *last* clock-out (Open Decision 1); accidental rapid double-taps are a client UX concern, not a server integrity concern requiring a hard reject.
- **Late-arriving events (any source, including a future biometric feed) and correction races:** because the summary is a live read-model (§3.3), not a cache, there is no invalidation problem to solve — the very next read reflects whatever rows currently exist. This is the direct payoff of not storing a derived summary.
- **Multiple devices:** naturally supported — every device/source simply appends its own events; the read-model doesn't care which source produced which row when computing first/last for a day.

---

## 4. Permission Matrix

Mirrors Leave's own exact four-key shape (`read.own`/`write.own`/`manage`/`approve`) as closely as possible, per "reuse existing permissions where semantically correct, do not create unnecessary permission keys." **Team-level (manager) visibility is resolved in the service layer via `reportingManagerId`, the same way `leaveCalendar.ts`'s `visibleEmployeeIds` already does — it does not get its own permission key**, exactly matching Leave's own precedent (no `leave_request.read.team` key exists either).

| Area | Permission key | Own | Manager (via reportingManagerId, service-layer tier) | Org-wide (HR) |
|---|---|---|---|---|
| Read attendance / summary | `attendance.read.own` | ✔ | ✔ (their direct reports) | — (org-wide read is implied by holding `attendance.manage`, same as Leave) |
| Self clock-in/out | `attendance.clock.own` | ✔ | — | — |
| Manual entry, register, org-wide read/write | `attendance.manage` | — | — | ✔ |
| Decide a pending correction request | `attendance.adjustment.approve` | — | — | ✔ |
| Attendance configuration (W38, unchanged) | `organization.update` (existing, reused) | — | — | ✔ |

Four new keys total: `attendance.read.own`, `attendance.clock.own`, `attendance.manage`, `attendance.adjustment.approve`. Seeded broadly (`org_admin`/`hr_manager`/`employee`) for the two `.own` keys (every employee needs to read and clock their own attendance, and could be someone's manager — same broad-read-tier rollout this platform has used for every comparable "own + service-layer-narrowed" permission since Leave); `attendance.manage`/`attendance.adjustment.approve` seeded `org_admin`/`hr_manager` only, same admin-only rollout every other org-wide write/approval permission in this platform uses.

---

## 5. Module Gating Strategy

- `attendance` already exists in the Module Registry; **W64 must flip its registry `status` from `"hidden"` to `"active"`** (identical fix, identical file — `module-definitions.ts` — to what this session's Phase 3A live QA already did for `recruitment`/`employee_self_service`; the same one-time live-data-correction step will be needed on any database seeded before that edit, per that fix's own documented limitation).
- Every new Attendance Capture backend route composes the standard shared `requireModuleEnabled("attendance")`, identical to every other module (not the config-route-specific `requireNamespaceModuleEnabled` local guard, which stays scoped to the generic namespace route it already serves).
- Every new frontend route wraps in `<ModuleGate moduleKey="attendance">`, identical to every other module's pages.
- ESS's new "My Attendance" tab (W68) checks `attendance` module accessibility **independently within the ESS page** (gated only by `employee_self_service` itself) — the exact same independent-degradation pattern W39's My Leave tab and W60's Internal Vacancies/My Applications tabs already established (`isModuleAccessible(modules, 'attendance')`), degrading to a controlled message, never a broken page, when `attendance` is disabled.
- Module gating is never a substitute for the permission checks in §4 — every route composes both, exactly like every route in this platform already does (verified as a hard requirement during this session's own W62 Phase 3A verification).

---

## 6. Database Table Plan

| Table | Purpose | Immutability | Migration workstream |
|---|---|---|---|
| `attendance_events` | Append-only raw clock events | Never edited/deleted | W64 |
| `attendance_adjustments` | Correction requests + HR direct entries, with decision history | Immutable once decided | W64 |

**No `attendance_daily_summaries` table** (§3.3 — a computed read-model, not stored). **No new table for the config namespace** (W38's `organization_settings` row is untouched). Total new tables: **2**, both purely additive, both org-scoped with the standard `serial` PK / `createdAt` conventions and hand-authored `.down.sql` this platform's every migration already follows. Exact columns, indexes, and enums are frozen at W64's own start, not finalized in this draft.

---

## 7. Reporting & Dashboard Plan

Reuses the Reporting Foundation (W17/ADR-016) exactly as W61 did for Recruitment: candidate report keys registered in the existing shared `reports` registry (`category: "attendance"`), executed via a dedicated, visibility-scoped `.../attendance/reports/:reportKey` route (not the generic `/reports/:key/run`, for the identical reason Recruitment's reports needed their own route — organization-wide vs. own/team visibility tiers the generic runner can't express). **No new reporting engine.**

Candidate initial report keys (non-binding — the exact frozen list is this plan's W70's own decision to make, per the same "frozen scope wins over speculative prose" discipline W61 itself used): daily register, monthly summary, late-arrivals breakdown, absenteeism breakdown.

A dedicated `/attendance/dashboard` + `/attendance-reports` frontend surface is recommended (mirrors W61's own precedent, given Attendance Capture's comparable scope to Recruitment) rather than folding into the existing `GET /dashboard/summary` widget-style extension W40 used for Leave's smaller footprint — see Open Decision 4 (§8).

---

## 8. Audit Plan

Reuses `recordAuditEvent`/`audit_events` directly (never a new audit mechanism), following this platform's existing "audit the exceptional/sensitive action, let the routine append-only log self-document" split: `attendance_event.recorded` (HR-manual entries only — a raw self-service clock event is already self-documenting via its own row, the same reasoning `application_stage_history` isn't separately duplicated into `audit_events`), `attendance_adjustment.requested` / `.approved` / `.rejected`, and the W64 module-activation flip itself.

---

## 9. Explicit Exclusions (this phase does not build)

Payroll attendance calculations, overtime pay, shift scheduling/rostering, biometric vendor/hardware integration, facial recognition, GPS/geofencing, a mobile app, offline sync, advanced timesheets, project time tracking, payroll deductions, or performance-penalty logic. None of these are assigned to this phase by the existing architecture or roadmap; each remains a candidate for a later, separately-scoped phase.

---

## 10. Ordered Workstream Plan (W64 onward)

### W64 — Attendance Foundation & Module Activation
- **Objective:** Establish the schema, permissions, and module-activation fix nothing else can be built without.
- **Dependencies:** none beyond the existing platform (reuses W2/ADR-009 config engine, W5/W6 module system unchanged).
- **Scope:** `attendance_events`, `attendance_adjustments` tables; flip `attendance` registry status hidden→active (module-definitions.ts, plus the same one-time live-data correction this session's Recruitment QA already established as necessary); `lib/attendanceAuthorization.ts` (mirrors `recruitmentAuthorization.ts`'s shape — own-employee resolution reuse, org-wide-via-permission, manager-tier-via-reportingManagerId, no business-table queries).
- **Database impact:** two new tables, purely additive.
- **Backend/API impact:** none yet beyond the module-status fix (mirrors W43's "authorization foundation only" precedent).
- **Permissions:** `attendance.read.own`, `attendance.clock.own`, `attendance.manage`, `attendance.adjustment.approve` seeded.
- **Module gating:** `attendance` flipped active; no route changes yet.
- **Frontend impact:** none yet.
- **Audit:** none yet.
- **Testing:** authorization-primitive unit tests (mirrors `recruitmentAuthorization.test.ts`); module-status-flip verified live against the dev database, same method as this session's Recruitment fix.
- **Explicit exclusions:** no capture route, no self-service clocking yet.
- **Definition of done:** schema migrated (generated, unapplied pending approval), permissions seeded, module enable-able, foundation tests green.

### W65 — Attendance Event Capture (Self-Service Clocking + HR Manual Entry)
- **Objective:** The first real capture paths — an employee clocking themselves, and HR entering/correcting on their behalf.
- **Dependencies:** W64.
- **Scope:** `POST .../attendance-events` (self clock-in/out — server derives `employeeId` via the existing `resolveOwnEmployeeId` chain, never a client-supplied ID, mirroring every ESS precedent this platform has); HR direct-entry path via `attendance_adjustments` with immediate auto-approval (§3.4); `GET .../attendance-events` (own, or org-wide/team per §4).
- **Database impact:** none (reuses W64's tables).
- **Backend/API impact:** `POST/GET .../organizations/:id/attendance-events`, `POST .../organizations/:id/attendance-adjustments` (HR direct-entry variant only — the employee-request variant is W67).
- **Permissions:** `attendance.clock.own`, `attendance.read.own`, `attendance.manage`.
- **Module gating:** `requireModuleEnabled("attendance")` on every route.
- **Frontend impact:** none yet (ESS clocking UI is W68; this workstream is API-only, verified via tests).
- **Audit:** `attendance_event.recorded` (HR-manual only, per §8).
- **Testing:** module/permission gating; server-derived identity (no client employeeId trust); HR direct-entry immediate-approval path; tenant isolation.
- **Explicit exclusions:** no daily summary computation yet (W66), no employee-initiated correction *requests* yet (W67), no frontend yet.
- **Definition of done:** events genuinely recordable and readable through the real API against a real database.

### W66 — Daily Summary Read-Model & Leave/Holiday Integration
- **Objective:** Turn raw events into the actual "who attended, were they late, were they absent" answer, live-computed.
- **Dependencies:** W65 (events to compute from), existing Leave (W33+) and Public Holidays (W37) tables (read-only reuse).
- **Scope:** `lib/attendanceDailySummary.ts` (§3.3's precedence-ordered status resolution); employee-status eligibility rules (§3.7); `GET .../employees/:id/attendance/summary` (single date) and a date-range variant.
- **Database impact:** none (pure read-model).
- **Backend/API impact:** the two GET routes above.
- **Permissions:** `attendance.read.own` (own/team tier), `attendance.manage` (org-wide tier).
- **Module gating:** unchanged, same as W65.
- **Frontend impact:** none yet.
- **Audit:** none (a read path).
- **Testing:** every status-precedence case (holiday beats leave beats events; ineligible employee never gets `absent`; late/grace-period boundary math; timezone-correct civil-date derivation — exercised with a non-UTC organization timezone specifically, not just UTC).
- **Explicit exclusions:** no register/dashboard UI yet (later workstreams), no multi-segment net-duration math beyond first-in/last-out (Open Decision 1).
- **Definition of done:** summary output verified correct against every documented status/eligibility rule in §3.3/§3.7.

### W67 — Attendance Adjustments: Employee-Initiated Requests + Approval
- **Objective:** The second half of the correction model — an employee asking for a fix, someone else deciding it.
- **Dependencies:** W64 (table), W65 (HR direct-entry precedent already established on the same table).
- **Scope:** `POST .../attendance-adjustments` (employee-initiated, `status: "pending"`); `POST .../attendance-adjustments/:id/approve` / `.../reject` (mirrors `leave_requests`' single-level approve/reject shape, W35).
- **Database impact:** none (reuses W64's table).
- **Backend/API impact:** the three routes above.
- **Permissions:** `attendance.read.own` (submit own request — reused, no new "write" key needed since a request just targets the existing table), `attendance.adjustment.approve` (decide).
- **Module gating:** unchanged.
- **Frontend impact:** none yet (ESS submission UI is W68).
- **Audit:** `attendance_adjustment.requested` / `.approved` / `.rejected`.
- **Testing:** pending→approved/rejected transitions; permission gating; a request never auto-approves itself (only the HR-direct-entry path from W65 auto-approves); tenant isolation.
- **Explicit exclusions:** no delegated/manager-tier approval (Open Decision 3 — org-wide only for this workstream).
- **Definition of done:** full request→decide cycle works, correctly distinct from W65's immediate HR-entry path.

### W68 — Employee Self-Service Attendance (ESS Integration)
- **Objective:** Surface clocking and an employee's own attendance inside the existing ESS page.
- **Dependencies:** W65 (clocking), W66 (summary), W67 (correction requests).
- **Scope:** new "My Attendance" tab on the existing `/self-service` page — clock-in/out widget, own recent summary/history, a "request a correction" form. Independent module-degradation, same pattern as My Leave (W39) and Internal Vacancies (W60).
- **Database impact:** none.
- **Backend/API impact:** none new (reuses W65/W66/W67's routes).
- **Permissions:** none new (reuses `attendance.clock.own`/`.read.own`).
- **Module gating:** `attendance` checked independently within the ESS page; `employee_self_service` remains the page's own outer gate, unchanged.
- **Frontend impact:** the tab itself.
- **Audit:** none new (the underlying routes already audit where applicable).
- **Testing:** disabled-module degrade; clock-in/out flow; own-history rendering; correction-request submission; no recruitment-module-style cross-contamination with other ESS tabs.
- **Explicit exclusions:** no manager-facing "my team's attendance" view here (that's the Register, W69).
- **Definition of done:** an employee can clock in/out and see their own attendance entirely through ESS.

### W69 — Attendance Register (Internal HR/Manager View)
- **Objective:** The internal, filterable list view HR and managers actually work from day to day.
- **Dependencies:** W66 (summary read-model).
- **Scope:** `/attendance-register` page + `GET .../organizations/:id/attendance` (paginated, daily or monthly view, filters: branch/department/employee/status), built on the W66 read-model, not a raw table scan.
- **Database impact:** none.
- **Backend/API impact:** the one list route above.
- **Permissions:** `attendance.read.own` (own/team-scoped register), `attendance.manage` (org-wide register + inline manual-entry action reusing W65).
- **Module gating:** standard.
- **Frontend impact:** the register page, nav entry (HR-capable-role-gated, same precedent as every other Recruitment/Leave nav entry this platform uses).
- **Audit:** none new.
- **Testing:** filter correctness; own/team/org-wide visibility tiers; pagination; performance-shape sanity at this codebase's established "scoped WHERE, reduce in application code" scale (see Open Decision 5's performance note).
- **Explicit exclusions:** no dashboard/report aggregation yet (W70).
- **Definition of done:** HR can see and filter a real attendance register end to end.

### W70 — Attendance Dashboard & Reporting
- **Objective:** Aggregate visibility and exportable reports, mirroring Recruitment's own W61 precedent.
- **Dependencies:** W66 (summary), W69 (register, for a consistent visual/data pattern).
- **Scope:** dedicated `/attendance/dashboard` (present/absent/late/on-leave/holiday tile breakdown for "today" or a selected date) + `/attendance-reports` (report catalog, reusing W17's registry, CSV export via the existing `?format=csv` convention); the exact frozen report-key list is decided at this workstream's own start (§7's candidates are non-binding).
- **Database impact:** none (fully live-computed, same discipline as W61).
- **Backend/API impact:** `GET .../attendance/dashboard`, `GET .../attendance/reports/:reportKey`.
- **Permissions:** reuses `attendance.read.own`/`attendance.manage` (no new reporting-specific key — see whether Recruitment's own `recruitment.reports.read` precedent is actually needed here or whether `attendance.manage`/`.read.own` already covers it cleanly; decided at this workstream's own start).
- **Module gating:** standard.
- **Frontend impact:** the two new pages, nav entries.
- **Audit:** none new.
- **Testing:** every report's null-vs-zero semantics (an uncomputable average is null, never zero — same discipline as W61); assigned/org-wide visibility; CSV export authorization.
- **Explicit exclusions:** no new charting library unless a report genuinely requires one and none already exists in this codebase.
- **Definition of done:** dashboard and every frozen report verified correct against real data.

### W71 — Phase 3B Verification
- **Objective:** Repo-wide verification, mirroring W20/W30/W41/W62.
- **Dependencies:** W64–W70.
- **Scope:** typecheck, lint, full test suite, migration journal/drift check, OpenAPI generation, generated-client sync (zero-diff twice), production build, module-gating/tenant-isolation/own-resource-authorization verification for every new table and route.
- **Database/API/Frontend impact:** none — verification only.
- **Testing:** any regression found is fixed and re-verified before this workstream is considered complete.

### W72 — Phase 3B Completion Report
- **Objective:** Formal completion report, mirroring W21/W31/W42/W63.
- **Dependencies:** W71.
- **Scope:** update `PROJECT_STATUS.md` with completed scope, the full migration list (unapplied, pending approval), permissions introduced, API/UI additions, final verification totals, and known exclusions.
- **Database/API/UI impact:** none — documentation only.

---

## 11. Open Decisions

Kept to the minimum genuinely needing product input, each with a recommended default so none of them need to block starting W64.

1. **Multiple clock-in/out segments per day** (e.g., a lunch-break out/in) — the event model supports this regardless; does the *daily summary* need true multi-segment net-duration math, or is first-clock-in/last-clock-out sufficient? **Recommended default:** first-in/last-out for W64–W70; revisit only if a real organization's operational pattern needs it. **Blocks implementation:** no — the schema supports either without change.
2. **Organization timezone requirement** — `general.timezone` already exists but is optional with no default. Should enabling Attendance *require* it to be set (a clear error until configured), or silently fall back to UTC? **Recommended default:** require it explicitly — a silent UTC fallback risks systematically wrong "late" calculations for any Ghana-based (or other non-UTC) organization that never noticed the missing field. **Blocks implementation:** affects W66's correctness, not W64's; should be settled before W66 starts.
3. **Correction-request approval authority** — org-wide only (`attendance.adjustment.approve`, admin-only), or should a requester's own manager be able to decide it too? **Recommended default:** org-wide only for W67, matching most existing approval precedents in this platform; a manager-tier extension is a small, separately-scoped follow-up if ever requested. **Blocks implementation:** no.
4. **Dashboard/reporting shape** — a dedicated `/attendance/dashboard` + `/attendance-reports` (Recruitment/W61-style), or folded into the existing `GET /dashboard/summary` widget (Leave/W40-style)? **Recommended default:** dedicated route, given Attendance's comparable operational scope to Recruitment. **Blocks implementation:** no — only shapes W70.
5. **Biometric device protocol/format** — completely undefined. **Recommended default:** stay boundary-only (§3.6) until a specific device/vendor requirement exists; do not speculate further now. **Blocks implementation:** no.

---

## 12. Production / Localhost Status

The application currently runs **localhost-only** (frontend on `:5173`, API on `:3001`). The development Supabase project (`vkvirwdxoiwsiftaarox`) is migrated through `0034` and seeded; Phase 3A's live QA against that database is complete, including four real defects found and fixed during that QA (roles-seed conflict target, module-registry status, a no-op-PATCH crash, and a shared error-classification bug affecting 12 files) — all committed and pushed to `origin/main`, all re-verified live post-fix. **No production environment exists or has been touched at any point.** Attendance Capture development, when approved, will proceed against this same development environment, following the identical rollout discipline (migrate → verify → seed → live QA) this session already exercised for Phase 3A.

---

## 13. Token Preservation Rules (carried forward)

Same operating discipline as `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` §26: read only what a given workstream's task lists plus what's directly required to implement/test it; do not re-summarize existing architecture; reuse existing services/schemas/permissions/audit patterns/API conventions/UI components/test harnesses; no broad refactoring as a side effect; implement one workstream per pass; stage/commit/push only what that workstream actually touched.
