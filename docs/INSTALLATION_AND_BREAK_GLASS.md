# Installation Registry & Break-Glass Access Foundation (WS-4)

Status: **Implemented (foundation only).** This is the fourth implementation workstream from `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20, implementing Owner Decision #29 (Installation Registry / Control Plane foundation) and Owner Decision #31 (Break-Glass / Emergency Administrative Access). The full fleet-management Control Plane (dashboards, remote deployment, backup/update orchestration, licensing) remains deferred — this workstream builds only the identity and access-control foundation those future features can attach to.

---

## 1. Customer / Organization / Installation / Environment — the distinction

These are four different concepts, deliberately not collapsed into one:

- **Customer** — a commercial relationship. Not modeled in this schema at all (a future Commercial/Control Plane concern).
- **Organization** (`organizations`) — a tenant. Owns users, workforce, structure, settings, permissions, modules.
- **Installation** (`installations`, new) — a deployed HRMS runtime/environment. Identified by a stable `installationKey`.
- **Environment** — a property *of* an installation (`environmentType`: development/staging/demo/production), not a separate table.

One installation may host **one or many** organizations (a shared deployment) — `installation_organizations` is a join table, never a single `organizationId` column on `installations`, which would have foreclosed that topology. One organization may be served by more than one installation over its lifetime (its own dev/staging/production instances). Neither direction is hard-coded to 1:1.

---

## 2. Installation Registry (`installations`)

Minimum durable fields to answer "what is this deployment and what is it running":

| Field | Purpose |
|---|---|
| `installationKey` | Stable, unique identifier. Server-generated (`crypto.randomUUID()`) if not supplied at creation; **never regenerated**. Not a secret — an identifier only (§18 of the brief); all platform operations still require real authentication/authorization regardless of who knows a key. |
| `name` | Human-readable label. |
| `environmentType` | `development` \| `staging` \| `demo` \| `production`. |
| `hostingModel` | `shared` \| `dedicated_owner_managed` \| `dedicated_customer_managed` \| `other`. Coarse topology only. |
| `hostingProvider` | Free-text, not an enum — organizations may host on arbitrary providers. |
| `primaryDomain`, `healthUrl` | Descriptive metadata. |
| `applicationVersion`, `gitCommit`, `migrationVersion`, `deployedAt` | Version identity (§11 of the brief) — deliberately never derived from a mutable branch name. `routes/health.ts`'s pre-existing `RELEASE_VERSION` (`process.env.RELEASE_VERSION ?? process.env.GIT_COMMIT_SHA ?? "unknown"`) is the same kind of value a deployment process would feed into these fields; no new exposure endpoint was added in this workstream since `/api/healthz` already safely exposes a release identifier. |
| `extensionProfile` | Free-text reference to a future org-type-specific extension bundle — reserved, not built out. |
| `status` | `active` \| `inactive` \| `decommissioned`. |

**Self-identity (§17)**: a deployed application is expected to carry its own `installationKey` via environment configuration and identify itself against the registry that way — this workstream does not wire that lookup into the running app itself (no code path reads its own key today); it only makes the registry able to hold and validate one.

**No secrets, no SSH credentials, no infrastructure passwords** are stored anywhere in this table, by design.

**Authority**: platform `super_admin` only (`requireSuperAdmin`), mirroring `platformUsers.ts`/`organizationDomains.ts`'s own precedent exactly. No organization role — including `org_admin` — can create, edit, or link/unlink an installation merely by administering an organization.

**API**: `GET/POST /installations`, `GET/PATCH /installations/:id`, `GET/POST /installations/:id/organizations`, `DELETE /installations/:id/organizations/:organizationId` (`routes/installations.ts`, `lib/installations.ts`). Linking is additive and soft-unlink (`unlinkedAt`), preserving history the same way `organization_domains` already does for its own primary-flag pattern.

**Audit**: `installation.created`, `installation.updated`, `installation.status_changed` (distinct from a plain metadata update), `installation.organization_linked`, `installation.organization_unlinked` — all via the one existing `recordAuditEvent()`, category `platform_configuration`.

---

## 3. Break-Glass Access Foundation (`break_glass_grants`, Owner Decision #31)

### 3.1 The problem this solves

Before this workstream, a `super_admin` who was not a member of an organization was **flatly denied** by `requireMembership` on every org-scoped route — a real, live-verified fact (see §5 below), not an assumption. That default-deny is correct and stays correct. What was missing was any *legitimate, controlled path at all* for a platform operator to help with a genuine support/security incident without either (a) being permanently added as a real organization member (a standing, unaudited-as-such grant that never expires) or (b) having no path whatsoever. Break-glass is that controlled path.

### 3.2 Model

A grant (`break_glass_grants`) is:

- **actor-bound** (`actorUserId`) — always the real platform user, never impersonated (§37: "Break-glass actor remains the actual platform user").
- **organization-bound** (`targetOrganizationId`) — never installation-wide, never platform-wide.
- **reason-bound** (`reason`, required, non-empty).
- **scope-bound** (`scope`, a JSON array of explicit, real permission keys — §22 option A: "explicit permission list," not a policy-language bundle).
- **time-limited** (`expiresAt`, required, must be in the future, capped by a platform policy maximum — `BREAK_GLASS_MAX_DURATION_HOURS` env var, default 8h, same env-var-with-safe-fallback pattern as `RELEASE_VERSION`).
- **revocable** (`status`, `revokedAt`, `revokedBy`).
- **fully audited** (every lifecycle event, plus every subsequent action taken under it — see §3.5).

There is **no separate request/approval workflow** in this foundation workstream — a grant is activated by the same platform actor who creates it (`requestedAt`/`activatedAt` are set together). A future customer-approval workflow is a deliberately deferred extension (§4 below), not built here.

**"Ended"/"expired" are not stored states.** Liveness is always derived at the moment of use — `status === "active"` AND `expiresAt > now()` — never from a background sweep (no scheduled jobs exist anywhere in this platform per WS-1's own boundary) and never from a second timestamp that could drift out of sync with `expiresAt`/`revokedAt`. See `getActiveGrantForActorAndOrg` (`lib/breakGlass.ts`) — the one function every privileged request re-evaluates against, every time.

### 3.3 Scope — read-only by construction

Scope validation (`lib/breakGlass.ts`) enforces two things at grant-creation time, server-side, never trusting the request body as-is:

1. Every key must already exist in the `permissions` table.
2. Every key must match the read-only naming convention already in universal use across this codebase's ~150 permission keys: contains a `.read` segment (`/(^|\.)read(\.|$)/` — matches `employee.read`, `audit.read.hr`, `asset_management.read.own`, etc.). Anything ending `.manage`/`.write`/`.approve`/etc. is rejected outright.

This operationalizes §23's "default recommendation: READ-ONLY emergency/support access initially" mechanically, without inventing a curated bundle list (`support_read`, `security_response`, ...) that would need separate maintenance — the brief's own §22 explicitly allows this as option A and prefers it ("avoid complex policy language if explicit permissions are clearer").

### 3.4 How elevation actually happens — the one integration point

`middlewares/requireMembership.ts` — the real funnel almost every organization-scoped route in this codebase already uses — gained exactly one narrow fallback:

```
membership found?           → proceed as before (req.membership set)
no membership, but caller
  is isSuperAdmin() AND has
  an active grant for THIS
  exact organization?       → proceed elevated (req.breakGlassGrant set,
                               req.membership left undefined)
neither                     → 403, unchanged
```

`requirePermission.ts` then checks the resolved membership's real role/permission grant as before, **or**, under elevation, whether the requested permission key is literally present in `req.breakGlassGrant.scope`. `requireModuleEnabled.ts` resolves the organization id from whichever path was taken. **A grant changes WHO may call a normal service — it never changes WHAT that service validates**: module gating, domain invariants, and (for the routes below) maker-checker/approval logic are all still enforced identically under elevation, because they are downstream of this same middleware chain, unmodified.

This was deliberately built as **one shared fallback in the existing chain**, not a parallel authorization system, so it applies uniformly to every route that already uses `requireMembership`/`requirePermission`/`requireModuleEnabled` — the same three middlewares essentially every org-scoped route in this codebase already composes.

**Disclosed foundation limitation**: a handful of already-existing route handlers read `req.membership!.organizationId` / `req.membership!.id` directly in their bodies rather than only in the middleware chain, which would throw if reached under elevation with no real membership. Two new resolver helpers (`resolveOrganizationId`, `resolveActorMembershipId`, exported from `requireMembership.ts`) fix this pattern; they have been applied to the specific sensitive-read routes this workstream explicitly needed to prove elevation against end-to-end — Payroll banking/statutory (all 4 GET routes, `routes/payrollSensitiveRecords.ts`) and Personnel File views (`routes/personnelFiles.ts`, all 3 GET routes). **Every other existing route in the platform has not been individually retrofitted** — a grant scoped to a permission gating one of those routes would currently 500 rather than succeed, until that route is updated to use the same two helpers. This is a real, bounded, disclosed gap in the foundation, not a silent one: extending coverage route-by-route as new support use cases arise is expected future work, explicitly out of this workstream's own hard scope boundary ("Only build the shared foundations required by WS-4").

### 3.5 Sensitive-read audit integration (§29)

`lib/requestContext.ts`'s existing `AsyncLocalStorage` (already carrying `requestId` since WS-3) now also carries an optional `breakGlassGrantId`, set once by `requireMembership.ts` only on an elevated request. `recordAuditEvent()` (`lib/auditLog.ts`) reads it automatically and stamps every audit row written during that request with the grant id — including the **exact same** `.read`/`.revealed`/`.viewed` events WS-3 already produces. **No sensitive-read event is ever duplicated** for an elevated request; the existing event is enriched with a reference to the grant, exactly as §29 requires. `audit_events.breakGlassGrantId` (new column, migration `0059`) makes it possible to reconstruct exactly which rows were written under which elevated session.

### 3.6 API and platform-only authority

`POST/GET /break-glass/grants`, `GET /break-glass/grants/:id`, `POST /break-glass/grants/:id/revoke` (`routes/breakGlass.ts`) — all `requireSuperAdmin`. Grant *management* is a platform operation, distinct from the elevated *access* a grant subsequently unlocks through the ordinary org-scoped middleware chain above.

### 3.7 Frontend

A minimal platform-admin page (`artifacts/hrms/src/pages/platform-admin.tsx`, route `/platform-admin`), gated by `me.role === "super_admin"` (the same true platform-bootstrap-identity check used elsewhere on the frontend, e.g. `organizations.tsx`'s `DomainsPanel`) — not any organization role. Linked from the Organizations page for discoverability. Covers: create/list installations, link/unlink organizations, create/list/revoke break-glass grants, with the active-grant table showing a live "ACTIVE — Xh Ym remaining" badge and an immediate Revoke action (§27/§35). **Not built**: an in-context "you are viewing this organization's data under an active grant" banner on the org data pages themselves — that would require plumbing elevation state into every org-scoped page in the app, explicitly out of this foundation's scope.

---

## 4. What was deliberately NOT built (hard scope boundary)

- Full fleet-management Control Plane UI (dashboard, remote SSH orchestration, one-click deployment, backup/restore, health polling, subscriptions/licensing, Demo Factory).
- Customer notification/approval workflow for break-glass activation — the schema and audit model support adding this later (an organization-administrator-visible pending/approved state) without redesigning grant identity, but no such workflow exists today.
- Arbitrary customer impersonation — never built, never intended; the true actor is always the identifiable platform user (§37).
- Any weakening of existing platform administration (`organizations.ts`'s `authorizeOrganizationAction`, `auth.ts`'s login/switch-organization super_admin bypass) — both untouched, both remain platform-scoped exactly as WS-2 established.
- A real WWM installation registry entry or any real break-glass use against WWM — this workstream used only disposable QA organizations/installations/grants, live-verified against a throwaway Postgres and a throwaway local dev stack, then torn down.

---

## 5. Pre-existing super-admin bypass — reconciled, not newly restricted

This workstream's own reconciliation pass (§5/§32 of the WS-4 brief) found that `isSuperAdmin()` was **already** confined, before WS-4 touched anything, to exactly three places:

1. `organizationAuthorization.ts`'s `authorizeOrganizationAction()` — used only by `organizations.ts`'s own GET/PATCH/suspend/reactivate routes (organization *metadata* — name, slug, status; never HR/employee/payroll content).
2. `organizations.ts`'s `GET /organizations` list endpoint — same organization-metadata scope.
3. `auth.ts`'s login and switch-organization entry points — explicitly documented, since WS-2, as the two places a session's tenant context is established in the first place.

`requireMembership.ts` — the actual funnel for the entire HR-data surface (employees, payroll, leave, personnel files, everything) — already carried **no** super_admin exemption, per its own WS-2 comment. This means Owner Decision #31's core requirement ("platform-owner status must not imply unrestricted everyday access to customer HR data") was **already structurally satisfied** before this workstream began. Break-glass's job was therefore to add the explicit, auditable, time-limited *path in* to that already-correctly-closed door — not to close a leak that existed. No material architectural contradiction was found; §32's "STOP and report" condition did not trigger.

---

## 6. Schema / Migration

Migration `0059` (additive):

- `installations` (new table, 3 new enums: `installation_environment_type`, `installation_hosting_model`, `installation_status`).
- `installation_organizations` (new join table; partial unique index on `(installationId, organizationId) WHERE unlinkedAt IS NULL`, mirroring `organization_domains`' own `isPrimary` partial-unique precedent).
- `break_glass_grants` (new table, 1 new enum: `break_glass_grant_status`).
- `audit_events.breakGlassGrantId` (new nullable column + FK + index).

**`ON DELETE RESTRICT`, not `SET NULL`, on `audit_events.breakGlassGrantId → break_glass_grants.id`** — a deliberate, live-verified correction. A FK's `SET NULL` action is implemented internally as an `UPDATE` on the referencing table (`audit_events`), which the WS-3 append-only trigger (`0058`) unconditionally rejects regardless of who or what issues it — so `SET NULL` could never actually have executed. `RESTRICT` declares the real, enforced behavior honestly and matches application behavior anyway: `lib/breakGlass.ts` never deletes a grant row, only updates its `status` (revoke).

All three new tables get `ENABLE ROW LEVEL SECURITY` with no policies, matching the repository's existing convention for every table added since `0036` (a disclosed, pre-existing condition — the application's own DB role is not currently RLS-restricted; not relied upon as the actual isolation mechanism, which is `requireMembership`'s own live membership/grant check).

Down migration provided (`0059_damp_nextwave.down.sql`).

---

## 7. Future policy hooks intentionally left as configuration points, not features

- `BREAK_GLASS_MAX_DURATION_HOURS` — platform policy, not customer-specific, settable per deployment.
- `metadata` (jsonb) on `break_glass_grants` — safe, non-sensitive context only (e.g. a support-ticket reference); never customer data.
- Customer notification/approval — no code path today; the audit/grant model does not need to change shape to add one later.
