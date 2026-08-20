# Phase 3D — Learning & Development: Draft Implementation Plan

Status: **DRAFT — NOT FROZEN.** No workstream may begin execution until this document is reviewed, its Owner Decisions answered, and it is explicitly frozen — exactly the same discipline `PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md` and `PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md` went through before their own W64/W73 began.

This document was produced by inspecting the current repository directly — no migration, no route, no frontend page, no permission seed, no module activation, and no production access were performed while writing it. Every claim about existing code is based on direct file inspection (paths cited); every new-design element is explicitly labeled **[PROPOSED DESIGN DECISION]**, and every genuine business-policy call this document cannot safely default on its own is labeled **[OWNER DECISION — NEEDS APPROVAL]**.

---

## 0. Owner Decisions — Needs Approval

The following are genuine business-policy calls, not implementation details. Each carries a recommended default; none are approved yet.

| # | Decision | Recommended default |
|---|---|---|
| 1 | Who approves an employee-requested enrollment when the course requires approval — the employee's own manager, or HR/L&D? | **The employee's own manager** (mirrors Performance's goal-proposal approval pattern, §12 of the frozen Performance plan) — resolved server-side via `reportingManagerId`, never a client-supplied relationship. HR/L&D (`learning.manage`) always retains override/org-wide decision authority regardless. |
| 2 | Is "mandatory" a course-level-only flag, or can an individual assignment override the course's own default? | **Course-level default + per-assignment override.** A course carries a `mandatoryDefault` flag; the assigner (HR/L&D or manager) may mark any individual assignment mandatory or optional regardless of that default, snapshotted onto the enrollment at creation. |
| 3 | Do Learning-issued certificates write into the existing `employee_certifications` table (Phase 2A, W24), or stay in a separate Learning-owned table? | **Stay separate — no automatic cross-write.** `employee_certifications` is a free-text, manually-maintained record of externally-earned credentials (issuing organization, credential ID); a Learning-issued certificate is a structured, course-linked, system-generated artifact. Overloading the existing table with Learning provenance risks confusing "who entered this" (employee/HR vs. the system) and complicates that table's existing simple shape. A future, explicitly-scoped "add to my certifications" bridging action could link them later if wanted — not built here. |
| 4 | Does completing a Learning course automatically create or update an `employee_skills` row (a "skill grant")? | **No, not in V1.** Skills remain the existing, separate, manually-maintained Phase 2A record. Coupling Learning completions to skill grants is a genuine future enhancement, not required for a useful V1, and would coupling Learning to a concept (skill proficiency inference) this plan has no frozen definition for. |
| 5 | Should V1 include any automatic recurring-assignment/renewal scheduler (e.g., an annual mandatory course auto-reassigns itself as a certificate nears expiry)? | **No.** No background-job/cron infrastructure is assumed available on this platform (the same boundary already documented in `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`'s own "no in-app job queue" exclusion, and Attendance's own cycle model, which is HR-manually-opened, never auto-opened). Renewal is HR-manually-triggered by re-running the bulk-assign action; a dashboard/report tile surfaces certificates expiring soon so this stays actionable without automation. |
| 6 | When an instructor-led session's `capacity` is reached, is a new enrollment hard-blocked, or does a waitlist exist? | **Hard-blocked (`409`), no waitlist.** A waitlist queue is an added-complexity LMS feature not clearly justified by anything in the roadmap; HR can always raise capacity or schedule another session. |
| 7 | Should course categories be a new Master Data domain (organization-defined, like `document_category`), or a dedicated owned entity (like Performance's rating scales)? | **A new Master Data domain, `training_category`.** Course categories are simple, flat, organization-customizable labels with no internal structure (no levels, no weights) — unlike rating scales/templates, which genuinely needed dedicated tables because they carry structured configuration. Reusing Master Data avoids a redundant categorization mechanism. |
| 8 | Should a completed-but-incorrectly-marked enrollment be correctable via a formal "reopen" state machine (mirroring Performance's W79 reopen), or should HR simply edit/cancel-and-reassign? | **No formal reopen in V1.** HR (`learning.manage`) may directly edit a mutable field or cancel and create a fresh enrollment; every such action is fully audited. A dedicated reopen state machine is more machinery than a training-record correction has so far demonstrated it needs; Performance's reopen exists because HR override/reason/revision tracking was frozen requirements there — nothing in Learning's own roadmap line demands the same. |

---

## 1. Purpose

Deliver a V1 Learning & Development module: an organization-owned course catalog, instructor-led and self-paced training delivery, employee/manager/HR-initiated enrollment with approval where required, completion and (optional) assessment tracking, system-issued certificates with expiry awareness, and reporting — reusing every existing platform primitive (module registry, permissions, Master Data, employee documents/file storage, audit log, Reporting Foundation, tenant isolation) rather than duplicating any of them, exactly per `CLAUDE.md`'s "Configuration Before Custom Code" and "Modular Architecture" principles.

---

## 2. Existing Architecture Reused

Verified by direct inspection before any design decision below was made:

| Concern | Existing mechanism | Verified at |
|---|---|---|
| Module registry | `learning` module key **already seeded** in `MODULE_DEFINITIONS` (`status: "hidden"`, category `hr-operations`, no dependencies) — no new module-registry row needed, only a status flip once shipped, exactly like `recruitment`/`attendance`/`performance` before it. | `lib/db/src/seed/module-definitions.ts` |
| Permissions | Standard `hasPermission`/`requirePermission` middleware chain; role-seeded matrix pattern (`employee`/`hr_manager`/`org_admin`/`super_admin`). | `artifacts/api-server/src/middlewares/requirePermission.ts`, Performance's own §7 |
| "Which employee is me" | `resolveOwnEmployeeId` (`employee_user_links`, W14/W33) — the platform's single identity-resolution mechanism, reused unchanged by every module since Attendance. | `artifacts/api-server/src/lib/leaveRequests.ts` |
| "Team" scope | `employees.reportingManagerId` — server-derived manager relationship, never a permission tier of its own (`attendance.read.team` and `performance.read.team` deliberately do not exist; Learning follows the identical discipline). | `lib/attendanceAuthorization.ts`, `lib/performanceAuthorization.ts` |
| External credential tracking | `employee_certifications` (Phase 2A, W24) — free-text `certificationTypeCode` (from Master Data), issuing organization, issue/expiry date, credential ID. Already exists; Learning does not duplicate it (Owner Decision 3). | `lib/db/src/schema/employee-certifications.ts` |
| Manually-tracked skills | `employee_skills` (Phase 2A, W24) — free-text `skillCode` (Master Data), proficiency level. Already exists; Learning does not touch it (Owner Decision 4). | `lib/db/src/schema/employee-skills.ts` |
| Master Data | Fixed, code-owned domain registry (`MASTER_DATA_DOMAINS`); organizations may add rows within an `organization-defined`/`organization-overridable` domain. `skill`, `qualification_type`, `certification_type`, `document_category` already exist as precedent for exactly this shape. | `lib/db/src/seed/master-data-definitions.ts` |
| File storage | `employee_documents` + `fileStorage.ts` + `documentValidation.ts` (extension/MIME/file-signature validation, 10MB cap, PDF/JPEG/PNG/DOCX/XLSX) — the same storage layer Performance's own evidence (W82) reused verbatim rather than building a second one. | `lib/db/src/schema/employee-documents.ts`, `artifacts/api-server/src/lib/fileStorage.ts` |
| Evidence join-table pattern | `performance_review_evidence` — a lightweight join table pointing into `employee_documents`, not a duplicate storage layer. Learning's own enrollment evidence follows the identical shape. | `lib/db/src/schema/performance-review-evidence.ts` |
| Scheduled-event shape | `interviews` (Phase 3A, W54) — `scheduledAt` (`timestamptz`, inherently timezone-aware), `durationMinutes`, `location`, `meetingLink`, a small closed status enum (`scheduled/completed/cancelled` + a per-participant outcome). Training sessions reuse this exact shape rather than inventing a new scheduling primitive. | `lib/db/src/schema/interviews.ts` |
| Bulk eligibility resolution | `resolveEligibleEmployees` (`all_active`/`department`/`position`/`manual`) and the atomic bulk-insert transaction pattern from `generateReviews` — reused for Learning's own bulk-assign action, without needing a persistent "cycle" table (see §3/§8). | `artifacts/api-server/src/lib/performanceCycles.ts` |
| Audit | `recordAuditEvent` — free-text `eventType`, `targetType`/`targetId`, `actorMembershipId`, optional `metadata`/`beforeState`/`afterState`. No new audit mechanism. | `artifacts/api-server/src/lib/auditLog.ts` |
| Reporting | The shared Reporting Foundation registry (W17/ADR-016) for catalog discoverability, executed through a dedicated, visibility-scoped route — the same pattern Attendance's and Performance's own reports use, never the generic runner. | `artifacts/api-server/src/lib/reporting.ts` |
| Organization settings | `getNamespaceConfig`/`organization_settings` — reused only if a genuine configuration need justifies a `learning` namespace (see §7's own note; none is proposed here beyond what's already snapshotted per-course). | `artifacts/api-server/src/lib/organizationSettings.ts` (namespace pattern, per Performance's `performance`/Attendance's `attendance` namespaces) |
| RLS / tenant isolation | Deny-by-default RLS on every `public` table (currently 79/79 enabled, 0 disabled, 0 policies) — every new Learning table follows the identical migration-time enablement, no policies, `BYPASSRLS` server role. | `docs/SUPABASE_SECURITY_REMEDIATION.md`, W83/W84 re-confirmation |

**No existing Learning/training/course/certification-delivery code exists anywhere in the repository** — confirmed by a repo-wide search; the only related prior art is the Phase 2A employee-record primitives listed above (certifications, skills), which this plan reuses rather than duplicates.

---

## 3. Scope (Proposed V1)

- Organization-owned course catalog, with categories from a new Master Data domain.
- Two delivery modes: self-paced (no scheduled session) and instructor-led (one or more scheduled sessions per course).
- Employee, manager, and HR/L&D-initiated enrollment, with approval where the course requires it.
- Audience targeting for bulk assignment (`all_active`/`department`/`position`/`manual`), reusing Performance's own eligibility-resolution logic — without a persistent "cycle" entity, since training assignment is not calendar-cyclical the way a review period is.
- Session attendance marking (session-scoped, binary, instructor/HR-marked) — deliberately not built on the Attendance module's daily-summary machinery (see §9).
- Completion tracking with an authoritative status field; optional, minimal pass/fail + numeric score for courses configured to require an assessment (no question bank/quiz engine).
- System-issued certificates on qualifying completion, with expiry awareness (computed, never a background job) and revocation.
- Training evidence attachments (enrollment-scoped) and a certificate file, both reusing `employee_documents`/`fileStorage`.
- ESS "My Learning" surface; a manager "My Team Training" surface; an internal HR/L&D administration workspace; a dashboard; 3 CSV-exportable reports.
- Full audit coverage, tenant isolation, RLS deny-by-default.

---

## 4. Non-Goals (Deferred)

Explicitly out of V1 scope — per this document's own instruction not to assume common LMS features belong here unless justified by the existing roadmap/repository:

- **Quizzes / question banks / SCORM / xAPI** — no content-delivery or interoperability standard exists on this platform; nothing in the roadmap requires it.
- **Video hosting or content authoring** — no media pipeline exists; courses are catalog/administrative records, not a content player.
- **Course marketplace or external content import.**
- **Learning recommendations / AI-driven suggestions.**
- **Gamification, badges, leaderboards, CPD-point systems.**
- **Automatic recurring-assignment/renewal scheduling** (Owner Decision 5) — no background-job infrastructure exists; renewal is HR-manually-triggered.
- **Session waitlists** (Owner Decision 6).
- **Formal enrollment "reopen" state machine** (Owner Decision 8) — correction is a direct HR edit or cancel-and-reassign, fully audited.
- **Skill-grant / competency integration with Performance** (Owner Decisions 3, 4) — Learning is fully usable with the `performance` module disabled or absent; no FK or write path from any `learning_*` table into `performance_*` or `employee_skills`/`employee_certifications` exists in V1. The only future integration point is read-only cross-reporting, not built here.
- **Cost/budget tracking, vendor management, or e-commerce (paid courses).**
- **Mobile app, offline access.**
- **Certificate PDF generation** — a certificate row may optionally carry an uploaded file (e.g., HR uploads a scanned/exported certificate), but V1 does not generate one.
- **Malware scanning on uploaded evidence/certificate files** — carried forward as a known, pre-existing platform gap (see §26), not addressed here.
- **CSV formula-injection escaping** — carried forward as a known, pre-existing, platform-wide gap (see §26), not addressed here.

---

## 5. Terminology

- **Course** — a catalog entry: what is being taught, how it's delivered, whether it's mandatory by default, whether completion requires an assessment, whether it issues a certificate.
- **Session** — a scheduled instance of an instructor-led course (date/time, duration, location or meeting link, optional capacity, optional instructor).
- **Enrollment** — one employee's assignment to (or self-requested registration in) a course, optionally bound to a specific session.
- **Completion** — the enrollment reaching a terminal `completed` (or `failed`, if assessed) status.
- **Certificate** — a system-issued credential artifact produced when a qualifying enrollment completes on a course configured to issue one.
- **Instructor of record** — the employee named on a session's own `instructorEmployeeId` — a per-session relationship, distinct from "manager."
- **Manager of record** — the enrolled employee's own `reportingManagerId` at enrollment time — mirrors Performance's own "reviewer of record" concept exactly, including the same snapshot-vs-live distinction (see §9).

---

## 6. Roles / Personas

- **Employee** — browses the active catalog, self-enrolls/requests enrollment, tracks own progress on self-paced courses, views own enrollment history and certificates.
- **Manager** (a plain `employee`-role holder who is someone's `reportingManagerId`) — assigns training to direct reports, decides pending employee-requested enrollments for direct reports, views "My Team Training."
- **Instructor of record** — the employee named on a session; marks attendance and completion/assessment results for that session's own enrollments, regardless of whether they are anyone's manager.
- **HR / L&D (`learning.manage`)** — full course/session administration, org-wide bulk assignment, org-wide approval/decision authority, administrative completion correction, certificate revocation, org-wide reporting.
- **Org Admin / Super Admin** — inherit the full HR/L&D-equivalent reach via the seeded role matrix, exactly like every other module.

---

## 7. Permissions

**5 proposed keys — deliberately no `.read.team` and no acknowledgement-shaped separate key**, following the platform's own established discipline that "team"/relationship-scoped visibility is resolved server-side, never granted as its own permission:

| Key | Grants |
|---|---|
| `learning.read.own` | Own enrollments, own certificates, own training history; the coarse gate for `my-enrollments`/`my-certificates`/enrollment-detail read. |
| `learning.write.own` | Self-enroll/request, mark own self-paced progress/completion, cancel own not-yet-started request, upload own enrollment evidence. |
| `learning.review.write` | Relationship-scoped: **manager of record** (assign to own reports, decide own reports' pending requests) *or* **instructor of record** (mark attendance/completion for their own session's enrollments) — dispatched server-side by comparing the caller's own employee identity against the enrollment's `managerEmployeeIdSnapshot` or the session's `instructorEmployeeId`, exactly mirroring Performance's `resolveReviewRelationship`/dual-tier dispatch (W78). No separate "instructor" permission key. |
| `learning.manage` | Course/session CRUD, bulk-assign, org-wide approval/decision authority, administrative completion/attendance correction, certificate revocation, org-wide enrollment list. |
| `learning.reports.read` | Dashboard + reports. |

**Proposed role mapping** (mirrors Performance's own §7 exactly): `employee` holds `read.own`/`write.own`/`review.write`/`reports.read` (every employee can potentially be a manager or instructor); `hr_manager`/`org_admin`/`super_admin` hold all 5.

**No organization-settings namespace is proposed for V1** — every course-level configuration (assessment requirement, certificate validity period, mandatory default, approval requirement) lives on the course row itself, snapshotted onto each enrollment at assignment time (§9), matching Performance's own `scoringPrecisionSnapshot`/`acknowledgementRequiredSnapshot` precedent rather than inventing an organization-wide default that would need its own snapshot discipline.

---

## 8. Data Model (Proposed)

All tables: `organizationId` (restrict, never cascade — matches every other business table on this platform), RLS enabled at migration time with zero policies (deny-by-default), standard `createdAt`/`updatedAt`.

### 8.1 `learning_courses`

Organization-owned catalog entry.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | FK → organizations, restrict | |
| `categoryCode` | text, not null | Free-text code from the new `training_category` Master Data domain (Owner Decision 7) — not validated against the domain's item list, same precedent as `employeeDocuments.categoryCode`. |
| `title` | text, not null | |
| `description` | text, nullable | |
| `deliveryMode` | enum: `self_paced`, `instructor_led` | Determines whether sessions are relevant to this course at all. |
| `mandatoryDefault` | boolean, not null, default false | Informational default only — snapshotted onto each enrollment, overridable per-assignment (Owner Decision 2). |
| `requiresApproval` | boolean, not null, default false | Gates whether an `employee_requested` enrollment starts `pending` or `auto_approved`. |
| `hasAssessment` | boolean, not null, default false | Whether completion requires an explicit `passed`/`score` result. |
| `issuesCertificate` | boolean, not null, default false | Whether a qualifying completion issues a `learning_certificates` row. |
| `certificateValidityMonths` | integer, nullable | Null = certificate never expires. Only meaningful when `issuesCertificate = true`. |
| `status` | enum: `draft`, `active`, `archived` | Draft = not yet assignable/enrollable; active = assignable; archived = no new enrollments, existing history untouched (§10.1). |
| `createdBy` | FK → users, set null | |

Unique: none beyond `id` (multiple courses may share a title). Index: `(organizationId, status)`.

### 8.2 `learning_course_sessions`

One scheduled instance of an instructor-led course. Mirrors `interviews` almost exactly.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | FK → organizations, restrict | |
| `courseId` | FK → learning_courses, restrict | Restrict, not cascade — a session must remain referenceable by historical enrollments even if the course is later archived. |
| `scheduledAt` | timestamptz, not null | Inherently timezone-aware, mirrors `interviews.scheduledAt`. |
| `durationMinutes` | integer, not null | |
| `location` | text, nullable | |
| `meetingLink` | text, nullable | |
| `instructorEmployeeId` | FK → employees, restrict, nullable | The "instructor of record" for `learning.review.write`'s relationship dispatch. |
| `capacity` | integer, nullable | Null = uncapped. Enforced atomically at enrollment time (§10.2), `409` when reached (Owner Decision 6). |
| `status` | enum: `scheduled`, `completed`, `cancelled` | Mirrors `interviews.status` minus `no_show` (per-enrollee attendance is tracked on the enrollment, §8.3, not the session). |

Index: `(organizationId, courseId)`, `(organizationId, instructorEmployeeId)`.

### 8.3 `learning_enrollments`

The core record — one employee's assignment to a course (optionally a specific session).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | FK → organizations, restrict | |
| `courseId` | FK → learning_courses, restrict | |
| `sessionId` | FK → learning_course_sessions, restrict, nullable | Null for self-paced; required for instructor-led (validated at creation). |
| `employeeId` | FK → employees, restrict | Historical business record — restrict, never cascade, matching `performance_reviews.employeeId` exactly. |
| `courseTitleSnapshot`, `categorySnapshot` | text, not null | Snapshotted at creation (§9). |
| `departmentIdSnapshot`, `positionIdSnapshot` | FK → departments/positions, restrict, nullable | Snapshotted at creation, matching `performance_reviews`. |
| `managerEmployeeIdSnapshot` | FK → employees, restrict, nullable | Snapshot of `employees.reportingManagerId` at creation — the "manager of record" for `learning.review.write` dispatch and approval authority; a later manager change never reassigns an in-flight or historical enrollment (identical rationale to Performance's `reviewerEmployeeId`). |
| `originType` | enum: `hr_assigned`, `manager_assigned`, `employee_requested` | |
| `assignedByMembershipId` | FK → organization_memberships, set null, nullable | Null for `employee_requested`. |
| `isMandatory` | boolean, not null | Snapshotted from `course.mandatoryDefault`, overridable by the assigner at creation (Owner Decision 2). |
| `dueDate` | timestamptz, nullable | Optional compliance deadline; informational, drives an "overdue" dashboard/report signal only — never a lifecycle gate. |
| `approvalStatus` | enum: `auto_approved`, `pending`, `approved`, `rejected` | `hr_assigned`/`manager_assigned` are always `auto_approved` at creation (the assigner already held the authority). `employee_requested` starts `pending` if `course.requiresApproval`, else `auto_approved`. |
| `approvalDecidedByMembershipId`, `approvalDecidedAt` | nullable | Informational only — never read to infer lifecycle stage instead of `approvalStatus`/`status` (§10.4). |
| `status` | enum: `assigned`, `in_progress`, `completed`, `failed`, `cancelled` | **The sole authoritative field for training progress** (§10.2). A `rejected` `approvalStatus` enrollment is terminal regardless of `status` — enforced in the service layer, never physically deleted (audit-trail integrity). |
| `attended` | boolean, nullable | Instructor-led only; set by the instructor of record or HR after the session occurs. |
| `attendanceMarkedByMembershipId`, `attendanceMarkedAt` | nullable | Informational. |
| `passed` | boolean, nullable | Only meaningful when `course.hasAssessment`. |
| `score` | numeric, nullable | Free-form, instructor/HR-entered — no question-bank scoring exists. |
| `completedAt` | timestamptz, nullable | Informational only (§10.4). |
| `cancelReason` | text, nullable | Required when `status` is set to `cancelled` by anyone other than the enrolled employee themself. |

Uniqueness (partial, application/DB-enforced): at most one **non-terminal** (`assigned`/`in_progress`) enrollment per `(employeeId, courseId)` for self-paced courses, and per `(employeeId, sessionId)` for instructor-led — allowing legitimate re-enrollment (e.g., annual mandatory retraining) once a prior enrollment reaches a terminal state (`completed`/`failed`/`cancelled`). Exact constraint shape (partial unique index vs. service-layer check) is an implementation detail for the owning workstream, not fixed here.

Indexes: `(organizationId, employeeId)`, `(organizationId, managerEmployeeIdSnapshot)`, `(organizationId, courseId, status)`, `(organizationId, sessionId)`.

### 8.4 `learning_enrollment_evidence`

Supporting documentation attached to an enrollment (e.g., a completion confirmation, an external receipt) — **not** the certificate itself (§8.5). Mirrors `performance_review_evidence` exactly, since cardinality here is genuinely many-per-enrollment.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | FK → organizations, restrict | |
| `enrollmentId` | FK → learning_enrollments, cascade | Evidence has no independent existence once its enrollment is gone — but enrollments themselves are never deleted in practice (restrict on `employeeId` above prevents the underlying employee from disappearing silently), so this is a defensive-only cascade, matching `performance_review_evidence.reviewId`'s own cascade precedent. |
| `employeeDocumentId` | FK → employee_documents, restrict | Points into the existing storage layer — no new file infrastructure. |
| `addedByMembershipId` | FK → organization_memberships, set null, nullable | |
| `addedAt` | timestamptz, not null | |

### 8.5 `learning_certificates`

One row per issued certificate. A **column**, not a join table, is used for the optional file reference here — unlike `performance_review_evidence`, cardinality is 1-certificate-to-0-or-1-file, not many-to-many.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | FK → organizations, restrict | |
| `enrollmentId` | FK → learning_enrollments, restrict | Provenance — which completion produced this certificate. |
| `employeeId` | FK → employees, restrict | Live reference for query convenience (matches `performance_reviews.employeeId`'s own "live reference, permanent identity" precedent) — the authoritative "what/when" always traces through `enrollmentId`. |
| `courseTitleSnapshot` | text, not null | Snapshotted at issuance — a later course rename never rewrites an already-issued certificate's own display text. |
| `certificateNumber` | text, nullable | Optional org-assigned identifier; no enforced global sequence in V1. |
| `issuedAt` | timestamptz, not null | |
| `expiresAt` | timestamptz, nullable | Computed once at issuance from `course.certificateValidityMonths`; null = never expires. |
| `status` | enum: `active`, `revoked` | **`expired` is never a stored value** — it is a live-computed display qualifier (`expiresAt < now()`), avoiding any background job, exactly matching Attendance's/Performance's own "computed, never persisted" discipline for derived state. |
| `revokedByMembershipId`, `revokedAt`, `revokeReason` | nullable | Required together when `status` is set to `revoked`. |
| `employeeDocumentId` | FK → employee_documents, restrict, nullable | Optional uploaded certificate file (V1 does not generate one — §4). |

Index: `(organizationId, employeeId)`, `(organizationId, expiresAt)` (for the expiring-soon report).

### 8.6 Master Data addition

New domain in `MASTER_DATA_DOMAINS`: `{ key: "training_category", label: "Training Category", classification: "organization-defined" }` — additive, code-only change to the fixed registry (Owner Decision 7), no migration by itself (Master Data domains are code-owned, not a table per domain).

### 8.7 Migration & RLS impact (proposed, not created)

**5 new tables** (`learning_courses`, `learning_course_sessions`, `learning_enrollments`, `learning_enrollment_evidence`, `learning_certificates`), each RLS-enabled inline with zero policies at creation, each with a hand-authored `.down.sql`, following every prior migration's own convention. **Expected next migration: `0039`** — not created in this planning session. Public table count would move from the current 79 to **84** (79 + 5), all RLS-enabled, 0 disabled, 0 policies, preserving the deny-by-default baseline with no exceptions.

---

## 9. Historical Integrity

Every enrollment permanently snapshots, at creation: `courseTitleSnapshot`/`categorySnapshot` (a later course rename/recategorization never rewrites what the employee was actually assigned), `departmentIdSnapshot`/`positionIdSnapshot`/`managerEmployeeIdSnapshot` (a later employee move/manager change never reassigns an in-flight or historical enrollment), and `isMandatory` (a later change to the course's own `mandatoryDefault` never retroactively alters an already-created enrollment). Every certificate permanently snapshots `courseTitleSnapshot` at issuance. `courseId`/`sessionId` are retained as live references for traceability only, never re-read for display content after creation — the same "live reference, protected by the fact history is snapshotted elsewhere" pattern Performance uses for `templateId`/`ratingScaleId`.

**Change-table (mirrors Performance's own §9 table):**

| Changes later... | Effect on existing enrollments/certificates |
|---|---|
| Employee's department/position/manager changes | No effect — all three are snapshotted |
| Course is edited or archived | No effect — title/category were copied at enrollment creation |
| Course category renamed | No effect |
| Course's `mandatoryDefault`/`requiresApproval`/`hasAssessment`/`issuesCertificate`/`certificateValidityMonths` changes | No effect on already-created enrollments/already-issued certificates — all relevant values are snapshotted or computed once at their own creation/issuance time |
| Session is edited or cancelled | Enrollment's own snapshot fields are unaffected; only the session's own `status` changes |

---

## 10. Lifecycle (State Machines)

**`status` (course/session/enrollment/certificate) is the sole authoritative field for its own workflow stage** — no route or service function may infer stage from a nullable timestamp instead, enforced at the function-signature level from the first Learning workstream onward, exactly matching Performance's own §10 discipline (and re-verified as a Definition-of-Done item there).

### 10.1 Course lifecycle

```
draft → active → archived
```

`draft`: being configured, not assignable. `active`: assignable/enrollable. `archived`: no new enrollments accepted; existing enrollments, sessions, and certificates remain valid, unaffected historical records.

### 10.2 Session lifecycle

```
scheduled → completed | cancelled
```

Mirrors `interviews.status` exactly. Enrollment against a session is only permitted while the session is `scheduled` and (if `capacity` is set) the count of non-`cancelled` enrollments against it is below capacity — checked atomically at enrollment-creation time, `409` on a concurrent capacity race.

### 10.3 Enrollment lifecycle — two independent axes

**`approvalStatus`** (only meaningful for `employee_requested` originType):

```
pending → approved | rejected
```

`hr_assigned`/`manager_assigned` enrollments are created directly at `auto_approved` — the assigner already held the authority to assign. A `rejected` enrollment is terminal; its own `status` never advances further (enforced in the service layer).

**`status`** (the authoritative progress field, gated by `approvalStatus` being `auto_approved`/`approved`):

```
assigned → in_progress → completed
                       ↘ failed   (only when course.hasAssessment and passed = false)
assigned/in_progress → cancelled (employee's own not-yet-started request, or HR/manager override with a reason)
```

Attendance (`attended`) is recorded as a separate fact by the instructor of record or HR once a session occurs — it does not by itself transition `status`; a completion action (§10.3.1) is always an explicit, separate step, consistent with the "no timestamp/flag substituting for an authoritative status transition" rule applied to every boolean fact here, not just timestamps.

**10.3.1 Completion action:** for self-paced courses, the employee (`learning.write.own`) marks their own `in_progress`/`completed`; for instructor-led courses, the instructor of record or HR (`learning.review.write`/`learning.manage`) marks completion after the session, supplying `passed`/`score` when `course.hasAssessment`. Every transition is an atomic conditional update (`WHERE status = '<expected>'`), mirroring `leaveApprovals.ts`/every Performance transition — a concurrent or repeat completion affects zero rows and returns a controlled `409`.

### 10.4 Certificate lifecycle

```
active → revoked
```

Issued automatically (system action, audited) the instant a qualifying enrollment reaches `completed` on a course with `issuesCertificate = true` (and, if `hasAssessment`, only when `passed = true`). `expiresAt` is computed once at issuance from `course.certificateValidityMonths` and never recomputed. **"Expired" is never a stored `status` value** — every read path computes it live from `expiresAt < now()` (organization-local "now," per §16), avoiding any background job. Revocation (`learning.manage` only) requires a reason and is fully audited; a revoked certificate's history (who issued it, when, from which enrollment) is never erased.

---

## 11. Goals / Assessment Model

No dedicated "goals" concept exists in Learning (unlike Performance) — training assignment itself is the unit of tracking. Where a course is configured `hasAssessment = true`, completion requires an explicit `passed` boolean plus an optional free-form `score`, entered by the instructor of record or HR — there is no question bank, no auto-grading, and no partial-credit model. This is a deliberate, minimal design matching "assessments... if justified" without building a quiz engine no roadmap item requires.

---

## 12. Self-Assessment / Employee Progress (ESS)

For self-paced courses, the employee (`learning.write.own`, own enrollment only) may advance their own enrollment `assigned → in_progress → completed`, and attach supporting evidence. There is no numeric "percentage complete" — this platform has no content-delivery/player infrastructure to measure it against, and inventing one would be exactly the kind of fabricated metric this session's own established discipline (and this document's own instruction) forbids. Once `completed`, the employee's own record locks (defense in depth: the write route's own schema never accepts a field once `status` has left `in_progress`, regardless of what's sent).

---

## 13. Manager / Instructor Actions

**Manager of record** (`managerEmployeeIdSnapshot`, `learning.review.write`): assigns training to direct reports (creating enrollments with `originType = manager_assigned`, `auto_approved`), decides `pending` employee-requested enrollments from direct reports, views "My Team Training."

**Instructor of record** (a session's own `instructorEmployeeId`, `learning.review.write`): marks attendance and completion/assessment results for that session's own enrollments — resolved server-side by comparing the caller's own employee identity against the session's `instructorEmployeeId`, never a client-supplied flag, mirroring `resolveReviewRelationship`'s exact dispatch shape from Performance W78.

An employee who is both someone's manager and a session's instructor is authorized on each relationship independently — no special-casing needed, since both checks are pure server-side comparisons against already-resolved identifiers.

---

## 14. HR / L&D Administration

`learning.manage`: course/session CRUD, bulk-assign (audience targeting — reuses `resolveEligibleEmployees`'s exact `all_active`/`department`/`position`/`manual` logic, one atomic transaction per bulk-assign action, mirroring `generateReviews`), org-wide approval/decision authority (overriding or standing in for a manager-of-record decision), administrative completion/attendance correction with mandatory reason and audit, certificate revocation, org-wide enrollment list and reporting.

---

## 15. ESS / Manager / HR Surfaces (Planned)

- **ESS "My Learning"** (new tab on the existing `/self-service` page, gated via the platform's established `isModuleAccessible(modules, 'learning')` pattern, independent of the rest of ESS — mirroring My Attendance/My Leave/My Performance exactly): browsable active catalog, self-enroll/request action, own enrollment list with status, own progress-marking for self-paced courses, own certificates, own training history.
- **Manager "My Team Training"** (mirrors Performance's "My Team Reviews," W78): direct-report enrollment list, pending-approval queue, assign-training action, instructor actions for any session they lead.
- **Internal HR/L&D workspace** (`/learning-courses`, `/learning-sessions`, `/learning-enrollments` — mirrors Performance's W80/Attendance's Register): course/session CRUD, org-wide enrollment list (paginated, filterable), bulk-assign, org-wide approval queue, certificate administration.
- **Dashboard** (`/learning`, mirrors §16): tile breakdown.
- **Reports** (`/learning-reports`, mirrors §17): 3 report keys + CSV.

---

## 16. Dashboard (Planned Metrics)

Plain counts only — **no invented completion-rate or average-score tile**, per this document's own instruction and the platform's established "no invented rate/KPI" discipline (Attendance's `attendance_monthly_summary`'s own precedent, reaffirmed by Performance's dashboard and by W83's explicit re-confirmation that no such tile was ever added there):

- `activeCourseCount`
- `enrollmentsAssignedCount` (organization-wide or manager-scoped, per caller)
- Zero-filled enrollment status breakdown (`assigned`/`in_progress`/`completed`/`failed`/`cancelled`)
- `pendingApprovalCount`
- `overdueCount` (enrollments with a passed `dueDate`, not yet `completed`)
- `certificatesExpiringSoonCount` (an explicit `?withinDays=` query parameter, not a hardcoded threshold — avoiding inventing a fixed policy the frozen document doesn't define)

---

## 17. Reporting

Three report keys, registered in the shared Reporting Foundation registry (`category: "learning"`) for catalog discoverability, executed through a dedicated, visibility-scoped route (`GET .../learning/reports/:reportKey`), never the generic runner — identical to Attendance's/Performance's own isolation:

- `learning_enrollment_status` — every enrollment in scope, status, approval state, dates, mandatory flag.
- `learning_completion_summary` — completions/failures per course/category/date range.
- `learning_certificate_expiry` — issued certificates, issue/expiry dates, computed expired/active/revoked state.

Own/manager-of-record/organization-wide visibility mirrors the dashboard exactly. `?format=csv` reuses the platform's established export convention — export scope is always identical to the already-authorized JSON scope, `organizationId` resolved from the URL/membership, never the query string.

---

## 18. Files / Evidence / Certificates

Both `learning_enrollment_evidence` and `learning_certificates.employeeDocumentId` point into the **existing** `employee_documents` table via the **existing** `fileStorage.ts`/`documentValidation.ts` layer — identical file-type allowlist (PDF, JPEG, PNG, DOCX, XLSX), identical 10MB cap, identical extension/MIME/file-signature validation, identical server-generated storage keys (never derived from a client-supplied filename), identical authenticated-only download with no public URL. **No new storage provider, no new upload/download infrastructure.** A new `document_category`-equivalent value is not needed — Master Data's own `document_category` domain already exists and Learning's uploads can register under it if a dedicated category label is wanted (an implementation detail for the owning workstream, not fixed here).

---

## 19. Tenant Isolation

Every table carries `organizationId`; every route composes `requireAuth` → `requireMembership("organizationId")` → `requireModuleEnabled("learning")` → a specific permission check, identical to every existing module. Manager-of-record and instructor-of-record relationships are always resolved from already-organization-scoped snapshot/session columns, never a cross-organization comparison. Cross-org enrollment, certificate, evidence, and session IDs are structurally unreachable — the same IDOR-guard discipline verified live throughout W73–W84 applies identically here (a valid ID from one organization is never sufficient authorization on its own).

---

## 20. RLS / Security

All 5 new tables RLS-enabled inline at migration time, zero policies — deny-by-default, no exceptions, matching every table on this platform (currently 79/79, proposed 84/84 with the same 0/0 disabled/policy counts). The application connects with the same `postgres`-owning, `BYPASSRLS` server role every other module already relies on; RLS's role here is exclusively to close the Supabase Data API/PostgREST exposure path, identical to its role everywhere else on this platform.

---

## 21. API Plan (Proposed)

Mirrors the established `requireAuth → requireMembership → requireModuleEnabled("learning") → requirePermission(...)` chain on every route.

| Route | Method | Permission |
|---|---|---|
| `.../learning/courses` | GET, POST | broad read; `learning.manage` (POST) |
| `.../learning/courses/:id` | GET, PATCH | `learning.manage` |
| `.../learning/courses/:id/sessions` | GET, POST | broad read; `learning.manage` (POST) |
| `.../learning/sessions/:id` | GET, PATCH | `learning.manage` |
| `.../learning/courses/:id/assign` | POST | `learning.manage` (bulk-assign, audience-targeted) |
| `.../learning/courses/:id/enroll` | POST | `learning.write.own` (self-enroll/request) |
| `.../learning/my-enrollments` | GET | `learning.read.own` |
| `.../learning/team-enrollments` | GET | `learning.review.write` (manager-of-record scope) |
| `.../learning/enrollments` | GET | `learning.manage` (org-wide) or `learning.read.own` (scoped) |
| `.../learning/enrollments/:id` | GET | own / manager-of-record / instructor-of-record / `learning.manage` |
| `.../learning/enrollments/:id/approve`, `/reject` | POST | manager-of-record (own reports) or `learning.manage` (org-wide) |
| `.../learning/enrollments/:id/progress` | PATCH | `learning.write.own` (own, self-paced) |
| `.../learning/enrollments/:id/attendance` | POST | instructor-of-record or `learning.manage` |
| `.../learning/enrollments/:id/complete` | POST | instructor-of-record or `learning.manage` |
| `.../learning/enrollments/:id/cancel` | POST | own (`learning.write.own`, not-yet-started) or `learning.manage` |
| `.../learning/enrollments/:id/evidence` | GET, POST | same visibility tier as the enrollment itself |
| `.../learning/enrollments/:id/evidence/:evidenceId/download` | GET | same visibility tier |
| `.../learning/my-certificates` | GET | `learning.read.own` |
| `.../learning/certificates` | GET | `learning.manage` (org-wide) |
| `.../learning/certificates/:id/revoke` | POST | `learning.manage` |
| `.../learning/dashboard` | GET | `learning.reports.read` |
| `.../learning/reports/:reportKey` | GET | `learning.reports.read` |

No `DELETE` route on any instance-level record — matches the platform's own established "no unnecessary CRUD" discipline (Performance §27's own closing line).

---

## 22. Frontend Plan (Proposed)

New routes: `/learning-courses`, `/learning-sessions` (or folded into the course detail view), `/learning-enrollments` (internal HR/L&D workspace), `/learning` (dashboard), `/learning-reports`; a new "My Learning" tab on the existing ESS page; a new "My Team Training" surface (either its own route or folded into an existing manager-facing page, an implementation detail for the owning workstream). All module-gated via `<ModuleGate moduleKey="learning">` (or the ESS tab's own independent in-page check, matching every prior ESS tab). No new charting dependency; standard loading/error/empty/`403`/`409` states; zero client-side scoring/status computation (every surface renders server-computed DTOs only, matching the platform-wide discipline re-verified as a Definition-of-Done item in both Attendance and Performance).

---

## 23. Integration Matrix

- **Foundation (Employees, Departments, Positions):** identity resolution reuses `resolveOwnEmployeeId`; `reportingManagerId` is the sole manager-of-record resolution mechanism; department/position are read only at enrollment-creation time, then snapshotted.
- **Employee Documents / File Storage (Phase 2A):** reused verbatim by evidence and certificates — no duplicate storage architecture.
- **Master Data:** one new domain (`training_category`).
- **ESS:** "My Learning" is independently module-gated, unaffected by and not affecting My Attendance/My Leave/My Performance/Internal Vacancies.
- **Reporting Framework (W17/ADR-016):** the shared `reports` registry is reused for catalog discoverability; no second report registry.
- **Performance:** **no coupling in V1** (Owner Decisions 3, 4; §4) — Learning is fully usable with `performance` disabled, and vice versa. The only future integration point contemplated is read-only cross-reporting (e.g., a future report joining completed mandatory training against review cycles) — not designed or built here.
- **Employee Certifications / Skills (Phase 2A):** deliberately not written to by Learning in V1 (Owner Decisions 3, 4).
- **Tenant Infrastructure:** shared-mode compatible by construction; dedicated-mode deployments run the identical, unmodified Learning code path.

---

## 24. Security Threat Review

| Threat | Control |
|---|---|
| Employee marks their own instructor-led completion without actually attending | Completion for instructor-led courses is instructor-of-record/HR-only (`learning.review.write`/`learning.manage`); the employee's own `learning.write.own` completion path is restricted to self-paced courses only, enforced by the route's own delivery-mode check. |
| Employee acknowledges/completes another employee's enrollment | Every own-scoped route resolves identity server-side (`resolveOwnEmployeeId`) and compares against the enrollment's own `employeeId` — never a client-supplied value. |
| Manager approves a request for an employee who isn't their direct report | `managerEmployeeIdSnapshot` comparison, server-derived, never client-supplied. |
| Instructor marks attendance/completion for a session they don't teach | `instructorEmployeeId` comparison, server-derived. |
| Cross-org enrollment/certificate/session access | `organizationId` scoping on every query plus `requireMembership`; a valid ID from another organization is never sufficient authorization alone (IDOR guard, matching the pattern verified live throughout Phase 3C). |
| A rejected enrollment is silently resumed | `approvalStatus = 'rejected'` is checked as a hard terminal gate on every subsequent write route, independent of `status`. |
| Certificate expiry silently drifts because a background job never ran | Not applicable — expiry is computed live on every read, never stored as a transition requiring a job. |
| Session capacity race under concurrent enrollment | Atomic conditional insert/count check, `409` on the losing side — same pattern as every other atomic transition on this platform. |

---

## 25. Performance / Scalability

Every list surface (enrollments, sessions, courses, certificates) follows the established `{items, total, page, pageSize}` pagination convention (W80's own precedent). Bulk-assign is a single atomic transaction, batch-inserting one enrollment row per eligible employee — no per-row query loop in any hot read path; dashboard/report aggregation uses one batched query plus in-memory aggregation, mirroring Performance's own W81/W83-verified discipline. No caching layer is introduced — none exists elsewhere on this platform.

---

## 26. Known Platform-Wide Items Carried Forward (Not Addressed by This Plan)

- **Repository-local lint tooling is unavailable** — pre-existing gap, unrelated to Learning, not addressed by this plan or its future implementation workstreams.
- **CSV formula-injection escaping is not implemented platform-wide** — pre-existing gap shared by Attendance's, Recruitment's, and Performance's own CSV export; Learning's own CSV export will share the identical gap unless a separate, dedicated platform-hardening workstream addresses it first.
- **No malware scanning exists for uploaded files** — pre-existing gap; Learning's evidence/certificate uploads will carry the identical limitation as Performance's own evidence uploads (extension/MIME/signature validation only).

---

## 27. Test Strategy (Future)

Mirrors Performance's own §33 discipline exactly: unit tests for every service-layer transition (atomic-conditional-update behavior, terminal-state guards, snapshot correctness), integration tests for every route's authorization chain (own/manager-of-record/instructor-of-record/HR/module-disabled/no-membership/cross-org), a dedicated "status is authoritative, never a timestamp" regression test, and settings-snapshot regression tests (a later course edit must never alter an already-created enrollment's own snapshotted values).

---

## 28. Live QA Strategy (Future)

Mirrors Performance's own §34/W83 discipline: a real, disposable-account lifecycle carried through real routes end to end (course → session → bulk-assign or self-enroll → approval where required → attendance/progress → completion → certificate issuance → expiry-soon report → revoke), WWM↔Acme tenant isolation across every entity type, IDOR checks, and independently-verified cleanup restoring both organizations' exact prior module-enablement/data state. No SQL-staged lifecycle statuses — only real transitions through real routes, direct SQL reserved for disposable-actor setup/inspection only, always disclosed.

---

## 29. Workstream Breakdown (Proposed)

Continuing numbering directly from W84 (Phase 3C's own completion report), per this document's own instruction:

| # | Workstream | Scope | Mirrors |
|---|---|---|---|
| **W85** | Learning Foundation & Module Activation | All 5 tables, RLS enabled inline, 5 permissions seeded, module `learning` flipped `hidden`→`active` (available, not enabled for any org), `lib/learningAuthorization.ts`, new `training_category` Master Data domain. Schema + auth primitives only — no routes, no frontend. | W73 |
| **W86** | Course Catalog & Sessions | Course CRUD (`draft`/`active`/`archived`), session scheduling CRUD, HR/L&D administration. | W74 |
| **W87** | Enrollment, Assignment & Approval | Bulk-assign (audience targeting), employee self-enroll/request, manager-assign, approval/decision flow, capacity enforcement. | W75 (+ Performance's own goal-approval pattern, W76) |
| **W88** | Employee Self-Service Learning | "My Learning" ESS tab — catalog browse, self-enroll, own progress-marking, own history/certificates. | W77 |
| **W89** | Manager & Instructor Actions | "My Team Training," attendance marking, completion/assessment marking, manager approval decisions. | W78 |
| **W90** | Certificates & Evidence | Certificate issuance on qualifying completion, expiry computation, revoke action, enrollment evidence attachments (reusing `employee_documents`). | W79 + W82 combined |
| **W91** | Internal HR/L&D Workspace | Org-wide enrollment list, paginated/filterable, course/session admin frontend. | W80 |
| **W92** | Dashboard & Reporting | Tile breakdown, 3 report keys, CSV export. | W81 |
| **W93** | Phase 3D Verification | Full repo-wide verification pass against this frozen plan — functional, authorization, tenant isolation, historical integrity, security, database, live QA. Verification-only, no casual feature additions. | W83 |
| **W94** | Phase 3D Completion Report | Formal closure — reconciliation, shipped-capability record, known non-blocking items, next roadmap step. | W84 |

Ten workstreams, matching Performance's own W73–W84 cadence and discipline exactly (including a dedicated final verification workstream and a dedicated completion-report workstream, per this document's own explicit instruction).

---

## 30. Definitions of Done

A Learning workstream is only complete when it includes: schema (where applicable) + migration + backend service/route + permission enforcement + validation + OpenAPI specification + regenerated API clients + frontend UI (where applicable) + organization isolation + audit logging where applicable + automated tests + this document updated to reflect what actually shipped — identical to `CLAUDE.md`'s own "Definition of Complete" and every prior phase's own discipline.

---

## 31. Production Rollout Boundary

Nothing in this document authorizes any production action. No migration, route, frontend page, permission seed, or module activation exists yet. Production rollout for Learning, once implemented, remains a separate, explicitly-gated decision requiring its own preflight, review, and approval — identical to every prior phase's own closing boundary.
