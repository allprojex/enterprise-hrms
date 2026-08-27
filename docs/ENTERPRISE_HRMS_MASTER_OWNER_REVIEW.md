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
| Employee documents (checklist) | PARTIAL/MISSING | Now folded under OD #4 |
| Statutory/SSNIT handling | COMPLETE, permission-gated + audited | Field-level masking now **P1** per OD #23 |
| Handbook/policy acknowledgement | MISSING | Zero "handbook" hits anywhere |
| Job description | CONFIGURATION-ONLY | Lives only on transient `vacancies` |
| Induction/orientation | MISSING, deliberately descoped historically | — |
| ESS activation | COMPLETE as mechanism; no onboarding-completion gate | No such signal exists anywhere |
| Onboarding workflow/checklist | MISSING | No task/checklist engine anywhere |
| Probation | PARTIAL, more built than assumed | Real `confirmEmployee()` mechanism; no duration engine, no extension-as-event |
| Probation review | Linked to Performance correctly | — |

**Genuine platform gaps** (ranked, unchanged): (1) publication-free candidate capture; (2) offer acceptance/decline; (3) onboarding checklist engine; (4) induction; (5) handbook acknowledgement; (6) document generation (unblocks #1's Ghana-compliance dimension, #5, and all §31 HR Letters); (7) candidate-source configurability; (8) employee-document checklist; (9) multi-step approval chains; (10) offer particulars for Ghana Schedule I; (11) `reportingManagerId` not carried through conversion; (12) field-level masking on SSNIT/TIN/bank details (**now P1**, OD #23).

**Do not rebuild**: employee numbering engine, PIF/personnel-file model, candidate→employee conversion path, probation/confirmation mechanism, probation-review-Performance linkage, statutory identifiers, Recruitment's stage/pipeline architecture, Assets/Office Inventory custody, Separation/exit architecture.

> **→ See §25 — WS-9 Workstream Scope Clarification (2026-08-27).** The Recruitment slice of the gap list above (publication-free capture, offer accept/decline, source configurability, the approval-chain question, and Schedule 1 particulars) left several implementation questions genuinely open — most consequentially whether multi-step approval chains should be built at all, and whether offer status should gate conversion. The Owner has recorded a dedicated scope clarification for WS-9. §25 is the authoritative scope for that workstream; the classifications in this section are unchanged by it.

---

## 7. Employee Lifecycle Extensions (§23–§36) — Owner Decisions Recorded

| # | Capability | Discovery Classification | Owner Decision | Approved disposition |
|---|---|---|---|---|
| 23 | Training & Development | ALREADY IMPLEMENTED as Learning module | — (no OD needed) | Unchanged; dev-plans layer remains P3 |
| 24 | Skills / Competencies | ALREADY IMPLEMENTED (base) | **OWNER DECISION #5 — APPROVED FOR ROADMAP, P2.** Do not defer indefinitely. Support skills inventory, competency frameworks, role competencies, proficiency, assessment, gaps, development linkage, Recruitment linkage, Succession linkage. Organizations may choose whether to enable/use it. | Firmed onto the P2 roadmap, not left open-ended |
| 25 | Career & Internal Mobility | ALREADY IMPLEMENTED (permanent transfers) | **OWNER DECISION #6 — APPROVED FOR ROADMAP, P2.** Reuse `employment_periods` architecture. Support effective-dated acting appointments, secondments, temporary assignments. Sequence after the scheduling/notification foundation. | Approved, sequencing condition set explicitly |
| 26 | Succession / Talent | GENUINELY MISSING (internal-employee sense) | **OWNER DECISION #7 — APPROVED FOR ROADMAP, P2.** Do not treat existing Talent Pools as automatically equivalent to Succession. Preserve existing capability (recruitment Talent Pools, unchanged). Add Succession only for genuinely missing concepts: critical roles, successors, readiness, development gaps, succession plans. Avoid duplication. | Approved; naming/scope confusion explicitly resolved |
| 27 | Contract / Employment Term Mgmt | PARTIAL | **OWNER DECISION #8 — APPROVED.** Reuse `employment_periods`/existing employment-history infrastructure. Support expiry, renewal, extension, amendment, reminders, historical integrity. | Approved unchanged |
| 28 | Employee Relations / Grievance | PARTIAL (disciplinary log only, no grievance) | **OWNER DECISION #9 — APPROVED.** Disciplinary cases and grievances are distinct business concepts. May share document infrastructure, evidence infrastructure, security primitives, audit — but must not be conflated into one record type. | Approved unchanged; confirms two separate schemas |
| 29 | Employee Welfare | GENUINELY MISSING | — (no OD; brief instructs no medical records) | Unchanged, P3 |
| 30 | Benefits | GENUINELY MISSING | — (no OD) | Unchanged, P2/P3, must not duplicate compensation components |
| 31 | HR Letters | GENUINELY MISSING (root cause: no document generation) | Owned by OD #4 | Unchanged, P1 |
| 32 | HR Service Requests | GENUINELY MISSING as generic mechanism | **OWNER DECISION #10 — APPROVED WITH CHANGE.** Do not build every simple HR request as an unrelated implementation. Design a configurable shared HR Service Request foundation for suitable requests (employment letter, document request, HR inquiry, simple organization-defined requests). Where a request has specialized domain behavior, approvals, or legal/business logic, keep the specialized domain workflow. Do not create a giant generic workflow engine. | **Changed** from "per-type, following precedent" to a hybrid: shared foundation for simple/generic requests, specialized workflow preserved where warranted |
| 33 | Employee Data Change Approval | GENUINELY MISSING | **OWNER DECISION #11 — APPROVED.** Use a proven request/approval shape. Sensitive fields must be configurable. Preserve requested value, previous value where appropriate, verification, approval/rejection, effective update, actor, timestamps, audit/history. | Approved unchanged |
| 34 | Offboarding / Clearance | PARTIAL (thin) | **OWNER DECISION #12 — APPROVED.** Build structured clearance integrated with authoritative owning modules (Assets, Office Inventory, Personnel Files/Documents, IT/access, department clearance, HR, Payroll handoff). Do not duplicate those modules' records. | Approved unchanged |
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
| Workflow/Approval primitive | Partial | | | | **P2 — APPROVED (OD #14)**, authority-resolver only |
| Delegation/Acting Authority | Y (1 module) | | | | **P2 — APPROVED (OD #15)**, generalize |
| Global Search / Employee 360 | Partial | | Y | | P2/P3 |
| HR Action Centre | N | | | | P1 |
| ESS | Y | Y | | | — |
| Manager/Department Head | Y | | Y | | P2 |
| Reporting/Analytics | Y | | Y (CSV hardening gap) | | P1 (CSV fix), P3 (rest) |
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
| WS-15 | Cross-Module Visibility | **P1/P2** | Employee 360 completion, HR Action Centre (org-wide), Manager Portal recruitment-participation source, Reporting execution consolidation | WS-6 | — |
| WS-16 | Workflow/Delegation Primitive Generalization | **P2** | Generalize Office Inventory's delegation table, extract authority-resolver | WS-3 (light) | OD #14, #15 |
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
| 14 | Shared Approval Primitive | **APPROVED** | P2 | Restrained: shared authority-resolution/delegation only, never a giant generic workflow engine replacing working domain flows. |
| 15 | Delegation | **APPROVED** | P2 | Generalize the proven Office Inventory delegation concept; sequence with #14; remain effective-dated/scoped/revocable/auditable. |
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
