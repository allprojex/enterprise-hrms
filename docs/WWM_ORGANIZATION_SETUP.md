# Worldwide Word Ministries — Organization Setup & Branding

Status: **Local/development readiness complete.** Production untouched, Netlify not deployed. See PROJECT_STATUS.md's "WWM Readiness — Workstream 1" entry for the full workstream record; this document is the living reference for WWM's configuration and the branding/tenant-resolution architecture it uses, kept current as later WWM workstreams land.

## 1. Organization Identity

WWM is organization id `3` (pre-existing — created before this workstream, not by it). Fresh queries against the live development database, run at the start of this workstream, corrected a false negative in the Office Inventory epic's own W11/W12 live-QA scripts: those scripts searched for `LIKE '%WWM%'` (uppercase), which never matches Postgres's case-sensitive `LIKE` against the organization's actual stored name (`wwm`, lowercase) — so W11/W12's "no WWM organization exists" conclusion was a search-pattern bug, not an accurate finding. WWM has existed in the development database since 2026-07-27.

| Field | Before this workstream | After this workstream |
|---|---|---|
| `name` | `wwm` | `Worldwide Word Ministries` |
| `slug` | `wwm` | `wwm` (unchanged — already correct) |
| `type` | `church` | `church` (unchanged) |
| `status` | `trial` | `trial` (unchanged — a deliberate later decision, not this workstream's) |
| `logoUrl` | `null` | `null` — **no logo asset exists anywhere in this repository or the development environment.** The login page and authenticated shell both already render a graceful fallback icon when `logoUrl` is null (verified live). A real WWM logo file must be supplied before this field can be set to something real; it should never be fabricated. |

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

## 7. What Is Deliberately Not Done Yet (real-person data)

Per the request's own instruction not to fabricate real organizational identity for WWM (§9, §13, §24: "Do NOT use disposable QA identity for WWM"), this workstream stops short of:

- **A dedicated WWM organization administrator distinct from the platform super_admin.** WWM's only membership today is `admin@hr.com` (the platform `super_admin`) holding `org_admin` within WWM — a pre-existing arrangement, not created by this workstream. A real named WWM administrator's email must be supplied before a genuine account can be onboarded; creating a fake one would violate the "no disposable identity for WWM" instruction.
- **Assigning either new custom role to any real membership.** Both roles exist and are fully configured, ready to assign the moment a real WWM HR person and real WWM employees exist as memberships. Assigning them to the super_admin's own admin membership would conflate system-administration authority with HR-operational authority — exactly what §10 says not to do.
- **Department Heads.** The assignment mechanism (`assignDepartmentHead`/`revokeDepartmentHead`/history/as-of, keyed by `headMembershipId`) is verified ready and unchanged; no WWM department currently has a real employee to assign as Head, so none was fabricated.
- **A WWM logo.** No asset exists; fallback rendering is graceful and verified.

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

## 11. Remaining Presentation-Readiness Work (not part of this workstream)

- A real named WWM organization administrator and at least one real WWM HR person, once the user supplies their identities — then assign `wwm_hr_inventory_operations` accordingly.
- A real WWM logo asset.
- Real WWM department/employee data before any Department Head can be assigned.
- A decision on WWM Payroll access (explicitly out of scope here).
- Netlify/production deployment (explicitly out of scope here — local/development only, per the request's own hard stop).
