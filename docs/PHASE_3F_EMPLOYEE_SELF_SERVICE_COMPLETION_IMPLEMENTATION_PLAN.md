# Phase 3F — Employee Self Service Completion Implementation Plan

**Status: FROZEN — APPROVED FOR IMPLEMENTATION**
**Freeze date: 2026-08-22**

This document was produced by a repository-grounded discovery pass, then reviewed and resolved by the Owner. All seven Owner Decisions below are final. Nothing in this document is a "TBD" or "pending" — every choice that affects implementation has an explicit, final answer. Sections are labeled to distinguish **Discovery Finding** (what the repository already contains, unchanged by review), **Owner Decision** (the resolution reached in this freeze session), and **Final Frozen Requirement** (the exact, binding scope for implementation).

Naming note: `ROADMAP.md`'s own Phase 3 ("Workforce Operations") list is Recruitment → Attendance → Leave → Performance → Learning → Assets → **Employee Self Service** → Manager Portal. Recruitment/Attendance/Performance/Learning/Assets shipped as Phase 3A/3B/3C/3D/3E respectively (Leave shipped earlier, in Phase 2B). This document continues that lettering as **Phase 3F**, matching the established `docs/PHASE_3[A-E]_*_IMPLEMENTATION_PLAN.md` naming convention exactly. Workstream numbering continues from the last-used number, **W105**.

---

## 1. What This Phase Closes

`PROJECT_STATUS.md` has carried the same unresolved item since Phase 2B, restated unchanged through Phase 3A and never touched by Phase 3B–3E:

> "W39 — employment-history aggregation into Employee Self-Service (W25–W27's `employment_periods`, via `listEmploymentPeriods`) — deferred, not completed. Remains open pending separate approval."
> "W39 — skills/qualifications/certifications aggregation into Employee Self-Service (W24's `employee_skills`/`employee_qualifications`/`employee_certifications`) — deferred, not completed. Remains open pending separate approval."
> — `PROJECT_STATUS.md:1328-1329`

Both were explicit, approved scope exclusions from Phase 2B's own W39 (Employee Self-Service, narrowed scope) — not defects. No later phase closed either item. This plan closes both bullets.

## 2. Verified Current State (Discovery Finding — unchanged)

`/self-service` (`artifacts/hrms/src/pages/employee-self-service.tsx`) has 9 tabs today, none referencing employment history, skills, qualifications, or certifications. `employment_periods` (employment history) has a working append-only write path (Transfer/Promote/Confirm) but its own read function `listEmploymentPeriods` is orphaned — no route, HR or employee, calls it. `employee_skills`/`employee_qualifications`/`employee_certifications` already have full HR-admin CRUD (`routes/employeeSkillsQualifications.ts`, 12 routes; `employee-detail.tsx`, 3 cards) but no self-service read surface. `learning_certificates` remains deliberately, structurally separate from `employee_certifications` per Learning's own Owner Decision 3. No document/evidence attachment exists for any of the four entities. Zero test coverage exists today for any self-service view of this data.

**A genuine pre-existing authorization gap was found**: all 12 `employeeSkillsQualifications.ts` routes are gated only by the flat `employee.read`/`employee.write` permissions with a client-supplied `:employeeId` and no own-scope narrowing. The `employee` role holds `employee.read` (not `employee.write`) — so an ordinary employee could currently `GET` a coworker's skills/qualifications/certifications, org-wide, via these routes. No frontend surface calls this today as an employee. **This is fixed in this frozen plan — see §5 and Decision 6.**

## 3. Final V1 Scope

1. A new, properly own-scoped, server-derived read path for all four entities (employment history, skills, qualifications, certifications), reusing every existing table and every existing HR-side write path verbatim.
2. A new "Career Profile" tab inside the existing `/self-service` page, four read-only sections.
3. A one-card HR-side gap closure in `employee-detail.tsx` (employment history has never been visible to HR either — Transfer/Promote/Confirm write to it, nothing renders it).
4. Authorization hardening of the 3 currently-unscoped GET routes in `employeeSkillsQualifications.ts` (§5).

## 4. Explicit Non-Scope (V1) — Final

- No employee create/edit/delete/verify/approve on any of the four entities, ever, through ESS (Owner Decision 1).
- No employee submission/approval workflow (Owner Decision 1).
- No merging or duplication of `learning_certificates` into Career Profile (Owner Decision 3).
- No synchronization between `learning_certificates` and `employee_certifications` (Owner Decision 3).
- No automatic `employee_skills` writes from Learning course/certificate completion (§7, Owner direction).
- No document/evidence attachment or upload workflow for any of the four entities (Owner Decision 5).
- No external previous-employer history — `employment_periods` only models internal movement (transfer/promotion/confirmation); external prior-employer history is not represented by the current schema and is explicitly **deferred**, not built (Owner Decision 2 refinement).
- No new dashboard, no new reports (Owner direction §18).
- No new module; Career Profile lives inside the existing `employee_self_service`-gated `/self-service` page, ungated by any additional module key (Owner direction §14).
- No manager Career Profile view, no manager impersonation of `/me/*`, no new `.read.team` permission, no manager mutation authority (Owner Decision, §12). Manager Portal remains a separate, not-yet-planned roadmap item.
- No new permission of any kind (Owner Decision 7 — superseded from the draft's own recommendation; see below).
- No change to `employees.ts`'s `transferEmployee`/`promoteEmployee`/`confirmEmployee` write logic.

## 5. Authorization Design — FINAL

### New `/me/*` routes: zero new permission (Owner Decision 7 — SUPERSEDED BY OWNER DIRECTION)

The draft's own recommended default (mint `employee.read.own`) is **superseded**. `GET /me/employee` already establishes a safe, existing, zero-permission pattern for own-scoped self-service data: `requireAuth → requireActiveOrganizationMembership → requireModuleEnabled("employee_self_service")`, with identity resolved server-side via `resolveOwnEmployeeProfile` (`lib/employeeSelfService.ts:60`) — no permission key at all, because scope is derived from the authenticated session, not a permission grant. The four new routes (`GET /me/employment-history`, `/me/skills`, `/me/qualifications`, `/me/certifications`) follow this exact precedent verbatim. This fully satisfies the Owner's "prefer ZERO new permissions" direction — no STOP condition is triggered, because a safe existing pattern already exists and is reused, not invented.

### Existing HR routes: hardened using an existing permission only (Owner Decision 6 — SUPERSEDED BY OWNER DIRECTION)

The draft's own recommended default (track separately, do not fix) is **superseded** — the Owner has directed this gap be fixed inside Phase 3F. The fix must not invent employee CRUD access and must not touch the underlying `employee.read`/`employee.write` permission definitions or their role grants (both are used far more broadly than these 12 routes — `employees.ts`, `employeeConversion.ts`, `employeeExitProcess.ts`, `employeeDisciplinaryRecords.ts` all depend on the current `employee.read`/`employee.write` role mapping being unchanged). The correct, minimal, surgical fix, grounded in an already-established precedent in this exact permission family (`seed-roles-permissions.ts:225-234`'s own comment: "`employee.write`'s existing gate... the same admin-only rollout"): **change the 3 currently-`employee.read`-gated GET routes to require `employee.write` instead**, matching the 8 mutating routes on the same three resources that already require `employee.write`. This makes all 12 routes uniformly HR-only (`org_admin`/`hr_manager`, who both already hold `employee.write`), with zero change to any permission definition or role-permission mapping, and zero risk to any other route that depends on `employee.read`/`employee.write`'s current role grants.

**Full 12-route table, as required before freeze:**

| # | Method + Path | Current middleware | Intended middleware | Intended actor | Intended scope |
|---|---|---|---|---|---|
| 1 | `GET .../employees/:employeeId/skills` | `employee.read` | **`employee.write`** (changed) | HR/Admin only | Org-wide (unchanged — an HR admin page legitimately views any employee's records) |
| 2 | `POST .../employees/:employeeId/skills` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 3 | `PATCH .../skills/:skillId` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 4 | `DELETE .../skills/:skillId` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 5 | `GET .../employees/:employeeId/qualifications` | `employee.read` | **`employee.write`** (changed) | HR/Admin only | Org-wide |
| 6 | `POST .../qualifications` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 7 | `PATCH .../qualifications/:qualificationId` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 8 | `DELETE .../qualifications/:qualificationId` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 9 | `GET .../employees/:employeeId/certifications` | `employee.read` | **`employee.write`** (changed) | HR/Admin only | Org-wide |
| 10 | `POST .../certifications` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 11 | `PATCH .../certifications/:certificationId` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |
| 12 | `DELETE .../certifications/:certificationId` | `employee.write` | `employee.write` (unchanged) | HR/Admin only | Org-wide |

**Net effect:** an ordinary `employee`-role user (who holds `employee.read` but not `employee.write`) can no longer read any of these 12 routes at all — the previously-dormant coworker-read gap is closed. `org_admin`/`hr_manager` (both already hold `employee.write`) are entirely unaffected — every legitimate current HR workflow through `employee-detail.tsx` continues to work exactly as before. This is verified, not assumed — W105 must include a regression test proving `employee-detail.tsx`'s existing Skills/Qualifications/Certifications cards still function for `org_admin`/`hr_manager`, plus a new test proving an `employee`-role caller is denied all 4 changed routes for both their own and another employee's id.

**New HR-side employment-history route** (§10 below): `GET .../employees/:employeeId/employment-history`, new, `employee.write` (consistent with the table above — HR-administrative read, not a general directory-browse permission), `org_admin`/`hr_manager` only.

## 6. Database Impact — FINAL

**Zero new tables. Zero new migration. Migration remains `0040`.** All four entities already exist with adequate columns for a read-only V1 under the approved decisions. `drizzle-kit generate` must report "No schema changes, nothing to migrate" before any workstream is considered complete. No STOP condition is triggered — the approved V1 design (read-only, no evidence attachment, no submission workflow) requires no schema change of any kind.

## 7. Final Owner Decisions

Every decision is final. None are pending.

### Decision 1 — Employee edit rights — **APPROVED** (Option A, as drafted)

**Question:** Can the employee add/edit their own skills/qualifications/certifications, or view-only?
**Final Frozen Requirement:** Career Profile is **READ-ONLY** for employees in V1. Employees may view but never create, edit, delete, verify, or approve these records through ESS. HR/Admin remains the sole authoritative writer via the existing, unchanged `employee-detail.tsx` CRUD. No submission/approval workflow is built. If employees later need to propose new records, that is a separately designed future workflow, not part of Phase 3F.

### Decision 2 — Employment history visibility scope — **APPROVED WITH REFINEMENT**

**Question:** Full raw `employment_periods` feed, formatted, or redacted/filtered?
**Final Frozen Requirement:** Show the full history, formatted into plain-language rows from the existing `eventType`/`previousState`/`newState` fields — no redaction policy, no hidden event types. **Refinement, made explicit by Owner direction §6:** `employment_periods` only models *internal* movement (transfer/promotion/confirmation) — it has no representation of employment prior to joining this organization. External previous-employer history is therefore **explicitly deferred**, not built in Phase 3F, since the current schema does not model it and Owner direction is clear: do not invent a new table for it here.

### Decision 3 — Learning certificates vs. external certifications — **APPROVED** (Option A, as drafted)

**Question:** Merge `employee_certifications` and `learning_certificates` into one list, or keep separate?
**Final Frozen Requirement:** Strictly separate, per Learning's own frozen Owner Decision 3. Career Profile's Certifications section shows **only** `employee_certifications` (HR-maintained/external). `learning_certificates` remains exclusively in My Learning's existing "My Certificates" card — **not duplicated, not synchronized, not converted** into `employee_certifications` automatically, ever.

### Decision 4 — Expired certifications visibility — **APPROVED** (Option A, as drafted)

**Question:** Hide expired certifications or always show them?
**Final Frozen Requirement:** Always visible. Every `employee_certifications` row is shown with a live-computed expiry status label (mirroring `learning_certificates`' own existing active/expired/revoked computation pattern), never hidden or deleted from the ESS view solely due to expiry. No renewal automation is built.

### Decision 5 — Evidence/document attachment — **APPROVED** (Option A, as drafted)

**Question:** Allow attaching supporting documents to qualifications/certifications?
**Final Frozen Requirement:** Out of V1 scope entirely. No new upload workflow, no new storage layer, no public file URLs, no new document-ownership model. Since discovery confirmed no existing document relationship exists for any of the four entities (§2), there is nothing "already safe to surface" either — the entire feature is deferred, not partially built.

### Decision 6 — Existing HR-route authorization gap — **SUPERSEDED BY OWNER DIRECTION**

**Question (as drafted):** Track the gap separately, or fix it now?
**Draft's own recommended default:** track separately (Option A).
**Owner direction:** fix it now, inside Phase 3F, without inventing employee CRUD access.
**Final Frozen Requirement:** See §5's full 12-route table above. The 3 currently-unscoped GET routes are changed from `employee.read` to `employee.write`, closing the gap with zero new permission and zero change to any permission's role mapping. W105 must include the regression tests specified in §5 and §21.

### Decision 7 — New permission vs. no-permission precedent — **SUPERSEDED BY OWNER DIRECTION**

**Question (as drafted):** Mint `employee.read.own`, or follow `/me/employee`'s no-permission precedent?
**Draft's own recommended default:** mint `employee.read.own` (Option A).
**Owner direction:** strong preference for zero new permissions; use existing patterns if they safely express the required boundary.
**Final Frozen Requirement:** **No new permission.** All four new `/me/*` routes follow `/me/employee`'s exact existing precedent — `requireAuth` → `requireActiveOrganizationMembership` → `requireModuleEnabled("employee_self_service")` → server-derived identity via a new `resolveOwnEmployeeId`-shaped helper in `lib/employeeSelfService.ts`. This is safe because scope is never permission-derived on these routes — it is derived entirely from the authenticated session, identical in kind to `/me/employee`'s own already-proven-safe pattern. No STOP condition applies; a safe existing pattern was found and reused.

### Decision on Manager Access (raised by Owner direction §12, not one of the original 7 — recorded for completeness)

No manager Career Profile view was ever proposed in the original discovery. Owner's explicit prohibition is recorded as a permanent boundary: no manager `/me` impersonation, no team career profiles, no new `.read.team` permission, no manager mutation authority. Manager Portal remains entirely out of scope, a separate, not-yet-planned roadmap item.

## 8. Frontend Design — Final

One new **"Career Profile"** tab inside the existing `/self-service` page, four clearly separated sections in order: Employment History, Skills, Qualifications, Certifications. Ungated by any additional module key (matches My Profile/My Documents' own precedent — reachable whenever `employee_self_service` is enabled and the caller is linked to an employee record). Read-only throughout. Each section independently implements: a loading state, an empty state (e.g., "No skills on record"), an error state (reusing the existing `QueryError` component pattern already used across ESS), plain-language date formatting, a text-labeled (never color-only) expiry/status indicator for certifications, and standard responsive/accessible markup consistent with every other ESS tab. Not implemented in this freeze session — this is the binding design brief for W106.

## 9. API Impact — Final

**New routes** (no permission — see §5 Decision 7):

| Method + Path | Middleware | Scope | Response | Audit |
|---|---|---|---|---|
| `GET /me/employment-history` | `requireAuth`, `requireActiveOrganizationMembership`, `requireModuleEnabled("employee_self_service")` | Own employee only, server-resolved | Array of `employment_periods` rows for the caller | Silent (read) |
| `GET /me/skills` | same | Own employee only | Array of `employee_skills` rows | Silent |
| `GET /me/qualifications` | same | Own employee only | Array of `employee_qualifications` rows | Silent |
| `GET /me/certifications` | same | Own employee only | Array of `employee_certifications` rows, each with a computed `expiryStatus` field | Silent |

No pagination — matches the existing `/me/employee`-family precedent (small, bounded per-employee datasets; no other `/me/*` route in this codebase paginates). No route accepts an `employeeId` query parameter of any kind.

**Existing routes changed** (permission only — see §5 table): the 3 GET routes in `employeeSkillsQualifications.ts` change from `employee.read` to `employee.write`. No route path, method, or response shape changes.

**New HR-side route** (§10): `GET /organizations/:organizationId/employees/:employeeId/employment-history`, `employee.write`, org-wide, audit-silent read.

**Not built:** any `POST`/`PATCH`/`DELETE` under `/me/*` for any of these four entities (Decision 1).

## 10. HR-Side Gap Closure — Final

`employee-detail.tsx` gains one new read-only "Employment History" card, reusing the existing `listEmploymentPeriods` function via the new route in §9, formatted identically to the employee-facing version (§8) so both surfaces render the same events the same way. This is the only way to verify a Transfer/Promote/Confirm action produces a correct, readable history entry before the employee-facing version ships.

## 11-12. Reporting / Dashboard Impact — Final

**None.** No new report, no new dashboard tile, no interaction with the Reporting Foundation or the generic report runner. Confirmed correct per Owner direction §18.

## 13. Historical Integrity Strategy — Final

**Employment History:** `employment_periods` rows are already immutable/append-only (no update/delete path exists in the codebase). `previousState`/`newState` JSON snapshots already capture values at write time; a later rename of a referenced department/position does not retroactively alter a historical row. No new snapshot fields are invented — the existing model is used exactly as-is.
**Skills / Qualifications / Certifications:** these are live, mutable, HR-maintained records with no historical/versioned concept — Career Profile always shows the current HR-recorded state, exactly as `employee-detail.tsx` already does today. There is no "point-in-time" semantic to preserve for these three tables, and none is invented.

## 14. Tenant Isolation Strategy — Final

Every new `/me/*` route resolves the caller's own employee id server-side; no route accepts a client-supplied employee id. Every underlying query (`listEmploymentPeriods`, `listEmployeeSkills`, `listEmployeeQualifications`, `listEmployeeCertifications`) is already `organizationId`-scoped and reused verbatim. WWM ↔ Acme isolation is explicitly required in live QA (§16, Scenario D) for all four new routes, and the existing 12 HR routes remain unaffected by this plan's own tenant-isolation properties (unchanged from their current, already-tested `organizationId`-scoped behavior).

## 15. Final Workstream Design

Continuing from W104. Four workstreams — unchanged count from the draft, scope of W105 expanded to include the now-in-scope authorization hardening.

### W105 — ESS Foundation, Authorization Hardening & Employment History
**Scope:** (1) Harden the 3 GET routes in `employeeSkillsQualifications.ts` per §5's table (`employee.read` → `employee.write`), with regression tests proving `org_admin`/`hr_manager` unaffected and `employee`-role denied. (2) New `resolveOwnEmployeeId`-shaped helper in `lib/employeeSelfService.ts`. (3) New route `GET /me/employment-history` (no permission, own-scope, reuses `listEmploymentPeriods` verbatim). (4) New HR-side route + `employee-detail.tsx` "Employment History" card (§10). No skills/qualifications/certifications ESS work yet — backend-first, matching this codebase's established workstream-splitting convention.
**Database impact:** none.
**API impact:** 1 new `/me/*` route, 1 new HR-side route, 4 existing routes' permission changed (no path/method/response change).
**Frontend impact:** one new card in `employee-detail.tsx`; no ESS frontend yet.
**Permissions used:** `employee.write` (existing, now also covers the 4 hardened GET routes and the new HR history route); no new permission.
**Tests:** own-scope enforcement and cross-org denial on `/me/employment-history`; the two authorization-hardening regression tests above; unlinked-employee empty state; HR-route permission check for the new history route.
**Live QA:** Scenarios D, E, F, G (§16).
**Definition of Done:** both W39 employment-history bullets' data path proven end-to-end, live-verified; authorization hardening proven not to regress legitimate HR workflows.
**STOP boundary:** no skills/qualifications/certifications routes or frontend yet. Do not begin W106 without its own separate go-ahead.

### W106 — Career Profile: Skills, Qualifications & Certifications
**Scope:** New routes `GET /me/skills`, `/me/qualifications`, `/me/certifications` (no permission, own-scope, reuse existing list functions verbatim). New "Career Profile" tab (§8) with all four sections (Employment History from W105 + these three). Live-computed expiry status for certifications. `employee_certifications` and `learning_certificates` kept strictly separate (Decision 3) — no duplication anywhere in the new tab.
**Database impact:** none.
**API impact:** 3 new `/me/*` routes.
**Frontend impact:** new "Career Profile" tab, 4 read-only sections, loading/empty/error states per §8.
**Permissions used:** none (module gate only).
**Tests:** own-scope enforcement and cross-org denial for all 3 new routes; module-gate behavior (page-level `employee_self_service` only, no additional module); a certifications-separation regression test confirming `employee_certifications` and `learning_certificates` never merge in response or UI; the full existing 9-tab regression suite re-run clean.
**Live QA:** Scenarios A, B, C, D, H, I, J (§16).
**Definition of Done:** both W39 bullets fully closed — employment history (W105) and skills/qualifications/certifications (W106) live in one consolidated, read-only Career Profile tab.
**STOP boundary:** no evidence/document attachment, no employee-editability, no manager view, no new report/dashboard. Do not begin W107 without its own separate go-ahead.

### W107 — Phase 3F Verification
**Scope:** Full integrated verification pass mirroring W93/W103's own exact charter — functional, authorization (including the W105 hardening), tenant isolation, historical integrity, full regression (backend + frontend), typecheck (root + full-build paths), production builds, OpenAPI/codegen determinism, one integrated live-QA lifecycle covering every scenario in §16 and every requirement in §21. Verification-only, no new scope.
**Definition of Done:** matches W93/W103's own template exactly.
**STOP boundary:** report PASS / PASS WITH FIXES / BLOCKED. Do not begin W108 without its own separate go-ahead.

### W108 — Phase 3F Completion Report
**Scope:** Formal closure, mirroring W94/W104's own exact structure. `PROJECT_STATUS.md` updated to close both original W39 bullets explicitly as delivered, final module/permission/route/test totals recorded, the still-open **Manager Portal** roadmap item restated as the next unresolved Phase 3 gap.
**Definition of Done:** `PROJECT_STATUS.md` updated; both W39 deferrals marked closed only if genuinely delivered and verified in W107.
**STOP boundary:** the final Phase 3F workstream. Do not begin Manager Portal planning without its own separate go-ahead.

## 16. Live QA Requirements — Final (10 scenarios, binding for W105–W107)

- **Scenario A:** employee with all four Career Profile data types populated sees all four correctly.
- **Scenario B:** employee with empty sections sees correct empty states, no errors.
- **Scenario C:** unrelated employee attempts to access another employee's data via all 4 new `/me/*` routes — denied by construction (no route accepts a caller-supplied employee id).
- **Scenario D:** WWM ↔ Acme isolation verified on all new and hardened routes, both directions, real and nonexistent ids.
- **Scenario E:** an ordinary `employee`-role user attempts the 4 now-hardened HR routes directly — denied (`403`), proving the authorization fix.
- **Scenario F:** HR legitimately manages a skill/qualification/certification record via the unchanged `employee-detail.tsx` flow; the employee's own Career Profile reflects the update on next read (no caching).
- **Scenario G:** an employment-period event created through the existing, unmodified Transfer/Promote/Confirm workflow appears correctly, plain-language formatted, in both the employee's own Career Profile and HR's new admin card.
- **Scenario H:** an expired certification remains visible with a correct expiry-status label.
- **Scenario I:** a Learning-issued certificate remains visible only in My Learning, confirmed absent from Career Profile.
- **Scenario J:** every existing module-gated ESS tab (Attendance/Performance/Learning/Assets/Leave/Recruitment) remains correctly gated — Phase 3F introduces no indirect access to a disabled module.

Cleanup must restore the exact pre-QA baseline; no genuine business/audit history may be deleted during cleanup, matching every prior phase's own established discipline. No QA data is created during this freeze session.

## 17. Expected Next Migration — Final

**None.** Migration remains `0040` through W105–W108 under this frozen design. Do not create `0041`.

## 18. Security Test Requirements — Final (binding minimum for W105–W107)

**Employee:** can read own Career Profile data; cannot select another employeeId (impossible by route construction, verified by test); cannot use the 4 hardened HR CRUD endpoints (verified by test, Scenario E); cannot mutate any Career Profile record through ESS (no write route exists at all).
**HR:** legitimate HR CRUD continues working unchanged (Scenario F regression); authorization hardening does not break valid HR administration (the two W105 regression tests in §5).
**Tenant:** WWM ↔ Acme both directions, real and nonexistent ids, on all new and hardened routes (Scenario D).
**Documents:** not applicable — no document surfacing exists in V1 (Decision 5).
**Modules:** all independently-gated ESS tabs remain inaccessible when their own module is disabled (Scenario J); Career Profile itself remains inaccessible when `employee_self_service` is disabled.
**Regression:** all 9 existing `/self-service` tabs (Profile, Attendance, Performance, Learning, Assets, Leave, Documents, Internal Vacancies, My Applications) verified unaffected.

## 19. Issues / Ambiguities Disclosed

1. The pre-existing HR-route authorization gap (§2, §5) — real, live, predated this plan, now fixed rather than carried forward, per explicit Owner direction.
2. `employment_periods` does not model external prior-employer history — explicitly deferred (Decision 2 refinement), not silently expanded into.
3. `ROADMAP.md` itself never restates the deferred item — tracked only in `PROJECT_STATUS.md`; no inconsistency found once accounted for.

---

**Freeze confirmation:** all 7 original Owner Decisions are resolved (2 APPROVED as drafted, 1 APPROVED WITH REFINEMENT, 2 APPROVED as drafted, 2 SUPERSEDED BY OWNER DIRECTION). Zero decisions remain pending. Zero new tables. Zero new migrations. Zero new permissions. One genuine pre-existing authorization gap fixed using an existing permission, with regression tests required before it can be considered done. This document authorizes W105 to begin once given its own separate explicit go-ahead — it does not itself begin implementation.
