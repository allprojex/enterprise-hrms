# Phase 3G — Manager Portal Implementation Plan

**Status: FROZEN — APPROVED FOR IMPLEMENTATION**
**Freeze date: 2026-08-22**

This document was produced in two passes: a repository-grounded discovery pass (2026-08-21/22, preserved below in the Discovery Findings sections), followed by this Owner review and freeze pass, which resolves every Owner Decision the discovery pass raised. **Zero Owner Decisions remain unresolved.** Every decision below carries an explicit disposition: **APPROVED**, **APPROVED WITH REFINEMENT**, **REJECTED**, or **SUPERSEDED BY OWNER DIRECTION**.

Naming continues the established `docs/PHASE_3[A-F]_*_IMPLEMENTATION_PLAN.md` convention as **Phase 3G**, the final item of `ROADMAP.md`'s Phase 3 ("Workforce Operations": Recruitment → Attendance → Leave → Performance → Learning → Assets → Employee Self Service → **Manager Portal**). Workstream numbering continues from W108 as **W109–W113**.

**This document authorizes implementation starting with W109, under a separate explicit go-ahead. No code has been written as part of producing or freezing this document.**

---

## 1. Roadmap Basis (Discovery Finding, unchanged since draft)

`ROADMAP.md`'s Phase 3 list ends with the single bare bullet `- Manager Portal` — no elaboration exists anywhere else in the repository. This plan's scope is derived entirely from discovery of existing repository capability, reconciled against the Owner directions below.

## 2. The Pre-Existing `manager_portal` Module Registry Row (Discovery Finding, re-confirmed live during freeze)

`lib/db/src/seed/module-definitions.ts:125-135`:
```
{
  key: "manager_portal",
  name: "Manager Portal",
  description: "Manager-facing views and approvals for their reports.",
  category: "hr-operations",
  version: "1.0.0",
  status: "hidden",
  defaultEnabled: false,
  requiredModuleKeys: [],
  optionalModuleKeys: [],
}
```
**Frozen (§17 of the Owner directions):** W109 activates this existing row (`status: "hidden" → "active"`), matching every prior module's own precedent. **No new module key is created. The key is not renamed.** `defaultEnabled` remains `false`. No organization is auto-enabled by W109 or any subsequent workstream — enabling `manager_portal` for a specific organization remains a separate, explicit administrative action, exactly like every other module.

## 3. Full Existing Manager Capability Matrix (Discovery Finding, unchanged)

| | Attendance | Leave | Performance | Learning | Assets |
|---|---|---|---|---|---|
| Manager page | `attendance-register.tsx` + `attendance-dashboard.tsx` | `leave-approvals.tsx` | `performance-team.tsx` | `learning-team-training.tsx` | `team-assets.tsx` |
| Nav gating (re-confirmed live, `app-shell.tsx`) | `isHrCapable`-only | **Unconditional** (line 315 — the one exception) | `isHrCapable`-only | `isHrCapable`-only | `isHrCapable`-only |
| Coarse permission | `attendance.read.own` | `leave_request.approve` | `performance.review.write` | `learning.review.write` | `asset_management.read.own` |
| Held by `employee` role by default? | Yes | Yes | Yes | Yes | Yes |
| Manager-scope mechanism | **Live** `reportingManagerId` | **Live** `reportingManagerId` | **Snapshot** `reviewerEmployeeId` | **Snapshot** `managerEmployeeIdSnapshot` + separate **live** instructor tier | **Live** `reportingManagerId` |
| Manager mutate ability | None (read-only) | Approve/reject | Rate/goals/submit | Approve/reject/assign (+ instructor mark-attendance/complete) | None (read-only) |

Zero recursive hierarchy exists anywhere (re-confirmed: no `WITH RECURSIVE` or multi-hop query in the repository).

**Frontend nav re-confirmed during freeze:** `app-shell.tsx`'s nav-item array applies **no client-side module-enabled filtering at all** — visibility is governed purely by `isHrCapable`/`isOrgAdmin` role flags (or, for Leave Approvals alone, nothing — unconditional). Module-enabled/disabled is enforced **only** server-side (routes 404/403 when disabled). This is the established, existing pattern this plan's own nav decision (§25 below) must match, not a gap to fix.

## 4. Manager-of-Record Model, Live vs. Snapshot Authority, Permission Registry (Discovery Findings, unchanged since draft)

`employees.reportingManagerId` — nullable, self-referencing, `onDelete: set null`, mutated only via the generic `PATCH .../employees/:employeeId`, with **zero audit trail**. See §22/§23 for how this plan treats that fact.

Attendance/Leave/Assets resolve manager authority **live**; Performance/Learning use a **snapshot** captured once at workflow-creation time; Learning additionally has a wholly separate **live** instructor-of-record tier. This distinction is architecturally load-bearing and is frozen as permanent in §20 below.

No `manager.*`/`manager_portal.*`/`.team` permission key exists anywhere; no formal "manager" role exists (exactly 3 seeded roles: `org_admin`, `hr_manager`, `employee`, confirmed live via `lib/db/src/seed/seed-roles-permissions.ts:14,18,20`). Frozen in §37.

## 5. Precise Read-Path Definitions Re-Confirmed Live During Freeze

These were re-verified directly against the current code during this freeze pass — not merely carried over from the discovery summary — because §30–§34 of the Owner directions require each dashboard/pending-action tile to have a precise, frozen definition.

- **Attendance** (`lib/attendanceDailySummary.ts:86`): `AttendanceSummaryStatus = "present" | "late" | "partial" | "absent" | "on_leave" | "holiday" | "non_working_day"`, plus a `null` ("not applicable") bucket. `resolveOrganizationTodayCivilDate` (`lib/attendanceReporting.ts:120`) resolves the organization's own current civil date.
- **Leave** (`lib/leaveApprovals.ts:38-48`): `listPendingApprovals` — requests with `status = "pending"`, org-wide for HR (`leave_request.manage`) or direct-reports-only otherwise, via a live `reportingManagerId` comparison. Doc comment confirms: "No new manager model: reuses `employees.reportingManagerId` exactly as W33's GET route does."
- **Performance** (`lib/performanceManagerReview.ts:129-156`): `listTeamReviews` returns reviews where `reviewerEmployeeId` (snapshot) equals the caller. The actionable stage is exactly `status === "manager_review"` — `rateCompetencyAsManager`/`submitManagerReview` both throw outside that status.
- **Learning** (`lib/learningEnrollments.ts:542-652`): `listTeamEnrollments` returns enrollments where `managerEmployeeIdSnapshot` (snapshot) equals the caller. The actionable state is exactly `approvalStatus === "pending"` — `decideEnrollmentApproval` is an atomic conditional update `WHERE approvalStatus = 'pending'`. Instructor-of-record (`isCallerInstructorOfRecord`, line 867) is a wholly separate, live relationship keyed off a session's own `instructorEmployeeId`, never `managerEmployeeIdSnapshot`.
- **Assets** (`lib/assetReporting.ts:115,331`): current custody = `assetAssignmentsTable` rows with `custodyEndedAt IS NULL`, scoped to the caller's live direct-report set (`resolveAssetReportScope`).
- **Team Overview photo field**: `SelfServiceEmployeeProfile.hasProfilePicture` (`lib/employeeSelfService.ts:33,103`) is already computed as `employee.profilePictureKey != null` — a boolean, no additional lookup, no widened authorization. This is the exact precedent Team Overview's own `hasProfilePicture` field reuses (§27).
- **Route availability**: `App.tsx`'s route table (lines 98-280) has no `/manager` route today — confirmed no naming conflict.

---

## 6. Owner Decisions — Resolved

Every decision is dispositioned. Evidence for each was gathered during discovery and, where the freeze session required a sharper factual answer, re-confirmed live in §5 above.

### Decision 1 — Portal Architecture
**APPROVED: Hybrid.** One consolidated manager landing page — Team Overview, dashboard/summary, Pending Actions, module-aware navigation/deep-links. **No duplicate cross-module business-rules engine.** Frozen as a load-bearing architectural invariant (§19).

### Decision 2 — Manager Eligibility
**APPROVED: live manager-of-record relationship only.** A user is a manager for Manager Portal purposes when their employee record is currently referenced as `reportingManagerId` by ≥1 current employee in the same organization. No formal manager role. No inference from unrelated permissions. No `manager.*` permission namespace. HR/admin access is a separate, additional path (Decision 4).

### Decision 3 — Direct Reports Only
**APPROVED.** V1 is direct-reports-only: no recursive hierarchy, no indirect reports, no reporting-tree traversal, no dotted-line/secondary management. Matches existing repository reality exactly (§3 — zero recursive query exists anywhere).

### Decision 4 — HR/Admin Access
**APPROVED WITH REFINEMENT.** `hr_manager`, `org_admin`, and `super_admin` may open the Manager Portal for operational visibility. This does **not** grant manager-of-record/reviewer/instructor/hiring-manager relationship authority merely through portal access. The portal must distinguish (A) manager-relationship-derived information/actions from (B) organization-wide HR/admin information the underlying module *already* authorizes independently of the portal. Where a module gives HR/admin org-wide authority already (e.g. Leave's `leave_request.manage`), the portal may surface it. Where an action specifically requires a relationship the caller doesn't hold (e.g. HR viewing a review where they are not the snapshotted `reviewerEmployeeId`), the portal grants nothing new — see Decision 27 for the concrete resolution on Team Overview's own HR/admin mode.

### Decision 5 — Modules in V1
**APPROVED.** Team Overview, Attendance, Leave, Performance, Learning, Asset Management. **Excluded**: Recruitment (hiring-manager ≠ reportingManagerId, no manager-scoped approval model exists), Workforce/Scheduling (doesn't exist as an implemented surface), Employee Career Profile, Documents, Payroll/compensation/banking.

### Decision 6 — Inline Mutations
**APPROVED: none in V1.** The portal shows counts/summaries/team information/pending work and deep-links to the authoritative module surface for every action (approve/reject/assign/complete/correct/return/review/any mutation). Permanent V1 invariant — see §19. This **explicitly resolves** the tension the discovery pass flagged between this recommendation and the pre-existing module-registry description's own "views and approvals" wording: approvals remain visible (as Pending Actions) but are never *executed* inside the portal.

### Decision 7 — Team Overview Fields
**APPROVED WITH REFINEMENT.** Employee ID, employee number, name (firstName/lastName, matching the codebase's own established raw-field convention — see `assetReporting.ts:295,347`'s `${firstName} ${lastName}` composition, not a new server-composed "fullName" field), position, department, branch, employment status. `hasProfilePicture` **is included** — confirmed safe by direct code inspection (§5): it is a boolean already computed from `profilePictureKey != null` with no additional lookup or widened authorization, the exact bar the Owner directions set. **Explicitly excluded**: home address, personal email, private phone numbers, banking, compensation, payroll, emergency contacts, identity documents (nationalId/passportNumber), employee documents, disciplinary information, medical information, and every other HR-confidential field. The Team Overview endpoint returns a purpose-built, deliberately narrowed DTO — it does not pass through `formatEmployee`'s full shape or `SelfServiceEmployeeProfile` (both carry far more than this DTO needs).

### Decision 8 — Pending Actions Model
**APPROVED: read-only aggregation, no persistent state.** No task table, no notifications engine, no new workflow state, no duplicated approval records. Computed live from each module's own authoritative state (§5's definitions). Each item retains source module, authoritative state, manager scope, and a deep-link. The portal never becomes the owner of the task.

### Decision 9 — Dashboard Tile Set
**APPROVED WITH REFINEMENT.** Final frozen set (§28):
- Direct Reports (count)
- Attendance — Absent or Late Today (redefined from the draft's vaguer "Attendance Attention Today," per Owner's own instruction in §30 to replace an imprecise label with the narrowest truthful count)
- Pending Leave Actions
- Pending Performance Actions
- Pending Learning Actions
- Team Assets In Custody

No engagement/productivity/effectiveness/risk/AI score, no attendance percentage, no performance average, no financial KPI — none invented.

### Decision 10 — Recruitment
**APPROVED: excluded from V1.** `hiringManagerEmployeeId` is not coupled to `reportingManagerId`. No Recruitment pending actions surface through the portal in Phase 3G. Recruitment remains independently accessible through its own existing surfaces.

### Decision 11 — Workforce/Scheduling
**APPROVED: excluded — nothing to aggregate.** No scheduling API or manager capability is invented to fill a portal section. Existing Attendance information appears only per Attendance's own authoritative model (§5).

### Decision 12 — Reporting Scope
**APPROVED: zero new reports.** No manager-specific reporting engine, no portal-owned CSV export. Portal sections may deep-link to an existing module report/operational page the caller already has access to. The portal is operational, not a reporting module.

### Decision 13 — Permission Model
**APPROVED: zero new permissions.** No `manager_portal.read`, `manager.read`, `manager.read.team`, or any `*.read.team` variant. Portal access resolves from authenticated membership + live manager-of-record relationship + existing HR/admin role/access (Decision 4) + each underlying module's own existing permissions/relationships for module-specific data. Module activation (`manager_portal` enabled) is never treated as authorization by itself — it is a necessary but not sufficient condition, exactly like every other module in this codebase.

### Decision 14 — Backend Aggregation Model
**APPROVED.** A small, dedicated Manager Portal read layer is built. It resolves current manager identity once, resolves live direct reports once, returns narrowed Team Overview DTOs, calculates dashboard counts and Pending Actions, and reuses each module's own authoritative service functions (`lib/leaveApprovals.ts`, `lib/performanceManagerReview.ts`, `lib/learningEnrollments.ts`, `lib/assetReporting.ts`, `lib/attendanceReporting.ts`/`attendanceDailySummary.ts`) rather than reimplementing their query logic. It must not reimplement any mutation/business-rule engine (§19).

### Decision 15 — Zero Direct Reports
**APPROVED WITH REFINEMENT.** A caller who currently has zero direct reports has no manager relationship, no team visibility, no manager-derived dashboard data, and no manager-derived Pending Actions — access is strictly live, never retained from a past relationship. HR Manager/Org Admin/Super Admin retain their own separately-approved access path (Decision 4) regardless. **UX resolution (the A/B question in Owner directions §16):** **Option B — allow entry to an explicit "You currently have no direct reports" empty state**, not hiding the nav item. This is the precedent-consistent choice: `app-shell.tsx`'s nav is role-gated, not relationship-gated, and Leave Approvals — the one existing surface with an identical "may have zero" relationship-only model — is shown unconditionally with the underlying route itself producing an empty result set, never a hidden nav entry. Manager Portal's own nav entry follows that exact precedent (§25).

---

## 7. Additional Frozen Architecture Decisions (Owner Directions §17–§34)

### §17 — `manager_portal` Module
Frozen per §2 above: activate the existing row in W109, no new key, no rename, `defaultEnabled: false` preserved, zero auto-enablement.

### §18 — Module-Gating Model
Frozen: the portal shell is controlled by `manager_portal`. Each section is **additionally** controlled by its own underlying module's own enabled state (`attendance`/`leave`/`performance`/`learning`/`asset_management`) — a disabled underlying module hides only its own card/section, never bypassed. Matches the ESS Career Profile precedent (per-tab module gates in `employee-self-service.tsx`) exactly. The shell must render correctly for a mixed-module organization (some enabled, some not).

### §19 — Cross-Module Authorization Invariant (formal, load-bearing, permanent)
**The Manager Portal must never widen authority beyond the underlying module.** Concretely and specifically: Assets stays current-custody read-only; Performance preserves its own `reviewerEmployeeId`-snapshot authority (never substituted with live manager-of-record); Learning preserves the manager-of-record vs. instructor-of-record separation (never merged into one "manager" badge — see §33); Leave preserves its own approval semantics exactly; Attendance preserves its own team scope and mutation rules (i.e., none — read-only). This is frozen as permanent, not just for V1 — no future Manager Portal workstream may relax it without its own explicit Owner approval.

### §20 — Live vs. Snapshot (frozen, not unified)
Portal Team Overview and general manager eligibility: **live** `reportingManagerId`. Assets team visibility: **live**, per Assets' own model. Attendance/Leave: preserve their own actual (live) semantics. Performance/Learning: preserve their own actual (snapshot/workflow) semantics. **No universal manager-authorization engine is built.** A shared helper (§21) may exist **only** for genuinely live current-direct-report resolution; it must never replace or be substituted for Performance's/Learning's own snapshot/workflow authority helpers.

### §21 — Duplicated Direct-Report Queries
Discovery found 7+ independently duplicated `eq(employeesTable.reportingManagerId, X)` implementations across `attendanceRegister.ts`, `attendanceReporting.ts`, `leaveApprovals.ts`, `leaveCalendar.ts`, `routes/users.ts`, `lib/assets.ts`, `lib/assetReporting.ts`. **W109 may introduce exactly one new, carefully-scoped shared helper for live current-direct-report resolution, for Manager Portal's own new endpoints only**, once repository inspection at implementation time confirms those 7 implementations are semantically equivalent to what the helper needs. **No broad refactor of the 7 existing call sites in W109 or any Phase 3G workstream** — they remain untouched unless a later, separately-approved refactor initiative is undertaken. Manager Portal implementation must not become unrelated cleanup work.

### §22 — Pre-Existing Security Gap: `employee.read`
Recorded as: **PRE-EXISTING SECURITY HARDENING ITEM — OUTSIDE PHASE 3G SCOPE.** `employee.read` exposes broad employee profile data organization-wide without manager-vs-stranger narrowing — genuine, disclosed, not silently fixed here. Manager Portal avoids depending on that broad DTO by building its own narrowed Team Overview DTO (Decision 7) instead. **If implementation discovers Phase 3G cannot be made safe without touching `employee.read` itself, implementation must STOP and report before broadening scope** — not silently patch it in passing.

### §23 — Pre-Existing Audit Gap: `reportingManagerId` Changes
Recorded as: **PRE-EXISTING AUDIT HARDENING ITEM — OUTSIDE PHASE 3G SCOPE.** `reportingManagerId` changes emit no audit event today. Manager Portal implementation must not silently add manager-change auditing as a side effect. **If implementation genuinely requires it, STOP and report** rather than improvising a new audit event type.

### §24 — Notifications
The `notifications` table has zero producers anywhere (re-confirmed, unchanged since discovery). **Not used for Manager Portal V1.** No notification producers are created. No persistent Manager Portal tasks. Pending Actions are computed live from authoritative module state only (Decision 8).

### §25 — Frontend Route & Nav
**Frozen: route `/manager`.** Confirmed via direct inspection of `App.tsx`'s route table (§5) — no conflict with any existing route. Serves as the consolidated Manager Portal landing page. Existing module-specific manager/team pages (`/team-assets`, `/learning-team-training`, `/performance-team`, `/leave-approvals`, `/attendance-register`) are **not removed or consolidated** — the portal deep-links to them, unchanged. **Nav label: "Manager Portal."** **Nav visibility (frozen, resolving Decision 15's UX question): unconditional** — shown to every authenticated organization member whenever the `manager_portal` module is enabled for that organization, mirroring the one existing precedent for a purely-relationship-gated surface, Leave Approvals (`app-shell.tsx:315`, the sole nav item with no `isHrCapable` gate). This is also consistent with the confirmed fact (§3) that `app-shell.tsx`'s nav applies no client-side module filtering today — so this nav item, like every other, is gated on role/relationship only client-side, with the true module-enabled gate enforced server-side on every Manager Portal route, exactly like every other module in this codebase. The page itself resolves live eligibility and renders the manager view, the HR/admin view (Decision 4), or the "no direct reports" empty state (Decision 15) — never a silent redirect or a hidden nav entry.

### §26 — Frontend Structure
**Frozen:**
```
Manager Portal (/manager)
  - Overview       — dashboard tiles + concise per-module summaries
  - My Team        — narrowed direct-report cards/table (Team Overview DTO)
  - Pending Actions — read-only aggregated list, grouped/labeled by source module
```
Tabs or sections, per existing app-shell/page conventions at implementation time. Every actionable Pending Actions item deep-links to its authoritative module surface. **No inline mutation control anywhere in this structure** (Decision 6).

### §27 — Team Overview Backend
**Frozen route: `GET .../manager-portal/team`.** Response is the Decision-7 narrowed DTO — never a full Employee DTO. Identity and organization are always server-derived (never a client-supplied manager employee ID or organization ID; never an arbitrary employee filter that could widen scope). **HR/admin mode resolution (frozen, per Owner directions §27's own explicit question):** Team Overview remains **direct-report-based even for HR/admin** — Option A, the Owner's own stated preferred safe default. HR/admin already have Employee Management (`/employees`) for organization-wide employee browsing; Manager Portal's Team Overview does not become a second HR employee directory. If an HR/admin caller has zero direct reports of their own, they see the same "no direct reports" empty state as any other employee-role caller in that position (Decision 15) — their HR/admin *portal access* (Decision 4) governs whether they may open `/manager` at all, not whether Team Overview shows them org-wide data.

### §28 — Dashboard Backend
**Frozen route: `GET .../manager-portal/dashboard`.** Resolves the caller once, resolves live direct reports once, determines enabled underlying modules, calculates only authorized metrics, returns deterministic zeroes for enabled-but-empty sections, and distinguishes disabled/unavailable modules from empty ones where the frontend needs that distinction (a disabled module's tile is omitted entirely; an enabled module's tile with no qualifying rows renders as zero — never conflated). No N+1 queries — direct reports resolved once and passed into each module's own aggregation call. No sensitive data computed client-side from a broad organization-wide dataset.

### §29 — Pending Actions Backend
**Frozen route: `GET .../manager-portal/pending-actions`.** Aggregates from the five sources defined precisely in §5/§30–§34. Each item returns: source module key, the underlying module's own existing identifier (leave request id / performance review id / learning enrollment id), a human-readable safe label, and enough routing metadata for the frontend to deep-link to the authoritative module page. No confidential field is exposed beyond what's needed for the label. **No mutation endpoint, no "complete task" endpoint, no universal task-ID table.**

### §30 — Attendance Definition (frozen precise definition)
**"Absent or Late Today"** = count of the caller's live direct reports whose daily attendance summary status (`resolveOrganizationTodayCivilDate`'s date, via the existing `getAttendanceDashboard`/daily-summary machinery) is exactly `"absent"` or `"late"`. Excludes `"partial"` (ambiguous — may be a legitimate scheduled half-day, not necessarily attention-worthy), `"on_leave"`, `"holiday"`, `"non_working_day"`, and `null`/not-applicable. Source: `lib/attendanceDailySummary.ts` + `lib/attendanceReporting.ts`. Scope: live direct reports only. Timezone/date semantics: the organization's own resolved civil "today," exactly as Attendance's existing dashboard already computes it — no new date logic. Module-disabled behavior: tile omitted entirely if `attendance` is disabled for the organization.

### §31 — Leave Definition (frozen)
A pending Leave action = a `leave_requests` row with `status = "pending"` where the caller is authorized to act on it per Leave's own existing `listPendingApprovals` (direct-reports-only for a plain manager; org-wide if the caller separately holds `leave_request.manage`, consistent with Decision 4's HR/admin carve-out). Source: `lib/leaveApprovals.ts:38-48`, reused unchanged. No new leave-approval authority model is introduced by the portal.

### §32 — Performance Definition (frozen)
A pending Performance action = a `performance_reviews` row with `reviewerEmployeeId` (snapshot) equal to the caller and `status = "manager_review"` exactly. Source: `lib/performanceManagerReview.ts:129-156`. Never inferred from live `reportingManagerId` — the snapshot is authoritative, per §19/§20.

### §33 — Learning Definition (frozen)
A pending Learning action, for general Manager Pending Actions, = a `learning_enrollments` row with `managerEmployeeIdSnapshot` (snapshot) equal to the caller and `approvalStatus = "pending"` exactly. Source: `lib/learningEnrollments.ts:542-652`. **Instructor-of-record work is explicitly excluded from this general Pending Actions surface** — it remains visible only through Learning's own dedicated My Team Training / instructor surfaces, unless the caller independently holds that instructor relationship and a future, separately-approved workstream explicitly chooses to surface it. V1 never conflates the two relationships.

### §34 — Assets Definition (frozen)
Assets information in the portal remains **read-only**. Dashboard count = number of currently-active custody assignments (`custodyEndedAt IS NULL`) held by the caller's live direct reports, via `resolveAssetReportScope`/the existing current-custody query (`lib/assetReporting.ts:115,331`). No asset mutation in the portal, no historical-custody widening.

### §35 — Audit
Frozen: Manager Portal read endpoints (`team`, `dashboard`, `pending-actions`) are audit-silent, consistent with every existing `/me/*` and manager/team/dashboard route in this codebase. Every deep-linked mutation continues to emit its own authoritative module's existing, unmodified audit event. The portal itself creates no duplicate or portal-specific mutation audit event, since it performs no mutation.

### §36 — Database
**Frozen: zero new tables, zero schema changes, zero migration.** Migration remains `0040`. No `0041` is created by any Phase 3G workstream under this frozen plan. If implementation later discovers a genuine schema requirement, implementation must **STOP** — no improvised migration.

### §37 — Permissions
**Frozen: zero new permission definitions, zero role-mapping changes, no formal manager role, no `manager.read.team`, no `manager_portal.read`.** Underlying module permissions remain fully authoritative for everything module-specific the portal surfaces.

---

## 8. Security, Tenant Isolation & Accessibility (Frozen Test Requirements)

**Tenant isolation test matrix (frozen, §38):** WWM↔Acme isolation; cross-org employee IDs; cross-org workflow IDs (leave request / review / enrollment / asset); cross-org module records; an unrelated manager; a plain employee with no reports; a manager relationship change mid-session; a manager who loses their last direct report; `manager_portal` disabled; an underlying module disabled; a mixed-module organization; HR/admin portal access (both with and without their own direct reports); underlying-module permission denial; underlying-workflow-relationship denial (e.g. an HR/admin who is not the snapshotted reviewer). No existence leaks anywhere in this matrix (404 for out-of-scope ids, never confirming or denying existence to an unauthorized caller, per established platform convention).

**Responsive/accessibility (frozen, §39):** desktop and mobile responsive layout, no separate mobile app, text status labels (color never the sole indicator), keyboard-accessible actions/links, explicit loading/error/empty states per section, an explicit module-unavailable state distinguished from an empty-but-enabled state, and no empty state that masks a permission denial as "nothing here."

**Reporting (frozen, §40):** zero Manager Portal reports, zero CSV, zero new report-registry keys, zero reporting migration/seed. Existing module reporting stays fully separate; Manager Portal's own "Overview" tiles are dashboard-style live counts, never a report artifact.

## 9. Frozen Deferrals (V1 Exclusions)

Recursive/multi-level org hierarchy; dotted-line/secondary managers; manager delegation; a persistent task/notification inbox engine; custom notifications; bulk cross-module actions; a new cross-module workflow engine; Manager Portal reports/CSV exports; employee private documents; Career Profile exposure through the portal; compensation/banking/payroll (none of the latter two exist anywhere in this schema — confirmed, not merely deferred); disciplinary/private HR information; succession planning; talent calibration; org-chart redesign; Recruitment participation; Workforce/Scheduling (doesn't exist); **and, explicitly not disguised as intentional behavior**, the two disclosed pre-existing hardening items — `reportingManagerId` audit-gap remediation and the broad `employee.read` authorization gap — both remain real, open, pre-existing product defects tracked **outside** Phase 3G, not resolved and not silently absorbed into this scope.

---

## 10. Frozen Workstreams (W109–W113)

### W109 — Manager Portal Foundation & Team Overview
**Objective:** Stand up the module and prove the Team Overview data path end-to-end.
**Scope:** Activate `manager_portal` (`hidden → active`, §2/§17); resolve live manager eligibility (Decision 2); the one new shared live-direct-report helper for Manager Portal's own use only (§21, no refactor of the 7 existing call sites); `GET .../manager-portal/team` returning the Decision-7 narrowed DTO with the §27 HR/admin resolution (direct-report-based even for HR/admin).
**Explicit exclusions:** no dashboard, no Pending Actions, no `/manager` frontend page yet (frontend is W111's own scope) unless the frozen W109 boundary at implementation time requires a minimal shell for testability — if so, it must be the smallest possible stub, not the full structure from §26.
**Backend impact:** 1 new route.
**Frontend impact:** none (or a minimal test-only stub, per the exclusion note above).
**Database impact:** none.
**Permissions:** zero new (§37).
**Authorization:** live `reportingManagerId`; server-derived identity/org only.
**Module gating:** `manager_portal` module gate on the route; no per-underlying-module gating needed yet (Team Overview doesn't read module-specific data).
**Audit:** none (read-only, audit-silent).
**Tests:** eligibility (has reports / has none), direct-report scope correctness, empty-team case, cross-org isolation, module-disabled (`manager_portal` off), HR/admin direct-report-based behavior, identity/org never client-suppliable.
**Live QA:** own-team read against real fixtures; zero-report manager; cross-org isolation both directions; HR/admin with and without their own direct reports.
**Cleanup:** all disposable QA fixtures independently re-verified zero-remaining, matching the established W105–W108 discipline.
**Definition of Done:** Team Overview proven end-to-end, live-verified, zero regression in the 5 underlying modules' own existing tests/routes.
**STOP conditions:** any of the §44 triggers below. Do not begin W110 without its own separate go-ahead.

### W110 — Manager Portal Dashboard & Pending Actions
**Objective:** Deliver the two remaining read-aggregation endpoints.
**Scope:** `GET .../manager-portal/dashboard` (Decision 9 tile set, §28); `GET .../manager-portal/pending-actions` (Decision 8, §29, using the precise §30–§34 definitions). Both call each module's own existing authoritative service functions — zero reimplementation of query logic, zero new mutation route of any kind.
**Explicit exclusions:** no frontend yet; no Manager Portal report/CSV of any kind (§40).
**Backend impact:** 2 new routes.
**Frontend impact:** none.
**Database impact:** none.
**Permissions:** zero new; each tile/item silently omitted if the caller lacks that module's own existing permission or the module is disabled for the organization.
**Authorization:** per-module, per §5/§30–§34 exactly (live for Attendance/Leave/Assets, snapshot for Performance/Learning) — never unified.
**Module gating:** each tile/section independently gated by its own underlying module.
**Audit:** none (read-only).
**Tests:** per-tile/per-item correctness against each source module's own existing data; module-disabled per-tile/per-item omission; a dedicated proof that no endpoint here ever performs or exposes a path to a mutation (§19); the Attendance "Absent or Late Today" definition tested against all 7 statuses to confirm only `absent`/`late` count.
**Live QA:** full tile/Pending-Actions set seeded through each module's own existing, unmodified routes; independently cross-checked against each source module's own dashboard/list for exact-count agreement.
**Cleanup:** as W109.
**Definition of Done:** dashboard and Pending Actions aggregation proven accurate against independently-verified source-module data.
**STOP conditions:** §44. Do not begin W111 without its own separate go-ahead.

### W111 — Manager Portal Frontend
**Objective:** Deliver the full V1 user-facing surface.
**Scope:** `/manager` page (§25/§26): Overview (dashboard tiles + module summaries), My Team (Team Overview list/cards), Pending Actions (grouped, deep-linking list). Unconditional nav entry labeled "Manager Portal" (§25). No inline mutation control anywhere (Decision 6).
**Explicit exclusions:** any embedded approve/reject/assign/complete/correct/return/review control for any module; any new reporting UI.
**Backend impact:** none (consumes W109/W110's three routes).
**Frontend impact:** new page + nav entry.
**Database/Permissions:** none.
**Tests:** loading/error/empty states per section; the explicit "no direct reports" empty state (Decision 15) distinct from a loading/error state; deep-link correctness for every Pending Actions item and every My Team entry point relevant to a module; a frontend assertion that zero mutation controls render anywhere on `/manager`; HR/admin view rendering (Decision 4); existing dedicated manager pages (`/team-assets`, `/learning-team-training`, `/performance-team`, `/leave-approvals`, `/attendance-register`) proven unaffected/unchanged.
**Live QA:** full manager walkthrough (multiple direct reports, single direct report, zero direct reports); full HR/admin walkthrough; mixed-module organization rendering only the enabled sections; a live manager-relationship change reflected immediately without page-specific caching.
**Definition of Done:** the full V1 Hybrid surface live, navigable, and regression-free against every underlying module's own existing page.
**STOP conditions:** §44. Do not begin W112 without its own separate go-ahead.

### W112 — Phase 3G Verification
**Objective:** Full integrated verification of Manager Portal as one system, mirroring the W93/W103/W107 charter exactly.
**Scope:** reconciliation against this frozen plan (every Owner Decision re-confirmed genuinely shipped, not merely re-asserted); functional verification; authorization verification including a direct, live test of the §19 cross-module-authorization-non-widening invariant for every one of the 5 modules; tenant isolation per the full §38 matrix; module-gating verification (shell + per-section, mixed-module organizations); full regression across all 5 underlying modules' own existing pages/routes/tests; one integrated live-QA lifecycle covering every scenario in this document's §8/§10 test requirements.
**Explicit exclusions:** no new feature scope introduced during verification; defects found are Category A/B/C per established project practice — Category A (in-scope implementation defects) may be fixed and disclosed; anything touching the §22/§23 pre-existing hardening items or requiring a new migration/permission/role triggers a STOP per §44, not a fix-in-place.
**Definition of Done:** matches the W93/W103/W107 template exactly — PASS, PASS WITH FIXES, or BLOCKED, reported with the same rigor (regression counts, live-QA assertion counts, RLS/advisor re-check, disposable-fixture cleanup verification).
**STOP conditions:** §44, plus: do not begin W113 without its own separate go-ahead.

### W113 — Phase 3G Completion Report
**Objective:** Formal closure, mirroring the W94/W104/W108 structure exactly.
**Scope:** documentation only, unless W112's verification surfaced an approved Category A fix still pending disclosure — never new feature scope. Reconciles all 15 Owner Decisions plus §17–§37 against final shipped state. Marks Manager Portal / Phase 3G complete **only if W112 passed**. Reconciles `ROADMAP.md`'s Phase 3 ("Workforce Operations") status — this is the final Phase 3 item, so W113 is also where Phase 3 as a whole may be marked complete, if and only if every prior Phase 3 item (already independently verified complete in Phases 3A–3F) plus Manager Portal itself are all genuinely done.
**Definition of Done:** `PROJECT_STATUS.md` fully reconciled; Phase 3 marked complete only if every requirement is genuinely delivered; next roadmap step identified (per `ROADMAP.md`, the "Future Expansion" tier) without beginning it.
**STOP conditions:** §44, plus: this is the final Phase 3G workstream — do not begin Future Expansion or any other new initiative without its own separate planning/freeze cycle and go-ahead.

## 11. Expected Migration

**None**, across all five workstreams, under this frozen plan. Migration remains `0040`. If any workstream's implementation genuinely requires a schema change, implementation must STOP (§44) rather than create `0041` improvisationally — a schema need discovered mid-implementation requires its own plan revision and Owner approval first.

## 12. Frozen STOP Conditions for Implementation (§44)

Future implementation sessions (W109–W113) must **STOP and report** rather than improvise if they discover any of the following:
- a genuine schema/migration requirement
- a genuine need for a new permission
- a genuine need for a manager role
- a contradiction with an underlying module's own authority model (§19)
- a requirement for recursive/indirect hierarchy
- a requirement to expose sensitive employee data beyond the frozen Decision-7 field set
- a requirement to broadly modify `employee.read` (§22)
- a requirement to audit `reportingManagerId` changes as part of portal work (§23)
- a requirement for an inline mutation not already frozen as excluded (§6/Decision 6)
- a need to couple Recruitment's `hiringManagerEmployeeId` to `reportingManagerId`
- a need for a persistent task/notification engine (§24)
- any production-only change
- any contradiction with this frozen plan

**Category-A implementation defects genuinely inside already-approved scope** (e.g. an off-by-one in a tile count, a missing loading state) may be fixed and disclosed per the established project practice (as in W103/W107/W93) — this is not a STOP trigger. The STOP list above is for genuine scope/authority/schema questions the Owner has not yet decided, not for ordinary in-scope bugs.

---

**This document is FROZEN — APPROVED FOR IMPLEMENTATION. W109 may begin under its own separate explicit go-ahead. No workstream implementation is authorized by the act of freezing this document alone.**
