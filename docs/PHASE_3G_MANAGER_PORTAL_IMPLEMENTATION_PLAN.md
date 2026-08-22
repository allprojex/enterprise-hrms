# Phase 3G — Manager Portal Implementation Plan

**Status: DRAFT — NOT APPROVED FOR IMPLEMENTATION**

This document is the output of a repository-grounded discovery pass, not a frozen plan. Nothing in this document authorizes writing code. Every choice not directly dictated by existing repository behavior is labeled **[PROPOSED DESIGN DECISION]** and is not approved until the Owner resolves it. Sections labeled **Discovery Finding** report what the repository already contains, unchanged by this document.

Naming note: `ROADMAP.md`'s own Phase 3 ("Workforce Operations") list is Recruitment → Attendance → Leave → Performance → Learning → Assets → Employee Self Service → **Manager Portal**. The prior six shipped as Phase 3A/3B/3C/3D/3E/3F. This document continues that lettering as **Phase 3G**, matching the established `docs/PHASE_3[A-F]_*_IMPLEMENTATION_PLAN.md` naming convention. Workstream numbering continues from the last-used number, **W109**.

---

## 1. What `ROADMAP.md` Actually Specifies

**Discovery Finding:** the entire Manager Portal specification in `ROADMAP.md` is the single bare bullet `- Manager Portal` (line 50), inside the Phase 3 list. The full file is 67 lines; there is no elaboration, sub-bullet, scope note, or cross-reference anywhere else in it. `PROJECT_STATUS.md` never scoped it beyond repeating this same fact and explicitly disclaiming that any prior phase (most recently Phase 3F) built any part of it — every mention lists the same four existing manager-facing surfaces (Team Assets, My Team Training, Performance manager review, Attendance Register's own team scope) as the current, non-consolidated state.

**This plan's own scope is therefore derived entirely from discovery of existing repository capability**, not from any pre-existing specification — there was none to reconcile against.

## 2. A Significant Pre-Existing Discovery: `manager_portal` Is Already Pre-Registered

**Discovery Finding, not a decision:** `lib/db/src/seed/module-definitions.ts:125-135` already contains a `manager_portal` module row:
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
Confirmed live: the module exists in the registry (`status: "hidden"`), zero organizations have an `organization_modules` row for it — exactly the same pre-registration pattern every other not-yet-built module used before its own Foundation workstream (Assets/Learning/Performance were all `hidden` before their own builds, flipped to `active` on their first workstream). This is disclosed as existing state, not implemented by this document.

Two facts from this pre-existing entry materially inform this plan:
- **`requiredModuleKeys: []`** — the module registry itself imposes no hard dependency on Attendance/Leave/Performance/Learning/Assets being enabled, which is consistent with (and lends registry-level support to) a "shell + independently-gated cards" architecture (§8 below) — the same pattern already used twice in this codebase (ESS's own per-tab module gates in `employee-self-service.tsx`).
- **The description says "views and approvals"** — this is evidence, not a decision, that whoever wrote this registry entry anticipated some inline action capability, not a pure read-only/deep-link-only aggregator. This tension is carried into Owner Decision 6 below rather than resolved silently.

## 3. Full Existing Manager Capability Matrix (Discovery Finding)

| | Attendance | Leave | Performance | Learning | Assets |
|---|---|---|---|---|---|
| Manager page | `attendance-register.tsx` + `attendance-dashboard.tsx` | `leave-approvals.tsx` | `performance-team.tsx` | `learning-team-training.tsx` | `team-assets.tsx` |
| Route | `/attendance-register`, `/attendance-dashboard` | `/leave-approvals` | `/performance-team` | `/learning-team-training` | `/team-assets` |
| Nav gating | HR-only (`isHrCapable`) | **Unconditional** — shown to every user | HR-only | HR-only | HR-only |
| Coarse permission | `attendance.read.own` | `leave_request.approve` (+ `leave_request.manage` for org-wide) | `performance.review.write` | `learning.review.write` | `asset_management.read.own` |
| Held by `employee` role by default? | Yes | Yes | Yes | Yes | Yes |
| Manager-scope mechanism | **Live** `reportingManagerId` query, re-evaluated every call | **Live** `reportingManagerId` query | **Snapshot** `reviewerEmployeeId`, captured once at review creation | **Snapshot** `managerEmployeeIdSnapshot` (+ a wholly separate **live** instructor-of-record tier) | **Live** `reportingManagerId` query (Owner Decision 3 from Phase 3E, explicit) |
| Recursive hierarchy | No | No | No | No | No |
| Manager mutate ability | **None** — read-only by construction | **Approve / reject** | Rate competencies, goals, **submit** manager review | **Approve / reject / assign** training (+ instructor mark-attendance/complete, a separate relationship) | **None** — read-only by explicit design (Decision 4) |
| Historical reach | Yes (arbitrary date range) | **No** (pending-only) | Yes (no status filter) | Yes (no status filter) | **No** (current custody only) |
| Org-wide fallback | None | None | None | None | None |
| Dedicated dashboard | Yes | **No** — folded into the generic `GET /dashboard/summary` | Yes | Yes | Yes |

**Zero recursive hierarchy exists anywhere** — every one of the 5 modules resolves manager scope via exactly one `eq(employees.reportingManagerId, callerEmployeeId)` comparison, direct reports only, confirmed by direct code inspection (no `WITH RECURSIVE` or multi-hop query anywhere in the repository).

## 4. Existing Manager Frontend Surfaces (Discovery Finding)

| Page | Component | Nav location | Module gate | Backend routes used | Shared with HR? |
|---|---|---|---|---|---|
| `attendance-register.tsx` | Register list, date/status/dept/branch filters | `isHrCapable`-only nav; reachable by URL for any manager | `attendance` | `GET .../attendance` | Same page, "Add Entry" further gated `isHrCapable`-only client-side |
| `attendance-dashboard.tsx` | Zero-filled status tiles | `isHrCapable`-only nav | `attendance` | `GET .../attendance/dashboard` | Same page |
| `leave-approvals.tsx` | Pending-approval queue, approve/reject | **Unconditional nav** — the one exception | `leave` | `GET .../leave-requests/pending-approvals`, `POST .../approve`, `POST .../reject` | Same page |
| `performance-team.tsx` | Team review list, rate/goals/submit | `isHrCapable`-only nav | `performance` | `GET .../performance/team-reviews`, `POST .../manager-review`, goal/evidence routes | Same page |
| `learning-team-training.tsx` | Team enrollment list, approve/reject/assign, instructor actions | `isHrCapable`-only nav | `learning` | `GET .../learning/team-enrollments`, `POST .../approve`, `/reject`, `/assign`, instructor routes | Same page |
| `team-assets.tsx` | Current-custody read-only list | `isHrCapable`-only nav | `asset_management` | `GET .../assets/team-assets` | Same page |

**No dedicated `/team`, `/my-team`, or `/direct-reports` route exists anywhere** in `routes/employees.ts` — the only employee-list route is the HR-admin `GET /organizations/:organizationId/employees`, gated `employee.read`, with no `reportingManagerId` filter parameter at all.

## 5. Manager-of-Record Model (Discovery Finding)

`employees.reportingManagerId` (`lib/db/src/schema/employees.ts:68-70`): a nullable, self-referencing FK to `employees.id`, `onDelete: "set null"`, indexed. It is mutated through exactly one path — the generic `PATCH /organizations/:organizationId/employees/:employeeId` route — alongside every other employee field, with **no audit event, no `employment_periods` row, and no historical trace of the prior value anywhere**. `transferEmployee()` (Phase 2A, W25) explicitly excludes `reportingManagerId` from its own params — a "manager change" is not folded into "transfer" and is not its own concept anywhere in this codebase. No `manager_history` table, no dotted-line/secondary-manager column, no matrix reporting exists anywhere (confirmed by repository-wide grep, zero matches).

**This is disclosed as a significant pre-existing finding, not something this plan proposes to fix** — see §19, Issue 1.

## 6. Live vs. Snapshot Authority — Must Be Preserved Per Module, Not Unified

**Discovery Finding, load-bearing for this entire plan:** Attendance, Leave, and Assets resolve manager authority **live** (re-queried every call). Performance and Learning resolve it via a **snapshot column** captured once at workflow-creation time, with explicit in-code comments stating this is deliberate — a later manager change must never reassign an in-flight or historical review/enrollment. Learning additionally has a wholly separate **instructor-of-record** relationship (a session's own `instructorEmployeeId`), unrelated to `reportingManagerId`, granting attendance-marking/completion authority independent of manager status.

**Manager Portal must never propose a single universal authorization helper that would collapse these intentionally different semantics.** Every card/section the portal surfaces must call each module's own existing, unmodified scope-resolution function — never reimplement or "simplify" it.

## 7. Permission Registry Findings (Discovery Finding)

Zero permission keys matching `manager.*`, `manager_portal.*`, or `.read.team`/`.team` exist anywhere in `lib/db/src/seed/seed-roles-permissions.ts` — confirmed by full-file grep, with four in-code comments *explicitly documenting the deliberate absence* of a `.team` variant in Performance, Learning, and Assets (e.g. Assets: "never a separate `.read.team` key").

**The established, repeatedly-chosen convention across every one of the 5 already-built modules is: one broad, coarse permission grant already held by the default `employee` role, narrowed server-side by a relationship comparison — never a dedicated `.team`/`manager.*` permission key.** A hypothetical `manager_portal.read` permission would be the first of its kind and would deviate from this convention. See Owner Decision 13.

**No formal "manager" role exists.** Exactly 3 roles are seeded: `org_admin`, `hr_manager`, `employee` (`lib/db/src/seed/seed-roles-permissions.ts:14,18,20`). "Manager" is purely a relational fact (someone else's `reportingManagerId` points at you), never a role or a permission tier.

## 8. Module Gating — Proposed Model

**[PROPOSED DESIGN DECISION]:** the Manager Portal shell is gated by the existing, pre-registered `manager_portal` module (flipped `hidden → active` on Foundation workstream, matching every prior module's own precedent). Each card/section inside it is **independently** gated by its own underlying module (`attendance`/`leave`/`performance`/`learning`/`asset_management`) — exactly the pattern already proven twice in this codebase (ESS's own Career Profile tab and its 4 module-gated siblings inside `employee-self-service.tsx`). A disabled underlying module hides only that one card, never the whole portal, and the portal must never become an indirect read path into a disabled module's own data. This is strongly supported by the pre-existing registry entry's own `requiredModuleKeys: []` (§2) but is not itself dictated by it — flagged as proposed, not assumed.

## 9. Team Directory / "Find My Direct Reports" — A Genuine, Disclosed Duplication

**Discovery Finding:** no shared/canonical "list my direct reports" function exists. The identical query shape is independently hand-written in at least **7 separate backend locations** (`attendanceRegister.ts`, `attendanceReporting.ts`, `leaveApprovals.ts`, `leaveCalendar.ts`, `routes/users.ts`, `lib/assets.ts`, `lib/assetReporting.ts`) plus once more client-side in `learning-team-training.tsx`. Performance and Learning avoid re-querying it live at read-time only because they snapshot the relationship once at workflow-creation — those snapshot-writing call sites each independently read `employee.reportingManagerId` too, with no shared "snapshot the manager" helper either.

**This plan does not propose touching any of those 8 existing call sites** — refactoring mature, already-shipped module business logic "merely for portal convenience" is explicitly out of scope. Instead, Manager Portal's own **new** endpoints (Team Overview, dashboard aggregation) get their **own** single canonical resolver, written once for the portal's own use — not retrofitted onto the 8 pre-existing instances.

**No existing "team" endpoint returns enriched employee-profile fields.** All four (`team-assets`, `team-enrollments`, `team-reviews`, the attendance register) return only a bare `employeeId` integer plus their own domain-specific fields — no name, employee number, position, department, branch, photo, phone, or email. **A Team Overview genuinely requires one new read aggregation endpoint** — no existing route can be reused unchanged for this purpose.

## 10–14. Per-Module Manager Capability (Discovery Finding — see §3 matrix for the compact form)

**Attendance:** read-only for managers (register + dashboard); mutation/approval of adjustments is HR-only, explicitly documented as "no delegated/manager-tier approval." Historical date-range reach exists.

**Leave:** the one module whose primary manager surface is a genuine approve/reject workflow, and the one module with unconditional (non-HR-gated) nav visibility. Pending-only — no manager-facing history of already-decided requests through this surface. No dedicated dashboard; its metrics live inside the generic `GET /dashboard/summary`.

**Performance:** full read + mutate + submit workflow (rate competencies, manage goals, submit for HR finalization), gated to `manager_review`-stage reviews via `reviewerEmployeeId` snapshot — never a live relationship comparison, by explicit design.

**Learning:** approve/reject/assign training for direct reports (manager-of-record, snapshot) plus a wholly separate instructor-of-record tier (mark attendance/complete, live, unrelated to manager status) — these two relationships must remain visibly distinct in any consolidated surface, never merged into one "manager" concept.

**Asset Management:** read-only by explicit design (Decision 4, Phase 3E) — current custody only, live relationship, zero mutation authority for managers under any circumstance.

## 15. Recruitment — Excluded From V1 (Discovery Finding)

`job_requisitions.hiringManagerEmployeeId` is a **separate, explicitly-assigned field**, not resolved via `reportingManagerId` — "hiring manager" and "reporting manager" are two distinct, unrelated concepts in this schema. Requisition approval is a flat, org-wide `requisition.approve` permission (held only by `org_admin`/`hr_manager`, **not** the default `employee` role) with **no per-requisition hiring-manager check anywhere in the service layer** — hiring managers have no dedicated approval routes today. Including Recruitment in Manager Portal V1 would require genuinely new backend authorization work (Category D), not an aggregation of existing capability, and would raise its own unresolved question (should `hiringManagerEmployeeId` participate in `requisition.approve` scope at all — a business-rule change to Recruitment's own already-shipped, frozen approval model). **Recommended: excluded from V1 entirely** — see Owner Decision 10.

## 16. Workforce / Scheduling — Does Not Exist (Discovery Finding)

Confirmed by full-repository grep: no shift, roster, or schedule concept exists anywhere in the schema or routes. The only hits are unrelated uses of "schedule"/"shift" (holiday date-shifting, maintenance/interview/learning-session scheduling) plus one line of **aspirational marketing copy** on the public landing page (`landing.tsx:16`, "shift scheduling") with zero corresponding implementation. **Nothing exists to aggregate — excluded from V1 by default, not a real decision.**

## 17–18. Employee Directory & Sensitive Data Boundaries (Discovery Finding — significant)

`formatEmployee` (the HR-admin employee-detail formatter) returns nearly the entire `employees` row — including `nationalId`, `passportNumber`, `dateOfBirth`, `residentialAddress`, `emergencyContacts` — gated only by the single flat `employee.read` permission, which **the default `employee` role holds with zero manager-vs-stranger scoping anywhere in the codebase**. Concretely: **today, any employee-role user — manager or not — can already view any coworker's full profile org-wide** (nationalId, passport, DOB, address, emergency contacts, `reportingManagerId`) through the existing HR-admin employee-detail route; only `notes` is withheld behind a separate permission. Exit-process records (`employeeExitProcess.ts`) are gated the same broad way. Disciplinary records and Phase 3F's own Career Profile (skills/qualifications/certifications) are correctly HR-only (`employee.disciplinary.read`/`employee.write`, neither a default `employee`-role grant) — a manager cannot see these for a direct report today.

**This pre-existing, platform-wide looseness is disclosed prominently but is explicitly NOT proposed to be fixed by this plan** — see §19, Issue 2. It is far broader than Manager Portal's own scope and would be a separate, significant security-hardening initiative. **Manager Portal's own Team Overview must not rely on or widen this looseness** — it should expose a deliberately minimal, least-privilege field set regardless of what `employee.read` already technically permits elsewhere (see Owner Decision 7).

## 19. Issues / Ambiguities Disclosed (Not Proposed to Be Fixed Here)

1. **`reportingManagerId` changes are completely silent and unaudited** — no `audit_events` row, no `employment_periods` row, nothing. A manager relationship can change with zero historical trace. This is a genuine platform gap discovered during this research pass. **Not proposed to be fixed as part of Manager Portal** — it predates this plan, is unrelated to portal implementation, and fixing it (e.g. minting a `reporting_manager.changed` audit event, or folding it into `employment_periods`) is a separate, narrowly-scoped decision the Owner may wish to pursue independently, not bundled here.
2. **`employee.read` exposes an employee's full profile (including several arguably-sensitive fields) org-wide to every `employee`-role holder, with zero manager/stranger distinction anywhere.** This is broader and older than the narrow 3-route gap Phase 3F found and fixed in Career Profile. **Not proposed to be fixed here** — a platform-wide authorization hardening pass of this scope is a separate initiative, disclosed for Owner awareness, not a Manager Portal blocker (Manager Portal's own new surfaces will be deliberately minimal regardless).
3. **The `notifications` table exists with a real read/mark-read API but has zero producers anywhere in the codebase** — nothing has ever inserted a row into it, across every phase to date (confirmed by full-repository grep). It is not a usable backbone for a "pending actions" aggregator without first building producers for every workflow — out of proportion for V1. See §21 and Owner Decision 8.

None of these three issues block Manager Portal discovery or drafting; they are disclosed for Owner visibility, not resolved here.

## 20. Existing Dashboard & Reporting Infrastructure (Discovery Finding)

Every existing dashboard (Foundation `dashboard.tsx`, plus Attendance/Performance/Learning/Assets' own dedicated dashboards) is computed **backend-side** by a dedicated DTO-returning route, rendered by the frontend with zero client-side aggregation, using a consistent zero-filled `statusBreakdown`-plus-scalar-tiles shape. The Foundation dashboard's own `leaveMetrics` sub-block **already implements** an "own + direct reports vs. org-wide" scope pattern (`resolveLeaveDashboardMetrics`) — direct, reusable precedent for a Manager Portal dashboard's own computation style.

The Reporting Foundation's generic runner (`lib/reporting.ts`) has exactly 3 flat, org-wide-only reports from the original Foundation phase; **every module-specific report set instead uses its own dedicated, scope-aware route**, each with an "own / manager-current-or-snapshot / org-wide" 3-tier pattern already established as repository convention — confirmed identically worded in Attendance's, Performance's, Learning's, and Assets' own report-definition comments. This 3-tier pattern is the correct precedent for anything Manager Portal itself computes, but no existing generic reporting mechanism can be reused unchanged.

## 21. Action-Queue / Notification Infrastructure (Discovery Finding)

A `notifications` table and a real 3-route read/mark-read API exist (Foundation phase) but have **zero producers anywhere** — confirmed, no workflow in any phase to date has ever written to it. **This is not a usable foundation for a "Pending Actions" aggregator as-is.** The only viable V1 approach is dashboard-style, read-time aggregation of each module's own already-existing pending-item queries (Leave's pending-approvals list, Learning's team-enrollments filtered to a pending approval status, Performance's team-reviews filtered to unlocked `manager_review`-stage rows) — never a new persistent task/notification engine. See Owner Decision 8.

---

## 22. Recommended Architecture

Three options, evaluated against repository reality:

**Option A — Pure Aggregator**: one landing page, team list, summary cards, deep-links only, zero mutation in the portal itself.
**Option B — Consolidated Operational Workspace**: portal directly embeds approvals/actions/team views from every module inline.
**Option C — Hybrid**: landing dashboard + Team Overview + deep-links to each module's own existing action pages for actual mutations, with no inline mutation forms duplicated inside the portal.

**Comparison:**
- **Security/authority-widening risk**: Option B is highest risk — every embedded mutation form must exactly reproduce each module's own validation/authorization/business rules (Leave's approve/reject, Performance's rate/submit, Learning's approve/assign), a second implementation of logic that already exists once, correctly, in each module's own page. Options A and C carry zero such risk since they never duplicate mutation logic.
- **Duplication**: Option B risks drift between the portal's own copy of a form and the original module page's copy, as each module's own frozen business rules evolve independently. Options A/C avoid this entirely.
- **Backend changes**: Option A requires the least (read-only aggregation only). Option C requires the same read-aggregation plus nothing more for mutations (deep-links use the existing pages verbatim). Option B would require either importing each module's own dialog components (feasible, but couples the portal tightly to every module's internal component structure) or reimplementing them (high risk, explicitly against the cross-module invariant in §23).
- **Maintainability**: A/C are easiest — each module's own page remains the single source of truth for its own mutation UI; the portal only ever reads.

**Recommendation: Option C (Hybrid). [PROPOSED DESIGN DECISION]** A landing dashboard (zero-filled tiles, backend-aggregated, reusing each module's own existing scope-resolution service functions verbatim) + a new Team Overview (the one genuinely new read aggregation) + deep-links into each module's own existing, unmodified manager page (Leave Approvals, My Team Reviews, My Team Training, Team Assets, Attendance Register) for every actual action. **This directly conflicts with the pre-existing module registry description's own wording ("views and approvals" — §2), which is disclosed as evidence the Owner may weigh differently — see Owner Decision 6.**

## 23. Cross-Module Authorization Invariant (Proposed, Core to This Plan)

**The Manager Portal must never widen authority beyond what the underlying module already grants.** Concretely: if Assets says a manager is read-only, the portal cannot add Asset mutation. If Performance uses reviewer-of-record (snapshot) authority, the portal cannot substitute live manager-of-record. If Learning separates manager-of-record from instructor-of-record, the portal must preserve that separation, never collapsing them into one "manager" badge. If Leave has its own approval authority model, the portal must call Leave's own existing approve/reject routes unchanged, never a new portal-specific approval path. This invariant is proposed as permanent and load-bearing for every future Manager Portal workstream, not just V1.

## 24. Proposed V1 Information Architecture

| Section | Data source | API | Permission | Relationship authority | Module gate | Read-only or action |
|---|---|---|---|---|---|---|
| Team Overview | New aggregation (employees + each module's own team endpoint for context) | **New**: `GET .../manager-portal/team` | none (relationship-derived, §29) | Live `reportingManagerId`, new canonical resolver (§9) | `manager_portal` (shell) | Read-only |
| Dashboard tiles | Reuses each module's own existing dashboard/list service functions | **New aggregation route** calling existing lib functions | none (shell) + each tile silently omitted if its own module/permission is unavailable | Whatever each underlying module already uses (live or snapshot, per module) | `manager_portal` (shell) + each tile independently needs its own module enabled | Read-only |
| Pending Actions | Leave pending-approvals, Learning team-enrollments (pending), Performance team-reviews (unlocked) | **Existing routes, reused unchanged** (Category A) | Each module's own existing permission | Each module's own existing mechanism | Each underlying module independently | Read-only; action = deep-link |
| Deep-links | N/A | N/A | N/A | N/A | N/A | Navigates to the existing, unmodified module page |

Team Assets, Attendance summary, and Recruitment are evidence-backed candidates for the dashboard tile row (§26) but are not automatically included — see Owner Decisions 9/10.

## 25. Proposed Team Overview

**[PROPOSED DESIGN DECISION]** Minimal, least-privilege field set, deliberately narrower than what `employee.read` technically already permits elsewhere (§17-18): name, employee number, position title, department, branch, employment status, `hasProfilePicture` (boolean, matching `formatEmployee`'s own existing convention — the actual image reuses the existing `GET .../employees/:employeeId/profile-picture` route, not duplicated). **Explicitly excluded**: nationalId, passport, date of birth, residential address, emergency contacts, phone, personal email, notes, disciplinary records, skills/qualifications/certifications, compensation/banking (none of which exist in this schema anyway, per §44). Phone/work-email inclusion is flagged as a narrower, genuinely open sub-question — see Owner Decision 7.

## 26. Proposed Dashboard (Deterministic, Zero-Filled)

**[PROPOSED DESIGN DECISION]**, evidence-backed per tile:

| Tile | Backed by | Category |
|---|---|---|
| Direct Reports (count) | New canonical resolver (§9) | New, trivial |
| Pending Leave Approvals | Leave's own existing `listPendingApprovals`, reused unchanged | A |
| Pending Performance Actions | Performance's own `listTeamReviews`, filtered client- or server-side to unlocked `manager_review` stage | A |
| Pending Learning Approvals | Learning's own `listTeamEnrollments`, filtered to pending approval status | A |
| Team Assets Outstanding | Assets' own `listTeamAssetAssignments`, count only | A |
| Absent/Late Today (Attendance) | Attendance's own register route, called with today's date | A |

No vanity KPI, no invented rate/percentage metric. Every tile traces to an existing, unmodified module function. **Recruitment and Workforce/Scheduling tiles are not proposed** — no reusable capability exists for either (§15, §16).

## 27. Proposed Backend Impact

Classified per the requested A/B/C/D taxonomy (A = existing route reused unchanged, preferred; D = new mutation route, avoided):

- **Category A (existing, unchanged)**: Leave pending-approvals list, Learning team-enrollments list, Performance team-reviews list, Assets team-assets list, Attendance register — all called internally by the new aggregation route(s), never duplicated.
- **Category C (new read/aggregation route required)**: `GET .../manager-portal/team` (Team Overview — no existing route returns enriched profile fields for direct reports, §9); `GET .../manager-portal/dashboard` (tile aggregation — no existing route spans 5 modules).
- **Category B (safe extension)**: none identified as necessary — every existing module route already returns what the portal needs at the data level; the "enrichment" gap is closed by the new Team Overview route joining employee names on top, not by modifying any existing module route.
- **Category D (new mutation route)**: **zero** — every action remains a deep-link to the module's own existing, unmodified mutation route (§23).

The new aggregation route(s) must call each module's own existing **service functions** (`lib/*.ts`), not re-implement their query logic, per §23.

## 28. Proposed Database Impact

**Zero new tables, zero schema changes. Expected next migration: NONE.** The Team Overview and dashboard aggregation are both pure reads over existing tables (`employees`, plus each module's own tables via their own existing service functions). No new column, no new index beyond what already exists (`employees_reporting_manager_idx` already covers the new canonical resolver's own query shape). If any future workstream discovers a genuine schema need, that is an Owner Decision at that time — not created here, not assumed here.

## 29. Proposed Permission Model

**[PROPOSED DESIGN DECISION]: Option A — no new permission.** Portal shell availability is derived entirely from a live relationship check (does the caller currently have ≥1 direct report?) plus the existing `manager_portal` module being enabled — mirroring the exact "broad grant + service-layer relationship narrowing, never a `.team` key" convention every one of the 5 already-built modules chose (§7). A `manager_portal.read` permission would be the first departure from this established convention and is not recommended. Each dashboard tile/action independently requires whatever permission its own underlying module already requires (e.g. seeing the Pending Leave Approvals tile still requires `leave_request.approve` — the portal grants nothing new). HR/admin access to the portal itself (viewing org-wide or another manager's team) is a **separate** question — see Owner Decision 4; if approved, it reuses each module's own existing `*.manage`-style org-wide permission tier, not a new one.

## 30. Manager Eligibility

**[PROPOSED DESIGN DECISION]: current manager-of-record only (live relationship), not a permission or role model** — there is no formal "manager" role to key off (§7), and every existing module already treats "is this caller a manager" as a pure relationship fact, never a role check. A caller with zero current direct reports still reaches the portal shell (module-enabled + authenticated) but sees a valid, explicitly-empty Team Overview and zero-filled dashboard — never an error, never an org-wide fallback — mirroring Assets'/Attendance's/Leave's own explicit "empty scope is valid" precedent (§3, §32).

## 31. Direct vs. Indirect Reports

**[PROPOSED DESIGN DECISION]: direct reports only for V1.** Zero recursive/multi-level hierarchy capability exists anywhere in this codebase today (§3) — building one would be a genuinely new, unprecedented query/schema capability, disproportionate to a portal that is meant to aggregate existing capability, not invent new hierarchy semantics. Not recommended for V1 under any circumstance short of an explicit, separately-scoped Owner request.

## 32. Manager Relationship Changes

When an employee's `reportingManagerId` changes, becomes inactive, or a manager loses all direct reports: the portal's own new surfaces (Team Overview, dashboard) must reflect the **live** relationship immediately, mirroring Assets'/Attendance's/Leave's own live-tier precedent — no caching, no stale membership. Performance's and Learning's own **snapshotted** manager-of-record fields are explicitly **not** to be touched or reinterpreted by the portal — an in-flight review/enrollment a caller was reviewer/manager-of-record for at creation time remains visible to them even after a live relationship change, exactly as those two modules already guarantee today. The portal must not apply one uniform "always live" rule across modules that intentionally differ (§6, §23).

## 33. Tenant Isolation (Future Requirement)

Organization-scoped throughout: every new route requires `requireMembership("organizationId")` + `requireModuleEnabled("manager_portal")`, with the caller's own employee id always server-resolved (never a client-supplied `employeeId`/`organizationId`), mirroring every `/me/*` and manager-scope route already shipped in this codebase. No cross-org id acceptance anywhere, no existence leak beyond established platform convention (404 for out-of-scope ids, never revealing whether a foreign id exists). ID classes requiring live cross-org QA in a future workstream: the caller's own employee id, every direct-report employee id surfaced in Team Overview, and every underlying module's own entity ids (leave request id, enrollment id, review id, asset id) reached via deep-link.

## 34. Proposed Frontend

**[PROPOSED DESIGN DECISION]: route `/manager-portal`.** Compared against existing naming: this codebase consistently uses hyphenated, descriptive route names (`/team-assets`, `/learning-team-training`, `/asset-workspace`, `/asset-reports`), never a bare single-word route for a major surface — `/manager-portal` is the most consistent with that convention; `/manager` risks ambiguity with a future "employee's own manager info" concept, and `/my-team` collides conceptually with the existing per-module "Team X" naming already used for module-specific pages (`team-assets.tsx`). Nav placement: a new top-level item, gated on the caller currently having ≥1 direct report (or HR/admin, if Owner Decision 4 approves), not folded into ESS `/self-service` (Manager Portal is architecturally closer to the existing `isHrCapable`-gated manager/HR surfaces than to the employee-own-data ESS pattern). **Existing dedicated manager pages (`/team-assets`, `/learning-team-training`, `/performance-team`, `/leave-approvals`, `/attendance-register`) are not removed or consolidated in V1** — the portal deep-links to them; removal/consolidation would require its own explicit Owner approval in a later phase.

## 35. Mobile / Responsive & Accessibility (Carried Forward, Not New)

Standard platform conventions apply, unchanged: card-based responsive layout (matching every existing dashboard), status communicated via text labels never color alone, keyboard-accessible controls, explicit loading/error/empty states per section (never a silently-empty section masking a permission denial), no new design system, no new mobile app.

## 36. Proposed Reporting

**[PROPOSED DESIGN DECISION]: zero new reports for V1.** The portal deep-links to each module's own existing manager-scoped report (Attendance/Performance/Learning/Assets each already ship reports with an own/manager-current-or-snapshot/org-wide tier, §20) rather than building a new manager-specific report suite. Smallest justified V1, matching the instruction to avoid a new reporting engine.

## 37. Proposed Audit Model

Portal reads remain audit-silent, matching every `/me/*` and existing dashboard/team-view route in this codebase. Every mutation continues to be a deep-link into the module's own existing route, which already emits its own correct audit event unchanged — the portal itself never emits a duplicate or portal-specific audit event for an action it did not itself perform.

## 38. Proposed Test Strategy (For Future Workstreams)

Manager eligibility (has reports / has none); direct-report scope correctness; a live relationship change immediately reflected; module-disabled behavior (shell and per-card, independently); cross-org isolation on every new route; denial when the caller lacks the underlying module's own permission for a given tile/deep-link; proof the portal never widens authority beyond the underlying module (e.g. a live HTTP attempt to mutate an Asset through any portal-originated call, expected denied exactly as `team-assets.tsx` already denies it); HR/admin behavior if Owner Decision 4 approves it; employee-with-zero-reports valid-empty case; a mixed-module organization (some modules enabled, some not) rendering only the enabled cards; and a regression proof that every existing dedicated manager page still functions unchanged.

## 39. Proposed Live QA Matrix (For Future Workstreams)

WWM + Acme, actors: a manager with multiple direct reports, a manager with exactly one, an employee with zero reports, HR manager, org admin, an unrelated manager, and a cross-org manager. Test every module-enabled/disabled combination against the dashboard's own per-tile omission. Test a live `reportingManagerId` change mid-session. Confirm WWM↔Acme isolation on the new Team Overview and dashboard routes specifically (the 5 underlying module routes already have their own independently-verified isolation from their own prior workstreams — not re-proven here, only the 2 new routes need fresh coverage). Not executed during this discovery pass.

## 40. Data / Security Baseline (Confirmed Non-Destructively During Discovery)

Confirmed live, read-only, no disposable records created: migration still `0040`, no `0041`; module registry has exactly 8 rows including the pre-existing `manager_portal` (`hidden`, zero organizations enabled); 80 total permissions, zero matching `manager.*`/`manager_portal.*`/`.team`; RLS 89/89 tables enabled, 0 disabled. Production was not connected to at any point.

---

## 41. Owner Decisions

Every decision below is genuinely unresolved by existing repository evidence. None are pre-approved.

### Decision 1 — Portal Architecture

**Question:** Aggregator (A) / Consolidated Operational Workspace (B) / Hybrid (C)?
**Evidence:** §22 full comparison. The pre-existing `manager_portal` registry description ("views and approvals") leans toward inline actions; the repository's own established anti-duplication discipline (§9, §23) leans toward deep-links only.
**Recommendation: Option C (Hybrid).** [PROPOSED DESIGN DECISION]

### Decision 2 — Manager Eligibility Model

**Question:** Current manager-of-record only, or a permission/role model?
**Evidence:** No formal "manager" role exists (§7); every existing module already treats this as a pure relationship fact.
**Recommendation: current manager-of-record only (live).** [PROPOSED DESIGN DECISION]

### Decision 3 — Direct Reports Only vs. Reporting Tree

**Evidence:** Zero recursive hierarchy capability exists anywhere today (§3, §31).
**Recommendation: direct reports only for V1.** [PROPOSED DESIGN DECISION]

### Decision 4 — HR/Admin Portal Access

**Question:** Should `org_admin`/`hr_manager` be able to view the portal (org-wide, or any specific manager's team)?
**Evidence:** Every existing dashboard already supports an org-wide tier for `*.manage`-permission holders (§3, §20) — architecturally "free" to extend, but a portal built *for* managers arguably need not also be an HR view.
**Recommendation: yes, reusing each module's own existing org-wide permission tier per tile — no new HR-specific portal code.** [PROPOSED DESIGN DECISION]

### Decision 5 — Modules Included in V1

**Evidence:** §10-16. Attendance/Leave/Performance/Learning/Assets all have real, reusable manager-scoped capability. Recruitment does not (hiring manager ≠ reporting manager, no manager-scoped route exists). Workforce/Scheduling does not exist at all.
**Recommendation: Attendance, Leave, Performance, Learning, Assets only. Recruitment and Workforce/Scheduling excluded from V1.** [PROPOSED DESIGN DECISION]

### Decision 6 — Inline Mutations vs. Deep-Links

**Question:** Does the portal embed any mutation UI directly, or deep-link exclusively to existing pages?
**Evidence:** The pre-existing registry description says "views and approvals" (§2) — direct evidence someone anticipated inline actions. This plan's own duplication-risk analysis (§22, §23) recommends against it.
**Recommendation: deep-links only for V1; no inline mutation forms, explicitly deferring "embedded approvals" to a later phase once the read-only shell is proven.** [PROPOSED DESIGN DECISION] — **this is the one decision where repository evidence and this plan's own recommendation most directly conflict; flagged for explicit Owner attention.**

### Decision 7 — Team Overview Fields

**Evidence:** §17-18, §25. `employee.read` already technically exposes far more than what's proposed here, but least-privilege-by-design is recommended regardless.
**Recommendation: name, employee number, position, department, branch, employment status, hasProfilePicture only.** Open sub-question: include phone/work-email or not? [PROPOSED DESIGN DECISION]

### Decision 8 — Pending Actions Aggregation Model

**Evidence:** §21. The `notifications` table has zero producers and is not a usable foundation as-is.
**Recommendation: dashboard-style read-time aggregation of each module's own existing pending-item queries; no new persistent task/notification engine in V1.** [PROPOSED DESIGN DECISION]

### Decision 9 — Dashboard Tile Set

**Evidence:** §26.
**Recommendation:** Direct Reports, Pending Leave Approvals, Pending Performance Actions, Pending Learning Approvals, Team Assets Outstanding, Absent/Late Today. [PROPOSED DESIGN DECISION]

### Decision 10 — Recruitment Inclusion

**Evidence:** §15 — no manager-scoped Recruitment capability exists today; including it requires new Recruitment authorization work, not aggregation.
**Recommendation: excluded from V1.** [PROPOSED DESIGN DECISION]

### Decision 11 — Workforce/Scheduling Inclusion

**Evidence:** §16 — the capability does not exist at all.
**Recommendation: excluded — nothing to aggregate.** Not a real decision, included for completeness.

### Decision 12 — Reporting Scope

**Evidence:** §20, §36.
**Recommendation: zero new reports; deep-link to each module's own existing reports.** [PROPOSED DESIGN DECISION]

### Decision 13 — New Permission vs. Zero New Permission

**Evidence:** §7, §29 — every existing module deliberately rejected a `.team` permission key.
**Recommendation: zero new permission (Option A).** [PROPOSED DESIGN DECISION]

### Decision 14 — New Backend Aggregation Endpoint vs. Client-Side Composition

**Evidence:** §20 — every existing dashboard in this codebase computes server-side; none aggregate client-side.
**Recommendation: new backend aggregation route(s) calling existing service functions server-side, matching established convention exactly.** [PROPOSED DESIGN DECISION]

### Decision 15 — Manager Access When Temporarily Zero Direct Reports

**Evidence:** §3, §30 — every existing module already treats this as a valid empty state, never an error, never an org-wide fallback.
**Recommendation: portal remains accessible, all sections show valid empty states.** [PROPOSED DESIGN DECISION]

---

## 42. Proposed V1 Boundaries (Explicit Exclusions)

Per discovery evidence, not invented merely to have a list: recursive/multi-level org hierarchy (§31); dotted-line/secondary managers (confirmed not to exist, §3); manager delegation of any kind; a persistent task/notification inbox engine (§21); custom notifications; bulk team actions; a new cross-module workflow engine; manager-specific reports (§36); employee private/confidential documents, compensation, banking (none of the latter two exist anywhere in this schema — confirmed, not merely deferred); disciplinary data (already HR-only, unchanged); payroll (does not exist in this codebase); succession planning; talent calibration; org-chart redesign; Recruitment participation (§15); Workforce/Scheduling (§16, does not exist); and any fix to the two disclosed pre-existing issues in §19 (manager-change audit gap; `employee.read`'s broad exposure) — both explicitly out of this plan's own scope, tracked separately.

## 43. Proposed Workstreams (Derived From Discovery, Not Assumed)

Continuing from W108. Five workstreams — proportional to the Hybrid architecture's own natural split (foundation/data → dashboard/actions aggregation → frontend shell → verification → completion), not adopted blindly from the prompt's own suggested shape.

### W109 — Manager Portal Foundation & Team Overview
**Scope:** Flip `manager_portal` `hidden → active` (module already exists in the registry, §2 — no new module row created). Resolve Owner Decisions 2/3/7/13/15. New canonical `resolveDirectReports`-style helper for the portal's own use only (§9 — does not touch the 8 pre-existing duplicated instances elsewhere). New `GET .../manager-portal/team` route (Category C, §27) returning the Decision-7 field set. No dashboard, no pending-actions aggregation, no frontend yet — backend-first, matching this codebase's own established workstream-splitting convention (e.g. W105 before W106).
**Database impact:** none.
**API impact:** 1 new route.
**Frontend impact:** none.
**Permissions:** zero new (Decision 13).
**Tests:** eligibility, direct-report scope, empty-team case, cross-org isolation, module-disabled.
**Live QA:** own-team read, zero-report manager, cross-org isolation.
**Definition of Done:** Team Overview data path proven end-to-end, live-verified.
**STOP boundary:** no dashboard, no deep-links yet. Do not begin W110 without its own separate go-ahead.

### W110 — Manager Portal Dashboard & Pending Actions Aggregation
**Scope:** Resolve Owner Decisions 8/9/14. New `GET .../manager-portal/dashboard` route (Category C) internally calling each module's own existing service functions verbatim (Category A reuse) for the Decision-9 tile set. No new mutation route of any kind (§23, §27).
**Database impact:** none.
**API impact:** 1 new route.
**Frontend impact:** none yet.
**Permissions:** zero new; each tile silently omitted if the caller lacks that module's own existing permission or the module is disabled.
**Tests:** per-tile correctness against each source module's own existing data, module-disabled per-tile omission, zero-widening-of-authority proof.
**Live QA:** full tile set against real data seeded through each module's own existing routes.
**Definition of Done:** dashboard aggregation proven accurate against independently-verified source-module data.
**STOP boundary:** no frontend yet. Do not begin W111 without its own separate go-ahead.

### W111 — Manager Portal Frontend
**Scope:** Resolve Owner Decisions 1/4/6. New `/manager-portal` page: Team Overview list, dashboard tile cards, deep-links to the 5 existing manager pages. Nav entry gated on live eligibility (or HR/admin, if Decision 4 approved). No inline mutation UI (Decision 6, unless the Owner's freeze reverses it, in which case this workstream's own scope would need revision before proceeding).
**Database impact:** none.
**API impact:** none (consumes W109/W110's routes).
**Frontend impact:** new page + nav entry.
**Tests:** loading/error/empty states, deep-link correctness, no mutation control present (if Decision 6 stands), existing dedicated manager pages unaffected.
**Live QA:** full manager walkthrough, HR/admin walkthrough (if Decision 4 approved).
**Definition of Done:** the full V1 Hybrid surface live and navigable.
**STOP boundary:** no W112 without its own separate go-ahead.

### W112 — Manager Portal Verification
**Scope:** Full integrated verification mirroring W93/W103/W107's own exact charter — functional, authorization (including the cross-module authority-non-widening invariant, §23), tenant isolation, module gating, regression across all 5 underlying modules' own existing pages, one integrated live-QA lifecycle per §39.
**Definition of Done:** matches W93/W103/W107's own template exactly.
**STOP boundary:** report PASS / PASS WITH FIXES / BLOCKED. Do not begin W113 without its own separate go-ahead.

### W113 — Manager Portal Completion Report
**Scope:** Formal closure, mirroring W94/W104/W108's own exact structure. Closes the Phase 3 ("Workforce Operations") roadmap list in full.
**Definition of Done:** `PROJECT_STATUS.md` updated; Phase 3 marked complete only if every requirement genuinely delivered.
**STOP boundary:** the final Manager Portal workstream. Do not begin the next roadmap tier (Future Expansion) without its own separate planning/freeze cycle.

## 44. Expected Migration

**None**, under every recommended default in this draft. Migration remains `0040`. If the Owner's eventual freeze changes Decision 1/6 toward inline mutations requiring new state, or Decision 7 toward fields genuinely not present anywhere in the existing schema, this plan would need a revision pass before implementation — not assumed here. Compensation/banking do not exist anywhere in this schema today, confirmed, not merely unconfirmed.

---

**This document is a DRAFT for Owner review only. No implementation, migration, route, permission, module-registry change, or frontend change has been made as part of producing this document.**
