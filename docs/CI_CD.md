# CI/CD, Docker & Security Foundation (WS-1)

Status: **Implemented.** This is the Engineering & Security Foundation workstream from `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20 (WS-1) — the first implementation workstream after the Owner architecture freeze. Scope: CI on every PR, baseline automated security scanning, a Docker/containerized foundation for the API server, and the already-identified CSV formula-injection fix. No HR feature, schema, permission, module, or WWM-specific change was made to deliver this.

---

## 1. Continuous Integration

Workflow: `.github/workflows/ci.yml`. Triggers on every pull request targeting `main` and every push to `main`.

### Required checks (for future branch-protection configuration)

Branch protection was **not** configured by this workstream (no GitHub repository settings were changed — WS-1 is documentation/code only). Once an Owner/admin enables "Require status checks to pass" on `main`, these are the exact job names to require:

- `Typecheck`
- `Backend tests`
- `Frontend tests + lint`
- `Production build`
- `DB schema drift check`
- `OpenAPI codegen drift check`
- `Dependency / SCA scan`
- `Secret scan (gitleaks)`
- `SAST (CodeQL)`

### What each job does, and its exact local equivalent

| Job | Local equivalent |
|---|---|
| Typecheck | `pnpm install --frozen-lockfile && pnpm run typecheck` |
| Backend tests | `pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run test` |
| Frontend tests + lint | `pnpm --filter @workspace/hrms run test && pnpm --filter @workspace/hrms run lint` |
| Production build | `pnpm run build` |
| DB schema drift check | `pnpm --filter @workspace/db run generate` then `git status --porcelain lib/db/drizzle` must be empty |
| OpenAPI codegen drift check | `pnpm --filter @workspace/api-spec run codegen` then `git status --porcelain lib/api-client-react lib/api-zod` must be empty |
| Dependency / SCA scan | `pnpm audit --json > audit-result.json; node tools/ci/check-pnpm-audit.mjs < audit-result.json` |
| Secret scan | `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source=/repo --redact --exit-code 1` |
| SAST | CodeQL — no simple single-command local equivalent; the workflow runs `github/codeql-action/init` + `analyze` |

None of these jobs require a live database, a real `RESEND_API_KEY`, or any other production credential. `DATABASE_URL` is set to a placeholder value at the workflow level purely to satisfy `@workspace/db`'s unset-check at import time (see `lib/db/src/index.ts`) — no job ever opens a real connection with it (backend tests mock `@workspace/db` entirely, per `artifacts/api-server/src/test/setup.ts`'s existing convention; `drizzle-kit generate` only diffs local schema files against the committed migration journal, never a live database).

### Parallelization and caching

All nine jobs run independently and in parallel — none declares a `needs:` dependency on another, since none of their outcomes depend on another's. Each job caches the pnpm store via `actions/setup-node`'s built-in `cache: pnpm`, keyed on `pnpm-lock.yaml`; every job still runs `pnpm install --frozen-lockfile` itself (deterministic install, no mutable generated artifacts cached). A `concurrency` group cancels a superseded run on the same branch/PR rather than letting stale and fresh runs race.

### CI/CD security posture

- Top-level `permissions: contents: read` — no job holds write access to the repository, PRs, or GitHub's code-scanning API (the CodeQL job explicitly disables SARIF upload, so it never needs `security-events: write`).
- No job deploys anything, and no job holds or references a production credential of any kind — this workflow contains zero `secrets.*` references.
- No PR event metadata (title, body, branch name, etc.) is interpolated into any `run:` shell command — the classic GitHub Actions script-injection vector — because no step needs any.
- Actions are pinned to major-version tags (`@v4`, `@v3`) rather than full commit SHAs. **Known limitation, disclosed rather than silently accepted**: SHA-pinning is stronger supply-chain hygiene than tag-pinning (a compromised upstream tag can't be re-pointed under a pinned SHA) and should be adopted as a fast-follow once specific commit SHAs for the pinned actions have been verified against their publishers — not done in WS-1 to avoid guessing exact hashes without the ability to verify them.

---

## 2. Dependency / SCA scan policy

`pnpm audit` exits non-zero for **any** finding of **any** severity — enforcing that directly would make CI permanently red on a real-world Node/TypeScript monorepo (an "impossible to maintain zero-warning policy" the frozen architecture explicitly warned against). The approved WS-1 policy, enforced by `tools/ci/check-pnpm-audit.mjs`:

- **CRITICAL** findings **fail the build**. None are silently ignored, ever.
- **HIGH / MODERATE / LOW / INFO** findings are always printed in full in the job log, every run — never hidden — but do not fail the build.

### Findings present when this gate was written (2026-08-25)

`pnpm audit --json` reported **0 critical, 9 high, 8 moderate, 1 low**. Every finding was individually triaged for production reachability (not blindly accepted):

**Production-reachable — tracked as an urgent, standing follow-up (Security Verification track), not fixed in WS-1:**
- `sharp` (direct runtime dependency, used for image processing on uploaded profile pictures/asset evidence) — HIGH, inherited libvips CVEs, patched `>=0.35.0`. Not bumped here: a `0.34→0.35` jump on a native-binding image library needs its own dedicated regression pass (upload/re-encode/EXIF-strip behavior for every consumer) that WS-1's scope explicitly excludes ("do not blindly upgrade dependencies... unless regression safety can be proven").
- `ip-address` (transitive, via the direct dependency `express-rate-limit`) — HIGH/MODERATE, SSRF/trust-boundary-bypass-shaped findings in IP parsing, patched `>=10.3.1`/`>=10.2.2`/`>=10.2.1`. Same reasoning: not bumped without a scoped regression pass on rate-limiting/trust-proxy behavior.

**Dev/build-tooling only — no production runtime exposure, lower urgency:**
- `js-yaml` (HIGH, via `orval`, the OpenAPI codegen tool — build-time only)
- `brace-expansion` (HIGH, via `eslint`'s `minimatch` — dev/lint-time only)
- `undici` (HIGH, via `vitest`/`jsdom` — test-time only)
- `fast-uri` (HIGH, via `orval`'s OpenAPI parser — build-time only)
- `nanoid` (HIGH, via `vitest`/`vite`/`postcss` — test-time only)
- `esbuild`, `postcss` (MODERATE/LOW, dev-server-only advisories, not applicable to the production `esbuild.build()` bundling path this project actually uses)

This triage is recorded in `tools/ci/check-pnpm-audit.mjs`'s own `KNOWN_PRODUCTION_REACHABLE` set (currently `sharp`, `ip-address`) so the two production-reachable findings are visibly flagged in every CI run's output, not just in this document. **Next owner action**: schedule a dedicated, regression-tested `sharp` and `express-rate-limit`/`ip-address` upgrade as part of the Security Verification workstream (WS-18), not as an ad hoc CI-log-triggered bump.

---

## 3. Secret scanning

`gitleaks` (OSS CLI, run directly via its official container image — `zricethezav/gitleaks:latest` — rather than a GitHub Marketplace wrapper action, specifically to avoid any dependency on that action's own licensing terms for private repositories). Scans full commit history on every run (`fetch-depth: 0`), with `--redact` so no discovered secret value is ever printed to logs or the uploaded report — only its file location and rule ID. Fails the build (`--exit-code 1`) on any confirmed finding.

**Before writing any part of this workstream, the repository was inspected for obvious committed credentials** (per the master review's own §12 finding: `.env.example` contains only placeholders, `.env`/`.env.*` are gitignored, a targeted grep for hardcoded-secret patterns returned zero hits). No live credential was found or is disclosed anywhere in this documentation.

---

## 4. SAST

CodeQL (`github/codeql-action`), `javascript-typescript` language pack — the natural baseline for this stack per the frozen architecture's own guidance, and the smallest sensible set (no second, overlapping SAST tool was added for appearance).

**Known limitation, disclosed**: the workflow runs `analyze` with `upload: false`. Uploading SARIF results to GitHub's Security/code-scanning tab requires **GitHub Advanced Security** to be enabled for **private** repositories — a plan/licensing fact this workflow has no way to verify or enable for itself. Rather than risk every CI run failing on the upload step for a reason unrelated to code quality, analysis runs in full on every PR and its SARIF output is published as a downloadable build artifact (`codeql-results`, 14-day retention) instead. Once this repository's GitHub Advanced Security status is confirmed, flip `upload: false` to `upload: true` (or remove the line — `true` is the action's own default) in `.github/workflows/ci.yml` to get results directly in the Security tab.

DAST (e.g. OWASP ZAP) and manual penetration testing are explicitly **out of WS-1's scope** — they belong to the dedicated future Security Verification Workstream (WS-18) per the frozen architecture, and are never run against ordinary PR CI or any live environment by this workflow.

---

## 5. Docker

### What's containerized, and what isn't

Only the **API server** (`artifacts/api-server`) is containerized. The frontend (`artifacts/hrms`) builds to a static `dist/public/` directory that this project's own documented deployment topology (`artifacts/hrms/README.md`'s "Deployment Portability" section) serves separately via a reverse proxy/CDN — consistent with the API server's own `helmet` CSP (`default-src 'none'`), which is only safe because the API never serves the frontend document itself. Containerizing the static frontend build (an nginx image copying `dist/public/`) is a natural, low-risk follow-up, not done here.

### Base image choice

`node:20-bookworm-slim` (Debian, **glibc**) — deliberately **not** `-alpine` (musl). This is a repository-evidence-driven choice, not a default: `pnpm-workspace.yaml`'s own `overrides` section prunes the **musl** variants of this workspace's native build tools (`lightningcss-linux-x64-musl`, `@tailwindcss/oxide-linux-x64-musl`) while explicitly keeping the **glibc** `linux-x64` variants, with the file's own comment stating "production deploys target linux-x64." The committed lockfile is already built for a glibc Linux target. Building on Alpine would fight that existing, deliberate platform choice. This was verified empirically, not just inferred: `sharp`'s native binary installed and worked correctly against `node:20-bookworm-slim` in local testing for this workstream (see §7 below).

### Image contents and size

Multi-stage build: `base` (pnpm via `corepack prepare pnpm@9.15.0 --activate`, matching the exact locally-verified pnpm version) → `build` (full workspace install + `pnpm --filter @workspace/api-server run build`, producing a single self-contained esbuild bundle, `dist/index.mjs`) → `prod-deps` (a second, independent `pnpm install --frozen-lockfile --prod --filter "@workspace/api-server..."` — scoped to just this package's own production dependency graph, not the whole workspace) → `runtime` (fresh base image, copies only the built `dist/`, the scoped `node_modules`, and `artifacts/api-server/package.json`; non-root `node` user; no pnpm, no TypeScript, no dev dependencies, no `.env` file).

`api-server`'s own esbuild bundle (`build.mjs`, `bundle: true`) inlines every first-party workspace package (`@workspace/db`, `@workspace/api-zod`) and every bundleable npm dependency directly into `dist/index.mjs` — verified locally that the container runs correctly without `lib/*` source present at all. The one genuinely native, externalized runtime dependency actually present in this project today is `sharp`; the runtime `node_modules` only needs to satisfy that (plus whatever it transitively pulls in), which the scoped `--filter` install provides. Final image size: ~516MB (mostly Debian base + `sharp`'s native binary + its dependency closure) — a reasonable, not minimal, runtime image; further slimming (e.g. `pnpm deploy`, a distroless base) is a legitimate future optimization, not attempted here to avoid guessing at pnpm/Docker interactions not already verified.

### Environment interface (no secret values — see `.env.example` for the full list)

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | **Required** — the process throws at startup if unset | PostgreSQL connection string |
| `PORT` | Optional (defaults to 3001) | Port the API server listens on |
| `NODE_ENV` | Optional | `development` \| `production` |
| `CORS_ORIGIN` | Optional | Comma-separated allowed origins; unset allows all (a real warning is logged in production if unset — verified in local testing, see §7) |
| `APP_BASE_URL` | Optional | Used to build links in transactional email |
| `RESEND_API_KEY` | Optional | If unset, email sends are silently no-op'd (deliberate — prevents account-enumeration via email-failure signals) |
| `EMAIL_FROM_ADDRESS` | Optional | Verified Resend sender address |
| `RELEASE_VERSION` (or `GIT_COMMIT_SHA` as a fallback name) | Optional | Surfaced by `GET /api/healthz` for deploy verification; reports `"unknown"` rather than fabricating a value if unset — verified in local testing |

None of these are baked into the image at build time — every value is supplied at container-start time by whatever deploys the image (a future VPS Automation script, a Compose file, an orchestrator's secret store). The image is identical for every organization/tenant and every deployment topology; nothing customer-specific is embedded anywhere in the `Dockerfile`.

### Health / readiness

The real endpoints are `GET /api/healthz` and `GET /api/readyz` (both under the `/api` prefix — confirmed by reading `artifacts/api-server/src/routes/index.ts` and `health.ts`, and by testing the built image directly). They are deliberately different checks, not interchangeable:

- **`/api/healthz` — liveness.** Never touches the database. Answers "is the process itself up and serving requests." The Docker `HEALTHCHECK` in this workstream's `Dockerfile` checks this endpoint, on the same reasoning `health.ts`'s own code comment gives: an orchestrator should restart a process that fails *this* check, but a database outage must never look like a reason to kill an otherwise-healthy process.
- **`/api/readyz` — readiness.** Runs `SELECT 1` against the database and reports `503`/`not_ready` if it fails, `200`/`ready` if it succeeds. A load balancer or orchestrator should route traffic based on *this* check (stop sending traffic, don't restart the process), not the container `HEALTHCHECK`.

### Migration boundary

Migrations are **never** run automatically on container start or restart — every replica restarting is not a schema-mutation event. The intended release shape:

```
Verified Release Image → Environment/Secrets → Migration → Container Start/Update → Health/Readiness → Smoke Test
```

`pnpm --filter @workspace/db run migrate` is a separate, explicit step, run once per release (from a deploy host, a one-shot init container, or a future VPS Automation script — not decided here, out of WS-1's scope) against the target database, before the new container image is started/rolled out. This was verified directly in local testing (§7): migrations were applied from the host against a real Postgres container while the app container was not yet running, then the app container was started separately and confirmed ready.

### Compose (local development / manual validation only)

`docker-compose.yml` at the repo root brings up the API server plus a throwaway local Postgres, purely as a development/testing convenience — **not** the production topology (production points `DATABASE_URL` at an externally managed database: Supabase, a managed RDS/Cloud SQL instance, or a customer's own dedicated database, per `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`; this file does not attempt to reproduce that as a container). It does not run migrations automatically — see the file's own header comment for the one-line command to run them against the Compose-managed database.

### VPS Automation compatibility (future workstream, not built here)

This image is a self-contained, environment-variable-configured artifact — exactly the shape a future VPS Automation workstream needs to consume: pull/verify the image, inject environment/secrets, run the migration step, start/replace the container, poll `/api/readyz`, run a smoke test, only then cut traffic over. Nothing in WS-1 builds that automation itself (explicitly out of scope) — this section documents the target shape so that future workstream doesn't have to re-derive it.

---

## 6. CSV formula-injection hardening

### Root cause

The Master Owner Review identified that this platform's shared CSV export helper (`lib/reporting.ts`'s `toCsv`) escaped only quotes/commas/newlines, not a leading `=`, `+`, `-`, `@`, tab, or carriage return — the character set a spreadsheet application (Excel, Google Sheets, LibreOffice) treats as "this cell is a formula," letting a malicious free-text value (e.g. a candidate or employee name field containing `=HYPERLINK(...)`) execute when the exported CSV is opened. Two routes had **already**, independently, fixed this for themselves: `officeInventoryReporting.ts` and `payrollPaymentBatches.ts`, both with a `safeCsvCell` helper applying a leading `'` guard. Every other CSV-producing route had its own **local, unhardened copy** of the same vulnerable logic, each explicitly self-disclosing the gap in its own code comments (a repo-wide, self-aware, but unfixed pattern).

### What was actually vulnerable (verified by reading every file, not assumed)

`lib/reporting.ts`'s `toCsv` (used directly by `routes/reports.ts`), and six further local copies in `routes/assetReporting.ts`, `routes/attendanceReporting.ts`, `routes/learningReporting.ts`, `routes/payrollReports.ts`, `routes/performanceReporting.ts`, `routes/personnelReporting.ts`, `routes/recruitmentReporting.ts` — **7 files, 8 call sites** (`reports.ts` imports the shared one).

`routes/officeInventoryReporting.ts` and `routes/payrollPaymentBatches.ts` were **already safe** and were **not modified** — WS-1's scope is "fix only demonstrated vulnerable paths," not refactor already-correct code for its own sake. `routes/legacyImport.ts`'s CSV endpoint was checked and found **not vulnerable**: it serves a fixed, hardcoded template (headers + one static example row), never user/tenant data.

### Fix

`lib/reporting.ts` is now the **one shared** `safeCsvCell`/`toCsv` primitive for the whole platform. Its guard logic matches the already-proven `officeInventoryReporting.ts`/`payrollPaymentBatches.ts` precedent (a leading `'` on any cell whose *string* form starts with `=`, `+`, `-`, `@`, a tab, or a carriage return), with one deliberate refinement: a genuine `number`-typed cell is **never** guarded, even if negative (e.g. `-42` exports as the plain numeral `-42`, not `'-42`) — only `string`/`boolean` values are tested against the dangerous-leading-character pattern, since a `number` can never itself be a formula-injection vector and guarding it would only strip its numeric type in the resulting spreadsheet for no security benefit. This refines, rather than copies byte-for-byte, the older precedent (which did not make this type distinction) — the older precedent's own two files were left untouched, not retroactively changed.

All 7 previously-vulnerable files now import `toCsv` from `../lib/reporting` and no longer define their own local copy.

### Regression tests

`artifacts/api-server/src/test/csvSafety.test.ts` — permanent unit tests directly against the shared `safeCsvCell`/`toCsv` functions (no HTTP/DB mocking needed, since the security property lives entirely in this one function and every CSV-producing route now calls it). Covers: each dangerous leading character (`=`, `+`, `-`, `@`, tab, CR) gets guarded; ordinary text is untouched; a real `number` (including a negative one) is never guarded; a string that merely *looks* numeric-negative (e.g. `"-42"`) is still guarded (the documented, accepted conservative trade-off); quoting/escaping still composes correctly with the guard; `null`/`undefined` render as empty; the underlying row objects passed to `toCsv` are never mutated (the fix is CSV-serialization-only, JSON/API responses built from the same row data are unaffected). All existing reporting test suites (`reports.test.ts` and the seven per-module reporting test files, 210 tests total across CSV-adjacent files) were re-run and pass unchanged, confirming the refactor didn't alter any legitimate report's output.

---

## 7. What was actually verified locally for this workstream

Not just written and assumed — each of the following was run and its real output inspected before this workstream was considered done:

- `pnpm run typecheck` — clean, whole workspace.
- `pnpm --filter @workspace/api-server run test` — **127 test files, 2305 tests, all passing** (full backend suite, not just the CSV/reporting-adjacent ones).
- `docker build` — succeeded; `sharp` installed its native binary correctly against `node:20-bookworm-slim` (confirming the glibc base-image choice was correct, not just theorized).
- Container started with `DATABASE_URL` unset → failed immediately with a clear, loud error (`DATABASE_URL must be set. Did you forget to provision a database?`), never a silent hang or an unclear crash.
- Container started with an unreachable placeholder `DATABASE_URL` → started successfully, logged a real "CORS_ORIGIN is not set in production" warning (existing app behavior, working as designed), `GET /api/healthz` returned `200 {"status":"ok"}`, `GET /api/readyz` returned `503 {"status":"not_ready","database":"error"}` — the liveness/readiness distinction behaves exactly as documented, not just as claimed.
- A real, throwaway `postgres:16-alpine` container was started; `pnpm --filter @workspace/db run migrate` was run **from the host** against it (confirming the migration-boundary separation actually works, not just as a stated intention); the app container was then pointed at that database and `GET /api/readyz` returned `200 {"status":"ready","database":"ok"}`.
- `RELEASE_VERSION` environment variable passthrough confirmed: `GET /api/healthz` reflected the exact value supplied at `docker run` time.
- Confirmed non-root: `docker exec ... whoami` → `node`, `id` → `uid=1000(node)`.
- A real, protected API route (`GET /api/reports`) returned `401 Unauthorized` with no session — confirming the container serves genuine application routing and authorization middleware, not just the two health endpoints.
- `docker compose config -q` validated the Compose file's syntax; `docker compose up` was run end-to-end (app + a local Postgres, wired via the Compose-internal `db` service hostname rather than `host.docker.internal`), confirming `depends_on: condition: service_healthy` correctly gates app startup on the database's own healthcheck, and that `/api/healthz`/`/api/readyz` behave identically over the Compose network as they did under plain `docker run`.
- The GitHub Actions workflow YAML was parsed and validated for structural correctness (9 jobs, correctly keyed) via an external YAML parser, since this environment cannot execute a real GitHub Actions run; the exact shell commands each job runs were run directly on the host beforehand (schema-drift and codegen-drift checks in particular were run twice — confirmed a clean `git status` with no drift in both cases).
- `pnpm audit --json | node tools/ci/check-pnpm-audit.mjs` — run against the real, current audit output (not a synthetic fixture), confirmed correct severity counting, correct pass/fail decision (0 critical → exit 0), and correct flagging of the two production-reachable findings.
