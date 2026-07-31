# Claude Development Handoff

_Prepared: 2026-07-31, end of session. Read this first, before `PROJECT_STATUS.md`, before starting any new work._

---

# Project

- **Project name:** Enterprise HRMS — a configurable, multi-tenant Human Resource ERP platform (one shared foundation, config-driven per organization type; see `CLAUDE.md` at the repo root for the full product/architecture principles). Monorepo: `artifacts/api-server` (Express), `artifacts/hrms` (React/Vite frontend), `lib/db` (Drizzle ORM schema/migrations), `lib/api-spec` (OpenAPI source of truth), `lib/api-client-react` + `lib/api-zod` (generated clients — never hand-edited).
- **Current branch:** `main`. No feature branches in use — every workstream has been committed and pushed directly to `main`.
- **Latest commit hash:**
  ```
  07281fe777a8e5dd156d344a537594499c825674  (short: 07281fe)
  feat(recruitment): add reference and background checks
  ```
  Confirmed pushed and in sync with `origin/main` as of this handoff (`git status -sb` shows no ahead/behind).
- **Current phase:** Phase 3A — Recruitment & Hiring, in progress. Frozen plan: `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` (21 workstreams, W43–W63).
- **Current workstream completed:** W56 — Reference & Background Checks.
- **Next workstream:** W57 — Offers.

---

# Current Status

## Completed workstreams (Phase 3A, session numbering — see "no session W48" note below)

- **W43 — Recruitment Foundation.**
- **W44 — Recruitment Configuration Foundation.** `recruitment_settings`, `recruitment_workflows`, `recruitment_stages`.
- **W45 — Job Requisition Foundation.** `job_requisitions`.
- **W46 — Requisition Approval Workflow** (frozen document's own W47). `requisition_approvals`.
- **W47 — Vacancy Management Foundation** (frozen document's own W48). `vacancies`, `vacancy_locations`, `vacancy_questions`. Internal CRUD/lifecycle only.
- **W49 — Public Careers Portal (Read + Apply Shell).** Full frozen scope (escalated from the task prompt's own narrower framing, user-confirmed via `AskUserQuestion`) — public org/vacancy read plus a real anonymous application-submission pipeline: `candidates`, `candidate_consents`, `candidate_documents`, `applications`.
- **W51 — Application Pipeline & Stage Movement.** `application_stage_history`; stage move/reject/withdraw/reopen against W44's `recruitment_stages`.
- **W52 — Screening Questions & Scoring.** `application_answers`, `application_scores`; answer capture added to W49's existing apply endpoint; knockout evaluation (never auto-rejects); computed, never-stored `scoreRollup`.
- **W53 — Candidate Notes, Tags, and Talent Pools.** `candidate_notes`, `candidate_tags`, `talent_pools`, `talent_pool_members`; internal candidate read (`lib/candidates.ts`) added as a byproduct.
- **W54 — Interviews & Scheduling.** `interviews`, `interview_panel_members`; scheduling only, no evaluation. Reschedule realized as cancel-old-row + create-new-row, never in-place date mutation.
- **W55 — Interview Scorecards.** `interview_scorecards`, `interview_scorecard_responses`; independent, lockable evaluations, one per panel member per interview. No template/criteria/weighting system exists in the frozen scope.
- **W56 — Reference & Background Checks.** `reference_checks` (reuses `application.read`/`.manage` — no dedicated permission), `background_checks` (own dedicated, organization-wide-only `background_check.read`/`.manage` pair).

## Deferred workstreams

- **W50 — Candidate Accounts & Verification — DEFERRED, not completed** (approved product decision, 2026-07-30). Full reasoning and the original, unmodified scope are preserved in `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md`'s own W50 section (marked `STATUS: DEFERRED — NOT IMPLEMENTED`) and in `PROJECT_STATUS.md`'s W50 entry. In one line: W49 already delivers the minimum useful public recruitment product (anonymous applications, consent, CV upload, signed-token status checking); candidate accounts add real auth surface and support burden with no demonstrated need yet. **Do not implement W50 unless explicitly instructed.** Nothing built since W50 (W51 through W56) has needed anything from it.
- **W39 (Phase 2B)** — employment-history and skills/qualifications/certifications aggregation into Employee Self-Service — remains open, unrelated to Phase 3A, not touched this session.

## Known limitations (deliberate, documented — not oversights)

- **No scorecard/reference-check/background-check template or criteria configuration system.** The frozen §9 table plan for W55/W56 defines only free-text fields (`criterion`, `checkType`) — no organization-configurable Master Data domain, no weighting, no rating scale.
- **External-panel-member interview evaluation is deferred.** `interview_scorecards.externalInterviewerToken`/`externalInterviewerTokenExpiresAt` are reserved columns (per §9) but no route consumes them — §10 lists no external/public route for scorecards, mirroring `vacancies.publicId`'s "reserved, not consumed" precedent.
- **No consent-gating for background checks.** The frozen `background_checks` row has no `consentReference`/consent-linkage column — W49's application-submission consent is not reinterpreted as blanket permission, but no second, check-specific consent record was invented either.
- **No live browser/dev-database walkthrough has been possible in this environment for any Recruitment workstream** — this environment has no provisioned dev database. All verification has relied on the automated backend/frontend test suites, typecheck, lint, and production build.

---

# Today's Accomplishments

Today's session completed five workstreams end-to-end: **W52, W53, W54, W55, W56** (W43–W51 were completed in earlier sessions this phase; see `PROJECT_STATUS.md` for their own entries).

## Architecture decisions

- **W52:** screening answers captured by *modifying* W49's existing apply endpoint (not a new endpoint) — knockout evaluation happens at submission time and only *flags* a failed answer for review, never auto-rejects. `applications.score` stays permanently unused; `scoreRollup` is computed fresh on every read from `application_scores` (explicit `overall` entry wins outright; otherwise the average of latest screening/interview entries).
- **W53:** notes/tags/talent pools kept as three independently extensible abstractions, not merged. `candidate_notes.applicationId` (nullable) distinguishes candidate-level vs. application-level notes. Talent pools are organization-wide only (no assigned tier) since a pool isn't reachable through any one requisition's recruiter/hiring-manager.
- **W54:** interview visibility introduced a genuinely new "assigned" shape for this phase — not the recruiter/hiring-manager-on-linked-requisition chain every other resource uses, but direct panel membership on that specific interview (`interview_panel_members.interviewerMembershipId == caller`). Rescheduling is cancel-old-row + create-new-row, never in-place date mutation (§4.5).
- **W55:** scorecards deliberately excluded any template/criteria/weighting system since none exists in the frozen model (`criterion` is free text, `rating` is an unconstrained integer). `scorecard.submit` never implies `scorecard.read_all`, even for the same caller — an interviewer never sees a colleague's scorecard through this API, submitted or not.
- **W56:** reference checks and background checks kept as two distinct business processes in separate tables/lib/route files. Reference checks reuse `application.read`/`.manage` (no dedicated permission exists in §7); background checks get their own dedicated, organization-wide-only `background_check.read`/`.manage` pair — holding `application.read`/`.manage` (or `candidate.read`) never implies background-check access.

## Security decisions

- **W54/W55/W56:** three separate, real leaks were found and fixed during each workstream's own pre-commit security review, each with a dedicated regression test added:
  - W55: `interview_scorecards.externalInterviewerToken`/`externalInterviewerTokenExpiresAt` were being spread from the raw DB row into every API response — fixed with an explicit `PublicInterviewScorecard` omission.
  - W56: `background_checks.documentStorageKey` (the raw evidence file storage key) was likewise being spread into responses — fixed with a `PublicBackgroundCheck` shape that exposes only a computed `hasEvidence` boolean.
  - W55: the scorecard GET route's permission gate incorrectly required `scorecard.submit` specifically, which would have 403'd a caller holding only `scorecard.read_all` — fixed to accept either permission.
- Every workstream this session confirmed: no automatic stage move / offer / hiring action is ever triggered by a scorecard, interview outcome, or check result; no sensitive fields (referee contact, resultSummary, notes, vendor reference, storage keys, raw tokens) ever appear in `recordAuditEvent` metadata.

## Permission decisions

- New permission keys added this session: `interview.read`/`.manage` (W54), `scorecard.submit`/`.read_all`/`.finalize` (W55), `background_check.read`/`.manage` (W56).
- Recurring rollout pattern followed for every new "read" key: seeded broadly (every role) to enable the assigned-visibility tier where one exists; every new "write"/"manage" key stays `org_admin`/`hr_manager`-only, since no dedicated recruiter/hiring-manager role exists in this platform's role model.
- W56 is the first resource this phase with a permission (`background_check.read`/`.manage`) that has **no assigned tier at all** — flat organization-wide-only, per §7's own matrix (explicitly "the narrowest permission in the matrix").

## Database changes / migrations created (none applied)

- `0027_violet_ozymandias.sql` (W52 — `application_answers`, `application_scores`)
- `0028_simple_onslaught.sql` (W53 — `candidate_notes`, `candidate_tags`, `talent_pools`, `talent_pool_members`)
- `0029_flawless_captain_midlands.sql` (W54 — `interviews`, `interview_panel_members`)
- `0030_wide_doctor_octopus.sql` (W55 — `interview_scorecards`, `interview_scorecard_responses`)
- `0031_premium_wolfsbane.sql` (W56 — `reference_checks`, `background_checks`)

All five have a hand-authored `.down.sql`, are purely additive, and are **not applied to any database** — zero drift confirmed after every generation.

## OpenAPI changes

New tags/schemas/paths added for `applications` (answers/scores embedded), `candidates`, `talent-pools`, `interviews`, `interview-scorecards`, `reference-checks`, `background-checks`. Codegen verified zero unexpected diff across two consecutive runs after every workstream. One notable codegen quirk found and worked around (W55): a nullable-object-via-`allOf` OpenAPI pattern produced a broken `(unknown | null) & X` TypeScript type via orval — replaced with a plain inlined `type: ["object", "null"]` shape.

## Frontend additions

`/candidates/:id`, `/talent-pools`, `/interviews`, `/interviews/:id`, `/interviews/:id/scorecard` (new pages); an "Interviews" card + Schedule dialog and "Reference Checks"/"Background Checks" sections added to the existing `/applications/:id` page; a "Scorecard" link added to `/interviews/:id`. Nav links added for Talent Pools and Interviews.

## Backend additions

New lib files: `candidates.ts`, `candidateNotes.ts`, `candidateTags.ts`, `talentPools.ts`, `interviews.ts`, `interviewScorecards.ts`, `referenceChecks.ts`, `backgroundChecks.ts`. New route files for each. `orgScopedRefs.ts` extended (added `organizationMembershipsTable` to the reusable cross-org-reference-validation union).

## Tests added

- Backend: 542 → 600 passing (43 files) — candidatesTalentPools (22), interviews (19), interviewScorecards (14→15), referenceChecks (10), backgroundChecks (14).
- Frontend: 158 → 186 passing (28 files) — candidate-detail (8), talent-pools (8), interviews (6), interview-detail (7), interview-scorecard (8), plus 7 new cases added to `application-detail.test.tsx`.

## Verification results

Every workstream this session finished with: focused + full backend suite green, focused + full frontend suite green, full-workspace typecheck clean, lint clean, OpenAPI codegen zero-diff (x2), migration drift zero, production build green for `api-server`/`hrms`/`mockup-sandbox`. No live database/browser environment exists here — this was stated explicitly in every workstream's final report, never silently assumed.

---

# Current Architecture Decisions

(Cumulative list of decisions still governing the project — see `PROJECT_STATUS.md`'s Phase 3A Progress entries for the full reasoning behind each. Not rewriting older, still-valid decisions from W43–W51 beyond what's listed here.)

- **W50 (Candidate Accounts) is formally deferred**, not cancelled — no candidate-session/authentication concept exists anywhere in this codebase.
- **Anonymous-first recruitment model** (W49): every application is anonymous; a candidate has no account/login/session; status is checked only via a signed, time-limited token.
- **Pipeline uses configurable recruitment stages** (W44/W51): stages are org-configurable rows mapped to 8 fixed categories; system logic keys off category, never an org's own stage label.
- **Interview scheduling is fully separated from interview evaluation** (W54 vs. W55): `interviews`/`interview_panel_members` know nothing about scores/recommendations; `interview_scorecards`/`interview_scorecard_responses` never write to W54's tables.
- **Screening/scoring (W52) is a distinct process from interview scorecards (W55)** — never merged into one rollup, never mixed with reference/background checks (W56) either, despite all four superficially "tracking an evaluation."
- **Computed rollups instead of stored totals, everywhere this pattern applies:** `application.scoreRollup` (W52) and the interview scorecard panel-completion summary (W55) are both computed fresh on every read from their source rows, never persisted or cached.
- **Immutable/append-only history wherever the frozen plan requires it:** `application_stage_history`, interview rescheduling (cancel + new row, not in-place), a submitted scorecard (immutable from the interviewer's side), a terminal reference/background check (no further status or result change).
- **404-not-403 visibility discipline, consistent since W45:** a record that exists but isn't visible to the caller returns 404, identical to nonexistent — never 403 — so visibility can never be probed via status code.
- **"Assigned" visibility tier is a narrowing filter only, never a broader role grant** — every administrative write permission this phase (`application.manage`, `vacancy.manage`, `interview.manage`, etc.) stays `org_admin`/`hr_manager`-only regardless of a resource's read-side assigned tier, since no dedicated recruiter/hiring-manager role exists in this platform's role model. `background_check.read`/`.manage` (W56) has no assigned tier at all, by the frozen matrix's own design, not by this rollout convention.
- **Org-wide visibility is signaled by holding the resource's own administrative permission** (e.g. `application.manage`, `candidate.manage`, `interview.manage`) — never a separate "org-wide" permission key.
- **No ADR log exists in this repository** — architecture decisions are recorded directly in `PROJECT_STATUS.md` and the frozen plan's own sections, not a separate framework.

---

# Database State

- **Latest migration:** `0031_premium_wolfsbane.sql` (+ hand-authored `.down.sql`).
- **Unapplied migrations:** `0021` through `0031` (eleven migrations, twenty-five new tables total across Phase 3A) — **none applied to any database**, all awaiting explicit approval per `CLAUDE.md`'s Database Rules.
- **Migration drift status:** zero drift confirmed after every generation this session (`drizzle-kit generate` reports "No schema changes, nothing to migrate" against the current schema). Journal (`lib/db/drizzle/meta/_journal.json`) is sequential, no gaps.

---

# Verification Status

- **Backend tests:** 600 / 600 passing (`artifacts/api-server`, vitest, 43 files).
- **Frontend tests:** 186 / 186 passing (`artifacts/hrms`, vitest, 28 files).
- **Typecheck:** clean across all workspaces (`pnpm run typecheck`).
- **Lint:** clean (`artifacts/hrms` — `eslint src --max-warnings=0`; no dedicated lint script exists for `api-server`).
- **Build:** production build succeeds for `api-server`, `hrms`, `mockup-sandbox`.
- **OpenAPI/codegen:** zero unexpected diff, verified across two consecutive `codegen` runs after every workstream.
- **Migration drift:** zero, confirmed after every generation.

---

# Files Intentionally Left Untouched

- **`artifacts/hrms/src/pages/login.tsx`** — modified before this session began (pre-existing, unrelated work). Every workstream this session explicitly confirmed this file remained untouched before staging/committing. **Do not commit or stage this file** unless the user asks for it directly.
- Untracked pre-existing items never touched or staged by any Recruitment commit: `.agents/skills/`, `.claude/`, `.mcp.json`, `CLAUDE.md`, `CONTRIBUTING.md`, `HRMS-Projects/`, `artifacts/api-server/uploads/`, `docs/.claude/`, `docs/architecture/`, `skills-lock.json`. Leave these alone unless separately instructed.

---

# Next Workstream

**W57 — Offers** (`docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` §23, line 561).

- **Objective:** Offer drafting, versioning, and approval.
- **Dependencies:** W51 (Application Pipeline — complete), and reuses W47's (Requisition Approval Workflow's) approval-chain shape. **W57 is unblocked.**
- **Scope:** three new tables — `offers`, `offer_versions`, `offer_approvals`.
- **Database impact:** three new tables.
- **API impact:** per §10 — read the exact route list there before assuming shape; this session's every workstream found the compact §23 line under-specifies the actual route surface at least once.
- **Frontend impact:** `/offers`, `/offers/:id`.
- **Verification:** versioning-never-overwrites tests, single-active-offer enforcement (per org policy).

## Important architecture rules for W57

- §14 (Offers — Versioning and Approval) already describes the model in prose: an `offers` row is a stable envelope; `offer_versions` holds the actual content, one immutable row per revision. Editing a `draft` version updates that row in place; editing an `approved`/`issued` version creates a **new** version row and marks the prior one `superseded` — never overwritten. `offers.currentVersionId` always points at the latest non-superseded version. Read §14 in full before designing the schema.
- Whether multiple *active* (non-superseded, non-terminal) offers may exist per application simultaneously is an **org policy flag** (§9/§17) — default is **one active offer per application**, enforced by a partial unique index per §9's own table note. Check the exact frozen field name for this policy flag on `recruitment_settings` before assuming one exists — W44's actual settings schema has already diverged from §9's prose once this phase (documented in `PROJECT_STATUS.md`'s W44 entry and `lib/db/src/schema/recruitment-settings.ts`'s own header comment).
- §7's permission matrix row: `offer.read`/`.manage`/`.approve`/`.issue`/`.withdraw` — Own: none, Assigned: `.manage` (draft only), Org-wide: `.approve`/`.issue`/`.withdraw`. This is a genuinely different shape from every prior workstream's permission rollout (an assigned recruiter/hiring manager CAN write, just only to a draft) — do not default to the "every write stays admin-only" pattern from W51–W56 without checking this row's actual text first.
- Reuse W46's (`requisitionApprovals.ts`) approval-chain shape where the frozen plan says to — do not reinvent a second approval-workflow pattern.

## Things that must NOT be implemented in W57

- Employee conversion (a later workstream).
- Any real compensation-negotiation workflow beyond what the frozen `offer_versions` field list actually defines.
- Any external e-signature or document-generation integration (documented boundary only, per §15, unless the frozen W57 section explicitly says otherwise — read it first).
- Candidate-facing offer acceptance/decline UI unless W57's own frontend-impact line calls for it (it currently only names `/offers`, `/offers/:id` — both internal-staff routes).
- Anything from W50 (still deferred) or W39 (Phase 2B, still open, unrelated).

## Expected deliverables

Schema (`offers`, `offer_versions`, `offer_approvals`) → migration (`0032`, hand-authored `.down.sql`, zero drift) → service lib(s) → permissions → routes → OpenAPI (zero-diff x2) → frontend (`/offers`, `/offers/:id`) → focused backend + frontend tests → full verification → security review → `PROJECT_STATUS.md` update → diff review → stage only W57 files → commit (`feat(recruitment): add offers` or as instructed) → push.

---

# Startup Instructions

The exact instructions the next Claude Code session should follow, in order:

1. Read `CLAUDE.md`.
2. Read `PROJECT_STATUS.md` (top summary + "Current Phase" + the W56 entry in "Phase 3A Progress" at minimum, for the most recent precedents).
3. Read `docs/CLAUDE_HANDOFF.md` (this file) in full.
4. Read only the exact W57 section of `docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md` — §23's compact entry, §14 (Offers — Versioning and Approval) in full, the relevant §7 permission-matrix row, the relevant §9 database-table-plan rows, and the §10 API-plan lines for offers.
5. Do not scan the repository. Do not inspect unrelated HR modules.
6. Implement only W57 — Offers. Do not begin W58.
7. Preserve all existing architecture decisions listed above — do not redesign W44–W56's own files beyond what W57 genuinely requires (e.g. reusing an existing visibility resolver or permission is expected; refactoring one is not).
8. Do not modify W50 (still deferred) or close the outstanding W39 (Phase 2B) scope.
9. Follow the same overall workflow every prior workstream this session used: inspect focused dependencies → reconcile exact frozen scope → implement → focused tests → full verification → security review → documentation → review full diff → stage only this workstream's files → commit → push → stop.

---

# Git State

- **Working tree state:** clean except `artifacts/hrms/src/pages/login.tsx` (pre-existing, unrelated, intentionally left modified-but-uncommitted) and the pre-existing untracked items listed above.
- **Latest pushed commit:** `07281fe` — `feat(recruitment): add reference and background checks` — confirmed in sync with `origin/main` (no ahead/behind).
- **Branch:** `main`.
- **Unrelated files intentionally untouched:** `artifacts/hrms/src/pages/login.tsx`, `.agents/skills/`, `.claude/`, `.mcp.json`, `CLAUDE.md`, `CONTRIBUTING.md`, `HRMS-Projects/`, `artifacts/api-server/uploads/`, `docs/.claude/`, `docs/architecture/`, `skills-lock.json`.

---

# Notes for Tomorrow

- **Migration generation requires a dummy `DATABASE_URL`** to run offline: `DATABASE_URL="postgres://user:password@localhost:5432/hrms" pnpm --filter @workspace/db run generate`. Next migration number is `0032` — confirm against `lib/db/drizzle/meta/_journal.json` before generating, don't assume.
- **Test harness pattern:** every backend test file this phase uses the same hand-rolled `vi.mock("@workspace/db", ...)` + `vi.mock("drizzle-orm", ...)` in-memory table/query-builder mock. Copy the newest, most relevant one as a starting template — `referenceChecks.test.ts` if W57 needs the full application-visibility chain (`resolveApplicationVisibilityContext`/`getVisibleApplicationById`), `backgroundChecks.test.ts` if a flat dedicated-permission model (no assigned tier) is closer to what's needed. If file uploads are involved, mock `../lib/fileStorage` directly (see `backgroundChecks.test.ts`) rather than writing to real disk.
- **`wouter`'s `useParams()` only populates inside a matching `<Route>`** — frontend tests must wrap the page under test in `<Route path="...">{() => <Page/>}</Route>`.
- **React lint gotcha:** this codebase's eslint config enforces `react-hooks/set-state-in-effect` — don't initialize form state from fetched data via `useEffect` + a manual "initialized" flag; instead extract a subcomponent that lazily initializes local state directly from props at mount time (see `interview-scorecard.tsx`'s `MyEvaluationCard` for the pattern).
- **DTO-leak discipline:** whenever a table has a column that shouldn't reach the client (a reserved/future-use column, an internal storage key, a raw token), explicitly omit it in the service layer before returning — never rely on the OpenAPI schema alone to "hide" a field the route handler still spreads from the raw DB row. Two real instances of this bug were caught and fixed this session (W55, W56); check for it proactively in W57 if `offers`/`offer_versions` end up with any internal-only field.
- **Avoid `format: email`** in OpenAPI string schemas — breaks codegen against this repo's pinned Zod version. Use plain `type: string`.
- **Permission design checklist for any new resource:** (1) does §7's matrix give it its own dedicated permission, or does it reuse an existing one? (2) does the matrix show an "Assigned" tier, and if so, is it realized as visibility-narrowing-only (the W51–W56 default) or does it actually grant broader write access (W57's `offer.manage` may be the first exception — check before assuming)? (3) is "org-wide" reach signaled by the resource's own `.manage`/equivalent permission, never a separate key?
- **`recruitment_settings` has diverged from the frozen plan's §9 field list** — always check the actual schema file (`lib/db/src/schema/recruitment-settings.ts`) rather than trusting §9's prose when a workstream (like W57's org-policy offer-count flag) depends on a settings field.
