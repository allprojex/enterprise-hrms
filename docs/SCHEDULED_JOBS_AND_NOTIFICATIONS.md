# Scheduled Jobs & Notifications Foundation (WS-6)

Status: **Implemented (foundation only).** This is the sixth implementation workstream from `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20/§22, implementing Owner Decision #13 (Scheduled Jobs / Notifications — "shared scheduling/notification foundation; unblocks multiple dependent capabilities"). It builds the shared platform infrastructure later HR workflows schedule reminders and deadlines through — it deliberately does **not** build those workflows.

Downstream workstreams this unblocks (per OD #13's own text, "unblocks 4+ other items"): WS-9 (Recruitment Completion), WS-10 (Onboarding/Handbook), WS-11 (Employment Lifecycle Events — acting/secondment auto-revert, contract-expiry reminders), WS-13 (Employee Data Change Approval & HR Service Requests), WS-15 (Cross-Module Visibility / HR Action Centre), and future audit-retention automation (OD #19). None of them is implemented here.

---

## 1. Reconciliation before implementation

Verified against actual repository state, not assumed from the frozen review alone:

- **Zero scheduling/queue/cron infrastructure existed anywhere** — no `cron`/`node-cron`/`agenda`/`bull`/`bullmq` in any `package.json`, no `setInterval`/`setTimeout`-based scheduling in source.
- `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md`'s own prior, still-frozen statement already anticipated this workstream: *"Background-job boundary: none exists in this application today, and none was added — per the explicit exclusion of 'complex queue platform.' If an in-app job system is ever justified, it should be scoped as its own workstream — this document only draws the boundary."*
- A `notifications` table **already existed**, fully wired end to end (routes, a working frontend bell + list page) — but a repo-wide search found **zero `.insert(notificationsTable...)` call sites anywhere in the codebase's history**. This was a live, deployed delivery surface nothing had ever written to. WS-6 extends this table rather than building a parallel one.
- Postgres-native concurrency primitives (`pg_advisory_xact_lock`, `FOR UPDATE`) were already idiomatic in this codebase (`officeInventoryLedger.ts`, `payrollPeriods.ts`, `payrollRuns.ts`, `numbering.ts`). `SKIP LOCKED` — new to this workstream — is the same family of primitive, one step further.
- No timezone-conversion library existed on the backend (`date-fns`/`luxon`/`moment`/`dayjs` all absent from `api-server`/`lib/db`'s package.json).

---

## 2. Scheduler technology decision

**DB-backed jobs, claimed by a dedicated worker process, using Postgres `UPDATE ... FOR UPDATE SKIP LOCKED`.** No Redis, no Kafka, no RabbitMQ, no queue library (BullMQ/Agenda), no cron package.

Why, grounded in the reconciliation above rather than a generic preference:

- This introduces **one new SQL clause** on top of a concurrency-control style this codebase already relies on daily — not a new architectural concept.
- Every deployment topology this platform names (shared SaaS, dedicated VPS, customer-managed) already requires Postgres. A message broker would be a **second piece of infrastructure** every one of those deployments would newly have to provision, secure, and keep available — for a workload (HR reminders/overdue checks) a polling worker against an indexed table serves comfortably.
- The prior, still-frozen architectural boundary in `docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md` already ruled out a "complex queue platform" for this product.

**The database is authoritative** (§6 of the frozen brief): a `scheduled_jobs` row survives process restart, container restart, worker crash, and deploy. Nothing about a job's existence or due state is ever held only in application memory — no `setTimeout`/`setInterval` anywhere schedules *business* work; those primitives are used only for the worker's own poll/reclaim loop cadence, never as the record of what work exists.

---

## 3. Process model — web and worker are separate commands

Per §8/§49: HTTP traffic never opportunistically runs due jobs. The web process only ever creates/updates `scheduled_jobs` rows (via `lib/scheduledJobs.ts`'s scheduling functions); only the worker process (`src/worker.ts`) ever claims and executes them.

Both are built from the **same source, in the same `esbuild` pass** (`build.mjs` now has two entry points: `src/index.ts` → `dist/index.mjs`, `src/worker.ts` → `dist/worker.mjs`), and ship in the **same Docker image** — the runtime stage already copies the whole `dist/` directory, so no second Dockerfile or build stage was needed. Run the worker from that same image with a different command:

```
node --enable-source-maps artifacts/api-server/dist/worker.mjs
```

`docker-compose.yml` (dev-only) adds a `worker` service demonstrating this. `package.json` adds a `worker` script alongside `start` for local development.

The worker's poll/reclaim/shutdown logic lives in `lib/workerRuntime.ts` as a plain, directly-unit-testable function (`createWorkerRuntime`) — `src/worker.ts` itself is a thin entrypoint wiring that runtime to real `process.env` and OS signals. This split exists because real OS signal delivery is platform-dependent in ways irrelevant to whether the shutdown *logic* is correct (Linux containers, the actual deployment target, handle `SIGTERM` normally; a Windows dev machine does not reliably deliver it to an arbitrary external process) — the live test suite proves the logic directly by calling `shutdown()`, exactly the code path a real `SIGTERM` triggers.

---

## 4. Job schema and lifecycle

One table, `scheduled_jobs`, migration `0061`, additive. Columns evaluated against the brief's own list; several were deliberately **not** split into separate columns:

- `scheduledFor` doubles as both the original due time and, after a retry, the next-attempt time — one mutable column, not two. A retry supersedes the original due time; they never coexist.
- **No separate `scheduled_job_attempts` table.** `attemptCount` + `lastAttemptAt` + `lastErrorClass` + `lastErrorMessage` is enough to answer "how many times, when last, why last failed" for operational troubleshooting — the same "keep it operational, not a duplicate audit system" reasoning the brief itself applies to the closely related dead-letter question (§26).

Lifecycle: `scheduled → running → completed | failed | cancelled`. A transient failure returns a job to `scheduled` with a later `scheduledFor` (retry-scheduled), rather than introducing a sixth status — the brief's own "a failed attempt is not necessarily a permanently failed job" and "do not create dozens of states."

`jobType` is a free-text column but is **never client-executable content**: every write path validates it against the server-side job-handler registry (`lib/jobHandlerRegistry.ts`) before a row is ever inserted, and every execution path re-validates it before dispatch. No mechanism anywhere turns database content into code.

---

## 5. Job-type registry and shipped handlers

`registerJobHandler(jobType, { parsePayload, execute, defaultMaxAttempts? })` — a plain in-memory `Map`, populated once at process startup by both entrypoints. `scheduleJob()` rejects an unregistered `jobType` immediately (fail-fast, before any row exists); `executeClaimedJob()` independently re-checks at execution time as defense in depth (a row could in principle be inserted by some other means).

Exactly **two** handlers ship with this workstream, both domain-neutral by construction:

| jobType | Purpose |
|---|---|
| `diagnostics.ping` | Proves the engine end to end with zero side effects. Never scheduled automatically for any organization. |
| `reminder.notify` | **The generic reminder primitive itself.** Delivers a notification, reliably, once, to an authorized recipient, at a time the caller chose. Contains no business rule about *what* should be reminded or *when* — WS-9/WS-10/WS-11/WS-13/WS-15 will each call `scheduleJob("reminder.notify", {...})` with their own title/message/recipient/timing decisions. |

No domain-specific reminder rule (contract expiry, probation, document expiry, leave, etc.) is implemented anywhere in this workstream.

---

## 6. Claiming, concurrency, and crash recovery

`claimDueJobs({ workerId, limit })` runs one statement:

```sql
UPDATE scheduled_jobs
SET status = 'running', locked_at = now(), locked_by = $workerId
WHERE id IN (
  SELECT id FROM scheduled_jobs
  WHERE status = 'scheduled' AND scheduled_for <= now()
  ORDER BY priority DESC, scheduled_for ASC
  LIMIT $limit
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

Two concurrent claims can never return the same job (each `SKIP LOCKED` claim only ever sees rows no other in-flight claim already holds), and different due jobs are claimed and processed independently — never serialized behind one lock. Both properties are proven live against a real Postgres database with genuinely concurrent claim calls, not mocked.

**Crash recovery** (`reclaimStaleJobs(leaseMs)`): a `running` row whose `locked_at` is older than the lease window is returned to `scheduled` so another worker can claim it. The lease is deliberately generous — the cost of reclaiming too early is a job running twice concurrently for the remainder of a merely-slow attempt; the cost of reclaiming too late is only a delayed retry. Proven live: a simulated crash (back-dating a lock past the lease) is reclaimed and the job completes correctly on the rescuing worker; a fresh lock within the lease window is never touched.

The database's own `now()` — not the application clock — decides "due" and "stale," avoiding app/server clock-skew risk.

---

## 7. Idempotency

Mandatory per the brief even though the frozen Master Owner Review did not spell it out — scheduled processing must assume at-least-once execution.

- **Scheduling-time dedup**: a unique index on `(jobType, idempotencyKey)`. `scheduleJob()` with a colliding key returns the existing row rather than erroring or creating a duplicate — proven live, including a hand-forged duplicate insert being refused by Postgres itself.
- **Execution-time dedup**: a completed job is never re-claimed (it's no longer `scheduled`) — proven live across repeated polls.
- **Notification-side dedup**: `notifyUser()` checks `sourceJobId` before inserting — a job that legitimately re-executes (e.g. after a crash/reclaim) does not send a second notification for the same job, even if the payload differs between attempts. Proven live.

This is deliberately two independent guards (the job's own key, and the notification's own job-linkage), not one relied on for both purposes.

---

## 8. Retry, backoff, and terminal failure

Handlers classify their own failures via `TransientJobError` / `PermanentJobError`; an unclassified thrown error defaults to **transient** (safer to retry, bounded by `maxAttempts` regardless). A `PermanentJobError` — or reaching `maxAttempts` — moves the job straight to terminal `failed`.

Backoff is exponential with jitter, capped at one hour: `min(30s * 2^(attempt-1), 1h)`, randomized within the top half of that window so many jobs failing at the same instant do not all retry at the same instant again.

**No separate dead-letter table.** A terminally `failed` job's row is never deleted — `attemptCount`, `lastErrorClass`, `lastErrorMessage`, and `failedAt` remain on the row itself, exactly the pattern the brief itself prescribes ("retain job, attempt count, last safe error, timestamps... if a separate dead-letter table is unnecessary, do not build one").

An administrator can manually re-queue a terminally failed job (`retryFailedJob`) — an explicit, audited act, not automatic.

---

## 9. Error data safety

`lib/scheduledJobs.ts`'s `toSafeErrorMessage` stores only the thrown error's own `.message`, truncated to 500 characters — never a stack trace, never a nested `cause` object that might carry a query, a payload, or a token. Handlers are responsible for throwing sanitized errors in the first place; this is the second line of defense, not the only one.

---

## 10. Reminder and deadline/overdue primitives

**No separate `reminders`/`reminder_definitions` table.** A "reminder" is modeled as an ordinary `scheduled_jobs` row of type `reminder.notify` — the primitive already needed for exactly this purpose, so a second table would only have duplicated it.

`lib/deadlineStatus.ts`'s `computeDeadlineStatus({ dueAt, completedAt, asOf, dueWindowMs? })` is a **pure function**, not a table — overdue state is derived from `dueAt + completion state + current time` on demand, per the brief's explicit preference over a persisted `overdue = true` flag. WS-6 owns no domain due-date column (a contract's end date, a probation period's end, a document's expiry date all belong to their own domain tables — see WS-5's `organization_document_versions.expiryDate`); this function is the shared vocabulary a future domain module applies to its own due-date column.

---

## 11. In-app notification foundation

**Decision: extend the pre-existing `notifications` table rather than build a new one**, for the reason in §1 above — it already had working routes and a working frontend, and had simply never been written to.

New, additive columns (all nullable, all backward-compatible): `organizationId`, `sourceReferenceType`/`sourceReferenceId`, `sourceJobId` (FK to `scheduled_jobs`, `ON DELETE SET NULL`), `actionPath`, `dismissedAt`, `expiresAt`. The six original columns (`id`, `userId`, `title`, `message`, `type`, `read`, `createdAt`) are untouched — every pre-existing route and the existing frontend keep working exactly as before, including the original ascending sort order (deliberately preserved, not "improved" to newest-first, to avoid silently changing existing display behavior).

`notifyUser()` is this table's first writer.

---

## 12. Recipient resolution

`lib/notifications.ts`'s `resolveRecipients(spec, organizationId)` — five concrete resolver kinds, **not a rule DSL** (explicitly forbidden by the brief):

| kind | Resolves to |
|---|---|
| `user` | An exact user id |
| `membership` | The user behind an exact membership id |
| `employee` | The user linked to an employee via `employee_user_links` |
| `manager_of_employee` | The linked user of the employee's current `reportingManagerId` — live-resolved at call time, never cached, matching `assetReporting.ts`/`attendanceReporting.ts`'s own established manager-relationship precedent |
| `permission_holders` | Every active member of the organization holding a given permission key |

**Every resolution is independently verified against an active, current membership in the target organization before a row is ever inserted** — the authoritative-relationship check the brief requires. A `user`/`membership`/`employee` spec that resolves to someone with no valid membership throws `RecipientNotAuthorizedError` rather than silently notifying them or silently doing nothing; `manager_of_employee` and `permission_holders` (which may legitimately resolve to nobody, e.g. an employee with no manager) return an empty list instead.

This is what makes "notification existence itself can leak information" (§19) actually closed: a notification is only ever created for someone with a real, live relationship to the organization it concerns.

---

## 13. Organization isolation

Proven live: a job/notification created for Org A is never listable, claimable, or notifiable as belonging to Org B; a user in Org B cannot be resolved as a recipient in Org A's context even by exact user id; Org B cannot list Org A's notifications.

---

## 14. Audit

Reuses WS-3's infrastructure. One new prefix registered in the single central category map (`lib/auditCategories.ts`): `scheduled_job` → `platform_configuration` (mirrors `installation`/`module`'s own placement).

Audited: manual admin cancel/reschedule/retry of a job — **never** routine scheduling or successful execution, matching the brief's explicit "do not flood the audit table with every normal background execution." The job row's own `attemptCount`/`lastErrorClass`/`lastErrorMessage` already carries that operational history; proven live that routine execution produces zero `scheduled_job.executed`-shaped events.

---

## 15. Security and authorization

- **No generic "execute job" or "create arbitrary job" endpoint exists anywhere.** Domain modules create jobs through their own server-side calls to `scheduleJob()`; a `jobType` a client could invent has no handler and fails safely. Proven live/via route test: `POST /platform/scheduled-jobs` (a hypothetical generic-create route) is not registered at all — 404.
- The platform admin surface (`/platform/scheduled-jobs*`) is reserved to `super_admin` via `requireSuperAdmin`, mirroring `installations.ts`'s exact precedent — no `requireMembership`, since this is platform-wide operational data, not an organization resource.
- **Break-glass remains read-only** (WS-4's own boundary, unchanged): nothing in WS-6 lets a break-glass grant schedule a mutating job. The scheduler's own service functions require an authenticated actor and are only ever called from server-side domain code or the super_admin-gated admin routes — never from a break-glass-elevated read path.
- `dismissNotification`/the notification list routes are IDOR-safe by construction: every lookup includes the caller's own `userId` in the `WHERE` clause, so no id — however guessed — resolves to another user's row.

---

## 16. Timezone model

No timezone library was added. Node 20 ships full ICU data, so the built-in `Intl` API already resolves arbitrary IANA timezones, including their historical and future DST transitions, with zero new dependency on a security-hardened backend.

`lib/organizationTimezone.ts`:
- `resolveOrganizationTimezone(organizationId)` reads the pre-existing (but previously unvalidated and unused) `general.timezone` config field, validates it via `Intl.supportedValuesOf("timeZone")`, and falls back to `UTC` for anything missing or invalid — never throws.
- `localDateTimeToUtc(timezone, "YYYY-MM-DDTHH:mm")` converts an organization-local wall-clock time to the UTC instant it represents, using a two-pass offset-resolution technique standard for `Intl`-based timezone math (no library needed).

**Nothing hard-codes `Africa/Accra`** (or any other zone) into shared scheduling logic — it appears only in comments and tests as one example zone among several. The conversion is proven correct against both a zero-offset zone (Africa/Accra, matching this platform's current Ghana-based customers) and a DST-observing zone (America/New_York, in both its winter and summer offsets, and across both DST transition boundaries) — deliberately exercised even though no current customer uses a DST zone, per the brief's own "do not assume every organization is GMT-only."

All persisted timestamps are `timestamptz` (UTC). Claiming and due-state decisions use the database's own `now()`, never the application/server clock.

---

## 17. Schema and migration

Migration `0061`, additive only:

- New table: `scheduled_jobs` (RLS enabled, zero policies, matching the repository's established deny-by-default convention).
- Extended table: `notifications` (seven new nullable columns; RLS was already enabled on this table from the WS-3 retrofit migration, so no new RLS statement was needed for it).

A hand-written `.down.sql` accompanies the migration and was verified by applying it and re-applying the up migration against a real database.

**Indexing** (§52): the due-job poll's exact predicate (`status = 'scheduled'`) has its own partial index on `scheduled_for`, so ordinary polling never scans rows in any other status. The stale-lock reclaim query similarly has a partial index on `locked_at` scoped to `status = 'running'`. `notifications` gets `(userId, read)` and `(organizationId)` indexes for its own list/unread-count queries.

---

## 18. OpenAPI / codegen

New/extended paths: `GET /notifications` (added an optional `organizationId` filter), `PATCH /notifications/{id}/dismiss` (new), and the platform admin surface `GET /platform/scheduled-jobs`, `GET /platform/scheduled-jobs/{id}`, `POST .../cancel`, `POST .../reschedule`, `POST .../retry`. `Notification` schema extended with the new nullable fields; new `ScheduledJob` schema added. Verified: 517 total operations, zero duplicate operation ids, zero dangling schema refs, codegen output identical across repeated runs.

---

## 19. Frontend

Two modest, additive UI changes — no dashboards, no Action Centre, no manager approval inbox:

- **Notifications page** (`artifacts/hrms/src/pages/notifications.tsx`): added a dismiss button and, where `actionPath` is set, a "View →" link. The pre-existing list/mark-read/mark-all-read behavior is unchanged.
- **Platform Admin page** (`artifacts/hrms/src/pages/platform-admin.tsx`): a new `ScheduledJobsPanel`, following the exact same card-per-concern pattern as the pre-existing WS-4 `InstallationsPanel`/`BreakGlassPanel` — list jobs, filter by status, cancel a pending job, retry a failed one. Gated by the same `super_admin`-only check the page already enforced.

---

## 20. Downstream integration contracts

| Workstream | What it consumes | Entry point |
|---|---|---|
| **WS-9** (Recruitment Completion) | Offer deadline / approval reminders | `scheduleJob("reminder.notify", { recipient, title, message, actionPath })` with `scheduledFor` computed via `localDateTimeToUtc` |
| **WS-10** (Onboarding/Handbook) | Onboarding task / handbook-acknowledgement deadline reminders | Same `reminder.notify` primitive; `computeDeadlineStatus` for checklist overdue state |
| **WS-11** (Employment Lifecycle Events) | Probation reminders, contract-expiry reminders, acting/secondment auto-revert scheduling | `scheduleJob`/`cancelJob`/`rescheduleJob`, keyed by an idempotency key encoding the employment period and occurrence |
| **WS-13** (HR Service Requests) | Request-approval reminders | `reminder.notify` |
| **WS-15** (HR Action Centre) | Outstanding-action composition without duplicating business records | `listNotificationsForUser`/`listScheduledJobs` filtered by organization, read-only |
| **Future audit-retention automation (OD #19)** | A recurring platform-scoped scan | `scheduleJob` with `organizationId: null` and an idempotency key encoding the scan occurrence (e.g. `"audit_retention_scan:2026-09-01"`) — the same re-schedule-on-each-run pattern proven by this workstream's own recurring-job mechanism, no DB-configurable cron table |

None of these is implemented by WS-6. A synthetic, disposable proof of the WS-5 document-expiry integration pattern (querying `queryExpiryState` and scheduling a `reminder.notify` job from it) exists only as a pattern documented here — no recurring document-expiry job is registered in any production code path.

---

## 21. Known limitations and follow-ups

1. **Recurring jobs have no DB-configurable schedule table.** A recurring job type re-enqueues its own next occurrence by calling `scheduleJob` again with an idempotency key encoding that occurrence (so repeated calls no-op via the unique constraint) — a server-defined pattern, not a cron-expression product feature. Sufficient for the "daily at a configured local time" style recurrence the brief anticipates; a full recurrence-configuration UI was explicitly out of scope.
2. **No per-organization scoped admin view of jobs/notifications** — only the platform `super_admin` surface exists. The brief allowed for "and perhaps tightly scoped organization administration for that org's notification status" as optional; deferred to keep this foundation narrow.
3. **OS signal delivery (`SIGTERM`/`SIGINT`) is not exercised by an automated test** — it is Node's own responsibility on the Linux containers this platform actually deploys to, and is not reliably testable on the Windows environment this workstream was authored in. The shutdown *logic* itself (`createWorkerRuntime`'s `shutdown()`) is fully unit-tested, and is the exact code path a real signal triggers.
4. **`reminder.notify` has no "digest"/batching mode** — each call produces one notification per resolved recipient. A future workflow that wants to batch multiple reminders into one message would build that composition itself; WS-6 does not provide it.
