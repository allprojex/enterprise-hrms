# Ghana HR — Employee Lifecycle, Recruitment & Onboarding Reconciliation

Status: **DISCOVERY — OWNER REVIEW REQUIRED.** This document is documentation-only. No application code, schema, migration, or WWM configuration was changed to produce it. It is a read-only reconciliation of what already exists in this repository against the full Ghana employee lifecycle (manpower need → recruitment → onboarding → probation → confirmation → continuing employment → separation), plus a conservative summary of the external Ghana legal/regulatory and CIHRM professional-practice context. Findings were gathered by four parallel, independent, read-only investigation passes (recruitment pipeline; identity/PIF/numbering/statutory; onboarding/probation/cross-module identity; Ghana legal/CIHRM research) and reconciled against each other and against `PROJECT_STATUS.md`/frozen implementation plans before being written here.

## 1. Executive Summary

The platform already has a **large, largely-shipped Recruitment module** (requisitions → approval → vacancy → application → stage pipeline → interviews/scorecards → reference/background checks → offers → pre-employment requirements → a transactional employee-conversion handoff) and a **more substantial probation/confirmation mechanism than initially assumed** (`confirmEmployee()`, linked to a `probation`-typed Performance cycle). Employee identity is architecturally sound: `employees.id` is the single canonical anchor used by every downstream module (Attendance, Leave, Performance, Payroll, Assets, PIF, Office Inventory), with exactly one flagged exception (Office Inventory's polymorphic, non-FK-enforced `holderId`, already disclosed in that module's own documentation).

The genuine gaps are narrower and more specific than "recruitment/onboarding doesn't exist" — they cluster around four things: (1) **no candidate/application can be created without the vacancy being `published`** (even if only `visibility: internal`) — there is no HR-driven, portal-free manual entry path, which directly contradicts this task's "publication must not be required" requirement; (2) **offer acceptance/decline is entirely unimplemented** — the status enum has the values, no code path ever writes them, and hiring authorization does not check offer status at all; (3) **there is no onboarding checklist/workflow, induction/orientation, or handbook/policy-acknowledgement capability anywhere in the repository** — all three are genuinely absent, two of them explicitly descoped in writing by the Recruitment workstream's own closing notes; (4) **no document-generation capability exists anywhere in the codebase** — offer letters, confirmation letters, and any future handbook document would all need net-new infrastructure, not just wiring.

Everything else inspected is either COMPLETE, PARTIAL with disclosed boundaries, or CONFIGURATION-ONLY (deliberately generic, e.g. employee numbering, master data). Nothing found here justifies rebuilding an existing subsystem.

## 2. Repository Checkpoint

Reconciled directly, not assumed:

- `local main == origin/main` confirmed twice during this workstream. The task's stated expected checkpoint (`70a5766`) was correct at the start. **HEAD has since legitimately advanced by one commit, `41ff71b` ("fix(hrms): gate HR-only controls on Employees/Branches/Departments/Positions")**, from another authorized, concurrently-running session on this same repository — an unrelated frontend permission-gating fix, not touching Recruitment, Onboarding, Probation, or any table/route this document discusses. Per instruction, this is reported and reconciled, not reset. Current checkpoint used for this discovery: **`41ff71b`**, confirmed `local main == origin/main` at time of writing.
- Working tree at time of writing: one pre-existing, unrelated modified file (`artifacts/mockup-sandbox/src/.generated/mockup-components.ts`, a line-ending-only diff present since before this session) and a set of pre-existing untracked items (`.agents/skills/`, `.claude/`, `CLAUDE.md`, `CONTRIBUTING.md`, `artifacts/api-server/uploads/`, `skills-lock.json`) — none created by this workstream, none touched.
- Migration ledger: unaffected by this discovery pass (documentation-only); last confirmed at `0055` in the prior W12 addendum, and this workstream created no migration.
- No schema drift introduced — zero schema/code changes made.
- `ROADMAP.md`/`MODULES.md` checked for contradiction with this document's findings: neither carries a "Complete" annotation for Recruitment or Onboarding (both are listed only as plain roadmap/module category items — `ROADMAP.md` line 43, `MODULES.md` lines 17/28), so nothing here required correction. Left untouched per the task's conservative instruction.

## 3. Ghana Legal/Regulatory Sources Reviewed

External research was performed live (web search/fetch) and is reported here conservatively — several claims could not be verified against primary statutory text this session (Ghana Government's own Act 651 PDF and a secondary mirror both failed to render as parseable text) and are flagged as such rather than asserted as fact.

**Ghana Labour Act, 2003 (Act 651)** — reviewed via secondary summaries (primary PDF unreadable this session, see below):
- **(A) Written particulars of employment**: a written contract is required for engagements of 6+ months; separately, a written statement of main terms (per Schedule I), signed by both parties, must be furnished **within two months of commencement** (§§12–13, 74–75, Schedule I — cited by wageindicator.org, not independently confirmed against primary text).
- **(A) Probation**: not mandatory. Where used, the Act's own language (as reported) requires only that a probationary/qualifying period be of "reasonable duration determined in advance" (§66(b), §98(d); Labour Regulations 2007, LI 1833, Reg. 5). **No specific numeric maximum-duration limit could be verified from primary text.** Some secondary/EOR-marketing sources assert "maximum six months" — this figure is **not corroborated** by the more careful source reviewed and **must not be treated as confirmed statutory fact**.
- **(A) Notice periods** (§17(1)): 3+ year contracts — one month's notice or pay in lieu; under 3 years — two weeks; week-to-week — seven days. A distinct, separate probation-specific notice figure was not confirmed.
- **(A, scope-limited) Records**: §27 requires an employer to keep a record of each worker's date of employment, annual-leave entitlement, dates leave was taken, and remuneration paid for that leave. This is a **leave-specific** record requirement — no broader general personnel-file/records mandate was found in the sources reviewed.
- Primary source attempted: `gipc.gov.gh/.../LABOUR-ACT-2003-ACT-651.pdf` and `ecoi.net/.../labour-act.pdf` — both returned unparseable binary to the tooling available this session; findings above rest on secondary summaries (`wageindicator.org`, `nlcghana.com`) cross-checked against each other, not on a directly-read primary text.

**CIHRM Ghana, established under Act 1020** — reviewed directly on `cihrmghana.org` plus reporting from `gna.org.gh`:
- **(A)** CIHRM is Ghana's statutory HR-practice regulatory body: certifies/registers HR practitioners, sets/enforces professional standards, conducts examinations, maintains a practitioner register.
- **(A/B, partially confirmed)** Confirmed directly on CIHRM's own site as named curriculum items: "Recruitment and Compensation Management," "Human Resource Development," "Industrial Relations," "Legal Aspects of Human Resource Management." The remaining items in the task's requested 11-item list (Recruitment & Selection as distinct from Compensation, HR Policy & Procedure, Performance Management, Employee Relations, HR Governance & Compliance, HR Administration, HR Technology) were **not independently re-confirmed** on CIHRM's own site this session (a dedicated CHRP curriculum page returned 404) — treat the full 11-item list as plausible but not directly re-sourced here.

**SSNIT** — reviewed via SSNIT's own published content (direct `WebFetch` against `ssnit.org.gh` failed with a tooling-level header error — the identical failure this repository's own `docs/PAYROLL_IMPLEMENTATION_PLAN.md`/`docs/PAYROLL_DISCOVERY_REPORT.md` already documented and worked around the same way, via search-recovered site text):
- **(A)** Employers must register with SSNIT (Employer Registration Number); each employee must independently obtain their own SSNIT number (linked to Ghana Card) — **contributions cannot be filed for an employee without one**.
- **(A)** Total mandatory contribution: 18.5% of basic salary (5.5% employee-withheld + 13% employer-paid), split 13.5% Tier 1 (SSNIT) / 5% Tier 2 (private trustee), remitted within 14 days of month-end.
- **(A)** Insurable-earnings ceiling revised periodically under the National Pensions Act, 2008 (Act 766) §63(3) — SSNIT's own 2026 Public Notice PDF confirms GHS 69,000 maximum / GHS 587.79 minimum, consistent with (and now primary-source-confirmed for) the figure already recorded in this repo's `docs/PAYROLL_IMPLEMENTATION_PLAN.md`.

**Data Protection Act, 2012 (Act 843)** — reviewed at a general level only (secondary summary, `itlawco.com`): governs personal-data processing, defines a "sensitive personal data" category requiring explicit consent or another specific legal basis. The Act's exact statutory definition and any recruitment-specific clause (background checks, medical/fitness data, national ID) were **not independently verified** this session — noted as a general compliance consideration for §9/§19 below, not a confirmed specific requirement.

**Pre-existing repo citations found**: none for Labour Act/CIHRM/Data Protection Act before this document. `docs/PAYROLL_IMPLEMENTATION_PLAN.md`/`docs/PAYROLL_DISCOVERY_REPORT.md` already cite GRA, SSNIT, NPRA, Income Tax Act 2015 (Act 896), and National Pensions Act 2008 (Act 766) §63(3) for payroll-statutory purposes — this document's SSNIT/pensions figures are consistent with, not contradictory to, that existing citation.

**Full source list**:
- `wageindicator.org/en-gh/work-in-ghana/labour-law/contracts-and-dismissals/` — probation/written-particulars language, section citations
- `nlcghana.com/termination-of-employment-under-the-labour-act2003-act-651/` — §17(1) notice periods
- `cihrmghana.org/act_1020-banner/`, `gna.org.gh/2025/12/cihrm-to-enforce-act-1020-to-streamline-hr-practice-ceo/` — CIHRM role/functions
- `cihrmghana.org` — confirmed curriculum items
- `ssnit.org.gh/become-a-member/` — employer/employee registration requirements
- `ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf` — 2026 insurable-earnings ceiling
- `itlawco.com/focus-areas/data-protection-and-privacy/ghanas-data-protection-act-2012-act-843/` — Act 843 general summary
- Attempted, unreadable: `gipc.gov.gh/wp-content/uploads/2023/05/LABOUR-ACT-2003-ACT-651.pdf`, `ecoi.net/en/file/local/1201125/1504_1217427124_labour-act.pdf`

**Not independently verified — do not treat as confirmed**: any specific numeric probation-duration limit under Act 651; a probation-specific statutory notice figure distinct from §17's general figures; the complete 11-item CIHRM practice-area list verbatim; Act 843's exact "sensitive personal data" definition and any recruitment-specific clause.

## 4. CIHRM Professional-Practice Alignment

Framed explicitly as **(B) professional practice guidance, not law**:
- **Recruitment & Selection**: good practice is a structured, job-related process — job analysis → sourcing → consistent structured interviewing/assessment → reference/background checks → documented decision — aimed at fairness, consistency, and defensibility. The platform's stage-based pipeline with immutable `application_stage_history` and lockable, per-interviewer `interview_scorecards` (§7 below) already substantially supports this practice, independent of any specific legal mandate.
- **HR Administration**: good practice is accurate, complete, confidentially-held employee records and timely, correct processing of employment transactions with audit-ready documentation. The platform's PIF/personnel-file custody model, `employee_number_allocations` history ledger, and `employment_periods` append-only event log (§§10–12, 21–22 below) already substantially support this practice.

No CIHRM requirement inspected during this discovery is currently unmet by the platform in a way that would constitute a compliance gap — CIHRM sets professional-practitioner standards, not a system-conformance checklist; the platform's role is to make good practice *possible* for an organization's own HR professionals, which the architecture described below generally does.

## 5. Existing Recruitment Architecture

Source of truth: `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` (frozen, W43–W63); `PROJECT_STATUS.md` lines ~1549–1730 (Phase 3A Completion Report); live schema/route/page inspection.

**Manpower/staffing need — COMPLETE.** `lib/db/src/schema/job-requisitions.ts`: `requisitionType` enum (`new_role`/`replacement`/`temporary`/`internship`/`volunteer`/`contract`/`ministry`), `requestedHeadcount`, `filledCount`, `departmentId`/`branchId`/`positionId`, `hiringManagerEmployeeId`/`recruiterEmployeeId`, `salaryRangeMin/Max/Currency`, `justification`, `replacementEmployeeId` (required only when type=replacement). Route: `artifacts/api-server/src/routes/jobRequisitions.ts`.

**Recruitment authorization — PARTIAL.** `requisition-approvals.ts`: a single required decision step (`sequence` is always 1 in practice; multi-step chaining is not implemented despite the column existing), `decision` (pending/approved/rejected), full decision history (`decidedAt`, `comment`). Approver is resolved at decision time as any org-wide `requisition.approve`-permission holder — **not** a pre-assigned or per-department-configurable chain. Do not assume Department Head approval is wired in here; it is not — this is a flat, permission-gated, single-step model with real audit history, and `requisition_approvals`'s own schema comment states "no delegated-approver configuration exists yet."

**Recruitment settings — CONFIGURATION-ONLY.** `recruitment_settings`, `recruitment_workflows`, `recruitment_stages` exist as the org-configurable substrate (stage names/order per organization, workflow templates) underneath the fixed system `category` enum (`applied`/`screening`/`interview`/`assessment`/`offer`/`hired`/`rejected`/`withdrawn`) that downstream logic (conversion eligibility, etc.) keys off.

## 6. Existing Candidate Model

**Vacancy/position — COMPLETE, but publication is architecturally required.** `vacancies.ts` carries description/requirements/responsibilities/preferred-qualifications, employment & workplace type, openings, open/close dates; `vacancy_locations.ts` for multi-location postings; salary context flows from the linked requisition. **Critical finding**: verified directly in `artifacts/api-server/src/lib/publicCareers.ts` and `artifacts/api-server/src/lib/employeeInternalApplications.ts` (line ~137) — both the public-apply path and the internal-ESS-apply path gate on `vacancy.status === "published"`. A vacancy can be `visibility: "internal"` (never listed externally) and still satisfy this — full public exposure is not required — but **publication itself is**. There is no route to create a candidate/application against a draft/unpublished vacancy, and no HR-driven manual-entry path exists at all: `artifacts/api-server/src/routes/candidates.ts` has no POST/PATCH (GET, notes, tags only); `applications.ts` has no POST (move-stage/reject/withdraw/reopen/scores on existing rows only). `candidates.ts`'s own schema comment states "every candidate row is created through the public careers apply endpoint." **This directly contradicts the "publication must not be required" requirement for this task's target design** — see Genuine Gap #1 (§27).

**Candidate sourcing — CONFIGURATION-ONLY BY DESIGN, EFFECTIVELY MISSING IN PRACTICE.** `candidates.source`/`applications.source` are plain nullable `text` columns (not Master-Data-linked, not enum) — architecturally capable of holding any value, but in practice only two literal values are ever written anywhere in the code: `"careers_portal"` (public path default) and `"internal_ess"` (internal-ESS path). No referral/walk-in/agency/campus/physical-announcement/direct-sourcing capture path or UI exists anywhere. This contradicts the frozen plan's own §9 design intent ("source (Master Data code)").

**Candidate/application capture — PARTIAL, contingent on the publication gate above.** Fields once an application exists: name/email/phone/address(jsonb)/nationality/work-authorization-status/national-identifier(type+value)/experience-summary/education-summary(jsonb)/skills/languages, `candidate_documents` (CV etc.), `submittedAt`. Duplicate handling: `candidates_org_email_unique` on `lower(email)` per organization — idempotent (returns the existing row), not fuzzy/cross-field dedup.

## 7. Existing Interview Architecture

**PARTIAL — scheduling and per-interviewer scorecards are solid; no numeric consolidation, no external-panelist submission route despite reserved columns.**

- `interviews`: `applicationId`, `interviewType` (phone/virtual/in_person), `scheduledAt`, `durationMinutes`, `location`, `meetingLink`, `status` (scheduled/completed/cancelled/no_show — no-show is a first-class status), `outcome` (free-text summary only, no score field). Multiple rounds are supported by simply creating multiple `interviews` rows per application. Rescheduling is modeled as cancel-old + create-new (full immutable history), not an in-place edit.
- `interview_panel_members`: `interviewerMembershipId` (nullable, for an external interviewer), `externalInterviewerName`/`Email`, `role` (lead/member), self-declared `conflictDeclared` boolean (no automated conflict detection).
- `interview_scorecards`: one per panel member per interview, `recommendation` (strong_yes/yes/no/strong_no), `overallComment`, a draft → submitted → finalized lock (`submittedAt`/`finalizedAt`). Confirmed via route permission gating that submitting one's own scorecard does not imply the ability to read others' — a deliberate bias-prevention design.
- `interview_scorecard_responses`: `criterion` (free text, not an org-defined assessment-template reference), `rating` (unconstrained integer), `comment`.
- No numeric consolidated/weighted rollup across panel members exists. `externalInterviewerToken`-style reserved columns exist but no route lets an external (non-membership) panelist submit their own scorecard — that capability is reserved, not built.

## 8. Existing Selection/Hiring Approval

**Selection — CONFIGURATION-ONLY (implicit).** No dedicated "selection" or "recommendation" entity exists. "Selected" is realized purely as an application whose current stage maps to a `hired`-category stage in the org's configured pipeline. No competing-candidates comparison feature exists; rejection reasons for non-selected candidates use `applications.rejectionReasonCode`.

**Approval to hire — PARTIAL, and "selected" ≠ "authorized to employ" is conflated into one gate.** Verified directly in `artifacts/api-server/src/lib/employeeConversion.ts`: eligibility to convert an application into an employee requires only (a) the current stage's `category === "hired"` and (b) every non-waived `pre_employment_requirements` row is `satisfied`/`waived`. The code's own comment states an offer's status is used only as an optional data source, never a gating condition. **Offer approval (`offer_approvals`) and employee-creation authorization are not wired together at all** — an application can be converted to an employee whether or not any offer was ever issued, approved, or accepted. See Genuine Gap #2 (§27).

## 9. Existing Offer/Appointment Model

**PARTIAL — rich structured versioning and approval; no document generation, no branding, no signatory, no probation/notice/leave/working-hours particulars.**

`offers` (one-per-application envelope, pointing at `currentVersionId`) / `offer_versions` (immutable per revision): `proposedStartDate`, `employmentType`, `workplaceType` (onsite/remote/hybrid), `location`, `compensationSummary` (free-form jsonb, deliberately no Payroll FK), `conditions` (free text), `expiryDate`, and a real approval-gated status lifecycle (draft → pending_approval → approved → issued → accepted/declined/expired/withdrawn/superseded — **but see §13 below, the terminal statuses are unreachable**). `letterTemplateId`/`generatedDocumentStorageKey` columns exist but are reserved and unpopulated — confirmed no PDF/document-rendering library or template-rendering engine exists anywhere in `artifacts/api-server/src`. No branding integration, no authorized-signatory field, no structured probation-terms/notice/working-hours/leave-entitlement particulars anywhere on the offer. `offer_approvals` mirrors `requisition_approvals`'s single-step, org-wide-approver, full-history model (§5).

**Cross-check against Ghana Labour Act (§3):** the Act's written-particulars requirement (Schedule I items, furnished within two months of commencement) is broader than what `offer_versions` structurally captures today — an organization relying solely on this system's offer data would not have a structured record of probation terms, notice, or leave entitlement at offer stage; these would need to be added to the offer/appointment model or captured elsewhere (employment contract) to fully support Schedule I compliance. This is a genuine, disclosed gap, not an assumption — see §27.

## 10. Existing Candidate-to-Employee Conversion

**COMPLETE and structurally sound — single authoritative path, DB-enforced no-duplication guarantee.**

`artifacts/api-server/src/lib/employeeConversion.ts` never inserts into `employees` directly — it calls the exact same `createEmployee()` function `routes/employees.ts`'s ordinary manual "create employee" POST handler uses. There is exactly one employee-creation code path in the entire system. `candidate_employee_links` (`organizationId`, `candidateId`, `applicationId`, `employeeId`, `convertedAt`, `convertedByMembershipId`) carries **two DB-level unique indexes** — on `applicationId` and on `employeeId` — closing both duplicate-conversion directions; violations are caught and translated to a typed `AlreadyConvertedError`, matching this codebase's established catch-the-race discipline. A repeat application from an already-converted candidate reuses the existing `employeeId` (via `candidates.linkedInternalEmployeeId`) rather than creating a second employee record. Everything downstream keys off `employeeId` only.

**Organizational placement at conversion — PRE-FILLED, not re-entered.** `employeeConversion.ts` resolves `departmentId`/`branchId`/`positionId` from the linked requisition (via the application → vacancy → requisition chain) and `employmentType`/`hireDate`/`workLocation` from the current offer version, mapping them straight into `createEmployee()`. **One gap**: `reportingManagerId` is not part of this mapping — no requisition/offer field carries an intended reporting manager, so it must be set as a separate post-conversion employee update. See §27.

## 11. Existing Employee Numbering

**COMPLETE — single generic, organization-configurable engine, correctly reused (not duplicated) across modules.**

`numbering_sequences` is a generic `(organizationId, sequenceKey, periodKey) → currentValue` counter, with `sequenceKey` deliberately free text so new consumers (employee numbers, PIF numbers, Office Inventory item/receipt codes) never require a schema change. Concurrency-safe (`SELECT ... FOR UPDATE`, increment committed independently of the caller's transaction). Format is configured per-organization via the existing generic `organization_settings` JSON-config-namespace mechanism (`numbering` namespace, `employeeNumber` key: prefix/suffix/separator/sequenceLength/startingSequence/branch-department-year-month tokens/reset policy/reuse-enabled). `employee_number_allocations` is the authoritative historical-allocation ledger; `employees.employeeNumber` is explicitly documented as only a denormalized current-value cache — the generic PATCH route no longer even accepts writes to it directly. **Any future onboarding/Recruitment work must call into this existing engine, never build a second numbering mechanism.**

## 12. Existing PIF/Personnel File

**COMPLETE — physical file/custody tracking only, zero overlap with `employees`' own personal-data columns.**

`personnel_files` (1:1 with employee, `pifNumber` via the numbering engine above, `allocationMethod` generated/manual — **never "reused"**, unlike staff numbers), `personnel_file_volumes` (physical binder/volume tracking), `personnel_file_movements` (append-only checkout/return/missing/recovered log with purpose/destination/expected-return-date — overdue is always derived live, never stored), `records_locations` (self-referencing physical-location hierarchy, org-defined). None of these tables carry any personal-detail field — no address, ID number, contact info — so there is no duplication risk against `employees`' own digital personal-data columns. Already demonstrated in practice for WWM via `docs/WWM_PRESENTATION_DEMO_DATA.md` (a PIF number, a records location, and one checkout/return cycle).

## 13. Existing Employee Documents

**PARTIAL/MISSING for a required-document checklist — currently a flat, generic upload list only.**

`employee_documents` full schema: `id`, `organizationId`, `employeeId` (nullable, can also attach to org-owned non-employee documents), `categoryCode` (free-text Master Data domain code, unvalidated against the domain's actual item list), `fileName`, `storageKey`, `mimeType`, `fileSize`, `uploadedBy`, `createdAt`. Confirmed by full-file search: **zero** required/optional flag, submitted/verified/rejected status, verifier field, expiry field, re-upload-requested state, or "documents complete" signal anywhere. Re-uploading creates a new row rather than versioning the old one (explicit schema comment). There is no concept anywhere of an organization-defined *required onboarding document set* being tracked to completion — this would need net-new work (a required-document-types config plus status/verifier columns, or a new table), not a repurposing of what exists. See §27.

## 14. Existing Statutory/SSNIT Handling

**COMPLETE and fully owned by Payroll — narrow-permission-gated, audited-on-read, but not field-masked.**

`employee_statutory_identifiers`: `ssnitNumber`, `tin`, effective-dated (`validFrom`/`validTo`, partial-unique on one open row per employee) — correction is close-old/open-new, not an in-place edit, and there is deliberately no "registration required/status/date-registered" workflow field, only the current identifier value. `employee_banking_details` follows the identical effective-dated pattern. Both tables are deliberately kept off the core `employees` table by design. Access is gated by narrow, Payroll-exclusive permissions (`payroll.statutory_identifiers.*`, `payroll.banking.*`) that no role — including `hr_manager` — receives by default; the module itself remains `status: hidden`/`defaultEnabled: false`. Every read is explicitly audit-logged (a deliberate exception to the platform's general read-silence convention). **Flag**: no field-level masking/redaction exists — a permission-holder's GET returns the full SSNIT/TIN/account-number value; protection is entirely permission-gating plus audit trail, not display-time masking. Worth a security-review note given Data Protection Act implications (§3), not a required change for this discovery.

**Boundary for any future onboarding workflow**: SSNIT/TIN capture must continue to be referenced only through Payroll's own existing routes/permissions — never duplicated onto `employees`, `employee_documents`, or a new onboarding table.

## 15. Existing Handbook/Policy Acknowledgement

**MISSING — confirmed by thorough search, not assumed.** Grepped `lib/db/src/schema` (all files), `artifacts/api-server/src`, `docs/` for "handbook", "policy", "acknowledg". Zero "handbook" hits anywhere in the repository. "Acknowledg*" hits exist only in `asset-assignments.ts` (an employee acknowledging *asset receipt*) and `performance-reviews.ts` (acknowledging a *performance review*) — neither is a handbook/policy concept. Genuinely absent, with no adjacent partial mechanism to extend.

## 16. Existing Job Description Handling

**CONFIGURATION-ONLY / structurally located differently than assumed.** `positions.ts` (the enduring organizational position record) has **no description field at all** — columns are only `id`, `organizationId`, `title`, `departmentId`, `status`, timestamps. Job description content instead lives on the transient recruitment side: `vacancies.jobDescription`/`responsibilities`/`requirements`/`preferredQualifications`, all plain nullable text, no versioning, no acknowledgement mechanism. Practical effect: once a vacancy closes, an organization's permanent position record carries zero job-description content — there is nothing for a later employee in that same position to reference or acknowledge.

## 17. Existing Induction/Orientation

**MISSING — confirmed and explicitly, deliberately descoped in writing.** Grepped "induction"/"orientation" across schema, routes, frontend, docs — zero genuine hits (only unrelated CSS-prop matches in UI components). `PROJECT_STATUS.md` contains two direct disclosures that this was never built by design: the W59 (Employee Conversion) closing note and the W58 (Pre-Employment Requirements) closing note both explicitly list "orientation" among items the frozen scope does **not** implement, alongside onboarding, asset assignment, training, and probation-at-that-time. This is documented deliberate deferral, not an oversight.

## 18. Existing ESS Activation

**COMPLETE as a mechanism; no onboarding-completion gate exists (by design, not oversight).** `POST /organizations/:id/invitations` → `GET /invitations/:token` → `POST /invitations/:token/accept` — the same mechanism already proven for WWM's presentation accounts (explicitly corroborated in `PROJECT_STATUS.md`: "invitations/accept-invitation, never a raw password write"). `employee_user_links` bridges an `employees` row to a `users` row via an `organization_memberships` row; its own schema comment states the link row is metadata only — access always flows through the membership. The moment a membership is active and the link exists, every `resolveOwnEmployeeId`-based ESS route (leave, attendance, My Documents, profile, payslips if enabled) becomes reachable — gated only by module enablement and role, **never** by any onboarding-completion signal, because no such signal exists anywhere in the platform (see §20).

## 19. Existing Assets/Inventory Integration

**CONFIRMED SEPARATE, as required.** No onboarding-checklist/workflow table exists (§20), so by definition nothing today tracks "laptop assigned" or "ID card issued" as an onboarding-workflow item. `asset_assignments.employeeId` (Assets) and `office_inventory_stock_movements.holderId` (Office Inventory, polymorphic — see §23) are standalone custody records tied directly to employee identity, with zero cross-reference to any onboarding concept in either module. This is the correct, already-established boundary (per Office Inventory's own frozen "Inventory/Assets boundary" documentation) and must not be merged.

## 20. Existing Onboarding Workflow/Checklist

**MISSING — confirmed by a full schema listing (~110 files in `lib/db/src/schema/`), not an assumption.** No `onboarding_checklist`, `onboarding_task`, `induction`, or equivalent table exists. A repository-wide case-insensitive grep for "onboarding" surfaces only unrelated usages: `lib/onboarding.ts`/`onboardOrganization()` (multi-tenant **organization** creation, unrelated to employee lifecycle — see also `docs/WWM_ORGANIZATION_SETUP.md`'s own discussion of this exact function), `membership.ts`'s "invitation-first onboarding" comment (referring to admin-user invitation, not employee onboarding), and one example workflow-name string in `recruitment-workflows.ts` ("Volunteer Onboarding," a label, not a feature). No configurable task/checklist engine (required/optional, responsible role, due date, dependency, evidence, waiver, overdue, progress) exists anywhere in this platform today.

## 21. Existing Probation Architecture

**PARTIAL — materially more built than the task's own premise assumed; tightly and deliberately bounded.**

`employees.probationEndDate` and `employmentStatus` (enum: active/probation/on_leave/suspended/terminated) are real columns, but `artifacts/api-server/src/lib/employees.ts` also contains a full `confirmEmployee()` function (Phase 2A W27, extended Phase 3H W117 per the frozen plan's own Decision 13), which: transitions `employmentStatus: probation → active` as an audited, permission-gated (`employee.write`, no new permission), dated action; records the transition as a **distinct event** (`eventType: "confirmation"`) in the append-only `employment_periods` log, not merely an enum flip; and optionally accepts and validates a `probationReviewId` referencing a real `performance_reviews` row belonging to a `performance_cycles` row with `cycleType='probation'` (throwing a typed error on mismatch).

**Explicitly and deliberately absent** (per the frozen plan's own Decision 13 text): a probation-required flag or duration-derivation logic (`probationEndDate` is simply a settable field, no rule engine behind it); a dedicated extension mechanism/event ("the existing `probationEndDate` field can simply be updated... a probation-extension event is not a new concept this phase introduces" — the frozen plan's own words); a "rejected"/unsuccessful-outcome state (the shape is deliberately binary confirm-or-don't); reminders/overdue detection (no scheduler/notification reference found anywhere `probationEndDate` is used); letters/documents (see §9 — no document generation exists at all in this repository); a dedicated new permission (reuses `employee.write` and Performance's existing review-write authority).

Do not build a second probation mechanism — `confirmEmployee()` and its `employment_periods` audit trail are the correct extension point for anything future work adds (e.g., reminders, extension-as-a-distinct-event, a rejected/unsuccessful outcome).

## 22. Existing Probation Review/Confirmation

**Linked by design to Performance, not merged into a second engine.** `performance-cycles.ts` defines a `cycleType` enum value `"probation"`; `lib/performanceCycles.ts` (~line 414–428) has one narrow, disclosed eligibility branch: manual review assignment on a `cycleType='probation'` cycle is the *only* path where an employee with `employmentStatus='probation'` (rather than `'active'`) is assignable to a review at all. `confirmEmployee()`'s optional `probationReviewId` cross-references this. No probation-specific review engine, template, or rating scale was built — probation review fully reuses Performance's existing lifecycle, confirmed in `PROJECT_STATUS.md`'s own module-impact table ("One narrow, disclosed, additive eligibility branch scoped exclusively to `cycleType='probation'` assignment — every other cycle type, scope, and eligibility path is byte-for-byte unchanged").

**Confirmation as a distinct decision — CONFIRMED.** Not merely `employmentStatus='active'`: it is a separately recorded `employment_periods` event with its own `eventType`, optionally cross-linked to the review that justified it.

**Document generation — MISSING, repository-wide, not specific to confirmation.** Searched the full repository for "confirmation letter," "appointment letter," "offer letter," "document generation," "PDF." The only trace found is `offers.letterTemplateId`/`generatedDocumentStorageKey` — reserved, unpopulated columns with no template table and no rendering engine behind them (`generatedDocumentStorageKey` is even actively stripped from every API response). **This repository has zero document-generation capability for any purpose today.** Any future confirmation letter, offer letter, or handbook document requires net-new infrastructure (a PDF/HTML-template renderer), not just wiring an existing mechanism.

## 23. Cross-Module Identity Audit

Traced: Candidate → Selected Candidate → Employee → ESS User → Personnel File → Attendance → Leave → Performance → Probation → Payroll → Assets → Office Inventory → Separation.

| Stage | Table.column | Canonical anchor | FK-enforced to `employees.id`? |
|---|---|---|---|
| Candidate | `candidates.id` | own identity | — |
| Selected/converted | `candidate_employee_links.candidateId`/`.applicationId`/`.employeeId` | provenance link only, DB-unique both directions | yes (`employeeId`) |
| **Employee (canonical from here on)** | `employees.id` | **the one stable identity** | — |
| ESS User | `employee_user_links.employeeId` | | yes |
| Personnel File | `personnel_files.employeeId` | | yes |
| Attendance | `attendance_events.employeeId` | | yes |
| Leave | `leave_requests.employeeId` | | yes |
| Performance (incl. probation review) | `performance_reviews.employeeId` | explicitly disclosed as a *live* reference, not a snapshot | yes |
| Probation/confirmation event | `employment_periods.employeeId` | append-only log | yes |
| Payroll | `employee_compensation_components.employeeId` | schema comment explicitly rules out staff/PIF number as the join key | yes |
| Assets | `asset_assignments.employeeId` | comment: "a LIVE reference" | yes |
| Office Inventory | `office_inventory_stock_movements.holderId` | **polymorphic** — `employeeId` or `departmentId`, selected by a companion `holderType` enum | **no — disclosed, intentional application-layer-only invariant, no DB FK to either table** |
| Separation | `employee_exit_processes.employeeId` | correct downstream terminus | yes |

**`employees.employeeNumber` (staff number) is never used as a join key anywhere checked** — every module's schema explicitly ties to `employees.id`, and Payroll's own schema comment goes out of its way to rule out staff-number-as-join-key. The "staff-number reuse must never reassign historical identity/custody" invariant is independently stated as an established, twice-proven platform precedent in three separate places: `docs/PAYROLL_DISCOVERY_REPORT.md`, `docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md`, and `docs/PHASE_3H_HR_OPERATIONS_PERSONNEL_RECORDS_IMPLEMENTATION_PLAN.md`.

**Disconnection risks found**, all disclosed rather than hidden:
1. **No onboarding/induction/handbook stage exists between "employee created" and "ESS active"** — ESS activates the instant a link row exists, with no completion gate (because no completion concept exists at all — see §20).
2. **`reportingManagerId` is not carried through the offer→conversion pipeline** and must be set manually after conversion (§10).
3. **Office Inventory's `holderId` is the sole non-FK-enforced identity link** in the entire traced chain — a pre-existing, already-disclosed application-layer-only invariant (paired `holderType`), not something this discovery is newly flagging as a surprise, but worth carrying into any future cross-module reliability review.

## 24. Ghana Compliance Matrix

| Requirement | Source/authority | Current implementation | Legal/statutory? | CIHRM practice? | Org-configurable? | Gap? | Recommendation |
|---|---|---|---|---|---|---|---|
| Written statement of main employment terms within 2 months (Schedule I) | Act 651 §§12–13, 74–75 (secondary-sourced) | `offer_versions` captures some terms (start date, employment type, workplace type, compensation, conditions); no structured probation/notice/leave-entitlement fields; no document generation | Legal (A) | — | Content should be configurable per org | **Yes — PARTIAL** | REQUIRED FOR GHANA COMPLIANCE (structured particulars); OPTIONAL PRODUCT ENHANCEMENT (document generation itself) |
| Probation "reasonable duration determined in advance" | Act 651 §66(b)/§98(d) (secondary-sourced, no numeric limit verifiable) | `employees.probationEndDate` freely settable, no rule/derivation engine, no organization-level default-duration config | Legal (A), duration unspecified | — | Should be organization-configurable | PARTIAL (field exists, no configured-default/derivation) | ORGANIZATION POLICY / CONFIGURATION (do not hard-code a duration — see §3's own caution) |
| Employer notice periods (§17(1)) | Act 651 §17(1) | Not modeled as structured data anywhere found in Recruitment/Onboarding/Employee schema | Legal (A) | — | Values are statutory, application (e.g. offer letter) should surface them | MISSING as structured data | REQUIRED FOR GHANA COMPLIANCE if/when offer/contract particulars are formalized |
| Leave record-keeping (date employed, leave entitlement/taken/paid) | Act 651 §27 | Leave module (`leave_requests`, `leave_balance_entries`) already tracks this independently of this discovery's scope | Legal (A) | — | N/A | No gap found (outside this discovery's direct scope; noted as already satisfied elsewhere) | — |
| SSNIT employer/employee registration, contribution, 14-day remittance | SSNIT public guidance; National Pensions Act 2008 (Act 766) §63(3) | Fully owned by Payroll (`employee_statutory_identifiers`, module-gated, hidden by default) | Legal (A) | — | N/A (statutory mechanics) | No gap — correctly scoped to Payroll, must not be duplicated | Reference only, never duplicate |
| Structured recruitment/selection process (job analysis → sourcing → structured assessment → checks → documented decision) | CIHRM practice guidance | Requisition → stage pipeline → scorecards → checks → offer, all present with real audit history | — | CIHRM (B) | Yes — stages/workflows are org-configurable | No material gap | RECOMMENDED HR PRACTICE, already substantially supported |
| Candidate sourcing must not require public advertisement | This task's own explicit requirement, consistent with general good practice, not itself a cited statute | Architecturally requires `vacancy.status='published'` (even if internal-only) for any application to exist; no HR-manual-entry path | — | — | Should be fully org-configurable/source-agnostic | **Yes — genuine platform gap** | REQUIRED FOR THIS TASK'S STATED DESIGN GOAL (not a Ghana legal requirement, but an explicit product requirement) |
| Sensitive data handling for background/medical checks | Data Protection Act 2012 (Act 843), general (secondary-sourced, specifics unverified) | `background_checks`/`reference_checks` exist with coarse status/notes controls; no field-level masking anywhere sensitive statutory data is stored (also true of Payroll's SSNIT/TIN, §14) | Legal (A), specifics unverified | — | N/A | Worth a security-review note, not a confirmed statutory violation | RECOMMENDED (masking/redaction review), not asserted as REQUIRED without primary-text confirmation |
| Handbook/Code of Conduct issuance and acknowledgement | CIHRM/general HR practice, not itself Ghana statute in the sources reviewed | Genuinely absent (§15) | — | CIHRM (B) practice | Fully org-configurable if built | **Yes — genuine gap** | RECOMMENDED HR PRACTICE |
| Induction/orientation | CIHRM/general HR practice | Genuinely absent, explicitly descoped (§17) | — | CIHRM (B) practice | Fully org-configurable if built | **Yes — genuine gap** | RECOMMENDED HR PRACTICE |

## 25. Organization-Configurability Matrix

| Capability | Currently configurable? | Mechanism | Notes |
|---|---|---|---|
| Number of interview rounds | Yes (implicitly) | Multiple `interviews` rows per application, no fixed limit | No org-level "require N rounds" policy field exists, but nothing prevents any number |
| Interview assessment templates/criteria | No | `interview_scorecard_responses.criterion` is free text | Would need an org-defined criteria/template table |
| Recruitment approval chain | Partial | `requisition_approvals`/`offer_approvals` exist but are single-step, permission-gated only | No multi-step, per-department-configurable chain |
| Candidate source options | Architecturally yes, practically no | `source` is free text | Only two hardcoded values ever written (§6) |
| Required onboarding documents | No | `employee_documents` has no required/optional concept | Genuine gap (§13, §20) |
| Offer/appointment templates | No | `letterTemplateId` reserved, unused; no template table | Genuine gap (§9, §22) |
| Authorized signatories | No | No signatory field on offers or anywhere else | Genuine gap |
| Induction checklist | No | Feature does not exist | Genuine gap (§17, §20) |
| Handbook/policies | No | Feature does not exist | Genuine gap (§15) |
| Probation applicability/duration | Partial | Field exists (`probationEndDate`), no org-default/derivation config | Should be added as organization policy config, not hard-coded |
| Probation reviewer | Yes (indirectly) | Via Performance's existing reviewer-assignment mechanism on a `probation`-typed cycle | Reuses existing engine correctly |
| Confirmation authority | Partial | Gated by `employee.write` permission only — any holder can confirm, no distinct "confirmation authority" role/approval concept | Could be tightened via existing role/permission mechanism without new architecture |
| Onboarding responsibilities (task ownership) | No | Feature does not exist | Genuine gap (§20) |

No `if organization === "WWM"` pattern was found anywhere in the areas inspected — every mechanism described above (numbering, master data, permission/role assignment, module enablement, org-configurable namespaces) is the platform's existing, generic, organization-scoped configuration architecture. This is consistent with the platform's established "one shared foundation" principle and should remain the pattern for any future work in this area.

## 26. WWM Configuration Requirements (NOT performed in this workstream)

Separated explicitly from platform gaps, per instruction. Once platform gaps below are resolved (or even before, for the parts that already work), **WWM-specific configuration that would still be needed** includes: assigning Department Heads/recruitment-approval-authority roles for WWM's own departments; deciding WWM's own recruitment approval chain (who approves a requisition, who approves an offer); defining WWM's own required onboarding-document set (once that capability exists); WWM's own appointment/offer letter template and authorized signatory (once document generation exists); WWM's own induction checklist content (once that capability exists); WWM's own handbook/policy documents (once that capability exists); WWM's own probation default duration/policy and confirmation-authority role; WWM's own candidate-source master-data list (once sourcing is made genuinely configurable). None of this was done, decided, or assumed in this workstream — Recruitment/Onboarding remain platform-generic, untouched for WWM, exactly as instructed.

## 27. Genuine Platform Gaps

Ranked by how directly they block the stated goals of this task:

1. **Candidate/application creation requires a `published` vacancy — no HR-driven, publication-free manual entry path exists.** Directly contradicts this task's explicit "publication must not be required" design goal. Evidence: §6. **REQUIRED FOR THIS TASK'S STATED DESIGN GOAL.**
2. **Offer acceptance/decline is entirely unimplemented** — the status enum has the values, zero code path ever writes them; and hiring authorization does not check offer status at all, so "selected" and "authorized to employ" are effectively one gate. Evidence: §8, §9. **OPTIONAL PRODUCT ENHANCEMENT bordering on REQUIRED** — a recruitment pipeline without a real acceptance step is functionally incomplete for real hiring decisions.
3. **No onboarding checklist/workflow engine exists.** Evidence: §20. **RECOMMENDED HR PRACTICE / OPTIONAL PRODUCT ENHANCEMENT**, high value once built since it would also be the natural place to reference (never merge) Assets/Office Inventory issuance, document completion, and induction completion.
4. **No induction/orientation capability exists**, explicitly descoped by the Recruitment workstream. Evidence: §17. **RECOMMENDED HR PRACTICE.**
5. **No handbook/policy acknowledgement capability exists.** Evidence: §15. **RECOMMENDED HR PRACTICE**, with a plausible Ghana-compliance dimension if an organization's own policies touch statutory topics (e.g., a Code of Conduct referencing statutory notice/disciplinary procedure).
6. **No document-generation capability exists anywhere in the codebase** — blocks offer letters, confirmation letters, and any handbook document regardless of which of the above gaps get addressed first. Evidence: §9, §22. **OPTIONAL PRODUCT ENHANCEMENT**, but a prerequisite for #1's Ghana-compliance dimension (written particulars) and for handbook acknowledgement to be more than a checkbox.
7. **Candidate sourcing is not genuinely configurable** — hardcoded to two values in practice despite a free-text column. Evidence: §6. **ORGANIZATION POLICY / CONFIGURATION** — low effort (Master Data domain + wiring), not architectural.
8. **Employee documents have no required/verified/expiry checklist concept.** Evidence: §13. **RECOMMENDED HR PRACTICE**, natural companion to gap #3.
9. **Recruitment/offer approval chains are single-step only**, not the multi-step, per-department-configurable chain the frozen plan's own reserved `sequence` column implies. Evidence: §5, §9. **ORGANIZATION POLICY / CONFIGURATION** enhancement.
10. **Offer/appointment particulars don't structurally capture probation terms/notice/working hours/leave information**, relevant to Act 651 Schedule I. Evidence: §9, §24. **REQUIRED FOR GHANA COMPLIANCE** if/when this system is relied on as the actual source of an employment contract's written particulars, rather than merely internal recruitment tracking.
11. **`reportingManagerId` is not carried through offer→conversion**, requiring a manual post-conversion step. Evidence: §10. **OPTIONAL PRODUCT ENHANCEMENT**, small and low-risk to close.
12. **No field-level masking on sensitive statutory identifiers (SSNIT/TIN/bank account)** — permission-gated and audited, but not display-masked. Evidence: §14, §24. **RECOMMENDED** security-review item, not confirmed as a statutory requirement.

## 28. Existing Capabilities That MUST NOT Be Rebuilt

- Employee numbering engine (`numbering_sequences`/`employee_number_allocations`, §11) — generic, reused across modules including Office Inventory. Any onboarding/recruitment numbering need routes through this.
- PIF/personnel-file custody model (§12) — physical file tracking, structurally disjoint from `employees`' own digital fields; do not add personal-data fields to it, and do not build a second file-tracking mechanism.
- Candidate→employee conversion path (`employeeConversion.ts` → `createEmployee()`, §10) — the single authoritative employee-creation route, with DB-enforced no-duplication guarantees. Any onboarding trigger must call into this, never insert into `employees` independently.
- Probation/confirmation mechanism (`confirmEmployee()`, §21–22) — more built than assumed; extend it (extension-as-event, reminders, unsuccessful-outcome) rather than replacing it.
- Probation-review linkage to Performance (`cycleType='probation'`, §22) — do not build a second review/rating engine for probation.
- Statutory identifiers/banking (Payroll-owned, §14) — never duplicate SSNIT/TIN/banking fields onto `employees`, `employee_documents`, or any new onboarding table.
- Recruitment's stage/pipeline architecture (`recruitment_stages`/`application_stage_history`, §5–§8) — the correct substrate for screening/shortlisting/selection; these are not missing features, they are this architecture used correctly.
- Assets/Office Inventory custody systems (§19) — must remain fully separate from any future onboarding checklist; reference, never merge.
- Separation/exit architecture (`employee_exit_processes`, §17 agent finding cross-referenced in §23) — the correct, already-stable downstream terminus; do not rebuild it as part of any lifecycle work.

## 29. Risks/Ambiguities

- The "maximum six months" probation-duration figure appearing in some secondary/marketing sources is **not corroborated** by primary text or by the more careful source reviewed — do not encode any specific numeric default into product design or documentation without further legal verification (ideally direct counsel or a readable primary-text pass once tooling permits fetching the official PDF).
- The full 11-item CIHRM practice-area list was only partially re-confirmed directly on CIHRM's own site this session; treat the unconfirmed items as plausible, not verified.
- Act 843's exact "sensitive personal data" definition and any recruitment-specific clause were not independently confirmed — the masking/redaction recommendation in §14/§24 is prudent-practice guidance, not a cited statutory mandate.
- `requisition_approvals`/`offer_approvals`'s reserved `sequence` column implies multi-step approval was originally intended but never implemented — any future work here should confirm with the frozen plan's original author intent before deciding whether to build true multi-step chaining or formally close that design question.
- Office Inventory's `holderId` polymorphic, non-FK-enforced pattern (§23) is a pre-existing, already-disclosed risk, not new — flagged here only because this discovery's cross-module trace surfaced it again; no action recommended beyond continued awareness.

## 30. Recommended Implementation Workstreams (NOT started — sequencing suggestion only)

1. **Publication-free candidate/application capture** — an HR-driven manual entry path (walk-in, referral, physical announcement, direct sourcing) that does not require `vacancy.status='published'`. Closes Gap #1 and makes Gap #7 (source configurability) trivial to close alongside it.
2. **Offer acceptance/decline lifecycle** — implement the already-modeled `accepted`/`declined`/`expired` transitions and decide whether/how offer status should gate employee conversion. Closes Gap #2.
3. **Onboarding checklist/workflow engine** — organization-configurable tasks, required/optional, responsible role, due date, completion, evidence, overdue — designed from the start to *reference* (never merge) Assets/Office Inventory issuance and document completion. Closes Gap #3, provides the natural home for #4/#5/#8's completion tracking.
4. **Induction/orientation** — likely delivered as a specialization or configuration of workstream 3's checklist engine rather than a separate table. Closes Gap #4.
5. **Handbook/policy versioning and acknowledgement** — new capability; likely needs document-generation or at minimum document-attachment + acknowledgement-event tracking. Closes Gap #5.
6. **Document generation** — a genuinely new subsystem (template + render), needed by workstreams 5 and by any future offer/confirmation-letter work. Closes Gap #6, unblocks the Ghana-compliance dimension of Gaps #1 and #10.
7. **Required employee-document checklist** — required/optional, verified/rejected, expiry, on the existing `employee_documents` foundation. Closes Gap #8.
8. **Offer/appointment structured particulars** — add probation terms/notice/working-hours/leave-entitlement fields to `offer_versions` (or a linked contract-particulars record) for Ghana Schedule I alignment. Closes Gap #10.
9. **Small, low-risk closes** — `reportingManagerId` in the conversion mapping (Gap #11); configurable multi-step approval chains if confirmed as originally intended (Gap #9); statutory-identifier display masking (Gap #12).

Each workstream above should get its own explicit go-ahead, its own frozen plan, and its own W1..Wn execution — consistent with how every other module in this platform (Office Inventory, Payroll, Recruitment itself) was built. This document recommends sequencing, not authorization to begin.
