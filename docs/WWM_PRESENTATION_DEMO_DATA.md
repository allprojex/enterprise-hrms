# WWM Presentation Demo Data — Cleanup Manifest

Status: **Local/development only.** Created for WWM Presentation Readiness (visual + demo-data workstream, following WWM Readiness Workstream 1). All records below are clearly-recognizable test/presentation identities, created entirely through the application's own supported paths (HTTP API — invitations/accept-invitation, employee creation, Office Inventory routes, asset routes, attendance clock-in), never a raw database insert. Every employee record carries `notes: "WWM Presentation Readiness — demo/test record. Safe to remove per docs/WWM_ORGANIZATION_SETUP.md cleanup manifest."` as an internal, auditable marker.

**When real WWM employees are onboarded, remove everything in this manifest and nothing else.** Do not delete WWM's organization configuration, branding, module enablement, or the custom roles listed in `docs/WWM_ORGANIZATION_SETUP.md` — those are legitimate, permanent WWM configuration, not demo data.

## Organization Structure Created

| Type | Name/Code | ID |
|---|---|---|
| Branch | Headquarters (HQ) | 5 |
| Department | Administration (ADMIN) | 65 |
| Department | Media & Communications (MEDIA) | 66 |
| Department | Facilities & Operations (FAC) | 67 |
| Position | Administrator | 16 |
| Position | HR Manager | 17 |
| Position | Communications Officer | 18 |
| Position | Deputy Communications Officer | 19 |
| Position | Media Officer | 20 |
| Position | Facilities & Inventory Officer | 21 |

## Demo People (6 — see login credentials in the final report)

| Employee | Employee # | Department | Position | Login Email |
|---|---|---|---|---|
| Kwame Owusu | EMP-0050 | Administration | Administrator | admin@wwm.test |
| Grace Mensah | EMP-0051 | Administration | HR Manager | hr@wwm.test |
| Ama Boateng | EMP-0052 | Media & Communications | Communications Officer (Dept. Head) | depthead@wwm.test |
| Efua Darko | EMP-0053 | Media & Communications | Deputy Communications Officer (Delegate) | depthead.delegate@wwm.test |
| Kofi Asante | EMP-0054 | Media & Communications | Media Officer (reports to Ama) | employee@wwm.test |
| Nana Adjei | EMP-0055 | Facilities & Operations | Facilities & Inventory Officer | inventory@wwm.test |

All six have real `users`/`organization_memberships` rows and are linked to their employee record via `employee_user_links` — the same canonical identity drives HR, Office Inventory, Assets, Attendance, and ESS for each of them.

## Custom Roles Created (WWM-scoped, org id 3 — reusable, not disposable)

These are **not** demo data — they are legitimate WWM role definitions and should be kept even after demo people are removed:

- `wwm_hr_inventory_operations` (id 181)
- `wwm_employee_inventory_self_service` (id 182)
- `wwm_inventory_store_officer` (id 183)
- `wwm_department_head` (id 184) — adds `office_inventory.delegate.manage` so a Department Head can delegate their own approval authority

## Department Head / Delegation

- Ama Boateng assigned Head of Media & Communications.
- Efua Darko assigned as Ama's delegate (delegation id 12).
- Administration and Facilities & Operations deliberately have **no Head assigned** (2 "Departments with Vacant Head" is expected, correct, and visible on the Office Inventory dashboard) — no real Head exists for those departments yet.

## Office Inventory Demo Data

- Store: "Main Store" (MAIN, id 66), responsible officer Nana Adjei.
- Items (4): A4 Paper Ream, Whiteboard Marker, Office Chair, Laptop Bag (item codes INV-00001 through INV-00004).
- Receiving: one receipt (RCV-00001) — 50 reams, 40 markers, 10 chairs, 5 laptop bags.
- Request REQ-00001 (Kofi, employee-type): 2 reams + 3 markers — approved by Ama, issued by Nana. Demonstrates the full request → approve → issue lifecycle.
- Request REQ-00002 (Kofi, employee-type): 1 laptop bag — **deliberately left pending**, to demonstrate the live approval queue (visible as "1 Pending Approvals" on the dashboard).

## Assets Demo Data

- "HP ProBook 450 Laptop" (serial WWM-LT-0001) — assigned to Kofi Asante.
- "Ergonomic Office Chair" — assigned to Nana Adjei.

## Attendance Demo Data

- Kofi Asante and Nana Adjei each have one real `clock_in` attendance event (self-service, via their own login — attendance capture cannot be entered on someone else's behalf, by design).

## Module Enablement Changes (organization-level configuration, not demo data — keep)

Enabled for WWM as part of this readiness pass, all through the real `PATCH /organizations/3/modules/:key` mechanism:

- `attendance`
- `asset_management`
- `employee_self_service`
- (`office_inventory` was already enabled by WWM Readiness Workstream 1)

`leave` remains **hidden platform-wide** (unrelated to WWM, not changed) — no leave demo data was created since the feature is not currently available to any organization. `payroll` remains hidden and not enabled for WWM.

## Organization Configuration Changes (keep)

- `general` namespace: `timezone: "Africa/Accra"` — required for Attendance's daily-summary derivation to function at all; a real, permanent WWM setting, not a demo value.

## How to Remove (when real WWM employees are onboarded)

1. Unlink and deactivate the 6 memberships (`DELETE /organizations/3/members/:membershipId`).
2. Separate the 6 employee records (`POST /organizations/3/employees/:id/separate`) or delete if the application supports hard-delete for records with no downstream history — check for referential history (Office Inventory movements, asset assignments, attendance events) before removing rows outright, since those are exactly the kind of historical-identity guarantees the platform is designed to preserve. Prefer separation over deletion.
3. Leave the departments/branch/positions in place if WWM intends to keep the same organizational structure for real staff — only remove them if the real structure differs.
4. Leave the 4 custom roles in place — reassign them to real people instead of deleting them.
5. Decide separately (a genuinely new decision, not automatic) whether to keep or reset the Office Inventory items/store/stock — real operational data may reasonably replace or extend the demo receipt rather than deleting it outright.
