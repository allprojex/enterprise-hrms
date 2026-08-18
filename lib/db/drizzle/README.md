# Migrations

This folder is generated/managed by `drizzle-kit` (`pnpm --filter @workspace/db run
generate`). Never edit the numbered `.sql` files or `meta/` by hand except where noted below.

## 0000_init_core_platform_foundation.sql

This is the **first** migration ever generated for this project — the database has, until
now, only ever been managed with `drizzle-kit push` (no migration history existed to diff
against). As a result this file describes the **entire current schema**, including four
tables that already exist on any database that has run `push` before:
`organizations`, `users`, `sessions`, `notifications`.

**On a brand-new, empty database:** apply `0000_init_core_platform_foundation.sql` as-is via
`pnpm --filter @workspace/db run migrate`.

**On the existing project database** (already has `organizations`/`users`/`sessions`/
`notifications` from prior `push` usage): applying the file as-is will fail on duplicate
tables. Before running `migrate` against that database, remove the following from a copy of
the file (or apply only the remaining statements manually):

- `CREATE TABLE "organizations"` and its `slug` unique constraint
- `CREATE TABLE "users"` and its `email` unique constraint
- `CREATE TABLE "sessions"` and its `token` unique constraint — but **keep** the
  `active_organization_id` column addition and its FK
- `CREATE TABLE "notifications"`
- The enum types `org_status`, `org_type`, `user_role`, `notification_type` (already exist)

Back up the database before applying anything. `0000_init_core_platform_foundation.down.sql`
is a hand-written companion rollback that reverses only the genuinely new objects (the 15 new
tables — including `positions` and the expanded `employees` table from Phase 2 — the
`organization_type_id` column on `organizations`, and the `active_organization_id` column on
`sessions`) — it does not touch the four pre-existing tables' own columns or data.

This migration was regenerated in place (not appended as 0001) while adding the Phase 2
`employees`/`positions` columns, since it had never been applied anywhere yet. Once it has
been applied to a real database, always generate a new incrementing migration for further
changes — never edit or regenerate an already-applied one.

All future migrations should be generated the normal way (`generate` → review → `migrate`)
and will be ordinary incremental diffs; this reconciliation step is a one-time cost of
adopting versioned migrations on top of an already-`push`-managed database.

## 0036_enable_rls_deny_default.sql

**Hand-authored, not `drizzle-kit generate` output.** The Drizzle schema definitions in this
project (`lib/db/src/schema/*.ts`) don't express Row-Level Security state — `generate` diffs
table/column/index/enum shape only, and enabling RLS changes none of that. This migration
enables RLS, with zero policies, on all 68 tables in `public` — a deny-by-default posture for
the `anon`/`authenticated` Supabase roles, which is the only thing standing between them and
full CRUD on every table (their default grants were never narrowed; RLS was the intended gate
and had never been enabled). It does not touch table ownership, columns, data, or the
application's own connection: the app connects as the `postgres` role, which owns every table
and carries `BYPASSRLS`, so this migration has zero effect on application behavior — see
`docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` and the Supabase security audit in project history
for the full verification. `FORCE ROW LEVEL SECURITY` is deliberately not used: it only changes
behavior for the table *owner*, and `BYPASSRLS` overrides it regardless, so it would add
nothing here. Tenant/permission-aware policies (matching the real `organization_memberships`
authorization chain) remain explicitly out of scope for this migration — deny-by-default closes
the actual exposure; real policies are a deliberate follow-on, not rushed in here.

`0036_enable_rls_deny_default.down.sql` is the matching hand-written rollback — disables RLS on
exactly the same 68 tables, touches no data.
