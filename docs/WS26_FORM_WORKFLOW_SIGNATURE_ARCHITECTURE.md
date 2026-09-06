# WS-26 — Tenant Form, Workflow & Signature Engine — Phase A Architecture

**Status: Owner-approved 2026-09-06. WS-26A implemented — see `docs/WS26A_FOUNDATION.md`. Not deployed.**
**Identifier:** WS-26, registered in `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20.

Repository at assessment (2026-09-06): `main` = `origin/main` = `421f118`. The working tree also carries the uncommitted, owner-pending Organization Branding / Logo Upload UI work (WS-25) reconciled to one implementation; WS-26 touches none of it. Migration head: `lib/db/drizzle/0075_chilly_felicia_hardy.sql` (journal idx 75). No Production access, no database access, no seed ran.

Source documents read from `C:\Users\wwmit\OneDrive\Documents\Ministry\` (the owner's list names them with a `(1)`/`(2)` suffix; the files on disk carry no suffix — same titles, treated as the authority):

| File | Size | Embedded assets |
|---|---|---|
| `LEAVE_APPLICATION_FORM_new.docx` | 599,846 B | `word/media/image1.png` 566,632 B (header logo) |
| `PIF-WWM-new.docx` | 601,394 B | `word/header1.xml`, `image1.png` 566,632 B |
| `staff_evaluation_form_final.docx` | 60,269 B | `image1.png` 29,087 B (a different, smaller logo raster) |
| `STAFF_PROBATIONARY_ASSESSMENT_FORM_1.docx` | 588,364 B | `image1.png` 566,632 B |

The three 566,632-byte images are byte-for-byte the same size and almost certainly the same WWM logo raster; the evaluation form embeds a different asset. Per §16 of the brief, WS-26 will **not** extract or commit either image: PDFs use the governed organization logo (`organizations.logoUrl`) and a neutral text header when it is unavailable.

---

## 1. Existing capabilities (traced, not assumed)

### 1.1 Forms and templates
| Capability | Where | Fit for WS-26 |
|---|---|---|
| Custom field definitions (14 types, versions, sensitivity `normal/sensitive`, visibility rules, scope allow-list `employee/candidate/application/position/organization_profile`) | `custom_fields.ts`, `lib/customFields/*`, migration 0064, WS-8 | **Reuse for WWM-specific profile data** (PIF Section B/F fields). Deliberately has no formulas, no file uploads, no rating matrices. |
| Custom forms: `custom_forms` / `custom_form_versions` (draft→published→archived, `layout` JSON of sections with `field`/`heading`/`help` items) / `custom_form_submissions` (bare `answers` JSON, no status) | `custom-forms.ts`, `lib/customFields/forms.ts` | **Not a fit as the WS-26 template model**: no lifecycle, no rating/matrix/signature/table items, no PDF layout, no workflow, layout bound to custom-field ids. WS-13 explicitly chose to build its lifecycle *above* it and add no columns to it. WS-26 follows the same rule. Its version idiom (`(form_id, version_number)` unique, published immutability) is copied. |
| Document templates: `document_templates` / `document_template_versions` (`format = plain_text` only, one active version by partial unique index) | WS-5 | Letter templates, not forms. Version-integrity idiom (partial unique index on active) is reused. |
| Onboarding templates/tasks (`documentCategoryCode`, `acknowledgementDocumentId`, `documentRequirementId`) | WS-10 | A task can point at a document requirement; **no task kind for "complete a form"** (gap, §5). |

### 1.2 Workflow and approval
| Capability | Where | Fit |
|---|---|---|
| Leave approval chain: `pending → pending_hr → approved/rejected/cancelled`, department head resolved live via `department_heads`, self-approval blocked, HR stage | `lib/leaveRequests.ts`, `lib/leaveApprovals.ts`, `leave-requests.ts` | **Authoritative for leave.** The WWM Leave form must drive this, not replace it. |
| WS-13 approval stages: `request_approval_stages` (purpose enum `data_change/service_request`, `stageOrder`, resolver enum `department_head/permission_holder/specific_membership`, `resolverConfig`), stage count frozen at request time, maker-checker by user **and** membership id, chronology tables with real FKs | `request-approvals.ts`, `lib/employeeRequests/*` | **Pattern and resolver code to reuse.** WS-13's own doc states it is not a cross-product engine (OD #14/#15 not claimed). WS-26 reuses the resolver vocabulary and the maker-checker + stale rules by sharing the resolver module, with its own stage table keyed by template version. |
| Recruitment approvals, offer approvals, office-inventory delegation | WS-9 etc. | Specialised; not touched. |
| Performance review state machine `draft → self_assessment → manager_review → hr_review → finalized → acknowledged`, reopen, revisionNumber | `performance-reviews.ts`, routes `performanceSelfAssessment/ManagerReview/HrReview/Acknowledgement` | Integration point for the Staff Evaluation and Probation forms (§7). |

### 1.3 Documents and PDF
| Capability | Where | Fit |
|---|---|---|
| `generateDocument()`: template active version + server-built merge context → PDF bytes → `writeOrgFile` → `generated_documents` row (templateVersionId, sourceType/sourceId, storageKey, sha via `stored_objects`) → audit `generated_document.generated` | `lib/documentGeneration.ts` | **Sink for finalized form PDFs** (`sourceType = 'form_submission'`). Merge-context builders (`buildEmployeeContext`) are the auto-fill precedent. |
| `renderTextPdf()`: dependency-free, deterministic PDF writer; Helvetica / Helvetica-Bold standard-14, WinAnsi, left-aligned wrapped text, pagination. **No tables, rules, checkboxes, images.** Its header says: "Anything beyond that … should not be bolted on here." | `lib/pdfWriter.ts` (282 lines) | Keep as is. WS-26 adds a sibling structured renderer (§9) that reuses its object/xref/escaping core. No PDF library exists in any workspace package. |
| Organization documents with version history, `document_requirements`, retention records | WS-5 | Retention primitive attaches to finalized form documents. |

### 1.4 Signature
There is **no signature capability**. `document_acknowledgements` is explicitly "not an electronic signature and must never be presented as one" (schema comment; owner review line 999: never use the word SIGNED without a real e-signature capability). Offer responses, learning enrolments and performance acknowledgements are typed confirmations. No canvas or signature library is installed in the frontend. WS-26B is the first e-signature capability in the platform and must be labelled as such in documentation.

### 1.5 Storage
`writeOrgFile(orgId, subdir, ext, buffer)` → random 48-hex key under a code-controlled subdir, `stored_objects` provenance row (backend kind, size, SHA-256), `readOrgFile`, best-effort `deleteOrgFile` with `delete_failed` marking, `discardOrphanedFile`. Backends: filesystem and S3 via `StorageBackend` interface (`write/read/delete/stat`). MIME + signature validation exists for images (`validateImageUpload`, now also declared-type agreement) and documents (`documentValidation.ts`). **Fully sufficient for WS-26**; no new storage mechanism.

### 1.6 Employee and profile extension
`employees` (36 columns): names, gender, dateOfBirth, maritalStatus, nationality, nationalId (Ghana Card), passportNumber, personal/work email, phones, `residentialAddress` JSON `{line1,line2?,city?,state?,postalCode?,country?}`, `emergencyContacts` JSON `[{name,relationship,phone}]`, department/branch/position, reportingManagerId, hireDate, probationEndDate, employmentStatus. Satellites: `employee_statutory_identifiers` (ssnitNumber, tin, validity), `employment_particulars` (dateOfFirstAppointment, jobTitleOrGrade — offer-derived), `employment_periods` (transfer/promotion/confirmation/… history with previous/new state), `employee_qualifications` (qualificationTypeCode, institution, fieldOfStudy, dates), `employee_skills` (catalogue-based), custom field values per scope. WS-13 data-change requests govern self-service edits of 16 allow-listed personal fields.

### 1.7 Leave
`createLeaveRequest({organizationId, employeeId, leaveTypeId, startDate, endDate, reason?, attachmentDocumentId?})` with policy resolution, `calculateLeaveDays` (weekend/holiday rules), `resolveEarliestAllowedStartDate` (notice period), `getAvailableBalance`, `approveLeaveRequest` / `rejectLeaveRequest` (stage-aware), `withWorkflowStage`. Leave types are per organization; **WWM has the module enabled but no leave types or requests yet** (`docs/WWM_ORGANIZATION_SETUP.md` §on Leave). The request model has no contact phone/email fields (gap §5).

### 1.8 Performance
Cycles (`cycleType` includes `probation`), templates with weighted goals/competencies and a rating scale (`performance_rating_scales` + levels `value/label/description`), reviews with competencies (`employeeRatingValue`, `managerRatingValue`, comments, notApplicable), goals, evidence uploads, computed and HR-override scores. `confirmEmployee({probationReviewId?})` validates a referenced review belongs to the employee and to a `probation` cycle.

### 1.9 Probation / confirmation
`confirmEmployee()` (status `probation → active`, writes `employment_periods.confirmation`), `POST …/probation/extend`, `POST …/probation/unsuccessful` (no auto-termination), reminders are observers only. No probation duration is defaulted (documented Ghana Act 651 reasoning). **No automatic confirmation exists and none is proposed.**

### 1.10 Permissions (186 keys)
Relevant existing keys: `custom_forms.manage/.read`, `custom_fields.manage/.read/.sensitive.read`, `document_template.manage/.read`, `organization_document.manage/.read/.sensitive.read`, `document.verify`, `leave_request.manage/.approve/.read.own/.write.own`, `performance.manage/.review.write/.finalize/.read.own/.write.own/.reports.read`, `employee.read/.write`, `onboarding.*`, `data_change.*`, `service_request.*`. Self-service rights come from the employee link, never a key (WS-10/12/13 precedent).

### 1.11 Audit
`recordAuditEvent({actorApplicationUserId, actorMembershipId, organizationId, eventType (free text), targetType, targetId, beforeState?, afterState?, metadata?})`, append-only, request-id correlated, "document contents never go into audit metadata" (§33). Sensitive values masked via WS-3 `maskIdentifier`.

### 1.12 Tenant boundary conventions
Every tenant table: `organization_id NOT NULL` FK; RLS enabled deny-by-default with zero policies (migration 0036 onward, CI "RLS coverage gate" statically fails a migration that omits `ENABLE ROW LEVEL SECURITY`; `pnpm --filter @workspace/db run verify:posture`). Authorization is `requireAuth → requireMembership(:organizationId) → requireModuleEnabled → requirePermission`; super_admin has no standing tenant access and reaches tenant data only through an active break-glass grant. Cross-tenant lookups answer 404, not 403.

---

## 2. Gaps (what does not exist)

1. A form template model with sections, fields, choice groups, rating matrices, computed totals, auto-fill bindings, signature slots and a print layout.
2. A form submission lifecycle with the states in §4 of the brief and a per-submission chronology.
3. A per-template workflow (participants, stage actions, editable sections per stage) that can also delegate to an existing engine (leave).
4. Any signature capture, storage, application or verification.
5. A PDF renderer for tables, rules, checkboxes and an image; a fidelity test harness.
6. Immutable finalization (snapshot + checksum + signature embedding).
7. Leave request contact phone/email; "No. of Days Remaining" and "Date of Resumption" as approval-time snapshots.
8. WWM-specific profile data: spouse (3 fields), current ministry role, previous ministry experience, office called to, skills & talents (free text), languages spoken, medical conditions, other relevant information, dependants (repeating rows), highest qualification as a single summary, position on first/current appointment as summaries.
9. A "complete this form" onboarding task kind (PIF at onboarding).
10. A place to attach a finalized form to a performance review or a probation decision without altering their scoring.

---

## 3. Design decisions

| Decision | Choice | Why |
|---|---|---|
| Template model | **New `form_templates` family**, not `custom_forms` | §1.1: custom forms are field composition with no lifecycle/matrices/PDF; WS-13 set the precedent of building above them. Copy their versioning idiom. |
| Tenant-specific profile data | **Custom field definitions (scope `employee`)**, referenced by key from template bindings | WS-8 exists for exactly this; sensitive fields (medical conditions) use `sensitivity = sensitive` and `custom_fields.sensitive.read`. No universal-schema columns for church-specific data. |
| Workflow | **Own `form_workflow_stages` table per template version** sharing WS-13's resolver vocabulary and resolver implementation; leave forms **delegate** approval to the Leave engine | Routing differs per form; WS-13 forbids becoming a cross-product engine; Leave is authoritative. |
| Submission history | **Append-only revisions + chronology events** | Brief §4/§14; WS-13's proven shape. |
| Finalized artefact | **`generated_documents` row** (`sourceType='form_submission'`) + `form_submissions.final_document_id` + SHA-256 | Reuse the WS-5 sink and retention; a second document sink would duplicate OD #4 infrastructure. |
| PDF engine | **Structured layout renderer beside `pdfWriter.ts`**, same deterministic object core; no external PDF library; no screenshots | §15 of the brief; supply-chain posture; deterministic bytes make hashes stable. Escalate only if fidelity testing proves the in-house path insufficient. |
| Logo | Governed `organizations.logoUrl` read through `readOrgFile`; embedded as an image XObject; neutral text header when absent | §16. |
| Signatures | Provider abstraction in the browser, one server contract, PNG artefacts in tenant storage, one row per applied signature, **never reused** | §7–§8. |
| Probation outcome | Recommendation recorded on the form; confirmation remains a separate authorized `confirmEmployee` call by HR | §12; §1.9. |
| Evaluation scores | Totals stored as computed values on the submission; **not** written into `performance_reviews.computedOverallScore` | §11; the WWM form has no weights or thresholds. |

---

## 4. Proposed WS-26 schema (additive; migration 0076 in WS-26A, 0077 in WS-26B)

All tables: `id serial`, `organization_id integer NOT NULL REFERENCES organizations ON DELETE RESTRICT`, timestamps, `ENABLE ROW LEVEL SECURITY`, org-leading indexes.

```
form_templates
  template_key text            unique per org (e.g. 'wwm_leave_application')
  form_type enum               leave_application | personal_information | staff_evaluation |
                               probationary_assessment | generic
  module_key text NULL         'leave' | 'performance' | 'core_hr' — gate via requireModuleEnabled when set
  title text
  status enum                  active | archived
  current_published_version_id integer NULL
  created_by_membership_id, archived_at/by

form_template_versions
  template_id → form_templates (cascade)
  version_number integer       unique (template_id, version_number)
  status enum                  draft | published | archived   (partial unique: one published per template)
  effective_from date NULL, effective_to date NULL
  definition jsonb             validated document model (§4.1)
  definition_sha256 text       hash of canonical definition
  signature_policy jsonb       slots: [{key, role, required, methods[]}]
  render_config jsonb          page size, header block, status-marker placement, logo slot
  first_used_at timestamp NULL locked once any submission references it (trigger + service guard)
  published_at/by, created_by, change_note

form_workflow_stages
  template_version_id → form_template_versions (cascade)
  stage_order integer          unique (template_version_id, stage_order)
  name text
  participant enum             employee | supervisor | department_head | hr | final_approver | assessor
  resolver enum                same vocabulary as request_authority_resolver: department_head |
                               permission_holder | specific_membership | reporting_manager (new) |
                               subject_employee (new) | delegated_engine (new: leave)
  resolver_config jsonb
  editable_section_keys jsonb  sections this stage may fill (e.g. ['approval'])
  allowed_actions jsonb        subset of: complete | approve | return | reject
  signature_slot_key text NULL

form_submissions
  template_id, template_version_id (restrict)
  subject_employee_id → employees (restrict)
  status enum                  draft | submitted | pending_approval | returned | rejected |
                               resubmitted | approved | finalized | archived
  current_stage_order integer NULL
  stage_count_snapshot integer frozen at first submit (WS-13 rule)
  linked_entity_type text NULL ('leave_request' | 'performance_review' | 'employment_period')
  linked_entity_id integer NULL
  created_by_membership_id, submitted_at, finalized_at, archived_at
  final_document_id → generated_documents NULL
  final_sha256 text NULL
  current_revision_id → form_submission_revisions NULL
  partial unique: one non-terminal submission per (template_id, subject_employee_id, linked_entity_id)

form_submission_revisions           (append-only)
  submission_id (cascade)
  revision_number integer      unique (submission_id, revision_number)
  kind enum                    draft | submitted | resubmitted | stage_update
  answers jsonb                user-entered values keyed by field key
  autofill_snapshot jsonb      values pulled from authoritative records at that instant
  computed jsonb               totals/derived values (server computed)
  stage_order integer NULL     which stage produced it
  saved_by_membership_id, saved_at

form_submission_events              (chronology, WS-13 shape)
  submission_id (cascade)
  event_type enum              created | draft_saved | submitted | stage_completed | returned |
                               rejected | resubmitted | approved | signature_applied |
                               final_document_generated | finalized | archived | downloaded
  stage_order, stage_name, notes, details jsonb (never form content), actor_user_id,
  actor_membership_id, request_id text, occurred_at

form_signatures                     (WS-26B; one row per application, never reused)
  submission_id, revision_id, template_version_id
  slot_key text
  signer_user_id, signer_membership_id
  represented_employee_id NULL
  authority text               role/participant at signing
  stage_order integer NULL
  method enum                  drawn | uploaded | device
  source_asset_id → signature_assets NULL (only for method = uploaded)
  device_provider text NULL, device_metadata jsonb NULL
  storage_key text             PNG in subdir 'signatures'
  sha256 text, mime_type text, width_px, height_px, byte_size
  signed_at, request_id, session_id_hash, user_agent
  revoked_at/by/reason NULL    (revocation is a new fact, never a delete)

signature_assets                    (WS-26B; a person's stored authorized signature image)
  owner_user_id, owner_membership_id
  storage_key, sha256, mime_type, width_px, height_px
  status enum                  active | revoked
  uploaded_at/by, revoked_at/by
  Only the owner may read or apply it; applying requires an explicit per-submission action.

form_documents                      (WS-26B; persisted renders other than final are optional)
  submission_id, revision_id
  kind enum                    blank | draft | submitted | returned | rejected | final
  generated_document_id → generated_documents NULL (final always set)
  sha256, rendered_at, rendered_by
```

### 4.1 Template definition model (server-validated JSON, no expressions)
```
{ sections: [{ key, title, layout: 'grid'|'table'|'matrix'|'text',
     items: [ field | choiceGroup | matrix | table | note | signatureSlot ] }] }
field:        { kind:'field', key, label, type: short_text|long_text|date|number|phone|email|
                boolean|single_choice|multi_choice, required, options?, binding?, editableBy? }
binding:      { source:'employee'|'custom_field'|'leave'|'position'|'department'|'computed',
                ref:'firstName' | 'wwm.current_ministry_role' | 'balance.available' | ..., mode:'readonly'|'prefill' }
matrix:       { kind:'matrix', key, rows:[{key,label}], columns:[{value,label}], total?:{key,label} }
table:        { kind:'table', key, columns:[{key,label,type}], minRows, maxRows }
computed:     { kind:'computed', key, op:'sum', of:[matrixKey.rows...] }   ← the only operator in 26A
signatureSlot:{ kind:'signature', key, role, dateFieldKey? }
```
Bindings are resolved server-side from an allow-list (the `buildEmployeeContext` precedent); a client can never name a column.

---

## 5. RLS and tenant boundary

- Every new table carries `organization_id NOT NULL`; the migration ends with `ENABLE ROW LEVEL SECURITY` for each (CI gate); zero policies, matching the platform posture.
- Routes: `/organizations/:organizationId/form-templates…`, `/organizations/:organizationId/form-submissions…`, `/organizations/:organizationId/signatures…`, all behind `requireAuth → requireMembership → (requireModuleEnabled when template.module_key) → requirePermission`. Service functions take the proven `organizationId` and scope every query by it; a submission id from another tenant is a 404.
- Templates are visible only where `organization_id` equals the caller's; there is no sharing table in WS-26. The four WWM templates are rows with `organization_id = 3`. A future platform-template catalogue (organization_id NULL + assignment table) is out of scope and not designed here.
- Storage keys live under the organization prefix in `writeOrgFile`; signature and PDF reads go through permission-checked routes only (never static).
- Super Admin: no standing access; break-glass grant scope must include the new permission keys to act, exactly as today.
- Self-service: an employee's right to open, fill and sign their own submission derives from `employee_user_links`, never from a key (WS-13 precedent). Somebody else's submission is 404.

---

## 6. Signature architecture (WS-26B)

**Browser** — `SignatureCaptureProvider` interface in `components/signature/`:
```
interface SignatureCaptureProvider {
  id: 'canvas' | 'upload' | string;            // vendor adapters use their own id
  label: string;
  isAvailable(): Promise<boolean>;             // e.g. WebHID device present, SDK loaded
  capture(options): Promise<SignatureCapture>; // { pngBlob, widthPx, heightPx, strokes?, deviceInfo? }
}
```
- `CanvasPointerProvider` (WS-26B, implemented): Pointer Events — mouse, touch, pen/stylus, finger — on a `<canvas>` with an accessible alternative (a "type your full name to sign" fallback is **not** offered as a signature; the alternative is keyboard-operable clear/undo/confirm plus a described upload path).
- `UploadProvider` (WS-26B, implemented): PNG/JPEG/WebP through the existing image validation; stored as a `signature_assets` row owned by the uploader; applying it to a submission is a separate explicit action producing a `form_signatures` row with `source_asset_id`.
- Device adapters (interface only in WS-26B, documented plug-in contract): `WebHidProvider`/`WebSerialProvider` shells for pads exposing HID/serial, and a `VendorSdkProvider` slot for vendor SDKs loaded under CSP `'self'` (self-hosted) — no vendor named, no compatibility claimed. A registry picks providers by availability; the server records `method = device` and `device_provider`.

**Server** — `POST /organizations/:id/form-submissions/:submissionId/signatures` (multipart PNG + slot key + method + optional device metadata). Checks: caller is the resolved participant for the slot's stage, submission is in a state that accepts that slot, image passes magic-byte validation and dimension bounds, one active signature per (submission, slot). Writes `signatures/` object, SHA-256, `form_signatures` row, audit `form.signature_applied` (metadata: ids and hash, never the image). `GET …/signatures/:sigId/image` is permission-checked to submission participants and HR (`form.read`) and audited. No list endpoint across submissions.

---

## 7. Workflow and integrations

**State machine** (server-enforced): `draft → submitted → pending_approval ⇄ returned → resubmitted → … → approved → finalized → archived`, with `rejected` terminal from any pending stage and `archived` from terminal states. Each transition writes a revision (when content changed) and an event. Maker-checker by user and membership id on every stage decision. Stage count frozen at first submit.

**WWM routing (configuration rows, not code):**
| Template | Stages |
|---|---|
| Leave Application | employee (fill + sign) → `delegated_engine: leave` (department head → HR via the existing Leave engine; the form's Approval Section is written from the leave decision) |
| Personal Information | employee (fill + sign declaration) → hr (verify/complete, approve) |
| Staff Evaluation | assessor = reporting_manager (Sections A–D, Assessed by, Comments, Recommendation, Summary, Supervisor Comments) → subject_employee (Employee Comments) → hr (finalize) |
| Probationary Assessment | assessor = reporting_manager (ratings, comments, Assessed by/Position/Date) → subject_employee (Comments (Probationer Staff)) → final_approver = permission_holder `form.approve` (Recommendation) → hr (finalize) |

**Leave** — submitting the form calls `createLeaveRequest` (one source of truth); `linked_entity = leave_request`. Approval actions taken on the form call `approveLeaveRequest`/`rejectLeaveRequest`; the form's approval section (Approved/Rejected, Approved By, Date Approved, No. of Days Remaining = `getAvailableBalance` after posting, Date of Resumption, Reason) is snapshotted into the revision at that moment. The 7-working-day note is rendered verbatim; enforcement stays with the leave policy's `noticePeriodDays` (not changed). Contact phone/email live in the submission answers only (gap 7 accepted, no leave-schema change).

**PIF** — auto-fill from `employees`, statutory identifiers, qualifications, particulars; WWM-specific fields bound to custom field definitions seeded for organization 3 (keys prefixed `wwm.`); HR approval may write back only through the existing governed paths (employee.write for HR; data-change requests for self-service), never by the form engine directly. Onboarding: a new task kind `complete_form` (WS-26C, additive column on onboarding template tasks) links a PIF submission — reported as the one onboarding schema touch.

**Staff Evaluation** — `linked_entity = performance_review` in the WWM cycle (half-year/full-year); totals stored in `computed`; the review's own weighted score is untouched; finalized PDF attached as review evidence.

**Probation** — `linked_entity = performance_review` in a `probation` cycle when one exists, else the employee; "Staff Confirmed / Not Confirmed / Confirmation Extended" is an explicit final-approver decision recorded on the form; HR then performs `confirmEmployee`, `probation/extend` or `probation/unsuccessful` through the existing endpoints, quoting the finalized submission id. No automatic outcome.

---

## 8. Field mapping of the four documents

Legend: **E** entered on the form, **A** auto-filled (read-only unless stated), **W** written by a workflow stage, **S** signature slot, **C** computed.

### 8.1 Employee Leave Application Form
| Form element | Kind | Binding / rule |
|---|---|---|
| Header: logo, "WORLDWIDE WORD MINISTRIES / EMPLOYEE LEAVE APPLICATION FORM" | render | governed logo + verbatim title |
| Employee Name | A | `employees.firstName + lastName` (preferred name not used) |
| Department | A | `departments.name` |
| Type of leave: Annual / Sick / Maternity / Paternity / Bereavement / Leave Without Pay | E single_choice | mapped to WWM `leave_types` by configured code; **WWM has no leave types yet** (must be created by WWM HR before use) |
| Other (specify) | E short_text | required when a leave type flagged "other" is chosen |
| From / To | E date | `startDate/endDate` |
| No. of Days Requested | C | `calculateLeaveDays` result, displayed and stored; user cannot override |
| Contact: Phone Number / Email Address | E | submission answers only |
| Employee Declaration: Employee Signature / Date | S + A | slot `employee`; date = signing timestamp |
| Approval: Approved / Rejected | W | from leave decision |
| Approved By / Date Approved / Signature | W + S | final decider name; slot `approver` |
| No. of Days Remaining | W/C | `getAvailableBalance` after approval posting |
| Date of Resumption | W | entered by approver (no engine field; ambiguity §11) |
| (If Rejected) Reason for Rejection | W | leave rejection reason |
| NOTE (7 working days) | render | verbatim |

### 8.2 Staff Personal Information Form
| Element | Kind | Binding |
|---|---|---|
| Intro sentence ("Please complete all sections…") | render | verbatim |
| A: Full Name | A | names |
| Date of Birth / Gender / Marital Status / Nationality | A | employees columns |
| Residential Address | A | `residentialAddress` JSON flattened |
| Phone Number / Email Address | A | phoneNumber / personalEmail (work email fallback) |
| Spouse's Name / Employer / Work Phone | E | custom fields `wwm.spouse_name`, `wwm.spouse_employer`, `wwm.spouse_work_phone` |
| B: Current Ministry Role / Previous Ministry Experience | E | `wwm.current_ministry_role`, `wwm.previous_ministry_experience` |
| Office Called To (Clergy only): Apostle / Prophet / Evangelist / Pastor / Teacher | E multi_choice | `wwm.office_called_to` (multi_select) — **ambiguity: single or multiple** (§11) |
| C: Highest Qualification / Institution Attended | A (prefill, editable) | highest `employee_qualifications` row; HR write-back via existing path |
| D: Date of First Appointment | A | `employment_particulars.dateOfFirstAppointment`, fallback `hireDate` |
| Position on First Appointment | A | earliest `employment_periods` state / `employment_particulars.jobTitleOrGrade` |
| Date of Current Position / Position on Current Appointment | A | latest promotion/transfer effective date / `positions.title` |
| Ghana Card No. | A | `employees.nationalId` (masked in audit/notifications per WS-3) |
| Social Security (SSNIT) No. | A | `employee_statutory_identifiers.ssnitNumber` |
| Employee No. | A | `employees.employeeNumber` |
| E: Contact Name / Relationship / Phone / Address | A (prefill) | `emergencyContacts[0]`; Address has no column → answers |
| Dependent Information (4 rows: Name(s) / Relationship) | E table | `wwm.dependants` — repeating rows; custom fields have no table type, so stored in submission answers (and optionally a custom `long_text`) — decision needed (§11) |
| F: Skills & Talents / Languages Spoken / Medical Conditions / Any Other Relevant Information | E | `wwm.skills_talents`, `wwm.languages_spoken`, `wwm.medical_conditions` (**sensitive**), `wwm.other_information` |
| Declaration sentence + Signature / Date | render + S | slot `employee` |

### 8.3 Staff Evaluation Form
| Element | Kind | Binding |
|---|---|---|
| Header lines incl. "Mailing Address: Box AN11908" | render | verbatim |
| Staff Name / Position / Department / Review Period | A / A / A / E | Review Period free text (or cycle name prefill) |
| Instruction paragraph | render | verbatim |
| Section A — Half-Year Goals (January-June): Goal 1–3, Goals Description, Specific Actions (3 lines each), Ratings 5/4/3/2/1 | E table + matrix | one rating per goal; **ambiguity: rating per goal or per action line** (§11) |
| Total Ratings (Half Year) | C | sum of the three goal ratings |
| Section B — Half-Year Ratings: rating scale sentence; 10 criteria (verbatim texts); Total Ratings (Half Year) | render + matrix + C | sum of ten |
| Section C — Full-Year Goals (July-December) | as A | |
| Section D — Full Year Evaluation | as B | |
| Assessed by / Position | W (assessor) | assessor name/position prefilled |
| Comments (with parenthetical guidance) | W long_text | |
| Recommendation: Not recommended for higher position / Recommended for higher position / Recommended for salary increment / Not recommended for salary increment | W multi_choice | **ambiguity: mutually exclusive pairs** (§11) |
| Summary: Overall Objectives / Support Needed / Review Mechanisms / Employee Comments / Supervisor Comments | W | employee stage fills Employee Comments only |
| Signatures | S | **the paper form has no signature lines**; see §11 |

### 8.4 Staff Probationary Assessment Form
| Element | Kind | Binding |
|---|---|---|
| Header incl. mailing address | render | verbatim |
| Staff Name / Position | A | |
| Instruction paragraph; Rating Scale (5–1 with "…not applicable to this staff") | render | verbatim (note wording differs slightly from the evaluation form; both kept) |
| 11 criteria (…"Responsiveness to Change: Staff adaptability to new trends", then a repeated 5-1 header, "Organizational Fit") | matrix | verbatim; repeated header row reproduced in PDF |
| "Overall Evaluation: Please add appropriate comments below:" row with rating cells | matrix row? | **ambiguity: rated or comment-only** (§11) |
| TOTAL RATINGS | C | sum of rated criteria |
| Comments (Probationer Staff) | W (subject employee) | |
| Comments (assessor guidance sentence) | W (assessor) | |
| Recommendation: Staff Confirmed / Staff Not Confirmed / Confirmation Extended | W single_choice (final approver) | drives nothing automatically |
| Assessed by / Position / Date | W | assessor identity; Date = stage completion |
| Signatures | S | none on paper; see §11 |

---

## 9. PDF architecture

`lib/pdf/layoutRenderer.ts` (new) reusing `pdfWriter.ts`'s object table, xref, WinAnsi escaping and Helvetica metrics, adding: absolute-positioned text with alignment, horizontal/vertical rules, rectangles, a table primitive (column widths, row heights from wrapped content, cell padding, header repeat across pages), checkbox glyphs drawn as squares with a stroke "X" when checked (no Unicode ☐/☒ — WinAnsi cannot encode them; the em dash in the rating scale is WinAnsi 0x97 and renders), an image XObject (PNG decoded to raw RGB(A) via the existing `sharp` dependency, Flate-compressed; JPEG passed through with DCTDecode), and a status marker (DRAFT / PENDING APPROVAL / RETURNED / REJECTED / APPROVED) drawn as small text in the page margin, outside the form body. Deterministic: no clock, no RNG; timestamps come from the data.

Template `render_config` maps sections to a page model that mirrors the docx: header table with logo slot, section tables, matrices with 5/4/3/2/1 columns, signature areas at the paper positions (signature PNGs scaled into the slot; a blank line when unsigned). "Download at every state" is a single `render(submission, revision, kind)` call: blank uses no answers; final is stored once and its SHA-256 recorded; all others render on demand from the immutable revision and are audited as `downloaded`.

Fidelity harness: a test extracts every string from each docx (the same parser used for this assessment) and asserts each label, choice, criterion and note appears in the rendered PDF's content streams in document order. Rendered bytes are also snapshot-tested for determinism.

---

## 10. Permissions and audit

New keys (proposed, minimum): `form_template.manage`, `form_template.publish`, `form.read`, `form.assess`, `form.approve`, `form.finalize`, `form.signature.apply`, `form.final.read`. Roles: org_admin all; hr_manager all except `form_template.publish` (publishing is a governed configuration change); hr_administrator/Primary HR per the existing delegation matrix (read/assess/approve/finalize, no template keys); employees none — self-service through the employee link. Ordinary supervisors act through stage resolution (`reporting_manager`) plus `form.assess`.

Audit event types: `form_template.created`, `form_template.version_published`, `form_template.version_archived`, `form_template.workflow_changed`, `form.created`, `form.submitted`, `form.returned`, `form.rejected`, `form.resubmitted`, `form.stage_completed`, `form.approved`, `form.signature_applied`, `form.signature_revoked`, `form.final_document_generated`, `form.finalized`, `form.archived`, `form.downloaded`, `signature_asset.uploaded`, `signature_asset.revoked`. Metadata carries ids, hashes, stage names; never answers or images.

---

## 11. Ambiguities in the source documents (preserved, not guessed)

1. **No signature lines on the Staff Evaluation and Probationary Assessment forms**; only "Assessed by" names. Proposal: keep the paper body unchanged and place the workflow signatures on an appended "Certification" page of the PDF (with names, roles, timestamps, hashes). Needs WWM confirmation.
2. **Evaluation goal ratings**: each goal has three action lines and a single 5–1 column set; unclear whether one rating per goal or per action line. Proposal: one per goal.
3. **Evaluation Recommendation**: four boxes that form two exclusive pairs; unclear whether one or two boxes may be ticked. Proposal: multi-choice with server rule "not both of a pair".
4. **Probation "Overall Evaluation" row** has rating cells; unclear whether it is rated and included in TOTAL RATINGS. Proposal: comment-only, excluded from total, pending confirmation.
5. **Probation form says "…not applicable to this staff"** where the evaluation form says "/ not applicable"; both kept verbatim.
6. **PIF "Office Called To"**: single office or several. Proposal: multi-select.
7. **PIF "Dependent Information"** has no section letter and sits between E and F; kept in that position. Four printed rows; digital form allows up to four unless WWM wants more.
8. **Leave "Date of Resumption"**: not derivable from the leave engine (next working day after `endDate` would be a guess); captured by the approver.
9. **Leave "Other (specify)"**: WWM leave types do not exist yet; which types map to the six boxes is WWM HR configuration, not code.
10. **Header logo asset**: the evaluation form embeds a different, smaller image than the other three; PDFs will use the single governed logo.
11. The owner's file list carries `(1)`/`(2)` suffixes; the files on disk do not. Treated as the same documents.

---

## 12. Phase breakdown (refined)

| Phase | Scope | Schema | Exit |
|---|---|---|---|
| **WS-26A Template & Submission Foundation** | tables above except signatures/assets/form_documents; template definition validator; version publish/lock; workflow stages + shared resolvers; submission lifecycle + revisions + events; auto-fill binding resolver; `layoutRenderer` v1 (text, tables, rules, checkboxes, logo, status marker); blank/draft/submitted/returned/rejected downloads on demand; permissions; admin UI (template list, publish) and ESS/HR submission UI on WS-25A primitives; isolation/permission/version/lifecycle tests | 0076 | CI green, up/down verified on local 5433, RLS gate passes |
| **WS-26B Signature & Finalized Document Engine** | provider abstraction, canvas + upload providers, device adapter contract, signature routes/storage/audit, finalization (snapshot + `generated_documents` + SHA-256 + embedded signatures + certification page), history UI | 0077 | signature authorization + immutability tests |
| **WS-26C WWM Leave + PIF** | template seed scripts (dev/test DB only), custom field definitions `wwm.*` for org 3, leave delegation stage, PIF auto-fill + onboarding `complete_form` task kind | 0078 (task kind) | fidelity tests for both forms |
| **WS-26D WWM Staff Evaluation + Probation** | matrices/totals, performance and probation linkage, assessor/employee/final-approver stages | none expected | fidelity + workflow tests |
| **WS-26E Fidelity, History & Production Readiness** | docx-vs-PDF harness across all four, responsive/a11y pass, download audit policy, retention, seeding runbook for Production WWM (owner-executed), rollback notes | none | owner deployment authorization |

The owner's split is appropriate; the one refinement is that the structured renderer belongs in **26A**, not 26E, because "download at every stage" is a 26A acceptance criterion.

---

## 13. Migration plan
1. Reconcile head (`0075`, journal idx 75) immediately before generating; run `pnpm --filter @workspace/db run verify:posture`.
2. WS-26A: `0076_ws26_form_engine.sql` — enums, seven tables, indexes, partial uniques, `ENABLE ROW LEVEL SECURITY` per table; a trigger or service guard setting `form_template_versions.first_used_at` on first submission insert and refusing definition updates afterwards.
3. Up/down/up on the disposable local database (port 5433, explicit `DATABASE_URL`; never the local `.env`, which points at Production).
4. No Production apply; the pending-migration count for Production grows by one and is recorded in the deployment doc.

## 14. Test strategy
Backend live tests (5433): tenant isolation (WWM sees its templates; org 1 cannot list, fetch, submit, download, or read signatures; super_admin without grant is 403/404, with grant follows the grant scope), permission matrix, version locking, full lifecycle with revisions/events, maker-checker, stale-stage protection, leave delegation round trip (balance snapshot), signature authorization (wrong slot, wrong stage, reuse attempt, cross-user asset), finalization immutability (hash stable, later employee edit does not change bytes), download at every state, PDF determinism and fidelity harness. Frontend: template admin, submission form (all field kinds, matrices at 320–1440 px), signature canvas with keyboard/AT alternative, history panel, downloads, `vitest-axe` on the three main screens. Typecheck, lint, production build, full CI.

## 15. Risks
- Fidelity of a table-heavy A4 layout in a hand-rolled renderer; mitigated by the docx-derived harness and by escalating to a library only if proven necessary.
- Scope creep into a general workflow engine; mitigated by per-template stages and delegation to Leave.
- Signature legal standing: the platform's first e-signature; documentation must state what is and is not asserted (identity by session, intent by explicit action, integrity by hash), and WWM policy for uploaded signatures is required before that method is enabled for anyone.
- Sensitive PIF data (medical conditions) must use sensitive custom fields and masked audit.
- WWM leave types absent; the leave template cannot be exercised on WWM until HR configures them.
- Concurrent sessions on this worktree (seen today); WS-26 branches must be single-owner.

## 16. Production confirmation
No Production writes, no database connection, no migration, no seed, no deployment. Files added by this phase: this document only.
