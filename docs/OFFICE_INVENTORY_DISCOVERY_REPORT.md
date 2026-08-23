# Office Inventory Management — Discovery Report & Draft Implementation Plan

**STATUS: DRAFT — OWNER REVIEW REQUIRED**

*(architecture proposed for review; nothing below is frozen; no code, schema, or migration was created in producing this document; Office Inventory was not enabled for WWM or any organization; production was not touched)*

---

## 1. Repository Baseline

- Confirmed fresh, not trusted from any prior report: `git fetch origin` + `git rev-parse HEAD main origin/main` — all three identical at `f511deb`.
- `git status --short` — identical to session start (the same pre-existing, unrelated untracked/modified items: `artifacts/mockup-sandbox/src/.generated/mockup-components.ts`, `.agents/skills/`, `.claude/`, `CLAUDE.md`, `CONTRIBUTING.md`, `artifacts/api-server/uploads/`, `skills-lock.json`). Nothing Inventory-related.
- Migration ledger ends at `0049`. The next migration, if this plan is frozen and implementation begins, would be `0050`.
- `PROJECT_STATUS.md` confirms Payroll COMPLETE and Phase 3H HR Operations/Personnel Records COMPLETE.
- **No existing inventory, stock, warehouse, or store concept exists anywhere in this repository** — schema, routes, UI, or even a stubbed module-registry entry. Confirmed by an exhaustive repo-wide search (`inventory`, `stock`, `warehouse`, `store`-as-physical-location): every real hit is either the Asset Management module's own colloquial use of the word "inventory" in its one-line description, or an explicit disclaimer that Assets is deliberately **not** a warehouse/consumables/retail-inventory system (`docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md` lines 28, 59, 282: *"Explicitly out of scope: retail/warehouse inventory... consumables inventory — each is a structurally different system"*). This confirms Office Inventory is genuinely new ground, not a rename or extension of something that already exists.

---

## 2. Existing Reusable Infrastructure

Investigated directly (not assumed from any prior report). Concrete file:line evidence retained internally from this session's investigation and summarized here.

### 2.1 Module registry (`lib/db/src/seed/module-definitions.ts`)
```ts
interface ModuleDefinition {
  key: string; name: string; description: string; category: string; version: string;
  status: "active" | "beta" | "hidden" | "deprecated";
  defaultEnabled: boolean; requiredModuleKeys: string[]; optionalModuleKeys: string[];
}
```
Every module today starts `status: "hidden"`, flips to `"active"` the moment its own foundation (schema + permissions + auth primitives) ships — "a one-line change once its workstream lands," documented as an established, repeated convention. `defaultEnabled: false` is universal. `asset_management` (category `hr-operations`) is the closest, most recent, non-financial precedent. Payroll is the only module that introduced a new category (`financial-operations`), justified specifically by financial/statutory distinctness — not a general precedent for every new module.

`organization_modules` (enable/disable per org) confirmed: `setModuleEnabled()` only permits `enabled: true` when the module's own registry `status` is `"active"` or `"beta"` — a `"hidden"` module cannot be turned on through the ordinary route at all, by design. This is exactly why Payroll couldn't be casually flipped on for any org before its own status change, and exactly the mechanism a new `office_inventory` module would start behind.

### 2.2 Organization settings / config namespaces (`services/organizationConfig.ts`)
`CONFIG_NAMESPACES` registry: each namespace has a Zod schema (with `.passthrough()`), a `defaults()` function, and an optional `moduleKey`. The DB column is named **`settings`** (jsonb) on `organization_settings` — the word `"data"` is only ever a service-layer DTO field name (`OrganizationConfigResult.data`), populated from `row.settings`. `getNamespaceConfig`/`updateNamespaceConfig` use a JSON-merge-patch deep merge, validate the **merged** result, and upsert with race-recovery. A new `office_inventory` namespace (e.g. for the repeat-request review-window default, receiving-notes requirements, etc.) would follow this exact pattern.

### 2.3 Roles & permissions (`lib/db/src/schema/roles.ts`, `permissions.ts`, `role-permissions.ts`)
Custom, org-scoped roles are a **real, ordinary-UI, always-available product feature** (ADR-015) — `routes/organizationRoles.ts` + `lib/roleTemplates.ts` provide `copyRoleTemplate` (copy a system template into an org-owned, customizable role) and `grantPermissionToOrgRole`/`revokePermissionFromOrgRole`, both refusing to touch a system-owned role. This is not confined to QA scripts.

Permission key convention, confirmed via 3 modules: `resource = action-namespace = the module's own registry key` (Asset Management's own seed comment states this explicitly: *"the permission namespace matches the module's own registry key"*). Asset Management deliberately kept its permission set to exactly 4 keys (`read.own`, `write.own`, `manage`, `reports.read`) and explicitly warns against namespace sprawl. Payroll used a wider, more granular set (16 keys) because it genuinely has more separable authorities. Inventory sits closer to Payroll's breadth of distinct operational concerns (see §31 permission proposal) than to Assets' minimal 4.

### 2.4 Departments — no "Department Head" field exists
`departments` table: `id, organizationId, branchId, parentDepartmentId (self-referencing), name, code, status, timestamps`. **No `headEmployeeId`/`departmentHeadId`/equivalent column anywhere in the schema** — confirmed by an explicit grep with zero matches. The only "who is this person's manager" primitive anywhere in the platform is `employees.reportingManagerId` (a plain, current-value-only, self-referencing FK — no history table, no as-of resolution). `primary_hr_assignments` is a single **organization-wide** "Primary HR" appointment (not per-department). `membership_scopes` expresses *what a membership is authorized to act on* (including `scopeType: "department"`), not *who heads it*.

**This is a genuine gap Office Inventory's own department-approval requirement runs directly into — flagged as Owner Decision 6.**

### 2.5 Employee/user linking — the ESS identity pattern
`resolveOwnEmployeeId(organizationId, applicationUserId)` (`lib/leaveRequests.ts`) is the single, platform-wide, reused-everywhere function for "which employee is the logged-in user" — via `employee_user_links`, re-verified against the target organization, **never** a client-supplied employee ID. Every ESS/Manager-Portal surface in the platform imports this exact function rather than reimplementing it. Office Inventory's own ESS surfaces must do the same.

### 2.6 Master data infrastructure (`master-data-domains.ts`, `master-data-items.ts`, `lib/masterData.ts`)
Three-tier classification: `system-defined` (org can never add), `organization-overridable` (system seeds defaults, org can add on top), `organization-defined` (entirely org-populated — e.g. `asset_category`, `document_category`, `payroll_bank`). A new `office_inventory_category` domain (classification `organization-defined`, mirroring `asset_category` exactly) is the natural fit for item categories. A `office_inventory_uom` domain (unit of measure) could follow the same pattern if a controlled list is preferred over free text.

### 2.7 Branches — too minimal to be a "store" directly
`branches`: just `id, organizationId, name, code, status`. No address, no responsible-person field, no capacity. Reusing it directly for "stores" would either force overloading it with inventory-specific fields (polluting a foundation table used by every other module) or leave a store without fields it plausibly needs. **Recommendation: a new, dedicated `office_inventory_stores` table**, optionally FK'd to `branches` if a store sits within a physical branch, never a repurposing of `branches` itself. Flagged as Owner Decision 4.

### 2.8 Numbering engine (`lib/numbering.ts`, `numbering_sequences` table)
The **low-level counter primitive is generic and directly reusable**: `numbering_sequences (organizationId, sequenceKey, periodKey, currentValue)` with a race-safe `lockAndIncrementSequence`/`lockAndIncrementSequenceIn` (row-locked, never `SELECT MAX+1`, self-healing retry on unique-violation) and `formatGeneratedNumber(config, value, tokens)`. `sequenceKey` is free text — a new key like `"office_inventory_item"` or `"office_inventory_receipt"` needs zero schema change.

Two different **higher-level allocation shapes** exist as precedent, and Inventory should pick per its own actual need rather than reflexively copying one:
- **Permanent, non-reusable identity** (PIF's `personnel_files` shape: one row forever, no release path, unique `employeeId`) — fits an item's own permanent catalog code, or a transaction reference number that is never released/reused.
- **Historical allocation with release/reuse** (`employee_number_allocations` shape: half-open `validFrom`/`validTo`, partial-unique-open index, `pickAllocationAsOf` resolver) — fits a scenario where a code is deliberately released and later reassigned to a *different* thing (unlikely for Inventory item codes or transaction references, which should simply never repeat).

**Recommendation: Inventory needs only the simple, permanent-generation shape** (reuse the counter primitive directly; no release/reuse table) — flagged as Owner Decision 23.

### 2.9 Attachment / document infrastructure
One real physical file store exists: `employee_documents` (+ `lib/fileStorage.ts`'s private, permission-gated, random-key local-disk storage — never a public URL). Every other module attaches documents via a **thin join table into `employee_documents`**, never a second storage subsystem — confirmed via `asset_evidence`, `performance_review_evidence`, `learning_enrollment_evidence`. Asset Management's own migration made `employee_documents.employeeId` nullable specifically so a non-employee-owned record (an asset) could still attach documents — the identical need Inventory has (an item/transaction, not an employee, owns the attachment). **Recommendation: a new `office_inventory_evidence` join table, identical shape, reusing `employee_documents`/`fileStorage.ts` unchanged.**

### 2.10 Notification infrastructure — confirmed NOT actually wired up
The `notifications` table and its read/mark-read routes exist, but **nothing anywhere in the codebase ever inserts a row into it** — confirmed by an exhaustive grep. Every module that could plausibly trigger a notification (Leave approval/rejection, Manager Portal) has an explicit `// not implemented, same documented-not-built precedent` comment at the natural trigger point. **This means Office Inventory would be the first real implementation of live notifications on this platform, not an integration with an existing system.** Flagged as Owner Decision 22 — confirm whether V1 genuinely needs this or defers it, since building it is new ground, not reuse.

### 2.11 Audit infrastructure (`lib/auditLog.ts`, `audit_events` table)
Real, working, append-only (`recordAuditEvent({ actorApplicationUserId?, actorMembershipId?, organizationId?, eventType, targetType, targetId?, beforeState?, afterState?, ipAddress?, userAgent?, metadata? })`). Convention confirmed: ordinary reads stay silent (personnel files, employees); **mutations are always audited** (Assets alone has ~15 distinct `eventType` mutation audits); a narrow, explicitly-disclosed exception exists for genuinely sensitive **reads** (Payroll banking/statutory-identifier reads — "a deliberate exception to the platform's general read-silence convention"). Office Inventory should mutation-audit every ledger-producing action (mirroring Assets' pattern exactly) and stay read-silent by default.

### 2.12 Reporting framework (ADR-016)
Confirmed precisely: `reports` (catalog registry, seeded via `report-definitions.ts`) is used for **discoverability only**. The generic runner (`GET .../reports/:reportKey/run`) only has 3 hardcoded, org-id-only report keys in its `RUNNERS` map (`headcount`, `workforce_status`, `audit_summary`); every other category (recruitment, attendance, performance, learning, assets, personnel records, payroll) is registered in the catalog for listing purposes only and executed through its own **dedicated, scope-aware route** (e.g. `GET .../assets/reports/:reportKey`, `GET .../payroll/runs/:runId/reports/:reportKey`) — because the generic signature can't express own/team/manager/org-wide visibility tiers. Office Inventory's reports must follow this exact dedicated-route pattern.

CSV export convention: the platform-wide `toCsv` helper has **no formula-injection escaping** (no guard against a leading `=`/`+`/`-`/`@`) — a known, disclosed, unfixed gap present in every report export except one. The **sole exception** is Payroll's payment-batch export (`payrollPaymentBatches.ts`'s `safeCsvCell`), hardened specifically because it's a real payment instruction containing free-text names a bank operator might paste into another system. **Office Inventory's receiving records capture free-text supplier/source fields with a broadly comparable risk profile** — flagged as Owner Decision 28.

### 2.13 ESS / Manager Portal
Both confirmed built entirely on `resolveOwnEmployeeId` + `employees.reportingManagerId` (live, never snapshotted, re-resolved on every call). Manager Portal's own file header states this exact query pattern (`WHERE reportingManagerId = <manager's employeeId>`) is **the 8th independent implementation** across the codebase (Attendance, Leave×2, Manager Portal, Assets×2, Users) — each module deliberately writes its own small local copy rather than a shared consolidated function. **A Department-Head-approves-Inventory-requests surface reusing `reportingManagerId` directly would be the 9th — normal and expected, not a shortcut.** However, this only identifies "my personal manager," not "my department's formal head" — see §2.4 above; the two are not guaranteed to be the same person.

### 2.14 Phase 3H personnel/PIF custody architecture — the pattern to reuse
This is the deepest, most directly relevant precedent for an event-ledger inventory design:
- **`records_locations`** — self-referencing, org-scoped location hierarchy, no hard-coded level labels.
- **`personnel_files`** — one permanent row per employee, a **denormalized custody-state cache** (`currentCustodyState` enum `["in_registry","checked_out","missing"]`, `currentLocationId`), explicitly documented as "kept transactionally consistent with `personnel_file_movements` via `SELECT ... FOR UPDATE`... never a stored 'overdue'."
- **`personnel_file_movements`** — the **append-only event ledger** (`eventType: checked_out | returned | marked_missing | recovered`), immutable, every row a discrete fact, identity always via `personnelFileId` (never a human-readable string), so history survives any later renaming/reuse.
- **State machine + concurrency** (`lib/personnelFileCustody.ts`): every mutating function locks the custody-target row `FOR UPDATE` inside a transaction *before* checking `currentCustodyState`, validates the transition (`checkoutPersonnelFile`: `in_registry→checked_out`; `returnPersonnelFile`: `checked_out|missing→in_registry`; `markMissing`: `checked_out→missing`, mandatory reason; `recover`: `missing→in_registry`), updates the cache, appends the ledger row, and audits — all atomically. A generic `IllegalCustodyTransitionError` naturally serializes concurrent conflicting attempts via the row lock.
- **Overdue derivation** — never stored; always `currentCustodyState === "checked_out" AND lastCheckout.expectedReturnDate < now`, with a **batched** resolver (`resolveLastCheckoutDetails`, one query for many rows) used by reporting to avoid N+1.
- **Dual-target lock abstraction** (file vs. volume) — directly reusable for an item vs. a specific batch/serialized-unit if Inventory ever needs that distinction.

**This is the single strongest architectural precedent for Office Inventory's own event-ledger + cache design (§9)** — reused as a *pattern*, never as a shared table or identity, exactly as instructed.

### 2.15 Assets module — the boundary neighbor
5 tables (`assets`, `asset_assignments`, `asset_maintenance`, `asset_evidence`, `asset_incidents`), all shipped in **one migration**. Custody is 100% row-history: `asset_assignments` has **no mutable `employeeId` pointer on the asset itself** — a DB-enforced partial unique index (`WHERE custody_ended_at IS NULL`) guarantees at most one active assignment per asset, with snapshot columns (`assetTagSnapshot`, `categorySnapshot`, `departmentIdSnapshot`) captured once at issue time. Separation/offboarding is confirmed **warn-only and explicitly never coupled into `separateEmployee()`** — Assets' own frozen plan states this as a hard invariant ("no hard block, no database trigger... an organization... must never be prevented from terminating an employee"); the "warning" is purely a separate report HR consults. Assets never implemented a real "transfer" action (only `return` + a fresh `assign`, two operations) — **Office Inventory does need real transfer/handover as first-class operations, per the requirements above, so this is a place where Inventory must go beyond Assets' own precedent, not copy it.** Incident handling (self-report → HR review, terminal `open→reviewed|dismissed`) is a clean, minimal pattern worth reusing for damage/missing reports.

---

## 3. Existing Functionality That Overlaps Inventory

None, materially. The only overlap is conceptual/boundary-adjacent (Assets tracks durable, individually-tagged property; Personnel Files tracks physical-file custody) — both explicitly and repeatedly disclaim being a quantity/stock system. No code, schema, or UI needs to be modified to make room for Inventory; the two modules can coexist with a clean, additive boundary (§28 below).

---

## 4. Reuse-vs-New-Build Matrix

| Concern | Reuse directly | Reuse as pattern only | Build new |
|---|---|---|---|
| Module registration | — | `module-definitions.ts` shape | new `office_inventory` entry |
| Org enable/disable | `organization_modules` mechanism | — | — |
| Org-level config | `organization_settings` namespace mechanism | — | new `office_inventory` namespace |
| Permissions | `roles`/`permissions`/`role_permissions` mechanism | `resource = module key` convention | new `office_inventory.*` keys |
| Custom roles | role-template-copy mechanism | — | — |
| "Who am I" (ESS) | `resolveOwnEmployeeId` | — | — |
| "Who reports to me" | `employees.reportingManagerId` query pattern | — | own local copy (9th instance) |
| Department head | — | — | **new** — no existing field (Owner Decision 6) |
| Delegation | — | — | **new** — confirmed nowhere in the codebase |
| Master data (categories/UOM) | `master_data_domains`/`items` mechanism | — | new domain entries |
| Location/store | — | `records_locations`/`branches` shape (self-ref hierarchy, minimal fields) | new `office_inventory_stores` |
| Numbering | `numbering_sequences` counter primitive | permanent-generation shape (PIF-style) | new `sequenceKey`s |
| Attachments | `employee_documents` + `fileStorage.ts` | `asset_evidence` join-table shape | new `office_inventory_evidence` |
| Event ledger + cache | — | `personnel_file_movements`/`personnel_files` cache-with-ledger-authority pattern | new `office_inventory_stock_movements` + balance derivation |
| Custody state machine | — | `personnelFileCustody.ts`'s lock→validate→transition→ledger→audit shape | new inventory-specific state machine |
| Concurrency | — | `SELECT ... FOR UPDATE` row-locking pattern; retry-on-unique-violation | applied to new tables |
| Audit | `recordAuditEvent` | Assets' exhaustive per-mutation pattern | new `office_inventory.*` event types |
| Reporting | `reports` catalog registration mechanism | ADR-016 dedicated-route pattern | new dedicated route + report functions |
| CSV export | `toCsv` baseline | Payment Batches' `safeCsvCell` hardening pattern (recommended, Owner Decision 28) | — |
| Notifications | `notifications` table/schema (dormant) | — | **new** — first real trigger implementation, if wanted |
| Separation warning | — | Assets' report-only, non-coupled pattern | new report following the same shape |
| Assets handoff | — | — | new, explicit, manual conversion action (Owner Decision 1) |

---

## 5. Current Gaps

1. No department-head/departmental-approval-authority concept anywhere in the schema.
2. No delegation/temporary-authority mechanism anywhere in the codebase.
3. No quantity/stock/store concept anywhere.
4. No working notification-trigger implementation anywhere (table exists, unused).
5. No "transfer" as a first-class operation anywhere (Assets punted on it).
6. `branches` too minimal to directly represent a store with a responsible person.

None of these are defects — they are simply capabilities Office Inventory needs that nothing in the platform has built yet.

---

## 6. Proposed Module Architecture

**Module key**: `office_inventory` (PROPOSED, not frozen). **Category**: `hr-operations` (matching every non-Payroll precedent; Payroll's own new category was justified by genuine financial/statutory distinctness that Inventory doesn't share — a minor, low-stakes, reversible choice, not raised as a full Owner Decision, mirroring how the Payroll plan resolved its own equally minor "module category" question pragmatically). **Status**: `hidden` at registration (per the platform's own universal bootstrap convention), flipped to `active` once its own foundation workstream ships. **`defaultEnabled`**: `false`. **`requiredModuleKeys`/`optionalModuleKeys`**: both empty — Inventory does not depend on Assets to function; the Assets handoff (§9 below) is a manual, permission-gated action, not a module dependency, and no existing module uses `optionalModuleKeys` as a live precedent to imitate.

Enabling/disabling Inventory touches only its own tables and the shared `organization_modules` row — it cannot affect HR, Payroll, Assets, or Personnel Records, exactly as every other module's isolation is already proven (module gate + org-scoped tables + narrow permissions, the same three-part isolation guarantee already demonstrated end-to-end by every prior workstream in this repository).

---

## 7. Proposed Item Model

New `office_inventory_items` (the catalog): organization-scoped, `itemCode` (server-generated via the numbering engine, permanent, never reused — see §2.8), `name`, `description`, `categoryCode` (free-text code from the new `office_inventory_category` master-data domain, unvalidated FK per the platform's own `asset.categoryCode` precedent), `unitOfMeasure` (free text or a second master-data domain — Owner Decision), `classification` enum `["consumable", "returnable"]` (Owner Decision 2 — is this the right, complete taxonomy for V1?), `reorderLevel` (nullable numeric), `status` (`active`/`inactive`), optional `unitCost`/`currency` (reference-only, mirroring `assets.purchaseCost` — Owner Decision 3 on whether V1 needs valuation at all).

**Durable/serialized property boundary**: explicitly out of this catalog. If an organization wants to individually track a durable item (a laptop, a projector), that belongs in the existing Assets module, never duplicated here (§28 below).

---

## 8. Proposed Store/Location Model

New `office_inventory_stores`: organization-scoped, `name`, `code`, optional `branchId` FK (a store may sit inside a physical branch), optional `responsibleMembershipId` (the appointed Store/Inventory Officer), `status`. **Flat for V1** (no hierarchy) — Owner Decision 4 on whether a hierarchy (mirroring `records_locations`' self-referencing shape) is needed now or can be deferred; recommend deferring, since nothing in the stated requirements (Main Store, Administration Store, Media Store, Cleaning Store — all flat, sibling stores) demands one. Store-to-store transfers are a first-class ledger event (§9), never modeled as consumption.

---

## 9. Proposed Stock-Ledger/Movement Model — the architectural core

Two layers, directly mirroring the personnel-file custody pattern's own cache-with-ledger-authority split:

**Layer 1 — the append-only ledger**: new `office_inventory_stock_movements`. One row per discrete fact: `organizationId`, `storeId`, `itemId`, `movementType` (`received | issued | returned | transferred_out | transferred_in | damaged | missing | recovered | written_off | adjusted`), a **signed** quantity delta (positive or negative — balance is always `SUM(delta)`, directly satisfying "current state can be derived... while historical movements remain authoritative"), a polymorphic `referenceType`/`referenceId` pointing back to the originating domain transaction (a receipt line, an issue line, a transfer, a write-off, an adjustment, a stocktake resolution — never inventing meaning beyond what the source record already states), `actorMembershipId`, `occurredAt`, `notes`. Never edited or deleted.

**Layer 2 — richer domain-specific transaction tables** (receiving, requests, issues, returns, handovers, incidents, write-offs, adjustments, stocktakes — §10–§22 below) each carry their own full business context and, upon their own authoritative action, append one or more ledger rows.

**Current balance**: **derived live** for V1 (`SUM(delta)` per `(storeId, itemId)`, batched — never one query per row), not a separately maintained cache table — directly following the explicit instruction not to invent persistent aggregate state without evidence it's needed. If a specific dashboard/report proves this too slow at real scale, a cache table (mirroring `personnel_files.currentCustodyState`'s pattern exactly) can be added later as a proven optimization, not a speculative one. **Current custody** (who holds a returnable item) is likewise derived live from the ledger for V1, for the same reason. Both are flagged together as **Owner Decision 4 (derive-vs-cache)**.

Every mutating action locks the relevant balance-defining rows `FOR UPDATE` before appending a ledger row and validating sufficient stock — **negative stock is strictly prohibited** (Owner Decision 18) — mirroring the personnel-file custody lock-then-validate-then-mutate transaction shape exactly.

---

## 10. Proposed Request Model

New `office_inventory_requests` (header: `requestedByMembershipId`, `requestType: employee|department`, `forEmployeeId`/`forDepartmentId`, `status`) + `office_inventory_request_lines` (`itemId`, `quantityRequested`, `quantityApproved`, `quantityIssued` — supporting partial approval and partial fulfilment directly at the line level, per the explicit requirement). The requester does not become custodian merely by submitting a department request — custody is established only by the actual issue transaction (§13), never inferred from the request.

---

## 11. Department Approval Model

**The core open question (Owner Decision 6)**: no "Department Head" field exists anywhere in the platform today. Two options considered:
- **(a)** Reuse the requester's own `reportingManagerId` as the approver. Simple, zero new schema, but conflates "my personal manager" with "my department's formal approval authority" — not guaranteed to be the same person, and doesn't cleanly resolve a *department-submitted* (not individual) request at all, since a department request has no single natural "requester's manager."
- **(b) (recommended)** A new, Inventory-scoped `office_inventory_department_approvers` table — mirroring `primary_hr_assignments`' own proven shape (a dedicated assignment table with a partial-unique-active-row-per-department constraint) rather than modifying the core `departments` table, keeping this concept bounded to Inventory's own need rather than a general HR schema change (avoiding scope creep into core HR foundation tables, consistent with the platform's own module-isolation principle).

For an individual employee's request: resolve the employee's `departmentId` (from authoritative HR data, per the explicit requirement), then resolve that department's current approver via (b). For a department request: resolve the target department's approver the same way. **Department Heads may approve their own requests — no self-approval prohibition, a deliberate, explicit departure from the maker-checker pattern used elsewhere in this platform (Payroll, Statutory Rules), because the user's own requirement states this explicitly and unambiguously.** Approval never itself mutates stock — issue (§13) is the only stock-affecting event.

---

## 12. Delegation Model

Confirmed genuinely new ground (§2.13). New `office_inventory_approval_delegations`: `organizationId`, `departmentId`, `delegatingApproverMembershipId`, `delegateMembershipId`, `validFrom`, `validTo` (half-open interval, mirroring `employee_compensation_components`/`employee_number_allocations`' own proven shape), a partial-unique-open index (`WHERE valid_to IS NULL`) enforcing at most one open delegation per `(departmentId, delegatingApproverMembershipId)`, `createdByMembershipId`, `revokedByMembershipId`/`revokedAt`. Revocation closes `validTo` rather than deleting the row — full history preserved.

**Historical approval preservation (per the explicit requirement)**: every approval record on a request line stores `actualApproverMembershipId`, `actedAsDelegate: boolean`, `delegatorMembershipId` (nullable), and a `delegationId` reference (nullable) — snapshotted at the moment of approval, never re-derived later. A later delegation revocation or role change never rewrites a historical approval's recorded authority.

---

## 13. Repeat-Request / Existing-Accountability Detection Model

A **query-time, non-blocking** function run at approval-review time (never a stored flag, never an automatic rejection): looks up, for the requesting employee/department and the requested item(s), (a) requests/issues within an organization-configurable review window (new `office_inventory` config-namespace field, default e.g. 30 days — Owner Decision 5 on whether item/category-specific windows are needed for V1; **recommended: a single org-level default for V1**, deferring per-item overrides until real usage shows the need, consistent with the explicit instruction against premature complexity), and (b) current outstanding returnable custody (derived live from the ledger, §9). Presented to the approver as an informational panel exactly matching the example in the request ("RECENT / EXISTING ACCOUNTABILITY... The Department Head can still approve") — **never blocks submission or approval.**

---

## 14. Receiving Model

New `office_inventory_receipts` (header: `storeId`, `receivedByMembershipId`, `source` free text, `deliveryReference` free text, `receivedAt`, `notes`) + `office_inventory_receipt_lines` (`itemId`, `quantity`, optional `unitCost`). On confirmation, each line appends a `received` ledger row and the derived balance increases. Deliberately **no supplier table, no purchase-order reference, no invoice-approval workflow** — captured fields are descriptive only, per the explicit hard scope boundary against Procurement. Optional supporting attachment via the new evidence join table (§2.9).

---

## 15. Issue / Fulfilment Model

New `office_inventory_issues` (+lines), referencing the originating approved request line (`quantityApproved` vs. `quantityIssued`, supporting partial issue). **Owner Decision 29**: should a direct, no-prior-request issue path exist for V1 pragmatism (e.g., quick over-the-counter dispensing)? Recommended: yes, but gated by a distinct, narrower permission than ordinary request-based issuing, and clearly disclosed as a deliberate exception to the module's own "who requested it, who approved it" accountability chain — not silently allowed by default. Approval never itself reduces stock (§11); only the issue transaction appends the `issued` ledger row and reduces the derived balance, and only up to the approved quantity remaining.

---

## 16. Receipt-Confirmation Model

A distinct acknowledgement event on the issue line — `acknowledgedAt`/`acknowledgedByMembershipId` — directly mirroring Assets' own `asset_assignments.acknowledgedAt` pattern. For individual issues: the recipient employee confirms via ESS (§31), reusing `resolveOwnEmployeeId`. For department custody: **Owner Decision 8** — recommend the original requester (if the request was department-type) or any membership in scope for that department (via `membership_scopes`), rather than inventing a new "authorized representative" designation distinct from the approval-authority concept already being built in §11.

---

## 17. Employee / Department Custody Model

Derived live from the ledger (§9): for each `(itemId, holderType: employee|department|store, holderId)`, outstanding returnable quantity = sum of `issued`/`transferred_in` minus `returned`/`transferred_out`/`written_off` deltas attributable to that holder. Historical custody is never overwritten to show only the current holder — every ledger row remains permanently queryable, exactly matching the explicit requirement and the PIF/Assets precedent.

---

## 18. Return / Handover / Transfer Model

- **Return** (§17 of the request): new `office_inventory_returns`, appends a `returned` ledger row crediting the receiving store; never erases the original `issued` row.
- **Handover** (§16 of the request): new `office_inventory_handovers` — `fromHolderType/Id`, `toHolderType/Id`, `itemId`, `quantity`, `reason`, `condition`, `initiatedByMembershipId`, `confirmedByMembershipId`/`confirmedAt`. Appends paired debit/credit ledger rows against the two holders. Supports employee→employee, employee→department, department→employee, and department→department (**Owner Decision 20**: is department-to-department transfer authorized the same way as a request, or does it need its own distinct authorization? Recommended: gate it behind the same department-approver concept from §11, applied to the *receiving* department, to keep one consistent authorization model rather than inventing a second).
- **Transfer** (store-to-store, §7 of the request): appends paired `transferred_out`/`transferred_in` ledger rows against the two stores — **never modeled as consumption**, directly per the explicit requirement, and a genuine capability Inventory must build fresh since Assets never implemented real transfer (§2.15).

---

## 19. Consumable Model

**Recommended for V1 (Owner Decision 12): issue itself is sufficient consumption authority** — no separate "consumption event" beyond the `issued` ledger row, per the explicit instruction not to over-engineer without evidence. The system still preserves exactly which employee/department received consumable stock (the `issued` row's holder) and supports consumption-analysis reporting (§27) directly from that same ledger, without inventing a second event type.

---

## 20. Damage / Missing / Recovery Model

New `office_inventory_incidents`, deliberately mirroring `asset_incidents`' clean, minimal shape: `itemId`, `holderType/Id` at time of report, `incidentType: damage|loss`, `description`, `reportedByMembershipId`, `status: open→reviewed|dismissed` (terminal, no reopen). A reviewed incident **never automatically mutates the ledger** — HR/Store Officer separately and deliberately appends a `damaged`/`missing` ledger row via its own dedicated action (mirroring Assets' explicit decoupling: reviewing an incident is a distinct decision from acting on it). A later `recovered` ledger row does not delete or hide the original `missing` row — the item's full accountability history, including the period it was missing, remains permanently visible, directly per the explicit requirement.

---

## 21. Write-Off Model

A dedicated, narrowly-permissioned action appending a terminal `written_off` ledger row with a mandatory reason. **Owner Decision 14**: single-actor authorization (narrow permission only) vs. a maker-checker workflow (the platform has a proven pattern for this, from Payroll's statutory-rule and run-approval controls, directly reusable if stricter financial control over disposals is wanted). **Recommended for V1: single-actor, narrow permission** — write-off of office consumables/returnables is a materially lower financial-control stakes than payroll figures, and maker-checker can be added later without a breaking schema change if Owner Review wants it.

---

## 22. Stock Adjustment Model

A dedicated, narrowly-permissioned action appending an `adjusted` ledger row with a mandatory `reason` and optional reference — **never a directly-editable balance field anywhere in the schema.** Owner Decision 15 on whether adjustments need their own approval workflow beyond permission-gating; recommended: permission-gating only for V1, mirroring write-off's own recommended posture.

---

## 23. Stocktaking Model

New `office_inventory_stocktakes` (session: `storeId` scope, `status: draft→counting→finalized`, `startedAt`, `finalizedAt`, `finalizedByMembershipId`) + `office_inventory_stocktake_lines` (`itemId`, `expectedQuantitySnapshot` — captured **at session start**, not re-derived at finalization — `countedQuantity`, `variance` computed, `resolutionType: adjustment|missing|accepted`, `resolutionReference`).

**Owner Decision 16 (freeze vs. live-movement strategy)**: does starting a stocktake **block** ordinary issues/receipts against that store for its duration, or does it snapshot expected quantity at the start and simply flag any movement that occurs during an open session as a caveat at finalization? **Recommended: snapshot-at-start, do not block live operations** — freezing an entire store's operations is a disproportionate operational cost for an HR-centered organization at WWM's scale, and the caveat-flagging approach still makes any resulting discrepancy fully visible and auditable rather than silently absorbed. **Owner Decision 17**: finalization requires an explicit resolution action on every non-zero-variance line (an adjustment, a missing-item record, or an explicit "accepted as explained" note) before the session can close — a variance is never allowed to silently mutate stock. QR/barcode scanning is explicitly deferred (not a V1 dependency), per the explicit instruction.

---

## 24. Reorder / Low-Stock Model

A simple computed comparison (`derivedBalance <= item.reorderLevel`) surfaced on the dashboard and a dedicated report (§27) — no automation, no purchase order, no procurement workflow of any kind, directly per the explicit hard boundary.

---

## 25. Assets Integration Boundary

**Office Inventory** manages stores, quantities, and stock accountability for consumable and returnable items. **Assets** remains authoritative for individually identifiable durable property. **No physical item is ever dual-custody between the two systems.**

**Controlled handoff (Owner Decision 1, the single highest-priority decision in this report)**: if an item received through Inventory is later judged to warrant individual Asset registration (e.g., a received durable item that should be individually tagged and tracked), propose an explicit, permission-gated "Convert to Asset" action on the originating receipt/item-instance — never automatic, never inferred. This action calls the *existing* Assets creation API/service directly (never duplicating its logic), records a one-way linking reference back to the originating Inventory record for traceability, and the item's Inventory-side quantity is correspondingly reduced (an `adjusted` or dedicated `converted_to_asset` ledger row — Owner Decision, exact ledger semantics to be frozen at implementation). The reverse direction (an existing Asset flowing back into Inventory) is explicitly **out of scope** for V1 unless Owner Review identifies a real need.

---

## 26. Personnel/PIF Filing Boundary

No overlap. Office Inventory reuses the personnel-file custody system's *architectural patterns* — the append-only ledger, the cache-with-ledger-authority split, the row-lock-then-validate-then-mutate transaction shape, the batched live-derivation convention — but never its tables, its identity, or its numbering. `records_locations` is not reused directly for stores (§8) since its semantics (a physical-file storage hierarchy) don't cleanly map to a stock-holding location with a responsible officer and balances.

---

## 27. Separation Integration

**Warn, never block** — directly matching both the explicit instruction and the platform's own proven, repeated precedent (Assets' own frozen plan states this as a hard invariant; Personnel Files' unreleased-number report follows the identical shape). Implemented as a dedicated report (mirroring `asset_unreturned_by_employee`/`personnel_separated_unreleased_numbers` exactly): outstanding returnable custody, pending handovers, missing items, unresolved returns, filterable by employee — **never coupled into `separateEmployee()`** itself, no trigger, no hard block, no automatic return/transfer/write-off merely because an employee separated (all three explicitly prohibited by the requirement).

---

## 28. Employee Department Change

Inventory custody remains attached to the specific employee (`employees.id`) regardless of a later department change — it is never silently reattributed to the employee's new department. Responsibility changes only through an explicit handover/transfer/return action (§18), exactly per the explicit requirement.

---

## 29. ESS Integration

Via `resolveOwnEmployeeId` exclusively, never a client-supplied employee ID: submit own request, view own requests/status (including approval status), confirm receipt of an issued item, view own current returnable custody, initiate a return/handover request, view own inventory history, and (if authorized by a narrow permission) report damage/missing on an item currently in the employee's own custody.

---

## 30. Department Head / Manager Experience

An approval screen resolving, per request: the request itself, requester, requesting department, requested quantity, current store availability (derived balance), the repeat-request/existing-accountability panel (§13), the employee's and department's current outstanding custody, and — if the actor is acting as a delegate — the delegation authority being exercised (§12). Actions: approve, partially approve (per line), reject, with a mandatory comment on rejection. **Department Heads may approve their own requests — no self-approval prohibition**, a deliberate, explicit, disclosed departure from the maker-checker pattern used elsewhere in this platform, because the requirement states this unambiguously.

---

## 31. Organization Administrator Model

The org's own Organization Administrator configures module enablement, stores, categories, and assigns operational roles (Store/Inventory Officer, department approvers, delegates) through the existing role/permission-assignment mechanism (§2.3) — **administrative configuration authority is kept structurally separate from operational/data authority**: an Organization Administrator does not automatically gain issuing, approval, or write-off permissions merely by administering the organization, mirroring Payroll's own proven precedent ("no role automatically gains new permissions merely because the module exists").

---

## 32. Proposed Permissions (PROPOSED, not frozen — Owner Review to confirm/trim)

Following the platform's `resource = module key` convention, resource `office_inventory`:

`office_inventory.configure` · `office_inventory.item.manage` · `office_inventory.store.manage` · `office_inventory.receive` · `office_inventory.request` (submit + implicitly read own) · `office_inventory.approve` (department approval) · `office_inventory.delegate.manage` · `office_inventory.issue` · `office_inventory.receipt.confirm.own` · `office_inventory.custody.read` · `office_inventory.return` · `office_inventory.transfer` · `office_inventory.handover` · `office_inventory.report_issue.own` (damage/missing self-report, mirroring Assets' `write.own` narrowness) · `office_inventory.incident.review` · `office_inventory.recover` · `office_inventory.adjust` · `office_inventory.writeoff` · `office_inventory.stocktake` · `office_inventory.reports.read`.

Roughly 20 keys — deliberately closer to Payroll's granularity than Assets' minimal 4, because Inventory genuinely has more separable operational authorities (the explicit requirement itself asks for this level of separation across configuration, catalog, store management, receiving, requesting, approval, delegation, issuing, confirmation, custody visibility, returns/transfers/handovers, incident reporting/review, recovery, adjustment, write-off, stocktaking, and reporting). **None granted to `employee`/`hr_manager`/`org_admin` by default** — mirroring Payroll's own explicit precedent that ordinary HR authority must not automatically imply a new module's operational authority — WWM HR receives Inventory access only through the same deliberate, future, explicit role/permission assignment every other module already requires.

---

## 33. Audit Model

Mutation-audit every ledger-producing action and every configuration change (item/store/category creation and edits, delegation creation/revocation, receipt, request submission, approval/rejection, issue, receipt confirmation, return, handover, transfer, incident report/review, recovery, adjustment, write-off, stocktake creation/count/finalization/resolution) — mirroring Assets' exhaustive per-mutation pattern exactly, narrow `beforeState`/`afterState` snapshots, never full-row dumps. Ordinary reads (browsing the catalog, viewing a store's stock) stay silent by default, matching the platform's general convention — **Owner Decision 11**: does any Inventory read (e.g. a valuation/cost report, if §7's cost tracking is approved) warrant the Payroll-banking-style read-audit exception? Recommended: no, unless Owner Review specifically identifies a comparable sensitivity — office-supply quantities are not comparably sensitive to bank account numbers or statutory identifiers.

---

## 34. Reporting / Dashboard Model

Dashboard tiles (mirroring Assets' 5-tile, zero-invented-KPI precedent): current stock count, low/out-of-stock item count, items currently with employees, items currently with departments, outstanding returnables, overdue temporary issues (live-derived, batched, never stored), pending receipt confirmations, recent repeat-request warnings triggered, open damage/missing incidents, unresolved stocktake variances.

Reports (all via the ADR-016 dedicated-route pattern, registered in `report-definitions.ts` for catalog discoverability only): Current Stock · Stock by Store · Stock Movement Ledger · Receipts · Issues · Employee Custody · Department Custody · Employee Inventory History · Department Inventory History · Outstanding Returns · Overdue Returnables · Missing Items · Damaged Items · Write-Offs · Adjustments · Stocktake Variances · Department Consumption · Repeat-Request History · Low Stock/Out of Stock · Stock Valuation (only if §7's cost-tracking Owner Decision is approved).

---

## 35. Concurrency / Idempotency Model

Every mutating ledger-append action locks the relevant `(storeId, itemId)` balance-defining rows `FOR UPDATE` inside a transaction *before* validating and appending — directly mirroring `lockCustodyTarget`'s proven shape. Reference-number generation reuses the row-locked, retry-on-unique-violation counter pattern (§2.8). Sufficient-stock validation happens *after* acquiring the lock, never before, so two simultaneous issues against the same limited stock serialize correctly rather than both reading a stale balance. Idempotency for double-submission risks (duplicate receiving/issue submissions, double receipt confirmation, double approval) follows the same "conditional UPDATE guarded by expected prior state, 409 on mismatch" pattern used throughout Assets and Personnel Files — never left to a disabled frontend button alone.

---

## 36. Tenant Isolation / RLS Model

Every new table `organizationId`-scoped, RLS enabled with zero policies at the database level (deny-by-default, authorization entirely in the application layer) — the platform's own 100%-consistent convention, currently true of all 111 public tables including all 16 Payroll tables and all 5 Assets tables. Office Inventory's full schema would extend this to roughly 130 tables, all following the identical convention.

---

## 37. Historical Integrity Model

`employees.id` remains the sole technical identity throughout — never a staff number, never an employee name, as a foreign key anywhere. Every transaction row that needs a human-readable label at the time it mattered (requester name, department name, item name/code) snapshots it, exactly mirroring `asset_assignments`' own snapshot columns; only "who currently holds this" queries perform a live join. This directly extends the same guarantee already proven twice over in this platform (Phase 3H's staff-number reuse, Payroll's staff-number-reuse compatibility) to a third module, without re-deriving the principle from scratch.

---

## 38. Proposed Schema / Tables (shape and purpose only — full DDL is implementation-phase work, not discovery)

`office_inventory_items` · `office_inventory_stores` · `office_inventory_stock_movements` (the ledger) · `office_inventory_requests` + `_request_lines` · `office_inventory_department_approvers` · `office_inventory_approval_delegations` · `office_inventory_receipts` + `_receipt_lines` · `office_inventory_issues` + `_issue_lines` · `office_inventory_returns` · `office_inventory_handovers` · `office_inventory_incidents` · `office_inventory_writeoffs` · `office_inventory_adjustments` · `office_inventory_stocktakes` + `_stocktake_lines` · `office_inventory_evidence`.

Roughly 19 tables — materially larger than Assets' 5-table, single-migration footprint, and closer in scale to Payroll's own multi-migration, multi-workstream shape. This is stated plainly rather than understated.

---

## 39. Expected Migration Impact

First migration would be `0050`. Given the schema's real breadth (§38), **a single migration for the entire module is not realistically expected** (unlike Assets' one-migration precedent) — a phased sequence across the workstreams below, each contributing its own migration as it ships, is the more realistic and honest estimate, mirroring how Payroll itself required 5 migrations (`0045`–`0049`) across its own workstream sequence.

---

## 40. Proposed Frontend Surfaces

An HR/Admin catalog + store management surface; a Store/Inventory Officer operational workspace (receiving, issuing, transfers, stocktaking — mirroring `asset-workspace.tsx`'s established operational-surface convention); a Department Head approval surface (mirroring the accountability-context-rich review screen already proven for Assets/incidents and Payroll/corrections); an accountability dashboard (mirroring `assets-dashboard.tsx`); a reports surface (mirroring `asset-reports.tsx`); an ESS "My Inventory" tab (mirroring the existing `MyAssetsTab` embedded-tab convention inside `employee-self-service.tsx`, rather than a standalone page, for consistency).

---

## 41. Configuration Model

A new `office_inventory` config namespace (§2.2): repeat-request review-window default (days), whether cost/valuation tracking is enabled, whether the direct-issue-without-request path is enabled, default receipt-confirmation requirements. All org-configurable, none hard-coded.

---

## 42. WWM-Specific Configuration Needs (without hard-coding WWM)

WWM's actual store list (Main Store, Administration Store, Media Store, Cleaning Store) and its department-approver assignments are **ordinary configuration data** an Organization Administrator enters through the generic store-management and department-approver-assignment surfaces described above — nothing in the schema or code references WWM specifically. This report does not configure any of it; that remains future, separately-authorized work.

---

## 43. Explicit V1 Scope

Module foundation and configuration · item catalog and categories · stores · the stock-movement ledger and derived balances · employee and department requests with partial approval · department approval with a new department-approver assignment concept · delegation with full historical preservation · the repeat-request/existing-accountability warning · receiving · issuing/fulfilment with partial issue · receipt confirmation · employee/department custody visibility · returns, handovers, and transfers · damage/missing incident reporting and resolution · write-off · stock adjustment · stocktaking with variance resolution · low-stock/reorder visibility (no automation) · the Assets controlled-handoff action · ESS integration · the Department Head approval experience · the dashboard and report set above · full audit coverage · a verification workstream mirroring Payroll's own W9 precedent.

---

## 44. Explicit Deferrals

Procurement in its entirety (requisitions, RFQs, quotations, tendering, purchase orders, procurement approval, invoice approval, accounts payable, payment processing, vendor contracting) · QR/barcode scanning · a store/location hierarchy beyond flat stores · item/category-specific repeat-request review windows · GL/accounting-journal integration · automatic reorder/purchase-order creation · a formal case-management layer for incidents beyond the open→reviewed/dismissed pattern · Asset-to-Inventory reverse handoff · maker-checker on write-off/adjustment (can be added later without a breaking change) · notifications, unless Owner Review specifically confirms V1 needs the platform's first real implementation of them.

---

## 45. Risks / Ambiguities

- The department-approval-authority gap (§11) is the single largest architectural risk — every other decision in this report is comparatively low-stakes and reversible; this one shapes several downstream tables (approvers, delegation, historical-approval snapshots).
- Nineteen tables is a genuinely large schema footprint; if Owner Review wants a smaller V1, the request/approval/delegation cluster (§10–§13) is the most consolidatable area without losing the module's core accountability objective.
- The derive-vs-cache balance decision (§9, Owner Decision 4) has real performance implications at scale that can't be fully assessed without production-like data volume — the recommendation to start with live derivation is a considered default, not a guarantee it will never need revisiting.
- Building real notifications (§2.10) would be new platform ground, not integration with a working system — a genuine scope/effort consideration for Owner Review, not a minor detail.

---

## 46. Owner Decisions (PROPOSED, not approved — numbered for reference)

1. **Assets handoff** — exact trigger point, authorization, and ledger semantics for "Convert to Asset." *Recommendation: explicit, permission-gated, manual, one-way (§25).*
2. **Item classification taxonomy** — is `consumable`/`returnable` complete for V1? *Recommendation: yes, defer further granularity.*
3. **Cost/valuation tracking** — required for V1 or deferred? *Recommendation: optional reference-only fields, mirroring Assets' own `purchaseCost` precedent; no accounting logic.*
4. **Store/location structure & derive-vs-cache** — flat stores, new dedicated table, live-derived balances/custody for V1. *Recommendation: as stated (§8, §9).*
5. **Repeat-request review-window configuration** — org-level single default vs. item/category-specific. *Recommendation: org-level only for V1.*
6. **Department approval authority source** — new dedicated assignment table vs. reusing `reportingManagerId`. *Recommendation: new dedicated table (§11), the single highest-priority decision alongside #1.*
7. **Delegation duration/revocation model** — half-open interval, partial-unique-open index. *Recommendation: as stated (§12).*
8. **Receipt confirmation — authorized department representative.** *Recommendation: original requester or any department-scoped membership (§16).*
9. **Temporary-return due dates/overdue** — live-derived, batched, mirroring PIF/Assets exactly. *Recommendation: as stated, low ambiguity.*
10. **Consumable treatment** — issue = consumption authority for V1. *Recommendation: as stated (§19).*
11. **Missing/damage workflow — read-audit boundary.** *Recommendation: mutation-audit only, no read-audit exception (§33).*
12. **Write-off authorization** — single-actor narrow permission vs. maker-checker. *Recommendation: single-actor for V1 (§21).*
13. **Adjustment authorization** — permission-gating only vs. dedicated approval workflow. *Recommendation: permission-gating only for V1 (§22).*
14. **Stocktake freeze vs. live-movement strategy.** *Recommendation: snapshot-at-start, do not block operations, flag concurrent movement at finalization (§23).*
15. **Stocktake finalization** — mandatory per-line resolution before close. *Recommendation: as stated, no ambiguity.*
16. **Negative-stock prohibition.** *Recommendation: strictly prohibited (§9, §35).*
17. **Department-to-department transfer authorization.** *Recommendation: gated by the receiving department's approver (§18).*
18. **Direct/no-request issue escape hatch.** *Recommendation: allowed, gated by a distinct narrower permission, clearly disclosed (§15).*
19. **Notification requirements.** *Recommendation: defer to V2 unless Owner Review specifically wants the platform's first real notification implementation (§2.10).*
20. **Inventory reference numbering** — permanent generation only, no release/reuse table. *Recommendation: as stated (§2.8).*
21. **Supporting attachments** — reuse `employee_documents` via a new join table. *Recommendation: as stated (§2.9), low ambiguity.*
22. **CSV formula-injection hardening for Inventory exports** (receiving captures free-text supplier/source fields with a risk profile comparable to Payroll's payment-batch export). *Recommendation: apply the same hardening (§2.12), disclosed as this module's own deliberate exception, not claimed as a platform-wide fix.*
23. **Module category** — `hr-operations`. *Recommendation: as stated, low-stakes (§6).*
24. **Final V1 scope boundary** — confirm §43/§44 as frozen once reviewed.

---

## 47. Proposed Implementation Workstreams (draft sequence, each requiring its own separate explicit go-ahead — mirroring Payroll's own workstream-by-workstream discipline)

**W1 — Foundation.** Module registration (hidden), permissions, org config namespace, master-data domains (category/UOM), `office_inventory_stores` schema. No item catalog, no ledger yet. **STOP boundary: no stock movement of any kind.**

**W2 — Item Catalog & Stock Ledger.** `office_inventory_items`, `office_inventory_stock_movements`, live-derived balance queries, numbering. **STOP boundary: no receiving, no requests yet — the ledger exists but nothing populates it.**

**W3 — Receiving.** `office_inventory_receipts` + lines, evidence attachment. **STOP boundary: no requests/approval/issue yet.**

**W4 — Requests, Department Approval & Delegation.** `office_inventory_requests`/`_lines`, `office_inventory_department_approvers`, `office_inventory_approval_delegations`, the repeat-request warning. **STOP boundary: approval exists but nothing is ever issued yet.**

**W5 — Issue, Fulfilment & Receipt Confirmation.** `office_inventory_issues`/`_lines`, confirmation fields. **STOP boundary: no returns/handovers/transfers yet.**

**W6 — Returns, Handovers & Transfers.** `office_inventory_returns`, `office_inventory_handovers`, store-to-store transfer.

**W7 — Damage, Missing, Recovery, Write-Off & Adjustment.** `office_inventory_incidents`, `office_inventory_writeoffs`, `office_inventory_adjustments`.

**W8 — Stocktaking.** `office_inventory_stocktakes`/`_lines`, variance resolution.

**W9 — ESS & Department Head Experience.** Frontend-heavy: My Inventory tab, approval screen with full accountability context.

**W10 — Reporting & Dashboard.**

**W11 — Assets Handoff.** The controlled conversion action, gated by both modules' own authorization.

**W12 — Full Verification.** Mirroring Payroll's own Frozen Workstream 9 precedent — one integrated live-QA master scenario, hand-calculated boundary checks, concurrency races, historical-reproducibility scenario (staff-number reuse never reassigns historical inventory custody), fresh RLS/permission audit, full regression.

**W13 — Completion Report.** Documentation-only closure, mirroring Payroll's own Frozen Workstream 10 precedent.

This sequence is a draft estimate for Owner Review to reshape, split, or consolidate — not a commitment.

---

## 48. Compatibility Analysis Across Existing Modules

**Payroll**: zero interaction of any kind. **Assets**: one explicit, controlled, manual, one-directional handoff point (§25); otherwise fully independent, non-overlapping data models. **Personnel Files**: architectural patterns reused, zero shared tables or identity. **HR core (employees, departments)**: read-only reuse of `employees.id`, `employees.reportingManagerId`, `departments`; one new Inventory-scoped table (`office_inventory_department_approvers`) added *alongside* `departments`, never modifying it. **ESS/Manager Portal**: extended via the same `resolveOwnEmployeeId`/`reportingManagerId` patterns every other module already uses, no changes to either module's own code. **Module/permission/reporting/audit/numbering/attachment infrastructure**: consumed exactly as designed for exactly this purpose — a new module plugging into proven, general-purpose platform mechanisms, not requiring any of them to change.

---

## Boundary

**STOP after this document.** No implementation begins as a result of this report. No migration `0050` was created. No application code was changed. No Office Inventory data was seeded. Office Inventory was not enabled for WWM or any organization. WWM HR permissions were not changed. No WWM users were configured. Production was not touched. Procurement was not begun. Assets and Personnel Filing were not modified. Payroll was not touched. The next step requires a separate, explicit go-ahead: **Owner Review and plan freeze.**
