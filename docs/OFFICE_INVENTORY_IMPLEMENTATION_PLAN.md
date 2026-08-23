# Office Inventory Management — Owner Review, Architecture Simplification & Plan Freeze

**FROZEN — APPROVED FOR IMPLEMENTATION**

*(architecture and workstream sequence are frozen; no code, schema, or migration was created in producing this document; Office Inventory was not enabled for WWM or any organization; no WWM users, Department Heads, or delegations were configured; production was not touched)*

This document supersedes `docs/OFFICE_INVENTORY_DISCOVERY_REPORT.md` as the authoritative plan. The discovery report remains in the repository as the historical record of how this plan was derived; where the two disagree, this document governs.

---

## 1. Result

All 24 Owner Decisions raised by discovery are resolved below (§4). The discovery's own ~19-table estimate was deliberately challenged and reduced to **11 tables** (§6–§7) by consolidating eight separate transaction-header/line table pairs (receiving, issuing, returns, handovers, transfers, adjustments, write-offs, recovery) into one shared, append-only stock-movement ledger — a genuine architectural simplification, not a cosmetic one, justified line-by-line against the checklist the Owner Review itself specified. The plan is approved for implementation on this basis.

---

## 2. Repository Reconciliation

Performed fresh, not trusted from the discovery report's own prose:

- `git fetch origin` + `git rev-parse HEAD main origin/main` — all three identical at `86409d6`.
- `git status --short` — identical to session start (the same pre-existing, unrelated untracked/modified items only).
- Migration ledger re-read directly — still ends at `0049`. No `0050`.
- `drizzle-kit generate` — zero schema drift.
- `grep -rli "office_inventory"` across `lib/db/src/schema`, `lib/db/src/seed`, `artifacts/api-server/src` — zero matches. No partial implementation exists anywhere.
- Payroll and Phase 3H both confirmed COMPLETE in `PROJECT_STATUS.md`, unchanged.
- **No material contradiction found between the discovery report and current repository fact.** This session proceeds to Owner Decision resolution and plan freeze rather than stopping.

---

## 3. Architecture Simplification (the discovery's ~19 tables, challenged)

Applying the Owner Review's own test to every discovery-proposed table — distinct business entity? unique lifecycle? required for concurrency/integrity? required for historical reconstruction? — the following consolidation was made:

**Eliminated as separate tables, folded into one shared ledger (§7.3):** `office_inventory_receipts` + `_receipt_lines`, `office_inventory_issues` + `_issue_lines`, `office_inventory_returns`, `office_inventory_handovers`, `office_inventory_writeoffs`, `office_inventory_adjustments` — eight tables collapsed into zero additional tables. Rationale: none of these represent a *distinct, independently-stateful* entity — each is a single discrete accountability fact (or a small, symmetric pair of facts — an issue debits a store and credits a holder; a transfer debits one store and credits another; a handover debits one holder and credits another). A shared, richly-columned, append-only `office_inventory_stock_movements` table represents every one of these facts directly, with the paired nature of issue/transfer/handover expressed as two rows sharing one generated `referenceNumber`. This directly satisfies the discovery's own §3 requirement ("an append-oriented/event-ledger architecture... so current state can be derived... while historical movements remain authoritative") more completely than the original per-transaction-type table design did, while removing real schema surface area.

**Retained as their own tables, each independently justified:**
- `office_inventory_items`, `office_inventory_stores` — distinct catalog entities with their own lifecycle (active/inactive), referenced by everything else. Not reducible.
- `office_inventory_stock_movements` — the ledger itself; required for concurrency/integrity and historical reconstruction by definition.
- `office_inventory_requests` + `office_inventory_request_lines` — a genuine multi-step approval workflow (pending → approved/partially approved/rejected → fulfilled) that exists **before** any stock movement occurs; a ledger row records what *was* moved, never what was *requested but not yet fulfilled*. This is real, distinct, pre-movement state the ledger structurally cannot represent.
- `department_heads` — a distinct organizational-authority assignment with its own effective-dated history, independent of any single request (§4.6).
- `office_inventory_approval_delegations` — a distinct, effective-dated authority-delegation relationship (§4.7).
- `office_inventory_incidents` — a genuinely stateful human report-and-review workflow (open → reviewed → dismissed), deliberately never conflated with the ledger's own append-only accounting facts, mirroring Assets' own proven `asset_incidents` precedent exactly (a reviewed incident never itself mutates state — a separate, deliberate action does).
- `office_inventory_stocktakes` + `office_inventory_stocktake_lines` — explicitly pre-authorized by the Owner Review itself ("Stocktaking may justify dedicated tables because it has snapshot/count/finalization semantics"); a stocktake's own per-item counting state (expected/counted/variance) is real, distinct, pre-resolution state, exactly like a request line.
- `office_inventory_evidence` — a genuine many-to-one attachment join table, mirroring `asset_evidence`'s own proven shape; folding it into anything else would lose the ability for one attachment to relate to a movement, an incident, or a stocktake without inventing a false single owner.

**Disclosed trade-off, stated honestly rather than hidden**: the consolidated ledger table is wide (~26 columns, most nullable, populated differently per `movementType`). This is a deliberate trade-off in favor of a smaller total table count and a single, simple mental model ("every accountability fact is one row in one table"), at the cost of more nullable columns on that one table than a fully normalized per-type design would have. `holderId` is a polymorphic reference (an employee id or a department id depending on `holderType`) and therefore **cannot** carry a real database foreign key to either table — this genuinely weakens one specific constraint compared to a fully normalized design, and is disclosed here explicitly rather than silently accepted; correctness for this one relationship rests on application-layer validation, exactly as the Owner Review's own checklist asked to be told when a consolidation does this.

---

## 4. Owner Decisions — All Resolved

Numbered exactly as raised in the discovery report (`docs/OFFICE_INVENTORY_DISCOVERY_REPORT.md` §46). Every decision below is **FINAL**, not proposed.

**1. Assets handoff.** A distinct `movementType: asset_handoff` ledger row (quantity decreasing from Inventory), whose `sourceReferenceType = 'asset'` / `sourceReferenceId` points directly at the newly created `assets.id` row — no separate cross-reference table needed. Triggered by a single, explicit, permission-gated (`office_inventory.asset_handoff`) action that calls the *existing* Assets creation API directly, never duplicating its logic. One-directional only; the reverse (an Asset flowing back into Inventory) remains out of scope.

**2. Item classification taxonomy.** `consumable` / `returnable` is complete for V1. A durable item warranting individual tracking belongs in Assets from the start (received directly there, or converted per Decision 1) — Inventory's own catalog never gains a third "durable" classification of its own.

**3. Cost/valuation tracking.** Optional, reference-only `unitCost`/`currency` on receiving movements (mirroring `assets.purchaseCost` exactly) — no FIFO/LIFO/weighted-average/depreciation/GL posting of any kind. A simple "total received cost" style report is in scope (§20); a true valuation engine is not.

**4. Store/location structure & derive-vs-cache.** Flat stores (no hierarchy) for V1 — new, dedicated `office_inventory_stores` table, never `branches` or `records_locations` directly. Current balance and current custody are both **derived live** (batched `SUM`/aggregation over the ledger, never one query per row) for V1 — no cache table. If real usage later proves this too slow, a cache can be added as a proven optimization; none is spent speculatively now.

**5. Repeat-request review-window configuration.** A single organization-level configurable number of days (new `office_inventory` config-namespace field), no item/category-specific override in V1.

**6. Department approval authority source — the single most load-bearing decision.** Resolved in full at §5 below: a new, general-purpose `department_heads` table (not Inventory-prefixed), effective-dated, exactly one current Head per department, historically resolvable.

**7. Delegation duration/revocation model.** A new `office_inventory_approval_delegations` table, half-open `validFrom`/`validTo` interval, partial-unique-open index (at most one open delegation per delegating-Head-per-department), explicit revocation (closes `validTo`, never deletes). A delegation's *row* survives its delegating Head being replaced, but becomes functionally inert the moment that membership is no longer the department's current Head — checked at the moment of approval, never assumed from the delegation row alone (full reasoning at §5.3).

**8. Receipt confirmation — authorized department representative.** The original requester (for a department-type request) or any membership currently scoped to that department via the existing `membership_scopes` mechanism — no new "authorized representative" designation invented.

**9. Temporary-return due dates/overdue.** `expectedReturnDate` optional per issued/handed-over-in movement row; overdue is **always live-derived** (`currentOutstandingQuantity > 0 AND expectedReturnDate < now`), never a stored mutable flag — directly mirroring the Personnel-File custody pattern's own proven overdue derivation.

**10. Consumable treatment.** The `issued` ledger row is itself sufficient consumption authority for V1 — no separate "consumed" event.

**11. Missing/damage workflow — read-audit boundary.** Mutation-audit only; no read-audit exception. Office-supply quantities are not comparably sensitive to bank account numbers or statutory identifiers, so the Payroll-banking-style exception does not apply here.

**12. Write-off authorization.** Single-actor, narrow permission (`office_inventory.writeoff`) for V1 — no maker-checker workflow. The platform's own maker-checker pattern (Payroll) remains available to add later without a breaking schema change if Owner Review ever wants stricter control.

**13. Adjustment authorization.** Permission-gating only (`office_inventory.adjust`) for V1, no dedicated approval workflow — mirroring Decision 12's own posture for consistency.

**14. Stocktake freeze vs. live-movement strategy.** Snapshot expected quantity **at the moment counting starts**; ordinary store operations are **never blocked**. Any movement recorded against an item already in an open stocktake's scope is flagged as a caveat at reconciliation, never silently absorbed and never blocked — a disproportionate operational cost for an HR-centered organization at WWM's scale is avoided while full accountability is preserved.

**15. Stocktake finalization.** Every non-zero variance line requires an explicit resolution (`recount | adjustment | missing`) before the session can be marked `finalized` — no silent "accept and overwrite" path exists anywhere in the design.

**16. Negative-stock prohibition.** Strictly prohibited, everywhere, no exception mode. Enforced by an advisory-lock-then-validate-then-append pattern (§8).

**17. Department-to-department transfer authorization.** Gated by the *receiving* department's Head (or their valid delegate) approving the incoming quantity — the same authorization model as an ordinary department request, not a second, separately invented one.

**18. Direct/no-request issue escape hatch.** Allowed, gated by a distinct, narrower permission (`office_inventory.issue.direct`) separate from ordinary request-fulfilling issue (`office_inventory.issue`), with a mandatory reason recorded on the movement row — disclosed as a deliberate, narrow exception to the module's own "who requested it, who approved it" accountability chain, never silently available to every issuing user.

**19. Notification requirements.** Deferred entirely for V1 (§21 below) — building real notifications on this platform would be new ground (the existing `notifications` table has never had a working insert anywhere in the codebase), not integration with an existing system, and is out of proportion to Inventory's own core objective.

**20. Inventory reference numbering.** Permanent generation only (reusing the existing `numbering_sequences` counter primitive with new `sequenceKey`s), never a release/reuse table — an item code, once generated, is never freed or reassigned; the same is true of every transaction reference number.

**21. Supporting attachments.** A new `office_inventory_evidence` join table into the existing `employee_documents` physical store, reusing `fileStorage.ts` unchanged — mirroring `asset_evidence` exactly.

**22. CSV formula-injection hardening for Inventory exports.** Applied — Inventory's receiving movements capture free-text `source`/`deliveryReference` fields with a risk profile comparable to Payroll's payment-batch export, so the same `safeCsvCell`-style leading-character guard is adopted for every Inventory CSV export, disclosed explicitly as this module's own deliberate exception (mirroring Payment Batches' own disclosed exception), never claimed as a platform-wide fix.

**23. Module category.** `hr-operations` — matching every non-Payroll module precedent; Payroll's own new category was justified by financial/statutory distinctness that Inventory does not share.

**24. Final V1 scope boundary.** Confirmed as the discovery's own §43/§44, refined by the consolidation in §3 above and the resolutions in this section — frozen as of this document.

**No unresolved `PROPOSED`, `PENDING`, or `TBD` load-bearing decision remains.**

---

## 5. Department Head Model (§6 of the Owner Review — resolved in full)

### 5.1 Placement

A new, **general-purpose, non-Inventory-prefixed** table: `department_heads`. Department headship is an organizational-authority relationship, not an Inventory-specific concept — a future module could equally need "who has formal authority over this department." Placing it generally costs nothing extra now (it is one table either way) and avoids naming a genuinely general HR concept after the one module that happens to need it first, directly matching `primary_hr_assignments`' own precedent as a general org-authority table.

This does **not** expand scope beyond what is needed: it ships as part of Office Inventory's own first workstream (the only real consumer today), its management routes are gated by `requireModuleEnabled("office_inventory")` for V1 (no separate "HR Department Authority" module or workstream is invented for a concept nothing else yet consumes), but its **permission key is named generally** (`department.head.manage`, not `office_inventory.department_head.manage`) so a future module can be granted the same authority-reading capability without a rename. It does not modify the existing `departments` table at all — purely additive.

### 5.2 Schema

```
department_heads
  id                        serial PK
  organizationId            int NOT NULL -> organizations.id (restrict)
  departmentId               int NOT NULL -> departments.id (restrict)
  headMembershipId           int NOT NULL -> organization_memberships.id (restrict)
  validFrom                  timestamptz NOT NULL default now()
  validTo                    timestamptz NULL          -- null = currently the Head
  assignedByMembershipId     int -> organization_memberships.id (set null)
  revokedByMembershipId      int -> organization_memberships.id (set null)
  createdAt                  timestamptz NOT NULL default now()

  UNIQUE INDEX department_heads_dept_open_unique
    ON (organizationId, departmentId) WHERE validTo IS NULL
```

**Exactly one current Head per department** is the frozen rule — enforced by the partial unique index, matching `primary_hr_assignments`' own single-active-row pattern scaled to per-department.

### 5.3 Historical resolution, replacement, and vacancy

**"Who was the authorized Department Head for Department X on Date Y?"** — the identical half-open-interval resolver pattern already proven twice on this platform (`pickAllocationAsOf` for staff numbers): scan a department's `department_heads` rows for the one where `validFrom <= Y < (validTo ?? Infinity)`.

**Replacement**: appointing a new Head for a department that already has one open row closes the old row's `validTo` to the new row's `validFrom` in the same transaction, row-locked — identical to the proven "close-the-old-one-when-opening-a-new-one" pattern already used by `employee_compensation_components`/`employee_banking_details`/`employee_number_allocations`.

**Vacancy**: a department may temporarily have **no** current Head (revoked, not yet replaced) — this is a valid, representable state (simply no open row for that department), never auto-filled. **Requests for a department with no current Head, and no valid delegation either, cannot be approved until an Organization Administrator appoints a new Head** — the request sits visibly as "pending, no approval authority available" (surfaced on the dashboard and a report, §20), never silently auto-routed to HR or any other role, exactly per the explicit instruction not to invent a fallback.

**Delegation survives a Head's own replacement as a *row*, but becomes functionally inert**: replacing Head A with Head B does not delete or auto-revoke a delegation A previously granted to X — but at the moment of any approval action, the system additionally checks whether the delegation's own `delegatingHeadMembershipId` **is currently** (as of the approval instant) the department's actual Head. If A is no longer Head, X's delegation from A can no longer be exercised, even though the delegation row itself remains open and fully auditable. This avoids a cascading-revocation side effect on every headship change while still correctly preventing a former Head's delegate from continuing to approve on their behalf — a deliberate, disclosed design choice.

---

## 6. Delegation Model — Final Schema

```
office_inventory_approval_delegations
  id                            serial PK
  organizationId                int NOT NULL -> organizations.id (restrict)
  departmentId                  int NOT NULL -> departments.id (restrict)
  delegatingHeadMembershipId    int NOT NULL -> organization_memberships.id (restrict)
  delegateMembershipId          int NOT NULL -> organization_memberships.id (restrict)
  validFrom                     timestamptz NOT NULL default now()
  validTo                       timestamptz NULL
  createdByMembershipId         int -> organization_memberships.id (set null)
  revokedByMembershipId         int -> organization_memberships.id (set null)
  createdAt                     timestamptz NOT NULL default now()

  UNIQUE INDEX office_inventory_approval_delegations_open_unique
    ON (organizationId, departmentId, delegatingHeadMembershipId) WHERE validTo IS NULL
```

Every approval action on a request line snapshots, at the moment it occurs (never re-derived later): `approvedByMembershipId` (the actual acting membership), `actedAsDelegate` (boolean), `delegatorHeadMembershipId` (nullable), `delegationId` (nullable FK) — directly on `office_inventory_request_lines` (§7.4), never a separate table. A later delegation revocation, expiry, or the delegating Head's own replacement **never rewrites** an already-recorded historical approval.

---

## 7. Final Schema — 11 Tables (exact, frozen)

Every table below: organization-scoped (except where noted), RLS enabled with zero policies, matching the platform's own 100%-consistent convention.

### 7.1 `office_inventory_items` — the catalog
`id, organizationId (restrict), itemCode (server-generated, permanent, unique per org), name, description, categoryCode (free text, "office_inventory_category" master-data domain, unvalidated FK per the platform's own established `assets.categoryCode` precedent), unitOfMeasure (free text), classification (enum: consumable|returnable), reorderLevel (nullable numeric), unitCost/currency (nullable, reference-only), status (enum: active|inactive), createdAt/updatedAt.` Unique: `(organizationId, itemCode)`. Item **name** may be edited (cosmetic); item **code** is permanent and never reused — the historical anchor, matching every other permanent-code precedent on this platform. A renamed item's historical ledger rows resolve the current name live (a disclosed, accepted cosmetic exception, identical in kind to Payroll's own employee-name live-resolution disclosure).

### 7.2 `office_inventory_stores`
`id, organizationId (restrict), name, code, branchId (nullable -> branches.id, set null), responsibleMembershipId (nullable -> organization_memberships.id, set null), status (active|inactive), createdAt/updatedAt.` Unique: `(organizationId, code)`. Flat — no hierarchy in V1 (Owner Decision 4).

### 7.3 `office_inventory_stock_movements` — the ledger (append-only, never edited or deleted)
```
id                    serial PK
organizationId         int NOT NULL -> organizations.id (restrict)
itemId                 int NOT NULL -> office_inventory_items.id (restrict)
movementType            enum: received | issued | returned | transferred_out | transferred_in
                             | adjustment_in | adjustment_out | written_off | missing | recovered | asset_handoff
quantity                numeric(12,2) NOT NULL, always positive — direction implied by movementType
storeId                 int NULL -> office_inventory_stores.id (restrict)   -- set when this row affects a store's balance
holderType              enum NULL: employee | department                    -- set when this row affects a holder's custody
holderId                int NULL                                             -- employeeId or departmentId per holderType; NOT a real FK (polymorphic, disclosed at §3)
referenceNumber          text NULL      -- one generated value shared by the paired rows of one logical transaction
sourceReferenceType      text NULL: request_line | incident | stocktake_line | asset
sourceReferenceId        int NULL
source                   text NULL      -- supplier/source, 'received' rows only
deliveryReference         text NULL      -- delivery note / invoice reference, 'received' rows only
unitCost                 numeric(12,2) NULL   -- 'received' rows only, if cost tracking used
condition                 enum NULL (mirrors assets.condition: new|good|fair|poor|damaged)
reason                    text NULL — REQUIRED at the application layer for adjustment_in/out, written_off, missing, recovered
expectedReturnDate        date NULL
confirmedByMembershipId   int NULL -> organization_memberships.id (set null)
confirmedAt               timestamptz NULL
idempotencyKey            text NULL
actorMembershipId         int NULL -> organization_memberships.id (set null)
occurredAt                timestamptz NOT NULL default now()
notes                     text NULL
createdAt                 timestamptz NOT NULL default now()

UNIQUE INDEX office_inventory_stock_movements_idempotency_unique
  ON (organizationId, idempotencyKey) WHERE idempotencyKey IS NOT NULL
INDEX (organizationId, itemId, storeId)
INDEX (organizationId, itemId, holderType, holderId)
INDEX (organizationId, sourceReferenceType, sourceReferenceId)
```
This single table is the authoritative record of receiving, issuing, returns, store transfers, handovers (represented as paired `issued`/`returned`-style movements between two holders — see §11), adjustments, write-offs, missing, recovery, and the Asset handoff. It is never updated or deleted after insert. `reason`'s mandatory-for-certain-types rule is enforced in the service layer, not a DB CHECK constraint — mirroring the platform's own existing `MissingReasonRequiredError` precedent exactly.

### 7.4 `office_inventory_requests` + `office_inventory_request_lines`
**Header**: `id, organizationId (restrict), requestReference (generated), requestedByMembershipId, requestType (employee|department), forEmployeeId (nullable), forDepartmentId (NOT NULL — always resolved, even for an employee request, from the employee's own current department), reason, submittedAt, status (pending|partially_approved|approved|rejected|fulfilled|partially_fulfilled|cancelled), cancelledAt/cancelledByMembershipId.`
**Lines**: `id, requestId (cascade), itemId (restrict), quantityRequested, approvalStatus (pending|approved|rejected), approvedQuantity (nullable), approvedByMembershipId, actedAsDelegate, delegatorHeadMembershipId, delegationId (nullable -> office_inventory_approval_delegations.id), approvedAt, rejectionReason, quantityIssuedSoFar (a small, transactionally-consistent running tally, updated in the same transaction as each referencing `issued` ledger row — a fully justified cache, not a speculative one).`

### 7.5 `department_heads` — see §5.2

### 7.6 `office_inventory_approval_delegations` — see §6

### 7.7 `office_inventory_incidents`
`id, organizationId (restrict), itemId (restrict), holderType/holderId (nullable, whose custody at time of report), incidentType (damage|missing), description, reportedByMembershipId, reportedAt, status (open|reviewed|dismissed), reviewedByMembershipId, reviewedAt, resolutionNotes.` Mirrors `asset_incidents` exactly. Reporting and reviewing an incident **never** itself mutates the ledger — a separate, deliberate "mark missing" / "recover" / "write off" action (referencing the incident via `sourceReferenceType='incident'`) does.

### 7.8 `office_inventory_stocktakes` + `office_inventory_stocktake_lines`
**Header**: `id, organizationId (restrict), storeId (restrict), stocktakeReference, status (draft|counting|finalized), startedAt/startedByMembershipId, finalizedAt/finalizedByMembershipId.`
**Lines**: `id, stocktakeId (cascade), itemId (restrict), expectedQuantitySnapshot (captured when counting starts), countedQuantity (nullable until counted), countedByMembershipId, countedAt, variance (computed), resolutionType (recount|adjustment|missing, nullable until resolved), resolutionMovementId (nullable -> office_inventory_stock_movements.id), resolvedAt.`

### 7.9 `office_inventory_evidence`
`id, organizationId (restrict), subjectType (movement|incident|stocktake), subjectId, employeeDocumentId (restrict -> employee_documents.id), addedByMembershipId, addedAt.` Mirrors `asset_evidence` exactly, extended to a small polymorphic subject set rather than a single fixed target, since Inventory attachments meaningfully relate to more than one kind of record.

**Total: 11 tables**, each independently justified against the Owner Review's own test in §3.

---

## 8. Stock Ledger Authority & Negative-Stock Invariant

**Authority**: `office_inventory_stock_movements` is the sole source of truth. Current store balance = `SUM(quantity signed by movementType direction)` for `(organizationId, itemId, storeId)`; current holder custody = the same aggregation keyed by `(organizationId, itemId, holderType, holderId)`. Both are **derived live**, batched, never one query per row, never a persisted mutable balance column (Owner Decision 4).

**Concurrency mechanism**: since there is no natural row to lock (unlike Personnel Files' own custody-cache row), every balance-affecting append acquires a **Postgres advisory transaction lock** keyed by `pg_advisory_xact_lock(hashtext(organizationId || ':' || itemId || ':' || storeId))` (for store-affecting movements) or the equivalent holder-keyed hash (for holder-affecting movements) **before** computing the current derived balance and **before** inserting the new movement row(s) — reusing the exact mechanism this codebase already proves for period/run-creation races (`createPayrollRun`/`createPayrollPeriod`), applied here to the one scenario it was always meant for: serializing concurrent mutations against state with no single row of its own to lock.

**Negative-stock prohibition (Owner Decision 16)**: strictly enforced — the locked transaction re-checks the current derived balance immediately before appending any decreasing movement; if the resulting balance would go negative, the whole action is rejected with a controlled validation error (never a partial write, never a negative-stock mode). This invariant is an **application-layer** rule, not a database CHECK constraint, since the balance itself is never a stored column — disclosed explicitly, not silently assumed.

---

## 9. Receiving

A receiving submission may cover multiple items in one session; each item produces one `received` ledger row (`storeId` set, `quantity` positive, `source`/`deliveryReference`/`unitCost` populated), all sharing one generated `referenceNumber` (`sequenceKey: "office_inventory_receipt"`). Idempotency via the ledger's own `idempotencyKey` unique index prevents duplicate submission from a network retry. No supplier table, no purchase order, no invoice-approval workflow — captured fields are descriptive only.

---

## 10. Request Model

Employee request: `forEmployeeId` set, `forDepartmentId` resolved from the employee's authoritative current department. Department request: `forDepartmentId` set directly, `requestedByMembershipId` recorded separately from the beneficiary department — the submitter never becomes custodian merely by submitting.

---

## 11. Approval Workflow

`pending → (per line) approved/partially_approved/rejected → (overall) fulfilled/partially_fulfilled`. Approval **never** appends a ledger row — only `office_inventory_request_lines.approvalStatus`/`approvedQuantity` change. Partial approval and partial fulfilment are both supported at the line level (`approvedQuantity <= quantityRequested`, `quantityIssuedSoFar <= approvedQuantity`, both enforced at the application layer). Insufficient stock at issue time is a controlled rejection of that specific issue attempt, never a silent partial substitution. A request may be fulfilled from more than one store across multiple issue actions if the approving/issuing flow chooses to — no single-store restriction is imposed.

---

## 12. Department Head Model — see §5

## 13. Delegation Model — see §6

## 14. Department Head Self-Approval — FROZEN PERMANENTLY

**Department Head self-approval is allowed for Office Inventory, without exception, and Payroll's maker-checker semantics are explicitly NOT applied here.** A request submitted by, or on behalf of, the Head of Media, requested for the Media Department, approved by that same person acting in their Head-of-Media capacity, is valid. This is audited normally (an ordinary approval-mutation audit event, capacity recorded as `actedAsDelegate: false`, `approvedByMembershipId` = the Head's own membership) — no special-casing, no rejection, no warning beyond the ordinary repeat-request accountability panel that would show for any approver.

---

## 15. Repeat-Request / Accountability Warning

Query-time only, never a stored flag: for the requesting employee **and** the requesting department, within the organization-configurable review window (Owner Decision 5), show recent requests/issues for the same `itemId` (never fuzzy name matching), current outstanding custody, and recent return history. **Non-blocking** — the approver, including a self-approving Department Head, may proceed regardless.

## 16. Issue / Fulfilment

Each fulfilling action against an approved request line appends one `issued` ledger row pair: a `storeId`-scoped decrease and a `holderType`/`holderId`-scoped increase, sharing one `referenceNumber` and `movementGroupId`-equivalent linkage (the same `referenceNumber`). `sourceReferenceType='request_line'` traces back to the specific approved line. Over-fulfilment beyond `approvedQuantity` is rejected. Partial fulfilment is supported (§11).

## 17. Direct-Issue Decision

Allowed, gated by the distinct `office_inventory.issue.direct` permission (never granted merely by holding `office_inventory.issue`), with a mandatory `reason` on the movement row and no `sourceReferenceType='request_line'` — a disclosed, narrow, deliberate exception (Owner Decision 18).

## 18. Receipt Confirmation

`confirmedByMembershipId`/`confirmedAt` on the holder-side `issued` (or handover-in) movement row — **never gates the custody change itself**, which already occurred at the moment the movement was recorded, mirroring Assets' own `acknowledgeAssetAssignment` precedent exactly (assignment happens first; acknowledgment is a separate, non-blocking layer added afterward). Confirmed by the recipient employee (via ESS) or, for department custody, the original requester or any membership scoped to that department. A repeat confirmation attempt on an already-confirmed row is rejected as a controlled conflict.

## 19. Custody Model

`STORE` (via `office_inventory_stores`), `EMPLOYEE`, `DEPARTMENT` (both via the ledger's `holderType`/`holderId`). Outstanding returnable quantity per holder = the live-derived aggregation (§8). Never overwritten — every original `issued` row remains permanently queryable regardless of how many partial returns follow it.

## 20. Return Due Dates / Overdue

`expectedReturnDate` optional per `issued`/holder-crediting row. **Overdue is always live-derived** — `currentOutstandingQuantity(item, holder) > 0 AND the most recent relevant issue's expectedReturnDate < now()` — never a stored, mutable flag, directly reusing the Personnel-File custody pattern's own proven derivation shape, including its batched-for-reporting form (no N+1).

## 21. Returns

A `returned` ledger row (holder-side decrease, store-side increase), `sourceReferenceType='request_line'` where traceable back to the original issue's own line (partial returns supported — multiple `returned` rows against one `issued` row, never exceeding the outstanding balance, enforced by the same locked-balance-check pattern as §8). The original `issued` row is never edited.

## 22. Handovers

Represented as a paired ledger entry: a decrease on the from-holder, an increase on the to-holder, sharing one `referenceNumber` (`sequenceKey: "office_inventory_handover"`). Supports employee↔employee, employee↔department, department↔employee, and department↔department (the last gated per Owner Decision 17). Confirmation follows §18's non-gating pattern. Full prior custody history is preserved — a handover never edits or removes the movement rows that established the departing holder's custody in the first place.

## 23. Store Transfers

A paired `transferred_out` (source store decrease) / `transferred_in` (destination store increase) ledger entry, sharing one `referenceNumber` (`sequenceKey: "office_inventory_transfer"`). **Single atomic transfer for V1** — both rows are inserted in the same locked transaction, so stock is never simultaneously available (or simultaneously unavailable) in both stores; the dispatch-then-separate-destination-receipt pattern is deferred as unnecessary added complexity for V1's accountability needs, since the atomic version already guarantees correctness and traceability. Organization-wide total is unchanged by construction (one row's decrease exactly equals the paired row's increase).

## 24. Consumables

Issue itself is sufficient consumption authority (Owner Decision 10) — no separate "consumed" event. Consumption reporting (§20 dashboard/reports) reads directly from `issued` movements against `classification='consumable'` items.

## 25. Damage / Missing / Recovery

Reporting a `damage` or `missing` incident (§7.7) is a pure annotation — **zero ledger effect**, mirroring Assets' own decoupling exactly. A subsequent, separate, permission-gated action ("mark missing" / "recover" / "write off," each requiring its own distinct permission) appends the actual `missing`/`recovered`/`written_off` ledger row, optionally referencing the incident (`sourceReferenceType='incident'`). A `missing` row remains permanently visible in the ledger even after a later `recovered` row restores the item — history is never hidden or collapsed. Damage does not automatically imply write-off; a damaged item may remain in custody, be returned, be recovered from a missing state, or be written off, each requiring its own separate, explicit action.

## 26. Write-Off

`written_off` ledger row, mandatory `reason`, single-actor narrow permission `office_inventory.writeoff` (Owner Decision 12) — no second approval workflow in V1.

## 27. Adjustments

`adjustment_in`/`adjustment_out` ledger rows, mandatory `reason`, permission `office_inventory.adjust` (Owner Decision 13). Adjustments apply to **store** balances only — an employee/department custody discrepancy is resolved through the return/handover/incident processes, never a direct custody adjustment, keeping exactly one accountable path per kind of discrepancy.

## 28. Stocktaking

`office_inventory_stocktakes`/`_stocktake_lines` (§7.8). Session scoped to one store. `expectedQuantitySnapshot` captured the moment counting starts (Owner Decision 14) — live store operations are **not** blocked during an open stocktake; any movement recorded against an in-scope item during the session is surfaced as a caveat at reconciliation. Concurrency: starting a stocktake against a store acquires the same advisory-lock domain as an ordinary movement against that store's items, so a stocktake-start and an in-flight issue/receipt naturally serialize rather than race silently.

## 29. Stocktake Variance Resolution

Every non-zero variance line requires an explicit `resolutionType` (`recount | adjustment | missing`) before the stocktake can be marked `finalized` — `finalizeStocktake` is rejected with a controlled error listing every still-unresolved line if any remain. `adjustment` and `missing` resolutions each append the corresponding ledger row and record its id on the stocktake line (`resolutionMovementId`) — full traceability from the physical count back to its accounting effect.

## 30. Reorder / Low Stock

`derivedStoreBalance <= item.reorderLevel` — a simple computed comparison surfaced on the dashboard (§20) and a report (§20). No automatic purchase order, no procurement action of any kind.

## 31. Separation Integration

**Warn only, never coupled into `separateEmployee()`.** A dedicated report (mirroring `asset_unreturned_by_employee`/`personnel_separated_unreleased_numbers` exactly): outstanding returnable custody, pending handovers awaiting confirmation, open missing incidents, unresolved returns — filterable by employee, consulted separately by HR before or after separation. No automatic return, handover, transfer, or write-off is ever triggered by a separation event.

## 32. Department-Change Behavior

An employee's personal custody (ledger rows where `holderType='employee', holderId=<that employee>`) remains theirs after a department change — never silently reattributed to either the old or new department. Department-owned custody (`holderType='department'`) is unaffected by any individual employee's department change. Responsibility changes only through an explicit return or handover.

## 33. ESS

Via `resolveOwnEmployeeId` exclusively — submit own request, view own requests/approval status, confirm receipt, view own current custody and full history, initiate a return/handover where permitted, report damage/missing on an item in their own current custody. No client-supplied employee ID ever establishes authority for any "my" route.

## 34. Department Head UX

An approval screen resolving: the request, requester, requesting department, item, quantity, purpose, current store availability, the repeat-request accountability panel (§15) for both the employee and the department, current custody for both, outstanding returnables, and — when the actor is a delegate — the delegation authority being exercised, its validity window, and the delegating Head's identity. Actions: approve (whole or partial, per line), reject with a mandatory reason, comment. Self-approval remains valid (§14).

## 35. Store / Inventory Officer UX

Receive stock, view stock by store, the approved-and-awaiting-fulfilment request queue, issue (including direct issue if permissioned), receipt-confirmation status, returns, handovers, store transfers, incident queue (if permissioned to review), adjustments/write-offs (if permissioned), stocktaking, movement history — no confidential HR data exposed merely because someone manages Inventory operations.

## 36. HR UX

The architecture supports granting WWM HR every operational Inventory permission (§19) through the existing, ordinary role/permission-assignment mechanism (§2.3 of the discovery) — **nothing in the schema or permission model hard-codes `hr_manager` = all Inventory permissions.** A different organization may grant a narrower or differently-shaped set to its own HR role without any code change.

## 37. Organization Administrator

Configures module enablement, stores, categories, and operational role/permission assignments (including who is a Department Head, via `department_heads`, and who holds which `office_inventory.*` permission) through the existing role/permission mechanism. **Administering the organization does not itself grant any Inventory operational permission** — the same structural separation Payroll already proved (an Organization Administrator is not automatically a Payroll preparer/approver either).

---

## 38. Final Permissions (frozen)

Following the platform's `resource = module key` convention, resource `office_inventory`, plus the one deliberately general exception (§5.1):

`office_inventory.configure` · `office_inventory.item.manage` · `office_inventory.store.manage` · `office_inventory.receive` · `office_inventory.request` (submit + read own) · `office_inventory.approve` · `office_inventory.delegate.manage` · `office_inventory.issue` · `office_inventory.issue.direct` · `office_inventory.receipt.confirm.own` · `office_inventory.custody.read` · `office_inventory.return` · `office_inventory.transfer` · `office_inventory.handover` · `office_inventory.report_issue.own` · `office_inventory.incident.review` · `office_inventory.recover` · `office_inventory.adjust` · `office_inventory.writeoff` · `office_inventory.stocktake` · `office_inventory.asset_handoff` · `office_inventory.reports.read` · **`department.head.manage`** (deliberately general-namespaced, §5.1).

**22 keys total** — reviewed against the Owner Review's own instruction not to collapse genuinely independent authorities: requesting, departmental approval, receiving, issuing, adjustment, write-off, stocktake, and reporting are each kept separately assignable, exactly as instructed. No further collapsing was found safe without losing a real, independently-useful authorization boundary (e.g., an org may want a Store Officer who can issue but never write off, or an HR user who can approve but never adjust stock).

---

## 39. Default Role Mapping

**None of the 22 keys above are granted to `employee`, `hr_manager`, or `org_admin` by default** — mirroring Payroll's own explicit, binding precedent (ordinary HR authority must not automatically imply a new module's operational authority). `super_admin` continues to receive every permission via the platform's own existing blanket grant. WWM HR receives Inventory permissions only through a future, separate, deliberate role/permission assignment — not as a side effect of this plan, not as a side effect of enabling the module, and not in this session.

---

## 40. Numbering

Reuses the existing `numbering_sequences` counter primitive (`lockAndIncrementSequence`) with new `sequenceKey`s, no schema change: `office_inventory_item` (permanent item codes), `office_inventory_request`, `office_inventory_receipt`, `office_inventory_issue`, `office_inventory_transfer`, `office_inventory_handover`, `office_inventory_adjustment`, `office_inventory_writeoff`, `office_inventory_stocktake`. **Not every ledger row gets a reference number** — `missing`/`recovered` rows referencing an incident, and `adjustment`/`missing` rows resolving a stocktake variance, rely on the incident's or stocktake's own reference instead, per the explicit instruction not to number every internal movement.

---

## 41. Attachments

`office_inventory_evidence` (§7.9), reusing `employee_documents`/`fileStorage.ts` unchanged, `employeeId: null` on every created document row (mirroring Assets' own established precedent for non-employee-owned attachments). Supports: receiving/delivery documentation, damage/missing evidence, write-off authorization documentation, stocktake evidence. Kept deliberately small for V1 — no new attachment concept, no new storage subsystem.

---

## 42. Notifications

**Deferred entirely for V1**, per Owner Decision 19. In-app-only surfaces (dashboard badges, pending-approval counts, pending-confirmation counts) are in scope; they are computed live from existing tables, not a notification system. Email/SMS/push notification infrastructure is explicitly not built as part of Office Inventory — recorded as an approved deferral (§46), not a silent gap.

---

## 43. Dashboard

Live-derived tiles: total distinct stock items, low-stock item count, out-of-stock item count, items currently with employees, items currently with departments, outstanding returnables, overdue returnables, pending departmental approvals, pending receipt confirmations, open damage/missing incidents, unresolved stocktake variances, departments/requests currently blocked by a vacant Department Head (§5.3). No persisted aggregate — every tile is a live, batched query.

---

## 44. Reports

All via the ADR-016 dedicated-route pattern (registered in `report-definitions.ts` for catalog discoverability only, executed through a dedicated `GET .../office-inventory/reports/:reportKey` route, never the generic runner):

1. Current Stock (by store, with organization-wide totals)
2. Stock Movement Ledger (filterable by item/store/holder/date range/movementType)
3. Receipts
4. Issues
5. Employee Custody
6. Department Custody
7. Outstanding / Overdue Returnables
8. Missing / Damaged Items
9. Adjustments & Write-Offs
10. Stocktake Variances
11. Repeat Request History
12. Department Consumable Usage
13. Simple Received-Cost Summary (only if Owner Decision 3's cost tracking is actually populated for a given organization — no report claims valuation beyond a plain sum of recorded `unitCost × quantity` at receiving)

CSV export for every report uses the hardened `safeCsvCell` convention (Owner Decision 22), not the platform's default unescaped `toCsv`.

---

## 45. Cost / Valuation

Optional `unitCost`/`currency` captured at receiving only (Owner Decision 3). No FIFO/LIFO/weighted-average, no depreciation, no GL posting, no accounting-grade inventory valuation engine — the received-cost summary report (§44.13) is a plain, historically-accurate sum of what was actually recorded at receiving time, nothing derived or estimated.

---

## 46. Historical Integrity

`employees.id` remains the sole technical employee identity; `departments.id` remains the sole technical department identity — neither an employee number nor a department name is ever used as a foreign key. Item **code** (permanent, never reused) is the historical anchor for catalog identity; item **name**/**category** may be edited and are resolved live for display, a disclosed cosmetic exception identical in kind to Payroll's own employee-name precedent. Store rename is likewise cosmetic and live-resolved; `storeId` is the permanent anchor. Department Head replacement, delegation expiry/revocation, and staff-number release/reuse all resolve historically via the same half-open-interval pattern (§5.3, §6) — none of them ever rewrites an already-recorded historical approval or movement. This directly extends the identical guarantee already proven twice on this platform (Phase 3H, Payroll) to a third module.

---

## 47. Concurrency / Idempotency

Every balance-affecting append: advisory-lock the `(organizationId, itemId, storeId)` or `(organizationId, itemId, holderType, holderId)` domain (§8) **before** validating and inserting. Every user-submitted transaction (receiving, issuing, requests, adjustments) carries an optional client-or-server-generated `idempotencyKey`, enforced by a real unique index — a network-retried duplicate submission is rejected as a controlled conflict, not silently double-applied. Approval races on one request line are serialized by locking the line row `FOR UPDATE` before checking/writing `approvalStatus`. Stocktake finalization races against a live movement are handled by the same advisory-lock domain the movement itself would acquire — a finalize-in-progress and a concurrent issue against the same item naturally serialize. No stock or accountability correctness depends on a disabled frontend button anywhere in this design.

---

## 48. Final Schema Impact

**11 tables** (§7), all `organizationId`-scoped except none (every table here is org-scoped; `department_heads` and `office_inventory_approval_delegations` are org-scoped too, never platform-global), all RLS-enabled with zero policies. One genuinely new numbering-sequence-key set (§40), one new master-data domain (`office_inventory_category`), one new config namespace (`office_inventory`), 22 new permission keys (§38), no changes to any existing table.

---

## 49. Expected Migrations

First migration: `0050` (not created in this session). Given the schema's real breadth, a **single migration for the entire module is not expected** — each workstream below (§50) contributes its own migration as it ships, mirroring Payroll's own 5-migration, multi-workstream shape rather than Assets' single-migration one.

---

## 50. Frozen Workstreams

Each requires its own separate, explicit Owner go-ahead — none begins as a result of this document.

**Workstream 1 — Foundation.** *Objective*: module registration (`office_inventory`, hidden, `hr-operations`, `defaultEnabled: false`), all 22 permissions (§38) including the general `department.head.manage`, the `office_inventory` config namespace, the `office_inventory_category` master-data domain, `office_inventory_items`/`office_inventory_stores`/`department_heads` schema. *Exclusions*: no ledger, no requests, no movement of any kind. *DB*: 1 migration. *Backend*: CRUD for items/stores/department-head assignment (with historical resolution). *API*: new OpenAPI paths/schemas. *Frontend*: minimal admin screens (item catalog, stores, Department Head assignment) — not the operational workspace. *Permissions*: as above. *Audit*: full mutation coverage. *Tests*: Department-Head replacement/vacancy/historical-resolution unit tests. *Live QA*: create items/stores, assign/replace a Department Head, confirm historical resolution across a replacement. *Concurrency*: two simultaneous Department Head appointments for one department — exactly one winner. *Cleanup*: independently re-verified. **STOP boundary: no stock exists yet, nothing to receive or request.**

**Workstream 2 — Stock Ledger & Receiving.** *Objective*: `office_inventory_stock_movements` schema, the advisory-lock-based balance/custody derivation engine, receiving. *Exclusions*: no requests/approval/issue yet — receiving is the only populated movement type. *DB*: 1 migration. *Tests*: balance-derivation correctness, negative-stock rejection (trivially true with only `received` rows, but the guard itself is unit-tested), idempotency-key duplicate rejection, the advisory-lock concurrency race (5 simultaneous receiving submissions for the same item/store). *Live QA*: receive stock across two stores, confirm organization-wide aggregation. **STOP boundary: nothing can be requested or issued yet.**

**Workstream 3 — Requests, Approval & Delegation.** *Objective*: `office_inventory_requests`/`_lines`, `office_inventory_approval_delegations`, self-approval, partial approval, the vacancy behavior (§5.3), the repeat-request warning (read-only against Workstream 2's ledger). *Exclusions*: nothing is ever issued yet — approval remains stock-inert. *DB*: 1 migration. *Tests*: self-approval permitted and audited normally; delegated approval snapshot fields; a delegation surviving vs. becoming inert after Head replacement (the load-bearing §5.3 rule, directly tested); vacancy blocking approval with no HR fallback. *Live QA*: employee request, department request, Head self-approval, delegate approval, an expired/revoked delegation correctly rejected, a vacant-department request correctly blocked. **STOP boundary: approved requests exist but nothing is ever fulfilled yet.**

**Workstream 4 — Issue, Fulfilment, Confirmation, Direct Issue.** *Objective*: issuing against approved request lines (full/partial), receipt confirmation (non-gating), direct issue (Owner Decision 18), negative-stock rejection under real contention. *Tests*: over-fulfilment rejection, partial fulfilment across multiple issue actions, confirmation idempotency, the 5-way concurrent-issue race. *Live QA*: full and partial issue, confirmation by the recipient and by a department-scoped confirmer, direct issue with its distinct permission and mandatory reason. **STOP boundary: no returns/handovers/transfers yet.**

**Workstream 5 — Returns, Handovers, Store Transfers.** *Objective*: `returned`, paired handover, paired store-transfer movements; outstanding-quantity derivation with partial returns. *Tests*: over-return rejection, department-to-department transfer authorization (§17/Owner Decision 17), the atomic-pair transfer never leaving stock simultaneously available/unavailable in both stores under a concurrency race. *Live QA*: partial return, all four handover directions, a store transfer, department-change behavior (§32) proven live. **STOP boundary: no incidents/write-off/adjustment yet.**

**Workstream 6 — Incidents, Missing, Recovery, Write-Off, Adjustment.** *Objective*: `office_inventory_incidents`, the mark-missing/recover/write-off/adjust actions and their distinct permissions. *Tests*: incident reporting has zero ledger effect; a subsequent mark-missing/recover/write-off each produce exactly the expected row; missing-then-recovered history remains fully visible; mandatory-reason enforcement. *Live QA*: the full damage→review→(no automatic effect)→separate mark-missing→recovery cycle; a direct write-off; a store adjustment. **STOP boundary: no stocktaking yet.**

**Workstream 7 — Stocktaking.** *Objective*: `office_inventory_stocktakes`/`_lines`, snapshot-at-start, non-blocking live operations with caveat-flagging, mandatory per-line resolution, finalization. *Tests*: a movement occurring during an open stocktake is correctly flagged, not blocked and not silently absorbed; finalization rejected while any line remains unresolved; each resolution type produces the correct ledger linkage. *Live QA*: a full count-with-variance-and-resolution cycle, including a movement occurring mid-session. *Concurrency*: stocktake-start vs. a live issue against the same store, and finalization vs. a live movement. **STOP boundary: no ESS/Department-Head-UX polish or reporting/dashboard yet beyond what internal testing needed.**

**Workstream 8 — ESS & Department Head Experience.** *Objective*: the employee-facing "My Inventory" ESS surface and the full-context Department Head approval screen (§34). *Frontend-heavy*; no new backend authority beyond what Workstreams 3–6 already built. *Live QA*: ESS own-only boundary (cross-employee denial), the full accountability-context approval screen including the repeat-request panel and delegation-authority display.

**Workstream 9 — Reporting & Dashboard.** *Objective*: the 13 reports (§44) and the dashboard (§43), the hardened CSV export (Owner Decision 22). *Tests*: every report's totals independently re-summed against the ledger; CSV/JSON parity; the formula-injection guard proven against a poisoned free-text field. *Live QA*: as above, plus tenant isolation on every report.

**Workstream 10 — Assets Handoff.** *Objective*: the single, explicit, permission-gated `office_inventory.asset_handoff` conversion action (§4 Decision 1), calling the existing Assets creation API directly. *Live QA*: a converted item correctly leaves Inventory's own balance and becomes authoritative in Assets, with the cross-reference traceable both directions.

**Workstream 11 — Full Office Inventory Verification.** Mirrors Payroll's own Frozen Workstream 9 precedent exactly: one integrated live-QA scenario spanning the entire chain (§51 below), hand-verified balance arithmetic, every concurrency race in §47 executed live (not merely unit-tested), a historical-reproducibility master scenario (staff-number reuse never reassigns historical Inventory custody — directly extending the identical proof already delivered twice on this platform), fresh RLS/permission audit, full regression, zero Category A defects required to pass.

**Workstream 12 — Office Inventory Completion Report.** Documentation-only closure, mirroring Payroll's own Frozen Workstream 10 precedent, using Workstream 11's PASS as its sole verification authority.

Every workstream above includes, per the Owner Review's own template: objective, scope, exclusions, DB/schema work, backend, API/OpenAPI/codegen, frontend, permissions, audit, concurrency, automated tests, live development QA, tenant isolation, cleanup, regression, Definition of Done, and an explicit STOP boundary — elaborated in full at the start of each workstream's own actual implementation session, not pre-written here in exhaustive procedural detail, matching exactly how Payroll's own frozen plan handled this same section.

---

## 51. Verification Plan (to be executed in Workstream 11 — NOT claimed as run now)

The eventual live-QA matrix must cover, at minimum: receiving; balance derivation across stores; an employee request; a department request; ordinary Department Head approval; **Department Head self-approval**; delegated approval; an expired/revoked delegation correctly rejected; a vacant-department request correctly blocked with no HR fallback; the repeat-request warning (present, non-blocking); partial approval; partial issue; receipt confirmation (employee and department); employee custody; department custody; partial return; all four handover directions; a store transfer; an overdue returnable (live-derived); a damage report with zero ledger effect; a missing-then-recovered cycle with full historical visibility; a write-off; a store adjustment; a full stocktake with a caveat-flagged concurrent movement and every resolution type; negative-stock rejection under real contention; the Assets handoff with a bidirectional cross-reference; the separation-warning report; the department-change custody-non-transfer behavior; a staff-number-reuse historical-integrity scenario mirroring Payroll's own proven master scenario; cross-org isolation on every route; every one of the 22 permission boundaries; the ESS own-only identity boundary; every concurrency race named in §47, executed live with genuinely simultaneous requests; every mutation's audit event; and full disposable-fixture cleanup independently re-verified. **None of this has been run. This is a specification for Workstream 11, not a report of results.**

---

## 52. WWM Intended Configuration (documented, NOT applied)

Recorded here purely as planning context for a future, separately-authorized configuration action — nothing below is created, assigned, or enabled in this session:

- **Organization Administrator**: controls WWM's own module enablement and access assignment.
- **HR**: intended as the primary operational Inventory user — expected to eventually hold most or all of the 22 operational permissions (§38), granted deliberately and explicitly when WWM adopts the module, never automatically because of the `hr_manager` role alone. Personnel/PIF Filing remains available to WWM HR independently, unaffected by Inventory's own enablement state.
- **Employees**: the ESS functions in §33 — own requests, own confirmation, own custody/history, permitted return/handover/damage-missing reporting.
- **Department Heads**: departmental approval authority, including self-approval, exactly as frozen in §5 and §14.
- **Delegates**: approval only within their own recorded, currently-valid authority (§6).
- **Store/Inventory Officers**: the operational surface in §35, scoped to whichever permissions WWM's Organization Administrator actually assigns them.
- **Other users**: no access beyond what is specifically, deliberately assigned.

---

## 53. Approved Deferrals

Procurement in its entirety (§3 of the Owner Review prompt, unchanged) · QR/barcode scanning · a store/location hierarchy beyond flat stores · item/category-specific repeat-request review windows · GL/accounting-journal integration · FIFO/LIFO/weighted-average/depreciation valuation · automatic reorder/purchase-order creation · a full case-management layer for incidents beyond open→reviewed/dismissed · Asset-to-Inventory reverse handoff · maker-checker on write-off/adjustment (addable later without a breaking change) · a dispatch-then-separate-destination-receipt store-transfer model (atomic transfer is V1's frozen choice) · email/SMS/push notifications (§42) · WWM configuration itself (§52, documented not applied).

---

## 54. Compatibility Analysis Across Existing Modules

**Payroll**: zero interaction of any kind, unchanged. **Assets**: exactly one explicit, controlled, manual, one-directional handoff point (§4 Decision 1); otherwise fully independent, non-overlapping data models — no Asset table is modified. **Personnel/PIF Filing**: architectural patterns reused (row-locking, batched live derivation, half-open-interval historical resolution); zero shared tables, zero shared identity; `records_locations` is not reused for stores. **HR core (`employees`, `departments`)**: read-only reuse of `employees.id`, an employee's authoritative current department; one new, general, purely-additive table (`department_heads`) added alongside `departments`, never modifying it. **ESS/Manager Portal**: extended via the same `resolveOwnEmployeeId` pattern every other module already uses; neither module's own code changes.

---

## 55. Issues / Ambiguities Found

None requiring a STOP. The two genuine gaps flagged by discovery (no Department Head field, no delegation mechanism) are both resolved in full above (§5, §6), each with concrete schema, historical-resolution rules, and vacancy/replacement behavior — neither was silently decided nor left open.

---

## 56. Documentation Changed

- `docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md` — this document (new, status FROZEN — APPROVED FOR IMPLEMENTATION).
- `PROJECT_STATUS.md` — a new, minimal pointer entry (see commit).
- `docs/OFFICE_INVENTORY_DISCOVERY_REPORT.md` — left unchanged, retained as the historical discovery record this plan supersedes.

No other file touched. No migration. No application code. No permission registered. No module registered. No WWM state changed.

---

## 57. Boundary

**STOP after this document.** No implementation begins as a result of this plan freeze. No migration `0050` was created. No application code was changed. Office Inventory was not enabled for WWM or any organization. No WWM users, Department Heads, or delegations were configured. WWM HR permissions were not changed. Production was not touched. Assets, Personnel/PIF Filing, and Payroll were not modified. Procurement was not begun. Notifications were not built. The next step requires a separate, explicit go-ahead naming **Workstream 1** specifically.
