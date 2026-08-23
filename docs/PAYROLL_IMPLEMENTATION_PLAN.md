# Payroll — Owner Review, Statutory Reconciliation & Plan Freeze

**FROZEN — APPROVED FOR IMPLEMENTATION**

*(architecture and workstream sequence are frozen; unresolved statutory **numeric values** are explicitly named below and remain unseeded pending confirmation — see §5)*

This document supersedes `docs/PAYROLL_DISCOVERY_REPORT.md` as the authoritative plan. The discovery report remains in the repository as the historical record of how this plan was derived; where the two disagree, this document governs. **No migration was created, no application code was changed, no statutory figures were seeded, Payroll was not enabled for any organization, and production was not touched in producing this document.**

---

## 1. Result

Every material, resolvable Owner Decision from the discovery report has been resolved at the **architecture** level, using the directions in the Owner Review prompt, repository evidence, and further statutory research. Two genuine statutory-numeric questions remain **partially** open even after this reconciliation pass (a pending 2026 Income Tax Amendment Bill of unknown content, and several unconfirmed secondary parameters — minimum insurable earnings, Tier 3 ceiling, relief schedule, benefit-in-kind monetization formulas) — these are named explicitly in §5 and are **not** frozen as numeric defaults; the architecture is frozen to support seeding them once confirmed. The plan is approved for implementation on that basis.

---

## 2. Repository Reconciliation

Performed fresh, not trusted from the discovery report's own prose:

- `git fetch origin` + `git rev-parse HEAD main origin/main` — all three identical at `2b2f3e6` (the discovery commit). No drift, no uncommitted payroll-related change.
- `git status --short` — identical to the state at the end of the discovery workstream (the same pre-existing, unrelated untracked/modified items from session start; nothing payroll-related).
- Migration ledger (`lib/db/drizzle/meta/_journal.json`) re-read directly — still ends at `idx: 44, tag: "0044_graceful_starhawk"`. No `0045`.
- `grep -ril "payroll" lib/db/src/schema lib/db/drizzle` — the only match is `offer-versions.ts`'s already-known, already-disclaimed `compensationSummary` field. **No payroll table, migration, or partial implementation exists anywhere.**
- `DECISIONS.md` ADR-007 re-read directly: *"Payroll is outside the scope of the initial HR foundation."* — unchanged, still standing; this plan does not overturn it, it defines how Payroll would be added consistently with it.
- `MODULES.md` "Future Modules" list re-confirmed: Payroll, Benefits, Tax — unchanged.
- `ROADMAP.md` Phase 3 (8 items) and Future Expansion tier re-confirmed unchanged; Payroll sits under Future Expansion, not the current Phase 3 list.
- **No material contradiction found between the discovery report and current repository fact.** This session proceeds to statutory reconciliation and plan freeze rather than stopping.

---

## 3. Statutory Sources Checked

Prioritized in this order, per the Owner Review instruction:

1. **GRA** — `gra.gov.gh/domestic-tax/tax-types/paye/` (fetched directly).
2. **SSNIT** — `ssnit.org.gh` and `ssnit.org.gh/faqs/` (direct fetch attempted; both returned a tooling-level fetch error — "Invalid header value" — not a content failure; SSNIT's own content was instead recovered via a targeted search that surfaced and quoted SSNIT's own site text and SSNIT's own hosted Public Notice PDF (`ssnit.org.gh/wp-content/uploads/.../SSNIT-Public-Notice*.pdf`) by title and citation).
3. **NPRA** — `npra.gov.gh`, `npra.gov.gh/faq/`, and NPRA's own hosted "Guidelines for the payment of contributions" PDF (fetched directly).
4. **Legislation** — Income Tax Act, 2015 (Act 896); Income Tax (Amendment) (No. 2) Act, 2023 (Act 1111); National Pensions Act, 2008 (Act 766), §63(3) — identified by citation through the above official sources, not independently fetched as raw statute text in this pass (flagged where that distinction matters, §5).

Secondary sources (tax/payroll blogs, calculators, accounting-firm guides) were used **only** to cross-check for agreement/disagreement across independent sources when a primary fetch was incomplete or failed — never as sole authority, per the explicit instruction. Every figure below states which category it came from.

---

## 4. Ghana Statutory Findings

### 4.1 PAYE (Income Tax Act, 2015 — Act 896; bands per Income Tax (Amendment) (No. 2) Act, 2023 — Act 1111)

**Bands (from GRA's own page, confirmed a second time by direct fetch in this session):**

| Monthly band | Rate | Annual band | Rate |
|---|---|---|---|
| First GH¢490 | 0% | First GH¢5,880 | 0% |
| Next GH¢110 | 5% | Next GH¢1,320 | 5% |
| Next GH¢130 | 10% | Next GH¢1,560 | 10% |
| Next GH¢3,166.67 | 17.5% | Next GH¢38,000 | 17.5% |
| Next GH¢16,000 | 25% | Next GH¢192,000 | 25% |
| Next GH¢30,520 | 30% | Next GH¢366,240 | 30% |
| Exceeding GH¢50,000 | 35% | Exceeding GH¢600,000 | 35% |

Non-resident individuals: flat 25%.

**Currency reconciliation (this session's genuine progress over the discovery pass):** GRA's own page still labels this table "effective from January 1st, 2024" (Act 1111). In this session, **multiple independent sources dated 2026** (not one blog — cross-checked across several unrelated tax-guide and payroll-compliance sites) were found to **still cite the identical table** as currently applicable, which is convergent evidence the 2024 bands remain in force. **However**, search also surfaced that an **Income Tax (Amendment) Bill, 2026 was scheduled for a legislative reading on 23 July 2026, with its contents not available** in any source checked, and that GRA is separately reported to be conducting "a comprehensive review of income-tax legislation" with a stated completion target of mid-2027. **Conclusion: the 2024/Act 1111 bands are the best-evidenced currently-applicable table, but a pending amendment of unknown content exists. This is not resolved to numeric certainty and must not be treated as such — see Owner Decision 1 (§6).**

**SSNIT-before-PAYE order of operations:** confirmed directly on the GRA page — SSNIT (employee's 5.5% of basic salary) is deducted before PAYE is computed.

**Allowances taxed as ordinary income (confirmed on-page):** transport, accommodation, risk, night duty, responsibility, child education, house help, cook, garden boy.

**Benefits in kind (confirmed on-page, not re-derived further this pass):** monetized before inclusion; electricity, water, vehicle, fuel named explicitly. **Exact monetization formulas not found in any fetch this pass — remains open, §5.**

**Conditional exemption (confirmed on-page):** employer-paid dental/medical/health-insurance reimbursement is exempt **only** where offered to every full-time employee on equal terms.

**Bonus (confirmed on-page):** flat 5% up to 15% of annual basic salary; excess folds into graduated income tax.

**Overtime (confirmed on-page):** 5% flat where overtime does not exceed 50% of monthly basic salary; 10% on the excess. **The "qualifying employee" threshold nuance flagged in the discovery report was not resolved further this pass — remains open, §5.**

**Reliefs:** not resolved this pass beyond confirming the category exists (personal tax relief, foreign tax credit) — **remains open, §5.**

### 4.2 SSNIT / Tier 1 / Tier 2 (National Pensions Act, 2008 — Act 766)

**This session materially advances the discovery report's unresolved conflict.** Re-fetching NPRA's PDF and cross-checking against SSNIT's own site content (recovered via search after a direct-fetch tooling error) and GRA's page, the convergent, now-internally-consistent reading is:

- **Total mandatory contribution: 18.5% of basic salary** — **5.5% employee** (withheld) + **13% employer** (paid on top of wages).
- Of the 18.5% total, **13.5% is remitted to SSNIT for Tier 1** (the mandatory Basic National Social Security Scheme, defined-benefit, government-managed) and **5% is passed to the employee's Tier 2 fund manager** (mandatory occupational scheme, defined-contribution, privately managed by an NPRA-licensed trustee).
- **Remittance deadline: within 14 days of month-end**, corroborated independently twice.
- **Legal basis: National Pensions Act, 2008 (Act 766).** The earlier discovery-pass PDF extraction's citation of "PNDC Law 247" is treated as an extraction error/conflation with an earlier, superseded pre-2008 SSNIT law, not a genuine alternative citation — dismissed on the strength of every other source in this and the prior pass consistently naming Act 766.

**This reading is treated as resolved with moderate-to-high confidence** (convergent across GRA, SSNIT's own site content, and multiple independent secondary sources, replacing the single outlier "28.5%" reading found in the discovery pass, which is now attributed to a PDF-extraction error rather than a genuine second interpretation). **It has not been independently verified against the raw text of Act 766 itself** — recommend a final legal/accounting sign-off before the first live payroll run, but this is no longer treated as an unresolved conflict between equally-plausible readings. See Owner Decision 4 (§6).

**Genuinely new finding this session — maximum insurable earnings:** SSNIT publishes an **annual Public Notice** setting the maximum (and, per the notice's own title, minimum) insurable earnings ceiling — e.g. "Public Notice 11 JAN 2023 — Maximum and Minimum Insurable Earnings for 2023," hosted directly on `ssnit.org.gh`. For the years found in this pass: **GHS 61,000/month for 2025, raised to GHS 69,000/month effective 1 January 2026**, per multiple 2026-dated news sources citing SSNIT's own announcement and Act 766 §63(3) (which mandates periodic review). **This was recovered via secondary reporting of SSNIT's own notice, not by directly fetching the 2026 notice PDF itself in this pass — flagged for direct primary confirmation before go-live, §5.** This finding is significant beyond its numeric value: **it is concrete, dated, real-world evidence that SSNIT revises the insurable-earnings ceiling annually, on its own independent cadence from the percentage rates** — directly validating the Owner Review's explicit requirement that percentages and earnings thresholds be independently versionable.

**Minimum insurable earnings:** the notice title format implies a minimum figure is published alongside the maximum each year, but no 2025/2026 minimum figure was recovered in this pass. **Remains open, §5.**

**Tier 3 (voluntary):** not independently confirmed from a primary source this pass either. **Remains open, §5.**

---

## 5. Unresolved Statutory Numerical Values (explicit — not guessed, not seeded)

| Value | Status | Action |
|---|---|---|
| Whether the 2024/Act 1111 PAYE bands remain unamended for the actual period(s) Payroll will run | Best-evidenced current answer: yes, unamended; a 2026 Amendment Bill of unknown content is pending | Confirm before go-live; do not seed until confirmed |
| Overtime "qualifying employee" threshold (if any) | Not found | Confirm with GRA/tax advisor before coding overtime treatment |
| Benefit-in-kind monetization formulas (vehicle/fuel/electricity/water) | Not found | Confirm with GRA/tax advisor |
| Personal tax relief categories and amounts | Not found | Confirm with GRA/tax advisor |
| SSNIT Tier 1/Tier 2 split (13.5%/5%) and 5.5%/13% employee/employer split | Resolved with moderate-high confidence via convergent sourcing | Recommend final legal/accounting sign-off before first live run; not treated as an open conflict |
| Maximum insurable earnings (GHS 69,000 for 2026 / GHS 61,000 for 2025) | Found via secondary reporting of SSNIT's own Public Notice; primary PDF not directly fetched this pass | Fetch/confirm the actual SSNIT Public Notice PDF directly before seeding |
| Minimum insurable earnings | Not found | Confirm directly from the SSNIT Public Notice before coding a floor |
| Tier 3 voluntary ceiling | Not found | Confirm with NPRA/tax advisor |

**None of these are seeded anywhere in this session. The architecture (§7–§9) is designed so that resolving each of these later is a configuration action, not a code change.**

---

## 6. Final Owner Decisions

Resolved using the Owner Review prompt's own directions first, repository evidence second, and conservative financial-control defaults only where the prompt left a genuine, low-stakes implementation choice unaddressed (each such case is labeled explicitly, per the instruction not to silently invent a preference on a material choice).

1. **PAYE band currency** — Architecture resolved (effective-dated, independently versionable band sets). Numeric value not frozen; see §5.
2. **Attendance/Leave → Payroll input scope** — **Resolved explicitly by the prompt:** no automatic or implicit financial inference from Attendance/Leave. Any such input must be an explicit, separately-created and separately-approved `payroll_input_references` record (§9.6) that a payroll preparer deliberately creates, pointing at the source Attendance/Leave record — never a live join evaluated at calculation time, and never retroactive: an Attendance correction after payroll calculation does not alter an already-referenced input; a new input/correction record would be required.
3. **Maker-checker different-actor enforcement** — **Resolved explicitly by the prompt for statutory-rule approval:** the creator of a statutory rule version may never be its sole approver; enforced server-side (§8.3). **Extended by direct application of the same stated principle to payroll-run approval and finalization** (not explicitly stated by the prompt for run-level approval specifically, so flagged here rather than silently assumed): the architecture requires `payroll.run.approve`/`payroll.run.finalize` as permissions distinct from `payroll.run.prepare`, and the *implementation* workstream should confirm whether different-actor enforcement is hard-enforced (matching statutory rules) or role-separated-but-not-actor-enforced for run approval specifically — this one sub-choice is left to the approval workstream (§13, Workstream 5) rather than frozen here, since the prompt did not explicitly resolve it at that level.
4. **Tier 1/Tier 2 split, ceiling, Tier 3** — Architecture resolved (independently-versionable employee%, employer%, Tier 1 allocation%, Tier 2 allocation%, min/max insurable earnings, all separately effective-dated, per the prompt's explicit list). Numeric values: split resolved with moderate-high confidence (§4.2); ceiling found but not primary-confirmed; floor and Tier 3 remain open (§5) — none seeded.
5. **Statutory rule-set granularity** — **Resolved by direct implication of the prompt's own explicit statement** ("Percentages and earnings thresholds must be independently versionable because one may change without the other"): a shared lifecycle/provenance framework (`payroll_statutory_rule_versions`) with **rule-type-specific child tables** for PAYE bands, pension rates, and pension earnings-ceilings respectively — never one undifferentiated table, and never one row per rule type that gets edited in place. Detail in §9.2.
6. **GL/accounting journal integration scope** — **Resolved by the prompt's own conditional test:** "deferred unless the Owner Review finds a compelling existing repository dependency." None was found (re-confirmed this session — no GL/chart-of-accounts concept anywhere in the platform). **Fully deferred**; V1 persists structured, itemized figures (§9.5) sufficient for a future export, without building an integration.
7. **Module category** — Minor, non-material implementation choice, resolved pragmatically rather than deferred to Owner: new `financial-operations` category (cleaner separation from `hr-operations`, matching how compensation/statutory/banking data is conceptually distinct from personnel-record HR operations). Flagged here as a low-stakes technical default, reversible at implementation time with a one-line change, not requiring further sign-off.
8. **Payslip generation model** — Resolved in favor of **on-demand generation** from the immutable `payroll_run_line_components`, following the same "never a stored/cached artifact, always computed from the authoritative record" convention every existing Phase 3H report already uses (§9.7) — a repository-convention-driven resolution, not an invented preference.
9. **Payroll audit sensitivity treatment** — **Resolved explicitly per the prompt's instruction to resolve it:** no field-level encryption is introduced (none exists anywhere in the repository as precedent — national ID and passport number are both stored as plain, RLS-and-permission-protected text columns today; inventing a new encryption layer would itself be a material, undiscussed architecture change outside this session's scope). Instead: **reads** of `employee_banking_details` and `employee_statutory_identifiers` — not just writes — become audit-logged, a deliberate departure from the platform's general "reads stay silent" convention, justified by the heightened sensitivity the prompt itself calls out. Ordinary payroll-run/report reads and an employee's own payslip view are **not** read-audited, consistent with the existing own-resource-read-is-silent precedent (§17).
10. **Reliefs / benefit-in-kind formulas / Tier 3 ceiling / remittance timing / ceiling-floor** — Remittance timing and maximum insurable earnings now resolved (§4.2). The remainder stay genuinely open (§5) — architecture accommodates all of them as independently-versionable parameters; no numeric value is guessed.

---

## 7. Final Payroll Architecture (summary)

Payroll is a new, independently-module-gated (`status: hidden`, `defaultEnabled: false`) layer sitting alongside — never inside — the existing `employees` table. It introduces exactly two configuration classes, kept structurally separate per the Owner Review's explicit instruction:

- **Statutory rules** (§8) — official Ghana parameters, versioned, source-attributed, maker-checker-approved, never organization-editable.
- **Organization payroll policy** (§9.1, §9.3) — an organization's own earning components, allowances, deductions, calendars, approval routing — configurable per organization, never confused with or capable of overriding a statutory value.

Every table is `organization_id`-scoped (except the statutory-rule tables, which are platform-global — Ghana law does not vary per organization), RLS-enabled with zero policies (identical to all 95 existing tables), and follows the half-open effective-dated-interval pattern already proven twice in this platform (`employee_number_allocations`, `leave_policies`) for every value that can change over time.

---

## 8. Statutory-Rule Versioning Model

### 8.1 Lifecycle (frozen)

`DRAFT → VALIDATED → APPROVED → ACTIVE (by effective date) → SUPERSEDED`

Mapped onto repository convention rather than invented from scratch:

- `DRAFT`/`VALIDATED` — free editing by a holder of `payroll.statutory.manage`; mirrors an ordinary draft record anywhere else in the platform (e.g. a Performance review template's own `draft` status).
- `APPROVED` — requires `payroll.statutory.approve`, held by a **different** membership than the one that created/last-edited the draft (server-side check, not a frontend affordance) — the explicit maker-checker requirement from the Owner Review prompt.
- `ACTIVE` — not a manually-set status; a version is "active" purely by virtue of its `effectiveFrom` having arrived and no later version having superseded it for that rule type — resolved the same way `pickAllocationAsOf` resolves "the current holder," never a separate mutable flag that could drift from the dates.
- `SUPERSEDED` — set automatically (by closing `effectiveTo`) the instant a new version for the same rule type is approved with a later `effectiveFrom` — mirrors exactly how `releaseEmployeeNumber` closes `validTo` on the old allocation the moment a new one opens.

### 8.2 Immutability

Once a statutory version has been **consumed by a finalized payroll run** (§10), its calculation-relevant fields become immutable — enforced the same way a locked personnel-file custody state or a released staff-number allocation is immutable: any further change is a **new version**, never an edit to the old row. A version that has never been consumed by a finalized run may still be corrected in `DRAFT`/`VALIDATED` before approval.

### 8.3 Maker-checker enforcement

Server-side only, per the explicit instruction. The approval route checks `approvedByMembershipId != createdByMembershipId` (or `!= lastEditedByMembershipId`) and rejects with a controlled 400 otherwise — new logic (no exact existing precedent enforces *different actor*, only *different permission*), scoped narrowly to this one route family.

### 8.4 Provenance (every version stores)

`createdByMembershipId`/`createdAt`, `approvedByMembershipId`/`approvedAt`, `effectiveFrom`, `effectiveTo` (nullable = currently open), `sourceUrl`/`sourceDescription`/`sourceRetrievedAt` (traceable to exactly where the value came from and when), `confirmedBy`/`confirmedAt` (distinguishing "staged" from "signed off by Owner/legal/accounting"), `reasonNote` (free text — why this version exists / what changed), and the rule-type-specific structured values themselves (§9.2).

---

## 9. Final Schema Impact (draft tables — not migrated in this session)

For every table: purpose, org-scoping, historical/effective-date behavior, uniqueness/concurrency, sensitive-field flag, append-only/immutable flag, RLS expectation.

### 9.1 Configuration & module

- **`payroll` module registry entry** — not a table; a `module-definitions.ts` entry. `status: hidden`, `defaultEnabled: false`, category `financial-operations` (Decision 7). Org-scoped via the existing `organization_modules` mechanism, unchanged.
- **`organization_settings` namespace `"payroll"`** — no new table; reuses the existing JSON-config-namespace table. Org-scoped. Not historically versioned itself (matches `numbering`'s own precedent — current-value-only; if history of policy changes matters, that's `employment_periods`-style event logging layered on top, not a namespace concern). Not sensitive. RLS: existing table's existing policy (none — deny-by-default, app-layer gated).

### 9.2 Statutory rule engine (platform-global, not org-scoped — Ghana law applies platform-wide)

- **`payroll_statutory_rule_versions`** — shared lifecycle/provenance table (§8.4) + a `ruleType` discriminator (`paye_bands` / `pension_rates` / `pension_earnings_ceiling`, extensible). Not org-scoped (statutory law, not organization policy). Effective-dated, half-open interval, `pickAllocationAsOf`-style resolver reused as-is. Concurrency: partial unique index preventing two `ACTIVE`-eligible (open `effectiveTo`) versions of the same `ruleType` overlapping in time, mirroring `employee_number_allocations_org_number_open_unique`'s own precedent (minus the org-scoping, since this table has none). Not sensitive (public statutory law, not personal data). Append-only in the sense that approved/consumed versions are never edited (§8.2). RLS: enabled, zero policies, app-layer gated (`payroll.statutory.*`).
- **`payroll_paye_bands`** — child rows of a `payroll_statutory_rule_versions` row where `ruleType = paye_bands`: `bandOrder` (int), `thresholdAmount` (numeric, nullable for the open-ended final band), `ratePercent` (numeric), `taxpayerCategory` (resident/non-resident, extensible). Ordering + open-ended-final-band support exactly per the Owner Review's explicit requirement. Not sensitive. Same RLS treatment as parent.
- **`payroll_pension_rates`** — child rows: `employeeRatePercent`, `employerRatePercent`, `tier1AllocationPercent`, `tier2AllocationPercent` — four independently-stored fields, per the explicit instruction not to collapse this into one percentage. Not sensitive. Same RLS treatment.
- **`payroll_pension_earnings_ceiling`** — child rows: `minimumInsurableEarnings` (nullable until confirmed), `maximumInsurableEarnings` (nullable until confirmed) — its **own** independent effective-dating from `payroll_pension_rates`, directly reflecting §4.2's real-world finding that SSNIT revises this ceiling on its own annual cadence, separate from the percentage rates. Not sensitive. Same RLS treatment.

### 9.3 Organization payroll policy (org-scoped — the second, structurally separate configuration class)

- **`payroll_earning_component_types`** / **`payroll_deduction_types`** — new master-data domains (reusing `master-data-definitions.ts`'s existing `organization-defined`/`organization-overridable` classification mechanism, not new bespoke tables), for an organization's own allowance/deduction taxonomy. Org-scoped (or system-defined for common ones like "Basic Salary"). Not effective-dated at the domain level (domains are a fixed classification list, like every existing one); individual employee assignments are (§9.4).
- **`payroll_periods`** — org-scoped, calendar definition (frequency, start/end/pay date per period). Uniqueness: one period per (org, frequency-cycle). Not sensitive. RLS as standard.

### 9.4 Employee compensation (new — never `compensationSummary`, never `salaryRange*`, per explicit instruction)

- **`employee_compensation_components`** — one row per (employee, component type, effective period), half-open `validFrom`/`validTo`, resolved as-of the relevant pay date via a `pickAllocationAsOf`-style helper. Fields: `employeeId` (→ `employees.id`, never a staff/PIF number), `componentTypeKey` (→ the master-data domain above), `amount` (`numeric(12,2)`, reusing `job_requisitions`'s established money-column precision), `currency` (text, reusing the same convention), `recurring` (boolean — recurring vs one-off, per the explicit requirement), `taxableTreatment` (ordinary/benefit-in-kind/bonus/overtime-tagged, per §4.1's confirmed differing treatments), `sourceReference` (nullable — e.g. an `employment_periods` row id, if this component change came from a recorded promotion; never auto-populated, always an explicit link per Decision 2). **Sensitive** (salary data) — gated by new `payroll.compensation.read`/`.manage`, never inherited from `employee.read`. Concurrency: no two open (`validTo IS NULL`) rows for the same (employee, componentType) — same partial-unique-index pattern as staff numbers. RLS: enabled, zero policies.
- **This is the sole payroll authority for compensation.** `offer_versions.compensationSummary` and `job_requisitions.salaryRange*` remain exactly what they already are — unstructured, recruitment-time, never read by Payroll, never migrated into this table automatically (an HR/Payroll user would deliberately create the first `employee_compensation_components` row when someone starts being paid, exactly as deliberate as every other Phase 3H "never auto-infer" boundary).

### 9.5 Payroll runs

- **`payroll_runs`** — org-scoped, one per (period, org). State machine (§10). `preparedByMembershipId`, `approvedByMembershipId` (nullable until approved, distinct-actor-enforced per Decision 3), `lockedAt`. Not itself sensitive (metadata only). RLS standard.
- **`payroll_run_lines`** — one per (run, employee). **Snapshots** compensation as resolved at calculation time (never a live join, per the same discipline Phase 3H already proved for staff numbers) — carries a copy of `employeeId` and the historically-resolved staff number **as of the pay date** (via `employee_number_allocations`, never `employees.employeeNumber` directly), satisfying the Phase 3H compatibility requirement (§19) at the schema level, not just by convention. Sensitive (contains resolved salary figures). RLS standard, gated by `payroll.compensation.read`/`payroll.report.read`.
- **`payroll_run_line_components`** — itemized breakdown per line: gross, each earning, each deduction, PAYE, SSNIT employee, Tier 2 employee, SSNIT employer, Tier 2 employer, net. The **true immutable source of truth** payslips (§9.7) and statutory schedules are generated from. Sensitive. Immutable once the parent run is `locked` (§10) — enforced the same way a released employee-number-allocation row is never edited, only superseded.

### 9.6 Inputs, corrections, payments

- **`payroll_input_references`** — the explicit, non-automatic link from an Attendance/Leave (or any other) record into a payroll calculation, per Decision 2: `payrollPeriodId`, `employeeId`, `sourceType`/`sourceId` (polymorphic reference, free-text type + id, mirroring `employment_periods.eventType`'s own precedent for extensibility without a schema change per source type), `financialEffect` (structured, e.g. "deduct N days at daily rate"), `createdByMembershipId`, `approvedByMembershipId` (nullable — an Owner-level implementation question: whether every input needs its own approval or only the run's overall approval covers it; not resolved here, deferred to Workstream 3, §13). Sensitive (financial). RLS standard.
- **`payroll_corrections`** — append-only, references the original locked run/line, never overwrites it; produces its own approved, dated adjustment record, mirroring the personnel-file-movement/employee-number-allocation "never mutate history" convention. Sensitive. RLS standard, gated by a distinct `payroll.run.correct` permission (maker-checker applies here too, per the general principle).
- **`payroll_payment_batches`** — one per (run, payment method, date). References `employee_banking_details` (§9.8) **as resolved at batch-creation time**, not live, for the same historical-integrity reason as everything else. Sensitive. RLS standard, gated by a distinct `payroll.payment.manage` permission — deliberately separate from run approval, since "who approves the numbers" and "who can see/move banking details" are different authorities per the Owner Review's own permission list.

### 9.7 Payslips

No new table (Decision 8) — generated on demand from `payroll_run_line_components`, exposed through a dedicated route (`payroll.payslip.read.own` for the employee's own, a distinct `payroll.payslip.read` for HR/payroll-admin viewing another employee's), following ADR-016's existing dedicated-route pattern exactly.

### 9.8 Banking & statutory identifiers

- **`employee_banking_details`** — `employeeId` (→ `employees.id`), bank (new master-data domain), account number, account name, branch, effective-dated (`validFrom`/`validTo`, since an employee can change banks). **Highly sensitive.** Gated by a distinct `payroll.banking.read`/`.manage`, narrower than general `payroll.compensation.read` (an ordinary payroll preparer does not automatically see bank accounts). **Reads are audit-logged** (Decision 9) — a deliberate exception to the platform's usual read-silence. RLS standard.
- **`employee_statutory_identifiers`** — `employeeId`, SSNIT number, TIN, effective-dated in case of correction/re-issuance. Same sensitivity/permission/audit-on-read treatment as banking details.

---

## 10. Payroll Lifecycle (frozen)

`Period defined → Employees included (explicit, not implicit "all active") → Compensation resolved (snapshot, §9.4→9.5) → Inputs collected (§9.6, explicit only) → Calculated (draft run + lines + components) → Validated (a distinct, re-runnable check pass — variance/sanity checks before human review) → Reviewed → Approved (distinct-actor-enforced per Decision 3) → Locked/Finalized (immutable financial result from this point) → Payslips generated (on demand, §9.7) → Payment batch prepared (§9.6, if in V1 scope — confirmed yes, generic batch only, no payment-rail integration) → Statutory schedules generated (§12) → [Corrections/Reversals as needed, §11, always append-only] → Historically reproducible forever after`.

A run may only be cancelled while `draft` or `calculated` — never once `approved`, mirroring the segregation-of-duties principle the Owner Review itself grounds maker-checker in.

---

## 11. Correction / Reversal Model (frozen)

- No locked line is ever edited in place.
- A correction is a new, dated, separately-approved `payroll_corrections` row referencing what it corrects.
- A correction that changes net pay produces its own explicit payment implication (a supplementary payment or an offset against a future run) — never inferred silently.
- Every correction is audit-logged with both prior and corrected figures, matching the platform's existing `beforeState`/`afterState` audit convention.
- A statutory-rule correction after a run has consumed the old version **never** retroactively recalculates that run — a new statutory version only ever applies to periods with a later `effectiveFrom`, per the invariant given verbatim in the Owner Review prompt.

---

## 12. Reports / Outputs (V1 boundary, frozen)

Payroll Register · Payslip (own + HR view) · PAYE schedule · SSNIT/Tier 1 contribution schedule · Tier 2 contribution schedule (per licensed trustee — trustee identity as a new master-data item) · deduction/earning summaries · payroll variance/validation report (feeding the lifecycle's own "Validated" stage) · payment-batch summary export (generic, no payment-rail integration) · historical/as-of payroll report (mirroring the Phase 3H Current-vs-Historical report pair). All via ADR-016's dedicated-route pattern, gated by `payroll.report.read`, never the generic report runner. **No GRA/SSNIT electronic-submission integration** — no supported interface was found or verified in this pass, and none is proposed; outputs remain export/print artifacts an organization would file manually or through its own separate tooling.

---

## 13. Implementation Workstreams (frozen sequence)

Mirrors Phase 3H's own workstream-by-workstream, individually-gated discipline. Each requires its own separate explicit go-ahead before starting — **none begin as a result of this document.**

**Workstream 1 — Payroll Foundation.** Objective: module + permissions + org-config namespace + statutory-rule schema, no numeric seeding. Scope: `payroll` module registration (hidden); all `payroll.*` permission keys (§14); `organization_settings` `"payroll"` namespace; `payroll_statutory_rule_versions` + the three rule-type child tables (§9.2), schema only. Exclusions: no compensation model yet, no calculation logic, no numeric statutory values seeded. DB: 1 migration (module registry data is code, not a migration — permissions/settings-namespace additions typically aren't separate migrations either in this repo's convention; the statutory-rule tables are). Backend: CRUD + lifecycle routes for statutory-rule versions (draft/validate/approve, maker-checker enforced). API: new OpenAPI paths/schemas for the above. Frontend: a minimal statutory-rule admin screen (not payslips/runs yet). Permissions: `payroll.statutory.manage`/`.approve`. Audit: full mutation coverage on rule-version lifecycle transitions. Tests: unit tests for the maker-checker different-actor check and the effective-date resolver, mirroring `pickAllocationAsOf`'s own existing test precedent. Live QA: create/validate/approve a rule version end-to-end via real HTTP, confirm a second version with a later `effectiveFrom` correctly supersedes without touching the first. Concurrency: two simultaneous approval attempts on one draft version — exactly one winner. Cleanup: remove all QA-created rule versions afterward, independently re-verified. DoD: module hidden/disabled everywhere by default, zero numeric statutory data present, full regression green. **STOP boundary: no compensation, no runs, no numeric Ghana data.**

**Workstream 2 — Employee Compensation.** Objective: `employee_compensation_components`, master-data domains for component types, banking/statutory-identifier tables. Scope: §9.3, §9.4, §9.8 schema + CRUD, effective-dating, concurrency-safe single-open-row enforcement. Exclusions: no calculation engine yet. DB: 1 migration. Backend/API/Frontend: compensation + banking CRUD routes and minimal admin UI. Permissions: `payroll.compensation.read`/`.manage`, `payroll.banking.read`/`.manage`, `payroll.statutory_identifiers.read`/`.manage` — all distinct. Audit: mutation coverage + read-auditing on banking/statutory-identifier reads (Decision 9). Tests: concurrency test for the single-open-compensation-row race. Live QA: assign compensation, confirm historical resolution across a change (old amount still resolves for a past date). Cleanup as usual. DoD: zero coupling to `offer_versions`/`job_requisitions`. **STOP boundary: no payroll run exists yet.**

**Workstream 3 — Payroll Periods & Calculation Engine.** Objective: `payroll_periods`, the calculation pipeline (§9's compensation/statutory resolution → gross → SSNIT → PAYE → net), draft-run generation only. Scope: draft-only runs (no approval/locking). Resolves the Workstream-3-deferred question of whether `payroll_input_references` need their own per-input approval (Decision, §9.6) as part of this workstream's own scope. Exclusions: no approval, no locking, no payslips, no payments. DB: 1–2 migrations (periods, runs/lines/components, input-references). Tests: the calculation pipeline against known inputs and the (still-unseeded, test-fixture-only) statutory rule versions, proving the pipeline shape is correct independent of real Ghana numbers. Live QA: full draft-run calculation via real HTTP against fixture statutory data. Concurrency: two simultaneous draft-run-generation attempts for one period — exactly one authoritative result per (period, employee). Cleanup as usual. **STOP boundary: draft runs are never approvable or payable yet.**

**Workstream 4 — Approval, Locking & Segregation of Duties.** Objective: the full run lifecycle (§10) from calculated through locked, permission enforcement (§8.3/§14), resolution of the Workstream-4-deferred different-actor question for run approval specifically (Decision 3). Scope: state-machine enforcement (controlled 400/409 on illegal transitions, matching the personnel-file-custody precedent exactly), immutability of a locked run. Tests: illegal-transition rejection tests, immutability tests (attempted edit of a locked line rejected). Live QA + concurrency: simultaneous approval attempts, simultaneous lock attempts — exactly one winner each. **STOP boundary: no payslips or payments yet.**

**Workstream 5 — Corrections & Reversals.** Objective: §11, append-only, never touching a locked run's original rows. Tests + live QA mirroring the personnel-file-movement-history precedent. **STOP boundary.**

**Workstream 6 — Payslips & Employee Self Service Exposure.** Objective: §9.7 on-demand generation, `payroll.payslip.read.own` ESS route, `payroll.payslip.read` HR route. Live QA: an employee sees only their own payslip; cross-employee/cross-org access rejected. **STOP boundary.**

**Workstream 7 — Statutory Schedules & Reports.** Objective: §12's dedicated-route reports. Live QA: report figures reconcile against `payroll_run_line_components` exactly. **STOP boundary.**

**Workstream 8 — Payment Batches.** Objective: §9.6's generic batch (no payment-rail integration, per Decision 6's deferral extended to this). **STOP boundary: no bank/mobile-money integration.**

**Workstream 9 — Payroll Verification.** A dedicated, Phase-3H-W120-style verification workstream: one integrated live-QA scenario spanning a full period end-to-end (compensation assignment → statutory-rule versioning → calculation → approval by a different actor → locking → correction → payslip → statutory schedule), concurrency tests across every contested resource named above, tenant isolation (WWM vs. Acme, and explicit re-confirmation that WWM remains payroll-disabled throughout), fresh regression, fresh RLS/permission re-query, historical-reproducibility proof (a statutory-rule change after a locked run must not alter that run's already-calculated figures — the exact invariant given in the Owner Review prompt, proven live, not just asserted).

**Workstream 10 — Payroll Completion Report.** Documentation-only closure, mirroring W121's own structure, using Workstream 9's PASS as its verification authority.

---

## 14. Permissions (frozen)

New, payroll-exclusive `<resource>.<action>` keys, none inherited from or granted to any existing role by default:

`payroll.statutory.manage` · `payroll.statutory.approve` · `payroll.compensation.read` · `payroll.compensation.manage` · `payroll.banking.read` · `payroll.banking.manage` · `payroll.statutory_identifiers.read` · `payroll.statutory_identifiers.manage` · `payroll.run.prepare` · `payroll.run.approve` · `payroll.run.lock` · `payroll.run.correct` · `payroll.payment.manage` · `payroll.report.read` · `payroll.payslip.read` (HR/admin view of another employee's) · `payroll.payslip.read.own` (ESS).

`hr_manager` and every other existing role receive **none** of these by default — an explicit act of role/permission assignment is required per organization, exactly mirroring Phase 3H's own `employee_number.allocate`/`personnel_file.manage` precedent.

---

## 15. Sensitive-Data / Banking Model

`employee_compensation_components`, `employee_banking_details`, `employee_statutory_identifiers`, and every `payroll_run_line*` table are sensitive. None inherit `employee.read`. No field-level encryption is introduced (Decision 9) — RLS + narrow permission gating, the platform's one existing convention, applied consistently. Banking/statutory-identifier **reads** are audit-logged as a deliberate exception to the general read-silence convention.

---

## 16. Audit Model

Every payroll mutation (compensation change, statutory-rule lifecycle transition, run calculation/approval/lock, correction, payment-batch creation) is audit-logged, matching the existing `audit_events` shape exactly. Additionally: banking/statutory-identifier **reads** are audited (Decision 9). Ordinary report/payslip/run-listing reads remain silent, matching every existing Phase 3H report/search precedent.

---

## 17. Phase 3H / Employee-Identity Compatibility

`employees.id` is the sole payroll identity. `payroll_run_lines` snapshots the employee's staff number **as historically resolved via `employee_number_allocations` at the pay date**, never a live `employees.employeeNumber` join — enforced at the schema/snapshot level (§9.5), not left to report-time discipline alone. A reused staff number must never cause a later holder's payslips/reports to show a former holder's payroll history, and must never cause a former holder's historical payslip to display the new holder's current number — the identical guarantee already proven twice in Phase 3H (W119, W120), extended here rather than re-derived from first principles. PIF numbers play no role in payroll identity whatsoever.

---

## 18. Attendance / Leave / HR Integration Boundary

No automatic or implicit linkage (Decision 2). `payroll_input_references` (§9.6) is the sole, explicit, approved bridge. Employment periods (transfer/promotion/confirmation) may optionally be *referenced* by a new compensation-component row's `sourceReference` field but never *trigger* one. Separation closes open compensation components (`validTo`) but never itself triggers a payroll run. Probation/Performance have no payroll linkage in this plan.

---

## 19. Approved Deferrals

QR/barcode, stocktaking, broad automatic filing (all carried forward from Phase 3H's own standing deferrals) — GL/accounting-journal integration — payment-rail/bank-file integration — multi-jurisdiction/multi-country statutory support beyond Ghana — Benefits and Tax as their own separate future modules — SSNIT/GRA electronic-submission integration — automatic scraping/auto-activation of statutory changes from any government website (explicitly prohibited by the Owner Review; any future update-notification mechanism would surface a change for human verification only, never auto-apply it).

---

## 20. Issues / Ambiguities Found

- Two `WebFetch` attempts directly against `ssnit.org.gh` failed with a tooling-level "Invalid header value" parse error (not a content/authority problem) — worked around via targeted search that recovered and quoted SSNIT's own site text and its own hosted Public Notice PDF by name; flagged so a future session with working direct access re-fetches these pages directly rather than relying on secondary reporting of them.
- The earlier discovery-pass NPRA PDF extraction's "28.5%"/"PNDC Law 247" reading is now treated as an extraction artifact rather than a genuine second interpretation, on the strength of convergent evidence gathered this session — but this document does not claim to have read Act 766's raw statutory text directly; recommend that confirmation as part of Workstream 1 or a pre-implementation legal review.
- The "different-actor enforcement for run approval" sub-question (Decision 3) is deliberately left to Workstream 5's own scope rather than frozen here, since the Owner Review prompt resolved it explicitly only for statutory-rule approval.
- Whether every `payroll_input_references` row needs its own approval, or only the run's overall approval covers it, is deliberately left to Workstream 3.

---

## 21. Documentation Changed

- `docs/PAYROLL_IMPLEMENTATION_PLAN.md` — this document (new).
- `PROJECT_STATUS.md` — a new, minimal pointer entry (see below).
- `docs/PAYROLL_DISCOVERY_REPORT.md` — left unchanged, retained as the historical discovery record this plan supersedes.

No other file touched. No migration. No application code. No seeded statutory data. Payroll not enabled for any organization.

---

## 22. Boundary

**STOP after this document.** No implementation begins as a result of this plan freeze. No migration `0045` was created. No application code was changed. No unverified statutory figures were seeded. Payroll was not enabled for WWM or any organization. WWM HR permissions were not changed. Production was not touched. Tax/Benefits/other Future Expansion modules were not begun. The next step requires a separate, explicit go-ahead naming Workstream 1 specifically.
