# Enterprise HRMS Project Status

_Last updated: 2026-07-26, after a foundation audit surfaced that "Enterprise Foundation" was not actually complete (Module Management not started, several areas in-progress, two open architecture questions). Those questions are now resolved and formalized in `docs/FOUNDATION_IMPLEMENTATION_PLAN.md` (workstreams W1–W21, approved). W1 is complete. Update this file per CLAUDE.md's Session End Checklist._

## Current Phase

Enterprise Foundation

---

## Current Objective

Build a configurable, enterprise-grade Human Resource ERP foundation that supports different organization types through configuration.

---

## Foundation Progress

- Authentication — **Complete**. Login, sessions, scrypt hashing, rate limiting. Tested (backend + live browser). No self-service password change; forgot-password sends no real email.
- Organization Management — In Progress. Create/list/get work end-to-end, tested live. No update/delete. Org switcher UI is a pre-existing disabled placeholder.
- Organization Settings — In Progress. Schema + API + UI exist (get/update), but it's an untyped JSON blob, not a structured per-org configuration surface.
- Module Management — **Planned, not started**. No module registry, no per-org enable/disable, no gating anywhere. Everything shipped so far is unconditionally on for every org.
- User Management — In Progress. Self-service profile only. No admin "all users" directory, no user registration/creation UI at all.
- Roles & Permissions — In Progress. Assign/revoke on a membership works end-to-end, tested live. Roles/permissions themselves are fixed seed data, not admin-creatable.
- Membership Management — **Complete**. List, add-by-email, revoke, role assign/revoke — full CRUD via the Admin console, tested live.
- Branches — **Complete**. Full CRUD, tested (unit + live browser).
- Organizational Units — **Complete**. Departments, incl. branch linkage, tested (unit + live browser).
- Positions — **Complete**. Incl. department linkage, tested (unit + live browser).
- Employee Management — In Progress. Full CRUD, search/filter/pagination tested live. Profile picture upload built and unit-tested but not yet exercised in the live browser pass.
- Employee–User Linking — **Complete**. Verified live via a member-picker UI (redesigned from an earlier draft that assumed email input, which didn't match the API contract).
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
- **W2 — Organization Configuration Engine — Not started (next).**
- W3–W21 — Not started.

---

## Known Issues

1. No Module Management system — the most structurally significant gap (see above). Targeted by W3/W4.
2. ~~Organization switcher is non-functional...~~ **Resolved by W1.** `GET /auth/me` now resolves and returns `activeOrganizationId` server-side (session's switched org → legacy `user.organizationId` → any other active membership → null), and every org-scoped page/query and the dashboard summary use it instead of the legacy field. The sidebar switcher is a working dropdown over `/me/organizations`.
3. No user registration/creation UI anywhere — limits realistic multi-user testing. Targeted by W7 (invitation-first admin user management).
4. Organization Settings is a raw JSON blob, not structured configuration.
5. Roles and permissions are fixed seed data — no admin path to define org-specific ones.
6. Core Reports not started.
7. Profile picture upload not yet verified live in the browser.
8. No "already linked" indicator on an employee record — re-linking just fails with a 409.
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
