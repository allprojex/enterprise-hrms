# Phase 3H — WWM HR Operations, Personnel Records & Document Reconciliation

**Status: FROZEN — APPROVED FOR IMPLEMENTATION**
**Freeze date: 2026-08-23**

This document was produced in two passes: a repository-grounded discovery pass (preserved below, labeled **FOUND IN REPOSITORY** / **OWNER-STATED REQUIREMENT** / **PROPOSED DESIGN**), followed by an Owner Review and this freeze pass, which resolves all 20 Owner Decisions plus the additional frozen requirements the Owner supplied on review. **Zero Owner Decisions remain unresolved.**

This document authorizes implementation starting with **W114**, under its own separate, explicit go-ahead. No code, migration, schema, or permission change has been made as part of producing or freezing this document.

---

## 1. Source Document Discovery (unchanged since draft)

**FOUND IN REPOSITORY:** an exhaustive search (`grep -rli` across `*.md`/`*.txt`/`*.pdf`, plus a filesystem scan for any `*.pdf`/`*.docx`/`*wwm*` file anywhere in the repository, including `artifacts/api-server/uploads`) found **zero WWM-specific source documents** (no PIF, leave form, staff-evaluation form, or probation-review form) anywhere in this repository. Every specific field, format example (`WWM/SN/001`, `PIF-001`), and workflow description in this document that concerns WWM's actual paper forms is **OWNER-STATED**, not independently verified against a source document — stated plainly, per this document's own discipline, rather than implied. The one directly relevant prior citation on record: `docs/PHASE_2B_IMPLEMENTATION_PLAN.md:245` — a personnel/physical-file registry was named and **deliberately deferred twice already** (Phase 2A's own completion report, then reaffirmed in Phase 2B). This document is the first time that deferred item is picked back up.

---

## 2. Final Decisions 1–20

Every decision below carries its final disposition. Three were **settled directly by Owner direction**, not merely recommended; the rest were **refined** during this freeze pass, several materially, after re-inspecting the actual repository (not the Owner Review's own preliminary assumptions).

### Decision 1 — Allocation-History Model
**FROZEN: new `employee_number_allocations` table**, append-only, partial unique index `WHERE valid_to IS NULL` (at most one open allocation per `(organizationId, employeeNumber)` pair). `employees.employeeNumber` remains a **denormalized current-value cache**, cleared to `NULL` when an allocation is released (§4). This is the one foundational, expensive-to-change-later decision in this document.

### Decision 2 — Staff-Number Reuse Policy
**REFINED on freeze.** The Owner directed: capability platform-wide, **eligibility organization-configurable, defaulting conservatively to DISABLED** unless an existing repository convention argues otherwise. **Repository reconciliation finding**: every module built in this codebase's history defaults to **disabled** at the organization level — `organization_modules.defaultEnabled` is `false` for every module ever shipped (Manager Portal, Assets, Learning, Performance, Attendance, Employee Self Service — confirmed repeatedly across every phase this session touched). This is a strong, consistent, load-bearing repository convention, and it **reinforces** disabled-by-default rather than arguing against it. **FROZEN: reuse-eligibility defaults to DISABLED per organization**, a new boolean org policy flag, following the exact same "capability exists platform-wide, off until an org opts in" shape as every module before it. Even when enabled: reuse is never automatic, requires deliberate HR selection, records the acting HR user, and never transfers or rewrites historical records — all directly enforced by the Decision 1 data model itself (a new allocation row referencing a *different* `employeeId` for the same `employeeNumber`, with the prior row's own `employeeId`/`validFrom`/`validTo` permanently intact).

### Decision 3 — Explicit vs. Automatic Release
**FROZEN: explicit HR action only**, distinct from separation. Never automatic. See the full lifecycle in §6.

### Decision 4 — PIF-Number Reuse
**SETTLED BY OWNER DIRECTION.** Permanent, 1:1, never released, never transferred. No allocation-history table is needed for it (unlike staff numbers) — there is no "previous holder" concept to track, since a PIF number never has more than one holder, ever.

### Decision 5 — Numbering Format Engine Scope
**REFINED on freeze — expanded, not minimal.** The Owner explicitly rejected the Owner-Review's own "prefix + padding only" framing. **FROZEN engine components**: prefix, suffix, configurable sequence length/padding, configurable starting sequence, branch token, department token, year token, month token, configurable reset policy (`never | yearly | monthly`, relevant only when a year/month token is used), and manual override (always available, validated against the same uniqueness/allocation rules as a generated number — never a separate, weaker code path). Not every organization uses every component — WWM's own two real formats (`WWM/SN/001`, `PIF-001`) use only prefix + zero-padded sequence, and nothing in the engine forces the unused components to be configured. Full concurrency-safe generation model in §5.

### Decision 6 — Physical-Location Hierarchy Storage
**FROZEN: dedicated `records_locations` table**, self-referencing nullable `parentId`, not a Master Data extension. Confirmed during the Owner Review's own reconciliation: Master Data (`master_data_items`) is strictly flat with no hierarchy column of any kind, and a physical location is operational data (created, retired, referenced by movement history) rather than simple reference-list data — Master Data's own three-tier classification model doesn't fit it. Levels are optional per level, matching the Owner's own explicit "do not force all levels mandatory" instruction, and the organization-configurable hierarchy requirement.

### Decision 7 — Movement / Chain-of-Custody Model
**REFINED on freeze — event-sourced, not stateful-row.** See the full state model in §7. `personnel_file_movements` is append-only, each row a discrete immutable **event** (`checked_out | returned | marked_missing | recovered`), never an editable stateful record. "Overdue" is **never persisted** — derived live from `expectedReturnDate` against the current unresolved `checked_out` event, per the Owner's own explicit instruction not to persist a time-derived status.

### Decision 8 — Volumes
**FROZEN: new `personnel_file_volumes` table**, child of `personnel_files` (never a sibling identity — "a new volume must not become a new employee"), `open | closed` state, own current-location reference.

### Decision 9 — Barcode/QR in V1
**FROZEN: deferred past V1**, but the location/movement schema (§6/§7) imposes no barrier to adding a scannable-code lookup later — a future QR/barcode value would simply resolve to a `records_locations.id` or `personnel_files.id`, both of which already exist as stable, addressable identities.

### Decision 10 — Stocktaking in V1
**FROZEN: deferred past V1** — a consumer of the location/movement data, not a prerequisite for it.

### Decision 11 — WWM "7 Working Days" Leave Rule
**FROZEN: additive `noticePeriodCountsWorkingDaysOnly` boolean on `leave_policies`** (nullable, defaulting to unset/calendar-days behavior — zero change to any existing organization's current Leave behavior). When set, the existing hard-block check in `createLeaveRequest` counts only working days (weekends skipped; public holidays optionally skipped too, reusing the already-existing `resolveHolidayDatesInRange` helper for consistency with how Leave already treats holidays elsewhere). The exact WWM leave-form field layout beyond this rule remains **pending source-document verification** — not invented.

### Decision 12 — Staff Evaluation Mapping
**SETTLED BY OWNER DIRECTION.** Configuration/template work on the existing Performance module only. Zero schema or code change. Not a Phase 3H implementation item.

### Decision 13 — Probation-Review Architecture
**REFINED on freeze — smaller than the Owner Review's own preliminary framing, after reconciling against the actual `employment_periods` schema.** Full model in §8. Headline change: **zero new table or column is needed to link a completed probation review to its confirmation event** — `employment_periods.newState` is an existing, already-free-form, already-queryable `jsonb` column (`lib/db/src/schema/employment-periods.ts:30`, `NOT NULL`, no fixed shape — each event type already defines its own shape). The confirmation event's own `newState` already can, and will, carry `{ employmentStatus: "active", probationReviewId: <id> }` with zero schema change. This is the "existing suitable mechanism" the Owner's own instruction asked me to look for before proposing anything additive, and it exists. The eligibility change to Performance itself remains genuinely additive and is unchanged from the Owner Review's own recommendation: `employmentStatus = 'probation'` is eligible **only** for a `cycleType = 'probation'` cycle, through a **dedicated probation assignment path** — `all_active`, `department`, `position`, and ordinary `manual` eligibility for every other cycle type are **not** touched, confirmed by scoping the change to a narrow conditional (`cycle.cycleType === "probation"`) inside `resolveEligibleEmployees`, never a general loosening of the `employmentStatus === 'active'` floor.

### Decision 14 — Automatic Filing Scope
**FROZEN: prepopulation in V1 (required); broad auto-filing deferred.** These are distinct: prepopulation is a read-only UI convenience (don't make HR retype known data), required by the Owner's own explicit instruction; auto-filing is a new automation engine with real failure modes, deferred until manual/orchestrated filing has proven itself.

### Decision 15 — Separation Integration Depth
**FROZEN: warn-only**, never a hard block, for outstanding assets, open file movements, or an unreleased staff number. Matches Assets' own already-frozen Phase 3E precedent exactly. Full lifecycle in §11.

### Decision 16 — Sensitive PIF Field Handling
**SETTLED BY OWNER DIRECTION.** Narrow, separately-permissioned storage; never dependent on the broad, disclosed, pre-existing `employee.read` gap. No specific sensitive fields are approved for capture by this freeze (§12) — the pattern is frozen, the field list is not.

### Decision 17 — Records Permissions
**REFINED on freeze — final permission set in §13.** Six new narrow permissions, zero new role, zero change to any existing permission. Numbering *configuration* (as opposed to allocation) reuses the **existing** `organization.update` permission, already gating every other `organizationConfig` namespace (`PATCH /organizations/:organizationId/config/:namespace`, `routes/organizationSettings.ts:57`) — confirmed live during this freeze's own reconciliation, a genuine reuse win over minting a seventh permission.

### Decision 18 — Reporting Scope
**FROZEN: five reports** (current allocations, historical allocations, files by location, checked-out/overdue files, separated-employees-with-unreleased-numbers), each **required** to resolve any staff number via the Decision 1 allocation table for the report's own as-of date — never a live join to `employees.employeeNumber`. `learningReporting.ts`'s own existing CSV column is flagged for the same fix once Decision 1 ships (the one concrete change required anywhere in the already-shipped codebase).

### Decision 19 — Legacy Import
**FROZEN: dedicated later workstream (W120)**, not bundled into foundational work. No forced identifier regeneration; unknown/missing legacy values stay nullable, matching the schema's own existing nullability.

### Decision 20 — Broad `employee.read` Dependency
**SETTLED BY OWNER DIRECTION.** Not required to be fixed first. The gap remains open, disclosed, unfixed, exactly as Manager Portal left it — new sensitive fields simply never depend on it (Decision 16).

---

## 3. Refinements Made During Repository Reconciliation

Disclosed explicitly, per the freeze instructions, rather than silently absorbed:

1. **Decision 2's default** was reconciled against actual repository convention (every module's own `defaultEnabled: false`) rather than assumed — the convention independently confirms, not merely permits, "disabled by default."
2. **Decision 5's scope** was expanded from the Owner Review's own "minimal engine" framing to the Owner's own fuller component list (branch/department/year/month tokens, reset policy) — no repository contradiction found; this is purely an Owner-directed scope correction, not a discovery-driven one.
3. **Decision 6** confirmed unchanged from the Owner Review (dedicated table, not Master Data) — the Owner's own instruction ("do not model this as one mutable text field... use dedicated structured/hierarchical file locations") independently reinforces the Owner Review's own reasoning for preferring a dedicated table.
4. **Decision 7's data model** changed from a "stateful row with a status column" framing to a fully **event-sourced** model (discrete immutable events, current state always derived) — a direct, more precise response to the Owner's own explicit "do not persist overdue... persist actual business events/states" instruction, and a better fit than what the original draft plan's own looser table sketch implied.
5. **Decision 13's schema footprint shrank to zero** for the confirmation↔review link specifically, after inspecting `employment_periods.newState`'s actual column definition (free-form `jsonb`, already the established mechanism for event-specific data) — the Owner Review's own preliminary language ("plus a small table/column") is superseded by this more precise finding.
6. **Decision 17's numbering-configuration permission** was found to already exist (`organization.update`) rather than needing a new one — confirmed live by reading the actual route guard.

**No genuine contradiction was found that would materially change the frozen architecture** — every refinement above is a sharpening or correction discovered through closer inspection, not a conflict requiring a STOP.

---

## 4. Numbering Configuration Model

Per the Owner's own required distinction, seven concepts, each with its own clear boundary:

1. **Numbering configuration** — an organization's own settings for one number type (employee or PIF), stored via the existing `organizationConfig.ts` mechanism as a new `numbering` namespace (two independent config keys per org: `numbering.employeeNumber`, `numbering.pifNumber` — never shared state). Configurable components: prefix, suffix, sequence length, starting sequence, branch/department/year/month token inclusion, reset policy. Gated by the **existing** `organization.update` permission — no new permission.
2. **Generated identifier** — the string produced by applying an org's own numbering configuration to the next available sequence value at allocation time.
3. **Manual override** — HR supplies the identifier directly instead of generating one; validated against the **same** uniqueness/allocation rules as a generated value (§5's own concurrency guarantee applies identically — no weaker path).
4. **Identifier allocation** — the act of creating a new row in `employee_number_allocations` (staff number) or setting `personnel_files.pifNumber` (PIF number, one-time only), always recording the acting user.
5. **Identifier release** — closing an *open* staff-number allocation (`validTo = now()`), a deliberate, separate, audited HR action. **Does not exist for PIF numbers** (Decision 4 — permanent, never released).
6. **Identifier reuse** — creating a *new* allocation row for a *different* employee using a staff number that has a *closed* (released) prior allocation. Gated by Decision 2's own org-level policy flag. **Does not exist for PIF numbers.**
7. **Historical allocation lookup** — querying `employee_number_allocations` for every row matching a given `employeeNumber`, ordered by `validFrom`, to answer "who has ever held this number, and when."

### Concurrency (numbering generation)

**FOUND IN REPOSITORY**: the current `generateEmployeeNumber()` (`lib/employees.ts:77-84`) is a disclosed, pre-existing race — a `count()`-based sequence read outside any lock, already known to be "not retried automatically" per its own code comment. **FROZEN fix**: a new `numbering_sequences` table (`organizationId, sequenceKey ('employeeNumber'|'pifNumber'), currentValue`, unique on `(organizationId, sequenceKey)`), incremented via `SELECT ... FOR UPDATE` **inside the same transaction** as the allocation-row insert — the row lock makes two simultaneous generation attempts serialize correctly, closing the pre-existing gap as a direct side effect of this workstream, not a separately-scoped fix. Manual override collisions and simultaneous-reuse-of-the-same-released-number races are both caught by Decision 1's own partial unique index (`WHERE valid_to IS NULL`) — a second concurrent insert for the same `(organizationId, employeeNumber)` pair fails at the database level (`SQLSTATE 23505`), converted to a clean error via the **existing** `isUniqueViolation()`/`dbErrors.ts` pattern, not a new one.

---

## 5. Staff-Number Allocation & Release/Reuse Lifecycle

Per the Owner's own explicit 10-step lifecycle, frozen precisely:

1. Employee is created; a staff number is either generated (via §4's engine) or manually supplied — a new `employee_number_allocations` row is inserted (`employeeId`, `employeeNumber`, `validFrom = now()`, `validTo = NULL`, `allocatedBy`), and `employees.employeeNumber` is set to match (the denormalized cache).
2. The allocation is now **active/current** (`validTo IS NULL`).
3. The employee separates (`employmentStatus → terminated`) — **the allocation is untouched**. The number remains theirs until an explicit release.
4. The (now-closed-eligible) allocation remains fully intact and queryable — nothing changes automatically.
5. HR performs a deliberate **release** action: the service layer requires `employmentStatus` to be a separated state (not `active`/`probation`/`on_leave`/`suspended`) — attempting to release an actively-employed employee's number is rejected with a clear domain error, enforced server-side, never merely a UI guard. On success: `validTo = now()`, `releasedBy` recorded, `employees.employeeNumber` cleared to `NULL` on that employee's own row.
6. The organization's own Decision-2 reuse policy flag determines whether the now-released number is even *selectable* for a new allocation — if disabled, released numbers simply remain permanently retired for that organization (no data changes when the flag itself changes state, only future selectability).
7. A released, reuse-eligible number may remain unallocated indefinitely — no forced/automatic reassignment.
8. HR deliberately selects the released number for a different employee.
9. A **new** `employee_number_allocations` row is inserted for the new `employeeId`, `validFrom = now()`, `validTo = NULL` — blocked by the partial unique index if, through any race, the "old" allocation wasn't actually closed yet.
10. The old allocation row is never edited or deleted — permanently intact, historically queryable, forever attached to the original `employeeId`.

### Explicit edge-case rules (frozen, not left to frontend validation)

- **Separation reversed/corrected**: no distinct "undo separation" action exists in this codebase today — only `rehireEmployee()` (a genuinely new employment period). Rehiring **never automatically restores** a previously-held staff number, even if it was released — that is always a fresh, deliberate HR allocation decision (possibly re-selecting the same number if still unassigned, possibly a new one), consistent with "reuse is never automatic."
- **A number was released accidentally, not yet reallocated**: HR performs a **new** allocation, same `employeeId`, same `employeeNumber` — a fresh row, never an edit to the released one (preserves the append-only guarantee; the "accidental release" itself remains visible in history, not erased).
- **A number was released accidentally, already reallocated to someone else**: not automatically resolvable — surfaced as a visible conflict in history (two people, two periods) for manual HR resolution (assign one of the two employees a different number going forward); the system's own job is to make this visible, not to silently fix it.
- **HR tries to release an actively-employed employee's number**: rejected server-side (§ step 5 above).
- **HR tries to allocate an already-active (currently held) number**: rejected by the partial unique index, surfaced as a clean 409-style error.
- **Two HR users simultaneously allocate the same released number**: the partial unique index allows exactly one to succeed; the second gets the same clean conflict error.
- **Manual override collides with an existing active allocation**: identical handling — the uniqueness constraint is the single source of truth regardless of whether the number came from the generator or manual entry.
- **Reuse disabled after numbers have already been released**: no data change; those numbers simply become unselectable for new allocation until/unless reuse is re-enabled for that organization.
- **Numbering configuration changes after allocations already exist**: **existing identifiers are grandfathered exactly as stored, forever** — configuration changes affect only future allocations. No retroactive reformatting under any circumstance short of a separately-authorized, explicitly distinct correction workflow (not part of this phase).

---

## 6. Historical Staff-Number Resolution Model

Every historical report or record display that includes a staff number must resolve it via `employee_number_allocations` **as of the record's own relevant date** — the allocation row where `validFrom <= recordDate AND (validTo IS NULL OR validTo > recordDate)` for that `employeeId`. **Never** a live join to `employees.employeeNumber`, which reflects only the *current* moment. This is required for every one of the five reports in Decision 18, and is the one concrete fix required in the already-shipped `learningReporting.ts` CSV export (its own `employeeNumberById` map, currently resolved live, must switch to this as-of-date resolution once Decision 1 ships).

**Confirmed unaffected — the central finding underpinning this entire model**: an exhaustive audit (performed during discovery, re-confirmed on freeze) found **zero** places anywhere in Attendance, Leave, Performance, Learning, Assets, Employee Self Service, Manager Portal, Recruitment, employment history, audit records, or documents where `employeeNumber` is used as an identity or foreign key — every one of those exclusively uses `employees.id`. A reused staff number therefore **cannot** cause any historical record in any of those systems to appear to belong to the new holder — the only place resolution logic is needed at all is the small set of places that *display* a staff number as a label (§ Compatibility Analysis, §15).

---

## 7. Personnel-File / PIF Lifecycle & Physical-File Custody Model

### 7a. Personnel-File / PIF Lifecycle

1. Personnel-record creation — a new `personnel_files` row, 1:1 with `employees.id`, created (typically) alongside or shortly after employee creation.
2. PIF-number allocation — a **one-time**, permanent value set on `personnel_files.pifNumber` (generated via §4's engine, using its own independent `numbering.pifNumber` config, or manually supplied), validated for uniqueness at allocation time. **No allocation-history table** — there is exactly one holder, forever, so there is nothing to track beyond the single allocation event itself (recorded via the same audit pattern as everything else in this phase, §14).
3. Permanent employee association — fixed at creation, `personnel_files.employeeId` is never reassigned, ever, to any other employee, under any circumstance (including staff-number reuse) — the direct implementation of the Owner's own PIF-permanence requirement.
4. Physical file creation (where an organization uses physical filing at all) — optional; a personnel record can exist purely digitally if an organization has no physical-filing need.
5. Volumes (where applicable) — child rows of `personnel_files`, per Decision 8.
6. Current physical location — a reference from `personnel_files` (or from the currently-open volume, if volumes are in use) to a `records_locations` row.
7. Checkout / return / missing / recovery — governed entirely by §7b below.
8. Separation/archive handling — the personnel record (and its PIF number) is **never** deleted, archived-in-place-only (matching ADR-013's own "never hard-delete" convention exactly) — it simply continues existing, permanently associated with the same, now-separated employee.
9. Historical retention — permanent, by construction (append-only movement history, permanent PIF-employee association, employee row itself never deleted).

If multiple physical volumes exist, they remain under the **same** permanent `personnel_files`/PIF identity — never their own separate identity, satisfying the Owner's own explicit "must not become a new employee" instruction, applied here to volumes-vs-personnel-file identity as well.

### 7b. Physical-File Custody & Movement — Final State Model

**Event-sourced, not a mutable status field** (§3 refinement 4). `personnel_file_movements` rows are immutable, append-only facts:

```
personnel_file_movements
  id                organizationId, personnelFileId, volumeId (nullable)
  eventType         'checked_out' | 'returned' | 'marked_missing' | 'recovered'
  occurredAt
  actorMembershipId
  purpose           (checked_out only)
  destination       (checked_out only)
  expectedReturnDate (checked_out only)
  notes
```

**Current custody state** is always **derived** from the most recent event for a given file/volume — never stored as an independently-editable field:
- No events yet, or most recent event is `returned`/`recovered` → **in registry** (available to check out).
- Most recent event is `checked_out` → **checked out**. **"Overdue" is derived live**: `checked_out` AND `expectedReturnDate < today` AND no later `returned`/`recovered` event exists for that same checkout. Never a persisted status value, per the Owner's own explicit instruction.
- Most recent event is `marked_missing` → **missing**.

**Valid transitions**: `(none) → checked_out`; `checked_out → returned`; `checked_out → marked_missing`; `marked_missing → returned` (found and brought back by the person who had it); `marked_missing → recovered` (found independently of the holder, e.g. in the wrong location); `returned/recovered → checked_out` (a fresh checkout cycle). **Chain of custody is never lost** — every event, including a mistaken or superseded one, remains permanently in the append-only log; nothing is ever deleted or overwritten, including once a file has safely returned.

### Concurrency (physical-file custody)

A small denormalized "current custody state" cache lives directly on `personnel_files`/`personnel_file_volumes` (mirroring the `employees.employeeNumber` cache pattern from Decision 1), updated **transactionally alongside** each new movement-event insert, guarded by `SELECT ... FOR UPDATE` on the file/volume's own row before the state check — the same concurrency-safe pattern as §4's numbering sequence, reused rather than reinvented. This resolves every scenario the Owner listed explicitly:
- **Double checkout**: the row lock plus the "must currently be in-registry" check prevents a second `checked_out` event from being accepted while one is already open.
- **Double return**: a `returned` event is only accepted from `checked_out`/`marked_missing` state — a second return attempt (state already `returned`) is rejected.
- **Concurrent checkout attempts**: serialized by the same row lock — one succeeds, one gets a clean conflict error.
- **Marking a checked-out file missing**: valid transition, accepted.
- **Recovering a missing file**: valid transition (`marked_missing → recovered` or `→ returned`), accepted.
- **Returning after marked missing**: explicitly valid (§ above), not an error.
- **Movement/location update races**: the same row-lock discipline applies to any location reassignment, not just checkout/return events.

---

## 8. WWM Staff Evaluation & Probation Review Integration

### Staff Evaluation
**No implementation** — WWM's own stated fields (name, position, department, review period, rating, comments) are already fully covered by Performance's own existing snapshot/template/rating-scale architecture. Building WWM's own rating scale and review template is a configuration task any HR admin can already perform today, not a Phase 3H deliverable. The actual authoritative WWM evaluation form was not supplied — no field/wording is invented; this section is marked **pending source-document verification** for anything beyond the already-confirmed-sufficient generic structure.

### Probation Review
Frozen per Decision 13. Precisely, answering every sub-question the Owner posed:

- **How a probation review is identified**: a `performance_reviews` row belonging to a `performance_cycles` row with `cycleType = 'probation'`.
- **Who can assign it**: the dedicated probation-assignment path, gated by the **existing** `performance.review.write`-equivalent authority already governing cycle-review generation today — no new permission for this specific action (it is Performance's own existing capability, applied through a narrower, additive eligibility branch).
- **Who completes it**: the review's own `reviewerEmployeeId` (snapshot, set at assignment time) — identical authority model to every other Performance review, per the platform's own established reviewer-of-record pattern; no special-cased "who can complete a probation review" rule beyond what already governs every review.
- **What counts as completed**: the review reaching `status = 'finalized'` (or whatever terminal status Performance's own existing workflow already defines) — reused verbatim, not redefined for probation reviews specifically.
- **How HR sees the result**: through Performance's own existing HR-review/finalization surfaces — no new UI surface invented for probation results specifically.
- **How confirmation references it**: `confirmEmployee()`'s own `employment_periods` row, `eventType = 'confirmation'`, carries `newState: { employmentStatus: 'active', probationReviewId: <id> }` — zero schema change, per §2/§3.
- **What happens when probation is extended**: outside this freeze's own scope to redesign — the existing `probationEndDate` field can simply be updated by HR via the existing employee-update path; a probation-extension event is not a new concept this phase introduces, and no new schema is proposed for it.
- **What happens when confirmation is rejected/deferred**: `confirmEmployee()` is simply not called — the employee remains in `employmentStatus = 'probation'` indefinitely until HR acts; no new "rejected" state is invented, matching the existing binary confirm-or-don't-confirm shape of `confirmEmployee()` today.
- **Historical probation reviews remain immutable**: automatic — Performance's own reviews are never edited post-finalization today, and this phase introduces no exception to that.

---

## 9. Digital Documents — Boundary (Unchanged, Reaffirmed)

`employee_documents`/`fileStorage`/existing document validation remain the **sole** digital-document engine — no competing engine is proposed anywhere in this document. Where a personnel record needs to reference an existing employee document (e.g., a scanned signed PIF form), the smallest safe link is a nullable `employeeDocumentId` foreign key on `personnel_files` (or a small join table if a file can reference more than one document) — **not** a new document-storage mechanism. Documents/evidence and physical-file custody remain conceptually and structurally separate: a document is a digital artifact in `employee_documents`; physical custody is tracked entirely in `personnel_file_movements` — the two are linked by reference only, never merged.

---

## 10. Search Model

**FROZEN**: direct cross-search for employee name, employee/staff number, and PIF/personnel-file number. Reuses the **existing** `listEmployees()` search pattern (`ilike` OR-match, `lib/employees.ts:177-187`) as its own foundation, extended to additionally match against `personnel_files.pifNumber` and — critically — against `employee_number_allocations.employeeNumber` (not only the live `employees.employeeNumber` cache), so a **historical** staff number remains searchable by authorized HR users, not only the current one.

**Result clarity (the reuse-ambiguity requirement, applied directly)**: when a searched staff number matches more than one allocation (i.e., it has been reused), results must show **every** matching allocation, each clearly labeled with its own holder and validity period — current holder marked distinctly from historical holders — never silently collapsed to "the current one." Searching a PIF number always resolves to exactly one employee (by construction, since PIF numbers are never reused) — no ambiguity is structurally possible there.

---

## 11. Separation Integration & Warnings

**FROZEN**: separation preserves all historical HR records automatically (ADR-013's own "never hard-delete" convention, unchanged and unaffected by this phase). Existing separation types/reasons remain exactly as they are today (`employmentStatus = 'terminated'` + a Master Data-sourced `separationReason` code) — no redesign. Separation **may warn** about: assets still in custody (reusing Assets' own existing `asset_unreturned_by_employee` report, unchanged), personnel files still checked out, and a staff number not yet released — **none of these block separation**, matching Assets' own already-frozen precedent exactly. Staff-number release remains a wholly separate, later, deliberate HR action — never a side effect of separation itself (§5, step 5). A released number never becomes assigned to anybody else automatically (§5, steps 6-8).

---

## 12. Payroll / SSNIT Boundary

**FROZEN, unchanged from the Owner's own explicit instruction**: this phase contains zero payroll calculation, salary processing, tax calculation, SSNIT contribution calculation, deductions, benefits calculation, payslip processing, payroll approval, journal generation, payment processing, or payroll workflow of any kind. If an SSNIT identification number is later separately approved as a PIF field (not decided by this freeze — no specific sensitive fields are approved here, per Decision 16), it would be stored purely as a **personnel identifier**, behind the narrow permission model in §13, with **zero** implied or actual SSNIT contribution-processing capability. Personnel data is structured so a future Payroll/SSNIT phase can reference `employees.id` (exactly as every other module already does) without rebuilding anything in this phase — no table in this document has any Payroll-specific shape or dependency.

---

## 13. Sensitive PIF Authorization Model

**FROZEN permission set** — six new, narrow permissions, zero new role, zero change to any existing permission:

| Permission | Grants | Default holders |
|---|---|---|
| `employee_number.allocate` | Allocate/release/reuse a staff number | `hr_manager`, `org_admin` |
| `personnel_file.read` | View a personnel record: PIF number, physical location, movement history | `hr_manager`, `org_admin` |
| `personnel_file.manage` | Create personnel files, manage physical-location hierarchy, create volumes | `hr_manager`, `org_admin` |
| `personnel_file.movement.write` | Checkout/return/mark-missing/recover actions | `hr_manager`, `org_admin` |
| `personnel_file.sensitive.read` | View any approved sensitive PIF field (medical/dependants/SSNIT id/etc., once specifically approved) | `hr_manager`, `org_admin` — narrower still if a future decision requires it |
| `personnel_file.sensitive.write` | Edit any approved sensitive PIF field | `hr_manager`, `org_admin` |

**Numbering configuration** requires **no new permission** — it reuses the existing `organization.update` permission already gating every other `organizationConfig` namespace (confirmed live, `routes/organizationSettings.ts:57`).

**Employee self-service**: employees may see **none** of this in V1 — no ESS surface for PIF number, physical-file status, or movement history is proposed. This is a deliberate, disclosed exclusion (not an oversight): nothing in the Owner's own instructions requested employee-facing visibility here, and building one would be scope creep beyond what was asked.

**Manager Portal**: explicitly, deliberately **not** extended to cover any of this — "do not invent manager access merely because Manager Portal exists" is honored literally; no manager-facing personnel-records surface is proposed anywhere in this phase.

**Least privilege preserved throughout**: `employee.read`/`employee.write` are untouched — narrower, not broader, than before this phase in relative terms, since every new sensitive concept gets its own gate rather than riding on the existing broad ones.

---

## 14. Audit

Every action listed in the original discovery pass (§32 of the original prompt) remains a real requirement: staff-number allocated/released/reassigned, PIF-number allocated, personnel-file created, file moved/checked-out/returned/marked-missing/recovered, volume created, physical-location hierarchy changed, sensitive-record accessed (where a future Decision approves specific sensitive fields), and every probation/confirmation action already covered by Performance's/`employment_periods`'own existing audit paths. No sensitive form *contents* are ever placed in audit metadata, matching the platform's own established convention (e.g., Assets' own incident-report metadata already deliberately excludes free-text descriptions).

---

## 15. Compatibility Analysis Across Completed Modules

| Module | Impact |
|---|---|
| **Recruitment** | None — `candidates` already uses its own generic national-identifier type+value pattern, untouched by anything here |
| **Attendance** | None — zero `employeeNumber` reference anywhere in this module |
| **Leave** | One additive, nullable column (`noticePeriodCountsWorkingDaysOnly`) — every existing leave policy's current behavior is completely unchanged unless an org explicitly sets the new flag |
| **Performance** | One narrow, disclosed, additive eligibility branch scoped exclusively to `cycleType = 'probation'` assignment — every other cycle type, scope, and eligibility path is byte-for-byte unchanged |
| **Learning** | One existing CSV export column (`employeeNumberById` in `learningReporting.ts`) needs to switch from a live join to as-of-date allocation resolution (§6) — the only concrete code change required anywhere in an already-shipped module |
| **Assets** | None — the existing report-only, non-blocking `asset_unreturned_by_employee` precedent is reused as-is for the new separation-warning behavior (§11), never modified |
| **Employee Self Service** | None — deliberately not extended (§13) |
| **Manager Portal** | None — deliberately not extended (§13) |
| **Existing Employee Management** | `employees.employeeNumber` gains a new *behavior* (cleared on release) but no schema change to the column itself; every existing employee record's current `employeeNumber` value is preserved exactly as-is (grandfathered, §5) |
| **Employment Periods** | Reused, unmodified — the confirmation event's own `newState` shape gains one new optional key (`probationReviewId`), which is fully backward-compatible since `newState` was always free-form JSON with no fixed schema |
| **Employee Documents** | Reused, unmodified — only a new nullable FK reference *from* `personnel_files` *to* `employee_documents`, never the reverse, never a schema change to `employee_documents` itself |
| **Audit Infrastructure** | Reused, unmodified — new event types recorded through the existing `recordAuditEvent` mechanism, no new audit table |

`employees.id` is not replaced by, aliased to, or made interchangeable with either the staff number or the PIF number anywhere in this document — it remains the sole technical employee identity, exactly as it is today.

---

## 16. Approved V1 Deferrals

Barcode/QR generation and scanning (Decision 9); physical-file stocktaking/reconciliation (Decision 10); broad automatic document filing beyond prepopulation (Decision 14); bulk legacy import (Decision 19, its own later workstream); any Payroll/SSNIT contribution processing of any kind (§12); fixing the broad `employee.read` gap (Decision 20, remains a separate, disclosed, pre-existing item); Employee Self Service and Manager Portal visibility into personnel records (§13); probation-extension and confirmation-rejection workflows beyond what already exists today (§8).

---

## 17. Frozen Workstreams (W114–W121)

### W114 — Foundation, Numbering & Identifier History
**Objective**: the numbering engine (§4), `numbering_sequences`, `employee_number_allocations`, the concurrency-safe generator replacing `generateEmployeeNumber`, and the release/reuse lifecycle service layer (§5).
**Backend impact**: new `lib/numbering.ts`-style service module; `employees.employeeNumber` write path changes to route through the new allocation service instead of the generic `PATCH` spread (closing the pre-existing no-audit-trail gap as a side effect).
**Database impact**: `numbering_sequences`, `employee_number_allocations`, both with the concurrency-safe patterns in §4/§5.
**API impact**: new allocation/release/reuse endpoints; existing employee create/update routes stop accepting a raw `employeeNumber` write, routing through the new service instead.
**Frontend impact**: none required yet — a minimal internal test surface only, if needed for verification.
**Authorization**: new `employee_number.allocate` permission.
**Audit**: allocation/release/reassignment events.
**Tests**: concurrency races (§4/§5's own explicit scenario list), grandfathering behavior, release-blocked-while-active enforcement.
**Live QA**: real allocation/release/reuse cycle against disposable fixtures; a genuine concurrent-allocation race proven live.
**Cleanup**: standard disposable-fixture discipline, matching every prior phase.
**Definition of Done**: the full staff-number lifecycle (§5) proven end-to-end, live-verified, zero regression in existing employee create/update behavior.
**STOP boundary**: no PIF/personnel-file work yet. Do not begin W115 without its own separate go-ahead.

### W115 — Personnel File Registry & PIF Linkage
**Objective**: `personnel_files` (§7a), PIF-number allocation (reusing W114's own numbering engine, its own independent `numbering.pifNumber` config), employee-UUID ↔ staff-number-history ↔ PIF-number relationship display (§10's own data model, not yet the search UI).
**Database impact**: `personnel_files`.
**API impact**: personnel-file CRUD (create, read, PIF allocation).
**Frontend impact**: none required yet — a minimal internal test surface only, if needed.
**Authorization**: `personnel_file.read`, `personnel_file.manage`.
**Audit**: personnel-file creation, PIF allocation.
**Tests**: PIF permanence (never released/reassigned under any tested scenario, including staff-number reuse), 1:1 employee linkage integrity.
**Live QA**: real personnel-file + PIF creation; a real staff-number reuse scenario proving the PIF number never moves.
**Cleanup**: standard discipline.
**Definition of Done**: PIF lifecycle (§7a items 1-3) proven end-to-end, live-verified.
**STOP boundary**: no physical filing/locations/movement yet. Do not begin W116 without its own separate go-ahead.

### W116 — Physical Filing, Locations & Movement
**Objective**: `records_locations` (§6, self-referencing hierarchy), `personnel_file_volumes` (§8), `personnel_file_movements` (§7b, event-sourced), the concurrency-safe custody-state model.
**Database impact**: `records_locations`, `personnel_file_volumes`, `personnel_file_movements`, plus the denormalized custody-state cache columns on `personnel_files`/`personnel_file_volumes`.
**API impact**: location CRUD, checkout/return/mark-missing/recover endpoints.
**Frontend impact**: none required yet.
**Authorization**: `personnel_file.movement.write` (actions), `personnel_file.manage` (locations/volumes), `personnel_file.read` (viewing history).
**Audit**: every movement event, location changes, volume creation.
**Tests**: the full concurrency scenario list in §7b (double checkout, double return, concurrent attempts, missing/recovery transitions, location-update races); overdue derived correctly, never persisted.
**Live QA**: a real checkout → mark-missing → recover → return cycle; a genuine concurrent-checkout race proven live.
**Cleanup**: standard discipline.
**Definition of Done**: the full physical custody model (§7b) proven end-to-end, live-verified.
**STOP boundary**: no WWM-specific form/workflow reconciliation yet. Do not begin W117 without its own separate go-ahead.

### W117 — WWM Forms / HR Workflow Reconciliation
**Objective**: the working-days notice-period extension (Decision 11); WWM's own Performance rating scale/template (Decision 12, configuration only — verify no code change is actually needed); the probation-review dedicated assignment path and its narrow eligibility branch (Decision 13/§8).
**Database impact**: one nullable column (`leave_policies.noticePeriodCountsWorkingDaysOnly`).
**API impact**: the notice-period check extended; a new probation-assignment endpoint (or an existing endpoint's own narrow new branch).
**Frontend impact**: minimal — surfacing the working-days flag in Leave policy configuration if a UI already exists for policy editing.
**Authorization**: reuses existing Performance/Leave permissions — no new permission for this workstream.
**Audit**: reuses Performance's own existing review-lifecycle audit events; the confirmation event's own `newState.probationReviewId` key.
**Tests**: probation-eligible-only-for-probation-cycle-type (proving `all_active`/`department`/`position`/ordinary `manual` scopes remain unaffected for every other cycle type); working-days notice-period calculation against a real holiday calendar.
**Live QA**: a real probation-cycle review assignment, completion, and confirmation-linkage cycle.
**Cleanup**: standard discipline.
**Definition of Done**: probation-review architecture (§8) proven end-to-end, live-verified; zero regression in any existing Performance cycle-type behavior.
**STOP boundary**: no search/automation/workspace UI yet. Do not begin W118 without its own separate go-ahead.

### W118 — Search, Automation & HR Workspace
**Objective**: the cross-search model (§10, including historical staff-number search); prepopulation in `employee-detail.tsx`-style personnel-record views (Decision 14); separation-time warnings (§11).
**Database impact**: none beyond prior workstreams.
**API impact**: extended search endpoint; separation-warning surface (reusing Assets' own existing report).
**Frontend impact**: the first real personnel-records UI — new cards on the existing `employee-detail.tsx` page (per the discovery pass's own "extend the existing page, don't build a new workspace" recommendation), prepopulated from already-known employee data.
**Authorization**: reuses W114-116's own permissions.
**Audit**: none new — this is a read/UI workstream.
**Tests**: reused-number search returns every allocation, clearly labeled; prepopulation never re-asks for already-known data; separation warnings never block.
**Live QA**: a full HR walkthrough — new employee → number allocation → personnel file → PIF → (later) separation with warnings shown, not blocked.
**Cleanup**: standard discipline.
**Definition of Done**: the HR daily-workflow vision (original discovery §22) demonstrably smoother, live-verified.
**STOP boundary**: no reporting/legacy-import yet. Do not begin W119 without its own separate go-ahead.

### W119 — Reporting / Legacy Import Support
**Objective**: the five Decision-18 reports (via the existing Reporting Foundation, ADR-016); the dedicated legacy-import capability (Decision 19).
**Database impact**: none beyond what import needs to populate already-designed tables.
**API impact**: new report routes (existing pattern); a new import endpoint/tooling.
**Frontend impact**: report access via existing Reporting Foundation UI conventions.
**Authorization**: reports gated by `personnel_file.read`/`employee_number.allocate` as appropriate; import gated by `personnel_file.manage`.
**Audit**: import actions themselves audited (bulk-created allocations/personnel-files each traceable to the import batch).
**Tests**: every report resolves staff numbers via allocation history, never a live join (§6); import never regenerates a supplied legacy identifier; import handles missing/unknown values as nulls, not fabricated data.
**Live QA**: a real CSV import of disposable legacy-style data; report output verified against independently-known-correct fixture data.
**Cleanup**: standard discipline, including import-created fixtures.
**Definition of Done**: reporting and import both proven end-to-end, live-verified.
**STOP boundary**: no Payroll, no SSNIT processing, no QR/barcode, no stocktaking. Do not begin W120 without its own separate go-ahead.

### W120 — Verification
**Objective**: full integrated verification of Phase 3H as one system, mirroring every prior phase's own W-verification charter (W83, W93, W103, W112) exactly — reconciliation against this frozen plan, regression across every module in the compatibility analysis (§15), a fresh integrated live-QA scenario covering the full lifecycle end-to-end (allocation → separation → warning → release → reuse → historical-report-correctness → search-clarity), tenant isolation, and a direct proof that no historical record anywhere was rewritten by a live reuse test.
**Definition of Done**: matches the established verification template exactly — PASS, PASS WITH FIXES, or BLOCKED.
**STOP boundary**: report result. Do not begin W121 without its own separate go-ahead.

### W121 — Completion Report
**Objective**: formal closure, mirroring W94/W104/W108/W113's own exact structure. Reconciles all 20 Owner Decisions plus every frozen requirement in this document against final shipped state. Marks Phase 3H complete only if W120 passed.
**Definition of Done**: `PROJECT_STATUS.md` fully reconciled; next roadmap step identified (Future Expansion, per `ROADMAP.md`) without beginning it.
**STOP boundary**: the final Phase 3H workstream. Do not begin Future Expansion/Payroll without its own separate planning/freeze cycle and go-ahead.

---

## 18. Expected Migration Impact

**Recalculated against the final frozen schema** (not the Owner Review's own preliminary count), current migration ledger confirmed at `0040` (`lib/db/drizzle/0040_boring_rafael_vega.sql`, no `0041` exists). The next migration is expected to contain:

**New tables (7)**: `numbering_sequences`, `employee_number_allocations`, `personnel_files`, `records_locations`, `personnel_file_volumes`, `personnel_file_movements`, and (only if a future, separate decision approves specific sensitive PIF fields) one narrow sensitive-fields table — **not committed by this freeze**, since no specific fields are approved yet.

**New columns (1)**: `leave_policies.noticePeriodCountsWorkingDaysOnly` (nullable boolean).

**New partial unique indexes (2+)**: `employee_number_allocations (organizationId, employeeNumber) WHERE valid_to IS NULL`; `personnel_file_movements (personnelFileId, volumeId) WHERE event_type IN ('checked_out', 'marked_missing')` (or the equivalent "open movement" predicate per §7b's final implementation).

**New permission rows (6)**: `employee_number.allocate`, `personnel_file.read`, `personnel_file.manage`, `personnel_file.movement.write`, `personnel_file.sensitive.read`, `personnel_file.sensitive.write`.

**Zero changes to any existing table's existing columns** — the only *behavioral* (not schema) change is how `employees.employeeNumber` gets written (via the new service layer instead of the generic `PATCH` spread) and cleared (on release).

**This migration is not created by this freeze session** — it is created at the start of W114, per that workstream's own Definition of Done.

---

**This document is FROZEN — APPROVED FOR IMPLEMENTATION. W114 may begin under its own separate explicit go-ahead. No workstream implementation is authorized by the act of freezing this document alone.**
