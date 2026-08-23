# Payroll — Discovery & Draft Implementation Plan

**Status: DISCOVERY / DRAFT ONLY. Not frozen. Not approved. No implementation has begun.**

This document is the output of a discovery-and-documentation-only workstream performed at the W121 checkpoint (Phase 1, Phase 2, and Phase 3 — including Phase 3H — all complete; see `PROJECT_STATUS.md`). It inspects the actual current repository state (not prior summaries), reconciles Ghana statutory rules against official sources, and proposes an architecture. **No migration was created, no application code was changed, no statutory figures were seeded into any database, Payroll was not enabled for any organization, and production was not touched.**

The next step is Owner Review and plan freeze — not implementation. Everything below is a proposal for that review, not a commitment.

---

## 1. Result

**Discovery complete.** The platform currently has **zero** payroll, compensation-structure, banking, statutory-calculation, payroll-journal, payment-batch, or payslip infrastructure of any kind. What exists is a deliberately-scoped set of *recruitment-time, unstructured* compensation fields that explicitly disclaim being a payroll structure, plus a rich set of reusable architectural patterns (effective-dated policy rows, org-scoped config namespaces, master-data domains, the module registry, the dedicated-report-route pattern, and the permission/RLS/audit model) that Payroll should build on rather than reinvent.

Ghana statutory reconciliation surfaced a **currency risk that must not be silently resolved by this document**: the GRA's own published PAYE band table is explicitly labelled *"effective from January 1st, 2024"* with no on-page confirmation that it still applies to a payroll period being run in 2026. This, and several other figures below, are flagged for Owner/legal/accounting confirmation rather than frozen.

---

## 2. Method & Reconciliation

Two independent tracks, performed together:

1. **Repository inspection** — direct `grep`/`glob`/file reads across `lib/db/src/schema/*`, `artifacts/api-server/src/lib/*`, `artifacts/api-server/src/routes/*`, `lib/api-spec/openapi.yaml`, `MODULES.md`, `DECISIONS.md`, `ROADMAP.md`, and every `docs/PHASE_*_IMPLEMENTATION_PLAN.md` — never trusting a prior workstream's own narrative summary where the source could be read directly.
2. **Ghana statutory reconciliation** — direct fetches of the GRA PAYE page (`gra.gov.gh/domestic-tax/tax-types/paye/`), the NPRA site (`npra.gov.gh`, including its FAQ and its own hosted "Guidelines for the payment of contributions" PDF), and cross-checked against several independent secondary sources, specifically to surface **disagreement between sources**, not to average it away.

Repository state confirmed clean before starting: `main == origin/main`, `git status` unchanged from the W121 checkpoint. This document itself is the only file created.

---

## 3. What Already Exists — Confirmed by Direct Inspection

### 3.1 Payroll-specific infrastructure: none

- No `payroll` key anywhere in `lib/db/src/seed/module-definitions.ts` (the module registry — currently exactly 8 modules: `recruitment`, `attendance`, `leave`, `performance`, `learning`, `asset_management`, `employee_self_service`, `manager_portal`).
- No payroll-named table, schema file, lib file, route file, or frontend page anywhere in the repository.
- No banking field (`bankAccount`, `bankName`, `routingNumber`, `accountNumber`, IBAN/SWIFT — searched all variants) anywhere in `lib/db/src/schema`.
- No SSNIT/social-security personnel number field on `employees` or anywhere else.
- No currency, exchange-rate, or multi-currency infrastructure beyond a single free-text `salaryCurrency` column on `job_requisitions` (recruitment-only, see below).
- `MODULES.md` §"Future Modules" already lists **Payroll, Benefits, Tax** as not-yet-built.
- `DECISIONS.md` **ADR-007**: *"Payroll is outside the scope of the initial HR foundation."* — an existing, standing architectural decision this discovery does not overturn; it only proposes how Payroll would eventually be added without violating it.

### 3.2 What looks payroll-adjacent but explicitly is not

- `lib/db/src/schema/offer-versions.ts` — `compensationSummary: jsonb`, with its own in-code comment: *"Recruitment-scoped fields only (base salary, currency, bonus, benefits summary) — never a full payroll/compensation structure (CLAUDE.md/§2 principle 7: no payroll dependency). Stored as-is, no internal shape enforced."* Unstructured, caller-supplied, never validated, never read by any calculation.
- `lib/db/src/schema/job-requisitions.ts` — `salaryRangeMin`/`salaryRangeMax` (`numeric(12,2)`) + `salaryCurrency` (`text`) — a **budgeted range for a vacancy**, not an employee's actual compensation. This is, however, the only place in the codebase that already establishes a money-column convention (`numeric(12,2)` + separate currency code) — worth reusing rather than inventing a second convention.
- `employees` table (`lib/db/src/schema/employees.ts`) — confirmed by full read: identity, contact, placement, and employment-status fields only. Zero compensation, banking, or statutory-identifier columns. This is a deliberate, already-audited boundary (Phase 3H's own W120 verification explicitly grepped for and confirmed the absence of speculative sensitive fields on this table).
- `artifacts/api-server/src/lib/preEmploymentRequirements.ts` — references cost only in the sense of a background-check vendor fee, unrelated to payroll.

### 3.3 Reusable architectural precedent (the actual foundation Payroll should sit on)

| Pattern | Where it already exists | Why it matters for Payroll |
|---|---|---|
| **Half-open effective-dated interval** (`validFrom` not-null, `validTo` nullable = "currently open"), resolved "as of a date" via a pure helper | `employee_number_allocations` + `pickAllocationAsOf()` (`artifacts/api-server/src/lib/numbering.ts`) | Exactly the shape statutory rule versioning needs: preserve the PAYE table that was in force when a payslip was actually run, even after rates change later. |
| **Effective-dated, scope-qualified policy rows** (`effectiveFrom`/`effectiveTo`, `status: active/inactive`, eligibility dimensions all nullable = "unscoped") | `leave_policies` (`lib/db/src/schema/leave-policies.ts`) | The template for organization-level payroll *policy* (as opposed to statutory *law*) — e.g. a company's own overtime policy, allowance eligibility, or pay-grade structure that can vary by branch/department/position and change over time without losing history. |
| **Append-only dated event log**, free-text `eventType`, `previousState`/`newState` JSONB | `employment_periods` | Candidate model for salary-change history (a raise, a one-off adjustment) if a lighter-weight approach than a dedicated compensation table is preferred — see §6.2 for the recommendation against this, in favor of a dedicated table. |
| **Org-scoped JSON config namespace**, versioned schema, audited on write | `organization_settings` (`numbering` namespace, W114) | The template for org-level Payroll settings — pay frequency, default currency, rounding rules, statutory jurisdiction selection — without a schema change per setting. |
| **Money column convention** | `job_requisitions.salaryRangeMin/Max` (`numeric(12,2)`) + `salaryCurrency` (`text`) | Reuse this precision/currency-column pair rather than inventing a second money convention. |
| **Module registry** (`status: hidden→active`, `defaultEnabled: false`, per-org opt-in via `organization_modules`) | `module-definitions.ts` | Exactly how Payroll must be added: platform-wide code existing is categorically separate from any organization (including WWM) having it enabled — see §14. |
| **Master-data domains** (`system-defined` / `organization-overridable` / `organization-defined`) | `master-data-definitions.ts` | Reusable for allowance types, deduction types, bank lists, pay-grade codes — new domains, not new bespoke tables, for anything that's really just a classification list. |
| **Dedicated-route reporting** (registered in the shared catalog for discoverability, executed only through a narrowly-permissioned dedicated route, never the generic runner) | `personnelReporting.ts`/`assetReporting.ts`/`learningReporting.ts` (ADR-016) | The template for payslip generation, statutory schedules, and journal exports — sensitive enough that "never the generic runner" matters even more here than it did for personnel records. |
| **Chained dual-permission middleware** (an action requiring two independently-held permissions, composed as two sequential `requirePermission` calls, no new merged permission minted) | Legacy import (`personnel_file.manage` + `employee_number.allocate`, W119) | The direct precedent for payroll maker-checker (see §8) — e.g. `payroll.run.approve` distinct from `payroll.run.create`, held by different people in practice even if the same role *could* hold both. |
| **RLS deny-by-default + application-layer authorization** | All 95 current public tables (fresh-queried in W120: 95/95 RLS-enabled, 0 policies) | Same model applies to every new payroll table without exception. |
| **Audit-events model** (full `beforeState`/`afterState` JSONB on every mutation, silent on reads) | `audit_events` | Directly reusable, with one open security question flagged in §15: today's convention stores full before/after state in plaintext JSONB — worth an explicit Owner Decision on whether payroll amounts need field-level treatment beyond RLS. |

---

## 4. Ghana Statutory Rules — Reconciled from Official Sources

**Framing, per explicit instruction: nothing below is frozen for use in a calculation engine merely because a current webpage states it. Each item records what was found, where, and its confidence — genuine gaps are flagged for Owner/legal/accounting confirmation, not guessed.**

### 4.1 PAYE (Income Tax Act, 2015 — Act 896)

Fetched directly from `gra.gov.gh/domestic-tax/tax-types/paye/`.

**Monthly bands, resident individuals** (as published on the page at fetch time):

| Band | Rate |
|---|---|
| First GH¢490 | 0% |
| Next GH¢110 | 5% |
| Next GH¢130 | 10% |
| Next GH¢3,166.67 | 17.5% |
| Next GH¢16,000 | 25% |
| Next GH¢30,520 | 30% |
| Exceeding GH¢50,000 | 35% |

**Annual bands, resident individuals:** First GH¢5,880 @ 0%, next GH¢1,320 @ 5%, next GH¢1,560 @ 10%, next GH¢38,000 @ 17.5%, next GH¢192,000 @ 25%, next GH¢366,240 @ 30%, exceeding GH¢600,000 @ 35%.

**Non-resident individuals:** flat 25% on chargeable income.

**⚠️ Effective-date flag (load-bearing, do not silently resolve):** the page states these rates *"took effect from January 1st, 2024."* This document was produced in 2026. The page carries **no visible confirmation that this table is still the applicable one for a payroll period being designed now** — Ghana's PAYE bands have historically been revised via the annual Budget Statement/Income Tax (Amendment) Act, and a 2024 label on a page fetched in 2026 is exactly the situation the user's own brief warned against treating as automatically current. **This must be confirmed against the current Income Tax (Amendment) Act / a tax advisor before any band is coded as a live default**, even though it should still be captured, dated, and effective-versioned in the schema exactly as published.

**Order of operations (confirmed on-page):** SSNIT (5.5% of basic salary) is deducted **before** PAYE is computed — i.e., PAYE is calculated on (gross taxable pay − SSNIT employee contribution), not on gross pay directly. This matches the user's own brief exactly and is treated as reconciled, not merely assumed.

**Allowances (confirmed on-page, included in taxable pay):** transport, accommodation, risk, night duty, responsibility, child education, house help, cook, and garden boy allowances.

**Benefits in kind (confirmed on-page):** monetized before inclusion — electricity, water, vehicle, and fuel benefits named explicitly. The exact monetization formulas (e.g. the standard percentage-of-salary basis Ghana uses for vehicle/fuel benefit) were **not** captured from this page and need a follow-up fetch/confirmation before being coded.

**Exemption (confirmed on-page):** employer discharge/reimbursement of dental, medical, or health-insurance expenses is excluded from taxable income **only** where the benefit is available to every full-time employee on equal terms — a conditional exemption, not a blanket one; the condition must be enforced in the calculation logic, not just documented.

**Bonus (confirmed on-page):** taxed at a flat 5% up to 15% of annual basic salary; any bonus amount **above** that 15%-of-annual-basic threshold is added to ordinary employment income and taxed at the graduated bands instead. ⚠️ Flag: the exact definition of "annual basic salary" for this test (current year to date? full annual rate annualized?) was not captured and needs confirmation.

**Overtime (confirmed on-page):** 5% flat rate where overtime pay does not exceed 50% of monthly basic salary; 10% on the portion exceeding that 50% threshold. ⚠️ Flag: Ghana's overtime concessionary rate has historically applied only to a specific category of "qualifying employee" (junior staff below a stated monthly basic-salary threshold), not universally to every employee — this qualification was **not** confirmed on the fetched page and must not be silently assumed either way; needs explicit confirmation.

**Reliefs:** the page references a "Personal Tax Relief" as a distinct, linked topic and a foreign-tax-credit deduction, but did not surface the actual relief categories/amounts (e.g. marriage/child/disability/aged-dependent/old-age reliefs commonly part of Ghana's system) on this fetch. **Not reconciled — flagged as an open item**, not guessed at.

**Legal basis:** Income Tax Act, 2015 (Act 896), confirmed by name on the GRA site itself.

### 4.2 Pensions — SSNIT (Tier 1) / Tier 2 / Tier 3 (National Pensions Act, 2008 — Act 766)

Reconciled across the NPRA site's FAQ, NPRA's own hosted "Guidelines for the payment of contributions" PDF, and independent secondary sources — deliberately cross-checked because the sources **did not agree with each other on first pass**, which is recorded here rather than smoothed over.

**Corroborated core figure (consistent across GRA's own page, the NPRA FAQ, and the user's own brief):** total mandatory pension contribution = **18.5% of basic salary**, split **5.5% employee-withheld + 13% employer-paid**. This matches the user's own already-stated confirmation and is treated as reconciled.

**Tier split — the more contested figure:** the most internally-consistent reading across sources is that the 18.5% total is **not** additional to a separate Tier 2 amount, but is itself divided: **13.5% to Tier 1 (SSNIT, government-managed, defined-benefit)** and **5% to Tier 2 (mandatory occupational, defined-contribution, managed by an NPRA-licensed corporate trustee)**, summing back to 18.5%.

**⚠️ Explicit disagreement found, not silently resolved:** the NPRA-hosted PDF, as extracted, described Tier 1 as 5.5%/13%/18.5% **and separately** Tier 2 as 5%/5%/10%, implying a combined 28.5% — which contradicts the "18.5% total mandatory" framing found everywhere else, including the user's own brief. The PDF extraction also cited the legal basis as "PNDC Law 247," which is very likely a conflation with Ghana's *earlier* (pre-2008) SSNIT law rather than the National Pensions Act, 2008 (Act 766) itself. **Both figures should be treated as unreliable pending direct confirmation against the Act's actual text or a qualified source (legal/accounting/NPRA directly)** — this discovery deliberately does not pick one interpretation and encode it. Flagged as **Owner Decision 4** below.

**Tier 3 (voluntary):** provident fund / personal pension, privately managed, tax-exempt up to a combined statutory ceiling (commonly cited across secondary sources as 16.5% of basic salary across Tiers 2+3 combined, deductible before PAYE) — **not independently confirmed from a primary NPRA page in this pass; flagged as open**, not encoded as fact.

**Contribution base:** "basic salary" is the consistently-used term across every source fetched — never gross pay, never total earnings. This has a direct product consequence: the compensation model must distinguish a structured "basic salary" component from every other earning component, since basic salary alone is the base for both SSNIT/pension and (per §4.1) the PAYE pre-deduction step.

**Remittance timing:** commonly cited elsewhere as 14 days after the end of the contribution month for SSNIT remittance, but **not independently confirmed from a primary source in this pass** — flagged as open.

**Ceiling/floor:** no explicit contribution ceiling or floor was found on any fetched page in this pass (unlike some jurisdictions' pension schemes). Flagged as open rather than assumed absent — the schema should support one anyway (see §7) since NPRA guidance elsewhere is known to reference maximum insurable/contribution thresholds that may not have surfaced in this pass's fetches.

**Employer pay-record expectation (directly relevant to product design):** NPRA's own regulatory framework contemplates employer payroll/pay records containing the relevant income and mandatory/voluntary contribution information per employee per period — this directly informs §11's audit/record-design requirement: the payroll record for a period must retain enough detail (gross pay, basic salary, each statutory contribution, each employer contribution) to reconstruct what NPRA/SSNIT would expect to see, not just a net-pay total.

### 4.3 What this reconciliation deliberately does NOT do

It does not freeze a single PAYE band table, a single Tier 1/Tier 2 split, a Tier 3 ceiling, a benefit-in-kind monetization formula, or a relief schedule into the proposed schema as a coded default. §7 proposes *where* these values would live (effective-dated, sourced, versioned) — not what today's authoritative values are. That confirmation is explicitly named as Owner Decisions 1–5 in §18.

---

## 5. Gap Matrix

| Area | Exists today | Gap |
|---|---|---|
| Payroll module registration | None | New `payroll` module key, `status: hidden`, `defaultEnabled: false` |
| Employee compensation (basic salary, allowances, other earning components) | None (only unstructured recruitment JSON) | New structured, effective-dated compensation model |
| Banking details (for payment, not for calculation) | None | New employee banking-details table, sensitive-permission-gated |
| Statutory identifiers (SSNIT number, TIN) | None on `employees` | New fields, likely on a Payroll-owned employee-extension table rather than the core `employees` table (see §14 boundary) |
| Payroll periods/calendars | None | New table: period definitions, org-configurable frequency |
| Statutory rule configuration (PAYE bands, SSNIT/Tier2 rates, reliefs) | None | New effective-dated rule-set tables, source-attributed |
| Deductions (statutory + voluntary) | None | New deduction-type master data + per-employee deduction records |
| Benefits in kind | None | New benefit-in-kind component type + monetization rule |
| Bonus/overtime taxation | None | Calculation-pipeline rules, sourced from §4.1, pending confirmation |
| Payroll run lifecycle (draft → calculated → approved → locked → paid) | None (closest precedent: Performance cycle's own draft→open→closed-ish lifecycle, and Personnel-File custody's state machine) | New state machine, reusing the same "controlled 400/409 on illegal transition" convention already proven in W116 |
| Payroll approvals / maker-checker | None (closest precedent: `requirePermission` chaining, W119) | New permission set enforcing segregation of duties |
| Locking/finalization | None (closest precedent: `employee_number_allocations`' half-open interval closes on release) | New "locked run" concept — once locked, immutable, corrections go through a reversal, never an edit |
| Corrections/reversals | None (closest precedent: Assets' maintenance-history append pattern; personnel-file movement history) | New append-only correction/reversal model, never destructive |
| Payslips | None | New generated artifact, per employee per run, historically reproducible |
| Payment batches | None | New table representing "this run, paid via this batch, on this date, by this method" |
| Statutory schedules/returns (PAYE monthly return / P9, SSNIT schedule) | None | New dedicated-route reports, per §12 |
| Accounting/journal outputs | None (no chart-of-accounts or GL concept anywhere in the platform) | New, and the largest genuinely open design question — see §18 Owner Decision 6 |
| Audit history for payroll | Platform-wide `audit_events` exists and is directly reusable | Only a security-treatment question (see §15), not a missing capability |
| Permissions | Platform-wide permission model exists and is directly reusable | New payroll-specific permission keys only |
| Historical reproducibility | Proven pattern exists (`employee_number_allocations`, Phase 3H) | Must be applied consistently to every payroll-facing figure, not just staff numbers |

---

## 6. Proposed Data Model (draft — not frozen)

All tables below would be additive, `organization_id`-scoped, RLS-enabled-with-zero-policies (same convention as every existing table), and would not touch `employees` beyond what's explicitly noted.

### 6.1 Module & configuration
- `payroll` module key in the registry (`status: hidden`, `defaultEnabled: false`), category either a new `financial-operations` or folded into the existing `hr-operations` — an Owner Decision (§18, Decision 7), not assumed.
- `organization_settings` namespace `"payroll"` — pay frequency (monthly/bi-weekly/weekly), default currency, statutory jurisdiction (fixed to Ghana for V1, but named as a field rather than hardcoded, matching CLAUDE.md's organization-neutrality principle), rounding rules — reusing the exact mechanism `numbering` already uses.

### 6.2 Employee compensation (new, dedicated — not `employment_periods`, not `compensationSummary`)
`employee_compensation_components` (or similar): one row per (employee, component type, effective period). Half-open `validFrom`/`validTo` interval, resolved as-of the relevant pay date — the exact `employee_number_allocations`/`pickAllocationAsOf` pattern, reused rather than reinvented. Component types (basic salary, transport allowance, accommodation allowance, etc.) come from a new master-data domain, not a hardcoded enum, so an organization's own allowance taxonomy is configurable per CLAUDE.md's "configuration before custom code" principle. Each component carries: amount, currency, taxable/non-taxable flag, statutory-treatment tag (ordinary income / benefit-in-kind / bonus / overtime — since §4.1 shows each is taxed differently), and a pointer to the `employees.id` this belongs to — never a staff/PIF number.

*Why a dedicated table instead of reusing `employment_periods`'s generic JSONB:* payroll calculation needs strongly-typed, queryable numeric amounts and per-component statutory tags to run a deterministic pipeline; `employment_periods` remains the right place for the *narrative* record ("salary changed on this date, approved by whom") but not for the calculation input itself.

### 6.3 Statutory rule configuration (effective-dated, source-attributed)
`payroll_statutory_rule_sets` (or split per rule family — PAYE bands / pension rates / reliefs — an open design question, §18 Decision 5): each row/table carries `effectiveFrom`/`effectiveTo` (half-open, same convention), a `sourceUrl`/`sourceDescription`/`sourceRetrievedAt` field (so every value in the system is traceable to where it came from and when it was captured — directly satisfying the brief's "record the source, legal/effective date and applicability" instruction as a schema-level guarantee, not just a document note), and an `confirmedBy`/`confirmedAt` field distinguishing a value that has been through Owner/legal/accounting sign-off from one that is merely staged from a document fetch. **No row would ever be inserted with real Ghana 2024/2026 figures during this discovery phase or its follow-on implementation until Owner Decision 1 (§18) is resolved.**

### 6.4 Banking & statutory identifiers
`employee_banking_details` — bank (from a new master-data domain), account number/name, branch — separate table, separately permissioned (`payroll.banking.read`/`payroll.banking.manage`), never merged into the core `employees` table (keeps `employees` organization-neutral and keeps banking data's blast radius small).
`employee_statutory_identifiers` (or fields on the banking table) — SSNIT number, TIN — same separation rationale.

### 6.5 Payroll periods, runs, lines
- `payroll_periods` — org-scoped, calendar-defined (monthly/etc.), start/end/pay dates.
- `payroll_runs` — one per (period, org), state machine (see §10), locked-at/finalized-at timestamps, approver chain.
- `payroll_run_lines` — one per (run, employee), snapshotting the employee's compensation *as resolved at calculation time* (not a live join) — the same "never a live cache, always a resolved-as-of snapshot" discipline Phase 3H already established for staff numbers, applied here to salary.
- `payroll_run_line_components` — the itemized breakdown per line (gross, each earning, each deduction, PAYE, SSNIT, Tier 2, net) — this is what payslips and statutory schedules are generated from.

### 6.6 Payment & correction
- `payroll_payment_batches` — one per (run, payment method/date), referencing banking details resolved at that time.
- `payroll_corrections` — append-only, referencing the original run/line, never overwriting it; a correction produces a new, separately-approved adjustment, mirroring the personnel-file movement-history / employee-number-allocation "never mutate history, always append a new dated record" convention already proven twice in this platform.

### 6.7 Payslips
Generated read-model rows (or generated-on-demand from `payroll_run_line_components`, an open design question — §18 Decision 8) — either way, must resolve the employee's identifier **as it was at that pay period**, via the same historical-resolution discipline as every other Phase 3H report, never a live `employees.employeeNumber` join.

---

## 7. Statutory-Rule Model (summary — detail folded into §6.3)

- Every statutory parameter (PAYE band table, Tier 1/Tier 2 rates, Tier 3 ceiling, reliefs, benefit-in-kind monetization formulas) is a **versioned, effective-dated, source-attributed row**, never a hardcoded constant.
- Resolution is always "as of the pay date of the period being calculated," using the same half-open-interval pattern already proven for staff numbers — guaranteeing that a payslip run in 2027 under new rates never silently recalculates a 2026 payslip differently.
- No row is considered "live/usable by the calculation engine" until it carries a `confirmedBy` sign-off — separating "staged from a document fetch" from "approved for use," directly addressing the brief's core instruction not to freeze a value merely because a page currently shows it.

---

## 8. Permission & Segregation-of-Duties Model (draft)

Following the existing `<resource>.<action>` convention and the W119 chained-dual-permission precedent, proposed **new, payroll-only** permission keys (none reusing or broadening any existing `employee.*` permission):

- `payroll.compensation.read` / `payroll.compensation.manage` — salary/allowance data.
- `payroll.banking.read` / `payroll.banking.manage` — banking details, deliberately separate from compensation so a preparer can see pay components without seeing bank accounts, or vice versa, if the organization wants that split.
- `payroll.statutory_config.manage` — who may edit statutory rule sets (almost certainly a very small group, likely distinct from ordinary HR admin).
- `payroll.run.prepare` (create/calculate a draft run) — the "maker."
- `payroll.run.approve` (move a run from calculated to approved) — the "checker," structurally distinct from `prepare`, mirroring the legacy-import dual-permission-chain precedent so a single person cannot both prepare and approve unless deliberately granted both.
- `payroll.run.lock` / `payroll.run.reverse` — finalization and correction, likely their own permissions again, for the same maker-checker reason.
- `payroll.report.read` — statutory schedules and reports, dedicated-route-gated exactly like every existing Phase 3H report.
- `payroll.payslip.read.own` — the employee's own payslip, via Employee Self Service, following the exact `leave_request.read.own`/personnel-records own-resource-only precedent.

**Segregation of duties is enforced the same way W119 enforced it**: by requiring two independently-held permissions on the sensitive transition routes (e.g. `POST .../payroll-runs/:id/approve` chains `payroll.run.approve` and could additionally require the actor differ from the run's own preparer — an Owner Decision, §18 Decision 3, since the platform has no existing "different actor" enforcement precedent to reuse and this would be new logic).

Crucially: **none of these permissions would be granted to any existing role by default.** Org-level payroll access is a deliberate, explicit act, exactly like every other Phase 3H permission — holding `hr_manager` or `personnel_file.manage` grants nothing here.

---

## 9. Calculation Pipeline (draft, conceptual)

For each `payroll_run_line` (one employee, one period):

1. Resolve compensation components as-of the period's pay date (§6.2).
2. Sum earnings into gross pay; separately isolate basic salary (needed as the base for step 3, per §4.2's confirmed "basic salary," not gross).
3. Compute SSNIT/Tier 1 + Tier 2 employee deductions from basic salary (5.5%, pending §18 Decision 4 on the Tier 1/Tier 2 split) — deducted before PAYE, per §4.1's confirmed order.
4. Compute taxable income = gross earnings (with each component's taxable/non-taxable/benefit-in-kind/bonus/overtime tag applied per its own §4.1 treatment) − SSNIT employee deduction − any confirmed reliefs.
5. Apply the effective-dated PAYE band table (§6.3) resolved as-of the pay date.
6. Apply bonus/overtime special-rate treatment (§4.1) to the relevant components rather than folding them into the graduated calculation, per the confirmed rule.
7. Compute employer-side contributions (SSNIT/Tier 2 employer 13%, pending the same §18 Decision 4 confirmation) — a cost to the organization, not a deduction from the employee, but still required for the statutory schedule and (if built) the journal output.
8. Assemble net pay = gross − all employee deductions (statutory + voluntary).
9. Persist every intermediate figure on `payroll_run_line_components` (§6.5) — never just the net-pay total — directly satisfying NPRA's own expectation (§4.2) that employer pay records retain the relevant income and contribution detail per employee per period.

This is a calculation **shape**, not a frozen formula — every rate/band/threshold it references comes from §6.3's versioned configuration, not a constant in this document.

---

## 10. Payroll Lifecycle (draft)

Proposed state machine for `payroll_runs`, enforced the same way personnel-file custody enforces its own state machine (controlled 400/409 on any illegal transition, never a silent no-op):

`draft → calculated → approved → locked → paid`, with `locked` being the point past which no line may be edited — only a `payroll_corrections` row (§6.6) may adjust a locked run's effective outcome, exactly mirroring how a released staff number is never edited in place, only superseded by a new dated allocation.

A run may be **cancelled** only while still `draft` or `calculated` (never once `approved`, matching the same "you can't casually undo a decision that's already been checked" principle segregation-of-duties exists to protect).

---

## 11. Correction / Reversal Model (draft)

- Never overwrite a locked line. Every correction is a new, dated, separately-approved row referencing what it corrects — the same discipline already proven twice (personnel-file movements, employee-number allocations).
- A correction that changes net pay produces its own payment-batch implication (either a supplementary payment or a deduction from a future run) — modeled explicitly, never inferred silently.
- Every correction is audit-logged with both the original and corrected figures in `beforeState`/`afterState`, exactly like every other Phase 3H mutation.

---

## 12. Proposed Reports & Statutory Outputs (draft)

Following the exact dedicated-route pattern (registered in the shared catalog for discoverability, executed only through a narrowly-permissioned dedicated route — never the generic runner, which would 404 for these keys just as it already does for every Phase 3H report):

- Payroll Register (per run, all employees, full component breakdown).
- Payslip (per employee, per run — also exposed to the employee via ESS under `payroll.payslip.read.own`).
- PAYE monthly return / GRA schedule (the P9-equivalent implied by §4.1's filing-requirement mention).
- SSNIT contribution schedule (Tier 1).
- Tier 2 contribution schedule, per licensed trustee (since Tier 2 is privately managed, the schedule likely needs a trustee identifier — a new master-data item, not assumed here).
- Payment batch summary (bank-file-ready, format TBD — an Owner Decision, since no payment-rail integration exists anywhere in the platform today).
- Historical/as-of reports mirroring Phase 3H's own Current-vs-Historical report pair, so a payslip or schedule for a past period always resolves the employee identity and figures as they stood then — never a live re-calculation.

---

## 13. Interaction With Existing HR Foundations

- **`employees.id` remains the sole identity.** Every payroll table references it, never a staff number or PIF number.
- **Staff-number reuse must never transfer payroll history.** The exact reused-number scenario Phase 3H proved twice (W119, W120) applies identically here: if employee A's staff number is later reused by employee B, every historical payslip, payroll-run line, and statutory schedule row for A must continue to resolve to A's own `employees.id`, and must display A's *historical* staff number (resolved as-of that pay date via the same `pickAllocationAsOf` mechanism), never B's current one.
- **Separation** should close out compensation components (a `validTo` on the relevant rows) but must not itself trigger a payroll action — matching the existing non-blocking-warning-only precedent (personnel-file/asset separation warnings never auto-act); a final/pro-rated pay run remains a deliberate HR/Payroll action.
- **Employment periods** (transfers/promotions/confirmations) may *inform* a compensation change (e.g. a promotion typically comes with a raise) but must never *silently* produce one — any link between an employment-period event and a compensation change should be as explicit and optional as W117's own `probationReviewId` linkage: recorded, never inferred.
- **Attendance and Leave** may supply proration/deduction inputs (unpaid leave days, overtime hours) **only where explicitly approved** per an Owner Decision (§18 Decision 2) — Payroll must not silently reach into Attendance/Leave data and assume a financial consequence; any such input would be an explicit, named integration point, not an implicit join.
- **Probation/Performance** have no proposed payroll linkage at all in this draft — out of scope unless an Owner Decision adds one later.

---

## 14. Organization-Isolation / WWM Boundary

Building Payroll platform-wide changes nothing for any existing organization by itself — this is the same guarantee already proven for every other module in this platform (W114–W120's own repeated live verification that enabling a module or shipping its code never auto-grants access): the `payroll` module would ship `status: hidden` and `defaultEnabled: false`, requiring a deliberate `organization_modules` row before any organization — including WWM — can use it at all. WWM's HR admin holding `personnel_file.manage`/`employee_number.allocate`/other existing Phase 3H permissions confers **zero** payroll authority, since every proposed payroll permission (§8) is new and would not be auto-granted to any existing role. This discovery does not enable Payroll for WWM and proposes that no follow-on workstream do so either without a separate, explicit decision.

---

## 15. Security Considerations

- RLS deny-by-default + application-layer authorization applies identically to every new table — no exception proposed.
- **Open question (Owner Decision 9, §18):** today's `audit_events` convention stores full `beforeState`/`afterState` as plaintext JSONB, readable by anyone with audit-read access. For payroll, that would include salary figures and (if `employee_banking_details` mutations are audited the same way) bank account numbers. Every other sensitive-data category in this platform (national ID, passport number) already goes through the identical unencrypted-JSONB audit convention today, so this isn't a new gap Payroll introduces — but the *quantity and sensitivity* of financial data payroll would add makes it worth an explicit sign-off rather than silently inheriting the existing convention.
- Banking-details read access should default to a narrower group than general payroll-compensation read access (§8) — a preparer does not automatically need to see bank account numbers to run a calculation.
- Statutory rule-set edit access (`payroll.statutory_config.manage`) should be held by very few users — a misconfigured PAYE band table has organization-wide, historically-compounding consequences.
- File/export outputs (payment-batch bank files, statutory schedules) will contain bulk PII/financial data — storage/retention/download-audit treatment is an open question, not yet designed (§17).

---

## 16. Migration Estimate (rough order of magnitude, not a commitment)

Based on Phase 3H's own actual delivered scale (6 workstreams, 4 migrations, ~10 new tables, 4 new permissions, 5 reports, 1 importer) as the nearest comparable unit of work, a Ghana-statutory-only V1 Payroll (compensation model, statutory rule config, run lifecycle, payslips, the 2–3 statutory schedules named in §12, no journal/GL, no payment-rail integration) is estimated at **roughly 8–12 workstreams and 6–10 migrations** — meaningfully larger than any single prior phase, because it combines a new structured compensation model, a new effective-dated statutory-configuration engine, a full approval/locking/correction lifecycle, and multiple statutory outputs, none of which have any existing partial implementation to build on (unlike, say, Phase 3H's own reporting layer, which reused four already-shipped workstreams' data). This is a planning-order estimate for Owner Review, not a workstream breakdown commitment.

---

## 17. Explicit Deferrals

Confirmed, by direct grep of the full codebase, that none of the following exist today and none are proposed as part of this discovery's V1 scope:

- **QR codes / barcodes** — no scanning/identification mechanism proposed for payroll (consistent with Phase 3H's own repeated, explicit deferral of the same).
- **Stocktaking** — not applicable to payroll; noted only because it's a standing platform-wide deferral category from Phase 3H, carried forward unchanged.
- **Broad automatic filing** — no automatic document-filing behavior proposed; any payslip/schedule storage would be an explicit, permissioned action.
- **General ledger / chart-of-accounts / accounting journal integration** — the single largest open item: this platform has **no existing accounting/GL concept anywhere**, so "journal outputs" (named in the user's own brief as something to inform the audit/record design) is scoped in this draft only as far as *what data a journal export would need* (§6.5's itemized components), not as a built integration to any specific accounting system. Proposed as fully deferred pending a separate Owner Decision on which accounting system(s), if any, need direct integration versus a generic export.
- **Payment-rail integration** (bank-file formats, mobile-money disbursement, etc.) — deferred; §12 proposes only a generic payment-batch summary shape, not a specific bank integration.
- **Multi-jurisdiction/multi-country statutory support** — this draft is Ghana-only for V1; the schema is *named* organization-neutrally (a `jurisdiction` field rather than a hardcoded assumption) per CLAUDE.md's core principle, but no second country's rules are researched or scoped here.
- **Benefits (health insurance, other non-statutory benefits administration)** — `MODULES.md` already lists this as a separate future module; not folded into Payroll V1.
- **Tax module beyond PAYE** (corporate tax, VAT, withholding tax on non-employment payments) — out of scope; `MODULES.md` lists "Tax" as its own separate future item.
- **SSNIT self-service / member-facing anything** — out of scope; this is an employer-side payroll system, not a SSNIT member portal.

---

## 18. Owner Decisions Requiring Approval (before any implementation workstream begins)

1. **PAYE band table currency** — confirm whether the GRA table found (labelled "effective from January 1st, 2024") remains the applicable table for the payroll periods this system needs to support, or obtain the current one, before any band is coded even as a seed default. (§4.1)
2. **Attendance/Leave → Payroll input scope** — which specific Attendance/Leave data points (if any) are approved as payroll calculation inputs (e.g. unpaid-leave proration, overtime hours), and whether that link is per-organization-configurable or platform-fixed. (§13)
3. **Maker-checker "different actor" enforcement** — whether `payroll.run.approve` must be enforced as a *different individual* from the run's preparer (new logic, no existing precedent), or whether holding the permission is sufficient, matching every other existing dual-permission precedent's behavior. (§8)
4. **Tier 1 / Tier 2 exact split, ceiling, and Tier 3 treatment** — resolve the explicit disagreement found in §4.2 (13.5%+5%=18.5% vs. an 18.5%+10%=28.5% reading) against a primary/legal source before any pension rate is coded even as a seed default; confirm the correct Act citation (Act 766) independently of the one unreliable extraction found. (§4.2)
5. **Statutory rule-set granularity** — one unified `payroll_statutory_rule_sets` table versus separate tables per rule family (PAYE bands / pension rates / reliefs / benefit-in-kind formulas). (§6.3)
6. **Accounting/journal integration scope** — whether V1 needs a real GL/journal integration to a named accounting system, a generic structured export only, or is fully deferred to a later phase. (§17)
7. **Payroll module category** — new `financial-operations` module category, or folded into the existing `hr-operations` category. (§6.1)
8. **Payslip generation model** — generated-and-stored artifact per run vs. generated-on-demand from `payroll_run_line_components`. (§6.7)
9. **Payroll audit sensitivity treatment** — accept the existing platform-wide unencrypted-JSONB `audit_events` convention for salary/banking data as-is, or introduce field-level treatment specific to payroll. (§15)
10. **Reliefs, benefit-in-kind monetization formulas, Tier 3 ceiling, SSNIT remittance timing, contribution ceiling/floor** — each individually flagged as "not independently confirmed from a primary source in this pass" in §4.1–4.2 and needs a dedicated follow-up reconciliation pass (or direct legal/accounting sign-off) before being encoded anywhere, even as a seed default.

---

## 19. Proposed Implementation Workstreams (draft sequencing, pending Owner Decisions above)

Not a commitment — sequencing only, mirroring Phase 3H's own workstream-by-workstream, gated discipline:

1. **Payroll Foundation** — module registration (hidden), permissions, `organization_settings` `"payroll"` namespace, statutory rule-set tables (schema only, no seeded values pending Decision 1/4/5).
2. **Employee Compensation** — `employee_compensation_components`, effective-dated, master-data-driven component types.
3. **Banking & Statutory Identifiers** — `employee_banking_details`, `employee_statutory_identifiers`, separately permissioned.
4. **Payroll Periods & Calculation Engine** — periods, the calculation pipeline (§9), draft-run generation only (no approval/locking yet).
5. **Approval, Locking & Segregation of Duties** — the full run lifecycle (§10), permission enforcement (§8), pending Decision 3.
6. **Corrections & Reversals** — §11.
7. **Payslips & Employee Self Service Exposure** — §6.7, §12's payslip report, `payroll.payslip.read.own`.
8. **Statutory Schedules & Reports** — PAYE return, SSNIT/Tier 2 schedules, dedicated-route reports per §12.
9. **Payment Batches** — §6.6, generic payment-batch summary only (payment-rail integration explicitly deferred, §17).
10. **Verification** — a Phase-3H-style dedicated verification workstream (integrated live QA, concurrency QA on run-locking, historical-reproducibility proof under a compensation change, tenant isolation, WWM-still-disabled confirmation) before any completion report.

Each would require its own explicit go-ahead, exactly as every Phase 3H workstream did.

---

## 20. Boundary

**STOP after this document.** No migration was created. No application code was changed. No Ghana statutory figures were seeded into any database. Payroll was not enabled for WWM or any organization. Production was not touched. The next step is Owner Review and plan freeze — not implementation — per the explicit instruction this discovery was scoped under.
