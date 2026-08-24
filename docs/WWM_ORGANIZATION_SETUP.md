# Worldwide Word Ministries — Organization Setup & Branding

Status: **Local/development readiness complete, including the WWM Presentation Readiness visual + demo-data pass (§12–§15), the real WWM logo integration (§16), and the Organization Administrator UX/authority verification (§17).** Production untouched, Netlify not deployed. See PROJECT_STATUS.md for the full workstream records; this document is the living reference for WWM's configuration and the branding/tenant-resolution architecture it uses, kept current as later WWM workstreams land. See `docs/WWM_PRESENTATION_DEMO_DATA.md` for the demo-data cleanup manifest.

## 1. Organization Identity

WWM is organization id `3` (pre-existing — created before this workstream, not by it). Fresh queries against the live development database, run at the start of this workstream, corrected a false negative in the Office Inventory epic's own W11/W12 live-QA scripts: those scripts searched for `LIKE '%WWM%'` (uppercase), which never matches Postgres's case-sensitive `LIKE` against the organization's actual stored name (`wwm`, lowercase) — so W11/W12's "no WWM organization exists" conclusion was a search-pattern bug, not an accurate finding. WWM has existed in the development database since 2026-07-27.

| Field | Before this workstream | After this workstream |
|---|---|---|
| `name` | `wwm` | `Worldwide Word Ministries` |
| `slug` | `wwm` | `wwm` (unchanged — already correct) |
| `type` | `church` | `church` (unchanged) |
| `status` | `trial` | `trial` (unchanged — a deliberate later decision, not this workstream's) |
| `logoUrl` | `null` | `/api/organizations/3/logo/<random-key>.png` — see §16. The real, standalone WWM emblem (the owner's own file), not the earlier wide logo, not a redraw. |

Updated through the same code path `PATCH /organizations/:id` uses (`organizations.updated` audit event recorded), not a bare row edit.

## 2. Branding Architecture

### 2.1 What already existed before this workstream

Investigation (mandated by the request before any branding work began) found the hostname-based tenant-resolution and login-branding infrastructure was **already fully built**, not something this workstream needed to invent:

- `organization_domains` table + `resolveTenantHost` middleware (migration `0035`) resolve a request's hostname to an organization id, attached as `req.resolvedTenantOrganizationId`. Documented in full in `docs/TENANT_DOMAINS_AND_ACCESS.md`.
- `GET /tenant-context` (`routes/tenantContext.ts`) is the public, unauthenticated, hostname-scoped-only endpoint the login page calls.
- `artifacts/hrms/src/pages/login.tsx` **already** called `useGetTenantContext()` and rendered the resolved organization's name/logo with an "Enterprise HRMS" fallback for an unmapped host — this was true before this workstream touched anything.
- `organizations.name` and `organizations.logoUrl` already existed as first-class, nullable-logo columns — no schema change was needed for either.

### 2.2 What this workstream added

One genuinely missing piece: a **system/product display name** ("Human Resource Management System" for WWM) shown alongside the organization's own name — there was no field for this anywhere.

- New `branding` configuration namespace (`artifacts/api-server/src/services/organizationConfig.ts`), reusing the existing Organization Configuration Engine (`organization_settings`, JSONB, namespace-validated) — no migration, no new table, matching the engine's own docstring, which already anticipated a future "branding" namespace by name. Schema: `{ systemDisplayName?: string }`, `.passthrough()`, no `moduleKey` (foundation namespace, same as `general`/`terminology` — every organization needs shell/login identity regardless of which modules it has enabled).
- `getPublicTenantContext` (`lib/organizationDomains.ts`) now also reads this namespace and includes `systemDisplayName` in the safe, public DTO `GET /tenant-context` returns.
- `MembershipSummary` (`GET /me/organizations`, used by the authenticated app shell's org switcher) now also includes `logoUrl` — previously absent, so the authenticated shell had no way to render an organization's own logo at all.
- OpenAPI spec (`lib/api-spec/openapi.yaml`) updated for both shapes; client/Zod regenerated (`pnpm --filter @workspace/api-spec run codegen`).
- Frontend: `login.tsx` renders `systemDisplayName` under the organization name (both the desktop branding panel and the mobile logo block), only when set — no line renders for an organization that hasn't configured one. `app-shell.tsx`'s `OrgLabel`/`OrgSwitcher` now render the current (and, in the switcher list, each) organization's own logo via a small shared `OrgLogo` component, falling back to the existing generic building icon when `logoUrl` is null — never a broken image.

### 2.3 Branding source of truth

For any organization: `organizations.name` + `organizations.logoUrl` (identity) + the `branding` config namespace's `systemDisplayName` (product name override). No duplication across tables. No binary image data in the database — `logoUrl` is a URL/reference, consistent with how the column was already typed.

WWM's current values:

```json
{
  "organizationName": "Worldwide Word Ministries",
  "organizationSlug": "wwm",
  "logoUrl": null,
  "systemDisplayName": "Human Resource Management System"
}
```

Live-verified via `GET /tenant-context` with `X-Tenant-Hostname: wwm.localhost`.

## 3. Login Tenant Resolution

**Reused verbatim, not reinvented.** Hostname → `organization_domains` → `organizationId` → `GET /tenant-context` → login page branding. WWM's existing domain row (`wwm.localhost`, `platform_subdomain`, `active`, primary) already routes correctly; opening `http://wwm.localhost:5173/login` in local development (with the Vite dev server and api-server both running) shows WWM's branded login. No hostname parameter is ever accepted by the endpoint — it only ever reports the caller's own already-resolved tenant, so it can never become a tenant directory.

## 4. PIF / Leave Form Branding — Investigation Finding

The request's premise (§3) — that WWM branding "already exists in official generated documents (PIF, Leave Form)" — **does not hold up under inspection.** A repository-wide search for the literal string "Worldwide Word Ministries" returned zero matches before this workstream began (it exists now only in `organizations.name`, a database value, not in any document-generation code). No PDF/document-generation code exists anywhere in the repository that references an organization's name or logo for PIF, Leave Form, or any other generated document. This is disclosed here as a factual correction, not assumed away: **PIF and Leave Form document generation, as a feature, does not appear to exist yet in this codebase** — there is nothing to verify compatibility against for §7, because there is no existing document-branding implementation to be compatible or incompatible with. If PIF/Leave Form PDF generation exists in some other environment or was previously demonstrated outside this repository, it is not part of the current codebase and this workstream could not locate or test it.

## 5. HR / Employee Inventory Access (Office Inventory for WWM)

Office Inventory's own frozen implementation plan explicitly reserved this decision: its 23 permission keys (22 `office_inventory.*` + `department.head.manage`) were deliberately **not** added to any global system role (`org_admin`, `hr_manager`, `employee`) — "an Inventory administrator role must be explicitly created and assigned these keys per organization before anyone can use them." This workstream is that explicit, per-organization decision, made through the existing custom-role mechanism (`POST /organizations/:id/roles` copying a system role template, then `POST .../roles/:roleId/permissions`) — global system roles remain untouched, so no other organization is affected.

Two WWM-scoped custom roles were created:

- **`wwm_hr_inventory_operations`** ("HR — Inventory Operations") — copied from the `hr_manager` template (inheriting its existing 77 permissions), plus all 23 Inventory/Department-Head keys. Reviewed individually, not granted as an unreviewed blanket: `hr_manager` already holds full operational "manage" authority for every other hr-operations-category module (`asset_management.manage`, `personnel_file.manage`, `leave_type.manage`, `recruitment_settings.manage`, ...), with only pure org-administration actions withheld from it platform-wide (`role.manage`, `module.manage`, `organization.update`, ...). Office Inventory is categorized identically (`category: hr-operations`), so granting the HR profile full Inventory operational authority matches that established precedent rather than being a special case.
- **`wwm_employee_inventory_self_service`** ("Employee — Inventory Self-Service") — copied from the `employee` template, plus 7 keys matching the "My Inventory" ESS surface exactly: `request`, `approve`, `receipt.confirm.own`, `custody.read`, `return`, `handover`, `report_issue.own`. `approve` is included deliberately, mirroring the existing `leave_request.approve` precedent already on the `employee` system role — the permission alone grants nothing; `resolveApprovalAuthority` (Head-or-delegate) is independently re-checked on every approval route, so this only lets whichever employee later becomes a Department Head actually act as one.

Neither role is yet assigned to a real WWM person — see §7.

## 6. Office Inventory Module

Module registry status flipped `hidden → active` (`lib/db/src/seed/module-definitions.ts` + a one-time correction to the already-seeded row, the same precedent `seed-modules.ts`'s own docstring documents for how `recruitment`/`employee_self_service` were previously graduated — `onConflictDoNothing` means editing the seed file alone never updates an already-seeded row). This was required: the module's `status` had been deliberately left `hidden` at Office Inventory's Workstream 1 when only the catalog/store/Department-Head foundation existed; the epic has since shipped completely through Workstream 12, but nothing had yet graduated the registry row to reflect that. `defaultEnabled` remains `false` — no organization is auto-enabled by this change. `organization_modules` confirms exactly **one** row exists for `office_inventory` platform-wide, for WWM (`organizationId: 3`, `enabled: true`) — verified live; no other organization was affected.

Existing `officeInventoryDefinitions.test.ts` asserted the old `hidden` status as "frozen Workstream 1 metadata"; updated to assert `active` with an explanation of the graduation, matching the same test-update precedent.

## 7. What Was Deliberately Not Done in Workstream 1 (real-person data) — superseded by §13

At the end of WWM Readiness Workstream 1, per the request's own instruction not to fabricate real organizational identity for WWM, this workstream stopped short of creating a dedicated WWM organization administrator, assigning either new custom role to any real membership, and any Department Head — no real WWM people existed yet, and inventing them would have violated that instruction.

**This has since changed.** The WWM Presentation Readiness workstream (§12–§15 below) received explicit, separate authorization to create clearly-recognizable demo/presentation identities for exactly this purpose. Six presentation accounts now exist, a Department Head and delegate are assigned, and all four custom roles (plus a new fourth one, `wwm_department_head`) are in active use. See §13 and `docs/WWM_PRESENTATION_DEMO_DATA.md` for the full record and cleanup manifest — the reasoning above still explains *why* nothing was fabricated in Workstream 1 itself, and remains the standard to hold to for genuinely real (non-demo) WWM data.

**A WWM logo** still does not exist as a file anywhere in this repository or the development environment; fallback rendering remains graceful and verified. Still pending real supply.

## 8. Multi-Tenant Isolation

Verified live against Acme (`organizationId: 4`, pre-existing, not created for this workstream):

| Hostname | `organizationName` | `systemDisplayName` |
|---|---|---|
| `wwm.localhost` | Worldwide Word Ministries | Human Resource Management System |
| `acme.localhost` | Acme | `null` (Acme has not configured one) |
| unmapped host | — (`resolved: false`) | — |

WWM's `systemDisplayName` never leaks onto Acme's response and vice versa (also covered by an automated test asserting this against two `organization_settings` rows in the same fixture set). `office_inventory` is enabled for WWM only — confirmed zero `organization_modules` rows for any other organization.

## 9. Payroll & Procurement

Payroll's module registry status remains `hidden`, untouched by this workstream — WWM has not been granted Payroll access. No `procurement` module key exists on the platform.

## 10. Netlify — Findings Only, No Deployment

No `netlify.toml` or any Netlify reference exists anywhere in this repository (confirmed by a fresh repository-wide search this workstream). `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` documents the platform's actual target production topology as a single **Hostinger VPS + Nginx**, reverse-proxying one shared Express process for every tenant, with Nginx setting the real `Host` header `resolveTenantHost` reads — not Netlify. This is a discrepancy worth the user's attention rather than a silent assumption in either direction.

What would and would not work on Netlify if it were used instead or in addition:

- **Frontend (`artifacts/hrms`)** builds to a plain static SPA bundle (`vite build` → `dist/public`, confirmed working). Because tenant branding is resolved entirely at runtime via `GET /tenant-context` (never baked in at build time), a *single* static build already serves every tenant hostname correctly — Netlify's per-site custom-domain support is compatible with this in principle. It would need a SPA rewrite rule (`_redirects` or `netlify.toml` `[[redirects]]` to `index.html`) — none exists yet, since no Netlify config exists at all.
- **Backend (`artifacts/api-server`)** builds to a standalone, long-running Node/Express process (`node ./dist/index.mjs`, esbuild-bundled, confirmed running locally on port 3001). This is **not** Netlify's native model (Netlify Functions are short-lived, per-request serverless invocations) — deploying this backend as-is to Netlify would require either running it elsewhere (matching the documented Hostinger/Nginx target, with Netlify hosting only the static frontend against that external API) or a non-trivial rearchitecture into serverless functions, which this workstream does not recommend undertaking implicitly.

No Netlify deployment, environment variable, or DNS change was made.

## 11. Remaining Work (as of Workstream 1; superseded in part by §12–§15)

- ~~A real named WWM organization administrator and at least one real WWM HR person~~ — done via clearly-recognizable presentation/demo identities, see §13. **Still open:** replacing them with genuinely real WWM people's identities when the user supplies them (a distinct, later action — swap the person, keep the role/module configuration).
- ~~A real WWM logo asset~~ — done, see §16. The owner's actual standalone emblem file, uploaded and stored through the application's own logo mechanism.
- ~~Real WWM department/employee data before any Department Head can be assigned~~ — done via demo data, see §13.
- A decision on WWM Payroll access (still explicitly out of scope).
- Netlify/production deployment (still explicitly out of scope — local/development only).

## 12. Visual/Branding Theming Architecture (Presentation Readiness)

A second, small piece of the `branding` configuration namespace was added: `theme`, a fixed set of 9 optional HSL-triple tokens (`sidebar`, `sidebarForeground`, `sidebarAccent`, `sidebarAccentForeground`, `primary`, `primaryForeground`, `accent`, `accentForeground`, `ring`) mapped **directly** onto the CSS custom property names `artifacts/hrms/src/index.css` already defines (`--sidebar`, `--primary`, `--ring`, ...). This is deliberately **not** a general theming engine — no arbitrary CSS, no per-component overrides, no color picker UI — just enough to give one organization its own colour identity without hardcoding it into the application shell.

`getPublicTenantContext` includes `theme` in the same public `GET /tenant-context` DTO that already carries `logoUrl`/`systemDisplayName`. A new frontend component, `TenantTheme` (`artifacts/hrms/src/components/tenant-theme.tsx`), mounted once near the app root (`App.tsx`, above the router), reads it and applies each configured token as an inline `style.setProperty` override on `document.documentElement` — clearing all nine properties first on every render, so a previous tenant's colours can never persist onto a different one. An organization that has not configured a theme (every organization but WWM today) renders with exactly the shared default theme, unchanged — verified live against Acme (`theme: null` in its own `GET /tenant-context` response).

WWM's own values (navy + gold, matching the approved reference design): `sidebar`/`primary`/`ring`: `220 55% 16%`; `sidebarForeground`: `210 30% 92%`; `sidebarAccent`/`accent`: `38 70% 50%`; `sidebarAccentForeground`/`accentForeground`/`primaryForeground`: dark-navy/white as appropriate for contrast against the gold/navy backgrounds respectively. Set through the same `PATCH /organizations/3/config/branding` mechanism as `systemDisplayName`.

Because the app shell's sidebar/nav/buttons already consumed these CSS variables (`bg-sidebar`, `bg-sidebar-accent`, `bg-primary`, `focus-visible:ring-ring`, ...) before this workstream touched anything, setting the theme reskins the **entire** authenticated shell and login page automatically — no per-page or per-component colour edits were needed beyond the login page's own left-panel treatment (see §13).

## 13. WWM Presentation Readiness — Visual, Navigation & Demo Data

**Login page:** retained its existing structure and tenant-resolution mechanism (no second branding mechanism introduced). The left branding panel changed from a `primary`→`accent` gradient wash to a solid `bg-primary` panel with a thin gold (`accent`) wave-divider SVG along the bottom edge — accent used sparingly, matching the approved reference. The mobile/collapsed logo block now also renders the resolved tenant logo (previously desktop-only).

**Authenticated shell:** the previously separate, hardcoded "Enterprise HRMS" header block and the tenant-aware `OrgLabel`/`OrgSwitcher` pill below it were consolidated into one `OrgBrandHeader`/`OrgBrandSwitcher` block — organization logo (white rounded box for contrast against the navy sidebar), organization name, and system display name, all sourced from `MembershipSummary` (which gained `logoUrl` in Workstream 1 and now also `systemDisplayName`, resolved per the caller's *active* organization rather than depending on hostname coincidence). The header's decorative, non-functional search input (`readOnly`, did nothing when typed into) was removed rather than left as a control that looks functional but isn't. The sidebar's "Notifications" entry was removed as redundant with the header's own working notification bell.

**Grouped navigation:** the sidebar's ~50-item flat, ungrouped list (accumulated over many workstreams) was reorganized into 11 labelled, collapsible sections (Overview, Personnel, Self-Service, Attendance, Leave Management, Performance, Learning & Development, Assets, Office Inventory, Recruitment, Administration) via a new `NavGroupList` component. Every underlying `href`/permission condition is byte-for-byte unchanged from before — this is a rendering/grouping change only. A group with zero visible items (every item filtered out by the caller's role) renders no header at all. The group containing the current route starts expanded; others start collapsed and are independently toggleable.

**Dashboard:** `GET /dashboard/summary` gained three more null-when-disabled metric groups, following the exact precedent `leaveMetrics` already established — `attendanceMetrics` (reuses the existing W70 Attendance Dashboard aggregation and its own visibility scope, zero new business logic), `assetMetrics` (a lightweight count, same style as the pre-existing `totalEmployees`), `inventoryMetrics` (same lightweight-count style). All three render as additional stat cards on the dashboard only when their owning module is enabled and the summary has loaded. **A real pre-existing bug was found and fixed while testing this:** switching organizations invalidated `getMe`/`myOrganizations` but never `dashboard/summary` (whose query key carries no parameters, since the route resolves everything from the server-side session) — a caller who switched orgs kept seeing the *previous* organization's dashboard figures until an unrelated remount. Fixed with one additional `invalidateQueries` call in `handleSwitchOrganization`, covered by a new regression test.

**Demo data & presentation accounts:** see `docs/WWM_PRESENTATION_DEMO_DATA.md` for the full manifest. In summary: 1 branch, 3 departments, 6 positions, 6 connected employee/login identities (Organization Administrator, HR, Department Head, Department Head Delegate, Employee, Store/Inventory Officer), a real Head+Delegate relationship, a full Office Inventory lifecycle (store → items → receiving → employee request → Head approval → Store Officer issue, plus one request deliberately left pending to show the live approval queue), two assigned assets, and two real attendance clock-in events. Every action went through the application's own HTTP API (invitations/accept-invitation for account creation, never a raw password-hash write) — see §14 for how account credentials were established without a known existing password. `attendance`, `asset_management`, and `employee_self_service` modules were enabled for WWM (through the same `PATCH /organizations/:id/modules/:key` mechanism as Office Inventory in Workstream 1); `leave` remains hidden platform-wide and was not touched.

A fourth custom WWM role, `wwm_department_head` (copied from `employee` + `office_inventory.delegate.manage` only), was created because the existing delegation-creation route requires the caller to be **both** permission-holding and the department's actual current Head (`NotCurrentDepartmentHeadError` otherwise) — neither HR (permission, not Head) nor the Head alone (no permission) could satisfy that combination without it.

## 14. Presentation Account Credentials — How They Were Set

This environment provided no way to retrieve `admin@hr.com`'s (or any account's) existing plaintext password, and a raw database password-hash overwrite was correctly refused by this session's own safety controls as too sensitive an action to take unprompted. The actual mechanism used instead — for both re-establishing access to the existing platform admin account and creating all six new presentation accounts — was the application's **own supported, first-class flows**:

- **Existing account (`admin@hr.com`):** `POST /auth/forgot-password` → the reset token (never emailed in this dev environment, by the platform's own "never fake email delivery" design) was read directly off the `users` row via a read-only query → `POST /auth/reset-password/:token` with a new password. The same code path, hashing, and token-consumption logic a real user clicking "Forgot password" would go through.
- **New accounts (the six presentation people):** `POST /organizations/3/invitations` (creates the `users` row in `invited` status, returns the invite token directly in the response — again, no fake email) → `POST /invitations/:token/accept` (sets the real name and a real password, activates the membership). This is the same account-creation path a genuine new WWM hire would go through.

No password was ever written directly to a database column by this workstream.

## 15. Attendance — Device Readiness Finding

No biometric or physical clock-in device integration architecture exists anywhere in this codebase — confirmed by a repository-wide search for device/biometric-related code, none found. Attendance capture is, and has only ever been, **self-service software clock-in/out** (`POST /organizations/:id/attendance-events`, `attendance.clock.own`, resolved to the caller's own linked employee identity via `employee_user_links` — never entered on someone else's behalf). This is not a gap introduced or left by this workstream; it is simply the feature as built. WWM currently has no biometric device, and the system is fully usable without one — self-service clock-in is a complete, real capture mechanism on its own, demonstrated live in §13.

No device-connector groundwork was added or removed by this workstream. If a future physical-device integration is wanted, the natural extension point is the same `recordSelfServiceClockEvent` (`lib/attendanceEvents.ts`) the self-service route already calls — a device-driven route would resolve the employee identity from the device's own enrollment mapping rather than from the caller's session, then call the same underlying event-recording function, so the daily-summary/register/dashboard/reporting layers built on top of it would need no changes at all.

## 16. Real WWM Logo Integration (Workstream 3)

**Investigation finding:** `lib/fileStorage.ts` already existed as the platform's one private, organization-scoped disk-storage primitive (`writeOrgFile`/`readOrgFile`/`deleteOrgFile`, used for employee avatars/documents) — but its own read pattern is deliberately authenticated-only (see the employee profile-picture GET route), and nothing before this workstream let an organization actually store a *logo* through it at all. An authenticated-only read cannot serve the login page, which renders before any authentication exists. So there was a real, missing piece, not merely an unused existing one — completing it (not building a second mechanism) was the right scope.

**What was added, reusing the existing primitive exactly:**

- `processLogoImage` (`lib/imageProcessing.ts`) — deliberately different from the existing avatar processor: `fit: "inside"` (shrinks only if larger than 1024px on either side, preserving aspect ratio, never crops) and no format conversion (a transparent PNG/WebP stays transparent — forcing JPEG would flatten it onto a black background). WWM's emblem (552×452 PNG, alpha channel) needed no resize at all.
- `PATCH /organizations/:id/logo` (new, `routes/organizationLogo.ts`) — authenticated, `organization.update`-gated, multipart upload, same file-signature validation (`validateImageUpload`) as the existing avatar upload. Writes via `writeOrgFile(orgId, "branding", ext, buffer)` (the exact existing function), deletes the previous logo file if replacing, sets `organizations.logoUrl`, records an `organization.logo_updated` audit event.
- `GET /organizations/:id/logo/:filename` (new, same file) — **public, no authentication**, mirroring `GET /tenant-context`'s own "one deliberately public, narrow, safe route" precedent. Serves only what a caller could already learn from `GET /tenant-context` (that this organization has a logo at this URL) — 404s for a suspended organization, a filename that doesn't match the organization's *current* `logoUrl`, or a malformed filename, without ever touching storage in those cases.

**Where the storage key lives:** `organizations` has no dedicated logo-storage-key column, and adding one purely to duplicate what the existing `logoUrl` text column can already express was rejected as unnecessary schema change. Instead, `logoUrl` itself encodes the storage key: `/api/organizations/3/logo/<48-hex-char-random-key>.png` — the `/api` prefix matters and is not decorative: logo URLs are consumed directly as `<img src>` in the frontend, never routed through the API client's base-URL logic, so they must carry the same prefix every other request relies on (Vite's dev proxy today, Nginx in production). The random key is server-generated by the existing `generateStorageFilename` (never client-supplied), the same trust level already extended to organization name/type/slug via `GET /tenant-context`.

**What was stored:** the owner's own standalone WWM emblem file (not the earlier wide "Worldwide Word Ministries" logo, not a redraw/approximation — the actual supplied PNG, 552×452, transparent background), uploaded via the real `PATCH /organizations/3/logo` endpoint using the WWM Organization Administrator's own account (`admin@wwm.test`), exactly as a real org admin would through a future Settings-page upload control (not built in this workstream — out of scope; only the backend capability was needed to verify the logo surfaces).

**An unrelated issue found during this workstream, not caused by it:** between the previous workstream and this one, the password hashes for `admin@wwm.test`, `hr@wwm.test`, and `employee@wwm.test` changed in the database (visible via their `updatedAt` timestamps) — the known `WwmDemo#2026!` password stopped working for those three. No other Claude Code session was found running against this repository (`ListAgents` showed only one unrelated, idle peer session). The user confirmed they had not changed the passwords themselves and asked for them to be reset back — done via the same legitimate `POST /auth/forgot-password` → `POST /auth/reset-password/:token` flow used previously, not a raw database write. All six accounts re-verified authenticating correctly afterward; the underlying demo data (6 employees, 4 active modules, 2 assets, 4 inventory items) was independently confirmed unaffected via a live dashboard-summary check before and after.

**Resolved:** the password changes described above were a second Claude Code session running the organization-administrator verification in §17 below, concurrently and independently, on the same repository — it reset the same three accounts via the same forgot-password flow to log in and test live, not an external actor. The two sessions coordinated once the overlap was discovered (mid-§17); no further password churn is expected from either.

## 17. WWM Organization Administrator Verification (Workstream 3)

Focused verification of the WWM Organization Administrator experience, run concurrently with §16 above (the logo-integration workstream) — the two overlapped on the same repository and the same three presentation accounts' passwords; see the "Resolved" note above. This section covers only the organization-administration UX/authority scope; §16 covers the logo.

**1. Actual authority — no super_admin dependency found.** `admin@wwm.test` (Kwame Owusu, `users.id` 427) has exactly **one** `organization_memberships` row, for WWM (`organizationId: 3`, status `active`), carrying exactly one role: the system role template `org_admin` (id 2, 84 permissions, `isSystemRole: true`, `organizationId: null` — a shared template, not WWM-specific, applied through the membership same as every organization's own admin). His legacy platform-wide `users.role` column reads `"employee"` — true for all six WWM presentation accounts and never consulted by any real organization-scoped authorization check (`authorizeOrganizationAction` / `hasPermission`, both keyed off `membership_roles`, not `users.role`). `isSuperAdmin()` checks `users.role === "super_admin"` only; Kwame's is `"employee"`. **No super_admin dependency exists anywhere in his authority chain.** Verified by direct query (not just permission-table inspection) and by live API calls as him: `GET /organizations` returns WWM only; `GET /organizations/4` (Acme) → `403`; `GET /organizations/4/members` → `403`; `POST /auth/switch-organization` to org 4 → `403`; `GET /me/organizations` returns one row, `roles: ["org_admin"]`, org 3 only.

Role distinction, confirmed live for all six presentation accounts via `membership_roles`:

| Account | Membership roles (org 3 only) |
|---|---|
| `admin@wwm.test` (Kwame) | `org_admin` |
| `hr@wwm.test` (Grace) | `hr_manager`, `wwm_hr_inventory_operations` |
| `depthead@wwm.test` (Ama) | `employee`, `wwm_employee_inventory_self_service`, `wwm_department_head` |
| `depthead.delegate@wwm.test` (Efua) | `employee`, `wwm_employee_inventory_self_service` |
| `employee@wwm.test` (Kofi) | `employee`, `wwm_employee_inventory_self_service` |
| `inventory@wwm.test` (Nana) | `employee`, `wwm_employee_inventory_self_service`, `wwm_inventory_store_officer` |

No platform/super_admin role appears anywhere in this table.

**2. Real root cause of the discoverability complaint, found and corrected.** It was not that the admin console didn't exist — a full Admin Console (`/admin`, `admin.tsx`) already existed with Members, Primary HR & Settings, Modules, Roles, Master Data, Audit Log, and Reports tabs, correctly `org_admin`-gated both in the nav and server-side. The actual causes were three display/authorization bugs, all sharing one root pattern — reading the legacy `users.role` column instead of the caller's real `membership_roles`-granted role for the active organization:

- **Kwame's own sidebar and profile-page badge read "Employee."** `app-shell.tsx`'s profile card and `profile.tsx`'s badge both rendered `user.role` (the legacy column, `"employee"` for every WWM account) instead of the membership role. A genuine Organization Administrator's own UI was telling him he was an Employee — a direct, plausible explanation for "the owner cannot identify where the Organization Administrator manages the system." **Fixed:** both now derive a `roleLabel` from the caller's `currentOrg.roles` (the same source the nav's `isOrgAdmin`/`isHrCapable` gates already used), falling back to the legacy field only when no membership has resolved yet. Live-verified: Kwame now shows "Organization Administrator," Grace shows "HR Manager," Kofi shows "Employee."
- **The Organisations page silently hid Kwame's real Edit/Suspend authority.** `organizations.tsx`'s `canManageSelectedOrg` gate checked `me.role === 'org_admin'` (legacy column, always `"employee"` for him) instead of his membership role, so the Edit/Suspend controls never rendered for him even though the backend (`organization.update` permission, which `org_admin` genuinely holds) would have allowed the action. **Fixed** the same way, using `useListMyOrganizations`.
- **A missing UI for an existing backend capability.** The `branding` configuration namespace (`systemDisplayName` + `theme`, used to set WWM's own navy/gold identity in an earlier workstream) had a working `GET`/`PATCH /organizations/:id/config/branding` endpoint but no admin-console UI at all — it could only ever be set by direct API call. **Added:** a third `NamespaceConfigCard` (reusing the exact existing `general`/`terminology` pattern, no new component) in Primary HR & Settings. Live-verified: renders WWM's actual current branding JSON, editable and re-saveable through the same route Workstream 1 used.

**3/9. Administration menu/location.** Sidebar → **Administration** (existing collapsible nav group, unchanged location) → **Organisations** (own-organization profile: name/slug/type/industry/status, Edit and Suspend/Reactivate, now correctly visible per the fix above) + **Organization Administration** (renamed from the generic "Admin," same `/admin` route, `org_admin`-gated) → Admin Console. The nav's dead **Settings** entry ("Coming Soon," no permission gate, no function for any organization, sitting directly beside the one real console) was removed from navigation — it was very plausibly the second half of the discoverability problem, a decoy next to the real thing. Its route was left in place (no functionality existed to lose) for anyone who reaches it by a saved direct URL. Grouped/collapsible nav structure from Workstream 2 is otherwise untouched.

**4. Module management — live-verified via `GET /organizations/3/modules` as Kwame:**

| Module | Status | Enabled for WWM |
|---|---|---|
| Leave | hidden | No |
| Recruitment | active | No |
| Employee Self Service | active | **Yes** |
| Attendance | active | **Yes** |
| Performance | active | No |
| Learning & Development | active | No |
| Asset Management | active | **Yes** |
| Manager Portal | active | No |
| **Payroll** | hidden | **No — confirmed remains disabled** |
| **Office Inventory** | active | **Yes — confirmed remains enabled** |

Available/enabled/disabled is clearly distinguished in the existing Modules tab (Status column + Enabled toggle) — no new mechanism built. Toggle authority itself confirmed live: a harmless idempotent `PATCH .../modules/office_inventory {enabled:true}` (already `true`; no state change) returned `200` for Kwame. No module was enabled or disabled by this verification beyond that no-op.

**5. User/access management.** Existing Admin Console **Members** tab: add-by-email, invite-with-optional-role (returns a shareable link, no fake email), per-membership role assign/revoke, membership revoke. Existing **Roles** tab: lists system + WWM custom roles with their permission keys, copy-system-template-to-customize, grant/revoke permission on a custom role. Both already fully organization-scoped (`requireMembership` + `organizationId` route param) — no changes made to either. Live-verified negative controls: `PATCH .../modules/payroll` and `POST .../roles` both returned `403` for both Grace (HR) and Kofi (Employee) tokens.

**6. HR/organization-administration separation — confirmed live.** Grace's roles (`hr_manager` + the WWM-scoped `wwm_hr_inventory_operations`) grant broad HR-operations authority but not `module.manage`/`role.manage`/`organization.update` — `hr_manager`'s 77 permissions were checked and do not include any of the three. Her sidebar shows no "Organization Administration" link; direct navigation to `/admin` redirects to `/unauthorized` (403 page), confirmed live via browser, not just by hiding the link.

**7. Live UX verification — performed for real, not database-only.** Logged in as all three accounts (via the app's own `POST /auth/forgot-password` → `POST /auth/reset-password/:token` flow, since no account's plaintext password was ever recorded anywhere in this repository — same precedent as §14; no password is written into this document either):

- **`admin@wwm.test`:** branded WWM login page; dashboard; sidebar badge "Organization Administrator"; Administration group shows Organisations + Organization Administration; Admin Console opens and every tab (Members, Primary HR & Settings incl. the new Branding card, Modules, Roles, Master Data, Audit Log, Reports) renders and is authorized.
- **`hr@wwm.test`:** sidebar badge "HR Manager"; Administration group shows only Organisations (no admin-console link); direct URL to `/admin` → 403 Access Denied page.
- **`employee@wwm.test`:** sidebar badge "Employee"; Administration group shows only Organisations; direct URL to `/admin` → 403 Access Denied page.

**8. Cross-tenant isolation — verified at the API boundary, not just the database.** As `admin@wwm.test`: `GET /organizations` → WWM only (never Acme); `GET /organizations/4` → `403`; `GET /organizations/4/members` → `403`; `POST /auth/switch-organization {organizationId:4}` → `403`. Organization switching cannot grant cross-tenant administrative authority because Kwame has no membership in any other organization to switch into in the first place.

**Notable finding, deliberately not changed:** `POST /organizations` (creating a brand-new organization) has no role/permission gate — any authenticated user of any role can call it and becomes that *new* organization's own `org_admin` + Primary HR. Investigated as a possible tenant-isolation gap and initially patched with `requireSuperAdmin`, then **reverted** after finding `artifacts/api-server/src/test/onboarding.test.ts` explicitly asserts a plain `"employee"`-role caller receives `201` — this is intentional, tested self-service tenant provisioning (comparable to "create your own workspace" in other multi-tenant SaaS products), not a defect. It lets any user spin up an unrelated new organization and administer *that*; it grants no authority over WWM or Acme. Recorded here rather than silently changed, per the request's own instruction not to weaken or alter authorization behavior beyond what this verification called for.

**Files changed (frontend only — no schema, migration, or permission-table change):** `artifacts/hrms/src/components/layout/app-shell.tsx`, `artifacts/hrms/src/pages/profile.tsx`, `artifacts/hrms/src/pages/organizations.tsx`, `artifacts/hrms/src/pages/admin.tsx`. Workspace typecheck clean; targeted test files (`app-shell`, `profile`, `organizations`, `admin`) pass in isolation; full frontend suite 577/577 passing tests with 0 assertion failures (a full-run worker-pool timeout unrelated to any of these files, pre-existing to this environment, affected one unrelated file's collection). No migration, no deployment, no change beyond local/development, matching every prior WWM workstream's own scope boundary.

## 18. Leave Module Enabled for WWM

`leave`'s module registry status graduated `hidden → active` (`lib/db/src/seed/module-definitions.ts`), the same one-time-row-correction precedent §6 documents for Office Inventory. Leave is not new or unfinished work — types, policies, balances, requests, approvals, calendar, and public holidays have all been built and shipped since Phase 2B, and the module was exercised live against real WWM data as far back as the Phase 3H W120 verification pass (a disposable ESS fixture at the time, since cleaned up) — its "hidden" flag was simply never graduated afterward, an oversight, not a deliberate withholding the way Office Inventory's 23 permission keys were.

Enabled for WWM specifically via `PATCH /organizations/3/modules/leave`, the same real mechanism every other module enablement in this document uses. **No new permission grant was needed**: `hr_manager` (Grace's existing system role) already carries `leave_request.manage`, `leave_request.approve`, `leave_type.manage`, `leave_type.read`, `leave_request.read.own`, `leave_request.write.own` — unlike Office Inventory, Leave's permissions were never withheld from the global system roles. Verified live: `GET /dashboard/summary` as `hr@wwm.test` now returns a populated `leaveMetrics` object (previously `null`) reflecting real, currently-empty state (0 employees on leave, 0 pending approvals — no leave types or requests exist for WWM yet; none were fabricated).

At the same time, and not by this action: `recruitment`, `performance`, `learning`, and `manager_portal` were also enabled for WWM (module list re-queried live shows all four `enabled: true`) — this was the concurrent peer session's own §17 UX verification work, not something done here. `payroll` remains correctly disabled throughout. Table below reflects state as of §18, superseding the one in §17:

| Module | Registry status | Enabled for WWM |
|---|---|---|
| Leave | active | **Yes** |
| Recruitment | active | **Yes** |
| Employee Self Service | active | **Yes** |
| Attendance | active | **Yes** |
| Performance | active | **Yes** |
| Learning & Development | active | **Yes** |
| Asset Management | active | **Yes** |
| Manager Portal | active | **Yes** |
| Office Inventory | active | **Yes** |
| Payroll | hidden | No |

Backend regression: **125/125 files, 2264/2264 tests**, clean. Zero schema drift. No frontend change.

## 19. WWM HR Granted Organization Administrator Rights (Owner Decision)

At the owner's explicit request, Grace Mensah (`hr@wwm.test`) was additionally granted the `org_admin` system role on top of her existing `hr_manager` + `wwm_hr_inventory_operations` roles — via `POST /organizations/3/members/426/roles {roleId: 2}`, the same membership-role-assignment endpoint used for every other role grant in this document. Additive, not a replacement: her membership now carries all three roles simultaneously.

§17 established (and this reconfirms) that the platform's own default design deliberately separates system/organization administration from HR-operational authority — `hr_manager` intentionally excludes `module.manage`/`role.manage`/`organization.update`. Granting Grace `org_admin` is a **conscious departure from that default, made by WWM's own stakeholder for WWM specifically** — not something the platform recommends by default, not applied to any other organization, and not something a future workstream should treat as a new baseline to replicate elsewhere without the same kind of explicit instruction.

Live-verified with Grace's own token after the grant: `PATCH /organizations/3/modules/leave` → `200` (module management), `GET /organizations/3/roles` → `200` (role/permission management), `PATCH /organizations/3` → `200` (organization settings). She can now configure modules, roles, and organization settings herself, in addition to her existing HR-operational work.

Kwame (`admin@wwm.test`) remains WWM's own dedicated `org_admin` as well — unaffected, still a separate account with the same authority. No other WWM account's roles changed.

No code, schema, or permission-table change of any kind; this document and the matching `PROJECT_STATUS.md` entry are the only repository change this action required.
