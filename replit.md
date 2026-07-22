# Enterprise HRMS

A configurable, multi-tenant Human Resource Management System for businesses, churches, NGOs, schools, hospitals, hotels, and government institutions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from `PORT` env var)
- `pnpm --filter @workspace/hrms run dev` — run the frontend (port from `PORT` env var)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
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
- `lib/db/src/schema/` — Drizzle schema (organizations, users, sessions, notifications)
- `artifacts/api-server/src/routes/` — Express route handlers (auth, organizations, notifications, users/dashboard)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — Bearer token auth middleware
- `artifacts/api-server/src/lib/authorization.ts` — `isSuperAdmin`/`canAccessOrganization`, the single place organization-ownership checks live. Reuse it; don't re-implement the check inline in a route.
- `artifacts/hrms/src/` — React frontend

## Architecture decisions

- Token-based auth: Bearer tokens stored in `sessions` table with 7-day TTL. No JWT, no cookie sessions. Standard for portable deployments.
- node:crypto scrypt for password hashing — no bcrypt dependency, works everywhere Node.js runs.
- OpenAPI-first: spec gates codegen which gates the frontend. Never write types that codegen already produces.
- Multi-tenant by design: every resource is scoped to `organization_id`. Super-admin role can cross org boundaries; enforced via `canAccessOrganization`, not per-route ad hoc checks.
- Runs on any PostgreSQL-backed Node.js host, not just Replit. Two Vite plugins (`@replit/vite-plugin-cartographer`, `@replit/vite-plugin-dev-banner`) are dev-only and gated behind `process.env.REPL_ID`, so they never load outside Replit. `@replit/vite-plugin-runtime-error-modal` is a lightweight dev-time error overlay that loads unconditionally in `artifacts/hrms` and `artifacts/mockup-sandbox` — harmless outside Replit, but worth knowing it's there. `@replit/connectors-sdk` was removed from the root package (Task 1 of the 2026-07-22 stabilization pass confirmed it was never imported anywhere in application code).
- `pnpm-workspace.yaml` resolves native build binaries (esbuild/Rollup/Tailwind oxide) for both `linux-x64` (Replit) and `win32-x64`/`win32-arm64` (local Windows dev) — other platforms remain excluded to keep the lockfile small.

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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `artifacts/hrms/README.md` for the full project README including deployment portability guide
