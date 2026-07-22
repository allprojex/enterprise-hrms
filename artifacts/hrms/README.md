# Enterprise HRMS

A configurable, multi-tenant Human Resource Management System for businesses, churches, NGOs, schools, hospitals, hotels, and government institutions.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, TypeScript |
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

### Backend (`artifacts/api-server`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/dbname`) |
| `PORT` | Port the API server listens on |
| `NODE_ENV` | `development` or `production` |

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

### 3. Seed demo data (optional)

Demo credentials after seeding:

| Role | Email | Password |
|------|-------|----------|
| HR Manager | admin@acme.com | Admin@1234 |
| Employee | james@acme.com | Employee@1234 |

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
```

> Automated test suites (Jest/Vitest unit tests, Playwright e2e) are planned for a future milestone. The foundation is in place; test configuration is not yet wired.

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
- Role-based access control enforcement beyond basic auth guard
- Multi-factor authentication

---

## Recommended Next Steps

1. Add an employee directory module (CRUD for employee records)
2. Wire up a real email provider (e.g. Resend, Postmark) for password resets
3. Add role-based route guards on the backend
4. Set up Vitest for unit tests on API routes
5. Set up Playwright for end-to-end tests on auth flows
