# Enterprise HRMS

A configurable, multi-tenant Human Resource Management System for businesses, churches, NGOs, schools, hospitals, hotels, and government institutions.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui components |
| Routing | Wouter |
| State / Data fetching | TanStack React Query |
| Backend | Node.js, Express 5, TypeScript |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Validation | Zod v3 |
| API contract | OpenAPI 3.1 (Orval codegen) |
| Logging | Pino + pino-http |
| Monorepo | pnpm workspaces |
| Build | esbuild (server), Vite (frontend) |

---

## Project Structure

```
artifacts/
  api-server/      # Express 5 backend — REST API
  hrms/            # React + Vite frontend
lib/
  api-spec/        # OpenAPI 3.1 spec (source of truth)
  api-client-react/ # Generated React Query hooks
  api-zod/         # Generated Zod validation schemas
  db/              # Drizzle ORM schema + client
```

---

## Required Environment Variables

See `.env.example` at the repo root for a copyable template.

### Backend (`artifacts/api-server`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/dbname`) |
| `PORT` | Port the API server listens on |
| `NODE_ENV` | `development` or `production` |
| `CORS_ORIGIN` | Comma-separated allowlist of origins permitted to call the API. Unset allows all origins (fine for local dev; set explicitly in production) |

### Frontend (`artifacts/hrms`)

| Variable | Description |
|----------|-------------|
| `PORT` | Port the Vite dev server listens on |
| `BASE_PATH` | URL prefix for the frontend (e.g. `/`) |

---

## Database Setup

The project uses Drizzle ORM with PostgreSQL.

### 1. Provision a PostgreSQL database

Any PostgreSQL 14+ instance works. Set `DATABASE_URL` to the connection string.

### 2. Push the schema

```bash
pnpm --filter @workspace/db run push
```

This creates all tables. Run this after any schema change during development.

### 3. Seed demo data (optional, development only)

Demo credentials referenced elsewhere in project docs:

| Role | Email | Password |
|------|-------|----------|
| HR Manager | admin@acme.com | Admin@1234 |
| Employee | james@acme.com | Employee@1234 |

No seed script exists in this repository yet — these are documented for
whoever adds one. **Any seed script must refuse to run when
`NODE_ENV=production`** (or equivalent), so demo credentials can never be
created in a production database.

---

## Running the App

### Development (Replit)

Workflows are pre-configured. The API server and frontend start automatically.

### Development (local)

```bash
# Install dependencies
pnpm install

# Start the API server
pnpm --filter @workspace/api-server run dev

# Start the frontend (in a separate terminal)
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/hrms run dev
```

Works on Linux, macOS, and Windows 11 (PowerShell or Git Bash) — no POSIX
shell is required for any workspace script.

### Production build

```bash
# Build the API server
pnpm --filter @workspace/api-server run build

# Build the frontend
pnpm --filter @workspace/hrms run build
```

The frontend produces a static `dist/public/` directory that can be served by any static host or CDN.

---

## API Codegen

The OpenAPI spec (`lib/api-spec/openapi.yaml`) is the single source of truth. After changing the spec, regenerate client hooks and Zod schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This generates:
- `lib/api-client-react/src/generated/` — React Query hooks for the frontend
- `lib/api-zod/src/generated/` — Zod schemas for server-side validation

---

## Testing Commands

```bash
# Full typecheck across all packages
pnpm run typecheck

# Typecheck libs only
pnpm run typecheck:libs

# Typecheck a specific package
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/hrms run typecheck

# Run backend tests (Vitest + Supertest, no real database required —
# @workspace/db is mocked)
pnpm --filter @workspace/api-server run test

# Run frontend tests (Vitest + Testing Library)
pnpm --filter @workspace/hrms run test
```

Current coverage: frontend auth-token helpers and the error boundary;
backend health check, the `canAccessOrganization`/`isSuperAdmin`
authorization helpers, and `GET /organizations/:id` authorization
(unauthenticated, same-org, cross-org, super_admin). Playwright e2e is not
set up. HR modules have no tests since none are implemented yet.

---

## Build Commands

```bash
# Full typecheck + build all packages
pnpm run build

# Build API server only
pnpm --filter @workspace/api-server run build

# Build frontend only
pnpm --filter @workspace/hrms run build
```

---

## Deployment Portability

This project has **no hard dependency on any hosting provider**. It runs on:

- **Replit** — via pre-configured workflows and managed PostgreSQL
- **Hostinger / GoDaddy / DigitalOcean / Hetzner / Linode VPS** — run the Node.js API server and serve the static frontend via nginx
- **AWS / Azure / Google Cloud / Oracle Cloud** — containerise with Docker or deploy directly to VM/PaaS
- **Docker** — wrap the API server in a Dockerfile; serve the frontend build via nginx
- **On-premise Linux/Windows servers** — the build outputs are standard Node.js and static files
- **Hybrid infrastructure** — frontend on CDN, API on any server/container runtime

### What you need on any target

- Node.js 20+
- PostgreSQL 14+ (managed or self-hosted)
- A reverse proxy (nginx, Caddy, Traefik) to route traffic to the API server and serve static files

### Windows 11 local development

`pnpm install` and all `dev`/`build`/`typecheck`/`test` scripts run under
Windows 11 (PowerShell or Git Bash) as well as Linux/macOS — no script
depends on a POSIX shell (`sh`), and `pnpm-workspace.yaml` resolves native
build tooling (esbuild, Rollup, Tailwind's oxide engine) for both
`linux-x64` and `win32-x64/arm64`.

### Docker (example Dockerfile for the API server)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @workspace/api-server run build
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
```

---

## Security

- **Login rate limiting**: `POST /auth/login` allows 10 attempts per IP per 15 minutes (`express-rate-limit`), independent of the auth model itself.
- **CORS**: configurable via `CORS_ORIGIN` (see Environment Variables above). Unset allows all origins — set it explicitly in production.
- **Security headers / CSP**: `helmet` is applied to the API server with a strict default (`default-src 'none'`), safe because this API only ever returns JSON. The frontend document itself is served separately (static host/CDN) and should set its own CSP/security headers at that layer.
- **Organization authorization**: every route that reads or writes organization-scoped data must call `canAccessOrganization`/`isSuperAdmin` from `artifacts/api-server/src/lib/authorization.ts` rather than re-implementing the role/ownership check inline.
- **Demo credentials**: no seed script exists in this repo. If one is added, it must check `NODE_ENV` and refuse to run in production.

---

## Current Status

### Features in this release (UI shell)

- ✅ Public landing page
- ✅ Login page with auth flow
- ✅ Forgot-password page
- ✅ Secure application layout (sidebar + topbar)
- ✅ Organisation selector
- ✅ Dashboard with real summary data
- ✅ User profile (view + edit)
- ✅ Notifications (list, mark read, mark all read)
- ✅ Settings placeholder
- ✅ Unauthorised (403) page
- ✅ Not-found (404) page
- ✅ Loading states and empty states

### Intentionally not implemented

- Employee directory and records
- Leave and attendance management
- Performance reviews
- Recruitment and applicant tracking
- Training and learning management
- Document management
- Payroll (out of scope)
- Email delivery (forgot-password sends no real email in this shell)
- Fine-grained role-based permissions per action (organization-ownership authorization exists; per-role feature permissions do not)
- Multi-factor authentication

---

## Recommended Next Steps

1. Add an employee directory module (CRUD for employee records)
2. Wire up a real email provider (e.g. Resend, Postmark) for password resets
3. Add fine-grained role-based permissions on top of the existing organization-authorization helper
4. Set up Playwright for end-to-end tests on auth flows
5. Add indexes on `sessions.userId`, `notifications.userId`, and `users.organizationId` before production-scale data
