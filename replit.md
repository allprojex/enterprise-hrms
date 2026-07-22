# Enterprise HRMS

A configurable, multi-tenant Human Resource Management System for businesses, churches, NGOs, schools, hospitals, hotels, and government institutions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from `PORT` env var)
- `pnpm --filter @workspace/hrms run dev` — run the frontend (port from `PORT` env var)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 20+, TypeScript 5.9
- Frontend: React 18, Vite, Wouter, TanStack React Query, Tailwind CSS v4, shadcn/ui
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
- `artifacts/hrms/src/` — React frontend

## Architecture decisions

- Token-based auth: Bearer tokens stored in `sessions` table with 7-day TTL. No JWT, no cookie sessions. Standard for portable deployments.
- node:crypto scrypt for password hashing — no bcrypt dependency, works everywhere Node.js runs.
- OpenAPI-first: spec gates codegen which gates the frontend. Never write types that codegen already produces.
- Multi-tenant by design: every resource is scoped to `organization_id`. Super-admin role can cross org boundaries.
- No Replit-specific services in application code — runs on any PostgreSQL-backed Node.js host.

## Product

Shell with public landing page, login/forgot-password, secure app layout (sidebar + topbar), dashboard with real summary data, user profile (view/edit), notifications, organisation selector, settings placeholder, 403/404 pages, loading and empty states. HR modules are coming-soon placeholders.

## Demo credentials (after seeding)

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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- See `artifacts/hrms/README.md` for the full project README including deployment portability guide
