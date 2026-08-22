# Phase 3F — Employee Self Service Completion Implementation Plan

**Status: DRAFT — NOT APPROVED FOR IMPLEMENTATION**

This document is the output of a repository-grounded discovery pass, not a frozen plan. Nothing in this document authorizes writing code. It exists so the Owner can review the findings, resolve the Owner Decisions in §7, and freeze (or redirect) the plan before any workstream begins.

Naming note: `ROADMAP.md`'s own Phase 3 ("Workforce Operations") list is Recruitment → Attendance → Leave → Performance → Learning → Assets → **Employee Self Service** → Manager Portal. Recruitment/Attendance/Performance/Learning/Assets shipped as Phase 3A/3B/3C/3D/3E respectively (Leave shipped earlier, in Phase 2B). This document continues that lettering as **Phase 3F**, matching the established `docs/PHASE_3[A-E]_*_IMPLEMENTATION_PLAN.md` naming convention exactly. Workstream numbering continues from the last-used number, **W105**, per `PROJECT_STATUS.md`'s own continuous numbering across every phase to date.

---

## 1. What This Phase Closes

`PROJECT_STATUS.md` has carried the same unresolved item since Phase 2B, restated unchanged through Phase 3A and never touched by Phase 3B–3E:

> "W39 — employment-history aggregation into Employee Self-Service (W25–W27's `employment_periods`, via `listEmploymentPeriods`) — deferred, not completed. Remains open pending separate approval."
> "W39 — skills/qualifications/certifications aggregation into Employee Self-Service (W24's `employee_skills`/`employee_qualifications`/`employee_certifications`) — deferred, not completed. Remains open pending separate approval."
> — `PROJECT_STATUS.md:1328-1329`

Both were explicit, approved scope exclusions from Phase 2B's own W39 (Employee Self-Service, narrowed scope) — not defects. No later phase closed either item; each later phase's own module-gated ESS tab (Attendance/Performance/Learning/Assets) added only its own module's own-scope data, never touching these four entities. This plan closes both bullets.

## 2. Verified Current State (repository-grounded, not assumed)

**`/self-service` (`artifacts/hrms/src/pages/employee-self-service.tsx`, 2209 lines)** currently has 9 tabs: My Profile (read-only by design), My Attendance, My Performance, My Learning, My Assets, My Leave, My Documents (read-only), Internal Vacancies, My Applications. Every later-phase tab independently checks its own module key via `isModuleAccessible(modules, '<key>')`; the page itself is gated server-side by the `employee_self_service` module on `GET /me/employee`. **There is no tab, section, or reference anywhere in this file to employment history, skills, qualifications, or certifications.**

**Employment history** — `employment_periods` (`lib/db/src/schema/employment-periods.ts`): one append-only table (`eventType` free text — `transfer`/`promotion`/`confirmation`), written by `transferEmployee`/`promoteEmployee`/`confirmEmployee` (`artifacts/api-server/src/lib/employees.ts`) via the shared `recordEmploymentPeriodEvent` (`lib/employmentLifecycleService.ts:25-62`). A read function `listEmploymentPeriods` exists (`lib/employmentLifecycleService.ts:65-71`, org+employee scoped) but **is never called by any route** — not by HR, not by self-service. Nobody in the product can currently see this data rendered anywhere, including HR.

**Skills / Qualifications / Certifications** — `employee_skills`, `employee_qualifications`, `employee_certifications` (`lib/db/src/schema/employee-{skills,qualifications,certifications}.ts`) each already have full CRUD: routes in `artifacts/api-server/src/routes/employeeSkillsQualifications.ts` (12 routes total) and HR-admin frontend in `artifacts/hrms/src/pages/employee-detail.tsx` (three cards with add/list/remove). **The gap is purely the self-service read surface** — none of this is exposed to the employee's own view today.

**A genuine pre-existing authorization gap, found during this discovery, not previously known:** all 12 skills/qualifications/certifications routes are gated only by the flat `employee.read`/`employee.write` permissions, with a client-supplied `:employeeId` path param and **no own-scope narrowing of any kind** — unlike every later Phase 3 module (Attendance/Performance/Learning/Assets), which all mint a dedicated `<resource>.read.own`/`.write.own` pair and resolve the caller's own employee id server-side via a `resolveOwn*EmployeeId`-style function that ignores any client-supplied id. Concretely: the `employee` role already holds `employee.read` (but not `employee.write`) — so any employee-role user hitting `GET /organizations/:orgId/employees/:employeeId/skills` with a coworker's `:employeeId` would currently succeed, org-wide, not own-scope-limited. No frontend surface calls this today, so it is dormant rather than actively exploited, but it is real and live in the shipped API surface. **This plan does not silently fix it** — see §7, Owner Decision 6.

**`learning_certificates` (Phase 3D) is deliberately kept structurally separate from `employee_certifications`** — Learning's own Owner Decision 3, stated explicitly in `lib/db/src/schema/learning-certificates.ts:10-24`: "A DISTINCT, Learning-owned model — deliberately never merged with the existing `employee_certifications` table... No cross-write, no FK between the two tables." `learning_certificates` is already shown in My Learning's "My Certificates" card. This precedent must be preserved: any new certifications surface shows both, clearly separated, never merged into one list.

**No document/evidence attachment exists** for any of the four entities today. Two reusable patterns already exist elsewhere in the codebase if evidence attachment is ever wanted: a many-per-record join table (`asset_evidence`/`learning_enrollment_evidence` shape) or a single nullable FK column (`learning_certificates.employeeDocumentId` shape). Neither is proposed for V1 — see §6, §7 Owner Decision 5.

**Zero test coverage exists today** for any self-service view of this data, frontend or backend.

## 3. What "ESS Completion" Means Here

The deferred item's own wording is "aggregation... into Employee Self-Service" — a read-surfacing gap, not a request to rebuild HR master-data administration (which already fully exists for three of the four entities). The smallest coherent scope that genuinely closes both W39 bullets is:

1. A new, properly own-scoped read path for all four entities (employment history, skills, qualifications, certifications), reusing every existing table and every existing HR-side write path verbatim.
2. A new tab (or tab group) inside the existing `/self-service` page surfacing that data.
3. Closing the incidental HR-side gap that even HR cannot currently see rendered employment history (a one-card addition to the already-existing `employee-detail.tsx`, reusing the already-existing `listEmploymentPeriods` function — not a new feature, just wiring an orphaned read function to a UI).

Nothing else is required to close the two W39 bullets as written.

## 4. Explicit Non-Scope (V1)

- No new HR administration surface for employment history (Transfer/Promote/Confirm already exist and are unaffected).
- No merging of `learning_certificates` and `employee_certifications`.
- No document/evidence attachment for skills/qualifications/certifications/employment-history (deferred; see Owner Decision 5).
- No new dashboard, no new reports (the deferred item never asked for either — see §11, §12).
- No coupling to Learning (Learning's own zero-automatic-skill-grant boundary is preserved unchanged).
- No fix to the pre-existing HR-route own-scope gap described in §2/§7 Decision 6, beyond disclosure — that is flagged as separately-approvable technical debt, not silently bundled into this phase's scope.
- No new module. Core HR data (My Profile, My Documents) is already ungated inside `/self-service`; this data follows the identical precedent (see §7 Decision 7).
- No Manager Portal work of any kind (separate, not-yet-planned roadmap item).

## 5. Authorization Design (proposed, pending Owner Decision 6/7)

Recommendation: **do not reuse the existing flat `employee.read`/`employee.write` HR routes for the new self-service surface.** Mint a new pair matching the established, consistent naming convention already used identically by every other Phase 3 module:

- `employee.read.own` — new. Grants read of the caller's own skills/qualifications/certifications/employment-history only.
- No write permission is proposed for V1 (see Owner Decision 1 — if Owner selects an editable/submit-for-approval model instead of read-only, a `.write.own` companion and schema changes would follow; not built here until that decision is made).

New routes live under `/me/*` (mirroring `/me/employee`'s own precedent exactly — no permission key at all is even strictly required there, since `/me/*` routes already resolve identity via `resolveOwnEmployeeProfile`-style functions and are gated purely by `employee_self_service` module + authentication). Given the existing `/me/*` precedent uses no discrete permission key, **Owner Decision 7** below asks whether to follow that exact precedent (simplest, zero new permission) or mint `employee.read.own` anyway for consistency with Attendance/Performance/Learning/Assets' own explicit-permission pattern. Either way, the caller's own employee id is always server-resolved (via a new `resolveOwnEmployeeId`-shaped helper in `lib/employeeSelfService.ts`, reusing `resolveOwnEmployeeProfile`'s existing internal lookup), never trusted from a client-supplied `:employeeId`.

## 6. Database Impact

**Preferred outcome: zero new tables, zero new migration.** All four entities already exist with full org/employee ownership and adequate columns for a read-only V1. `drizzle-kit generate` is expected to report "No schema changes, nothing to migrate," and migration stays at `0040` unless Owner Decision 1 or 5 (below) requires an additive column/table.

**Conditional impact, only if Owner approves it:**
- Owner Decision 1 (employee-submitted, pending HR approval) would require one additive `status` enum column (`pending`/`approved`/`rejected`) plus a `submittedByMembershipId` column on each of `employee_skills`/`employee_qualifications`/`employee_certifications` — three additive `ALTER TABLE` statements, one migration (`0041`), no data loss, no table rewrite.
- Owner Decision 5 (evidence attachment) would require one new join table per the `asset_evidence` shape, or a nullable FK column per the `learning_certificates.employeeDocumentId` shape — either way, additive only.

**Do not create migration `0041` during this discovery pass or before Owner freeze**, regardless of which option is eventually approved.

## 7. Owner Decisions Requiring Approval

Every decision below is genuinely unresolved by existing repository evidence — none are pre-chosen.

### Decision 1 — Employee edit rights on Skills/Qualifications/Certifications

**Question:** Can the employee add/edit their own skills, qualifications, and certifications directly, or are these strictly HR-authored records the employee can only view?
**Evidence:** Today, all three are HR-write-only via `employee-detail.tsx`. Nothing in the deferred item's own wording ("aggregation... into Employee Self-Service") implies employee editability — it reads as a visibility gap, not a write-access request.
**Option A (recommended default):** Employee read-only. HR continues to be the sole writer via the existing `employee-detail.tsx` CRUD. Zero schema change, zero new write route, matches the "aggregation" wording literally.
**Option B:** Employee-submitted, pending HR approval/verification (new `status` column, new approval workflow, new HR review queue). Materially larger scope — closer to a new mini-module than a completion of an existing gap.
**Consequence:** Option A ships in roughly two workstreams; Option B requires additional workstreams for the approval workflow and a schema migration.
**Recommended default: Option A.**

### Decision 2 — Employment History employee visibility scope

**Question:** Should the employee see the full raw `employment_periods` feed (every transfer/promotion/confirmation with its `previousState`/`newState` JSON), or a simplified, HR-approved-for-display summary?
**Evidence:** `employment_periods.previousState`/`newState` are raw JSON snapshots of whatever fields changed (department/branch/position/status) — not currently formatted for end-user display anywhere, since no UI reads this table at all today (§2).
**Option A (recommended default):** Show the full history, formatted into plain-language rows (e.g. "Transferred to Finance — 2026-03-01"), reusing the existing `eventType`/`previousState`/`newState` fields directly — no new data, just a rendering layer.
**Option B:** Hide certain event types or fields from the employee's own view (e.g. suppress `confirmation` events, or redact salary-adjacent fields if any are ever added to `newState`).
**Consequence:** Option A is a pure read/format task. Option B requires defining a redaction policy that does not exist anywhere in the codebase today.
**Recommended default: Option A** — nothing in `employment_periods`' current fields is sensitive beyond what the employee already implicitly knows about their own history.

### Decision 3 — Certifications: Learning + external, shown together or separately?

**Question:** Should the new Certifications view show `employee_certifications` (external/manual) and `learning_certificates` (system-issued, already shown in My Learning) in one merged list, or keep them visually separate?
**Evidence:** Learning's own Owner Decision 3 (`learning-certificates.ts:10-24`) is explicit that the two tables must never be merged at the data layer. `learning_certificates` already has its own card in My Learning.
**Option A (recommended default):** Keep them fully separate. The new tab shows only `employee_certifications` (external/manual credentials); `learning_certificates` stays exactly where it already is, in My Learning's own existing card. No duplication, no merged UI list.
**Option B:** Add a second "System-Issued Certificates" section to the new tab that also displays `learning_certificates` (read-only, reusing the existing `useListMyLearningCertificates` hook), so an employee has one place to see all certificates, clearly labeled by source.
**Consequence:** Option A is simpler and changes nothing about My Learning. Option B duplicates a read-only view Learning already ships, purely for UX convenience.
**Recommended default: Option A**, unless the Owner specifically wants a single "all my certificates" consolidated view.

### Decision 4 — Expired certifications visibility

**Question:** Do expired `employee_certifications` rows (past `expiryDate`) remain visible to the employee, or are they hidden/archived from the self-service view?
**Evidence:** `employee_certifications.expiryDate` is a plain nullable timestamp with no status/archival column; nothing in the schema or existing HR UI currently hides expired rows (`employee-detail.tsx`'s own Certifications card lists everything unconditionally).
**Option A (recommended default):** Always visible, with an expired/active label computed live (mirroring `learning_certificates`' own already-established live-computed active/expired/revoked pattern) — no data hidden, no new column.
**Option B:** Hide expired certifications by default behind a toggle.
**Consequence:** Option A is zero-new-logic beyond a date comparison already proven elsewhere in the codebase. Option B requires new UI state with no existing precedent to reuse.
**Recommended default: Option A.**

### Decision 5 — Evidence/document attachment

**Question:** Should employees (or HR) be able to attach a supporting document (e.g. a diploma PDF, a certification scan) to a qualification or certification record?
**Evidence:** No such attachment exists today for any of the four entities. Two reusable patterns exist elsewhere (`asset_evidence`-style join table, or `learning_certificates.employeeDocumentId`-style nullable FK) — either would require an additive schema change.
**Option A (recommended default):** Out of V1 scope entirely. The deferred item's own wording is about "aggregation," not evidence capture; `employee_documents`'s existing generic "My Documents" tab already gives employees a place to view (not attach) HR-uploaded documents, which is sufficient for V1.
**Option B:** Add evidence attachment now, following the `learning_certificates.employeeDocumentId` (single nullable FK) shape for simplicity, or the `asset_evidence` (join table, multi-file) shape for flexibility.
**Consequence:** Option A ships with zero schema change. Option B adds one additive migration and materially expands scope (upload UI, validation reuse, authenticated download reuse, cleanup discipline).
**Recommended default: Option A** — can be proposed as its own small follow-up phase later if wanted.

### Decision 6 — Existing HR-route authorization gap

**Question:** Should the pre-existing lack of own-scope narrowing on the 12 existing `employeeSkillsQualifications.ts` HR routes (§2 — any `employee`-role user can currently GET any coworker's skills/qualifications/certifications, not just their own) be hardened as part of this phase, or tracked separately?
**Evidence:** This is a real, live, already-shipped gap discovered during this research pass, not introduced by this plan. It predates Phase 3F entirely (Phase 2A/W24).
**Option A (recommended default):** Track it separately, disclosed here, not bundled into Phase 3F's own scope — Phase 3F only adds new, correctly-scoped `/me/*` routes; the existing HR routes are left exactly as they are, pending a dedicated decision on whether/how to hardened them (e.g. requiring `employee.write` — which `employee` role members do not hold — be checked even for the read routes, or minting a proper `employee.read.team`/manager tier).
**Option B:** Fix it now, inside Phase 3F, by adding own-scope/manager-scope narrowing to the existing 12 routes.
**Consequence:** Option A keeps Phase 3F's blast radius small and auditable. Option B risks silently changing already-shipped HR-admin behavior (e.g. if any current legitimate HR workflow relies on the current unscoped read) without its own dedicated review.
**Recommended default: Option A**, with this finding formally logged in `PROJECT_STATUS.md` as a disclosed, separately-trackable item (not silently left undocumented).

### Decision 7 — New permission key vs. `/me/*` no-permission precedent

**Question:** Should the new self-service read routes mint a discrete `employee.read.own` permission (matching Attendance/Performance/Learning/Assets' own explicit-permission convention), or follow `/me/employee`'s own existing precedent of no permission key at all (module-gate + server-resolved-identity only)?
**Evidence:** Both patterns are already established and live in the codebase (see §5).
**Option A (recommended default):** Mint `employee.read.own`, for consistency with every other Phase 3 module and for future-proofing (e.g. if a manager-of-record tier is ever wanted later, having a real permission key to extend is easier than retrofitting one).
**Option B:** No new permission — follow `/me/employee`'s exact precedent (module gate only).
**Consequence:** Option A is one additive permission-seed row, fully consistent with the rest of the platform. Option B is marginally simpler but inconsistent with every other Phase 3 module's own "own" tier.
**Recommended default: Option A.**

---

## 8. Proposed Frontend Design

Recommendation: **one new "Career Profile" tab** inside the existing `/self-service` page (not four separate tabs, not a separate page/route), containing four clearly labeled sections in this order: Employment History, Skills, Qualifications, Certifications. This matches the deferred item's own framing ("aggregation" — one consolidated place), keeps the existing 9-tab structure from growing unwieldy, and mirrors the same "one page, many cards" layout `employee-detail.tsx` already uses for the equivalent HR-admin view. The tab is **ungated by any additional module** (matching My Profile/My Documents' own precedent — all four entities are Core HR, not tied to any Phase 3 module), reachable whenever `employee_self_service` itself is enabled and the caller is linked to an employee record. Read-only throughout for V1 (per Decision 1 Option A).

## 9. Proposed API Impact

New routes only — no existing route is modified or removed.

| Method + Path | Permission | Scope | Reason |
|---|---|---|---|
| `GET /me/employment-history` | `employee.read.own` (pending Decision 7) | Own employee only, server-resolved | Surfaces the already-existing, currently-orphaned `listEmploymentPeriods` |
| `GET /me/skills` | `employee.read.own` | Own employee only | New own-scoped read over existing `employee_skills`, reusing `listEmployeeSkills` |
| `GET /me/qualifications` | `employee.read.own` | Own employee only | Reuses existing `listEmployeeQualifications` |
| `GET /me/certifications` | `employee.read.own` | Own employee only | Reuses existing `listEmployeeCertifications` |

Existing routes explicitly **not** duplicated or modified: all 12 `employeeSkillsQualifications.ts` HR routes stay exactly as they are (see Decision 6); `employees.ts`'s `transferEmployee`/`promoteEmployee`/`confirmEmployee` stay exactly as they are.

If Decision 1 resolves to Option B (employee-submitted), additional `POST`/`PATCH` routes under `/me/*` with an approval workflow would be designed in a follow-up revision of this plan — not included above.

## 10. Proposed HR-Side Gap Closure

`employee-detail.tsx` already has full CRUD for Skills/Qualifications/Certifications but **no employment-history display at all** — not a new feature, an existing orphaned read function (`listEmploymentPeriods`) with no UI consumer anywhere. Proposed: add one read-only "Employment History" card to `employee-detail.tsx`, reusing `listEmploymentPeriods` via a new thin HR-facing route (`GET /organizations/:organizationId/employees/:employeeId/employment-history`, `employee.read`, matching the existing HR-route permission convention exactly) — this is the natural, minimal companion to giving the employee their own read view, and is the only way to actually verify a Transfer/Promote/Confirm action produced a sane history entry before shipping the employee-facing version.

## 11. Reporting / Dashboard Impact

**None proposed.** The deferred item asks only for ESS aggregation; the Reporting Foundation (ADR-016) has no existing employment-history/skills/qualifications/certifications report definitions, and nothing in the roadmap or `PROJECT_STATUS.md` calls for one. Not recommended for this phase.

## 12. Reporting Foundation / Generic Runner

No interaction — this phase adds no report keys, no dashboard tiles.

## 13. Historical Integrity Strategy

`employment_periods` rows are already immutable/append-only (no update/delete path exists anywhere in the codebase) — this property is preserved unchanged; the new read route adds no mutation. `previousState`/`newState` JSON snapshots already capture the values at the moment of the event, so a later change to (for example) a department's name would not retroactively alter historical entries, since departments are referenced by id, and the snapshot captures the id/value at write time — this matches every other Phase 3 module's own snapshot-at-write-time convention (assignment snapshots in Assets, review snapshots in Performance, enrollment snapshots in Learning). Skills/qualifications/certifications rows are live, mutable HR-maintained records (per Decision 1 Option A) — there is no "historical" version of these to preserve; they simply reflect current HR-recorded state, exactly as `employee-detail.tsx` already treats them today.

## 14. Tenant Isolation Strategy

Every new route resolves the caller's own employee id server-side (never trusts a client-supplied `:employeeId`) exactly like `/me/employee` already does, and every underlying query is already `organizationId`-scoped in the existing lib functions (`listEmploymentPeriods`, `listEmployeeSkills`, `listEmployeeQualifications`, `listEmployeeCertifications`) — reused verbatim, not reimplemented. Live QA (see §16) will verify WWM ↔ Acme isolation explicitly for all four new routes, plus confirm an employee cannot reach another employee's data through the new routes (impossible by construction, since no route accepts a caller-supplied employee id at all — verified, not merely asserted).

## 15. Proposed Workstreams

Continuing numbering from W104. Four workstreams proposed — proportional to the actual gap found (a read-surfacing task over already-existing, already-validated data), not padded.

### W105 — Foundation, Authorization & Employment History
**Scope:** Resolve Owner Decisions 2, 6, 7 into code. Mint `employee.read.own` (if Decision 7 = Option A). New `resolveOwnEmployeeId`-shaped helper in `lib/employeeSelfService.ts`. New route `GET /me/employment-history` (own-scope, reuses `listEmploymentPeriods` verbatim). New HR-side route + `employee-detail.tsx` card per §10 (closes the "even HR can't see this" gap). No skills/qualifications/certifications work yet.
**Database impact:** none (zero schema change) unless Decision 2 requires field-level redaction logic — expected none.
**API impact:** 2 new routes (`/me/employment-history`, HR-side history read).
**Frontend impact:** one new card in `employee-detail.tsx`; no ESS frontend yet (backend-first, per this codebase's own established workstream-splitting convention).
**Permissions used:** `employee.read.own` (new), `employee.read` (existing, HR route).
**Tests:** own-scope enforcement, cross-org denial, unlinked-employee empty state, HR-route permission check.
**Live QA:** own employee sees their own history; unrelated employee denied; HR sees the same data via the new admin card; WWM↔Acme isolation.
**Definition of Done:** both W39 employment-history bullets' data path proven end-to-end, live-verified.
**STOP boundary:** no skills/qualifications/certifications routes yet. Do not begin W106 without its own separate go-ahead.

### W106 — Skills / Qualifications / Certifications ESS Integration
**Scope:** Resolve Owner Decisions 1, 3, 4 into code. New routes `GET /me/skills`, `GET /me/qualifications`, `GET /me/certifications` (own-scope, reuse existing list functions verbatim). New "Career Profile" tab in `employee-self-service.tsx` (§8) with all four sections (Employment History from W105 + these three), live-computed expired/active certification labels, `employee_certifications` and `learning_certificates` kept visually separate per Decision 3.
**Database impact:** none, if Decision 1 = Option A (expected).
**API impact:** 3 new `/me/*` routes.
**Frontend impact:** new "Career Profile" tab, 4 sections, read-only.
**Permissions used:** `employee.read.own`.
**Tests:** own-scope enforcement for all 3 new routes, cross-org denial, module-gate behavior (page-level `employee_self_service` only, no additional module), certifications-separation regression test (confirms `employee_certifications` and `learning_certificates` never merge in the response/UI), existing 9-tab regression suite re-run clean.
**Live QA:** full Career Profile tab render for a real employee with data in all four categories; unrelated employee denial on all 3 routes; WWM↔Acme isolation; expired-certification display; existing ESS tabs (Attendance/Performance/Learning/Assets/Leave/Documents/Recruitment) regression-checked unaffected.
**Definition of Done:** both W39 bullets fully closed, both halves (employment history from W105, skills/qualifications/certifications from W106) live in one consolidated ESS tab.
**STOP boundary:** no evidence/document attachment (Decision 5 = Option A), no employee-editability (Decision 1 = Option A), no HR-route hardening (Decision 6 = Option A). Do not begin W107 without its own separate go-ahead.

### W107 — Phase 3F Verification
**Scope:** Full integrated verification pass mirroring W93/W103's own exact charter — functional, authorization, tenant isolation, historical integrity, regression (backend + frontend full suites), typecheck (both root and full-build paths), production builds, OpenAPI/codegen determinism, one integrated live-QA lifecycle. Verification-only, no new scope.
**Definition of Done:** matches W93/W103's own template exactly.
**STOP boundary:** report PASS / PASS WITH FIXES / BLOCKED. Do not begin W108 without its own separate go-ahead.

### W108 — Phase 3F Completion Report
**Scope:** Formal closure, mirroring W94/W104's own exact structure. Update `PROJECT_STATUS.md` to close both W39 bullets explicitly (quoting them as closed, not merely superseded), record final module/permission/route/test totals, restate the still-open **Manager Portal** roadmap item as the next unresolved Phase 3 gap.
**Definition of Done:** `PROJECT_STATUS.md` updated, both original W39 deferrals marked closed only if genuinely delivered.
**STOP boundary:** the final Phase 3F workstream. Do not begin Manager Portal planning without its own separate go-ahead.

## 16. Proposed Live QA (draft scenarios, not executed during this discovery pass)

- Employee A sees their own employment history, skills, qualifications, certifications (including a live expired-certification label) via the new Career Profile tab.
- Employee B (unrelated) is denied all 4 new routes when attempting to fetch Employee A's data by id (impossible by construction — routes accept no caller-supplied employee id — verified, not merely asserted).
- Manager M has no special access via these new routes (no manager tier is proposed — Owner Decisions do not introduce one).
- HR sees the same employment-history data via the new `employee-detail.tsx` card, confirming a live Transfer/Promote/Confirm action is correctly reflected.
- WWM ↔ Acme isolation on all 4 new routes, both directions.
- `employee_self_service` module-disabled → all 4 routes and the new tab correctly unavailable (existing `/me/*` module-gate precedent).
- No evidence/document IDOR scenario applies (Decision 5 = Option A, out of scope).
- Historical integrity: a live department/position rename after an existing `employment_periods` row is written must not alter that row's own `previousState`/`newState` snapshot.
- Full regression pass across all 9 existing `/self-service` tabs, confirming zero behavior change to Attendance/Performance/Learning/Assets/Leave/Documents/Recruitment.

No QA data is created during this discovery/planning pass.

## 17. Expected Next Migration

**None expected** for the recommended Owner Decision defaults (Decision 1/5 = Option A each). Migration remains `0040` through W105–W108. If the Owner instead selects Decision 1 Option B or Decision 5 Option B, this plan would need a revision pass before implementation, including a real `0041` migration design — not created here.

## 18. Issues / Ambiguities Disclosed

1. The pre-existing HR-route own-scope authorization gap (§2, Decision 6) — real, live, predates this plan, disclosed rather than silently fixed or silently ignored.
2. `ROADMAP.md` itself never restates the deferred item — it is tracked only in `PROJECT_STATUS.md`. No inconsistency was found between the two documents once this is accounted for; `ROADMAP.md`'s own Phase 3 list still correctly names "Employee Self Service" as a not-yet-fully-delivered item.
3. Decision 3/4's "recommended default" assumes the Owner wants the smallest possible surface; if the Owner instead wants a single consolidated "all my certificates" view (Decision 3 Option B), the workstream sequence above does not change, only the tab's internal layout.

---

**This document is a DRAFT for Owner review only. No implementation, migration, route, permission, or frontend change has been made as part of producing this document.**
