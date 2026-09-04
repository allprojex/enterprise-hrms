# Enterprise HRMS

A configurable, multi-tenant Human Resource Management System for businesses, churches, NGOs, schools, hospitals, hotels, and government institutions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from `PORT` env var)
- `pnpm --filter @workspace/hrms run dev` — run the frontend (port from `PORT` env var)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run generate` — generate a versioned migration from the current schema (see `lib/db/drizzle/README.md` before running against the existing database)
- `pnpm --filter @workspace/db run migrate` — apply pending migrations
- `pnpm --filter @workspace/db run seed:roles` / `seed:organization-types` — idempotent reference-data seeds
- `pnpm --filter @workspace/db run backfill:memberships` — derive `organization_memberships` from existing `users` rows
- `pnpm --filter @workspace/api-server run test` — backend tests (Vitest + Supertest, `@workspace/db` mocked, no real DB needed)
- `pnpm --filter @workspace/hrms run test` — frontend tests (Vitest + Testing Library)
- Required env: `DATABASE_URL` — Postgres connection string. See `.env.example` at repo root for the full list.

## Stack

- pnpm workspaces, Node.js 20+, TypeScript 5.9
- Frontend: React 19, Vite, Wouter, TanStack React Query, Tailwind CSS v4, shadcn/ui
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (v3), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API server), Vite (frontend)
- Auth: token-based sessions stored in `sessions` table, node:crypto scrypt hashing

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle schema. Legacy tables: organizations, users (still has `organizationId`/`role`), sessions, notifications. Multi-org foundation (additive, not yet the only path): organization_types, organization_settings, organization_memberships, roles, permissions, role_permissions, membership_roles, membership_scopes, primary_hr_assignments, branches, departments, employees, employee_user_links, organization_relationships, audit_events.
- `lib/db/drizzle/` — versioned migrations (`drizzle-kit generate`/`migrate`). Read `drizzle/README.md` before applying `0000_*` to the existing database — it was generated with no prior migration history so it describes the whole schema, not just what's new.
- `lib/db/src/seed/`, `lib/db/src/backfill/` — idempotent, insert-only scripts; never modify or delete existing rows.
- `artifacts/api-server/src/routes/` — Express route handlers (auth, organizations, notifications, users/dashboard, me)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — Bearer token auth middleware
- `artifacts/api-server/src/middlewares/requireMembership.ts` — resolves an active `organization_memberships` row for a path param, never trusts the client-supplied org ID beyond using it as a lookup key
- `artifacts/api-server/src/lib/authorization.ts` — `isSuperAdmin`/`canAccessOrganization`, still the check used by the legacy `organizationId`-based routes
- `artifacts/api-server/src/lib/{membership,permissions,primaryHr,auditLog,onboarding}.ts` — the new membership-based authorization foundation: active-membership lookups, role→permission resolution, Primary HR appoint/transfer (relies on the DB partial unique index, not app-level locking), append-only audit writes, and the one function (`onboardOrganization`) allowed to create an organization
- `artifacts/hrms/src/` — React frontend

## Architecture decisions

- Token-based auth: Bearer tokens stored in `sessions` table with 7-day TTL. No JWT, no cookie sessions. Standard for portable deployments.
- node:crypto scrypt for password hashing — no bcrypt dependency, works everywhere Node.js runs.
- OpenAPI-first: spec gates codegen which gates the frontend. Never write types that codegen already produces.
- Multi-tenant by design: every resource is scoped to `organization_id`. Super-admin role can cross org boundaries; enforced via `canAccessOrganization`, not per-route ad hoc checks.
- Multi-org foundation is additive, not a cutover: `users.organizationId`/`role` are still the source of truth for every pre-existing route. New routes (`POST /organizations`, `POST /auth/switch-organization`, `GET /me/organizations`) run on `organization_memberships` instead. Migrating the legacy routes over is a later phase, not done yet.
- Organization creation only ever happens through `onboardOrganization()` (one DB transaction: org + creator's membership + org_admin role + Primary HR) — never insert into `organizations` directly from a route.
- `sessions.activeOrganizationId` is a UX convenience pointer only, set by `/auth/switch-organization`. It is never treated as an authorization decision — every org-scoped request re-verifies an active membership independently.
- Runs on any PostgreSQL-backed Node.js host. The project was originally scaffolded on Replit; as of 2026-07-26 it has been fully migrated off that platform — the Replit-only dev plugins (`@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`, `@replit/vite-plugin-runtime-error-modal`), `.replit`/`.replitignore` config, and related workspace exclusions/catalog entries have all been removed.
- `pnpm-workspace.yaml` resolves native build binaries (esbuild/Rollup/Tailwind oxide) for both `linux-x64` (production deploy target) and `win32-x64`/`win32-arm64` (local Windows dev) — other platforms remain excluded to keep the lockfile small.

## Product

Shell with public landing page, login/forgot-password, secure app layout (sidebar + topbar), dashboard with real summary data, user profile (view/edit), notifications, organisation selector, settings placeholder, 403/404 pages, loading and empty states. HR modules are coming-soon placeholders.

## Demo credentials (after seeding)

No seed script exists in this repo yet. If one is added, it must check
`NODE_ENV` and refuse to run in production — these credentials must never
exist outside development.

| Role | Email | Password |
|------|-------|----------|
| HR Manager | admin@acme.com | Admin@1234 |
| Employee | james@acme.com | Employee@1234 |

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After adding new tables to `lib/db/src/schema/`, always run `pnpm run typecheck:libs` before typechecking leaf artifacts.
- Codegen runs `typecheck:libs` automatically — no need to run it manually after codegen.
- Zod v3 is used (not v4). Use `import { z } from "zod"` in API routes — do not use `zod/v4` in the api-server package.
- `format: email` in the OpenAPI spec generates `zod.email()` which doesn't exist in Zod v3. Omit that format.
- Express 5: wildcard routes need `/{*splat}`, `req.params.id` is `string | string[]` — always parse with `Array.isArray` guard.
- `@workspace/db` throws at import time if `DATABASE_URL` isn't set (no lazy check). Backend tests set a placeholder value in `artifacts/api-server/src/test/setup.ts` and mock `@workspace/db`/`drizzle-orm` directly rather than hitting a real database — see `organizations.test.ts` for the pattern (mock resolves rows by which table `.from()` was called with).
- Workspace scripts must stay POSIX-shell-free (no `sh -c`, no `export VAR=val &&`) so they run on Windows without WSL/Git Bash. Use `cross-env` for cross-platform env vars in npm scripts, and plain Node scripts (see `tools/preinstall.mjs`) instead of shell one-liners.
- `lib/db/drizzle.config.ts` must use relative, forward-slash `schema`/`out` paths, not `path.join(__dirname, ...)`. On Windows the latter produces backslash paths that `drizzle-kit generate`'s schema-file glob matcher fails to resolve ("No schema files found"), even though the path is correct.
- Primary HR "exactly one active per org" is enforced by a partial unique index (`primary_hr_assignments`, `WHERE revokedAt IS NULL`), not application logic — `appointPrimaryHr()` relies on catching the resulting Postgres unique-violation (SQLSTATE 23505) rather than a racy check-then-insert.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `artifacts/hrms/README.md` for the full project README including deployment portability guide

## Production edge (Nginx)

`deploy/nginx/hrms.afripebbles.com.conf` and `deploy/nginx/snippets/hrms-security-headers.conf`
are the source of truth for the Production reverse proxy. Rollout: copy both to
`/etc/nginx/sites-available/hrms.afripebbles.com` and `/etc/nginx/snippets/`, run `nginx -t`,
then `systemctl reload nginx` (graceful — never restart). Verify with
`node tools/security/edge-header-probes.mjs https://hrms.afripebbles.com`. See `docs/SECURITY.md` §18.
