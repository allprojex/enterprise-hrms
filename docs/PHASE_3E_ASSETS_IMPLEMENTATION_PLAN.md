# Phase 3E — Asset Management: Draft Implementation Plan

Status: **DRAFT — NOT FROZEN**

This document is a **discovery-and-design draft only**. As of this document:

- **No migration has been created.** The database schema is unchanged; the latest migration remains `0039`.
- **No module has been activated.** The `asset_management` module registry entry remains `status: "hidden"`, exactly as it already existed before this document was written.
- **No permission has been seeded.**
- **No API route, frontend page, or generated client code exists for Assets.**
- **No production access occurred** in the production of this document.
- **Every Owner Decision below remains PENDING.** None has been approved.
- **No implementation workstream (W95 onward) may begin until this plan is reviewed and explicitly frozen by the owner**, exactly as W73 and W85 each required their own separate go-ahead after their own frozen documents were approved.

This document distinguishes three kinds of statement throughout:

- **[ROADMAP REQUIREMENT]** — something `ROADMAP.md` or `PROJECT_STATUS.md` actually says, verbatim or in substance.
- **[PROPOSED DESIGN DECISION]** — a design choice this document recommends, reasoned from existing repository architecture, but not yet approved. Implementation may proceed on these once the plan is frozen, unless a later owner review overrides them.
- **[OWNER DECISION — PENDING]** — a genuine business-policy fork this document cannot resolve on its own. Implementation of the affected area must not begin until each is answered.

---

## 0. Roadmap Findings

**[ROADMAP REQUIREMENT]** `ROADMAP.md`'s Phase 3 ("Workforce Operations") list reads, in full:

```
- Recruitment
- Attendance
- Leave
- Performance
- Learning
- Assets
- Employee Self Service
- Manager Portal
```

That single line — **"Assets"** — is the entire roadmap-level specification. `ROADMAP.md` contains no further detail: no field list, no lifecycle, no mention of procurement, maintenance, custody, or reporting. `PROJECT_STATUS.md`'s own "Future Modules" list (a near-duplicate, independently maintained list) names the same item **"Asset Management"** — a wording difference between the two documents, not a different item; this document adopts "Asset Management" as the module's proper name because it is also the name already registered in the live module registry (§1).

Everything beyond that one line in this document — the data model, lifecycle, permissions, workflows, reports — is a **[PROPOSED DESIGN DECISION]**, reasoned from this HRMS's own established architecture and from what a company-property/equipment register genuinely needs to be useful, not from any further roadmap text (because none exists). This is stated explicitly per this session's own instruction not to silently expand a one-line roadmap item into a large system without documenting that expansion.

---

## 1. Existing Foundations Reused (Verified by Direct Inspection)

Every claim below was verified by reading the actual file, not assumed.

- **Module registry already contains this module, pre-registered and unbuilt.** `lib/db/src/seed/module-definitions.ts` already defines:
  ```
  key: "asset_management"
  name: "Asset Management"
  description: "Company asset inventory and employee assignment tracking."
  category: "hr-operations"
  version: "1.0.0"
  status: "hidden"
  defaultEnabled: false
  ```
  This is the **exact same pre-registration pattern** every prior phase's own module went through before its own foundation workstream flipped it to `"active"` (Recruitment, Attendance, Performance, Learning all show this identical history in this same file). **The module key this plan uses throughout is `asset_management`, not `assets`** — a factual finding from the repository, not a design choice this document is making.
- **No `assets`-related table, route, permission, or frontend page exists anywhere in the repository today.** Confirmed by a full-repository search for asset/equipment/device/property/inventory/custody/maintenance/serial-number/vehicle/uniform/access-card/procurement/purchase-order/supplier/vendor/warehouse/disposal/write-off/IMEI — zero genuine hits. This is a clean-slate module with **zero risk of overlap or duplication** with any existing module.
- **`employee_documents` + `fileStorage.ts` + `documentValidation.ts`** (`lib/db/src/schema/employee-documents.ts`, `artifacts/api-server/src/lib/fileStorage.ts`, `artifacts/api-server/src/lib/documentValidation.ts`) — the exact file-storage architecture Performance's evidence (W82) and Learning's evidence (W90) both already reuse verbatim: org-scoped disk storage, server-generated storage keys, PDF/JPEG/PNG/DOCX/XLSX allowlist, 10MB cap, magic-byte signature validation, authenticated-only download. Reusable for Assets evidence exactly the same way.
- **`branches`** (`lib/db/src/schema/branches.ts`) — `id, organizationId, name, code, status(active/inactive)`, unique `(organizationId, code)`. This HRMS's existing physical-location concept.
- **`departments`** (`lib/db/src/schema/departments.ts`) — org-scoped, optional `branchId`, optional self-referencing `parentDepartmentId`.
- **`employees`** — `employmentStatus` enum (`active/probation/on_leave/suspended/terminated`), `departmentId`, `positionId`, `reportingManagerId`, `branchId`, `separationDate`/`separationReason` (free-text, backed by the existing `separation_reason` Master Data domain).
- **`employee_exit_processes`** (`lib/db/src/schema/employee-exit-processes.ts`, Phase 2A W29) — a checklist/clearance/exit-interview record attached to a separation event: `checklistCompleted`, `clearanceCompleted`, `exitInterviewCompleted` booleans, `exitInterviewNotes`, its own snapshotted `separationDate`. Backend-only today — **no frontend page exists for it anywhere** (confirmed: no route in `App.tsx` references it). This is the natural integration point for an outstanding-assets signal (§10), but it is a bare backend record with no UI to extend yet — a fact this plan's own workstream sequencing must account for, not assume around.
- **Master Data** (`lib/db/src/schema/master-data-domains.ts` + `master-data-items.ts`) — a registry of organization-definable reference-data domains (`system-defined` / `organization-overridable` / `organization-defined`), code-registered in `lib/db/src/seed/master-data-definitions.ts`. Learning's own `training_category` domain (`organization-defined`, no seeded default items) is the closest direct precedent for a new Assets category domain.
- **Reporting Foundation** (`lib/db/src/schema/reports.ts`, `lib/db/src/seed/report-definitions.ts`, `artifacts/api-server/src/lib/reporting.ts`) — a shared registry (`key, label, description, category, requiredPermissionKey`) used for catalog discoverability; every module with own/manager/org-wide visibility tiers (Recruitment, Attendance, Performance, Learning) executes its own reports through a **dedicated, module-owned route**, never the generic runner, because the generic runner only resolves `organizationId` and cannot express a scoped visibility tier. The identical pattern applies here.
- **Audit log** (`lib/db/src/schema/audit-events.ts`, `artifacts/api-server/src/lib/auditLog.ts`'s `recordAuditEvent`) — append-only, `{organizationId, actorApplicationUserId, actorMembershipId, eventType, targetType, targetId, beforeState?, afterState?, metadata?}`.
- **Authorization primitives** — every existing module (`lib/learningAuthorization.ts`, `lib/performanceAuthorization.ts`, etc.) resolves manager scope from the employee's own live `reportingManagerId`, never a static "manager" role or a `.read.team` permission. This is the platform's own settled convention (explicitly reaffirmed as recently as Learning's own W91/W93 closure) and this plan follows it identically.
- **`assertBelongsToOrganization`-style cross-org reference validation** — the existing pattern (used throughout Learning/Performance/Recruitment) for rejecting a same-shape-but-wrong-org foreign key with a `400`, never trusting a raw FK constraint alone to prevent cross-tenant reference injection.

**Net effect: nothing needs to be invented at the infrastructure level.** Assets needs its own tables and its own business logic, but every supporting system it needs (file storage, audit, Master Data, Reporting Foundation, module gating, tenant isolation, the manager-relationship authorization pattern) already exists and is directly reusable.

---

## 2. Purpose

Deliver a V1 company-asset register: HR/Admin registers organization-owned equipment, assigns it to employees with a full custody history, tracks condition/location/maintenance, and retires it — reusing every existing platform primitive rather than duplicating any of them, exactly per `CLAUDE.md`'s "Configuration Before Custom Code" and "Modular Architecture" principles, and exactly matching the discipline every prior Phase 3 module's own frozen plan already established.

---

## 3. Domain Boundary — What Assets IS and IS NOT

**[PROPOSED DESIGN DECISION].** The central question this plan answers: *what company-owned property must HR/Admin be able to register, assign to employees, track, recover, and retire?*

**In scope for V1:** a general-purpose, organization-defined-category register of durable equipment issued to employees — laptops, desktops, monitors, phones, tablets, printers, access cards, furniture, tools, and any other category an organization defines for itself. The category list is **not hardcoded** (§5) — a manufacturing company, a school, and a church all need different categories, and Master Data already solves exactly this problem.

**Explicitly out of scope for V1** (each is a distinct, larger system with its own data model, workflow, and — in several cases — its own regulatory/accounting concerns; building any of them here would silently turn a one-line roadmap item into an ERP suite):

| Excluded system | Why it's a different problem |
|---|---|
| Retail/warehouse inventory & stock levels | Tracks fungible quantity-on-hand of sellable goods, not individually-custodied durable property assigned to a person. |
| Accounting fixed-asset depreciation | A regulated financial-reporting concern (depreciation schedules, useful-life methods, GL posting) with its own compliance requirements this HRMS has no other financial-ledger infrastructure to support. |
| Procurement / purchase orders / vendor management | A pre-acquisition workflow (requisition → PO → receipt) entirely upstream of "the organization now owns this thing and needs to track who has it," which is where this module's own scope begins. |
| Fleet management | Vehicles have their own regulatory concerns (registration, insurance, mileage, driver assignment, fuel) that a general equipment register does not model well; a vehicle *can* still be registered as an asset row with a `vehicle` category if an organization wants basic custody tracking only, but odometer/insurance/fuel-log features are not V1. |
| IT remote device management (MDM) | Software agents, remote wipe, patch compliance — a security-operations tool, not an HR custody register. |
| Consumables inventory | Office supplies, cables, toner — high-volume, low-value, not individually assigned/returned; not a fit for a per-item custody model. |

This boundary itself is a design recommendation, not something the roadmap specifies — flagged explicitly per this session's own instruction.

---

## 4. Asset Categories — Master Data Fit

**[PROPOSED DESIGN DECISION].** Inspected the existing Master Data architecture (§1) against the requirement for organization-defined equipment types. It fits directly: a new domain, `asset_category`, classified `organization-defined` (identical classification to Learning's `training_category` and the existing `document_category`) — no seeded default items, each organization defines its own category codes (`laptop`, `phone`, `furniture`, `vehicle`, ...) the same way it already does for training/document categories. No new registry mechanism is needed; this is a pure data addition to the existing `master-data-definitions.ts` seed list.

**Condition, location, maintenance type, and disposal reason are each evaluated independently, not automatically folded into Master Data:**

- **Condition** — **[PROPOSED DESIGN DECISION]:** a small, fixed enum (`new`, `good`, `fair`, `poor`, `damaged`), not Master Data. Condition is a bounded, universal concept every organization needs identically (unlike a category list, which is genuinely organization-specific) — the same reasoning Learning applied to `learning_courses.status`/`learning_enrollments.status` (fixed enums, not Master Data). Making it Master Data would let an organization silently redefine what "damaged" means, which report logic (§17) elsewhere assumes is stable.
- **Location** — **[PROPOSED DESIGN DECISION]: reuse the existing `branches` table directly (`branchId`), not a new location concept and not Master Data.** This HRMS already has exactly one physical-location entity (`branches`), used identically by Employees/Departments; inventing a second "asset location" domain would fragment an already-solved concept for no benefit. An asset's location is simply "which branch currently has it" (defaulting to the assigned employee's own branch when assigned, or an explicit storage branch when unassigned).
- **Maintenance type** — **[PROPOSED DESIGN DECISION]:** free text (a short label field), not Master Data and not an enum. Maintenance types are too varied and low-stakes to warrant a governed domain (no report or authorization logic needs to reason about a fixed maintenance-type list) — the same reasoning already applied to `learning_courses.categoryCode`'s free-text precedent, one level down in stakes.
- **Disposal reason** — **[PROPOSED DESIGN DECISION]:** free text (mandatory, mirroring the existing "mandatory reason" pattern already used for mandatory-enrollment cancellation and certificate revocation in Learning), not Master Data. A fixed list would understate the genuine variety of real disposal reasons; a mandatory free-text field, always audited, is the established platform precedent for "must justify this action" scenarios.

---

## 5. Asset Register — Data Model

**[PROPOSED DESIGN DECISION]**, unless noted as an Owner Decision.

**Table: `assets`**

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | Org ownership, identical convention to every other table. |
| `assetTag` | text, NOT NULL | **Server-generated, sequential, per-organization** (`AST-00001`, `AST-00002`, ...) at creation time — mirrors `employeeNumber`'s own nullable-but-usually-present convention, except here it is always server-set, never client-supplied, because a tag is the register's own primary human-facing identifier and must never collide or be spoofed. Unique per `(organizationId, assetTag)`. |
| `categoryCode` | text, NOT NULL | Free-text code from the new `asset_category` Master Data domain (§4) — not FK-validated against the domain's item list, identical precedent to `learning_courses.categoryCode`/`employee_documents.categoryCode`. |
| `name` | text, NOT NULL | Short display name ("Dell Latitude 5420"). |
| `description` | text, nullable | |
| `manufacturer` | text, nullable | |
| `model` | text, nullable | |
| `serialNumber` | text, nullable | **Not globally unique, but unique per organization when present** — a partial unique index `(organizationId, serialNumber) WHERE serialNumber IS NOT NULL` prevents accidental duplicate registration within one org while never blocking assets with no serial (furniture, uniforms) or (rare, but real) organizations that don't track serials at all. |
| `branchId` | int, FK `branches`, `set null`, nullable | Current physical location (§4) — `set null`, not `restrict`, since a branch being archived must never block asset history. |
| `purchaseDate` | date, nullable | Plain `date` (Architecture Principle 7 — no timezone/instant question for a calendar date), not `timestamp`. |
| `purchaseCost` | numeric, nullable | See Owner Decision 7 (§25) — **stored as a plain reference figure only, no currency conversion, no depreciation, no accounting integration of any kind.** |
| `currencyCode` | text, nullable | Free-text (e.g. `"GHS"`, `"USD"`) — only meaningful alongside `purchaseCost`; no FX table exists on this platform and none is built here. |
| `warrantyExpiryDate` | date, nullable | |
| `condition` | enum (`new`/`good`/`fair`/`poor`/`damaged`), NOT NULL, default `"good"` | Current condition — updated by condition-change events (§9), never silently overwritten by an unrelated action. |
| `status` | enum (`available`/`assigned`/`maintenance`/`lost`/`retired`), NOT NULL, default `"available"` | The sole-authoritative lifecycle field (§7) — mirrors Learning's/Performance's own "one authoritative status column" discipline exactly. |
| `notes` | text, nullable | |
| `createdBy` | int, FK `users`, `set null`, nullable | |
| `createdAt`/`updatedAt` | timestamptz | |

**Table: `asset_assignments`** (custody history — §8)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `cascade`, NOT NULL | Defensive-only cascade (assets are never deleted in practice, mirrors `learning_enrollment_evidence.enrollmentId`'s own precedent). |
| `employeeId` | int, FK `employees`, `restrict`, NOT NULL | **Live reference** for "who currently/previously had this" lookups (§14) — `restrict`, not `cascade`, since custody history must outlive the employee row exactly the way `employee_documents` already protects its own history. |
| `assetTagSnapshot` | text, NOT NULL | Snapshot (§14). |
| `assetNameSnapshot` | text, NOT NULL | Snapshot (§14). |
| `categorySnapshot` | text, NOT NULL | Snapshot (§14). |
| `departmentIdSnapshot` | int, nullable | Snapshot of the employee's department **at issue time** (§14). |
| `positionIdSnapshot` | int, nullable | Snapshot of the employee's position **at issue time** (§14). |
| `issuedAt` | timestamptz, NOT NULL | |
| `issuedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `expectedReturnDate` | date, nullable | Optional — not every issued asset has a planned return date (a permanently-issued laptop vs. a short-term loaner). |
| `issueCondition` | enum (same condition enum), NOT NULL | Condition recorded at handover. |
| `issueNotes` | text, nullable | |
| `acknowledgedAt` | timestamptz, nullable | See Owner Decision 1 (§25) — populated only if acknowledgement is approved for V1; always nullable regardless, since acknowledgement (if built) is never a hard precondition for the assignment row existing. |
| `returnedAt` | timestamptz, nullable | **NULL means this is the currently-active assignment.** |
| `receivedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `returnCondition` | enum, nullable | Only meaningful once returned. |
| `returnNotes` | text, nullable | |
| `endReason` | enum (`returned`/`lost`/`transferred`/`retired`), nullable | Why this specific custody period ended — distinct from the asset's own `status`, since an assignment can end because the asset moved to someone else (`transferred`, immediately followed by a new assignment row), not only because it came back to the shelf. |
| `createdAt`/`updatedAt` | timestamptz | |

Uniqueness: **a partial unique index `(assetId) WHERE returnedAt IS NULL`** guarantees at most one active assignment per asset at the database level — the same class of guarantee `employee_user_links`' own unique-per-employee index already provides, chosen deliberately over relying on application logic alone (§24).

**Table: `asset_maintenance`** (§11 — contingent on Owner Decision 6)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `cascade`, NOT NULL | |
| `maintenanceType` | text, NOT NULL | Free text (§4). |
| `description` | text, nullable | |
| `providerText` | text, nullable | Free-text vendor/provider name — **not a vendor management table** (§26). |
| `status` | enum (`scheduled`/`in_progress`/`completed`/`cancelled`), NOT NULL, default `"scheduled"` | |
| `startedAt` | timestamptz, nullable | |
| `completedAt` | timestamptz, nullable | |
| `cost` | numeric, nullable | Same reference-figure-only treatment as `assets.purchaseCost`. |
| `notes` | text, nullable | |
| `createdByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `createdAt`/`updatedAt` | timestamptz | |

**Table: `asset_evidence`** (§13 — a lightweight join table into `employee_documents`, mirroring `learning_enrollment_evidence`/`performance_review_evidence` exactly)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `organizationId` | int, FK `organizations`, `restrict`, NOT NULL | |
| `assetId` | int, FK `assets`, `cascade`, NOT NULL | **[PROPOSED DESIGN DECISION]: evidence attaches to the asset only, not separately to an assignment or a maintenance event.** A receipt, warranty document, damage photo, or disposal approval is naturally part of one asset's own timeline; a three-way polymorphic attachment target has no precedent anywhere in this codebase (Performance/Learning evidence both attach to exactly one parent entity each) and would be over-engineering for V1's actual needs. If a future need genuinely requires evidence scoped to one specific assignment or maintenance event, that is a small, additive extension, not a V1 blocker. |
| `employeeDocumentId` | int, FK `employee_documents`, `restrict`, NOT NULL | Mirrors the Learning/Performance precedent's own restrict-on-delete discipline exactly. |
| `addedByMembershipId` | int, FK `organization_memberships`, `set null`, nullable | |
| `addedAt` | timestamptz, NOT NULL | |

**Expected next migration: `0040`** — verified against the current ledger (`0039` is confirmed the latest file in `lib/db/drizzle/`, no `0040` exists). **Not created by this document.**

---

## 6. Field-Level Reasoning (§6 of the master prompt, answered explicitly)

- **Asset tag generation:** server-generated, sequential, per-organization (`AST-00001`, ...) — **[PROPOSED DESIGN DECISION]**, not organization-customizable in V1 (a custom prefix/format scheme is a reasonable future enhancement, not a V1 requirement nothing in the roadmap asks for).
- **Serial number uniqueness:** unique per organization only when present (partial index), never globally unique, never required — reasoned in §5.
- **Purchase cost:** included as a plain optional reference figure — **Owner Decision 7 (§25)**, since "should cost exist at all" is exactly the kind of policy question this document must not silently answer.
- **Financial depreciation:** explicitly out of V1 (§3, §26) — no schedule, no method, no GL posting, no accounting integration of any kind. `purchaseCost` is a memo field only.

---

## 7. Asset Lifecycle

**[PROPOSED DESIGN DECISION].**

```
available → assigned → available (returned)
available → maintenance → available (completed) | retired
assigned  → maintenance (asset recalled for service while still "held")
assigned  → lost
available/maintenance → retired
```

Five statuses, deliberately not more:

| Status | Meaning |
|---|---|
| `available` | In the organization's possession, not currently issued to anyone. |
| `assigned` | Currently issued to an employee (exactly one active `asset_assignments` row exists). |
| `maintenance` | Temporarily out of service — **an asset can enter maintenance directly from `assigned`** (the employee's active assignment row is *not* auto-closed; the asset is recalled for service and expected to return to the same custody, tracked by leaving `returnedAt` null on the existing assignment while `status` moves to `maintenance` and back). |
| `lost` | Reported lost or stolen — **terminal in practice but not database-enforced as terminal**, since a "lost" item is occasionally recovered; recommended as reachable back to `available` only via an explicit `learning.manage`-equivalent administrative correction, mirroring the platform's own "administrative correction, not a route" convention. |
| `retired` | Permanently out of service (disposed, written off, or otherwise decommissioned) — **hard-terminal**, matching Learning's own "no formal reopen" discipline exactly: an asset once `retired` never returns to `available`; if an organization somehow needs the same physical item back in service, it is re-registered as a new asset row, never reopened.

**Deliberately not separate top-level statuses** (per this section's own instruction to avoid unnecessary states when condition/history metadata already represents them):

- **"Damaged"** is a `condition` value, not a `status` — a damaged laptop can still be `assigned` (the employee keeps using it while damaged) or `maintenance` (sent for repair); collapsing damage into status would force a false choice between "who has it" and "what state it's in."
- **"Stolen"** is folded into `lost` at the status level, with the distinction (lost vs. stolen) captured in the mandatory notes/reason text of the condition-change event (§12) — a genuinely separate `stolen` status would only matter if some later report needed to distinguish them structurally, and none currently does.
- **"Disposed"** is folded into `retired` at the status level, with the disposal reason/method captured as mandatory text on the retirement action (§12) — matching the same reasoning as `lost`/`stolen` above. **Flagged as Owner Decision 10 (§25)** in case the owner wants `disposed` to be a genuinely distinct terminal status from `retired` (e.g., "retired but still in storage" vs. "physically disposed of") — this document's own recommendation is that one terminal status plus a disposal-reason text field is sufficient for V1 and avoids an unnecessary lifecycle fork.

**Who may transition:** every transition other than employee self-service acknowledgement/damage-reporting (contingent on Owner Decisions 1–2, §25) is `assets.manage`-only (§15) — mirroring Learning's own "HR/L&D administratively controls every lifecycle transition beyond the employee's own narrow self-service slice" discipline exactly.

**Concurrency:** every transition is an atomic conditional `UPDATE ... WHERE status = '<expected prior status>'`, identical in shape to every lifecycle transition already implemented in Learning/Performance/Attendance — a concurrent or repeat attempt against the wrong prior state returns a controlled `409`, never a silent double-transition (§24).

---

## 8. Assignment / Custody Model

**[PROPOSED DESIGN DECISION], reasoned per §8 of the master prompt.**

A dedicated `asset_assignments` table (§5) is used — **not** a single `assets.employeeId` column — because the system must be able to answer every one of the questions §8 poses (who has it now, who had it before, when issued, by whom, when returned, condition at issue vs. return, acknowledgement, and why an assignment ended) and a single mutable FK column structurally cannot answer any of the historical ones. This mirrors Learning's own W87 decision to model enrollment as a row-per-event rather than a mutable pointer, and Performance's identical reasoning for review history.

**Assignment target for V1: employee only.** Department- or location-level custody (an asset "belonging to" a department rather than a person) was considered and is **explicitly deferred** — it would require a second, parallel assignment shape (target-type polymorphism this codebase has no precedent for) for a use case ("shared equipment," e.g. a department-owned printer) that is better served in V1 by simply leaving such an asset `available` with its `branchId`/location set, and noting shared ownership in `notes`, rather than building a second custody model day one. If genuinely needed later, department/location custody is a small, additive extension to this same table shape (an optional `departmentId`/`locationId` alongside the required `employeeId`, or a nullable-`employeeId` variant), not a redesign.

**"Currently has it" query:** the single active row per asset (`returnedAt IS NULL`, enforced by the partial unique index in §5) — an O(1) lookup, no aggregation needed. **"Previously had it" query:** the full `asset_assignments` history for that `assetId`, ordered by `issuedAt`.

---

## 9. Issue / Return Workflow

**[PROPOSED DESIGN DECISION]** for the mechanics; **[OWNER DECISION — PENDING]** for acknowledgement (§25, Decision 1).

**Issue** (`available → assigned`): HR/Admin (`assets.manage`) selects an available asset and an employee; the route atomically (a) conditionally updates `assets.status` from `available` to `assigned` and (b) inserts the new `asset_assignments` row with the required snapshots (§5), in one transaction — the identical "atomic transition + same-transaction side-effect insert" shape Learning's own W90 certificate-issuance already established and proved race-safe under real concurrent-request testing.

**Return** (`assigned → available`): HR/Admin closes the active assignment row (`returnedAt`, `receivedByMembershipId`, `returnCondition`, `returnNotes`, `endReason = 'returned'`) and atomically flips `assets.status` back to `available` (or to `maintenance`, in the same transaction, if the return notes indicate the item needs service — a single combined action, not two separate calls a caller could fail to complete).

**Acknowledgement (Owner Decision 1):** if approved, the employee (via ESS "My Assets," §19) sets `acknowledgedAt` on their own active assignment row — a narrow, single-field, own-scoped write, structurally incapable of touching anyone else's assignment (the same "server-derived own identity, never a client-supplied target" discipline every other own-scoped Learning/Performance route already enforces). If not approved for V1, the column exists in the schema (§5) but no route ever sets it, and the frontend never renders an acknowledgement control — the same "schema-level capability, no route" precedent already established for `learning_certificates.employeeDocumentId` in W90.

---

## 10. Offboarding Integration

**[PROPOSED DESIGN DECISION]**, bounded deliberately narrow; **automatic termination-blocking is explicitly NOT proposed** (§25, Decision 5).

The existing `employee_exit_processes` table (§1) has **no frontend page at all today** — it is a backend-only record from Phase 2A. This plan does not propose building or redesigning exit-process UI; that is out of scope for an Assets phase. Instead, V1's own integration is additive and read-only:

- An **"outstanding assets" query** (`SELECT active asset_assignments WHERE employeeId = :id`) is exposed wherever offboarding-relevant employee data is already surfaced — most simply, as a field on the existing employee-detail view and as one of the three V1 reports (§17, `asset_unreturned_by_employee`).
- **No automatic block on `separateEmployee`** (`lib/employees.ts`) is proposed. Coupling asset-return status to the separation flow would introduce new coupling into `lib/employees.ts` that the frozen Performance/Learning precedent's own "V1 doesn't couple across modules without an explicit, approved reason" discipline argues against, and the exit-process page doesn't even exist yet to surface a warning inside. If the owner wants a hard block or a UI warning integrated directly into a (not-yet-built) exit-process page, that is Owner Decision 5 (§25) and, if approved, a small later addition — not something this plan builds by default.

---

## 11. Maintenance

**[OWNER DECISION — PENDING]** whether maintenance tracking is in V1 at all (§25, Decision 6); **[PROPOSED DESIGN DECISION]** for its shape if approved.

If included: a dedicated `asset_maintenance` table (§5), **simple history only — not a scheduling/dispatch/work-order platform.** Four states (`scheduled`/`in_progress`/`completed`/`cancelled`) are sufficient to represent "we know this happened or is planned," which is all V1 needs; no assignment of maintenance to a technician, no SLA tracking, no automated reminder/recurrence exists or is proposed. An asset entering `maintenance` status (§7) does not require a maintenance record to exist — the two are related but independent (an org might track `status=maintenance` without ever filling in a `asset_maintenance` row, or vice versa log a completed repair without the asset's own status ever having left `assigned`, e.g. a quick on-site fix). If declined, `assets.status` still supports the `maintenance` value on its own (§7) — deferring only the dedicated history table, not the status itself, since a status without a corresponding record loop is a much smaller feature than a full history table.

---

## 12. Loss, Damage & Disposal

**[PROPOSED DESIGN DECISION]**, with one item flagged as Owner Decision 10 (§25).

- **Damage:** a `condition` update to `damaged` (§7) — always via a mandatory-reason action (mirroring the platform's own "must justify" pattern), audited (`asset.condition_updated`, §23), never a silent field edit.
- **Loss/theft:** a `status` transition to `lost` (§7), mandatory reason, audited (`asset.marked_lost`). Whether the caller distinguishes "lost" from "stolen" is captured in that mandatory reason text, not a separate status (§7).
- **Retirement/disposal:** a `status` transition to `retired` (§7), mandatory reason (which method/why — sold, scrapped, donated, written off), always audited (`asset.retired`), and **[OWNER DECISION — PENDING #10]** whether this requires its own distinct `disposed` status separate from `retired`, or whether one terminal status plus a mandatory reason is sufficient (this document's own recommendation: the latter).
- **Retired/disposed assets never return to service** (§7) — a hard-terminal status, no un-retire route exists anywhere in this plan.
- **Historical custody is never deleted.** An asset's full `asset_assignments` history remains queryable forever regardless of the asset's own current status — retiring or losing an asset never touches its own past assignment rows, the same "immutable historical record over destructive update" discipline this section's own instruction calls for and every other module in this HRMS already follows.
- **Optional evidence** (a disposal-approval document, a damage photograph) attaches via `asset_evidence` (§5, §13) — never required for the transition itself to succeed (evidence attachment is a separate, optional action, not a precondition baked into the lifecycle transition route).

---

## 13. Documents / Evidence

**[PROPOSED DESIGN DECISION].** Reuses `employee_documents`/`fileStorage.ts`/`documentValidation.ts` verbatim (§1) via the new `asset_evidence` join table (§5) — identical architecture to Learning's W90 and Performance's W82, **no second storage subsystem**. Attaches to the asset only (§5's own reasoning). Covers every example use case named in this session's own instruction — purchase receipt, warranty document, damage evidence, disposal approval, maintenance invoice — as a flat, undifferentiated list of files on the asset's own timeline; a `description`/`label` free-text field on `asset_evidence` (not shown as a separate column above, folded into a future minor addition if genuinely needed) lets the uploader annotate what each file is, rather than the schema enforcing a fixed taxonomy of evidence types.

---

## 14. Historical Integrity — Snapshot Rules

Per this session's own explicit instruction, every relevant relationship is classified below with its reasoning — nothing is snapshotted reflexively.

| Relationship | Classification | Reasoning |
|---|---|---|
| `asset_assignments.employeeId` | **LIVE REFERENCE** | Needed to resolve "who currently/previously had this" against the employee's own current record (name, current department for org-wide filtering) — the same live-reference precedent `learning_enrollments.employeeId` itself already uses. |
| `asset_assignments.assetTagSnapshot` / `.assetNameSnapshot` / `.categorySnapshot` | **SNAPSHOT** | A later asset rename/recategorization must never rewrite what a historical custody record displayed at the time — identical reasoning to `learning_enrollments.courseTitleSnapshot`. |
| `asset_assignments.departmentIdSnapshot` / `.positionIdSnapshot` | **SNAPSHOT** | The employee's department/position **at issue time**, so a later transfer/promotion never reinterprets who was responsible for an asset in what role at the time it was issued — identical reasoning to `learning_enrollments.departmentIdSnapshot`/`.positionIdSnapshot`/`.managerEmployeeIdSnapshot`. |
| `asset_assignments.issueCondition` / `.returnCondition` | **SNAPSHOT** (by construction — these are point-in-time values, never re-derived) | The condition at handover and at return are historical facts, not references to the asset's own current (possibly since-changed) condition field. |
| `assets.branchId` | **LIVE REFERENCE** | An asset's *current* location is meant to reflect its actual present location, not a historical snapshot — unlike an assignment's own department/position snapshot, there is no "location at time of X" question this field is answering; it simply tracks where the item is now. A future report needing "which branch was this asset at when assigned" would read that from `asset_assignments`' own department-linked branch, not this column — not needed for any V1 report (§17). |
| `assets.categoryCode` | **LIVE REFERENCE on the asset row itself, SNAPSHOT on each assignment** | The asset's own current category can be corrected/reclassified going forward; each historical assignment keeps its own `categorySnapshot` exactly as it appeared at issue time, mirroring how `learning_enrollments.categorySnapshot` coexists with `learning_courses.categoryCode` remaining live. |
| `asset_maintenance.assetId` | **LIVE REFERENCE** | Maintenance history is inherently tied to the current asset identity, no snapshot question exists here. |
| `asset_evidence.employeeDocumentId` | **LIVE REFERENCE**, `restrict`-protected | Mirrors the identical Learning/Performance precedent — a document can never be silently unlinked. |

---

## 15. Authorization Model

**[PROPOSED DESIGN DECISION]**, contingent on Owner Decisions 2–4 (§25).

**Proposed permission keys — 4, mirroring Learning's exact shape:**

- `assets.read.own` — own assigned assets, own custody history.
- `assets.write.own` — own-scoped self-service mutation: acknowledgement (if Decision 1 approves it) and self-reported damage/loss (if Decision 2 approves it). **If both are declined, this permission key still exists (for symmetry with every other module's own shape) but gates nothing in V1** — the same "seeded, but nothing currently uses it" precedent is not actually needed here; more precisely, if both Decisions 1 and 2 are declined, `assets.write.own` is **not seeded at all** in V1, since an unused permission key is worse hygiene than simply not creating it (flagged so the eventual foundation workstream does the right thing based on the actual answer, not a default).
- `assets.manage` — organization-wide: register/edit/retire assets, issue/return/transfer custody, record maintenance, revoke evidence, run org-wide reports.
- `assets.reports.read` — dashboard + report access, own/manager-of-record/organization-wide scope resolved server-side exactly like Learning's own W92 reporting scope, never a separate visibility model.

**No `assets.read.team` or `assets.review.write`-equivalent key is proposed** unless Owner Decision 3 or 4 (§25) requires manager *action* (assign/return), not merely manager *visibility* — manager visibility into direct-reports' assigned assets is resolvable server-side purely from the existing `reportingManagerId` relationship plus `assets.reports.read`, the identical "manager is a relationship, not a permission" pattern already established platform-wide, requiring zero new permission key. Only if managers need to *act* (not just view) would a `assets.review.write`-equivalent become necessary, mirroring exactly why Learning needed `learning.review.write` (managers approve/instructors record outcomes) where Performance's own reviewer-of-record model needed an analogous key.

**Proposed role/permission matrix** (mirroring the existing seeded pattern for every other Phase 3 module — final seeding contingent on Owner Decisions 2–4):

| Role | `assets.read.own` | `assets.write.own` | `assets.manage` | `assets.reports.read` |
|---|---|---|---|---|
| `employee` | ✅ | Only if Decision 1/2 approve any self-service mutation | ❌ | ✅ (own-scoped reach only, resolved server-side) |
| manager-of-record | (relationship, not a role — same `assets.read.own`/`.reports.read` as any employee, plus server-resolved direct-report visibility if Decision 3 approves it) | — | ❌ unless Decision 4 explicitly grants managers assignment authority | ✅ (own + direct-report scope) |
| `hr_manager` | ✅ | ✅ | ✅ | ✅ |
| `org_admin` | ✅ | ✅ | ✅ | ✅ |
| `super_admin` | ✅ | ✅ | ✅ | ✅ |

---

## 16. Module Activation

**[ROADMAP REQUIREMENT / factual finding, not a decision]:** the `asset_management` module key **already exists** in `lib/db/src/seed/module-definitions.ts`, `status: "hidden"`, `defaultEnabled: false`. This plan proposes flipping it to `"active"` in the eventual foundation workstream (mirroring the identical `hidden → active` flip every prior Phase 3 module's own foundation workstream performed) — **not done in this discovery session.** No organization is or will be auto-enabled by that flip alone, per the platform's own established "module availability grants no organization access by itself" rule, re-verified true for every module in this HRMS to date.

---

## 17. Reporting

**[PROPOSED DESIGN DECISION].** Exactly 3 reports, registered in the shared Reporting Foundation registry (`category: "asset_management"`) for catalog discoverability, executed through a dedicated `GET .../assets/reports/:reportKey` route — identical isolation pattern to Learning's/Performance's/Attendance's own dedicated reporting routes:

| Report key | Purpose | Row/aggregate semantics | Filters | Scope | CSV |
|---|---|---|---|---|---|
| `asset_register` | The full asset list with current status/condition/location/current holder. | Row-level, one row per in-scope asset. | `categoryCode`, `status`, `branchId` | org-wide only (`assets.manage`) | Yes, identical scope to JSON. |
| `asset_unreturned_by_employee` | Outstanding (currently-assigned) assets, for offboarding/audit purposes (§10). | Row-level, one row per active `asset_assignments` record, joined to its own snapshot fields. | `employeeId`, `departmentId` | own / manager-of-record / organization-wide (identical 3-tier model to Learning's own reports) | Yes. |
| `asset_maintenance_history` | Maintenance events over a date range. | Row-level, one row per `asset_maintenance` record. | `assetId`, `status`, date range | organization-wide only (`assets.manage`) — **only registered if Owner Decision 6 approves maintenance tracking at all.** | Yes. |

Deliberately **not** included in V1: a retired/disposed-assets report (the `asset_register` report's own `status` filter already covers this — a fourth report would be redundant) and any cost/valuation report (out of scope, §3/§18).

---

## 18. Dashboard

**[PROPOSED DESIGN DECISION].** A zero-filled tile breakdown, no invented rate/KPI, no financial valuation tile (matching this HRMS's own platform-wide "no invented rate/KPI" discipline, reaffirmed as recently as Learning's own W92):

- `totalAssetCount` (organization-wide, or in-scope for a manager/employee).
- A zero-filled status breakdown: `available` / `assigned` / `maintenance` / `lost` / `retired` counts.
- `employeesWithAssignedAssetsCount` (distinct employees holding at least one active assignment, in scope).
- `overdueReturnCount` — active assignments where `expectedReturnDate` has passed (only meaningful for assignments that set one; an assignment with no `expectedReturnDate` is never counted as overdue) — the identical "a date field passing plus a status check, never a stored transition" computation Learning's own `overdueCount` already established.

Scope mirrors the reports (§17): own / manager-of-record / organization-wide, resolved from `assets.reports.read` server-side, identical to Learning's own W92 dashboard scope model.

---

## 19. Frontend Surfaces

**[PROPOSED DESIGN DECISION].**

**HR/Admin:**
- `/assets` — Asset Register (list, create, detail/edit, retire) — mirrors `/learning-courses`'s own shape (a list page with a "manage" detail dialog).
- `/assets` detail view also hosts assignment/return, maintenance history (if approved), and evidence — mirrors `/learning-courses`'s own nested-panel convention (Sessions nested inside a course's own manage dialog) rather than spawning several separate pages for what is, at V1's own scope, one entity's own facets.
- `/asset-workspace` — the internal org-wide operational surface (assignment queue, outstanding returns, lost/retired history) — mirrors `/learning-enrollments`'s own W91 shape, reusing the register/assignment routes verbatim, no second business-rules engine.
- `/assets-dashboard`, `/asset-reports` — mirrors `/learning`/`/learning-reports`'s own W92 shape exactly.

**Employee ESS:** a new "My Assets" tab on the existing `/self-service` page — own currently-assigned + historical assets, acknowledgement control if Decision 1 approves it, damage/loss self-report control if Decision 2 approves it — mirrors "My Learning"'s own independent module-gating (`isModuleAccessible(modules, 'asset_management')`) exactly. **No new employee portal is created** — ESS already exists and every prior module's own employee surface is a tab within it; Assets follows the identical convention.

**Manager:** **only if Owner Decision 3 approves manager visibility** — a "Team Assets" surface, most likely folded into the existing manager-facing pattern (a page or a section, mirroring `/learning-team-training`'s own shape) rather than a new standalone concept — not built by default.

All surfaces: `<SecureRoute moduleKey="asset_management">` / the ESS tab's own independent in-page module check, nav-gated `isHrCapable`-only where the underlying route itself requires organization-wide authority — identical convention to every existing module, including the exact same navigation-visibility-is-UX-only, backend-is-the-real-gate discipline already re-verified true throughout Phase 3D.

---

## 20. API Contract (Planning Only — No Route Code)

**[PROPOSED DESIGN DECISION].** Grouped by area; every route composes `requireAuth → requireMembership("organizationId") → requireModuleEnabled("asset_management") → requirePermission(...)`, identical chain to every existing module.

**Asset register**
| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `.../assets` | List/search, paginated, filterable (`categoryCode`, `status`, `branchId`) | `assets.manage` (org-wide) | `{items,total,page,pageSize}`, mirrors Learning's own W91 list convention. |
| POST | `.../assets` | Register a new asset | `assets.manage` | Server-generates `assetTag`. |
| GET | `.../assets/:id` | Detail | `assets.manage` (org-wide) or own-scope reach if currently assigned to the caller | |
| PATCH | `.../assets/:id` | Edit base fields (name/category/location/notes/etc.) | `assets.manage` | Never edits `status` (a dedicated transition route handles that, mirroring Learning's own session-status-vs-field-edit separation). |
| POST | `.../assets/:id/retire` | Terminal transition | `assets.manage` | Mandatory reason. |
| POST | `.../assets/:id/mark-lost` | `assigned`/`available` → `lost` | `assets.manage` | Mandatory reason. |
| POST | `.../assets/:id/condition` | Record a condition change (e.g. `damaged`) | `assets.manage` | Mandatory reason, audited. |

**Assignments**
| Method | Path | Purpose | Permission |
|---|---|---|---|
| POST | `.../assets/:id/assign` | Issue to an employee | `assets.manage` (or a manager-scoped variant if Decision 4 approves) |
| POST | `.../assets/:id/return` | Close the active assignment | `assets.manage` (or manager-scoped, same contingency) |
| GET | `.../assets/:id/assignments` | Full custody history for one asset | `assets.manage` (org-wide) or own-scope if currently/previously assigned |
| POST | `.../assets/:id/acknowledge` | Own active-assignment acknowledgement | `assets.write.own` — **only if Decision 1 approves** |

**Employee own assets**
| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `.../assets/my-assets` | Own current + historical assignments | `assets.read.own` |
| POST | `.../assets/:id/report-issue` | Self-report damage/loss on an owned assignment | `assets.write.own` — **only if Decision 2 approves** |

**Manager/team scope** — folded into the existing `GET .../assets` / `GET .../assets/reports/:reportKey` routes via server-resolved scope (no separate route needed), **unless** Decision 4 approves manager assign/return authority, in which case `POST .../assets/:id/assign`/`/return` gain a dual-floor permission check (mirrors Learning's own `learning.manage`-or-`learning.review.write` dual-floor pattern on its own assign route).

**Maintenance** (contingent on Decision 6)
| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET, POST | `.../assets/:id/maintenance` | List/create maintenance events | `assets.manage` |
| PATCH | `.../assets/maintenance/:id` | Update status/completion | `assets.manage` |

**Documents/evidence**
| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET, POST | `.../assets/:id/evidence` | List/upload | Same visibility tier as the asset itself |
| GET | `.../assets/:id/evidence/:evidenceId/download` | Authenticated download | Same visibility tier |

**Dashboard / reports**
| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `.../assets/dashboard` | Tile breakdown | `assets.reports.read` |
| GET | `.../assets/reports/:reportKey` | Run a registered report, `?format=csv` supported | `assets.reports.read` |

No `DELETE` route on any instance-level record anywhere in this contract — matching the platform's own established "no unnecessary CRUD" discipline (retirement, not deletion, is how an asset leaves active use; a custody row is never deleted, only closed).

---

## 21. Data Model Summary & Migration

Table set proposed: **`assets`, `asset_assignments`, `asset_maintenance` (contingent on Decision 6), `asset_evidence`** — 3 or 4 tables depending on that one decision, each fully specified in §5 with FKs, uniqueness, org-scoping, and snapshot/audit-sensitive fields called out. **Expected next migration number: `0040`** (verified: `0039` is the current latest, no `0040` exists) — **not created in this discovery session.**

---

## 22. RLS / Tenant Isolation

**[PROPOSED DESIGN DECISION]**, following the identical, already-proven architecture every other table on this platform uses — no new pattern:

- Every org-owned table above carries `organizationId`, RLS enabled inline at migration time, zero permissive policies — deny-by-default, matching the current live baseline (84/84 tables, 0 disabled, 0 policies) exactly; Assets' own new tables would bring that to 87 or 88 depending on Decision 6, still 0 disabled / 0 policies.
- The application connects with the same `BYPASSRLS` server role every other module already relies on — RLS's role here, as everywhere else on this platform, is exclusively closing the Supabase Data API/PostgREST exposure path; real authorization is server-side.
- **Every cross-org reference is explicitly validated, never trusted from a raw FK alone**, using the existing `assertBelongsToOrganization`-style helper: `employeeId` (assignment target), `branchId` (asset location), `assetId`/`assignmentId`/`maintenanceId`/`evidenceId` (every instance-level route parameter), and `employeeDocumentId` (evidence linkage) — a same-shape-but-wrong-organization ID for any of these must 404, never leak existence via a differently-worded error, matching the exact IDOR discipline independently re-verified live throughout W91 and W93.

---

## 23. Audit Events

**[PROPOSED DESIGN DECISION].** Restrained, matching the platform's own existing naming convention (`<entity>.<action>`, verified against `learningEnrollments.ts`'s/`learningCertificates.ts`'s own real emitted events):

`asset.created`, `asset.updated`, `asset.assigned`, `asset.returned`, `asset.condition_updated`, `asset.marked_lost`, `asset.sent_to_maintenance`, `asset.maintenance_completed`, `asset.retired`, `asset_evidence.attached`.

**No audit event for any GET/list/read operation** — matching the platform-wide "reads generate zero audit noise" discipline re-confirmed as recently as W93's own audit review. If acknowledgement (Decision 1) or self-reporting (Decision 2) are approved, they gain their own events (`asset_assignment.acknowledged`, `asset.self_reported_issue`) at implementation time — not enumerated definitively here since their existence is itself contingent on those pending decisions.

---

## 24. Concurrency / Data Integrity

**[PROPOSED DESIGN DECISION].** Every race condition named in this session's own instruction is addressed structurally, not merely by convention:

| Race | Protection |
|---|---|
| Two admins assign the same available asset simultaneously | Atomic conditional `UPDATE assets SET status='assigned' WHERE id=:id AND status='available'` — the loser affects 0 rows, gets a controlled `409`, never a silent double-assignment. |
| Duplicate active assignments for one asset | The partial unique index `asset_assignments(assetId) WHERE returnedAt IS NULL` (§5) makes this a database-level impossibility, not merely an application check. |
| Simultaneous return + maintenance action on the same asset | Both routes share the identical atomic conditional-UPDATE pattern against `assets.status`'s own current value — only one can win the race for any given prior state. |
| Retirement while assigned | The retire route's own conditional UPDATE checks `status IN ('available','maintenance')` — an `assigned` asset cannot be retired directly; the route must first fail with a clear `409` ("this asset is currently assigned — return it before retiring," mirroring the platform's own controlled-error-over-generic-500 discipline) rather than silently retiring out from under an active custodian. Whether force-retiring an assigned asset (auto-closing the assignment) should instead be allowed with an explicit reason is a small enough implementation-time judgment call for the owning workstream, not elevated to an Owner Decision here. |
| Duplicate asset tag | Structurally impossible — server-generated only (§6), never client-supplied. |
| Duplicate serial number | Partial unique index, per-organization, non-null only (§5) — a genuine duplicate returns a controlled `409`/`400`, never a raw constraint-violation `500`, matching the existing `isUniqueViolation`-based error-translation pattern already used elsewhere in this codebase (e.g. Leave's own ledger duplicate-posting translation). |
| Cross-org references | §22. |

---

## 25. Owner Decisions Requiring Approval

Every decision below is genuinely undecided by this document. Nothing in §5–§24 above that depends on one of these has been built — only designed, contingently, pending the answer.

| # | Decision | Consequence | Recommendation |
|---|---|---|---|
| 1 | Can employees acknowledge receipt of an assigned asset? | If yes: `assets.write.own` gains one narrow route, `acknowledgedAt` becomes populated, ESS shows an acknowledgement control. If no: the column stays schema-level-only, exactly like `learning_certificates.employeeDocumentId`. | **Recommend yes** — a lightweight, own-scoped, single-field action with clear audit value (mirrors the existing platform pattern of employee acknowledgement already established for Performance's own W83A), low implementation cost. |
| 2 | Can employees self-report loss/damage, or must HR/Admin always record it? | If yes: `assets.write.own` gains a self-report route; the asset's condition/status still only changes via an HR/Admin-reviewed action afterward (self-report creates a flag/notification, not an automatic status change), to avoid an employee unilaterally marking company property `lost`. If no: only HR/Admin records loss/damage, following an out-of-band report (phone call, email, ticket). | **Recommend yes, with the caveat above** — self-reporting improves data timeliness, but the actual status transition should remain `assets.manage`-gated regardless, so this is lower-risk than it first appears. |
| 3 | Can managers view assets assigned to their direct reports? | If yes: `assets.reports.read` resolves manager-of-record scope server-side, identical to Learning's own model — no new permission key needed. If no: only HR/Admin and the employee themselves can see an assignment. | **Recommend yes** — pure visibility, no new permission, matches the platform's own default "managers can see their team's own module data" pattern in Performance/Learning/Attendance. |
| 4 | Can managers assign/return assets themselves, or is that HR/Admin/Asset-Officer only? | If yes: the assign/return routes gain a dual-floor permission check (`assets.manage` or a manager-of-record path), mirroring Learning's own `learning.manage`-or-`learning.review.write` dual-floor precedent on its `assign` route — direct reports only, never org-wide. If no: assignment stays a purely centralized HR/Admin/Asset-Officer function. | **Recommend no for V1** — equipment issuance is more commonly a centralized IT/Admin function than a line-manager one in most organizations this platform serves; keeping it centralized is simpler and lower-risk, with manager-assignment as a plausible V2 extension if real usage shows the need. |
| 5 | Should an employee's outstanding assets block termination/offboarding, or only generate a warning/report? | Hard-blocking `separateEmployee` couples Assets into `lib/employees.ts`, a shared core module — a significant coupling decision. A warning/report is additive and reversible. | **Recommend warning/report only for V1** (§10) — matches this platform's own general reluctance to add cross-module hard-blocks without a specific, approved business reason, and the exit-process page doesn't yet exist to surface a warning inside even if desired. |
| 6 | Is maintenance tracking included in V1? | If yes: the `asset_maintenance` table (§5), its own report (§17), its own routes (§20, §11) are all built. If no: `assets.status` still supports the `maintenance` value on its own, but no history table, no maintenance report. | **Recommend yes, but kept intentionally minimal** (§11) — genuinely useful for a company-property register and cheap to build at the scope proposed (simple history, no scheduling engine); declining it would leave `status=maintenance` as a dead end with no supporting record. |
| 7 | Should purchase cost be stored in V1, without depreciation/accounting logic? | If yes: `assets.purchaseCost`/`currencyCode` exist as plain memo fields, no valuation/depreciation logic anywhere. If no: those two columns are dropped from the schema entirely. | **Recommend yes, memo-only** — genuinely useful reference data for an asset register (insurance claims, replacement budgeting) with near-zero implementation cost, provided it is never mistaken for or extended into real accounting functionality (§3, §26 make this boundary explicit). |
| 8 | Should asset categories use organization-defined Master Data? | If yes: the `asset_category` domain (§4) is registered, mirroring `training_category`. If no: a fixed enum would need its own frozen value list, which no roadmap or prior document defines. | **Recommend yes** — this document's own analysis (§4) found no better fit; a fixed enum would require inventing a universal category list this document has no basis to author. |
| 9 | Are asset documents/evidence included in V1? | If yes: `asset_evidence` (§5, §13) ships, reusing existing infrastructure at near-zero marginal cost. If no: no receipt/warranty/damage-photo attachment exists anywhere. | **Recommend yes** — the marginal cost is genuinely small (a join table, reusing 100% of existing storage/validation infrastructure, no new subsystem), and the value (proof of purchase, warranty claims, damage documentation) is high. |
| 10 | Should retired/disposed assets be permanently terminal, and should "disposed" be a distinct status from "retired"? | Terminality: yes either way, this document does not propose any un-retire path regardless. Distinctness: a `disposed` status would add a 6th lifecycle value and its own transition rules. | **Recommend: terminal, yes; distinct `disposed` status, no** — one terminal status (`retired`) plus a mandatory disposal-reason text field (§12) captures the same information with a simpler lifecycle; splitting it would only matter if a future report genuinely needed to distinguish "retired but not yet disposed" from "disposed," which no current requirement calls for. |

**No decision above has been answered on the owner's behalf.** Every schema/route/permission element in §5, §9, §11, §15, §19–§20 that depends on one of these is described as *contingent*, not as already-approved.

---

## 26. Explicit V1 Deferrals

Confirmed deferred, none accidentally designed into any section above:

- Procurement / purchase orders.
- Supplier/vendor management beyond a simple free-text `providerText` field on a maintenance record (§5, §11) — no vendor table, no vendor performance tracking.
- Warehouse/stock inventory of fungible goods.
- Consumables inventory.
- Depreciation / accounting journal integration of any kind.
- Barcode/QR scanning — not essential for V1's own core custody-tracking value; `assetTag` remains a plain text/numeric identifier a scanner could read *if* one were pointed at a printed tag later, but no scanning UI or integration is built.
- RFID.
- GPS/location tracking beyond the static `branchId` field.
- Remote device management (MDM).
- Fleet management (mileage, insurance, fuel, driver logs) — a vehicle can be registered as a basic asset row (§3), nothing more.
- Automated maintenance scheduling/reminders.
- Insurance management.
- Asset reservations/booking.
- Employee payroll deductions for damaged/lost property — a real HR policy question with payroll implications this platform's own Learning/Performance precedent for "no cross-module financial coupling without explicit approval" argues strongly against building silently; if ever wanted, it is its own, separately-scoped, separately-approved feature.
- Complex multi-step approval workflows for any asset action — every action in this plan is a single-actor, single-step transition (issue/return/retire/etc.), matching the platform's own existing "avoid inventing approval chains the frozen scope doesn't call for" discipline.

---

## 27. Proposed Workstream Sequence (Hypothesis — Not Approved, Adjustable)

Ten workstreams, directly mirroring Learning's own proven W85–W94 shape, continuing this platform's numbering from W94. **No workstream may begin merely because this plan exists — each still requires its own separate go-ahead, exactly as every prior phase's own workstream did, and this entire document must first be reviewed/frozen and every Owner Decision (§25) answered.**

### W95 — Asset Management Foundation & Module Activation
**Scope:** schema only — `assets`, `asset_assignments`, `asset_evidence` (and `asset_maintenance` if Decision 6 approves), migration `0040`, RLS enabled inline, the `asset_category` Master Data domain registered (if Decision 8 approves), permissions seeded per the final (post-decision) matrix, module `asset_management` flipped `hidden → active`, `lib/assetAuthorization.ts` foundation (manager-of-record resolution, cross-org validation helpers). **No routes, no frontend.**
**Database impact:** migration `0040`.
**API impact:** none.
**Frontend impact:** none.
**Permissions used:** seeds the final permission set.
**Tests:** schema/auth-helper unit tests, mirroring `learningAuthorization.test.ts`'s own W85 precedent.
**Live QA:** foundation-level only — table/RLS/module/permission state verified live, no business route exists yet to exercise.
**Definition of Done:** matches every prior foundation workstream's own DoD exactly (schema + migration + RLS + permissions + module flip + auth helper + tests + docs, no business logic).
**STOP boundary:** no asset register, no assignment logic, no frontend. Do not begin W96 without its own separate go-ahead.

### W96 — Asset Register
**Scope:** `lib/assets.ts` + `routes/assets.ts` — create/list/detail/edit/retire, server-generated `assetTag`, serial-number partial-uniqueness, `/assets` HR/Admin page.
**Database impact:** none (uses W95's schema).
**API impact:** the "Asset register" route group (§20).
**Frontend impact:** `/assets`.
**Permissions used:** `assets.manage`.
**Tests:** register CRUD, tag generation, serial-uniqueness conflict handling, cross-org denial.
**Live QA:** create/edit/retire lifecycle, duplicate-serial `409`, cross-org `404`.
**Definition of Done:** every field/lifecycle rule in §5–§7 implemented and tested; no assignment logic yet.
**STOP boundary:** no assignment/custody logic. Do not begin W97 without its own separate go-ahead.

### W97 — Assignment / Custody / Return
**Scope:** `asset_assignments` business logic — issue/return, the atomic `assigns`/`returns` transitions, the partial-unique-index-backed one-active-assignment guarantee, snapshot capture at issue.
**Database impact:** none (uses W95's schema).
**API impact:** the "Assignments" route group (§20), plus (contingent on Decision 4) the manager-assign dual-floor path.
**Frontend impact:** assignment/return UI nested in `/assets`'s own detail view.
**Permissions used:** `assets.manage` (+ manager path if Decision 4 approves).
**Tests:** assign/return atomicity, the concurrent-double-assign race (real `Promise.all` test, mirroring Learning's own W90 certificate-race precedent), snapshot immutability after a later asset rename.
**Live QA:** full issue→return cycle, concurrent-assign race, snapshot-immutability-after-rename check.
**Definition of Done:** §8–§9, §14 (assignment-related rows), §24 (assignment-related races) all implemented and live-verified.
**STOP boundary:** no employee/manager self-service views yet, no maintenance/loss/retirement business actions beyond what W96 already covers. Do not begin W98 without its own separate go-ahead.

### W98 — Employee & Manager Asset Views
**Scope:** ESS "My Assets" tab (own current + historical assignments, acknowledgement if Decision 1 approves, self-report if Decision 2 approves); manager "Team Assets" view only if Decision 3/4 approve it.
**Database impact:** none.
**API impact:** the "Employee own assets" route group (§20), contingent routes per Decisions 1–2.
**Frontend impact:** new ESS tab; possibly a manager surface.
**Permissions used:** `assets.read.own`, `assets.write.own` (contingent).
**Tests:** own-scope-only visibility, acknowledgement/self-report contingent tests, manager-scope tests if built.
**Live QA:** own-scope enforcement, cross-employee denial, manager-scope-not-org-wide check if built.
**Definition of Done:** exactly the contingent scope Decisions 1–4 actually approved — nothing self-service beyond what was explicitly decided.
**STOP boundary:** no maintenance/loss/retirement UI yet. Do not begin W99 without its own separate go-ahead.

### W99 — Condition Events, Loss & Retirement
**Scope:** condition-update route, mark-lost route, retire route (§7, §12) — all mandatory-reason, all audited, all atomic conditional transitions.
**Database impact:** none.
**API impact:** the remaining "Asset register" transition routes (§20).
**Frontend impact:** the corresponding actions surfaced in `/assets`'s own detail view.
**Permissions used:** `assets.manage`.
**Tests:** every transition + its own concurrency case (§24), terminal-state immutability (repeat-retire `409`).
**Live QA:** damage/loss/retire flows, retire-while-assigned `409`, repeat-retire `409`.
**Definition of Done:** the full lifecycle (§7) is now completely implemented and live-verified end to end.
**STOP boundary:** no maintenance-table work yet (a separate concern from status alone, §11). Do not begin W100 without its own separate go-ahead.

### W100 — Maintenance & Documents/Evidence
**Scope:** `asset_maintenance` (if Decision 6 approves) + `asset_evidence` (if Decision 9 approves) — both reusing existing infrastructure (§11, §13).
**Database impact:** none (schema already exists from W95).
**API impact:** "Maintenance" + "Documents/evidence" route groups (§20).
**Frontend impact:** maintenance history + evidence sections nested in `/assets`'s own detail view.
**Permissions used:** `assets.manage`, plus the existing evidence-visibility-tier resolution.
**Tests:** maintenance CRUD/status transitions if built; evidence upload/list/download/IDOR/signature-validation, mirroring Learning's own W90 evidence test shape exactly.
**Live QA:** maintenance lifecycle if built; evidence upload/download/cross-org-IDOR.
**Definition of Done:** exactly the contingent scope Decisions 6/9 approved.
**STOP boundary:** no org-wide operational workspace yet. Do not begin W101 without its own separate go-ahead.

### W101 — Internal Asset Workspace
**Scope:** `/asset-workspace` — org-wide list/filter/paginate, outstanding-returns view, bulk visibility into lost/retired history — mirrors Learning's own W91 "zero new backend business logic, reuse every existing route" discipline exactly.
**Database impact:** none.
**API impact:** none new — consumes W96–W99's own routes with pagination/filter parameters, mirroring Learning's own W91 finding that its own workspace needed no new backend code.
**Frontend impact:** `/asset-workspace`.
**Permissions used:** `assets.manage`.
**Tests:** frontend-only (no new backend behavior to test).
**Live QA:** org-wide list/filter/paginate correctness, confirming every action reuses an existing route.
**Definition of Done:** matches Learning's own W91 DoD template exactly.
**STOP boundary:** no dashboard/reports. Do not begin W102 without its own separate go-ahead.

### W102 — Dashboard & Reporting
**Scope:** `lib/assetReporting.ts`, `/assets-dashboard`, `/asset-reports` — the tile breakdown (§18) and exactly 3 reports (§17), registered in the shared Reporting Foundation registry, executed through Assets' own dedicated route.
**Database impact:** none — report keys are additive seed/catalog rows only, not a schema change (identical to Learning's own W92 finding).
**API impact:** "Dashboard/reports" route group (§20).
**Frontend impact:** `/assets-dashboard`, `/asset-reports`.
**Permissions used:** `assets.reports.read`.
**Tests:** scope resolution (own/manager/org-wide), the exact math for every dashboard tile and report field, CSV/JSON row-count parity, N+1 structural verification (batched queries only).
**Live QA:** scope-by-actor, CSV parity, cross-org isolation, unknown-report-key `404`.
**Definition of Done:** every dashboard tile and report field cross-checked against §17/§18 with no undocumented addition, matching Learning's own W92 DoD template.
**STOP boundary:** this is the last feature-delivery workstream. Do not begin W103 without its own separate go-ahead.

### W103 — Phase 3E Verification
**Scope:** full repo-wide verification pass against this frozen plan — functional, authorization, tenant isolation, historical integrity, lifecycle, security (RLS re-confirmed), database (migration ledger, zero drift), performance/N+1, API contract, frontend, one integrated live-QA lifecycle against the real development database — mirroring W93's own exact charter and template. **Verification-only — no casual feature additions.**
**Database impact:** none expected; a genuine small reproducible defect is fixed with a permanent regression test (Category A); a substantial architectural defect is reported, not silently fixed (Category B) — identical discipline to W83/W93.
**Definition of Done:** matches W93's own template exactly.
**STOP boundary:** report PASS / PASS WITH FIXES / BLOCKED. Do not begin W104 without its own separate go-ahead.

### W104 — Phase 3E Completion Report
**Scope:** formal closure — reconciliation of every workstream against this plan, the shipped-capability record, database/permission/security/reporting state, known non-blocking items, production status, and the next undelivered roadmap item — mirroring W94's own exact structure.
**Definition of Done:** `PROJECT_STATUS.md` updated, Phase 3E marked complete only if every requirement genuinely delivered.
**STOP boundary:** the final Assets workstream. Do not begin the next roadmap module without its own separate planning/freeze cycle.

---

## 28. Verification Strategy (For the Eventual Phase)

Mirrors the exact discipline already proven across Recruitment/Attendance/Performance/Learning, restated here so the eventual W103 has a ready-made checklist:

- Focused backend tests per workstream; focused frontend tests per workstream.
- Full backend regression + full frontend regression before every commit, re-derived live, never reused from a prior workstream's own numbers.
- Typecheck clean across every workspace package.
- All 3 production builds (`api-server`/`hrms`/`mockup-sandbox`).
- Lint: **NOT AVAILABLE** (pre-existing repository gap) unless that changes independently before this phase begins.
- OpenAPI/codegen run at least twice per workstream that touches the API surface, confirmed byte-identical (hash-verified).
- Migration drift check (`drizzle-kit generate`) after every workstream.
- RLS baseline re-confirmed (count of enabled/disabled/policies) after every schema-touching workstream.
- Tenant isolation / IDOR matrix — every ID class named in §22, both directions, real-foreign-ID and nonexistent-ID cases tested separately.
- Full permission matrix re-verified live for every role, per §15's own final (post-decision) shape.
- Lifecycle: every transition + every terminal-state-immutability case (§7, §24).
- Concurrency: every race in §24, at least the asset-assignment race verified under a genuine `Promise.all` test, mirroring Learning's own certificate-issuance race precedent.
- Historical custody: every snapshot field in §14 re-verified immutable to a later asset/employee edit.
- Evidence access: IDOR, signature validation, size limit, authenticated-download-only — mirroring Learning's own W90 evidence test suite shape.
- Live development QA: real HTTP against the actual development database, disposable actors/data only, with **physical evidence files independently verified deleted from disk** (not merely their DB rows) — the exact discipline Learning's own W90/W93 QA already had to learn the hard way, applied here from the start rather than rediscovered.
- Cleanup: every disposable row and file deleted, module-enablement state restored to its exact prior value (not merely `false` — deleted entirely if no row existed before, per Learning's own W91/W93 precedent), independently re-verified by a fresh query, while **genuine audit history is always preserved, never deleted to make a cleanup count look clean.**

---

## 29. Future Manual/Documentation Hooks

Not written here — this is a discovery/planning document, not the manual itself — but the eventual user-facing workflows this plan's own design makes coherent enough to document step by step, once built:

- How HR/Admin registers a new asset (categories, optional cost/warranty, server-assigned tag).
- How HR/Admin issues an asset to an employee (condition at handover, expected return date if any).
- How an employee sees their own assigned property in ESS, and (if Decision 1 approves) acknowledges receipt.
- How an employee (if Decision 2 approves) reports damage or loss.
- How HR/Admin processes a return (condition at return, whether it goes back to `available` or into `maintenance`).
- How maintenance is logged and closed out (if Decision 6 approves).
- How loss/damage/retirement are recorded, and what each status genuinely means to a non-technical reader (§7's own table is written with this future audience in mind).
- How the 3 reports and the dashboard are read and exported.
- What a manager can and cannot see about their team's assets (contingent on Decisions 3–4).
- The exact meaning of each of the 5 lifecycle statuses (§7), written for an HR administrator, not a developer.

---

## 30. Definition of Done (Phase-Level, Mirrors §30 of the Learning Plan)

An Asset Management workstream is only complete when it includes: schema (where applicable) + migration + backend service/route + permission enforcement + validation + OpenAPI specification + regenerated API clients + frontend UI (where applicable) + organization isolation + audit logging where applicable + automated tests + this document updated to reflect what actually shipped — identical to `CLAUDE.md`'s own "Definition of Complete" and every prior phase's own discipline.

---

## 31. Production Rollout Boundary

Nothing in this document authorizes any production action. No migration, route, frontend page, permission seed, or module activation exists yet. Production rollout for Asset Management, once implemented, remains a separate, explicitly-gated decision requiring its own preflight, review, and approval — identical to every prior phase's own closing boundary.
