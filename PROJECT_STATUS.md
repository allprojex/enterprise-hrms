# Enterprise HRMS Project Status

_Last updated: 2026-07-27, after W15 (Employee Separation). Formalized in `docs/FOUNDATION_IMPLEMENTATION_PLAN.md` (workstreams W1–W21, approved). Update this file per CLAUDE.md's Session End Checklist._

## Current Phase

Enterprise Foundation

---

## Current Objective

Build a configurable, enterprise-grade Human Resource ERP foundation that supports different organization types through configuration.

---

## Foundation Progress

- Authentication — **Complete**. Login, sessions, scrypt hashing, rate limiting. Tested (backend + live browser). No self-service password change; forgot-password sends no real email.
- Organization Management — **Complete** (W8). Create/list/get/update + suspend/reactivate (no hard delete — organizations are never destroyed) all work end-to-end. Org switcher is a working dropdown (W1).
- Organization Settings — In Progress. Schema + API + UI exist (get/update), but it's an untyped JSON blob, not a structured per-org configuration surface.
- Module Management — In Progress. Module Registry (W3) + per-organization enablement (W4, `GET/PATCH /organizations/:organizationId/modules[/:moduleKey]`, dependency-graph enforced) exist. No gating anywhere yet (W5/W6) — everything shipped so far is still unconditionally on for every org regardless of this flag.
- User Management — In Progress. Self-service profile + invitation-first onboarding (W10: invite by email, accept sets name/password, then log in separately). Still no admin "all users" directory (a cross-org listing, out of W10's scope).
- Roles & Permissions — In Progress. Assign/revoke on a membership works end-to-end, tested live. Roles/permissions themselves are fixed seed data, not admin-creatable.
- Membership Management — **Complete**. List, add-by-email, revoke, role assign/revoke — full CRUD via the Admin console, tested live.
- Branches — **Complete**. Full CRUD, tested (unit + live browser).
- Organizational Units — **Complete**. Departments, incl. branch linkage, tested (unit + live browser).
- Positions — **Complete**. Incl. department linkage, tested (unit + live browser).
- Employee Management — In Progress. Full CRUD, search/filter/pagination tested live. Profile picture upload built and unit-tested but not yet exercised in the live browser pass. Separation/rehire (W15) added: never hard-deleted, history preserved via audit events (ADR-013).
- Employee–User Linking — **Complete** (W14). Verified live via a member-picker UI (redesigned from an earlier draft that assumed email input, which didn't match the API contract). Now full lifecycle: the employee record surfaces its link status and offers Unlink instead of a blind, doomed re-link attempt.
- Onboarding — **Complete**. Organization creation → membership → role → Primary HR, one transaction, tested (unit + live browser).
- Dashboard — **Complete**. Real employee counts, real module-availability tiles with working links (was showing stale "Coming Soon" placeholders until fixed this session).
- Notifications — **Complete**. Pre-existing, unmodified this session.
- Audit Logs — In Progress. Write path is broad and solid. Read path exists only as an admin-console tab; no dedicated reporting/export/search UI.
- Core Reports — **Planned, not started**.

---

## Current Sprint

Foundation build-out and live verification (this session, now wrapping up):

- Filled backend gaps that had DB tables but zero API exposure: roles, permissions, memberships, Primary HR, organization settings, audit events.
- Built the missing frontend for branches, departments, positions, the employee directory + detail view, organization creation, and a full admin console.
- Ran the app locally against the approved dev database and manually verified every foundation flow end-to-end, fixing two real bugs found in the process.
- Applied the one-time migration baseline to the dev database and created the working admin account.
- Established the project governance doc set: `CLAUDE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`, `CONTRIBUTING.md`, this file.

All of the above is staged locally, not committed, not pushed.

---

## Foundation Completion Plan

Authoritative, approved plan: see `docs/FOUNDATION_IMPLEMENTATION_PLAN.md` (21 dependency-ordered workstreams, W1–W21) and `DECISIONS.md` ADR-008–017 for the architecture decisions behind it. Phase 2A (Core Employee Domain) does not begin until this plan's Definition of Foundation Complete is met.

- **W1 — Active Organization Context & Safe Tenant Switching — Complete.** See Known Issue #2 below (resolved).
- **W2 — Organization Configuration Engine — Complete.** See Known Issue #4 below (resolved). Pending: the generated `0001_loving_william_stryker.sql` migration has not been applied to any database — additive only (2 new columns with defaults + an index swap), awaiting your approval per CLAUDE.md's Database Rules.
- **W3 — Module Registry — Complete.** `GET /modules` (reference catalog, any authenticated user). 8 HR-operations modules seeded, all `status: "hidden"` since none has a shipped owning workstream yet. Deliberately does not touch per-org enablement — see Known Issue #1 above. Registry integrity (unknown dependency key, self-dependency, circular dependency) is enforced in code (`validateModuleDefinitions` in `lib/db/src/seed/module-definitions.ts`, run before every seed insert) and was exercised manually against all three failure cases plus the real data — but `lib/db` has no automated test harness yet, so this isn't covered by a committed test suite. W4 owns adding that coverage, since it's the workstream that will actually walk this graph to resolve module dependencies at enable-time and has an existing test harness (api-server) to exercise it through. Pending: the generated `0002_fuzzy_vindicator.sql` migration (new `modules` table, purely additive) has not been applied to any database, same as W2's, awaiting approval. The seed script (`pnpm --filter @workspace/db run seed:modules`) has also not been run.
- **W4 — Per-Organization Module Enablement — Complete.** `organization_modules` (additive, per-org override of a registry module's `defaultEnabled`) + `GET/PATCH /organizations/:organizationId/modules[/:moduleKey]`. Enabling walks the registry's dependency graph (requires `active`/`beta` status and every `requiredModuleKeys` entry already enabled); disabling is rejected if another enabled module still requires it. Gated by a new `module.manage` permission (org admin/super admin); GET reuses `organization.read`. Does not gate anything yet — see Known Issue #1. Pending: the generated `0003_abandoned_dormammu.sql` migration (new `organization_modules` table, purely additive) has not been applied to any database, same as W2/W3's.
- **W5 — Backend Module Gating — Complete.** `requireModuleEnabled(moduleKey)` middleware (composes after `requireMembership`, same pattern as `requirePermission`) + `getModuleAccess` in `lib/organizationModules.ts`, which independently re-walks the required-dependency chain rather than trusting a single override row. No route uses it yet — every registered module (W3) is still `status: "hidden"` with no shipped feature routes, so there is nothing in this codebase to gate. No schema change; no migration generated.
- **W6 — Frontend Module Gating — Complete.** `isModuleAccessible` (`artifacts/hrms/src/lib/module-access.ts`, transitively re-walks `requiredModuleKeys` like W5's `getModuleAccess`) + `<ModuleGate moduleKey>` route guard (mirrors Admin's existing UX-level route guard: redirects to `/unauthorized`, real enforcement stays server-side). No route in `App.tsx` uses it yet — same reason as W5: every registered module (W3) is still `status: "hidden"` with no shipped page. Does not touch the dashboard's hardcoded module tiles/`ACTIVE_MODULE_COUNT` — that's W18's explicit job ("Dashboard Completion — Remove all hardcoded values").
- **W7 — Master Data Management — Complete.** Generic reference-data model (ADR-010): `master_data_domains` (registry, mirrors `modules`/W3 — key/label/classification) + `master_data_items` (`organizationId` null = system row shared by every org, set = that org's own row). `GET /master-data/domains` (catalog) + `GET/POST /organizations/:organizationId/master-data/:domain` (GET merges system + org items, reuses `organization.read`; POST adds an org item, rejected for system-defined domains, new `master_data.manage` permission). Seeds the 20-domain registry from the frozen plan and a representative item set for 3 system-defined domains — not exhaustive real-world catalogs. Pending: the generated `0004_special_kylun.sql` migration (two new tables, purely additive) has not been applied to any database, same as W2–W4's.
- **W8 — Organization CRUD Completion — Complete.** `PATCH /organizations/:id` (name/slug/type/logoUrl/industry/employeeCount) + `POST /organizations/:id/suspend` + `POST /organizations/:id/reactivate`. Uses the existing legacy `canAccessOrganization`-style authorization (new `canManageOrganization`: super_admin, or `org_admin` within the organization) rather than the membership-based `requirePermission` — migrating these routes onto memberships is a later phase, not done yet (same as the rest of `organizations.ts`). Audit-logged (`organization.updated`/`organization.suspended`/`organization.reactivated`). No schema change; no migration generated. Frontend: Edit dialog + Suspend/Reactivate action on the Organisations page, gated client-side by the same rule the server enforces.
- **W9 — Organization Permission Gates — Complete.** `GET/PATCH /organizations/:id` and `POST /organizations/:id/suspend|reactivate` now use `authorizeOrganizationAction` (`lib/organizationAuthorization.ts`): super_admin bypasses, everyone else needs an active membership in the target organization carrying `organization.read` (GET) or `organization.update` (PATCH/suspend/reactivate) — the same membership + permission infrastructure every other org-scoped route already uses, both permission keys already seeded. Replaces the old role-string checks (`canAccessOrganization`/`canManageOrganization`, now deleted as dead code). `GET /organizations` (cross-org list for super_admin) and `POST /organizations` (create) are unaffected — neither has a single target org to gate against. No schema change; no migration.
- **W10 — Administrative User Management — Complete.** Invitation-first onboarding (ADR-014): `POST /organizations/:organizationId/invitations` (creates a user if the email doesn't exist yet, with an unusable random password, plus an `invited`-status membership carrying a secure token) → `GET /invitations/:token` (public preview) → `POST /invitations/:token/accept` (public; sets the invitee's real name/password, activates the membership) → separate `/auth/login` afterward. No email is sent (ADR-017's "never fake email delivery" applies here too) — the create-invitation response returns the raw token; the admin console shows a copyable accept link. Reuses the existing `membership.manage` permission and the membership row's pre-existing `invited` status/`invitedAt` column; listing/revoking a pending invitation reuses the existing `GET`/`DELETE /organizations/:organizationId/members[...]` endpoints unchanged, since an invitation *is* a membership row. Pending: the generated `0005_common_wong.sql` migration (two new nullable columns + a unique constraint on `organization_memberships`, purely additive) has not been applied to any database, same as W2–W4/W7's.
- **W11 — Roles, Permissions and Templates — Complete.** ADR-015: system role templates (`organizationId` null, `isSystemRole` true) stay fixed and protected; `roles` gains a nullable `organizationId` (mirrors `master_data_items`/W7's system/org split) so an organization can copy a template into its own customizable row. `GET/POST /organizations/:organizationId/roles` (list merges templates + the org's own roles; copy duplicates the template's current permission set) + `POST`/`DELETE .../roles/:roleId/permissions[/:permissionId]` (grant/revoke on an org-owned role only — rejected with 400 for a system template, mirrors `members.ts`'s membership-role assign/revoke pattern). Existing `GET /roles` catalog and 4 system roles are untouched, not renamed — ADR-015's longer example list (HR Officer, Department Head, Auditor, ...) is illustrative of what templates *can* exist, not a mandated seed; inventing specific permission sets for names not otherwise defined anywhere in this codebase was out of scope. Pending: the generated `0006_solid_fat_cobra.sql` migration (nullable column + FK + partial-unique-index swap, same shape as W2's index swap) has not been applied to any database, same as W2–W4/W7/W10's.
- **W12 — Organization Structure Service — Complete.** ADR-012: one shared `lib/organizationStructureService.ts` for branch/department/position business rules instead of three parallel implementations. Hierarchy validation (cross-org reference checks, plus cycle detection for a department's own ancestry) now backs both `POST .../departments`/`.../positions` (replacing the routes' ad-hoc calls) and two new endpoints: `PATCH .../departments/:id/restructure` (move branch/parent) and `PATCH .../positions/:id/restructure` (move department) — structural placement only, not a general field update. Dependency validation (`assertBranchArchivable`/`assertDepartmentArchivable`) is implemented and tested but not yet wired to a live endpoint, since no archive/delete endpoint exists yet for these entities — that's W13's ("...Completion") job, matching the precedent already set by W5/W6's gating logic shipping ahead of any consuming route. No schema change; no migration.
- **W13 — Branch, Organizational Unit and Position Completion — Complete.** `departments`/`positions` gain a `status` column (mirrors `branches.status` exactly). `PATCH .../branches/:id`, `.../departments/:id`, `.../positions/:id` (name/code/title only — not structural placement, that stays `restructure`'s job from W12, nor status) + `POST .../archive` and `.../reactivate` for all three, wired to W12's already-built `assertBranchArchivable`/`assertDepartmentArchivable` dependency checks (positions have no downstream dependents in this service's scope, so no check needed there). Audit-logged. Admin console pages (Branches/Departments/Positions) get Edit + Archive/Reactivate actions. Migration `0007_smiling_nehzno.sql` (two new columns, purely additive) generated, not applied, same as W2–W4/W7/W10/W11's.
- **W14 — Employee–User Linking Completion — Complete.** `employee_user_links` already existed with link-only support (Known Issue #8: no "already linked" indicator, re-linking just failed with a 409). `GET .../employees[/:employeeId]` now batch-resolves each employee's `linkedApplicationUserId` (same batching pattern as `resolveEmployeeLabels`'s department/branch/position/manager lookups) + new `DELETE .../employees/:employeeId/link-user` (404 if not linked), audit-logged. Employee detail page shows the linked account and an Unlink action instead of the link form once linked, resolving Known Issue #8. No schema change; no migration.
- **W15 — Employee Separation — Complete.** `employees` gains `separation_date`/`separation_reason` (nullable; the reason is a free-text code from the existing W7 "separation_reason" Master Data domain, org-overridable). New `POST .../employees/:employeeId/separate` (sets `employmentStatus: terminated` + date/reason, 400 if already terminated) and `POST .../employees/:employeeId/rehire` (clears separation fields back to `active`, 400 if not currently terminated), both `employee.write`-gated and audit-logged (`employee.separated`/`employee.rehired`). Per ADR-013, the record is never deleted or duplicated — history lives in `audit_events`, not a new employment-periods table. Employee detail page adds a Separate dialog (date + reason picker) and a Rehire action, conditional on status. Migration `0008_wise_krista_starr` generated, not applied.
- W16–W21 — Not started.

---

## Known Issues

1. No Module Management *enforcement* — the registry (W3), per-org enablement (W4), and both the backend (W5) and frontend (W6) gate mechanisms now exist, but no route or page composes either gate yet, since no module has a shipped feature to gate. Everything still ships unconditionally on for every org.
2. ~~Organization switcher is non-functional...~~ **Resolved by W1.** `GET /auth/me` now resolves and returns `activeOrganizationId` server-side (session's switched org → legacy `user.organizationId` → any other active membership → null), and every org-scoped page/query and the dashboard summary use it instead of the legacy field. The sidebar switcher is a working dropdown over `/me/organizations`.
3. ~~No user registration/creation UI anywhere...~~ **Resolved by W10.** Admins can now invite an email that has no account yet via the Admin console (or the API directly); the invitee accepts via a public link, sets their own name and password, then logs in normally. No cross-org "all users" directory yet — that's a separate, not-yet-scoped concern.
4. ~~Organization Settings is a raw JSON blob, not structured configuration.~~ **Resolved by W2.** Replaced by the Organization Configuration Engine: `organization_settings` now stores one validated, versioned row per (organization, namespace) instead of one uncontrolled blob per organization. `general` and `terminology` namespaces are implemented now; further namespaces (module enablement, numbering formats, branding, ...) register into the same engine as their owning workstream lands. Existing data preserved automatically via a column default, no migration script needed.
5. ~~Roles and permissions are fixed seed data — no admin path to define org-specific ones.~~ **Resolved by W11.** System role templates stay fixed and protected; an org copies one into its own row and customizes that copy's permissions.
6. Core Reports not started.
7. Profile picture upload not yet verified live in the browser.
8. ~~No "already linked" indicator on an employee record — re-linking just fails with a 409.~~ **Resolved by W14.**
9. Dashboard's `ACTIVE_MODULE_COUNT` is a hardcoded constant, not derived from a real module registry — a direct symptom of issue #1.
10. **Cross-document inconsistency**: this file excludes Payroll from scope entirely, but `ROADMAP.md` Phase 3 ("Operations") still lists Payroll, and `ROADMAP.md` Phase 5 ("Extended ERP") still lists Loans, which is also dropped from Future Modules below. I haven't edited `ROADMAP.md` to match — that's your call, since you authored it directly.

---

## Future Modules

These will only begin after the HR foundation is complete.

- Recruitment
- Attendance
- Leave
- Performance
- Learning & Development
- Asset Management
- Employee Self Service
- Manager Portal

Payroll is intentionally excluded from the current project scope.
