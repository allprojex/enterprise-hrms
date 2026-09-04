# Security Posture

Operational security reference for Enterprise HRMS. Companion to
[`SUPABASE_SECURITY_REMEDIATION.md`](./SUPABASE_SECURITY_REMEDIATION.md) (database
posture) and [`ENVIRONMENT_CLASSIFICATION.md`](./ENVIRONMENT_CLASSIFICATION.md)
(which environment is which).

**No credentials, connection strings, keys, or secrets belong in this file or any
other document.** Everything below refers to environment variables by name only.

---

## 1. Deployment environment variables that are security controls

These are not tuning knobs. Leaving one unset changes the security properties of
the deployment.

| Variable | If unset | Set it to |
|---|---|---|
| `TRUST_PROXY` | `req.ip` is the socket peer. Behind a load balancer that is the **proxy, for every request**, so every per-IP rate limit in the fleet shares one bucket — see §3. | The number of trusted proxy hops (usually `"1"`). Only use `"true"` if an edge proxy overwrites inbound `X-Forwarded-For`. |
| `CORS_ORIGIN` | In production, cross-origin requests are **denied**. Safe when the SPA is served by this process (same-origin), which is the shipped topology. | A comma-separated allowlist, only if a separate front-end origin must call this API. |
| `APP_BASE_URL` | Password-reset links cannot be built; reset emails are silently skipped and the failure is logged. | The public base URL of the application. |
| `NODE_ENV` | Non-production defaults apply (permissive CORS). | `production` in production. Note that error-response safety no longer depends on this — see §5. |
| `DATABASE_URL` | The API cannot start. | The application/migration connection. Owns the tables and bypasses RLS by design — see §6. |
| `PRODUCTION_AUDIT_DATABASE_URL` | `verify:posture` falls back to `DATABASE_URL`. | The read-only, `NOBYPASSRLS` auditor role. Never used by the application at runtime. |

## 2. Password recovery (F-2)

`/auth/forgot-password` and `/auth/reset-password/:token` are unauthenticated and
therefore the most exposed write path in the product. Controls, all server-side:

- **Rate limiting on four dimensions** (`lib/authRateLimit.ts`): per source IP,
  per submitted account identifier, per source IP for token presentation, and
  per token. The per-account limiter keys on the *submitted string* and never
  consults the database, so an unregistered address throttles identically to a
  registered one and the throttle carries no enumeration signal. Identifiers are
  hashed before use as limiter keys.
- **Uniform responses.** Status, body, and elapsed time are identical whether or
  not the address is registered. Email delivery is dispatched without blocking
  the response, and a minimum response duration absorbs the remaining
  database-write difference — without it, a stopwatch enumerates the user base.
- **Tokens**: 256 bits of `crypto.randomBytes`, 1-hour TTL, single-use, and
  **stored as a SHA-256 digest**. A reader of the `users` table — a support
  query, a backup, an export — never obtains usable account-takeover material.
- **Session revocation.** A successful reset deletes every session for the
  account, in the same transaction as the password update. Password reset is the
  control a user reaches for *because* they think they are compromised; leaving
  a stolen bearer token alive would defeat the point.
- Tokens and reset URLs are never logged. Delivery failures log the user id only.

Regression suite: `artifacts/api-server/src/test/passwordResetAbuse.security.test.ts`.

## 3. Rate limiting — known deployment limitation

`express-rate-limit`'s default store is `MemoryStore`, which is **per process**.

With N application instances behind a load balancer, the effective limit is N ×
the configured value, and an attacker who reconnects may land on an instance with
a fresh budget. These limits are **best-effort abuse damping, not a cluster-wide
guarantee**, and must not be described as one.

This is deliberate: a shared store means introducing Redis, which WS-18 was not
authorized to add. If the deployment scales beyond one instance, wire
`rate-limit-redis` into the limiters in `lib/authRateLimit.ts` — no call site
changes.

Compounding this, `TRUST_PROXY` must be set correctly (§1) or per-IP limiting
does not isolate anyone at all.

## 4. Authorization model

Every organization-scoped route composes the same chain:

```
requireAuth -> requireMembership(:organizationId) -> requireModuleEnabled(module) -> requirePermission(key)
```

- The client-supplied organization id is only ever a **lookup key**. Access
  follows from a live membership row, never from the id looking plausible.
- Tenant-hostname consistency is enforced, and fails **closed** if tenant
  resolution itself errors.
- Platform role confers **no standing customer-data access**. The single
  exception is a break-glass grant: organization-scoped, permission-scoped,
  time-limited, revocable, re-checked live on every request.
- Module gating is server-side. Hiding a route in the UI is not a control.
- Request bodies cannot carry authority. Zod schemas strip unknown keys, so
  `organizationId`, `role`, `permissions`, and `membershipId` in a payload are
  discarded rather than honoured.

Adversarial suites: `tenantIsolation.security.test.ts`,
`massAssignmentAndLeakage.security.test.ts`.

## 5. Error responses

A terminal error handler (`app.ts`) returns generic JSON —
`{ error: "Internal server error", requestId }` — for every unhandled failure, in
**every** environment. No stack, no exception message, no file paths, no SQL.

This previously fell through to Express's built-in handler, which renders an HTML
page containing the full stack and absolute source paths, suppressed only when
`NODE_ENV === "production"`. Safety that depends on one environment variable being
spelled exactly right is not a control. Detail now goes to the server log, keyed
by the same `requestId` the caller is given.

## 6. Database posture

Full detail in [`SUPABASE_SECURITY_REMEDIATION.md`](./SUPABASE_SECURITY_REMEDIATION.md).
In short: every application table is RLS-enabled with **no policies**
(deny-by-default), and `anon`/`authenticated` hold **zero** privileges on
application tables and sequences. The application connects as the table-owning
role and bypasses RLS by design, enforcing tenant isolation in application
authorization (§4).

Two independent gates keep it that way:

| Gate | When | What it proves |
|---|---|---|
| `node tools/ci/check-rls-coverage.mjs` | Every PR (CI job `RLS coverage gate`) | Every table in the Drizzle schema is RLS-enabled by a committed migration, and any migration creating a table enables RLS in the same file. Runs `--self-test` first against known-bad fixtures, so a gate that cannot fail never reports a meaningless pass. |
| `pnpm --filter @workspace/db run verify:posture` | **After every deployment** | The live database actually has that posture: RLS coverage, zero `anon`/`authenticated` table *and sequence* privileges, safe default privileges. Catalogue-only — it never reads an application row. |

Neither is sufficient alone: CI cannot see configuration applied out-of-band, and
the static gate cannot see the live database.

> **A deployment is not complete until `verify:posture` passes against the
> deployed database.**

## 7. Uploads and content

- Allowlisted MIME types only: PDF, JPEG, PNG, DOCX, XLSX. **SVG and HTML are
  not accepted** — both can carry active content.
- Magic-byte signature verification, not trust in `Content-Type`.
- The storage extension is derived from the validated MIME type, never from the
  client's filename, so filename tricks cannot influence what is stored.
- Downloads are served `Content-Disposition: attachment` with the filename
  URL-encoded, and helmet sets `X-Content-Type-Options: nosniff`.

## 8. Injection surface

- **SQL**: no `sql.raw` anywhere in the API server. Every `sql` template
  interpolates Drizzle column references or bound parameters. No user-controlled
  identifier or fragment reaches SQL.
- **Command execution**: no `child_process` surface exists.
- **SSRF**: the API server makes no user-influenced outbound requests. Email goes
  to a fixed provider.
- **XSS**: the API is JSON-only; React escapes at the render boundary. The single
  `dangerouslySetInnerHTML` in the codebase is unused shadcn chart scaffolding
  with no callers and no tenant-controlled input.
- **CSRF**: authentication is a bearer token, not an ambient cookie, so classic
  cookie CSRF does not apply. No CSRF middleware is present, deliberately.

## 9. Standing residuals

| Item | Status |
|---|---|
| `supabase_admin` default privileges on `public` still grant `anon`/`authenticated` | **Provider-managed, not closable here.** `ALTER DEFAULT PRIVILEGES FOR ROLE r` requires membership in `r`, and `postgres` is not a member of `supabase_admin`. Latent only — it takes effect only if `supabase_admin` itself creates an object in `public`, which Supabase's managed migrations do not do. `verify:posture` reports it as a warning and fails hard if it ever becomes a real grant. **Escalate to Supabase Support.** |
| Rate limits are per process | §3. Revisit when scaling past one instance. |
| Break-glass elevation errors on most routes | 101 route files read `req.membership!` directly instead of `resolveOrganizationId(req)`, which is `undefined` under elevation. Fails **closed** (no data disclosed), so it is a correctness defect in an emergency control rather than an exposure. WS-4 follow-on. |
| Production is behind the repository | Deploying is a separate authorized action, and must be followed immediately by `verify:posture`. |

---

## 10. Container security (WS-18 Pass 3)

The production image is `Dockerfile`'s `runtime` stage. Posture, verified by
inspecting the built image:

| Property | State |
|---|---|
| Runtime user | `node` (uid 1000) — **not root** |
| `/app` (code, node_modules) | root-owned, **not writable** by the runtime user |
| `/var/lib/hrms/uploads` | owned by `node` — the only writable path |
| Exposed ports | 3001 only |
| Package managers | **npm, npx and corepack are deleted** from the runtime image |
| Shell utilities | no `curl`, `wget`, `git`, `ssh`, or compilers |
| Base image | pinned by **digest**, with Debian security updates applied on top |
| Healthcheck | plain `node` (no extra tooling required) |

Removing npm is both hardening (an attacker with execution cannot fetch and
install a package) and honesty: npm ships ~1,500 bundled dependencies that the
running product never loads, and they accounted for **1 CRITICAL and 20 HIGH**
scanner findings before removal — permanent noise that had to be re-triaged on
every scan.

### Standing exploitability analysis for the unfixable tail

Every remaining CRITICAL/HIGH is a Debian base-OS package with **no vendor fix
available**. Each is reachable only by a process that can already execute
commands in the container — and the application has **no command-execution
surface at all** (no `child_process` anywhere; verified in Pass 2). They are
therefore post-compromise concerns, not entry points:

| Package | Why it is not reachable |
|---|---|
| `perl-base` | The application never invokes perl. No interpreter is spawned. |
| `zlib1g` (CVE-2023-45853) | The MiniZip component carrying the flaw is not built in Debian's zlib. |
| `util-linux`, `mount`, `libuuid1`, `libblkid1`, `libsmartcols1`, `bsdutils` | Mount/filesystem utilities. Never invoked, and the runtime user cannot mount. |
| `ncurses`, `libtinfo6` | Terminal handling. No TTY is attached. |
| `gzip`, `libacl1` | Never shelled out to. |

This analysis is the thing to revisit if a command-execution surface is ever
introduced — not the gate threshold.

**Future option, not taken here:** a distroless or Alpine base would remove most
of this tail outright. It is a larger change (sharp needs glibc) and was out of
scope for this pass.

## 11. Supply-chain gates

| Gate | Tool | Policy |
|---|---|---|
| Dependency / SCA | `pnpm audit` → `tools/ci/check-pnpm-audit.mjs` | Fail on CRITICAL. Everything else printed. |
| Container | Trivy 0.74.0 → `tools/ci/check-container-scan.mjs` | Fail on any CRITICAL/HIGH **that has an available fix**. Unfixable base-OS findings printed every run and analysed in §10. |
| SBOM | Trivy (CycloneDX 1.7) | Generated from the same image that was scanned; retained as a 90-day CI artifact. |
| Secrets | gitleaks (full history) | — |
| SAST | CodeQL (`javascript-typescript`) | — |
| RLS coverage | `tools/ci/check-rls-coverage.mjs` | Fail if any table lacks RLS; self-tests first. |

**No suppression list exists, deliberately.** If one ever becomes necessary it
must be per-CVE with a written justification and a review date — never a
severity-wide or package-wide mute.

The container gate keys on *fixability* rather than raw severity. A gate that
fails on unpatchable base-image CVEs is red on day one, stays red through every
green build, and trains everyone to ignore it — which is how a real finding gets
waved through. Keyed this way, a failure always means one specific thing:
**something in this image can be patched and has not been.**

## 12. DAST

Tooling and harness live in `tools/security/`:

| File | Purpose |
|---|---|
| `dast-probes.mjs` | Targeted probes: headers, CORS (OD-WS18-10), TRUST_PROXY (OD-WS18-9), password recovery, error handling, tenant/IDOR, open redirect, header injection. 43 assertions. |
| `seed-dast-fixture.cjs` | Two disposable synthetic tenants + three users. Idempotent. |
| `nginx-dast.conf` | Reverse-proxy topology for the TRUST_PROXY tests. |

Run against a **disposable stack only** — never Production, never real HR data.
The ZAP baseline (`zaproxy/zap-stable`, ZAP 2.17.0) complements these: it is
good at generic passive web weaknesses, but it cannot express this platform's
tenant model or the frozen owner decisions, and against an API-only surface with
no HTML to crawl it reaches only a handful of URLs. Neither replaces the Pass 2
adversarial authorization suite, which tests isolation properly.

**Not wired into pull-request CI**, deliberately: a meaningful run needs a
migrated and seeded database plus a reverse proxy, and a flaky security job that
people learn to re-run is worse than a documented release-gate step. Run it as a
release gate against the staging stack.

### Deployment note for the VPS/Nginx topology

Set `server_tokens off;` in nginx. The application emits no `Server` header, but
nginx advertises its exact version by default — flagged by ZAP against the test
proxy, and it applies to any real deployment fronted the same way.

---

## 13. Tenant identity is taken from the connection, not from headers (WS-18 Pass 4)

`GET /tenant-context` is public and unauthenticated. Tenant resolution therefore
reads the **raw `Host` header only**:

- **`X-Tenant-Hostname` is ignored in production.** It exists solely for the
  split-port dev setup (the Vite proxy rewrites `Host`). It stays available
  outside production, and behind an explicit `ALLOW_TENANT_HOSTNAME_HEADER=true`
  for the rare non-production stack that needs it. **Never set that in
  production** — it is, by construction, a caller-supplied tenant identity.
- **`X-Forwarded-Host` never influences resolution.** Express derives
  `req.hostname` from it whenever `trust proxy` is on — which is the frozen
  Production setting (`TRUST_PROXY=1`) — so resolution deliberately does not use
  `req.hostname`.

Before this, an anonymous caller could name any tenant's hostname in a header
and receive that organization's id, name, slug, type, logo and branding: exactly
the "public tenant directory" the route's own doc comment forbids. Confirmed
live in both proxy configurations.

Regression suite: `tenantHostSpoofing.security.test.ts`.

> **Nginx must pass `Host` through unmodified** (`proxy_set_header Host $host`),
> as `tools/security/nginx-dast.conf` shows. A proxy that rewrites `Host` to the
> upstream name breaks tenant resolution entirely.

## 14. Separation of duties fails closed (WS-18 Pass 4)

Every maker-checker guard compares an attribution column — `prepared_by_membership_id`,
`created_by_membership_id`, `created_by`, `requested_by_user_id`. **Each of those
foreign keys is declared `ON DELETE SET NULL`**, so deleting the maker's
membership or user — routine offboarding — rewrites the attribution to `null`,
and `null === <approver id>` is `false`.

The guard did not fail. It stopped existing. The same person could then approve
the payroll run they prepared, with nothing reporting that a financial control
had been dropped.

`lib/separationOfDuties.ts` is now the single predicate for these checks, and it
refuses in **two** cases: the maker and actor are the same principal, *or* the
maker cannot be identified. Applied at all five affected call sites (payroll run
approve, payroll run lock, payroll correction approve, service-request approve,
data-change approve).

**Operational consequence, intended:** a record whose maker has been offboarded
can no longer be approved as-is. That is correct — the record no longer supports
the claim that two different people handled it. Re-prepare it under a current
maker and the claim becomes true again.

Two guards were checked and found already safe: leave approval compares
`leave_requests.employee_id` (`NOT NULL`), and statutory rule approval compares
`payroll_statutory_rule_versions.created_by_membership_id` (`NOT NULL`).

Regression suite: `separationOfDuties.security.test.ts`.

## 15. Manual penetration harness

`tools/security/pentest-probes.mjs` — 27 assertions over host-header spoofing,
stale authority, HTTP parser/routing edge cases, vertical and horizontal
escalation, audit integrity, module gating, error/cache leakage and CORS. Run
against a disposable stack seeded by `seed-dast-fixture.cjs`, never Production.

Stale-authority revocation was verified live and takes effect on the **next
request** in every case: membership suspended → 403, membership expired → 403,
user disabled → 401, roles revoked → 403, and reactivation restores access. No
authority is cached in the session.

---

## 16. gitleaks false-positive handling

`.gitleaks.toml` adds exactly **one** allowlist entry. The upstream default
ruleset is inherited in full (`[extend] useDefault = true`); nothing is disabled.

### The findings

Three historical findings, all from commit `cb143108` (2026-08-30), all rule
`generic-api-key`:

| File | Line | Construct |
|---|---|---|
| `artifacts/api-server/src/lib/employee360/types.ts` | 79 | `key: <TypeName>;` |
| `artifacts/api-server/src/lib/employee360/types.ts` | 125 | `key: <TypeName>;` |
| `lib/api-client-react/src/generated/api.schemas.ts` | 53 | `key: <TypeName>;` |

All three are **CONFIRMED FALSE POSITIVES**. Evidence, established without ever
printing the matched text:

- The matched span straddles the property label, the colon **and** the trailing
  semicolon — it is not a self-contained token.
- The "value" is a 21-character PascalCase identifier: a valid TypeScript
  identifier, not base64/hex/JWT-shaped.
- It is **declared as a type** in both flagged files and imported as a symbol
  elsewhere. It is a type, not data.
- It never appears inside a string literal and never on the right-hand side of
  an assignment.
- All three matches are the identical construct, with identical entropy.

A TypeScript type annotation is erased at compile time. It has no runtime value
and therefore cannot be a credential.

`generic-api-key` looks for a key-ish label followed by a longish high-entropy
value; `key: SomePascalCaseTypeName;` matches that shape structurally while
being, semantically, a type.

### Why the exception is safe

The allowlist regex excuses a match **only** when the entire match is a bare
type annotation. It requires an unquoted PascalCase identifier terminated by a
semicolon, so:

- anything **quoted** is still reported — and a real secret in TypeScript is
  quoted (`key: "sk_live_…"`, `const KEY = '…'`);
- anything containing `+ / = . - _ :`, or starting with a digit or lowercase, is
  still reported — which covers essentially every real API key, JWT, base64
  blob, hex digest and connection string.

It is scoped to the single `generic-api-key` rule. Every other rule stays active
everywhere, **including in these same files**.

This is deliberately **not** a path-based exclusion of generated code. Excluding
whole files would also hide genuine secrets inside them; scoping to the syntax
keeps those files under full scrutiny.

### Negative controls (re-run if the config changes)

Verified against synthetic fixtures held **outside** the repository, so a fake
secret can never be committed:

| Case | Expected | Result |
|---|---|---|
| `key: SomeTypeName;` (the allowlisted construct) | not reported | ✅ not reported |
| `key: "<quoted secret>"` in the same position | reported | ✅ reported |
| `api_key: <unquoted base64>` | reported | ✅ reported |
| `const apiKey = "<secret>"` | reported | ✅ reported |
| `key: <non-PascalCase identifier>` | reported | ✅ reported |
| GitHub PAT / Slack bot token / Stripe token (other rules) | reported | ✅ reported |

Repository scan after the change: **250 commits, no leaks found.**

## 17. Tenant identity is immutable, explicit and visible (pre-production hardening)

Full record: `docs/TENANT_IDENTITY_AND_CUSTOMIZATION.md`. The security-relevant
properties, each with a test:

- **`organizations.id` and `organizations.tenant_uuid` cannot change.** A
  `BEFORE UPDATE` trigger (migration `0075`) refuses the statement; the slug is
  immutable through the API. A display-name change never alters ownership
  (`organizations.test.ts`, `tenantIdentityLive.test.ts`).
- **Every request is bound to at most one authorized tenant** on the request
  context, derived only from membership / break-glass / platform authority /
  session scoping and the connection's `Host` header — never from a client
  header or body (`requestContextLogging.test.ts`; the WS-18 host suites are
  unchanged). Binding a second, different tenant throws.
- **Every log line carries `tenant_id`, `request_id`, `user_id`, `environment`,
  `app_version`**; credentials are censored even when a call site includes
  them (`LOG_REDACT_PATHS`).
- **Dangerous tenant-specific actions name their target twice.** Suspend and
  reactivate require `confirmSlug` to equal the target's slug; feature flags,
  break-glass grants and domain changes take the organization as an explicit
  parameter. Nothing infers a target from the session's last-viewed
  organization.
- **Blast radius is declared before the action and recorded with it.**
  `classifyOperation` refuses a tenant-scoped action without an explicit
  organization and an installation-wide action pinned to one organization
  (`blastRadius.test.ts`).
- **Per-tenant feature flags / controlled extensions default OFF, are
  platform-managed (a tenant cannot enable its own), and never leak across
  tenants** (`featureFlags.test.ts`, `platformTenants.test.ts`,
  `admin-endpoints.test.ts`).

The RLS posture (§6), the membership chain (§4) and the host-header rule (§13)
are unchanged.

## 18. Edge security headers and indexing policy (post-deployment hardening)

The Production Nginx configuration is source-controlled in `deploy/nginx/`
(`hrms.afripebbles.com.conf` + `snippets/hrms-security-headers.conf`) and
installed verbatim on the VPS. Header ownership is explicit:

- **Static SPA surface** (document, assets, robots): the edge snippet sends
  HSTS (`max-age=31536000; includeSubDomains`, no preload), `X-Robots-Tag:
  noindex, nofollow, noarchive, nosnippet`, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()` and a
  **report-only** CSP. Enforcing the CSP is a separate, later authorization.
- **`/api/`**: Helmet in the container is authoritative (enforced CSP, XFO,
  nosniff, `Referrer-Policy: no-referrer`, COOP/CORP). The edge hides Helmet's
  HSTS and emits exactly one copy, and adds `X-Robots-Tag`. Nothing else is
  duplicated. `securityHeaders.test.ts` pins the Helmet baseline.
- **Indexing**: the application is authenticated, multi-tenant HR data and is
  never indexed. Declared at source (`artifacts/hrms/index.html` meta,
  `public/robots.txt` `Disallow: /`, guarded by `indexing-policy.test.ts`)
  and at the edge (`X-Robots-Tag`, `/sitemap.xml` → 404). A future public
  careers exception is an explicit tenant-level feature, not a default.

`tools/security/edge-header-probes.mjs <https://host>` verifies the live
matrix: one HSTS per surface, no duplicated API headers, report-only CSP on
the SPA, no-index everywhere, no HSTS on the plain-HTTP redirect.

## 19. Primary HR Administrator and safe HR-team delegation

**Decision (owner, 2026-09-04).** An organization's Primary HR may build and
manage their own HR team without holding `org_admin`, unrestricted
`membership.manage` or unrestricted `role.manage`. The designation "Primary HR"
(`primary_hr_assignments`, one active row per organization) is now an
**authorization boundary**, not metadata.

### The model

| Path | Who | What they may do |
|---|---|---|
| `org_admin` | any member whose effective permissions include `membership.manage` (member routes) or `role.manage` (role routes); a break-glass grant whose scope carries the key behaves the same | Unchanged, with two new hard limits: the `super_admin` **template** is never assignable through organization routes, and a platform-restricted audit key (`audit.read.security`, `audit.read.platform_configuration`) cannot be granted to a role by someone who does not hold it |
| `hr_team` | the organization's **active** Primary HR whose effective permissions include `hr_team.manage` | Add/invite/revoke members, assign/revoke roles, copy templates and edit organization-owned roles — **only inside their own boundary** (rules below) |

Both paths are resolved by `requireDelegationAuthority(adminKey)`
(`artifacts/api-server/src/middlewares/requireDelegationAuthority.ts`), which
replaces `requirePermission("membership.manage" | "role.manage")` on every
member/invitation/role write route and attaches `req.delegation`. Nobody else
reaches those routes: an `hr_team.manage` holder who is not the active Primary
HR, or a Primary HR whose designation was revoked or who lost the key, gets
`403`.

### The rules (lib/roleDelegation.ts — pure, unit-tested)

1. **Ownership.** A role is loadable only if it is a system template
   (`organizationId IS NULL AND isSystemRole`) or owned by the request's
   organization. Another tenant's role is indistinguishable from a nonexistent
   one (`404`), on both paths. Previously assign-role and invite validated only
   that the id existed.
2. **Template.** The `super_admin` template (`NON_ASSIGNABLE_TEMPLATE_KEYS`) is
   never assignable, copyable or invitable through organization routes, on both
   paths.
3. **Prohibited keys (hr_team only).** A role, grant or target member carrying
   any of `organization.update`, `module.manage`, `primary_hr.manage`,
   `role.manage`, `membership.manage`, `migration.manage`, `migration.execute`,
   `audit.read`, `audit.read.security`, `audit.read.platform_configuration`,
   `audit.read.payroll`, or **any `payroll.*` key** is outside the HR boundary.
   Payroll is deliberately excluded from HR delegation (maker-checker and
   separation of duties, §14, are untouched).
4. **Subset (hr_team only).** A role may be delegated, copied or edited, and a
   permission granted, only if every key involved is one the Primary HR
   themselves holds. Delegation can never exceed the delegator.
5. **Scope (hr_team only).** A member may be revoked, or have a role removed,
   only if that member's *entire* effective permission set is inside the
   boundary. The HR team cannot strip an `org_admin`.
6. **Grant rule (both paths).** `POST /roles/:id/permissions` looks the
   permission up by id and applies `permissionGrantVerdict` before the write,
   closing the previous `role.manage` self-escalation (any key could be added to
   an organization role and then self-assigned).

`hr_team.manage` is itself delegable by the Primary HR (it is in their own
set) but confers nothing on its own: the middleware requires the *active
Primary HR designation*, which only `primary_hr.manage` — a prohibited key —
can move. A Primary HR can therefore prepare a deputy without being able to
appoint one.

### The template

`hr_administrator` ("HR Administrator") is a fifth system template seeded by
`seed:roles` (idempotent, additive, no schema migration): a strict superset of
`hr_manager` plus `membership.read`, `hr_team.manage`, the office-inventory
keys and HR configuration/audit/grievance/succession keys. It never carries
`membership.manage`, `role.manage`, `primary_hr.manage`, `organization.update`,
`module.manage`, any `payroll.*` key or a platform-restricted audit key
(pinned by `rolesPermissionsSeed.test.ts`).

### UI

`GET /organizations/:id/roles` now returns `delegable` per role — the server's
own verdict for the calling user. The admin console offers only delegable
roles in the invite and assign selects and hides the copy affordance on
non-delegable templates. The active Primary HR holding `hr_administrator` sees
the console in **HR Team Management** mode (Members and Roles tabs only) via
`useCanManageHrTeam`; every write is re-checked server-side regardless.

### Adversarial coverage

`hrTeamDelegation.security.test.ts` (adversarial harness, 26 cases, positive
control on every route): non-primary `hr_team.manage` holder, revoked Primary
HR, key removed mid-designation, `org_admin`/`super_admin`/payroll/beyond-
boundary/cross-tenant role assignment, invitation with each of those initial
roles, revoking an `org_admin`, revoking a delegable role from a member who
also holds out-of-boundary authority, template copy of `org_admin`/
`super_admin`/custom/cross-tenant roles, grants of prohibited/un-held keys,
editing a role that already reaches outside the boundary, `org_admin`'s
platform-restricted grant, protected system templates, the `delegable` flag
for each authority level, and break-glass. `roleDelegation.test.ts` pins the
pure rules; `rolesPermissionsSeed.test.ts` pins the template shape.
