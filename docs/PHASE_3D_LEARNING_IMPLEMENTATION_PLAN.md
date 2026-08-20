# Phase 3D — Learning & Development: Frozen Implementation Plan

Status: **FROZEN — APPROVED FOR IMPLEMENTATION** (2026-08-20). No workstream may begin execution merely because this document is frozen — **W85 still requires its own separate go-ahead**, exactly as W64 and W73 did after their own frozen documents were approved. This document was produced across two passes: an initial discovery/draft pass (no migrations, no routes, no frontend pages, no permission seeding, no module activation, no production access), and this final-reconciliation pass (owner decisions approved, historical-integrity/lifecycle/certificate/assessment/permission/workstream detail reconciled against those decisions — again with no migration, route, frontend, permission seed, module activation, or production access performed).

This document was produced by inspecting the current repository directly. Every claim about existing code is based on direct file inspection (paths cited); every design element not already forced by existing architecture is a considered design decision now folded into the frozen sections below; every genuine business-policy call is recorded and approved in §0.

---

## 0. Owner Decisions — Approved (2026-08-20)

The following eight decisions were open in the draft and are now resolved, exactly as recommended. They are load-bearing on §8–§13 and the workstream breakdown (§29) — every downstream section below has been reconciled to them.

| # | Decision | Approved answer |
|---|---|---|
| 1 | Who approves an employee-requested enrollment when the course requires approval? | **The employee's own manager (manager-of-record), server-derived via `reportingManagerId` — never a client-supplied relationship.** HR/L&D (`learning.manage`) may additionally approve, reject, assign directly, or override any decision, organization-wide. **The employee can never approve their own request** — no route accepts a caller acting on their own `employeeId` for an approve/reject action; the server-side identity check structurally excludes it. |
| 2 | Is "mandatory" a course-level-only flag, or can an individual assignment override it? | **Course-level default (`mandatoryDefault`) + per-assignment override**, snapshotted onto the enrollment at creation (`mandatoryAtAssignment` — renamed from the draft's `isMandatory` for clarity, see §8.3). **A mandatory enrollment cannot be cancelled by the employee.** HR/L&D may cancel or waive it, but only with a required reason, fully audited (§10.5). A later course edit to `mandatoryDefault` never changes an already-created enrollment's own snapshotted value. |
| 3 | Do Learning-issued certificates write into `employee_certifications`, or stay separate? | **Stay separate — confirmed, no automatic cross-write.** `learning_certificates` remains a distinct, Learning-owned model; `employee_certifications` remains the sole source for external/manually-tracked credentials. The two may be **surfaced together** in a future UI/report (a read-only join at display time), but their underlying data models remain structurally independent — no FK, no shared table, no automatic sync. |
| 4 | Does course completion automatically write to `employee_skills`? | **No — confirmed.** Any Learning-to-skills integration is deferred past V1 in its entirety. |
| 5 | Automatic renewal/recurring-assignment scheduling? | **No — confirmed.** No background-job infrastructure exists on this platform. Expiry/expiring-soon status is always computed live from stored dates, never a stored transition. A future renewal workflow creates a **new** enrollment row (and, on completion, a new certificate) — it never rewrites or reopens the old one, preserving §10.6's own immutable-outcome guarantee. |
| 6 | Session capacity — hard block or waitlist? | **Hard-blocked (`409`), no waitlist — confirmed.** |
| 7 | Course categories — Master Data or a dedicated table? | **Master Data (`training_category`, organization-defined) — confirmed.** No separate Learning category table exists. |
| 8 | Formal reopen of completed/failed enrollments? | **No — confirmed.** No enrollment in a terminal state (`completed`, `failed`, `cancelled`) may ever be reopened or mutated. Retraining always creates a **new** enrollment row. Every historical enrollment's own outcome (`status`, `passed`, `score`, `attended`) is permanently immutable once terminal — enforced at the service-layer function-signature level, identical in spirit to Performance's own "status is authoritative" discipline, but stricter here: Performance allows a controlled HR reopen; Learning V1 deliberately does not. |

**Three additional workflow clarifications, resolved during this reconciliation pass** (not independent Owner Decisions — direct, mechanical consequences of Decision 1 applied consistently):

- **HR-direct assignment bypasses approval entirely.** An `hr_assigned` enrollment is created with `approvalStatus = 'auto_approved'` at the same instant it's created — HR/L&D is itself the assigning authority under `learning.manage`, so there is nothing left to approve. This is not a shortcut; it is the same "the assigner's own authority is the approval" principle Performance already established for manager-created goals (§12 of the frozen Performance plan: "manager-created goal: accepted immediately").
- **Manager-assigned enrollment likewise bypasses approval — no manager-approves-their-own-assignment loop.** A `manager_assigned` enrollment is created with `approvalStatus = 'auto_approved'` at creation. Requiring the same manager to then "approve" their own assignment would be a redundant, pointless loop; approval exists specifically to gate an *employee's own request* against someone else's decision, not to gate an authority's own action against itself.
- **Employee-requested enrollment's exact request→assigned mechanics** (§10.3): the `learning_enrollments` row is created **immediately** at request time, in every case — there is no separate "pending request" entity. `status` is set to `assigned` at creation regardless of `approvalStatus`. What differs is *actionability*, not row existence: every subsequent write route (progress-marking, attendance, completion) additionally requires `approvalStatus ∈ {auto_approved, approved}` before it will act on the row. A manager/HR decision on a `pending` row changes only `approvalStatus` (`pending → approved` or `pending → rejected`); it never itself advances `status`. This means "moving from request into assigned" is not a status transition at all — the row was always `status = 'assigned'`; approval simply unlocks it. A `rejected` row stays at `status = 'assigned'` forever, permanently inert, kept only for audit.

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

## 3. Scope (Frozen V1)

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

## 7. Permissions — Frozen

**Exactly 5 keys, revalidated and confirmed final in this reconciliation pass — deliberately no `.read.team` and no acknowledgement-shaped separate key**, following the platform's own established discipline that "team"/relationship-scoped visibility is resolved server-side, never granted as its own permission (identical to Attendance's and Performance's own §7 precedent):

| Key | Grants |
|---|---|
| `learning.read.own` | Own enrollments, own certificates, own training history; the coarse gate for `my-enrollments`/`my-certificates`/enrollment-detail read. |
| `learning.write.own` | Self-enroll/request, mark own self-paced progress/completion (never one's own assessment result, §11), cancel own not-yet-started **non-mandatory** request (§10.5), upload own enrollment evidence. |
| `learning.review.write` | Relationship-scoped: **manager of record** (assign to own reports, decide own reports' pending requests) *or* **instructor of record** (mark attendance/completion, including assessment results, for their own session's enrollments) — dispatched server-side by comparing the caller's own employee identity against the enrollment's `managerEmployeeIdSnapshot` or the session's `instructorEmployeeId`, exactly mirroring Performance's `resolveReviewRelationship`/dual-tier dispatch (W78). No separate "instructor" permission key. |
| `learning.manage` | Course/session CRUD, bulk-assign, org-wide approval/decision authority (including any pending `employee_requested` enrollment, not just those under a specific manager), administrative completion/attendance correction, mandatory-enrollment cancel/waive (§10.5), certificate revocation, org-wide enrollment list. |
| `learning.reports.read` | Dashboard + reports. |

**Final default role mapping** (mirrors Performance's own §7 exactly, confirmed unchanged by this reconciliation): `employee` holds `read.own`/`write.own`/`review.write`/`reports.read` (every employee can potentially be a manager or instructor of someone); `hr_manager`/`org_admin`/`super_admin` hold all 5. No role holds `learning.manage` except `hr_manager`/`org_admin`/`super_admin` — a plain `employee` (even one who happens to manage or instruct others) never gains organization-wide reach through `learning.review.write` alone.

**No organization-settings namespace exists for Learning** — confirmed in this reconciliation pass. Every course-level configuration (assessment requirement, certificate validity period, mandatory default, approval requirement) lives on the course row itself, snapshotted onto each enrollment at assignment time (§9), matching Performance's own `scoringPrecisionSnapshot`/`acknowledgementRequiredSnapshot` precedent rather than inventing an organization-wide default that would need its own snapshot discipline.

---

## 8. Data Model — Frozen (five tables, reconciled)

**Five tables remain sufficient after applying all eight Owner Decisions — verified explicitly in this reconciliation pass, no table was added or removed.** No decision required a new entity: course categories reuse Master Data (Owner Decision 7, no `learning_categories` table); certificates stay in their own table but gain no new relations (Owner Decision 3 — no bridge table to `employee_certifications`); skills gain no integration table (Owner Decision 4); no reopen/revision-history table exists (Owner Decision 8 — immutability is enforced by the absence of any reopen path, not by a new audit-shadow table, since `audit_events` already captures every transition). The only schema-level consequence of this reconciliation pass is **additional columns on the existing `learning_enrollments` table** (§8.3) to satisfy the fuller historical-snapshot requirement — described below, not created as a migration.

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

**Frozen, same as every other cross-table reference on this platform:** a session's `courseId` must belong to the same `organizationId` as the session itself — validated in the service layer at creation, the identical discipline Performance uses to keep a template's `ratingScaleId` same-organization. `scheduledAt` is `timestamptz`, inherently timezone-aware and organization-timezone-displayed on read (no separate `timezone` column, mirroring `interviews.scheduledAt` exactly); an end time is always derived as `scheduledAt + durationMinutes`, never stored separately. `instructorEmployeeId` and `capacity` are both optional — a session may exist with neither (e.g., a placeholder scheduled before an instructor is confirmed), but `learning.review.write`'s instructor-of-record dispatch and capacity enforcement (Owner Decision 6) simply have nothing to grant/enforce until they're set.

**Attendance/completion relationship — explicitly not the Attendance module:** `attended` lives on the **enrollment** (§8.3), not the session, and is a single binary "did this employee attend this specific training session" fact, instructor/HR-marked after the session occurs. This is deliberately unconnected to the Attendance module's `attendance_events`/`attendance_adjustments`/daily-summary machinery, which tracks daily *work* attendance (clock-in/out, computed daily status) — a structurally different domain operating on civil dates, not scheduled events. Learning session participation is never written to, read from, or reconciled against any Attendance table, and vice versa; the two modules remain fully independent, each usable with the other disabled.

### 8.3 `learning_enrollments`

The core record — one employee's assignment to a course (optionally a specific session).

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | FK → organizations, restrict | |
| `courseId` | FK → learning_courses, restrict | |
| `sessionId` | FK → learning_course_sessions, restrict, nullable | Null for self-paced; required for instructor-led (validated at creation). |
| `employeeId` | FK → employees, restrict | Historical business record — restrict, never cascade, matching `performance_reviews.employeeId` exactly. |
| `courseTitleSnapshot`, `categorySnapshot` | text, not null | Snapshotted at creation (§9) — `categorySnapshot` is the category's own **display label** at assignment time (not merely the Master Data code), so a later label rename never rewrites what the employee was actually shown. |
| `deliveryModeSnapshot` | enum: `self_paced`, `instructor_led`, not null | **[New in this reconciliation pass — historical integrity]** Snapshotted from `course.deliveryMode` at creation. A course's delivery mode is not expected to change after any enrollment exists against it, but nothing here relies on that assumption — write routes always branch on the enrollment's own snapshot, never the live course row. |
| `hasAssessmentSnapshot` | boolean, not null | **[New in this reconciliation pass]** Snapshotted from `course.hasAssessment` at creation — a later course edit toggling this never changes whether an already-created enrollment requires a pass/fail result. |
| `issuesCertificateSnapshot` | boolean, not null | **[New in this reconciliation pass]** Snapshotted from `course.issuesCertificate` at creation — certificate issuance at completion time (§10.4) reads this column, never the live course row. |
| `certificateValidityMonthsSnapshot` | integer, nullable | **[New in this reconciliation pass]** Snapshotted from `course.certificateValidityMonths` at creation (only meaningful when `issuesCertificateSnapshot = true`). A later change to the course's own validity period never alters an already-issued or yet-to-be-issued certificate for an existing enrollment. |
| `departmentIdSnapshot`, `positionIdSnapshot` | FK → departments/positions, restrict, nullable | Snapshotted at creation, matching `performance_reviews`. |
| `managerEmployeeIdSnapshot` | FK → employees, restrict, nullable | Snapshot of `employees.reportingManagerId` at creation — the "manager of record" for `learning.review.write` dispatch and approval authority (Owner Decision 1); a later manager change never reassigns an in-flight or historical enrollment (identical rationale to Performance's `reviewerEmployeeId`). |
| `originType` | enum: `hr_assigned`, `manager_assigned`, `employee_requested` | |
| `assignedByMembershipId` | FK → organization_memberships, set null, nullable | Null for `employee_requested`. |
| `mandatoryAtAssignment` | boolean, not null | Snapshotted from `course.mandatoryDefault`, overridable by the assigner at creation (Owner Decision 2). Renamed from the draft's `isMandatory` for clarity — the column name itself now states that it is a snapshot, not a live-read flag. |
| `dueDate` | timestamptz, nullable | Optional compliance deadline; informational, drives an "overdue" dashboard/report signal only — never a lifecycle gate. |
| `approvalStatus` | enum: `auto_approved`, `pending`, `approved`, `rejected` | `hr_assigned`/`manager_assigned` are **always** `auto_approved` at creation — the assigner already held the authority (§0's own workflow clarifications). `employee_requested` starts `pending` if `course.requiresApproval`, else `auto_approved`. |
| `approvalDecidedByMembershipId`, `approvalDecidedAt` | nullable | Informational only — never read to infer lifecycle stage instead of `approvalStatus`/`status` (§10.3). |
| `status` | enum: `assigned`, `in_progress`, `completed`, `failed`, `cancelled` | **The sole authoritative field for training progress** (§10.3). Set to `assigned` at creation in every case, regardless of `approvalStatus` — approval gates *actionability*, not row existence (§0). A `rejected` `approvalStatus` enrollment is permanently inert at `status = 'assigned'` — enforced in the service layer, never physically deleted (audit-trail integrity). Once `completed`/`failed`/`cancelled`, **no further transition is ever permitted** (Owner Decision 8) — no reopen exists in V1. |
| `attended` | boolean, nullable | Instructor-led only; set by the instructor of record or HR after the session occurs. A fact, not a status — recording it never by itself transitions `status` (§10.3). |
| `attendanceMarkedByMembershipId`, `attendanceMarkedAt` | nullable | Informational. |
| `passed` | boolean, nullable | Only meaningful when `hasAssessmentSnapshot = true`. Recorded directly and independently by the instructor of record or HR/L&D — **never auto-derived from `score` against a threshold** (§11). |
| `score` | numeric, nullable | Free-form, instructor/HR-entered — no question-bank scoring exists, no pass threshold is stored or computed anywhere (§11). |
| `completedAt` | timestamptz, nullable | Informational only, never read to infer stage instead of `status` (§10.3). |
| `cancelReason` | text, nullable | **Required** whenever `status` is set to `cancelled` by anyone other than the enrolled employee cancelling their own not-yet-started, non-mandatory request. **Always required, with no exception, when the enrollment being cancelled is mandatory** (`mandatoryAtAssignment = true`) — a mandatory enrollment can only ever be cancelled by HR/L&D (`learning.manage`), never by the employee, and always with a reason (§10.5). |

Uniqueness (partial, application/DB-enforced): at most one **non-terminal** (`assigned`/`in_progress`) enrollment per `(employeeId, courseId)` for self-paced courses, and per `(employeeId, sessionId)` for instructor-led — allowing legitimate re-enrollment (e.g., annual mandatory retraining) once a prior enrollment reaches a terminal state (`completed`/`failed`/`cancelled`), each retraining always a **new row**, never a reopened old one (Owner Decision 8). Exact constraint shape (partial unique index vs. service-layer check) is an implementation detail for the owning workstream (W87), not fixed here.

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

### 8.7 Migration & RLS impact (frozen design, not yet created)

**5 new tables** (`learning_courses`, `learning_course_sessions`, `learning_enrollments`, `learning_enrollment_evidence`, `learning_certificates`), each RLS-enabled inline with zero policies at creation, each with a hand-authored `.down.sql`, following every prior migration's own convention. **Expected next migration: `0039`** — not created in this planning session. Public table count would move from the current 79 to **84** (79 + 5), all RLS-enabled, 0 disabled, 0 policies, preserving the deny-by-default baseline with no exceptions.

---

## 9. Historical Integrity

Every enrollment permanently snapshots, at creation, the complete set of historical fields needed to understand it later without re-reading the live course: `courseTitleSnapshot` (title), `categorySnapshot` (category display label), `deliveryModeSnapshot` (delivery type), `mandatoryAtAssignment` (the mandatory flag applicable to this exact enrollment), `hasAssessmentSnapshot` (completion/pass requirement), `issuesCertificateSnapshot`/`certificateValidityMonthsSnapshot` (certificate eligibility and rule applicable at assignment), `departmentIdSnapshot`/`positionIdSnapshot` (targeting context), and `managerEmployeeIdSnapshot` (approver/manager-of-record reference). Every certificate permanently snapshots `courseTitleSnapshot` at issuance. `courseId`/`sessionId` are retained as live references for traceability only, never re-read for display content or business-rule evaluation after creation — the same "live reference, protected by the fact history is snapshotted elsewhere" pattern Performance uses for `templateId`/`ratingScaleId`. **A later course edit never changes an existing enrollment's own historical meaning, for any field** — every rule that could vary by course configuration is evaluated once, at enrollment creation (or, for certificate expiry, at issuance), and never re-evaluated against the live course row again.

**Change-table (mirrors Performance's own §9 table):**

| Changes later... | Effect on existing enrollments/certificates |
|---|---|
| Employee's department/position/manager changes | No effect — all three are snapshotted |
| Course is edited or archived | No effect — title/category/delivery-mode were copied at enrollment creation |
| Course category renamed | No effect — the enrollment's own `categorySnapshot` is the label as it stood at creation |
| Course's `mandatoryDefault`/`requiresApproval`/`hasAssessment`/`issuesCertificate`/`certificateValidityMonths` changes | **No effect whatsoever** on already-created enrollments or already-issued certificates — every one of these is snapshotted onto the enrollment at creation (or computed once at certificate issuance) and never re-read live again |
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

**`approvalStatus`** (only meaningful for `employee_requested` originType — §0's own workflow clarifications, frozen):

```
pending → approved | rejected
```

`hr_assigned`/`manager_assigned` enrollments are created directly at `auto_approved` — the assigner already held the authority to assign, and requiring a manager to approve their own assignment would be a redundant loop (§0). `pending → approved`/`pending → rejected` is decided by the enrollment's own `managerEmployeeIdSnapshot` (manager-of-record) or by any `learning.manage` holder (HR/L&D), organization-wide — **never by the enrolled employee themselves**, structurally excluded by the route's own server-derived-identity check (Owner Decision 1). A `rejected` enrollment is permanently terminal; its own `status` never advances (enforced in the service layer, atomic conditional check on every subsequent write).

**`status`** (the authoritative progress field for the row itself, present from creation, gated for *actionability* by `approvalStatus` being `auto_approved`/`approved` — see §0's "request→assigned mechanics" for why this is not itself a transition):

```
assigned → in_progress → completed
                       ↘ failed   (only when hasAssessmentSnapshot = true and passed = false)
assigned/in_progress → cancelled (§10.5 — subject to the mandatory-enrollment restriction)
```

Attendance (`attended`) is recorded as a separate fact by the instructor of record or HR once a session occurs — it does not by itself transition `status`; a completion action (§10.3.1) is always an explicit, separate step, consistent with the "no timestamp/flag substituting for an authoritative status transition" rule applied to every boolean fact here, not just timestamps. **Once `status` reaches `completed`, `failed`, or `cancelled`, it is permanently terminal — no further transition of any kind is permitted** (Owner Decision 8; §10.6).

**10.3.1 Completion action:** for self-paced courses, the employee (`learning.write.own`) marks their own `in_progress`/`completed`. For instructor-led courses, the instructor of record marks completion after the session (`learning.review.write`); HR/L&D (`learning.manage`) may also mark completion for any enrollment, organization-wide. **For a self-paced course with `hasAssessmentSnapshot = true`** — no instructor of record exists (no session) — only HR/L&D (`learning.manage`) may record the `passed`/`score` result; the employee's own `learning.write.own` completion path never accepts an assessment result for their own row (an employee cannot grade themselves). Every transition is an atomic conditional update (`WHERE status = '<expected>'`), mirroring `leaveApprovals.ts`/every Performance transition — a concurrent or repeat completion affects zero rows and returns a controlled `409`.

### 10.4 Certificate lifecycle — frozen issuance rules

```
active → revoked
```

**Issuance is automatic, system-triggered, and part of the same atomic action as the completion transition itself** — not a separate manual "issue certificate" step. Exact frozen rule:

1. **Required completion state:** the enrollment's `status` transition to `completed` (never `failed` — a failed assessment never issues a certificate).
2. **Assessment gate:** when `hasAssessmentSnapshot = true`, a certificate issues **only if `passed = true`** in the same completion call; a `completed` (self-paced, no assessment) or `completed` + `passed = true` (assessed) enrollment both qualify; `failed` never qualifies by definition (it is a different terminal `status` value, not a `completed` + `passed = false` combination — a course requiring an assessment routes a non-pass to `status = 'failed'` directly, per §10.3).
3. **Certificate eligibility source:** read from the enrollment's own `issuesCertificateSnapshot`/`certificateValidityMonthsSnapshot` — **never** the live `learning_courses` row (§9).
4. **Who/what issues it:** the system itself, as an automatic consequence of the completion service function, in the same transaction — audited as its own distinct event (§19), attributed to the actor who performed the completion action (there is no separate "certificate issuer" identity).
5. **Issue date:** `issuedAt` = the server timestamp of the completion transaction — never client-supplied, never backdated.
6. **Expiry date:** `expiresAt` = `issuedAt + certificateValidityMonthsSnapshot` months, computed exactly once at issuance and never recomputed; null `certificateValidityMonthsSnapshot` → `expiresAt` stays null (never expires).
7. **Certificate title:** `courseTitleSnapshot` copied from the enrollment's own `courseTitleSnapshot` at issuance (a chain of snapshots — course → enrollment → certificate — each layer frozen at its own creation moment, never re-reading the live course).
8. **Revoked state:** `learning.manage` only, mandatory `revokeReason`, fully audited; **permanently terminal** — a revoked certificate is never reactivated; a corrected/reissued credential requires a wholly new enrollment (Owner Decision 8) producing a wholly new certificate.
9. **"Expired" is never a stored `status` value** — every read path computes it live from `expiresAt < now()` (organization-local "now," per §25), avoiding any background job (Owner Decision 5).
10. **Relationship to file storage:** an optional single `employeeDocumentId` reference into the existing `employee_documents` table (§18) — not a join table, since a certificate has at most one attached file. V1 never generates a certificate PDF; the field exists only for an optionally HR-uploaded file.

### 10.5 Mandatory Enrollment Rules

Frozen, per Owner Decision 2:

- **A mandatory enrollment (`mandatoryAtAssignment = true`) can never be cancelled by the enrolled employee.** The employee's own `learning.write.own` cancel path structurally rejects it (`403`), regardless of `status`.
- **Only HR/L&D (`learning.manage`) may cancel or waive a mandatory enrollment**, and **only with a required, non-empty `cancelReason`** — enforced at the schema/validation level, not merely a UI convention (defense in depth, matching the platform's own established discipline for every other mandatory-reason field, e.g. Performance's `hrOverrideReason`).
- **An optional (non-mandatory) enrollment may be cancelled by the enrolled employee themselves**, but only while it is still `assigned` (not yet `in_progress`) — once training has genuinely started, cancellation becomes an HR/L&D action requiring a reason, identical to the mandatory case.
- **No historical completion or failure record is ever deleted, for a mandatory or optional enrollment.** Cancellation, waiver, and rejection are all status transitions on the existing row — never a `DELETE`. No `DELETE` route exists on `learning_enrollments` at all (§21).

### 10.6 Immutable Terminal Outcomes

Once an enrollment reaches `completed`, `failed`, or `cancelled`, its own outcome fields (`status`, `passed`, `score`, `attended`, `completedAt`) are permanently immutable — enforced at the service-layer function-signature level (every mutating function's own atomic `WHERE status = '<expected>'` clause structurally cannot match a row already in a terminal state). There is no reopen path anywhere in V1 (Owner Decision 8). A correction, or genuine retraining, always creates a **new** `learning_enrollments` row — the old row, and any certificate it produced, remain permanently, exactly as they were.

---

## 11. Goals / Assessment Model — Frozen

No dedicated "goals" concept exists in Learning (unlike Performance) — training assignment itself is the unit of tracking. Where a course is configured `hasAssessment` (`hasAssessmentSnapshot` on the enrollment, §9), completion requires an explicit result, frozen exactly as follows:

- **Result model:** a `passed` boolean, plus an optional free-form numeric `score` — not a letter grade, not a rubric, not multiple question-level scores.
- **Pass threshold: none exists.** `passed` is recorded **directly and independently** by the instructor of record or HR/L&D at completion time — it is never auto-derived from `score` against any stored or configured threshold. No `passThreshold`/`passingScore` field exists anywhere in this schema. This is a deliberate simplification: a numeric auto-threshold would require defining what `score` is even measured against (points out of what maximum? a percentage?) — a concept this plan has no frozen definition for, and inventing one would be exactly the kind of unjustified LMS machinery this document's own instructions warn against.
- **Snapshotting:** because no threshold exists, there is nothing to snapshot onto the enrollment beyond `hasAssessmentSnapshot` itself (already covered in §8.3/§9) — the assessment *requirement* is snapshotted; the assessment *result* is, by definition, always recorded fresh at completion time and was never a course-level property to begin with.
- **Who records it:** the instructor of record (a session's own `instructorEmployeeId`, `learning.review.write`) for instructor-led courses; HR/L&D (`learning.manage`) for self-paced courses with an assessment requirement, since no instructor-of-record relationship exists without a session (§10.3.1). **The employee never records their own `passed`/`score`**, even for their own self-paced enrollment — self-grading is structurally excluded from the employee's own `learning.write.own` completion path.

There is no question bank, no auto-grading, no partial credit, and no quiz/assessment-delivery infrastructure of any kind — this is a deliberate, minimal design matching "assessments... if justified" without building a quiz engine no roadmap item requires (§4).

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

## 21. API Plan — Frozen

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

## 22. Frontend Plan

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

## 29. Workstream Breakdown — Reconciled

Continuing numbering directly from W84 (Phase 3C's own completion report). Ten workstreams, matching Performance's own W73–W84 cadence and discipline exactly, including a dedicated final verification workstream (W93) and completion-report workstream (W94). **W85 remains the first implementation workstream and requires its own separate go-ahead even now that this document is frozen** — freezing this plan is not itself authorization to begin.

### W85 — Learning Foundation & Module Activation

- **Scope:** all 5 tables (§8) created via migration `0039`, RLS enabled inline with zero policies; 5 permissions seeded (§7) exactly onto `employee`/`hr_manager`/`org_admin`/`super_admin` per the frozen role mapping; module `learning` flipped `hidden`→`active` in the registry (available, not enabled for any organization); `lib/learningAuthorization.ts` (identity/relationship-resolution primitives, mirroring `lib/performanceAuthorization.ts`); new `training_category` Master Data domain (code-only registry addition, §8.6).
- **Schema impact:** all 5 tables created for the first time this workstream.
- **API impact:** none — no route exists yet.
- **Frontend impact:** none.
- **Definition of Done:** migration applied to development and verified live; exactly 5 permissions exist and match the frozen role matrix cell-for-cell; module status flip confirmed; `training_category` domain resolvable via the existing Master Data read path; foundation-level tests green; RLS re-confirmed (public table count moves from 79 to 84, all enabled, 0 disabled, 0 policies).
- **STOP boundary:** schema + auth primitives only. No route, no frontend. Do not begin W86 without its own separate go-ahead.

### W86 — Course Catalog & Sessions

- **Scope:** course CRUD (`draft`/`active`/`archived`, §10.1); session scheduling CRUD (§8.2, `scheduled`/`completed`/`cancelled`); HR/L&D administration only — no enrollment exists yet.
- **Schema impact:** none (tables already exist from W85).
- **API impact:** `GET/POST .../learning/courses`, `GET/PATCH .../learning/courses/:id`, `GET/POST .../learning/courses/:id/sessions`, `GET/PATCH .../learning/sessions/:id` (§21).
- **Frontend impact:** none yet (internal admin UI for these lands with W91, mirroring how Performance's W74 shipped scales/templates with no frontend, and W80 shipped the internal workspace later) — **or**, if the owning workstream judges a minimal admin CRUD UI belongs here instead, that is an implementation-time call within this workstream's own scope, not a deviation from this plan.
- **Definition of Done:** full CRUD tested (authorization, same-org validation for `courseId` on sessions, status-transition guards); OpenAPI + codegen regenerated, byte-identical across two runs; typecheck/build clean.
- **STOP boundary:** no enrollment logic of any kind. Do not begin W87 without its own separate go-ahead.

### W87 — Enrollment, Assignment & Approval

- **Scope:** bulk-assign (audience targeting via `all_active`/`department`/`position`/`manual`, reusing `resolveEligibleEmployees`'s exact logic, one atomic transaction per action, §14); employee self-enroll/request (§0's request→assigned mechanics); manager-assign; the full `approvalStatus` state machine (§10.3) including the frozen "HR-direct and manager-assigned bypass approval" and "employee can never approve their own request" rules (Owner Decision 1); session capacity enforcement (Owner Decision 6, atomic, `409` on a race); the mandatory-cancellation rules (§10.5).
- **Schema impact:** none (table exists from W85) — this workstream is the first to actually write `learning_enrollments` rows.
- **API impact:** `.../learning/courses/:id/assign`, `.../learning/courses/:id/enroll`, `.../learning/my-enrollments`, `.../learning/team-enrollments`, `.../learning/enrollments`, `.../learning/enrollments/:id`, `.../learning/enrollments/:id/approve`, `/reject`, `.../learning/enrollments/:id/cancel` (§21).
- **Frontend impact:** none yet.
- **Definition of Done:** every origin path (`hr_assigned`/`manager_assigned`/`employee_requested`) tested end to end including the approval bypass rules; the employee-cannot-approve-own-request guard tested explicitly; mandatory-vs-optional cancellation rules tested explicitly (including the reason-required path); capacity race tested under concurrency; all snapshot columns (§8.3/§9) verified populated correctly and immutable to later course edits.
- **STOP boundary:** no progress-marking, no attendance, no completion, no certificates. Do not begin W88 without its own separate go-ahead.

### W88 — Employee Self-Service Learning

- **Scope:** "My Learning" ESS tab (§15) — catalog browse (active courses only), self-enroll/request action, own enrollment list with status, own self-paced progress-marking (§10.3.1, `assigned`→`in_progress`→`completed`, never an assessment result), own certificates, own training history.
- **Schema impact:** none.
- **API impact:** `.../learning/enrollments/:id/progress` (PATCH, `learning.write.own`) added; every other route consumed here already exists from W87.
- **Frontend impact:** new "My Learning" ESS tab, module-gated independently within the existing ESS page (mirroring My Attendance/My Leave/My Performance).
- **Definition of Done:** RTL component tests plus live HTTP QA of the exact endpoints/payloads the tab sends; self-paced completion never accepts an assessment result from the employee's own path (tested explicitly); a disabled `learning` module degrades only this tab, confirmed by test.
- **STOP boundary:** employee-facing surface only. No manager/instructor UI, no HR administration UI. Do not begin W89 without its own separate go-ahead.

### W89 — Manager & Instructor Actions

- **Scope:** "My Team Training" (manager-of-record scope); attendance marking (§10.3, instructor-of-record or HR); completion/assessment-result marking for instructor-led courses (§10.3.1/§11, instructor-of-record or HR); manager approval decisions on direct reports' pending requests (Owner Decision 1).
- **Schema impact:** none.
- **API impact:** `.../learning/enrollments/:id/attendance`, `.../learning/enrollments/:id/complete` (§21); the approve/reject routes from W87 gain their manager-of-record dispatch path (employee-only access existed from W87; this workstream is the natural place the manager/instructor side is exercised live, though the routes themselves were already built).
- **Frontend impact:** "My Team Training" surface (new route or folded into an existing manager-facing page, an implementation-time call).
- **Definition of Done:** instructor-of-record vs. manager-of-record dual-tier dispatch tested explicitly (an employee who is both, tested independently on each relationship); self-paced-with-assessment routed correctly to HR-only (§11); every completion/attendance write is an atomic conditional update with a controlled `409` on repeat/concurrent attempts, tested under concurrency (mirroring W83A's own acknowledgement-race test precedent).
- **STOP boundary:** no certificate logic. Do not begin W90 without its own separate go-ahead.

### W90 — Certificates & Evidence

- **Scope:** certificate issuance exactly per §10.4's ten frozen rules (automatic, same-transaction-as-completion, snapshot-sourced eligibility, computed expiry, title snapshot); revoke action (`learning.manage`, mandatory reason); enrollment evidence attachments reusing `employee_documents`/`fileStorage` verbatim (§18), mirroring Performance's own W82.
- **Schema impact:** none (tables exist from W85).
- **API impact:** `.../learning/my-certificates`, `.../learning/certificates`, `.../learning/certificates/:id/revoke`, `.../learning/enrollments/:id/evidence` (GET/POST), `.../learning/enrollments/:id/evidence/:evidenceId/download` (§21).
- **Frontend impact:** certificate display on the ESS "My Learning" tab (from W88) and the internal workspace (landing with W91); evidence upload/list embedded in enrollment detail surfaces.
- **Definition of Done:** certificate issuance tested against every combination in §10.4's rule 2 (self-paced no-assessment, assessed+passed, assessed+failed-never-issues); expiry computed correctly and re-confirmed live-computed (never a stored `expired` value, no background job introduced); revoke tested as permanently terminal; evidence upload reuses the identical file-type/size/signature validation as Performance's own W82, confirmed by test, not merely assumed.
- **STOP boundary:** no dashboard, no reports. Do not begin W91 without its own separate go-ahead.

### W91 — Internal HR/L&D Workspace

- **Scope:** org-wide, paginated, filterable enrollment list (mirrors W80); course/session administration frontend (the UI counterpart to W86's own backend, if not already built there); org-wide approval queue and administrative correction actions surfaced in the UI.
- **Schema impact:** none.
- **API impact:** none new — consumes `.../learning/enrollments` (org-wide scope) already built in W87.
- **Frontend impact:** new `/learning-courses`, `/learning-sessions`/course-detail session management, `/learning-enrollments` routes.
- **Definition of Done:** pagination/filtering tested against the established `{items, total, page, pageSize}` convention; module-gated; no N+1 in the list query (batched, mirroring W80's own verified discipline).
- **STOP boundary:** no dashboard, no reports. Do not begin W92 without its own separate go-ahead.

### W92 — Dashboard & Reporting

- **Scope:** dashboard tile breakdown exactly per §16 (no invented rate/KPI tile); 3 report keys exactly per §17 (`learning_enrollment_status`, `learning_completion_summary`, `learning_certificate_expiry`) registered in the shared Reporting Foundation registry, executed through Learning's own dedicated visibility-scoped route; CSV export.
- **Schema impact:** none.
- **API impact:** `.../learning/dashboard`, `.../learning/reports/:reportKey` (§21).
- **Frontend impact:** `/learning` dashboard, `/learning-reports`.
- **Definition of Done:** every dashboard tile and report field cross-checked against §16/§17 with no undocumented addition; single-batched-query aggregation confirmed (no per-row loop); CSV export scope confirmed identical to the already-authorized JSON scope in every case.
- **STOP boundary:** this is the last feature-delivery workstream. Do not begin W93 without its own separate go-ahead.

### W93 — Phase 3D Verification

- **Scope:** full repo-wide verification pass against this frozen plan — functional, authorization, tenant isolation, historical integrity (every snapshot column re-verified immutable to a later course edit), scoring/assessment rules, security (RLS baseline re-confirmed), database (migration ledger, zero drift), data integrity, performance/N+1, API contract, frontend, live QA against the real development database. **Verification-only — no casual feature additions, no refactor of working code merely because another design may look cleaner**, identical to W71's and W83's own charter.
- **Schema impact:** none expected; any genuine, small, reproducible defect found is fixed with a permanent regression test (Category A, per the discipline established in W83); a substantial architectural defect is reported, not silently fixed (Category B).
- **API/Frontend impact:** none expected beyond a defect fix, if any.
- **Definition of Done:** matches W83's own template exactly — full regression suite, live E2E QA with disposable accounts (real routes only, no SQL-staged lifecycle statuses), tenant isolation matrix, security re-confirmation, exact state restoration after QA.
- **STOP boundary:** report PASS / PASS WITH FIXES / BLOCKED. Do not begin W94 without its own separate go-ahead, and do not silently turn this workstream into implementation.

### W94 — Phase 3D Completion Report

- **Scope:** formal closure — reconciliation of every workstream against this frozen plan, the shipped-capability record, database/permission/security/reporting state, known non-blocking items, production status, and the next undelivered roadmap item, mirroring the Phase 3A/3B/3C completion-report structure exactly (folded into `PROJECT_STATUS.md`, per established repository precedent).
- **Schema/API/Frontend impact:** none — documentation only, unless W93 left a small approved fix still pending, which W94 would then also record.
- **Definition of Done:** `PROJECT_STATUS.md` updated, Phase 3D marked complete only if every frozen requirement in this document is genuinely delivered; if a genuine gap is found at this stage, it is reported, not silently patched (mirroring W83/W83A's own precedent for Performance's acknowledgement gap).
- **STOP boundary:** this is the final Learning workstream. Do not begin the next roadmap module without its own separate planning/freeze cycle.

---

## 30. Definitions of Done

A Learning workstream is only complete when it includes: schema (where applicable) + migration + backend service/route + permission enforcement + validation + OpenAPI specification + regenerated API clients + frontend UI (where applicable) + organization isolation + audit logging where applicable + automated tests + this document updated to reflect what actually shipped — identical to `CLAUDE.md`'s own "Definition of Complete" and every prior phase's own discipline.

---

## 31. Production Rollout Boundary

Nothing in this document authorizes any production action. No migration, route, frontend page, permission seed, or module activation exists yet. Production rollout for Learning, once implemented, remains a separate, explicitly-gated decision requiring its own preflight, review, and approval — identical to every prior phase's own closing boundary.
