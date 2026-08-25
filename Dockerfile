# WS-1 (Engineering & Security Foundation) — production container for the
# API server (`artifacts/api-server`). The frontend (`artifacts/hrms`) is NOT
# containerized here: it builds to a static `dist/public/` directory that
# this project's own documented deployment topology serves separately via a
# reverse proxy/CDN (see artifacts/hrms/README.md's "Deployment Portability"
# section and helmet's `default-src 'none'` CSP on the API server, which is
# only safe because the API never itself serves the frontend document).
# Containerizing the static frontend build is a straightforward follow-up
# (an nginx-based image copying `dist/public/`) but is out of WS-1's approved
# scope, which is the backend service every later Installation Registry
# workstream needs a real artifact to track.
#
# Base image: `node:20-*-slim` (Debian/glibc), deliberately NOT `-alpine`
# (musl). `pnpm-workspace.yaml`'s own `overrides` section prunes the MUSL
# variants of this workspace's native build tools (`lightningcss-linux-x64-
# musl`, `@tailwindcss/oxide-linux-x64-musl`) while explicitly keeping the
# glibc `linux-x64` variants ("production deploys target linux-x64" per that
# file's own comment) — i.e. the committed lockfile is already built for a
# glibc Linux target, not musl. Building on Alpine here would fight that
# existing, deliberate platform choice rather than follow it.
#
# Same image is used for every organization/tenant and every deployment
# topology (shared or dedicated) — no customer-specific configuration is
# baked in anywhere in this file; every environment-specific value comes from
# a runtime environment variable (see .env.example), never a build ARG.

ARG NODE_IMAGE=node:20-bookworm-slim
ARG PNPM_VERSION=9.15.0

# ---------------------------------------------------------------------------
# base — shared setup for every later stage: pnpm via corepack (matches the
# exact locally-verified pnpm version, not "whatever corepack defaults to").
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# build — full workspace install (dev+prod, needed for tsc/esbuild/etc.) and
# the actual production build. Deliberately copies the whole source tree in
# one layer rather than a manifests-only pre-copy for finer-grained layer
# caching — this monorepo's workspace graph spans many package.json files
# across artifacts/*, lib/*, lib/integrations/*, and scripts (per
# pnpm-workspace.yaml), and a correct, low-risk full-source COPY was chosen
# over a fragile hand-enumerated manifest COPY list for this first WS-1
# Dockerfile. Revisit only if build time on real CI hardware proves this
# costly — it has not been a demonstrated problem yet.
# ---------------------------------------------------------------------------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

# ---------------------------------------------------------------------------
# prod-deps — a second, independent install pass scoped to production
# dependencies of @workspace/api-server ONLY (`--filter ...` walks its actual
# workspace dependency graph — @workspace/db, @workspace/api-zod — rather
# than installing every other workspace package's own prod deps too, e.g.
# the frontend's React/Vite runtime dependencies, which this image never
# needs). Drops typescript/vite/esbuild/vitest/drizzle-kit/etc. from what
# ships in the final image. Kept as its own stage, not reused from `build`,
# because `build` installed dev dependencies too and pnpm does not support
# pruning an existing install down to --prod in place.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@workspace/api-server..."

# ---------------------------------------------------------------------------
# runtime — the actual shipped image. No pnpm, no TypeScript, no source
# beyond the single bundled output file, no .env file (real secrets are
# always injected as runtime environment variables by whatever deploys this
# image — never baked into a layer), non-root user.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# api-server's own esbuild bundle (build.mjs) inlines every first-party and
# bundleable dependency into one file; only genuinely native/dynamically-
# loaded packages are left external (see build.mjs's own `external` list) —
# in practice, for what this project actually depends on today, that's just
# `sharp`. Copying the pnpm workspace node_modules tree produced by the
# scoped --filter install above (root hoisted store + each package's own
# symlinked node_modules) is what makes Node's normal upward node_modules
# resolution find it at runtime without needing to hand-pick individual
# packages. `lib/*` source is NOT copied into the runtime image — it's fully
# inlined into the bundle already (verified: the container runs correctly
# without it), so shipping it again would only bloat the image; the one
# trade-off is that a production stack trace's file references (via
# --enable-source-maps) name paths like lib/db/src/index.ts that don't
# physically exist in this image — still useful for locating the problem in
# a real checkout, just not directly `cat`-able inside the container.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /app/artifacts/api-server/package.json ./artifacts/api-server/package.json

# Non-root runtime user (Debian slim images ship a low-privilege `node`
# user/group by default — reuse it rather than inventing a new one).
RUN chown -R node:node /app
USER node

# The API server itself reads PORT from the environment (defaulting to 3001
# per .env.example) — EXPOSE is documentation for the image, not enforcement.
EXPOSE 3001

# Liveness-shaped: does the process itself answer HTTP at all. Deliberately
# checks /api/healthz (never touches the database — see health.ts's own
# comment distinguishing liveness from readiness) so a database outage never
# causes an orchestrator to kill/restart an otherwise-healthy process. A
# caller that wants to gate traffic on DB reachability should probe
# /api/readyz separately (e.g. a load balancer target-group check), not this
# container HEALTHCHECK.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No automatic migration on every restart (see the migration-boundary note in
# docs/CI_CD.md — migrations are a separate, explicit release step run once
# per release, never implicitly on container start/restart of every replica).
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
