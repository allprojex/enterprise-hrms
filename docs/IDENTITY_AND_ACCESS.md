# Identity & Access Model (WS-2)

Status: **Implemented.** This is the Identity & Access Hardening workstream from `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20 (WS-2), implementing Owner Decision #1 (legacy `users.role`/`users.organizationId` must not remain a permanent parallel authorization source) and Owner Decision #20 (platform-level user disablement). Owner Decision #31 (break-glass access) was explicitly **not** implemented here — WS-2 only avoids foreclosing it (see §6 below).

---

## 1. Authoritative Access Model

```
User → Organization Membership → Role(s) / Permissions → Module Enablement → relationship-derived authority
```

This was already the real authorization path for essentially everything in this codebase before WS-2 — confirmed by a repository-wide usage audit of every reference to `users.role` and `users.organizationId` (grep across `artifacts/api-server/src`, excluding tests): the surface was small (7 non-test files) and every use fell into one of three categories, none of which required a redesign:

| Usage | File | Classification | Disposition |
|---|---|---|---|
| `user.role === "super_admin"` (`isSuperAdmin()`) | `lib/authorization.ts` | **Platform Bootstrap Identity** — not "normal organization authorization" | Kept, explicitly documented as its own distinct concept (§2) |
| `eq(organizationsTable.id, user.organizationId)` in `GET /organizations` | `routes/organizations.ts` | **A — genuine authorization source, wrong for multi-org users** | **Fixed** — now uses `getActiveMembershipsForUser()`, matching `GET /me/organizations` |
| `user.organizationId` as a last-resort candidate in `resolveActiveOrganizationId()` | `lib/membership.ts` | **B — bootstrap/UX-default compatibility** | Kept, unchanged — always independently re-verified against a real active membership before being trusted; never itself an authorization decision |
| `role`/`organizationId` fields in `formatUser()`/`PATCH /users/me` responses | `routes/auth.ts`, `routes/users.ts` | **C — display/non-authority metadata** | Kept, unchanged — the frontend never uses these for gating (see §5) |

**No frontend code depends on `users.role` or `users.organizationId` for authorization.** The `useIsOrgAdmin`/`useIsHrCapable` hooks (`artifacts/hrms/src/hooks/use-hr-capable.ts`) that look similar are a **different, already-correct mechanism** — they read membership **role template keys** (`roles.key`, e.g. `"org_admin"`) from `GET /me/organizations`, not the legacy `users.role` enum column. The two happen to share vocabulary (`super_admin`/`org_admin`/`hr_manager`/`employee`) by naming coincidence, not by shared implementation — **do not confuse them**. A membership can independently hold the `roles.key === "super_admin"` role **template** (broad permissions within one organization only) without the underlying user carrying platform-wide `users.role === "super_admin"` (cross-organization bypass); these are two different mechanisms with very different blast radii.

---

## 2. Super Admin — Platform Bootstrap Identity

`isSuperAdmin(user)` (`user.role === "super_admin"`) remains the single platform-wide, cross-organization bypass. It was **not** migrated in WS-2: no safer alternative marker exists anywhere in this codebase to migrate to, and the frozen brief's own WS-2 scope explicitly frames this as a distinct "Platform Bootstrap Identity" concept, separate from normal organization authorization — not something Owner Decision #1 asked to be removed. `lib/authorization.ts` now carries an explicit doc comment recording this reasoning, so a future reader doesn't have to re-derive it.

`requireSuperAdmin` (`middlewares/requireSuperAdmin.ts`) is the existing, dedicated gate for platform-scoped routes (`organizationDomains.ts`'s tenant-domain management, and now `platformUsers.ts`'s disable/enable) — reused as-is, not reimplemented.

---

## 3. Multi-Organization Users

A user may hold active memberships in more than one organization; each membership carries its own role/permission grants, entirely independent of the others. This was already correctly supported by `organization_memberships`/`getActiveMembershipsForUser()` and by `GET /me/organizations` — the one place it was **not** correctly honored was `GET /organizations` (see §1's table), now fixed to match. Verified with a permanent regression test (`userDisablement.test.ts`): a user with active memberships in two organizations, whose legacy `organizationId` column points at only one of them, now sees **both** from `GET /organizations` — the exact scenario the old code could never represent.

---

## 4. Platform-Level User Disablement (Owner Decision #20)

### Schema

Additive migration `0056`: `users.disabledAt` (timestamptz, nullable), `users.disabledBy` (FK → `users.id`, nullable), `users.disabledReason` (text, nullable). A `NULL disabledAt` is the active state; a non-null value **is** the disabled state — no separate boolean/status column, deliberately mirroring the exact `revokedAt`/`revokedBy` pattern `organization_memberships` and `primary_hr_assignments` already use rather than inventing a redundant enum.

### Semantics

- **Platform-wide, not organization-scoped.** Disabling a user blocks them in every organization they belong to, regardless of how many active memberships they hold. This is a distinct axis from `organization_memberships.status` (§5) — the two are never conflated.
- **Reserved to `super_admin`** (`routes/platformUsers.ts`, `requireAuth` + `requireSuperAdmin`, no `requireMembership`). An organization admin's `membership.manage` permission — the authority that already governs inviting/assigning-roles-to/revoking a membership — cannot reach this; it only ever acts within their own organization. A user may belong to other organizations an org_admin has no authority over, so this boundary is intentional, not an oversight (§17 of the WS-2 brief).
- **Cannot self-disable** (`CannotDisableSelfError`, 400) — the same "don't let the actor lock themselves out" precedent Payroll's corrections workflow already established for self-approval.
- **Live re-check on every request, not just at login.** `requireAuth` (`middlewares/requireAuth.ts`) checks `disabledAt IS NULL` in the exact same query that already loads the session+user — zero additional query cost, never cached, never inferred from a token claim. A user disabled mid-session is rejected on their very next request.
- **Immediate session revocation.** `disableUser()` deletes every one of the target user's sessions in the same operation, so a disabled user cannot continue on a token issued before disablement. This is defense in depth, not the only enforcement — the live `requireAuth` check above still rejects even a session that somehow survives.
- **Re-enable restores platform eligibility only** (`enableUser()`) — deliberately does not touch `organization_memberships`, `membership_roles`, or any permission grant. A membership revoked or a role removed while the account was disabled stays revoked/removed; those remain separately authoritative and are managed through their own existing membership-management operations, never as a side effect of re-enabling the platform account.
- **Audited.** `platform_user.disabled`/`platform_user.enabled` events, via the existing `recordAuditEvent()` — no second audit mechanism.

### API

`POST /platform/users/:userId/disable` (body: `{ reason?: string }`), `POST /platform/users/:userId/enable`. OpenAPI (`lib/api-spec/openapi.yaml`) and generated clients (`lib/api-zod`, `lib/api-client-react`) updated accordingly. No dedicated frontend admin UI was built for these — WS-2's scope is the identity/authorization model itself, not a new product surface; a future Control Plane (or a small admin page) can wire into the already-generated client hooks without further backend work.

---

## 5. Organization Membership Disablement — Unchanged, Verified Independent

`organization_memberships.status` (`suspended`/`revoked`/`expired`) already existed and already worked correctly before WS-2 — no new code was needed. What WS-2 verified is that the two disablement axes compose correctly and independently:

- A user with an **active platform account** but a **revoked membership in Organization A** is denied access to Organization A (pre-existing `getActiveMembership`/`activeAndUnexpired()` behavior) while a separate **active membership in Organization B** continues to work normally.
- A user's **platform account disabled** blocks every organization at once, including ones where their membership is otherwise perfectly healthy.

These are two independent gates a caller must pass, not one derived from the other.

---

## 6. Employee Separation Boundary — Documented, Not Redesigned

Per the WS-2 brief's explicit instruction, `separateEmployee()` (`lib/employees.ts`) was **not** touched. Read in full: it updates only the `employees` table (`employmentStatus`, `separationDate`, `separationReason`) and records an `employee.separated` audit event — it does **not** touch `organization_memberships`, `users`, or `employee_user_links` in any way.

**Finding, recorded here rather than silently assumed**: separating an employee does **not** automatically disable their platform account or revoke their organization membership. A separated employee's ESS/platform login access remains fully active until a separate, explicit action removes it (revoking their membership, or — now — platform-disabling their account if warranted). This is pre-existing behavior, not something WS-2 introduced or is fixing; it is flagged here as a genuine, disclosed gap for a future HR-process workstream to decide whether access removal should become part of the offboarding/clearance flow (already tracked as a P1 item — WS-12, Employee Relations & Offboarding Clearance — in the frozen roadmap), not something to couple into either `separateEmployee()` or platform user disablement as a side effect.

---

## 7. Break-Glass Readiness (Owner Decision #31) — Not Built, Not Foreclosed

WS-2 did not implement break-glass/emergency administrative access — that remains WS-4's explicit scope. Nothing in WS-2's design forecloses it: `disabledAt`/`disabledBy`/`disabledReason` follow the same effective-dated-actor pattern (`revokedAt`/`revokedBy`) a future break-glass grant/audit model would extend, and `requireSuperAdmin` remains the one platform-wide authority gate a future break-glass invocation step would sit in front of, not replace.

---

## 8. Auth-Provider Boundary

This platform has no external identity provider (no Supabase Auth, OIDC, or SAML) — authentication is entirely local (`users.passwordHash`, `sessions.token`, both pre-existing). There is therefore no "auth provider account state vs. HRMS platform user state" split to document for this codebase specifically; the distinction the WS-2 brief asks about is not applicable here today. If an external identity provider is introduced in a future workstream (e.g. as part of MFA/SSO, explicitly out of WS-2's scope), platform disablement as built here already fails closed correctly on its own axis (`requireAuth`'s live check), and would need to be paired with, not replaced by, whatever provider-side revocation that future integration adds.

---

## 9. What Was Verified

- **Backend**: full suite re-run clean — **2317/2317 passing** (128 files; 2305 pre-WS-2 + 12 new `userDisablement.test.ts` tests), including the existing tenant-isolation/cross-org/authorization test suites (`organizations.test.ts`, `organizationAuthorization.test.ts`, `switch-organization.test.ts`, `authorization.test.ts`, `members.test.ts`, `tenantHostSecurity.test.ts`, `organizationTenantHostname.test.ts`, `resolveTenantHostFailOpen.test.ts`) — none broken by the `requireAuth`/`organizations.ts` changes.
- **New backend coverage**: a disabled user is rejected (401) even with a valid, unexpired session token, on `/auth/me` and on an unrelated protected route; disabling deletes sessions and records an audit event; a super_admin cannot disable themselves (400); disabling/enabling a nonexistent user 404s; a non-super_admin gets 403 on both disable and enable; re-enabling never touches membership rows; `GET /organizations` correctly reflects a multi-org user's real memberships (not the legacy column) for both the "sees both orgs" and "sees none" cases, and still returns everything for `super_admin`.
- **New frontend coverage** (`app-shell.test.tsx`): a `401` from `GET /auth/me` clears the local token and redirects to `/login`; a healthy session does neither; a non-401 error (e.g. a transient 500) does neither — confirming the pre-existing generic session-invalidation handler in `app-shell.tsx` correctly covers the disabled-user case with **zero new frontend product code**, only new test coverage of already-existing behavior.
- **Typecheck**: clean, whole workspace, after the schema/route/OpenAPI changes.
- **Schema drift**: `pnpm --filter @workspace/db run generate` produces no further changes after migration `0056` is committed — schema and migration journal agree.
- **Codegen drift**: `pnpm --filter @workspace/api-spec run codegen` produces no further changes after the new OpenAPI paths/schemas and their generated clients are committed.

---

## 10. Primary HR Administrator — delegated HR-team management (2026-09-04)

The Primary HR designation (`primary_hr_assignments`, §1 model unchanged) is
now an **authorization boundary**. The organization's active Primary HR whose
effective permissions include `hr_team.manage` may add, invite and revoke
members and assign, revoke, copy and edit roles — but only within their own
permission set, never any organization-level authority key, never payroll,
never the `super_admin` template, never another tenant's role, and never
against a member who holds authority they lack. `org_admin` behaviour is
unchanged apart from the `super_admin`-template and platform-restricted-grant
limits.

- Middleware: `requireDelegationAuthority("membership.manage" | "role.manage")`
  (replaces `requirePermission` on every member/invitation/role write route;
  attaches `req.delegation = { mode: "org_admin" | "hr_team", ... }`).
- Rules: `artifacts/api-server/src/lib/roleDelegation.ts` (ownership, template,
  prohibited-key, subset, scope, grant).
- Template: `hr_administrator` (fifth system template; seed `seed:roles` is
  idempotent and additive — no migration).
- Frontend: `useCanManageHrTeam` (hr_administrator **and** `isPrimaryHr` from
  `GET /me/organizations`) gates the console's HR Team Management mode; role
  selects use the server's `delegable` flag from `GET /organizations/:id/roles`.
- Audit: `membership.added|invited|revoked|role_assigned|role_revoked` carry
  `metadata.delegationMode`.

Full rationale, rule table and adversarial coverage: `docs/SECURITY.md` §19.
