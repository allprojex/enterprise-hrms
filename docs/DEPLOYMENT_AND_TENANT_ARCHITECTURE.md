# Deployment & Tenant Architecture — Master Infrastructure Foundation

**Status: Implemented/reconciled where noted; documentation-only where noted.** This document is the shared-platform deployment, hosting-lifecycle, and operational foundation every module (present and future) builds on — it is not a phase workstream. Companion documents: `docs/TENANT_DOMAINS_AND_ACCESS.md` (hostname → organization resolution, already implemented — not restated here) and `artifacts/hrms/README.md` (day-to-day dev setup, existing "Deployment Portability" section — this document extends that, it does not replace it).

**Working method, per the brief:** every item below was reconciled against existing architecture before anything was built. Almost everything here is achievable with primitives that already exist — `organizations.status`, `organization_domains`, `organization_modules`/`modules`, `organization_settings`, `audit_events`, the Reporting Foundation's CSV export, and standard PostgreSQL/filesystem operations at the infrastructure layer. Two small, additive code changes were made where a genuine, minimal gap existed (§8). Nothing else required source changes. No new database table or column was needed — **no migration was generated for this workstream; development remains at `0035`.**

---

## 1. Deployment Modes — shared, dedicated, evaluation

**Shared** (the only mode this platform runs in today): one Express process, one PostgreSQL database, many organizations, isolated entirely by `organizationId` scoping and the tenant-hostname infrastructure already documented in `TENANT_DOMAINS_AND_ACCESS.md`. WWM and Acme both run this way.

**Dedicated**: the same, unmodified application and schema, deployed to a customer's own VPS against their own PostgreSQL database, serving exactly one organization (or a small private group). No code branch exists for this — a dedicated deployment is a *deployment topology* decision (§5), not an application-layer mode. The same `organizations`/`organization_domains`/`organization_modules` rows exist in that database; they simply aren't shared with anyone else's.

**Evaluation**: reuses the existing `organizations.status` lifecycle (`trial | active | suspended`) that has existed since Foundation — no new field. A prospective customer's organization is created with `status: "trial"` (already the schema default); a platform super-admin promotes it to `active` (existing `POST /organizations/:id/reactivate`-style flow) once a commercial decision is made, or to `suspended` if the evaluation lapses or is declined. This is why item 2 needed no new lifecycle model: it already existed, one level up from where this workstream was looking.

**No mode flag was added to `organizations`.** Which physical deployment currently serves a given tenant is deployment-topology information (which VPS, which database connection string), not tenant data — it doesn't belong inside any single tenant's own database, shared or dedicated. It is tracked operationally (§16, "platform operator's own record"), not in-app.

---

## 2. Hosting Ownership & Reversibility

**Software-owner hosted** (default): the platform owner (you) operates the shared Hostinger VPS, the shared Supabase/PostgreSQL database, and DNS for the platform's own base domain and `platform_subdomain` testing hostnames. This is the only mode WWM and Acme use today.

**Customer self-hosted / dedicated**: the customer (or their own infrastructure team) operates their own VPS, database, and `custom_domain`. The application and schema are identical — see §5's migration boundary for exactly how a tenant moves between the two.

**Reversible by construction, not by a special mechanism**: because a dedicated deployment is just "the same schema, a different database," moving back to shared hosting is the same `pg_dump`/`pg_restore` (or equivalent) procedure run in the opposite direction (§5), not a one-way door requiring new tooling. Nothing in the schema or application encodes "this organization can never come back" — there is no such flag to unset.

---

## 3. Private Repository — deployment/release model

The application already lives in a private GitHub repository (this one) with `main` as the deployable branch; every commit in this session followed the existing convention (`git push origin main`, no force-push, no history rewriting). Deployment to any target — shared or dedicated — is: `git clone`/`git pull` the private repo (with deploy-key or PAT access, never a public checkout), `pnpm install --frozen-lockfile`, build (`pnpm run build`), run. No CI/CD pipeline, container registry, or automated deployment trigger exists or was built here — deployment is currently a manual, documented procedure (`artifacts/hrms/README.md`'s existing Docker/VPS sections), which matches the brief's exclusion of automatic provisioning. Each dedicated customer's deployment pulls from the **same** private repository — there is no per-customer fork, matching CLAUDE.md's "One Shared Foundation."

---

## 4. Customer Customization — entitlement, configuration, extension

All three already exist as distinct, reused primitives — no new model was needed:

- **Entitlement** (which modules a tenant may use): `modules` (the platform-wide registry, `status: hidden|beta|active`) × `organization_modules` (the per-organization enable/disable override, falling back to `defaultEnabled`) — enforced everywhere by `requireModuleEnabled`. This is the complete answer to "customer feature/module entitlement boundary." A dedicated customer's deployment has the exact same registry; entitlement is still per-organization, not per-deployment, so a dedicated single-tenant deployment still meaningfully uses this table (it just has one organization row instead of many).
- **Configuration** (how an enabled module behaves for one tenant): `organization_settings`, namespaced JSON validated per-namespace by `services/organizationConfig.ts` (`general`, `terminology`, `attendance`, …), the Organization Configuration Engine. Terminology, workflow rules, business rules all route through here — never a schema change per customer.
- **Extension** (tenant-specific master data): `master_data_domains`/`master_data_items` — configurable categories/lists (document categories, custom classifications) without touching code. This is the primitive the future File/Document module's "configurable document categories" (per `TENANT_DOMAINS_AND_ACCESS.md` §12) will reuse.

No customer gets bespoke application code. A customization need that these three primitives can't express is a product/roadmap decision (a new configuration namespace, a new module), never a per-customer code fork — this is the same "configuration before custom code" principle CLAUDE.md states as a core rule, reconciled here rather than restated as something new.

---

## 5. Migration & Portability Boundaries

All three directions below share one mechanism — there is exactly one, not three:

**The mechanism**: a PostgreSQL logical dump/restore (`pg_dump`/`pg_restore`, or the hosting provider's equivalent — Supabase's own backup/restore tooling for a shared→managed move) of the *entire* target database, followed by pointing that database's `DATABASE_URL` at the new deployment and its `organization_domains` custom hostname at the new host's DNS/Nginx. Nothing bespoke was built because nothing bespoke is needed: the schema is already fully portable Postgres DDL (the migrations in `lib/db/drizzle/`), and every table is already `organizationId`-scoped, so a whole-database dump is also, trivially, a complete single-tenant dump whenever the target database serves exactly one organization (the dedicated case).

- **Hosted → dedicated**: dump the shared database filtered to the one organization's rows (every table already carries `organizationId` or a foreign key chain back to one — this is the same isolation property `TENANT_DOMAINS_AND_ACCESS.md` documents for request-time isolation, reused here for data-time isolation), restore into the customer's new, empty database, run outstanding migrations if the source was behind, create the `custom_domain` row there, update DNS.
- **Dedicated → hosted**: the reverse — dump the customer's single-tenant database in full, restore its rows into the shared database (new-organization import, same shape as onboarding a brand-new tenant, since the dedicated DB's schema is identical), reassign the hostname.
- **Provider → provider** (e.g. one VPS host to another, still dedicated): a full database dump/restore plus a filesystem copy of the deployment directory — no application data lives outside PostgreSQL today (no object storage yet, §7), so this is the simplest of the three.

**Explicitly not built** (per the brief): automatic VPS provisioning, automatic DNS transfer, a self-service "migrate my tenant" button, or any tool that performs the above without a human operator running it deliberately. This is a documented, supervised, platform-admin-executed procedure — not a product feature yet.

---

## 6. Backup Architecture

> ### ⚠️ Correction (WS-17 Pass 0, 2026-08-31): this section is out of date
>
> The sentence below — *"Database backup is the entire backup surface today —
> there is no object storage and no other stateful store"* — was true when
> written and is **no longer true**. This document's own "Future object-storage
> backup boundary" note predicted the dependency; it has since arrived, and in
> a form the note did not anticipate.
>
> **WS-5 Documents & Records shipped, and its binaries live on a local
> filesystem, not object storage.** `lib/fileStorage.ts` writes authoritative
> business data — employee and organization documents, background-check and
> performance evidence, candidate résumés, generated PDFs, avatars, bulk-import
> source files — under `UPLOADS_DIR`. **Twelve modules** write through it, and
> **ten tables** hold storage keys.
>
> Two consequences follow, and neither is optional:
>
> 1. **A PostgreSQL backup is no longer a complete backup.** The predicted
>    mitigation ("most such providers offer versioning/replication natively")
>    does not apply, because there is no provider — it is a directory.
> 2. **`UPLOADS_DIR` must point at storage that survives container
>    replacement.** Until WS-17 Pass 0, no deployment artifact set it: the
>    Docker image defaulted to `<cwd>/uploads` = `/app/uploads`, inside the
>    container's own writable layer, with no volume declared anywhere.
>
> **Pass 0 fixed the persistence half only.** The image now defaults
> `UPLOADS_DIR` to `/var/lib/hrms/uploads` and `docker-compose.yml` mounts a
> named volume there for **both** the `app` and `worker` services (the worker
> genuinely reads uploaded files — its bulk-import adapters call `readOrgFile`).
>
> **PERSISTENCE IS NOT BACKUP.** A volume survives container replacement. It
> does **not** survive `docker compose down -v`, `docker volume rm`, `docker
> volume prune`, or loss of the host. **`docker compose down -v` destroys every
> uploaded document in that environment.** Treat volume-removing commands as
> destructive operations against business data.
>
> **Upgrading an existing deployment:** files already written under
> `/app/uploads` are **not moved** by this change and will not appear at the new
> path. Copy them into the mounted volume once, as a deliberate operator action,
> before serving traffic from the new image.
>
> Backing the uploads volume up remains open. **The provider-neutral storage
> foundation has since been built — see the section immediately below.**

### File storage: the provider-neutral boundary (WS-17 Pass 1)

**Storage is now an installation choice, not a hard-coded filesystem.**
`lib/storage` defines one small contract — write, read, delete, stat, health —
and two implementations behind it:

- **`filesystem`** (the default): the pre-existing behaviour, unchanged, using
  `UPLOADS_DIR` and the Pass 0 mounted volume. Development, tests and
  self-managed installations need no object storage at all.
- **`s3`**: any **S3-compatible** object store — AWS S3, MinIO, Ceph,
  Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Supabase Storage's S3
  endpoint. There is deliberately **no provider-specific adapter and no
  provider branch anywhere**; adding one would defeat the neutrality.

Selected by `STORAGE_BACKEND`. This is an **installation/environment**
decision: never a tenant setting, never per-organization, never user-selectable
— making it tenant-selectable would require storage credentials to become
tenant data. Selecting `s3` without credentials **fails loudly at startup**
rather than silently falling back to the filesystem, because a silent fallback
would put authoritative business data somewhere the operator does not back up.

**Business modules did not change, and that is the design.** All twelve
consumers still call `writeOrgFile`/`readOrgFile`/`deleteOrgFile` with an
organization id and an opaque key. Buckets, endpoints, prefixes, paths,
credentials and presigned URLs never cross the boundary.

**Tenant isolation is enforced at the object layer, not by the database.**
PostgreSQL RLS protects rows; it protects no binary. The physical location is
derived server-side from `(organizationId, key)`, so a key alone cannot address
another tenant's bytes, and traversal or malformed keys are **rejected rather
than normalized** — quietly cleaning them up would hide both a bug and an
attack.

**Storage access is not authorization.** Every private read still goes through
the application's own permission checks, and the backend issues **no public
objects and no presigned URLs**. The organization logo — the platform's one
publicly-readable class — needs none: its route reads the bytes server-side and
serves them itself after checking the requested key against
`organizations.logoUrl`, so it works unchanged on a fully private bucket.

**Integrity: SHA-256, honestly scoped.** Every new authoritative write records
a `stored_objects` row with the backend, size and a SHA-256 computed once from
the buffer already in memory — never by re-reading the object, and never during
a download. **Files written before Pass 1 have no row, are never backfilled,
and remain fully readable**; their integrity is reported as *unknown* rather
than fabricated. `stored_objects` holds binary persistence facts only — never
a title, owner, category, confidentiality or retention basis, all of which stay
owned by WS-5 and the module tables.

**Deletion failure is now visible.** The old `.catch(() => undefined)` made
"deleted" and "could not delete" the same outcome, so bytes could survive a
deletion forever with nothing recording it. Business semantics are unchanged
(deletion is still best-effort and still does not throw), but a real failure is
logged and recorded as `delete_failed`, and a binary orphaned by a failed
business transaction is recorded as `orphaned` — a state reconciliation can act
on, because nothing references it.

**Reconciliation and migration tooling now exists (WS-17 Pass 2)** — see
`docs/STORAGE_MIGRATION_RUNBOOK.md`. It classifies every referenced binary
(healthy, historical/unregistered, missing, orphan, checksum mismatch,
migration pending/verified/failed), registers historical files idempotently,
and copies objects between backends with a verify-then-switch protocol that
**retains the source** and preserves the opaque key, so no business record is
rewritten. It needed no schema: authority is the single `stored_objects.backend`
column, and every intermediate state is recovered by recomputing from live
storage rather than from remembered progress.

**Still open, and not claimed as done:** **no live file has been migrated** —
the tooling has only ever run against synthetic fixtures. There is no orphan
cleanup and no source deletion (the only irreversible steps, deliberately
absent), no backup or restore control plane, and no Enterprise Migration Centre. **The S3 backend existing does
not mean anything has moved to it.** A complete recovery point still requires a
database snapshot **and** compatible binary state; restoring PostgreSQL alone
does not restore the HRMS.

**Database backup** is the entire backup surface today — there is no object storage (§7) and no other stateful store. Two layers, matching how this platform is actually hosted:

- **Managed** (Supabase, the current development database's host): point-in-time recovery and automated daily backups are a platform capability of the hosting provider itself — no application code needs to trigger, schedule, or manage them. This is the default for both the shared platform deployment and any dedicated deployment a customer chooses to also host on Supabase.
- **Self-managed** (a bare VPS, dedicated or otherwise): standard `pg_dump` on a cron schedule (system-level `cron`, not an in-application job — see §12's background-job boundary for why nothing was added inside the app for this), written to storage separate from the database host itself.

**Full-system backup** = the database backup above, plus (today) the application code itself, which is already durably versioned in the private Git repository (§3) — nothing else is stateful. `.env` files (secrets) are deliberately **excluded** from any backup taken through source control (already gitignored) and should be captured separately, encrypted, by whatever secrets-management practice the operator uses — documented as a boundary here, not solved with new tooling, since building a secrets vault is out of this workstream's scope.

**Future object-storage backup boundary**: once the File/Document module exists (explicitly not built here), its object storage (Supabase Storage or an S3-compatible provider, per `TENANT_DOMAINS_AND_ACCESS.md` §12) will need its own backup story — most such providers offer versioning/replication natively. The database will only ever hold metadata/storage keys for those files (the same boundary already documented), so a database backup alone will never be a complete backup once that module ships; this document flags that dependency now so it isn't missed later.

**Retention**: not newly defined here — reuses existing discipline. `audit_events` is already append-only and never pruned by application code. Organization/employee/candidate records are already "never hard-delete" (soft status transitions — `suspended`, `revoked`, `disabled` — throughout every phase to date). Backup *retention* (how many days/weeks of point-in-time snapshots to keep) is a hosting-provider configuration choice, not an application concern, and is left to the operator's chosen provider's settings.

**Backup metadata/version compatibility**: every backup is implicitly stamped by the schema it was taken against — drizzle-kit's own `__drizzle_migrations` bookkeeping table (confirmed present and authoritative during this session's own tenant-domain migration work) records exactly which numbered migrations had been applied at backup time. A restore onto a database at a different migration state must reconcile that gap the same way `lib/db/drizzle/README.md` already documents for the historical `push`-to-`migrate` transition: apply any migrations the backup predates, or (for a genuinely mismatched restore target) treat it as a fresh `migrate` run. No new versioning scheme was invented — the existing migration ledger already *is* the version marker.

---

## 7. Restore Architecture

**Full restore** = `pg_restore` (or provider equivalent) of a whole-database backup onto a target database, then `pnpm --filter @workspace/db run migrate` to bring it current if the backup predates later migrations. This is standard PostgreSQL operation, not a custom tool — none was built, per the brief's exclusion of "one-click restore."

**Full restore vs. tenant import — the distinction the brief asks for**: a *full restore* replaces an entire database's contents (disaster recovery — the target had a problem, or didn't exist). A *tenant import* (the data-movement half of §5's hosted↔dedicated migration) adds **one** organization's rows into an *already-running*, already-populated database that other tenants also depend on — it must never overwrite or truncate anything, and every inserted row must get fresh primary keys with all foreign keys remapped consistently (the same integrity constraint `lib/db/drizzle/README.md` already calls out for the historical membership backfill script). No tenant-import tool exists yet (explicitly excluded — "full tenant-transfer engine"); this is the boundary a future one would need to respect, documented now so it isn't built the unsafe way later.

**Integrity / safety**: a restore target is never the live production database being restored *over* without an operator's explicit action — the same "never destroy existing data without explicit approval" rule this entire session has already followed for every database write (see the tenant-domain workstream's own preflight checks before touching the development Supabase project). Restoring into a database that already has rows must fail loudly (a real `pg_restore`/constraint violation) rather than silently merge or overwrite — this is PostgreSQL's own default behavior for a straightforward restore into a non-empty database, not something the application layer weakens.

**Restore testing**: not automated (no tooling was built to do this), but the *procedure* is stated so it isn't skipped: after any restore, run `drizzle-kit migrate` (confirms schema currency — exactly the reconciliation performed live during the tenant-domain migration work) and the full backend test suite against the restored database's connection string as a smoke check before declaring the restore usable.

---

## 8. RPO / RTO

Not a new mechanism — a target, documented against the backup cadence already described in §6:

- **RPO (Recovery Point Objective)**: bounded by backup frequency. Managed/Supabase point-in-time recovery: effectively minutes (continuous WAL-based recovery, a provider capability). Self-managed cron `pg_dump`: bounded by the cron interval chosen (a daily cron ⇒ up to 24h of data loss in the worst case) — this is an operator configuration decision, not a fixed number this document can promise across every possible deployment.
- **RTO (Recovery Time Objective)**: dominated by the manual `pg_restore` + `drizzle-kit migrate` + smoke-test procedure in §7, plus DNS propagation if the restore target is a new host. No number is promised here either, since no automated restore tooling exists to make one measurable — this is deliberately honest rather than a fabricated SLA.

---

## 9. Operational Foundation

**Environment separation**: already achieved entirely through environment variables (`DATABASE_URL`, `NODE_ENV`, `CORS_ORIGIN`, per `.env.example`) — development, staging, and production are different `.env` files pointing at different databases, never a schema or code branch. Nothing new was needed.

**Health / readiness — the one genuine code gap this workstream filled** (§ below, "Implementation"): `GET /healthz` (liveness — is the process up) and the new `GET /readyz` (readiness — can this instance reach its database) are now distinct, matching the standard liveness/readiness split every orchestrator (Docker, Kubernetes, a VPS process manager) expects. Previously only a static "ok" existed, with no way to distinguish "the process crashed" from "the database is unreachable" — an important distinction for both single-VPS and future dedicated deployments, and cheap enough to add now rather than leave undocumented.

**Observability / logging**: already structured — Pino + `pino-http`, redacting `Authorization`/`Cookie`/`Set-Cookie` by default (`lib/logger.ts`), used consistently across every route including the new tenant-resolution failure logging from the prior reconciliation (`773bdb5`). No new logging framework was introduced; `resolveTenantHost`'s own error path is the newest example of the existing convention, not a parallel one.

**Background-job boundary**: **none exists in this application today**, and none was added — per the explicit exclusion of "complex queue platform." Everything that might eventually need one (backup scheduling, evaluation-expiry sweeps, future notification digests) is documented here as *external* to the app (system cron, the hosting provider's own scheduler) rather than built as an in-process job runner. If an in-app job system is ever justified, it should be scoped as its own workstream — this document only draws the boundary, per the brief's own "identify what needs source changes vs. documentation" instruction resolving to "documentation" here.

**Data retention / offboarding**: reuses `organizations.status = "suspended"` (already the mechanism `resolveTenantByHostname` already treats as "this tenant fails to resolve" — see `TENANT_DOMAINS_AND_ACCESS.md` §5) as the offboarding action — data is retained, never deleted, exactly like every other "soft" lifecycle transition in this codebase. A genuine hard-delete (e.g., a regulatory erasure request) remains a manual, supervised database operation an operator performs deliberately — not a self-service button, matching CLAUDE.md's data-safety rules.

**Customer data export boundary**: the Reporting Foundation's existing CSV export (`GET .../reports/:key/run?format=csv`, `text/csv`, `Content-Disposition: attachment`, established W17/ADR-016, reused unchanged by every reporting workstream since including Recruitment's W61) already gives every tenant admin self-service export of every reportable dataset. What does **not** exist, and was not built here: a complete raw-table export (every row of every table for an organization, not just report views) — that is the same "tenant import" data shape from §7 run in reverse, and belongs with a future tenant-portability workstream, not invented ad hoc here.

**Release / version identification**: `GET /healthz` now reports `version`, sourced from an optional `RELEASE_VERSION` (or `GIT_COMMIT_SHA`) environment variable set at deploy time. Unset, it honestly reports `"unknown"` rather than fabricating a value — there is no build pipeline in scope to inject one automatically yet.

**Deployment / update / rollback strategy**: not a new mechanism — `git pull` to a target commit, rebuild, restart the process (the same manual procedure §3 describes), `git checkout` to a prior commit for rollback. Every migration already has a hand-authored `.down.sql` (established since `0000`, followed for `0035`), so a schema rollback is symmetric with the code rollback when one is needed. No blue/green or zero-downtime tooling was built — out of scope for a single shared VPS today.

---

## 10. Definition of Done — extended for infrastructure interaction

CLAUDE.md's existing "Definition of Complete" (schema, migration, API, permission enforcement, validation, OpenAPI spec, generated clients, frontend UI, CRUD, organization isolation, audit logging, tests, documentation) is **not superseded** — every future module (Attendance, File/Document, Performance, Learning, Assets, Manager Portal) still owes all of it. This workstream adds exactly three infrastructure obligations, each satisfied automatically by reusing what already exists rather than anything module authors need to build themselves:

1. **Tenant isolation is inherited, not reimplemented.** Any new module's org-scoped routes composing `requireMembership` (the standard, established pattern) automatically pick up the hostname-consistency guard and its fail-closed behavior from `773bdb5` — zero additional code.
2. **Entitlement is inherited.** Composing `requireModuleEnabled("<new-module-key>")` is the entire integration point with §4's entitlement model — register the module in the `modules` registry (as every module to date already has) and it is immediately shared/dedicated/evaluation-compatible with no further work.
3. **New schema stays backup/restore-safe.** Additive-only migrations with a matching `.down.sql` (the standing rule since `0000`, unchanged here) keep every future module compatible with the whole-database backup/restore model in §§6–7 — a new module's tables are backed up and restored for free as part of the same database, never a special case.

---

## Implementation (the two genuinely necessary code changes)

Everything above this line needed no source change. Two small, additive ones were made, both inside the existing health-check surface:

- `GET /healthz` — unchanged shape, one new optional field: `version` (release identification, §9).
- `GET /readyz` — new route: `{status: "ready"|"not_ready", database: "ok"|"error"}`, `200`/`503`. Checks database reachability via a single `SELECT 1` against the existing connection pool (`pool.query`, `@workspace/db`) — never touches tenant data, never affects `/healthz`'s own liveness contract.

No new table, column, or migration. `lib/api-spec/openapi.yaml` gained the `ReadinessStatus` schema and the `/readyz` path; `@workspace/api-zod`/`@workspace/api-client-react` were regenerated (byte-identical across two consecutive runs). Focused tests (`health.test.ts`): liveness unaffected by database reachability, version fallback to `"unknown"`, readiness `503` against the test suite's genuinely-unreachable placeholder database, readiness `200` with the pool's `query` method temporarily replaced to simulate a healthy database (no real connection opened, matching this suite's existing "no live database" convention throughout).
