# Phase 3E — Asset Management: Frozen Implementation Plan

Status: **FROZEN — APPROVED FOR IMPLEMENTATION** (2026-08-21)

This document was produced across two passes: an initial discovery/draft pass (no migrations, no routes, no frontend pages, no permission seeding, no module activation, no production access), and this final-reconciliation pass (10 owner decisions approved, permission-namespace/incident-model/acknowledgement/manager-scope/offboarding-boundary reconciled against those decisions — again with no migration, route, frontend, permission seed, module activation, or production access performed).

**As of this document:** no migration has been created (the latest remains `0039`; the plan's own expected next migration, `0040`, is not yet created), no schema has changed, the module registry entry (`asset_management`) has not been activated (remains `status: "hidden"`), no permission has been seeded, no API route or frontend page exists, and production was not accessed. **W95 still requires its own separate go-ahead**, exactly as W64/W73/W85 each did after their own frozen documents were approved — freezing this document authorizes writing an implementation plan's contents, not beginning implementation.

This document distinguishes three kinds of statement throughout, carried forward from the draft:

- **[ROADMAP REQUIREMENT]** — something `ROADMAP.md`/`PROJECT_STATUS.md` actually says.
- **[PROPOSED DESIGN DECISION]** — a design choice reasoned from existing repository architecture. Now load-bearing on every downstream section, since the plan is frozen.
- **Owner Decision — APPROVED** — resolved below, §0. No `OWNER DECISION — PENDING` marker remains anywhere in this document (verified by search before freezing).

---

## 0. Owner Decisions — Approved (2026-08-21)

The following ten decisions were open in the draft and are now resolved, exactly as approved. They are load-bearing on §5–§27 below — every downstream section has been reconciled to them.

| # | Decision | Approved answer |
|---|---|---|
| 1 | Can employees acknowledge receipt of an assigned asset? | **Yes.** A single `acknowledgedAt` timestamp directly on `asset_assignments` (§5, §9) — "I received this asset" only, never worded as agreement with liability/valuation/condition/deductions/discipline. Server-derived actor, server-generated timestamp. Only possible while the assignment is still open (`custodyEndedAt IS NULL`); a repeat attempt is rejected via the same atomic-conditional-UPDATE-guarded-by-prior-state pattern every other lifecycle transition on this platform already uses — the second caller gets a `409`, never a silent overwrite. The value is never cleared on return, so historical acknowledgement remains permanently visible. |
| 2 | Can employees report loss/damage themselves? | **Yes, report-only.** A new `asset_incidents` table (§5) — the employee creates a report; it never mutates `assets.status`/`.condition` directly. Only `asset_management.manage` can act on it. No case management, no disciplinary workflow, no payroll deduction, no insurance claim — a report plus a review/dismiss outcome, nothing more. |
| 3 | Can managers view assets assigned to their direct reports? | **Yes, current custody only.** No `asset_management.read.team` — the existing `reportingManagerId` relationship, resolved live at request time, exactly like every other module's own manager-of-record scope. **Historical (returned/closed) assignments are NOT manager-visible in V1** — only HR/Asset-management (`asset_management.manage`) and the employee's own `asset_management.read.own` reach historical rows. The manager relationship is never snapshotted as continuing authority: if an employee stops reporting to a given manager, that manager immediately loses visibility, including retroactively into what was previously visible. |
| 4 | Can managers assign/return assets? | **No.** Managers get scoped visibility only (§15). Assignment/return/status/condition/maintenance/retirement remain exclusively `asset_management.manage`. No manager mutation engine. |
| 5 | Does outstanding-asset status block offboarding? | **No hard block. Warning/reporting only.** No coupling into `lib/employees.ts`/`separateEmployee`. Assets V1 owns exactly one authoritative capability here: answering "does this employee currently hold any company assets?" via the existing assignment-scope query and the `asset_unreturned_by_employee` report (§17). Since `employee_exit_processes` has no frontend today (confirmed, §1), no exit-process-page UI integration is built in this phase — that cross-module UI work is explicitly deferred (§10), while the Assets-side query/report ships now and is independently usable by HR before any separation is finalized. |
| 6 | Is maintenance tracking in V1? | **Yes, simple history only.** `asset_maintenance` (§5) — no scheduling engine, no recurring jobs, no work orders, no vendor management, no reminders, no parts inventory, no SLA engine. |
| 7 | Is purchase cost stored? | **Yes, optional, reference-only.** `purchaseCost` + `purchaseCurrency` (free text, mirroring `job_requisitions.salaryCurrency`'s own exact naming/typing convention — the platform's own established money-field precedent). No depreciation, no book value, no accounting journals, no capitalization, no tax treatment, no financial reporting derived from this figure anywhere. |
| 8 | Do asset categories use Master Data? | **Yes.** Confirmed by direct inspection: the `asset_category` domain (`organization-defined`, zero seeded default items) **already exists** in `lib/db/src/seed/master-data-definitions.ts`, sitting alongside the already-registered `asset_management` module key — pre-planned by this platform's own architects, identical precedent to `training_category`. **No new domain registration is needed at all** — this is a correction from the draft, which had incorrectly assumed the domain needed to be newly added. |
| 9 | Is evidence/documents included? | **Yes.** Reuses `employee_documents`/`fileStorage.ts`/`documentValidation.ts` verbatim via a new `asset_evidence` join table (§5, §13) — no second storage system, no public URLs. |
| 10 | Should "disposed" be a separate status? | **No.** Five statuses only (§7): `available`/`assigned`/`maintenance`/`lost`/`retired`. `retired` is permanently terminal, no reopen. The specific reason (normal retirement, disposal, write-off, other) is captured as mandatory free text on the retirement action itself, not as a lifecycle fork. |

**No `OWNER DECISION — PENDING` marker remains anywhere in this document** — verified by search immediately before freezing (§32 of the reconciliation session's own final-review checklist).

---

## 1. Roadmap Findings (Unchanged From Draft)

**[ROADMAP REQUIREMENT]** `ROADMAP.md`'s Phase 3 list contains exactly one line — "Assets" — with no further detail. `PROJECT_STATUS.md`'s "Future Modules" list names the same item "Asset Management." Everything beyond that one line in this document is a **[PROPOSED DESIGN DECISION]** or an **Owner Decision — APPROVED**, never itself roadmap text.

---

## 2. Existing Foundations Reused (Verified by Direct Inspection, Re-Confirmed for This Freeze)

- **Module registry already contains `asset_management`**, `status: "hidden"`, `defaultEnabled: false` (`lib/db/src/seed/module-definitions.ts`) — the identical pre-registration pattern every prior Phase 3 module went through. **Not activated by this document.**
- **The `asset_category` Master Data domain already exists** (`organization-defined`, zero seeded items) in `lib/db/src/seed/master-data-definitions.ts` — a repository fact discovered during this reconciliation pass, not something W95 needs to add.
- **No `asset`/`assets`/`asset_management`-prefixed table, route, permission, or frontend page exists anywhere.** Zero conflict risk.
- `employee_documents` + `fileStorage.ts` + `documentValidation.ts` — reusable verbatim (§13).
- `branches`, `departments`, `employees` (`employmentStatus`, `separationDate`/`separationReason`, `reportingManagerId`) — reusable as-is.
- `employee_exit_processes` (Phase 2A, W29) — backend-only, **no frontend page exists for it anywhere**, confirmed again for this freeze. The offboarding boundary (§10, Decision 5) accounts for this directly.
- Master Data registry (`master-data-domains.ts`/`master-data-items.ts`), Reporting Foundation registry (`reports.ts`/`report-definitions.ts`/`reporting.ts`), audit log (`audit-events.ts`/`auditLog.ts`), the manager-of-record live-relationship authorization pattern, `assertBelongsToOrganization`-style cross-org validation — all directly reusable, none needing modification.
- **Money-field convention, confirmed by direct inspection this freeze:** `job_requisitions.salaryRangeMin`/`.salaryRangeMax` (`numeric(12,2)`) + `salaryCurrency` (plain `text`) — no currency table, no FX logic anywhere on this platform. Assets' own `purchaseCost`/`purchaseCurrency` (§5, Decision 7) follows this exact naming/typing shape.

---

## 3. Domain Boundary (Unchanged From Draft)

In scope: an organization-defined-category register of durable equipment issued to employees. Explicitly out of scope: retail/warehouse inventory, accounting depreciation, procurement/PO/vendor management, fleet management, IT remote-device management, consumables inventory — reasoning unchanged from the draft (each is a structurally different system).

---

## 4. Asset Categories & Reference Data — Final

- **Category:** the already-registered `asset_category` Master Data domain (§2, Decision 8) — organizations define their own category codes, no seeded defaults, identical precedent to `training_category`.
- **Condition:** a fixed enum (`new`/`good`/`fair`/`poor`/`damaged`), not Master Data — a bounded, universal concept, reasoning unchanged from the draft.
- **Location:** the existing `branches` table (`branchId`), not a new location concept — reasoning unchanged.
- **Maintenance type:** free text, not Master Data — reasoning unchanged.
- **Disposal/retirement reason:** mandatory free text on the retirement action (§7, §12, Decision 10) — reasoning unchanged.
- **Incident type:** a small fixed enum (`damage`/`loss`) on `asset_incidents` (§5) — the same "bounded, universal, not organization-specific" reasoning as `condition`.

---

## 5. Final Data Model — 5 Tables

**Table count changed from the draft's 3–4 (contingent) to a definite 5**, because Decision 2 (employee incident reporting) requires a genuinely new table beyond what the draft proposed — disclosed explicitly here, not hidden. Final table set: **`assets`, `asset_assignments`, `asset_maintenance`, `asset_evidence`, `asset_incidents`.**

### `assets`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetTag` | text, NOT NULL | Server-generated, sequential per-organization (`AST-00001`, ...), never client-supplied. Unique `(organizationId, assetTag)`. |
| `categoryCode` | text, NOT NULL | Free-text code from the already-registered `asset_category` domain (§4) — not FK-validated against the domain's item list, identical precedent to `learning_courses.categoryCode`. |
| `name` | text, NOT NULL | |
| `description` | text, nullable | |
| `manufacturer` | text, nullable | |
| `model` | text, nullable | |
| `serialNumber` | text, nullable | Unique per organization only when present — partial unique index `(organizationId, serialNumber) WHERE serialNumber IS NOT NULL`. |
| `branchId` | int, FK `branches`, `set null`, nullable | Current physical location — **live reference** (§14). |
| `purchaseDate` | date, nullable | |
| `purchaseCost` | numeric(12,2), nullable | Decision 7 — reference figure only. |
| `purchaseCurrency` | text, nullable | Decision 7 — mirrors `job_requisitions.salaryCurrency`'s exact naming/typing convention. |
| `warrantyExpiryDate` | date, nullable | |
| `condition` | enum (`new`/`good`/`fair`/`poor`/`damaged`), NOT NULL, default `"good"` | |
| `status` | enum (`available`/`assigned`/`maintenance`/`lost`/`retired`), NOT NULL, default `"available"` | Sole-authoritative lifecycle field (§7). |
| `notes` | text, nullable | |
| `createdBy` | int, FK `users`, `set null`, nullable | |
| `createdAt`/`updatedAt` | timestamptz | |

### `asset_assignments` (custody history)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `cascade`, NOT NULL | Defensive-only cascade (assets are never deleted in practice). |
| `employeeId` | int, FK `employees`, `restrict`, NOT NULL | **Live reference** (§14). |
| `assetTagSnapshot` / `assetNameSnapshot` / `categorySnapshot` | text, NOT NULL | **Snapshot** (§14). |
| `departmentIdSnapshot` / `positionIdSnapshot` | int, nullable | Employee's department/position **at issue time** — **snapshot** (§14). |
| `issuedAt` | timestamptz, NOT NULL | |
| `issuedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `expectedReturnDate` | date, nullable | |
| `issueCondition` | enum (condition), NOT NULL | |
| `issueNotes` | text, nullable | |
| `acknowledgedAt` | timestamptz, nullable | **Decision 1.** Set once, only while `custodyEndedAt IS NULL`; never cleared, including after return. |
| `acknowledgementNote` | text, nullable | Optional employee comment at acknowledgement — low-cost, consistent with the "optional notes" pattern used everywhere else on this platform; not itself a business-rule field. |
| `custodyEndedAt` | timestamptz, nullable | **Renamed from the draft's `returnedAt`** during this reconciliation — the draft's own name read oddly for a `lost`/`transferred` closure that isn't literally a "return." `NULL` means this is the currently-active assignment (the sole basis for the "who currently has this" query and the one-active-assignment-per-asset constraint below). |
| `endReason` | enum (`returned`/`lost`/`transferred`/`retired`), nullable | Why this custody period ended; only meaningful once `custodyEndedAt` is set. |
| `receivedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | Only meaningful for `endReason='returned'`. |
| `returnCondition` | enum (condition), nullable | Only meaningful for `endReason='returned'`. |
| `returnNotes` | text, nullable | |
| `createdAt`/`updatedAt` | timestamptz | |

**Uniqueness:** partial unique index `(assetId) WHERE custodyEndedAt IS NULL` — at most one active assignment per asset, database-enforced (§24).

### `asset_maintenance` (Decision 6)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `cascade`, NOT NULL | |
| `maintenanceType` | text, NOT NULL | Free text (§4). |
| `description` | text, nullable | |
| `providerText` | text, nullable | Free-text vendor/provider name — no vendor table. |
| `status` | enum (`scheduled`/`in_progress`/`completed`/`cancelled`), NOT NULL, default `"scheduled"` | |
| `startedAt` | timestamptz, nullable | |
| `completedAt` | timestamptz, nullable | |
| `cost` | numeric(10,2), nullable | Same reference-figure-only treatment as `assets.purchaseCost`. |
| `notes` | text, nullable | |
| `createdByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `createdAt`/`updatedAt` | timestamptz | |

### `asset_evidence` (Decision 9)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `cascade`, NOT NULL | Attaches to the asset only (§13) — no polymorphic attachment target. |
| `employeeDocumentId` | int, FK `employee_documents`, `restrict`, NOT NULL | Mirrors the Learning/Performance evidence precedent exactly. |
| `addedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `addedAt` | timestamptz, NOT NULL | |

### `asset_incidents` (NEW — required by Decision 2, not in the original draft's table count)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `restrict`, NOT NULL | `restrict`, not `cascade` — incident history must survive regardless of the asset's own later lifecycle. |
| `assignmentId` | int, FK `asset_assignments`, `restrict`, NOT NULL | The specific custody period the report concerns — required, since Decision 2 scopes reporting to "an asset currently assigned to them." |
| `reportedByEmployeeId` | int, FK `employees`, `restrict`, NOT NULL | **Server-derived from caller identity**, never client-supplied — the employee must equal `asset_assignments.employeeId` for the referenced `assignmentId`, enforced in the service layer. |
| `incidentType` | enum (`damage`/`loss`), NOT NULL | |
| `description` | text, NOT NULL | |
| `reportedAt` | timestamptz, NOT NULL, default now() | Server-generated. |
| `status` | enum (`open`/`reviewed`/`dismissed`), NOT NULL, default `"open"` | Minimal lifecycle (§7 of this section). |
| `reviewedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `reviewedAt` | timestamptz, nullable | |
| `resolutionNotes` | text, nullable | Free text — may reference what asset-level action (if any) was separately taken; **no hard FK to a "resulting action,"** deliberately, to avoid drifting into case management. |
| `createdAt`/`updatedAt` | timestamptz | |

Indexes: `(organizationId, assetId)`, `(organizationId, status)` (for the HR-facing open-incidents queue, §19).

**Expected next migration: `0040`** — confirmed against the current ledger (`0039` remains latest). **Not created by this document.**

---

## 6. Field-Level Reasoning (Unchanged From Draft Except Currency Naming)

Asset tag: server-generated, sequential, per-organization, never client-supplied. Serial number: unique per organization only when present, never required. Purchase cost/currency: Decision 7, `purchaseCost`/`purchaseCurrency`, mirroring `job_requisitions`' own exact convention (§2). Depreciation: explicitly out of V1.

---

## 7. Final Asset Lifecycle

**Five statuses** (Decision 10): `available`, `assigned`, `maintenance`, `lost`, `retired`.

**Frozen transitions, reconciled for custody integrity (not the master prompt's example taken blindly):**

```
available  → assigned     (issue: creates a new asset_assignments row)
assigned   → available    (return: closes the active assignment, endReason='returned')
available  → maintenance  (no active assignment exists)
assigned   → maintenance  (the active assignment row stays OPEN — custodyEndedAt remains
                            NULL — the asset is recalled for service, custody is not relinquished)
maintenance → available   (derived automatically: no active assignment row exists for this asset)
maintenance → assigned    (derived automatically: an active assignment row still exists for
                            this asset — completing maintenance simply returns the asset to
                            the custodian who never formally lost it)
available  → lost         (misplaced/stolen while not assigned to anyone)
assigned   → lost         (closes the active assignment, endReason='lost', custodyEndedAt set —
                            the custody period is over even though nothing was physically
                            "returned")
maintenance → lost        (lost in transit/at a service provider — rare, but structurally
                            identical to the available→lost case)
lost       → retired      (formally write off an asset that was never recovered)
lost       → available    (recovery — an explicit, real, audited transition, `asset_management.manage`-
                            only, mandatory reason, event `asset.recovered` — NOT a hidden
                            "administrative correction" side-channel; `lost` is terminal in the
                            sense that nothing happens automatically, but it is not
                            database-enforced terminal the way `retired` is)
available  → retired      (direct retirement of an unassigned asset)
maintenance → retired     (an asset that fails service is retired straight from maintenance)
assigned   → retired      NOT ALLOWED DIRECTLY — the assign-side custody must close first
                            (return, or be marked lost/transferred) before an asset can be
                            retired; enforced by the retire route's own conditional UPDATE
                            (`WHERE status IN ('available','maintenance','lost')`), returning a
                            controlled 409 ("this asset is currently assigned — return it
                            before retiring") rather than silently retiring out from under an
                            active custodian.
retired    → (nothing)    PERMANENTLY TERMINAL. No reopen path anywhere, hidden or otherwise
                            (Decision 10, and this session's own explicit "no hidden reopen
                            path" instruction).
```

**Whether maintenance returns an asset to `available` or `assigned` is never caller-supplied** — it is derived server-side from whether an active (`custodyEndedAt IS NULL`) `asset_assignments` row still exists for that asset at the moment maintenance completes, eliminating an entire class of caller-supplied-wrong-target-state bugs.

**Who may transition:** every transition is `asset_management.manage`-only (§15) — no employee or manager mutation authority anywhere in this lifecycle, per Decision 4.

**Concurrency:** every transition is an atomic conditional `UPDATE ... WHERE status = '<expected prior status>'` (§24).

### Assignment lifecycle (open/closed)

Open: `custodyEndedAt IS NULL`. Closed: `custodyEndedAt IS NOT NULL` + `endReason` set. **A closed assignment row is never reopened** — a transfer or re-issue always creates a brand-new row, identical discipline to every other historical record on this platform.

### Maintenance lifecycle

`scheduled → in_progress → completed | cancelled`. `completed` and `cancelled` are both terminal — no reopen; a further service need on the same asset creates a new `asset_maintenance` row.

### Incident lifecycle (NEW)

`open → reviewed | dismissed`. Both terminal — no reopen; a further/repeat report on the same asset creates a new `asset_incidents` row, identical "new row, not a reopened old one" discipline used everywhere else in this plan.

---

## 8. Assignment / Custody Model (Unchanged From Draft)

Dedicated `asset_assignments` history table, not a mutable `assets.employeeId` pointer — reasoning unchanged. Employee-only assignment target for V1 — department/location custody explicitly deferred, reasoning unchanged.

---

## 9. Issue / Return / Acknowledgement Workflow — Final

**Issue** (`available → assigned`): atomic — conditional status UPDATE + new `asset_assignments` row insert, in one transaction, mirroring Learning's own certificate-issuance transaction shape.

**Return** (`assigned → available`, or `→ maintenance` in the same call if return notes indicate a service need): closes the active assignment row and atomically updates `assets.status`, one transaction.

**Acknowledgement (Decision 1, frozen):**
- **Who:** the assignment's own `employeeId`, resolved server-side from the caller's linked employee record — never a client-supplied target, identical discipline to every other own-scoped route on this platform.
- **Prerequisite:** the assignment must still be open (`custodyEndedAt IS NULL`); an already-returned/closed assignment cannot be retroactively acknowledged.
- **Timestamp:** server-generated (`now()`), never client-supplied.
- **Optional comment:** `acknowledgementNote`, free text, not a business-rule field.
- **After return:** `acknowledgedAt` is never cleared — historical acknowledgement remains permanently visible on the (now-closed) assignment row.
- **Repeat/concurrent acknowledgement:** an atomic conditional UPDATE (`WHERE id=:id AND employeeId=:callerEmployeeId AND custodyEndedAt IS NULL AND acknowledgedAt IS NULL`) — a second call, concurrent or sequential, affects 0 rows and returns a controlled `409` ("already acknowledged"), never a silent overwrite.
- **Wording constraint (Decision 1):** the frontend control's own copy must read as "I confirm I received this item," never anything implying agreement to liability, valuation, condition, deductions, or disciplinary responsibility — a UI/content requirement, not a schema one, but explicitly recorded here so it is not lost between this plan and implementation.

---

## 10. Offboarding Boundary — Final

**Decision 5 (§0), frozen exactly.** Assets V1 owns precisely one authoritative capability: a live query answering "does employee X currently hold any active (unreturned) asset assignments?" — already fully expressible via the existing own/manager/org-wide assignment-scope query and the `asset_unreturned_by_employee` report (§17), filterable by `employeeId`. **No hard block, no database trigger, no coupling into `lib/employees.ts`/`separateEmployee` — an organization with the `asset_management` module disabled, or with zero assets ever registered, must never be prevented from terminating an employee.**

**What is explicitly deferred, not built here:** any UI integration into the `employee_exit_processes` workflow — that page doesn't exist yet (§2), and building a new one, or extending that backend-only record's own schema to reference Assets, is out of this phase's own scope. A future, separately-scoped Offboarding/Exit-Process phase can surface Assets' own report/query inside whatever UI it eventually builds, at that point — this phase ships the capability standalone and independently usable (an HR admin can already run the `asset_unreturned_by_employee` report, filtered by employee, before finalizing any separation, entirely through the Assets workspace) without waiting for that future integration.

---

## 11. Maintenance — Final (Decision 6)

Unchanged from the draft's own reasoning: simple history only, four states (§7), no scheduling/dispatch/work-order/vendor-management/reminder/parts-inventory/SLA functionality.

---

## 12. Loss, Damage & Disposal — Final

- **Damage:** a `condition` update to `damaged`, mandatory reason, audited (`asset.condition_updated`).
- **Loss/theft:** `status → lost` (§7), mandatory reason, audited (`asset.marked_lost`); distinguishing lost vs. stolen is captured in the mandatory reason text, not a separate status.
- **Retirement/disposal (Decision 10):** `status → retired`, mandatory reason describing the method (normal retirement/disposal/write-off/other), audited (`asset.retired`). One terminal status, no `disposed` fork.
- **Recovery:** `lost → available` (§7), an explicit, real, audited, mandatory-reason transition — not a hidden correction path.
- **Historical custody is never deleted** regardless of any of the above.
- **Optional evidence** attaches via `asset_evidence` (§5, §13), never a precondition for the transition itself.

---

## 13. Documents / Evidence — Final (Decision 9)

Reuses `employee_documents`/`fileStorage.ts`/`documentValidation.ts` verbatim via `asset_evidence` (§5) — identical allowlist/cap/signature-validation/authenticated-only-download/no-public-URL discipline as Learning's W90 and Performance's W82. Attaches to the asset only. Covers purchase receipt, warranty, issue/assignment evidence, return evidence, damage/loss evidence, maintenance invoice, retirement/disposal evidence — as an undifferentiated list on the asset's own timeline, annotated by filename/upload-time metadata already present on `employee_documents`, not a rigid evidence-type taxonomy.

---

## 14. Historical Integrity — Snapshot Rules (Final)

| Relationship | Classification | Reasoning |
|---|---|---|
| `asset_assignments.employeeId` | **LIVE REFERENCE** | Needed to resolve current identity/current department for manager-scope filtering (§3, §15). |
| `asset_assignments.assetTagSnapshot`/`.assetNameSnapshot`/`.categorySnapshot` | **SNAPSHOT** | A later asset rename/recategorization must never rewrite a historical custody record's own display. |
| `asset_assignments.departmentIdSnapshot`/`.positionIdSnapshot` | **SNAPSHOT** | The employee's department/position **at issue time** — a later transfer/promotion never reinterprets who was responsible for an asset in what role at the time it was issued. |
| `asset_assignments.issueCondition`/`.returnCondition` | **SNAPSHOT** (point-in-time by construction) | Historical facts, never re-derived from the asset's own current condition. |
| `assets.branchId` | **LIVE REFERENCE** | Tracks the asset's actual present location; no "location at time of X" question exists for this field. |
| `assets.categoryCode` | **LIVE on the asset row, SNAPSHOT on each assignment** | The asset's own category can be corrected going forward; each historical assignment keeps its own `categorySnapshot` unaffected. |
| `asset_maintenance.assetId` | **LIVE REFERENCE** | No snapshot question — maintenance is inherently tied to current asset identity. |
| `asset_evidence.employeeDocumentId` | **LIVE REFERENCE**, `restrict`-protected | Mirrors the Learning/Performance precedent exactly. |
| `asset_incidents.assignmentId`/`.reportedByEmployeeId` | **LIVE REFERENCE**, `restrict`-protected | An incident report is inherently about a specific real assignment/employee; `restrict` (not `cascade`) ensures the report itself is never silently lost. |

---

## 15. Authorization Model — Final

### Permission Namespace Reconciliation (Required Investigation, Now Resolved)

**Finding, from direct inspection of `lib/db/src/seed/seed-roles-permissions.ts` and `module-definitions.ts`:** this platform has **two coexisting permission-namespace conventions**:

1. **Flat namespace matching the module's own registry key exactly** — Learning (module `learning` → `learning.read.own`/`.write.own`/`.review.write`/`.manage`/`.reports.read`), Performance (module `performance` → `performance.read.own`/`.write.own`/`.review.write`/`.manage`/`.reports.read`/`.finalize`), Attendance (module `attendance` → `attendance.read.own`/`.clock.own`/`.manage`/`.adjustment.approve`). Every one of these three is a single, cohesive HR-operations module, exactly the shape Assets is.
2. **Entity-level namespaces, one per sub-concern, independent of the module key** — Leave (module `leave` → `leave_request.*`, `leave_type.*`, `public_holiday.*`, three genuinely separate entities with different audiences) and Recruitment (module `recruitment` → mostly entity-scoped, `recruitment.reports.read` only for its reporting surface).

**Assets is structurally a single cohesive module** (one register, one custody model, one reporting surface — not several loosely related entities each needing independently-grantable permissions the way Leave's types/requests/holidays genuinely are), and it is being built as a direct architectural sibling of Learning/Performance/Attendance (same `hr-operations` module category, same dual-tier permission-plus-relationship-authorization pattern, same 4-key shape the draft already proposed). **Pattern 1 is therefore the correct fit — the permission prefix must match the module registry key exactly.**

**The module key is `asset_management`, not `assets`** (§2). **Therefore the frozen permission namespace is `asset_management.*`, not `assets.*`** — a direct correction from the draft, made explicitly rather than silently, per this reconciliation's own instruction.

### Final Permission Set (4 keys, `asset_management.*`)

- **`asset_management.read.own`** — the single coarse-floor read permission held by every role including plain `employee`; fine-grained scope (own / manager-of-record-current-only / organization-wide) is resolved server-side from the caller's actual permission tier and live relationships, exactly mirroring `learning.read.own`'s own dispatch pattern. **No `.read.team` key** (Decision 3).
- **`asset_management.write.own`** — **reconsidered explicitly per this reconciliation's own instruction, now that acknowledgement and incident reporting are both approved.** Authorizes **exactly two** narrow, own-scoped actions and nothing else:
  1. `POST .../asset-assignments/:id/acknowledge` — only on the caller's own currently-open assignment.
  2. `POST .../assets/:id/report-issue` — only on an asset currently assigned to the caller.

  **This permission never authorizes any change to `assets.status`, `assets.condition`, an assignment's own `custodyEndedAt`/`endReason`, or any maintenance/retirement/evidence-deletion action, under any circumstance** — stated here as an explicit, permanent invariant, not merely an implementation-time convention, per this reconciliation's own explicit requirement.
- **`asset_management.manage`** — the full HR/Asset-Officer authority: register/edit/retire assets, issue/return/mark-lost/recover, maintenance CRUD, review/dismiss incidents, evidence upload/download, organization-wide reports. **Not role-gated to a hardcoded "Asset Officer" role** — any role holding this permission (typically `hr_manager`/`org_admin`/`super_admin`, but organization-customizable per this platform's own existing role-copy-and-customize mechanism) has full authority, matching the instruction's own "IT/Asset Officer should be represented by permission assignment, not a hardcoded role."
- **`asset_management.reports.read`** — dashboard + reports, same own/manager-of-record-current-only/organization-wide scope model as `.read.own`, mirroring Learning's own W92 reporting-scope model exactly.

### Final Role/Permission Matrix

| Role | `.read.own` | `.write.own` | `.manage` | `.reports.read` |
|---|---|---|---|---|
| `employee` | ✅ | ✅ (acknowledge own + report own incidents only) | ❌ | ✅ (own-scoped reach only) |
| manager-of-record | (relationship, not a role — same base grants as `employee`, plus server-resolved current-direct-report visibility via `.read.own`/`.reports.read`'s own scope dispatch) | — | ❌ | ✅ (own + current-direct-report scope) |
| `hr_manager` | ✅ | ✅ | ✅ | ✅ |
| `org_admin` | ✅ | ✅ | ✅ | ✅ |
| `super_admin` | ✅ | ✅ | ✅ | ✅ |

---

## 16. Module Activation (Unchanged From Draft)

`asset_management` already exists, `status: "hidden"`. W95 (§27) proposes the flip to `"active"` — **not performed by this document.**

---

## 17. Reporting — Final

Three reports, category `asset_management`, registered in the shared Reporting Foundation registry, executed through a dedicated `GET .../assets/reports/:reportKey` route:

| Report key | Purpose | Semantics | Filters | Scope | CSV |
|---|---|---|---|---|---|
| `asset_register` | Full asset list with current status/condition/location/current holder. | Row-level, one row per in-scope asset. | `categoryCode`, `status`, `branchId` | org-wide only | Yes, identical scope to JSON. |
| `asset_unreturned_by_employee` | Outstanding (currently-assigned) assets — doubles as the offboarding-boundary query (§10). | Row-level, one row per active `asset_assignments` record. | `employeeId`, `departmentId` | own / manager-of-record-current-only / organization-wide | Yes. |
| `asset_maintenance_history` | Maintenance events over a date range. | Row-level, one row per `asset_maintenance` record. | `assetId`, `status`, date range | organization-wide only | Yes. |

No 4th report for incidents in V1 — the incident queue itself is better served as a live operational list inside the internal workspace (§19) than a historical report; if a future need arises, adding one is a small extension, not a V1 requirement. No financial/depreciation report — out of scope (§3, §7).

---

## 18. Dashboard — Final

Deterministic tiles only, no financial/rate/KPI tile:

- `totalAssetCount` (in scope for the caller).
- Zero-filled status breakdown (`available`/`assigned`/`maintenance`/`lost`/`retired`).
- `employeesWithAssignedAssetsCount` (distinct, in scope).
- `overdueReturnCount` (active assignments past their `expectedReturnDate`, only for assignments that set one).
- `openIncidentCount` (`asset_incidents.status = 'open'`, in scope) — added during this reconciliation, since Decision 2's own incident model gives the dashboard a genuinely new, deterministic, useful signal the draft's own dashboard proposal didn't yet have.

Scope: own / manager-of-record-current-only / organization-wide, resolved from `asset_management.reports.read`.

---

## 19. Frontend Surfaces — Final

- **HR/Admin:** `/assets` (register — list/create/detail/edit/retire, with assignment/return/acknowledgement-history/maintenance/evidence/incident-review all nested in the same detail view, mirroring `/learning-courses`'s own nested-panel convention rather than spawning separate pages for one entity's own facets); `/asset-workspace` (org-wide operational surface — assignment queue, outstanding returns, the open-incident queue, lost/retired history — reusing every register/assignment/incident route verbatim, mirroring Learning's own W91 "zero new backend logic" finding); `/assets-dashboard`, `/asset-reports`.
- **Employee ESS:** a new "My Assets" tab on the existing `/self-service` page — own current + historical assignments, the acknowledgement control (Decision 1), the report-issue control (Decision 2) — independently module-gated, no second employee portal.
- **Manager (Decision 3, newly approved):** a "Team Assets" surface — current custody for current direct reports only, no historical reach, no mutation controls anywhere — following the existing per-module manager-surface precedent (mirrors `/learning-team-training`'s own shape, read-only here since Decision 4 grants no manager actions).

All surfaces: `<SecureRoute moduleKey="asset_management">` / the ESS tab's own independent in-page check, nav-gated `isHrCapable`-only where the underlying route requires organization-wide authority, backend remaining the real gate regardless of nav visibility — identical convention to every existing module.

---

## 20. Final API Contract (Planning Only — No Route Code)

Every route: `requireAuth → requireMembership("organizationId") → requireModuleEnabled("asset_management") → requirePermission(...)`.

**Asset register**
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `.../assets` | `asset_management.manage` (org-wide) | Paginated, filterable. |
| POST | `.../assets` | `asset_management.manage` | Server-generates `assetTag`. |
| GET | `.../assets/:id` | `asset_management.manage` (org-wide) or own-scope reach if currently assigned to the caller | |
| PATCH | `.../assets/:id` | `asset_management.manage` | Base fields only, never `status`. |
| POST | `.../assets/:id/retire` | `asset_management.manage` | Mandatory reason; `409` if currently `assigned`. |
| POST | `.../assets/:id/mark-lost` | `asset_management.manage` | Mandatory reason; closes any active assignment (`endReason='lost'`). |
| POST | `.../assets/:id/recover` | `asset_management.manage` | `lost → available` only; mandatory reason. |
| POST | `.../assets/:id/condition` | `asset_management.manage` | Mandatory reason, audited. |

**Assignments**
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `.../assets/:id/assign` | `asset_management.manage` | `available → assigned` only; atomic + snapshot capture. |
| POST | `.../assets/:id/return` | `asset_management.manage` | Closes active assignment; optional same-call routing to `maintenance`. |
| GET | `.../assets/:id/assignments` | `asset_management.manage` (org-wide, full history) or own-scope (own current + historical rows only) | Manager scope explicitly excluded here (Decision 3 — current-only, not historical); a manager calls the current-assignment-only view instead (below). |
| POST | `.../asset-assignments/:id/acknowledge` | `asset_management.write.own` | Own open assignment only; atomic, idempotent-rejecting. |

**Employee own assets / manager team view**
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `.../assets/my-assets` | `asset_management.read.own` | Own current + full historical assignments. |
| GET | `.../assets/team-assets` | `asset_management.read.own` (server-resolves manager-of-record scope) | **Current assignments only** for current direct reports (Decision 3) — no historical reach through this route. |
| POST | `.../assets/:id/report-issue` | `asset_management.write.own` | Only on an asset with an active assignment belonging to the caller; creates an `asset_incidents` row, never mutates `assets` directly. |

**Incident handling (HR/Asset-Officer)**
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `.../asset-incidents` | `asset_management.manage` | Org-wide, filterable by `status`. |
| POST | `.../asset-incidents/:id/review` | `asset_management.manage` | Sets `status='reviewed'`, `reviewedByMembershipId`, `reviewedAt`, optional `resolutionNotes`. |
| POST | `.../asset-incidents/:id/dismiss` | `asset_management.manage` | Sets `status='dismissed'`, same actor/timestamp fields. |

**Maintenance**
| Method | Path | Permission |
|---|---|---|
| GET, POST | `.../assets/:id/maintenance` | `asset_management.manage` |
| PATCH | `.../asset-maintenance/:id` | `asset_management.manage` |

**Documents/evidence**
| Method | Path | Permission |
|---|---|---|
| GET, POST | `.../assets/:id/evidence` | Same visibility tier as the asset itself |
| GET | `.../assets/:id/evidence/:evidenceId/download` | Same visibility tier, authenticated only |

**Dashboard/reports**
| Method | Path | Permission |
|---|---|---|
| GET | `.../assets/dashboard` | `asset_management.reports.read` |
| GET | `.../assets/reports/:reportKey` | `asset_management.reports.read`, `?format=csv` supported |

No `DELETE` route anywhere — retirement, not deletion, is how an asset leaves service; no custody/incident row is ever deleted.

---

## 21. RLS / Tenant Isolation (Unchanged From Draft, Extended to `asset_incidents`)

Every table carries `organizationId`, RLS enabled inline, zero permissive policies — deny-by-default, matching the current live baseline exactly (this phase would bring the platform from 84 to 89 tables, still 0 disabled / 0 policies). Every cross-org reference explicitly validated: `employeeId`, `branchId`, `assetId`, `assignmentId`, `maintenanceId`, `evidenceId`, `incidentId`, `employeeDocumentId` — a same-shape-but-wrong-organization ID for any of these must `404`, never leak existence.

---

## 22. Audit Events — Final

`asset.created`, `asset.updated`, `asset.assigned`, `asset.returned`, `asset.condition_updated`, `asset.marked_lost`, `asset.recovered`, `asset.retired`, `asset_assignment.acknowledged`, `asset_incident.reported`, `asset_incident.reviewed`, `asset_incident.dismissed`, `asset_maintenance.started`, `asset_maintenance.completed`, `asset_evidence.attached`. No audit event for any GET/list/read operation, matching the platform-wide "reads generate zero audit noise" discipline.

---

## 23. Concurrency / Data Integrity — Final

Unchanged from the draft (§24 there), plus:

| Race | Protection |
|---|---|
| Duplicate/concurrent acknowledgement | The atomic conditional UPDATE in §9 — a second attempt affects 0 rows, `409`. |
| Concurrent incident report + HR review of the same assignment | Independent tables/rows — a review action never blocks a report from being filed, and vice versa; the incident's own `status` transition (`open → reviewed/dismissed`) is itself an atomic conditional UPDATE guarded by `status='open'`, so two simultaneous review attempts resolve to exactly one winner. |
| Retire-while-lost-recovery-in-flight | Both routes share the identical atomic-conditional-UPDATE-against-`assets.status` pattern — only one wins for any given prior state. |

---

## 24. Workstreams W95–W104 — Final

Adjusted from the draft to accommodate acknowledgement (§9) and incident reporting (§0, Decision 2) without adding an 11th workstream — folded into the workstreams whose own scope they naturally belong to, disclosed explicitly below wherever the boundary shifted from the draft.

### W95 — Asset Management Foundation & Module Activation
**Scope:** schema for all 5 tables (`assets`, `asset_assignments`, `asset_maintenance`, `asset_evidence`, `asset_incidents`), migration `0040`, RLS enabled inline; confirm the already-registered `asset_category` Master Data domain needs no seed change; seed the final 4-key `asset_management.*` permission set (§15) per the final role matrix; flip module `asset_management` `hidden → active`; `lib/assetAuthorization.ts` foundation (manager-of-record current-scope resolution, cross-org validation helpers). **No routes, no frontend.**
**Database impact:** migration `0040`.
**API/Frontend impact:** none.
**Permissions used:** seeds the final set.
**Tests:** schema/auth-helper unit tests, mirroring `learningAuthorization.test.ts`'s own W85 precedent.
**Live QA:** foundation-level only.
**Definition of Done:** matches every prior foundation workstream's own DoD exactly.
**STOP boundary:** no asset register, no assignment logic, no frontend. Do not begin W96 without its own separate go-ahead.

### W96 — Asset Register
**Scope:** `lib/assets.ts` + `routes/assets.ts` — create/list/detail/edit/retire/mark-lost/recover/condition-update, `assetTag` generation, serial-number partial-uniqueness, `/assets` HR/Admin page.
**Database impact:** none (uses W95's schema).
**API impact:** the "Asset register" route group (§20).
**Frontend impact:** `/assets`.
**Permissions used:** `asset_management.manage`.
**Tests:** register CRUD, tag generation, serial-uniqueness conflict, every non-assignment lifecycle transition (§7) + its own concurrency case, cross-org denial.
**Live QA:** full non-custody lifecycle (create → damage → lost → recover → retire), duplicate-serial `409`, retire-while-assigned `409` (setup via a manually-created assignment row if W97 hasn't landed yet — or, more simply, this specific case is deferred to W97's own QA once assignment exists; W96's own QA covers every transition reachable without an active assignment).
**Definition of Done:** every field/lifecycle rule in §5, §7, §12 implemented and tested for assets with no active assignment.
**STOP boundary:** no assignment/custody logic. Do not begin W97 without its own separate go-ahead.

### W97 — Assignment, Custody, Return & Acknowledgement
**Scope:** `asset_assignments` business logic — issue/return, the atomic transitions, the partial-unique-index-backed one-active-assignment guarantee, snapshot capture at issue, **and the acknowledgement route (§9)** — folded in here because acknowledgement is a narrow extension of the assignment row itself, not a separate concern.
**Database impact:** none (uses W95's schema).
**API impact:** the "Assignments" route group (§20), including `POST .../asset-assignments/:id/acknowledge`.
**Frontend impact:** assignment/return UI nested in `/assets`'s own detail view; the acknowledgement control itself ships in W98 alongside the ESS surface that renders it (this workstream ships the route, not the employee-facing control).
**Permissions used:** `asset_management.manage` (assign/return), `asset_management.write.own` (acknowledge).
**Tests:** assign/return atomicity, the concurrent-double-assign race (real `Promise.all` test, mirroring Learning's own W90 certificate-race precedent), snapshot immutability after a later asset rename, acknowledgement idempotency/repeat-call `409`, retire-while-assigned `409` (the W96-deferred case, now testable).
**Live QA:** full issue→acknowledge→return cycle, concurrent-assign race, snapshot-immutability check, repeat-acknowledgement `409`.
**Definition of Done:** §8–§9, §14 (assignment-related rows), §23 (assignment/acknowledgement races) all implemented and live-verified.
**STOP boundary:** no employee/manager self-service views, no incident reporting yet. Do not begin W98 without its own separate go-ahead.

### W98 — Employee & Manager Asset Views, Incident Reporting
**Scope:** ESS "My Assets" tab (own current + historical assignments, the acknowledgement control, **the report-issue control**), the new `asset_incidents` employee-facing creation route, and the manager "Team Assets" current-only view (Decision 3).
**Database impact:** none (uses W95's schema).
**API impact:** "Employee own assets / manager team view" route group (§20), including `POST .../assets/:id/report-issue`.
**Frontend impact:** new ESS tab; new manager surface.
**Permissions used:** `asset_management.read.own`, `asset_management.write.own`.
**Tests:** own-scope-only visibility, acknowledgement UI wiring, report-issue creation + own-currently-assigned precondition enforcement, manager current-only scope (never historical, never org-wide, live-relationship-not-snapshotted).
**Live QA:** own-scope enforcement, cross-employee denial, manager-scope-current-only check (an employee who stops reporting to a manager immediately drops out of that manager's view), incident-report creation by an employee on their own assigned asset + denial on an asset not assigned to them.
**Definition of Done:** the full employee/manager self-service surface (§9, §19, Decisions 1–3) implemented and live-verified.
**STOP boundary:** no HR-side incident review, no maintenance/retirement UI beyond what W96 already covers. Do not begin W99 without its own separate go-ahead.

### W99 — Incident Review, Loss & Retirement (HR-Side)
**Scope:** the HR/Asset-Officer incident review/dismiss routes (§20), grouped here because reviewing an incident naturally precedes or accompanies the loss/damage transitions W96 already built — this workstream is where the two meet operationally.
**Database impact:** none.
**API impact:** the "Incident handling" route group (§20).
**Frontend impact:** the incident-review actions surfaced in `/assets`'s own detail view and the org-wide open-incident queue.
**Permissions used:** `asset_management.manage`.
**Tests:** review/dismiss transitions + their own concurrency case (§23), terminal-state immutability (repeat-review/-dismiss `409`).
**Live QA:** employee reports an issue → HR reviews it → HR separately marks the asset `lost`/`damaged` via W96's own routes → confirms the incident and the asset-level action are correctly independent-but-related.
**Definition of Done:** the full incident lifecycle (§7) implemented and live-verified end to end, including its interaction with the asset-level lifecycle.
**STOP boundary:** no maintenance-table work yet. Do not begin W100 without its own separate go-ahead.

### W100 — Maintenance & Documents/Evidence
**Scope:** `asset_maintenance` and `asset_evidence` — both reusing existing infrastructure (§11, §13).
**Database impact:** none (schema already exists from W95).
**API impact:** "Maintenance" + "Documents/evidence" route groups (§20).
**Frontend impact:** maintenance history + evidence sections nested in `/assets`'s own detail view.
**Permissions used:** `asset_management.manage`, plus the existing evidence-visibility-tier resolution.
**Tests:** maintenance CRUD/status transitions, the `maintenance→available`-vs-`→assigned` derivation logic (§7) under both "had an active assignment" and "did not" conditions; evidence upload/list/download/IDOR/signature-validation, mirroring Learning's own W90 evidence test shape.
**Live QA:** maintenance lifecycle including both derivation branches; evidence upload/download/cross-org-IDOR.
**Definition of Done:** §11, §13 fully implemented and live-verified, including the maintenance-completion derivation rule from §7.
**STOP boundary:** no org-wide operational workspace yet. Do not begin W101 without its own separate go-ahead.

### W101 — Internal Asset Workspace
**Scope:** `/asset-workspace` — org-wide list/filter/paginate, outstanding-returns view, the open-incident queue, lost/retired history — reuses every existing route verbatim, zero new backend business logic, mirroring Learning's own W91 finding exactly.
**Database impact:** none.
**API impact:** none new.
**Frontend impact:** `/asset-workspace`.
**Permissions used:** `asset_management.manage`.
**Tests:** frontend-only.
**Live QA:** org-wide list/filter/paginate correctness, confirming every action reuses an existing route.
**Definition of Done:** matches Learning's own W91 DoD template exactly.
**STOP boundary:** no dashboard/reports. Do not begin W102 without its own separate go-ahead.

### W102 — Dashboard & Reporting
**Scope:** `lib/assetReporting.ts`, `/assets-dashboard`, `/asset-reports` — the tile breakdown (§18) and exactly 3 reports (§17).
**Database impact:** none — report keys are additive seed/catalog rows only.
**API impact:** "Dashboard/reports" route group (§20).
**Frontend impact:** `/assets-dashboard`, `/asset-reports`.
**Permissions used:** `asset_management.reports.read`.
**Tests:** scope resolution (own/manager-current-only/org-wide), exact tile/report math, CSV/JSON row-count parity, N+1 structural verification.
**Live QA:** scope-by-actor, CSV parity, cross-org isolation, unknown-report-key `404`.
**Definition of Done:** matches Learning's own W92 DoD template exactly, every tile/field cross-checked against §17/§18.
**STOP boundary:** last feature-delivery workstream. Do not begin W103 without its own separate go-ahead.

### W103 — Phase 3E Verification
**Scope:** full repo-wide verification pass against this frozen plan — functional, authorization, tenant isolation, historical integrity, lifecycle, security (RLS re-confirmed), database (migration ledger, zero drift), performance/N+1, API contract, frontend, one integrated live-QA lifecycle against the real development database — mirroring W93's own exact charter and template. Verification-only.
**Definition of Done:** matches W93's own template exactly.
**STOP boundary:** report PASS / PASS WITH FIXES / BLOCKED. Do not begin W104 without its own separate go-ahead.

### W104 — Phase 3E Completion Report
**Scope:** formal closure, mirroring W94's own exact structure.
**Definition of Done:** `PROJECT_STATUS.md` updated, Phase 3E marked complete only if every requirement genuinely delivered.
**STOP boundary:** the final Assets workstream. Do not begin the next roadmap module without its own separate planning/freeze cycle.

---

## 25. Verification Strategy (Unchanged From Draft)

Mirrors the exact discipline already proven across Recruitment/Attendance/Performance/Learning — focused + full regression, typecheck, builds, deterministic codegen, migration drift, RLS, tenant isolation/IDOR, permission matrix, lifecycle, concurrency, historical custody, evidence access (including physical-file-on-disk verification, not merely DB rows, per Learning's own W90/W93-established discipline), live development QA with disposable data only, cleanup with genuine audit history always preserved.

---

## 26. Future Manual/Documentation Hooks (Unchanged From Draft, Extended)

Adds, beyond the draft's own list: how an employee reports damage/loss (and what happens to that report), how HR reviews and resolves an incident, what "acknowledged" does and does not mean to an employee, what a manager can see about their team's current (not historical) assets.

---

## 27. Definition of Done (Phase-Level)

An Asset Management workstream is only complete when it includes: schema (where applicable) + migration + backend service/route + permission enforcement + validation + OpenAPI specification + regenerated API clients + frontend UI (where applicable) + organization isolation + audit logging where applicable + automated tests + this document updated to reflect what actually shipped — identical to `CLAUDE.md`'s own "Definition of Complete" and every prior phase's own discipline.

---

## 28. Production Rollout Boundary

Nothing in this document authorizes any production action. No migration, route, frontend page, permission seed, or module activation exists yet. Production rollout for Asset Management, once implemented, remains a separate, explicitly-gated decision requiring its own preflight, review, and approval — identical to every prior phase's own closing boundary.
