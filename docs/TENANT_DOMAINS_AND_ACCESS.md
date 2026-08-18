# Multi-Organization Tenant Infrastructure

**Status: Implemented and applied to the development database.** Not a phase workstream — this sits alongside Phase 3A/3B as shared platform infrastructure every module (present and future) builds on. Phase 3B (Attendance Capture, W64–W72) remains frozen and is resumed unmodified after this document; see `PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md`.

---

## 1. One platform, many tenants — the architecture this preserves

CLAUDE.md's "One Shared Foundation" principle applies here without exception: there is one HRMS codebase, one Express API, one React frontend, one module framework. WWM (a church), Acme (a business), and every future organization type run through the exact same routes, the exact same middleware chain, and the exact same React app. Nothing in this workstream introduces an organization-type-specific code path — `organizations.type` (`business | church | ngo | school | hospital | hotel | government | other`) already existed before this work and is untouched by it. A hostname is a *routing and branding* concern only; it never changes which code runs, only which organization's data that code is scoped to.

This is additive infrastructure: one new table (`organization_domains`), a resolver middleware, a handful of consistency checks layered onto middleware that already existed, and a matching frontend context. It does not touch, renumber, or duplicate any existing module.

---

## 2. Domain model

### Schema — `organization_domains`

```
id                   serial PK
organization_id      integer NOT NULL, FK -> organizations(id) ON DELETE CASCADE
hostname             text NOT NULL — always normalized (lowercase, trimmed, no scheme/port/path)
domain_type          enum: platform_subdomain | custom_domain
status               enum: pending | active | disabled     (default: pending)
is_primary           boolean NOT NULL DEFAULT false
verification_token   text, nullable — reserved for custom-domain DNS ownership challenges
verified_at          timestamptz, nullable
created_at / updated_at
```

Constraints:
- `organization_domains_hostname_unique` — a hostname belongs to exactly one organization, globally, forever.
- `organization_domains_org_idx` — lookups by organization.
- `organization_domains_org_primary_unique` — a **partial** unique index (`WHERE is_primary = true`) enforcing at most one primary domain per organization at the database level, not just in application code.

Migration `0035_right_maria_hill` (`lib/db/drizzle/`) is purely additive — one new table, two new enum types, nothing altered on any existing table. Its `.down.sql` companion drops exactly those three objects and nothing else.

### `platform_subdomain` vs `custom_domain`

- **`platform_subdomain`** — a hostname on the platform's own testing/staging domain (e.g. `wwm.localhost` today; `wwm.example-hrms.com` once a commercial platform domain exists — never hardcoded here). The platform controls DNS for these, so a newly created row goes **active immediately**, no verification step.
- **`custom_domain`** — the tenant's own domain (`hr.worldwidewordministries.org`). Starts **pending** with a generated `verification_token`. Today, activation is a manual platform-admin action after confirming DNS ownership out-of-band (e.g. asking the tenant to prove control of the domain some other way) — there is no automated DNS TXT-record checker yet. The `verification_token`/`verified_at` columns exist so that automation can be added later without a schema change; nothing in this workstream promised or implemented the checker itself.

### Status model

`pending → active ⇄ disabled`. Only an `active` domain resolves to a tenant (§4). `disabled` stops a domain from resolving immediately without deleting the row or losing its history — the same "never hard-delete" discipline this codebase already uses everywhere else (candidates, memberships, roles).

---

## 3. Testing URL and custom domain, side by side

Every organization can carry any number of domain rows. In practice: one `platform_subdomain` row for internal testing/demoing, plus zero or more `custom_domain` rows once the tenant is ready to go live on their own domain. `is_primary` marks which one is "the" URL a platform admin would hand to a tenant — not enforced anywhere beyond the UI's own display convention, since every active domain for an org resolves identically.

Example, dev environment:

| organization | hostname         | type               | status | primary |
|---|---|---|---|---|
| wwm (id 3)    | `wwm.localhost`  | platform_subdomain | active | yes |
| Acme (id 4)   | `acme.localhost` | platform_subdomain | active | yes |

Nothing here assumes `.localhost` — the same rows in a later environment would read `wwm.example-hrms.com` / `hr.worldwidewordministries.org`, with no code change.

---

## 4. Tenant resolution

`artifacts/api-server/src/middlewares/resolveTenantHost.ts`, wired **globally** in `app.ts`, immediately after body parsing and **before** the router (so it runs ahead of `requireAuth` — login itself needs tenant context):

```
incoming request
  → normalize the candidate hostname(s)
  → look up organization_domains (status = 'active')
  → also require the linked organization not be 'suspended'
  → attach req.resolvedTenantOrganizationId (number | null)
  → next()  — never blocks by itself
```

**Host precedence:** the real `Host` header (`req.hostname`) is tried first — in production, behind Nginx (`proxy_set_header Host $host;`), this is the actual, un-spoofable hostname the browser connected to, and `wwm.example-hrms.com` genuinely differs from `acme.example-hrms.com` at this layer. The `X-Tenant-Hostname` header is a **fallback**, needed only because this project's own development setup runs the frontend (`localhost:5173`) and the API (`localhost:3001`) as separate origins — Vite's dev proxy (`changeOrigin: true`) rewrites the `Host` header before the API ever sees it, so `wwm.localhost:5173` never reaches the API as `wwm.localhost`. The frontend's `initAuth()` (`artifacts/hrms/src/lib/auth.ts`) registers `window.location.hostname` as that fallback via `setTenantHostnameGetter` (`lib/api-client-react/src/custom-fetch.ts`), attached to every request the same way the Bearer token already is.

**This header carries no authorization weight.** Every check built on it (§5) can only ever *add* a denial on top of the real membership/permission checks that already existed — never bypass or replace them. An attacker who strips or spoofs `X-Tenant-Hostname` gains nothing beyond what their real credentials and real permissions already allow (security requirement #15).

**Fails open, by design.** Any error resolving a tenant (malformed hostname, a database hiccup) resolves to `null` — "no tenant context" — never a 500, and never blocks the request. `resolveTenantHostFailOpen.test.ts` proves this directly against a `@workspace/db` mock that doesn't even know the new table exists, the same shape every one of this project's other 50+ existing test files' mocks have — this is why wiring a new global middleware into `app.ts` didn't require touching any of them.

---

## 5. Authentication and membership interaction

The core rule, verified live end-to-end (§9):

```
hostname tenant  +  authenticated user  +  active membership  +  permission  +  module gating
                              all five must agree
```

A resolved tenant hostname is checked for consistency at five points, all reusing the same two functions (`hostnameOrganizationMismatch`/`shouldFailClosedForTenantResolution`, `lib/organizationDomains.ts`) rather than each reimplementing the rule:

1. **`requireMembership`** (`middlewares/requireMembership.ts`) — the shared gate composed into nearly every org-scoped route in the codebase (branches, departments, leave, recruitment, …). If a tenant was resolved from the hostname and it doesn't match the route's `:organizationId`, deny — one file, every module inherits the guard automatically, with no per-route changes.
2. **`requireActiveOrganizationMembership`** (`routes/me.ts`) — the equivalent gate for the `/me/*` routes, which resolve "current organization" from the session rather than a URL param.
3. **`GET/PATCH /organizations/:id`, `/suspend`, `/reactivate`** (`routes/organizations.ts`, `tenantHostnameAllowsOrganization`) — this route family authorizes via `authorizeOrganizationAction` rather than `requireMembership`, so it needed its own call site reusing the identical rule (found and fixed as a follow-up; real membership/permission enforcement was never affected — only this additional hostname guard was missing).
4. **`POST /auth/login`** — after password verification succeeds and before a session is issued: if a tenant hostname resolved and the account has no active membership there, the login itself is denied (`403`, "This account does not have access to this organization") — even with fully correct credentials.
5. **`POST /auth/switch-organization`** — switching into an organization that mismatches the resolved hostname is denied the same way. Per the brief, a hostname change never triggers an automatic switch either way — nothing in this workstream reads the resolved hostname to *pick* an organization on its own; it only ever narrows what a caller-initiated action is allowed to target.

**`super_admin` is exempt only at points 4 and 5** (login, switch-organization) — the two entry points that manage which tenant a session is even scoped to in the first place, the same platform-wide bypass `isSuperAdmin()`/`authorizeOrganizationAction()` already grants everywhere else in this codebase. Points 1–3 carry **no** super_admin exemption: every org-scoped action, including a platform admin acting on one specific organization's own record, retains an explicit tenant context. A platform super-admin can still log in and administer freely from the platform's own base domain (no tenant hostname resolves there, so none of these checks ever trigger) — they just cannot use a hostname bound to one organization to act on a *different* one, the same restriction an ordinary user faces.

---

## 6. Platform admin

Domain management (`routes/organizationDomains.ts`) is reserved to the platform `super_admin` role only — `middlewares/requireSuperAdmin.ts`, a plain `req.user.role === 'super_admin'` check, deliberately **not** the existing permission-grant machinery, since no tenant role is meant to hold this capability (an org's own `org_admin` cannot manage that org's domains, let alone another org's):

- `GET  /organizations/:organizationId/domains` — list
- `POST /organizations/:organizationId/domains` — create (`platform_subdomain` → active immediately; `custom_domain` → pending)
- `POST /organizations/:organizationId/domains/:id/activate`
- `POST /organizations/:organizationId/domains/:id/disable`
- `POST /organizations/:organizationId/domains/:id/set-primary`

Every write is audit-logged (`organization_domain.created` / `.activated` / `.disabled` / `.primary_set`) via the existing `recordAuditEvent`. The frontend surface lives on the existing **Organisations** platform-admin page (`artifacts/hrms/src/pages/organizations.tsx`) — a "Domains" panel on the selected organization's detail card, visible only when `me.role === 'super_admin'`: list with per-row copy/activate-disable/set-primary actions, and an add-domain form. No new page, no duplicated organization list — the existing platform-admin surface simply grew a section, per CLAUDE.md's "extend, don't duplicate."

`GET /tenant-context` (`routes/tenantContext.ts`) is the one public, unauthenticated route in this workstream. It takes **no hostname parameter** — it only ever resolves from the caller's own request (§4) — so it cannot be used to enumerate other tenants; this was a deliberate, explicit design constraint ("do not expose a public tenant directory"), not an oversight. Its response is either `{resolved: false}` or `{resolved: true, organizationId, organizationName, organizationSlug, organizationType, logoUrl}` — never an employee, a membership, an admin email, a permission structure, or another tenant's data.

---

## 7. Organization types and module relationship

Nothing here is church-specific, business-specific, or type-specific in any way. `organizations.type` is read nowhere in this workstream's own code. Tenant resolution sits, deliberately, **below** the module system:

```
hostname → organizationId (informational only)
    ↓
authenticated user + active membership (requireMembership)
    ↓
module enabled? (requireModuleEnabled)
    ↓
permission granted? (requirePermission)
    ↓
route allowed
```

`organization_domains` is never consulted by `requireModuleEnabled` or the module registry, and vice versa — a WWM user on `wwm.localhost` sees exactly the modules WWM has enabled, the same as if they'd reached the same route through any other hostname carrying a valid session. Module configuration is not duplicated into this table, and this table adds nothing to module gating beyond the one-time hostname/organization consistency check in §5.

---

## 8. Local development

Two changes were needed at the transport layer to make multi-hostname dev testing work, both already present before this workstream and left untouched because they were already correct:

- **Frontend** (`artifacts/hrms/vite.config.ts`): `server.allowedHosts: true` and `host: '0.0.0.0'` already accept any hostname, including `wwm.localhost:5173`/`acme.localhost:5173` — no browser-side DNS entry is required for `*.localhost`, modern browsers and OS resolvers already treat it as loopback.
- **API CORS** (`artifacts/api-server/src/app.ts`): with `CORS_ORIGIN` unset (the dev default), `cors({ origin: true })` reflects whatever `Origin` the browser sends, and the `cors` package's default `allowedHeaders` behavior already reflects `X-Tenant-Hostname` (or any other header) back from the preflight's own `Access-Control-Request-Headers` — no explicit allow-list edit was needed.

The one genuinely new piece is the `/api` dev proxy's interaction with hostname resolution, covered in §4 — solved in application code (`X-Tenant-Hostname` fallback), not by touching the proxy config, since `changeOrigin: true` is correct and necessary there for other reasons (the API's CORS/cookie-adjacent behavior) and rewriting it would be the wrong fix for a problem that isn't really about the proxy.

---

## 9. WWM — the existing tenant, reused

Per the brief: **no new WWM organization was created.** The existing development organization was inspected directly against the live development Supabase project (`vkvirwdxoiwsiftaarox`) and is used as-is.

| field | value |
|---|---|
| id | 3 |
| name | `wwm` |
| slug | `wwm` |
| type | `church` |
| status | `trial` |
| memberships | 1 active (`admin@hr.com`, `org_admin`) |
| modules enabled | 0 |
| branding | none set (`logoUrl` null) |

Assigned testing hostname: **`wwm.localhost`** (`platform_subdomain`, `active`, primary) — confirmed live: `GET /tenant-context` with `X-Tenant-Hostname: wwm.localhost` returns `{"resolved":true,"organizationId":3,"organizationName":"wwm","organizationSlug":"wwm","organizationType":"church","logoUrl":null}`. WWM demonstrates the platform's own promise directly: a church runs on the exact same infrastructure as every other organization type, with zero church-specific code anywhere in this workstream.

---

## 10. Acme — the isolation partner

Also pre-existing (id 4, slug `acme`, type `business`, status `active`, 2 modules enabled) — retained, not deleted, per the brief. Assigned **`acme.localhost`** the same way.

**One pre-existing data-hygiene issue was found and corrected during setup, dev-database only:** Acme's admin account (`admin@acme.com`) carried the platform-wide `users.role = 'super_admin'` — the same role that makes `isSuperAdmin()` bypass every cross-organization check in this codebase (`authorizeOrganizationAction`, and now the four checks in §5 too). Left as-is, it would have made any WWM/Acme isolation test against that account meaningless — the account would have been able to reach WWM regardless of what this workstream built, for reasons entirely unrelated to domains. It was demoted to `org_admin` (matching its actual `organization_memberships` role grant, which was already `org_admin`-equivalent) — a single-column UPDATE, on dev data, directly serving the isolation testing this workstream exists to prove, not a broader cleanup. Not touched: `Acme Test Corp` (id 2), an unrelated pre-existing stray organization from earlier testing — left alone as out of scope.

---

## 11. Hostinger / Nginx production boundary

The production shape this design assumes and does not require any code change to reach:

```
tenant DNS (wwm.example-hrms.com, hr.worldwidewordministries.org, ...)
    → one Hostinger VPS
    → Nginx (proxy_set_header Host $host;)
    → one shared HRMS application (the same Express process for every tenant)
    → resolveTenantHost (reads the real, per-tenant Host header directly — no X-Tenant-Hostname needed here)
    → tenant-isolated application context, per request
```

No per-organization deployment, no per-organization VPS, no per-organization database. Every tenant's traffic reaches the identical application binary; only the resolved `organizationId` differs. `PLATFORM_BASE_DOMAIN`/commercial domain names are not hardcoded anywhere in this workstream — a super-admin types whatever hostname they're assigning at domain-creation time (§6). Dedicated infrastructure for a future customer with contractual/regulatory needs remains possible later (a different `organization_domains` row pointing at a different backend origin via its own Nginx server block) without any schema or application change today. **Nothing was deployed as part of this workstream** — production has not been touched, per the brief's explicit instruction.

---

## 12. Boundary for the future File/Document module

Not implemented here, and this workstream deliberately does not block it. `organization_domains` carries no file/object-storage concept at all — hostnames identify a tenant, nothing about where that tenant's files live. When the File/Document module is built:

- Object storage stays private and provider-agnostic (Supabase Storage today; another S3-compatible provider later) — the database stores metadata and storage keys/references only, never becomes the blob store itself, per this project's own established `candidate_documents.storageKey`-style convention (Phase 3A).
- Document categories, retention, chain-of-custody, and audit stay **configurable per organization** — the same "configuration before custom code" principle this entire platform runs on, not a hostname or organization-type concern. WWM will eventually configure church-relevant categories; another church, a hotel, or a school will configure their own, on the identical module.
- Tenant isolation for documents is inherited automatically: any future document route composes `requireMembership` the same way every other module route already does, so it picks up the hostname-consistency guard in §5 for free, with zero additional code.

---

## 13. Security — verified

All sixteen scenarios from the brief were verified, split across two evidence sources: **52 new automated tests** (26 unit — `organizationDomains.test.ts`; 2 fail-open safety — `resolveTenantHostFailOpen.test.ts`; 16 route-level integration — `tenantHostSecurity.test.ts`; 4 app-shell + 4 login frontend — `app-shell.test.tsx`/`login.test.tsx`), all running against the real Express app/middleware chain via `supertest` (not reimplemented logic), and **live requests against the actual development database** (§9–10) using two disposable, since-deleted QA accounts created for this purpose (no production or real dev-team credentials were touched or reset).

| # | Scenario | Verified |
|---|---|---|
| 1 | WWM user cannot discover Acme | ✅ live — `admin@wwm`-style token denied on Acme hostname and Acme org id |
| 2 | Acme user cannot discover WWM | ✅ live — symmetric denial confirmed |
| 3 | WWM credentials + Acme hostname → denied | ✅ live login: `403 "This account does not have access to this organization"` |
| 4 | Acme credentials + WWM hostname → denied | ✅ live login, symmetric |
| 5 | Cross-organization API ids remain denied | ✅ live — `GET /organizations/4` with a WWM-only token → `403` |
| 6 | Single-org users see no global tenant picker | ✅ `app-shell.test.tsx` — switcher hidden, plain label shown |
| 7 | Multi-org users see only legitimate memberships | ✅ pre-existing behavior (`GET /me/organizations` is already self-scoped), re-verified unchanged |
| 8 | Tenant admin cannot manage another tenant's domains | ✅ `org_admin` gated out by `requireSuperAdmin` regardless of which org they administer |
| 9 | Platform super-admin can manage tenant domains | ✅ `requireSuperAdmin` grants exactly this role, tested |
| 10 | Unknown hostname fails safely | ✅ live — `{"resolved":false}`, no error |
| 11 | Disabled hostname fails safely | ✅ live — WWM's own domain flipped to `disabled` and back; `{"resolved":false}` while disabled |
| 12 | Suspended organization fails safely | ✅ unit + integration tested (`resolveTenantByHostname` / `GET /tenant-context`) |
| 13 | Module checks remain enforced | ✅ untouched — `requireModuleEnabled` composition unchanged everywhere |
| 14 | Permission checks remain enforced | ✅ untouched — `requirePermission`/`hasPermission` unchanged; live-confirmed a hostname match alone doesn't skip them (§9 test 7b needed a real role grant) |
| 15 | Host-header manipulation cannot bypass tenant isolation | ✅ by construction (§4) — the header can only add a denial, never remove one; live-confirmed test 8b (same request, only the hostname header changed, from allowed to denied) |
| 16 | Public tenant context leaks no unrelated tenant data | ✅ `GET /tenant-context` payload is the closed, safe DTO only; no hostname parameter exists to probe other tenants with |

---

## 14. Verification

Backend: 754/754 tests pass (was 706; +48 net new). Frontend: 240/240 tests pass (was 234; +6 net new). Typecheck clean (libs + api-server + hrms). Lint clean (`eslint src --max-warnings=0`). OpenAPI → codegen: byte-identical output across two consecutive runs (`@workspace/api-zod`, `@workspace/api-client-react`). `drizzle-kit generate`: "No schema changes, nothing to migrate" after the migration was applied. Production builds succeed for `api-server`, `hrms`, and `mockup-sandbox`. Migration `0035` applied to the development Supabase project only (`vkvirwdxoiwsiftaarox`) after confirming no pre-existing `organization_domains` table; verified column-for-column and index-for-index against the migration file after applying; migrations `0000`–`0034` were independently confirmed already applied there via `drizzle-kit migrate`'s own tracking table (`drizzle.__drizzle_migrations`, 35 rows, hash-verified against `0034`'s own file). Migration `0035` was applied via a direct SQL statement rather than `drizzle-kit migrate` itself (this session's tooling reaches the database directly), so its tracking row was added by hand afterward — same `sha256(file contents)` hash algorithm drizzle-kit itself uses, verified by reproducing `0034`'s recorded hash from its file first — and `drizzle-kit migrate` was then run once more against the same database to confirm it now reports success with nothing further to apply. Production database: **untouched**.

**Update — resolved, see `docs/SUPABASE_SECURITY_REMEDIATION.md`:** the RLS-disabled condition flagged here was investigated as a full security audit and closed in development via migration `0036` (deny-by-default RLS on all 68 public tables, no policies, no application changes required — this app's server connects as the `postgres` role, which owns every table and carries `BYPASSRLS`, so it is architecturally unaffected by RLS state either way). That audit found the Data API/PostgREST endpoint for this project genuinely reachable with default `anon`/`authenticated` grants permitting full CRUD, and classified this as a confirmed exposure *path* (a live, provable capability) — not evidence of any historical exploitation, which a log review within the available retention window found no sign of. See that document for the full investigation, live verification, and remediation record. Tenant/permission-aware RLS policies (mirroring the real `organization_memberships` authorization chain) remain explicitly out of scope and are tracked there as deliberate follow-on defense-in-depth work, not rushed into the deny-by-default fix.
