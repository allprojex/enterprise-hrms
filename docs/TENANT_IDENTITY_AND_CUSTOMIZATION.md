# Tenant Identity, Isolation & Safe Customization

**Status: Implemented (pre-production hardening, 2026-09-03). Migration `0075`.**
Companion documents: `docs/TENANT_DOMAINS_AND_ACCESS.md` (hostname → organization
resolution), `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` (deployment modes,
installations), `docs/SECURITY.md` (WS-18 Production security gate),
`docs/AUDIT_AND_SENSITIVE_DATA.md` (audit model).

This document makes one architectural requirement explicit and records how the
platform satisfies it: **every tenant is uniquely, permanently and visibly
identifiable throughout the platform**, so that a fix, investigation,
configuration, customization, maintenance or support action can be requested
for *one* organization without touching any other.

The architecture is, and remains:

```
SHARED CORE APPLICATION
+ IMMUTABLE TENANT IDENTITY        (§2)
+ STRICT TENANT DATA ISOLATION     (§4)
+ TENANT CONFIGURATION             (§6, level 1)
+ FEATURE FLAGS                    (§6, level 2)
+ CONTROLLED TENANT EXTENSIONS     (§6, level 3)
```

There is one code base and one schema. No tenant has a fork. No shared business
logic branches on a tenant's name — a repository-wide search confirms zero
`tenant === "X"` / `slug === "X"` / `organization.name === "X"` conditionals
outside tests and seeds, and §6 is how it stays that way.

---

## 1. Reconciliation — what already existed

Almost everything the requirement asks for had already been built by earlier
workstreams and was reused unchanged. The genuine gaps, and only those, were
closed (§9 lists the changes).

| Requirement | Existing implementation (reused) | Status before | Gap closed |
|---|---|---|---|
| Tenant primary identity | `organizations.id` (serial PK, every tenant-owned table references it) | Exists | — |
| Immutable tenant UUID | none | **Missing** | `organizations.tenant_uuid` + DB trigger (§2) |
| Human-readable tenant code | `organizations.slug`, unique | Partial (mutable, unvalidated) | immutable via API, validated at creation (§2) |
| Hostname → tenant | `organization_domains`, `resolveTenantHost` | Exists | — |
| Tenant resolution on requests | raw `Host` only (WS-18 P4-01), `X-Tenant-Hostname` dev-only | Exists | — (preserved, re-tested) |
| Tenant context propagation | AsyncLocalStorage with `requestId` + `breakGlassGrantId` only | Partial | `userId`, `hostTenant`, bound `tenant` (§3) |
| `organization_id` ownership | 165 of 198 tables; the rest are platform/installation tables, global statutory data, or child tables scoped through a parent FK | Exists | — (§4 records the child-table list) |
| PostgreSQL RLS | deny-by-default on 198/198 tables, zero policies, CI-gated; app connects as owning role | Exists (WS-18 posture) | — (not weakened) |
| Tenant-aware authorization | `requireAuth → requireMembership → requireModuleEnabled → requirePermission` | Exists | — |
| Tenant-aware audit | `audit_events.organization_id`, append-only, `request_id` | Exists | blast radius + explicit target in `metadata` (§8) |
| Structured logs with tenant | pino-http with `req.id` only | **Missing** | canonical fields on every line (§5) |
| Request/session correlation | `req.id` → `audit_events.request_id` | Exists | `request_id` on log lines too |
| Super Admin tenant selection | session `active_organization_id`; super_admin has **no** standing tenant data access; break-glass only | Exists | identity card + typed confirmation (§7) |
| Module controls | `modules` × `organization_modules`, `requireModuleEnabled` | Exists | — |
| Feature flags | none | **Missing** | registry + service + platform route (§6) |
| Tenant configuration | `organization_settings` namespaces, `services/organizationConfig.ts` | Exists | `feature_flags` namespace, `platformManaged` |
| Branding | `organizations.logo_url`, `branding` namespace, `GET /tenant-context` | Exists | — |
| Support access linked to tenant | `break_glass_grants.target_organization_id` + reason | Exists | blast-radius metadata |
| Maintenance actions | installation-scoped operations (WS-17) | Exists | blast-radius metadata |
| Backup/restore linked to tenant | installation-scoped **by design** (a physical restore rolls back every co-tenant); affected organizations derived via `installation_organizations` | Exists | — |
| Deployment/version per tenant | `installations` + `installation_organizations`, `/healthz` version | Exists | surfaced on the identity card; `INSTALLATION_KEY` self-identification (§5) |
| Customization/extension mechanism | config namespaces, modules, custom fields/forms, master data; no extension point | Partial | levels 2–3 (§6) |
| Blast-radius classification | only restore snapshots affected organizations | **Missing** | `lib/platformOperations/blastRadius.ts` (§8) |

---

## 2. Tenant identity contract

Every organization has, on `organizations`:

| Field | Role | Rules |
|---|---|---|
| `id` (serial) | **Internal primary key and security boundary.** Every tenant-owned row references it. | Immutable — the database refuses any UPDATE that changes it (trigger `organizations_identity_immutable`, migration `0075`). Never client-supplied. |
| `tenant_uuid` (uuid) | **Authoritative technical identity for the outside world** — support tickets, maintenance records, change requests, logs correlated across installations. | Generated by PostgreSQL (`gen_random_uuid()`), unique index, immutable by the same trigger, never client-supplied. Unlike `id`, it survives a tenant moving between installations (a hosted → dedicated move remaps serial keys, `DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` §5/§7). |
| `slug` (text) | **Human-readable tenant code.** | Unique (DB constraint). Validated at creation: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–63 chars. **Immutable after creation through the API** — `PATCH /organizations/:id` no longer accepts it and answers `400` if it is sent. No rename operation exists; a controlled rename would be a future platform operation with its own audit trail, not a self-service field. |
| `name` (text) | Display name. | Freely editable (audited `organization.updated`). **Never a security boundary**: renaming changes nothing about data ownership — proven by `organizations.test.ts` ("display-name change leaves the tenant identity untouched") and `tenantIdentityLive.test.ts`. |
| `status` | `trial` / `active` / `suspended` | Organizations are never deleted; `suspended` is the off state. Because rows persist and `slug`/`tenant_uuid` are unique and immutable, **a tenant identity can never be reused** by a later organization. |
| Hosting identity | `installation_organizations` → `installations` (`installation_key`, environment, hosting model, deployed version) | Which deployment serves the tenant. |
| Hostnames | `organization_domains` | Which hostnames resolve to the tenant. |

The `Organization` API object exposes `id`, `tenantUuid`, `slug`, `name`,
`status`, and the frontend shows all four identifiers wherever a tenant is
selected or operated on (§7).

**Display names must never be used as a security boundary** — nothing in the
code base looks up, authorizes or scopes by name.

---

## 3. Request tenant context

Every request runs inside one `AsyncLocalStorage` store
(`artifacts/api-server/src/lib/requestContext.ts`), created immediately after
pino-http assigns `req.id`:

| Field | Set by | Meaning |
|---|---|---|
| `requestId` | app.ts | pino-http's own per-request id (no second generator). |
| `userId` | `requireAuth` | The verified session's user. Never the token. |
| `hostTenantOrganizationId` | `resolveTenantHost` | The organization the connection's raw `Host` header resolved to. Informational — grants nothing. |
| `tenant` | `requireMembership`, `requireActiveOrganizationMembership` (`/me/...`), the organization-record routes, `/auth/login`, `/auth/switch-organization`, the platform tenant routes | **The one organization this request is authorized to act on**, with its `source` (`membership`, `break_glass`, `platform_authority`, `session`). |
| `breakGlassGrantId` | `requireMembership` | WS-4 elevation, unchanged. |

**A request resolves to exactly one tenant.** `bindTenantContext` is idempotent
for the same organization and throws `TenantContextConflictError` for a
different one — a request that spans two tenants is the bug this context
exists to make impossible, so it fails closed rather than logging the wrong
tenant.

**Nothing in the context is read from a client header or body.** Tenant
identity is derived only from authenticated membership (or a live break-glass
grant, or the platform super_admin role acting on an organization *record*),
and the connection's `Host` header — exactly the WS-18 posture:

- `X-Tenant-Hostname` is ignored in production (`ALLOW_TENANT_HOSTNAME_HEADER`
  is the only, explicitly non-production, override);
- `X-Forwarded-Host` never influences resolution (`req.hostname` is not used);
- `TRUST_PROXY` remains hop-count based.

Regression suites `tenantHostSpoofing.security.test.ts`,
`tenantHostSecurity.test.ts`, `organizationTenantHostname.test.ts` and
`resolveTenantHostFailOpen.test.ts` are unchanged and green.

Deployment identity is the process's own (`lib/releaseInfo.ts`): `NODE_ENV`,
`RELEASE_VERSION`/`GIT_COMMIT_SHA` (honestly `"unknown"` when unset) and the
optional `INSTALLATION_KEY`.

> `sessionId` is deliberately not in the context: the `sessions` table's only
> identifier is the bearer token itself, which must never be logged. Session
> correlation is `user_id` + `request_id`.

---

## 4. Data isolation

Unchanged from WS-18 and re-verified:

- **Application-enforced isolation.** Every organization-scoped route composes
  the chain above; handlers scope on `resolveOrganizationId(req)` /
  `req.membership.organizationId`. `lib/orgScopedRefs.ts` proves client-supplied
  foreign keys belong to the caller's organization.
- **RLS is deny-by-default on every table (198/198), with zero policies,
  gated by `tools/ci/check-rls-coverage.mjs` on every pull request.** Its job
  is to close the Supabase Data API path for `anon`/`authenticated`; the
  application connects as the table-owning role and enforces isolation itself.
  This hardening did not add tenant-aware policies and did not weaken the
  posture (migration `0075` creates no table and touches no RLS state).
- **Privileged paths do not silently bypass isolation.** A platform super_admin
  has no standing customer-data access; `requireMembership` admits them only
  under a live, organization-bound break-glass grant (WS-4). The only
  super_admin bypass is on the organization *record* routes
  (`authorizeOrganizationAction`), which is the platform owner managing tenants,
  not reading tenant HR data — and even there the tenant-hostname consistency
  guard still applies.
- **Tables without a direct `organization_id`** (33 of 198) are: platform
  tables (`organizations`, `users`, `sessions`, `permissions`, `modules`,
  `role_permissions`, `master_data_domains`, `reports`, `installations`,
  `organization_types`), installation-scoped operational tables
  (`installation_*`, `platform_operation_grants`, `break_glass_grants`),
  global statutory reference data (`payroll_paye_bands`,
  `payroll_pension_rates`, `payroll_pension_earnings_ceiling`,
  `payroll_statutory_rule_versions`), and eight child tables scoped through
  their parent's organization (`payroll_correction_components`,
  `payroll_run_line_components`, `performance_rating_scale_levels`,
  `performance_template_competencies`, `membership_roles`,
  `membership_scopes`, `employee_user_links`, `organization_relationships`).
  Each child is only ever reached through a parent row that carries the
  organization id; none is addressable by a client-supplied id alone.

Cross-tenant negative coverage that runs in CI: `tenantIsolation.security.test.ts`
(31 cases across both chain shapes, both directions, break-glass scope),
`massAssignmentAndLeakage.security.test.ts` (writes), `moduleGating.test.ts`,
plus the new `featureFlags.test.ts`, `platformTenants.test.ts` and
`organizations.test.ts` cases. The opt-in live suites add per-resource
negatives against a real database.

---

## 5. Observability

Every structured log line the API writes carries, via `lib/logger.ts`:

| Field | Source | Always present? |
|---|---|---|
| `environment` | `NODE_ENV` | yes (base binding) |
| `app_version` | `RELEASE_VERSION` / `GIT_COMMIT_SHA` / `"unknown"` | yes |
| `installation_key` | `INSTALLATION_KEY` | when declared |
| `request_id` | request context | inside a request |
| `user_id` | request context | after `requireAuth` |
| `tenant_id` | request context — the bound tenant, else the hostname-resolved one | when known |
| `tenant_source` | `membership` / `break_glass` / `platform_authority` / `session` / `hostname` | with `tenant_id` |
| `host_tenant_id` | hostname resolution | when a tenant hostname was used |
| `break_glass_grant_id` | WS-4 elevation | under elevation |
| `module`, `action`, `error_code` | the call site's own log object | as supplied |

The pino `mixin` adds the request fields to every line written inside a
request; pino-http's completion line (written from a response event, outside
the async context) gets the same fields explicitly in `app.ts`; the terminal
error handler includes them alongside `requestId`, which is also the value
returned to the caller.

This is what lets an operator distinguish *"organization X has an error"*
(`tenant_id` = X on every failing line) from *"every tenant has the same
platform error"* (the same `error_code` across many `tenant_id`s, or none).

**What is never logged:** passwords, tokens, cookies, `Authorization`, API
keys — `LOG_REDACT_PATHS` censors them even if a call site includes them — and
no HR payload is bound automatically. The context carries identifiers only.

Audit events already carry `organization_id`, `request_id`, actor and outcome;
§8 adds the blast-radius and explicit target metadata.

---

## 6. Tenant-specific customization hierarchy

Use the **lowest** level that expresses the need. Each level is explicit,
testable, auditable and default-safe.

| Level | Mechanism | Who changes it | Audited |
|---|---|---|---|
| **1 — Tenant configuration** | `organization_settings` namespaces (`general`, `terminology`, `branding`, `attendance`, `numbering`, `payroll`, …) via `services/organizationConfig.ts`; plus master data, custom fields/forms, workflow/approval configuration. Policy differences that need no code branch. | Organization admins (`organization.update`) | per namespace (numbering, audit retention) |
| **2 — Module / feature flag** | Whole capability areas: `modules` × `organization_modules`, enforced by `requireModuleEnabled` and the frontend `ModuleGate`. Narrower capabilities for selected tenants (early access, staged rollout): a `level: "feature"` entry in `lib/featureFlagRegistry.ts`. | Modules: organization `module.manage`. Flags: **platform super_admin only**, `PUT /platform/organizations/:id/feature-flags/:key` with a reason. | `module.enabled/disabled`; `feature_flag.enabled/disabled` |
| **3 — Controlled tenant extension** | A `level: "tenant_extension"` entry in the same registry. **The one sanctioned way shared code may behave differently for a specific tenant**: the branch is `await isFeatureEnabled(organizationId, "<key>")`, evaluated for the request's authorized tenant, default OFF everywhere, enabled per tenant by a super_admin. Never `if (tenant === "WWM")`. | platform super_admin only | `feature_flag.enabled/disabled` with blast radius |
| **4 — Core platform change** | Shared product behaviour for every tenant. Ordinary development; no flag. | Engineering | n/a |

Properties of levels 2–3 (`lib/featureFlags.ts`, proven by
`featureFlags.test.ts`, `platformTenants.test.ts`, `tenantIdentityLive.test.ts`):

- stored in the tenant's own `organization_settings` row (namespace
  `feature_flags`) — isolation is inherited from the configuration engine, not
  reimplemented; no new table, no migration;
- **default OFF** for every organization that has not enabled a flag;
- enabling a flag for Tenant A never affects Tenant B;
- unregistered keys are rejected at write time *and* throw at read time — a
  misspelt flag can never silently read as "off";
- the namespace is `platformManaged`: the organization can read it, but its own
  config PATCH route refuses to write it (`403`), so a tenant cannot enable a
  capability for itself;
- values are plain booleans — no percentages, cohorts or expressions.

**The registry is empty at first deployment.** No tenant-selective capability or
tenant-specific extension has been approved. The mechanism exists so the first
such request is met by adding one registry entry and one guarded branch, not
by a conditional in shared logic. This is the implementation of Owner Decision
#3 ("defer plugin framework; use configuration, optional modules, feature
flags"); it loads no code and evaluates nothing dynamic.

---

## 7. Super Admin safety

Before any tenant-specific operational action a platform super_admin can see,
for the exact tenant:

- display name, **tenant code (slug)**, **immutable tenant UUID**, internal id,
  status, type — on the Organizations page detail panel;
- the **installation(s)** it is linked to with environment type, hosting model,
  deployed application version, migration version and status;
- the **serving API's** environment and release version (and `INSTALLATION_KEY`
  when declared);
- hostnames; enabled modules; registered feature flags and their state.

Source: `GET /platform/organizations/:id/identity` — super_admin only, explicit
target in the path, tenant-hostname consistency enforced, **no HR data**.
Organization pickers in platform surfaces (break-glass grant, installation
linking) show `name · slug · #id`, never the name alone, and the sidebar
always shows the current tenant's code so a user reporting a problem can quote
it.

**Dangerous tenant-specific actions require the target explicitly, twice.**
Suspend/reactivate now require a body `{ confirmSlug, reason? }` whose
`confirmSlug` must equal the target organization's slug — the same
typed-confirmation shape physical restore already uses. A stale screen or a
mistyped id can no longer suspend the wrong customer; the frontend dialog shows
the full identity and requires the code to be typed. Break-glass grants,
feature flags, module toggles and domain changes all take the organization as
an explicit path/body parameter — **never** the session's last-viewed
organization.

Every such action records **who** (`actor_application_user_id`), **what**
(`event_type`), **which tenant** (`organization_id` plus `metadata.tenantSlug` /
`tenantUuid` / `targetOrganizationId`), **when** (`occurred_at`), **why**
(`metadata.reason`) and the **result** (`outcome`, before/after state).

---

## 8. Change blast-radius classification

`lib/platformOperations/blastRadius.ts` declares, for every operational action
kind, one of:

| Radius | Meaning | Required target | Forbidden target |
|---|---|---|---|
| `tenant_scoped` | exactly one organization | `organizationId` (explicit, positive integer) | — |
| `multi_tenant` | every organization on one installation (deployment, backup, physical restore) | `installationId` | `organizationId` — an installation-wide action must not be attributed to one customer |
| `platform_wide` | every installation / tenant (registering an installation, platform authority grants, platform user roles) | — | `organizationId` |

`classifyOperation(kind, target)` runs **before** the action and throws
`BlastRadiusViolation` for any combination that would misstate the radius. In
particular a tenant-scoped action without an explicit organization is refused —
**a tenant-scoped operation can never silently become platform-wide.** The
resulting scope is written into `audit_events.metadata`
(`operation`, `blastRadius`, `targetOrganizationId`, `targetInstallationId`) by:
organization suspend/reactivate/update, feature-flag changes, break-glass
activation, deployment records, backup policy/request/run records and restore
submissions. An operation kind that is not in the registry cannot be
classified — TypeScript refuses the key — so new operational code must declare
its radius in one place or it does not compile. No schema change was needed.

---

## 9. What changed (and what did not)

**Schema — migration `0075_chilly_felicia_hardy`** (additive only; `.down.sql`
provided; ledger `0074 → 0075`):

- `organizations.tenant_uuid uuid NOT NULL DEFAULT gen_random_uuid()` — every
  existing organization receives an identity at migration time, no backfill;
- unique index `organizations_tenant_uuid_unique`;
- trigger `organizations_identity_immutable` (BEFORE UPDATE) rejecting changes
  to `id` or `tenant_uuid`.

No table created, no RLS state touched (`check-rls-coverage` remains 198/198),
no data rewritten. **Not applied to Production** — the Production plan is now
`0056` applied → `0075` committed, **20 pending migrations** (was 19), still
gated on the manual backup step.

**Backend:** `lib/releaseInfo.ts`, extended `lib/requestContext.ts`,
tenant-aware `lib/logger.ts` + `app.ts`, context binding in `requireAuth`,
`resolveTenantHost`, `requireMembership`, `routes/me.ts`, `routes/auth.ts`,
`routes/organizations.ts`; `lib/platformOperations/blastRadius.ts` wired into
organizations, break-glass, platform operations and restore audit events;
`lib/featureFlagRegistry.ts`, `lib/featureFlags.ts`, `feature_flags` namespace
(`platformManaged`) in `services/organizationConfig.ts` and its guard in
`routes/organizationSettings.ts`; `routes/platformTenants.ts`;
`lib/installations.ts` gains `listInstallationsForOrganization`;
`lib/auditCategories.ts` maps `feature_flag` → `platform_configuration`.

**API contract:** `Organization.tenantUuid`; `CreateOrganizationInput.slug`
pattern; `UpdateOrganizationInput` no longer has `slug`;
`OrganizationStatusChangeInput` on suspend/reactivate; `TenantIdentity`,
`FeatureFlagState`, `SetFeatureFlagInput`; three `/platform/organizations/…`
paths. Clients regenerated.

**Frontend:** identity fields, typed status-change confirmation and the
operational identity panel on the Organizations page; identifiers in the
platform-admin pickers; tenant code in the sidebar.

**Not changed, deliberately:** the WS-18 host resolution and its tests; the
RLS posture; the membership/permission chain; installation-scoped backup and
restore (a per-tenant restore remains a separately registered future
workstream); the super_admin organization-record bypass; module management;
any completed workstream's design.

---

## 10. Tests

| # | Requirement | Test |
|---|---|---|
| 1 | Tenant A cannot access Tenant B data | `tenantIsolation.security.test.ts`, `massAssignmentAndLeakage.security.test.ts`, `leavePoliciesTenantIsolation.test.ts` (unchanged, green) |
| 2 | Tenant A feature flag does not enable it for Tenant B | `featureFlags.test.ts`, `platformTenants.test.ts`, `tenantIdentityLive.test.ts` |
| 3 | Tenant A configuration does not change Tenant B | `admin-endpoints.test.ts` config suite (row-per-organization engine), `tenantIdentityLive.test.ts` |
| 4 | Tenant-specific extension defaults OFF elsewhere | `featureFlags.test.ts` ("controlled tenant extension … stays OFF everywhere else"), live suite |
| 5 | Tenant context cannot be forged through untrusted headers | `tenantHostSpoofing.security.test.ts`, `tenantHostSecurity.test.ts` (unchanged) |
| 6 | Logs / audit events identify the correct tenant | `requestContextLogging.test.ts`; audit assertions in `organizations.test.ts`, `platformTenants.test.ts` |
| 7 | Display-name change does not alter ownership | `organizations.test.ts`, `tenantIdentityLive.test.ts` (with the DB trigger) |
| 8 | Tenant-specific Super Admin operation records the correct tenant | `platformTenants.test.ts`, `organizations.test.ts` (suspend metadata) |
| 9 | Platform-wide changes are explicitly classified | `blastRadius.test.ts` |
| 10 | WS-18 security tests remain green | full backend suite |

Live suite: `TENANT_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms`
against the repository's throwaway `docker compose` database migrated through
`0075` (`liveDbGuard.ts` refuses a non-local host).
