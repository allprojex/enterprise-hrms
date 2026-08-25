# Enterprise HRMS — Master Owner Review

**Status: OWNER REVIEW — APPROVAL REQUIRED BEFORE IMPLEMENTATION**

Mode: Discovery / Reconciliation / Owner Review / Architecture / Security Architecture / AI Architecture / Commercial Platform / Deployment Architecture / **Documentation Only**. No application code, schema, migration, or WWM configuration was changed to produce this document. Findings were gathered by nine parallel, independent, read-only investigation passes (Foundation & Access Control; Employee Lifecycle Extensions; Documents, Records & Bulk Import; Platform Primitives; Workforce Operations Modules; Audit Architecture; Security Architecture; AI Architecture; Commercial/Control Plane/Deployment/Backup) plus this coordinating pass's own direct reading of `docs/GHANA_HR_EMPLOYEE_LIFECYCLE_RECONCILIATION.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `MODULES.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `OPERATIONS.md`, reconciled against each other before being written here.

**The single largest cross-cutting finding of this review**: the existing recruitment/onboarding/probation discovery already performed in `docs/GHANA_HR_EMPLOYEE_LIFECYCLE_RECONCILIATION.md` was not duplicated — its findings are incorporated by reference throughout §6 below. Everything else in this document is new evidence gathered specifically for this review.

---

## 1. Repository Checkpoint & Reconciliation

- `local main == origin/main` at `baf5b68` (`fix(access): make dashboards permission-aware`), confirmed by `git fetch` + `git rev-parse HEAD`/`origin/main` at the start of this workstream.
- HEAD has legitimately advanced one commit beyond the task's stated checkpoint (`75f7452`, `docs(hr): reconcile Ghana employee lifecycle and onboarding`) — the intervening commit `baf5b68` is an unrelated frontend permission-gating fix, not touching any capability this document discusses. Reported and reconciled, not reset, per instruction.
- Working tree at time of writing: `artifacts/hrms/src/pages/office-inventory.tsx` was shown as modified in the initial git-status snapshot; re-checked live during this review and the working tree is now clean for that file — nothing is currently pending there. Untracked items present since before this session (`.agents/skills/`, `.claude/`, `CLAUDE.md`, `CONTRIBUTING.md`, `artifacts/api-server/uploads/`, `skills-lock.json`) — none created or touched by this workstream.
- Migration ledger: unaffected (documentation-only pass); no migration created.
- `ROADMAP.md`/`MODULES.md` checked for contradiction with this document's findings — none found requiring correction. Left untouched.
- No repository-reality contradiction was found that would require stopping this review.

---

## 2. Product Identity & Multi-Organization Architecture

Product is **Enterprise HRMS** — a configurable, multi-tenant HR ERP. Ghana law/CIHRM practice inform design; they are not product branding. No user-facing "Ghana HR"/"WWM HR" naming exists anywhere in the codebase (confirmed by the existing Ghana doc and re-confirmed here).

**Hardcoding check (repo-wide grep for `WWM`, across `lib/`, `artifacts/api-server/src`, `artifacts/hrms/src`)**: every hit is a code comment documenting an organization-neutral design decision, a negative-guarantee comment (e.g. `requireMembership.ts`: "a WWM hostname can never be used to act on Acme's data"), test fixture data, or a seed-file comment stating a decision applies "for any organization, including WWM." **Zero instances of `if (organization === "WWM")` or any WWM-specific conditional branch exist in production code.** Classification: **COMPLETE AND SURFACED** — Core Principle #1 is upheld in practice, not just in policy.

**Multi-tenancy today** is single-installation: one Express process + one Postgres database serve every organization, isolated by `organizationId` scoping (enforced in `requireMembership.ts`, re-verified per request, never cached from `sessions.activeOrganizationId`) plus hostname resolution (`organization_domains` → `resolveTenantHost`). Two organizations (WWM, Acme) already coexist safely in the same database, proving the isolation model. Dedicated single-tenant deployment (separate VPS/DB running the same unmodified codebase) is a documented **topology decision**, not a distinct code path (`docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`).

---

## 3. Existing Module Map — Foundation

Classification against the platform's own "Definition of Complete" (schema + migration + API + permission enforcement + validation + OpenAPI + generated clients + frontend + CRUD + org isolation + audit logging + tests + docs).

| Module | Classification | Evidence | Residual gap |
|---|---|---|---|
| Authentication | COMPLETE AND SURFACED | `auth.ts`, `requireAuth.ts`, `sessions` table (Bearer token, 7-day TTL), real server-side logout (row delete, not client-only) | No MFA/SSO (see §14) |
| Organization Management | COMPLETE AND SURFACED | `organizations.ts`, `organizations.tsx`, tenant-hostname resolution | none |
| Organization Settings | COMPLETE AND SURFACED, audit coverage uneven | `organization-settings.ts` — real validated, versioned (`schemaVersion`) Configuration Engine per ADR-009, 6 live namespaces (general/terminology/attendance/performance/numbering/branding) | Only the `numbering` namespace is audit-logged on change; `general`/`terminology`/`attendance`/`performance`/`branding` PATCHes are not (**P1**, see §13) |
| Module Management | COMPLETE AND SURFACED | `modules.ts` + `organization-modules.ts` + `requireModuleEnabled` middleware + `ModuleGate` frontend + audited enable/disable (`module.enabled`/`module.disabled`) | none structural |
| User Management | PARTIAL — dual identity model | `organization_memberships`+`membership_roles`+`roles`/`permissions` is the current model; but legacy `users.role`/`users.organizationId` columns still exist and are still read by `isSuperAdmin()` | **OWNER DECISION #1** (P0) — formally deprecate or explicitly document the legacy columns as platform-bootstrap-only |
| Roles & Permissions | COMPLETE AND SURFACED | System role templates (`roles.ts`, `isSystemRole`), org-level custom roles via `copyRoleTemplate` (audited: `role.copied_from_template`, `.permission_granted`, `.permission_revoked`) | none |
| Membership Management | COMPLETE AND SURFACED | `organization-memberships.ts`, invite/accept flow (audited: `membership.role_assigned`/`_revoked`) | none |
| Branches | COMPLETE AND SURFACED | Full CRUD + archive/reactivate, org-scoped, tested (`organizationStructure.test.ts`) | none |
| Organizational Units (Departments) | COMPLETE AND SURFACED | Full CRUD + `/restructure`, archive/reactivate | none |
| Positions | COMPLETE AND SURFACED | Full CRUD + `/restructure`, archive/reactivate | none |
| Master Data | COMPLETE AND SURFACED | `master-data-domains.ts`/`master-data-items.ts`, real classification enum (system-defined/org-overridable/org-defined) per ADR-010, **28 domains actually seeded** | none |
| Org Structure & History | COMPLETE AND SURFACED — strongest area in the audit | `department-heads.ts`: genuinely effective-dated `[validFrom, validTo)`, DB-enforced at-most-one-open-head-per-department, full point-in-time API (`/head`, `/head/history`, `/head/as-of`); `primary-hr-assignments.ts` follows the identical pattern; the effective-dating pattern is reused across 7+ schema files | No first-class "acting/temporary appointment" concept distinct from permanent reassignment — **OWNER DECISION #2** (P2) |

**Foundation summary**: the Foundation (CLAUDE.md priority items 1–10) is genuinely COMPLETE AND SURFACED, with one P0 architectural loose end (dual identity model) and one P1 audit-coverage gap (settings namespaces), both cheap to close.

---

## 4. Custom Fields, Form Builder & Extension Framework

**Custom Fields & Form Builder (§37, brief-mandatory) — GENUINELY MISSING, confirmed by exhaustive grep.** Zero matches for "custom field," "form builder," "dynamic field" anywhere in code *or* in the project's own status log — this hasn't even been discussed/deferred before. Absent: field-type registry, per-field validation storage, org/module scope binding, conditional visibility, versioning, and any entity-attachment mechanism. **Priority P1** given Core Principle #2 ("Configuration Before Custom Code") depends on this existing; recommend scoping as its own Foundation-adjacent workstream.

**Organization Customization / Extension Framework (§7) — GENUINELY MISSING.** No plugin/extension registration, versioning, or core-compatibility-declaration mechanism exists. What a future extension mechanism could build on: `organization_modules` (coarse on/off, not third-party registration), Master Data's classification model (the closest "org adds its own data into a controlled slot" primitive, but reference-data-only), the Roles/Permissions composition model, and `organization_settings`'s namespace engine (currently only first-party-registered). **OWNER DECISION #3** (P3): is a true third-party extension framework in scope at all, or does "configuration before custom code" mean the answer is "no — only deeper configuration surfaces, ever"? Recommend classifying **NOT REQUIRED** until an Owner explicitly commits to it — building speculative extension infrastructure contradicts Core Principle #2.

**Configuration Governance (§49) — PARTIAL.** Permission checks are solid across all sensitive-config routes. Audit logging is inconsistent by design (see §13). No settings-value change-history exists (only schema-version tracking). **P1**, folded into the audit-coverage fix above.

---

## 5. Documents & Records Architecture — MANDATORY OWNER DECISION

**The question**: should there be one unified Documents & Records subsystem, and what should it own vs. leave to Personnel Files/Recruitment/Payroll?

**What exists today**: two structurally similar but independently-owned tables — `employee_documents` and `candidate_documents` — that already share a single, well-built storage/validation backend: `fileStorage.ts` (private local-disk, organization-scoped by directory, server-generated random-hex filenames — no path-traversal surface by construction, never served by static middleware, only through authenticated permission-checked routes) and `documentValidation.ts` (real magic-byte signature sniffing against an allowlist — PDF/JPEG/PNG/DOCX/XLSX, not MIME-header trust alone, 10MB cap). Both tables' lib code call the *exact same* validation/storage functions. This is the good news: the security-relevant part of Documents & Records is already unified; only the row-shape/ownership-FK part is duplicated.

Separately, `personnel_files`/`personnel_file_volumes`/`personnel_file_movements`/`records_locations` model **physical custody of a folder**, with zero column overlap with either digital-document table — already correctly isolated per the Ghana doc and must stay that way (brief: "Do NOT duplicate Personnel Files"). `records_locations` itself is schema-generic (self-referencing hierarchy, no PIF-specific columns) but is used 100% for PIF today — a ready extension point for future non-personnel physical records with zero schema change.

**OWNER DECISION #4 — Documents & Records subsystem shape.**
- *Option 1: Full merge* into one polymorphic `documents` table. Rejected — `employee_documents` and `candidate_documents` have genuinely different lifecycle/FK needs (a rejected candidate's CV vs. a terminated employee's contract have different retention timelines).
- *Option 2: Status quo.* Tolerable short-term but risks a third module inventing a third bespoke document table.
- *Option 3 (recommended): Shared plumbing, separate ownership tables.* Formalize `fileStorage.ts` + `documentValidation.ts` + a shared `document_category` Master Data domain as the official subsystem boundary; require any new document-bearing feature (handbook, org-level policies/forms, future letter generation) to route through it rather than inventing new storage logic.

**What's genuinely missing, platform-wide, confirmed for every document table (not just `employee_documents`)**: (a) no required/verified/expiry checklist concept anywhere; (b) no retention/disposal/archive workflow anywhere; (c) no document versioning/supersession (re-upload always creates a new unlinked row — confirmed for both tables); (d) no generic org-level (non-employee) document upload surface — the schema supports it (`employeeId` nullable) but the only real caller is Asset Management's evidence-attachment path; (e) **zero document-generation capability anywhere in the repository** — no template table, no PDF/rendering engine, `offers.letterTemplateId`/`generatedDocumentStorageKey` are reserved and unpopulated (confirmed independently by two research streams and the pre-existing Ghana doc). This single root cause blocks every letter type in §31 (appointment/confirmation/promotion/transfer/warning/service/separation letters) identically.

**Priority**: P1 for retention/disposal (legal/compliance-shaped), P1 for the document-generation engine (blocks HR Letters entirely), P2 for the generic org-document upload surface.

---

## 6. Core Employee Lifecycle (Recruitment → Separation)

This section is drawn directly from `docs/GHANA_HR_EMPLOYEE_LIFECYCLE_RECONCILIATION.md` (already-performed, thorough, four-pass discovery) — not re-researched, incorporated by reference per this task's own instruction not to duplicate existing work.

| Area | Classification | Key finding |
|---|---|---|
| Manpower/staffing need | COMPLETE | `job-requisitions.ts`, full requisition model |
| Recruitment authorization | PARTIAL | Single-step, org-wide permission-gated only; reserved `sequence` column implies multi-step was intended but never built |
| Vacancy/position | COMPLETE, but publication-gated | **Genuine gap**: no candidate/application can be created without `vacancy.status='published'` (even `visibility:internal` counts) — zero HR-driven manual-entry path exists. Directly contradicts a "publication must not be required" design goal |
| Candidate sourcing | CONFIGURATION-ONLY BY DESIGN, EFFECTIVELY MISSING | `source` is free text but only two literal values (`careers_portal`, `internal_ess`) are ever written anywhere |
| Interviews | PARTIAL | Scheduling/scorecards solid, no-show is first-class; no numeric consolidated rollup; external-panelist submission reserved but not built |
| Selection / approval to hire | PARTIAL | "Selected" and "authorized to employ" are conflated into one gate; offer approval status is never checked at conversion |
| Offer/appointment | PARTIAL | Rich versioning/approval; **zero document generation**; no branding/signatory/structured probation-notice-leave particulars |
| Candidate→Employee conversion | COMPLETE, structurally sound | Single authoritative path (`employeeConversion.ts` → `createEmployee()`), DB-enforced no-duplication both directions |
| Employee numbering | COMPLETE | Generic, organization-configurable, concurrency-safe, correctly reused across modules — must never be duplicated |
| PIF/Personnel File | COMPLETE | Physical custody only, zero overlap with digital employee data |
| Employee documents (checklist) | PARTIAL/MISSING | Flat generic upload, no required/verified/expiry concept (see §5 above — now confirmed platform-wide, not just here) |
| Statutory/SSNIT handling | COMPLETE, permission-gated + audited | No field-level masking (see §14) |
| Handbook/policy acknowledgement | **MISSING**, confirmed by exhaustive grep | Zero "handbook" hits anywhere |
| Job description | CONFIGURATION-ONLY | Lives only on transient `vacancies`, not on the permanent `positions` record — a closed vacancy leaves zero job-description content behind |
| Induction/orientation | **MISSING**, explicitly and deliberately descoped in writing (W58/W59 closing notes) | — |
| ESS activation | COMPLETE as mechanism; no onboarding-completion gate | ESS activates the instant a membership link exists — because no onboarding-completion signal exists anywhere |
| Onboarding workflow/checklist | **MISSING**, confirmed by full schema listing | No task/checklist engine anywhere |
| Probation | PARTIAL, more built than assumed | Real `confirmEmployee()` mechanism, linked to Performance (`cycleType='probation'`), audited, event-logged; no duration-derivation rule engine, no extension-as-event, no unsuccessful-outcome state (deliberately binary confirm-or-don't) |
| Probation review | Linked to Performance correctly, not a second engine | — |

**Genuine platform gaps** (ranked, per the Ghana doc): (1) publication-free candidate capture — **required for this platform's own stated design goal**; (2) offer acceptance/decline entirely unimplemented; (3) onboarding checklist engine; (4) induction; (5) handbook acknowledgement; (6) document generation (root cause of #1's Ghana-compliance dimension, #5, and all of §31's HR Letters); (7) candidate-source configurability; (8) employee-document checklist; (9) multi-step approval chains; (10) offer particulars (probation/notice/leave) for Ghana Schedule I; (11) `reportingManagerId` not carried through conversion; (12) no field-level masking on SSNIT/TIN/bank details.

**Do not rebuild**: employee numbering engine, PIF/personnel-file model, candidate→employee conversion path, probation/confirmation mechanism, probation-review-Performance linkage, statutory identifiers (Payroll-owned), Recruitment's stage/pipeline architecture, Assets/Office Inventory custody, Separation/exit architecture.

---

## 7. Employee Lifecycle Extensions (§23–§36)

| # | Capability | Classification | Evidence | Priority | Owner Decision |
|---|---|---|---|---|---|
| 23 | Training & Development | ALREADY IMPLEMENTED as Learning module (shipped Phase 3D) | Full request→approval→completion→certificate pipeline | P3 (dev plans/needs-analysis layer only) | — |
| 24 | Skills / Competencies | ALREADY IMPLEMENTED (inventory + ESS-read), REACTIVATE item now resolved | Deferred at Phase 2B/W39, closed at Phase 3F (W105/W106); free-text proficiency, no formal competency framework; certification `expiryDate` column exists but no reminder mechanism | P2/P3 | **OD #5** — formal competency framework in scope later, or free-text sufficient indefinitely? |
| 25 | Career & Internal Mobility | ALREADY IMPLEMENTED for permanent transfer/promotion/confirmation | `employment_periods` append-only log, real `transferEmployee()`/`promoteEmployee()`/`confirmEmployee()`, full UI dialogs | P2 (acting/secondment) | **OD #6** — add `eventType: acting_appointment`/`secondment` (zero schema change) with an auto-revert mechanism — needs scheduled-job infra that doesn't exist (see cross-cutting finding below) |
| 26 | Succession / Talent | PARTIAL — `talent_pools` is recruitment-only (FK'd to candidates, not employees); no internal-succession concept exists at all | Verified by reading full schema/route/page | P2 | **OD #7** — confirm the brief means new internal-succession capability, not documentation of existing (recruitment) Talent Pools; needs a new schema, not a repurposing |
| 27 | Contract / Employment Term Mgmt | PARTIAL — static `employmentType` enum only, no start/end/expiry/renewal/reminder | No contract-management table anywhere | **P1** — plausible Ghana Labour Act relevance (not independently verified) | **OD #8** — model as new `employees` columns or as `employment_periods` events (recommended: latter, reuses working infra) |
| 28 | Employee Relations | PARTIAL — disciplinary log exists (append-only, no workflow stages); grievance/complaint entirely absent | `employee-disciplinary-records.ts`: no investigation/hearing/response/evidence/findings/appeal fields at all | **P1** — fair-hearing/disciplinary-procedure compliance relevance | **OD #9** — add structured stages to disciplinary records, and build Grievance as a wholly separate, employee-initiated schema (opposite initiator/confidentiality needs) |
| 29 | Employee Welfare | GENUINELY MISSING, confirmed | Zero hits repo-wide; no medical records investigated per instruction | P3 | — |
| 30 | Benefits | GENUINELY MISSING as a distinct module; adjacent capability (`employee_compensation_components`, effective-dated, `benefit_in_kind` tax treatment) already exists and must not be duplicated | — | P2/P3 | — |
| 31 | HR Letters | GENUINELY MISSING for every letter type — single root cause (no document-generation engine, §5) | — | P1, owned by §5 | — |
| 32 | HR Service Requests | GENUINELY MISSING as a generic mechanism; two proven module-specific analogs exist (Office Inventory requests, Learning enrollment requests) | — | P2 | **OD #10** — one generic polymorphic request table, or per-type tables following the proven precedent (codebase currently favors the latter) |
| 33 | Employee Data Change Approval | GENUINELY MISSING — today HR edits all fields (including identity/next-of-kin/statutory) directly with zero approval gate; ESS is read-only | `PATCH /employees/:id` gated only by `employee.write`, no sensitivity distinction | **P1** — data-integrity and Data Protection Act relevance | **OD #11** — reuse the Office Inventory request/approval shape; sensitive-field list should be Master-Data-driven/configurable, not hardcoded |
| 34 | Offboarding / Clearance | PARTIAL — real but thin: 3 booleans (checklist/clearance/exit-interview) + notes, no Assets/Inventory/PIF-closure linkage, no departmental clearance breakdown | `employee-exit-processes.ts` read in full | **P1** — audit/security expectation currently unprovable | **OD #12** — structured per-department clearance rows + explicit FK/trigger to Assets return and PIF closure, or accept current manual-checklist level for V1? |
| 35 | Workplace Incidents | GENUINELY MISSING, confirmed; must stay separate from Assets/Inventory incident tables | — | P2 (org-type-dependent) | — |
| 36 | HR Compliance Calendar | GENUINELY MISSING as an aggregated view; underlying dates inconsistently present | `dashboard.tsx` is stat-tiles only, no per-item deadline list | P2 | Sequencing depends on §27 (contract expiry) existing and on scheduled-job infra |

**Cross-cutting finding (load-bearing for §25, §27, §30, §36)**: **no scheduled-job/notification infrastructure exists anywhere in this platform.** This is independently confirmed by the Learning module's own documented non-goals and by the total absence of any reminder mechanism for certificate expiry, contract expiry, or compliance deadlines. This should be tracked as its own infrastructure item (**OWNER DECISION #13**, P1) rather than three/four separate gaps — several of the items above cannot be fully closed until it exists.

**Best-designed underused asset found**: `employment_periods`'s free-text `eventType` design means acting-appointment/secondment (§25) and contract-renewal (§27) can both be added as new event types with **zero schema migration**, reusing `recordEmploymentPeriodEvent()` verbatim.

---

## 8. Platform Primitives (§38–§48)

| # | Capability | Classification | Key evidence | Priority |
|---|---|---|---|---|
| 38 | Tasks / Notifications / Reminders | GENUINELY MISSING as a generic engine; notifications are a flat message log only | `notifications.ts` has no `taskId`/`dueDate`/`entityType`. Four unrelated schema files *each* independently disclose "overdue is never a stored column, always computed live" — a consistent, deliberate architecture choice, not an oversight. `managerPortalPendingActions.ts` proves the "live-aggregation, no second task table" pattern works for 3 modules (Leave/Performance/Learning) | P2, rises to P1 once HR Action Centre (§45) is attempted |
| 39 | Workflow / Approval primitive | PARTIAL / duplicated-but-converging | Requisition-approvals and Offer-approvals are **literally copy-pasted** (offer's own header says so); Leave's two-stage (Dept-Head→HR) design genuinely differs; Payroll corrections use a distinct-actor self-approval block. **One real point of shared code found**: `department_heads` authority resolver, consumed by both Office Inventory and Leave | See **OD #14** below |
| 40 | Delegation / Acting Authority | SPECIALIZED — one well-built instance (Office Inventory), not generalized | `office-inventory-approval-delegations.ts`: effective-dated, revoke-only, DB-enforced single-open-delegation, live re-validation against the current Head every time. Leave's Dept-Head stage has **no** delegate fallback | **OD #15**, P2 |
| 44 | Global Search / Employee 360 | PARTIAL — strong composed profile, not a full cross-domain 360; no global search exists | `employee-detail.tsx` (2,468 lines) already composes Documents/Skills/Qualifications/Certifications/History/Disciplinary/PIF/Performance/Separation, including a genuine cross-module check (Assets-unreturned warning on separation). Missing: Leave/Attendance/Learning/Inventory. Only real search endpoint found is Personnel-Records-scoped | P2 (360 completion), P3 (global search) |
| 45 | HR Action Centre | GENUINELY MISSING | `dashboard.tsx` is aggregate stats only, zero per-item actionable list. Manager Portal's Pending Actions is a proven, working template (per-source resolver → merged list) that could be widened org-wide | **P1** — clear gap with a low-risk implementation template already proven in the codebase |
| 46 | ESS (broader surface) | COMPLETE for its shipped scope | `employee-self-service.tsx`: profile, own documents, Leave, Attendance, Payslips (where enabled), Career Profile (read-only skills/quals/certs/history) — own-scope enforced via `resolveOwnEmployeeId` pattern | none residual |
| 47 | Manager / Department Head | PARTIAL — well-architected, deliberately narrow | Manager Portal: 3 read-only routes, zero mutation hooks, deep-links to each module's own page; covers Leave/Performance/Learning/Attendance-awareness/Team-Assets-awareness only. Missing: recruitment participation, probation tracking, onboarding participation, delegated authority beyond Office Inventory | P2 |
| 48 | Reporting / Analytics | PARTIAL — registry has grown to **40 report definitions** (far beyond ADR-016's original 3), but only the original 3 execute through the shared generic runner; the other 37 are independently-implemented, same-shape routes | `reports.ts` registry + 8 module-specific reporting route files, each re-implementing the `{columns,rows}`/CSV convention | See CSV finding below |

**Security-relevant finding surfaced here**: the shared CSV export (`reporting.ts`'s `toCsv`) has **no formula-injection hardening** (no leading `=`/`+`/`-`/`@` neutralization). Office Inventory's own reporting comment explicitly discloses it built a **locally hardened, formula-injection-safe** export as its own Owner Decision — meaning every *other* module's CSV export inherits the unhardened shared default unless independently fixed. **Priority P1** — small, high-value, single-point fix in `reporting.ts`.

**OWNER DECISION #14 — extract a shared Workflow/Approval primitive?** Options: (A) do nothing, continue copy-by-convention (risk: continued drift, already proven — Offer copied Requisition's shape, Leave diverged into two-stage); (B) extract a full `approval_steps`/`approval_chains` engine covering all approval types (risk: over-engineering — the brief itself cautions against replacing working domain-specific flows unnecessarily); (C) extract only the **authority-resolution half** — generalize `department_heads` + delegation beyond Office Inventory, leave each module's own approval state machine bespoke. **Recommendation: Option C**, since it's the one piece of code that already *is* proven reusable across two modules. Revisit Option B only when a 4th/5th new single-step approval is requested. Priority P2 (authority-resolver generalization), P3 (full engine, revisit later).

**OWNER DECISION #15 — generalize Office Inventory's delegation table?** The shape (org/scope/delegator/delegate/effective-dated/revocable/audited/live-revalidated) is close to organization-neutral already; only `departmentId` is Inventory-specific. Recommend sequencing together with OD #14. Priority P2.

---

## 9. Bulk Import / Organization Migration (§43, brief-mandatory)

**Classification: PARTIAL — narrow single-purpose importer, not the full §43 multi-entity migration workflow. This is the largest gap-to-mandate distance found in this entire review.**

What exists (`legacyImport.ts` + `personnel-import.tsx`), verified by full read: a real, secure, well-validated **"create employees + allocate current staff/PIF numbers" importer** — fixed 18-column CSV, real validation (enum/date/duplicate/collision checks), a genuine two-step dry-run→commit flow, all-or-nothing transactional commit, one batch-level audit event (row counts only, never PII), self-disclosed as deliberately V1/narrow scope.

What §43 requires but does **not** exist: no column-mapping step for arbitrary legacy formats (fixed headers only); no import path for organizational structure/departments/positions (referenced by lookup code, never created); **no import path at all** for employment history, qualifications, certifications, leave balances, or Payroll opening balances; no bulk document/file import; no reconciliation report beyond a flat created-row list; no update/upsert capability (create-only).

**Priority: P0** — explicitly MANDATORY per the brief, and the gap between what exists and what's required is the widest of any single finding in this review.

---

## 10. Workforce Operations Modules

| Module | Classification | Status |
|---|---|---|
| Attendance | COMPLETE AND SURFACED | Phase 3B, W64–72, zero residual defects at W71 verification |
| Leave | COMPLETE AND SURFACED | Two-stage Dept-Head→HR workflow shipped (`91955c9`), fully reconciled into `PROJECT_STATUS.md`; a real historical module-gating gap (registry stuck on default despite the module being functional since Phase 2B) was found and fixed (`2ccf1d1`) |
| Performance | COMPLETE AND SURFACED | Phase 3C, W73–84; one self-disclosed acknowledgement gap found and closed within the same phase (W83A) |
| Learning & Development | COMPLETE AND SURFACED | Phase 3D, W85–94; two load-bearing cross-workstream issues disclosed and resolved during development, not silently patched |
| Asset Management | COMPLETE AND SURFACED | Phase 3E, W95–104; W103 verification PASS, 117/117 real-HTTP assertions |
| Office Inventory | COMPLETE AND SURFACED (for WWM specifically) | 11-table consolidated ledger design; W11 verification 57/57, zero Category A defects; deliberately `hidden`/`defaultEnabled:false` at build completion, later graduated to `active` for WWM only via a separate authorized "WWM Readiness" workstream |
| Payroll | **COMPLETE (code) / CONFIGURATION ONLY (not yet operable)** | 13 tables, full `draft→calculated→approved→locked` lifecycle with maker-checker; GRA/SSNIT/NPRA sources cited, PAYE bands direct-fetch-confirmed; **but no real Ghana statutory figures have been seeded into any database** — deliberately withheld pending legal/accounting sign-off (several figures explicitly unresolved: overtime threshold, benefit-in-kind monetization, personal relief, Tier 3 ceiling). Module correctly remains `hidden` |
| Manager Portal | COMPLETE AND SURFACED | Phase 3G, W109–113; zero product defects at W112 verification |
| Employee Self Service | COMPLETE AND SURFACED (shipped scope) | Phase 3F, W105–108; both Phase-2B-deferred items (employment history, skills/quals/certs aggregation) closed |
| HR Operations / Personnel Records | COMPLETE | Phase 3H, W1–121 (per completion report); staff-number history, numbering engine, PIF, records-location hierarchy, movement ledger, probation-review linkage (Decision 13), 5 frozen reports |

**`PROJECT_STATUS.md`'s own "Current Phase" marker is stale** (a W119-dated, 2026-08-23 snapshot claiming Phase 3H "in progress") — later entries in the same file and independent git-log evidence confirm Phase 3H completed through W121, Office Inventory shipped end-to-end and was separately turned on for WWM, Payroll shipped end-to-end but was deliberately left disabled pending statutory data, and Leave's two-stage workflow shipped and was reconciled. **True current state: all ten roadmap modules functionally complete; Payroll and Office Inventory both deliberately gated (one on statutory data, one on organization enablement); most recent work is WWM-specific onboarding/access-control refinement, not a new module phase.**

**Priority**: **P1** — seed confirmed Ghana statutory figures and obtain legal sign-off to unlock Payroll for WWM (an operational task, not an architecture gap).

---

## 11. Audit Trail Architecture (§50–§58) — MANDATORY PLATFORM CAPABILITY

**A real, substantial foundation exists** — `recordAuditEvent()` (`artifacts/api-server/src/lib/auditLog.ts`) has **337 confirmed production call-sites across ~99 files**, covering Employees, Recruitment/Candidates/Interviews/Offers, Onboarding-adjacent, Leave, Performance, Probation, Learning, Payroll, Assets, Office Inventory (most extensive — 18+ call-sites in `assets.ts` alone, 10+ Inventory lib files), Separation, security/roles/module-activation, and imports. Route surface is exactly one endpoint (`GET /organizations/:id/audit-events`), gated by a single flat `audit.read` permission, with **no PATCH/PUT/DELETE anywhere** — confirmed append-only at the application layer, both by absent routes and an explicit schema comment.

**Event model** (`audit_events`, full column list verified): `occurred_at`, `actor_application_user_id`, `actor_membership_id`, `organization_id`, `event_type`, `target_type`, `target_id`, `before_state`, `after_state`, `ip_address`, `user_agent`, `metadata` — plus 3 indexes including one pre-built for date-range queries.

**Confirmed real gaps**:
1. **Login and logout are not audited** (`routes/auth.ts` — only `session.org_switch` is recorded); password reset has zero audit call-sites. For a "security first" platform this is a material, cheap-to-fix gap. **P0.**
2. **No DB-level tamper protection.** Append-only rests entirely on application-code discipline and the absence of a route — `audit_events` does have RLS enabled (migration `0036`) but with no accompanying policy, which is a blanket posture, not a targeted anti-tamper control; nothing stops a future code change or direct DB access from issuing an UPDATE/DELETE. **P1.**
3. **Flat, uncategorized read permission.** One `audit.read` permission gates visibility into every event — a routine leave approval and a Payroll banking-detail read are equally visible to any holder. Payroll has distinctive *audit events* (5 read-audit call-sites, explicitly documented as "frozen plan Decision 9" — a deliberate, disclosed exception to the platform's general read-silence convention) but no distinct *read surface*. **P1.**
4. **Read-audit exists only for Payroll** (banking/statutory-identifier reads) — Personnel Files, disciplinary records, and document downloads are all confirmed audit-silent on read, despite being exactly the kind of sensitive access the brief asks about. **P1.**
5. **Missing model fields**: no `request_id`/correlation ID, no `success`/failure outcome, no severity/security-significance tier, no `reason`/approval-context column, no `deployment_id`. Everything about *provenance and criticality of the event itself* is only escapable via the untyped `metadata` jsonb blob. **P1** for request-ID and outcome specifically (most load-bearing for incident investigation).
6. **No date-range filter and no export endpoint** despite the schema being indexed for date-range queries — audit review without a time window is close to unusable at any real scale. **P1** (filter), **P2** (export).
7. **No retention policy or job** — no `jobs/` directory exists anywhere in the codebase (zero scheduled-job infrastructure platform-wide, consistent with §7's finding). **P2**, policy call not engineering.
8. **Audit + AI / Audit + Control Plane** — both inherently forward-looking (no AI, no Control Plane exist yet); note only, no current gap.

**OWNER DECISION #16** — add DB-level tamper protection (trigger or REVOKE-based) for `audit_events` now, or defer to a dedicated migration pass? **Recommendation: do it now** — cheap, high-value, directly serves CLAUDE.md's "Security First."

**OWNER DECISION #17** — introduce category-scoped audit-read permissions (`audit.payroll.read`, `audit.hr.read`, `audit.security.read`) or accept the flat model? **Recommendation: introduce them** — least-privilege is an explicit CLAUDE.md requirement and the current model violates it for exactly the sensitive data this platform stores.

**OWNER DECISION #18** — extend Payroll's "read-silence exception" (Decision 9) to Personnel Files and disciplinary records, or was Payroll meant to be the only exception? **Recommendation: extend it** — the pattern is proven, the shape is known, this is a known-cost change.

**OWNER DECISION #19** — audit retention policy: indefinite (current de facto default) vs. a defined online+archive window? Policy decision, not engineering — flag for explicit Owner sign-off rather than leaving it as an accidental default.

---

## 12. Security Architecture (§59–§74, §124–§125)

**No live credentials, API keys, or secrets found committed anywhere in the repository.** `.env.example` contains only placeholders; `.env`/`.env.*` are gitignored with a correct `!.env.example` exception; a targeted grep for hardcoded-secret patterns returned zero hits.

| Area | Classification | Key evidence | Priority |
|---|---|---|---|
| §59 Security administration | PARTIAL | Auth core (Bearer tokens, real server-side logout) is solid; MFA/SSO confirmed absent (zero grep hits); **no platform-level user disable/lockout flag** — `usersTable` carries no disabled/active column, and base-domain login validates only email+password, not membership status, so a user revoked at every organization can still authenticate (they simply resolve to no usable org) | **P1** (disablement), P2 (MFA/SSO) |
| §60 Privacy/retention/legal hold | GENUINELY MISSING as formal policy; a stub exists | `candidates.candidateDataRetentionMonths` is a configured number with an explicit code comment that the purge mechanism itself "is not built in this workstream" | **P1** |
| §61 Integration/API foundation | PARTIAL | Only one real external integration: email (`EmailProvider` interface + `ResendEmailProvider`, per ADR-017, silently no-ops if unconfigured — deliberate, prevents enumeration). **Idempotency-key handling is real but Office-Inventory-scoped only** (`pg_advisory_xact_lock`-backed) — solid engineering, not yet a platform-wide convention | P2/P3 |
| §62 OWASP (architecture) | Broken Access Control: consistent `requireAuth→requireMembership→requireModuleEnabled→requirePermission` composition, sampled across 6+ modules. Injection: **zero raw-SQL-concatenation findings** — Drizzle used throughout, every `sql\`\`` hit is parameterized. XSS: exactly one `dangerouslySetInnerHTML` (a shadcn chart-styling component, code-controlled input, low risk). CSRF: architecturally low (Bearer-token only, no cookie-session path). Mass assignment: **zero raw `req.body` spread findings** — every insert uses `...parsed.data` (Zod-validated) | P2 |
| §63 Tenant isolation (architecture) | COMPLETE AND SURFACED at pattern level; defense-in-depth confirmed (route-param check *and* query-predicate scoping, sampled across Assets/Performance/Inventory/Learning/Leave/Employees) | Not exhaustively verified route-by-route — this is explicitly future live-testing work | **P0** as a dedicated future workstream |
| §64 Authz/IDOR/privilege escalation (architecture) | Same pattern, same caveat | — | **P0** future workstream |
| §65 Authn/session security | PARTIAL, better than expected on rate limiting | **Login rate limiting already exists** (`express-rate-limit`, 10/15min per IP on `/auth/login`) and on public-careers apply/status routes — corrects an initial assumption. Enumeration-resistant password reset (generic response either way). **Gap: `/auth/forgot-password` and `/auth/reset-password/:token` have no rate limiting at all** — a real brute-force/enumeration-adjacent gap on the reset-token guess surface | **P1** |
| §66 File/document security | COMPLETE AND SURFACED | See §5 — server-generated storage keys, magic-byte validation, auth-gated reads, no signed-URL story yet (not needed for local-disk) | P3 |
| §67 Sensitive data | Confirmed matches Ghana doc — permission-gated + audited, **no field-level masking/encryption** anywhere (SSNIT/TIN/bank details returned in full to any permission-holder) | — | **P1/P2** |
| §68 Secret management | COMPLETE, no gap found | — | — |
| §69 Security scanning | GENUINELY MISSING, more absolute than expected | **No `.github/workflows/` directory exists at all — zero CI of any kind**, not even typecheck/build/test-on-PR. Everything is run manually/locally | **P0** |
| §70 Business-logic security (architecture) | COMPLETE AND SURFACED for every sampled gate | Employee conversion, Leave two-stage, Payroll lock/maker-checker all confirmed server-side (lib layer), not frontend-only — a client bypassing the UI still hits the guard | P2 (extend sampling to remaining ~8 gates) |
| §71 CI/CD security | N/A — no pipeline exists to assess | Bundled with §69 | **P0** |
| §72 SBOM/supply chain | PARTIAL baseline (lockfile checked in), formal SBOM process missing | — | P2, defer until CI exists |
| §73 Vulnerability management | GENUINELY MISSING as a process; one genuine ad hoc precedent exists (`docs/SUPABASE_SECURITY_REMEDIATION.md` — RLS-disabled exposure, investigated and remediated in dev; **production explicitly flagged as not yet assessed**) | — | **P1** — the flagged open item itself needs closing, separately from writing a general process |
| §74 Security incident response | GENUINELY MISSING as documented process; same precedent shows the platform *can* execute one competently | — | P1 |
| §124/125 Verification workstream / Production gate | Forward-looking by design. What a future gate can already lean on: Drizzle-only DB access, consistent membership/permission middleware chain, Zod-validated mass-assignment protection, magic-byte upload validation, live login rate limiting, clean secret hygiene, one real incident-response precedent. What has zero evidence of ever running: SAST, SCA, secret-scanning, DAST, penetration testing | **P0** — define as a dedicated, budgeted future workstream, explicitly gating production go-live |

**OWNER DECISION #20** — add a platform-level `users.status`/`disabledAt` column now? **Recommendation: yes**, small change, closes a real gap.

**OWNER DECISION #21** — CI provider and initial scanner set. **Recommendation**: GitHub Actions (repo is already on GitHub) running typecheck/build/test on every PR immediately (this alone is a large uplift, since none of that runs automatically today), then layer in `pnpm audit`/Dependabot for SCA, gitleaks/trufflehog for secret-scanning, and CodeQL/Semgrep for SAST as fast-follows.

**OWNER DECISION #22** — jurisdiction(s) for data-protection/retention policy (Ghana Data Protection Act 2012 baseline confirmed relevant per the Ghana doc; others per target markets), and whether purge is manual/supervised (matching CLAUDE.md's "never destroy data without approval") or automated once built.

**OWNER DECISION #23** — field-level masking/encryption for SSNIT/TIN/bank details: required for target-market compliance, or is permission-gating + audit logging an accepted risk posture?

**Urgent, standalone action item (not a new Owner Decision, a pre-existing flagged item)**: `docs/SUPABASE_SECURITY_REMEDIATION.md` explicitly states production has not yet been assessed for the RLS gap already found and fixed in dev. This should be tracked and closed before any production security gate is claimed satisfied.

---

## 13. AI Architecture (§75–§86)

**Confirmed: no AI capability exists anywhere in this codebase today** (repo-wide grep for provider/SDK/framework names, checked against every `package.json` in the workspace — zero real hits). Everything below is a forward-looking architecture proposal, classified GENUINELY MISSING throughout, grounded in what actually exists so it's buildable, not generic.

**What a future AI layer would sit on top of** (all real, already in production): `authorizeOrganizationAction()` as the canonical single-call permission gate; `requireAuth.ts`/`requireMembership.ts` as the tenant/session resolution chain (fails closed on tenant-hostname mismatch); `recordAuditEvent()` as the one audit-write path; 371 already Zod-validated, permission-gated OpenAPI path templates as the domain-service layer; `pino` structured logging with PII/secret redaction already applied; and ADR-017's `EmailProvider`/`ResendEmailProvider` interface as the direct precedent for a swappable-provider pattern.

**Proposed architecture, section by section**:
- **§75/§76** — AI never bears authority independent of the calling user; every tool call re-resolves membership + the *exact* permission key the underlying route already requires — never a new parallel `ai.*` permission namespace.
- **§77** — `User → AI Model → Permission-Aware Tool Gateway → Existing Domain Services → Database`. Rejected: any path where AI reaches the database directly or generates SQL. Realistic here specifically because ~100 route handlers already exist as thin, validated wrappers a tool gateway can wrap.
- **§78 Risk levels**, mapped to real routes: Level 1 (info/search, read-only, permission-filtered); Level 2 (drafts — vacancy text, interview questions — never persisted as human-authored without explicit save); Level 3 (low-blast-radius mutations, explicit human confirm-and-restate step required before the call); **Level 4 — AI must never autonomously execute**: compensation/banking changes, Payroll finalization/payment batches, separation, disciplinary sanctions, permission/role changes.
- **§79–§84** — Documents: summarize/explain *existing* uploads only (document generation doesn't exist yet, §5). Recruitment: drafting/summarizing only, hiring decisions stay human, gated by the existing `application_stage_history`. Onboarding: structurally blocked until an onboarding-checklist engine exists to summarize progress against (§6/§7) — sequencing dependency, not an AI-architecture gap. Control Plane and Demo/Org-Setup AI both explicitly depend on those platform capabilities existing first (§15/§16) — noted, not designed in depth. Bug diagnostics: real substrate exists (structured, redacted logging) but log *aggregation* wasn't confirmed to exist — flag as a prerequisite.
- **§85 Provider abstraction** — reuse ADR-017's exact shape: an `AiProvider` interface, core logic depends only on the interface, platform degrades to a visibly-absent "AI unavailable" state (never a silent no-op) when no provider is configured, mirroring the email provider's own resolved principle.
- **§86 Privacy/security** — data minimization at the tool-response level; provider retention/training-use terms confirmed contractually before any real tenant data flows out; prompt injection treated structurally (retrieved document content is never trusted as instructions, and every proposed tool call still passes the full permission re-check regardless of what retrieved content said); cross-tenant isolation via the same membership/hostname checks as every other request; per-call (not per-session) authorization re-check; AI-relevant audit events flow through the existing `audit_events` table with `metadata` distinguishing AI-mediated actions — no second audit system.

**OWNER DECISION #24** — which AI provider to approve first, under what data-processing terms. **Recommendation**: one hosted provider under a confirmed no-training/limited-retention enterprise agreement, behind the `AiProvider` interface from day one so switching later is a config change.

**OWNER DECISION #25** — Level-3 mutation confirmation UX: a distinct review-and-confirm screen, or an inline chat "yes." **Recommendation**: distinct screen for at least the first 6–12 months of AI availability, revisited with real usage data.

**OWNER DECISION #26** — AI interaction log retention. **Recommendation**: keep the permanent `audit_events` row (action/actor/before-after state, no raw prompt text) as today; store raw prompt/response content, if kept at all, in a separate, shorter-retention store — never conflate "audit trail of what changed" with "raw AI conversation transcript."

---

## 14. Commercial Model & Control Plane

**Today's reality, confirmed by direct research**: this is a single-installation platform. `super_admin` is a **single-database, cross-organization** bypass only — zero concept of multiple separate installations/deployments/customers exists anywhere (confirmed by grep: "control plane," "customer," "installation" as distinct concepts return zero matches). `organization_relationships` is a purely descriptive table, explicitly never consulted by authorization logic. This is a materially smaller capability than a true Control Plane needs, and the gap is real, not cosmetic.

**§87 Commercial Product Model** — no commercial-model concept exists (`organizations.status` is a lifecycle flag — trial/active/suspended — not a billing concept). Proposal: a `commercial_agreements` table (model: subscription/one-time-license/maintenance-contract/evaluation), living in Control Plane metadata, **never** gating `requireModuleEnabled`/`requireMembership` directly — a lapsed subscription must trigger a documented, contractual workflow (grace period → read-only → export-then-suspend), never a silent code-level HR-data lockout (explicit brief constraint).

**§88 Owner/Control Plane** — genuinely absent; proposal is a *separate* metadata store (never inside any tenant's schema) tracking customer/org/installation/commercial-model/hosting/domain/version/modules/health/backup/security-patch/renewal. Must never store or proxy client HR data directly — any support access to real tenant data requires a separate, explicitly-authorized, time-boxed, audited grant layered on the *existing* permission model, never a bypass.

**§89 Installation/Deployment Model** — Customer → Organization (exists) → Installation/Deployment (new) → Environment (new). The "shared installation, many organizations" shape is already proven (WWM + Acme coexist safely); "one organization, multiple environments" has no primitive yet.

**§90/§91 Demo Factory / Demo-to-Production** — genuinely missing as a repeatable capability. The reusable seed-script *pattern* (idempotent, typed definitions — `module-definitions.ts`, `master-data-definitions.ts`) is solid scaffolding to extend from; WWM's actual demo data was built by 20+ discrete real API calls with a hand-maintained cleanup manifest, not a factory. Recommend named templates (Church/Corporate/NGO/School/Blank) as data files driving `Create → Seed (via the real HTTP API) → Verify → Present → Reset → Delete`, with every demo org explicitly flagged (no such flag exists today — WWM had to invent an ad hoc marker convention). Promotion to production must always mean a *new*, empty org plus a Configuration Export (§92) — never in-place promotion.

**§92 Configuration Export/Import** — partially reachable today via existing primitives (`organization_settings` namespaces, module registry, custom-role-copy mechanism, Master Data domains) but no selective serialization layer exists. Hard exclusion list (enforced in code): employees, payroll, real documents, banking data, passwords/secrets, sessions.

**§93 Customer Provisioning** — the *back half* of this pipeline (Organization Created → Go Live) is **already fully implemented and proven**: `onboardOrganization()`, module/branding/role/permission/Master-Data admin surfaces, and the invitation/accept-invitation flow (used for all WWM presentation accounts, never a raw password write). The gap is purely the *commercial/hosting front half*, which is Control-Plane-dependent.

**OWNER DECISION #27 — shared vs. dedicated hosting as the default sales motion.** Recommend shared-by-default (proven, zero extra infra cost today); dedicated stays a manual, contract-triggered exception until VPS Automation exists to make it operationally cheap.

**OWNER DECISION #28 — subscription vs. one-time-license as primary commercial model.** Recommend supporting both from day one at the data-model level, defaulting self-service signups to subscription, reserving one-time-license for sales-assisted deals.

**OWNER DECISION #29 — when to build the Control Plane, given WWM is the only live customer today.** Recommend **defer** — every primitive it would sit on (org isolation, module entitlement, audit, domain resolution) is already proven multi-tenant-safe; the Control Plane's entire value is managing *multiple installations*, and there is no second installation yet. Building it now risks exactly the speculative-infrastructure trap Core Principle #2 warns against. Trigger condition: the first customer requiring dedicated hosting, not a calendar date.

---

## 15. Deployment, Release & Backup Architecture

**Confirmed absent**: `.github/` does not exist at all (zero CI); no Dockerfile/docker-compose anywhere; no Nginx/systemd/PM2 config files (only documentation prose describing the intended target topology); no `pg_dump`/backup/restore tooling — `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` explicitly delegates backups entirely to the hosting provider and states plainly "no automated restore tooling exists" and "no number is promised" for RPO/RTO.

**What already exists that a pipeline could immediately use**: real, fast test suites (Vitest+Supertest backend fully DB-mocked, Vitest+Testing Library frontend — genuine Level-1/2 test-tier foundation, just never wired to a merge gate); `GET /healthz`/`GET /readyz` endpoints already implemented and version-aware; every migration already has a hand-authored `.down.sql` (a real, existing rollback story); `pnpm-workspace.yaml` already solves the Linux-production/Windows-dev native-binary matrix.

**§94 Deployment Standardization (Docker)** — low-risk given the app is already portable (env-var-driven config, no OS-specific paths beyond the already-solved binary matrix). Proposal: multi-stage Dockerfile, non-root, `HEALTHCHECK` against the existing `/readyz`, migration-runner as a separate init step, never baked into app startup. The one piece that doesn't containerize cleanly yet: local-disk file storage needs a volume mount (or an eventual object-storage migration) before this is production-safe in a reschedulable container.

**§95 VPS Automation / §96 Release Pipeline / §97 Test Levels** — proposals build directly on real existing plumbing (documented in detail in the underlying research; summarized): a deploy script operationalizing the already-documented manual procedure with health-check gating and `.down.sql`-based rollback; a release pipeline assembling existing test commands + a new CI trigger + the already-implemented version-aware health endpoints; Levels 1–2 of the test-tier model are real today (just not CI-wired), Levels 3–6 (real-DB integration, E2E, staging/production smoke, scheduled ops checks) are net-new.

**§98–§106 Backups** — all genuinely missing at the application layer today, confirmed deliberate ("hosting provider's problem," explicitly undocumented as automated/tested/promised). Target architecture kept intentionally light per the brief's own instruction not to over-design infrastructure this review shouldn't build: mandatory backups enforced via a future Fleet Health check (not new backup code itself); configurable frequency and off-server storage as a Control-Plane-tracked per-installation config; safe-restore flow codifying the deployment doc's own existing discipline (never silently merge into a non-empty database) as an actual guarded script; restore testing as a scheduled job restoring into a scratch DB and running the real test suite against it; RPO/RTO only becomes a measurable number once the above exist — today's honest answer is unbounded.

**§107–§120 (Fleet Health, Run Checks, Bug Detection/Correlation/Management, One-Click Maintenance, Safe Fix Pipeline, Update Experience/Preflight/Rollback/Staged-Rollout/Post-Update Verification, Client Version Inventory)** — all explicitly Control-Plane- and Release-Pipeline-dependent; kept as light directional proposals in the underlying research, sequenced strictly after §88/§94–96 land. Not designed in depth here per the brief's own instruction against building speculative infrastructure ahead of need.

**§121–§123 Configuration Validation / Customer Go-Live Gate / Enterprise Readiness Gate** — unlike the above, these are **checklists, not infrastructure**, and are buildable now, independent of the Control Plane. Configuration Validation (READY/WARNING/BLOCKED) can directly codify the inspection queries this and prior sessions have already run by hand for WWM (module/role/permission/Primary-HR checks) into one reusable endpoint. Customer Go-Live Gate is the terminal step of provisioning, reusing the existing `organizations.status: trial→active` transition — no new state machine needed. Enterprise Readiness Gate is a heavier version adding audit-coverage, backup-presence, and support-access-authorization checks — this one gate should wait on backups/Control Plane existing, since it can't honestly certify readiness for capabilities that don't exist yet.

**OWNER DECISION #30 — build Docker now, independent of Control Plane timing?** **Recommendation: yes, start now.** Unlike the Control Plane, containerization pays off immediately for the *one* installation that exists today and is a prerequisite for VPS Automation and any future staged rollout to be trustworthy.

---

## 16. Enterprise Readiness Gate & Production Security Gate (Definitions)

Per the brief's explicit instruction, this review does **not** declare the platform enterprise-ready or production-security-cleared. It defines the gates:

**Enterprise Readiness Gate** requires future evidence, beyond what exists today, for: functional coverage across every module in §3/§7/§8/§10 with residual gaps closed to an Owner-accepted level; live (not architectural) tenant-isolation and IDOR/privilege-escalation testing (§63/§64); sensitive-data protection decision executed (§67, OD #23); audit coverage gaps closed (§11); organization configuration/extension boundary decided (OD #3); import/migration brought to full §43 scope (§9); Documents & Records decision executed (§5); notifications/tasks infrastructure built (§7 cross-cutting finding, §8 item 38); privacy/retention policy adopted and executed (§12, OD #22); backups/restores built and tested (§15); monitoring/deployment standardized (§15); security verification workstream completed (§12); vulnerability management process live and the flagged Supabase-production item closed (§12); scalability/regression/disaster-recovery evidence gathered; operational documentation current.

**Production Security Gate** requires: zero unresolved CRITICAL findings; HIGH findings resolved or explicitly risk-accepted with stated consequences; live tenant-isolation and IDOR testing executed and passed; permissions tested; SAST/SCA/secret-scan/DAST run at least once with findings triaged; business-logic abuse testing executed (extending §70's 3-of-11 sampled gates to full coverage); sensitive-data review executed; file security reviewed; security headers reviewed (not assessed in this pass — flag as an open item); CI/CD security in place (§12, OD #21); backup security reviewed (once backups exist); logging review executed; remediation and regression cycle completed; deployment/version tracking in place (§15).

Neither gate is met today. Both should become their own dedicated, budgeted future workstreams (P0), not implied by this document's completion.

---

## 17. Final Module Map

| Module | Existing? | Complete? | Partial? | Deferred/Hidden? | Priority for residual work |
|---|---|---|---|---|---|
| Authentication | Y | Y | | | P2 (MFA/SSO) |
| Organization Management | Y | Y | | | — |
| Organization Settings | Y | | Y (audit coverage) | | P1 |
| Module Management | Y | Y | | | — |
| User Management | Y | | Y (dual identity model) | | P0 |
| Roles & Permissions | Y | Y | | | — |
| Membership Management | Y | Y | | | — |
| Branches / Departments / Positions | Y | Y | | | — |
| Master Data | Y | Y | | | — |
| Org Structure & History | Y | Y | | | P2 (acting appointment) |
| Custom Fields / Form Builder | N | | | | P1 |
| Extension Framework | N | | | | P3 / recommend Not Required |
| Documents & Records (unified) | Partial (plumbing shared, tables not) | | Y | | P1 |
| Document Generation | N | | | | P1 (blocks HR Letters) |
| Recruitment | Y | | Y (publication-gate, approval chain, offer accept/decline) | | See §6 ranked gaps |
| Onboarding checklist/workflow | N | | | | High value, sequenced after infra |
| Handbook/Policy Acknowledgement | N | | | | Medium |
| Induction | N | | | Deliberately descoped historically | Medium |
| Probation/Confirmation | Y | | Y (no duration engine, no unsuccessful outcome) | | Medium |
| Training & Development (Learning) | Y | Y | | | — |
| Skills/Competencies | Y | Y (base) | | | P2/P3 (framework) |
| Career & Internal Mobility | Y | Y (permanent) | Y (acting/secondment) | | P2 |
| Succession/Talent | N (internal-employee sense) | | | | P2 |
| Contract/Employment Term Mgmt | Partial | | Y | | P1 |
| Employee Relations (disciplinary) | Y | | Y (no workflow stages) | | P1 |
| Grievance | N | | | | P1 |
| Employee Welfare | N | | | | P3 |
| Benefits | N | | | | P2/P3 |
| HR Letters | N | | | Blocked on Document Generation | P1 |
| HR Service Requests | N | | | | P2 |
| Employee Data Change Approval | N | | | | P1 |
| Offboarding/Clearance | Y | | Y (thin) | | P1 |
| Workplace Incidents | N | | | | P2 |
| HR Compliance Calendar | N | | | | P2 |
| Tasks/Notifications/Reminders | N | | | | P2 → P1 |
| Workflow/Approval primitive | Partial (duplicated) | | | | P2 (see OD #14) |
| Delegation/Acting Authority | Y (1 module) | | | | P2 |
| Global Search / Employee 360 | Partial | | Y | | P2/P3 |
| HR Action Centre | N | | | | P1 |
| ESS | Y | Y | | | — |
| Manager/Department Head | Y | | Y | | P2 |
| Reporting/Analytics | Y | | Y (CSV hardening gap) | | P1 (CSV fix), P3 (rest) |
| Bulk Import/Migration | Y | | Y (employees-only, not full §43) | | P0 |
| Attendance / Leave / Performance / Learning / Assets / Manager Portal / ESS-completion / Personnel Records | Y | Y | | | — |
| Office Inventory | Y | Y | | Enabled for WWM only | — |
| Payroll | Y | Y (code) | | Hidden — statutory data not seeded | P1 (operational) |
| Audit Trail | Y | | Y (see §11 gaps) | | P0/P1 (see §11) |
| Security controls | Y (many) | | Y (see §12 gaps) | | P0/P1 (see §12) |
| AI Layer | N | | | | Architecture proposed, not built |
| Commercial Model / Control Plane | N | | | | Deferred by design (OD #29) |
| Demo Factory | Partial (seed pattern only) | | | | Medium |
| Deployment Standardization (Docker) | N | | | | P1 (OD #30 — start now) |
| CI/CD | N | | | | P0 (OD #21) |
| Backup/Restore | N | | | | Deferred to infra decision |

---

## 18. Deferred Feature Register

| Capability | Original workstream | Reason for deferral | Current status | Prerequisites now complete? | Disposition |
|---|---|---|---|---|---|
| Employment-history aggregation into ESS | Phase 2B, W39 | Explicitly deferred | **CLOSED** at Phase 3F W105 | Yes | ALREADY IMPLEMENTED |
| Skills/qualifications/certifications aggregation into ESS | Phase 2B, W39 | Explicitly deferred | **CLOSED** at Phase 3F W106 | Yes | ALREADY IMPLEMENTED |
| Onboarding, orientation, asset assignment, training, probation (as of W58/W59) | Phase 3A closing notes (Recruitment) | Explicitly, deliberately descoped in writing | Probation subsequently built (Phase 2A W27, extended 3H); Onboarding/Orientation/Training-as-onboarding-item still **not built** | Partially | REACTIVATE (Probation, done) / GENUINELY MISSING (Onboarding, Induction) |
| Multi-step requisition/offer approval chains | Recruitment (`requisition_approvals`/`offer_approvals` reserved `sequence` column) | Never implemented despite reserved column | Still single-step | N/A | OPTIONAL — confirm original intent before building (see §8, OD #14) |
| Payroll statutory data seeding | Payroll W1–10 | Deliberately withheld pending legal/accounting sign-off | Code complete, data not seeded, module hidden | Sign-off pending | REACTIVATE once signed off — this is the one deferred item with a clear, short path to closure |
| Office Inventory (11 tables, full lifecycle) | Office Inventory W1–12 | Built complete then deliberately left `hidden`/`defaultEnabled:false` platform-wide | Enabled for WWM only via separate "WWM Readiness" workstream | Yes | ALREADY IMPLEMENTED for WWM; REACTIVATE-per-org for future customers |
| Leave module activation | Leave (functional since Phase 2B) | Registry `status` flag never graduated from default — a genuine BUILT BUT NOT SURFACED gap, not a deliberate deferral | **CLOSED** — fixed via `2ccf1d1` | Yes | ALREADY IMPLEMENTED |

No other meaningful TODO/FUTURE/DEFERRED records were found requiring separate registration beyond what's captured in §3–§15's classification tables above.

---

## 19. WWM Boundary

WWM is the first live organization. **No WWM-specific configuration was performed, decided, or assumed in this workstream.** Per the brief's requirement, the following remains **WWM CONFIGURATION REQUIRED AFTER PLATFORM COMPLETION** (unchanged, and not started here): branding refinement, module selection beyond what's already enabled, role/permission assignment for WWM's own structure, Department Head assignments, recruitment approval chain decisions, interview panel setup, offer/appointment templates and signatories (blocked until Document Generation exists, §5), handbook/policy documents (blocked until that capability exists, §6), onboarding/induction content (blocked until those capabilities exist), probation default duration/policy, required-document sets, Leave/Attendance/Payroll policy tuning (Payroll additionally blocked on statutory-data sign-off, §10), Assets/Inventory master data, report configuration, AI enablement (once built), security baseline, and deployment/backup profile once those exist.

No `if organization === "WWM"` pattern was found anywhere across all nine research passes — every mechanism inspected is the platform's existing, generic, organization-scoped configuration architecture.

---

## 20. Final Workstream Plan (Priority-Ordered, Smallest Coherent Roadmap)

**P0 — production/safety required**
1. Resolve the dual identity/role model (`users.role`/`organizationId` vs. memberships) — OD #1.
2. Bulk Import — extend to full §43 multi-entity scope (structure, history, qualifications, certifications, leave balances, Payroll opening balances) with mapping/reconciliation.
3. Stand up CI (typecheck/build/test on every PR) — OD #21. Currently the single largest quality-safety gap: zero automated gate exists today.
4. Audit login/logout/password-reset (currently silent) — §11.
5. Add DB-level tamper protection to `audit_events` — OD #16.
6. Close the flagged production Supabase RLS assessment (`docs/SUPABASE_SECURITY_REMEDIATION.md`'s own open item).
7. Define and schedule the Security Verification Workstream and Production Security Gate as dedicated future efforts (§16) — not satisfied by this document.
8. Dedicated future live tenant-isolation / IDOR / privilege-escalation testing workstream (§12, §63–64) — architecture looks sound, has never been adversarially tested.

**P1 — expected complete Enterprise HRMS**
9. Documents & Records: adopt Option 3 (shared plumbing, separate tables) and build the document-generation engine (unblocks HR Letters, offer particulars, handbook).
10. Add account-disablement (`users.status`) and rate-limit the two unprotected auth endpoints — OD #20, §12.
11. Category-scoped audit-read permissions and Payroll's read-audit pattern extended to Personnel Files/disciplinary records — OD #17/#18.
12. Fix the shared CSV export's formula-injection gap (`reporting.ts`) — small, high-value.
13. Employee Data Change Approval workflow — OD #11.
14. Offboarding/Clearance: structured per-department stages + Assets/PIF linkage — OD #12.
15. Employee Relations: structured disciplinary stages + separate Grievance schema — OD #9.
16. Contract/Employment Term Management (expiry/renewal/reminders) — OD #8.
17. HR Action Centre (org-wide, extending the proven Manager Portal pattern).
18. Custom Fields & Form Builder (Foundation-adjacent, mandatory per brief).
19. Scheduled-job/notification infrastructure (unblocks §25/§27/§30/§36 items) — OD #13.
20. Settings-namespace audit coverage completed uniformly — §3/§11.
21. Payroll: seed confirmed Ghana statutory figures, obtain legal sign-off, activate for WWM.
22. Field-level masking decision for sensitive statutory/banking data — OD #23.
23. Privacy/retention/legal-hold policy adopted — OD #22.
24. Docker containerization — OD #30.

**P2 — advanced enterprise capability**
25. Recruitment: candidate-source configurability, offer acceptance/decline lifecycle, multi-step approval chains (confirm original intent first).
26. Onboarding checklist/workflow engine + Induction (as a specialization of it).
27. Handbook/policy versioning + acknowledgement.
28. Skills/Competencies: formal proficiency framework (if wanted) — OD #5.
29. Career mobility: acting/secondment event types — OD #6.
30. Succession/Talent (genuinely new internal-employee capability) — OD #7.
31. HR Service Requests (generic mechanism) — OD #10.
32. Workplace Incidents module.
33. HR Compliance Calendar.
34. Employee 360 completion (Leave/Attendance/Learning/Inventory sections added to existing profile page).
35. Manager Portal: recruitment-participation source added.
36. Workflow/Delegation authority-resolver generalization — OD #14 (Option C)/#15.
37. VPS Automation, Release Pipeline, Test-tier expansion.
38. Backup/Restore architecture (once infra decisions are made).

**P3 — specialized/optional capability**
39. Employee Welfare, Benefits modules (organization-type-dependent).
40. Global cross-entity search.
41. Extension/Plugin framework — only if OD #3 is answered "yes."
42. AI Layer — build once the P0/P1 foundation above (especially audit, permissions, and Documents & Records) is solid; the architecture proposal in §13 is ready whenever the Owner greenlights it.
43. Commercial Model / Control Plane / Demo Factory / Fleet Health / Update Pipeline — deferred by design (OD #29) until a second installation is actually needed.

---

## 21. Dependency Graph (Key Chains)

- **Document Generation** blocks → HR Letters (§31), Offer structured particulars (Ghana Schedule I), Handbook-as-a-document, Confirmation/Promotion letters.
- **Onboarding checklist engine** blocks → Induction (likely a specialization of it), AI Onboarding assistance (§15), meaningful HR Compliance Calendar coverage for onboarding items.
- **Scheduled-job/notification infrastructure** blocks → Contract-expiry reminders, Certificate-expiry reminders, HR Compliance Calendar, acting-appointment auto-revert, Audit retention automation.
- **Custom Fields/Form Builder** is independent but high-leverage — unblocks organization-specific extension without code changes across every module, consistent with Core Principle #2.
- **CI/CD (OD #21)** blocks → meaningful Security Scanning (§69/§71), a trustworthy Release Pipeline (§96), and is a soft prerequisite for confidently doing any of the P0/P1 work above at volume.
- **Control Plane (OD #29, deferred)** blocks → Commercial Model enforcement, Fleet Health, Update/Fix Pipeline, AI-over-Control-Plane, Demo Factory's org-tagging — all correctly sequenced behind it and not started.
- **Audit event-model fields (request ID, outcome) and DB tamper protection** are prerequisites for a credible Production Security Gate (§16) and Enterprise Readiness Gate (§16).
- **AI Layer (§13)** depends on: stable permission/audit foundation (already exists), Documents & Records decision (for AI Documents scope), Onboarding engine (for AI Onboarding scope), Control Plane (for AI Control Plane scope, deferred).

---

## 22. Owner Decisions — Consolidated

| # | Decision | Priority | Recommendation |
|---|---|---|---|
| 1 | Deprecate or formally document legacy `users.role`/`organizationId` | P0 | Document as bootstrap-only, or retire |
| 2 | First-class "acting appointment" primitive | P2 | Build only if temporary-coverage need is real |
| 3 | Third-party extension/plugin framework in scope? | P3 | Recommend NOT REQUIRED for now |
| 4 | Documents & Records subsystem shape | P1 | Option 3 — shared plumbing, separate tables |
| 5 | Formal Skills competency framework | P2/P3 | Defer until requested |
| 6 | Acting/secondment as `employment_periods` event type | P2 | Build once scheduled-job infra exists |
| 7 | Succession/Talent — confirm scope vs. existing Talent Pools | P2 | Clarify naming; build new schema if truly needed |
| 8 | Contract expiry/renewal modeling location | P1 | `employment_periods` events (reuse working infra) |
| 9 | Disciplinary stages + separate Grievance schema | P1 | Build both |
| 10 | HR Service Requests — generic vs. per-type | P2 | Per-type, following proven precedent |
| 11 | Employee Data Change Approval — reuse Inventory shape, configurable sensitive-field list | P1 | Yes to both |
| 12 | Offboarding clearance — structured stages + FK to Assets/PIF | P1 | Build |
| 13 | Scheduled-job/notification infrastructure | P1 | Build — unblocks 4+ other items |
| 14 | Shared Workflow/Approval primitive extraction | P2 | Option C — authority-resolver only, not a full engine |
| 15 | Generalize Office Inventory's delegation table | P2 | Yes, sequenced with #14 |
| 16 | DB-level audit tamper protection | P1 | Build now |
| 17 | Category-scoped audit-read permissions | P1 | Build |
| 18 | Extend read-audit beyond Payroll | P1 | Yes — Personnel Files, disciplinary records |
| 19 | Audit retention policy | P2 | Explicit Owner sign-off required |
| 20 | Platform-level user disablement | P1 | Build |
| 21 | CI provider + scanner set | P0 | GitHub Actions; typecheck/build/test first, then SCA/secret-scan/SAST |
| 22 | Data-protection/retention jurisdiction & purge model | P1 | Confirm jurisdictions; manual/supervised purge initially |
| 23 | Field-level masking for sensitive statutory/banking data | P1/P2 | Owner risk-acceptance call required |
| 24 | First AI provider + data terms | Future | Hosted provider, confirmed no-training terms, behind `AiProvider` interface |
| 25 | AI Level-3 confirmation UX | Future | Distinct confirm screen initially |
| 26 | AI log retention | Future | Permanent structured audit row; short-retention raw transcript, separately |
| 27 | Shared vs. dedicated hosting default | P2 | Shared-by-default |
| 28 | Subscription vs. one-time-license | P2 | Support both; default subscription |
| 29 | Control Plane build timing | Deferred | Defer until a second installation is actually needed |
| 30 | Docker containerization timing | P1 | Start now, independent of Control Plane |

**TOTAL OWNER DECISIONS REQUIRING APPROVAL: 30**

---

## 23. Freeze Checklist

- [ ] Architecture (multi-org, extension framework scope, Documents & Records shape) — approved
- [ ] Module map (§17) — approved
- [ ] Workstream plan and priorities (§20) — approved
- [ ] Audit model (§11) — approved
- [ ] AI model (§13, proposal only) — approved for future build, not started
- [ ] Security model (§12, §16) — approved; Security Verification Workstream and Production Security Gate scheduled separately
- [ ] Commercial model (§14) — approved; Control Plane build deferred per OD #29
- [ ] Control Plane (§14) — deferred, not started
- [ ] Deployment model (§15) — Docker approved to start now; CI/CD approved to start now; VPS automation/release pipeline sequenced after
- [ ] Backup/restore model (§15) — target architecture noted; build deferred to infra decision
- [ ] Update/fix model (§15) — deferred behind Control Plane and CI
- [ ] Owner Decisions (§22, 30 items) — awaiting explicit answers
- [ ] WWM configuration — explicitly NOT started, deferred to post-platform-completion (§19)

**STOP AFTER OWNER REVIEW**, per the brief's own instruction. No Workstream 1 implementation, no schema, no migrations, no WWM configuration, no module enablement, no production deployment, no Control Plane, no AI, no demo environments, no deployment automation, and no production fixes have been started or will be started until the Owner Decisions above are explicitly answered and this document is approved.
