# Enterprise HRMS — Master Owner Review

**Status: OWNER REVIEW — APPROVED / ARCHITECTURE FROZEN**

Mode: Discovery / Reconciliation / Owner Review / Architecture / Security Architecture / AI Architecture / Commercial Platform / Deployment Architecture / Owner Decision Recording / Architecture Freeze / Roadmap Reconciliation / **Documentation Only**. No application code, schema, migration, or WWM configuration was changed to produce this document, in either the discovery pass or this freeze pass. The discovery pass gathered findings from nine parallel, independent, read-only investigation passes (Foundation & Access Control; Employee Lifecycle Extensions; Documents, Records & Bulk Import; Platform Primitives; Workforce Operations Modules; Audit Architecture; Security Architecture; AI Architecture; Commercial/Control Plane/Deployment/Backup) plus direct reading of `docs/GHANA_HR_EMPLOYEE_LIFECYCLE_RECONCILIATION.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `MODULES.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `OPERATIONS.md`. This freeze pass records the Owner's 31 approved decisions against that discovery, recalculates the workstream roadmap against them, and identifies (without starting) the exact first implementation workstream.

**The single largest cross-cutting finding of the discovery pass**: the existing recruitment/onboarding/probation discovery already performed in `docs/GHANA_HR_EMPLOYEE_LIFECYCLE_RECONCILIATION.md` was not duplicated — its findings are incorporated by reference throughout §6 below.

**What changed in this freeze pass, at a glance**: all 30 prior Owner Decisions are now approved (27 unchanged, 3 changed materially: HR Service Requests, Data Retention/Purge jurisdiction framing, and Control Plane timing); one new decision was added (**Owner Decision #31 — Break-Glass / Emergency Administrative Access**); Skills/Competencies, Succession, and Acting Appointments are firmed onto the P2 roadmap (not indefinitely deferred); Sensitive-Field Masking is firmed to **P1**; the Control Plane's **foundation/installation-registry layer** is now required **before the first formal production deployment**, while the full fleet-management UI remains deferred; and the 43-item workstream list is recalculated into 19 coherent, dependency-ordered workstreams plus one parallel operational track.

---

## 1. Repository Checkpoint & Reconciliation

- Discovery-pass checkpoint: `local main == origin/main` at `baf5b68`, then the discovery document was committed and pushed at `0a61b86` (`docs(hrms): master enterprise platform owner review`).
- This freeze pass reconciled again before writing: `git fetch origin` + `git rev-parse HEAD`/`origin/main` both resolve to `0a61b86`, confirmed clean — **no concurrent work has landed since the discovery pass**, nothing to reconcile.
- Working tree at the start of this pass: one pre-existing, unrelated modified file (`artifacts/mockup-sandbox/src/.generated/mockup-components.ts`, disclosed since before the discovery pass) and the same pre-existing untracked items (`.agents/skills/`, `.claude/`, `CLAUDE.md`, `CONTRIBUTING.md`, `artifacts/api-server/uploads/`, `skills-lock.json`) — none created or touched by this pass.
- No migration created. `ROADMAP.md`/`MODULES.md` re-checked for contradiction with this pass's changes — none found requiring correction. Left untouched.

---

## 2. Product Identity & Multi-Organization Architecture

Product is **Enterprise HRMS** — a configurable, multi-tenant HR ERP. Ghana law/CIHRM practice inform design; they are not product branding. No user-facing "Ghana HR"/"WWM HR" naming exists anywhere in the codebase.

**Hardcoding check (repo-wide grep for `WWM`, across `lib/`, `artifacts/api-server/src`, `artifacts/hrms/src`)**: every hit is a code comment documenting an organization-neutral design decision, a negative-guarantee comment, test fixture data, or a seed-file comment stating a decision applies "for any organization, including WWM." **Zero instances of `if (organization === "WWM")` or any WWM-specific conditional branch exist in production code.** Classification: **COMPLETE AND SURFACED**.

**Multi-tenancy today** is single-installation: one Express process + one Postgres database serve every organization, isolated by `organizationId` scoping (enforced in `requireMembership.ts`, re-verified per request) plus hostname resolution. Two organizations (WWM, Acme) already coexist safely in the same database, proving the isolation model. Dedicated single-tenant deployment is a documented **topology decision**, not a distinct code path.

**Owner Decision #22's approved framing applies here too**: Ghana is the initial legal/operational baseline because current target organizations are Ghana-based, but the architecture must support jurisdiction/configuration metadata rather than hard-coding Ghana into the product — consistent with, and reinforcing, this section's own finding.

---

## 3. Existing Module Map — Foundation

Classification against the platform's own "Definition of Complete" (schema + migration + API + permission enforcement + validation + OpenAPI + generated clients + frontend + CRUD + org isolation + audit logging + tests + docs).

| Module | Classification | Evidence | Residual gap / Owner Decision status |
|---|---|---|---|
| Authentication | COMPLETE AND SURFACED | `auth.ts`, `requireAuth.ts`, `sessions` table (Bearer token, 7-day TTL), real server-side logout | No MFA/SSO (see §12) |
| Organization Management | COMPLETE AND SURFACED | `organizations.ts`, `organizations.tsx`, tenant-hostname resolution | none |
| Organization Settings | COMPLETE AND SURFACED, audit coverage uneven | `organization-settings.ts` — validated, versioned Configuration Engine per ADR-009, 6 live namespaces | Only `numbering` namespace audit-logged on change; folded into **Owner Decision #16/#17** scope (audit hardening) |
| Module Management | COMPLETE AND SURFACED | `modules.ts` + `organization-modules.ts` + `requireModuleEnabled` + audited enable/disable | none structural |
| User Management | PARTIAL — dual identity model | Current model: `organization_memberships`+`membership_roles`+`roles`/`permissions`. Legacy `users.role`/`users.organizationId` still read by `isSuperAdmin()` | **OWNER DECISION #1 — APPROVED WITH CHANGE.** Not a permanent parallel authorization source; determine a safe compatibility/migration path and retire from normal authorization after verification. Not removed in this documentation pass. |
| Roles & Permissions | COMPLETE AND SURFACED | System role templates, org-level custom roles via `copyRoleTemplate` (audited) | none |
| Membership Management | COMPLETE AND SURFACED | `organization-memberships.ts`, invite/accept flow (audited) | none |
| Branches / Departments / Positions | COMPLETE AND SURFACED | Full CRUD + `/restructure`, archive/reactivate, tested | none |
| Master Data | COMPLETE AND SURFACED | Real classification enum per ADR-010, 28 domains seeded | none |
| Org Structure & History | COMPLETE AND SURFACED — strongest area in the audit | `department-heads.ts`: effective-dated, DB-enforced, full point-in-time API; pattern reused across 7+ schema files | **OWNER DECISION #2 — APPROVED FOR ROADMAP, P2.** Acting appointments are a valid enterprise HR capability; must be organization-configurable, effective-dated, with authority/history and eventual restoration to the substantive position. Not built now. |

**Foundation summary**: unchanged from discovery — genuinely COMPLETE AND SURFACED, with the identity-model resolution (OD #1) and audit-coverage uniformity (OD #16/#17) as the two live threads carried into the roadmap.

---

## 4. Custom Fields, Form Builder & Extension Framework

**Custom Fields & Form Builder (§37, brief-mandatory) — GENUINELY MISSING, confirmed by exhaustive grep.** No field-type registry, validation storage, scope binding, conditional visibility, versioning, or entity-attachment mechanism exists. **Priority P1**, unchanged — not addressed by this Owner Decision set (no OD number was ever attached to it; it remains mandatory per the original brief).

> **→ See §24 — WS-8 Workstream Scope Clarification (2026-08-27).** The brief's §37 detail is not present in this repository, so WS-8's scope was extracted from this document and found to be under-specified on every material question. The Owner has since recorded a dedicated scope clarification for WS-8. §24 is the authoritative scope for that workstream; this section's classification (GENUINELY MISSING, P1) is unchanged by it.

**Organization Customization / Extension Framework (§7) — OWNER DECISION #3 — DEFER.** Do not build a public/general third-party plugin ecosystem now. Use configuration, optional modules, feature flags, organization extensions, and deployment-specific integrations instead. A general plugin marketplace/framework may be reconsidered later. This is unchanged from the discovery pass's recommendation.

**Configuration Governance (§49) — PARTIAL.** Folded into the audit-hardening workstream (OD #16/#17).

---

## 5. Documents & Records Architecture

**OWNER DECISION #4 — APPROVED.** Use shared document infrastructure for storage, security, versioning, access control, audit, retention, and metadata primitives, while allowing appropriate domain-specific tables/records. **Do not duplicate Personnel Files.** This approves the discovery pass's Option 3 recommendation (shared plumbing via `fileStorage.ts` + `documentValidation.ts` + a shared `document_category` Master Data domain, separate ownership tables for `employee_documents`/`candidate_documents`), and explicitly extends the shared layer's scope to include **versioning and retention as first-class shared primitives** — not just storage/validation as originally scoped, closing part of the "genuinely missing platform-wide" gap list from the discovery pass (no versioning/supersession, no retention/disposal workflow) as part of the same decision rather than as separate future items.

**What's genuinely missing, now folded under OD #4's approved scope**: required/verified/expiry checklist concept; retention/disposal/archive workflow; document versioning/supersession; a generic org-level (non-employee) document upload surface; and **document generation** (zero template/rendering engine anywhere — `offers.letterTemplateId`/`generatedDocumentStorageKey` remain reserved and unpopulated). Document generation is the single root cause blocking every letter type in §31 (appointment/confirmation/promotion/transfer/warning/service/separation) and remains **P1**.

`personnel_files`/`personnel_file_volumes`/`personnel_file_movements`/`records_locations` model physical custody only, zero column overlap with digital-document tables — stays isolated per the Owner's explicit "do not duplicate Personnel Files" instruction.

---

## 6. Core Employee Lifecycle (Recruitment → Separation)

Unchanged from the discovery pass — drawn directly from `docs/GHANA_HR_EMPLOYEE_LIFECYCLE_RECONCILIATION.md`, not re-researched, no Owner Decision in this freeze pass altered its findings.

| Area | Classification | Key finding |
|---|---|---|
| Manpower/staffing need | COMPLETE | `job-requisitions.ts`, full requisition model |
| Recruitment authorization | PARTIAL | Single-step, org-wide permission-gated only; reserved `sequence` column implies multi-step was intended but never built |
| Vacancy/position | COMPLETE, but publication-gated | No HR-driven manual-entry path exists without `vacancy.status='published'` |
| Candidate sourcing | CONFIGURATION-ONLY BY DESIGN, EFFECTIVELY MISSING | Only two literal source values ever written |
| Interviews | PARTIAL | Scheduling/scorecards solid; no numeric consolidated rollup; external-panelist submission reserved but not built |
| Selection / approval to hire | PARTIAL | "Selected" and "authorized to employ" are conflated into one gate |
| Offer/appointment | PARTIAL | Rich versioning/approval; zero document generation; no branding/signatory/structured particulars |
| Candidate→Employee conversion | COMPLETE, structurally sound | Single authoritative path, DB-enforced no-duplication |
| Employee numbering | COMPLETE | Generic, organization-configurable, must never be duplicated |
| PIF/Personnel File | COMPLETE | Physical custody only |
| Employee documents (checklist) | PARTIAL/MISSING | Now folded under OD #4 — narrowed by §26.1: WS-5's `document_requirements` already supplies the required/provided/verified/expiry primitive |
| Statutory/SSNIT handling | COMPLETE, permission-gated + audited | Field-level masking now **P1** per OD #23 |
| Handbook/policy acknowledgement | MISSING | Zero "handbook" hits anywhere — **WS-10 scope frozen in §26** (§26.17: WS-5 document + acknowledgement layer) |
| Job description | CONFIGURATION-ONLY | Lives only on transient `vacancies` |
| Induction/orientation | MISSING, deliberately descoped historically | **WS-10 scope frozen in §26** (§26.22: specialization of the checklist engine, not a separate engine) |
| ESS activation | COMPLETE as mechanism; no onboarding-completion gate | No such signal exists anywhere — **§26.23 freezes this as deliberate: WS-10 introduces no ESS gate** |
| Onboarding workflow/checklist | MISSING | No task/checklist engine anywhere — **WS-10 scope frozen in §26** |
| Probation | PARTIAL, more built than assumed | Real `confirmEmployee()` mechanism; no duration engine, no extension-as-event — **WS-11 architecture frozen in §27** (§27.8 unsuccessful outcome never auto-separates; §27.9 extension-as-event) |
| Probation review | Linked to Performance correctly | — |

**Genuine platform gaps** (ranked, unchanged): (1) publication-free candidate capture; (2) offer acceptance/decline; (3) onboarding checklist engine; (4) induction; (5) handbook acknowledgement; (6) document generation (unblocks #1's Ghana-compliance dimension, #5, and all §31 HR Letters); (7) candidate-source configurability; (8) employee-document checklist; (9) multi-step approval chains; (10) offer particulars for Ghana Schedule I; (11) `reportingManagerId` not carried through conversion; (12) field-level masking on SSNIT/TIN/bank details (**now P1**, OD #23).

**Do not rebuild**: employee numbering engine, PIF/personnel-file model, candidate→employee conversion path, probation/confirmation mechanism, probation-review-Performance linkage, statutory identifiers, Recruitment's stage/pipeline architecture, Assets/Office Inventory custody, Separation/exit architecture.

> **→ See §25 — WS-9 Workstream Scope Clarification (2026-08-27).** The Recruitment slice of the gap list above (publication-free capture, offer accept/decline, source configurability, the approval-chain question, and Schedule 1 particulars) left several implementation questions genuinely open — most consequentially whether multi-step approval chains should be built at all, and whether offer status should gate conversion. The Owner has recorded a dedicated scope clarification for WS-9. §25 is the authoritative scope for that workstream; the classifications in this section are unchanged by it.

---

## 7. Employee Lifecycle Extensions (§23–§36) — Owner Decisions Recorded

| # | Capability | Discovery Classification | Owner Decision | Approved disposition |
|---|---|---|---|---|
| 23 | Training & Development | ALREADY IMPLEMENTED as Learning module | — (no OD needed) | Unchanged; dev-plans layer remains P3 |
| 24 | Skills / Competencies | ALREADY IMPLEMENTED (base) | **OWNER DECISION #5 — APPROVED FOR ROADMAP, P2.** Do not defer indefinitely. Support skills inventory, competency frameworks, role competencies, proficiency, assessment, gaps, development linkage, Recruitment linkage, Succession linkage. Organizations may choose whether to enable/use it. | Firmed onto the P2 roadmap, not left open-ended — **WS-14 architecture frozen in §30**; §30.1 corrects “ALREADY IMPLEMENTED (base)” to *a free-text proficiency string with no scale, verification, assessor, evidence, expiry or history*, and §30.2 keeps one Skills catalogue rather than minting a second “competency” entity beside Performance’s shipped one. **Implemented under WS-14** (ledger `0070`, §30.30) — see `docs/SKILLS_AND_SUCCESSION.md` |
| 25 | Career & Internal Mobility | ALREADY IMPLEMENTED (permanent transfers) | **OWNER DECISION #6 — APPROVED FOR ROADMAP, P2.** Reuse `employment_periods` architecture. Support effective-dated acting appointments, secondments, temporary assignments. Sequence after the scheduling/notification foundation. | Approved, sequencing condition set explicitly — **implemented under WS-11, architecture frozen in §27** (§27.12 acting, §27.13 secondment, §27.14 the four distinct concepts) |
| 26 | Succession / Talent | GENUINELY MISSING (internal-employee sense) | **OWNER DECISION #7 — APPROVED FOR ROADMAP, P2.** Do not treat existing Talent Pools as automatically equivalent to Succession. Preserve existing capability (recruitment Talent Pools, unchanged). Add Succession only for genuinely missing concepts: critical roles, successors, readiness, development gaps, succession plans. Avoid duplication. | Approved; naming/scope confusion explicitly resolved — **WS-14 architecture frozen in §30** (§30.11 critical positions only, §30.12 an unranked pool with no numeric ranking, §30.13 human-owned readiness with no potential score and no 9-box, §30.16 succession never mutates employment state, §30.17 confidential and withheld from Organization Admin by default). **Implemented under WS-14** (ledger `0070`, §30.30) — see `docs/SKILLS_AND_SUCCESSION.md` |
| 27 | Contract / Employment Term Mgmt | PARTIAL | **OWNER DECISION #8 — APPROVED.** Reuse `employment_periods`/existing employment-history infrastructure. Support expiry, renewal, extension, amendment, reminders, historical integrity. | Approved unchanged — **implemented under WS-11, architecture frozen in §27**; §27.1 corrects "PARTIAL" to *no contract term model exists at all*, and §27.5 records that `employment_periods` alone cannot hold a live term |
| 28 | Employee Relations / Grievance | PARTIAL (disciplinary log only, no grievance) | **OWNER DECISION #9 — APPROVED.** Disciplinary cases and grievances are distinct business concepts. May share document infrastructure, evidence infrastructure, security primitives, audit — but must not be conflated into one record type. | Approved unchanged; confirms two separate schemas — **implemented under WS-12, architecture frozen in §28** (§28.2 legacy disciplinary history preserved, never rewritten; §28.4 grievance is a distinct schema; §28.5 explicit ESS visibility model) |
| 29 | Employee Welfare | GENUINELY MISSING | — (no OD; brief instructs no medical records) | Unchanged, P3 |
| 30 | Benefits | GENUINELY MISSING | — (no OD) | Unchanged, P2/P3, must not duplicate compensation components |
| 31 | HR Letters | GENUINELY MISSING (root cause: no document generation) | Owned by OD #4 | Unchanged, P1 |
| 32 | HR Service Requests | GENUINELY MISSING as generic mechanism | **OWNER DECISION #10 — APPROVED WITH CHANGE.** Do not build every simple HR request as an unrelated implementation. Design a configurable shared HR Service Request foundation for suitable requests (employment letter, document request, HR inquiry, simple organization-defined requests). Where a request has specialized domain behavior, approvals, or legal/business logic, keep the specialized domain workflow. Do not create a giant generic workflow engine. | **Changed** from "per-type, following precedent" to a hybrid: shared foundation for simple/generic requests, specialized workflow preserved where warranted — **implemented under WS-13, architecture frozen in §29** (§29.12 request lifecycle and configuration; §29.5 specialized workflows stay specialized; §29.13 letters generate through WS-5, never a second engine) |
| 33 | Employee Data Change Approval | GENUINELY MISSING | **OWNER DECISION #11 — APPROVED.** Use a proven request/approval shape. Sensitive fields must be configurable. Preserve requested value, previous value where appropriate, verification, approval/rejection, effective update, actor, timestamps, audit/history. | Approved unchanged — **implemented under WS-13, architecture frozen in §29**; §29.1(2) corrects “GENUINELY MISSING” to *employees cannot change their own record at all today, so the request IS the path*, §29.2 admits both ESS and HR origins through one architecture, §29.3 confines it to an explicit eligible-field registry, and §29.6 enforces maker-checker server-side |
| 34 | Offboarding / Clearance | PARTIAL (thin) | **OWNER DECISION #12 — APPROVED.** Build structured clearance integrated with authoritative owning modules (Assets, Office Inventory, Personnel Files/Documents, IT/access, department clearance, HR, Payroll handoff). Do not duplicate those modules' records. | Approved unchanged — **implemented under WS-12, architecture frozen in §28**; §28.1 corrects "PARTIAL (thin)" to *three booleans with no clearance items at all*, §28.6 permits offboarding to begin from a recorded separation basis, §28.7 freezes that offboarding never terminates employment, and §28.9–28.10 keep Assets and Office Inventory observe-only |
| 35 | Workplace Incidents | GENUINELY MISSING | — (no OD) | Unchanged, P2, must stay separate from Assets/Inventory incidents |
| 36 | HR Compliance Calendar | GENUINELY MISSING | — (no OD; depends on OD #13) | Unchanged, P2 |

**OWNER DECISION #13 — Scheduled Jobs / Notifications — APPROVED, HIGH PRIORITY P1.** Build a shared scheduling/notification foundation because multiple capabilities depend on it (reminders, deadlines, overdue events, safe scheduled processing). This is the single highest-leverage employee-lifecycle-extension decision — it unblocks OD #6 (acting/secondment auto-revert), OD #8 (contract-expiry reminders), item 36 (Compliance Calendar), and audit retention automation (OD #19), all of which the discovery pass had independently flagged as blocked on "no scheduled-job infrastructure exists anywhere in this platform."

---

## 8. Platform Primitives (§38–§48)

Discovery findings unchanged (Tasks/Notifications engine missing per OD #13 above; Global Search/Employee 360 partial; HR Action Centre missing, P1; ESS complete; Manager/Department Head partial; Reporting partial with a CSV formula-injection gap, P1).

**OWNER DECISION #14 — Shared Approval Primitive — APPROVED.** Use the restrained architecture: shared authority-resolution/delegation primitives where justified. Do **not** replace working domain workflows (Leave's two-stage, Payroll's maker-checker, Recruitment's requisition/offer approvals) with one giant generic workflow engine. This approves the discovery pass's Option C recommendation exactly — extract only the authority-resolution/delegation half, leave each module's own approval state machine bespoke.

**OWNER DECISION #15 — Delegation — APPROVED.** Generalize the proven delegation concept (currently Office Inventory-only: effective-dated, revocable, DB-enforced single-open-delegation, live-revalidated) beyond Office Inventory where appropriate. Sequence with OD #14. Authority must remain effective-dated, scoped, revocable, and auditable.

---

## 9. Bulk Import / Organization Migration (§43, brief-mandatory)

Unchanged from discovery — **PARTIAL**, no Owner Decision needed (mandatory per the original brief, not a discretionary item). The existing importer handles employees + current staff/PIF numbers only; §43 requires organizational structure, employment history, qualifications, certifications, leave balances, and Payroll opening balances as importable entities, none of which exist today. **Priority P0**, unchanged — the widest gap-to-mandate distance found in the whole review.

---

## 10. Workforce Operations Modules

Unchanged from discovery.

| Module | Classification | Status |
|---|---|---|
| Attendance / Leave / Performance / Learning / Assets / Manager Portal / ESS-completion / Personnel Records | COMPLETE AND SURFACED | Fully shipped, zero residual defects at their respective final verifications |
| Office Inventory | COMPLETE AND SURFACED | Enabled for WWM only, deliberately `hidden`/`defaultEnabled:false` platform-wide otherwise |
| Payroll | COMPLETE (code) / CONFIGURATION ONLY (not operable) | No real Ghana statutory figures seeded; module correctly remains `hidden` pending legal/accounting sign-off — **P1 operational task**, not architecture |

`PROJECT_STATUS.md`'s own "Current Phase" marker remains stale (a W119-dated snapshot); true state is unchanged from the discovery pass — all ten roadmap modules functionally complete, Payroll and Office Inventory both deliberately gated.

---

## 11. Audit Trail Architecture (§50–§58) — MANDATORY PLATFORM CAPABILITY

**A real, substantial foundation exists** — `recordAuditEvent()` has 337 confirmed production call-sites across ~99 files. Route surface is one endpoint, gated by a single flat `audit.read` permission, append-only at the application layer (no PATCH/PUT/DELETE anywhere).

**Confirmed real gaps and their approved dispositions**:

1. Login/logout/password-reset not audited — **P0**, folded into OD #16/#17 hardening scope.
2. **OWNER DECISION #16 — DB-level audit tamper protection — APPROVED, P1.** Strengthen the existing audit architecture. Do **not** create a second audit system. Critical audit records must be append-oriented and protected from ordinary application mutation/deletion. Determine appropriate DB-level protection (trigger or REVOKE-based) as an implementation detail of this decision, not a separate open question.
3. **OWNER DECISION #17 — Audit read permissions — APPROVED, P1.** Introduce category/sensitivity-aware audit-read authorization. Basic HR access must not automatically expose Payroll, security, or other sensitive audit information.
4. **OWNER DECISION #18 — Sensitive read auditing — APPROVED AND EXPANDED.** Review read-auditing for: Personnel Files; disciplinary/grievance evidence; sensitive report exports; banking information; statutory identifiers; **privileged support access**; other highly sensitive records. Use risk-based auditing — do not create noise by auditing every harmless page view. The "privileged support access" item is the audit-side half of **Owner Decision #31** (Break-Glass Access, below) — this decision's scope now explicitly includes recording who accessed a customer environment, why, when access started/ended, what privileged capabilities were used, and what sensitive records were accessed or changed during a break-glass session.
5. Missing model fields (request ID, outcome, severity, reason, `deployment_id`) — folded into OD #16/#17 implementation scope; request-ID and outcome remain the most load-bearing.
6. No date-range filter/export endpoint — folded into OD #17 implementation scope.
7. **OWNER DECISION #19 — Audit retention — APPROVED WITH CONFIGURABLE POLICY.** Audit retention must support legal, contractual, organization, and deployment requirements. Do **not** hard-code one universal retention duration. Ordinary users must not be able to shorten protected retention and silently destroy required history. Support legal-hold/retention safeguards where required.
8. Audit + AI / Audit + Control Plane — forward-looking; AI audit integration unchanged (§13); **Control Plane audit integration is now more concrete** given OD #29's change — see §14.

**Break-glass audit requirement (Owner Decision #31, recorded in full in §14)**: the audit architecture must be capable of showing who accessed a customer environment under break-glass, why, start/end timestamps of the elevated session, what privileged capabilities were used, what sensitive records were accessed where required, and what records/actions were changed. This is a new, explicit requirement on the audit event model (likely new `event_type` values such as `support_access.granted`/`.revoked`/`.action` and a `deployment`/organization-scoped elevated-session identifier) — folded into OD #16/#17's implementation scope rather than treated as a separate audit redesign.

---

## 12. Security Architecture (§59–§74, §124–§125)

No live credentials found anywhere in the repository (unchanged).

| Area | Discovery Classification | Owner Decision status |
|---|---|---|
| §59 Security administration | PARTIAL — no platform-level user disable/lockout flag | **OWNER DECISION #20 — APPROVED, P1.** Build platform-level account disablement/revocation suitable for compromised accounts, departed users, security incidents, administrative suspension. Ensure session/token implications are addressed. |
| §60 Privacy/retention/legal hold | GENUINELY MISSING as formal policy | **OWNER DECISION #22 — APPROVED WITH CHANGE.** Ghana is the initial legal/operational baseline because current target organizations are Ghana-based. Architecture must still support jurisdiction/configuration metadata rather than hard-coding Ghana into the product. Begin with supervised/manual controlled purge, including authorization, preview, legal hold, audit, retention checks, and protection against accidental destruction. |
| §65 Authn/session security | PARTIAL — reset endpoints unrate-limited | Folded into OD #20's implementation scope |
| §67 Sensitive data | Confirmed — no field-level masking anywhere | **OWNER DECISION #23 — APPROVED, P1.** Do not risk-accept this away. Review permission-aware masking/reveal controls for banking information, statutory identifiers, and other high-sensitivity identifiers. Possession of general employee access must not automatically imply full visibility of every sensitive field. Reveal actions should be considered for sensitive-read auditing where appropriate (cross-references OD #18). |
| §69/§71 Security scanning / CI-CD security | GENUINELY MISSING — zero CI of any kind exists | **OWNER DECISION #21 — APPROVED, P0.** Use GitHub Actions as the initial CI platform. Establish typecheck, tests, build — then add dependency/SCA scanning, secret scanning, SAST. DAST and deeper security verification belong in the dedicated Security Verification Workstream (§16), not this decision's scope. |
| §73 Vulnerability management | GENUINELY MISSING as a process; one flagged open item | Unchanged — the flagged production Supabase RLS assessment (`docs/SUPABASE_SECURITY_REMEDIATION.md`) remains an urgent, standalone action item, independent of any Owner Decision, tracked in the workstream plan (§20). |
| §63/§64 Tenant isolation / IDOR (architecture) | COMPLETE AND SURFACED at pattern level; live testing not performed | Unchanged — remains a dedicated future Security Verification Workstream item, **P0**. |
| §124/§125 Verification workstream / Production gate | Forward-looking by design | Unchanged — defined in §16, not satisfied by this document. |

All other §12 findings (OWASP architecture review, file/document security, secret management, business-logic security, SBOM, incident response) are unchanged from the discovery pass and carried forward without a new Owner Decision.

---

## 13. AI Architecture (§75–§86)

**Confirmed: no AI capability exists anywhere in this codebase today.** Everything below remains a forward-looking architecture proposal — approved as architecture, not authorized for implementation.

**OWNER DECISION #24 — AI Provider — ARCHITECTURE APPROVED.** Do **not** permanently lock the HRMS to one provider now. Use an `AiProvider` abstraction (reusing ADR-017's `EmailProvider`/`ResendEmailProvider` shape exactly, as the discovery pass proposed). The first production provider will be selected during the AI **implementation** workstream, based on current privacy terms, no-training/data-use commitments, contractual terms, security, capability, availability, and cost. Core HRMS must continue operating with AI disabled/unavailable. This changes the discovery pass's specific recommendation ("start with one hosted provider under a confirmed no-training agreement") into an approved abstraction with the concrete provider choice deferred to implementation time, when current market terms can actually be evaluated.

**OWNER DECISION #25 — AI Level-3 confirmation — APPROVED.** AI-assisted mutating business actions require an explicit confirmation experience initially. At execution time: recheck authorization, recheck current state, validate normal domain rules, execute the existing domain service, audit the action. Matches the discovery pass's recommendation (distinct confirm-and-restate step) exactly.

**OWNER DECISION #26 — AI log retention — APPROVED.** Use durable structured audit metadata where required; shorter-retention raw AI conversation/transcript data; data minimization; configurable retention. Do not unnecessarily retain sensitive prompts indefinitely. Matches the discovery pass's recommendation exactly.

The Tool Gateway architecture (`User → AI → Permission-Aware Tool Gateway → Existing Domain Services → Database`), the four-tier action risk model, and the per-section proposals (§75–§86) are unchanged and remain the approved target design for whenever the AI implementation workstream is authorized. **Not started, per the boundary in §23.**

---

## 14. Commercial Model & Control Plane

**OWNER DECISION #27 — Hosting default — APPROVED WITH QUALIFICATION.** Shared hosting may be the normal commercial default. Also support dedicated VPS, dedicated database, dedicated cloud deployment, and customer-owned VPS/cloud where contractual, isolation, performance, or security requirements justify it. Separate hosting must not require a separate source repository (already architecturally true — same unmodified codebase per topology decision, §2).

**OWNER DECISION #28 — Commercial Model — APPROVED.** Support (A) subscription, (B) one-time/perpetual license, (C) separate maintenance/support contract. Subscription may be the default commercial offering. Licensing, hosting, and maintenance are separate concepts — matches the discovery pass's data-model recommendation exactly.

**OWNER DECISION #29 — Control Plane — CHANGED.** Do **not** build the full Control Plane UI now. However: **the Control Plane foundation / installation registry must exist before the first formal production deployment.** Every installation/deployment should have durable operational identity. At minimum, review/plan fields for: installation ID, customer, organization(s), environment, hosting model, hosting provider/profile, domain, application release/version, Git commit, migration version, extension profile, deployment date, backup policy, health endpoint/status, security/update status. The full fleet-management UI can remain deferred until multiple installations make it useful. **Do not retrofit basic deployment identity after many customers already exist.**

This is a material change from the discovery pass's original recommendation (full defer until a second installation is needed). The new position separates two things the discovery pass had bundled together: a lightweight **installation-identity/registry schema** (small, cheap, and exactly the kind of thing that's expensive to retrofit later) versus the **full fleet-management UI/operations product** (genuinely speculative until there's more than one installation to manage). Only the latter remains deferred.

**OWNER DECISION #31 — Break-Glass / Emergency Administrative Access — NEW, APPROVED PRINCIPLE.**

- **Question**: how should platform-owner (`super_admin`) access to a customer's actual HR data be governed, given it currently has no special controls beyond the existing cross-org bypass?
- **Repository evidence**: `isSuperAdmin()`/`canAccessOrganization()` (`authorization.ts`) is today a blanket, always-on cross-organization bypass with no invocation step, no reason capture, no time limit, and no distinct audit trail beyond whatever the underlying route itself logs.
- **Approved principle**: Platform-owner status must **not** automatically grant unrestricted everyday access to customer HR information. Design controlled emergency/support access. Where privileged customer-data access is necessary, require appropriate: explicit invocation; reason; exact customer/organization; scoped permissions; time limitation where practical; visible elevated-session state; audit; sensitive-read audit where appropriate; start/end timestamps; revocation; post-access traceability.
- **Audit capability required** (cross-referenced into §11 OD #18): the audit trail must be able to show who accessed the customer environment, why, when access started, when access ended, what privileged capabilities were used, what sensitive records were accessed where required, and what records/actions were changed.
- **Explicitly rejected**: unrestricted platform-owner impersonation (today's de facto state).
- **Impact**: this decision converts today's blanket `isSuperAdmin()` bypass from an implicit, always-available capability into an explicitly-invoked, scoped, time-boxed, audited session — a real authorization-model change, not just a documentation note. It is sequenced with OD #29's installation-registry foundation because a "which customer, for how long, why" grant needs somewhere durable to be recorded.
- **Risk**: HIGH-IMPACT if left undone — an unrestricted, unaudited cross-tenant bypass on a platform whose entire value proposition is tenant isolation is the single largest latent authorization risk this review has identified, worse in kind than any individual gap found in §12.

**§93 Customer Provisioning** — unchanged: the *back half* of this pipeline (Organization Created → Go Live) is already fully implemented and proven; the gap remains the commercial/hosting front half, now sequenced behind OD #29's foundation layer rather than fully deferred.

---

## 15. Deployment, Release & Backup Architecture

**OWNER DECISION #30 — Docker — APPROVED, P1.** Begin containerization in the appropriate roadmap workstream. Docker/containerized deployment should become the standard repeatable deployment model where supported. It is independent of the full Control Plane UI (though it is a natural companion to OD #29's installation-registry foundation, since a registry needs something concrete — a container image + version tag — to track).

**§98–§106 Backups**, **§107–§120 (Fleet Health, diagnostics, update pipeline)**, and **§121–§123 (Configuration Validation / Go-Live Gate / Enterprise Readiness Gate)** are unchanged from the discovery pass, with one sequencing update: Fleet Health, diagnostics, and the update pipeline (§107–§120) are now sequenced behind OD #29's **installation-registry foundation** (which exists earlier than previously planned) rather than behind a full Control Plane UI — they can begin design once the registry schema exists, even though their own UI remains deferred alongside the full Control Plane.

---

## 16. Enterprise Readiness Gate & Production Security Gate (Definitions)

Unchanged from the discovery pass — neither gate is met today, both remain dedicated future workstreams. One addition: the **Production Security Gate** now explicitly includes break-glass access controls (OD #31) and installation-registry-tracked deployment/version identity (OD #29) among its required evidence, since both are now approved architecture rather than deferred-indefinitely items.

---

## 17. Final Module Map

| Module | Existing? | Complete? | Partial? | Deferred/Hidden? | Priority for residual work |
|---|---|---|---|---|---|
| Authentication | Y | Y | | | P2 (MFA/SSO) |
| Organization Management | Y | Y | | | — |
| Organization Settings | Y | | Y (audit coverage) | | P1 (OD #16/#17) |
| Module Management | Y | Y | | | — |
| User Management | Y | | Y (dual identity model) | | **P0 (OD #1 — approved with change)** |
| Roles & Permissions | Y | Y | | | — |
| Membership Management | Y | Y | | | — |
| Branches / Departments / Positions | Y | Y | | | — |
| Master Data | Y | Y | | | — |
| Org Structure & History | Y | Y | | | P2 (OD #2 — acting appointment, approved for roadmap) |
| Custom Fields / Form Builder | N | | | | P1 |
| Extension Framework | N | | | | **DEFER (OD #3)** |
| Documents & Records (unified) | Partial | | Y | | **P1 (OD #4 — approved)** |
| Document Generation | N | | | | P1 (blocks HR Letters) |
| Recruitment | Y | | Y | | See §6 ranked gaps |
| Onboarding checklist/workflow | N | | | | High value, sequenced after OD #13 |
| Handbook/Policy Acknowledgement | N | | | | Medium |
| Induction | N | | | Deliberately descoped historically | Medium |
| Probation/Confirmation | Y | | Y | | Medium |
| Training & Development (Learning) | Y | Y | | | — |
| Skills/Competencies | Y | Y (base) | | | **P2 — APPROVED FOR ROADMAP (OD #5), not indefinitely deferred** |
| Career & Internal Mobility | Y | Y (permanent) | Y (acting/secondment) | | **P2 — APPROVED (OD #6)**, sequenced after OD #13 |
| Succession/Talent | N (internal-employee sense) | | | | **P2 — APPROVED (OD #7)**, distinct from Talent Pools |
| Contract/Employment Term Mgmt | Partial | | Y | | **P1 — APPROVED (OD #8)** |
| Employee Relations (disciplinary) | Y | | Y | | **P1 — APPROVED (OD #9)** |
| Grievance | N | | | | **P1 — APPROVED (OD #9)**, separate schema |
| Employee Welfare | N | | | | P3 |
| Benefits | N | | | | P2/P3 |
| HR Letters | N | | | Blocked on Document Generation | P1 |
| HR Service Requests | N | | | | **P2 — APPROVED WITH CHANGE (OD #10)**, hybrid shared-foundation + specialized-workflow model |
| Employee Data Change Approval | N | | | | **P1 — APPROVED (OD #11)** |
| Offboarding/Clearance | Y | | Y (thin) | | **P1 — APPROVED (OD #12)** |
| Workplace Incidents | N | | | | P2 |
| HR Compliance Calendar | N | | | | P2 |
| Tasks/Notifications/Reminders | N | | | | **P1 — APPROVED, HIGH PRIORITY (OD #13)** |
| Workflow/Approval primitive | Partial | | | | **P2 — APPROVED (OD #14)** — **COMPLETE** (§32.29); authority-resolver only, frozen in §32; discovery found most extraction already shared, so WS-16's remaining scope is one live direct-report helper (§32.9). WS-9/WS-13 stage resolvers stay separate (§32.14) |
| Delegation/Acting Authority | Y (1 module) | | | | **P2 — APPROVED (OD #15)** — **COMPLETE** (§32.29); generalized per §32: new shared `authority_delegations` table for future consumers, `department_head` only, holder-only creation; Office Inventory stays on its own table, unmigrated (§32.20) |
| Global Search / Employee 360 | Y (360) / N (search) | | | | P2/P3 — **Employee 360 COMPLETE** against §31.29 (eight module-aware sections, no giant DTO, no migration), see `docs/EMPLOYEE_360.md`; **Global Search approved as a future safe navigation/discovery capability, NOT implemented** (§31.40) |
| HR Action Centre | Y | | | | P1 — **WS-15 P1 IMPLEMENTED** against §31.4–31.27 (runtime federation, no new table, no new permission); see `docs/ACTION_CENTRE.md` |
| ESS | Y | Y | | | — |
| Manager/Department Head | Y | | | | P2 — **WS-15 P2 IMPLEMENTED** against §31.28; the registered gap (panel membership, outstanding own scorecard, hiring-manager standing) is closed, see `docs/ACTION_CENTRE.md` |
| Reporting/Analytics | Y | | | | P1 (CSV fix — **shipped in WS-1**), P3 — **WS-15 P3 IMPLEMENTED** against §31.30: 46 definitions seeded, all 46 now generically executable (3 built-in runners plus 43 delegated to their owning module), see `docs/REPORTING.md` |
| Bulk Import/Migration | Y | | Y (employees-only) | | P0 |
| Attendance / Leave / Performance / Learning / Assets / Manager Portal / ESS-completion / Personnel Records | Y | Y | | | — |
| Office Inventory | Y | Y | | Enabled for WWM only | — |
| Payroll | Y | Y (code) | | Hidden — statutory data not seeded | P1 (operational) |
| Audit Trail | Y | | Y | | **P1 (OD #16/#17/#18/#19 — all approved)** |
| Break-Glass / Privileged Access | N | | | | **NEW — P0/P1 (OD #31 — new, approved principle)** |
| Security controls | Y (many) | | Y | | **P0/P1 (OD #20/#21/#22/#23 — all approved)** |
| AI Layer | N | | | | Architecture approved (OD #24/#25/#26); implementation not authorized |
| Control Plane Foundation / Installation Registry | N | | | | **P0 — APPROVED, required before first formal production deployment (OD #29 — changed)** |
| Full Control Plane UI / Fleet Management | N | | | | Deferred until multiple installations exist |
| Commercial Model (subscription/license/maintenance) | N | | | | P2 (OD #27/#28 — approved) |
| Demo Factory | Partial (seed pattern only) | | | | Medium |
| Deployment Standardization (Docker) | N | | | | **P1 — APPROVED, start now (OD #30)** |
| CI/CD | N | | | | **P0 — APPROVED (OD #21)** |
| Backup/Restore | N | | | | Deferred to infra decision; benefits from Installation Registry existing first |

---

## 18. Deferred Feature Register

Unchanged from the discovery pass:

| Capability | Original workstream | Reason for deferral | Current status | Disposition |
|---|---|---|---|---|
| Employment-history aggregation into ESS | Phase 2B, W39 | Explicitly deferred | CLOSED at Phase 3F W105 | ALREADY IMPLEMENTED |
| Skills/qualifications/certifications aggregation into ESS | Phase 2B, W39 | Explicitly deferred | CLOSED at Phase 3F W106 | ALREADY IMPLEMENTED |
| Onboarding, orientation, asset assignment, training, probation (as of W58/W59) | Phase 3A closing notes | Explicitly, deliberately descoped in writing | Probation built; Onboarding/Induction still not built | REACTIVATE (Probation, done) / GENUINELY MISSING (Onboarding, Induction) |
| Multi-step requisition/offer approval chains | Recruitment (reserved `sequence` column) | Never implemented | Still single-step | OPTIONAL — confirm original intent before building |
| Payroll statutory data seeding | Payroll W1–10 | Deliberately withheld pending legal/accounting sign-off | Code complete, data not seeded, module hidden | REACTIVATE once signed off |
| Office Inventory (11 tables, full lifecycle) | Office Inventory W1–12 | Built complete then deliberately left hidden platform-wide | Enabled for WWM only | ALREADY IMPLEMENTED for WWM; REACTIVATE per org |
| Leave module activation | Leave (functional since Phase 2B) | Registry `status` never graduated | CLOSED via `2ccf1d1` | ALREADY IMPLEMENTED |

---

## 19. WWM Boundary

Unchanged in spirit — WWM is the first live organization; no WWM-specific configuration was performed, decided, or assumed in either the discovery pass or this freeze pass. **One addition from this freeze pass**: WWM's own eventual move to formal production status is exactly the trigger event OWNER DECISION #29 anticipates — the Control Plane foundation/installation registry must exist **before** that happens, not be retrofitted afterward. This is a platform-architecture prerequisite, not WWM-specific configuration, and remains untouched here.

No `if organization === "WWM"` pattern was found anywhere across all research passes.

---

## 20. Final Workstream Plan — Recalculated Against 31 Approved Owner Decisions

The prior 43-item micro-list is retired. Below is the smallest coherent implementation sequence: **19 workstreams**, each a coherent bundle of related, dependency-linked work, plus one parallel operational track that needs no engineering sequencing.

> ### → EXACT FIRST IMPLEMENTATION WORKSTREAM: **WS-1 — Engineering & Security Foundation (CI + Docker + Quick Security Fixes)**
> **Not started.** See full justification after the workstream table below.

| # | Workstream | Priority | Bundles | Depends on | Key Owner Decisions |
|---|---|---|---|---|---|
| WS-1 | Engineering & Security Foundation | **P0** | CI (typecheck/build/test on every PR), Docker containerization, CSV formula-injection fix | none | OD #21, #30 |
| WS-2 | Identity & Access Hardening | **P0** | Legacy `users.role`/`organizationId` migration path, platform-level user disablement | WS-1 (soft) | OD #1, #20 |
| WS-3 | Audit & Sensitive-Data Security Hardening | **P1** | DB-level audit tamper protection, category-scoped audit-read permissions, expanded sensitive-read auditing, configurable audit retention/legal hold, sensitive-field masking/reveal | WS-2 | OD #16, #17, #18, #19, #23 |
| WS-4 | Installation Registry & Break-Glass Access Foundation | **P0** | Installation/deployment identity schema (not full UI), break-glass access-grant mechanism + new audit event types | WS-3 | OD #29, #31 |
| WS-5 | Documents & Records Foundation | **P1** | Shared versioning/retention primitives, `document_category` domain formalization, document-generation engine (unblocks HR Letters, offer particulars, handbook) | WS-3 | OD #4 |
| WS-6 | Scheduled Jobs / Notifications Foundation | **P1** | Generic scheduling engine, reminder/overdue primitive | none (parallel to WS-4/5) | OD #13 |
| WS-7 | Bulk Import — Full Multi-Entity Migration | **P0** | Extend §43 to structure, history, qualifications, certifications, leave balances, Payroll opening balances, mapping, reconciliation | WS-1 (soft) | — |
| WS-8 | Custom Fields & Form Builder | **P1** | Field-type registry, validation, scope binding, conditional visibility, versioning | WS-1 (soft) | — |
| WS-9 | Recruitment Completion | **P1/P2** | Publication-free candidate capture, offer accept/decline, source configurability, approval-chain decision, Ghana Schedule I offer particulars | WS-5, WS-6 | — |
| WS-10 | Onboarding, Induction & Handbook | **P1/P2** | Checklist/workflow engine, Induction as specialization, Handbook versioning + acknowledgement | WS-5, WS-6 | — |
| WS-11 | Employment Lifecycle Events Expansion | **P2** | Acting appointments, acting/secondment, contract expiry/renewal, probation extension-as-event/reminders/unsuccessful-outcome | WS-6 | OD #2, #6, #8 |
| WS-12 | Employee Relations & Offboarding Clearance | **P1** | Structured disciplinary stages, separate Grievance schema, structured offboarding clearance with Assets/Inventory/PIF linkage | WS-5 (light) | OD #9, #12 |
| WS-13 | Employee Data Change Approval & HR Service Requests | **P1/P2** | Shared request/approval shape, configurable sensitive-field list, hybrid generic-foundation + specialized-workflow HR requests | WS-6 (light) | OD #10, #11 |
| WS-14 | Skills, Competency Framework & Succession | **P2** | Formal proficiency framework, competency linkage, new internal-succession schema (critical roles, successors, readiness) | WS-9 (soft, for recruitment linkage) | OD #5, #7 |
| WS-15 | Cross-Module Visibility | **P1/P2** | Employee 360 completion, HR Action Centre (org-wide), Manager Portal recruitment-participation source, Reporting execution consolidation | WS-6 | — (**architecture frozen in §31**) — **COMPLETE.** All four bundles implemented (§31.40.7); Global Search is a future approved safe navigation/discovery enhancement, **not implemented** and not a closure blocker (§31.40) |
| WS-16 | Workflow/Delegation Primitive Generalization | **P2** | Generalize Office Inventory's delegation table, extract authority-resolver | WS-3 (light) | OD #14, #15 — **WS-16 COMPLETE** (formally closed in §32.29). Architecture frozen in §32; scope narrowed by discovery: authority extraction is already largely shared (§32.2), so WS-16 delivers one shared live direct-report helper (Pass 2A) plus a new shared department-head delegation foundation (Pass 2B). Office Inventory is **not** migrated (§32.20); the holder-facing surface is **gated on a first approved consumer** (§32.21). **Pass 2A COMPLETE** (§32.27) — shared live direct-report helper shipped, six consumers migrated, seventh retained. **Pass 2B COMPLETE** (§32.28) — `authority_delegations` foundation shipped on migration `0071`, `department_head` only, holder-only, **zero business consumers by design**. **Pass 2C/2D DEFERRED / CONSUMER-TRIGGERED** — no longer closure blockers (§32.29.1); shared delegation consumer count is **0 by design**, and Office Inventory stays module-owned with its delegate-validation defect still open (§32.25). WS-16 overall **COMPLETE** |
| WS-17 | Deployment & Backup Operations | **P2** | VPS automation, release-pipeline Levels 3–6, backup/restore build-out, Fleet Health design | WS-1, WS-4 | — |
| WS-18 | Security Verification Workstream & Production Security Gate | **P0** (gate, sequenced late) | Live tenant-isolation/IDOR testing, DAST, penetration testing, full business-logic-security sampling, closing the flagged Supabase-production RLS item | WS-1, WS-2, WS-3, WS-4 | — |
| WS-19 | AI Layer (implementation) | **Future/P2** | Tool Gateway build, first provider selection, Level 1–4 action mapping | WS-3, WS-5, WS-10, WS-4 (for future Control Plane AI scope) | OD #24, #25, #26 |

**Parallel operational track (no engineering sequencing required)**: Payroll — seed confirmed Ghana statutory figures, obtain legal/accounting sign-off, activate for WWM. Can proceed independently of all 19 workstreams above.

**Not scheduled as a workstream**: WWM configuration itself remains explicitly out of scope for this platform roadmap (§19), performed after platform completion, not before.

### Why WS-1 must come first

WS-1 is the only workstream with **zero dependencies** and the largest number of downstream workstreams depending on it, directly or by convention:

- **Zero CI exists today** — not even typecheck/build/test runs automatically on a pull request. Every one of WS-2 through WS-19 involves schema, permission, or business-logic changes; landing any of them without an automated gate is exactly the kind of risk this review's own Security Architecture section (§12) flagged as the platform's most absolute gap ("more absolute than expected... zero CI of any kind").
- **Docker containerization** (bundled here per OD #30's explicit "independent of Control Plane, start now") gives every subsequent workstream — especially WS-4's Installation Registry and WS-17's deployment operations — something concrete (a versioned, reproducible build artifact) to track and deploy, rather than retrofitting reproducibility after multiple workstreams have already shipped.
- **The CSV formula-injection fix** is bundled in because it is a real, already-identified, single-file security fix with no dependencies of its own — it costs nothing to include and should not wait behind a 19-workstream queue.
- Every later workstream's own "tests" and "completion gate" language implicitly assumes an automated test-and-build pipeline exists to run them against — WS-1 is the thing that makes every subsequent workstream's own completion gate meaningful rather than aspirational.

**WS-1 does not touch product schema, permissions, or business logic at all** — it is pure engineering/DevOps infrastructure, which is precisely why it can start immediately without any further Owner input beyond this freeze, and why it carries the least risk of any workstream in the sequence.

---

## 21. Dependency Graph (Key Chains)

- **WS-1 (CI + Docker)** blocks/de-risks → every other workstream's safe delivery; is a soft prerequisite for WS-7, WS-8 landing under proper test coverage.
- **WS-2 (Identity Hardening)** blocks → WS-3 (audit events reference actor identity — should be settled first).
- **WS-3 (Audit & Sensitive-Data Hardening)** blocks → WS-4 (break-glass needs the audit event-model enhancements and category-scoped read permissions), WS-16 (delegation generalization touches authority/audit patterns).
- **WS-4 (Installation Registry & Break-Glass)** — now sequenced **before first formal production deployment**, not fully deferred; blocks → WS-17 (deployment/backup operations need something to track), WS-18 (security verification should cover break-glass), WS-19's future Control Plane AI scope.
- **WS-5 (Documents & Records)** blocks → WS-9 (offer particulars), WS-10 (handbook), WS-12 (evidence attachment), WS-19 (AI Documents scope).
- **WS-6 (Scheduled Jobs/Notifications)** blocks → WS-9, WS-10, WS-11, WS-13, WS-15 — the single most-depended-on employee-lifecycle-extension workstream, matching OD #13's own text ("unblocks 4+ other items").
- **WS-9 (Recruitment Completion)** softly precedes → WS-14 (Succession's recruitment-linkage aspect).
- **WS-18 (Security Verification & Production Security Gate)** is deliberately sequenced **late** — it depends on WS-1 through WS-4 landing first so there is a meaningful CI/SAST/SCA baseline and a hardened audit/access model to actually test.
- **WS-19 (AI)** remains the last workstream in the dependency chain by design — it depends on WS-3, WS-5, WS-10, and WS-4's foundation, and is explicitly **not authorized to begin** regardless of sequencing position.

---

## 22. Owner Decisions — Final Register (31/31 Recorded)

| # | Decision | Status | Priority | Approved disposition |
|---|---|---|---|---|
| 1 | Legacy User Authority (`users.role`/`organizationId`) | **APPROVED WITH CHANGE** | P0 | Not a permanent parallel authorization source; determine safe migration path, retire from normal authorization after verification. Not removed now. |
| 2 | Acting Appointments | **APPROVED FOR ROADMAP** | P2 | Organization-configurable, effective-dated, with authority/history/restoration. Not built now. |
| 3 | Third-Party Plugin Framework | **DEFER** | P3 | Use configuration/modules/feature-flags/extensions instead; may be reconsidered later. |
| 4 | Documents & Records | **APPROVED** | P1 | Shared storage/security/versioning/access-control/audit/retention/metadata infrastructure; domain-specific tables allowed; never duplicate Personnel Files. |
| 5 | Skills / Competency Framework | **APPROVED FOR ROADMAP** | P2 | Full inventory/framework/proficiency/assessment/gaps/linkage; organization-optional. Not deferred indefinitely. |
| 6 | Acting / Secondment / Temporary Assignment | **APPROVED FOR ROADMAP** | P2 | Reuse `employment_periods`; sequence after scheduling foundation (WS-6). |
| 7 | Succession / Talent | **APPROVED FOR ROADMAP** | P2 | Distinct from existing Talent Pools; add only genuinely missing succession concepts. |
| 8 | Contract Expiry / Renewal | **APPROVED** | P1 | Reuse `employment_periods`; expiry/renewal/extension/amendment/reminders/historical integrity. |
| 9 | Discipline / Grievance | **APPROVED** | P1 | Distinct record types; may share document/evidence/security/audit infrastructure. |
| 10 | HR Service Requests | **APPROVED WITH CHANGE** | P2 | Shared configurable foundation for suitable requests; specialized domain workflows preserved where warranted; no giant generic workflow engine. |
| 11 | Employee Data Change Approval | **APPROVED** | P1 | Proven request/approval shape; configurable sensitive fields; full audit/history preserved. |
| 12 | Offboarding Clearance | **APPROVED** | P1 | Structured, integrated with owning modules (Assets/Inventory/Documents/IT/Payroll); no duplication of their records. |
| 13 | Scheduled Jobs / Notifications | **APPROVED — HIGH PRIORITY** | P1 | Shared scheduling/notification foundation; unblocks multiple dependent capabilities. |
| 14 | Shared Approval Primitive | **APPROVED** | P2 | Restrained: shared authority-resolution/delegation only, never a giant generic workflow engine replacing working domain flows. **Assigned to WS-16** (§20 register), architecture frozen in §32. **IMPLEMENTED — WS-16 COMPLETE** (§32.29.2): the one genuine duplication consolidated, deliberately different semantics preserved, no generic workflow engine built. |
| 15 | Delegation | **APPROVED** | P2 | Generalize the proven Office Inventory delegation concept; sequence with #14; remain effective-dated/scoped/revocable/auditable. **Assigned to WS-16** (§20 register), architecture frozen in §32. **IMPLEMENTED — WS-16 COMPLETE** (§32.29.3): shared `authority_delegations` foundation on migration `0071`, `department_head` only, holder-only, stricter than the prototype it generalizes. Module adoption is future, requirement-triggered work (§32.29.6). |
| 16 | Audit Tamper Protection | **APPROVED** | P1 | Strengthen existing architecture (no second audit system); append-oriented, DB-level protection for critical records. |
| 17 | Audit Read Permissions | **APPROVED** | P1 | Category/sensitivity-aware audit-read authorization; basic HR access must not expose Payroll/security audit data. |
| 18 | Sensitive Read Auditing | **APPROVED AND EXPANDED** | P1 | Personnel Files, disciplinary/grievance evidence, sensitive exports, banking, statutory identifiers, **privileged support access**, other highly sensitive records; risk-based, not noisy. |
| 19 | Audit Retention | **APPROVED WITH CONFIGURABLE POLICY** | P2 | Legal/contractual/organization/deployment-driven; no hard-coded universal duration; protected retention cannot be silently shortened; legal-hold support. |
| 20 | Platform User Disablement | **APPROVED** | P1 | Account disablement/revocation for compromised/departed/suspended accounts; session/token implications addressed. |
| 21 | CI / Security Scanning | **APPROVED** | P0 | GitHub Actions; typecheck/tests/build first, then SCA/secret-scan/SAST; DAST and deeper verification belong to the dedicated Security Verification Workstream. |
| 22 | Data Retention / Purge | **APPROVED WITH CHANGE** | P1 | Ghana is the initial legal/operational baseline (current target organizations are Ghana-based); architecture must still support jurisdiction/configuration metadata, not hard-code Ghana. Begin supervised/manual purge with authorization/preview/legal-hold/audit/retention-checks/accidental-destruction protection. |
| 23 | Sensitive Field Masking | **APPROVED** | **P1** (firmed from P1/P2) | Do not risk-accept away. Permission-aware masking/reveal for banking/statutory/high-sensitivity identifiers; general employee access ≠ full sensitive-field visibility; reveal actions considered for sensitive-read audit. |
| 24 | AI Provider | **ARCHITECTURE APPROVED** | Future | `AiProvider` abstraction now; no permanent single-provider lock-in; first provider selected during the AI implementation workstream; core HRMS continues functioning with AI disabled. |
| 25 | AI Level-3 Confirmation | **APPROVED** | Future | Explicit confirmation experience; execution-time recheck of authorization/state/domain rules, then execute existing domain service, then audit. |
| 26 | AI Log Retention | **APPROVED** | Future | Durable structured audit metadata + shorter-retention raw transcript data; data minimization; configurable retention. |
| 27 | Hosting Default | **APPROVED WITH QUALIFICATION** | P2 | Shared hosting as normal default; dedicated VPS/DB/cloud/customer-owned supported where justified; never requires a separate source repository. |
| 28 | Commercial Model | **APPROVED** | P2 | Subscription (default) + one-time/perpetual license + separate maintenance/support contract; licensing/hosting/maintenance kept as separate concepts. |
| 29 | Control Plane | **CHANGED** | **P0** (foundation) | Full Control Plane UI deferred; installation-registry foundation (durable operational identity: installation ID, customer, org(s), environment, hosting, domain, release/version, Git commit, migration version, extension profile, deployment date, backup policy, health/security status) **must exist before the first formal production deployment**. |
| 30 | Docker | **APPROVED** | P1 | Standard repeatable containerized deployment model; independent of full Control Plane UI; start now. |
| 31 | Break-Glass / Emergency Administrative Access | **NEW — APPROVED PRINCIPLE** | **P0/P1** | Platform-owner status never grants unrestricted everyday customer-data access. Explicit invocation, reason, scoped org/permissions, time limitation, visible elevated-session state, full audit trail (start/end, capabilities used, records accessed/changed), revocation, post-access traceability. Unrestricted impersonation explicitly rejected. |

**TOTAL OWNER DECISIONS RECORDED: 31/31.** No contradiction remains between this register and the recalculated roadmap in §20 — every APPROVED/CHANGED/DEFER/NEW disposition above is reflected in §20's workstream bundles and §21's dependency graph.

---

## 23. Freeze Checklist

- [x] Architecture (multi-org, extension framework scope DEFER, Documents & Records shape) — **approved**
- [x] Module map (§17) — **approved**, reflecting all 31 decisions
- [x] Workstream plan and priorities (§20) — **recalculated to 19 workstreams + 1 operational track, approved**
- [x] Audit model (§11), including break-glass audit capability — **approved**
- [x] AI model (§13, architecture only) — **approved for future build, implementation not authorized**
- [x] Security model (§12, §16) — **approved**; Security Verification Workstream (WS-18) and Production Security Gate scheduled, not satisfied by this document
- [x] Commercial model (§14) — **approved**
- [x] Control Plane — **foundation/installation registry approved, required before first formal production deployment; full fleet-management UI remains deferred**
- [x] Break-glass / emergency administrative access (§14, Owner Decision #31) — **approved as new architecture requirement**
- [x] Deployment model (§15) — **Docker and CI approved to start now (WS-1)**; VPS automation/release pipeline (WS-17) sequenced after
- [x] Backup/restore model (§15) — target architecture noted; build sequenced behind Installation Registry (WS-4)
- [x] Update/fix model (§15) — sequenced behind CI + Installation Registry
- [x] Owner Decisions (§22, 31/31) — **all recorded and approved**
- [x] WWM configuration — **explicitly NOT started**, deferred to post-platform-completion (§19)

**Validation performed for this freeze pass**: all 31 decisions are represented in §22; no contradiction found between the decision register and the recalculated roadmap; priorities in §17/§20 reflect the decisions exactly; the dependency graph (§21) reflects the Control Plane foundation's earlier sequencing; Control Plane foundation and full Control Plane UI are kept explicitly distinct throughout (§14, §17, §20); audit architecture explicitly includes break-glass access (§11, §14); sensitive-field masking is P1 (§12, §22); Skills and Succession remain P2, not indefinitely deferred (§7, §17, §22); **no implementation occurred** — this remains a documentation-only pass.

**STOP AFTER ARCHITECTURE FREEZE.** No Workstream 1 (WS-1 or any other) has been started. No schema, no migrations, no permission changes, no WWM configuration, no module enablement, no production deployment, no Docker configuration, no AI, no Control Plane, no installation registry, no production changes, and no destructive security tests have been performed. Wait for explicit Owner authorization before beginning WS-1.

---

## 24. WS-8 Workstream Scope Clarification — Custom Fields & Form Builder

**Recorded 2026-08-27. Documentation only — no implementation, schema, migration or permission change accompanied this section.**

**Why this section exists.** A read-only scope extraction against §4/§17/§20/§21 established that WS-8 has only four substantive references in this document, carries **no Owner Decision number**, and points its detail at "§37" of the *original brief* — a document **not present in this repository**. Every material implementation question (which entities fields attach to, which field types, what "versioning" versions, what happens to submitted data when a definition changes) resolved to NOT SPECIFIED. WS-8 could not be implemented safely on that basis, so the Owner recorded the clarification below.

**Status of the freeze.** This is a *workstream-scope clarification*, not an architecture-freeze rewrite. **None of the 31 Owner Decisions in §22 is reopened, amended or superseded.** OD #3 (defer general third-party plugin framework) is expressly preserved — see §24.19.

### 24.1 Purpose and non-goals

WS-8 delivers **Custom Fields + Form Builder as organization-level configuration capabilities**.

WS-8 is explicitly **NOT**: a public plugin framework; arbitrary code execution; arbitrary database-schema generation; a scripting engine; a replacement for first-class HR domain fields; a workflow engine.

### 24.2 Custom field principle

A custom field is an **organization-defined structured data field attached to an approved entity context**. Custom fields extend records without requiring customer-specific source-code forks.

They must **not** replace first-class platform fields where the concept belongs in core HRMS schema. Illustrative: "Church Membership Status" is a good custom field; "Employee Salary" is not, because Payroll already owns an authoritative compensation domain.

### 24.3 Approved entity contexts (initial)

Custom fields may attach to:

1. **Employee**
2. **Candidate / Application**
3. **Onboarding**
4. **Organization / HR Profile**
5. **Position / Designation**

**Prohibited contexts in WS-8** — these domains carry stronger integrity requirements: Payroll transaction records, Payroll runs, Leave transactions, Attendance transactions, Asset movements, Office Inventory movements, disciplinary findings, audit records, system/security identities.

Future workstreams may authorize additional contexts.

### 24.4 Definition vs value ownership

| | Classification | Consequence |
| --- | --- | --- |
| Field **definition** | organization-scoped **configuration** | movable between organizations as a template |
| Field **value** | tenant-isolated **business data** attached to a record | never travels with configuration |

**Business values must not be stored inside configuration JSON.**

### 24.5 Approved field types (initial registry)

`short_text`, `long_text`, `integer`, `decimal`, `boolean`, `date`, `datetime`, `single_select`, `multi_select`, `email`, `phone`, `url`.

**Optional, only if repository architecture supports them safely**: `employee_reference`, `master_data_reference`.

**Explicitly NOT in WS-8**: arbitrary formulas, JavaScript, SQL expressions, executable scripts, calculated-code fields, HTML-injection fields, **file-upload fields**. Document/file upload remains with Documents & Records unless separately approved.

### 24.6 Validation

Type-appropriate, declarative validation only:

- text — min length, max length, regex **only if implemented safely**
- number — minimum, maximum
- date — earliest/latest where useful
- select — allowed values
- common — required/optional, default value where semantically safe

**No validation expression may contain executable code.**

### 24.7 Required-field semantics — prospective only

Required applies **prospectively**. Turning an optional field required must **not** retroactively invalidate or rewrite historical records. Existing records missing the newly-required value may be surfaced as **MISSING REQUIRED CUSTOM DATA**. **The system must never fabricate a value.** Organizations complete those records later.

### 24.8 Scope binding

A definition must declare where it applies: organization, entity context, and optionally a module/context subdivision. **Valid scopes are a server-controlled allow-list** — there is deliberately no arbitrary table-name attachment mechanism.

### 24.9 Ordering

Organization-defined display order is supported. Ordering is **configuration only** and changing it must never change historical values.

### 24.10 Conditional visibility — IN SCOPE, constrained

A constrained **declarative** rule model. Initial operators: `equals`, `not_equals`, `contains` (where the type supports it), `is_empty`, `is_not_empty`, `in`, `not_in`.

**Prohibited**: JavaScript, arbitrary expressions, SQL, cross-tenant lookups, unsafe recursive logic. Conditions stay within the same approved form/context unless a specific repository-safe reference is designed.

### 24.11 Definition versioning and change classification

Definitions are **versioned**. A field has a **stable identity**; revisions create new versions; **historical values retain the definition version under which they were captured**. Changing a definition must never silently reinterpret historical stored values.

| Safe changes | Breaking changes |
| --- | --- |
| label, help text, display order | changing field type |
| optional → required (prospective) | removing a select option used historically |
| adding a new select option | changing decimal → date, or changing a field's meaning |

Breaking changes require a **new definition version or a new field** — never destructive reinterpretation. **Old values are never mutated to fit a changed type.**

### 24.12 Value history

Preserve history for meaningful business-data changes, capturing at minimum: field definition, entity, old value, new value, actor, timestamp. **Reuse the existing WS-3 audit architecture — do not create a duplicate audit system.**

### 24.13 Archive / deactivation

Fields may be deactivated/archived. Archiving removes a field from **new** data entry but does **not** delete historical values and does not remove it from historical record views where history requires it. **Definitions are never hard-deleted once values exist.**

### 24.14 Sensitive custom fields

A definition may be classified **NORMAL** or **SENSITIVE**. Sensitive fields integrate with WS-3 principles: a dedicated permission check for full-value access; masked/default-safe behaviour where appropriate; sensitive-read audit when a full value is revealed; **no sensitive value in logs**; no broad report/export leakage.

**Custom-field definitions must not invent their own permission model.**

### 24.15 Field-level permissions — deliberately not built

**No arbitrary per-field ACLs in WS-8.** Authorization uses the entity/domain permission plus an optional sensitive-custom-field permission. Finer-grained field ACLs are left to a future workstream if a real customer need appears.

### 24.16 Select values and Master Data

Single/multi-select may source options either **(A)** from options stored with the definition, or **(B)** from an approved Master Data domain reference where the architecture supports it. Existing Master Data must not be duplicated unnecessarily.

### 24.17 Reporting, export and search

**Reporting/export — IN SCOPE**: authorized filters, selected custom-field columns, CSV-safe export reusing WS-1's formula-injection hardening. Sensitive fields require the sensitive-read/report permission. **Custom fields are not automatically exposed in every report.**

**Global search — OUT OF SCOPE.** Custom fields are deliberately excluded from global search by default, avoiding performance problems, accidental sensitive-data exposure and inconsistent indexing. Search integration may be designed separately later.

### 24.18 WS-7 import relationship

Custom field **values** should be importable through WS-7 once WS-8 exists, and **WS-8 must expose a stable import adapter/service contract** for that purpose.

**WS-7 implementation is not reopened by this clarification.** A WS-7 adapter may be added during WS-8 implementation **only if it can be done safely without redesigning WS-7**. Custom field **definitions** are configuration and are never employee migration rows.

### 24.19 Configuration export/import readiness, and the configuration-vs-extension boundary

Definitions and form definitions should be **suitable for** future organization configuration export/import. The full export/import service is **not** built in WS-8 unless already in scope elsewhere. IDs/keys must be designed so templates can move between organizations **without copying business values**.

**Formal distinction established by this clarification**, and the reason OD #3 remains intact:

- **WS-8 = ORGANIZATION CONFIGURATION** — use custom fields/forms when the requirement is data/configuration oriented.
- **ORGANIZATION EXTENSION (code)** — use only when genuinely new business logic is required.

This is what allows different organizations to have different custom requirements **without separate source-code forks**, satisfying the platform's core "one shared foundation" principle through configuration rather than customization.

### 24.20 Form Builder — purpose and scope

A structured way to compose data-entry forms from existing approved core fields (where safely exposable), custom fields, headings/sections and help text. **It does not create arbitrary database tables and does not replace domain services.**

**Initial form types**: `INTERNAL HR FORM`, `EMPLOYEE ESS FORM`, `ONBOARDING FORM`, `CANDIDATE/APPLICATION FORM` — actual domain availability depends on existing route/domain architecture.

### 24.21 Layout, and repeating groups

**Supported**: sections, headings, field order, help/instruction text, one-column/simple grouped layout where existing UI supports it. A straightforward ordered-section editor is sufficient.

**Not built**: drag-and-drop page designer (unless trivial with existing components), pixel-perfect freeform layout, arbitrary HTML, arbitrary CSS, script blocks.

**Repeating/nested groups — OUT OF SCOPE.** Qualifications, certifications, dependants and similar concepts use their proper domain tables where those already exist. **A form builder must not be used to recreate normalized HR data structures.**

### 24.22 Form versioning and submissions

Form definitions are **versioned**. A submission retains: form identity, form version, field-definition versions, submitted values, `submittedAt`, submitter, and target entity/context. **Editing a live form later must never rewrite historical submissions.**

Submissions are **business data**: organization-scoped, immutable or append-oriented after submission where appropriate, auditable, permission-controlled. Draft behaviour may be supported if simple and safe. **Submitted historical data is never silently mutated.**

### 24.23 Workflow, anonymous forms, ESS and candidate forms

- **Generic form approval workflow — OUT OF SCOPE.** A submission may later feed a *specialized* domain workflow (Employee Data Change, Recruitment, Onboarding). **Do not build another generic workflow engine.**
- **Anonymous / public forms — OUT OF SCOPE.** No unauthenticated generic form publishing, which materially reduces the abuse/security surface. Recruitment may later expose specific external application forms under WS-9.
- **ESS forms — IN SCOPE** where the form is explicitly marked for Employee ESS and the fields suit employee self-entry. An employee may submit only for **their own** employee identity unless a later authorized relationship permits otherwise.
- **Candidate forms — IN SCOPE as a form-definition capability.** Public candidate-facing Recruitment integration belongs to **WS-9**; no anonymous candidate access is implemented here.

### 24.24 Security boundary

**Form definitions are never trusted from the frontend.** The server validates: form version, field membership, field types, required state, conditional visibility, organization, target entity, and permissions. **Extra/unrecognized submitted fields are rejected. No mass assignment.**

**Conditional-field security**: a field that is not applicable/visible under **server-evaluated** conditions must not become writable by crafting an API request. **Rejection is preferred** for unexpected values.

**Tenant isolation is mandatory.** Organization A must not view Organization B's definitions, use its field IDs, submit its forms, attach values to its entities, read its historical values, or export its data. **Direct IDOR tests are required.**

### 24.25 Permissions and audit

Compact permission model, evaluated at minimum as: `custom_fields.read`, `custom_fields.manage`, `custom_forms.read`, `custom_forms.manage`. Submission permissions primarily follow the target domain/context. Sensitive value reveal uses the approved sensitive-data permission model. **Manage permissions are not granted broadly by default.**

Audit via WS-3: field definition created; field version created; field archived; form created/versioned/archived; sensitive custom value revealed; administrative value correction where allowed. **Do not audit every harmless form render.** Domain submissions preserve actor/time/history.

### 24.26 API boundary

Explicit APIs only. **Never exposed**: arbitrary entity/table binding, arbitrary validation code, arbitrary SQL, arbitrary script execution. OpenAPI and generated clients are updated deterministically.

### 24.27 Schema, storage and performance principles

Prefer a **compact normalized model**. Concepts likely relevant: `custom_field_definitions`, `custom_field_definition_versions`, `custom_field_values`, `custom_forms`, `custom_form_versions`, `custom_form_fields`, `custom_form_submissions`, `custom_form_submission_values`.

**These are not a prescription.** Inspect actual repository patterns and choose the **smallest coherent schema**. Explicitly prohibited: one physical DB column per organization-defined field; dynamically `ALTER`-ing employee tables per custom field.

**Value storage** must be type-safe and structured — not everything reduced to unvalidated text. A typed-JSON value plus field-type validation, or another repository-consistent design, is acceptable; the authoritative definition controls the expected type, and queries/reporting must preserve type semantics.

**Performance**: avoid EAV-style N+1 explosions; batch custom-field values for entity lists; index organization, entity scope, entity ID and field definition. **Do not blindly index every arbitrary value.**

### 24.28 WWM and production boundary

**No WWM configuration.** No WWM custom fields or forms are to be created; existing WWM PIF/Leave forms are not altered; existing forms are **not** automatically migrated into WS-8. QA uses **disposable synthetic organizations** only.

**Production remains untouched** — no deployment, no production migration, no WWM configuration.

### 24.29 Open items still requiring Owner input before implementation

None blocking. The clarification above resolves every question the scope extraction raised. Two items are conditional by design and are to be decided **from repository evidence during implementation**, not invented:

1. Whether `employee_reference` / `master_data_reference` field types can be supported safely (§24.5).
2. Whether a WS-7 import adapter can be added without redesigning WS-7 (§24.18).

If either proves unsafe on inspection, it is dropped and the reason recorded — neither is mandatory.

---

## 25. WS-9 Workstream Scope Clarification — Recruitment Completion

**Recorded 2026-08-27. Documentation only — no implementation, schema, migration or permission change accompanied this section.**

**Why this section exists.** WS-9's frozen bundle (§20) names five items but leaves several implementation questions genuinely open — most consequentially whether multi-step approval chains should be built at all (§18 marks them *"OPTIONAL — confirm original intent before building"*) and whether offer status should gate employee conversion (the reconciliation's §30.2 leaves it undecided). The Owner has resolved those questions here.

**Status of the freeze.** This is a *workstream-scope clarification*, not an architecture-freeze rewrite. **None of the 31 Owner Decisions in §22 is reopened, amended or superseded.** OD #14's ruling — extract shared authority/delegation primitives, do **not** replace working domain workflows with one generic workflow engine — is expressly preserved and constrains §25.2 below.

### 25.1 WS-9 is completion, not reconstruction

The following are **already built and must not be rebuilt**: requisitions; vacancies; organization-configurable pipeline stages; multiple interview rounds; interview panels and their external-panelist data structure; conflict declarations; per-interviewer scorecards with draft/submitted/finalized behaviour and bias-prevention visibility; screening/shortlisting via the stage pipeline; interview reschedule (cancel + create) and no-show handling; reference/background-check capability; immutable offer versions; offer approval and its decision history; candidate→employee conversion; duplicate-employee protection; employee numbering and PIF handoff; the five-tier Recruitment permission architecture; internal candidate handling.

This restates §6's own "do not rebuild" list for the Recruitment slice and is binding on WS-9.

### 25.2 Recruitment approval chains — BUILD, Recruitment-specific

Configurable **multi-stage** Recruitment approval is approved. It is Recruitment-specific: **no second general workflow engine may be built** (OD #14), and existing authority/delegation primitives are reused where appropriate.

Organizations configure which stages apply — examples include Department Head, HR, Finance, Management, Executive, or another approved organization authority. **None of these is a hard-coded mandatory stage**; an organization may configure fewer, more, or different stages.

**Authority resolution** comes from relationships, permissions, organization configuration and delegation where supported. A role *name* never implies approver status: holding `hr_manager`, `department_head` or `org_admin` does not by itself make someone an approver. **Department Head authority must resolve through the existing authoritative Department Head relationship model (`department_heads`), not a role-name check** — this closes the gap the reconciliation's §5 flagged explicitly ("Do not assume Department Head approval is wired in here; it is not").

Stages use **server-defined authority-resolver types**. Configuration is explicit and readable; arbitrary code or workflow expressions are prohibited.

### 25.3 Separating selection from authorization to hire

The reconciliation's §8 records that *"selected"* and *"authorized to employ"* are conflated into a single gate. WS-9 must separate them:

| Decision | Meaning |
| --- | --- |
| **Requisition approval** | the organization authorizes *recruiting for* a role |
| **Approval to hire / final selection** | the organization authorizes *employing this specific candidate* |

The smallest Recruitment-specific model that separates these is required — **without replacing the working requisition architecture**.

**Approval history** preserves stage, actor, **authority basis**, decision, timestamp, reason/comment where appropriate, historical actor identity, and replacement/delegation semantics. **Earlier stage decisions are never overwritten.**

### 25.4 Offer status now gates conversion — for the Recruitment path only

For the **normal Recruitment workflow**, candidate→employee conversion requires **all four**:

1. final selection / authorization to hire complete;
2. the current offer **approved**;
3. the current offer **accepted**;
4. the offer not withdrawn, superseded or expired.

A declined or withdrawn offer must never convert to an employee through the Recruitment path.

**This gating is scoped to Recruitment conversion and must not break**: direct employee creation; legacy employee import; WS-7 bulk migration; existing employees; or rehire where owned elsewhere. An organization can still create or import employees without running Recruitment when Recruitment was not the source of hire — that is the explicit boundary.

**Legacy compatibility**: existing Recruitment records may predate offer acceptance entirely (the accept/decline statuses were never reachable). Enforcement is **prospective**. Already-converted employees must not become invalid, and **historical conversions are never rewritten**.

### 25.5 Recruitment source becomes Master Data

`source` stops being authoritative free text. A Recruitment source domain — `recruitment_source` — is introduced following existing Master Data conventions, with stable codes/keys.

Organizations may configure sources such as online/public application, internal announcement, physical/offline announcement, employee referral, walk-in, recruitment agency, direct sourcing, campus/institutional recruitment, or another organization-defined source. **These are product examples, not mandatory universal values.**

**Historical free-text source data must be preserved safely** — the two values in practice today (`careers_portal`, `internal_ess`) are real history, not noise.

### 25.6 Publication-free capture — the invariant is deliberately superseded

A candidate/application must **no longer require a publicly published vacancy**.

The current code states this invariant about itself — `candidates.ts`'s schema comment asserts *"every candidate row is created through the public careers apply endpoint"*, `candidates.ts` has no POST/PATCH, `applications.ts` has no POST, and both apply paths gate on `vacancy.status === "published"`. **That invariant is now intentionally superseded**, and the refactor must be done carefully rather than by loosening the existing check.

Two valid capture paths result:

| Path | Requirements |
| --- | --- |
| **A — Public / online application** | published vacancy **required** (unchanged) |
| **B — Authorized internal/manual capture** | public publication **not** required; authorized HR/Recruitment actor required; configured recruitment source required; properly audited |

**The public route's publication check is not weakened.** Unpublished and internal-only vacancies must never be exposed through public APIs.

Authorized Recruitment users may create a candidate, link to the appropriate vacancy/requisition where applicable, record the configured source and capture date, capture required candidate information, upload CV/supporting documents through the existing secure document infrastructure, and enter the candidate into the existing pipeline. **No second candidate model may be created.**

### 25.7 Source and publication are orthogonal

**Source** and **publication status** are distinct concepts and must not be conflated. A physical-announcement, referral or walk-in source may accompany an unpublished vacancy; an internal source may accompany internal-only visibility; a public-website source usually accompanies a published one. **Source values must not automatically control publication** unless an organization's own configuration explicitly defines that relationship.

### 25.8 Employment particulars — Act 651 Schedule 1

Structured employment-term data implementing Ghana Labour Act, 2003 (Act 651) **§13** — the employer must, subject to the contract terms, provide the worker **within two months** of commencement with a written statement of the main terms in the form set out in **Schedule 1**, signed by employer and worker. **The authoritative Act text must be used when implementing the exact particulars; earlier secondary summaries are not sufficient.**

**Terminology**: these are **employment particulars**. The product feature is **not** branded "Ghana Schedule I Form" except where a generated statutory document itself requires it; underlying fields use ordinary HR terminology.

The model must be sufficient to represent: employer name; employee name; date of first appointment; job title or grade; rate, method and intervals of pay; hours of work; holiday periods and holiday-pay details; sickness/injury incapacity conditions and sick-pay details, if any; social-security or pension scheme details; notice required from employer; notice required from worker; applicable disciplinary rules; grievance/dispute procedure; and overtime payment details, if any.

**Schedule 1 numbers notice as one item with employer and worker sub-parts. Preserve the legal meaning rather than forcing exactly thirteen physical columns.**

### 25.9 Ownership and snapshotting of particulars

Authoritative data must **not** be duplicated unnecessarily — organization, employee/candidate, position/grade, compensation, working hours, Leave/holiday policy, pension/statutory configuration and disciplinary/grievance policy already have owners.

But **an issued employment document must remain historically reproducible**. WS-9 must therefore determine the correct combination of **authoritative reference before issuance** and **immutable snapshot at offer/document issuance**.

**Old signed employment particulars must never change because a policy or setting was edited later.**

Proposed particulars belong with the immutable offer revision **or** a strictly linked versioned employment-terms snapshot — extending `offer_versions`, or a linked `employment_particulars`/terms version record, chosen on repository design and normalization grounds. **Mutable current-policy references must not be embedded in historical offer versions without snapshotting.**

- **Probation**: capture where applicable. **No universal duration may be hard-coded** — not three months, not six, not any figure. §29 of the reconciliation records that the numeric duration was *not* established as a universal Ghana rule.
- **Notice**: capture the applicable terms; **no single universal notice period may be hard-coded**. Resolve from applicable employment terms, organization configuration, and legal/domain rules already supported. **No new Ghana legal calculations without authoritative evidence.**
- **Leave/holiday**: reuse Leave policy/configuration; **do not duplicate the Leave engine**. Snapshot issued terms where historical reproducibility requires it.

### 25.10 Document generation — WS-5 only

WS-5's engine is used. **No second PDF/template engine may be built.** Recruitment generates the offer document and, where appropriate, the appointment/employment-particulars document, using organization templates and branding. **The generated artifact is immutable and tied to the correct offer and template version.**

**Boundary**: WS-9 owns only enough structured Recruitment employment terms to complete offer and acceptance. It does **not** become the post-hire Documents/Onboarding workstream — WS-10 owns onboarding, handbook and induction; later lifecycle workstreams own confirmation, promotion and transfer.

### 25.11 Offer responses — accept, decline, withdraw

All three terminal concepts already exist in the status enum and are currently **unreachable**. Each becomes reachable through a proper domain action.

- **Accept** records the offer and **exact offer version** accepted, the candidate, `acceptedAt`, and acceptance actor/evidence/context. **An accepted offer never silently switches to a newer revision**; a subsequent revision requires its own acceptance.
- **Decline** records the exact offer version, `declinedAt`, actor/source of response, and a reason where the organization's configuration requires one. Decline is terminal **for that revision**. **Candidate history is never deleted.**
- **Withdraw** is available to an authorized Recruitment/HR actor on an eligible offer, recording the exact version, `withdrawnAt`, `withdrawnBy` and reason. **Withdrawal never erases prior approval or history.** Behaviour after acceptance must be defined deliberately: **ordinary withdrawal after a completed conversion is to be prevented** unless a separate lawful downstream process applies.

**Expiry**: the field exists; WS-9 makes it operational. Expiry state must be deterministic, an expired offer cannot be newly accepted without an authorized explicit extension or revision, and WS-6 may provide scheduled reminders. **No excessive reminder workflows.**

**Revision**: the existing immutable revision/supersession architecture is preserved. **Only the current eligible approved version can receive a new candidate response**, and historical responses stay attached to their own version.

### 25.12 Signature and evidence

**No electronic-signature platform is built in WS-9.** Practical evidence of acceptance is sufficient: an authenticated candidate action where the architecture allows; recorded HR/manual acceptance evidence; the acceptance timestamp; and a document/evidence reference through WS-5 where appropriate.

**If candidate portal authentication does not exist, a full account system must not be invented solely for offer acceptance.**

### 25.13 Candidate response without an account — reuse the existing precedent

Where candidates have no accounts, a secure response mechanism is required. **An existing mechanism must be reused rather than invented**: `applications.statusCheckToken` / `statusCheckTokenExpiresAt`, with its unique index and a dedicated rate limiter on `/careers/:orgSlug/application-status/:token`, is the established precedent for a candidate-facing, tokenized, rate-limited endpoint.

Any offer-response token must be: high-entropy; expiring; **single-purpose**; bound to one candidate, one offer and **one offer version**, with one allowed action; replay-protected; **revocable when the offer is superseded or withdrawn**; never written to logs; stored hashed where practical; rate-limited; and audited on response. **Sequential IDs must not be exposed, and reusable general authentication tokens must not be used.**

### 25.14 Public anti-abuse

The careers portal is unauthenticated and must carry baseline anti-abuse controls: **rate limiting, payload limits, duplicate/replay safeguards, server-side validation, the existing secure document validation, and safe error behaviour.**

Rate limiting already exists on the public apply and status endpoints (`applyRateLimiter`, `statusCheckRateLimiter`) — WS-9 extends the baseline rather than starting from nothing.

**CAPTCHA is provider-optional and configurable.** The product must **not** be hard-coded to one vendor; the architecture permits *disabled*, *an approved provider configured*, and *future provider replacement*. If adding a provider in WS-9 would require an unnecessary external-service commitment, WS-9 establishes the **interface and configuration gate**, implements the other anti-abuse controls now, and **documents that decision**.

### 25.15 CV and document security

WS-5's document validation/storage infrastructure is reused where possible. **Public CV uploads are untrusted** and require file-size limits, supported MIME/types, magic-byte validation where it exists, private storage, a tenant/vacancy relationship, safe filename handling, and authorization for later staff download.

**Malware/AV scanning does not exist in this platform and must not be claimed.** It remains a disclosed security follow-up.

### 25.16 Public data minimization

Public Recruitment APIs expose only what a candidate needs. They must never leak internal requisition approval data, interview scorecards, internal notes, other candidates, unpublished vacancies, employee data, or internal organization configuration.

### 25.17 WS-8 candidate forms

WS-8 provides candidate/application form definitions, versioning and submissions. WS-9 integrates that architecture where it cleanly improves configurable application capture. **No second form builder may be created.**

Public candidate integration requires a **controlled anonymous/public bridge designed specifically for Recruitment**. **Generic WS-8 forms are never exposed anonymously** — that boundary was set in §24.23 and is unchanged.

### 25.18 Notifications

WS-6 is used **only where genuinely needed**: approval required; offer issued/available; offer approaching expiry; offer response recorded. **Email and SMS channels are not built** — WS-6 did not implement them. In-app notification is used where recipients are authenticated users; a public candidate notification channel remains limited by the actual candidate identity/contact architecture.

### 25.19 Permissions, isolation, audit, privacy

The existing five-tier Recruitment permission model is preserved. **New keys only where a genuinely new authority cannot be represented safely.** Relationship-derived Department Head authority is never replaced by a broad role-name permission.

**Tenant isolation is mandatory**, with direct IDOR testing across candidate, application, vacancy, source, approval chain, offer, offer-response token, employment-particulars generation, candidate documents and conversion.

**Audit via WS-3**: manual candidate created; source assigned/changed; requisition and hire-approval stage decisions; offer issued, accepted, declined, withdrawn, superseded; employment particulars generated; candidate converted to employee. **Existing correctly-recorded audit events are not duplicated.**

**Candidate privacy**: the full retention/purge system is **not** built here. WS-9 must nonetheless avoid duplicate candidate records, preserve candidate history, protect candidate documents, restrict internal notes, tenant-isolate everything, and avoid logging CV or personal content. **The future retention boundary is documented as unresolved.**

### 25.20 Conversion is not rebuilt

Only the **eligibility guard** changes, per §25.4. The single authoritative creation path, the `candidate_employee_links` DB uniqueness guarantees in both directions, and the existing identity protections remain authoritative and untouched.

**Historical integrity**: old applications, interviews, scorecards, offer versions and previously converted employees are never rewritten. New rules apply prospectively.

### 25.21 Frontend scope

Only the UI required by this bundle: manual candidate capture; source selection; Recruitment approval stages and status; offer response and status; employment particulars; access to generated offer/particulars documents; and public application configuration where appropriate.

**Already-working interview and pipeline pages must not be redesigned merely for consistency.** Recruitment source configuration integrates with the existing Master Data management UI rather than a separate source-administration module.

### 25.22 Legal, practice, product and configuration — kept distinct

| Classification | Items |
| --- | --- |
| **LEGAL REQUIREMENT** | Act 651 §§12–13 and Schedule 1 written particulars, where applicable |
| **CIHRM PROFESSIONAL PRACTICE** | structured recruitment/selection process — already substantially supported, **not law** |
| **PRODUCT CAPABILITY** | structured capture, versioning, document generation, historical snapshot, publication-free capture |
| **ORGANIZATION CONFIGURATION** | actual employment terms, probation duration, source list, approval chain, signatory/template |

**CIHRM practice must never be labelled as law**, and no numeric probation duration may be presented as a Ghana legal requirement.

### 25.23 WWM and production boundary

**No WWM configuration.** No WWM Recruitment approval stages, no seeded WWM sources, no WWM signatory, no published WWM vacancy, no WWM candidate, no generated WWM offer, no altered WWM permissions. QA uses **disposable synthetic organizations** only.

**Production remains untouched** — no deployment, no production migration, no changes to any live careers surface.

### 25.24 Open items still requiring Owner input before implementation

None blocking. Two items are conditional by design and are to be decided **from repository evidence during implementation**, not invented:

1. Whether employment particulars extend `offer_versions` or become a linked versioned terms record (§25.9) — a normalization judgement.
2. Whether a CAPTCHA provider is wired in WS-9 or only its interface and configuration gate (§25.14) — decided on whether it would force an unnecessary external-service commitment.

Either resolution must be recorded with its reason.

## 26. WS-10 Workstream Scope Clarification — Onboarding, Induction & Handbook

Recorded by the Owner after a read-only frozen-scope extraction found WS-10's three-item bundle ("Checklist/workflow engine, Induction as specialization, Handbook versioning + acknowledgement") carried **no attached Owner Decision** and left the majority of its architecture unstated. This section is **purely additive**. The 31 Owner Decisions in §22 are untouched and none is reopened; OD #14's "no second general workflow engine" ruling is expressly preserved and constrains §26.11 below.

WS-10 is **P1/P2** and depends on **WS-5 (Documents & Records)** and **WS-6 (Scheduled Jobs / Notifications)**, both complete. **WS-19 depends on WS-10.**

### 26.1 Repository findings that materially shaped this clarification

Three facts were verified in the repository before freezing, and they change what WS-10 must build:

1. **`document_requirements` already exists** (WS-5) and is exactly the required/provided/verified/rejected/expiry primitive this workstream needs: `ownerType` ∈ {employee, candidate, organization}, `ownerId`, `categoryCode`, `required`, `status` ∈ {pending, provided, verified, rejected}, `verifiedBy`/`verifiedAt`, `expiryDate`, `rejectionReason`, and a polymorphic `fulfilledDocumentTable`/`fulfilledDocumentId` pointing at the concrete row that satisfied it. **Its own header names WS-10 as an intended consumer.** A unique index constrains it to one requirement per `(organization, ownerType, ownerId, categoryCode)`.
2. **`organization_documents` + `organization_document_versions` already exist** (WS-5, OD #4) and the table header explicitly names **"handbook, HR policy"** as its purpose. Versions carry `versionNumber`, `status` ∈ {current, superseded}, `effectiveDate`, `expiryDate`, `changeNote`, `supersededAt`.
3. This **narrows ranked gap #8**. The earlier finding that `employee_documents` has no required/verified/expiry columns is correct but incomplete: WS-5 solved the checklist need in a *separate* table rather than by widening `employee_documents`. WS-10 therefore has **no document-requirement table to build**.

### 26.2 Lifecycle boundary — frozen

`RECRUITMENT` (candidate selected → approved to hire → offer → **offer acceptance**) → `PRE-ONBOARDING` (permitted preparation before commencement) → `EMPLOYEE IDENTITY CREATED` (canonical `employees.id` exists) → `FORMAL EMPLOYEE ONBOARDING` (tasks, documents, handbook/policies, induction, access/setup, asset/inventory references, completion) → `ACTIVE EMPLOYMENT` (Attendance, Leave, Performance, Learning, Assets/Inventory, Payroll if enabled).

**Probation is not part of this chain.** It remains its own existing capability (`confirmEmployee()`, `employment_periods`) and is expanded under **WS-11**.

### 26.3 Pre-onboarding — minimum bridge only

Pre-onboarding may begin **after an offer has been formally accepted** and may carry pre-employment document requests, instructions, commencement information, required forms and administrative preparation.

**Do not build a large separate pre-onboarding engine, and do not duplicate the task engine across the candidate and employee phases.** Given §26.1, the document dimension of pre-onboarding is **already satisfied** by `document_requirements` with `ownerType = 'candidate'` — no new table is required for it. Implement only the smallest bridge the remaining dimensions genuinely need, preferring existing Recruitment/Offer architecture where it offers a cleaner one.

Before `employees.id` exists, **candidate identity remains authoritative**. Any pre-onboarding state must link forward through the existing candidate→employee conversion relationship (`candidate_employee_links`, `candidates.linkedInternalEmployeeId`).

### 26.4 Employee-identity boundary — frozen

Formal onboarding attaches to **`employees.id`**. Do **not** create `onboarding_employee`, a temporary employee identity, a duplicate person record, or a separate onboarding staff identity. All onboarding history must resolve to the same `employees.id` used across the HRMS.

### 26.5 Candidate who never commences

Do not fabricate an active employee lifecycle. Preserve candidate/recruitment history; close or cancel pre-onboarding cleanly; record reason/status. Formal employee onboarding **must not start** unless employee identity was actually created through the approved conversion process. **Recruitment history is never silently deleted.**

### 26.6 Template model

Onboarding is organization-configurable around **template → template version → instance → tasks**. Templates may vary by organization, branch, department, position/designation, employment type, or other narrowly approved applicability criteria. **No WWM onboarding is hard-coded.**

### 26.7 Template versioning

Templates are versioned. An instance **snapshots or binds to the exact template version** at creation. Later template edits must never rewrite an onboarding in progress or already completed — the same snapshot discipline as WS-8 field versions and WS-9 employment particulars.

Template lifecycle: **`draft` → `active` → `archived`.** Only `active` versions create new instances; existing instances retain their original version.

### 26.8 Status model — frozen

| Entity | States |
| --- | --- |
| Onboarding instance | `not_started`, `in_progress`, `completed`, `cancelled` |
| Task | `pending`, `completed`, `waived`, `cancelled` |
| Acknowledgement | `pending`, `acknowledged` |
| Template | `draft`, `active`, `archived` |

**`overdue` is DERIVED** — from `dueAt` + unfinished state + current time — and is **not** a persisted lifecycle status. Do not invent additional states unless repository evidence creates a genuine requirement.

### 26.9 Task model

A task may support: title, description/instructions, required-or-optional, responsible party/resolver, due-date rule, completion state, `completedBy`, `completedAt`, evidence/reference, waiver where authorized, notes, order, and dependency where genuinely useful.

**Do not build a generic project-management system.**

### 26.10 Required vs optional, waiver, and completion

Required tasks block completion unless **completed** or **explicitly waived by an authorized user**. Optional tasks never block. A waiver requires **authority, reason, actor, timestamp and audit**.

Onboarding is **complete** when every required task is completed or validly waived. Completion is **server-derived** and must never be inferred from a percentage.

### 26.11 Responsibility resolvers

Use **relationship-derived authority, never fragile role-name strings** — the same ruling already recorded for Recruitment in §25.2. Initial resolver types may include: the employee, an HR permission holder, the reporting manager, the Department Head (through the temporal `department_heads` model), a specific user/membership, and the organization administrator only where a configuration task genuinely requires it.

**No arbitrary expression DSL** — consistent with OD #14.

### 26.12 Responsibility history

When a manager, Department Head or membership changes: **completed history is never rewritten** — who actually completed a task stays recorded. Pending work re-resolves authority under the documented resolver semantics. This mirrors the authority-basis snapshot proven in WS-9.

### 26.13 Due dates

Due-date rules are relative to meaningful dates only: onboarding start, employee commencement/start date, or task-dependency completion. The rule model stays constrained. **No arbitrary executable scheduling expressions.** WS-6 owns the scheduler.

### 26.14 WS-6 reminder contract

WS-6 is used for upcoming task reminders, overdue task reminders, handbook/policy acknowledgement reminders and induction reminders where configured. Register **only allow-listed job types**, with migration-safe idempotency, narrow payload identifiers, authoritative state re-fetch, and stale-reminder no-op/cancel semantics.

**In-app notification only. No email or SMS in WS-10.**

### 26.15 Required-document architecture

**Do not rebuild document storage, and do not build a document-requirement table.** WS-5 is authoritative and, per §26.1, `document_requirements` already provides required/optional, provided, verified, rejected, missing and expiry against employee, candidate and organization owners. WS-10 consumes it and links onboarding tasks to it. Do not turn `employee_documents` into a parallel workflow engine.

### 26.16 PIF, personnel file and staff numbering

**Neither is rebuilt.** Onboarding may carry a reference task such as "Personnel File/PIF setup completed" or reference authoritative state, but physical custody stays in the Personnel Files domain and must not be merged into onboarding tables. Employee-number allocation remains the existing numbering engine's; onboarding may **reference whether a staff number exists** but must never generate or reassign one.

### 26.17 Handbook architecture — frozen

**HANDBOOK = a WS-5 organization document + a WS-10 assignment/acknowledgement layer.** No second handbook document-storage subsystem. WS-5 supplies documents, versions, storage, effective versions, audit and retention (all confirmed present in §26.1). WS-10 adds only: assignment, recipient, acknowledgement, acknowledgement timestamp, acknowledged version, outstanding status.

### 26.18 Policy acknowledgement scope

The same mechanism serves the **Employee Handbook, Code of Conduct and organization HR policies**. **No fixed policy taxonomy is hard-coded** — organizations decide which document categories require acknowledgement.

### 26.19 Acknowledgement semantics

An acknowledgement records: employee, document, **exact document version**, `assignedAt`, `dueAt` where configured, `acknowledgedAt`, actor/employee identity, and method/status.

Acknowledgement is **not** a legal electronic signature. Use **ACKNOWLEDGED / RECEIVED / READ CONFIRMATION** wording — **never "SIGNED"** — unless a real e-signature capability is explicitly implemented. (WS-9 likewise built no e-signature platform.)

### 26.20 Re-acknowledgement

When a new version becomes effective, organizations **configure** whether re-acknowledgement is required. If required, the new obligation points at the **new version**; the previous acknowledgement remains historical evidence and is **never overwritten**.

### 26.21 Handbook assignment audience

Assignment may target: all employees, branch, department, position/designation, employment type, or explicit employee selection. The audience resolver stays constrained — **no arbitrary rules engine**.

### 26.22 Induction

Induction is a **specialization of the onboarding checklist engine**, not an unrelated workflow engine. An induction task/template may represent HR induction, organization orientation, department induction, role induction, IT/security orientation, workplace procedures, or safety orientation. **Content remains organization configuration.**

Specialization may support facilitator/responsible person, scheduled date/time, location or meeting details, attendance/completion, evidence/notes, reschedule and completion.

**No training-course/LMS functionality** — the Learning module remains separate. Evidence may reference a WS-5 document, uploaded evidence, an attendance/completion record, or notes; **reuse WS-5 for anything file-shaped — no duplicate blob storage.**

### 26.23 Gating decisions — both frozen NEGATIVE

**No automatic ESS gate.** Onboarding completion must **not** become a universal prerequisite for ESS access. Existing ESS behaviour (module + role, per §6 row 98) is unchanged. WS-10 must not lock employees out until onboarding is 100% complete. A future workstream may authorize configurable access dependencies; WS-10 may not.

**No automatic probation gate.** Probation start must **not** depend on onboarding completion. **No second probation mechanism** (§21). Probation extension-as-event, reminders and unsuccessful outcome belong to **WS-11**.

### 26.24 Module boundaries — reference, never merge

| Domain | WS-10 may | WS-10 must not |
| --- | --- | --- |
| **Assets** | carry a task such as "Required asset assigned"; reference an existing assignment; verify it exists; link to the Asset workflow | duplicate asset custody; auto-create asset records absent an explicit authorized Asset action |
| **Office Inventory** | carry "Required Inventory issued"; reference request/issue/custody; verify completion; link to the Inventory workflow | duplicate inventory custody; **reduce stock because a task was ticked** |
| **Access provisioning** | track account-linked, invitation-sent, ESS-access-verified and organization-defined access checks | create a second identity system; bypass membership/role provisioning; fabricate account access — **WS-2 is authoritative** |
| **Payroll** | reference "Payroll setup completed", only where Payroll is enabled **and** the user holds Payroll authority | expose Payroll-sensitive data; enable Payroll automatically |
| **Leave** | reference setup completion where useful | mutate Leave balances or policies on onboarding completion |

Assets and Office Inventory remain **confirmed separate** (§19) and must not be merged.

### 26.25 Reporting and progress

Provide at minimum: total tasks, required tasks, completed, waived, pending, overdue, completion percentage, overall status. **Percentage alone is never authoritative completion** (see §26.10).

### 26.26 Surfaces and visibility

- **HR (authorized):** active onboarding, upcoming tasks, overdue tasks, document gaps, acknowledgement gaps, induction status. Permission-aware. **Organization-wide onboarding data is never exposed to ordinary employees.**
- **Employee (ESS):** their **own** onboarding tasks, required documents, assigned handbook/policies, acknowledgement actions, induction information and completed/pending state — **own scope only**.
- **Manager / Department Head:** only the onboarding work they are responsible for through a relationship resolver. **No global onboarding visibility.**

### 26.27 Configuration authority

Organization Admin / authorized HR configuration manages templates, task definitions, applicability, responsible resolver, required/optional, due-date rules, induction specialization, document requirements, acknowledgements and Asset/Inventory reference tasks. **Configuration authority stays separate from sensitive operational access** — the same split WS-8 established.

### 26.28 Cancellation and reopening

Cancelling an instance requires **authority and a reason**, preserves history, stops future WS-6 reminders for that onboarding, does not delete completed evidence, and **does not terminate employment** (separation remains a separate domain).

**Completed onboarding is not casually reopened.** A material correction uses an explicit audited administrative correction or a supplementary task. Completed state and history are never erased.

### 26.29 Audit (WS-3)

Audit: template created/versioned/activated/archived; instance created; task completed; task waived; task reassigned where administrative; onboarding completed; onboarding cancelled; handbook/policy assigned; acknowledgement recorded; induction completed/rescheduled. **Do not audit list views.**

### 26.30 Sensitive data and tenant isolation

Onboarding must not become a data-exfiltration shortcut. Respect WS-3 masking, document permissions, Payroll permissions, Asset/Inventory permissions, employee self-scope and organization isolation. **Task descriptions must not embed unnecessary sensitive data.**

Isolation is mandatory: Org A cannot view Org B's template, start onboarding for Org B's employee, complete Org B's task, acknowledge Org B's policy, access Org B's induction, or reference Org B's document, asset or inventory record. **Direct IDOR tests are required.**

Note for implementation: `document_requirements` uses a **polymorphic** `ownerType`/`ownerId` pair with no database FK, so the owning workflow — here WS-10 — is responsible for validating `ownerId` against the right table and organization before writing. That obligation is stated in the table's own header and must be honoured.

### 26.31 Permission model

Keep it compact. Evaluate at minimum `onboarding.read`, `onboarding.manage`, `onboarding.configure`, `onboarding.task.complete` — plus handbook/policy acknowledgement keys **only if a genuinely distinct authority is required**. ESS own-actions use **self-scope, not broad `onboarding.read`**. **Do not proliferate keys.**

### 26.32 Schema principle

Candidate concepts: `onboarding_templates`, `onboarding_template_versions`, `onboarding_template_tasks`, `onboarding_instances`, `onboarding_tasks`, `onboarding_acknowledgements`, handbook assignments, and induction specialization fields.

**Do not mechanically create every listed table.** Use the **smallest coherent normalized schema** after inspecting existing patterns, and do not duplicate document, employee, asset or inventory tables. Per §26.1 and §26.15, **no document-requirement table is to be created.**

### 26.33 API, integration and codegen

Explicit domain APIs only — **no generic arbitrary workflow endpoints** (OD #14). Update OpenAPI and regenerate clients deterministically.

- **WS-5:** reuse document requirements, organization documents, versions, verification, expiry, retention and generated documents. **Do not fork document logic.**
- **WS-6:** allow-listed job types only; no email/SMS.
- **WS-8:** WS-10 creates the authoritative onboarding entity, then **flips the `onboarding` scope's `bindable` flag and adds the entity lookup in `lib/customFields/scopes.ts`** — the contract WS-8 recorded in advance. Nothing else about WS-8 changes, and **no second custom-form submission model** is created.

### 26.34 Conversion handoff

At candidate→employee conversion: preserve candidate identity/history; create or link the formal onboarding instance **if configured**; carry eligible pre-onboarding completion and evidence forward; **do not duplicate already-satisfied requirements**; map to `employees.id`. **This handoff must be idempotent.**

### 26.35 Employee creation boundary

**WS-10 must not create employees.** Recruitment conversion and the canonical employee-creation paths remain authoritative. Onboarding is started for an existing employee through an **explicit onboarding start action**.

Organizations may start onboarding for an existing employee **without any Recruitment record** — supporting legacy/imported employees, manual hires, and re-onboarding for a new role or process where organization policy permits. **A candidate record is never required.**

### 26.36 Legal, practice, product and configuration — kept distinct

| Classification | Items |
| --- | --- |
| **LEGAL REQUIREMENT** | none identified for onboarding, induction or handbook in the sources reviewed |
| **CIHRM PROFESSIONAL PRACTICE** | handbook/Code of Conduct issuance and acknowledgement; induction/orientation — **not statute** |
| **PRODUCT CAPABILITY** | the checklist engine, versioning, assignment/acknowledgement mechanism, induction specialization |
| **ORGANIZATION CONFIGURATION** | actual tasks, handbook content, policy set, induction content, responsibilities, due-date rules |

Do not name any capability **"Ghana onboarding"** or **"CIHRM onboarding"** — use ordinary HR terminology. Handbook acknowledgement and induction **align with** Ghana professional HR practice reviewed earlier but are **not to be represented as statutory requirements** unless independently supported by law. **Do not claim CIHRM certification or compliance.**

### 26.37 WWM and production boundary

**No WWM configuration** — no WWM onboarding templates, no uploaded WWM handbook, no assigned WWM policies, no started WWM employee onboarding, no configured WWM induction, no altered WWM assets/inventory, no WWM deployment. QA uses **disposable synthetic organizations** only.

**Production remains untouched** — no deployment, no production migration, no production configuration.

### 26.38 Open items still requiring Owner input before implementation

None blocking. Three items are conditional by design and are to be decided **from repository evidence during implementation**, not invented:

1. Whether the pre-onboarding bridge (§26.3) needs any new table at all beyond `document_requirements` with `ownerType = 'candidate'`, or whether existing Recruitment/Offer architecture already carries the remaining dimensions.
2. Whether induction specialization is expressed as columns on the task tables or a linked detail row (§26.22) — a normalization judgement.
3. Whether handbook assignment and acknowledgement are one table or two (§26.17) — decided on whether an assignment can meaningfully exist without an acknowledgement obligation.

Either resolution must be recorded with its reason.

## 27. WS-11 Workstream Architecture Freeze — Employment Lifecycle Events Expansion

Recorded by the Owner after a read-only extraction found WS-11's bundle carried real architectural forks with employment-law consequences, which must not be guessed. This section is **purely additive**. The 31 Owner Decisions in §22 are untouched; OD #2, #6 and #8 are implemented, not amended. WS-1 through WS-10 remain complete and are not reopened.

WS-11 is **P2** and depends on **WS-6** (complete). Nothing in the dependency graph depends on WS-11.

**Priority note.** WS-11 is P2, but **OD #8 (Contract Expiry / Renewal) is P1** while OD #2 and #6 are P2. A P1 decision therefore sits inside a P2 workstream. This is recorded, not resolved: if delivery must be split, the contract-term work is the P1 half.

### 27.1 Corrected repository facts (mandatory reconciliation)

An earlier extraction claim was wrong and is corrected here. Verified at `c42845e`:

1. **`employment_periods` receives only three event types** from the live lifecycle services: `transfer`, `promotion` and `confirmation` — all written by `employees.ts` through `recordEmploymentPeriodEvent`.
2. **Separation and rehire do NOT write `employment_periods`.** `separateEmployee()` and `rehireEmployee()` call `recordAuditEvent` only, producing `employee.separated` / `employee.rehired` **audit** events. This is a deliberate W15-predates-W22 artifact noted in the schema header, not a defect.
3. **Consequence:** the Employment History surface backed by `employment_periods` — including the read-only card on `employee-detail.tsx` — is **not a complete record of major employment lifecycle events**. It omits the two most consequential ones.
4. **`eventType` is `text`, free by design.** The schema header states each consuming workstream defines its own values "without a schema change here".
5. **WS-7's `employmentHistory` import adapter accepts arbitrary `eventType` strings** (present, ≤64 characters). Its own comment refuses to "force an imported history row into a stricter taxonomy than the domain itself enforces". **Arbitrary event strings therefore already exist in production data.**
6. **No contract term model exists anywhere.** `"contract"` is only an `employmentType` enum value; there is no `contractStartDate`, no `contractEndDate`, no contract table, no expiry logic.
7. **Acting appointments and secondment do not exist** in any form.
8. **Document generation now exists** (WS-5: `document_templates`, `document_template_versions`, `generated_documents`, `documentGeneration.ts`, `documentMerge.ts`). Earlier statements in this document that "zero document-generation capability exists" described the discovery-era repository and are **superseded**.

### 27.2 Decision A — Employment history authority

**`employment_periods` is the authoritative append-only BUSINESS LIFECYCLE HISTORY.** `audit_events` remains the SECURITY / OPERATIONAL AUDIT TRAIL. They are complementary and **must never be conflated**: one answers "what happened to this person's employment", the other "who did what in this system, when".

Note that `recordEmploymentPeriodEvent` already writes both — a lifecycle row plus a mirrored `employment_period.${eventType}` audit row. That existing behaviour is correct and is preserved.

System-generated lifecycle history should ultimately comprise:

| Event | Disposition |
| --- | --- |
| `transfer`, `promotion`, `confirmation` | **Already exist.** Unchanged. |
| `separation`, `rehire` | **ADD** (Decision B) — forward-only. |
| `probation_extension`, `probation_unsuccessful` | **ADD** (Decisions G, H). |
| `contract_renewal` | **ADD** (Decision F). |
| `acting_start`, `acting_end` | **ADD** (Decision K). |
| `secondment_start`, `secondment_end` | **ADD** (Decision L). |
| Contract **expiry** | **NOT an automatic event.** A date passing is not an act. Expiry is *derived* state (Decision E); an event is written only when an authorized person records an action. |
| Hire / commencement | **DEFERRED, with a stated reason.** `createEmployee` is shared by Recruitment conversion, manual creation, legacy import and WS-7 migration. Emitting a hire event there would fabricate hundreds of events with imported or unknown dates on every bulk import — exactly what Decision B forbids. If a hire event is ever added it must fire only on canonical single-employee creation paths where a real hire date is known, and **never** from an import path that already carries its own history. |

Do not add an event merely because it appears in a list.

### 27.3 Decision B — The separation/rehire gap

**Close it, forward-only.** Future separation and rehire actions append a lifecycle event **in addition to** their existing audit event.

Explicitly forbidden: removing or weakening the existing audit events; rewriting any existing row; **fabricating historical events for existing employees**; backfilling uncertain dates; inferring events from current `employmentStatus`. An employee who is `terminated` today with no lifecycle event stays that way — the absence is honest, and inventing a date would be worse than the gap.

If a backfill is ever wanted it is an explicit, authorized data-reconciliation exercise with real source evidence, never an automatic migration.

### 27.4 Decision C — Event-type strategy

**`employment_periods.eventType` must NOT become a database enum.** Doing so would invalidate legitimate imported history (fact 5 above) and break WS-7.

Instead:

1. A **server-defined registry of system event types** (a TypeScript constant/registry, the same discipline as WS-9's resolvers and WS-10's task kinds) — the closed set the platform itself may write.
2. **Write-time validation in the lifecycle services**: a system-generated event must name a registered type.
3. **Legacy and imported strings are preserved and remain readable** — never rejected, never rewritten, never migrated into the registry.
4. **Payload/`newState` shape validation per known system type**, so a controlled event carries the fields its consumers expect.
5. **Unknown historical types render as-is** in history surfaces (the existing UI already renders the raw string).

This gives forward control without destroying migration compatibility.

### 27.5 Decision D — Contract term location

**A dedicated employment-term domain (option C).** Not current-fields-only, not `employment_periods` alone, and not `employment_particulars`.

Reasons, from repository evidence:

- **`employment_periods` cannot answer "when does this contract expire?"** It is an append-only event log with no current-state fields. OD #8's "reuse `employment_periods`" is satisfied for the **history** of renewals, but a live term needs a queryable record.
- **A single `contractEndDate` on `employees` destroys history**, which OD #8 ("historical integrity") forbids and §8 of the clarification brief rejects outright.
- **`employment_particulars` is the wrong home**, and its own header says why: it is the *written statement of terms*, keyed one-to-one on `offerVersionId` and **frozen at issuance**. It is a document's content, not a live tracker, and it cannot serve employees who never had an offer.

The term model must support permanent employment, fixed-term employment, renewal, expiry, historical terms, changed terms, rehire under a new term, and multiple employment periods across a person's history.

**A pre-recorded contract is honoured here.** WS-9's `employment_particulars` header anticipated exactly this moment: *"later workstreams (confirmation, promotion, transfer, service letters) need particulars without an offer at all, and a one-to-one row keyed on `offerVersionId` today can gain a second nullable owner column later without disturbing offers."* WS-11 may take up that option so a renewal or confirmation can issue particulars without inventing a second particulars model. Whether it does so is an implementation judgement to be recorded with its reason.

### 27.6 Decision E — Contract expiry behaviour

**Contract expiry must NEVER silently terminate employment.** This is frozen.

Scheduled infrastructure **may**: detect upcoming expiry, raise reminders, surface expired/overdue state as derived information, notify authorized users, and populate an HR action queue.

Termination or separation **requires an explicit authorized lifecycle action** through the existing separation service.

The reason is factual, not cautious: an expiry date reaching today does not prove employment ceased. Renewal, extension, administrative delay, statutory requirements or an organizational decision may all intervene, and the system cannot know which. A future organization-configurable policy could authorize a safe automated action, but no such policy is approved now.

### 27.7 Decision F — Contract renewal

Renewal is a **distinct lifecycle event plus a new term record**. It preserves the prior term, the new term, the effective date, the actor, a reason/reference, and a supporting document where applicable.

**Historical contract terms are never overwritten.** A renewal chain must remain readable end to end.

### 27.8 Decision G — Unsuccessful probation outcome

**An unsuccessful probation outcome must NEVER automatically separate an employee.** This is frozen, and it is the sharpest employment-law boundary in WS-11.

The outcome action must: record the probation outcome as a lifecycle event; preserve the Performance review reference where one exists (the same optional `probationReviewId` validation `confirmEmployee()` already performs); surface an HR action; and leave the employment decision to an authorized organizational process.

If employment does end, it ends through the **authoritative separation service**. WS-11 must not create a second termination path inside probation — §6's "do not rebuild the separation architecture" ruling applies directly.

### 27.9 Decision H — Probation extension

Build extension as a **real effective-dated lifecycle event**, capturing at minimum: employee, previous expected end, new expected end, effective date, reason, authorized actor, supporting document/reference where applicable, and creation timestamp. History stays append-only, and the original probation record is never overwritten.

**Current derived probation end** comes from the latest controlled extension event where one exists, falling back to `employees.probationEndDate`. Only registered system events participate (Decision N); an arbitrary imported string never moves a live date.

`confirmEmployee()` and `employment_periods` remain the extension point. **No second probation mechanism** — the §21 ruling stands.

### 27.10 Decision I — Probation reminders

**WS-6 only.** No second scheduler. Reminder handlers **re-fetch authoritative state** and no-op permanently when stale, following the pattern WS-10 established. Reminder timing is **organization-configurable**; no WWM timing and no numeric default may be hard-coded. Reminders **never mutate employment state** (Decision J).

### 27.11 Decision J — Scheduled-job mutation boundary

Frozen as a **platform-wide enterprise safety rule**, not merely a WS-11 rule.

Scheduled jobs **may**: calculate, detect, remind, notify, queue, and mark derived operational state where safe.

Scheduled jobs **must NOT** independently make consequential employment decisions — termination, confirmation, promotion, transfer, failed-probation separation, or contract-renewal acceptance — unless a future, explicitly approved workflow establishes that authority.

Note this qualifies OD #13's phrase "acting/secondment auto-revert": a job may detect that an acting appointment's expected end has passed and surface or queue it, but **ending it is an authorized action**, not a silent background write. Where an organization later wants true auto-revert, that is a configurable policy decision requiring its own approval.

### 27.12 Decision K — Acting appointments

**Implement in WS-11** (OD #2 + OD #6, both approved for roadmap, sequencing condition "after WS-6" now satisfied).

Model as an **effective-dated temporary assignment** preserving: the substantive position, the acting position/function, effective start, expected end, actual end, reason, authority, department/position references, and full history.

**An acting appointment must NEVER overwrite the employee's substantive `positionId`.** Doing so would silently convert a temporary duty into an apparent permanent promotion and destroy substantive history — the single most damaging misreading available here.

Likewise, **`acting` and `seconded` must NOT be added to `employmentStatus`**. That enum answers *whether and how someone is employed*; acting and secondment answer *where they are currently working*. Conflating them would corrupt every existing consumer of employment status.

The established effective-dated precedent is `department_heads` — `validFrom`/`validTo` as a half-open interval with a partial unique index guaranteeing one open row, and a point-in-time resolver. §6 of this document calls that pattern the strongest in the audit and notes it is reused across seven or more schema files. It is the recommended model.

**UI:** where an employee is acting, surfaces should show **Substantive Position** and **Acting As** as distinct facts.

### 27.13 Decision L — Secondment

**Implement in WS-11, deliberately scoped for V1.**

Preserve: the same `employees.id` (no second employee record, ever), the substantive employment relationship with the home organization, a **descriptive destination**, an internal/external classification where useful, effective start, expected end, actual return/end, reason, authority, and document references.

**Cross-organization secondment inside the platform is OUT OF SCOPE for V1.** V1 records the destination **descriptively only**. Moving a person between tenants would cross the organization-isolation boundary that every other part of this platform enforces, and no frozen decision authorizes it.

**Secondment transfers no historical ownership.** Leave, Attendance, Performance, Assets, Office Inventory and Personnel Files records remain owned by the home organization and attached to the same employee. A secondment is an assignment fact, not a data migration.

### 27.14 Decision M — Four distinct concepts

Frozen. These must never collapse into one generic "transfer":

| Concept | Meaning |
| --- | --- |
| **Transfer** | Permanent/ordinary organizational placement change. |
| **Promotion** | Substantive advancement or change of position. |
| **Acting appointment** | Temporary responsibility while the substantive appointment is preserved. |
| **Secondment** | Temporary placement outside the normal substantive assignment, with return/end semantics. |

### 27.15 Decision N — Current state versus history

**Separated.** `employment_periods` holds append-only historical events. Current employment state is held by the authoritative employee/employment records and derived only where explicitly designed.

**Only controlled, registered system events may participate in deterministic state derivation.** The platform must never scan arbitrary free-text imported event strings and infer current state from them.

### 27.16 Decision O — Document integration

**WS-5 only. Documents are not rebuilt.**

WS-11 events that may optionally reference or generate a document: probation extension, confirmation, unsuccessful probation outcome, contract renewal, a contract-expiry action, acting appointment, secondment, and separation where already supported.

`document_templates.categoryCode` is **free text and organization-scoped**, so WS-11 needs no new template-type enum: an organization defines its own categories. The organization decides the template, whether a document is required at all, the wording, the branding, and any acknowledgement.

**No Ghana letter wording, and no statutory form text, may be hard-coded** into the platform. Only an organization's own generated document may carry statutory form wording — the rule `employment_particulars` already records.

### 27.17 Decision P — Organization configuration

Configurable, never hard-coded:

- whether probation applies, and by employment type
- default probation duration (**no numeric default may be hard-coded — not three months, not six, not any figure**)
- probation reminder schedule
- whether extensions are permitted, and any organization-chosen limit
- contract-expiry reminder windows
- whether acting appointments are used
- whether secondments are used
- required reason/document rules per event
- responsible authority for each lifecycle action

Configuration must never weaken tenant isolation, authorization or historical integrity. An organization may choose its policy; it may not choose to be less secure or to rewrite history.

### 27.18 Decision Q — Legal, practice, product and configuration

| Classification | Items |
| --- | --- |
| **LEGAL REQUIREMENT (Ghana)** | Probation of "reasonable duration determined in advance" (Act 651 §66(b)/§98(d); LI 1833 Reg. 5) — **secondary-sourced, and no numeric maximum is verifiable**. Notice periods (§17(1)): 3+ years — one month; under 3 years — two weeks; week-to-week — seven days. |
| **PROFESSIONAL PRACTICE** | Structured confirmation and probation review. **Nothing on record for acting appointments or secondment** — the Ghana lifecycle reconciliation contains zero mentions of either. |
| **PRODUCT CAPABILITY** | The event engine, effective dating, the term model, reminders, document integration. |
| **ORGANIZATION CONFIGURATION** | Probation duration and applicability, reminder timing, extension rules, authorities, whether acting/secondment are used at all. |

The "maximum six months" figure circulating in secondary sources is **explicitly not corroborated** and must never be treated as statutory fact or encoded as a default.

The product is **Enterprise HRMS**. The strings "Ghana HR", "Ghana mode" and "CIHRM compliant" must not appear in product UI, and **no CIHRM certification or compliance is claimed**.

### 27.19 Decision R — Imported-history compatibility

WS-7 imported history is **historical evidence**, not a controlled business operation. WS-11 must:

- **preserve** arbitrary imported event types and render them;
- **never reject** existing history because a type is not in the new registry;
- **never reinterpret** an arbitrary imported string as a trusted state transition;
- **never execute lifecycle side effects** from imported history.

System-generated lifecycle events are controlled operations. The two must remain distinguishable.

### 27.20 Decision S — Cross-module side-effect boundary

**A lifecycle event must not silently mutate another module's authoritative business records** unless an existing domain service explicitly owns that transition. This restates and extends the boundary §26.24 established for onboarding.

| Module | WS-11 may | WS-11 must not |
| --- | --- | --- |
| **Leave, Attendance** | reference; surface balances or records for context | mutate balances, policies or records because a lifecycle event occurred |
| **Payroll** | reference where enabled and the caller holds Payroll authority | mutate compensation, or expose salary/bank/statutory data through a lifecycle surface |
| **Performance** | reference a probation review (the existing validated link) | create, alter or auto-complete reviews |
| **Assets, Office Inventory** | **warn** about outstanding custody on separation | silently return assets, move stock, or alter custody |
| **Personnel Files** | reference | allocate or reassign PIF numbers |
| **ESS, Manager Portal** | surface own-scope and responsibility-scope history | expose organization-wide lifecycle data to ordinary employees |

Previously approved separation boundaries are preserved unchanged.

### 27.21 Protected capabilities — do not rebuild

`employees.id` identity, employee numbering, PIF, transfer, promotion, confirmation, the separation service, the rehire service, Recruitment conversion, Onboarding (WS-10), the Performance probation linkage, WS-5 Documents, the WS-6 scheduler, WS-3 audit, and WS-8 custom fields/forms. **WS-11 extends lifecycle behaviour around them.**

### 27.22 Open items still requiring decision at implementation time

None blocking. Four are conditional by design and are to be decided **from repository evidence during implementation**, each recorded with its reason:

1. Whether the employment-term model is one table or an envelope/term-version pair (§27.5) — a normalization judgement against the renewal-chain requirement.
2. Whether acting and secondment share one effective-dated assignment table with a discriminator, or take one table each (§27.12–27.13).
3. Whether WS-11 takes up `employment_particulars`' pre-recorded second-owner column, or defers it (§27.5).
4. Whether the event-type registry lives beside the lifecycle service or in `@workspace/db` alongside the schema (§27.4).

---

## 28. WS-12 Workstream Architecture Freeze — Employee Relations & Offboarding Clearance

Recorded by the Owner after a read-only Pass-1 reconciliation found that two of WS-12's three pillars **already have shipped, live, permissioned implementations** that the workstream register described only as "PARTIAL", and that a third pillar's integration surface had already been built by WS-11. Six genuine forks were put to the Owner and answered before this section was written; they are recorded below as Decisions A, E, D, J, P and N respectively.

This section is **purely additive**. The 31 Owner Decisions in §22 are untouched. **OD #9 and OD #12 are implemented, not amended**; OD #14 (no giant generic workflow engine), OD #18 (sensitive read auditing) and OD #20 (platform user disablement) constrain it. WS-1 through WS-11 remain complete and are not reopened.

WS-12 is **P1** and depends on **WS-5 (light)**, which is complete. WS-13 does not depend on it.

### 28.1 Corrected repository facts (mandatory reconciliation)

Verified read-only at `7c95030`, migration ledger `0067`. The workstream register's "PARTIAL (thin)" descriptions are correct but materially understate what exists:

1. **`employee_disciplinary_records` already exists and is live** (Phase 2A, W28). It is **append-only by design** — its own header states there is no update or delete path — with five business columns: free-text `actionType`, `description`, `actionDate`, `recordedBy`. It has live routes, a dedicated `employee.disciplinary.read` permission narrower than `employee.read`, writes gated on `employee.write`, tests, and a panel on `employee-detail.tsx`. It has **no** stages, investigation, notice, response, hearing, findings, outcome, appeal, warning validity or document linkage.
2. **Grievance is genuinely greenfield.** No grievance case management exists anywhere. The only repository hits are `employment_particulars.grievanceProcedure` — a **text clause printed into appointment letters**, not a record type.
3. **`employee_exit_processes` already exists and is live** (Phase 2A, W29). It carries **three booleans** (`checklistCompleted`, `clearanceCompleted`, `exitInterviewCompleted`) plus free-text `exitInterviewNotes`. It is correctly keyed per separation cycle — it snapshots `separationDate` at creation so an employee separated, rehired and separated again receives a distinct row that never overwrites a prior one. It has **no** checklist items, clearance items, responsible parties, evidence, approvers or questionnaire.
4. **`createEmployeeExitProcess` today throws `EmployeeNotSeparatedError` unless `employmentStatus === "terminated"`.** Offboarding can currently begin only *after* separation is already effected. Decision E changes this deliberately and with an explicit control.
5. **WS-11 already shipped the clearance read surface.** `GET /organizations/:organizationId/employees/:employeeId/separation-readiness` reads open `asset_assignments`, employee-held `office_inventory_stock_movements` and `personnel_files`, and returns structured warnings with `blocksSeparation: false`. WS-12 extends this reader; it does not invent one.
6. **Assets already model the entire custody lifecycle.** `asset_assignments` carries issue, acknowledgement, `custodyEndedAt`, `receivedByMembershipId`, `returnNotes` and `assetAssignmentEndReasonEnum` (`returned` / `lost` / `transferred` / `retired`); `assets` carries `asset_condition` (`new`/`good`/`fair`/`poor`/`damaged`); `asset_incidents` and `asset_evidence` exist. **Every asset-return field the WS-12 brief enumerates already exists.**
7. **Office Inventory distinguishes `consumable` from `returnable`** in `officeInventoryItemClassificationEnum`, and its schema header states that a durable individually-tracked item "belongs in Assets from the start". **Only `returnable` items are clearance-relevant.**
8. **`employee_documents` has no confidentiality dimension** — only a free-text `categoryCode` from the `document_category` Master Data domain. Disciplinary and grievance evidence therefore has no confidentiality control today.
9. **Disciplinary and exit audit currently sit in the ordinary `"hr"` category** (`auditCategories.ts`: `employee_disciplinary_record: "hr"`, `employee_exit_process: "hr"`), even though **OD #18 explicitly names "disciplinary/grievance evidence"** for sensitive-read auditing. That decision is presently unimplemented for the exact data it named.
10. **§24.3 explicitly prohibits Custom Fields on "disciplinary findings".** WS-8 is therefore not available as the extensibility mechanism for findings, though it remains available for exit-interview questionnaires, which are not prohibited.
11. **Organization Admin already holds `employee.disciplinary.read`** in the shipped seed. Decision P preserves that rather than silently revoking it.

### 28.2 Decision A — Legacy disciplinary history is preserved, never rewritten

**`employee_disciplinary_records` is frozen as immutable legacy disciplinary history.** The new structured case architecture is built **alongside** it.

Legacy rows **must not** be migrated into fabricated case structures. Allegations, hearings, findings, stages, appeals, warnings and outcomes that were never historically recorded **must not be inferred**. A flat legacy row records what someone actually wrote down; manufacturing a case around it would invent evidence in the one domain where invented evidence is most damaging.

Both surfaces may appear on the employee record, each subject to its own permission. This mirrors §27.3's forward-only treatment of the separation/rehire history gap: the platform closes a gap prospectively rather than backfilling a past it cannot prove.

### 28.3 Decision B — Structured disciplinary case architecture

A disciplinary **case** is the new authoritative structured record: subject employee, category, severity, current stage, status, opened and closed dates, responsible officer, confidentiality.

Case chronology is **append-only events** — allegation recorded, notice issued, response received, hearing held, finding recorded, outcome recorded, appeal lodged, appeal decided. A later event never overwrites an earlier one, following the same reasoning that made the legacy table append-only.

Stages, categories and outcome types are **organization-configured**, not hard-coded: organizations differ in both terminology and number of stages, and §28.18 governs how. Warning outcomes may carry a validity expiry where the organization's policy defines one. **No Ghana-specific disciplinary wording is hard-coded**, consistent with §27.18 and OD #22's treatment of Ghana as an operating baseline rather than a hard-coded jurisdiction.

**The system never determines fault.** Every finding and outcome is a recorded human decision.

### 28.4 Decision C — Grievance is a distinct schema

OD #9's "distinct record types" is implemented literally: grievance cases are **their own tables**, not a discriminator on disciplinary cases.

They are not the same shape. In a disciplinary case the employee is the respondent; in a grievance the employee is the complainant, and there may be a separate respondent who is another employee, a unit, or nobody identified. Confidentiality obligations differ, visibility differs, and the escalation path differs. Collapsing them would force one visibility model onto two populations with opposed interests.

Grievance carries: submission, category, respondent context where applicable, description, confidentiality, acknowledgement, assignment, investigation, meetings, findings, resolution, escalation, appeal where applicable, closure, supporting documents, chronology and audit.

### 28.5 Decision D — Grievance visibility in Employee Self-Service

**Employees may submit their own grievances through ESS**, and may see their own submission, its acknowledgement, appropriate case status, requests directed to them, meetings or hearings they are permitted to know about, and the appropriate final resolution communication.

Employees **must not** automatically see confidential HR notes, investigator working notes, internal deliberations, restricted evidence, information about another employee they are not authorized to receive, draft findings or outcomes, or protected audit information.

**The visibility model must be designed explicitly and field-by-field.** Exposing the complete grievance record to ESS and relying on the employee to be uninterested in the rest is not an implementation of this decision. Every ESS-visible field is an allow-list entry; the default is not visible.

### 28.6 Decision E — When offboarding may begin

Offboarding **may begin before actual separation**, but only where an **authoritative recorded future separation basis** exists — an accepted or approved resignation, retirement, approved termination, confirmed contract end, or another separation state already supported by the authoritative Employment Lifecycle architecture.

**An offboarding case must never become a substitute for a valid separation basis.** An arbitrary offboarding record started against no recorded basis is precisely what this control forbids.

The architecture must therefore distinguish, where the applicable dates require the sequence:

**recorded future separation basis → offboarding initiated → clearance in progress → actual employment separation → final offboarding completion**

This deliberately relaxes the shipped `EmployeeNotSeparatedError` precondition recorded in §28.1(4). The relaxation is the point: clearance that can only start after termination starts too late to be useful during a notice period. The precondition is replaced by a **stricter, more specific** one — a recorded basis — not removed.

### 28.7 Decision F — Offboarding never terminates employment

**Starting or completing offboarding must not itself terminate employment.** WS-11 remains authoritative for employment separation and for `employment_periods` history.

This is the same boundary §27.6 froze for contract expiry and §27.8 froze for unsuccessful probation, applied to a third surface: a checklist reaching 100% is not a legal act. Completing every clearance item produces a *ready* state and nothing more; the separation itself is an explicit authorized act through the existing separation service.

WS-12 must not call `separateEmployee()` from any clearance, checklist or scheduled-job path.

### 28.8 Decision G — Clearance architecture

Clearance is **template → instance**, with the instance **copied from the template at initiation**, never joined live to it. This is the WS-10 precedent (§26): publishing a revised template must not rewrite clearance already in progress.

A clearance item carries: responsible department or unit, responsible approver, required or optional, status, comment, evidence reference, completion date, return or rejection, and escalation.

**Waiver and override are the deliberate escape hatch**, and both require a **mandatory reason** and are audited — the same treatment WS-10 gave task waivers.

**Final HR clearance is a distinct terminal act**, not the arithmetic result of the item list.

**Organizations define their own clearance requirements.** No universal checklist is hard-coded. The three booleans on `employee_exit_processes` are superseded as inputs: they may be **derived** from real clearance items, never trusted as settable flags — the same reasoning §26 applied to onboarding completion.

### 28.9 Decision H — Assets integration is observe-only

Per OD #12's "no duplication of their records", **Assets remains authoritative for asset records.** WS-12 creates no competing asset register.

Clearance **reads** open `asset_assignments` and surfaces outstanding custody, condition, missing and damaged states from the fields §28.1(6) confirms already exist. An asset is returned **in the Assets module**, by the Assets service, recorded against `custodyEndedAt` / `receivedByMembershipId` / `returnNotes` / the end-reason enum; clearance observes the outcome.

**Marking a clearance item complete must never end an asset assignment, alter custody or change asset condition.** A test must prove that completing clearance returns nothing. This restates §27.20 and §26.24 for a third consumer.

Financial recovery for a missing or damaged asset is **not** computed in WS-12.

### 28.10 Decision I — Office Inventory integration

The same observe-only rule applies, with one additional constraint: **only `returnable` items are clearance-relevant.** Consumables are never clearance items — §28.1(7) records that the classification enum already draws this line, and pretending every issued inventory record is an individually assigned asset would produce clearance items nobody can ever satisfy.

Clearance must not move stock, create a request, or issue or receive anything.

### 28.11 Decision J — Confidential evidence extends WS-5, additively

**No second document store.** Employee-relations and offboarding documents use the existing Documents & Records architecture: disciplinary notices, responses, hearing records, findings, warning letters, grievance documents, investigation documents, resignation letters, separation correspondence, clearance evidence, exit and handover documents.

WS-5's existing polymorphic `sourceType` / `sourceId` pointer is the linkage; WS-12 adds its own source types and creates no document FK on its own records.

**WS-5 gains the minimum confidentiality/security dimension required for Employee Relations evidence.** Any such schema change must be **additive and backward compatible**, and must not alter the behaviour of documents that predate it. Existing document behaviour is not weakened, re-gated or migrated.

### 28.12 Decision K — Sensitive-read auditing (OD #18 implemented)

Disciplinary and grievance evidence covered by OD #18 **must use sensitive-read auditing**. §28.1(9) records that this decision is currently unimplemented for the exact data it named; WS-12 closes that.

Auditing must remain **risk-based, not noisy**, exactly as OD #18 requires. **No alternative audit system is created** — WS-3 infrastructure is extended (OD #16).

Every consequential mutation is audited with actor, organization, employee, action, reason where required, effective date, relevant before/after metadata, request id and timestamp. **Case chronology does not replace audit, and audit does not replace case chronology**; the two serve different purposes, as §27 already established for lifecycle events.

### 28.13 Decision L — Identity and access boundary

WS-12 distinguishes three separate things and must not conflate them: **clearance tracking**, an **access-revocation task**, and **actual identity or access mutation**.

WS-12 owns the first two. The third belongs to Identity & Access and OD #20 (Platform User Disablement). **No automated destructive access action is created in WS-12.** Clearance records whether revocation was performed and by whom; it does not perform it, and no second access-control mechanism is invented.

### 28.14 Decision M — Payroll boundary

**Integration contract only.** Final settlement belongs to Payroll. WS-12 builds no payroll calculation of any kind and stores no authoritative payroll state.

Clearance may carry a final-settlement item resolved by someone holding Payroll authority. **No amounts are computed, stored or displayed through a WS-12 surface**, consistent with §27.20's rule that a lifecycle surface never exposes salary, banking or statutory data.

### 28.15 Decision N — Exit interviews, and rehire eligibility withheld

**Configurable exit interviews are included in WS-12.** They reuse the existing WS-8 Custom Fields / Form Builder architecture rather than introducing another questionnaire engine — the WS-10 `onboarding` scope precedent, where a shipped authoritative record made a scope bindable with one lookup branch. Exit interviews are **not** among §24.3's prohibited domains.

Responses are tied to the **correct offboarding and separation cycle** — the per-cycle keying §28.1(3) already establishes — and protected by appropriate HR permissions.

**Rehire eligibility is NOT authorized in WS-12. No rehire-eligibility field may be added.** It is deferred until a separate Owner Decision defines who may set it, permitted values, whether a reason is mandatory, who may view it, whether the employee may view it, whether it expires, whether it may be changed, and the audit requirements for changes. That flag carries real legal weight and is not to be introduced as an implementation detail.

### 28.16 Decision O — Cross-module side-effect boundary

Restating §27.20 and §26.24 for WS-12:

| Module | WS-12 may | WS-12 must not |
| --- | --- | --- |
| **Assets** | read open custody; surface outstanding, missing, damaged | return an asset, end custody, alter condition, create a competing register |
| **Office Inventory** | read employee-held `returnable` custody | move stock, create a request, issue or receive |
| **Personnel Files** | reference; record a custody-confirmation item | allocate, reassign or close a PIF |
| **Payroll** | expose a settlement item to a Payroll-authorized actor | compute, store or display amounts |
| **Identity & Access** | record a revocation task and its completion | disable accounts, revoke sessions or mutate roles |
| **Employment Lifecycle (WS-11)** | read separation basis and history; initiate from a recorded basis | separate, rehire, or write `employment_periods` |
| **Recruitment, Onboarding, Performance** | reference | mutate |
| **ESS / Manager Portal** | surface own-scope and responsibility-scope per §28.5 | expose confidential case content to ordinary employees |

### 28.17 Decision P — Permissions

Reconciled against existing conventions before minting keys.

**Existing shipped Organization Admin disciplinary access is preserved.** `employee.disciplinary.read` stays exactly as seeded; silently revoking a shipped authorization is the change §27.21's protected-capabilities rule warns against, and it is not made here.

**New grievance access requires an explicit grievance permission.** Organization Admin status alone must not automatically grant access to confidential grievance records — the grant must be an explicit permission assignment through the existing role/permission architecture, not an implication of role name.

New keys are the minimum required for genuinely new actions, covering employee-relations case management, grievance read and management, offboarding management, and a clearance-acting capability for approvers who are not HR. Employee self-scope covers an employee's own grievance per §28.5 and mints no key of its own — the WS-10 precedent. Super Admin and control-plane rules (OD #29, #31) are unchanged; break-glass access remains governed by §22 OD #31.

### 28.18 Decision Q — Organization configuration

Configurable per organization: disciplinary categories, stages and outcome types; warning types and durations; grievance categories; clearance templates, responsible units and required items; exit-interview templates; offboarding workflow rules.

Delivered through the existing organization-settings and master-data conventions. **No new configuration engine is built**, and nothing is made configurable merely because it theoretically could be.

### 28.19 Decision R — Custom Fields boundary

Exit-interview questionnaires reuse WS-8 (§28.15). **Disciplinary findings must not** — §24.3 prohibits Custom Fields on disciplinary findings, and that prohibition stands. Findings use typed columns owned by WS-12.

### 28.20 Decision S — Scheduled jobs and notifications

WS-6 only, in-app only; no email or SMS capability exists in this platform.

Legitimate reminders: case assignment, hearing date, response due, grievance acknowledgement due, overdue grievance action, clearance assignment, overdue clearance, unresolved asset or inventory return, final-clearance readiness.

**Scheduled jobs must not mutate sensitive Employee Relations outcomes.** §27.11 froze this as a platform-wide safety rule and it applies with full force here: no job may record a finding, decide an outcome, close a case, waive a clearance item, complete clearance or separate an employee. Handlers re-fetch authoritative state and no-op permanently when stale, following the shipped `onboarding.*` and `employment.*` handler pattern and its naming convention.

### 28.21 Decision T — AI boundary

**No autonomous disciplinary decisions, grievance findings, termination recommendations, guilt or innocence determinations, or automatic employee sanctions.** Human authority is unambiguous and non-delegable in this domain.

Should administrative assistance such as summarization, classification assistance or drafting ever be useful, it is permitted only inside the already-approved AI governance boundary (OD #24, #25, #26), with explicit confirmation and execution-time recheck. **No AI capability is proposed or built in WS-12.**

### 28.22 Decision U — Bulk migration

The existing WS-7 framework is the only importer. **No separate importer is built.**

**Historical workflow events must not be fabricated from incomplete legacy data** — the §27.3 and §28.2 principle applied to import. Legacy disciplinary, grievance or clearance history import is **deferred**: adapters may be added later through the existing framework when real source data justifies them.

### 28.23 Decision V — Reporting boundary

Minimum P1 read-models only: open disciplinary cases, case ageing, grievance status, grievance ageing, employees currently offboarding, outstanding clearance, outstanding assigned assets, completed offboarding.

All permission-filtered and confidentiality-aware — a report must never become the route by which confidential case content reaches a caller who could not read the case itself. **WS-12 is not an analytics workstream.**

### 28.24 Tenant isolation and security

Every WS-12 entity is organization-scoped under existing tenant invariants, with explicit `organizationId` predicates and RLS enabled with zero policies (repository convention; the application layer remains the primary control).

**Explicit IDOR tests are mandatory** for: case read and write, cross-organization approver assignment, cross-organization clearance action, cross-organization document attachment, cross-organization asset and inventory reference, cross-organization exit process, grievance ESS self-scope, and forged scheduled-job payloads. No cross-organization identifier may permit reading, writing, approving, clearing, attaching documents to, or discovering another tenant's records.

### 28.25 Protected capabilities — do not rebuild

`employees.id` identity, employee numbering, PIF, the separation service, the rehire service, `employment_periods` and the WS-11 lifecycle services, Recruitment conversion, Onboarding (WS-10), WS-5 Documents, the WS-6 scheduler, WS-3 audit, WS-8 custom fields and forms, the Assets custody model, the Office Inventory ledger, and the existing `employee_disciplinary_records` and `employee_exit_processes` surfaces. **WS-12 extends behaviour around them.**

### 28.26 WS-11.1 follow-on scope remains deferred

The WS-11 follow-on items — organization-configured acting auto-revert, configurable employment types, contract extension and amendment, additional lifecycle event capabilities, temporary assignment support, accepted-offer to employment-term handoff, lifecycle letter generation, additional acting and probation metadata, and write-side Employment Lifecycle UI — are **preserved as WS-11.1 and must not be implemented as part of WS-12**.

If implementation discovers a genuine blocking dependency on one of them, **stop and report the dependency** rather than silently changing WS-11.

### 28.27 Open items still requiring decision at implementation time

None blocking. Q1 through Q6 are resolved above. The following are conditional by design and are to be decided **from repository evidence during implementation**, each recorded with its reason:

1. Whether disciplinary and grievance cases share one chronology-event table with a discriminator or take one each (§28.3, §28.4) — a normalization judgement that must not weaken the §28.4 ruling that the **case** records themselves are distinct.
2. Whether the WS-5 confidentiality dimension (§28.11) is a column on `employee_documents`, a document-category setting, or a separate access-control record — to be chosen for the smallest additive, backward-compatible change.
3. Whether clearance items reference `document_requirements` (which already supplies required/provided/verified/rejected/expiry) or carry their own evidence pointer (§28.8) — the §26.1 reasoning applies and should be re-checked against real clearance semantics.
4. Whether the exit-interview questionnaire binds a new WS-8 scope or attaches to the existing employee scope (§28.15) — following the WS-10 precedent where a shipped authoritative record made a scope bindable.
5. Whether the three legacy booleans on `employee_exit_processes` are derived in the read model or retained as denormalized cache columns (§28.8) — they must never be independently settable either way.

---

## 29. WS-13 Workstream Architecture Freeze — Employee Data Change Approval & HR Service Requests

Recorded by the Owner after a read-only Pass-1 reconciliation established that **both WS-13 pillars are greenfield**, that **three different proven approval shapes already ship**, and that **WS-8 pre-recorded a contract naming Employee Data Change as a future consumer of its form submissions**. Six genuine forks were put to the Owner and answered before this section was written; they are recorded below as Decisions A, B, F, G, J and P, with four binding clarifications folded into Decisions B, D, E and K.

This section is **purely additive**. The 31 Owner Decisions in §22 are untouched. **OD #10 and OD #11 are implemented, not amended.** **OD #14 and OD #15 are expressly NOT claimed by this workstream** (§29.9). OD #23's masking, already shipped in WS-3, is reused and not reimplemented. WS-1 through WS-12 remain complete and are not reopened.

WS-13 is **P1/P2** and depends on **WS-6 (light)**, which is complete. WS-14 does not depend on it.

**Priority note.** OD #11 (Employee Data Change Approval) is **P1** while OD #10 (HR Service Requests) is **P2**, so a P1 and a P2 decision sit inside one workstream — the same shape §27 recorded for WS-11. This is recorded, not resolved: if delivery must be split, the data-change work is the P1 half.

### 29.1 Corrected repository facts (mandatory reconciliation)

Verified read-only at `2435ae2`, migration ledger `0068`:

1. **Both pillars are genuinely greenfield.** No `change_request`, `data_change`, `field_change`, `service_request` or `hr_request` table, service or route exists anywhere.
2. **An employee cannot change their own employee record at all today.** `PATCH /organizations/:organizationId/employees/:employeeId` is gated on `employee.write` (HR), and the only self-service writes in `me.ts` are profile-picture upload and delete. **A data-change request is therefore not a gate placed over an existing self-service path — it IS the path**, and this materially shapes Decision A.
3. **Three proven approval shapes already ship, and they differ from one another.** *Leave* is a hard-coded two-stage Department Head → HR chain with per-stage columns and a `pending`/`pending_hr`/… status enum. *Recruitment (WS-9)* is the most general and most recent: configurable ordered `recruitment_approval_stages`, **three server-defined authority resolvers** (`department_head`, `permission_holder`, `specific_membership`), an append-only decision log, and a **stage count frozen at request time** so reconfiguring a chain cannot retroactively change whether an in-flight request is complete. *Office Inventory* adds effective-dated delegation with a live re-check that the delegating Head is still the Head at the moment of every approval.
4. **WS-8 pre-recorded a contract for this workstream.** §24.23 states that a form submission "may later feed a *specialized* domain workflow (**Employee Data Change**, Recruitment, Onboarding)". `custom_forms` already carries an `employee_ess` form type, and `custom_form_submissions` is deliberately a bare record — form, version, scope, entity, answers, submitter, timestamp — with **no status and no lifecycle of any kind**. WS-8 supplies the form layer; WS-13 supplies the request lifecycle above it.
5. **OD #23 masking is already implemented.** WS-3's `lib/sensitiveData.ts` provides `maskAccountNumber` and `maskIdentifier`, and banking and statutory identifiers live in payroll-owned tables served by `payrollSensitiveRecords`. WS-13's "configurable sensitive fields" is a **different axis** — which fields require approval to change — and is not a second masking implementation.
6. **WS-6 deliberately built no approval inbox.** Its own record states "no HR Action Centre, no manager approval inbox, no dashboards", and the org-wide **HR Action Centre belongs to WS-15**.
7. **`employees.updatedAt` exists with `$onUpdate`**, giving a natural anchor for stale-change detection (§29.10).
8. **`generated_documents` already carries a polymorphic `sourceType`/`sourceId`** plus `templateId`, `templateVersionId` and `categoryCode` — everything a fulfilled letter request needs to point at its own document without WS-13 storing one.
9. **The `employees` table mixes three ownership classes in one row**: personal and contact fields; employment fields owned by the WS-11 lifecycle services (`employmentStatus`, `positionId`, `departmentId`, `separationDate`, `probationEndDate`); and pointers to payroll-owned sensitive records. Decision B exists because of this.

### 29.2 Decision A — Two origins, one request architecture

WS-13 supports **two legitimate request origins through a single shared request and decision architecture**. Two parallel engines — one for ESS, one for HR — are forbidden.

**Employee-originated.** An authenticated employee may request changes to eligible fields on **their own** record through ESS. **The server derives the subject employee from the authenticated employee relationship** (`employee_user_links`, the resolver WS-10 and WS-12 already use). A browser-supplied employee id is never trusted for an own-data request — the request body carries no subject identifier at all, exactly as §28.5's ESS grievance submission does. The request stays pending until the required verification and approval complete; **only then may the authoritative record change**.

**HR-originated.** An authorized HR user may propose a change to another employee's eligible field. Where the organization has configured that field to require approval, the change **must** travel through maker-checker (§29.6) rather than direct mutation.

**Origin is recorded explicitly on every request** — `employee_self_service` or `hr_originated` — so policy, reporting and audit can distinguish them. It is derived server-side from how the request was raised, never accepted from the client.

### 29.3 Decision B — The eligible-field registry

WS-13 governs **only an explicit, product-defined, typed registry of eligible change targets**. There is no "any employee column" mechanism, and no configuration path that can create one.

**Excluded by construction**, regardless of any organization's configuration:

- Employment Lifecycle authoritative fields, and every separation or employment-status transition
- Department, position and designation changes where the lifecycle architecture owns the transition
- Payroll-owned banking, statutory and pay-sensitive records
- Leave-owned records
- Assets and Office Inventory
- Disciplinary and grievance state
- Identity & Access, roles, permissions, MFA and administrative status
- Any other specialist-module authoritative state

This is §27.20 and §28.16's cross-module boundary applied a third time, and the reason is concrete: `employees` mixes ownership classes in one row (§29.1(9)), so a registry keyed on "column exists" would hand WS-13 a route into separation, promotion and banking. **WS-13 must never become a generic backdoor around another module's invariants.**

Where a request concerns another module, WS-13 may **record and route** it where authorized, but **the authoritative mutation remains owned by that module**.

The registry is a code-level allow-list — adding a target is a deliberate change a reviewer can see, the same reasoning that keeps WS-9's authority resolvers server-defined and §24.8's custom-field scopes a closed enum.

### 29.4 Decision C — Approval is configurable only within the eligible set

For each **eligible** target, an organization configures one of two dispositions:

- **direct** — an authorized HR update applies immediately, as it does today; or
- **approval required** — the change must travel as a request and be decided.

**Configuration may never convert a specialist-module-owned field into a generic WS-13 field.** A field excluded by §29.3 stays excluded whatever the configuration says, and the server validates configuration against the registry rather than trusting stored settings.

**Not every HR edit becomes maker-checker.** Making every edit reviewable would be a silent, organization-wide authorization change to shipped behaviour, and §28.17's precedent refuses exactly that. Organizations choose which eligible fields warrant it.

### 29.5 Decision D — Specialized workflows remain specialized

OD #10's shared foundation applies **only to suitable requests**. Where a domain already has real business workflow, WS-13 does not rebuild it as a generic service request. That covers Leave, Recruitment, Onboarding, Employment Lifecycle, disciplinary and grievance, Payroll, Assets and Office Inventory.

A service request may provide an **entry point or referral** where the architecture permits, but it **cannot become an alternate source of truth** for a domain that owns its own records. This restates OD #10's own "no giant generic workflow engine" and §24.23's "generic form approval workflow — out of scope".

### 29.6 Decision E — Maker-checker

Where approval is required, **`requester != approving actor`**, enforced **server-side** on every decision path.

This binds HR-originated requests as much as any other, and it is not satisfied by hiding a button: frontend concealment is not authorization, the rule §28.17 already states for WS-12. An organization whose only eligible approver is the requester gets a request that cannot be self-approved — that is the correct outcome, not a bug to engineer around.

### 29.7 Decision F — Approval does not expand data visibility

**Being named an approver must never expose data the actor is otherwise prohibited from seeing.**

The approval DTO carries the **minimum information required to make the permitted decision** — the field being changed, its requested value, its previous value where the approver is entitled to it, the subject, the origin and the justification. It is built field by field, never spread from the employee record, the same construction §28.5 required of the ESS grievance view and for the same reason: a spread-based DTO starts leaking any column added later, silently.

**Sensitive values continue to observe existing masking and security rules.** Where OD #23 masking applies to a value today, it applies inside an approval DTO too. Approval is not a reveal.

### 29.8 Decision G — A bounded approval-stage and resolver model

WS-13 builds its **own namespaced** approval configuration, modelled on WS-9's proven architecture: configurable ordered stages, server-defined authority resolvers, a **stage count frozen at request time**, and an **append-only decision history**.

**Shipped Recruitment is not refactored to consume new shared tables, and Recruitment must not be made to depend on WS-13.** Architectural duplication is deliberately preferred here to destabilising a completed workstream — the §27.21 and §28.25 protected-capabilities rule. A future implementation of OD #14 may extract the common primitives deliberately; **WS-13 is not that refactor**.

WS-9's safeguards are followed where they apply, in particular that **later configuration changes must not alter an in-flight request**.

Resolvers are server-defined. There is **no rule DSL, no expression evaluator and no generic state machine** — the same constraint §25.2 placed on Recruitment.

### 29.9 Decision H — OD #14 and OD #15 are not claimed

WS-13 **must not claim to complete OD #14 or OD #15**. Both are approved and **assigned to WS-16** (corrected in §31.38). WS-16's architecture is now frozen in **§32**; its implementation has not started.

Accordingly WS-13 builds: no cross-product generic approval engine; no generalized system-wide delegation framework; no unrequested refactor of Office Inventory delegation; no unrequested refactor of Recruitment approval resolution.

A bounded authority resolver **inside** WS-13 is permitted (§29.8). **Assignment and reassignment for HR service fulfilment is not approval delegation** and must not be described or built as one. True approval delegation stays deferred until a workstream explicitly owns it.

### 29.10 Decision I — Stale-change and concurrency protection

A request records the **previous value of each target field, captured when the request is raised**. At decision time the service **re-reads the current value and compares**.

If the authoritative value has moved since the request was raised, the decision **must not silently overwrite it**. The request is surfaced as **stale** and requires an explicit, audited re-confirmation; it is never applied on the assumption that the world stood still. This is the same reasoning that makes WS-6's job handlers re-fetch authoritative state and no-op when stale, and that makes WS-12's reminders permanent no-ops rather than blind writers.

`employees.updatedAt` (§29.1(7)) supports coarse detection; **per-field previous-value comparison is the authoritative check**, because a change to an unrelated field on the same row must not invalidate an untouched request.

Concurrency is protected at the database where a constraint can express the rule — at most one pending request per (employee, field) — rather than by a read-then-write check two concurrent submissions could both pass, following §27.5, §28.8 and WS-9.

Application of an approved change is **transactional and idempotent**: a retried decision must not apply twice, and a partially applied multi-field change must not be possible.

### 29.11 Decision J — Effective dating

WS-13 distinguishes, and stores separately:

- **requested at** — when the request was raised
- **decided at** — when each decision was recorded
- **effective date** — when the change takes effect in the business sense
- **applied at** — when the authoritative record was actually written

`createdAt` alone is never treated as any of these — the effective-dating rule §28 already states.

**A future effective date does not licence a scheduled job to apply the change.** §27.11's platform-wide rule stands: a job may detect, remind and surface, but applying a consequential change is an authorized human act. Where an organization wants dated application, that is a configurable policy requiring its own Owner Decision, exactly as acting auto-revert was.

Where a field has no meaningful business effective date, the effective date is the application instant, and the model does not invent one.

### 29.12 Decision K — HR Service Request lifecycle and configuration

WS-13 provides the **shared configurable HR Service Request foundation** OD #10 authorizes, covering suitable simple requests: employment-letter request, document request, HR enquiry, and simple organization-defined requests.

**Request types are organization-configured** — label, whether approval is required, who fulfils, whether a WS-8 form supplies the request's own fields — within a product-defined set of behaviours. There is no scripting and no arbitrary workflow definition.

WS-13 owns, for every request: submission, acknowledgement, assignment, status, approval where the type requires it, fulfilment tracking, employee-facing status, and the **resulting document reference** where one exists.

Statuses stay small and are drawn from a fixed set; anything derivable — age, overdue against a configured target — is **derived, never stored**, the treatment §28.23 gave case ageing.

### 29.13 Decision L — Documents & Records integration

**WS-13 owns no document generation.** HR generates through the existing WS-5 capability, and a fulfilled request **references the resulting `generated_documents` record** through the polymorphic pointer that already exists (§29.1(8)). No second document store, no second template system, no second renderer.

**A request for a letter and automatic lifecycle-event letter generation are separate concepts.** WS-11.1's deferred lifecycle-letter automation is **not** implemented, wired or partially anticipated here, and remains deferred (§29.22).

Where a request's supporting evidence is a document, it uses WS-5 and observes WS-12's confidentiality dimension where applicable.

### 29.14 Decision M — WS-8 Form Builder reuse

Where a request type needs its own question set, it uses **WS-8 Custom Forms** — fulfilling the contract §24.23 pre-recorded and following the WS-10 and WS-12 precedent. **No second questionnaire or form engine is built.**

`custom_form_submissions` remains what it is: a bare submission record with no status and no lifecycle. **WS-13 adds the lifecycle above it by reference and does not add workflow columns to WS-8's tables** — §24.23's "generic form approval workflow — out of scope" is upheld, not quietly relaxed.

§24.3's prohibited domains stand. Nothing in WS-13 makes a prohibited domain reachable through a custom-field scope.

### 29.15 Decision N — WS-6 notifications and reminders

WS-6 only, in-app only; no email or SMS capability exists in this platform.

Legitimate events: request submitted, acknowledgement due, approval pending, decision recorded, request assigned, fulfilment due, request overdue.

**Scheduled jobs must not decide, approve, reject or apply anything.** §27.11's platform-wide rule and §28.20 apply with full force: a job may remind and surface; it may never record a decision or write an authoritative field. Handlers re-fetch authoritative state and return a permanent no-op when stale, following the shipped `onboarding.*`, `employment.*` and `employee_relations.*` pattern.

**Notification bodies carry no sensitive value.** A notification list is a wider audience than the record's own permission — the rule §28.20 already established.

### 29.16 Decision O — Payroll and sensitive-data exclusions

Payroll-owned banking, statutory and pay-sensitive records are **excluded from the eligible registry by construction** (§29.3). WS-13 neither changes them nor becomes a route to reading them.

Where a request merely *concerns* such a record, WS-13 may record and route it, and the authoritative change happens in the owning module by an actor holding that module's own authority.

**OD #23 masking is reused, never reimplemented.** Existing masking rules apply unchanged inside WS-13 surfaces, including approval DTOs (§29.7).

### 29.17 Decision P — Operational UI, stated explicitly

**This decision is deliberately explicit so that no implementation may later report a required write as "API-only".**

WS-13 must ship a **WS-13-scoped Requests and Approvals operational surface sufficient for normal WS-13 work to be performed through the application**. The following user actions are frozen as reachable **through the UI**, not merely through the API:

| Actor | Action that must be performable in the application |
| --- | --- |
| Employee (ESS) | Raise a data-change request on their own eligible fields |
| Employee (ESS) | Raise an HR service request of a configured type |
| Employee (ESS) | See their own requests and current status |
| HR | Raise a data-change request against another employee's eligible field |
| HR | See the queue of pending data-change requests |
| HR | See the queue of HR service requests, and those assigned to them |
| Approver | Open a request and **approve, reject or return** it |
| Fulfiller | Record fulfilment, including attaching the resulting document reference |
| Configurer | Manage request types and the per-field approval configuration |

Read-only surfaces alone do **not** satisfy this decision.

**This is not the organization-wide HR Action Centre.** Leave approvals, Recruitment approvals, Onboarding actions, Employee Relations actions, Payroll actions and other module tasks **must not** be aggregated into this workspace merely because WS-13 has approvals. **WS-15 retains ownership of the future cross-module HR Action Centre.**

Nav visibility is presentation; **every endpoint enforces its own permission server-side**.

### 29.18 Decision Q — Permissions

Reconciled against existing conventions before minting keys. The minimum for genuinely new actions: reading and managing data-change requests, deciding them, reading and managing service requests, fulfilling them, and configuring request types and field dispositions.

**Employee self-service mints no permission key.** An employee's right to raise a request about their own data comes from their employee link, resolved server-side — the precedent WS-10 and WS-12 both set, and for the same reason: a right that an administrator could withhold is not self-service.

Approval authority is resolved through §29.8's resolvers, **never inferred from a role name** — the §25.2 ruling, extended again.

Configuration authority is separated from operational authority, mirroring the WS-8/WS-10/WS-11/WS-12 split. Existing shipped permissions, `employee.write` included, are **not redefined, renamed or re-gated** (§27.21, §28.17).

### 29.19 Decision R — Audit and history

WS-3 infrastructure only; **no alternative audit system** (OD #16).

Audited: request raised, request updated, each decision, stale re-confirmation, application of an approved change, rejection, return, cancellation, assignment, fulfilment, and every configuration change to request types or field dispositions.

Every entry carries actor, organization, subject employee, action, reason where required, effective date, relevant before/after metadata, request id and timestamp — **and the request's origin** (§29.2).

**Request history and audit are complementary and never conflated**, the distinction §27 and §28 both drew. The decision log is append-only: a later decision never overwrites an earlier one.

Where a WS-13 surface reads data that OD #18 classifies as sensitive, it uses the **existing** sensitive-read path WS-12 shipped (§28.12) rather than a second one.

### 29.20 Decision S — Tenant isolation

Every WS-13 entity is organization-scoped under existing invariants, with explicit `organizationId` predicates and RLS enabled with zero policies (repository convention; the application layer remains the primary control).

**Explicit IDOR tests are mandatory** for: request read and write, cross-organization subject employee, cross-organization approver or assignee, cross-organization decision, cross-organization form submission reference, cross-organization document reference, ESS self-scope, configuration read and write, forged scheduled-job payloads, and the reporting read models. No cross-organization identifier may permit reading, writing, deciding, fulfilling, attaching to or discovering another tenant's records.

### 29.21 Decision T — Reporting

Minimum P1 read models only: pending data-change requests and their ageing, open service requests by type and ageing, requests awaiting a given approver, and completed requests.

Permission-filtered and confidentiality-aware — **a report must never become the route by which a value reaches a caller who could not read the record itself** (§28.23). Derived ageing, never stored. **WS-13 is not an analytics workstream**; WS-15 owns reporting consolidation.

### 29.22 Scope classifications

- **SLA and escalation** — a configured target date and an overdue *derived* state plus WS-6 reminders are **IN SCOPE**. An escalation engine that reassigns or auto-decides is **OUT OF SCOPE**; auto-deciding is forbidden outright by §29.15.
- **Delegation** — **DEFERRED** to OD #15's future owner (§29.9). Assignment and reassignment for fulfilment is not delegation.
- **Bulk migration** — the existing WS-7 framework is the only importer; **no separate importer**, and **no fabrication of historical requests or decisions** from incomplete data (the §27.3, §28.2 principle). Adapters are **deferred**.
- **AI** — **no autonomous AI decision of any kind**: no AI approval, rejection, eligibility determination, or automatic application of a change. Nothing is proposed or built in WS-13; anything future stays inside OD #24/#25/#26's approved envelope with explicit human confirmation.

### 29.23 Cross-module side-effect boundary

| Module | WS-13 may | WS-13 must not |
| --- | --- | --- |
| **Employment Lifecycle (WS-11)** | reference; route a request | change status, position, department, separation or any lifecycle field |
| **Payroll** | reference; route a request | change or expose banking, statutory or pay-sensitive records |
| **Leave, Attendance** | reference | mutate balances, policies or records |
| **Assets, Office Inventory** | reference | alter custody or move stock |
| **Employee Relations (WS-12)** | reference | alter case, grievance or clearance state |
| **Identity & Access** | record that a change was requested | mutate accounts, roles, permissions, MFA or admin status |
| **Documents (WS-5)** | reference a generated document | generate, store or template one itself |
| **Custom Forms (WS-8)** | reference a submission | add workflow state to WS-8's tables |
| **ESS** | surface own-scope requests and status | expose another employee's data or an approver's internal notes |

### 29.24 Protected capabilities — do not rebuild

`employees.id` identity, employee numbering, `employee.write` and the shipped employee update path, the WS-11 lifecycle services, the Leave approval chain, Recruitment approval configuration and its resolvers, Office Inventory delegation, WS-5 Documents, WS-8 custom fields and forms, the WS-6 scheduler, WS-3 audit and OD #23 masking, and the WS-12 Employee Relations surfaces. **WS-13 extends behaviour around them.**

### 29.25 Deferred dependencies recorded, not solved

- **WS-12's future separation basis.** Nothing in this platform records an approved *future* resignation, retirement or termination, which is why WS-12 recognizes only `already_separated` and `contract_end`. **WS-13 does not solve this and must not create a parallel separation source** — a "resignation" service request is a request, never a separation basis, and §29.3 excludes lifecycle fields by construction. The dependency stays recorded for whichever future workstream owns it, with its own Owner Decision.
- **WS-11.1 remains deferred in full** — organization-configured acting auto-revert, configurable employment types, contract extension and amendment, temporary assignment, accepted-offer to employment-term handoff, **lifecycle letter generation**, additional acting and probation metadata, and write-side Employment Lifecycle UI. If implementation discovers a genuine blocking dependency, **stop and report it** rather than silently changing WS-11.
- **OD #14 and OD #15** are approved and **assigned to WS-16** (§29.9; corrected in §31.38). WS-16's architecture is now frozen in **§32**; its implementation has not started.

### 29.26 Open items still requiring decision at implementation time

None blocking. Q1 through Q6 and clarifications A through D are resolved above. The following are conditional by design and are to be decided **from repository evidence during implementation**, each recorded with its reason:

1. Whether data-change requests and HR service requests share one request table with a discriminator or take one each (§29.2, §29.12) — a normalization judgement that must not weaken the §29.2 ruling that both origins share **one decision architecture**, nor the §29.5 ruling that specialized workflows stay specialized.
2. Whether the decision log is one table across both request kinds or one per kind (§29.8) — to be settled the way §28.27 item 1 was: prefer a real foreign key to a polymorphic pair this repository can only express without one.
3. Whether the eligible-field registry lives beside the WS-13 service or in `@workspace/db` (§29.3) — the §27.22 item 4 reasoning applies: it governs what the platform may **write**, not what the column may hold.
4. Whether a request type's WS-8 form binds a new custom-field scope or reuses an existing one (§29.14) — following the WS-10 and WS-12 precedent, and binding to whichever entity keeps the submission tied to the right request.
5. Whether the per-field approval disposition is stored in `organization_settings` or its own configuration table (§29.4) — to be chosen for the smallest change that still lets the server validate configuration against the registry.

---

## 30. WS-14 Workstream Architecture Freeze — Skills, Competency Framework & Succession

Recorded by the Owner after a read-only Pass-1 reconciliation found that **one half of this workstream is already partly built and the other half is genuinely greenfield**, and that the word "competency" is already taken by shipped Performance Management code. Nine forks were put to the Owner and answered before this section was written; they are recorded below as Decisions A through I, with six binding clarifications folded into Decisions E, F, G, H, K and O.

This section is **purely additive**. The 31 Owner Decisions in §22 are untouched. **OD #5 and OD #7 are implemented, not amended**; OD #4, #13, #16, #17, #18, #23 and #24–#26 constrain it. WS-1 through WS-13 remain complete and are not reopened.

WS-14 is **P2** and depends softly on **WS-9** (complete). WS-15 does not depend on it.

### 30.1 Corrected repository facts (mandatory reconciliation)

Verified read-only at `69f1f14`, migration ledger `0069`. The register's "Formal proficiency framework, competency linkage, new internal-succession schema" is accurate, but §6's "ALREADY IMPLEMENTED (base)" materially understates how thin the base is, and one term collides:

1. **`employee_skills` already exists and is live** (Phase 2A, W24). It carries a free-text `skillCode` from the `skill` Master Data domain, a **free-text `proficiencyLevel`**, and `createdBy`. It has **no scale, no verification, no assessor, no assessment date, no evidence, no expiry and no history**. The "formal proficiency framework" OD #5 asks for is genuinely absent.
2. **A `skill` Master Data domain already exists**, registered in `master-data-definitions.ts` alongside 25 other domains. `master_data_items` carries only `domain`, `organizationId`, `code`, `label` and `sortOrder` — no category, scale binding, evidence expectation or expiry applicability.
3. **"Competency" is already a shipped term with a different meaning.** `performance_template_competencies` and `performance_review_competencies` are **per-template, free-text review criteria carrying weights** — the template's own header states they are "free text by default". They are review criteria, not a reusable organizational capability library. Decision A exists because of this.
4. **A proficiency-scale precedent exists but belongs to Performance.** `performance_rating_scales` plus `performance_rating_scale_levels` is an organization-scoped named scale over a numeric value with sort order. Decision B copies the *pattern*, not the *tables*.
5. **Performance Management is fully implemented** (Phase 3C): cycles, templates, reviews, self/manager/HR stages, `computedOverallScore`, `hrOverrideScore`, scoring, acknowledgement, dashboards and reports. Succession therefore *can* have an authoritative performance input, which is why Decision N is a boundary rather than a gap.
6. **A Learning module is fully implemented**: `learning_courses`, `learning_course_sessions`, `learning_enrollments`, `learning_enrollment_evidence`, `learning_certificates`. WS-14 has no reason to build one, which is why Decision M is a linkage rather than a build.
7. **Qualifications and certifications already exist**, and `employee_certifications` already carries `expiryDate`. `lib/deadlineStatus.ts` already computes derived expiry states. **No certification-expiry reminder job exists.**
8. **Talent Pools are recruitment-side only.** `talent_pool_members` keys on `candidateId`; there is no employee dimension anywhere. OD #7's "distinct from existing Talent Pools" is therefore already true in the data, and Talent Pools are not touched.
9. **`positions` is the entire job model**: `id`, `organizationId`, `title`, `departmentId`. There is **no designation, job family, career level or job-profile table**. Decision G attaches requirements to what exists rather than inventing a job architecture.
10. **Succession is genuinely greenfield.** A repository-wide search for succession, successor, readiness, critical role and bench strength returns nothing in schema, services or UI.
11. **Every shipped skills, qualification and certification route — including the GETs — is gated on `employee.write`.** A read sits behind a write permission. Decision P records this as a documented legacy anomaly rather than perpetuating it silently.
12. **`employees.reportingManagerId` exists**, which is what makes Decision G's manager resolver possible without inventing a relationship or reading a role name.

### 30.2 Decision A — One capability catalogue, centred on Skills

WS-14 uses **one reusable capability catalogue, centred on Skills**. It does **not** mint a second reusable `competencies` entity.

The reason is §30.1(3): "competency" already means per-template review criteria in shipped Performance code. Minting a second, differently-shaped Competency entity would leave two meanings of one word in one platform, and renaming Performance's would re-gate working code — the change §27.21 and §28.17 refuse.

Breadth is carried by **category** instead: technical, behavioural, leadership, functional, compliance and organization-defined categories. An organization that thinks in "competencies" models them as behavioural or leadership skills, and loses nothing.

**Performance's competency and review-criteria tables are untouched.**

### 30.3 Decision B — A WS-14 proficiency scale, structurally modelled on Performance

WS-14 owns an **organization-scoped proficiency scale**: named levels, organization-configurable labels, and a **fixed internal ordinal** that gives stable comparison.

`performance_rating_scales` is **not reused directly**. Copying the pattern and owning the storage keeps the two independent — otherwise an edit to a performance scale would silently change what a capability requirement means, coupling two modules that have no business being coupled.

**Per-skill scales are out of scope** for this workstream: real precision, disproportionate complexity.

The default is **one active scale per organization**. A bounded historical or versioning model is permitted only where implementation evidence shows a live requirement genuinely needs it (§30.27 item 2).

The ordinal exists so the platform can compare a requirement against a capability, compute a gap, report, and evidence readiness. **It must never be surfaced as though it were an objective universal competence score** — it is an ordering within one organization's own labels.

### 30.4 Decision C — A typed WS-14 skill catalogue

WS-14 owns a **typed skills catalogue**. The existing `skill` Master Data domain **remains intact and is not widened**: `master_data_items` is shared by 25 other domains, and adding WS-14 metadata to it would impose this workstream's shape on all of them.

The catalogue holds what the framework needs and no more: stable code, name, description, category, active/inactive, whether proficiency applies, evidence expectation, and certification/expiry applicability.

**A safe import path from existing organization `skill` Master Data items is provided**, and it must not silently duplicate the same organization's skill on repeated runs — the idempotency §26 required of the onboarding handoff, applied again.

### 30.5 Decision D — Employees may claim; a claim is not a verification

Employees may **declare their own skills through ESS** where permitted. A self-declared skill is **not automatically authoritative and not verified**.

The record carries a small, explicit lifecycle — **claimed, assessed, verified, rejected** — using the smallest clean shape §30.7 defines.

**Employees must be able to tell their own claim from an organization-verified skill** in the interface. A surface that renders both identically would make the distinction meaningless in exactly the place it matters most.

### 30.6 Decision E — Verified capability is the authoritative comparison basis

Wherever WS-14 computes position gaps, succession development gaps, organizational skill availability or required-versus-available capability, it uses **current verified capability**.

A claimed but unverified skill may be **shown separately** and must **never satisfy an authoritative position requirement**.

**"Not recorded" and "not verified" are not evidence that somebody lacks a capability**, and no WS-14 surface may present them as such. Three states are kept distinct everywhere:

- **missing verified evidence** — nothing recorded, or recorded but unverified;
- **verified proficiency below requirement**;
- **verified proficiency meeting or exceeding requirement**.

This is the same discipline §28.2 applied to legacy disciplinary history: absence of a record is an honest absence, never an inferred negative fact.

### 30.7 Decision F — Claim, assessment, verification and current capability are four things

**They must not collapse into one mutable `proficiencyLevel` column.** The architecture distinguishes:

- the **employee's claim** — what the person says;
- an **assessment** — an authorized assessor's observed proficiency, at a point in time;
- a **verification** — the organization confirming a capability as authoritative;
- the **current verified proficiency** — the projection the rest of the platform compares against.

**Assessment history is append-only.** A new assessment never erases the previous one; the system may expose a current or latest projection, but prior assessments remain auditable. This is the balanced pattern §27, §28 and §29 all used: a projection for reading, an append-only record for truth.

**No 360-degree assessment is built.**

### 30.8 Decision G — Assessors, and where requirements attach

**Skill requirements attach to the existing `positions` architecture.** WS-14 introduces **no designations, job profiles, job families or career levels** merely to host them — inventing a job architecture is a separate workstream's decision, not a side effect of this one.

Authorized assessors are:

1. **HR users holding the explicit WS-14 assessment permission**; and
2. **the employee's authoritative reporting manager**, resolved from the existing `reportingManagerId` relationship.

**Manager authority is never derived from a role name** — the §25.2 ruling, extended a fourth time.

**Manager assessment and HR verification are separate acts.** A manager may record observed proficiency; that assessment is preserved historically and **does not automatically become the organization-verified record** unless the frozen policy explicitly permits that path. Verification is HR's, or another explicitly authorized capability's.

### 30.9 Decision H — Position requirements

A position requirement carries at minimum: the **skill**, the **required minimum proficiency**, and a **required-or-preferred classification**.

**No weighting or scoring engine.** WS-14 is not a job-evaluation system, and a weighted capability score would invite exactly the false precision Decision J refuses elsewhere.

### 30.10 Decision I — Gap semantics

A gap is computed as **required minimum proficiency versus current verified proficiency**, per skill, using Decision B's ordinal and Decision E's three states.

Gaps are **derived, never stored** — a persisted gap would be wrong the moment either side moved, the reasoning §27.6 applied to contract expiry and §28.23 to case ageing.

**No recommendation engine, and no ranking of people by gap.**

### 30.11 Decision J — Succession applies to organization-selected critical positions

Succession applies **only to positions an organization has identified as critical**. **No succession plan is required for every position.**

**One critical position may have multiple candidates, and one employee may be a candidate for multiple critical positions.** Neither is limited.

### 30.12 Decision K — An unranked candidate pool

Candidates form an **unranked pool**. **No numeric successor ranking is built.**

The interface may **group or filter by readiness**, but readiness must never be presented as, or reconstructible into, a hidden numeric rank. Ranking people for succession carries real employment consequences, and the Owner has declined to create that artifact.

### 30.13 Decision L — Readiness is human-owned

Readiness uses an **organization-configurable named scale with ordered categories**, sufficient for reporting and grouping.

**The system never calculates final readiness.** Capability gaps, performance information and other evidence **inform** the human decision; they do not determine it. Readiness changes are preserved historically (§30.7's append-only discipline applies here too).

**No potential score, no potential assessment, and no 9-box matrix.** Potential is not inferred from performance scores. A 9-box would be buildable now that Performance exists — that is precisely why its absence is recorded as a decision rather than a gap.

### 30.14 Decision M — Development actions link to Learning; they do not become Learning

WS-14 may record a **development action or need** arising from a capability gap, a readiness assessment or an assessment finding, carrying a note, an optional target date, a status where required, an **optional link to an existing Learning course or enrolment**, and supporting evidence.

WS-14 **must not** build a second course catalogue, learning content, attendance, exams or certificate issuance, and **must not automatically enrol anybody merely because a gap exists**.

**The Learning module remains authoritative.** Default to observe-and-link; any course or enrolment reference is validated for organization ownership before storage. WS-14 does not mutate Learning state.

### 30.15 Decision N — Performance is a read-only supporting input

Performance Management already exists and may be **read** as supporting evidence for a human succession decision.

WS-14 **must not** rebuild Performance, change a performance score, automatically calculate readiness from performance, create a 9-box, or make Performance depend on WS-14. Any linkage is bounded and observe-only — the cross-module rule §27.20, §28.16 and §29.23 each restated.

### 30.16 Decision O — Succession decisions never touch employment state

A succession candidacy or readiness decision must **never** promote, transfer, appoint, separate, rehire, create an acting appointment, change a position or change a reporting line.

**WS-11 remains authoritative for employment lifecycle state**, and "ready now" is not an appointment. This is the same boundary §27.6 drew for contract expiry, §27.8 for unsuccessful probation, §28.7 for offboarding clearance and §29 for approved data changes: recording a judgement is not performing an act.

### 30.17 Decision P — Confidentiality, and the Organization Admin boundary

**Succession information is confidential HR information** and requires explicit succession permissions.

**Organization Admin status alone does not grant confidential succession access** — the §28.17 precedent, and for the same reason: a succession plan may concern the administrator, or somebody they line-manage.

**Employees see nothing of succession through ESS** — not their own candidacy, not target roles, not readiness, not notes, not the pool, not review information. An employee's own skill profile is theirs to see (§30.18); their standing in somebody's succession plan is not.

**Confidential succession reads use OD #18's existing sensitive-read mechanism** — the helper WS-12 shipped (§28.12). **No second read-audit subsystem is built.** The reads classified as sensitive are: opening a succession plan, reading its candidate list, and reading a confidential succession note.

Confidential succession DTOs carry the **minimum** required for the permitted decision, built field by field, never spread from an employee or plan record — the construction §28.5 and §29.7 both required.

**Super Admin gains no routine talent-management visibility**; break-glass remains governed by OD #31.

### 30.18 Decision Q — Employee visibility of their own capability

Through ESS an employee may **view their own skills**, **declare a claim**, see whether each record is claimed or organization-verified, see the **required skills for their own current position**, and see **their own gaps** against it.

They may **not** see other employees' capability records, assessor identities or assessment deliberations, and — per §30.17 — **nothing of succession**.

### 30.19 Decision R — Documents & Records

WS-5 only. Certificates, licences, qualification proof, assessment evidence and succession supporting documents all use the existing store through its polymorphic pointer.

**No second document store.** WS-12's confidentiality dimension (§28.11) applies where the evidence is confidential, and sensitive-read auditing applies where §30.17 classifies the read as sensitive.

### 30.20 Decision S — Certification and expiry boundary

`employee_certifications` already exists with `expiryDate`, and `deadlineStatus.ts` already derives expiry states (§30.1(7)). **WS-14 does not rebuild either.**

WS-14 may treat an **expired certification as no longer current evidence** for a skill that declares certification applicability (§30.4), and may surface expiring and expired states as **derived** — never stored.

**No compliance engine beyond that**, and no statutory rule is encoded.

### 30.21 Decision T — WS-6 reminders

WS-6 only, in-app only; no email or SMS capability exists in this platform.

Legitimate reminders: verification requested, assessment due, certification expiring, succession review due, development action due.

**No scheduled job may change readiness, nominate or remove a candidate, assess competence, verify a claim, or promote or transfer anybody.** §27.11's platform-wide rule, restated for a fifth workstream: automation may remind, never decide. Handlers re-fetch authoritative state and no-op permanently when stale, and notification bodies carry no proficiency value or succession content.

### 30.22 Decision U — Permissions

Minted narrowly, using existing conventions, and covering: skill catalogue read and configure; employee skill read and manage; assessment; verification; position requirement read and configure; succession read; succession manage; confidential succession read; and reporting where an existing key is not already correct.

Assessment and verification are **separate keys**, because §30.8 makes them separate acts. Succession read and confidential succession read are **separate keys**, because §30.17 makes the notes and pool a narrower thing than the plan's existence.

**Employee self-service mints no key** — the right to see and claim one's own capability comes from the employee link, the precedent WS-10, WS-12 and WS-13 all set.

**The legacy anomaly is documented, not perpetuated.** Shipped skills, qualification and certification routes keep their `employee.write` gate exactly as they are — re-gating a shipped public contract is the silent authorization change §27.21 warns against — while **every new WS-14 surface uses the corrected explicit permission architecture**. §30.27 item 4 records the additive compatibility question for implementation time.

### 30.23 Decision V — Audit and history

WS-3 infrastructure only; **no alternative audit system** (OD #16).

Audited: skill created, updated or deactivated; proficiency scale configured; employee claim submitted; claim verified or rejected; assessment recorded; assessment superseded by a later one; requirement added or changed; succession plan created; candidate nominated; readiness changed; candidate removed; confidential note created or changed; succession plan closed.

Every entry carries actor, organization, subject, action, reason where required, relevant before/after metadata, request id and timestamp.

**Confidential succession notes are not copied into audit payloads.** Audit records *that* a note changed and *who* changed it — enough to prove accountability — without duplicating protected content into a store with different read rules, the rule §28.12 established.

### 30.24 Decision W — Tenant isolation

Every WS-14 entity is organization-scoped under existing invariants, with explicit `organizationId` predicates and RLS enabled with zero policies (repository convention; the application layer remains the primary control).

**Explicit IDOR tests are mandatory** for: skill catalogue, proficiency scale, employee skill, skill evidence, assessment, verification, position requirement, succession plan, successor candidate, confidential succession read, cross-tenant document reference, cross-tenant employee reference, cross-tenant position reference, cross-tenant Learning course or enrolment reference, forged assessor, reminder payloads, and every reporting read model.

### 30.25 Decision X — Reporting, migration and AI

**Reporting** — minimum read models only: employee skill matrix, capability gaps, skills by department, required-versus-available capability, certification expiry, critical roles, succession coverage, roles with no successor, ready-now bench, and successor development gaps. All permission-filtered, with confidential succession content excluded from any model a non-confidential reader can reach. **WS-14 is not a workforce-analytics workstream**; WS-15 owns reporting consolidation.

**Migration** — the existing WS-7 framework only; **no second importer**. Adapters for legacy skill catalogues, employee skills, certifications, ratings and succession plans are **deferred**. Nothing fabricates an assessor, a verification, a historical rating, a readiness or a nomination date that the source data does not contain (the §27.3, §28.2 principle).

**AI** — **no AI may rate competence, decide candidacy, rank successors, set potential, set readiness, determine promotions or remove candidates.** Nothing is proposed or built in WS-14. Any future assistance stays inside OD #24/#25/#26's approved envelope with explicit human confirmation.

### 30.26 Decision Y — Frontend operational acceptance table

**This table is an implementation acceptance criterion.** §29.17's lesson applies: a capability whose write path exists only in the API has not been delivered. Read-only surfaces alone do not satisfy this decision.

| Frozen capability | Actor | Read UI | Required write action | Write UI required? | Permission |
| --- | --- | --- | --- | --- | --- |
| Skill catalogue | HR / configurer | Yes | Create, edit, deactivate a skill | **Yes** | catalogue configure |
| Proficiency scale | Configurer | Yes | Define and label levels | **Yes** | catalogue configure |
| Import from Master Data | Configurer | Yes | Run the idempotent import | **Yes** | catalogue configure |
| Employee skill profile | HR | Yes | Add or edit an employee skill record | **Yes** | employee skill manage |
| Own skill profile | Employee (ESS) | Yes | Declare a claim | **Yes** | none — employee link |
| Own gaps against own position | Employee (ESS) | Yes | — | n/a | none — employee link |
| Assessment | HR / reporting manager | Yes | Record an assessment | **Yes** | assessment |
| Verification | HR | Yes | Verify or reject a claim | **Yes** | verification |
| Position requirements | HR / configurer | Yes | Add, edit, remove a requirement | **Yes** | requirement configure |
| Gap view for a position | HR | Yes | — | n/a | employee skill read |
| Critical positions | HR | Yes | Mark or unmark a position critical | **Yes** | succession manage |
| Successor candidates | HR | Yes | Nominate, remove, set readiness | **Yes** | succession manage |
| Confidential succession notes | Authorized reader | Yes | Add or edit a note | **Yes** | confidential succession read/manage |
| Development actions | HR / manager | Yes | Create, update, link to Learning | **Yes** | employee skill manage |
| WS-14 reporting | HR | Yes | — | n/a | reporting / respective read keys |

**Succession must not appear in any employee-facing surface** (§30.17), and this workspace is **not** the organization-wide HR Action Centre, which remains WS-15's.

### 30.27 Open items still requiring decision at implementation time

None blocking. Q1 through Q9 and clarifications A through F are resolved above. The following are conditional by design and are to be decided **from repository evidence during implementation**, each recorded with its reason:

1. Whether claim, assessment and verification are one table with a state discriminator plus an append-only history table, or separate tables (§30.7) — a normalization judgement that must not weaken the ruling that the four concepts stay distinct and that history is append-only.
2. Whether the proficiency scale needs a bounded versioning model, or one active scale per organization suffices (§30.3) — decide from whether a live requirement genuinely needs a historical scale, and prefer the simpler shape.
3. Whether readiness history is its own table or an append-only event log shared with candidacy changes (§30.13) — following the §28.27 item 1 and §29.26 item 2 reasoning: prefer a real foreign key over a polymorphic pair this repository can only express without one.
4. Whether an **additive** compatibility improvement to the legacy `employee.write`-gated read routes is safe without breaking callers, or whether they must be left exactly as shipped (§30.22) — the default is to leave them and document the anomaly.
5. Whether the skill catalogue's Master Data import belongs in the WS-7 framework or is a WS-14 configuration action (§30.4) — it is a one-off organization setup step rather than a data migration, so the latter is likely, but decide against the shipped framework's own boundaries.

### 30.28 Protected capabilities — do not rebuild

Performance Management and its competency and rating-scale tables, the Learning module, Recruitment Talent Pools, `positions` and the organization structure, `employee_qualifications` and `employee_certifications`, `deadlineStatus`, the `skill` Master Data domain, WS-5 Documents, the WS-6 scheduler, WS-3 audit and OD #23 masking, WS-11's lifecycle services, WS-12's sensitive-read helper, and WS-13's request architecture. **WS-14 extends behaviour around them.**

### 30.29 Deferred and out of scope

Full Performance Management, 360-degree review, Learning Management, course management, promotion, transfer and acting-appointment workflows, workforce planning, compensation planning, AI succession ranking, career-path engines, organizational-chart simulation, a generic approval engine, the WS-15 Action Centre, and **WS-11.1 in full**. **OD #14 and OD #15 are approved and assigned to WS-16** (corrected in §31.38); WS-16's architecture is now frozen in **§32** and its implementation has not started. WS-12's future-separation-basis dependency is recorded there and is **not** solved here.

### 30.30 Implementation record (WS-14 Pass 2)

WS-14 is implemented against this section. Migration ledger **0070**, eleven new tables,
purely additive: zero drops, zero altered columns, RLS enabled with zero policies on all
eleven, up/down/up verified on a fresh database, zero schema drift. Full implementation
record in `docs/SKILLS_AND_SUCCESSION.md`.

**The five §30.27 conditional items, resolved from repository evidence:**

1. **Claim, assessment and verification — one record plus an append-only history.**
   `employee_skill_records` holds the current standing with a `claimed / assessed /
   verified / rejected` discriminator; `employee_skill_assessments` is the append-only
   chronology, one row per judgement, never edited. The four concepts stay distinct
   because the *writers* are distinct: `claimSkill` never sets `verified_level_id`,
   `assess` never sets it, and `verify` is the only function in the codebase that does.
   Separate tables per concept would have made "what is this employee's standing on this
   skill?" a three-table question with no database guarantee of a single answer;
   `employee_skill_records_employee_skill_unique` gives that guarantee.

2. **One active scale per organization — the simpler shape, as §30.3 preferred.**
   No live requirement in this repository needs a historical scale, and
   `proficiency_scales_active_per_org_unique` (partial, `active = true`) makes "exactly
   one" a database fact rather than a service convention. Versioning is achieved by
   *archiving*: publishing a new scale deactivates the incumbent inside a transaction and
   retains its levels, so every historical assessment still resolves. A level's label is
   editable and its **ordinal is not** — `relabelLevel` has no path to it, because
   reordering would silently rewrite what a past judgement meant.

3. **Readiness history shares the candidacy event log, with a real foreign key.**
   `succession_candidate_events` carries `nominated`, `readiness_changed`,
   `rationale_updated`, `removed`, `reinstated` and `appointed_elsewhere` against a
   `candidate_id` foreign key — following the §28.27 item 1 and §29.26 item 2 reasoning.
   A separate readiness table would have split one candidate's story across two
   chronologies with no shared ordering, and a polymorphic pair would have bought nothing
   this repository can express.

4. **The legacy routes are left exactly as shipped, and the anomaly stands documented.**
   `GET/POST /organizations/{id}/employees/{employeeId}/skills` keeps its `employee.write`
   gate and its free-text `employee_skills` table; migration `0070` does not reference
   that table. Implementation surfaced one fact §30.22 did not anticipate: WS-14's own
   employee-skill write path wanted **the same URL**. It was moved to `/skill-records`
   rather than shadowing a shipped contract. Consolidating the two models remains a
   separate decision with its own migration path, and is **not** claimed here.

5. **Master Data import is a WS-14 configuration action, not a WS-7 migration.**
   Decided against the shipped framework's own boundaries: WS-7's migration batches carry
   source upload, mapping, validation, approval and execution, and exist for multi-entity
   data migration at cutover. This is a one-off organization setup step reading a domain
   that already lives in this platform. It is idempotent and one-way — Master Data is read
   and never written, and re-running imports nothing.

**Two defects were found by running the tests, and fixed rather than worked around.**
`position_skill_requirements` declared an `active` column that `computeGaps` filters on,
while `removeRequirement` hard-deleted the row — the service was made to match its own
schema, withdrawing rather than deleting, with `addRequirement` reinstating in place so
the `(organization, position, skill)` uniqueness still holds. And the WS-14 permission
seed had written the intended `hr_manager` block into the `org_admin` array, so
`org_admin` received all three succession keys that §30.17 explicitly withholds from it;
the block was moved, and a live test now asserts the absence directly against the seeded
database rather than against the source file.

**§30.26's fifteen-row acceptance table is satisfied in the application**, across four
surfaces: `/skills-settings` (catalogue, scale, Master Data import), `/capability`
(skill profiles, assessment, verification, position requirements, gap analysis,
development actions), `/succession` (plans, candidates, readiness bands, coverage) and
`/my-skills` (own profile, own claim, own gaps). Succession is a separate route from
capability on purpose: its permissions are narrower and are withheld from organization
administration by default, so folding them together would have made one navigation entry
serve two different audiences.

**No AI decides anything, and no scheduled job decides anything.** The four WS-14 job
types are reminders; none can reach `assess`, `verify`, `nominateCandidate`,
`removeCandidate` or `setReadiness`, and a live test asserts that the complete set of
registered `skill.*`, `succession.*` and `development.*` job types is exactly those four.

**Nothing in §30.29 was built.** No 9-box, no potential score, no numeric successor
ranking, no automatic enrolment, no automatic promotion or appointment, no employee-facing
succession, and no WS-15 Action Centre. **WS-11.1 remains deferred, and OD #14 and OD #15
are approved and assigned to WS-16, which has not started (corrected in §31.38).**

---

## 31. WS-15 — Cross-Module Visibility (Architecture Freeze)

**Status of the freeze.** This section is **purely additive**. The 31 Owner Decisions in §22 are untouched and none is reopened. WS-15 carries **no assigned Owner Decision** — its register row's decision column reads `—`. OD #14 (no giant generic workflow engine) and OD #17/#18 (audit categories, sensitive-read auditing) **constrain** it. WS-1 through WS-14 remain complete and are not reopened. Migration ledger remains **`0070`**.

### 31.1 The register entry this section implements

> `| WS-15 | Cross-Module Visibility | **P1/P2** | Employee 360 completion, HR Action Centre (org-wide), Manager Portal recruitment-participation source, Reporting execution consolidation | WS-6 | — |`

WS-15 is **four bundles**, not one. The workstream is named *Cross-Module Visibility*; the HR Action Centre is one member of it. This section freezes all four and preserves their distinct repository priorities.

### 31.2 Per-bundle priority classification

| Bundle | §17 capability row | Priority | Frozen in |
|---|---|---|---|
| HR Action Centre (org-wide) | `HR Action Centre — N` | **P1** | §31.4–31.26 — **IMPLEMENTED**, see `docs/ACTION_CENTRE.md` |
| Manager / Department Head completion (Recruitment participation source) | `Manager/Department Head — Y, partial` | **P2** | §31.28 — **IMPLEMENTED**, see `docs/ACTION_CENTRE.md` |
| Employee 360 / Global Search completion | `Global Search / Employee 360 — Partial` | **P2/P3** | §31.29 — **Employee 360 COMPLETE** (`docs/EMPLOYEE_360.md`); **Global Search: future approved safe navigation/discovery enhancement, NOT implemented** (§31.40) |
| Reporting execution consolidation | `Reporting/Analytics — Y, CSV gap` | **P3** | §31.30 — **IMPLEMENTED**, see `docs/REPORTING.md` |

The Reporting row's **P1 half — the CSV formula-injection fix — already shipped in WS-1** (`safeCsvCell`/`toCsv` in `lib/reporting.ts`, now the one shared primitive). What remains of that bundle is the P3 half.

**Only the HR Action Centre is P1.** The other three are genuine, registered WS-15 scope and are frozen here so implementation has an architecture to build against — but they are **deliberately later-priority**, and a Pass-2 report must not classify them as missing P1 work.

### 31.3 Repository reconciliation — what discovery actually found

Nine findings shaped this section. Each is a repository fact, not an assumption.

1. **The architecture WS-15 needs already ships, twice.** `lib/managerPortalPendingActions.ts` (Phase 3G, W110) is a live cross-module action queue over Leave, Performance and Learning. Its own header states the ruling verbatim: *"Read-only aggregation of current authoritative work; **no persistent task table**, no notifications engine, no mutation route… Every item is recomputed live on every call from each module's own existing service functions — **never a second 'task' concept.**"* `GET /dashboard/summary` (`routes/users.ts`) is the same federation shape for metrics. WS-15's Action Centre is the org-wide sibling of a pattern this platform has already shipped and tested.

2. **The "unavailable vs zero" convention is already established and is exactly the non-leaking signal WS-15 needs.** `managerPortalDashboard.ts` documents it: a tile is `null` when its module is disabled **or** when the caller lacks that module's permission — *"silently omitted, never a 403 for the whole dashboard"* — and a real number, including `0`, when the caller is authorized and the query genuinely found nothing. Because `null` is indistinguishable between *disabled* and *unauthorized*, it leaks nothing about what exists.

3. **Ten independent authority resolvers ship today**, each authoritative for its own module: `resolveAssetActorEmployeeId`, `resolveAttendanceActorEmployeeId`, `resolveLearningActorEmployeeId`, `resolvePerformanceActorEmployeeId`, `resolveRecruitmentActorEmployeeId`, `resolveManagerPortalActorEmployeeId`, `listDepartmentsHeadedByMembership`, `officeInventoryDelegations.resolveApprovalAuthority`, `recruitmentApprovalStages.resolveStageAuthority`, `onboarding/responsibility.resolveResponsibility`. **Three different resolver enumerations exist** (WS-9 Recruitment, WS-10 Onboarding's five-value `employee_self | reporting_manager | department_head | permission_holder | specific_membership`, WS-13 Requests). Unifying them is OD #14 / WS-16 work. WS-15 calls them; it does not merge them.

4. **`useIsHrCapable` is a role-name heuristic**, and its own file warns: *"Do NOT reach for this hook where the backend's own authority is actually permission-scoped."* It is navigation convenience only and can never be WS-15 authority (§25.2).

5. **Roughly half of all candidate sources carry no deadline at all.** Genuine authoritative dates exist on onboarding tasks (`dueAt`), document acknowledgements (`dueAt`), learning enrolments (`dueDate`), performance goals (`dueDate`), service requests (`targetDays`), succession plans (`reviewDueAt`), development actions (`targetDate`) and offers (`expiryDate`). Leave requests, data-change requests, grievance and disciplinary cases, clearance items and requisition approvals have **none**.

6. **No shared priority or severity model exists anywhere in the platform.** No candidate source pair uses a comparable scale.

7. **Two modules already carry a real assignment concept**: `service_requests.assignedMembershipId` and `grievance_cases.assignedMembershipId`. `clearance_items.responsibleMembershipId` and onboarding tasks' `responsibleMembershipId` are resolver-derived rather than free assignment. Every other candidate source uses purely dynamic authority.

8. **The Reporting registry is complete but its execution is not.** `report-definitions.ts` seeds **46** definitions (recorded as 47 at freeze time; corrected in Pass 3C — see §31.30), each already carrying a `requiredPermissionKey`; `lib/reporting.ts`'s `RUNNERS` map implements **3** (`headcount`, `workforce_status`, `audit_summary`). `runReport` throws `ReportNotFoundError` — a `404` — for the other **43**, which are reachable only through eight bespoke module reporting routes with divergent response shapes. The generic endpoint already permission-checks correctly before running.

9. **Employee 360 is thinner than §17's "Partial" suggests, and in two places it is stale.** `employee-detail.tsx` aggregates the core record, numbering, qualifications, certifications, documents, employment history, personnel file and custody, exit processes, performance reviews and an asset report. It shows the **legacy** free-text `employee_skills` and the **legacy** `employee_disciplinary_records`. It shows **nothing** of WS-11 employment terms, WS-12 disciplinary or grievance *cases*, WS-13 data-change or service requests, WS-14 skill records or gaps, Leave, Learning, Attendance or Onboarding. Separately, **no cross-module search exists**: `app-shell.tsx` carries an explicit comment declining to render a search box *"because there is no real cross-module search capability to back it."*

### 31.4 Runtime federation — the governing ruling

**WS-15 aggregates. It never owns.**

Every Action Centre request derives current work from the source modules at request time. There is:

- **no persistent authoritative task table**;
- **no materialized Action Centre projection** built merely for aggregation;
- **no second task concept**;
- **no cached authority**;
- **no reconciliation engine** for Action Centre state.

This is not a preference. A materialized projection would create precisely the second source of truth this platform has refused everywhere else, and would then need staleness detection, rebuild and reconciliation machinery to re-solve a problem federation does not have: **because every item is recomputed live, a changed membership, reporting manager, permission, delegation, stage, assignment or source status is reflected on the very next request, with nothing to invalidate.**

**Consequence for the ledger: the P1 Action Centre requires no schema and no migration `0071`.** See §31.31.

### 31.5 The source provider contract

Each participating module exposes a **provider** — a bounded adapter that translates its own authoritative current work into the normalized representation of §31.6. Providers follow the shape `managerPortalPendingActions.ts` already established: one small resolver function per source, composed by an aggregator.

Every provider independently enforces, in this order, before returning anything:

1. **organization / tenant scope**;
2. **module enablement**, where the module is optional;
3. **the source module's own permission**;
4. **the source module's own live authority resolver**;
5. **current source state** — only genuinely actionable items;
6. **safe summary mapping** per §31.14.

A provider that fails any of the first four returns **empty**, never an error and never a partial leak. This is the "unavailable vs zero" convention of §31.3(2) applied to rows rather than tiles.

**Providers are adapters, not a refactor.** No completed module is restructured to participate. A provider calls the module's *existing* service functions. Nothing in this section authorizes generalizing a module's workflow, authority resolution or delegation — that is OD #14/#15 and belongs to **WS-16** (§31.27.4).

### 31.6 The normalized action item

The frozen contract. **These fields and no others.**

| Field | Meaning | Rule |
|---|---|---|
| `sourceModule` | Which module owns this work | Fixed vocabulary, not free text |
| `sourceType` | The source's own resource kind | e.g. `leave_request`, `onboarding_task` |
| `sourceId` | The source record's own existing id | Never a WS-15-minted id |
| `actionKind` | What is being asked of the actor | e.g. `approve`, `complete`, `verify`, `review` |
| `title` | A safe, generic operational label | §31.14 governs. Never narrative |
| `employeeId` / `employeeFirstName` / `employeeLastName` | Subject reference | **Only where the actor may already see that employee through the source** |
| `status` | The source's own current status string | Passed through, never re-mapped into a WS-15 lifecycle |
| `createdAt` | The source record's own creation time | |
| `dueAt` | The source's own authoritative due date | **`null` where the source has none** (§31.16) |
| `overdue` | Derived from `dueAt` against now | **`null` where `dueAt` is `null`** |
| `deepLink` | Route into the owning module's own surface | |
| `inlineCommands` | Allow-listed command identifiers, if any | Empty for every deep-link-only item (§31.9) |

Explicitly **not** in the contract:

- **no arbitrary metadata blob** — the exact prohibition `managerPortalPendingActions.ts` already states;
- **no sensitive narrative** of any kind;
- **no universal workflow state** — WS-15 mints no lifecycle;
- **no universal priority or severity** (§31.17);
- **no assignee identity** beyond what §31.10's Assigned Work needs;
- **no source payload passthrough.**

The source module remains authoritative for real state. A row is a *pointer plus enough to triage*, never a copy.

### 31.7 Live source authority

WS-15 asks the owning module whether the actor **currently** has visibility and action authority. It never decides this itself, and never derives it from a displayed role name (§25.2).

The following remain entirely their modules' own and **must not be unified by WS-15**: Recruitment approval-stage resolvers; Onboarding responsibility resolvers; reporting-manager authority; Department Head authority; permission-holder authority; Office Inventory delegation; WS-13 approval authority; WS-14 assessor authority.

**A previously visible item confers no authority.** Because federation is live there is no cached assignment to go stale — but the rule is stated because it governs the inline-action path too: §31.8 requires the authority re-check at action time regardless.

`useIsHrCapable` may gate navigation. It may never gate data.

### 31.8 Inline actions — the frozen P1 allow-list

**Exactly four.** Nothing else is inline in P1.

| # | Inline action | Owning command | Source authority re-checked |
|---|---|---|---|
| 1 | Leave approve / reject | Leave's existing approval service | Department Head, or `leave_request.manage` org-wide |
| 2 | Learning enrolment approve / reject | Learning's existing enrolment approval service | Learning's manager-of-record snapshot + `learning.review.write` |
| 3 | Onboarding task completion | Onboarding's existing task completion service | `resolveResponsibility` / `isCurrentlyResponsible` |
| 4 | WS-14 skill verification decision | `capability.verify` / `capability.reject` | `skill_verification.decide`, plus WS-14's own self-verification refusal |

For every one of the four, WS-15:

- **invokes the owning module's existing service or command** — it never writes a source table directly;
- **re-checks live authority at action time**, not at render time;
- **preserves the source transaction** entirely;
- **preserves the source idempotency and state guard** (§31.23);
- **preserves the source audit** — the domain event stays the domain's;
- **preserves source notification behaviour**;
- **preserves source maker-checker** where the source has one.

**No approval logic is copied into WS-15.** If a Pass-2 repository reconciliation finds that one of these four lacks a safe authoritative source command to call, that action becomes deep-link-only and the finding is recorded — it is never re-implemented in WS-15.

### 31.9 Deep-link-only in P1

These remain deep-link-only. WS-15 may show an authorized safe summary; the owning module makes the decision.

Recruitment staged approval and complex workflow · Employee Relations grievance and disciplinary decisions · WS-13 data-change decisions · WS-13 service-request fulfilment · succession decisions, readiness and candidacy · Payroll actions · Employment Lifecycle actions · Assets and Office Inventory complex actions · Performance scoring and review decisions.

### 31.10 My Actions, Assigned Work, HR Oversight

Three concepts, frozen where the repository supports them.

**My Actions** — items the authenticated actor can *currently act upon* through source authority. The default surface.

**Assigned Work** — items **explicitly assigned** to the actor's membership, where the owning module genuinely has an assignment concept. Per §31.3(7) that is **WS-13 service requests** and **WS-12 grievance cases** only. **Assignment is not fabricated for modules that use dynamic authority** — a Leave approval is not "assigned" to anybody, and presenting it as such would invent a relationship the source does not hold.

**HR Oversight** — an organization-level operational visibility queue for authorized HR users.

> **HR Oversight creates no new read authority.** Every row and every count still requires the source module's own read and visibility permission, evaluated by the source provider exactly as in §31.5. A user who cannot see a grievance through Employee Relations sees **no grievance row**, **no grievance count**, and **nothing from which to infer that a hidden grievance exists**. The same holds for succession, Payroll, confidential documents, sensitive HR requests and every other protected module.

Oversight is a *filter over the same permission-filtered providers*, never a privileged second query path.

### 31.11 Organization Admin

Organization Admin receives **no additional cross-module authority** because WS-15 exists. Org Admin visibility is exactly the union of the source permissions that actor already holds.

WS-15 must not restore access deliberately withheld by **§28.17** (Employee Relations grievance keys) or **§30.17** (the three succession keys), or by any other sensitive-module freeze. Those withholdings were deliberate, and an aggregation surface is the most natural place for them to be quietly undone.

**There is no Action Centre backdoor.**

### 31.12 No Action Centre permission key

**WS-15 P1 mints no permission.** Not `action_centre.read`, not `action_centre.manage`, not any umbrella key.

The Action Centre is a composition and routing surface. Visibility derives entirely from participating source permissions and source authority. This follows the Manager Portal precedent exactly: it shipped with **zero new permissions**, resolving access from module enablement plus a live relationship.

Frontend navigation may determine whether a user has *any* eligible source capability in order to decide whether to show the entry. That is a presentation affordance and **is not authority to read source data**, and the two must never be conflated. If implementation later proves a navigation-only feature flag is genuinely required, it remains navigation-only.

**No broad umbrella permission may exist that can widen item visibility.**

### 31.13 ESS My Actions

An employee-facing **My Actions** surface is approved, with a narrowly frozen initial allow-list. Only these three, each confirmed to have an authoritative pending state in the repository:

1. **Onboarding tasks resolved to `employee_self`** — `onboarding_tasks.status = 'pending'` with the `employee_self` responsibility resolver, and a real `dueAt`.
2. **Document acknowledgements** — `document_acknowledgements.status = 'pending'` with a real `dueAt`. *Implementation note: both sources sit behind `requireModuleEnabled("onboarding")`, so an organization with Onboarding disabled correctly sees neither.*
3. **WS-13 service requests awaiting employee response** — `service_requests.status = 'awaiting_employee'`.

**Deliberately excluded**, and not to be added without extending this allow-list: own Leave history; Learning progress; performance history; skill claims merely awaiting HR; Payroll; grievances; succession; general notifications. None of these is work the employee is being asked to do, and treating "pending somewhere else" as "your action" would make the surface dishonest.

**The employee's identity is server-derived** from the employee link on every request (`resolveOwnEmployeeId`). No ESS request carries an employee identifier, and none is read if supplied.

### 31.14 Sensitive summary minimization

A generic Action Centre row carries **only the minimum operational information needed to identify and navigate the work**. This applies to every surface including HR Oversight.

Never in a row, under any permission: grievance details or narrative · disciplinary evidence · succession candidate identity, readiness or notes · Payroll amounts, salary, bank details, statutory identifiers or calculation detail · proposed National ID or passport values · confidential document content · sensitive HR request content.

The Manager Portal precedent is the standard: *"never a leave reason, never confidential Performance/Learning fields, no arbitrary metadata blob."*

Where a subject employee's name would itself be disclosure, the row carries the case reference and omits the name.

### 31.15 Sensitive-read auditing

Where WS-15 renders only a generic redacted row and deep-links, **the owning module's existing OD #18 sensitive-read audit remains authoritative**, and WS-15 records nothing. A redacted pointer is not a read of the sensitive record, and auditing it would inflate the trail with events that describe no disclosure — the "risk-based, not noisy" rule OD #18 states for itself and §28.12 repeats.

If any WS-15 surface is ever made to return sensitive detail directly, it reuses `lib/sensitiveRead.ts` rather than building a second mechanism. In P1 no such surface exists.

**No read is double-counted merely because a generic row was rendered.**

### 31.16 Due and overdue

A due date is used **only** where the source module holds a genuine authoritative date that semantically means due, expiry or review timing.

| Source | Authoritative date | Used as `dueAt` |
|---|---|---|
| Onboarding task | `dueAt` | ✅ |
| Document acknowledgement | `dueAt` | ✅ |
| Learning enrolment | `dueDate` | ✅ |
| WS-13 service request | `targetDays` from the request type | ✅ **derived per WS-13's own semantics only** (§29: a configured target with derived overdue state, never an escalation engine) |
| Succession plan review | `reviewDueAt` | ✅ |
| Development action | `targetDate` | ✅ |
| Offer version | `expiryDate` | ✅ |
| Leave request | — | ❌ `null` |
| Data-change request | — | ❌ `null` |
| Grievance / disciplinary case | — | ❌ `null` |
| Clearance item | — | ❌ `null` |
| Requisition approval | — | ❌ `null` |
| Skill verification | — | ❌ `null` |

**Deadlines are never manufactured.** Where no authoritative date exists, `dueAt` is `null` and `overdue` is `null` — not `false`, because "not overdue" and "no concept of overdue" are different statements and a UI must be able to tell them apart.

**SLA is never derived from age.** Only a source that owns an SLA contributes one.

**Employment Lifecycle effective dates are not task due dates.** A probation end date or contract expiry is a fact about employment, not a deadline for the actor looking at the row. Lifecycle participates read-only (§31.27) and contributes no `dueAt` in P1; relabelling those dates would misrepresent what the source means.

### 31.17 No universal priority model

**WS-15 creates no cross-module priority or severity scale.** The normalized contract of §31.6 has no priority field.

Source priority may be surfaced **only** where the source genuinely owns one and where surfacing it cannot imply comparability with another module's. No candidate source pair satisfies this today (§31.3(6)), so **P1 exposes no priority at all**.

**No employee-sensitive case is ranked algorithmically.** Ordering an inbox is not ranking people, and the distinction is load-bearing: a grievance is never sorted by inferred severity, and a succession candidate is never sorted at all (§30.12).

### 31.18 Sorting

Deterministic, four-tier, computed from authoritative dates only:

1. **genuinely overdue** — `dueAt` exists and is in the past — ascending by `dueAt` (most overdue first);
2. **due soon** — `dueAt` exists and is in the future — ascending by `dueAt`;
3. **undated** — `dueAt` is `null` — ascending by `createdAt` (oldest pending first);
4. **stable tie-break** within any tier: `createdAt` ascending, then `sourceModule`, then `sourceId`.

This deliberately **departs from Manager Portal's `createdAt DESC`**. That surface has no due dates to sort by, so newest-first was the only meaningful order available to it; the Action Centre does have them, and surfacing the newest item above a three-week-overdue one would be the wrong operational answer. The departure is recorded here rather than left as an inconsistency for a reader to discover.

**Undated work is never given fabricated urgency** — it sorts oldest-first within its own tier and never mixes into the overdue tier.

**No AI prioritization** (§31.26).

### 31.19 Filtering and counts

Frozen P1 filters, each backed by a field the normalized contract actually carries:

`sourceModule` · `actionKind` · `status` · scope (`my_actions` | `assigned` | `oversight`) · `dueState` (`overdue` | `due_soon` | `undated`) · `employeeId` **where the actor's visibility of that employee already permits it**.

**Counts are computed from the exact same permission-filtered providers as rows.** There is no separate counting query, and no organization-wide total is ever computed before permission filtering and then exposed.

**No confidential existence may leak through** badges, per-module counts, totals, or empty-versus-non-empty indicators. The mechanism is §31.3(2)'s already-shipped convention: a module the actor cannot see is **omitted**, indistinguishably from a module that is disabled — never rendered as a zero, because a zero asserts that the module exists and is empty.

### 31.20 Notifications remain separate

WS-6 notifications are a **delivery and reminder channel**. WS-15 is a **live operational work view**. The distinction is frozen:

- a notification **is not** the authoritative task, and **creates no** Action Centre state;
- an actionable source item **may exist with no notification**;
- an actionable source item **may have** a WS-6 notification pointing at it;
- **notification state is never duplicated as workflow state**, and workflow state is never inferred from notification state.

A notification deep link **re-checks source authority when opened**, and denies safely when the actor no longer holds it. §1613 records that WS-6 deliberately built no approval inbox precisely because the org-wide HR Action Centre belongs here; that boundary is preserved rather than blurred.

### 31.21 Completed history

The P1 queue is **active, currently actionable work**.

WS-15 builds **no second history store**. Completed business history remains in the source modules, which already hold it authoritatively and already audit it.

A bounded recent-completed view was considered and is **deferred**: no repository precedent exists for completed-work aggregation — `managerPortalPendingActions` returns pending items only — and every candidate provider would need a second, differently-shaped query with its own permission story. **Aggregating recent-completed is deferred rather than invented.** No persistence is created to retain Action Centre history under any circumstances.

### 31.22 Source failure and staleness

**The source of truth wins, always.**

| Situation | Frozen behaviour |
|---|---|
| Item completed elsewhere between render and action | The source's own state guard refuses; WS-15 surfaces the source's current truth and the row disappears on the next request |
| Source state changed | Same — the next request recomputes from source |
| Actor lost authority | The action-time re-check (§31.8) denies, even if the row was rendered a moment earlier |
| Source item cancelled | Provider no longer returns it |
| A provider fails | **Partial-source failure is represented, not hidden** — see below |
| Inline command fails | The source error is surfaced; **no automatic replay** |

**Stale actions are never executed. Authority is never cached. Unsafe business commands are never automatically replayed.**

**Provider failure is isolated, following the shipped `managerPortalDashboard` precedent**, which catches a source module's hard error and treats that tile as unavailable rather than letting it take down the whole response. WS-15 applies the same isolation to rows — but with one addition this section makes explicit, because the shipped precedent's `null` deliberately conflates *disabled*, *unauthorized* and *failed*:

> A provider that fails for an **operational** reason is reported to the user as **unavailable**, distinctly from a module that is absent because it is disabled or unauthorized. **A systemic error is never silently hidden in a way that leads a user to believe the queue is complete.** The user-visible signal names the affected source and says its work could not be loaded; it never says the source is empty.

This is the one place WS-15 adds a signal the shipped aggregators do not carry, and it is added deliberately: an inbox that quietly under-reports is worse than one that admits it is incomplete.

### 31.23 Idempotency

Every approved inline action preserves the owning module's state and idempotency rules. A repeated click, a double submit or a network retry must not approve twice, reject twice, complete an onboarding task twice, or verify a skill twice.

WS-15 adds no idempotency mechanism of its own — the source guards are the guards. Pass 2 tests each of the four inline actions for double execution explicitly (§31.35).

### 31.24 Tenant isolation

Federation is **organization-scoped at both the provider and the aggregator boundary**. Every provider receives the organization from `req.membership!.organizationId` and scopes its own query; the aggregator never trusts an organization identifier from a client.

A forged cross-tenant identifier fails safely on every path: rows, detail, deep-link identifiers, inline commands, counts, employee filters, oversight and ESS My Actions. Pass 2 proves each (§31.35).

### 31.25 Super Admin

Super Admin and the control plane receive **no routine tenant HR Action Centre**. There is no cross-tenant operational employee queue and no bypass. Tenant employee actions never appear in platform health views. WS-4's controlled break-glass support access remains the only authoritative path to tenant data, unchanged.

### 31.26 No AI

No AI prioritization and no AI decision-making in WS-15. No AI may approve or reject, infer grievance severity, rank employees, determine succession urgency, alter Payroll workflow, or invent priority. Any future assistive summarization requires its own Owner Decision.

### 31.27 Module participation — the frozen matrix

Classification per Decision 27. `IL` = approved inline action; `DL` = deep-link only.

| Module | Actionable state | Authority source | Safe summary | Due date | Mode | Confidentiality | Classification & reason |
|---|---|---|---|---|---|---|---|
| **Leave** | `pending`, `pending_hr` | Dept Head via `listDepartmentsHeadedByMembership`; org-wide via `leave_request.manage` | "Leave request" + employee | ✗ | **IL** | Low — reason never shown | **P1 provider, inline.** Highest-volume approval on the platform; already federated in Manager Portal, so the resolver exists and is proven |
| **Learning** | enrolment approval `pending` | manager-of-record snapshot + `learning.review.write` | Course title snapshot | ✅ `dueDate` | **IL** | Low | **P1 provider, inline.** Already federated in Manager Portal |
| **Onboarding** | task `pending` | `resolveResponsibility` (5-way) | Task label | ✅ `dueAt` | **IL** | Low | **P1 provider, inline.** Real due dates; task completion is a single low-context act |
| **WS-14 skills** | record `claimed`, `assessed` | live `reportingManagerId`; `skill_verification.decide` | Skill name + employee | ✗ | **IL** | Low | **P1 provider, inline** (Decision 23). Authority re-evaluated against WS-14's own rules at action time, including its self-verification refusal |
| **Performance** | review `manager_review` | reviewer-of-record snapshot + `performance.review.write` | "Performance Review — {cycle}" | goal `dueDate` | **DL** | Medium | **P1 provider, deep-link.** Already federated in Manager Portal; scoring and review decisions stay in Performance (Decision 7) |
| **Recruitment — requisition** | `pending_approval` | `resolveStageAuthority` | "Requisition approval" | ✗ | **DL** | Low | **P1 provider, deep-link.** Staged approval is exactly the complex workflow Decision 7 keeps in-module |
| **Recruitment — offer** | `pending_approval` | `resolveStageAuthority` | "Offer approval" | ✅ `expiryDate` | **DL** | Medium — no particulars in the row | **P1 provider, deep-link** |
| **WS-13 data change** | `pending`, `returned`, `stale` | WS-13 stage resolver + maker-checker | Field label only, **never the proposed value** | ✗ | **DL** | High — OD #23 masking | **P1 provider, deep-link** (Decision 22). Maker-checker, stale detection and application stay entirely WS-13's |
| **WS-13 service request** | `submitted`, `acknowledged`, `in_progress` | `assignedMembershipId` + service-request keys | Request type + subject line | ✅ from `targetDays` | **DL** | Medium | **P1 provider, deep-link.** Also the sole non-grievance source of **Assigned Work** (§31.10) |
| **WS-12 clearance** | item `pending` | `responsibleDepartmentId` / `responsibleMembershipId` | Item label + employee | ✗ | **DL** | Low — operational, not confidential | **P1 provider, deep-link.** §28 already treats clearance as operational rather than confidential-evidence work |
| **WS-12 grievance** | `submitted`, `acknowledged`, `under_review` | `assignedMembershipId` + grievance keys **withheld from `org_admin` (§28.17)** | **Case reference only** — no narrative, no evidence, no subject name | ✗ | **DL** | **Highest** | **P1 provider, minimal summary + deep-link** (Decision 19). Also contributes **Assigned Work** |
| **WS-12 disciplinary** | case `open` | disciplinary keys + confidentiality tier | Case reference only | ✗ | **DL** | **Highest** | **P1 provider, minimal summary + deep-link** |
| **WS-14 succession** | plan review due | `succession.manage` / `succession.confidential.read`, **withheld from `org_admin` (§30.17)** | **"Succession plan review due" — names no position, no candidate, no readiness** | ✅ `reviewDueAt` | **DL** | **Highest** | **P1 provider, generic label + deep-link** (Decision 20). No inline succession decision, no readiness change, no nomination or removal in WS-15 |
| **Employment Lifecycle** | probation / contract expiry approaching | HR lifecycle permissions | Generic lifecycle label | ✗ — see §31.16 | **DL** | Medium | **P1 provider, read-only awareness.** Contributes no `dueAt`: effective dates are employment facts, not actor deadlines |
| **Payroll** | run `draft`, `calculated` | Payroll keys | — | ✗ | — | **Highest** | **DEFERRED from P1** (Decision 21). The only actionable state is a run-level administrative step with no employee subject, no due date and no safe generic row that adds anything over Payroll's own gated pages. Forcing it into a people-work queue would gain nothing and put the platform's most sensitive module one rendering mistake from disclosure. Revisit only if a genuinely safe actionable state emerges |
| **Assets** | incident `open` | asset keys | — | ✗ | — | Low | **EXCLUDED from P1.** Operational asset administration, not HR work. Assets already has its own workspace and its own dashboard tile |
| **Office Inventory** | request `pending` | `officeInventoryDelegations.resolveApprovalAuthority` | — | ✗ | — | Low | **EXCLUDED from P1.** Operational, and its effective-dated delegation authority is precisely what **WS-16 / OD #15** exists to generalize. Pulling it in would risk generalizing OD #15 by accident — the thing Decision 4 forbids |
| **Attendance** | — | — | — | — | — | — | **EXCLUDED.** No approval or task concept; adjustments are already a module surface, and Manager Portal correctly classifies Attendance as awareness rather than an action queue |

**Not every module appears, and that is the design.** A module earns a place by having genuinely actionable, safely summarizable, authority-resolvable work — not by existing.

### 31.28 Manager / Department Head completion — **P2**

The existing `managerPortalPendingActions.ts` is **authoritative precedent and is not discarded, replaced or rebuilt**. There is no second manager authority system.

**The exact registered gap**, from discovery: Manager Portal sources Leave, Performance and Learning. A manager's **Recruitment participation** is absent — specifically:

- **interview panel membership** → `interview_panel_members.interviewerMembershipId`, with `resolveInterviewVisibilityContext({ membershipId })` already shipped as the authority resolver;
- **an outstanding own scorecard** → `interview_scorecards` where `submittedAt is null`, with `resolveScorecardVisibilityContext({ membershipId })` already shipped, `saveOwnInterviewScorecard` as the own-write command and `scorecard.submit` as the permission;
- **hiring-manager standing** → `job_requisitions.hiringManagerEmployeeId`.

**Frozen architecture:** one bounded **Recruitment participation provider** in the shape of the three existing resolvers, returning outstanding own-scorecard work and panel participation. It reuses the shipped visibility contexts and adds no new manager authority concept.

**Classified P2.** It is not required for P1 Action Centre closure. Because the provider shape is identical to §31.5's, it is naturally delivered by the same provider work if — and only if — Pass 2 finds it to be a small shared implementation; otherwise it ships separately and P1 closes without it.

### 31.29 Employee 360 completion — **P2/P3**

Frozen **separately from the Action Centre**. This is a cross-module employee **visibility and read** concern, not an action workflow, and conflating the two is how a read surface acquires write authority by accident.

**Discovery (§31.3(9)) is the specification.** `employee-detail.tsx` already aggregates the core record, numbering, qualifications, certifications, documents, employment history, personnel file and custody, exit processes, performance reviews and an asset report. Two of its sections show **superseded models** — the legacy free-text `employee_skills` and the legacy `employee_disciplinary_records` — while their WS-12 and WS-14 successors are absent, so the page is not merely incomplete but in two places out of date. Absent entirely: WS-11 employment terms, WS-12 cases, WS-13 requests, WS-14 skill records and gaps, Leave, Learning, Attendance, Onboarding.

**Frozen architecture:**

- **Bounded, module-aware sections** — one read provider per module, each enforcing its own permission and confidentiality, exactly as §31.5 requires of action providers.
- **No giant employee DTO.** There is no single endpoint returning everything about a person. A section the caller may not read is **omitted**, per §31.3(2)'s convention — never returned empty, never returned redacted-but-present.
- **Confidential sections obey their own freezes**: grievance content per §28, succession per §30.17 (an employee's standing in a succession plan **never** appears on their 360 view), Payroll per its own keys, OD #23 masking throughout.
- **Legacy-versus-successor display is a Pass-2 reconciliation item**, not silently resolved here: showing both, replacing one, or labelling the legacy section is a presentation decision that must be made against the code at the time. It must not become a data migration (§31.37).
- **Global Search is P3 and is not required by Employee 360.** `app-shell.tsx`'s existing comment — declining to render a search control because nothing backs it — remains correct until a real capability exists. **No cross-module sensitive full-text search** is authorized (§31.37). **Resolved in §31.40**: Global Search is approved as a future *safe navigation and discovery* capability, still **not implemented**, and this prohibition is preserved rather than relaxed.

**Classified P2/P3. Not required for P1 Action Centre closure.**

### 31.30 Reporting execution consolidation — **P3**

**Repository fact, recorded:** **46** report definitions are seeded — the Pass-1 figure of 47 was a miscount, corrected during Pass 3C against `report-definitions.ts` and confirmed by the seeder's own output ("Seeded 46 report registry entries"); the file has been unchanged since `f8fa5b8`, so nothing moved. Each already carries a `requiredPermissionKey`; only **3** generic runners existed (`headcount`, `workforce_status`, `audit_summary`); the remaining **43** returned `404` from the generic endpoint and were reachable only through eight bespoke module reporting routes. The generic endpoint already permission-checks against the definition's own key before running, and `safeCsvCell`/`toCsv` are already the one shared export primitive.

This is a **valid WS-15 consolidation target** — the registry, the permission check and the export primitive are all in place, and only execution is missing.

**Frozen architecture for eventual consolidation:**

- each report **remains permission-scoped and source-owned** — the runner delegates to the owning module's existing reporting service rather than re-querying;
- **no single giant report query** and no shared reporting schema;
- the `{columns, rows}` shape and `toCsv` stay the uniform serialization, with no per-report special-casing;
- module reporting routes are **not removed**; consolidation adds a generic execution path beside them.

**Classified P3.** The 43 missing runners were **not an Action Centre defect** and were not reported as one; reporting consolidation was explicitly not implemented as part of P1. **IMPLEMENTED in WS-15 Pass 3C** — all 43 now execute generically by delegating to their owning module's existing reporting service, with a completeness guard preventing future drift. See `docs/REPORTING.md`.

### 31.31 No migration

**The P1 runtime-federated Action Centre requires no persistence table and no migration `0071`.** Ledger remains `0070`.

No migration is created because WS-15 exists. If the Employee 360 or Reporting bundles later genuinely require additive schema, that must be justified by **that bundle's own** requirements at its own priority — never by Action Centre aggregation, which by construction stores nothing.

### 31.32 Audit

WS-15 duplicates no domain audit. The owning module remains authoritative for every business decision, and an inline action produces the source's own audit event exactly as if it had been taken in the source module.

WS-15 adds only navigation context where it is genuinely its own: an inline action attempt that WS-15's own authority re-check denies is worth recording, because it happened at this surface and nowhere else. Routine queue rendering is **not** audited — that is the "do not flood the audit table" rule already stated for scheduled jobs in `auditCategories.ts`, and an inbox render is the highest-frequency read on the platform.

No new audit category is introduced; any WS-15 event type is categorized through the existing prefix map.

### 31.33 Proposed API surface — P1

Bounded and explicit. **No arbitrary module mutation command is exposed, and every inline action maps to one known source command.**

| Endpoint | Purpose |
|---|---|
| `GET /organizations/{id}/action-centre` | The federated queue. Query: `scope` (`my_actions` \| `assigned` \| `oversight`), `sourceModule`, `actionKind`, `status`, `dueState`, `employeeId` |
| `GET /organizations/{id}/action-centre/counts` | Permission-filtered counts, computed from the same providers as rows |
| `GET /organizations/{id}/my-action-centre` | ESS My Actions — the §31.13 allow-list, subject server-derived |
| `POST /organizations/{id}/action-centre/actions/{command}` | Invoke one allow-listed inline command against `{sourceModule, sourceId}`; the command identifier is validated against the frozen §31.8 list before anything else |

There is deliberately **no** `GET .../action-centre/{id}` detail endpoint in P1: a row's detail is the owning module's own surface, reached by `deepLink`. Adding one would be the first step toward WS-15 returning sensitive detail, and §31.15 exists precisely to keep that from happening quietly.

The inline-command endpoint takes a **command identifier from a closed vocabulary**, never a module, table or method name from the client.

### 31.34 Frontend acceptance table

**These are user actions that must be performable in the application.** Stated as a table for the same reason §29.17 and §30.26 were: so no Pass-2 report can later describe a required write as "API-only".

> **Read-only surfaces do not satisfy an inline write action frozen by this section.** Rows 7–10 each require a working control in the UI, not merely an endpoint.

| # | Actor | Surface | Source / provider | Required read capability | Required write action | Inline / deep-link | Source authority |
|---|---|---|---|---|---|---|---|
| 1 | HR user | Action Centre → **My Actions** | All P1 providers | Federated queue, permission-filtered per source | — | — | Each source's own permission + resolver |
| 2 | Manager | Action Centre → **My Actions** | Leave, Performance, Learning, Onboarding, WS-14 skills | Same queue, scoped to what the manager may act on | — | — | Dept Head; reviewer/manager-of-record snapshots; live `reportingManagerId` |
| 3 | HR / manager | **Assigned Work** | WS-13 service requests, WS-12 grievances | Items explicitly assigned to the caller's membership | — | — | `assignedMembershipId` + source read key |
| 4 | Authorized HR | **HR Oversight** | All P1 providers | Organization-level queue, **still source-permission-filtered per row** | — | — | Source permissions only; **no new authority** |
| 5 | Any actor | **Module filter** | Aggregator | Filter by `sourceModule`, `actionKind`, `status`, `dueState`, `employeeId` | — | — | Filters apply after permission filtering |
| 6 | Any actor | **Counts / badges** | Aggregator | Permission-filtered counts | — | — | A module the actor cannot see is **omitted**, never zero |
| 7 | Leave approver | Action Centre row | Leave | Row: "Leave request" + employee | **Approve / reject inline** | **Inline** | Dept Head, or `leave_request.manage`; re-checked at action time |
| 8 | Learning approver | Action Centre row | Learning | Row: course title | **Approve / reject inline** | **Inline** | Manager-of-record snapshot + `learning.review.write` |
| 9 | Task owner | Action Centre row | Onboarding | Row: task label + `dueAt` | **Complete task inline** | **Inline** | `resolveResponsibility` / `isCurrentlyResponsible` |
| 10 | Verifier | Action Centre row | WS-14 skills | Row: skill + employee | **Verification decision inline** | **Inline** | `skill_verification.decide` + WS-14 self-verification refusal |
| 11 | Authorized actor | Action Centre row | Recruitment, WS-13, WS-12, Performance, Lifecycle, succession | Safe summary only | Decision taken in the owning module | **Deep link** | Source module gates the destination |
| 12 | Actor without the key | Action Centre | Grievance / succession providers | **Nothing** — no row, no count, no indicator | — | — | §28.17 / §30.17 withholding preserved |
| 13 | Employee | **ESS My Actions** | Onboarding `employee_self` tasks, document acknowledgements, `awaiting_employee` service requests | Own actionable work only | Complete / acknowledge / respond via the owning surface | Inline for task completion and acknowledgement; deep link for the service request | Employee link, server-derived; **no employee identifier is sent** |
| 14 | Any actor | **Source failure notice** | Aggregator | A named, user-visible "this source could not be loaded" state | — | — | Distinct from *disabled* and from *empty* (§31.22) |

### 31.35 Pass-2 test acceptance matrix

Every row is an invariant this section freezes, and each must be proved rather than asserted. A live database suite is planned (`WS15_LIVE_DATABASE_URL`, `resolveLiveDatabaseUrl` + `describeLive`, `liveDbGuard` refusing a non-local host) because tenant isolation and permission filtering are database behaviour. **A skipped live suite is not acceptance.**

**Authority and visibility**
1. An item is visible only to an actor the source module says is *currently* authorized.
2. Removing the source permission removes the row on the next request — no cached authority.
3. Changing an employee's `reportingManagerId` removes the former manager's WS-14 skill-assessment authority immediately.
4. Ending a Department Head appointment removes the Leave rows immediately.
5. A member of another organization sees none of it.

**Tenant isolation** — rows, deep-link identifiers, inline commands, counts, employee filters, oversight and ESS My Actions each reject a forged cross-tenant identifier.

**Confidentiality**
6. An actor without the grievance key sees no grievance row **and no grievance count**, and cannot distinguish that from the module being disabled.
7. The same for succession, with `succession.confidential.read` withheld.
8. `org_admin` — which by §28.17 and §30.17 holds neither — sees neither through aggregation. **This is the Action Centre backdoor test.**
9. No row contains grievance narrative, disciplinary evidence, succession candidate identity or readiness, Payroll amounts or bank details, or a proposed National ID / passport value.
10. Rendering a redacted row records **no** sensitive-read audit event.

**Inline actions**
11. Each of the four invokes the owning module's service — proved by the source's own audit event and state transition, not by WS-15's response.
12. Each re-checks authority at action time and denies when it has been lost since render.
13. **Maker-checker survives**: a WS-13 requester cannot approve their own request through any WS-15 path, and no WS-15 endpoint constitutes a bypass.
14. **Idempotency**: a repeated inline command does not approve twice, reject twice, complete an onboarding task twice, or verify a skill twice.
15. An action on an item completed elsewhere fails against the source's state guard and is not replayed.
16. No WS-15 path can mutate Payroll, Employee Relations or succession outside the source's own rules.

**Behaviour**
17. A completed source item disappears from the queue on the next request.
18. `dueAt` and `overdue` are `null` for every source with no authoritative date — never `false`, never fabricated.
19. Sorting is the four tiers of §31.18 and is deterministic across repeated calls.
20. A failing provider yields a named unavailable state, distinct from empty, and does not fail the whole response.
21. Deep links enforce the source's permission at the destination.
22. ESS My Actions returns only the three allow-listed sources and derives the employee server-side; a supplied employee identifier is never read.

Frontend tests cover every row of §31.34, including the four inline write paths and the unauthorized case, following the WS-13 and WS-14 precedent that a read-only surface does not satisfy a frozen write action.

### 31.36 Protected capabilities — do not rebuild

`managerPortalPendingActions.ts` and `managerPortalDashboard.ts` and their resolvers · every module's own authority resolver (§31.3(3)) · WS-9 Recruitment approval stages · WS-10 onboarding responsibility resolution · WS-12 Employee Relations confidentiality and its `assignedMembershipId` · WS-13's request architecture, maker-checker, stale detection and fulfilment · WS-14 capability, verification and succession confidentiality · WS-6 scheduler and notifications · WS-3 audit, OD #17 categories, OD #18 sensitive reads, OD #23 masking · WS-4 break-glass · Office Inventory delegation · the report registry, its `requiredPermissionKey` and `safeCsvCell`/`toCsv`. **WS-15 composes these. It replaces none of them.**

### 31.37 Deferred and out of P1 scope

Generic BPM or workflow engine · universal approval table · universal task table · generic process designer · arbitrary workflow transitions · **OD #14 authority-resolver generalization and OD #15 delegation generalization — both belong to WS-16** (§31.27.4) · a materialized Action Centre projection · an Action Centre history store · recent-completed aggregation (§31.21) · cross-module sensitive full-text search · Global Search (P3) · arbitrary or cross-module export — **not authorized in P1**, being the highest-confidentiality-risk feature available here and trivially the route by which redaction is undone · AI prioritization, approval, severity inference, employee ranking or succession urgency · Payroll Action Centre participation (§31.27) · Assets and Office Inventory participation · Attendance participation · WS-11.1 · WS-12's future-separation-basis dependency · legacy `employee_skills` consolidation — **and note that §31.29's legacy-versus-successor display question is a presentation reconciliation and must not become a data migration** · production deployment · WWM configuration.

### 31.38 Owner Decision register corrections

Repository discovery is authoritative on two points.

**1. OD #14 and OD #15 are assigned to WS-16.** The §20 workstream register has read `| WS-16 | Workflow/Delegation Primitive Generalization | **P2** | … | WS-3 (light) | OD #14, #15 |` since the original freeze, and §22 rows 14 and 15 both carry **APPROVED, P2**. The statement *"OD #14 and OD #15 remain approved and unassigned"*, carried forward through §28.29, §29 and §30.29–30.30, is **inaccurate in one word**: they are approved and **assigned to WS-16**, which has **not started**. Those references are corrected to say so.

**The substantive frozen text of Owner Decisions #14 and #15 is untouched, and neither is reopened, amended or superseded.** Only inaccurate status wording is corrected.

**2. WS-15 claims neither.** WS-15's register row assigns no Owner Decision. WS-15 may call existing module-specific resolvers; it must not generalize authority resolution or delegation. **WS-16 remains the owner of that work.**

### 31.39 Open items conditional at implementation time

None blocking. Decisions 1 through 33 are resolved above. The following are conditional **by design** and are to be decided **from repository evidence during implementation**, each recorded with its reason — following the §28.27 / §29.26 / §30.27 convention:

1. Whether the four §31.8 inline actions each genuinely expose a safe authoritative source command to call (§31.8) — if one does not, it becomes deep-link-only and the finding is recorded. It is **never** re-implemented inside WS-15.
2. Whether the §31.28 Recruitment participation provider is small enough to be naturally delivered by the same P1 provider work, or ships separately at its own P2 priority (§31.28) — decide from the implemented provider shape, and prefer shipping P1 without it over widening P1.
3. Whether HR Oversight needs its own endpoint or is a `scope` parameter on the one queue endpoint (§31.33) — prefer the parameter, so oversight cannot acquire a separate query path that drifts from the permission-filtered one.
4. How §31.29's legacy-versus-successor Employee 360 sections are presented — show both, replace, or label — decided against the code at the time, and **never** by migrating or deleting legacy data.
5. Whether the §31.22 provider-failure signal is per-source or aggregate in the response DTO — decide from what the frontend genuinely needs to render row 14 of §31.34 honestly, preferring the smallest signal that can name the affected source.

### 31.40 Global Search — Owner Decision, and WS-15 formal closure

Recorded 2026-08-31, after WS-15's four implementation bundles landed. This
subsection resolves the one remaining ambiguity in §31.29 and formally closes
the workstream. It is **documentation only**: no code, schema, permission or
migration accompanied it, and the ledger remains `0070`.

#### 31.40.1 The decision

**Global Search is APPROVED as a future SAFE NAVIGATION AND DISCOVERY
capability. It is NOT authorized as unrestricted cross-module full-text search,
and it is NOT implemented.**

Its purpose is to help an already-authorized user *locate a permitted entity and
navigate to the module that owns it*. It is a way of getting somewhere, not a
way of seeing something new.

Every future implementation must preserve, without exception:

- tenant isolation;
- source module permissions;
- source confidentiality;
- module enablement;
- result-level visibility rules;
- sensitive-data minimization.

> **A result must never become visible merely because the search layer indexed
> it.** Indexing is not authorization, and the search layer holds no authority
> of its own.

#### 31.40.2 Safe sources — a catalogue to be frozen, not a licence

A future implementation may draw on bounded, explicitly approved entity types of
this shape: employee directory identity, employee number, employee name,
department, branch, position, other non-confidential organization directory
entities, and explicitly approved safe business identifiers.

**This list is not implementation scope.** Each source must independently
authorize the actor, and a future pass must freeze its exact source catalogue
before writing anything — the same discipline §31.5 applied to action providers
and §31.29 to Employee 360 sections.

#### 31.40.3 What Global Search must never search

Unrestricted full-text search is prohibited over: grievance narratives ·
disciplinary evidence · confidential Employee Relations notes · succession
candidate information, readiness or notes · Payroll compensation · bank details ·
statutory identifiers · protected WS-13 values · National ID and passport
values · confidential document body text · private Performance comments ·
restricted interview notes · any other sensitive or confidential free text.

> **Do not index hidden content and attempt to hide it later.** Unauthorized
> content must never enter the searchable result universe in the first place.
> Filtering after indexing is the pattern that leaks, because every downstream
> surface — ranking, faceting, highlighting — then works from data the actor was
> never entitled to.

This preserves §31.29's and §31.37's existing prohibition rather than relaxing
it. The decision above **narrows** what may eventually be built; it does not
widen it.

#### 31.40.4 No confidential existence leak

Search must not reveal that a hidden source record exists. That includes leaks
through result counts, autocomplete, snippets, facets, suggestions, "no access"
rows, highlighted terms, ranking and typeahead.

**If the actor lacks source visibility, the result does not exist from the
search layer's perspective.** This is the same rule the Action Centre applies to
omitted sources (§31.19) and Employee 360 applies to omitted sections
(§31.29) — a zero, a placeholder or a redacted row is itself a disclosure.

#### 31.40.5 Search is navigation, never authority

A search result confers nothing. Opening one must re-check authentication,
tenant, module permission, current source authority, and source existence and
state — exactly as §31.7 requires of an Action Centre row and §31.20 of a
notification deep link. **A stale search result cannot grant access.**

#### 31.40.6 No AI search authority

AI must not decide whether confidential results are visible, and must not bypass
source permissions. **Semantic or vector search over sensitive tenant HR content
is not authorized by this decision.** Any future AI-assisted search requires its
own explicit governance review, consistent with §31.26 and OD #24–#26.

#### 31.40.7 Why this closes WS-15

WS-15's register row bundles four items. All four that were concretely specified
are implemented and verified:

| WS-15 bundle | Final status |
|---|---|
| HR Action Centre (P1) | **COMPLETE** — §31.4–31.27, `docs/ACTION_CENTRE.md` |
| Manager / Department Head Recruitment participation (P2) | **COMPLETE** — §31.28 |
| Employee 360 (P2/P3) | **COMPLETE** — §31.29, `docs/EMPLOYEE_360.md` |
| Reporting execution consolidation (P3) | **COMPLETE** — §31.30, `docs/REPORTING.md` |
| Global Search | **FUTURE APPROVED SAFE NAVIGATION / DISCOVERY ENHANCEMENT — NOT IMPLEMENTED** |
| **Overall WS-15** | **COMPLETE** |

Global Search is no longer a closure blocker, for a reason that is about
definition rather than effort: §31 already prohibited unsafe cross-module
full-text search, so the register's "Global Search" was never a specified
deliverable awaiting code — it was a capability still needing its own boundary.
That boundary is now drawn, above, and what remains is a separately schedulable
enhancement rather than unfinished WS-15 implementation.

> **WS-15 completion does not mean Global Search has shipped.** Nothing was
> built for it in any WS-15 pass. `app-shell.tsx` still declines to render a
> search control, and that remains correct.

#### 31.40.8 Two corrections carried forward

Both were found by verification rather than review, and are recorded here so
neither is quietly lost.

**The Reporting figures.** §31.30 and §31.3(8) originally recorded *47
definitions, 44 missing*. The verified figures are **46 definitions, 3
pre-consolidation runners, 43 missing at the start of Pass 3C, 46 generic
runners after it, and zero seeded definitions falling through to 404** —
confirmed against `report-definitions.ts` and by the seeder's own output. The
file was unchanged since `f8fa5b8`, so nothing moved; the Pass-1 number was a
miscount. **The incorrect 47/44 figures must not be restored.**

**The WS-6 concurrent-suite constraint.** `documentExpiryReminderSample.test.ts`
fails only when the whole backend suite runs concurrently against a single
database, with the assertion `expected 91 to be 92` — it claimed another
suite's job. That is the platform-wide, deliberately unscoped `claimDueJobs`
behaving as designed, and the file's own header instructs that it be run alone.
It is a **documented suite-isolation constraint of an unsupported test execution
topology**, not a WS-15 regression and not nondeterminism. Production behaviour
must not be changed to accommodate that topology.

#### 31.40.9 What this closure does not touch

**WS-16 continues to own OD #14 and OD #15.** No workflow generalization,
delegation generalization or authority-primitive extraction is authorized or
implied by this WS-15 closure. (WS-16's own Pass 1 subsequently froze that
architecture in **§32**, on the same date; its implementation has not started.) WS-11.1 remains deferred, WS-12's
future-separation-basis dependency remains unresolved, and the legacy
`employee_skills` consolidation remains a separate Owner Decision. None is
absorbed into this closure.

---

## 32. WS-16 — Workflow / Delegation Primitive Generalization (Architecture Freeze)

**Status of the freeze.** This section is **purely additive**. The 31 Owner
Decisions in §22 are untouched and none is reopened. WS-16 carries **two**
assigned Owner Decisions — **OD #14 (Shared Approval Primitive)** and **OD #15
(Delegation)** — whose approved text is implemented, never amended, by what
follows. WS-1 through WS-15 remain complete and are not reopened. Migration
ledger remains **`0070`**; this section is documentation only.

Recorded 2026-08-31, after a read-only Pass 1 discovery against
`7662a680755effabbba2472ec22d7b37d708afc0` and five binding Owner Decisions
resolving the forks that discovery surfaced.

### 32.1 What OD #14 and OD #15 actually authorize

Quoted from §11 and §22, unchanged:

> **OD #14 — Shared Approval Primitive — APPROVED.** Use the restrained
> architecture: shared authority-resolution/delegation primitives *where
> justified*. Do **not** replace working domain workflows (Leave's two-stage,
> Payroll's maker-checker, Recruitment's requisition/offer approvals) with one
> giant generic workflow engine. … extract only the authority-resolution/
> delegation half, leave each module's own approval state machine bespoke.

> **OD #15 — Delegation — APPROVED.** Generalize the proven delegation concept
> (currently Office Inventory-only: effective-dated, revocable, DB-enforced
> single-open-delegation, live-revalidated) beyond Office Inventory *where
> appropriate*. Sequence with OD #14. Authority must remain effective-dated,
> scoped, revocable, and auditable.

The load-bearing words are *where justified* and *where appropriate*. §32.2
records what the repository proved is justified; §32.4 records the five Owner
Decisions that bounded the rest.

### 32.2 The discovery finding that reframed the workstream

**OD #14's authority-resolution extraction is already largely done — organically,
and better than a retrofit would have managed.** This was established by direct
inspection rather than by reading prior documents, and it *narrows* WS-16 rather
than expanding it.

| Authority mechanism | Reality at `7662a68` | Genuine duplication? |
|---|---|---|
| "Which employee is me" — 6 × `resolve*ActorEmployeeId` (asset, attendance, learning, performance, recruitment, managerPortal) | Every one is a **one-line delegation** to `resolveOwnEmployeeId` in `lib/leaveRequests.ts` | **No — naming only** |
| Org-wide permission — 5 × `hasOrgWide*Access(membershipId, key)` | Every one is a **one-line delegation** to `hasPermission` | **No — naming only** |
| Own-record — 5 × `isOwn*Record` | Identical pure comparison, no I/O | **No — naming only** |
| Department head | **One shared module**, `lib/departmentHeads.ts`, four *purposeful* variants, consumed by nine modules | **No** |
| Live direct reports | **Seven independent query sites** (§32.9) | **YES — the only one** |
| Approval-stage authority | Two implementations (WS-9, WS-13) sharing a three-value vocabulary across **two separate enums**, with materially different semantics (§32.14) | **Vocabulary only** |
| Task responsibility | One implementation (WS-10), five values, *forward* resolver | Different question entirely |
| Delegation | One implementation (Office Inventory) | Sole implementation — the OD #15 prototype |

This refines §31.3(3)'s "ten independent authority resolvers". That count was
accurate as a count of *named functions*; sixteen of those names resolve to
three shared primitives. **The correct figure for genuine, unshared duplication
is one mechanism, not ten.**

The four `departmentHeads.ts` variants are not duplication and must not be
collapsed: `getCurrentDepartmentHead` (live), `resolveDepartmentHeadAsOf`
(point-in-time, for historical evidence), `listDepartmentsHeadedByMembership`
(inverse, live) and `resolveDepartmentHeadIdentity` (display identity). Only
`officeInventoryReporting.ts` touches `department_heads` directly, and that is a
reporting aggregate — "departments blocked by a vacant head" — not an authority
decision.

### 32.3 Live authority versus snapshot authority

This distinction is load-bearing and already documented in shipped code. WS-16
must preserve it exactly.

| Authority | Kind | Source |
|---|---|---|
| Manager Portal team roster, Assets team custody, Attendance/Leave/dashboard scopes | **LIVE** | `employees.reportingManagerId`, re-queried every call |
| Department headship | **LIVE** (or explicitly as-of) | `department_heads` where `valid_to is null` |
| Learning enrolment manager | **SNAPSHOT** | `learning_enrollments.managerEmployeeIdSnapshot` |
| Performance reviewer | **SNAPSHOT** | `performance_reviews.reviewerEmployeeId` |

`managerPortalAuthorization.ts` already carries the warning verbatim: its live
helper *"must never be substituted for Performance's/Learning's own snapshot/
workflow authority helpers … this helper is for genuinely live
reportingManagerId semantics only."*

**Frozen prohibition.** WS-16 must not replace
`learning_enrollments.managerEmployeeIdSnapshot` or
`performance_reviews.reviewerEmployeeId` with live reporting-manager
resolution, directly or transitively. A snapshot exists so that a review or an
enrolment stays attributable to the manager who actually owned it; converting it
to live would silently rewrite history. This is a Pass-2 regression requirement
(§32.23, invariants 22–23), not merely a coding instruction.

### 32.4 The five binding Owner Decisions

Resolved by the Owner on 2026-08-31 after Pass 1 discovery reported them.

| # | Fork | Decision | Consequence |
|---|---|---|---|
| Q1 | How far "where justified" / "where appropriate" reaches | **A — MINIMAL** | Smallest justified shared delegation primitive; consolidate only proven-equivalent live direct-report resolution; preserve module-owned workflows and authority semantics |
| Q2 | Does the shared primitive replace Office Inventory's table? | **A — NEW TABLE FOR NEW CONSUMERS; OFFICE INVENTORY UNTOUCHED** | No migration of its rows, no replacement of its table, no rewrite of its concurrency-tested resolver, **no dual-write** |
| Q3 | May an administrator delegate on behalf of an authority holder? | **A — AUTHORITY HOLDER ONLY** | No Org Admin, HR, Super Admin or workflow-administrator delegation on another person's behalf |
| Q4 | Are the seven direct-report implementations consolidated? | **B — ONLY PROVEN SEMANTICALLY IDENTICAL** | Per-site classification required, recorded in §32.9 |
| Q5 | Which authority types become delegatable? | **A — `department_head` ONLY** | Reporting-manager, permission-holder, specific-membership, stage, reviewer, interview panel, HR-permission, Payroll maker-checker, Recruitment approval and Onboarding `employee_self` authority are **not** delegatable |

**Explicitly excluded from WS-16 by Q1.** Converging the WS-9 and WS-13 stage
resolvers; a generic workflow engine; centralizing module approval state
machines; replacing Onboarding responsibility semantics; replacing Performance
or Learning snapshot authority; and generalizing any resolver merely because its
name resembles another's.

### 32.5 What the Office Inventory prototype already proves

Nine questions about delegation are answered by shipped, concurrency-tested
evidence rather than by decision. Each is carried forward.

1. **No chaining is structurally possible.** `createDelegation` throws
   `NotCurrentDepartmentHeadError` unless the actor **is** the department's
   current Head. A delegate is never the Head, so a delegate can never create a
   delegation. A → B → C cannot be expressed.
2. **Delegation adds substitute authority; it never transfers it.**
   `resolveApprovalAuthority` returns `capacity: "department_head"` for the Head
   *and* `capacity: "delegate"` for the delegate. The Head keeps everything.
3. **Delegation grants authority, not permission.** The delegation route
   independently requires `office_inventory.delegate.manage`, and the approval
   routes independently require their own permission. The row grants neither.
4. **Revocation is immediate**, because authority is re-derived on every action
   from a live query — never cached, never inferred from the row's existence.
5. **Rows are never deleted or rewritten.** `validTo` is stamped; the row stays
   fully historically queryable.
6. **No job is required for correctness.** Validity is a runtime date
   evaluation. Nothing expires a delegation on a schedule.
7. **Only the current authority holder may create or revoke** — `revokeDelegation`
   enforces this too, not just creation.
8. **Cross-tenant delegation is impossible for the actor**: `organizationId` is
   on the table and in every query, and the route resolves it from the verified
   membership rather than from the request body.
9. **The §5.3 rule is the model's spine.** A delegation row survives its Head's
   replacement but becomes **functionally inert**, because every approval
   re-checks that the row's `delegatingHeadMembershipId` is *still* the
   department's actual current Head.

A concurrency defect found during that module's own live QA is carried forward
as a design constraint, because the shared primitive inherits its shape: the
unique index keys on the **delegating head**, not the delegate, so one delegate
may simultaneously hold an open-but-inert row from a former Head alongside a
valid row from the current Head. The resolver therefore filters on
`delegatingHeadMembershipId = currentHead.headMembershipId` **inside the query**
rather than filtering after the fact — an unordered "any open row for this
delegate" query could non-deterministically return either row. **The shared
resolver must be written the same way** (§32.23, invariant 20).

### 32.6 A defect in the prototype, recorded and deliberately not fixed here

Discovery found that `office_inventory_approval_delegations` accepts a
`delegateMembershipId` validated **only by its foreign key**. The OpenAPI body
is `{ delegateMembershipId: integer }` with no constraints, and neither the
route nor `createDelegation` checks that the delegate:

- belongs to the **same organization** as the delegating Head;
- is an **active** membership;
- **is not the actor** — self-delegation is currently accepted.

The foreign key guarantees only that the id names *some* membership, including
one in another tenant.

**This is recorded, not repaired.** Q2 and §32.20 place Office Inventory
expressly outside WS-16's scope, and repairing it would change the behaviour of
a shipped module this workstream is instructed not to touch. **It requires its
own Owner Decision and its own pass**, and is registered as such in §32.25. It
is stated here so that it is neither silently inherited nor silently fixed.

**The shared primitive is deliberately stricter than the prototype** and
validates all three at write time (§32.16).

### 32.7 The shared live direct-report helper — the one genuine consolidation

**Canonical helper.** A new module `artifacts/api-server/src/lib/directReports.ts`,
sibling to `lib/departmentHeads.ts` and following its shape:

```ts
export async function listLiveDirectReportEmployeeIds(
  organizationId: number,
  managerEmployeeId: number | null,
): Promise<number[]>
```

Frozen semantics:

- resolves from `employees.reportingManagerId` **live**, on every call — never
  cached, never snapshotted;
- scoped by `organizationId` in the same `and(...)` clause, always;
- **no `employmentStatus` filter** — this matches all six migrating sites
  exactly (§32.9);
- returns employee **ids only**;
- returns `[]` when `managerEmployeeId` is `null`, subsuming the `?? -1` idiom
  four of the six sites use today, with identical results and without a sentinel
  id in a SQL predicate;
- **does not include the caller's own employee id.** Self-inclusion is
  caller-side composition and differs legitimately between sites — Assets'
  team-custody endpoint deliberately excludes self; the four scope resolvers
  deliberately include it. Folding that choice into the helper would change
  behaviour at five sites.

**It must never be used for snapshot authority** (§32.3), and the file must
carry that prohibition in its header, as `managerPortalAuthorization.ts` does.

### 32.8 A stale premise corrected

The Manager Portal frozen plan's header in `managerPortalAuthorization.ts` names
seven existing direct-report implementations and lists **`leaveApprovals.ts`**
among them. At `7662a68` that is **false**: `leaveApprovals.ts` contains no
`reportingManagerId` query at all, and its own comment states that a Department
Head *"sees only 'pending' requests from the department(s) they currently,
actually head — **never derived from reportingManagerId**, never from holding
`leave_request.approve` alone."* Leave approval authority is department-headship
authority, not reporting-line authority.

The verified set of forward live direct-report query sites is the seven in
§32.9. **The stale list must not be restored.** Correcting that header comment
is a Manager Portal file change: permitted in Pass 2A, forbidden in Pass 1.

### 32.9 The seven direct-report sites — required classification (Q4 = B)

Verified exhaustively by inspecting every `employeesTable.reportingManagerId`
reference in `artifacts/api-server/src`, excluding tests.

| # | Site | Predicate | Selects | Status filter | Disposition | Reason |
|---|---|---|---|---|---|---|
| 1 | `lib/assetReporting.ts:110` (`resolveAssetReportScope`) | `organizationId = X AND reportingManagerId = Y` | ids | none | **MIGRATE** | Predicate, projection and absence of a status filter are identical to the canonical helper. Self is added separately by `scopedEmployeeIds` and is unaffected. |
| 2 | `lib/assets.ts:1127` (`listTeamAssetAssignments`) | identical | ids | none | **MIGRATE** | Identical. The deliberate exclusion of self is caller-side (team custody only) and unaffected. |
| 3 | `lib/attendanceReporting.ts:62` (`resolveAttendanceReportScope`) | identical, `ownEmployeeId ?? -1` | ids | none | **MIGRATE** | Identical; the `?? -1` sentinel is subsumed by the helper's `null → []` contract, with the same result. |
| 4 | `routes/attendanceRegister.ts:81` | identical, `?? -1` | ids | none | **MIGRATE** | Identical; an inline route copy of #3. |
| 5 | `routes/leaveCalendar.ts:58` | identical, `?? -1` | ids | none | **MIGRATE** | Identical; the pattern the others describe themselves as mirroring. |
| 6 | `routes/users.ts:48` (`resolveLeaveDashboardMetrics`) | identical, `?? -1` | ids | none | **MIGRATE** | Identical. |
| 7 | `lib/managerPortalAuthorization.ts:75` (`listLiveDirectReports`) | `… AND employmentStatus <> 'terminated'` | full `Employee` rows | **excludes `terminated`** | **RETAIN — DIFFERENT SEMANTICS** | Its own header documents the difference as deliberate: *"a deliberate, narrower filter than the … existing direct-report query implementations (none of which filter by employmentStatus at all, since their own purpose — bounding a workflow search — differs from Team Overview's own purpose of showing a live team roster)."* It also returns full rows in a deterministic `lastName, firstName, id` order. Migrating it onto the canonical helper would put terminated employees back on a live team roster; migrating the six onto **it** would silently narrow six shipped scopes. Under Q4 = B, neither is permitted. |

**Not candidates — opposite direction.** Three further sites read
`employees.reportingManagerId` as a *projection*, answering "who is **my**
manager" rather than "who are my direct reports": `lib/notifications.ts:135`,
`lib/onboarding/responsibility.ts:83`, `lib/skills/capability.ts:91`. A
different question with a different cardinality; **out of scope**.

**Net result: six sites migrate, one is retained with a recorded reason, three
are not candidates. No behaviour changes anywhere.**

### 32.10 The shared delegation table (architecture only — not implemented)

Name: **`authority_delegations`** — module-neutral, following `department_heads`'
own naming rather than Office Inventory's module-prefixed table.

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` primary key | |
| `organization_id` | `integer` NOT NULL → `organizations.id` `on delete restrict` | tenant scope; present in every query |
| `authority_type` | `delegatable_authority_type` NOT NULL | new enum whose **only** member is `department_head` |
| `department_id` | `integer` NOT NULL → `departments.id` `on delete restrict` | the authority scope |
| `delegator_membership_id` | `integer` NOT NULL → `organization_memberships.id` `on delete restrict` | must **be** the current holder at creation |
| `delegate_membership_id` | `integer` NOT NULL → `organization_memberships.id` `on delete restrict` | must differ from the delegator |
| `reason` | `text` NOT NULL | required; non-empty after trim |
| `valid_from` | `timestamptz` NOT NULL default `now()` | |
| `valid_to` | `timestamptz` NULL | written only by revocation or replacement |
| `revoked_by_membership_id` | `integer` NULL → `organization_memberships.id` `on delete set null` | |
| `created_at` | `timestamptz` NOT NULL default `now()` | |

Indexes:

- `authority_delegations_open_unique` — **UNIQUE** on
  `(organization_id, authority_type, department_id, delegator_membership_id)`
  **`WHERE valid_to IS NULL`**;
- `authority_delegations_org_scope_idx` on
  `(organization_id, authority_type, department_id)`;
- `authority_delegations_delegate_idx` on `(delegate_membership_id)`.

Row-level security: `ENABLE ROW LEVEL SECURITY` with **zero policies**, per the
repository's standing convention — RLS enabled as defence in depth while
application-level organization scoping remains the primary control.

**Four deliberate departures from the prototype, each justified:**

1. **`reason` is added and required.** Office Inventory has no `reason` column.
   A delegation grants authority over other people's requests; OD #31 already
   establishes that elevated access carries a stated reason, and OD #18 that
   sensitive actions are auditable. A required reason costs one column and makes
   every grant self-explaining in the audit trail.
2. **`created_by_membership_id` is omitted.** Office Inventory carries it, but
   under Q3 (holder-only) it is *provably* always equal to
   `delegator_membership_id`. The instruction is to include only fields
   justified by the architecture; a column that can never differ is not.
3. **A separate `revoked_at` is omitted.** Revocation writes `valid_to`, so a
   second timestamp would always be identical to it. `revoked_by_membership_id`
   is retained because it carries information `valid_to` does not.
4. **`authority_type` is an enum with one member, not free text or JSON.**
   Arbitrary JSON authority definitions are prohibited. A single-member enum
   makes an unsupported authority type **unrepresentable at the database level**
   rather than merely rejected at runtime — strictly stronger than Q5 requires,
   and widened additively when a later decision approves a second type.

**Why `department_id` is a real foreign key rather than a generic
`authority_scope_id`.** Q5 restricts WS-16 to exactly one authority type, whose
scope *is* a department. A nullable, un-keyed generic scope column would trade a
real database guarantee available today for a hypothetical future one, and every
schema in this repository uses real foreign keys. A future authority type adds
its own scope column and widens the enum — additive, which is this repository's
migration convention regardless.

### 32.11 Single-open-delegation and concurrency

The proven pattern appears **twice** in shipped code — `department_heads` and
`office_inventory_approval_delegations` — and is identical in both: a **partial
unique index** over the open rows (`WHERE valid_to IS NULL`), plus an
application-layer close-then-insert inside one transaction that reads the
existing open row `FOR UPDATE`. The repository contains **no** exclusion
constraint and does not load `btree_gist`.

Frozen for the shared primitive:

- **Uniqueness scope** is `(organization_id, authority_type, department_id,
  delegator_membership_id)` among rows where `valid_to IS NULL` — the Office
  Inventory scope, extended by `authority_type`. It keys on the **delegator**,
  as the prototype does, with the resolver-side consequence recorded in §32.5.
- **Creating a second delegation replaces the first**, within a single
  transaction: `SELECT … FOR UPDATE` the open row, stamp its `valid_to` and
  `revoked_by_membership_id`, then insert. This matches `createDelegation`
  exactly. Under holder-only creation the replaced row is always the actor's
  own, and the closure is audited.
- The partial unique index is the **database backstop** should two concurrent
  transactions ever escape the row lock.

**Consequence, stated plainly: WS-16 supports neither future-dated nor
planned-end delegations.** `valid_from` is `now()` at creation, and `valid_to`
is written only by revocation or replacement. This is not an oversight. A
planned end date, or a future start, would place two rows in the table with
`valid_to IS NULL` describing non-overlapping windows, which the partial unique
index cannot distinguish from genuine ambiguity. Enforcing it properly would
require replacing the proven index with a `tstzrange` exclusion constraint and
the `btree_gist` extension, neither of which this repository has ever used, and
the binding instruction is *do not weaken concurrency protection*. A scheduled
delegation window is a genuine future enhancement requiring its own Owner
Decision, registered in §32.25.

"Effective-dated" is fully preserved: `[valid_from, valid_to)` is evaluated at
runtime on every action, so a revoked delegation falls outside its window from
the instant of revocation, with no job involved (§32.13).

### 32.12 Authority resolution, permission and business state

The shared resolver answers exactly one bounded question — *may this membership
act with department-head authority for this department, right now?* — and
returns a small typed result distinguishing `direct` from `delegated`, carrying
the underlying head's membership id and the delegation id when delegated. This
mirrors `ApprovalAuthority` in `officeInventoryDelegations.ts`, which is the
proven shape. It is used **only** where it reduces real duplication or improves
audit and debugging; no existing resolver is forced to return it in WS-16, and
internal authorization configuration is never leaked to ordinary users.

**Frozen composition rule.** For a delegated action to succeed, all of the
following must independently pass:

```
source permission  AND  effective delegated authority  AND  source business state
```

- **Delegation never grants permission.** Office Inventory proves the
  separation: `office_inventory.delegate.manage` gates the delegation surface,
  and the approval routes gate themselves. **Delegation must not become an RBAC
  mutation mechanism.**
- **Modules remain authoritative for business state.** WS-16 owns none of:
  Leave states, Recruitment stages, Payroll maker-checker state, WS-13 request
  state, Onboarding task state, Performance state, Learning state, Employee
  Relations state.
- **Module enablement is an independent prerequisite.** A delegation cannot
  revive, bypass or re-expose a disabled module.
- **Confidentiality is not widened.** A department-head delegation grants
  department-head *authority* over the adopting consumer's own actions and
  nothing else. It must never yield grievance narratives, disciplinary evidence,
  succession candidate data, Payroll compensation, banking or statutory
  identifiers, or any other protected read. Source module permissions and
  confidentiality rules remain independently enforced, exactly as §31.19 and
  §31.29 require of the Action Centre and Employee 360.

### 32.13 Failure semantics, and no job requirement

Validity is evaluated at runtime from `valid_from`, `valid_to` and the live
re-check of the delegator's underlying authority. **No worker expires a
delegation**, and correctness must never depend on one having run. WS-6 may
later provide reminder or expiry *notifications* if separately authorized; those
would be conveniences, never part of the authority decision.

These outcomes remain **distinct** and must not be collapsed into one another:

| Condition | Outcome |
|---|---|
| Actor holds no direct authority and no delegation | Authorization denied |
| Delegation exists but is outside `[valid_from, valid_to)` | Authorization denied |
| Delegation is invalidly configured (unsupported type, invalid scope) | Rejected at write; denied at runtime |
| Delegate membership is inactive | Authorization denied |
| Source permission missing | Permission denied, by the source's own gate |
| Database or infrastructure failure | **Operational error — never converted into "unauthorized"** |

**No permissive fallback exists** — never to Org Admin, never to HR. And an
operational failure must never be silently reported as an authorization result;
that is the same `authorize`/`query` discipline §31 froze for the Action Centre.

### 32.14 WS-9 and WS-13 stage resolvers remain separate

Frozen explicitly, on evidence. Both expose a three-value vocabulary —
`department_head`, `permission_holder`, `specific_membership` — across **two
separate enums** (`recruitment_authority_resolver`, `request_authority_resolver`).
The vocabulary is duplicated. The semantics are not:

| | WS-9 `resolveStageAuthority` | WS-13 `membershipSatisfiesStage` |
|---|---|---|
| Question | "Is this actor authorized, and on what basis?" | "Does this membership satisfy this stage?" |
| Returns | `AuthorityGrant \| null` with an `authorityBasis` string | `boolean` |
| Department head via | `resolveDepartmentHeadAsOf` — **point-in-time** | `getCurrentDepartmentHead` — **live** |
| Department derived from | the **caller-supplied** department | the **subject employee** |
| `specific_membership` | `Number(config.membershipId)` coercion | strict `===`, no coercion |

Merging them would force one of each pair onto the other and change at least one
module's behaviour. **Do not merge them, do not build one generic stage
resolver, and do not migrate their configuration.** This is precisely the trap
OD #14 names — similar names are not shared semantics.

### 32.15 WS-10 Onboarding remains separate

Onboarding's `resolveResponsibility` is a **forward** resolver — *who is
responsible?* — returning a set of membership ids and a basis string across
**five** values (`employee_self`, `reporting_manager`, `department_head`,
`permission_holder`, `specific_membership`). WS-9 and WS-13 are **predicate**
resolvers over three values. Task responsibility is not approval authority.
WS-10 may continue consuming shared low-level identity and department helpers
where it already does, but its five-value responsibility model remains
source-owned and unchanged.

### 32.16 Write-time validation (holder-only)

The shared create path rejects, before any write:

1. **cross-tenant delegate** — the delegate membership must belong to the same
   `organization_id`;
2. **inactive delegate** — the delegate membership must be active;
3. **self-delegation** — delegator and delegate must differ;
4. **unsupported authority type** — unrepresentable by the enum, and rejected in
   the service besides;
5. **invalid authority scope** — the department must exist in this organization
   (the prototype's `DepartmentNotFoundError` check);
6. **actor is not the direct authority holder** — the actor must **be** the
   department's current Head, resolved live via `getCurrentDepartmentHead`,
   never trusted from the request;
7. **no chaining** — a delegate is never treated as a holder, which (6) enforces
   structurally;
8. **invalid date range** — unreachable in WS-16 (§32.11); the check is retained
   so it cannot become reachable silently.

**Runtime must revalidate regardless.** Write-time validation is a usability and
integrity measure; it is never the authorization decision.

### 32.17 Revocation, authority loss and inertness

- **Revocation is immediate**, because authority is re-derived per action.
- **The historical row is retained** — never deleted, never rewritten.
- **Previous delegated actions remain attributed to the actual delegate**, and
  revocation never rewrites historical audit events.
- **The delegator may revoke while they still hold the underlying authority**,
  which is the prototype's rule: `revokeDelegation` throws
  `NotCurrentDepartmentHeadError` if the actor is no longer the Head. Repository
  evidence establishes **no** safe revocation rule *after* authority loss, and
  none is invented here — the row does not need revoking, because it is already
  inert, and the new holder cannot revoke a grant they did not make.
- **Authority loss makes the delegation functionally inert** (§5.3). The row may
  continue to exist; every action re-checks that `delegator_membership_id` is
  *still* the department's current Head, and the delegate can approve nothing
  once it is not.
- **A new department head does not inherit the previous head's delegation.** The
  new holder must create their own. Automatic transfer is prohibited.
- **A vacancy denies everything**: with no current Head there is no holder to
  validate a delegation against, so no delegation can be valid.
- **An inactive delegate membership makes the delegation ineffective** even
  while the row is open.

### 32.18 Actual-actor attribution

The prototype's attribution model is proven and carried forward: the **source
record** carries the attribution columns, and the shared delegation table does
**not** record exercises. `office_inventory_request_lines` stores
`approvedByMembershipId` (the actual delegate), `actedAsDelegate`,
`delegatorHeadMembershipId` and `delegationId`, and the audit event's actor is
the actual acting membership.

Frozen: whenever delegated authority is exercised, the record must capture the
**actual acting membership**, the **underlying authority holder**, the
**delegation id**, an authority basis of **delegated**, the **source module and
action**, the **source record or stage** where applicable, and the
**organization**.

**Never attribute a delegated action as though the delegator performed it
personally.** Adding those columns is the *adopting consumer's* own work in its
own pass — the shared table does not grow an exercise log.

### 32.19 Maker-checker survives delegation

Payroll is the reference case: `payrollRuns.ts` throws
`PayrollRunSelfApprovalError` when `run.preparedByMembershipId` equals the
**acting** membership, for both approve and lock.

Frozen invariant: **a source conflict rule compares the actual acting
membership, never the delegator.** A delegate who prepared a run cannot approve
it, and no valid delegation may override a source's own maker-checker,
separation-of-duties or self-approval prohibition. Delegated authority is never
a laundering path around a source rule.

### 32.20 Office Inventory compatibility (Q2)

Office Inventory keeps its own table, its own resolver, its own routes and its
own permission key. **No migration. No dual-write. No replacement. No rewrite of
the concurrency-tested resolver.** Its existing implementation remains
authoritative for Office Inventory.

Where genuinely useful, a **typed compatibility interface** may normalize the
two conceptual outputs — for example a shared `AuthorityGrant`-shaped result
type — **without normalizing storage**. That is a type-level convenience only
and must change no Office Inventory behaviour.

Pass 2 must prove, against a live database, that Office Inventory's creation,
revocation, effective dating, concurrency, permission separation, live head
revalidation, audit and tenant isolation are all unchanged.

### 32.21 Super Admin, and the initial consumer set

**Super Admin is not an ordinary workflow authority holder** and cannot create
tenant delegations. The existing controlled, audited support-access mechanism
(OD #31, break-glass) remains entirely separate. **No cross-tenant delegation
exists**, in any direction.

**The initial consumer set is empty, and that is the honest finding.** Every
module with department-head-shaped authority — Leave's Department Head stage,
WS-9 Recruitment, WS-13 Requests, WS-10 Onboarding, Payroll — is named in this
freeze's own scope as **not** automatically delegatable. Office Inventory
already has its own implementation and stays on it (Q2). **No non-Office-
Inventory consumer is currently authorized**, and a consumer must not be
invented merely to prove the table works.

Two consequences follow, and are frozen:

1. **The foundation is frozen and built independently.** Module adoption
   requires an explicit later decision, per module.
2. **The holder-facing surface (Pass 2C) is contingent on a consumer existing.**
   A create-and-revoke UI for authority that nothing consults would be a surface
   that silently does nothing — worse than no surface at all. §32.24 records
   this as a gate rather than a scope reduction, and the frozen contract for
   that surface is recorded in full in §32.22 so it needs no re-litigation when
   a consumer is approved.

**A shared delegation primitive existing does NOT mean** Leave, Recruitment,
WS-13, Payroll or Onboarding becomes delegatable.

### 32.22 Frontend acceptance table (frozen contract; gated by §32.21)

**Read-only surfaces do not satisfy the frozen create and revoke capabilities.**

| Actor | Surface | Read capability | Required write action | Authority rule | Write UI required | Audit requirement |
|---|---|---|---|---|---|---|
| **Direct Department Head** (current holder) | Own delegations for a department they currently head | Own active delegation plus full history for that scope | **Create** a delegation; **revoke** their own effective delegation | Live `getCurrentDepartmentHead` = actor, at both create and revoke | **YES — both** | `authority_delegation.created` / `.revoked`, actor = the Head, before/after delegate recorded |
| **Delegate** | May act on the adopting consumer's own approval surface | Sees no delegation-management surface | **None** | Holds `capacity: "delegate"` for actions only; a delegate manages approvals, never who else may be delegated to | **NO** | Each exercised action audited with the actual actor and the delegation id (§32.18) |
| **Unauthorized membership** | None | None — the surface is absent, not disabled with an explanatory message | **None** | Not the current Head, holds no delegation | **NO** | Denials audited per existing conventions; no existence leak |
| **Org Admin without direct authority** | None | None | **None — explicitly** | Q3: administrative privilege does not manufacture another person's workflow authority | **NO — no "delegate for someone else" UI exists** | Any attempt denied and audited |
| **Super Admin** | None (tenant boundary) | None | **None** | §32.21 — not an ordinary workflow authority holder; break-glass remains separate | **NO** | Break-glass audit only, through its own mechanism |

No generic workflow designer. No cross-module approval builder. No admin
delegation console.

**Permission model.** Because only the authority holder may create or revoke
their own delegation, **no broad administrative delegation permission is
introduced**, and **no permission keys are created in Pass 1**. Office Inventory's
precedent is a *module-owned* key (`office_inventory.delegate.manage`) paired
with the live holder check, and Manager Portal's precedent is zero new
permissions with access resolved from module enablement plus a live
relationship. A shared `delegation.manage` key is therefore **not** created by
WS-16: with no authorized consumer, a permission key would gate nothing. The
first adopting consumer's own pass decides between reusing its module key and
adding one, under least privilege. The live holder check is required in every
case and is never replaced by a permission.

### 32.23 Pass-2 acceptance matrix

Every item is a required, verifiable Pass-2 invariant.

1. Same-tenant only — delegator, delegate and department all in one organization.
2. Direct authority required to create — the actor **is** the live current Head.
3. Holder-only create — no admin, HR, Super Admin or workflow-administrator path exists.
4. No self-delegation — delegator ≠ delegate.
5. No delegation chaining — a delegate cannot create a delegation.
6. Only `department_head` is accepted; every other authority type is rejected.
7. Source permission is independently required; delegation grants none.
8. A valid date window is enforced at runtime, `[valid_from, valid_to)`.
9. An expired delegation is denied **with no job having run**.
10. A revoked delegation is denied **immediately**.
11. An inactive delegate membership is denied.
12. Delegator authority loss makes the delegation **inert**, with the row preserved.
13. A new department head does **not** inherit the previous head's delegation.
14. The **actual delegate** is recorded in audit, never the delegator as actor.
15. The **delegation id** is recorded on the source record.
16. **Maker-checker survives** — a source self-approval prohibition compares the acting membership (§32.19).
17. Confidential permissions are **not widened** by holding a delegation.
18. **Module disablement survives** — a disabled module cannot be revived through delegation.
19. Cross-tenant forged ids in the request body are denied; the organization is resolved from the verified membership, never from the body.
20. Concurrent creation cannot produce two open delegations for one delegator scope — `FOR UPDATE` close-then-insert plus the partial unique index — **and** the resolver filters on `delegator_membership_id = currentHead` inside the query, never after the fact (§32.5).
21. **Office Inventory behaviour unchanged** — creation, revocation, effective dating, concurrency, permission separation, live head revalidation, audit, tenant isolation.
22. **Performance snapshot behaviour unchanged** — `performance_reviews.reviewerEmployeeId` is never resolved live.
23. **Learning snapshot behaviour unchanged** — `learning_enrollments.managerEmployeeIdSnapshot` is never resolved live.
24. **WS-9 behaviour unchanged** — its stage resolver is untouched.
25. **WS-13 behaviour unchanged** — its stage resolver is untouched.
26. **WS-10 Onboarding behaviour unchanged** — the five-value responsibility model is untouched.
27. **Action Centre regression green** (§31.4–31.27).
28. **Manager Portal regression green**, including `listLiveDirectReports`' terminated exclusion (§32.9 #7).
29. **Employee 360 regression green** (§31.29).
30. **No generic workflow engine**, no centralized approval state machine, no arbitrary expression DSL.
31. **No AI authority decisions** — AI may not grant, resolve, route or infer authority, and may not decide who may approve.

Repository-specific additions required by this freeze:

32. The six migrated direct-report sites return **identical result sets** to their pre-migration behaviour, proven per site against a live database.
33. `listLiveDirectReports` still filters `employmentStatus <> 'terminated'` and still returns full rows in `lastName, firstName, id` order.
34. `lib/directReports.ts` is never imported by a Performance or Learning authority path.
35. The `authority_delegations` migration is **purely additive** — zero drops, zero altered columns — with RLS enabled and zero policies, and a hand-written `.down.sql` verified up → down → up.
36. No `reporting_manager`, `permission_holder` or `specific_membership` delegation can be stored; the enum makes it unrepresentable.

### 32.24 Pass-2 implementation slices

Restrained, and sequenced by dependency rather than by ambition.

| Slice | Scope | Gate |
|---|---|---|
| **Pass 2A** | Shared live direct-report helper `lib/directReports.ts`; migrate the six proven-equivalent sites (§32.9); retain #7 with its documented reason; correct the stale `leaveApprovals.ts` reference in the Manager Portal header (§32.8). **No schema change, no migration; ledger stays `0070`.** | **COMPLETE** — see §32.27 |
| **Pass 2B** | `authority_delegations` table and enum (migration **`0071`**, additive, RLS, hand-written down), the shared resolver, create/revoke service with §32.16 validation and §32.11 concurrency, audit events. **No consumer wired.** | **COMPLETE** — see §32.28 |
| **Pass 2C** | Holder-facing API, frontend surface (§32.22) and audit surfacing | **DEFERRED / CONSUMER-TRIGGERED** (§32.29.1) — no longer a WS-16 closure blocker |
| **Pass 2D** | First approved consumer adoption, including that module's own attribution columns (§32.18) | **DEFERRED / CONSUMER-TRIGGERED** (§32.29.1) — requires the adoption gate in §32.29.6 |

Pass 2A and Pass 2B are independent and may be committed separately. Neither
requires the other.

### 32.25 Registered for a later, separate decision

Recorded so that none is silently absorbed into WS-16 or silently dropped.

1. **The Office Inventory delegate-validation gap** (§32.6) — cross-tenant,
   inactive and self delegate ids are accepted today. Requires its own decision
   and its own pass, because repairing it changes a shipped module's behaviour.
   **Still open after Pass 2B**, deliberately: the shared foundation validates
   all three at write time (§32.28.3), but Office Inventory was not touched,
   not migrated and not dual-written, so its own gap is unchanged.
2. **The first delegation consumer** (§32.21) — no module is authorized today;
   Pass 2C and Pass 2D are gated on this.
3. **Scheduled delegation windows** (§32.11) — a future start or a planned end,
   which would require an exclusion constraint and `btree_gist`.
4. **A second delegatable authority type** (Q5) — additively widening
   `delegatable_authority_type`.
5. **The two duplicated stage-resolver enums** (§32.14) — the vocabulary is
   duplicated even though the semantics are not; WS-16 deliberately leaves both
   in place.

### 32.26 What this freeze does not touch

**WS-11.1 remains deferred. WS-12's future-separation-basis dependency remains
unresolved. The legacy `employee_skills` consolidation remains a separate Owner
Decision. Global Search remains a future approved safe navigation and discovery
capability and is not implemented (§31.40).** None is absorbed here.

WS-16 closes OD #14 and OD #15 **as architecture, not as implementation**.
Neither is complete until Pass 2A and Pass 2B ship.

**Pass 2A shipped on 2026-08-31 (§32.27), and Pass 2B on the same date (§32.28).
Pass 2C and Pass 2D remain gated.**

### 32.27 Pass 2A implementation record

Shipped 2026-08-31 against the frozen §32.7 and §32.9. **No schema change, no
migration, no permission key, no API contract change, no frontend change;
ledger remains `0070`** and a `drizzle-kit` drift probe reports "No schema
changes, nothing to migrate".

#### 32.27.1 The canonical helper

`artifacts/api-server/src/lib/directReports.ts` —
`listLiveDirectReportEmployeeIds(organizationId, managerEmployeeId | null)`,
exactly the frozen contract. It imports only `drizzle-orm` and
`@workspace/db`, so it can introduce no dependency cycle, and its header
carries the four prohibitions §32.7 requires: not a snapshot substitute, not a
department-head resolver, not an authority or permission decision, not a
generic workflow resolver.

#### 32.27.2 The six migrations

| # | Consumer | Change | Behaviour-preservation evidence |
|---|---|---|---|
| 1 | `lib/assetReporting.ts` → `resolveAssetReportScope` | inline query → helper | `assetReporting.test.ts`; live parity + status/tenant tests |
| 2 | `lib/assets.ts` → `listTeamAssetAssignments` | inline query → helper | `assets.test.ts`; live "team custody excludes self" and "null manager → []" |
| 3 | `lib/attendanceReporting.ts` → `resolveAttendanceReportScope` | inline query + `?? -1` → helper | `attendanceReporting.test.ts`; live null-manager parity |
| 4 | `routes/attendanceRegister.ts` | inline query + `?? -1` → helper | `attendanceRegister.test.ts` |
| 5 | `routes/leaveCalendar.ts` | inline query + `?? -1` → helper | `leaveCalendar.test.ts` |
| 6 | `routes/users.ts` → `resolveLeaveDashboardMetrics` | inline query + `?? -1` → helper | `managerPortalDashboardAndPendingActions.test.ts` |

| Retained | Reason not migrated |
|---|---|
| `lib/managerPortalAuthorization.ts` → `listLiveDirectReports` | §32.9 #7 — deliberately excludes `terminated` and returns full rows in `lastName, firstName, id` order. Migrating it would put former employees back on a live team roster; teaching the shared helper its filter would narrow six shipped scopes. A live regression test now asserts the two disagree about a terminated employee, so a future "cleanup" cannot merge them silently. |

Two routes — `attendanceRegister.ts` and `leaveCalendar.ts` — no longer query
the database directly at all and dropped their `drizzle-orm`/`@workspace/db`
imports entirely. That is a consequence of the consolidation, not a separate
refactor: it was their only direct query.

#### 32.27.3 Semantics deliberately preserved, not tidied

- **No employment-status filter.** Active, probation, on_leave, suspended and
  **terminated** direct reports all remain in scope for all six, asserted
  explicitly. This is what they did before; narrowing it would have been a
  silent security-relevant change in six places at once.
- **No `orderBy`.** None of the six had one, and each consumes the result as a
  membership set. Adding determinism would have been a behaviour change
  disguised as an improvement.
- **Self-inclusion stays caller-side.** Assets' team-custody endpoint still
  excludes the manager; the four scope resolvers still include them.
- **The `?? -1` sentinel is gone**, replaced by the helper's `null → []`
  contract. Identical result, without a sentinel id in a SQL predicate.

#### 32.27.4 Verification

15 new live tests (`directReportsLive.test.ts`) and 6 new structural guards
(`directReportsBoundaries.test.ts`), the latter requiring no database:

- the helper is **never imported by a Performance or Learning path** (§32.23 #34);
- exactly **two** forward `reportingManagerId` query sites remain — the helper
  and the retained roster — so a new inline copy fails the build;
- the helper contains no `employmentStatus` reference and does predicate
  `organizationId`;
- the retained roster still excludes `terminated`;
- **no delegation foundation exists yet** — `authority_delegations` appears
  nowhere, guarding the Pass 2A/2B boundary.

Snapshot authority was proved intact behaviourally, not merely by inspection:
changing an employee's `reportingManagerId` moves them under the new manager
in the live helper while `learning_enrollments.managerEmployeeIdSnapshot` and
`performance_reviews.reviewerEmployeeId` both stay pointing at the old one.

Tenant isolation is proved three ways: the right manager id asked in the wrong
organization returns `[]`; a forged cross-tenant manager id returns `[]`; and
writing a cross-tenant reporting line still does not make it visible from the
other side, because the organization predicate excludes it.

#### 32.27.5 Untouched, and verified untouched

Office Inventory's delegation table, resolver and routes are **unmodified** —
the validation gap recorded in §32.6 remains open and registered in §32.25, not
fixed here. No permission key or seed changed. No Action Centre, Employee 360,
Reporting or Global Search change. The API contract is unchanged: **732
operations across 594 paths**, zero duplicate operation ids, zero dangling
schema references, codegen deterministic.

### 32.28 Pass 2B implementation record

Shipped 2026-08-31 against the frozen §32.10–§32.19. **Migration `0071`,
purely additive; ledger moves `0070` → `0071`.** No permission key, no
permission seed change, **no HTTP route**, no API contract change (**732
operations across 594 paths**, unchanged), no frontend change, and **no
business consumer**.

#### 32.28.1 Schema objects created

One enum and one table, with zero drops and zero altered columns anywhere:

- `delegatable_authority_type` — a pgEnum with the **single** member
  `department_head`;
- `authority_delegations` — the eleven frozen columns exactly: `id`,
  `organization_id`, `authority_type`, `department_id`,
  `delegator_membership_id`, `delegate_membership_id`, `reason`,
  `valid_from`, `valid_to`, `revoked_by_membership_id`, `created_at`.
  No `created_by_membership_id` and no `revoked_at`, for the reasons §32.10
  records;
- indexes `authority_delegations_open_unique` (UNIQUE, partial,
  `WHERE valid_to IS NULL`), `authority_delegations_org_scope_idx` and
  `authority_delegations_delegate_idx`;
- five foreign keys (`restrict`, except `revoked_by` which is `set null`);
- **three CHECK constraints** — the first in this repository — pushing
  integrity into the database rather than leaving it all in a service:
  `authority_delegations_no_self_delegation`,
  `authority_delegations_valid_range` and
  `authority_delegations_reason_not_blank`;
- `ENABLE ROW LEVEL SECURITY` with **zero policies**, the standing convention.

Verified by round-trip on a fresh database: **up → down → up**, with every
index, CHECK, foreign key and RLS restored, and `drizzle-kit` reporting
"No schema changes, nothing to migrate" afterwards.

#### 32.28.2 A constraint defect found and fixed before commit

The reason-not-blank CHECK was first written as `length(btrim(reason)) > 0`.
A live test proved that wrong: **PostgreSQL's `btrim` strips spaces only**, so
a tab- or newline-only reason passed the database while the service's JavaScript
`.trim()` rejected it. A backstop that disagrees with the service it backs is
worse than no backstop, so the constraint became
`reason ~ '[^[:space:]]'` — "contains at least one non-whitespace character",
which is exactly what `.trim().length > 0` means. The migration was regenerated
rather than patched, and the test now asserts four whitespace shapes against
both layers.

#### 32.28.3 The service

`artifacts/api-server/src/lib/authorityDelegations.ts` — internal only, with
**no route and no OpenAPI surface**, because the holder-facing API and UI are
Pass 2C and remain gated (§32.21).

- `resolveDepartmentHeadAuthority(organizationId, departmentId, actorMembershipId)`
  → the frozen minimal result `{ basis, directAuthorityHolderMembershipId,
  delegationId }` or `null`. Composes `departmentHeads.ts`'s existing
  `getCurrentDepartmentHead` rather than creating a competing source of truth.
- `createDepartmentHeadDelegation` — holder-only. There is **no
  `delegatorMembershipId` parameter to forge**: the delegator is always the
  authenticated actor, verified live against the department-head resolver.
- `revokeDelegation` — delegator-only, immediate, never deleting.
- `listDelegationsGrantedBy`, `getDelegation`, `getOpenDelegationGrantedBy` —
  bounded reads, all organization-predicated, all keyed on the delegator. There
  is deliberately **no "list every delegation in the tenant"** capability and no
  administrative backdoor.

Write-time validation rejects, each with its own named error: unsupported
authority type · blank reason · self-delegation · a department outside the
organization · an actor who is not the current head · an inactive or
cross-tenant actor · **an inactive or cross-tenant delegate**. That last one is
the gap the Office Inventory prototype leaves open (§32.6): a foreign key
proves a membership exists, never that it is ours.

#### 32.28.4 The rules that carry the design

- **Holder-only.** No Org Admin, HR, Super Admin or workflow-administrator
  path exists to create or revoke on someone's behalf.
- **No chaining, structurally.** Creation demands DIRECT authority, and a
  delegate is by definition not the head, so A → B → C cannot be expressed —
  proved by a test in which B genuinely holds delegated authority and is still
  refused.
- **Authority loss makes a delegation inert**, and the new head does **not**
  inherit it. The row stays open and fully queryable while granting nothing,
  because resolution matches only a row whose delegator *is* the current head.
- **Revocation is immediate**, by runtime date evaluation. **No job exists or
  is required**, and none may be built that correctness depends on.
- **An inactive or expired delegate** resolves to no authority, re-checked at
  resolution rather than trusted from creation.
- **A vacancy denies everyone**, delegation or not.
- **Delegation grants no permission** — asserted by a test comparing membership
  roles before and after.
- **Replacement, not accumulation**: creating a second delegation closes the
  holder's own open one inside one transaction (`SELECT … FOR UPDATE`), with
  the partial unique index proven to reject a raw duplicate open row.

#### 32.28.5 Audit

`authority_delegation.created` and `authority_delegation.revoked`, through the
existing `recordAuditEvent` — no second audit system. The prefix is registered
in `auditCategories.ts` as **`security`**, sitting with `membership` and
`role` rather than under HR or a module category, because what it records is an
access-control change. Both events name the **actual** acting membership, and a
replacement records the superseded delegation's id.

The resolver returns `directAuthorityHolderMembershipId` and `delegationId`
precisely so a future consumer can store the **actual delegate** alongside them
and never attribute an action as though the head performed it personally
(§32.18). No source business audit was modified, because no consumer is wired.

#### 32.28.6 Verification

**33 live tests** covering create, runtime resolution, revoke, tenant isolation,
audit and the permission boundary, plus **4 new structural guards** replacing
Pass 2A's now-obsolete "no delegation foundation exists" assertion:

- the foundation has **zero business consumers** — any file importing it other
  than itself fails the suite;
- it is **not exposed over HTTP**, guarding the Pass 2C gate;
- **only `department_head`** is representable in the enum;
- **Office Inventory neither reads nor is read by** the shared module.

Cross-tenant defence is proved at every entry point: Org A cannot read, revoke
or resolve an Org B delegation; a cross-tenant delegate is refused at creation;
and a failed cross-tenant revoke leaves the foreign row untouched.

#### 32.28.7 What Pass 2B completion does NOT mean

**Shared delegation infrastructure existing does not mean delegation is
available.** No business workflow recognises it, no frontend exposes it, no
route serves it, and no authority scope beyond `department_head` is
authorized. **The initial consumer set remains EMPTY** and a consumer must not
be invented to justify the table. Pass 2C (holder-facing API and UI) and
Pass 2D (first consumer adoption) both remain **GATED** on an explicit Owner
Decision naming a module.

Office Inventory remains on its own table and resolver, unmigrated and
un-dual-written, and **its FK-only delegate-validation gap remains open**
(§32.6, §32.25) — deliberately not repaired here.

**Superseded by §32.29:** WS-16 was formally CLOSED on 2026-08-31. The
reusable primitive itself completes the workstream; module adoption is
future, requirement-triggered work.

### 32.29 WS-16 formal closure

Recorded 2026-08-31, after Pass 2A (`c40114d87b0251c4d0b0dd2d8186be8956d8b354`,
ledger `0070`) and Pass 2B (`f2caa5c13401e87e27c01531fdad53d3541e839a`,
migration `0071_nostalgic_patriot`, ledger `0071`). This subsection is
**documentation only**: no code, schema, permission, API, job or migration
accompanied it, the ledger remains `0071`, and there is no `0072`.

**WS-16 is COMPLETE.**

#### 32.29.1 The closing decision

> The reusable authority/delegation primitive itself completes WS-16.
> Business-module adoption is future, requirement-triggered work and is not a
> prerequisite for closing this infrastructure workstream.

WS-16's register row bundles two things — *"generalize Office Inventory's
delegation table, extract authority-resolver"* — and both are delivered. What
remains, module adoption, was never in that row: it is the work a future
business requirement will commission, and §32.21 froze the initial consumer set
as **EMPTY** precisely so that no consumer would be invented to justify the
infrastructure.

**Pass 2C and Pass 2D therefore cease to be closure blockers and become
consumer-triggered future work.** They are reclassified from GATED-within-WS-16
to DEFERRED, under the adoption gate in §32.29.6.

#### 32.29.2 Why OD #14 is satisfied

OD #14 approved *"shared authority-resolution/delegation primitives where
justified"* and forbade *"one giant generic workflow engine"*. Each half is
answered by verifiable repository state, not assertion:

| OD #14 requirement | Evidence at `f2caa5c` |
|---|---|
| Extract the authority-resolution half where justified | Discovery established most of it was already shared (§32.2); the one genuine duplication — live direct-report resolution — is consolidated into `lib/directReports.ts` |
| Consolidate only what is genuinely equivalent | Six of seven sites migrated; **exactly two** forward `reportingManagerId` query sites remain in the codebase, the shared helper and the retained roster |
| Preserve deliberately different semantics | The seventh, `listLiveDirectReports`, still excludes `terminated` and is guarded by a test asserting the two **disagree** |
| Keep existing shared primitives shared | `departmentHeads.ts` untouched and still the single department-head source of truth, now composed by the delegation resolver |
| Leave each module's approval state machine bespoke | WS-9's `recruitmentApprovalStages.ts` and WS-13's `employeeRequests/approvalStages.ts` both remain, with their two separate enums, unmerged (§32.14) |
| Preserve snapshot authority | `learning_enrollments.managerEmployeeIdSnapshot` and `performance_reviews.reviewerEmployeeId` remain snapshot columns; a structural guard forbids the live helper being imported by a Performance or Learning path |
| **No generic workflow engine** | No workflow schema, no workflow rule registry, no expression DSL exists — verified by search, not assumed |

#### 32.29.3 Why OD #15 is satisfied

OD #15 approved generalizing the proven Office Inventory delegation concept
*"beyond Office Inventory where appropriate"*, requiring authority to remain
*"effective-dated, scoped, revocable, and auditable"*. The shared foundation
delivers each, and several protections the prototype never had:

| OD #15 requirement | Delivered |
|---|---|
| Effective-dated | `[validFrom, validTo)` evaluated at runtime on every resolution |
| Scoped | `organization_id` + `authority_type` + `department_id`, with a real foreign key |
| Revocable | Immediate, by runtime date evaluation — **no job exists or is required** |
| Auditable | `authority_delegation.created` / `.revoked` through the existing audit primitive, categorized `security`, naming the **actual** actor |
| Live-revalidated | Authority loss makes a delegation inert while preserving the row; the new head does not inherit it |
| DB-enforced single-open | Partial unique index, proven to reject a raw duplicate open row |
| Tenant-safe | Every query organization-predicated; cross-tenant read, revoke and resolve all proven denied |
| Holder-only | No administrative on-behalf-of path exists for anyone |
| Independent of permission | Membership roles proven unchanged across a delegation |

**A business consumer is not required to prove that reusable infrastructure
exists.** The foundation is verified by 33 live tests and four structural
guards; wiring a module would prove nothing further about the primitive and
would breach §32.21.

The generalization is also **stricter than the prototype it generalizes**: it
validates cross-tenant, inactive and self delegates at write time, and adds
three database CHECK constraints. Office Inventory's own gap is untouched and
stays open (§32.29.5).

#### 32.29.4 Delivered, and intentionally deferred

**Delivered**

- a shared live current direct-report primitive, with six equivalent consumers
  consolidated onto it;
- deliberately different authority semantics preserved — the retained roster,
  WS-9/WS-13 stage resolvers, WS-10 responsibility, and Performance/Learning
  snapshots;
- a shared department-head delegation foundation: additive schema, holder-only
  creation, no chaining, runtime revalidation, immediate revocation,
  DB-enforced concurrency protection, tenant safety, audit, and no permission
  widening;
- no generic workflow engine.

**Intentionally deferred**

- business-module consumer adoption;
- the delegation frontend;
- the delegation HTTP API;
- Office Inventory migration;
- the Office Inventory delegate-validation fix;
- additional authority types;
- future-scheduled or planned-end delegation.

> **These deferred capabilities are not WS-16 closure defects.** Each is either
> a future business requirement (adoption, and the surface that serves it) or a
> separately registered decision (§32.25). None was in WS-16's register row, and
> none is made more likely to be built correctly by being rushed now.

#### 32.29.5 The Office Inventory defect remains open

**WS-16 did not fix it, and must not be read as having done so.** Office
Inventory's module-owned delegation implementation still validates
`delegateMembershipId` by foreign key alone, so it does not enforce the shared
foundation's protections against a **cross-tenant delegate**, an **inactive
delegate**, or **self-delegation**.

It was not migrated, not dual-written, not read from, and not repaired. It
remains registered in §32.25 as future corrective work needing its own Owner
Decision, because repairing it changes a shipped module's behaviour.

#### 32.29.6 The future adoption gate

The table existing never authorizes adoption. Before any module consumes
`authority_delegations`, record:

1. the named module;
2. the genuine business requirement driving it;
3. the exact authority point being delegated;
4. proof that `department_head` is the appropriate authority for it;
5. a live-versus-snapshot determination for that authority;
6. the source permission that remains independently required;
7. the maker-checker impact;
8. the confidentiality impact;
9. audit attribution carrying actual actor, direct holder and delegation id;
10. the Action Centre impact, where applicable;
11. the API and frontend surface required;
12. the regression plan.

#### 32.29.7 Verification record

Carried forward from Pass 2B exactly, including what did not pass:

- **Backend: 2862/2863 across 163 files.** The single whole-suite failure is
  `documentExpiryReminderSample.test.ts` — the already-documented WS-6 unscoped
  `claimDueJobs` suite-isolation condition, whose own header instructs that it
  run alone. It passes **1/1 alone on a clean database**, and Pass 2B touches no
  WS-5 or WS-6 path. **The whole-suite result is 2862/2863 and must not be
  restated as 2863/2863.**
- **Frontend: 843/843 across 78 files**, zero skipped.
- **API: 732 operations across 594 paths, unchanged**, with no delegation HTTP
  API, zero duplicate operation ids and zero dangling schema references.
- **Migration `0071` round-trip up → down → up verified**; schema drift clean.
- **Acceptance matrix: 36/36 PASS.**

#### 32.29.8 Final status

| Item | Status |
|---|---|
| Pass 1 — architecture freeze | **COMPLETE** (§32) |
| Pass 2A — shared live direct-report helper | **COMPLETE** — `c40114d`, ledger `0070` (§32.27) |
| Pass 2B — shared delegation foundation | **COMPLETE** — `f2caa5c`, migration `0071` (§32.28) |
| Pass 2C — holder-facing API and frontend | **DEFERRED / CONSUMER-TRIGGERED** |
| Pass 2D — first consumer adoption | **DEFERRED / CONSUMER-TRIGGERED** |
| Shared delegation consumer count | **0 — by design** |
| Office Inventory | module-owned, unmigrated, defect open |
| **WS-16 overall** | **COMPLETE** |

#### 32.29.9 What this closure does not touch

**WS-11.1 remains deferred. WS-12's future-separation-basis dependency remains
unresolved. The legacy `employee_skills` consolidation remains a separate Owner
Decision. Global Search remains a future approved safe navigation and discovery
capability that is not implemented (§31.40). The Office Inventory
delegate-validation defect, future delegation date ranges, and additional
delegation authority types all remain separately owned (§32.25).** None is
absorbed here.
