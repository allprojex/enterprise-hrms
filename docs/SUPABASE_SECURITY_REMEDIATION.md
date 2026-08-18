# Supabase Data API Exposure — Investigation & Development Remediation

**Status: Development remediated (migration `0036`). Production not yet assessed or touched — requires its own separate verification and approval before any RLS change is made there.**

## What was found

Supabase's Security Advisor flagged RLS disabled on all 68 tables in the development project's `public` schema (`vkvirwdxoiwsiftaarox`). Investigation (this session) established, live:

- The Data API/PostgREST endpoint for this project is **reachable** (confirmed via an unauthenticated request returning `401`, not a connection failure).
- Default Supabase grants were never narrowed: **`anon` and `authenticated` both hold full `SELECT/INSERT/UPDATE/DELETE` on all 68 tables**, with RLS as the only thing standing between that grant and actual access.
- With RLS disabled, a live anon-key request against `sessions`, `users`, `organizations`, `organization_memberships`, `employees`, `candidates`, `background_checks`, and `reference_checks` would have returned rows.

This is classified as a **confirmed exposure path** — a live, provable capability — not evidence that anyone exploited it. A log review of the available retention window (the maximum single query exposes, ~24h) found no anonymous REST requests to any table other than this investigation's own test traffic. **No suspicious activity found in the available logs.** This does not prove no earlier access occurred outside that window; it is not claimed to.

## Why the application itself was never at risk from its own connection

This application never uses the Supabase client SDK, Supabase Auth, or PostgREST — confirmed by repository-wide search (no `@supabase/supabase-js`, no `VITE_SUPABASE_*`/`NEXT_PUBLIC_SUPABASE_*`, no reference to Supabase anywhere in `artifacts/`). It connects to Postgres directly via `DATABASE_URL`, as the Postgres role `postgres` (Supabase's pooler presents this as `postgres.<project-ref>`). That role:

- owns every one of the 68 tables, and
- carries `BYPASSRLS`,

both independently sufficient for Postgres to skip Row-Level Security entirely for this connection. **Enabling RLS therefore has zero effect on the application** — confirmed both by this reasoning and by a live regression pass after remediation (login, `/auth/me`, organization-scoped reads, tenant-hostname consistency, cross-organization denial, `switch-organization`, module-gated Recruitment/ESS routes — all identical to pre-remediation behavior, no `500`s anywhere).

## Development remediation — migration `0036`

`lib/db/drizzle/0036_enable_rls_deny_default.sql` (+ matching `.down.sql`) enables Row-Level Security on all 68 public application tables, with:

- **No policies created.** RLS-enabled-with-no-policies denies every row, for every operation (SELECT/INSERT/UPDATE/DELETE alike), to any role without `BYPASSRLS` — a complete, deterministic block on the `anon`/`authenticated` PostgREST path, verified live post-migration (`Content-Range: */0` for `anon` against all 8 sensitive tables tested; the `authenticated` role is denied by the identical mechanism, since it also lacks `BYPASSRLS` and no policy exists for any role).
- **Grants retained, not revoked.** RLS is a complete gate on its own; narrowing grants too is a reasonable later hardening step, not required and deliberately out of this migration's minimal scope.
- **No `FORCE ROW LEVEL SECURITY`.** FORCE RLS only changes behavior for the table *owner* — `postgres` bypasses RLS via `BYPASSRLS` regardless of FORCE RLS, so it would add nothing here.
- **No tenant/permission-aware policies.** Real policies mirroring the actual `organization_memberships` → role → permission chain (`docs/TENANT_DOMAINS_AND_ACCESS.md` §5–6) remain deliberate, explicit follow-on work — a second, carefully reviewed migration, not rushed into this one. Deny-by-default fully closes the confirmed exposure path in the meantime; it does not need real policies to do that, since this application never legitimately queries as `anon`/`authenticated` in the first place.

Applied to the development project only. Verified live: 68/68 tables RLS-enabled, 0 disabled, 0 policies, `FORCE RLS` off everywhere, migration ledger reconciled (`drizzle.__drizzle_migrations`), `drizzle-kit generate` reports zero drift. Supabase's advisor re-check now shows the same 68 tables as `rls_enabled_no_policy` — `INFO` level, not `ERROR` — confirming the platform itself now treats this as a safe, intentional posture.

## What remains open

- **Production has not been assessed.** This document, migration `0036`, and every verification step above apply to the development project only. Production requires its own independent audit and its own explicit approval before any RLS or grant change — assuming the same architecture (it should, per this repository's single shared codebase) does not remove the need to verify it there directly.
- **Tenant/permission-aware RLS policies** are future defense-in-depth work, tracked but not scheduled here — useful chiefly if this application, or some future integration, ever legitimately queries as `anon`/`authenticated` (it does not today).
- **Session rotation** for the development database was assessed as a precaution (not because exploitation was found) and intentionally **not performed** — pending separate approval.
