# Phase 3H — WWM HR Operations, Personnel Records & Document Reconciliation

**Status: DRAFT — NOT APPROVED FOR IMPLEMENTATION**

This document is the output of a repository-grounded discovery pass, prompted by Owner-supplied real-world requirements from Worldwide Word Ministries (WWM). Nothing in this document authorizes writing code. Every claim is labeled one of:

- **FOUND IN REPOSITORY** — verified directly against shipped code/schema/docs, with file:line citations.
- **OWNER-STATED REQUIREMENT** — supplied by the Owner in this session's own prompt, not independently verifiable against any source document (no WWM PIF/leave-form/evaluation/probation-review document exists anywhere in this repository — confirmed by an exhaustive search; see §1).
- **PROPOSED DESIGN** — this document's own recommendation, not yet approved.

Every design choice not directly dictated by existing repository behavior is tagged **[PROPOSED DESIGN DECISION]** in the numbered Owner Decisions section (§16) and is not approved until the Owner resolves it.

---

## 1. Source Document Discovery

**FOUND IN REPOSITORY:** An exhaustive search (`grep -rli` across `*.md`/`*.txt`/`*.pdf`, plus a filesystem scan for any `*.pdf`/`*.docx`/`*wwm*` file anywhere in the repository, including `artifacts/api-server/uploads`) found:

- **Zero WWM-specific source documents** of any kind (no PIF, no leave form, no staff evaluation form, no probation review form) anywhere in this repository or its uploads directory. The only file in `uploads/` is one disposable Acme (org 4) candidate document, unrelated to WWM.
- Three passing mentions of adjacent terms in existing planning docs, none of which are WWM source material:
  - `docs/PHASE_2A_IMPLEMENTATION_PLAN.md`, `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` — contain the word "SSNIT" only inside the "Future Expansion" exclusion list.
  - `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md:345` — a real, load-bearing Owner Decision about a **generic configurable national-identifier field**, explicitly written to avoid hardcoding "Ghana Card" (see §5).
  - **`docs/PHASE_2B_IMPLEMENTATION_PLAN.md:245`** — the single most directly relevant citation in the whole repository: *"The Enterprise Document and Physical File Registry — remains reserved for a later dedicated phase, as already recorded in the Phase 2A Completion Report; W23's per-employee document attachment is not that system and this plan does not extend it into one."* This confirms a personnel-records/physical-file system was named and deliberately deferred **twice already** (Phase 2A's own completion report, then reaffirmed in Phase 2B) — this document is the first time that deferred item is being picked back up.

**Conclusion:** every specific field, format example (`WWM/SN/001`, `PIF-001`), and workflow description in this document that concerns WWM's actual paper forms is **OWNER-STATED**, not independently verified against a source document. This is stated plainly rather than implied, per this document's own §3 instruction. If actual WWM forms exist outside this repository, they should be supplied before any workstream begins — this plan's own field-by-field reconciliation tables are built entirely from the Owner's own prompt text.

---

## 2. WWM Personal Information Form (PIF) — Field Reconciliation

**OWNER-STATED** field list, reconciled against the actual shipped `employees` schema (`lib/db/src/schema/employees.ts:32-108`, read in full) and its companion tables.

| PIF Area | Field | Classification | Evidence |
|---|---|---|---|
| Personal | First/Middle/Last/Preferred name | **A** — already stored | `employees.firstName/middleName/lastName/preferredName` |
| Personal | Gender, Date of Birth, Marital Status, Nationality | **A** — already stored | `employees.gender/dateOfBirth/maritalStatus/nationality` |
| Personal | Ghana Card number | **A** — already stored, but generically named | `employees.nationalId` (plain `text`, not Ghana-Card-specific — see §5) |
| Personal | SSNIT number | **D** — not represented | No `ssnit`/social-security/tax-id field exists anywhere on `employees` (confirmed via direct grep, zero matches) |
| Personal | Employee Number | **A** — already stored, format not yet configurable | `employees.employeeNumber` (see §4) |
| Contact | Phone, alternate phone, personal/work email, residential address | **A** — already stored | `employees.phoneNumber/alternatePhoneNumber/personalEmail/workEmail/residentialAddress` (jsonb) |
| Emergency contact | Name, relationship, phone | **A** — already stored | `employees.emergencyContacts` (jsonb array, `[{name, relationship, phone}]`) |
| Dependants | Name(s), relationship, etc. | **D** — not represented | No `employee_dependants` table or equivalent exists anywhere (confirmed: `lib/db/src/schema/employee-*.ts` lists only certifications/disciplinary-records/exit-processes/qualifications/skills/user-links/documents — no dependants table) |
| Church/ministry information | Role, ministry, involvement | **D** — not represented | No field or table of any kind. This is the one PIF area with no generic HRMS analogue at all — see Owner Decision discussion below |
| Education | Level, institution, qualification | **B** — stored under a different model | `employee_qualifications` (Phase 2A, W24) via the `qualification_type` Master Data domain — education level/degree can be represented as a qualification type, but there is no dedicated "highest education level" field distinct from the qualifications list |
| Skills | Skill name/proficiency | **A** — already stored | `employee_skills` (Phase 2A, W24), `skill` Master Data domain |
| Languages | Language(s) spoken | **D** — not represented | A `language` Master Data domain exists (used elsewhere, e.g. candidate/organization locale), but **no `employee_languages` linking table exists** — an employee cannot record which languages they speak today |
| Medical information | Any medical details | **E** — deliberately excluded/sensitive, requires Owner Decision | No field exists; see §11 Security/Privacy — recommend NOT adding without an explicit Owner Decision on classification, encryption-at-rest expectations, and who may ever read it |
| Employment information | Department, branch, position, reporting manager, hire date, employment type | **A** — already stored | `employees.departmentId/branchId/positionId/reportingManagerId/hireDate/employmentType` |
| Employment information | Probation end date | **A** — already stored | `employees.probationEndDate` |
| Declaration | Signature/date/acknowledgement | **D** — not represented, and arguably **F** | No e-signature/declaration-capture concept exists anywhere. If ever built, this is closer to a document-attachment (a signed, scanned PIF form) than a new structured field — see §9 |
| — | Employee full name/number/department | **F** — derived, must not be manually re-typed | Already available on every employee record; any future PIF-capture UI must prefill these from the existing employee record, never ask HR to retype them |

**No fields require immediate schema changes to support classification A/B items** — they already exist. Classification D/E items (dependants, languages, medical, church/ministry, declaration) would each need their own Owner Decision before any schema work, per this document's own explicit "discovery first, do not add fields" instruction.

---

## 3. WWM Leave Form — Field Reconciliation

**OWNER-STATED** form concepts, reconciled against the shipped Leave module.

| WWM Form Concept | Status | Evidence |
|---|---|---|
| Employee information (name, department, position) | **F** — derived, prefillable | Already available server-side on every `leave_requests` row's own `employeeId` join |
| Leave type | **A** — already stored | `leave_requests.leaveTypeId` → `leave_types` |
| Requested dates | **A** — already stored | `leave_requests.startDate/endDate` |
| Contact details while on leave | **D** — not represented | No field on `leave_requests` for an away-contact number/address distinct from the employee's own stored phone/address |
| Approval/rejection | **A** — already stored | `leave_requests.status`, `approved_by`/`approved_at`/`rejection_reason` |
| Remaining leave days | **A** — already computed | `leaveBalances.ts` computes this live from the ledger; not a form field, a live query |
| Resumption date | **F** — derived, not a stored field | No dedicated column exists; this is trivially `endDate + 1 day`, and should stay computed rather than becoming a new column |
| **"At least 7 working days in advance" submission rule** | **A, with a genuine discrepancy — see below** | `leave_policies.noticePeriodDays` (`lib/db/src/schema/leave-policies.ts`), enforced as a **hard block** in `createLeaveRequest` (`artifacts/api-server/src/lib/leaveRequests.ts:190-196`): `if (policy.noticePeriodDays != null && policy.noticePeriodDays > 0) { ...throw new InvalidLeaveRequestError(...) }` |

**The discrepancy, precisely:** `noticePeriodDays` already exists, is already **per-leave-policy configurable** (more flexible than a single global "7 days" rule — WWM could set a different notice period per leave type if desired), and is already a **hard block with no exception path** (no HR override exists to force-submit past the notice window). But the existing implementation counts **calendar days** (`earliestAllowed.setUTCDate(earliestAllowed.getUTCDate() + policy.noticePeriodDays)` — a flat date-add, no weekend/holiday skipping), while WWM's own stated rule is **"7 working days."** This is a real, evidence-based gap, not a guess — flagged as Owner Decision 11.

---

## 4. Current Employee Number Architecture

**FOUND IN REPOSITORY**, verified directly against the actual shipped code (not assumed from any prior design discussion):

- **Schema** (`lib/db/src/schema/employees.ts:41`): `employeeNumber: text("employee_number")` — plain nullable text, no format/pattern constraint.
- **Uniqueness** (`employees.ts:100-101`, migration `0000_init_core_platform_foundation.sql:308`): a composite unique index on `(organization_id, employee_number)`. Scoped per-organization (two orgs may reuse the same value with zero conflict). Nullable, so Postgres allows unlimited `NULL` values simultaneously.
- **Generation** (`artifacts/api-server/src/lib/employees.ts:77-84`):
  ```ts
  export async function generateEmployeeNumber(organizationId: number): Promise<string> {
    const [row] = await db.select({ value: count() }).from(employeesTable).where(eq(employeesTable.organizationId, organizationId));
    const sequence = (row?.value ?? 0) + 1;
    return `EMP-${String(sequence).padStart(4, "0")}`;
  }
  ```
  **Correcting an apparent prior assumption stated in this session's own prompt**: this format (`EMP-0001`) is **completely hardcoded** — there is **no organization-configurable numbering today**. `artifacts/api-server/src/services/organizationConfig.ts` (the actual config-namespace registry: `general`, `terminology`, `attendance`, `performance` — confirmed by reading `CONFIG_NAMESPACES` in full) has no `numbering` namespace, and that file's own top-of-file comment explicitly names **"numbering formats"** as an example of a namespace that will be **added later, by its own future workstream** — i.e., the codebase itself already documents that this was designed for, but never built. "We previously designed employee numbering as tenant-configurable" does not match what actually shipped; only the *aspiration* was recorded, not the capability.
- **Manual entry**: supported at the API layer (`createEmployee`, `employees.ts:142`: `params.fields.employeeNumber ?? generateEmployeeNumber(...)`) and via `UpdateEmployeeBody`/`CreateEmployeeBody` (both accept an optional `employeeNumber` string) — but **not exposed in the current "Add Employee" UI dialog** (`artifacts/hrms/src/pages/employees.tsx` — no input field for it, confirmed by direct inspection).
- **Legacy import path**: none exists as a distinct feature. The only way to preserve a legacy number today is the same generic "supply `employeeNumber` in the create body" path — there is no bulk-import tooling of any kind (see §4a).
- **Mutability**: `employeeNumber` is **not immutable**. Any caller holding `employee.write` can change it via the generic `PATCH /employees/:employeeId` route, which spreads `UpdateEmployeeBody` (including `employeeNumber`) directly into the update (`routes/employees.ts:297`) — **with zero audit trail for that specific change**. The route's own audit block only fires when `employmentStatus` changes (`routes/employees.ts:301-312`); a same-request change to `employeeNumber` alone produces no `audit_events` row and no before/after record.
- **Race condition (pre-existing, disclosed, unrelated to this discovery's own scope)**: `generateEmployeeNumber`'s `count()`-based sequence is not transactionally safe — two simultaneous employee creations can read the same count before either insert commits, producing a duplicate-candidate value that then collides on the unique index (surfacing as a 409, not silently succeeding). The function's own doc comment already acknowledges this is "not retried automatically." This is a genuine pre-existing gap, separate from the new reuse-model concurrency requirements in §7 below.
- **Foreign-key/identity usage — the central finding for the reuse question**: an exhaustive grep across every backend module (`attendance*.ts`, `leave*.ts`, `performance*.ts`, `learning*.ts`, `asset*.ts`, `employeeSelfService.ts`, `managerPortal*.ts`) and every frontend page found **zero** places where `employeeNumber` is used as a foreign key or lookup identity. Every module without exception uses the internal integer `employees.id` for joins, scoping, and the `` `Employee #${employeeId}` `` display fallback pattern. `employeeNumber` is used only for (a) display, (b) the free-text search box in `listEmployees()` (`employees.ts:183`, an `ilike` OR-match alongside name/email), and (d) one CSV export column in `learningReporting.ts` that resolves the value **live** at export time (not snapshotted, unlike every other historical dimension in that same report, which the code's own comment explicitly says is deliberate: "every historical dimension read from the enrollment's own snapshot columns, never the live... employee row" — `employeeNumber` was simply never added to that snapshot).

**Correcting the Owner's own "internal employee UUID" language**: the permanent internal identity is `employees.id`, a **serial auto-incrementing integer primary key**, not a literal UUID type. Functionally it already satisfies exactly what the Owner is asking for (permanent, immutable, never reused, never exposed as the "public" number) — this document just notes the terminology so the eventual implementation plan isn't built around a UUID migration that isn't actually needed.

### 4a. Bulk Import / Export

**FOUND IN REPOSITORY**: no bulk-import feature exists for employees at all — `routes/employees.ts`'s 19 routes are all single-record CRUD/action endpoints; the two `multer` upload instances in that file are scoped to profile pictures and document attachments, not CSV ingestion. Export is limited to the generic 3-report Reporting Foundation (none reference `employeeNumber`) and Learning's own CSV reports (§4, live-resolved `employeeNumber` column only). **This means WWM's own legacy staff/PIF data has no existing import path today** — relevant to Owner Decision 19 (Legacy Import).

---

## 5. National Identifier Fields — A Real, Pre-Existing Inconsistency

**FOUND IN REPOSITORY**: `employees.nationalId`/`employees.passportNumber` (`employees.ts:51-52`) are plain hardcoded `text` columns — one column per identifier type, Ghana-Card-shaped by convention but not by name. By contrast, `candidates.nationalIdentifierType`/`candidates.nationalIdentifierValue` (`lib/db/src/schema/candidates.ts:31-32`) use a **generic configurable type+value pair**, per an explicit, already-frozen Recruitment Owner Decision (`docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md:345`, item 10): *"Generic configurable type+value (not hardcoded 'Ghana Card')... A hardcoded field violates the organization-neutral principle even though this deployment is Ghana-first."*

**That decision was never retrofitted onto `employees`.** For WWM's own "Ghana Card number" PIF field, the existing `employees.nationalId` field already stores the value correctly (classification A) — the platform's own organization-neutral principle is preserved not by the column name but by **not hardcoding a UI label**: WWM's own terminology configuration (`organizationConfig.ts`'s `terminology` namespace, already shipped) can label this field "Ghana Card Number" for WWM specifically, while another organization labels the same column something else. No schema change is needed to satisfy WWM's own requirement here — only whether to retrofit the generic type+value pattern platform-wide is a genuinely open question, raised as Owner Decision 4-adjacent but not bundled into the numbering-engine decision itself.

---

## 6. Employee Number Reuse — Impact Analysis

**OWNER-STATED requirement**, evaluated against the architecture in §4.

**What must change**: the current unique index — `UNIQUE (organization_id, employee_number)` — makes reuse **structurally impossible today**. Since employees are never hard-deleted (ADR-013, `DECISIONS.md:75-78`), Employee A's row (with `employeeNumber = 'WWM/SN/014'`) continues to exist in the `employees` table forever after separation. Any attempt to insert or update Employee B with the same `employeeNumber` value while Employee A's row still holds it would be rejected by the unique index (SQLSTATE `23505`) — this is not a policy gap, it is a hard database constraint. **A schema change is unavoidable to support reuse at all** — this is a firm, evidence-based conclusion, not a guess.

**What does NOT need to change**, per §4's own "identity vs FK" finding: because zero modules treat `employeeNumber` as a foreign key or lookup identity anywhere in the codebase, **reuse does not require touching attendance, leave, performance, learning, assets, ESS, Manager Portal, or the audit log** — every one of those already keys exclusively off `employees.id`, which remains permanent and unique regardless of how `employeeNumber` is reallocated. The only code that must change is: (a) the uniqueness constraint itself, (b) the generation function, (c) the one live-resolved CSV column in `learningReporting.ts` (cosmetic only — it would start showing the *current* holder's number for a past report row unless a proposed allocation-history model is consulted at report time), and (d) any new UI/API built specifically to manage allocation.

---

## 7. Proposed Allocation-History Model

**PROPOSED DESIGN**, not yet approved, addressing §6/§7 of the Owner's own prompt.

### Option A — New `employee_number_allocations` table (recommended)

A new table, structurally similar to the existing `employment_periods` append-only pattern (`lib/db/src/schema/employment-periods.ts`, Phase 2A, W22 — already proven, already understood by this codebase's own conventions):

```
employee_number_allocations
  id               serial PK
  organizationId    integer, FK organizations
  employeeNumber    text, NOT NULL
  employeeId        integer, FK employees
  validFrom         timestamp, NOT NULL
  validTo           timestamp, NULL  -- NULL = current holder
  allocatedBy       integer, FK users
  releasedBy        integer, FK users, NULL
  createdAt         timestamp
```

`employees.employeeNumber` would become a **denormalized, always-current cache** of the row where `validTo IS NULL` for that employee — kept in sync by the same service function that writes an allocation row, never edited directly via the generic `PATCH /employees/:id` route anymore (closing the §4 "no audit trail for employeeNumber change" gap as a side effect, not a separate fix).

**Required properties, mapped to this model:**
- *Only one current holder*: a **partial unique index** `UNIQUE (organizationId, employeeNumber) WHERE validTo IS NULL` — Postgres natively supports this and is the correct way to enforce "at most one open allocation per number" at the database level, not merely in application code.
- *Previous holder permanently discoverable*: trivial — query `employee_number_allocations WHERE employeeNumber = ? ORDER BY validFrom`.
- *Historical documents/transactions remain associated with the correct employee UUID*: automatic, since every other table already keys off `employees.id`, never `employeeNumber` (§4/§6).
- *Reports for historical periods identify the correct holder*: requires each historical-reach report to resolve `employeeNumber` via the allocation table **as-of the report's own date**, not via a live join to `employees.employeeNumber` (this is the fix needed in `learningReporting.ts` and any future report touching this field).
- *Accidental duplicate active allocation impossible under concurrency*: the partial unique index handles this at the database level — no reliance on a pre-check.

**Schema impact**: one new table, one new partial unique index, a `NOT NULL` migration-safe backfill (one allocation row per existing employee with a non-null `employeeNumber`, `validFrom = createdAt`, `validTo = NULL`). `employees.employeeNumber` itself is **not dropped** — kept as the fast-read cache, with the allocation table as the source of truth. This is additive, not a breaking schema change.

### Option B — Reuse `employment_periods` with a new event type

Rejected as the primary recommendation: `employment_periods` already has a specific, narrow purpose (transfer/promotion/confirmation — organizational movement events tied to one continuously-employed person). Overloading it with a *different* concept (a business identifier's own allocation lifecycle, which spans *across* people) would blur that table's own single responsibility and complicate its existing consumers (Career Profile's own Employment History display, W105/W106) for no real benefit over a small dedicated table.

### Option C — No allocation table; only track "released" numbers

Rejected: does not satisfy "previous holder permanently discoverable" or "reports for historical periods identify the correct holder" — a bare release-date-only model cannot answer "who held `WWM/SN/014` in 2020" once a second person has taken it.

**Recommendation: Option A.** [PROPOSED DESIGN DECISION — see Owner Decision 1]

---

## 8. Current PIF/File Number Architecture

**FOUND IN REPOSITORY**: **does not exist in any form.** No field, table, or Master Data domain resembling a "personnel file number" or "PIF number" exists anywhere in the schema. This is confirmed, not assumed — `employees.ts` has no such column, and no `employee_personnel_file` or similarly-named table exists among the `employee-*.ts` schema files.

**Staff Number ↔ PIF Number linkage**: cannot exist today, since neither the PIF-number concept nor a linking mechanism has been built. Both would need to be created together as part of the same workstream (see §9/§15).

---

## 9. PIF Number Format & Number Format Engine

**OWNER-STATED** requirement: employee-number format and PIF-number format must be **independently configurable**, sharing a generic engine where sensible.

**PROPOSED DESIGN**: a single, reusable **Numbering Format Configuration** mechanism (a natural fit for `organizationConfig.ts`'s own existing `numbering` namespace, already named as a "to be added" example in that file's own comment — §4), instantiated **twice** per organization: once for `employeeNumber`, once for `personnelFileNumber` — same engine, independent configuration values, never shared state. Proposed configurable components, evaluated against what the Owner's own examples actually need (not an unbounded list):

| Component | Needed for `WWM/SN/001`? | Needed for `PIF-001`? | Include in V1? |
|---|---|---|---|
| Prefix (free text, e.g. `WWM/SN/`, `PIF-`) | Yes | Yes | Yes |
| Sequence + zero-padding width | Yes | Yes | Yes |
| Separator between components | Implicit in prefix | Implicit in prefix | Fold into prefix, not a separate component (simpler, matches both examples) |
| Suffix | Not shown in examples | Not shown in examples | Defer — no evidence it's needed yet |
| Year/month token | Not shown in examples | Not shown in examples | Defer to V1+ (mentioned only as a hypothetical, e.g. `EMP/2026/001`) |
| Department/branch/position token | Not shown in examples | Not shown in examples | Defer — adds real complexity (what happens on transfer?) with no stated WWM need |
| Manual override (bypass generator entirely) | Yes (already exists) | Yes (must exist from day one) | Yes |
| Starting sequence value | Needed for legacy import (§ below) | Needed for legacy import | Yes |
| Reset policy (e.g. yearly reset) | Not requested | Not requested | Defer |

**Recommendation**: build the minimal engine (prefix + zero-padded sequence + manual override + configurable starting sequence), proven against WWM's own two real formats, rather than the full hypothetical component list — extend later only if a real organization needs year/department tokens. [PROPOSED DESIGN DECISION — see Owner Decision 4]

---

## 10. PIF Number Reuse — Not Assumed

Per this document's own explicit instruction, PIF/personnel-file-number reuse is **not** assumed merely because staff-number reuse is required. Records-management convention generally favors a personnel file's own identity staying permanently attached to the person's record, distinct from a reusable *organizational* business identifier like a staff number — but this is a genuine, unresolved policy question, not a technical one, since no PIF-number mechanism exists yet to reuse or not reuse. Raised as Owner Decision 3, with no reuse assumed as the default going in.

---

## 11. Personnel File Identity, Physical Filing & Records Management

**FOUND IN REPOSITORY**: confirmed via an exhaustive repository-wide search (code, schema, `*.md` docs) — **no personnel-file/physical-filing feature of any kind exists**, beyond the one explicit deferral citation already quoted in §1 (`docs/PHASE_2B_IMPLEMENTATION_PLAN.md:245`). Specifically confirmed absent: file number, records number, physical file, records room, cabinet, drawer, shelf, box, chain of custody, file movement, checkout, stocktake, QR code, barcode. Zero matches for any of these across the entire codebase.

### 11a. The Five Distinct Identities (§13 of the Owner's prompt)

Confirmed as genuinely distinct concepts requiring their own identity, none of which collapse into another:

| # | Concept | Current State |
|---|---|---|
| A | Employee identity | `employees.id` — permanent, already correct (§4) |
| B | Staff number | `employees.employeeNumber` — reusable-pending-redesign (§6/§7) |
| C | Personnel/PIF file identity | Does not exist (§8) |
| D | Physical storage location | Does not exist |
| E | Digital documents | `employee_documents` — exists, metadata-only (§12) |

### 11b. Physical Location Hierarchy

**FOUND IN REPOSITORY**: Master Data (`lib/db/src/schema/master-data-items.ts`, confirmed by direct schema read) is **strictly flat** — `id, domain, organizationId, code, label, sortOrder, status, createdAt, updatedAt`, **no `parentId` or self-referencing column of any kind**. The two closest existing domains, `region` and `city`, are independent flat lists with no parent-child link between them (i.e., Master Data does not even model the *simplest* two-level hierarchy today, let alone site→building→room→cabinet→drawer→shelf→box).

**Conclusion**: a physical-location hierarchy **cannot** be represented in the existing Master Data mechanism as-is. Two real options:

- **Option A**: extend `master_data_items` with a nullable self-referencing `parentId` — a small, additive schema change, reusable by *any* future hierarchical domain, not just physical locations. Keeps the existing "flat by default" domains (skill, gender, etc.) completely unaffected (a `NULL parentId` is exactly today's behavior).
- **Option B**: a dedicated new `records_locations` table, purpose-built for the location hierarchy only, with its own `parentId`.

**Recommendation**: Option A (generic `parentId` on Master Data) — it solves the location hierarchy *and* becomes reusable platform infrastructure for any other future hierarchical requirement, matching this platform's own stated preference for configuration over dedicated one-off tables. Levels remain optional per the Owner's own explicit instruction ("Do not force all levels to be mandatory") — a location row can point directly at any ancestor, skipping unused levels. [PROPOSED DESIGN DECISION — see Owner Decision 5]

### 11c. Movement / Chain of Custody

Does not exist. Would require a new `personnel_file_movements` table (checkout/transfer/return, with `expectedReturnDate`, `actualReturnDate`, status enum `checked_out | returned | overdue | missing | recovered`) — additive, no precedent to reuse beyond the general append-only-history pattern already established by `employment_periods`.

### 11d. Volumes

Does not exist. A `personnel_file_volumes` table (one file → many volumes, `volumeNumber`, `status: open|closed`, own location) would be additive and structurally simple — the Owner's own instruction that "a new volume must not become a new employee" is already naturally satisfied by keeping volumes as a child of the personnel-file identity (§8/§11a item C), never of the employee identity directly.

### 11e. QR/Barcode

**FOUND IN REPOSITORY**: does not exist anywhere — zero package.json dependency, zero code reference, across the entire monorepo. `PROJECT_STATUS.md`'s own Phase 3E completion report explicitly lists "RFID/barcode/GPS tracking" as something Assets *deliberately did not build*. Building this is a genuinely new capability with a real V1-scope question (Owner Decision 9) — no hardware integration is implied by generating a scannable code string/image alone, but even that is new surface area.

### 11f. Stocktaking

Does not exist. A genuinely later-phase capability per the Owner's own framing ("Do not implement. Determine whether appropriate for initial records V1 or later") — recommend explicit deferral past V1 (Owner Decision 10).

### 11g. Records-Related Roles

**FOUND IN REPOSITORY**: "Records Officer" and "Auditor" are named only as **aspirational example role-template names** in `DECISIONS.md:89` (ADR-015) and `docs/FOUNDATION_IMPLEMENTATION_PLAN.md:234-248` — **never seeded, never implemented as actual roles**. However, the underlying **custom-role creation mechanism ADR-015 describes IS implemented**: `lib/roleTemplates.ts`'s `copyRoleTemplate()` (confirmed live, `routes/organizationRoles.ts:53`, `POST /organizations/:organizationId/roles`) lets an `org_admin` copy any existing **system** role (`super_admin`/`org_admin`/`hr_manager`/`employee`) into a new org-scoped custom role, then grant/revoke individual permissions on it. **No pre-seeded "Records Officer" template row exists** — but once records-related permissions are defined (a later workstream), an organization could create a "Records Officer" role today using this already-shipped mechanism, without any new platform capability. This is a materially different, more optimistic finding than "roles don't exist" — the infrastructure is there; only the specific permissions and the convenience of a pre-named template are missing.

---

## 12. Document Management Reconciliation

**FOUND IN REPOSITORY** (`lib/db/src/schema/employee-documents.ts`, `artifacts/api-server/src/lib/fileStorage.ts`, `documentValidation.ts`):

- `employee_documents`: `id, organizationId, employeeId (nullable, since Phase 3E W95, to support non-employee org documents like asset receipts), categoryCode (free text, sourced from but NOT validated against the `document_category` Master Data domain), fileName, storageKey, mimeType, fileSize, uploadedBy, createdAt`. **One row per uploaded file — re-uploads are new rows, not versions.**
- **No retention/expiry field of any kind.** No physical-location/file-number/volume column. **No download/read route exists at all** for employee documents (`routes/employees.ts` exposes only list/upload/delete — confirmed by direct inspection; contrast with the profile-picture route, which does read bytes back). Audit events exist only for `employee_document.uploaded`/`.removed` — no "viewed"/"downloaded" event, consistent with there being no download route to audit in the first place.
- `fileStorage.ts`: local disk only (`uploads/organizations/{orgId}/...`), randomly-generated filenames (no path-traversal risk from user input), never served by static middleware. `documentValidation.ts`: magic-byte signature validation (PDF/JPEG/PNG/DOCX/XLSX only), 10MB cap. No cloud storage, no versioning, no retention/archive lifecycle anywhere.

**Recommendation**: the records/filing system should **orchestrate** this existing infrastructure, never replace it — reuse `employee_documents`/`fileStorage`/`documentValidation` verbatim for every digital-document need (scanned PIF forms, evidence, etc.), adding only what's genuinely missing: retention metadata, a real download route (a surprising, pre-existing gap worth fixing regardless of records-system scope — flagged separately, not bundled), and the physical-location/movement/volume concepts described in §11, which belong to the *personnel file* record, not to `employee_documents` itself.

---

## 13. Automatic Filing — Realistic Automation Matrix

| Source Module | Record | Currently Produces a Document? | Should File Automatically? | Target Category | Owner Decision Required? |
|---|---|---|---|---|---|
| Employee Lifecycle | Transfer/Promotion/Confirmation event | No — `employment_periods` is a structured row, not a document | Optional — could auto-generate a simple text/HTML summary (mirroring Recruitment's own offer-letter precedent, `docs/PHASE_3A...` item 7: "stored HTML/text template, no PDF engine") | `employment_history` | Yes — whether to build this at all in V1 |
| Leave | Approved leave request | No | Optional, low value (already fully queryable) | `leave` | Yes, but low priority |
| Performance | Finalized review | No (Performance evidence/attachment exists as a separate upload feature, W83) | Possibly — a finalized review could auto-file its own PDF/HTML snapshot | `performance` | Yes |
| Probation | Confirmation action | No — `confirmEmployee()` produces only an audit-logged status change, zero content capture (§14) | Depends entirely on the probation-review architecture decision (Owner Decision 13) | `probation` | Yes — coupled to Owner Decision 13 |
| Learning | Certificate/evidence | Yes — `learning_certificates`, `learning_enrollment_evidence` already exist as real records | Already effectively "filed" via Learning's own module; no new automation needed | n/a | No |
| Disciplinary | Disciplinary record | Yes — `employee_disciplinary_records` exists | Could auto-attach to personnel file once one exists | `disciplinary` | Yes |
| Separation | Exit process | Yes — `employee_exit_processes` exists (checklist/clearance/exit interview) | Yes — natural candidate for auto-filing on close | `separation` | Yes |

**No event in this codebase currently auto-files anything into any personnel-record concept, because no such concept exists yet.** Every "Yes" in the "Should File Automatically" column is a V1+ candidate, not a V1 requirement — recommend deferring all auto-filing until the personnel-file registry itself (§11a item C) exists and has proven the manual-filing path first.

---

## 14. WWM Staff Evaluation — Reconciliation

**OWNER-STATED** concepts (Staff Name, Position, Department, Review Period, rating/scoring, comments) reconciled against the shipped Performance module.

| WWM Concept | Status | Evidence |
|---|---|---|
| Staff Name, Position, Department | **F** — already snapshotted automatically | `performance_reviews.departmentIdSnapshot`/`positionIdSnapshot` (captured at review-creation time, per Performance's own historical-integrity design) |
| Review Period | **A** — already stored | `performance_reviews.cycleId` → `performance_cycles` (`startDate`/`endDate`) |
| Rating/scoring | **A** — already stored, template-configurable | `performance_review_competencies`, `performance_rating_scales`, `computedOverallScore` |
| Comments | **A** — already stored | `employeeFinalComment`, competency-level comment fields (confirmed present in the Performance schema from this session's own earlier work) |

**Conclusion**: WWM's own stated Staff Evaluation fields are **already fully covered** by the existing Performance module's own template/cycle/rating-scale architecture — this requires **configuration** (a WWM-specific rating scale and review template matching their own wording/scale), not new schema or a second evaluation engine. No Owner Decision required here beyond "build WWM's own template using existing Performance Foundation tools" — a configuration task, not a Phase 3H implementation item.

---

## 15. WWM Probation Review — Architecture Options

**OWNER-STATED**: no actual WWM probation-review form/source material was supplied ("If the form is NOT available: say so. Do not invent its fields.") — **confirmed: not available.** This section evaluates architecture only, not fields.

**FOUND IN REPOSITORY**, the load-bearing finding: `performance_cycles.cycleType` already has a `"probation"` enum value (`lib/performanceCycles.ts:231`) — but `resolveEligibleEmployees()` (`performanceCycles.ts:391-429`) **hard-requires `employmentStatus === 'active'` for every single applicability scope, including `manual`** (line 412-417: an explicit rejection — *"Employee id(s)... are not active and cannot be assigned a review"*). Since a probationary employee's `employmentStatus` is literally `"probation"`, not `"active"`, **zero probationary employees can be assigned a Performance review through any existing scope today, even by explicit manual HR selection.** The `"probation"` cycle-type value exists as a label with no actual path to use it for probationary staff as the schema currently stands.

**Options, evaluated against this finding:**

- **A — Inside Performance, via a special template/cycle**: architecturally the closest fit (reuses 100% of the Performance engine, satisfying "no parallel evaluation engine") but is **not viable without changing Performance's own `resolveEligibleEmployees` eligibility floor** — a genuine Performance-module change, not a configuration-only fix. This tension is disclosed, not hidden.
- **B — Inside employment confirmation workflow**: `confirmEmployee()` (`lib/employees.ts:406-435`) already exists, audited via `employment_periods` (`eventType: "confirmation"`) — but captures **zero review content**, only a status flip + effective date. Extending it to hold a rating/comments would either bloat `employment_periods`'s own narrow purpose or require a small companion table just for confirmation-review content.
- **C — A coordinated workflow using both**: Performance produces the *review content* (once the eligibility floor is addressed), confirmation remains the *outcome* (status transition), linked by referencing the review id from the confirmation event's own `employment_periods` row (`newState` already accepts arbitrary JSON per its existing shape). This avoids extending either engine's own core responsibility.
- **D — A dedicated new architecture**: rejected as disproportionate — nothing evidence-based suggests probation review needs a third pattern beyond what Performance/confirmation already provide once connected.

**Recommendation: Option C**, contingent on Owner Decision 13 approving the narrow, disclosed change to Performance's eligibility floor (allowing `employmentStatus = 'probation'` into `manual`-scope assignment specifically, not opening `all_active` to include probation — a deliberate, narrow carve-out, not a general loosening). [PROPOSED DESIGN DECISION — see Owner Decision 13]

---

## 16. Separation, Number Release & the Assets/Payroll Boundary

**FOUND IN REPOSITORY**:
- All four Owner-stated separation types (resignation/retirement/dismissal/death) collapse into the single `employmentStatus = "terminated"` value today, distinguished only by the free-text `separationReason` (sourced from the `separation_reason` Master Data domain — `organization-overridable` classification, but **zero default values are pre-seeded** for it, confirmed: only the domain registration exists, `master-data-definitions.ts:38`, "No default items are frozen for this domain"). WWM's own four reasons could be added as that organization's own Master Data values with zero schema change.
- `employee_exit_processes` (Phase 2A, W29) exists — checklist/clearance/exit-interview, one process per separation cycle (duplicate-prevented), audit-logged directly.
- **Assets and separation are deliberately, completely decoupled today**: `asset_unreturned_by_employee` is a report-only, informational query (confirmed in this session's own prior Phase 3E completion work: "zero `employee_exit_processes` references anywhere in Assets code"). Separation is never blocked by unreturned assets.
- **No Payroll exists in this codebase** — nothing to couple number-release to even if desired.

**Recommendation for number release** (Owner Decision 2): release should be an **explicit HR action**, never automatic on separation — the Owner's own stated workflow ("optionally release staff number") already implies this. Automatic release risks releasing a number while file movements/outstanding items are still open. Whether unreturned assets or open file movements should *block* (not just warn) release is a genuine open question — recommend **warn, do not block**, mirroring Assets' own existing report-only precedent exactly (consistency with an already-established platform pattern), rather than inventing a new hard-block model for this one release action. Payroll must never be a factor while WWM has no Payroll — and the capability must not assume Payroll exists, satisfying the Owner's own explicit boundary (§38 of the prompt).

---

## 17. Search Experience

**FOUND IN REPOSITORY**: `listEmployees()` (`employees.ts:177-187`) already performs a single free-text `search` param matched via `ilike` `OR` across `firstName`, `lastName`, `preferredName`, `employeeNumber`, `workEmail`, `personalEmail` — so "search by name or employee number in one box" **already works today**, scoped to the Employees list page. **No cross-entity/global search exists anywhere** (confirmed: zero matches for "globalSearch"/"omnisearch"/"command-palette" repository-wide). A future "PIF number → employee + staff number" and "physical location → files" search would need genuinely new query paths once those entities exist — this is new surface area, not an extension of the existing search box, since PIF numbers/physical locations don't exist as queryable entities yet.

---

## 18. Configurability Classification

Per the Owner's own explicit instruction (§30), every proposed behavior classified:

| Behavior | Classification |
|---|---|
| `employees.id` as permanent identity | **Platform invariant** (already true, unrelated to this phase) |
| Employee-number format is configurable | **Platform capability** (the engine); the specific format chosen is **organization configuration** |
| `WWM/SN/001`, `PIF-001` | **WWM configuration** (specific values within the platform capability) |
| Employee-number reuse **capability** existing at all | **Platform invariant**, once built — must exist for every organization, per the Owner's own explicit "reuse must be supported for all organizations" statement |
| Whether reuse is actually **exercised** for a given organization | **Organization configuration** — recommend a per-organization policy flag (default: reuse permitted, since the Owner's own instruction frames this as the general expectation, not an opt-in exception) — see Owner Decision 2 |
| Physical-location hierarchy depth/levels used | **Organization configuration** (an organization uses only the levels it needs, per the Owner's own explicit instruction) |
| Ghana Card / SSNIT as specific identifier types | **WWM configuration**, riding on a platform-level generic identifier capability (§5) |

---

## 19. Security / Privacy

**FOUND IN REPOSITORY**, the load-bearing pre-existing fact: `employee.read` (held by the default `employee` role) already exposes an employee's **full profile organization-wide** — including `nationalId`, `dateOfBirth`, `residentialAddress`, `emergencyContacts` — **with zero manager-vs-stranger narrowing anywhere.** This is the same pre-existing hardening item disclosed during Manager Portal's own discovery (Phase 3G) and **deliberately not fixed** by that phase. It remains open today.

**Direct application to this discovery**: every PIF field this document recommends storing (Ghana Card/SSNIT/dependants/medical/church-ministry information, if approved) would, if simply added as new `employees` columns, **inherit this exact same broad exposure** — any `employee`-role holder could read any coworker's Ghana Card number, medical information, or dependants list, org-wide, today, with the existing gap unaddressed. **This is a real, load-bearing dependency, not a hypothetical one.**

Per this document's own explicit instruction ("If not: raise a STOP-level dependency"): **this is flagged as a STOP-level dependency for any V1 workstream that would store new sensitive PIF fields (dependants, medical information, or any newly-added identifier) on the existing broad-`employee.read`-gated `employees` table.** It does **not** block the *numbering/reuse* work (§4-§7), which touches no new sensitive field, nor the *records/filing metadata* work (§11-§13), which is about file/location/movement tracking, not sensitive personal content. It specifically blocks: adding new sensitive fields directly to the broadly-exposed `employees` row. Two safe paths exist without fixing the broad gap first: (a) store new sensitive fields in a **separately-permissioned** table (mirroring `employee_disciplinary_records`'s own already-correct `employee.disciplinary.read` pattern, distinct from `employee.read`), or (b) fix the broad `employee.read` gap first, as its own dedicated, narrowly-scoped hardening workstream. **Recommendation: (a)** — narrower blast radius, consistent with the platform's own established precedent, and does not require Owner approval of a larger, separate hardening initiative before this phase can proceed. [PROPOSED DESIGN DECISION — see Owner Decision 20]

---

## 20. Audit, Historical Integrity & Concurrency

**Audit** (Owner Decision-adjacent, not itself a numbered decision — a build requirement once §7/§11 are approved): every action listed in the Owner's own prompt (§32) is a real gap today for numbering (confirmed: zero audit event exists for employee-number allocation/change, §4) and would be entirely new for the records/filing system (nothing exists to audit yet). No sensitive form *contents* should ever appear in audit metadata — matching the platform's own existing convention (e.g., Assets' incident-report audit metadata deliberately excludes free-text descriptions, per this session's own prior Phase 3E work).

**Historical integrity**: verified structurally sound for the proposed reuse model — because zero modules use `employeeNumber` as identity (§4/§6), reallocating a number cannot rewrite any historical attendance/leave/performance/learning/asset/document/audit/employment-history record; all of those already key off the permanent `employees.id`. The one identified exception requiring a fix is `learningReporting.ts`'s live-resolved `employeeNumber` CSV column (§4) — a report generated *after* a reallocation would show the *new* holder's number next to *old* historical rows unless report generation is updated to consult the allocation-history table (§7) for the report's own as-of date.

**Concurrency**: the partial unique index proposed in §7 (`UNIQUE (organizationId, employeeNumber) WHERE validTo IS NULL`) is a database-level guarantee, not an application pre-check — directly satisfying the Owner's own "recommend DB-level protection where appropriate... do not rely only on pre-checks" instruction. The same pattern (a partial/conditional unique index) would apply to PIF-number allocation and to "only one open file-movement checkout per file" if/when those are built. The pre-existing `generateEmployeeNumber` race condition (§4) is a separate, disclosed, pre-existing gap — fixing it is a reasonable side effect of building the allocation table (the sequence would move from a live `count()` to a proper allocation-table-backed generator), not a new problem this phase introduces.

---

## 21. Legacy Import

**FOUND IN REPOSITORY**: no bulk-import mechanism exists at all today (§4a) — this is not specific to numbering, it's a total gap. WWM's own existing staff/PIF/physical-location data has no path into the system beyond one-employee-at-a-time manual entry (which does already support supplying a pre-existing `employeeNumber`, satisfying "do not force regenerated identifiers during import" for the *single-record* case). A genuine bulk-import capability (CSV or similar), covering employees + optionally their historical number allocations + PIF numbers + known physical-location assignments, is new scope — recommend a dedicated, later workstream (W119 in the proposed structure below), not bundled into the foundational numbering/records work.

---

## 22. HR Daily Workflow (Planning-Level Only)

Per the Owner's own three example flows (§29), evaluated against what already exists:

- **New Employee**: `create employee` (exists) → `allocate staff number` (exists today via manual entry or auto-generation, §4) → `allocate PIF` (does not exist, §8) → `capture PIF information` (partially exists per §2's reconciliation) → `create personnel file` (does not exist, §11) → `onboarding` (exists, Foundation-era) → `probation schedule` (exists — `probationEndDate` is already captured at hire). The gaps are concentrated entirely in PIF-number/personnel-file territory, not in what already works.
- **Existing Employee**: the Owner's own "one profile" vision is already substantially true today — `employee-detail.tsx` already orchestrates employment history, documents, skills/qualifications/certifications (HR side) and Career Profile (ESS side) on one page per employee. Adding PIF number, personnel file, and physical-location status to that same existing page (rather than a new standalone screen) is the natural, low-friction extension — no new "workspace" architecture needed, just new cards on an already-proven page.
- **Separation**: `close employment` (exists, `separateEmployee`) → `outstanding assets warning` (would need a new, deliberately non-blocking check, §16) → `outstanding file movements` (new, once §11c exists) → `preserve personnel record` (automatic — the personnel file's own identity outlives the employee's active status, per §11a) → `close staff-number allocation` (new, §7) → `optionally release staff number` (new, explicit HR action, §16).

---

## 23. Existing HRMS Reuse (Confirmed Applicable)

Every one of the Owner's own listed reuse targets (§37) was independently confirmed to exist and be reusable: Employee Management, `employment_periods`, Employee Self Service, Performance, Leave, Assets, `employee_documents`, `fileStorage`, Master Data, the audit log, the Reporting Foundation, the module registry, permissions, organization settings. No second engine is proposed anywhere in this document for anything already covered by one of these.

---

## 24. Payroll Boundary

Confirmed nowhere in this document does this discovery propose building Payroll, Payroll tables, Payroll permissions, or Payroll UI, or couple PIF/numbering/file operations to Payroll's own existence. Number-release recommendation (§16) explicitly does not require Payroll closure. The proposed `employee_number_allocations` table (§7) and personnel-file tables (§11) are structurally independent of Payroll — a future Payroll module could reference `employees.id` (as every other module already does) without any of this phase's own tables needing to change.

---

## 25. Current-State Gap Matrix

| Requirement | Current Support | Partial | Missing | Reusable Foundation | Schema Impact | Security Impact | Owner Decision? |
|---|---|---|---|---|---|---|---|
| Staff number | ✅ (hardcoded format) | | | `employees.employeeNumber` | None for current state | None | — |
| Staff-number format | | | ✅ | `organizationConfig.ts`'s own "future numbering namespace" | New config namespace | None | Yes (4) |
| Number reuse | | | ✅ | `employees.id` already unaffected | New table + partial unique index | None | Yes (1, 2) |
| Allocation history | | | ✅ | `employment_periods`' own append-only pattern | New table | None | Yes (1) |
| PIF number | | | ✅ | Numbering engine (shared w/ staff number) | New column/table | None | Yes (4) |
| PIF format | | | ✅ | Same engine | Same as above | None | Yes (4) |
| PIF form fields | ✅ Partial (§2 table) | ✅ | ✅ (dependants/languages/medical/church) | `employees`, `employee_qualifications` | New columns/tables for D/E items only | Yes, for E items | Yes (16, 20) |
| Filing (personnel file identity) | | | ✅ | `employee_documents` (digital half only) | New table | Low (metadata only) | Yes (5) |
| Physical location | | | ✅ | Master Data (needs `parentId` extension) | New column + optional new table | None | Yes (5) |
| Movements | | | ✅ | `employment_periods`' own history pattern | New table | Low | Yes (6) |
| Volumes | | | ✅ | — | New table | None | Yes (7) |
| QR/barcode | | | ✅ | — | None (generated on read) | None | Yes (8) |
| Stocktaking | | | ✅ | — | New table (if built) | None | Yes (9) |
| Leave form | ✅ mostly | ✅ (contact-while-on-leave) | | Leave module, `noticePeriodDays` | None for existing fields | None | Yes (10, working-days) |
| Staff evaluation | ✅ fully | | | Performance module | None (configuration only) | None | No |
| Probation review | | ✅ (confirmation exists) | ✅ (review content) | Performance + confirmation | Small eligibility-floor change + small table | None | Yes (12) |
| Separation | ✅ | | ✅ (typed reasons need seeding) | `employeeExitProcess`, Master Data | None (seed data only) | None | No |
| Search | ✅ (per-page) | | ✅ (cross-entity: number↔PIF↔location) | `listEmployees()`'s own search pattern | None initially | None | No |
| Automatic filing | | | ✅ | Every source module already listed in §13 | Depends on §11 existing first | None | Yes (13, coupled) |

---

## 16. Owner Decisions

Every decision below is genuinely unresolved by existing repository evidence and is not pre-approved.

### Decision 1 — Allocation-History Model
**Evidence**: §6/§7. **Recommendation**: new `employee_number_allocations` table with a partial unique index (`WHERE validTo IS NULL`), `employees.employeeNumber` retained as a denormalized current-value cache. [PROPOSED DESIGN DECISION]

### Decision 2 — Reuse: Always Allowed vs. Organization-Configurable
**Evidence**: §18. The Owner's own instruction frames reuse as a required platform capability for every organization, but whether a given organization *exercises* it is a separate question. **Recommendation**: the capability is a platform invariant (must exist); whether reuse is actually offered to HR by default is a per-organization policy flag, defaulting to **enabled** (matching the Owner's own stated general expectation), not opt-in. [PROPOSED DESIGN DECISION]

### Decision 3 — Explicit Release vs. Automatic Release
**Evidence**: §16. **Recommendation**: explicit HR action only, never automatic on separation; warn (do not block) on outstanding assets/file movements, mirroring Assets' own existing report-only precedent. [PROPOSED DESIGN DECISION]

### Decision 4 — PIF-Number Reuse
**Evidence**: §10. **Recommendation**: PIF/personnel-file numbers remain permanently attached to the person's record after separation, never reallocated — records-management convention favors this, and unlike staff numbers, the Owner gave no explicit instruction requiring PIF reuse. [PROPOSED DESIGN DECISION]

### Decision 5 — Numbering Format Engine Scope
**Evidence**: §9. **Recommendation**: minimal engine (prefix + zero-padded sequence + manual override + configurable starting sequence) proven against WWM's own two real formats; defer year/department/suffix tokens until a real need is shown. [PROPOSED DESIGN DECISION]

### Decision 6 — Physical-Location Hierarchy Storage
**Evidence**: §11b. **Recommendation**: extend Master Data (`master_data_items`) with a nullable `parentId`, rather than a dedicated one-off location table — reusable platform infrastructure, zero impact on existing flat domains. [PROPOSED DESIGN DECISION]

### Decision 7 — Movement/Check-Out Model
**Evidence**: §11c. **Recommendation**: new `personnel_file_movements` table, append-only history, statuses `checked_out|returned|overdue|missing|recovered`. [PROPOSED DESIGN DECISION]

### Decision 8 — Volumes
**Evidence**: §11d. **Recommendation**: new `personnel_file_volumes` table, child of the personnel-file identity (never of the employee identity directly), `open|closed` state. [PROPOSED DESIGN DECISION]

### Decision 9 — Barcode/QR in V1
**Evidence**: §11e. **Recommendation**: defer past V1 — genuinely new surface area with no existing precedent anywhere in this codebase, and no stated urgency distinct from the core filing/movement capability. [PROPOSED DESIGN DECISION]

### Decision 10 — Stocktaking in V1
**Evidence**: §11f. **Recommendation**: defer past V1 — depends on the filing/location/movement foundation existing and proving itself first. [PROPOSED DESIGN DECISION]

### Decision 11 — WWM "7 Working Days" Leave Rule
**Evidence**: §3. `noticePeriodDays` already exists, is per-policy configurable, and is already a hard block — but counts calendar days, not working days. **Recommendation**: extend the existing hard-block check to optionally count working days (skip weekends, and optionally public holidays via the already-existing `resolveHolidayDatesInRange` used elsewhere in Leave) via a new per-policy flag (`noticePeriodCountsWorkingDaysOnly` or similar) — additive to the existing field, not a redesign, and organization/leave-type-configurable rather than a hardcoded WWM-only rule. No exception/override path is added, matching the existing hard-block precedent unless the Owner explicitly wants one. [PROPOSED DESIGN DECISION]

### Decision 12 — Staff Evaluation Mapping
**Evidence**: §14. **Recommendation**: no schema/code change — build WWM's own rating scale and review template using the existing, already-sufficient Performance Foundation. Not a Phase 3H implementation item at all, purely a configuration task any HR admin can already do today. [PROPOSED DESIGN DECISION — effectively "no work needed," included for completeness]

### Decision 13 — Probation-Review Architecture
**Evidence**: §15. **Recommendation**: Option C (coordinated Performance + confirmation workflow), contingent on a narrow, disclosed change to `resolveEligibleEmployees`'s eligibility floor allowing `employmentStatus = 'probation'` into `manual`-scope assignment specifically (never `all_active`). This is the one recommendation in this document that touches existing Performance-module logic, not purely additive — flagged explicitly for that reason. [PROPOSED DESIGN DECISION]

### Decision 14 — Automatic Filing Scope
**Evidence**: §13. **Recommendation**: build zero auto-filing in the foundational workstream; prove manual/orchestrated filing first, revisit automation once the personnel-file registry exists and has real usage. [PROPOSED DESIGN DECISION]

### Decision 15 — Separation Integration Depth
**Evidence**: §16/§22. **Recommendation**: warn-only integration with Assets and file movements at separation time (no hard block), matching Assets' own existing precedent; number release remains a separate, explicit, later HR action, never automatic. [PROPOSED DESIGN DECISION]

### Decision 16 — Sensitive PIF Field Handling
**Evidence**: §2 (classification E items), §19. **Recommendation**: any newly-added sensitive field (dependants, medical information, church/ministry information if approved) is stored in a **separately-permissioned** table, never added directly to the broadly-`employee.read`-exposed `employees` row — mirroring `employee_disciplinary_records`'s own already-correct precedent. [PROPOSED DESIGN DECISION]

### Decision 17 — Records Permissions
**Evidence**: §11g. **Recommendation**: new, narrowly-scoped permissions (e.g. `personnel_file.read`, `personnel_file.manage`, `personnel_file.movement.write`) — zero new role, reusing the already-shipped `copyRoleTemplate` custom-role mechanism if an organization wants a dedicated "Records Officer" role. No new role-template row is pre-seeded by this phase unless the Owner wants one. [PROPOSED DESIGN DECISION]

### Decision 18 — Reporting Scope
**Evidence**: §25 (gap matrix), Owner's own §36 examples. **Recommendation**: build only the reports with a clear, stated operational need (current allocations, historical allocations, files by location, checked-out/overdue files, separated-employees-with-unreleased-numbers) via the existing Reporting Foundation pattern — defer probation/evaluation-due reports until the underlying workflow (Decision 13) is settled. [PROPOSED DESIGN DECISION]

### Decision 19 — Legacy Import
**Evidence**: §4a/§21. **Recommendation**: a dedicated, later workstream (proposed W119) — do not force-regenerate any identifier during import; unknown/missing legacy values remain nullable, matching the existing schema's own nullability. [PROPOSED DESIGN DECISION]

### Decision 20 — Broad `employee.read` Dependency
**Evidence**: §19. **Recommendation**: do **not** require fixing the broad `employee.read` gap before this phase proceeds — instead, store any new sensitive field behind its own narrow permission (Decision 16), which structurally avoids depending on the broad gap at all. The broad gap itself remains a separate, disclosed, pre-existing hardening item, exactly as it was left by Phase 3G. [PROPOSED DESIGN DECISION]

---

## 17. Proposed Phase

**Proposed working title**: Phase 3H — HR Operations & Personnel Records (not fixed; may be renamed on freeze).

### W114 — Foundation, Numbering & Identifier History
Scope: `employee_number_allocations` table + partial unique index; numbering-format config namespace (shared engine, independent config per number type); migrate `generateEmployeeNumber` off the racy `count()` pattern onto the new allocation table; audit events for allocation/release/reassignment; fix the disclosed `employeeNumber`-change audit gap as a natural side effect of routing changes through the new service layer instead of the generic `PATCH` spread.

### W115 — Personnel File Registry & PIF Linkage
Scope: PIF-number allocation (permanent, non-reusable per Decision 4) using the same engine from W114; personnel-file identity table linking employee ↔ staff-number-allocation-history ↔ PIF-number; the narrow sensitive-field table (Decision 16) if any PIF fields are approved for capture.

### W116 — Physical Filing, Locations & Movement
Scope: Master Data `parentId` extension (Decision 6); `personnel_file_movements`; `personnel_file_volumes`. Barcode/QR and stocktaking explicitly excluded (Decisions 9/10).

### W117 — WWM Forms / HR Workflow Reconciliation
Scope: WWM's own Performance rating scale/template (Decision 12, configuration only); the working-days notice-period extension (Decision 11); the probation-review coordination workflow and its narrow Performance eligibility-floor change (Decision 13).

### W118 — Search, Automation & HR Workspace
Scope: extend existing per-page search to cover PIF-number/staff-number/location cross-lookups; extend `employee-detail.tsx` with the new personnel-file/location/movement cards (§22); the automatic-filing matrix items approved by Decision 14, if any.

### W119 — Reporting / Legacy Import Support
Scope: the reports approved by Decision 18; a dedicated legacy-import capability (Decision 19) — the first bulk-import feature this codebase would ever have.

### W120 — Verification
Full integrated verification, mirroring every prior phase's own W-verification charter.

### W121 — Completion Report

This is a starting hypothesis, not a frozen structure — subject to revision once the Owner resolves §16's decisions, several of which (13, 16, 20) materially affect scope.

---

## 18. Expected Migration

**Likely `0041`**, but not created by this discovery document. Schema analysis (§7, §11, §15) confirms genuine, real schema work will be needed once Decisions 1, 5, 6, 7, 8, 16 are resolved — this is not a guess, it follows directly from "no table for X exists" findings verified in this document. The exact shape of `0041` depends entirely on which Owner Decisions are approved; this document does not presume the outcome.

---

**This document is a DRAFT for Owner review only. No implementation, migration, schema change, permission, or frontend change has been made as part of producing this document.**
