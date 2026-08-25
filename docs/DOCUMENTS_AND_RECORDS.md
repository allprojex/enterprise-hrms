# Documents & Records Foundation (WS-5)

Status: **Implemented (foundation only).** This is the fifth implementation workstream from `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20, implementing Owner Decision #4 (shared document infrastructure with domain-specific ownership preserved). It builds the shared digital-document platform later HR workflows consume — it deliberately does **not** build those workflows.

Downstream workstreams this unblocks: WS-6 (reminders/expiry notifications), WS-9 (Recruitment completion / offer particulars), WS-10 (Onboarding / handbook), WS-12 (Employee Relations / evidence), WS-19 (AI Documents). None of them are started here.

---

## 1. The domain boundary that matters most: digital documents vs Personnel Files

These are two different things and are **not** merged:

| | Digital Documents & Records (WS-5) | Physical Personnel File custody (Phase 3H) |
|---|---|---|
| Tables | `organization_documents`, `organization_document_versions`, `employee_documents`, `candidate_documents`, `generated_documents` | `personnel_files`, `personnel_file_volumes`, `personnel_file_movements`, `records_locations` |
| Models | A stored file: bytes, MIME type, size, version history | A physical folder's identity, custody state, and location |
| Has a `storageKey`? | Yes — every row points at a stored object | **No.** These tables have no file/storage columns at all |
| Question it answers | "What does this document say, and which version is current?" | "Where is the physical file right now, and who has it?" |

Verified before implementation: the four personnel-file tables have **zero column overlap** with any digital-document table — no `storageKey`, no `mimeType`, no `fileName`. They were left completely untouched by WS-5. A generic `documents` table that swallowed them would have destroyed a distinct, working custody domain to make an architecture diagram look uniform, which Owner Decision #4 and the frozen scope both forbid.

Digital documents may *reference* business entities; physical custody remains authoritative in its own domain.

---

## 2. Ownership model — shared primitives, separate ownership tables

Owner Decision #4's "Option 3": shared infrastructure for storage, security, versioning, access control, audit, retention, and metadata — while **preserving domain-specific ownership tables**.

Concretely, WS-5 did **not** collapse `employee_documents` and `candidate_documents` into one polymorphic table. Both continue to work exactly as before, through their existing routes, permissions, and UI. What WS-5 added is:

- a new ownership table for the one domain that had none — organization-level documents;
- cross-cutting primitives (`document_requirements`, `document_retention_records`) that attach to *any* document domain via an explicit `(table, id)` pair;
- shared services (validation, storage, categories, generation) every domain can call.

Where a cross-cutting table points at a document, it uses a polymorphic `(documentTable, documentId)` pair rather than one nullable FK column per domain — the set of document domains is expected to grow (WS-9/WS-10/WS-12), and a per-domain column would need a schema change each time. No database FK is possible across a polymorphic reference, so the owning service validates the pair against an allow-list of known document tables before it ever reaches a query.

---

## 3. Document categories (`document_category` + `document_category_settings`)

The category **list** is not a new table. `document_category` was already a registered, organization-defined Master Data domain, already the source of `categoryCode` on `employee_documents`/`candidate_documents`, and already exposed through the generic Master Data API and UI. Organizations keep defining categories exactly where they already did — no second category-management screen was built.

What WS-5 added is `document_category_settings`: the optional per-category **behavior** that the generic Master Data shape cannot carry.

| Field | Meaning |
|---|---|
| `verificationRequired` | A document in this category must be explicitly verified, not merely provided. |
| `expirySupported` / `expiryRequired` | Whether an expiry date is accepted / mandatory. |
| `sensitivity` | `standard` \| `confidential`. Confidential reads need an extra permission and are audited. |
| `retentionBasis`, `retentionPeriodMonths` | Seeds each new document instance's retention record. |

Resolution follows Master Data's own precedence: an organization's row overrides a platform-wide (`organizationId is null`) row, and a category with **no** settings row falls back to safe defaults (not confidential, no expiry, no verification) rather than erroring. That default is deliberately unremarkable — an unconfigured category must not silently behave as confidential (hiding documents from users who should see them) nor as expiring (producing false alerts in WS-6).

No category is hard-coded as a mandatory system category. Appointment/offer/confirmation/promotion/transfer/warning/service/separation letters, handbooks, policies, certificates, identity documents, and contracts are all *examples* an organization may define — none is created by this workstream, for any organization.

---

## 4. Organization documents and versioning

`organization_documents` is the repository for documents owned by the organization itself — handbook, HR policy, forms, procedures. Not Personnel Files; not employee- or candidate-owned.

The envelope/version split (`organization_documents` → `organization_document_versions`) reuses the exact shape `offers`/`offer_versions` already established, rather than inventing a second versioning idiom.

**Version integrity is enforced by the database, not by convention.** `organization_document_versions` carries a partial unique index on `(documentId) WHERE status = 'current'`. Two concurrent uploads therefore cannot both leave a current row behind — the loser gets a unique violation, surfaced as a retryable `409`, instead of silently corrupting history.

Supersession semantics:

- Uploading a new version inserts a new row and marks the previous one `superseded`, in one transaction.
- The prior row **and its stored object** are left completely intact. A new upload never overwrites an existing storage object — `writeOrgFile` always generates a fresh, unguessable key.
- Superseded versions stay downloadable through version history to anyone authorized to read the document.
- `supersededAt`/`supersededBy`/`changeNote` record what happened and why.

Proven live (`documentsLiveIntegration.test.ts`): v1 → v2 leaves v1 retrievable with its original bytes, exactly one current version exists, the document's `currentVersionId` advances, and a hand-forged second "current" row is rejected by Postgres itself.

---

## 5. Requirements: required / provided / verified / expiring

`document_requirements` is the shared checklist primitive — generic across employee, candidate, and organization owners, and deliberately **not** a workflow engine. It records one fact per row: this category is required for this owner, and here is its state.

The central rule (frozen scope §13): **uploading is not verifying.**

- `markProvided` records that a document arrived and links the row that satisfied it (`fulfilledDocumentTable`/`fulfilledDocumentId`). Resulting status: `provided` — never `verified`, even for a category that needs no verification.
- `verifyRequirement` is the separate decision, behind its own permission (`document.verify`), recording `verifiedBy`/`verifiedAt` or a `rejectionReason`.
- Re-providing after a rejection clears the prior decision — the new document has not been judged yet.

Whether a `provided` requirement counts as satisfied is the consuming workflow's judgment (read from the category's `verificationRequired`), not a state this primitive decides on anyone's behalf.

WS-9/WS-10/WS-12 compose their own checklists from these rows. No recruitment or onboarding checklist is built here.

---

## 6. Expiry — the WS-6 contract

WS-5 stores structured expiry metadata and exposes a **read-only** query. It sends nothing; no scheduling or notification infrastructure was added.

`queryExpiryState(organizationId, asOf, horizonDays)` returns three disjoint lists:

| List | Rule |
|---|---|
| `expired` | `expiryDate` strictly **before** `asOf` |
| `expiringSoon` | `asOf` through `asOf + horizonDays`, **inclusive both ends** |
| `missing` | `required = true` and status still `pending` |

`asOf` is an explicit parameter rather than an implicit `now()` so boundary behavior is deterministic and directly testable — a document expiring exactly on `asOf` appears in `expiringSoon` and never in both lists. Verified live against fixed dates.

Exposed as `GET /organizations/{organizationId}/document-requirements/expiry`.

---

## 7. Retention, archive, legal hold, disposal

`document_retention_records` is a first-class shared primitive (Owner Decision #4), attached to every document instance at creation and seeded from its category's configured basis — so retention queries never have to reason about documents with no record.

Three states, deliberately distinct:

| State | Means |
|---|---|
| **Archived** | Out of active circulation. **Not deletion** — row and stored object both survive. |
| **Eligible for disposal** | A reviewable determination that retention elapsed. **Never** automatic deletion. |
| **Disposed** | An authorized human decided, with a recorded reason; the storage object was then deleted. |

**Legal hold overrides all of it.** While `legalHold` is true a record can never become disposal-eligible and can never be disposed, regardless of how far past `retainUntil` it is. Held records are also excluded from the disposal-eligible listing, so the UI can never present one as ready to dispose. Applying and lifting a hold are both audited.

Additional guards:

- A record with **no** `retainUntil` can never age into eligibility — an explicit retention decision must be recorded first (fail-closed).
- Disposal requires an explicit reason, recorded and audited.
- There is deliberately **no** bulk "dispose everything expired" operation anywhere in the codebase. The query endpoints report candidates; a human authorizes each disposal individually.
- Disposal is **per document instance**, keyed by `(documentTable, documentId)`. Disposing one version never touches sibling versions of the same document — verified live.
- Physical Personnel File disposal is **not** in scope and shares no primitive with this.

`document.retention.manage` gates every state change and is seeded to **no role by default** — authorizing destruction of records is a deliberate per-organization delegation, not something ordinary HR or records authority implies.

---

## 8. Storage security and cleanup ordering

Storage reuses the existing `fileStorage.ts` abstraction unchanged: private local-disk, organization-scoped by directory, never served by static middleware, always read through an authenticated permission-checked route.

- Storage keys are 24 random bytes of hex plus an extension — unguessable, and **never** derived from the client-supplied filename (verified live: a key never contains the uploaded name).
- The storage subdirectory is always a fixed code literal, never request input, so there is no path-traversal surface.
- Paths are organization-scoped, and every read re-proves organization ownership from the database first, so a cross-organization object path cannot be constructed.
- Downloads set `Content-Disposition: attachment` with an encoded filename and `Cache-Control: private, no-store`.

**Cleanup ordering is deliberate and differs between upload and disposal:**

| Operation | Order | Why |
|---|---|---|
| Upload / new version / generation | Write object → open transaction → on failure, delete the object | A failed transaction can leave at most one unreferenced blob (inert). The inverse — a row referencing an object that was never written — is a dangling reference and is worse. |
| Disposal | Mark the record disposed (transactional) → **then** delete the object | If the delete fails, the record still reads "disposed" and the object is a recoverable orphan. Deleting first would risk a destroyed file with a record still claiming the document is retained. |

A storage delete failure during disposal is non-fatal and reported as `storageDeleted: false` rather than rolling the authorized decision back.

---

## 9. File validation

Reuses and does not duplicate `documentValidation.ts`: size ceiling (10MB), MIME allow-list (PDF, JPEG, PNG, DOCX, XLSX), and **magic-byte signature verification** so a renamed executable declaring `application/pdf` is rejected on its actual bytes, not its Content-Type. Verified live for both the spoofed-PDF and disallowed-executable cases.

**There is no malware/antivirus scanning.** This validation proves a file is a well-formed instance of an allowed type; it does **not** prove the file is safe. A malicious PDF or OOXML document that is structurally valid will pass. Recorded here as an explicit security follow-up rather than described as something it is not.

---

## 10. Template model and merge fields

`document_templates` → `document_template_versions`, same envelope/version split as everything else above, for the same reason: a letter generated from version N must stay explainable by reading version N, which no later edit can alter.

Editing model (mirrors `offer_versions`' draft/non-draft precedent):

- A `draft` version is mutable in place.
- An `active` version is **not** — editing creates a new draft version instead.
- At most one version per template may be `active`, enforced by a partial unique index, so concurrent activations cannot both succeed.

### Merge fields — allow-list, not sandbox

Template content is organization-controlled input written by HR users. The security model is structural rather than defensive:

- Template content is **plain text only** (`format: plain_text`) — never HTML, never a templating-language string.
- Substitution is a single regular expression finding `{{field.name}}` tokens, replaced from a context object built entirely server-side.
- There is **no expression syntax, no conditionals, no loops, no property-path traversal, no helper or filter invocation**. Nothing is ever evaluated.
- A token naming a field outside `MERGE_FIELDS` cannot resolve — the allow-list is checked before the lookup, so even a real object property like `toString` or `__proto__` is inert.
- Output is drawn into a PDF as literal glyphs with every byte escaped, so there is no HTML/script sink downstream either.

There is therefore no server-side template injection surface to sandbox in the first place. Verified directly against expression-injection, block-helper, shell-interpolation, prototype-pollution, and constructor-escape payloads.

The allow-list is organization-neutral and deliberately **excludes every sensitive payroll/identity field** — nothing from `employee_banking_details`, `employee_statutory_identifiers`, or `employee_compensation_components`. Whoever holds `document_template.manage` must not gain a backdoor read of payroll data through a merge field. A test asserts the allow-list contains no bank/salary/statutory-identifier key.

Unknown fields fail **at authoring time** with a clear error, not silently at generation time on an official letter. A known-but-unsupplied field renders empty rather than leaving a raw `{{token}}` visible in a finished document.

---

## 11. Output format decision

**PDF, produced by a small dependency-free writer (`lib/pdfWriter.ts`).**

The repository had no PDF tooling at all before WS-5 (verified against every workspace `package.json`), so "reuse existing tooling" was not available and the choice was between adding a rendering dependency and writing the small amount of PDF actually needed. Generated letters are plain text, which needs none of what a PDF library exists to provide — no images, no vector graphics, and no font embedding (the PDF standard-14 fonts require no font program). What remains is page structure, text placement, and escaping.

What this buys:

- **Deterministic bytes.** Nothing in the writer reads the clock or any RNG, and no `/CreationDate`, `/ModDate`, or `/ID` is written — so identical content always produces an identical file. That is what makes the immutability guarantee checkable rather than merely asserted.
- **No new supply-chain surface** on a path that renders organization-controlled input, for a platform hardened in WS-1.
- **Total control over escaping** — every byte reaching a content stream is escaped or dropped.

Scope boundary: left-aligned Helvetica/Helvetica-Bold text, A4, automatic wrapping and pagination. It is not a general PDF library and should not grow into one. **DOCX was evaluated and rejected** — it would have required either a new dependency or hand-writing an OOXML/ZIP writer, for a second format nothing in WS-5 or its named downstream consumers needs.

Verified structurally (header, object graph, xref byte offsets checked against real object positions, trailer), verified deterministic, and verified visually by rendering a sample letter in a real PDF engine.

Generated artifacts are stored under the organization-scoped `generated-documents/` prefix via the same `fileStorage` abstraction. No generated file is written to an arbitrary server-local path, and no temporary render files are produced.

---

## 12. Generated-artifact immutability

`generated_documents` is one immutable row per finalized artifact, recording exactly which template version, merged with which source entity, produced the stored PDF — plus the actor and timestamp.

Later template edits create new `document_template_versions` rows and **never** touch a stored artifact or its lineage. Nothing anywhere regenerates historical letters when a template changes. Verified live: after a template is rewritten and reactivated, a previously generated artifact's bytes are unchanged and it still points at the version it was actually made from.

`templateId`/`templateVersionId` use `ON DELETE set null` rather than `restrict` — a past artifact's own row must remain valid evidence even if its lineage reference is later removed; the artifact itself is never deleted by that.

---

## 13. Organization branding

Generated documents draw organization identity through existing infrastructure — `organizations.name` plus the `general` config namespace (address, contact email, contact phone) — never hard-coded for any customer. The same engine works for every organization.

**No WWM (or any customer) template, category, branding, or document was created by this workstream.** Existing WWM forms (PIF, Leave) were not redesigned and were not touched; the architecture can adopt shared branding later without changing them now.

---

## 14. Permissions

Seven new keys, following the existing `<resource>.<action>` convention. Deliberately **not** one key per document category (the frozen scope forbids that) — the split follows authority boundaries, not table layout:

| Key | Gates | Seeded to |
|---|---|---|
| `organization_document.read` | Listing/reading organization documents, requirement and retention queries | org_admin, hr_manager |
| `organization_document.manage` | Upload, new version, metadata, category settings, requirement creation/provision | org_admin, hr_manager |
| `organization_document.sensitive.read` | Downloading a document in a **confidential** category | org_admin, hr_manager |
| `document.verify` | The verification decision — separable from the ability to upload | org_admin, hr_manager |
| `document.retention.manage` | Archive, legal hold, disposal eligibility, disposal | **no role** — deliberate per-organization delegation |
| `document_template.read` | Reading templates; generating from an active version | org_admin, hr_manager |
| `document_template.manage` | Creating/versioning/activating templates; preview | org_admin, hr_manager |

Existing `employee_documents`/`candidate_documents` routes keep their current `employee.*`/recruitment gates untouched — these keys gate only the surfaces WS-5 introduces. `super_admin` receives all seven only through the pre-existing blanket grant, not a WS-5-specific broadening.

---

## 15. Authorization, isolation, and break-glass

Every route runs the standard chain: `requireAuth` → `requireMembership` → `requirePermission`. `requireMembership` resolves the organization from the path against the caller's own membership, so a client-supplied organization id is only ever a lookup key — never a grant of access.

Downloads re-prove the full chain before a single byte is read: the document belongs to this organization → the version belongs to that document → if the category is confidential, the caller additionally holds `organization_document.sensitive.read`. Knowing a document id, version id, or storage key is never sufficient.

Generation is isolated the same way: the source entity is resolved **inside the caller's own organization**, so an Org A template cannot render for an Org B employee — the lookup simply finds nothing. Verified live in both directions.

**Break-glass (WS-4) needed no special handling and got none.** Because these routes use the ordinary middleware, an authorized elevated read works exactly when the grant's scope includes the specific permission key, and `recordAuditEvent` tags the resulting event with `breakGlassGrantId` automatically. There is **no bypass** anywhere in WS-5, and no duplicate elevated-read event.

---

## 16. Audit

Uses the existing WS-3 infrastructure. Six new event-type prefixes were registered in the single central map (`lib/auditCategories.ts`), all resolving to the existing `documents` category: `organization_document`, `document_requirement`, `document_retention`, `document_template`, `document_category`, `generated_document`.

Audited: upload, version created, document updated, confidential download, requirement created/provided/verified/rejected, archive, legal hold applied/released, disposal eligibility, disposal, template created/updated/versioned/activated, and document generated.

Deliberately **not** audited: ordinary list views, and non-confidential downloads.

**Document contents never appear in audit metadata** — events carry lineage and provenance only (version ids, version numbers, category codes, template version references). Verified live, including that a confidential document's own content does not appear in its own read event.

---

## 17. Sensitive reads

A download in a category the organization marked `confidential` requires `organization_document.sensitive.read` in addition to `organization_document.read`, and writes an `organization_document.downloaded` event in the `documents` audit category. Non-confidential reads write nothing. Under break-glass elevation the existing `breakGlassGrantId` correlation is preserved automatically — one event, not two.

---

## 18. Schema and migration

Migration `0060`, additive only. Eight new tables:

`document_category_settings`, `organization_documents`, `organization_document_versions`, `document_requirements`, `document_retention_records`, `document_templates`, `document_template_versions`, `generated_documents`.

Plus one additive FK: `offer_versions.letterTemplateId` → `document_templates.id` (`ON DELETE set null`).

`employee_documents`, `candidate_documents`, and all four personnel-file tables were **not modified**. A hand-written `.down.sql` accompanies the migration per repository convention and was verified by applying it and re-applying the up migration against a real database.

**RLS:** all eight new tables get `ENABLE ROW LEVEL SECURITY` with **zero policies**, matching the repository's established deny-by-default posture for `anon`/`authenticated` Supabase roles. The application connects as the table owner, so this is defense-in-depth against direct database access, not the tenant-isolation mechanism — that remains fully application-layer via `requireMembership`. Verified live: RLS enabled on all eight, zero policies present.

---

## 19. Reserved offer fields (`offer_versions`)

`letterTemplateId` and `generatedDocumentStorageKey` existed but were unused, reserved for exactly the generation engine WS-5 built. WS-5 added the FK on `letterTemplateId` as pure infrastructure wiring.

**No recruitment business behavior changed.** No route populates either column; no offer issuance or acceptance flow was built or altered. That remains WS-9's scope. `generated_documents.sourceType`/`sourceId` is the general mechanism WS-9 will use to link an issued letter back to whichever entity it decides to key generation from.

---

## 20. Downstream integration contracts

| Workstream | What it consumes | Entry point |
|---|---|---|
| **WS-6** (reminders) | Expiry state; retention deadlines | `queryExpiryState(orgId, asOf, horizonDays)`; `listDisposalEligible(orgId, asOf)` — both report-only |
| **WS-9** (Recruitment completion) | Offer/appointment letter generation; candidate document checklists | `generateDocument(...)` with `sourceType: "offer_version"`; `document_requirements` with `ownerType: "candidate"` |
| **WS-10** (Onboarding) | Handbook/policy distribution; new-hire document checklists | `organization_documents`; `document_requirements` with `ownerType: "employee"` |
| **WS-12** (Employee Relations) | Warning/separation letters; evidence retention and legal hold | `generateDocument(...)`; `setLegalHold(...)` |
| **WS-19** (AI Documents) | Template content; generated artifact lineage | `document_template_versions`; `generated_documents` |

Each of these calls the shared services above. None of them is implemented by WS-5.

---

## 21. Known limitations and follow-ups

1. **No malware/antivirus scanning** (see §9). Validation proves file *type*, never file *safety*. The most significant security follow-up from this workstream.
2. **No full-text search or OCR.** Search is metadata-only (title, category, status, expiry, current/archive state) — explicitly out of WS-5's scope.
3. **`employee_documents` still has no download route.** A pre-existing gap (upload/list/delete only), unchanged by WS-5 and deliberately not fixed here, since altering that surface risked the existing-flow regression the frozen scope requires preserving.
4. **`employee_documents`/`candidate_documents` `categoryCode` remains unvalidated free text**, as it was before. WS-5's own surfaces validate `categoryCode` against the organization's active categories; retroactively tightening the older tables would reject documents organizations have already stored.
5. **Generation is synchronous.** Adequate for single letters at current sizes; no scheduled-job infrastructure was added before WS-6, per scope.
6. **Retention periods are computed from the category at document creation.** Changing a category's retention period does not retroactively re-derive `retainUntil` on existing records.
