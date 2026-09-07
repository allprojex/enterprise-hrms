# WWM Employee Access & WS-26 Pre-C Remediation

**Date:** 2026-09-07
**Trigger:** Authenticated Production smoke test as an ordinary WWM employee (Kofi Asante, employee 439) against release `9bd8a54` / migration head `0077`.
**Scope:** Minimal, architecture-compatible corrections to what an ordinary employee can see. No completed workstream was redesigned. Tenant isolation and existing HR / Admin access are preserved.

## 1. Findings and fixes

| # | Finding (smoke test) | Severity | Fix |
|---|---|---|---|
| 1 | `/form-templates` typed directly rendered the administrative Form Templates page with a **New template** button for an employee (backend create already 403). | P2 (WS-26) | `pages/form-templates.tsx` is now wrapped in an admin gate using the same HR-capable role heuristic the sidebar uses (`useHrCapability`). Non-HR callers are redirected to `/unauthorized`; the page waits for the role lookup before deciding, so a legitimate HR caller is never bounced on first render. Backend `form_template.manage` / `.publish` remain authoritative. |
| 2 | `employee.read` (held by every role, including the employee template) returned a colleague's **full record**: date of birth, gender, marital status, nationality, national ID, passport, personal email, alternate phone, residential address, emergency contacts, separation reason. | P2 (pre-existing) | Two field-category permissions added (same shape as `employee.notes.read`): **`employee.sensitive.read`** and **`employee.documents.read`**. The employee DTO now nulls the sensitive fields and sets `sensitiveFieldsRedacted: true` unless the caller holds `employee.sensitive.read` or is viewing their **own** record (resolved server-side via `employee_user_links`). Directory identity (name, number, work email, work phone, department, position, manager, status) is unchanged. |
| 3 | `GET /employees/:id/documents` listed a colleague's personnel-document metadata under `employee.read`. | P2 (pre-existing) | After the existing `employee.read` gate, the route now requires **self** (server-resolved link) or `employee.documents.read`; any other colleague receives 403. Upload / delete stay on `employee.write`. There is still no binary download route; storage protections are untouched. |
| 4 | `GET /organizations/:id/roles` (every role's full permission key list) was readable under `organization.read`. | P3 | Gate changed to **`membership.read`**. Only the Admin console's member / invite / HR-team screens consume this catalogue; org_admin, hr_manager and hr_administrator all hold `membership.read`, so no role-management path changes. |
| 5 | ESS **My Inventory** called the item catalogue (`GET .../office-inventory/items`, gated `office_inventory.item.manage`) to resolve names → repeated 403s and `Item #112` placeholders. Opening **New Request** would have shown an empty item picker for the same reason. | P3 | Own-scoped custody / history responses now carry `itemName`, `itemCode`, `classification` (resolved server-side, batched, only for items the caller actually holds). New endpoint **`GET .../office-inventory/requestable-items`** (gated `office_inventory.request`) returns **active items' display identity only** (id, code, name, unit, classification — no cost, reorder level or status management) for the shared New Request dialog. The full catalogue route keeps `office_inventory.item.manage`. |
| 6 | Dashboard Leave section said "Real-time Leave metrics for your organisation" to an employee. | P3 | Backend already scoped the figures (org-wide only with `leave_request.manage`, otherwise own + live direct reports). `leaveMetrics.scope` (`organization` / `own_and_reports`) is now returned and the dashboard labels the section accordingly. No new data is exposed. |

Not changed (documented, pre-existing, out of this scope): `GET .../employees/:id/profile-picture` remains `employee.read` (directory photo); employee-scope custom-field values keep their existing `customFields/scopes` gates.

## 2. Permission model changes

New catalogue keys (`lib/db/src/seed/roles-permissions-definitions.ts`):

| Key | Purpose | Granted to |
|---|---|---|
| `employee.sensitive.read` | Read another employee's personal identity / contact fields | org_admin, hr_manager, hr_administrator (by composition), super_admin (blanket) |
| `employee.documents.read` | List another employee's personnel-document metadata | same |

The `employee` template is **unchanged** (it keeps `employee.read` as the directory grant and receives neither new key). Existing keys were not renamed or removed. The WS-26B form-permission mappings (8 keys incl. `form.signature.apply`) are untouched.

Guard changes: `GET /organizations/:id/roles` → `membership.read` (was `organization.read`).

## 3. Migration / seed implications

- **No schema migration.** Ledger stays at `0077`.
- **`seed:roles` must run in Production after deploy** (idempotent, additive, same procedure as the 14cb29e release) so the two new permissions exist and are mapped to org_admin / hr_manager / hr_administrator / super_admin. Until it runs, HR callers see redacted colleague fields and 403 on colleague documents — fail-closed, never fail-open.
- WWM tenant-scoped custom roles receive no new keys.

## 4. API contract changes (`lib/api-spec/openapi.yaml`, clients regenerated)

- `Employee` gains optional `sensitiveFieldsRedacted: boolean`; sensitive properties are documented as caller-dependent.
- `LeaveDashboardMetrics` gains required `scope`.
- `OfficeInventoryCustodyEntry` gains required nullable `itemName`, `itemCode`, `classification` (additive; HR custody endpoints share the shape).
- New `OfficeInventoryMyHistoryEntry` (`OfficeInventoryStockMovement` + `itemName`, `itemCode`) for `GET .../office-inventory/my/history`.
- New `GET /organizations/{id}/office-inventory/requestable-items` → `OfficeInventoryRequestableItem[]`.

## 5. Tests added / updated

Backend (`artifacts/api-server/src/test`): `employees.test.ts` (colleague redaction, HR reveal, own-record reveal), `employeeDocuments.test.ts` (HR 200, colleague 403, own 200), `admin-endpoints.test.ts` + `hrTeamDelegation.security.test.ts` (roles catalogue 403 with organization.read only), `dashboardLeaveMetrics.test.ts` (scope for HR / manager / ordinary employee), `rolesPermissionsSeed.test.ts` (new keys on HR templates only), `officeInventoryEssHttp.test.ts` (history rows named without any inventory permission, catalogue never leaks), `officeInventoryRequestsHttp.test.ts` (requestable-items: 401/403/module/identity-only subset, other-tenant items excluded).

Frontend (`artifacts/hrms/src/test`): `forms-and-templates.test.tsx` (employee redirected, loading state, HR renders), `employee-self-service.test.tsx` (names from custody payload, catalogue never called, New Request uses requestable items), `dashboard.test.tsx` (scope label).

Cross-tenant 403/404 isolation tests are unchanged and still pass.

## 6. Data hygiene (reported only — nothing deleted or altered)

WWM (organization 3) still carries disposable QA leave residue created 2026-08-24 23:48–23:51 UTC by user 431 during the Leave Workflow Reconciliation live QA:

| Record | Id | Detail |
|---|---|---|
| leave_types | 8 | "QA Annual Leave (disposable)" `QA_ANNUAL_DISPOSABLE`, status **inactive** |
| leave_policies | 9 | "QA Org-wide Policy (disposable)", 20 days, `allow_negative_balance`, status **inactive** |
| leave_requests | 10 | employee 439, 2027-03-10→11, 2.00 days, **approved** (dept head 429, HR 428), reason "…live QA (safe to remove)" |
| leave_requests | 11 | employee 439, 2027-04-10, 0.00 days, **rejected** ("Coverage gap during this period") |
| leave_requests | 12 | employee 439, 2027-05-10, 1.00 day, **rejected** ("QA scenario complete — closing disposable test request") |
| leave_balance_entries | 1 | employee 439, type 8, `usage` −2.00 linked to request 10 → the visible **−2.00 days available** |

Because type 8 and policy 9 are inactive, the balance card only appears through the residual ledger entry. **Recommendation (owner decision):** either (a) leave as historical QA evidence and hide inactive-type balances with zero credits in ESS, or (b) purge in one governed transaction — balance entry 1, requests 12, 11, 10, policy 9, type 8 (in that order) — after a pre-cleanup `pg_dump`, recording an audit event. Option (b) removes the only leave history Kofi Asante has, which is entirely synthetic. No code in this remediation touches these rows.

## 7. Responsive QA (still outstanding)

Not executed: the browser-automation extension could not resize a maximized window, framing is blocked by the site's frame policy, and zoom shortcuts are unsupported. Widths 320 / 375 / 390 / 430 / 768 / 820 / 1024 / 1180 / desktop remain to be verified with a tool that can set real viewport widths.

## 8. Production deployment plan (awaiting owner authorization)

1. Preflight: `origin/main` == release SHA, CI green, Production healthz on `9bd8a54`, ledger `0077` (78 rows), peer sessions idle.
2. Backups: none required for schema (no migration); take the standard pre-release `pg_dump -Fc` anyway (no PITR) and keep the `.9bd8a54.bak` compose copy.
3. Build image `enterprise-hrms:<sha>`, update compose, restart `api` + `worker`, verify healthz version.
4. Run `seed:roles` via the 5432 verify-full URL (never 6543); verify permission count +2 and the four template mappings.
5. Post-deploy checks as Kofi Asante (read-only): `/form-templates` → unauthorized; `/employees/436` → `sensitiveFieldsRedacted: true`; `/employees/436/documents` → 403; `/organizations/3/roles` → 403; My Inventory shows item names; dashboard Leave label "for you and your direct reports". As HR: colleague record and documents still visible; role catalogue still visible.
6. Rollback: image `enterprise-hrms:9bd8a54` + compose `.9bd8a54.bak`; the seeded permissions are additive and harmless to the previous release.
