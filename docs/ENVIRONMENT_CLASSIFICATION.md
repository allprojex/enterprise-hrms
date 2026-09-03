# Environment Classification — Authoritative

**This document is the single source of truth for which Supabase environment this repository deploys to. Where any other document disagrees with this one, this one is correct.**

## The correction

The Supabase project this repository has been developed against was documented
throughout as a **development** environment. It is not. The owner has confirmed
directly in the Supabase dashboard that it is the **Production** project.

| | |
|---|---|
| Previously documented as | development / "no production environment exists" |
| Actually | **Production** |
| Confirmed by | the project owner, in the Supabase dashboard |
| Corrected during | WS-18 Pass 1B (assessment) / Pass 1C (remediation) |

The live project identity is authoritative. Documentation written under the old
label was mistaken about the environment, not about the facts it recorded.

## Why this mattered

This was not a cosmetic labelling error. It had a direct, traceable security
consequence.

`docs/SUPABASE_SECURITY_REMEDIATION.md` recorded, correctly, that `anon` and
`authenticated` held blanket privileges on every application table, and decided
that narrowing those grants was *"a reasonable later hardening step, not
required"* — a defensible call for a development database, and the wrong call
for Production. WS-18 Pass 1B classified exactly that deferral as
**F-1B — HIGH CONFIGURATION DEFECT**. Pass 1C closed it.

An environment label is a security control. It determines the standard a change
is held to. Treat a wrong one as a defect in its own right.

## Naming convention going forward

Prefer **environment-neutral** terminology in documentation:

- ✅ "the Production Supabase project", "the primary database", "the deployment target"
- ❌ hardcoded project references, dashboard URLs, connection strings, region
  identifiers, or role passwords

The project reference belongs in configuration (`.mcp.json`, deployment
environment variables), not scattered across prose. Documentation that names it
inline creates coupling that has to be corrected by hand every time the estate
changes — which is precisely how this mislabelling survived as long as it did.

**Never** place credentials, passwords, connection strings, service-role keys, or
the audit role's password in documentation. Connection material is supplied
exclusively through environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Application runtime + migrations. Owning role; bypasses RLS by design (see below). |
| `PRODUCTION_AUDIT_DATABASE_URL` | Read-only security auditor (`hrms_sec_audit`): non-superuser, `NOBYPASSRLS`, catalog-oriented. Used by `pnpm --filter @workspace/db run verify:posture`. |

## Documents affected by the old label

These still contain "development" phrasing about this project. Their historical
statements are left intact — rewriting a dated record of what was believed at the
time would falsify it — but each is governed by this correction:

- `PROJECT_STATUS.md` — the workstream log. Every "shipped in development",
  "applied to development", and "live QA against the real development database"
  entry describes work that went to **Production**.
- `docs/SUPABASE_SECURITY_REMEDIATION.md` — carries its own correction notice.
- `docs/PHASE_3B_ATTENDANCE_IMPLEMENTATION_PLAN.md` — its claim that "**No
  production environment exists or has been touched at any point**" is **false**.
- `docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md` — its claim that "**Nothing
  in this plan authorizes touching production**" did not hold: the project it
  named as development is Production.
- `docs/TENANT_DOMAINS_AND_ACCESS.md` — the "existing development organization"
  it describes is a Production organization holding real records.

## Standing consequence

Any change to this project is a **Production** change and is held to CLAUDE.md's
Deployment standard: verified build, passing tests, migration verification,
environment validation, rollback strategy, deployment documentation.

At the time of writing, Production is **19 migrations behind** the repository
(`0056` applied vs `0074` committed; 121 of 198 tables exist). Closing that gap
is a Production deployment, not a routine catch-up.

> **Update (2026-09-03, tenant identity hardening):** the repository now
> carries `0075_chilly_felicia_hardy` (`organizations.tenant_uuid`, its unique
> index and an identity-immutability trigger — additive, no new table). The
> Production gap is therefore **20 migrations** (`0056` applied vs `0075`
> committed; still 121 of 198 tables). Nothing has been applied to Production;
> the manual backup gate remains unsatisfied. See
> `docs/TENANT_IDENTITY_AND_CUSTOMIZATION.md` §9.
