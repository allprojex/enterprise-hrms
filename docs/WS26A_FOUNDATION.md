# WS-26A — Template, Submission & Structured Document Foundation

**Workstream:** WS-26 — Tenant Form, Workflow & Signature Engine (architecture: `docs/WS26_FORM_WORKFLOW_SIGNATURE_ARCHITECTURE.md`, owner-approved 2026-09-06).
**Phase:** WS-26A. **Status: COMPLETE, not deployed. No Production migration, seed or data write.**
**Migration:** `0076_bizarre_lady_ursula` (journal idx 76; head before generation was `0075`, confirmed immediately before `drizzle-kit generate`).

## 1. What this phase delivers

The reusable, tenant-scoped foundation every later phase builds on:

| Capability | Where |
|---|---|
| Template model with immutable published versions, effective dates, definition hash, signature-policy and render-config hooks | `lib/db/src/schema/form-engine.ts`, `artifacts/api-server/src/lib/formEngine/templates.ts` |
| Server-validated definition contract (sections; `field`, `choice_group`, `matrix`, `rated_table`, `table`, `note`, `signature`, `computed` items; allow-listed bindings; no expressions) | `lib/formEngine/definition.ts` |
| Auto-fill from authoritative records, snapshotted per revision | `lib/formEngine/bindings.ts` |
| Answer validation (draft vs strict), exclusive pairs, rating scales, repeatable tables, sums | `lib/formEngine/answers.ts` |
| Per-version workflow stages; resolvers `subject_employee`, `reporting_manager`, `department_head`, `permission_holder`, `specific_membership` resolved live | `lib/formEngine/templates.ts` |
| Submission lifecycle `draft → submitted/pending_approval ⇄ returned → resubmitted → approved → finalized → archived` (+ `rejected`), append-only revisions, chronology events, maker-checker, stage-count freeze | `lib/formEngine/submissions.ts` |
| Structured PDF renderer: header block with governed logo, bordered tables with repeated headers, drawn checkboxes, signature lines, status marker in the margin, page numbers; deterministic bytes; JPEG logo via `sharp`; no external PDF library, no screenshots | `lib/pdf/layoutRenderer.ts` |
| Document builder: official body from the definition only; Approval & Signature Certificate appended after it (owner decision 1) | `lib/formEngine/render.ts` |
| Download at every state: blank (template), draft, submitted, returned, rejected, approved (rendered on demand from the immutable revision) and **final** (the stored snapshot only, never re-rendered) | `routes/formSubmissions.ts`, `routes/formTemplates.ts` |
| Finalization: one render, `generated_documents` row (`sourceType = form_submission`), SHA-256 recorded, second finalize refused | `submissions.finalize` |
| Permissions `form_template.manage/.publish`, `form.read/.assess/.approve/.finalize/.signature.apply/.final.read` | `lib/db/src/seed/roles-permissions-definitions.ts` |
| Audit: `form_template.created/.version_created/.version_updated/.version_published/.archived/.blank_downloaded`, `form.created/.submitted/.resubmitted/.stage_completed/.approved/.returned/.rejected/.finalized/.archived/.downloaded` | services |
| Frontend: Forms list + start, submission page (renderer, save/submit, stage actions, finalize/archive, downloads, history), Form Templates admin (JSON definition, versions, publish, blank PDF) on the WS-25A foundation | `artifacts/hrms/src/pages/forms.tsx`, `form-submission.tsx`, `form-templates.tsx`, `components/forms/form-renderer.tsx` |
| The four WWM templates as data + docx-derived structure fixtures + fidelity harness | `artifacts/api-server/src/formTemplates/wwm/*`, `src/test/fixtures/wwm-forms/*`, `src/test/wwmFormFidelity.test.ts` |

Deferred by design: signature capture/devices and stored signature assets (WS-26B), Leave-engine delegation, PIF custom fields and onboarding task kind (WS-26C), performance/probation linkage (WS-26D), Production seeding of the four templates (WS-26E, owner-executed).

## 2. Schema (migration 0076, purely additive)

Six tables, eight enum types, RLS enabled on every table (verified: `pg_tables.rowsecurity = true` for all six; local posture script reports 204/204 tables enabled). Down migration `0076_bizarre_lady_ursula.down.sql` drops only what 0076 created; up → down → up verified on the disposable docker `db` (port 5433).

`form_templates` (org, `template_key` unique per org, `form_type`, `module_key`, title, status, `current_published_version_id`) · `form_template_versions` (`(template_id, version_number)` unique, one `published` per template by partial index, `definition` jsonb, `definition_sha256`, `signature_policy`, `render_config`, `first_used_at` lock) · `form_workflow_stages` (per version, `(version, stage_order)` unique, participant, resolver, `resolver_config`, `editable_section_keys`, `allowed_actions`, `signature_slot_key`) · `form_submissions` (template + frozen version, subject employee, status, `current_stage_order`, `stage_count_snapshot`, `current_revision_id`, linked entity, `final_document_id → generated_documents`, `final_sha256`) · `form_submission_revisions` (append-only: answers, `autofill_snapshot`, computed, kind, stage) · `form_submission_events` (chronology incl. `signature_applied` / `signature_revoked` reserved for WS-26B; `details` never carries form content).

## 3. Tenant boundary and authorization

Every service call takes the organization id proven by `requireMembership`; foreign ids are "not found". Templates are visible only within their organization; a non-manager sees only active templates with a published version. A submission is visible to HR (`form.read`), the subject employee (employee link), the creator, and the current stage's resolved actor; everyone else receives 404. Creating a form for another employee requires `form.assess`; a template's `module_key` is enforced with `getModuleAccess` at creation. Decisions cannot be taken by the creator or the subject (checked by user id and membership id). Super Admin has no standing access; break-glass grants apply as everywhere.

Proven live (`formEngineLive.test.ts`, 5 tests): another organization cannot list, read, publish, submit to, render or finalize; a foreign subject id is refused; a published definition cannot be edited; first use freezes the version; the full lifecycle with revisions and events; maker-checker; HR-only finalize; the final snapshot's bytes hash to `final_sha256` and do not change after the employee record changes; rejected forms render REJECTED; a bystander cannot see a submission and holds no template key.

## 4. Fidelity results (all four WWM forms)

`wwmFormFidelity.test.ts` runs three checks per form against the docx structure fixtures (regenerated from the owner's files by `src/test/tools/docxStructure.ts`, which reads `word/document.xml` with no dependencies):

1. **Ordered text stream equality** — the definition's complete text (header, intro, every section title, label, option, rating column, criterion, total and note, in definition order) equals the document's complete text in document order. Not "appears somewhere": the sequences are identical.
2. **Structure** — every section title is a real document heading; every 5-1 rating header is a real document row in that order; every checkbox option sits in the same document table as its section title.
3. **Rendered PDF** — the blank PDF's drawn text contains the same stream in order.

Result: 12/12 passing for Leave Application, Personal Information, Staff Evaluation and Probationary Assessment. Owner decisions 2–6 are encoded in the definitions (one rating per goal; two exclusive recommendation pairs; "Overall Evaluation" un-rated and excluded from the total; multi-select office; unbounded dependants with four printed rows).

## 5. Tests executed

- Backend unit: `formEngineDefinition` (12), `formEngineRenderer` (4), `wwmFormFidelity` (16) — 32/32.
- Backend live (5433): `formEngineLive` — 5/5.
- Backend full suite: 162 files passed, 27 skipped; 2,761 tests passed, 491 skipped (live suites without their URL).
- Frontend: `form-renderer` (5), `form-submission` (4), `forms-and-templates` (4), `app-shell` unchanged — see the commit for the full-suite count.
- Typecheck: api-server and hrms clean. ESLint: 0 findings in touched files (one pre-existing `react-hooks/set-state-in-effect` finding in `app-shell.tsx` is outside this change; CI lint remains non-blocking per `docs/CI_CD.md` §7).

## 6. Storage, provenance, audit

Final documents are written through `writeOrgFile(organizationId, "forms", "pdf", bytes)` (random server-owned key, `stored_objects` provenance with SHA-256), referenced by a `generated_documents` row and served only through the authenticated download route with `Cache-Control: private, no-store`. Non-final renders are computed on demand from the immutable revision and never stored. Downloads append a `downloaded` event and a `form.downloaded` audit event.

## 7. Notes for the owner

- `verify:posture` prefers `PRODUCTION_AUDIT_DATABASE_URL` when present in the environment; the first run in this session therefore connected to Production with the **read-only NOBYPASSRLS auditor role** and reported "Posture verified". No write occurred. The second run with that variable blanked targeted the local database and confirmed RLS on 204/204 tables before stopping at a Supabase-only role check.
- Leave types: the leave template exposes exactly the six boxes plus "Other (specify)" as form data; nothing in the Leave module was configured or invented. Mapping to `leave_types` is WS-26C work and needs WWM HR to define its types first.
- WS-26B handoff: `signature_policy` on versions, `signature` items with `role`/`dateLabel`, `form_workflow_stages.signature_slot_key`, the reserved event types, `form.signature.apply`, and the renderer's `signature_line` element (accepts a JPEG image and caption) are the hooks. Next: `form_signatures` + `signature_assets` tables (migration 0077), capture providers, the signature route, and certificate rows with signature images.
