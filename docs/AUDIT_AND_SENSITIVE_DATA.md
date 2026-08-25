# Audit & Sensitive-Data Security Model (WS-3)

Status: **Implemented.** This is the Audit & Sensitive-Data Security Hardening workstream from `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20 (WS-3), implementing Owner Decisions #16 (DB-level audit tamper protection), #17 (category-scoped audit-read permissions), #18 (expanded sensitive-read auditing), #19 (audit-retention configuration foundation), and #23 (sensitive-field masking). Owner Decision #31 (break-glass) was **not** implemented — WS-3 only ensures the audit model can represent it later (§7 below).

---

## 1. Single Audit System — Preserved

`audit_events`/`recordAuditEvent()` (`artifacts/api-server/src/lib/auditLog.ts`) remains the **one** audit platform. No second audit table (`security_audit_events`, `payroll_audit_events`, etc.) was created. Every addition in this workstream — category, request ID, outcome, DB-level tamper protection — extends this one table and one write function; none of the ~340 pre-existing call sites needed to change to get them.

---

## 2. Audit Event Model — What Was Added

| Field | Type | Populated by | Notes |
|---|---|---|---|
| `category` | `audit_category` enum (`hr`, `payroll`, `security`, `documents`, `assets_inventory`, `platform_configuration`) | `recordAuditEvent()`, automatically, from `resolveAuditCategory(eventType)` (`lib/auditCategories.ts`) | Every existing call site gets this for free. Unmapped/future prefixes fail closed to `security` — deliberately the most restrictive default. |
| `requestId` | `text`, nullable | `recordAuditEvent()`, automatically, from `getCurrentRequestId()` (`lib/requestContext.ts`) | Reuses pino-http's own already-generated per-request `req.id`, propagated via Node's built-in `AsyncLocalStorage` — no new ID generator, no distributed-tracing system. Null for background/non-HTTP callers (seeds, backfills). |
| `outcome` | `audit_outcome` enum (`success`, `failure`, `denied`), nullable | Only new call sites that have a real reason to (the Payroll reveal/masked-view split, personnel-file views) | Left null for the ~340 pre-existing call sites — their existence already implies success. This is **not** a "log every attempt" mechanism; ordinary permission-check 403s are still not audited (see §4). |

Migration: `0057_public_lady_bullseye.sql` (additive: two new enum types, three new nullable/defaulted columns, one new index on `(organizationId, category, occurredAt)`).

---

## 3. DB-Level Tamper Protection (Owner Decision #16)

**Mechanism: a `BEFORE UPDATE`/`BEFORE DELETE` trigger** (`0058_audit_events_tamper_protection.sql`), not a role-privilege `REVOKE`.

**Why a trigger, not `REVOKE UPDATE, DELETE ON audit_events FROM <role>`**: this platform deploys across shared hosting, dedicated VPS, and customer-owned Postgres instances (`docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`) — there is no single, portable, guaranteed-to-exist application role name to `REVOKE` from across every target, and on a target where the app connects as the table owner (common on a self-hosted VPS), `REVOKE` would not even apply. A trigger fires on the DML operation itself, independent of which role or privilege level is connected — it protects this table identically on every deployment target this platform supports.

**Verified live, against a real Postgres, not mocked** (per the frozen review's own instruction not to fake this with unit mocks): a throwaway `postgres:16-alpine` container was migrated through `0058`, then:

```
INSERT INTO audit_events (...) → succeeds
UPDATE audit_events SET event_type='hacked' → ERROR: audit_events is append-only: UPDATE is not permitted on this table
DELETE FROM audit_events → ERROR: audit_events is append-only: DELETE is not permitted on this table
SELECT ... → the row is still present, unmodified
INSERT ... (a second row) → still succeeds — the application can keep writing normally
```

**Honest limitation, disclosed, not claimed away**: a role with DDL privileges on this table (`ALTER TABLE ... DISABLE TRIGGER`, `DROP TRIGGER`) can still remove this protection. That is a fundamentally different, far more privileged act than the ordinary DML an application bug or a compromised application-level credential could issue — this platform's own request-handling code never needs or uses DDL access — so the trigger is a real, meaningful barrier against the actual threat model Owner Decision #16 targets ("ordinary application code/users cannot silently modify or delete protected audit history"), not a claim of protection against a fully compromised database-owner credential.

**Maintenance boundary (§11 of the brief)**: the trigger function's own comment documents (but does not implement or expose) a future extension point — a session-local `SET LOCAL` escape hatch a later, separate, privileged retention/legal-maintenance workstream could add. **No such bypass exists anywhere in this application today** — no route, script, or code path in WS-3 sets it. The block is unconditional as shipped.

---

## 4. Category-Scoped Audit Read Permissions (Owner Decision #17)

**Six new permission keys**, additive, alongside the pre-existing `audit.read` (kept unchanged, existing holders lose no access — it now means "read every category"):

```
audit.read.hr
audit.read.payroll
audit.read.security
audit.read.documents
audit.read.assets_inventory
audit.read.platform_configuration
```

`hr_manager` was granted `audit.read.hr` — a genuine, new capability this role had **zero** audit visibility of before this workstream (only `org_admin`/the org-scoped `super_admin` role template held the broad `audit.read`). This is deliberately narrow: `hr_manager` still cannot see Payroll, Security, or any other category's audit history.

`lib/auditAuthorization.ts`'s `resolveAllowedAuditCategories(membershipId)` returns `"all"` (if `audit.read` is held) or the specific subset of categories the membership's `audit.read.<category>` grants cover. `routes/auditEvents.ts` uses this **server-side**, before ever querying `audit_events` — the SQL query itself is filtered to the caller's allowed categories (never "fetch everything, hide some client-side," per the frozen review's own §14 instruction). A caller holding none of the seven audit permissions gets 403. An explicit `?category=` outside the caller's allowed set also gets 403; an unrecognized category value gets 400.

**Verified live** (development database): after re-running `pnpm --filter @workspace/db run seed:roles` against a migrated instance, `hr_manager` holds exactly `audit.read.hr`; `org_admin`/org-scoped `super_admin` hold the broad `audit.read` unchanged.

---

## 5. Sensitive-Read Auditing — Expanded (Owner Decision #18)

| Area | Before WS-3 | After WS-3 |
|---|---|---|
| Payroll banking (current + history) | Audited, unmasked | Still audited; masked by default, a distinct `.revealed` eventType for the full-value path (§6) |
| Payroll statutory identifiers (current + history) | Audited, unmasked | Same — masked by default, distinct `.revealed` eventType |
| Personnel File (view-by-employee, view-by-id) | **Not audited at all** | Now audited (`personnel_file.viewed`) — a specific personnel file's own details are a deliberate, higher-value sensitive read |
| Personnel Records search (list/browse) | Not audited | **Still not audited, deliberately** — a routine list/browse view, auditing it would be noise per the frozen review's own "do not audit every employee-list view" instruction |
| Payroll payment-batch export | Already audited (`payroll_payment_batch.exported`), already never stores the exported account numbers/rows in audit metadata | Unchanged — already correct, found and confirmed, not modified |

---

## 6. Sensitive-Field Masking (Owner Decision #23)

**Shared primitive**: `lib/sensitiveData.ts`'s `maskAccountNumber`/`maskIdentifier` — the exact masking behavior (`"1234567890123"` → `"*********0123"`, last 4 characters visible) already existed, proven, in `payrollPaymentBatches.ts` (used for the payment-batch CSV export). Moved to a shared module and re-exported unchanged from its original location so no existing importer needed to change; `payrollSensitiveRecords.ts` now imports the same function rather than a second implementation.

**Design decision — no new permission**: `payroll.banking.read`/`payroll.statutory_identifiers.read` remain the ONE permission gating both the masked view and the full reveal. Per the frozen review's own §23 guidance ("do not require reveal-click UX if the current page already has a safe dedicated sensitive endpoint... use evidence"), these endpoints were already narrow, non-default (no role gets them by default), and already read-audited — a second, narrower permission would add no real boundary. What was genuinely missing was masked-by-default behavior and a distinct audit trail for "saw the masked value" vs. "saw the full value," both of which this workstream adds.

**Behavior**:
- `GET .../payroll/banking`, `.../banking/history`, `.../statutory-identifiers`, `.../statutory-identifiers/history` — masked by default.
- `?reveal=true` on any of the four — returns the full value(s), and records a **distinct** `eventType` (`payroll_banking.revealed`, `payroll_banking.history_revealed`, `payroll_statutory_identifier.revealed`, `payroll_statutory_identifier.history_revealed`) instead of the masked-view `.read`/`.history_read` events, with `outcome: "success"`.
- A masked view is never mistakenly recorded as a `.revealed` event, and vice versa — verified by test.
- `null` values pass through unmasked-because-there's-nothing-to-mask (`ssnitNumber`/`tin` are individually nullable; masking is only applied to a non-null value).

---

## 7. Break-Glass Audit Preparedness (Owner Decision #31) — Not Built, Not Foreclosed

No break-glass session system was built in WS-3 (correctly out of scope). What already exists and needs no further change once WS-4 builds it: the `security` category (the `audit_category` enum's fail-closed default, §2) is the natural home for future `support_access.granted`/`.revoked`/`.action` events with zero further categorization work; the event model already carries `organizationId` (target org), `actorApplicationUserId`/`actorMembershipId` (who), `metadata` (jsonb, for reason/scope), `outcome`, and `requestId` — everything §30 of the frozen review lists as needed to represent "privileged/elevated access start, reason, target organization, actor, scope, sensitive read, mutation, end/revocation" already has a column or a documented jsonb slot. Nothing new was added specifically for this — the existing model already covers it.

---

## 8. Audit Retention — Configuration Foundation Only (Owner Decision #19)

New `organization_settings` namespace, `audit_retention`, reusing the existing Configuration Engine (`services/organizationConfig.ts`, ADR-009) — **no new table**. Fields: `standardRetentionDays` (min 90), `securityRetentionDays` (min 365), `financialRetentionDays` (min 365), `legalHold` (boolean). Minimums are enforced in the Zod schema itself, not just documented, so an ordinary `organization.update`-permission holder cannot configure retention "below zero" effective protection.

**Explicitly, deliberately not built**: any automatic purge/archival process. Nothing anywhere in this repository deletes an `audit_events` row based on this configuration — a future, separate, privileged retention workstream would read it to drive an actual process. `legalHold: true` is a flag a future purge process must honor (refuse to purge anything for that organization); there is no case-level legal-hold system.

Changes to this namespace are audited (`audit_retention_config.updated`), extending the exact same targeted exception the `numbering` namespace already had (`routes/organizationSettings.ts`) — the other, unrelated namespaces remain out of scope.

---

## 9. Data Minimization, Caching, Logging

- API DTOs were not broadened by this workstream — the banking/statutory GET responses return the same fields as before, just masked by default.
- No sensitive full value is placed in a URL path (the `reveal` flag is a query-string boolean, not the value itself; the value only ever appears in the JSON response body).
- No new frontend persistent caching was introduced for reveal endpoints — the existing generated React Query hooks are used as-is, with the same query-key-per-request-shape convention every other endpoint in this codebase already follows (a `?reveal=true` request has a different query key than the masked one, so React Query never silently serves a cached full value for what looks like a masked request or vice versa).
- No sensitive value is written into audit `metadata`, server logs, or this documentation — `recordAuditEvent()`'s calls for the reveal path record only `employeeId`/`targetId`, never the account number/SSNIT/TIN itself, matching the pre-existing "never store the exported data itself in audit metadata" convention (§19 of the frozen review, already correctly followed by the Payroll export route before this workstream).

---

## 10. Multi-Organization & Super-Admin Boundaries — Preserved

- Audit category permissions are resolved per-membership, per-organization — a caller with `audit.read.payroll` in Organization A gets no special standing in Organization B; `requireMembership` still independently resolves and verifies the target organization first, unchanged from before this workstream. Verified by test (a caller's audit rows never cross the `organizationId` boundary regardless of category permissions held).
- The platform `super_admin` bootstrap identity (`isSuperAdmin()`, WS-2's documented distinction from the unrelated, org-scoped `roles.key === "super_admin"` role template) is untouched by this workstream — it continues to bypass permission checks entirely, including the new category-scoped audit permissions, exactly as it already did for the old flat `audit.read`.

---

## 11. Schema / Migration / RLS

- **Schema**: `lib/db/src/schema/audit-events.ts` — additive only (`category`, `requestId`, `outcome`, one new index); no existing column changed or removed.
- **Migrations**: `0057_public_lady_bullseye.sql`/`.down.sql` (schema columns/enums/index), `0058_audit_events_tamper_protection.sql`/`.down.sql` (hand-authored, via `drizzle-kit generate --custom` — the trigger function/triggers aren't expressible in Drizzle's schema DSL). Both applied and verified against a real Postgres instance before being considered done.
- **RLS**: `audit_events` already had bare `ENABLE ROW LEVEL SECURITY` with no policies (migration `0036`, pre-existing, unrelated to this workstream) — confirmed unchanged by this workstream's migrations; not claimed as an audit-immutability mechanism (the trigger is the actual mechanism, per §3's own honest-limitations note — RLS-with-no-policy is a blanket posture affecting every table equally, not a targeted control this workstream relies on).

---

## 12. What Was Verified

- `resolveAuditCategory`/`maskAccountNumber`/`maskIdentifier` — pure unit tests, 13 cases, all passing.
- `GET /audit-events` category authorization — 8 integration tests: no audit permission → 403; HR-only reader sees only HR events; Payroll-only reader denied Security even by explicit filter, but can filter to Payroll; the broad legacy `audit.read` still sees everything; an unknown category → 400; tenant isolation preserved regardless of category permissions; no-membership → 403 unchanged.
- Payroll banking/statutory masking — 7 integration tests: masked by default (both current + history), full value + distinct `.revealed` audit event with `?reveal=true`, existing permission gate still enforced (masking never weakens it), a masked view is never mistakenly recorded as a reveal.
- Personnel File read-audit — extended the existing `personnelFiles.test.ts` to assert both GET-by-employee and GET-by-id record a `personnel_file.viewed` event with `category: "documents"`.
- DB-level tamper protection — live-proven against a real Postgres container (§3).
- Seed script — re-run against a migrated real Postgres instance, confirmed correct permission grants (§4).
