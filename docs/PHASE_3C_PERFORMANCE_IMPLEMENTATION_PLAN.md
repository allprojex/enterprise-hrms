# Phase 3C — Performance: Frozen Implementation Plan

Status: **FROZEN — APPROVED FOR IMPLEMENTATION** (2026-08-20). No workstream may begin execution until this freeze date; W73 is the first implementation workstream, and does not begin merely because this document is frozen — it still requires its own separate go-ahead, exactly as W64 did after `PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md` was frozen.

This document was produced across two sessions: an initial discovery/draft pass (no migrations, no routes, no frontend pages, no permission seeding, no module activation, no production access), and this final-reconciliation pass (owner decisions recorded, lifecycle/scoring/historical-integrity/permissions/workstreams reconciled against those decisions — again with no migration, route, frontend, permission seed, module activation, or production access performed). Every claim about the existing codebase was verified by direct inspection (file paths cited); every new-design element is explicitly labeled.

Two labels are used throughout:
- **[ROADMAP REQUIREMENT]** — literally stated in `ROADMAP.md` / `PROJECT_STATUS.md`.
- **[PROPOSED DESIGN DECISION]** — filled in by this document; not pre-existing.
- **[OWNER DECISION — APPROVED 2026-08-20]** — a business-policy call made by the owner during final reconciliation, superseding the draft's own "recommendation" framing.

---

## 0. Owner Decisions — Approved (2026-08-20)

The following six decisions were open in the draft and are now resolved. They are load-bearing on §10–§13, §37, and the workstream scope in §35 — every downstream section has been reconciled to them.

| # | Decision | Approved answer |
|---|---|---|
| 1 | Does employee self-rating contribute numerically to the final score? | **No.** Retained for comparison/context only; excluded from the scoring formula (§11). |
| 2 | Is employee acknowledgement of a finalized review required? | **Yes.** Acknowledgement means "I have seen this review," not "I agree with this review" (§14, §17). |
| 3 | Does v1 include a formal appeal/dispute workflow? | **No.** Deferred. An optional final employee comment is allowed at acknowledgement (§17). |
| 4 | Are goals employee-proposed, manager-assigned, or both? | **Both.** Employee-created goals are proposals; a proposed goal is not official review criteria merely because the employee created it — it becomes official only once the manager accepts it (§12). |
| 5 | Do review templates support custom questions in v1? | **No.** V1 uses structured goals/KPIs and competencies only. |
| 6 | Does v1 include Performance Improvement Plans (PIP)? | **No.** Explicitly deferred to a future Employee Relations module. |

---

## 1. Purpose

Define the complete, frozen architecture and workstream sequence for the Performance module — the next undelivered item in `ROADMAP.md`'s Phase 3 ("Workforce Operations") ordering, per `PROJECT_STATUS.md`'s own "Next Roadmap Step" note (line 274): Recruitment and Attendance are complete; Leave and Employee Self Service were already delivered in Phase 2B; **Performance is next**. This plan exists so implementation (W73 onward) can proceed in small, controlled, independently-shippable workstreams without redesigning the module mid-build — the same discipline `PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` and `PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md` already established.

**[ROADMAP REQUIREMENT]** `ROADMAP.md` names "Performance" as a Phase 3 item with no further elaboration — no scope description, no dependencies, no explicit deferrals. Everything beyond the bare name is a **[PROPOSED DESIGN DECISION]**, now finalized by the Owner Decisions in §0 and the reconciliation below.

**Filename note:** the discovery brief suggested `docs/PERFORMANCE_IMPLEMENTATION_PLAN.md`; this repository's own established convention is `docs/PHASE_<N><letter>_<MODULE>_IMPLEMENTATION_PLAN.md` (`PHASE_3A_RECRUITMENT...`, `PHASE_3B_ATTENDANCE...`). Following that convention exactly, this document is `docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md`.

---

## 2. Existing Architecture Reused

Unchanged from the draft — nothing here is new platform infrastructure; every one of these is an existing, working primitive Performance will consume unchanged:

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

**No new platform primitive is required to build Performance.**

---

## 3. Scope (Frozen V1)

- Performance Cycles (org-configured periods with self-assessment / manager-review / HR-finalization windows)
- Review Templates (reusable, snapshot-preserved competency sets + weighting + rating scale reference)
- Rating Scales (organization-configurable, not hardcoded 1–5)
- Goals/Objectives — **manager-created (official immediately) and employee-proposed (official only once manager-accepted)**, five measurement types
- Competencies (per-review, snapshotted from a template at assignment time)
- Self-Assessment (ESS)
- Manager Review (direct-report scope, one level, server-derived)
- HR Review & Finalization (with optional score override + mandatory reason)
- Employee Acknowledgement — **required**, "seen" not "agreed," optional final comment
- Evidence/Attachments (reusing `employee_documents` — a lightweight join table only)
- Performance Dashboard (own dedicated route, mirroring Attendance's W70 precedent)
- 4 initial reports via a dedicated, visibility-scoped reporting route
- Full audit trail on every state transition, reopen, and goal-acceptance decision

## 4. Non-Goals (Deferred)

- Formal appeal/dispute/case-management workflow — **[OWNER DECISION]** deferred; only an optional final employee comment ships in v1
- Performance Improvement Plans (PIP) — **[OWNER DECISION]** explicitly deferred to a future Employee Relations module
- Custom questions on templates — **[OWNER DECISION]** deferred; v1 uses structured goals/KPIs and competencies only
- In-app/email notifications (no working notification delivery infra exists platform-wide today — see §23)
- Numeric contribution of employee self-rating to the final score — **[OWNER DECISION]** self-rating is comment/reference-only (see §11)
- Multi-level (recursive) manager hierarchy — matches the platform-wide one-level-only precedent
- Overachievement scoring beyond 100% of a numeric/percentage/currency goal target
- Template versioning as a first-class entity (achieved instead via snapshot-at-creation — see §9)
- A dedicated review-revision-history table (achieved instead via a `revisionNumber` counter + the existing `audit_events` before/after state — see §10.4)
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

Uses the platform's existing 4-role model (`super_admin`, `org_admin`, `hr_manager`, `employee`) — **no dedicated "manager" role exists anywhere on this platform** (confirmed: `seed-roles-permissions.ts`, and repeatedly documented in Attendance/Recruitment history). "Manager" is not a role; it is a *relationship*, resolved server-side from the review's own snapshotted `reviewerEmployeeId` (§9), exactly like Attendance and Leave already resolve `reportingManagerId`.

| Persona | Platform role | Performance capability |
|---|---|---|
| Employee | `employee` | Own reviews, own self-assessment, propose goals, acknowledgement |
| Manager (relationship, not a role) | `employee` (+ `reviewerEmployeeId` match on the specific review) | Manager-review, accept/edit/reject proposed goals, on reviews where they are reviewer of record only |
| HR | `hr_manager` | Cycles, templates, rating scales, assignment, org-wide read, finalize, override, reopen, reports |
| Org Admin | `org_admin` | Everything HR can do |
| Super Admin | `super_admin` | Platform-wide (via existing seeding convention: all permissions) |

---

## 7. Permissions

**Revalidated against the corrected lifecycle (§10) and goal-authorship model (§12) — the original 6 keys remain sufficient; no new key is required.** Goal accept/edit/reject is a `manager_review`-stage action performed by the reviewer of record, so it is gated by the same `performance.review.write` key that already gates manager-review submission — adding a separate `performance.goal.approve` key would duplicate an already-narrowed scope for no additional control. Reopen remains exclusively `performance.manage`. Score override remains exclusively `performance.finalize`.

**[PROPOSED DESIGN DECISION — reconfirmed]** Following the Attendance precedent (broad grant + service-layer narrowing via `reportingManagerId`/assignee-column comparison), Performance uses **6 keys**, none of them a `.team` variant:

| Key | Purpose | Scope resolution |
|---|---|---|
| `performance.read.own` | View own reviews/goals/competencies, and (via service-layer comparison) reviews where caller is the snapshotted `reviewerEmployeeId` | own: employeeId match; manager: pure comparison against `performance_reviews.reviewerEmployeeId`, same shape as `isReportingManagerOf` |
| `performance.write.own` | Submit/edit own self-assessment (goal results, self-ratings, comments, goal proposals), acknowledge finalized review | own only |
| `performance.review.write` | Submit manager review (ratings, comments, goal verification); accept/edit/reject employee-proposed goals; mark goals/competencies not-applicable | narrowed to `reviewerEmployeeId` match on the specific review row — never broadened by the permission grant alone, mirrors `recruitmentAuthorization.ts`'s "assigned" tier |
| `performance.manage` | Create/edit cycles, templates, rating scales; generate/assign reviews; **reopen** any review to an explicit valid stage; org-wide read | organization-wide only |
| `performance.finalize` | HR finalize a review, optionally override score (requires reason) | organization-wide only |
| `performance.reports.read` | Dashboard + reports | broad grant, scope resolved in service layer exactly like `recruitment.reports.read` (own/reviewer-of-record vs. org-wide signaled by holding `performance.manage`) |

### Final role matrix

| Key | employee | manager (relationship) | hr_manager | org_admin | super_admin |
|---|:---:|:---:|:---:|:---:|:---:|
| `performance.read.own` | ✓ (own) | ✓ (own + reviewer-of-record, via same grant) | ✓ (org-wide via `performance.manage`) | ✓ | ✓ |
| `performance.write.own` | ✓ | ✓ (own only — being a manager grants no extra write-own reach) | — (uses `performance.manage`/`.finalize` instead) | ✓ | ✓ |
| `performance.review.write` | ✓ (grant present, but narrowed to zero effect unless reviewer of record on a specific review) | ✓ (effective on reviews where reviewer-of-record) | ✓ | ✓ | ✓ |
| `performance.manage` | — | — | ✓ | ✓ | ✓ |
| `performance.finalize` | — | — | ✓ | ✓ | ✓ |
| `performance.reports.read` | ✓ (own/reviewer-of-record scope) | ✓ (same) | ✓ (org-wide via `performance.manage`) | ✓ | ✓ |

"Manager" is not a separate row in the role-seeding table (it isn't a role) — the matrix above shows it as an `employee`-role holder whose grants become *effective* only on rows where the service layer's `reviewerEmployeeId` comparison matches. No over-granting: an `employee` with no direct reports and no proposed reviews has every one of these permissions but zero rows they can act on beyond their own.

---

## 8. Data Model

**Final table count: 9 — unchanged from the draft.** Table names unchanged. Changes from the draft are additive columns only, driven directly by the Owner Decisions and lifecycle correction below (goal authorship/acceptance state, not-applicable handling, revision counter, and settings-snapshot columns for full historical determinism). All 9 tables remain organization-owned, RLS-enabled with zero policies in their own creation migration, created in one schema-only workstream (W73), mirroring Attendance's W64 precedent exactly.

### 8.1 `performance_rating_scales` (definition, org-owned) — unchanged
| Column | Notes |
|---|---|
| id, organizationId | organizationId → `restrict` |
| name, description | |
| status | `active` \| `archived` — **immutable once any review references it** (editing levels is blocked once `usageCount > 0`; org must archive and create a new scale version instead) |
| createdAt |

### 8.2 `performance_rating_scale_levels` (child of 8.1) — unchanged
| Column | Notes |
|---|---|
| id, ratingScaleId (→ `restrict`) | |
| value (numeric) | the actual score value, e.g. 1–5; not required to be sequential |
| label, description | e.g. "Exceeds Expectations" |
| sortOrder | |
| Unique | `(ratingScaleId, value)` |

### 8.3 `performance_review_templates` (definition, org-owned) — unchanged
| Column | Notes |
|---|---|
| id, organizationId | |
| name, description | |
| ratingScaleId (→ `restrict`) | |
| goalsWeight, competenciesWeight | integers, **must sum to 100**, validated at save time |
| applicabilityScope | `all_active` \| `department` \| `position` \| `manual` |
| applicabilityDepartmentIds, applicabilityPositionIds | jsonb integer arrays — filter config, not a relational entity |
| status | `draft` \| `active` \| `archived` |
| createdAt, updatedAt |

Editing an `active` template only affects reviews created *after* the edit — existing reviews already snapshotted their competencies/weights (§9). No template-versioning table is needed.

### 8.4 `performance_template_competencies` (child of 8.3) — unchanged
| Column | Notes |
|---|---|
| id, templateId (→ `cascade`) | |
| label, description | free text by default; an organization-defined Master Data domain (e.g. `competency`) may optionally supply typeahead suggestions — not FK-enforced |
| weight, sortOrder | weights within a template must sum to 100 |

### 8.5 `performance_cycles` (org-owned) — unchanged
| Column | Notes |
|---|---|
| id, organizationId | |
| name, cycleType | `annual` \| `semiannual` \| `quarterly` \| `monthly` \| `probation` \| `ad_hoc` |
| startDate, endDate | |
| selfAssessmentWindowStart/End, managerReviewWindowStart/End, hrFinalizationWindowStart/End | |
| templateId (→ `restrict`), ratingScaleId (→ `restrict`) | default for this cycle's generated reviews |
| applicabilityScope, applicabilityDepartmentIds, applicabilityPositionIds | same shape as 8.3, cycle-level override |
| status | `draft` → `open` → `closed` → `archived` (§10.5) |
| createdAt |

### 8.6 `performance_reviews` (the instance — one per employee per cycle) — **amended**
| Column | Notes |
|---|---|
| id, organizationId | |
| cycleId (→ `restrict`), templateId (→ `restrict`), ratingScaleId (→ `restrict`) | `templateId`/`ratingScaleId` retained for traceability only — never re-consulted for content after creation (§9) |
| employeeId (→ `restrict`) | |
| reviewerEmployeeId | **snapshot** of `employees.reportingManagerId` at assignment time — fixed for this review even if the employee's manager later changes |
| departmentIdSnapshot, positionIdSnapshot | snapshotted at assignment time |
| goalsWeight, competenciesWeight | copied from template at creation |
| **scoringPrecisionSnapshot** *(new)* | copied from the `performance` settings namespace at creation time — a later org-wide precision change never alters an existing review's displayed score |
| **acknowledgementRequiredSnapshot** *(new)* | copied from the `performance` settings namespace at creation time — a later org-wide toggle never retroactively changes whether an in-flight review requires acknowledgement |
| status | state machine — **authoritative field, see §10** |
| selfAssessmentSubmittedAt, managerReviewSubmittedAt, hrFinalizedAt, acknowledgedAt | **informational metadata only** — never read by any authorization/business-logic check to infer stage; `status` alone is authoritative (§10.4) |
| employeeFinalComment | optional, entered at acknowledgement |
| computedOverallScore | always the formula's output — never overwritten |
| hrOverrideScore, hrOverrideReason | nullable; reason required if score is set; original `computedOverallScore` is preserved alongside, never replaced |
| **revisionNumber** *(new, default 1)* | incremented by 1 on every HR reopen action (§10.4) — a lightweight, purely informational counter; full detail of what changed on each reopen lives in `audit_events`' `beforeState`/`afterState`, not a new table |
| createdAt, updatedAt |
| Unique | `(cycleId, employeeId)` — one review per employee per cycle |
| Indexes | `(organizationId, employeeId)`, `(organizationId, reviewerEmployeeId)`, `(organizationId, cycleId, status)` |

### 8.7 `performance_review_goals` (child of 8.6) — **amended (goal-authorship state model)**
| Column | Notes |
|---|---|
| id, reviewId (→ `cascade`) | |
| title, description | |
| measurementType | `numeric` \| `percentage` \| `currency` \| `boolean` \| `rating` \| `qualitative` |
| target, actualResult, unit | nullable, per type; `actualResult` is the **manager-verified official value** (settable only during `manager_review`) — the employee's own claim is captured in `employeeComment`, not a separate structured column (avoids duplicating structured data for no added scoring value) |
| weight | must be **0** for `qualitative`; weights of scored, `accepted`, non-N/A goals must sum to 100 (§11) |
| dueDate, status | `not_started` \| `in_progress` \| `completed` \| `missed` |
| employeeComment, managerComment | |
| computedScore | normalized 0–100, computed at manager-submit time (§11); `null` while `approvalStatus != 'accepted'` |
| **originType** *(replaces the draft's `createdBy`)* | `manager` \| `employee_proposed` |
| **approvalStatus** *(new)* | `accepted` \| `proposed` \| `rejected`. Manager-created goals are inserted with `approvalStatus = 'accepted'` immediately (official once saved, per Owner Decision 4). Employee-proposed goals are inserted with `approvalStatus = 'proposed'` and become official **only** when the manager accepts them during `manager_review` (§12). `rejected` goals are retained, never deleted, and excluded from weighting/scoring. |
| **notApplicable, notApplicableReason** *(new)* | manager-only, settable during `manager_review`; reason required when `true`; excluded from weighting via proportional redistribution (§11) |

### 8.8 `performance_review_competencies` (child of 8.6 — snapshotted from template at creation) — **amended**
| Column | Notes |
|---|---|
| id, reviewId (→ `cascade`) | |
| label, description | copied text, **not a live FK** to `performance_template_competencies` |
| weight, sortOrder | copied from template; must sum to 100 across a review's applicable competencies |
| employeeRatingValue, employeeComment | self-rating — **informational/comparative only, excluded from the scoring formula** (Owner Decision 1) |
| managerRatingValue, managerComment | authoritative for scoring |
| **notApplicable, notApplicableReason** *(new)* | manager-only, settable during `manager_review`; reason required when `true`; excluded from weighting via proportional redistribution (§11) |

### 8.9 `performance_review_evidence` (lightweight join — reuses existing storage) — unchanged
| Column | Notes |
|---|---|
| id, reviewId (→ `cascade`), goalId (nullable, → `cascade`) | attaches at review level or a specific goal |
| employeeDocumentId (→ `restrict`) | points into the **existing** `employee_documents` table — no new storage layer |
| addedByMembershipId, addedAt | |

No new file-storage code is written; a new `document_category` Master Data code (e.g. `performance_evidence`) is registered.

---

## 9. Historical Integrity

Mechanism: **snapshot-at-creation, not live-reference**. Per the reconciliation requirement, every field that could plausibly matter to explaining a review years later is now individually classified as **LIVE REFERENCE** or **SNAPSHOT**:

| Field | Classification | Reasoning |
|---|---|---|
| Employee identity (`employeeId`) | **LIVE REFERENCE** (FK, never hard-deleted) | Identity itself doesn't need snapshotting — the row is permanent |
| Employee display name / employee number | **LIVE REFERENCE** (resolved live via join, never stored on the review) | A later name/number correction is a data-quality fix, not a meaningful historical fact — unlike a department transfer, it should retroactively read correctly everywhere, including old reviews |
| Department | **SNAPSHOT** (`departmentIdSnapshot`) | A transfer is a meaningful historical fact — the review must show where the employee was *at that time* |
| Position/designation | **SNAPSHOT** (`positionIdSnapshot`) | Same reasoning — a promotion/transfer is meaningful history |
| Manager/reviewer | **SNAPSHOT** (`reviewerEmployeeId`) | A later manager change must never reassign an in-flight or historical review |
| Review template (which one was used) | **LIVE REFERENCE, traceability only** (`templateId`) | Kept for "which template generated this" auditability; never re-read for content after creation |
| Review template content (competencies, weights) | **SNAPSHOT** (`performance_review_competencies` columns) | A later template edit must never rewrite existing review criteria |
| Rating scale / rating levels | **LIVE REFERENCE, protected by immutability lock** (`ratingScaleId`) | Duplicating every level row into every review would be pure redundancy the platform's own "don't duplicate for identity/history concepts unnecessarily" discipline warns against; safe as a live reference *only* because editing is structurally blocked once any review uses the scale (§8.1) — so a live reference cannot alter historical meaning |
| Competency name/description | **SNAPSHOT** (`performance_review_competencies.label`/`description`) | Copied plain text, not an FK |
| Competency weight | **SNAPSHOT** (`performance_review_competencies.weight`) | |
| Goal title/definition | **SNAPSHOT** (inherently — goal rows are review-owned from creation, no separate "goal library" to diverge from) | |
| Goal target/unit | **SNAPSHOT** (`performance_review_goals.target`/`unit`) | |
| Goal weight | **SNAPSHOT** (`performance_review_goals.weight`) | |
| Scoring configuration (`goalsWeight`/`competenciesWeight`, `scoringPrecision`, `acknowledgementRequired`) | **SNAPSHOT** (`performance_reviews.goalsWeight`/`competenciesWeight`/`scoringPrecisionSnapshot`/`acknowledgementRequiredSnapshot`) | A later org-wide settings change (either the `performance` namespace or a template edit) must never alter a review already created |

Full change-table (unchanged from the draft, now with the settings-snapshot gap closed):

| Changes later... | Effect on existing finalized reviews |
|---|---|
| Employee's department/position/manager changes | **No effect** — all three are snapshotted |
| Template is edited or archived | **No effect** — competencies were copied at creation |
| Competency library entry renamed | **No effect** |
| Rating scale levels edited | **Cannot happen** — blocked once `usageCount > 0` |
| `performance` settings namespace changes (precision, acknowledgement requirement) | **No effect** — both are now snapshotted onto the review row at creation |
| Competency/rating-scale row is later archived | Status-only change, never a hard delete |

**Finalized reviews are durable historical business records** — never mutated after `finalized`, except by an explicit, controlled, fully-audited HR **reopen** action (§10.4).

---

## 10. Review Lifecycle (State Machine) — Corrected

**`performance_reviews.status` is the sole authoritative field for workflow stage.** The `*SubmittedAt`/`*FinalizedAt`/`acknowledgedAt` timestamp columns and `revisionNumber` are informational metadata for display/reporting only — no authorization check, no route guard, and no business-logic branch anywhere is permitted to infer stage from a nullable timestamp instead of `status`. This is enforced at the service-layer function signature level: every transition function takes and validates against `status` explicitly, exactly like `leaveApprovals.ts`'s `WHERE status = 'pending'` pattern — never `WHERE approved_at IS NULL`.

```
draft → self_assessment → manager_review → hr_review → finalized → acknowledged
```

### 10.1 Transition table

| # | Transition | Actor | Permission | Prerequisites |
|---|---|---|---|---|
| 0 | (cycle `open` action) → rows created in `draft` | HR/org_admin | `performance.manage` | cycle status = `open`; one row per applicable employee; goals (manager-created only, if any pre-authored) and competencies snapshotted from template |
| 1 | `draft` → `self_assessment` | HR/org_admin | `performance.manage` | cycle's self-assessment window has started (or HR opens manually) |
| 2 | `self_assessment` → `manager_review` | Employee (submit, own review only) | `performance.write.own` | every non-qualitative, non-N/A `accepted`-goal has an employee comment/entry; every competency has `employeeRatingValue` set; no missing required field |
| 3 | `manager_review` → `hr_review` | Manager (reviewer of record, submit) | `performance.review.write` | every `accepted` goal has `actualResult`/`computedScore` (or is marked `notApplicable`); every competency has `managerRatingValue` (or is marked `notApplicable`); every `proposed` goal has been explicitly `accepted` or `rejected` (none left pending) |
| 4 | `hr_review` → `finalized` | HR/org_admin | `performance.finalize` | — (HR may finalize with or without an override); computes `computedOverallScore` at this transition |
| 5 | `finalized` → `acknowledged` | Employee (own review only) | `performance.write.own` | review's own `acknowledgementRequiredSnapshot` — if `false`, acknowledgement is optional but still permitted |
| 6 | reopen: `{manager_review, hr_review, finalized}` → an earlier explicit valid stage | HR/org_admin only | `performance.manage` | mandatory `reopenReason`; target stage must be one of `self_assessment`, `manager_review`, `hr_review` — never an arbitrary jump, never forward, never into `draft`/`acknowledged` |

### 10.2 Field editability per state

| State | Employee may edit | Manager may edit | HR may edit |
|---|---|---|---|
| `draft` | nothing (not yet visible to employee) | goals (create, `originType='manager'`, auto-`accepted`) | cycle/template/scale config (separate pages, not the review row) |
| `self_assessment` | own `employeeComment`/`employeeRatingValue` fields; may propose new goals (`originType='employee_proposed'`, `approvalStatus='proposed'`) | nothing on this review | nothing routine |
| `manager_review` | **locked** (self-assessment submission locks all employee-writable fields) | `actualResult`/`computedScore`/`managerComment` per goal; `managerRatingValue`/`managerComment` per competency; accept/edit/reject `proposed` goals; set `notApplicable`+reason on goals/competencies | nothing routine |
| `hr_review` | locked | **locked** (manager submission locks all manager-writable fields) | `hrOverrideScore`/`hrOverrideReason`; finalize action |
| `finalized` | locked | locked | locked (only reopen, §10.4, reverses this) |
| `acknowledged` | `employeeFinalComment` (once, at acknowledgement) | locked | locked |

**What becomes locked after submission:** each submit action (self-assessment, manager review) is itself the lock — the target state's own field-editability row above defines what closes; there is no separate "lock" flag, since `status` alone already gates every write route's Zod-validated field set (an employee-facing route's schema simply does not accept manager-only fields, regardless of stage, satisfying defense-in-depth independently of the stage check).

### 10.3 Atomic and concurrent-transition behavior

Every transition (rows 1–6 above) is a single atomic conditional update:

```sql
UPDATE performance_reviews
SET status = '<target>', ...
WHERE id = ? AND organization_id = ? AND status = '<expected_prior_status>'
```

mirroring `leaveApprovals.ts`/`attendanceAdjustments.ts` exactly. Zero rows affected (a concurrent second submit, or a stale client retry) returns `409 Conflict`, never a silent double-transition and never `500`. Goal accept/reject actions (§12) use the identical pattern keyed to `(goalId, approvalStatus = 'proposed')`.

### 10.4 Reopen — controlled rule (replaces the draft's "any earlier stage")

Authorized HR (`performance.manage`) may reopen a review **only** when all of the following hold:

1. The review's current `status` is one of `manager_review`, `hr_review`, or `finalized` (a review still in `draft`/`self_assessment` has nothing to reopen; `acknowledged` is also reopenable via the same rule, treated as equivalent to `finalized` for this purpose since acknowledgement makes no field changes).
2. A **mandatory `reopenReason`** (non-empty text) is supplied in the request.
3. The **target stage** is an explicit, valid earlier stage — one of `self_assessment`, `manager_review`, `hr_review` — never an arbitrary jump (e.g. `finalized` cannot reopen directly to `draft`), never forward, and never into a terminal `acknowledged` state.
4. Actor (`actorMembershipId`) and timestamp (`occurredAt`) are recorded — via the existing `recordAuditEvent` call, not a duplicate column on `performance_reviews`.
5. The action is audited: `performance_review.reopened`, `metadata: { targetStage, reason }`, `beforeState`/`afterState` capturing the full row before/after — the same shape every other audited mutation on this platform already uses.

**What reopening does and does not do:**
- Sets `status` to the target stage.
- Clears only the timestamp(s) and decision fields strictly **downstream** of the target stage (e.g. reopening to `manager_review` clears `managerReviewSubmittedAt`, `hrFinalizedAt`, `acknowledgedAt`, `hrOverrideScore`, `hrOverrideReason`, `computedOverallScore`).
- **Does not** blank the actual field values (self-assessment answers, manager ratings, HR override reason text, etc.) below the target stage — they remain in place as an editable starting point, since the point of a reopen is correction, not restarting from scratch.
- **Does not** erase prior submission/decision history — the pre-reopen values of every cleared field are already permanently preserved in the `audit_events` row(s) recorded at the time they were originally submitted (each submission's own audit event already captures `beforeState`/`afterState`), so nothing is destroyed even though the live row is overwritten on the next submission.
- Increments `revisionNumber` by 1 — a small, purely informational counter (e.g. "Revision 2") surfaced in the UI so HR/employee/manager can see at a glance that a review was corrected, without needing a full revision-row table.

**Smallest robust approach, consistent with the existing audit architecture:** no new revision-snapshot table is introduced. `revisionNumber` (one integer column) plus the existing `audit_events.beforeState`/`afterState` on every transition together give both an at-a-glance signal ("this was revised") and full forensic detail ("exactly what changed, by whom, when, why") — the same two-tier pattern (a cheap denormalized counter + the append-only audit log as the source of truth) already implicit in how every other module on this platform handles history, without inventing new infrastructure.

### 10.5 Cycle-level state machine (independent from review-level)

`draft → open → closed → archived`. `open` is the only cycle action that mutates data (generates review rows). `closed`/`archived` are read-only historical states, set by HR manually (no background-job/cron infrastructure is assumed available in v1).

---

## 11. Rating/Scoring — Frozen Rules

**Official score source: manager scores only.** Employee self-rating is informational/comparative and is structurally excluded from every formula below (Owner Decision 1).

### 11.1 Per-item normalization (0–100)

- `numeric`/`percentage`/`currency` goal: `clamp(actualResult / target × 100, 0, 100)` — no overachievement bonus in v1.
- `boolean` goal: 100 if `actualResult` indicates complete, else 0.
- `rating` goal: `(chosen level value / max level value in the review's rating scale) × 100`.
- `qualitative` goal: no score; `weight` is structurally forced to 0 at goal-creation validation.
- Competency: `(managerRatingValue / max level value) × 100`. `employeeRatingValue` is never used in this formula.

### 11.2 Which items count

An item (goal or competency) is **included** in its section's weighted average only if **all** of the following hold: it is a goal with `approvalStatus = 'accepted'` (competencies have no approval concept — always included unless N/A), it is not `qualitative` (goals only), and it is not `notApplicable`.

### 11.3 Not-applicable handling — one deterministic rule

A goal or competency may be marked `notApplicable = true` (manager-only, during `manager_review`, `notApplicableReason` required). This is the single explicit N/A rule, chosen over both "block submission" and "leave weight orphaned":

- **Redistribution is proportional, within the same section, computed at calculation time — never by mutating stored weights.** For a section (goals or competencies) with N/A items removed, each remaining applicable item's *effective* weight is:

  ```
  effectiveWeight(item) = storedWeight(item) / (100 − Σ storedWeight(N/A items in this section)) × 100
  ```

  so the remaining applicable items' effective weights always sum to exactly 100, and the weighted-average formula (§11.4) is applied using effective, not stored, weights.
- **If every item in a section is N/A** (or the section is `qualitative`-only/empty of accepted goals), that section's average is `null` and its weight contributes **0** to the overall score; the *other* section's weight is redistributed to 100% for that review's overall-score calculation.
- **If both sections end up with a `null` average** (pathological — blocked before this can occur, see §11.6), the review cannot be submitted for manager review at all.

### 11.4 Weighted averages and overall score

```
goalsAvg        = Σ(goalScore × effectiveGoalWeight) / 100   [over accepted, non-qualitative, non-N/A goals]
competenciesAvg = Σ(competencyScore × effectiveCompetencyWeight) / 100

effectiveGoalsWeight, effectiveCompetenciesWeight =
  the review's stored goalsWeight/competenciesWeight, OR — if one section's average is null per §11.3 —
  0 for the null section and 100 for the other

overallScore = round(
  goalsAvg × effectiveGoalsWeight/100 + competenciesAvg × effectiveCompetenciesWeight/100,
  scoringPrecisionSnapshot
)
```

Rounding: standard round-half-up, applied **once**, at the final `overallScore` only (intermediate averages are computed at full precision, never persisted separately — they can always be recomputed from the stored per-item scores if ever needed, avoiding derived-data duplication).

### 11.5 Weighting validation

- `goalsWeight + competenciesWeight` must equal exactly 100 — validated at template save time, and copied onto the review at creation.
- Individual goal weights (excluding `qualitative`, which must be 0) among `accepted` goals must sum to 100 — validated at self-assessment submission and again at manager-review submission (defense in depth).
- Individual competency weights must sum to 100 across a review's competencies — validated at review creation (snapshot time) and unaffected thereafter (competencies aren't user-addable per-review in v1, only goals are).

### 11.6 Missing-score / undefined-denominator handling

Manager submission (`manager_review → hr_review`) is **blocked** (400, listing exactly what's missing) unless:
- every `accepted`, non-qualitative, non-N/A goal has `actualResult` set, **and**
- every non-N/A competency has `managerRatingValue` set, **and**
- at least one of the two sections (goals or competencies) has at least one scoreable (accepted, non-N/A, non-qualitative) item — i.e. **not both sections may be entirely empty/N/A/qualitative-only**, which is exactly the §11.3 pathological case; blocking it here means it can never reach the scoring formula.

**No undefined denominator ever reaches the formula** — §11.3's redistribution guarantees a defined denominator whenever a section has ≥1 applicable item, and §11.6 guarantees at least one section does.

---

## 12. Goals — Authorship State Model

**Smallest state model that satisfies Owner Decision 4**, added directly to `performance_review_goals` (§8.7), no separate table:

```
originType:      manager | employee_proposed
approvalStatus:  accepted | proposed | rejected
```

| Path | `originType` | Initial `approvalStatus` | Becomes official when |
|---|---|---|---|
| Manager creates a goal (in `draft` or `manager_review`) | `manager` | `accepted` | Immediately, on save — no separate approval step |
| Employee proposes a goal (only during `self_assessment`, on their own review) | `employee_proposed` | `proposed` | Manager explicitly accepts it during `manager_review` (may edit title/target/weight/dueDate in the same action) |

- A `proposed` goal is visible to the manager during `manager_review` alongside manager-created goals, but is **excluded from weighting/scoring** (§11.2) until `accepted`.
- Manager may `accept` (optionally editing fields first), `edit`-then-`accept`, or `reject` (with `managerComment` explaining why — reuses the existing comment field, no new column) each `proposed` goal. **No `proposed` goal may remain unresolved** when the manager submits — §10.1 row 3's prerequisite blocks the `manager_review → hr_review` transition otherwise.
- A `rejected` goal is retained (never deleted, per the platform's never-hard-delete convention) but permanently excluded from weighting/scoring for this review.
- **Once a goal is `accepted` and the review has moved into `manager_review` or later, it is a review-owned snapshot** — there is no "source" goal-library row to later rewrite it (goals were never templated to begin with; each review's goals are first-class, review-scoped rows from creation), so no additional historical-integrity mechanism is needed beyond what §9 already establishes for the rest of the review.
- Goals are not reusable across cycles as live objects — each cycle's reviews get their own rows (an org wanting a recurring goal simply re-enters it; no goal-templating engine in v1, per the draft's original non-goal).

Five measurement types remain unchanged from the draft (§3): `numeric`, `percentage`, `currency`, `boolean`, `rating`, `qualitative` — deliberately not more.

## 13. Competencies

Unchanged from the draft. Model: §8.4 (template-level definition) and §8.8 (review-level snapshot, now with `notApplicable`/`notApplicableReason`, §11.3). No dual-authorship/proposal concept for competencies — Owner Decision 4 named goals only; competencies remain purely template-snapshotted, with N/A as the only manager-side adjustment available in `manager_review`.

## 14. Self-Assessment — Corrected

Employee, via `performance.write.own`, while `status = 'self_assessment'`: view assigned review (goals + snapshotted competencies + rating scale), enter self-ratings/comments on competencies, enter comments on goals, **propose new goals** (§12), submit. Submission is the single atomic `self_assessment → manager_review` transition (§10.1 row 2) — routine autosave-as-you-go PATCH calls are permitted before submit, but the transition itself is what locks the stage.

**After submission:** every employee-writable field is locked — the manager-review route's write surface simply does not expose these fields to an employee caller, and the employee's own write route rejects any call once `status != 'self_assessment'`, regardless of which fields are sent (defense in depth, not solely a stage check).

**If HR reopens specifically to `self_assessment`** (§10.4): employee editing resumes on exactly the same field set as originally, pre-filled with the prior values (not blanked); the reopen's reason and actor are audited on `performance_review.reopened`, independently of anything the employee subsequently edits.

The employee **can** see the rating scale and their own prior entries at any time; they **cannot** see the manager's rating until the manager submits (server-enforced — the review-read DTO omits manager fields for a `self_assessment`-stage caller unless they hold `performance.manage`/`performance.finalize`).

## 15. Manager Review — Corrected (Explicit Stage)

Manager access is entirely server-derived from `reviewerEmployeeId` (snapshotted at review creation, §8.6/§9) — never a client-supplied relationship, never a live re-check of the *current* `reportingManagerId`. While `status = 'manager_review'`, the manager (reviewer of record):

- views the employee's submitted self-assessment (per §14's visibility rule, now unlocked since self-assessment is submitted)
- records `actualResult`/`computedScore`/`managerComment` per goal
- records `managerRatingValue`/`managerComment` per competency
- accepts, edits-then-accepts, or rejects each `proposed` (employee-authored) goal (§12)
- marks goals/competencies `notApplicable` with a required reason (§11.3)
- submits (§10.1 row 3), subject to the completeness prerequisites there

**After manager submission:** all manager-writable fields lock, identically to how self-assessment locks after employee submission (§10.2). Manager score becomes the primary official scoring input feeding HR review; employee self-rating never contributes mathematically (Owner Decision 1). Reopen back to the manager remains HR-only (§10.4) — a manager cannot unilaterally bounce a review back to the employee or reopen their own submission.

## 16. HR Review — Corrected (Explicit Stage)

While `status = 'hr_review'`, authorized HR (`performance.finalize` for the finalize action itself; `performance.manage` for cycle/template/config administration and reopen):

- reviews the completed manager assessment (all goal/competency scores, comments, N/A markings, resolved goal-acceptance decisions)
- validates completeness (the same prerequisite set from §10.1 row 3 is re-displayed, not re-enforced a second time — enforcement already happened at the manager-submit transition)
- optionally applies a score override: `hrOverrideScore` + **mandatory** `hrOverrideReason`. `computedOverallScore` (the formula's own output, computed at the `hr_review → finalized` transition) is **always preserved unedited** alongside the override — the override is a separate, additional column, never a destructive overwrite of what the manager/formula originally produced. Actor and timestamp are recorded via the existing `hrFinalizedAt` column plus the `performance_review.finalized`/`performance_review.score_overridden` audit events (actor via `actorMembershipId`).
- finalizes (§10.1 row 4)

`performance.manage` (cycles/templates/scales/assignment/reopen/org-wide read) and `performance.finalize` (finalize + override) remain two separate keys — configuration/administration is conceptually distinct from the finalize/override decision, mirroring Attendance's `attendance.manage`/`attendance.adjustment.approve` split, even though both default to the same roles today.

---

## 17. ESS (Planned Surfaces) — Corrected for Acknowledgement

A new "My Performance" tab on the existing `/self-service` page, gated exactly like "My Attendance"/"My Leave" via `isModuleAccessible(modules, 'performance')`. Contents: current-cycle review card (status badge, key dates, `revisionNumber` shown only if > 1), self-assessment form (goals + competencies + comments + goal-proposal action, submit action), review history (prior finalized/acknowledged reviews, read-only), and — **required, per Owner Decision 2** — an acknowledgement action on a `finalized` review: a single confirmation ("I have seen this review") that is explicitly labeled as **not** agreement, plus an optional final comment field (captured in `employeeFinalComment`, no score mutation, per §10.1 row 5). An employee's disagreement, expressed only through that comment, never blocks or reverses finalization — formal appeal is deferred (Owner Decision 3).

## 18. Manager (Planned Surfaces)

Unchanged from the draft. A dedicated route `/performance-team`, `ModuleGate`-wrapped, nav-entry-gated `isHrCapable`-only. Contents: reviews awaiting manager action — including, now explicitly, a distinct "Proposed goals awaiting your decision" list surfacing `proposed`-status goals across the manager's in-progress reviews — plus team progress list and completed reviews.

## 19. HR (Planned Surfaces)

Unchanged from the draft:

- `/performance` — Performance Dashboard
- `/performance-cycles` — cycle CRUD + "generate reviews" action
- `/performance-templates` — template + competency configuration
- `/performance-rating-scales` — rating scale + level configuration
- `/performance-reviews` — organization-wide review list/detail, **reopen action now requires a reason field in the UI** (§10.4), finalize/override actions
- `/performance-reports` — report catalog + CSV export

All `ModuleGate`-wrapped, nav-entry-gated `isHrCapable`. 6 pages, unchanged.

## 20. Dashboard (Planned Metrics)

Unchanged from the draft — plain tile breakdown, no invented rate/KPI: active cycle, employees assigned, self-assessments pending/submitted, manager reviews pending/submitted (now also surfacing "proposed goals awaiting manager decision" as its own count), finalized/acknowledged counts, rating distribution (score bands, no fabricated "average score" tile).

## 21. Reporting

Unchanged from the draft — dedicated route `routes/performanceReporting.ts`, same 4 report keys (`performance_review_status`, `performance_scores`, `performance_goal_results`, `performance_rating_distribution`), same CSV convention. `performance_goal_results` now additionally reports `originType`/`approvalStatus` per goal row, for HR visibility into how many goals were employee-proposed vs. manager-created and their acceptance outcome.

## 22. Audit — Corrected Event List

`performance_cycle.created` / `.opened` / `.closed` / `.archived`, `performance_review_template.created` / `.updated` / `.archived`, `performance_rating_scale.created` / `.archived`, `performance_review.assigned`, `.self_assessment_submitted`, `.manager_review_submitted`, `.reopened` (metadata: `{targetStage, reason}`), `.score_overridden`, `.finalized`, `.acknowledged`, and — **new** — `performance_review_goal.proposed` / `.accepted` / `.rejected`. Read-only surfaces (dashboard, reports, review detail GET) generate **zero** audit noise.

## 23. Notifications

Unchanged — confirmed no working notification-delivery infrastructure exists anywhere on this platform. Every state-transition function (including the newly-detailed reopen and goal-accept/reject actions) gets the same `// Notification extension point (Architecture Principle 8) — not implemented` comment. **Formally DEFERRED.**

## 24. Files / Evidence

Unchanged from the draft.

---

## 25. Tenant Isolation

Unchanged from the draft — every one of the 9 tables carries `organizationId` (→ `restrict`), queried exclusively through `requireMembership` → `requireModuleEnabled("performance")` → `requirePermission(...)`.

## 26. RLS / Security

Unchanged from the draft — all 9 tables RLS-enabled with zero policies in their own creation migration.

## 27. API Plan — Amended

All routes under `/organizations/:organizationId/performance/...`, tag `performance`. Additions since the draft are marked **new**:

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
| **new** `POST /performance/reviews/:id/goals` | employee proposes, or manager creates, a goal | `performance.write.own` (own, `self_assessment` only) or `performance.review.write` (reviewer of record, `draft`/`manager_review`) |
| **new** `PATCH /performance/reviews/:id/goals/:goalId` | edit a goal (employee: own `proposed` goal, pre-acceptance; manager: any goal, `manager_review` only) | `performance.write.own` or `performance.review.write` |
| **new** `POST /performance/reviews/:id/goals/:goalId/accept` | manager accepts a `proposed` goal | `performance.review.write` (reviewer of record) |
| **new** `POST /performance/reviews/:id/goals/:goalId/reject` | manager rejects a `proposed` goal (comment required) | `performance.review.write` (reviewer of record) |
| `POST /performance/reviews/:id/manager-review` | submit manager review | `performance.review.write` |
| `POST /performance/reviews/:id/finalize` | finalize (+ optional override) | `performance.finalize` |
| `POST /performance/reviews/:id/acknowledge` | employee acknowledgement | `performance.write.own` |
| **amended** `POST /performance/reviews/:id/reopen` | HR reopen — body requires `{ targetStage, reason }`; `targetStage` validated against §10.4's explicit allow-list | `performance.manage` |
| `GET /performance/my-reviews` | ESS: caller's own reviews | `performance.read.own` |
| `GET /performance/team-reviews` | manager: reviews where caller is `reviewerEmployeeId` | `performance.review.write` |
| `GET /performance/dashboard` | tile metrics | `performance.reports.read` |
| `GET /performance/reports/:reportKey` | dedicated reporting route (§21) | `performance.reports.read` |

Still no unnecessary CRUD — no `DELETE` on any instance-level record.

## 28. Frontend Plan

Unchanged in shape from the draft; forms for self-assessment/manager-review now include the goal-proposal/accept/reject and not-applicable controls described above, and the HR reopen action's dialog requires a reason field.

## 29. Integration Matrix

Unchanged from the draft.

## 30. Security Threat Review — Amended

All rows from the draft remain valid, plus:

| Threat | Control |
|---|---|
| Employee's proposed goal silently becomes official/scored without manager action | `approvalStatus` defaults to `proposed` and is structurally excluded from weighting/scoring (§11.2) until a manager explicitly transitions it to `accepted`; enforced in the scoring function itself, not merely by UI convention |
| Manager silently reopens their own submission to change a score after the fact | Reopen is exclusively `performance.manage` (HR/org_admin only) — no route grants a manager (via `performance.review.write` alone) any reopen capability |
| HR reopen used to arbitrarily jump stages or erase history | `targetStage` validated server-side against the explicit `{self_assessment, manager_review, hr_review}` allow-list (§10.4); prior submitted values are never blanked, and the full pre-reopen state is preserved in `audit_events` regardless of what happens next |
| N/A marking used to strip weight from an inconvenient goal without accountability | `notApplicableReason` is a required, non-empty field whenever `notApplicable = true`, captured in the manager-review submission's own audited `beforeState`/`afterState` |

## 31. Performance / Scalability

Unchanged from the draft.

## 32. Backup / Restore / Portability

Unchanged from the draft.

## 33. Test Strategy (Future) — Amended

All items from the draft, plus: goal-authorship-and-acceptance state transitions (`proposed`→`accepted`/`rejected`, each direction's permission check, a `proposed` goal correctly excluded from a submitted manager-review's score, submission blocked while any `proposed` goal remains unresolved); not-applicable redistribution math (single N/A item, all-N/A-in-a-section, both-sections-empty rejection at submit time); reopen behavior (each of the three valid target stages, an invalid target stage rejected, prior values preserved not blanked, `revisionNumber` increments, `audit_events` captures reason/actor/timestamp); `status`-is-authoritative regression (a test asserting no route/service function branches on a nullable timestamp instead of `status`); settings-snapshot regression (changing the `performance` namespace's `scoringPrecision`/`acknowledgementRequired` after a review is created does not alter that review's stored/displayed values).

## 34. Live QA Strategy (Future)

Unchanged from the draft.

---

## 35. Workstream Breakdown — Reconciled

Continuing from W72 (last complete workstream) — **next workstream is W73**. Continuing from migration `0037` — **next migration is `0038`**. Titles/IDs unchanged from the draft; scope lines enriched to reflect this reconciliation. No workstream was split or merged — the corrected lifecycle/scoring/goal-authorship model fits entirely within the original 12-workstream sequence's existing boundaries.

| ID | Title | Scope | Schema/API/Frontend impact | Migration | Stop boundary |
|---|---|---|---|---|---|
| **W73** | Performance Foundation & Module Activation | All 9 tables incl. the amended columns in §8.6–§8.8 (`revisionNumber`, `scoringPrecisionSnapshot`, `acknowledgementRequiredSnapshot`, `originType`/`approvalStatus`, `notApplicable`/`notApplicableReason`); RLS enabled inline; 6 permissions seeded (§7, unchanged count); module `performance` flipped `hidden`→`active` (available, not enabled for any org); `lib/performanceAuthorization.ts`; `performance` `organization_settings` namespace registered | Schema + auth primitives only. **No routes, no frontend.** | `0038` | DoD (§36) + explicit go-ahead before W74 |
| **W74** | Rating Scales & Review Templates (HR Configuration) | CRUD API + `/performance-rating-scales` and `/performance-templates` pages; scale-immutability-once-used enforcement; weight-sum validation | Routes + lib + frontend, no schema change | none | before W75 |
| **W75** | Performance Cycles & Review Assignment | Cycle CRUD API + `/performance-cycles` page; "generate reviews" bulk-assignment action (creates `draft` reviews with manager-authored goals (`accepted` immediately) + competency snapshot per applicability) | Routes + lib + frontend, no schema change | none | before W76 |
| **W76** | Goals/Objectives Management | Goal CRUD within a review: manager-created (`accepted` immediately) and employee-proposed (`proposed`) authorship paths, accept/edit/reject actions, five measurement types, weight validation, `notApplicable` marking wiring | Routes + lib + frontend, no schema change | none | before W77 |
| **W77** | Self-Assessment (ESS) | `self_assessment → manager_review` transition (§10.1 row 2); ESS "My Performance" tab (self-assessment form, goal-proposal UI, review history) | Routes + lib + frontend, no schema change | none | before W78 |
| **W78** | Manager Review | `manager_review → hr_review` transition (§10.1 row 3), including the "resolve every proposed goal" prerequisite; `/performance-team` manager page with a proposed-goals decision queue | Routes + lib + frontend, no schema change | none | before W79 |
| **W79** | HR Review, Finalization, Override & Reopen | `hr_review → finalized → acknowledged` transitions; score override with mandatory reason (original score preserved); **the full controlled reopen rule (§10.4)** — target-stage allow-list, mandatory reason, `revisionNumber` increment, audit | Routes + lib + frontend, no schema change | none | before W80 |
| **W80** | Internal HR/Manager Review List | `/performance-reviews` org-wide list/detail page, reopen-with-reason dialog | Frontend + minor route additions, no schema change | none | before W81 |
| **W81** | Performance Dashboard & Reporting | `/performance/dashboard`, dedicated `routes/performanceReporting.ts`, 4 report keys registered + `/performance-reports` page | Routes + lib + frontend, no schema change | none | before W82 |
| **W82** | Evidence/Attachments | `performance_review_evidence` wiring, `performance_evidence` Master Data code, UI attach/view on review & goal detail | Routes + lib + frontend, no schema change | none | before W83 |
| **W83** | Phase 3C Verification | Full repo-wide verification pass against this frozen plan (mirrors W71): regression suite, migration drift check, RLS/advisor re-check, live cross-tenant QA, explicit checks that `status` is never inferred from a timestamp anywhere in the shipped code | Verification only, zero source changes expected | none | before W84 |
| **W84** | Phase 3C Completion Report | Formal closing record (mirrors W72) | Documentation only | none | Phase 3C closed |

## 36. Definitions of Done

Unchanged generic DoD from the draft (per-workstream: own scope fully built, full test suites pass, typecheck clean, OpenAPI/codegen byte-identical, zero unexpected migration drift, all builds succeed, live QA with settings state restored, audit events verified, production untouched), **plus, platform-wide for every workstream from W76 onward:** a direct code-inspection check (not just a passing test) confirming no route/service function branches on a nullable timestamp column instead of `status` — the specific discipline called out in §10's opening paragraph. W73's own DoD additionally requires `organization_modules` confirmed to have zero rows for `performance` after the workstream, mirroring W64.

## 37. Owner Decisions — Record

All six decisions that were open in the draft are now resolved and recorded in §0; this section is retained only as a pointer for anyone reading top-to-bottom expecting the original "Open Decisions" position. No decision remains open. Any future genuinely new business-policy question (e.g. whether to build formal appeals in a later phase) would be logged the same way, in a future document, not by reopening this one.

## 38. Production Rollout Boundary

**Nothing in this plan authorizes touching production.** Every workstream (W73–W84) targets the development Supabase project (`vkvirwdxoiwsiftaarox`) only. Production rollout is a separate, later, explicitly-approved action requiring its own migration-verification, environment-validation, and rollback-strategy review per CLAUDE.md's Deployment section — not addressed by this document and not implied by its freeze.
