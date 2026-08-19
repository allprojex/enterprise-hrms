# Phase 3C — Performance: Frozen Implementation Plan

Status: **DRAFT — NOT FROZEN.** Becomes frozen only once reviewed and approved. No workstream may begin until this document is approved, exactly as `PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md` was approved before W64 began.

This document is the product of a discovery-only session: no migrations, no routes, no frontend pages, no permission seeding, no module activation, and no production access were performed while producing it. Every claim about the existing codebase below was verified by direct inspection (file paths cited); every new-design element is explicitly labeled.

Two labels are used throughout:
- **[ROADMAP REQUIREMENT]** — literally stated in `ROADMAP.md` / `PROJECT_STATUS.md`.
- **[PROPOSED DESIGN DECISION]** — filled in by this document; not pre-existing.

---

## 1. Purpose

Define the complete, frozen architecture and workstream sequence for the Performance module — the next undelivered item in `ROADMAP.md`'s Phase 3 ("Workforce Operations") ordering, per `PROJECT_STATUS.md`'s own "Next Roadmap Step" note (line 274): Recruitment and Attendance are complete; Leave and Employee Self Service were already delivered in Phase 2B; **Performance is next**. This plan exists so implementation (W73 onward) can proceed in small, controlled, independently-shippable workstreams without redesigning the module mid-build — the same discipline `PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` and `PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md` already established.

**[ROADMAP REQUIREMENT]** `ROADMAP.md` names "Performance" as a Phase 3 item with no further elaboration — no scope description, no dependencies, no explicit deferrals. Everything beyond the bare name below is a **[PROPOSED DESIGN DECISION]**.

**Filename note:** the discovery brief suggested `docs/PERFORMANCE_IMPLEMENTATION_PLAN.md`; this repository's own established convention is `docs/PHASE_<N><letter>_<MODULE>_IMPLEMENTATION_PLAN.md` (`PHASE_3A_RECRUITMENT...`, `PHASE_3B_ATTENDANCE...`). Following that convention exactly, this document is `docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md`.

---

## 2. Existing Architecture Reused

Nothing below is proposed as new platform infrastructure — every one of these is an existing, working primitive Performance will consume unchanged:

| Foundation | Reused as-is from |
|---|---|
| Module registry + gating (`ModuleDefinition`, `organization_modules`, `requireModuleEnabled`, `ModuleGate`, `isModuleAccessible`) | `lib/db/src/seed/module-definitions.ts`, `artifacts/api-server/src/middlewares/requireModuleEnabled.ts`, `artifacts/hrms/src/components/module-gate.tsx`, `artifacts/hrms/src/lib/module-access.ts` |
| Permission system (`permissions`, `role_permissions`, `requirePermission`, `hasPermission`) | `lib/db/src/schema/permissions.ts`, `lib/db/src/schema/role-permissions.ts`, `artifacts/api-server/src/middlewares/requirePermission.ts`, `artifacts/api-server/src/lib/permissions.ts` |
| Own/team/org-wide scope pattern (broad permission grant + service-layer narrowing, **no explicit `.read.team` key**) | `artifacts/api-server/src/lib/attendanceAuthorization.ts` (`isReportingManagerOf`, `resolveAttendanceVisibilityScope`) |
| Identity resolution (never trust a client-supplied employeeId) | `resolveOwnEmployeeId` in `artifacts/api-server/src/lib/leaveRequests.ts:44-53` |
| Manager hierarchy (one level — direct reports only, no recursive walk) | inline `reportingManagerId` equality filters, e.g. `routes/leaveCalendar.ts:52-59`, `routes/attendanceRegister.ts:81-82` |
| Employee/Department/Position/Branch schema | `lib/db/src/schema/employees.ts`, `departments.ts`, `positions.ts`, `branches.ts` |
| ESS tab-based page + independent per-tab module degradation | `artifacts/hrms/src/pages/employee-self-service.tsx` |
| Document/evidence storage (table + local-disk abstraction) | `lib/db/src/schema/employee-documents.ts`, `artifacts/api-server/src/lib/fileStorage.ts` |
| Organization settings namespace framework | `lib/db/src/schema/organization-settings.ts`, `artifacts/api-server/src/services/organizationConfig.ts` (`CONFIG_NAMESPACES`) |
| Master Data framework (org-overridable/org-defined lookup lists) | `lib/db/src/schema/master-data-domains.ts`, `master-data-items.ts`, `lib/db/src/seed/master-data-definitions.ts` |
| Atomic state-transition pattern (conditional `UPDATE ... WHERE status = 'expected'`) | `artifacts/api-server/src/lib/leaveApprovals.ts`, `attendanceAdjustments.ts` |
| Audit framework (`audit_events`, `recordAuditEvent`) | `lib/db/src/schema/audit-events.ts`, `artifacts/api-server/src/lib/auditLog.ts` |
| Reporting Foundation (registry + generic runner + CSV convention) and the "needs its own visibility-scoped route" precedent | `lib/db/src/schema/reports.ts`, `lib/db/src/seed/report-definitions.ts`, `artifacts/api-server/src/lib/reporting.ts`, `routes/attendanceReporting.ts`, `routes/recruitmentReporting.ts` |
| RLS deny-by-default convention | `docs/SUPABASE_SECURITY_REMEDIATION.md`, `lib/db/drizzle/0036_enable_rls_deny_default.sql`, `0037_redundant_rictor.sql` |
| `routes/*.ts` (thin HTTP) vs `lib/*.ts` (business logic) split, tests in `artifacts/api-server/src/test/` | throughout Attendance/Recruitment/Leave |
| OpenAPI hand-written spec + orval codegen (React Query hooks + Zod schemas) | `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts` |
| Frontend routing (`SecureRoute` + `ModuleGate`), nav gating (`isHrCapable`) | `artifacts/hrms/src/App.tsx`, `artifacts/hrms/src/components/layout/app-shell.tsx` |

**No new platform primitive is required to build Performance.** This is itself a significant finding: Performance is purely a new module built entirely on existing foundations.

---

## 3. Scope (Recommended V1)

- Performance Cycles (org-configured periods with self-assessment / manager-review / HR-finalization windows)
- Review Templates (reusable, versioned-by-snapshot competency sets + weighting + rating scale reference)
- Rating Scales (organization-configurable, not hardcoded 1–5)
- Goals/Objectives (per-review, employee- or manager-created, five measurement types)
- Competencies (per-review, snapshotted from a template at assignment time)
- Self-Assessment (ESS)
- Manager Review (direct-report scope, one level, server-derived)
- HR Review & Finalization (with optional score override + mandatory reason)
- Employee Acknowledgement ("seen," not "agree," with an optional final comment)
- Evidence/Attachments (reusing `employee_documents` — a lightweight join table only)
- Performance Dashboard (own dedicated route, mirroring Attendance's W70 precedent)
- 4 initial reports via a dedicated, visibility-scoped reporting route
- Full audit trail on every state transition

## 4. Non-Goals (Deferred)

- Formal appeal/dispute/case-management workflow (only an optional acknowledgement comment ships in v1)
- Performance Improvement Plans (PIP) — explicitly deferred to a future Employee Relations module
- Custom questions on templates (only goals + competencies + ratings + comments in v1)
- In-app/email notifications (no working notification delivery infra exists platform-wide today — see §23)
- Numeric contribution of employee self-rating to the final score (self-rating is comment/reference-only by default — see Open Decision 2)
- Multi-level (recursive) manager hierarchy — matches the platform-wide one-level-only precedent
- Overachievement scoring beyond 100% of a numeric/percentage/currency goal target
- Template versioning as a first-class entity (achieved instead via snapshot-at-creation — see §9)
- Cross-tenant/cross-organization anything (never in scope, per platform architecture)

---

## 5. Terminology

Canonical, organization-neutral internal concepts (per CLAUDE.md's "one shared foundation" principle — no church/company terminology in table names):

| Canonical concept | Table/API name |
|---|---|
| Performance Cycle | `performance_cycles` |
| Review Template | `performance_review_templates` |
| Rating Scale | `performance_rating_scales` |
| Performance Review | `performance_reviews` |
| Goal | `performance_review_goals` |
| Competency | `performance_review_competencies` |

**[PROPOSED DESIGN DECISION]** Display-label customization (e.g. a church relabeling "Performance Review" as "Ministry Review") is achieved via the existing `terminology` `organization_settings` namespace (already used platform-wide for `employeeLabel`/`employeeLabelPlural`) — add a small set of `performance.*` terminology keys there. **No org-specific table/column naming is introduced anywhere.**

---

## 6. Roles / Personas

Uses the platform's existing 4-role model (`super_admin`, `org_admin`, `hr_manager`, `employee`) — **no dedicated "manager" role exists anywhere on this platform** (confirmed: `seed-roles-permissions.ts`, and repeatedly documented in Attendance/Recruitment history). "Manager" is not a role; it is a *relationship* — any `employee`-role user who is another employee's `reportingManagerId` — resolved server-side, exactly like Attendance and Leave already do.

| Persona | Platform role | Performance capability |
|---|---|---|
| Employee | `employee` | Own reviews, own self-assessment, own goals, acknowledgement |
| Manager (relationship, not a role) | `employee` (+ `reportingManagerId` match) | Manager-review on direct reports' reviews only, one level |
| HR | `hr_manager` | Cycles, templates, rating scales, assignment, org-wide read, finalize, override, reports |
| Org Admin | `org_admin` | Everything HR can do |
| Super Admin | `super_admin` | Platform-wide (via existing seeding convention: all permissions) |

---

## 7. Permissions

**[PROPOSED DESIGN DECISION]** Following the Attendance precedent exactly (§3 of research: "no explicit team permission — broad grant + service-layer narrowing via `reportingManagerId`/assignee-column comparison"), Performance uses **6 keys**, none of them a `.team` variant:

| Key | Purpose | Scope resolution |
|---|---|---|
| `performance.read.own` | View own reviews/goals/competencies, and (via service-layer comparison) reviews where caller is the snapshotted `reviewerEmployeeId` | own: employeeId match; manager: pure comparison against `performance_reviews.reviewerEmployeeId`, same shape as `isReportingManagerOf` |
| `performance.write.own` | Submit/edit own self-assessment (goals results, self-ratings, comments), acknowledge finalized review | own only |
| `performance.review.write` | Submit manager review (ratings, comments, goal verification) | narrowed to `reviewerEmployeeId` match on the specific review row — never broadened by the permission grant alone, mirrors `recruitmentAuthorization.ts`'s "assigned" tier |
| `performance.manage` | Create/edit cycles, templates, rating scales; generate/assign reviews; reopen any review; org-wide read | organization-wide only |
| `performance.finalize` | HR finalize a review, optionally override score (requires reason) | organization-wide only |
| `performance.reports.read` | Dashboard + reports | broad grant, scope resolved in service layer exactly like `recruitment.reports.read` (own/reviewer-of-record vs. org-wide signaled by holding `performance.manage`) |

### Default role mapping

| Key | super_admin | org_admin | hr_manager | employee |
|---|:---:|:---:|:---:|:---:|
| `performance.read.own` | ✓ | ✓ | ✓ | ✓ |
| `performance.write.own` | ✓ | ✓ | ✓ | ✓ |
| `performance.review.write` | ✓ | ✓ | ✓ | ✓ |
| `performance.manage` | ✓ | ✓ | ✓ | — |
| `performance.finalize` | ✓ | ✓ | ✓ | — |
| `performance.reports.read` | ✓ | ✓ | ✓ | ✓ |

`performance.review.write`/`performance.read.own`/`performance.reports.read` are seeded broadly to `employee` for the same reason `attendance.read.own` and `recruitment.reports.read` are — any employee could be someone's manager, and the real narrowing happens per-row in the service layer, never at the permission-grant level.

---

## 8. Data Model

**[PROPOSED DESIGN DECISION]** 9 new tables, all organization-owned, all RLS-enabled with zero policies in their own creation migration (mirrors migration `0037`'s pattern of enabling RLS inline rather than in a separate follow-on migration). All created in one schema-only workstream (W73), mirroring Attendance's W64 precedent exactly ("schema, permissions, module activation, authorization primitives only — no route, no frontend").

### 8.1 `performance_rating_scales` (definition, org-owned)
| Column | Notes |
|---|---|
| id, organizationId | organizationId → `restrict` |
| name, description | |
| status | `active` \| `archived` — **immutable once any review references it** (enforced in service layer: editing levels is blocked once `usageCount > 0`; org must archive and create a new scale version instead) |
| createdAt |

### 8.2 `performance_rating_scale_levels` (child of 8.1)
| Column | Notes |
|---|---|
| id, ratingScaleId (→ `restrict`) | |
| value (numeric) | the actual score value, e.g. 1–5; not required to be sequential |
| label, description | e.g. "Exceeds Expectations" |
| sortOrder | |
| Unique | `(ratingScaleId, value)` |

### 8.3 `performance_review_templates` (definition, org-owned)
| Column | Notes |
|---|---|
| id, organizationId | |
| name, description | |
| ratingScaleId (→ `restrict`) | |
| goalsWeight, competenciesWeight | integers, **must sum to 100**, validated at save time |
| applicabilityScope | `all_active` \| `department` \| `position` \| `manual` |
| applicabilityDepartmentIds, applicabilityPositionIds | jsonb integer arrays — filter config, not a relational entity (same spirit as Attendance's `workDays` array) |
| status | `draft` \| `active` \| `archived` |
| createdAt, updatedAt |

Editing an `active` template only affects reviews created *after* the edit — existing reviews already snapshotted their competencies/weights (§9). No template-versioning table is needed.

### 8.4 `performance_template_competencies` (child of 8.3 — the library set a template offers)
| Column | Notes |
|---|---|
| id, templateId (→ `cascade`) | |
| label, description | free text by default; **[PROPOSED DESIGN DECISION]** organizations wanting a shared competency library may optionally define an organization-defined Master Data domain (e.g. `competency`) that the template-builder UI offers as typeahead suggestions — not FK-enforced, same "free-text code, unvalidated by design" precedent as `employee_documents.categoryCode` |
| weight, sortOrder | weights within a template must sum to 100 |

### 8.5 `performance_cycles` (org-owned)
| Column | Notes |
|---|---|
| id, organizationId | |
| name, cycleType | `annual` \| `semiannual` \| `quarterly` \| `monthly` \| `probation` \| `ad_hoc` |
| startDate, endDate | |
| selfAssessmentWindowStart/End, managerReviewWindowStart/End, hrFinalizationWindowStart/End | |
| templateId (→ `restrict`), ratingScaleId (→ `restrict`) | default for this cycle's generated reviews (each review still stores its own copy — see 8.6) |
| applicabilityScope, applicabilityDepartmentIds, applicabilityPositionIds | same shape as 8.3, cycle-level override of the template's own default |
| status | `draft` → `open` → `closed` → `archived` (see §10) |
| createdAt |

### 8.6 `performance_reviews` (the instance — one per employee per cycle)
| Column | Notes |
|---|---|
| id, organizationId | |
| cycleId (→ `restrict`), templateId (→ `restrict`), ratingScaleId (→ `restrict`) | |
| employeeId (→ `restrict`) | |
| reviewerEmployeeId | **snapshot** of `employees.reportingManagerId` at assignment time — fixed for this review even if the employee's manager later changes |
| departmentIdSnapshot, positionIdSnapshot | snapshotted at assignment time, for historically-accurate reporting even after a later transfer/promotion |
| goalsWeight, competenciesWeight | copied from template at creation |
| status | state machine — see §10 |
| selfAssessmentSubmittedAt, managerReviewSubmittedAt, hrFinalizedAt, acknowledgedAt | |
| employeeFinalComment | optional, entered at acknowledgement |
| computedOverallScore | always the formula's output — never overwritten |
| hrOverrideScore, hrOverrideReason | nullable; reason required if score is set |
| createdAt, updatedAt |
| Unique | `(cycleId, employeeId)` — one review per employee per cycle |
| Indexes | `(organizationId, employeeId)`, `(organizationId, reviewerEmployeeId)`, `(organizationId, cycleId, status)` |

### 8.7 `performance_review_goals` (child of 8.6)
| Column | Notes |
|---|---|
| id, reviewId (→ `cascade`) | |
| title, description | |
| measurementType | `numeric` \| `percentage` \| `currency` \| `boolean` \| `rating` \| `qualitative` |
| target, actualResult, unit | nullable, per type |
| weight | must be **0** for `qualitative` (informational only, no scoring impact — a deliberate simplification avoiding proportional-reweighting complexity); weights of scored goals must sum to 100 |
| dueDate, status | `not_started` \| `in_progress` \| `completed` \| `missed` |
| employeeComment, managerComment | |
| computedScore | normalized 0–100, computed at manager-submit time (see §11) |
| createdBy | `employee` \| `manager` \| `hr` — who proposed the goal (see Open Decision 4) |

### 8.8 `performance_review_competencies` (child of 8.6 — snapshotted from template at creation)
| Column | Notes |
|---|---|
| id, reviewId (→ `cascade`) | |
| label, description | copied text, **not a live FK** to `performance_template_competencies` — a later template edit never changes an existing review |
| weight, sortOrder | copied from template; must sum to 100 across a review's competencies |
| employeeRatingValue, employeeComment | self-rating, reference-only (Open Decision 2) |
| managerRatingValue, managerComment | authoritative for scoring |

### 8.9 `performance_review_evidence` (lightweight join — reuses existing storage)
| Column | Notes |
|---|---|
| id, reviewId (→ `cascade`), goalId (nullable, → `cascade`) | attaches at review level or a specific goal |
| employeeDocumentId (→ `restrict`) | points into the **existing** `employee_documents` table — no new storage layer |
| addedByMembershipId, addedAt | |

No new file-storage code is written; a new `document_category` Master Data code (e.g. `performance_evidence`) is registered so uploads through the existing employee-documents route can be tagged for this purpose.

---

## 9. Historical Integrity

This is the section CLAUDE.md's "preserve data integrity" principle bears on most directly for Performance. Mechanism: **snapshot-at-creation, not live-reference**, applied consistently:

| Changes later... | Effect on existing finalized reviews |
|---|---|
| Employee's department/position/manager changes | **No effect** — `performance_reviews.departmentIdSnapshot`/`positionIdSnapshot`/`reviewerEmployeeId` are fixed at assignment time |
| Template is edited or archived | **No effect** — `performance_review_competencies` copied the label/weight/description as plain columns, not an FK, at review-creation time |
| Competency library entry renamed | **No effect** — same reason |
| Rating scale levels edited | **Cannot happen** — service layer blocks editing a scale's levels once `usageCount > 0`; org must archive and create a new scale version |
| Organization configuration (`performance` settings namespace) changes | **No effect on existing reviews** — `goalsWeight`/`competenciesWeight`/`scoringPrecision` are all copied onto the review/goal/competency rows at creation, not read live at display time |
| Competency/rating-scale row is later "deleted" | Never hard-deleted — `status: archived` only, per the platform's established never-hard-delete convention (`separationReason`, `document_category`, etc.) |

**Finalized reviews are durable historical business records** — never mutated after `finalized`, except by an explicit, audited HR `reopen` action (§10), which is itself a rare, permissioned, fully-audited operation, not a routine edit path.

---

## 10. Review Lifecycle (State Machine)

**[PROPOSED DESIGN DECISION]** One explicit state machine on `performance_reviews.status`:

```
draft → self_assessment → manager_review → hr_review → finalized → acknowledged
```

| Transition | Actor | Permission | Mechanism |
|---|---|---|---|
| (cycle `open` action) → `draft` rows created | HR/org_admin | `performance.manage` | bulk insert, one row per applicable employee, goals/competencies snapshotted from template |
| `draft` → `self_assessment` | HR (cycle-level "open reviews" action, or automatic at the cycle's self-assessment window start) | `performance.manage` | — |
| `self_assessment` → `manager_review` | Employee (submit) | `performance.write.own` | atomic `UPDATE ... WHERE status = 'self_assessment' AND employee_id = ?` — mirrors `leaveApprovals.ts`'s conditional-update pattern; blocked with a 400 listing missing fields unless every non-qualitative goal has a result and every competency has a self-rating |
| `manager_review` → `hr_review` | Manager (reviewer of record, submit) | `performance.review.write` | same atomic-conditional pattern, keyed to `reviewerEmployeeId`; blocked unless every goal is scored and every competency has a manager rating |
| `hr_review` → `finalized` | HR/org_admin | `performance.finalize` | atomic conditional update; computes `computedOverallScore`; optional `hrOverrideScore`+`hrOverrideReason` |
| `finalized` → `acknowledged` | Employee | `performance.write.own` | optional `employeeFinalComment` |
| any of `{manager_review, hr_review, finalized}` → an earlier stage | HR/org_admin only | `performance.manage` | explicit **reopen** action — clears only the downstream-only fields (e.g. reopening `finalized`→`hr_review` clears `hrFinalizedAt`/override but keeps manager scores intact); always audited |

Every transition is atomic (conditional `UPDATE ... WHERE status = 'expected_prior_status' AND organization_id = ?`), exactly like `leaveApprovals.ts`/`attendanceAdjustments.ts` — a concurrent second submit affects zero rows and returns `409`, never a silent double-transition or `500`.

Cycle-level state machine (independent from review-level): `draft → open → closed → archived`. `open` is the only cycle action that mutates data (generates review rows); `closed` and `archived` are read-only historical states, set by HR once all reviews reach a terminal per-cycle status or the configured window ends — no automatic cron-based transition is proposed (no background-job infrastructure is assumed available; HR triggers this manually in v1).

---

## 11. Rating/Scoring

**[PROPOSED DESIGN DECISION]**

- **Goal score** (0–100, normalized): `numeric`/`percentage`/`currency` → `clamp(actual/target × 100, 0, 100)` (no overachievement bonus in v1); `boolean` → 100 if complete else 0; `rating` → `(chosen level value / max level value) × 100`; `qualitative` → no score, weight forced to 0.
- **Competency score**: manager's `managerRatingValue` normalized the same way (`value / maxLevelValue × 100`). Employee's own rating never enters the formula (Open Decision 2).
- **Goals weighted average** = `Σ(goalScore × goalWeight) / Σ(goalWeight)` over scored goals.
- **Competencies weighted average** = `Σ(competencyScore × competencyWeight) / Σ(competencyWeight)`.
- **Overall score** = `round(goalsAvg × goalsWeight/100 + competenciesAvg × competenciesWeight/100, scoringPrecision)`, `scoringPrecision` defaulting to 2 decimal places, org-configurable via the `performance` settings namespace.
- **Weighting validation**: `goalsWeight + competenciesWeight` must equal exactly 100 at the template level; individual goal weights (excluding qualitative) must sum to 100; individual competency weights must sum to 100. Validated at template save time and again at review-submission time (defense in depth).
- **Missing-score handling**: manager submission is blocked (400, listing exactly what's missing) until every non-qualitative goal has a result and every competency has a manager rating — no silent partial score, no proportional reweighting.
- **Not-applicable handling**: not supported in v1 — deferred (a genuinely N/A goal should be given `weight: 0` at template/goal-authoring time instead).
- **Self-rating's effect on the final score**: none, by default — see Open Decision 2.
- **Manager score is authoritative**; HR may override the *displayed* `overallScore` via `hrOverrideScore`, which always requires `hrOverrideReason`. `computedOverallScore` is retained unedited alongside it for transparency.

---

## 12. Goals

Model: see §8.7. Created either by the employee or the manager (see Open Decision 4 — recommended: **both**, editable by either party until `self_assessment` is submitted). Not reusable across cycles as live objects — each cycle's reviews get their own goal rows (an org wanting a recurring goal simply re-enters it; no goal-templating engine in v1). Five measurement types, deliberately not more (no "custom formula" type).

## 13. Competencies

Model: see §8.4 (template-level definition) and §8.8 (review-level snapshot). No Performance-specific "competency library" table beyond `performance_template_competencies` — an organization defining the same competency across many templates simply re-enters it (or types the same label, optionally suggested via an org-defined Master Data domain, §8.4). Position/department-specific competency sets are achieved via separate templates with different applicability filters, not a competency-to-position mapping table (kept out of v1 — a template *is* the position/department-specific set).

## 14. Self-Assessment

Employee, via `performance.write.own`: view assigned review (goals + snapshotted competencies + rating scale), enter goal results/self-rating where applicable, add comments, submit. Submission is a single atomic transition (§10) — no partial-save-then-separate-submit distinction beyond ordinary autosave-as-you-go PATCH calls prior to the submit action. Once submitted, the employee cannot edit until HR reopens it. The employee **can** see the rating scale and their own prior entries at any time; they **cannot** see the manager's rating until the manager submits (server-enforced — the review-read endpoint omits manager fields for the `self_assessment`-stage caller unless they hold `performance.manage`/`performance.finalize`).

## 15. Manager Review

Manager access is entirely server-derived from `reviewerEmployeeId` (snapshotted at review creation from `employees.reportingManagerId`, §8.6/§9) — never a client-supplied relationship, and never a live re-check of the current `reportingManagerId` (a manager change after assignment does not retroactively reassign an in-flight review, consistent with §9's historical-integrity principle). Manager: views employee's self-assessment, verifies/enters goal results, rates each competency, comments, submits. Reopen/return-to-employee is HR-only (§10) — a manager cannot unilaterally bounce a review back to the employee in v1 (kept out of scope to avoid inventing an unspecified secondary state).

## 16. HR / Admin Review

`performance.manage` covers: create/edit cycles, templates, rating scales; trigger "generate reviews" (bulk assignment); monitor completion (dashboard); reopen any review at any stage; view every organization-wide review. `performance.finalize` (separate key, same default role mapping) covers: finalize a review, optionally override score with a mandatory reason. Kept as two keys rather than one, mirroring Attendance's `attendance.manage` / `attendance.adjustment.approve` split — configuration/administration is a conceptually different action from the finalize/override decision, even though both are seeded to the same roles by default today.

---

## 17. ESS (Planned Surfaces)

**[PROPOSED DESIGN DECISION]** A new "My Performance" tab on the existing `/self-service` page (`employee-self-service.tsx`), gated exactly like "My Attendance"/"My Leave" via `isModuleAccessible(modules, 'performance')` — **no separate employee portal**. Contents: current-cycle review card (status badge, key dates), self-assessment form (goals + competencies + comments, submit action), review history (prior finalized/acknowledged reviews, read-only), acknowledgement action + optional final comment on a `finalized` review.

## 18. Manager (Planned Surfaces)

A dedicated route `/performance-team` (mirrors `/attendance-register`'s shape) gated by `ModuleGate moduleKey="performance"` at the route level, nav-entry-gated `isHrCapable`-only per the established pattern (own/team tier still directly URL-reachable by an ordinary manager, exactly like the Attendance Register). Contents: reviews awaiting manager action (pending self-assessments to review, submitted-but-not-yet-reviewed), team progress list, completed reviews.

## 19. HR (Planned Surfaces)

- `/performance` — Performance Dashboard (tiles; mirrors `/attendance` dashboard's shape)
- `/performance-cycles` — cycle CRUD + "generate reviews" action
- `/performance-templates` — template + competency configuration
- `/performance-rating-scales` — rating scale + level configuration
- `/performance-reviews` — organization-wide review list/detail (filter by cycle/department/status), reopen/finalize actions
- `/performance-reports` — report catalog + CSV export (mirrors `/attendance-reports`)

All `ModuleGate`-wrapped, nav-entry-gated `isHrCapable`. Kept to 6 pages — the smallest coherent navigation set, not one page per table.

## 20. Dashboard (Planned Metrics)

**[PROPOSED DESIGN DECISION]** Mirrors Attendance's W70 "raw tile breakdown, no invented rate/KPI" discipline exactly — every metric below is a plain count with a defined denominator, nothing fabricated:

- Active cycle name + window dates
- Employees assigned (count of `performance_reviews` rows in the active cycle, scoped)
- Self-assessments pending / submitted (status breakdown, scoped)
- Manager reviews pending / submitted (status breakdown, scoped)
- Finalized / acknowledged counts (scoped)
- Rating distribution (count of finalized reviews per `computedOverallScore` band, e.g. deciles — **no "average score" tile unless explicitly approved**, per the same "do not invent executive KPIs" discipline W70 was held to)

All figures resolved through one batched context object per request (mirrors `attendanceReporting.ts`'s ~3-queries-total pattern, §21) — never a per-employee loop.

## 21. Reporting

Reuses the Reporting Foundation registry (`reports` table, `report-definitions.ts`) for catalog discoverability, but — per the exact precedent documented for Attendance/Recruitment (visibility-scoped execution "cannot be expressed" by the generic organization-only `RUNNERS` map) — executed through a **new, dedicated route** `routes/performanceReporting.ts`, never the generic `GET .../reports/:reportKey/run`.

**[PROPOSED DESIGN DECISION]** Initial report keys (category `"performance"`, `requiredPermissionKey: "performance.reports.read"`):

| Key | Contents |
|---|---|
| `performance_review_status` | one row per review: employee, cycle, status, key dates |
| `performance_scores` | one row per finalized review: employee, cycle, goals avg, competencies avg, overall score, override (if any) |
| `performance_goal_results` | one row per goal: employee, cycle, goal title, target/actual, score |
| `performance_rating_distribution` | count of finalized reviews per score band |

CSV export reuses the exact `?format=csv` convention (`text/csv`, `Content-Disposition: attachment`) — no new export code path.

## 22. Audit

Every state transition and configuration write is audited via the existing `recordAuditEvent`, `resource.action` naming convention:

`performance_cycle.created` / `.opened` / `.closed` / `.archived`, `performance_review_template.created` / `.updated` / `.archived`, `performance_rating_scale.created` / `.archived`, `performance_review.assigned`, `.self_assessment_submitted`, `.manager_review_submitted`, `.reopened`, `.score_overridden`, `.finalized`, `.acknowledged`. Read-only surfaces (dashboard, reports, review detail GET) generate **zero** audit noise, exactly like Attendance's four read-only surfaces.

## 23. Notifications

**Confirmed: no working notification-delivery infrastructure exists anywhere on this platform today.** The `notifications` table (`lib/db/src/schema/notifications.ts`) supports only read/mark-read; nothing in the entire backend ever inserts a row into it. Every existing module (Leave, Attendance, Recruitment) marks its own transition points with a `// Notification extension point (Architecture Principle 8) — not implemented` comment and ships without it. **Performance follows the identical precedent: every state-transition function gets the same extension-point comment; notifications are formally DEFERRED, not built**, until a platform-wide notification-delivery workstream exists independently of Performance.

## 24. Files / Evidence

Reuses `employee_documents` + `fileStorage.ts` unchanged, via the new `performance_review_evidence` join table (§8.9) and a new `performance_evidence` `document_category` Master Data code. No new storage provider, no new upload route — the existing `POST /organizations/:organizationId/employees/:employeeId/documents` route is reused; Performance only adds the join-row linking an uploaded document to a specific review/goal.

---

## 25. Tenant Isolation

Every one of the 9 new tables carries `organizationId` (→ `restrict`) and is queried exclusively through the same `requireMembership` → `requireModuleEnabled("performance")` → `requirePermission(...)` chain every other module uses — no route accepts a client-supplied `organizationId` without the existing membership-validation middleware. Cross-tenant IDs (a review ID, cycle ID, template ID, or rating-scale ID from another organization) never resolve — every lookup is always additionally filtered by `organizationId` from the authenticated membership, matching the pattern independently verified for Attendance/Recruitment in every prior phase's live QA (WWM cannot reach Acme's rows and vice versa, both directions).

## 26. RLS / Security

All 9 tables get `ENABLE ROW LEVEL SECURITY` with **zero policies**, in their own creation migration (not a follow-on batch) — identical to migration `0037`'s pattern. This relies on the same platform-wide fact documented in `docs/SUPABASE_SECURITY_REMEDIATION.md`: the application connects as the Postgres `postgres` role (`BYPASSRLS`), so RLS-enabled-with-no-policy is a complete deny-by-default gate against the anon/authenticated PostgREST path while remaining a no-op for the trusted server connection. A matching hand-authored `.down.sql` ships with the same migration, per the established pairing convention.

## 27. API Plan

**[PROPOSED DESIGN DECISION]** All routes under `/organizations/:organizationId/performance/...`, new OpenAPI tag `performance`:

| Method & Path | Purpose | Permission |
|---|---|---|
| `GET/POST /performance/rating-scales` | list/create scales | `performance.manage` (POST); read broad |
| `GET/PATCH /performance/rating-scales/:id`, `/levels` | manage levels | `performance.manage` |
| `GET/POST /performance/templates` | list/create templates | `performance.manage` (POST) |
| `GET/PATCH /performance/templates/:id`, `/competencies` | manage template + competency set | `performance.manage` |
| `GET/POST /performance/cycles` | list/create cycles | `performance.manage` (POST) |
| `GET/PATCH /performance/cycles/:id` | edit cycle | `performance.manage` |
| `POST /performance/cycles/:id/generate-reviews` | bulk-create `draft` reviews per applicability | `performance.manage` |
| `GET /performance/reviews` | org-wide list, filterable | `performance.manage` (org-wide) or `performance.read.own` (scoped) |
| `GET /performance/reviews/:id` | single review detail | `performance.read.own` (own/reviewer-of-record) or `performance.manage` |
| `POST /performance/reviews/:id/self-assessment` | submit self-assessment | `performance.write.own` |
| `POST /performance/reviews/:id/manager-review` | submit manager review | `performance.review.write` |
| `POST /performance/reviews/:id/finalize` | finalize (+ optional override) | `performance.finalize` |
| `POST /performance/reviews/:id/acknowledge` | employee acknowledgement | `performance.write.own` |
| `POST /performance/reviews/:id/reopen` | HR reopen to an earlier stage | `performance.manage` |
| `GET /performance/my-reviews` | ESS: caller's own reviews | `performance.read.own` |
| `GET /performance/team-reviews` | manager: reviews where caller is `reviewerEmployeeId` | `performance.review.write` |
| `GET /performance/dashboard` | tile metrics | `performance.reports.read` |
| `GET /performance/reports/:reportKey` | dedicated reporting route (§21) | `performance.reports.read` |

No unnecessary CRUD — e.g. no separate `DELETE` on any instance-level record (finalized reviews are durable; templates/scales are archived, never deleted).

## 28. Frontend Plan

Summarized fully in §17–19. Every page: `ModuleGate moduleKey="performance"` at route level, standard loading/error/empty states matching the existing pattern (a real "Access denied" state for 403, distinct from a generic error state, per Recruitment's precedent), responsive table/card components reused from existing pages — no new visual system, no new charting library (plain `Card`/`Badge`/`Table`, matching Attendance/Recruitment dashboards' explicit "no new charting library unless genuinely required" precedent).

## 29. Integration Matrix

| Foundation | Classification |
|---|---|
| Employees (id, `reportingManagerId`, `employmentStatus`) | **REQUIRED NOW** |
| Departments / Positions | **REQUIRED NOW** (applicability filters + historical snapshot) |
| Organization hierarchy (one-level manager relationship) | **REQUIRED NOW** |
| ESS | **REQUIRED NOW** |
| Documents (`employee_documents` + `fileStorage.ts`) | **REQUIRED NOW** (evidence, via a thin join table only) |
| Organization Settings (`performance` namespace) | **REQUIRED NOW** |
| Master Data | **OPTIONAL** (competency-label typeahead only) |
| Reporting Foundation | **REQUIRED NOW** (registry + dedicated route) |
| Audit | **REQUIRED NOW** |
| Attendance | **NO INTEGRATION** — per CLAUDE.md's explicit instruction not to couple Performance to Attendance merely because it now exists; a future deliberate integration (e.g. attendance data informing a review) would need its own separately-scoped approval |
| Leave | **NO INTEGRATION** in v1 |
| Recruitment | **NO INTEGRATION** |
| Notifications | **FUTURE** (deferred — no working infra exists, §23) |
| Payroll | **NO INTEGRATION** (doesn't exist yet) |
| Learning/Training | **FUTURE** (a "development action" concept could later link to Learning once that module exists; not built now) |

---

## 30. Security Threat Review

| Threat | Control |
|---|---|
| Employee views another employee's review | every read route filters by `employeeId = resolveOwnEmployeeId(...)` unless caller holds `performance.manage`/`.finalize`/reviewer-of-record match |
| Manager views a non-report's review | `reviewerEmployeeId` comparison against the review's own snapshotted column, never the employee's *current* `reportingManagerId` |
| Employee edits manager rating | `managerRatingValue`/`managerComment` columns are only ever set by the manager-review route, gated `performance.review.write` + reviewer-of-record; the self-assessment route's Zod schema excludes these fields entirely |
| Manager edits HR final score | `hrOverrideScore`/`hrOverrideReason` only settable by the finalize route, gated `performance.finalize` |
| Client spoofs `employeeId`/`reviewerEmployeeId` | never accepted from the client on any write route — always server-derived |
| Cross-tenant review/template/scale ID | every lookup additionally filtered by `organizationId` from the authenticated membership (§25) |
| Hidden draft/final review exposure | review-read DTO omits manager/HR fields from a caller in `self_assessment` stage unless they hold `performance.manage`/`.finalize` |
| CSV export scope leakage | export uses the exact same pre-authorized scope as the JSON response — no separate export permission/path |
| Aggregate dashboard leakage | dashboard built from the same scoped context object as the detail routes — never a raw org-wide query for a non-`performance.manage` caller |
| Stale transition/replay | atomic conditional `UPDATE ... WHERE status = 'expected'` on every transition — concurrent second attempt gets `409`, never a silent double-apply |
| Score manipulation | `computedOverallScore` is server-computed only, never client-supplied; override requires a separate permission + mandatory reason |
| Unauthorized reopen/finalize | both gated behind `performance.manage`/`.finalize` exclusively — no employee/manager path to either |
| Attachment leakage | evidence reuses `employee_documents`' existing authenticated, permission-checked read route — never served by static middleware |

## 31. Performance / Scalability

**[PROPOSED DESIGN DECISION]** Mirrors `attendanceReporting.ts`'s exact batching shape (~3 queries total per dashboard/report call, regardless of employee count): resolve the caller's scope once (own/reviewer-of-record/org-wide), fetch all applicable `performance_reviews` (+ joined goals/competencies) in one `inArray`-batched query, aggregate in-memory via `Map`/`for` loops. No per-employee-per-goal query loop anywhere. No caching layer introduced (none exists elsewhere on this platform; not introduced prematurely here either, per CLAUDE.md's "avoid premature abstraction").

## 32. Backup / Restore / Portability

No new infrastructure — Performance's 9 tables are ordinary additive Postgres tables, covered automatically by the existing platform-wide backup/restore/migration-portability model documented in `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` (standard `pg_dump`/restore, portable across shared/dedicated/evaluation deployment modes, no customer-specific fork).

## 33. Test Strategy (Future)

Schema constraints (weight-sum validation, unique `(cycleId, employeeId)`); service-layer rules (scoring formula, rounding, missing-score blocking); every state transition (happy path + wrong-prior-status 409 + concurrent-double-submit race); permission checks (all 6 keys, each direction); own/reviewer-of-record/org-wide scope (a manager cannot see a non-report; an org-wide caller sees everyone); tenant isolation (WWM/Acme cross-org denial, both directions, mirroring every prior phase's live QA); module-disabled 403; rating/weighting edge cases (single goal, zero goals with `goalsWeight=0`, qualitative goals excluded); historical-integrity regression (template edited after a review was created → existing review unchanged); concurrency (`Promise.all` double-submit test, mirroring Leave/Attendance's own regression tests); ESS self-assessment flow; manager-review flow; HR finalize + override flow; dashboard scoped correctly; reports scoped correctly + CSV headers; RLS re-confirmed via Supabase advisors + a direct anon-key PostgREST request returning `200 []`.

## 34. Live QA Strategy (Future)

Identical discipline to every prior phase: disposable WWM/Acme accounts, `organization_settings`' exact prior state read and restored, module-enablement reverted after, all disposable business records deleted afterward, genuine audit history preserved. Cross-tenant denial tested both directions. Production untouched throughout — no connection, no deploy, no migration, no QA data, at any point until separately approved.

---

## 35. Workstream Breakdown

Continuing from W72 (last complete workstream, Phase 3B Completion Report) — **next workstream is W73**. Continuing from migration `0037` — **next migration is `0038`**.

| ID | Title | Objective | Migration |
|---|---|---|---|
| **W73** | Performance Foundation & Module Activation | All 9 tables (§8), RLS enabled inline, 6 permissions seeded (§7), module `performance` flipped `hidden`→`active` in `module-definitions.ts` (available, not enabled for any org — mirrors W64 exactly), `lib/performanceAuthorization.ts` (mirrors `attendanceAuthorization.ts`'s shape), `performance` `organization_settings` namespace registered. **No routes, no frontend** — schema/auth primitives only, per the W64 precedent. | `0038` |
| **W74** | Rating Scales & Review Templates (HR Configuration) | CRUD API + `/performance-rating-scales` and `/performance-templates` pages; scale-immutability-once-used enforcement; weight-sum validation | none |
| **W75** | Performance Cycles & Review Assignment | Cycle CRUD API + `/performance-cycles` page; "generate reviews" bulk-assignment action (creates `draft` `performance_reviews`+goals(empty)+competencies-snapshot rows per applicability) | none |
| **W76** | Goals/Objectives Management | Goal CRUD within a review (employee- and manager-created per Open Decision 4), five measurement types, weight validation | none |
| **W77** | Self-Assessment (ESS) | `self_assessment`→`manager_review` transition; ESS "My Performance" tab (self-assessment form + history) | none |
| **W78** | Manager Review | `manager_review`→`hr_review` transition; `/performance-team` manager page | none |
| **W79** | HR Finalization & Acknowledgement | `hr_review`→`finalized`→`acknowledged` transitions, score override, reopen action (any stage → earlier stage) | none |
| **W80** | Internal HR/Manager Review List | `/performance-reviews` org-wide list/detail page | none |
| **W81** | Performance Dashboard & Reporting | `/performance/dashboard`, dedicated `routes/performanceReporting.ts`, 4 report keys registered + `/performance-reports` page | none |
| **W82** | Evidence/Attachments | `performance_review_evidence` wiring, `performance_evidence` Master Data code, UI attach/view on review & goal detail | none |
| **W83** | Phase 3C Verification | Full repo-wide verification pass against this frozen plan (mirrors W71: regression suite, migration drift check, RLS/advisor re-check, live cross-tenant QA) | none |
| **W84** | Phase 3C Completion Report | Formal closing record (mirrors W72) | none |

Each workstream ships independently, with its own Definition of Done (below), and stops before the next begins — exactly the discipline W64–W72 followed.

## 36. Definitions of Done

Per-workstream DoD, generically: (1) the workstream's own scope line above, fully built — nothing from a later workstream pulled forward; (2) full backend + frontend test suites pass, including new tests for this workstream; (3) typecheck clean on both packages; (4) OpenAPI/codegen byte-identical across two consecutive runs (once routes exist); (5) zero unexpected migration drift; (6) all three production builds succeed; (7) live QA against development per §34, with before/after `organization_settings` state confirmed identical; (8) audit events verified recorded exactly once per real transition, zero on read-only surfaces; (9) production untouched. W73's own DoD additionally requires: `organization_modules` confirmed to have zero rows for `performance` after the workstream (available, not enabled anywhere, mirroring W64's own explicit check).

## 37. Open Decisions

Kept deliberately small — only genuine business-policy calls, not technical details resolvable from existing architecture:

| # | Decision | Option A | Option B | Recommendation | Reason |
|---|---|---|---|---|---|
| 1 | Does employee self-rating contribute numerically to the final score? | No — comment/reference-only; manager score is authoritative | Yes — blended with manager score via a configurable weight | **A** | Avoids inventing a blend-weighting algorithm with no roadmap basis; matches "manager score authoritative" as the safer v1 default; can be revisited as an explicit future enhancement |
| 2 | Is employee acknowledgement of a finalized review required? | Required by default (org-configurable via the `performance` settings namespace) | Optional entirely | **A** | Matches the "seen, not agreed" framing the discovery brief itself specifies; gives HR a completion signal without implying score sign-off |
| 3 | Does v1 include a formal appeal/dispute workflow? | No — defer; only an optional acknowledgement comment | Yes — build a structured dispute/appeal state | **A** | The brief explicitly warns against accidentally building an employee-relations case-management system inside Performance |
| 4 | Are goals employee-proposed, manager-assigned, or both? | Manager-only | Both (either party creates; either may edit until self-assessment is submitted) | **B** | Matches how most real organizations actually use goal-setting (collaborative), and needs no extra state beyond a `createdBy` column already in the schema |
| 5 | Do review templates support custom questions in v1? | No — goals + competencies + ratings + comments only | Yes — a flexible Q&A engine | **A** | Custom-question engines are a meaningfully separate scope (dynamic form schema, response storage, reporting complexity) with no stated roadmap requirement; can be a clean v2 addition |
| 6 | Does v1 include Performance Improvement Plans (PIP)? | No — explicitly deferred to a future Employee Relations module | Yes — build within Performance | **A** | The brief explicitly warns against casually adding disciplinary functionality into Performance |

## 38. Production Rollout Boundary

**Nothing in this plan authorizes touching production.** Every workstream (W73–W84) targets the development Supabase project (`vkvirwdxoiwsiftaarox`) only, exactly like every Attendance/Recruitment workstream before it. Production rollout is a separate, later, explicitly-approved action requiring its own migration-verification, environment-validation, and rollback-strategy review per CLAUDE.md's Deployment section — not addressed by this document and not implied by its approval.
