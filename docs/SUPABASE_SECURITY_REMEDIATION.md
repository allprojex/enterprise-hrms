# Supabase Data API Exposure — Investigation & Remediation

**Status: Remediated. RLS deny-by-default (`0036`) + grant/default-privilege hardening (Supabase migration `0037`, WS-18 Pass 1C). Verified independently through a read-only auditor role.**

> ## ⚠️ Environment classification correction
>
> **Everything below that was originally written as applying to a "development"
> project applies to the live Production project.** The Supabase project this
> document describes was documented throughout this repository as a development
> environment. The owner has since confirmed directly in the Supabase dashboard
> that it is the actual **Production** project. The live project identity is
> authoritative; the earlier "development" label was wrong.
>
> The original text of the investigation section is preserved as written —
> correcting the record means changing the classification, not rewriting what
> was found. Read every "development" in the historical sections below as
> "Production". See [`ENVIRONMENT_CLASSIFICATION.md`](./ENVIRONMENT_CLASSIFICATION.md)
> for the authoritative statement and for what this mislabelling caused.

---

## What was found (original investigation — classification since corrected)

Supabase's Security Advisor flagged RLS disabled on all 68 tables in the project's `public` schema. Investigation established, live:

- The Data API/PostgREST endpoint for this project is **reachable** (confirmed via an unauthenticated request returning `401`, not a connection failure).
- Default Supabase grants were never narrowed: **`anon` and `authenticated` both hold full `SELECT/INSERT/UPDATE/DELETE` on all 68 tables**, with RLS as the only thing standing between that grant and actual access.
- With RLS disabled, a live anon-key request against `sessions`, `users`, `organizations`, `organization_memberships`, `employees`, `candidates`, `background_checks`, and `reference_checks` would have returned rows.

This is classified as a **confirmed exposure path** — a live, provable capability — not evidence that anyone exploited it. A log review of the available retention window (the maximum single query exposes, ~24h) found no anonymous REST requests to any table other than this investigation's own test traffic. **No suspicious activity found in the available logs.** This does not prove no earlier access occurred outside that window; it is not claimed to.

## Why the application itself was never at risk from its own connection

This application never uses the Supabase client SDK, Supabase Auth, or PostgREST — confirmed by repository-wide search (no `@supabase/supabase-js`, no `VITE_SUPABASE_*`/`NEXT_PUBLIC_SUPABASE_*`, no reference to Supabase anywhere in `artifacts/`). It connects to Postgres directly via `DATABASE_URL`, as the Postgres role `postgres` (Supabase's pooler presents this as `postgres.<project-ref>`). That role:

- owns every application table, and
- carries `BYPASSRLS`,

both independently sufficient for Postgres to skip Row-Level Security entirely for this connection. **Enabling RLS therefore has zero effect on the application** — confirmed both by this reasoning and by a live regression pass after remediation (login, `/auth/me`, organization-scoped reads, tenant-hostname consistency, cross-organization denial, `switch-organization`, module-gated Recruitment/ESS routes — all identical to pre-remediation behavior, no `500`s anywhere).

## Remediation step 1 — migration `0036` (RLS deny-by-default)

`lib/db/drizzle/0036_enable_rls_deny_default.sql` (+ matching `.down.sql`) enables Row-Level Security on all 68 public application tables then existing, with:

- **No policies created.** RLS-enabled-with-no-policies denies every row, for every operation (SELECT/INSERT/UPDATE/DELETE alike), to any role without `BYPASSRLS` — a complete, deterministic block on the `anon`/`authenticated` PostgREST path, verified live post-migration (`Content-Range: */0` for `anon` against all 8 sensitive tables tested; the `authenticated` role is denied by the identical mechanism, since it also lacks `BYPASSRLS` and no policy exists for any role).
- **Grants retained, not revoked.** RLS is a complete gate on its own; narrowing grants too is a reasonable later hardening step, not required and deliberately out of this migration's minimal scope. *(This deferral is what WS-18 Pass 1B later classified as F-1B and Pass 1C closed — see below.)*
- **No `FORCE ROW LEVEL SECURITY`.** FORCE RLS only changes behavior for the table *owner* — `postgres` bypasses RLS via `BYPASSRLS` regardless of FORCE RLS, so it would add nothing here.
- **No tenant/permission-aware policies.** Real policies mirroring the actual `organization_memberships` → role → permission chain (`docs/TENANT_DOMAINS_AND_ACCESS.md` §5–6) remain deliberate, explicit follow-on work.

Verified live: 68/68 tables RLS-enabled, 0 disabled, 0 policies, `FORCE RLS` off everywhere, migration ledger reconciled (`drizzle.__drizzle_migrations`), `drizzle-kit generate` reports zero drift. Supabase's advisor re-check shows those tables as `rls_enabled_no_policy` — `INFO` level, not `ERROR` — confirming the platform itself treats this as a safe, intentional posture.

---

## WS-18 Pass 1B — Production assessment (F-1B)

Assessed read-only through a dedicated auditor role, `hrms_sec_audit` (non-superuser, `NOBYPASSRLS`, catalog-oriented). No application rows were read.

Findings at the time of assessment (121 application tables):

- RLS enabled on **121/121**; zero tables with RLS disabled; **zero policies** in the entire database — deny-by-default holding, and independently corroborated by Supabase Security Advisor (121 `rls_enabled_no_policy` lints, all `INFO`; **no** `ERROR`-level lints at all).
- No functions, no views, and no SECURITY DEFINER surface in `public`; `pg_graphql` not installed. No bypass path.
- **But**: `anon` and `authenticated` still held full `arwdDxtm` on all 121 tables and `rwU` on all 121 sequences, and `DEFAULT PRIVILEGES` re-granted both roles on *every future object* created in `public`.
- PostgREST is **live** (`authenticator` connections, `PostgREST 14.5`), so those roles are genuinely externally reachable.

Classified **F-1B — HIGH CONFIGURATION DEFECT**: no active exposure, but a single-layer control. Sequence privileges in particular are **not** constrained by table RLS. The decisive factor was that Production was 19 migrations behind the repository: PostgreSQL creates tables with RLS **off**, so the next deployment would have created 77 tables that were `anon`-readable *and writable* before RLS was enabled on them.

### A methodological warning worth keeping

The first pass of the assessment read grants from `information_schema.role_table_grants` and concluded "no grants to `anon`/`authenticated`". **That was a false negative.** Those views only return grants whose grantor or grantee is a role the *current user* belongs to, so an unprivileged auditor sees an empty result. The blanket grants were only revealed by re-querying `pg_class.relacl` and `has_table_privilege()`, which have no such filter. Any future audit must use the `has_*_privilege()` family. `lib/db/src/security/verify-rls-posture.ts` does, and says so in its header.

## WS-18 Pass 1C — remediation (Supabase migration `0037`)

`0037_revoke_anon_authenticated_public_grants`, applied to the Supabase migration ledger (**not** the Drizzle ledger — that deliberately stays at `0056`, and the 19 pending migrations were **not** deployed):

1. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES/SEQUENCES/FUNCTIONS FROM anon, authenticated` — the primary fix, stopping future propagation.
2. `REVOKE ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public FROM anon, authenticated` — the existing 121 tables and 121 sequences.

`postgres` and `service_role` were left untouched, as were the `auth`, `storage`, and `realtime` schemas (Supabase system components legitimately grant `anon`/`authenticated` there; those objects are themselves RLS-enabled with no policies). No RLS state, policy, table structure, or row was changed.

**Dependency analysis that authorised the revoke** (repo @ `7be1efa`): no `@supabase/supabase-js` in any application source; no anon/publishable key reaches any client (no `VITE_*`, `NEXT_PUBLIC_*`, or `SUPABASE_*` variable exists anywhere); authentication is self-hosted (`node:crypto` scrypt + `public.users`/`public.sessions`), **not** Supabase Auth — `auth.users` has no foreign key from any application table; the frontend calls its own Express API. `anon`/`authenticated` had no legitimate consumer. Because RLS already denied both roles everything, no *working* behaviour could regress: a caller that previously received an empty result now receives a permission error instead.

### Verified post-remediation (read-only, via `hrms_sec_audit`)

| Check | Result |
|---|---|
| RLS enabled | 121/121, 0 disabled, 0 forced |
| Policies in entire database | 0 (unchanged) |
| `anon` privileges on application tables / sequences | **0 / 0** |
| `authenticated` privileges on application tables / sequences | **0 / 0** |
| `postgres`, `service_role` retained | yes (121 tables each) |
| `DEFAULT PRIVILEGES` for `postgres` on `public` | `anon`/`authenticated` removed |
| Table count / Drizzle ledger | 121 / 56 — both unchanged |
| Security Advisor | 121 `INFO` lints, unchanged; no new `ERROR`/`WARN` |

### Known residual (monitored, not closable here)

`supabase_admin` also holds `DEFAULT PRIVILEGES` on `public` that grant `anon`/`authenticated`. `ALTER DEFAULT PRIVILEGES FOR ROLE <r>` requires membership in `<r>`, and `pg_has_role('postgres','supabase_admin','MEMBER')` is **false** — verified live. No credential available to this project can remove them; only Supabase platform support can.

This is **latent, not active**: it only takes effect if `supabase_admin` itself creates an object in `public`, which Supabase's managed migrations do not do (they target `auth`/`storage`/`realtime`/`extensions`/`graphql`). If it ever did, the effective-privilege checks in `verify-rls-posture.ts` fail hard, because they test every object that actually exists. The verifier reports this as a standing **warning** rather than a failure, so the gate does not sit permanently red on something no one here can fix.

---

## Standing controls

Two independent gates, because neither is sufficient alone.

**`tools/ci/check-rls-coverage.mjs` — static, runs on every PR** (CI job `RLS coverage gate`). Proves, with no database and no credentials, that (1) every `pgTable` in `lib/db/src/schema` is enabled for RLS by some committed migration — currently **198/198** — and (2) any migration from `0037` onward that creates a table enables RLS on it *in the same migration file*. Drizzle wraps each migration file in a transaction, so same-file means atomic: there is never a committed window in which a new table exists without deny-by-default. `DISABLE ROW LEVEL SECURITY` in a forward migration is always rejected.

The job runs `--self-test` **first**, feeding the checker known-bad migrations. A gate that cannot be shown to fail proves nothing when it passes.

**`lib/db/src/security/verify-rls-posture.ts` — live, run against a real database** (`pnpm --filter @workspace/db run verify:posture`). Reads `PRODUCTION_AUDIT_DATABASE_URL` (preferred) or `DATABASE_URL`, sets the session read-only, and asserts RLS coverage, zero `anon`/`authenticated` table *and sequence* privileges, and safe default privileges. Catalog-only — it never reads an application row, so it is safe to point at Production. **Run it after every deployment**: CI cannot see configuration applied out of band, and the static gate cannot see the live database.

### Deployment-safety proof

Before the 19 pending migrations are ever deployed, their behaviour was proven in a disposable PostgreSQL 17 container (never against Production). Two databases, both seeded with the stock Supabase role model and default privileges; one then received `0037`'s default-privilege hardening. All 75 migrations were applied to each via the real mechanism (`drizzle-kit migrate`):

| | tables | RLS on | `anon` SELECT | `anon` INSERT | `anon` sequence USAGE |
|---|---|---|---|---|---|
| stock defaults (pre-`0037`) | 198 | 198 | **198** | **198** | **198** |
| after `0037` defaults | 198 | 198 | **0** | **0** | **0** |

This confirms both halves: the repository's migrations do enable RLS on all 198 tables, *and* without `0037` the next deployment would have granted `anon` full read/write on all 77 newly created tables. It also serves as a full migration round-trip test — all 75 migrations apply cleanly from an empty database.

## What remains open

- **Production is 19 migrations behind** (`0056` applied vs `0074` in the repository; 121 of 198 tables exist). Deploying them is a separate, explicitly-approved action — not authorised by, and not performed during, WS-18 Pass 1C.
- **Tenant/permission-aware RLS policies** remain future defense-in-depth work — useful chiefly if this application, or some future integration, ever legitimately queries as `anon`/`authenticated` (it does not today). Deny-by-default plus zero grants is the current, deliberate posture.
- **`supabase_admin` default privileges** — the residual above. Closing it requires a Supabase support request.
- **Schema `USAGE` on `public`** is still held by the `PUBLIC` pseudo-role (`=U/pg_database_owner`), so revoking `USAGE` from `anon`/`authenticated` alone would achieve nothing. Revoking it from `PUBLIC` is available as further hardening but was outside Pass 1C's authorised scope.
- **Session rotation** was assessed as a precaution (not because exploitation was found) and intentionally **not performed** — pending separate approval.
