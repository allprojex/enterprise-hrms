# Skills, Competency Framework & Succession (WS-14)

Implements the architecture frozen in §30 of `ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md`.
Read that section first: it records the Owner Decisions this implementation is bound by,
and where the two disagree, §30 governs.

---

## What this module is for

Two questions, kept deliberately separate:

1. **What can our people do, and what do our roles need?** — the skills catalogue,
   employee capability records, assessment and verification, position requirements
   and gap analysis. Operated by HR, visible in part to each employee about themselves.
2. **Who could step into a critical role, and when?** — succession plans, candidate
   pools and readiness bands. Confidential, and never employee-facing.

They share a database and a permission model but not an audience. That separation is the
single most important thing about this module, and §30.17 is why.

---

## Four concepts that must not be collapsed (§30.5)

| Concept | Means | Who creates it |
| --- | --- | --- |
| **Claim** | "I can do this" / "HR recorded that they can do this" | The employee, or HR |
| **Assessment** | "I observed them at this level" | HR, or the employee's reporting manager |
| **Verification** | "The organization confirms this" | A holder of `skill_verification.decide` |
| **Requirement** | "This role asks for this" | A holder of `position_requirement.configure` |

A claim is not evidence. An assessment is not a confirmation — recording one moves the
record to `assessed` and deliberately does **not** set a verified level. Only verification
writes `verified_level_id`, and only verified capability counts toward a requirement.

**Nobody verifies their own skill.** The check is made against the actor's own employee
link, not against anything the client sends.

---

## Assessor authority (§30.8)

Two independent routes to it, resolved server-side on every call:

- a holder of `skill_assessment.record`; or
- the subject's **authoritative reporting manager**, read live from
  `employees.reporting_manager_id`.

Never a role name, never a value in the request body. A manager of somebody else, or of
nobody, is refused. This follows §25.2's platform rule: authority is a relationship the
database can prove, not a title.

---

## Gap analysis, and the state that is easiest to misread (§30.6)

`GET /organizations/{id}/employees/{employeeId}/skill-gaps?positionId=` returns one row
per active requirement, in one of four states:

| State | Means |
| --- | --- |
| `no_verified_evidence` | The organization has not confirmed this skill |
| `below_requirement` | Verified, but below the level the role asks for |
| `meets_requirement` | Verified at the required level |
| `exceeds_requirement` | Verified above the required level |

`no_verified_evidence` **does not mean the employee lacks the skill.** Frequently it means
nobody has assessed it yet. Every surface in this module is worded accordingly, and the
frontend tests assert the wording, because the failure mode here is a report that reads as
a competence judgement when it is a record-keeping gap.

An unverified claim is reported separately through `hasUnverifiedClaim`, so a human can see
it. It never satisfies a requirement.

**Certification expiry is derived, never stored** (§30.20). A lapsed certification is
computed against `asOf` on every read, so the same stored record correctly reads as current
today and expired later, with nothing written in between.

---

## The proficiency scale, and why order is immutable (§30.3)

An organization has at most one active scale — a partial unique index enforces it, so this
is a database guarantee rather than a service convention.

A level's **label can change; its order cannot.** Every historical assessment points at a
level row, so moving a level up or down would silently rewrite what a past judgement meant.
`PATCH /proficiency-levels/{id}` carries no ordinal for exactly that reason.

Publishing a new scale **archives** the incumbent inside a transaction. The old scale and
its levels are retained, so every assessment ever recorded still resolves.

---

## Succession: what it is, and the four things it is not (§30.11–30.17)

A succession plan marks a position as one the organization is planning for. Candidates are
nominated onto it with a rationale and a readiness band.

**It does not rank.** There is no rank, score, priority or ordering column on
`succession_candidates`, and none may be added. Candidates are *grouped* by readiness band;
they are not ordered within one. There is no "first successor". A live-schema assertion in
`skillsLive.test.ts` fails if such a column ever appears.

**It does not compute.** Readiness is a human judgement, supplied every time. There is no
9-box, no potential score, and no scheduled job that can reach `setReadiness`.

**It does not appoint.** Nominating changes no position, no employment status and no
reporting line. An appointment is a separate, deliberate employment act elsewhere.

**It is not employee-facing.** There is no ESS succession route anywhere — not candidacy,
not readiness, not target roles. The absence of the route is the enforcement.

### Confidentiality and sensitive reads (§30.17)

| Permission | Grants |
| --- | --- |
| `succession.read` | That a position is succession-managed; coverage counts |
| `succession.confidential.read` | Candidates, rationales, criticality notes, readiness history |
| `succession.manage` | Opening plans, nominating, readiness, removal |

The three confidential reads — opening a plan, reading its candidate pool, reading a
candidate's readiness history — are recorded through Owner Decision #18's existing
`recordSensitiveRead` helper. Listing *which* positions have plans is deliberately not
classified sensitive, on OD #18's own "risk-based, not noisy" rule.

**`org_admin` does not receive any of the three succession keys by default.** A plan may
concern the administrator or somebody they line-manage, and administrative rank is not the
same as a need to see who is being lined up for a role. `hr_manager` receives all three.
This mirrors what §28.17 did with grievance access.

Coverage reporting returns counts only — no candidate identity, no rationale, no note — so
it can be read by somebody who cannot open the plans themselves (§30.25).

---

## Development actions (§30.14)

A record of what was agreed. Learning references (`learning_course_id`,
`learning_enrollment_id`) are validated for organization ownership and then **left alone**:
nothing creates a course, enrols anybody, or issues a certificate, and no enrolment happens
automatically because a gap exists. The Learning module remains authoritative.

---

## Scheduled jobs are observers (§30.21, §27.11)

Four job types, all reminders:

| Job type | Reminds | Recipients |
| --- | --- | --- |
| `skill.verification_pending` | A claim awaits a decision | `skill_verification.decide` |
| `skill.certification_expiring` | Evidence is about to lapse | `employee_skill.manage` |
| `succession.review_due` | A plan has reached its review date | `succession.manage` **only** |
| `development.action_due` | An action reached its target date | `employee_skill.manage` |

No job may assess, verify, nominate, remove a candidate, change readiness, or promote,
transfer or appoint anybody. Notification bodies carry no proficiency value and no
succession content: the succession reminder says a review is due and names nothing, and
routes only to succession holders, because a notification list is a wider audience than a
record's own permission.

---

## Permissions

| Key | Purpose | org_admin | hr_manager |
| --- | --- | --- | --- |
| `skill_catalogue.read` | Read the catalogue and scale | ✅ | ✅ |
| `skill_catalogue.configure` | Define skills and the scale | ✅ | ❌ |
| `employee_skill.read` | Read employee capability | ✅ | ✅ |
| `employee_skill.manage` | Record skills, development actions | ✅ | ✅ |
| `skill_assessment.record` | Record an assessment as HR | ✅ | ✅ |
| `skill_verification.decide` | Verify or reject a claim | ✅ | ✅ |
| `position_requirement.read` | Read what a role requires | ✅ | ✅ |
| `position_requirement.configure` | Set what a role requires | ✅ | ✅ |
| `succession.read` | Which positions are managed; coverage | ❌ | ✅ |
| `succession.manage` | Plans, nominations, readiness | ❌ | ✅ |
| `succession.confidential.read` | Candidates, rationales, notes | ❌ | ✅ |

`skill_catalogue.configure` is withheld from `hr_manager` on the same
configuration-versus-operation split used by WS-8, WS-10, WS-11, WS-12 and WS-13.

**Employee self-service is gated by no key at all** (§30.22). An employee's right to record
what they can do comes from their employee link, resolved server-side — not from a grant
somebody could withhold.

---

## Surfaces

| Route | Audience | Covers |
| --- | --- | --- |
| `/skills-settings` | HR | Catalogue, proficiency scale, Master Data import |
| `/capability` | HR | Skill profiles, assessment, verification, position requirements, gaps, development actions |
| `/succession` | Succession holders | Plans, candidates, readiness bands, coverage |
| `/my-skills` | Every employee | Own skills, own claim, own gaps — **no succession content** |

Nav visibility is presentation only. Every endpoint enforces its own permission
server-side, so a caller who navigates directly is still correctly authorized.

---

## Master Data import (§30.4)

`POST /organizations/{id}/skills/import-master-data` reads the existing `skill` Master Data
domain and creates catalogue entries for codes not already present. It is **idempotent** —
re-running imports nothing — and **one-way**: Master Data is read and never written.
Imported skills carry `source_master_data_code` and the neutral `other` category, because
Master Data items carry no category information and guessing one would be worse than
leaving it plain.

---

## Relationship to the legacy `employee_skills` table

The pre-existing free-text `employee_skills` surface
(`GET/POST /organizations/{id}/employees/{employeeId}/skills`) is **untouched by WS-14**.
Migration `0070` does not reference it. The new model lives at `/skill-records` precisely so
it does not shadow the shipped endpoint; the two coexist, and consolidating them would be a
separate decision with its own migration path.

---

## Schema

Eleven tables, migration `0070`, all with RLS enabled and zero policies (the platform
convention):

`skills`, `proficiency_scales`, `proficiency_levels`, `employee_skill_records`,
`employee_skill_assessments`, `position_skill_requirements`, `readiness_levels`,
`succession_plans`, `succession_candidates`, `succession_candidate_events`,
`development_actions`.

Database guarantees worth knowing:

- `skills_org_code_unique` — one code per organization
- `proficiency_scales_active_per_org_unique` (partial, `active = true`) — one active scale
- `proficiency_levels_scale_ordinal_unique` — one level per position in a scale
- `employee_skill_records_employee_skill_unique` — one standing per employee per skill
- `position_skill_requirements_unique` — one expectation per position per skill
- `succession_plans_open_per_position_unique` (partial, `status in ('active','under_review')`) — one open plan per position
- `succession_candidates_active_unique` (partial, `status = 'active'`) — one active candidacy per employee per plan

`employee_skill_assessments` and `succession_candidate_events` are append-only chronologies.
Nothing edits or deletes a row in either.

---

## Testing

- **`artifacts/api-server/src/test/skillsLive.test.ts`** — 25 tests against a real
  PostgreSQL database. Set `WS14_LIVE_DATABASE_URL` to a local disposable database; the
  suite self-skips without it, and `liveDbGuard.ts` refuses a non-local host.
- **`artifacts/hrms/src/test/{my-skills,capability,succession}.test.tsx`** — 18 tests
  driving the write paths, including the wording assertions for §30.6 and the
  no-ranking assertions for §30.12.

```bash
docker compose up -d db
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run migrate
DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms pnpm --filter @workspace/db run seed:roles
cd artifacts/api-server && WS14_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
  npx vitest run src/test/skillsLive.test.ts --pool=threads --maxWorkers=1
```

The `threads` pool matters: the default fork pool silently drops test files on some
Windows machines.

---

## Deliberately out of scope

Frozen by §30 as not-in-WS-14, and not to be added without a new Owner Decision:

- 9-box grids, potential scoring, numeric successor ranking
- Automatic promotion, transfer or appointment from a succession plan
- Automatic enrolment from a gap
- Any employee-facing succession visibility
- Consolidating or migrating the legacy `employee_skills` table
