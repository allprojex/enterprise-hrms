# Claude Development Handoff

_Prepared: 2026-07-30, end of session. Read this first, before `PROJECT_STATUS.md`, before starting any new work._

---

## 1. Current Project

Enterprise HRMS — a configurable, multi-tenant Human Resource ERP platform (one shared foundation, config-driven per organization type; see `CLAUDE.md` at the repo root for the full product/architecture principles). Monorepo: `artifacts/api-server` (Express), `artifacts/hrms` (React/Vite frontend), `lib/db` (Drizzle ORM schema/migrations), `lib/api-spec` (OpenAPI source of truth), `lib/api-client-react` + `lib/api-zod` (generated clients — never hand-edited).

## 2. Current Phase

**Phase 3A — Recruitment & Hiring**, in progress. Frozen plan: `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` (21 workstreams, W43–W63).

Completed: W43, W44, W45, W46, W47, W49, W51.
Deferred (not completed): W50.
There is no session "W48" — see §7 below.

## 3. Current Branch

`main`. No feature branches in use — every workstream has been committed and pushed directly to `main`.

## 4. Latest Commit Hash

```
37b032165baa5b310778c8d51f4ef8ca62724111  (short: 37b0321)
feat(recruitment): add application pipeline
```
Confirmed pushed and in sync with `origin/main` as of this handoff (`git status -sb` shows no ahead/behind).

## 5. Today's Completed Workstreams

(Session numbering — see §7 for the numbering note.)

- **W47 — Vacancy Management Foundation.** `vacancies`, `vacancy_locations`, `vacancy_questions`. Internal CRUD/lifecycle only (draft→scheduled/published→paused⇄published→closed→archived). Commit `e793b67`.
- **W49 — Public Careers Portal (Read + Apply Shell).** Full frozen scope, not a shell — public org/vacancy read plus a real anonymous application-submission pipeline (`candidates`, `candidate_consents`, `candidate_documents`, `applications`). This was a deliberate escalation over the task prompt's own narrower framing, confirmed with the user via `AskUserQuestion` before building — see §7. Commit `083e430`.
- **W50 — Candidate Accounts & Verification — DEFERRED, not completed.** Documentation-only. See §6.
- **W51 — Application Pipeline & Stage Movement.** The start of the ATS: `application_stage_history` (one new table), stage movement/reject/withdraw/reopen against W44's existing `recruitment_stages`. Commit `37b0321`.

## 6. Deferred Workstreams

**W50 — Candidate Accounts & Verification.** Formally deferred by an approved product decision (2026-07-30), not skipped or forgotten. Full reasoning and the original, unmodified scope are preserved in `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md`'s own W50 section (marked `STATUS: DEFERRED — NOT IMPLEMENTED`) and in `PROJECT_STATUS.md`'s W50 entry. In one line: W49 already delivers the minimum useful public recruitment product (anonymous applications, consent, CV upload, signed-token status checking); candidate accounts add real auth surface and support burden with no demonstrated need yet. **Do not implement W50 unless explicitly instructed.**

**W39 (Phase 2B)** — employment-history and skills/qualifications/certifications aggregation into Employee Self-Service — remains open, unrelated to today's work, not touched today.

## 7. Important Architecture Decisions Made Today

1. **W49 scope escalation, user-confirmed.** The W49 task prompt's own body described a narrow "shell" (no persistence, no file upload) while separately saying "the frozen plan controls" on conflict — and the frozen plan's actual Objective/Scope for W49 requires a real anonymous submission pipeline. This was flagged explicitly and the user chose the full frozen scope via `AskUserQuestion` before any code was written. **If a future task prompt for a later workstream also conflicts with its own frozen-plan section, flag it the same way — do not silently pick either interpretation.**
2. **Numbering resync at W49.** Sessions building W45–W47 used a session numbering one behind the frozen document's own (e.g. session-"W47" = frozen document's own W48). The user explicitly instructed this session to stop that drift starting at W49 — use the frozen document's numbering directly from W49 onward. **There is no session "W48."** Full explanation is in `PROJECT_STATUS.md`'s "Current Phase" section — read it before assuming any workstream number lines up 1:1 with the frozen document without checking.
3. **W50 deferral, and no ADR log exists.** This repository has no established ADR/architecture-decision-record file or directory convention — only informal, uncatalogued `"ADR-NNN"` citations appear inline inside the phase-plan documents, with no canonical source to append to. The W50 deferral decision was recorded directly in `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md`'s own W50 section and in `PROJECT_STATUS.md` instead of inventing a new ADR framework for one decision. **If a future task asks to "record an architecture decision," check first whether this is still true — do not assume an ADR log exists.**
4. **Public vacancy eligibility applies its own independent `openDate`/`closeDate` gate**, regardless of internal `status`. W47's "manual flip" lets a staff operator publish a vacancy internally before its `openDate` (deliberate feature); W49's public read layer still hides it from the public until `openDate` arrives, and still hides a `published` vacancy whose `closeDate` has passed. The public boundary never mutates the stored vacancy — filtering is applied fresh on every read.
5. **W51 stage model reuses W44's `recruitment_stages` unchanged** — it did **not** introduce a new hardcoded stage/status enum. Every stage maps to one of the frozen plan's 8 fixed categories (`applied/screening/interview/assessment/offer/hired/rejected/withdrawn`); system logic keys off category, never an org's own stage label. Only one new table was added (`application_stage_history`) — no separate comments table, per the frozen plan's own "one new table" database-impact line.
6. **Recurring permission-rollout precedent** (established across W45/W47/W51): the frozen plan's §7 permission matrix marks an "Assigned" tier for several administrative actions (e.g. requisition update, vacancy publish/close, application pipeline move), but every workstream so far has realized "Assigned" as a **visibility** tier only, not a broader role grant — the actual write permission key is seeded to `org_admin`/`hr_manager`/`super_admin` only, since no dedicated "recruiter"/"hiring manager" role exists in this platform's role model. **Follow this same pattern for any new Recruitment permission** unless explicitly told otherwise.
7. **Visibility/404 discipline, consistent since W45:** a record that exists but isn't visible to the caller returns 404, identical to a nonexistent record — never 403 — so visibility can never be probed via a status-code difference. Applies to job requisitions, vacancies, applications, and (for tenant/careers-portal existence itself) public organization resolution.

## 8. Current Database Migration Number

Latest applied-in-sequence (generated, **not applied to any database**): `0026_previous_adam_destine.sql` (+ hand-authored `.down.sql`).

Full Phase 3A migration set so far: `0021` (W44 config), `0022` (W45 requisitions), `0023` (W46 approvals), `0024` (W47 vacancies), `0025` (W49 candidates/applications), `0026` (W51 application_stage_history) — 13 new tables total across Phase 3A, all purely additive. Journal is sequential, no gaps. Zero drift confirmed after every generation (re-run `drizzle-kit generate` to re-verify — it should report "No schema changes, nothing to migrate").

**None of these migrations have been applied to any database.** They are all awaiting explicit approval per `CLAUDE.md`'s Database Rules.

## 9. Current Test Totals

- **Backend:** 511 / 511 passing (`artifacts/api-server`, vitest)
- **Frontend:** 134 / 134 passing (`artifacts/hrms`, vitest)
- Typecheck: clean across all workspaces. Lint: clean. Production build: succeeds for `api-server`, `hrms`, `mockup-sandbox`.
- OpenAPI → generated clients: zero unexpected diff, verified across two consecutive `codegen` runs.

## 10. Open Issues or Blockers

None. Every workstream completed today finished in the `Complete` state with all its own verification green. No known regressions, no failing tests, no unresolved TODOs left in the code from today's work.

## 11. Files Intentionally Left Untouched

- **`artifacts/hrms/src/pages/login.tsx`** — modified before this session began (pre-existing, unrelated work). Every workstream today explicitly confirmed this file remained untouched before staging/committing. **Do not commit or stage this file** unless the user asks for it directly — it is not part of any Recruitment workstream.
- Various untracked pre-existing items never touched or staged by any Recruitment commit: `.agents/skills/`, `.claude/`, `.mcp.json`, `CLAUDE.md`, `CONTRIBUTING.md`, `HRMS-Projects/`, `artifacts/api-server/uploads/`, `docs/.claude/`, `docs/architecture/`, `skills-lock.json`. Leave these alone unless separately instructed.

## 12. Exact Next Workstream

**W52 — Screening Questions & Scoring** (`docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` §23, line 516).

- **Objective:** Answer capture, knockout evaluation, scoring rollup.
- **Dependencies:** W48 (= this session's W47, Vacancy Management — complete) and W51 (Application Pipeline — complete). **W52 is unblocked.**
- **Scope:** two new tables — `application_answers`, `application_scores`.
- **API impact:** answers captured **at W49's existing apply endpoint** (`POST /careers/:orgSlug/jobs/:vacancyPublicId/apply`) — this means W52 will need to *modify* that existing W49 route/service to accept and persist answers to the vacancy's `vacancy_questions`, not just add new endpoints. Scores get new endpoints on `/applications/:id`.
- **Frontend impact:** answers shown on `/applications/:id` (the page built in W51); a new score-entry UI.
- **Verification:** knockout-flagging correctness, score-recomputation-on-read tests.

## 13. Exact First Instruction the Next Claude Session Should Follow

Do not start coding immediately. First:

1. Read `CLAUDE.md`, this file, and `PROJECT_STATUS.md`'s "Current Phase" + the W51 and W49 entries in "Phase 3A Progress" (for the `vacancy_questions` and `applications`/`candidates` shapes W52 builds on).
2. Read the W52 section of `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` in full (§23), plus §9 (Database Table Plan) for the frozen `application_answers`/`application_scores` field lists, since past workstreams have found the compact §23 entries incomplete on their own.
3. Read the actual, currently-implemented `submitPublicApplication` in `artifacts/api-server/src/lib/candidateApplications.ts` (W49) and the vacancy_questions schema (`lib/db/src/schema/vacancy-questions.ts`, W47) before designing how answers get captured — this workstream modifies existing W49 code, it doesn't just add new files.
4. Reconcile the frozen plan against reality the same way every prior workstream in this session did (each workstream so far found at least one gap between the compact §23 line and either the fuller spec elsewhere in the doc, or what a prior workstream actually shipped) — document any such gap transparently rather than silently picking an interpretation, and use `AskUserQuestion` if a genuine scope conflict (like W49's) comes up again.
5. Only then implement, following the same pattern every prior workstream used: schema → migration (`drizzle-kit generate`, hand-author `.down.sql`, confirm zero drift) → service lib → permissions → routes → OpenAPI → codegen (verify zero-diff twice) → frontend → focused tests (backend + frontend) → full verification → `PROJECT_STATUS.md` update → review diff → stage only this workstream's files → commit → push.

## 14. Anything the Next Session Must NOT Modify

- **`artifacts/hrms/src/pages/login.tsx`** — pre-existing, unrelated. Never stage or commit it.
- **W50's scope** — do not implement candidate accounts/authentication/sessions unless the user explicitly un-defers it.
- **Completed workstreams' own files** (W43–W47, W49, W51) — extend via new files/additive changes only if W52 genuinely requires it (e.g. the W49 apply-route modification called out in §12 above is expected and fine); do not redesign or refactor anything outside what W52's own frozen scope requires.
- **Any already-generated migration `0021`–`0026`** — never edit a past migration file; a new one is always `0027` (check `lib/db/drizzle/meta/_journal.json` for the true next number before generating, don't assume).
- **`lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*`** — never hand-edited, only ever produced by `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`.
- **Do not apply any migration to a live database** — every migration in this project remains generated-but-unapplied pending the user's explicit approval, per `CLAUDE.md`.

## 15. Implementation Notes to Continue Safely

- **Migration generation requires a dummy `DATABASE_URL`** to run offline (no real DB connection needed for `generate`): `DATABASE_URL="postgres://user:password@localhost:5432/hrms" pnpm --filter @workspace/db run generate`.
- **Test harness pattern:** every backend test file in this phase (`vacancies.test.ts`, `publicCareers.test.ts`, `applicationPipeline.test.ts`) uses the same hand-rolled `vi.mock("@workspace/db", ...)` + `vi.mock("drizzle-orm", ...)` in-memory table/query-builder mock — copy the newest one (`applicationPipeline.test.ts`) as the starting template for W52's tests rather than reinventing it.
- **Frontend test gotcha already fixed:** `artifacts/hrms/src/test/setup.ts` now stubs `ResizeObserver` (needed by Radix's `Checkbox` and similar size-aware primitives when mounted outside a closed dialog) — don't re-add this, it's already there.
- **`wouter`'s `useParams()` only populates inside a matching `<Route>`** — frontend tests must wrap the page under test in a `<Route path="...">{() => <Page/>}</Route>`, not just render it bare inside `<Router>`, or route params will silently come back empty.
- **Codegen quirk:** avoid `format: email` in OpenAPI string schemas — it broke code generation against this repo's pinned Zod version earlier this session (produces `zod.email()`, unsupported here). Use plain `type: string` for email fields, matching every existing endpoint.
- **`recruitment_settings` has diverged from the frozen plan's §9 field list** (e.g. no `careersSlug`, no `vacancyApprovalRequired`, has `externalRecruitmentEnabled`/`duplicateCandidatePolicy` instead) — always check the actual schema file (`lib/db/src/schema/recruitment-settings.ts`) rather than trusting §9's prose when a workstream depends on a settings field.
- **Vacancies carry no salary field**, and `job_requisitions.salaryRangeMin/Max/Currency` is explicitly "org-internal only, never public" — if W52 or later touches anything salary-adjacent, preserve that boundary.
- **`applications.currentStageId` is nullable and commonly `null`** for anything not yet triaged through W51's pipeline — code reading it (including whatever W52 builds) must handle the null case, treated as the `applied` category for display purposes only, never written back.
