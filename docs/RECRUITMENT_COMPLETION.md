# Recruitment Completion (WS-9)

Completes the recruitment lifecycle that was already largely built. Authoritative
scope: `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §25.

**This is completion, not reconstruction.** Requisitions, vacancies, pipeline
stages, multi-round interviews, panels, per-interviewer scorecards, immutable
offer versions, offer approval, candidate→employee conversion, duplicate
protection and the five-tier permission model were already in place and are
untouched.

---

## What WS-9 adds

| Gap | What it does now |
| --- | --- |
| Candidates required a published vacancy | A second, authorized manual capture path |
| `source` was free text with two literal values | Organization-configurable Master Data |
| One gate conflated "selected" with "authorized to employ" | Two distinct decisions |
| Approval chains were single-step only | Configurable multi-stage, per purpose |
| `accepted`/`declined`/`withdrawn` were unreachable | Real domain actions, version-bound |
| Offer expiry was a column nothing enforced | Deterministic, computed on every read and write |
| No structured employment terms | Employment particulars, frozen at issuance |
| `letterTemplateId`/`generatedDocumentStorageKey` reserved and unused | Wired to the shared document engine |

---

## Two candidate entry paths

The platform previously asserted, in `candidates.ts`'s own schema comment, that
*"every candidate row is created through the public careers apply endpoint."*
That invariant is deliberately superseded — but only by adding a door, never by
widening the existing one.

| | **A — Public / online** | **B — Authorized manual capture** |
| --- | --- | --- |
| Vacancy must be published | **Yes — unchanged** | **No** |
| Authentication | none (public portal) | required |
| Permission | none | `candidate.manage` |
| Source | portal default | a configured source is **required** |
| Audited | existing behaviour | yes |

Path A's gate lives in `publicCareers.ts`'s `isVacancyPubliclyEligible` and in
`employeeInternalApplications.ts`'s own predicate. **Neither was modified,
relaxed or routed around.** Unpublished and internal-only vacancies remain
invisible to public APIs.

Path B reuses `findOrCreateCandidate`, the same tables, the same
`(candidateId, vacancyId)` uniqueness and the same already-converted linkage.
**There is no second candidate model.** A manually captured candidate is
indistinguishable downstream except for its recorded source.

### Source and publication are orthogonal

A referral, walk-in or physical-notice source may accompany an unpublished
vacancy; a website source usually accompanies a published one. **Source never
controls publication.** They answer different questions: *how did this person
reach us* versus *is this role advertised*.

---

## Recruitment sources

`recruitment_source`, an `organization-defined` Master Data domain with **no
seeded items** — the same precedent as `training_category` and `payroll_bank`.
Referral, walk-in, agency, campus, physical announcement and careers portal are
*examples*; seeding any of them would impose one organization's recruiting model
on every other.

Validation matches either the organization's own item or a platform-wide one.
The organization filter is **part of the query**, not a post-check on a single
arbitrary row — an organization-defined code legitimately exists in many
organizations at once.

**Historical data is preserved.** The pre-existing free-text `source` column is
untouched, so every historical row keeps the literal it was written with. New
writes populate both it and the validated `sourceCode`.

---

## Approval architecture

Two chains, because they answer different questions:

| Purpose | Question |
| --- | --- |
| `requisition` | May this organization recruit for this role? |
| `hire` | May this specific candidate be employed? |

Conflating these was the documented gap. They are now separate records with
separate histories.

An organization configures ordered stages per purpose. **No stage is mandatory
and no sequence is hard-coded** — one stage, several, or none.

### Authority resolution

Three server-defined resolvers. A stage names one; it cannot supply code, and
there is no rule language or expression evaluator anywhere (OD #14 forbids a
second generic workflow engine).

| Resolver | Resolves through |
| --- | --- |
| `department_head` | the authoritative, temporal `department_heads` relationship for the subject's own department |
| `permission_holder` | any active member currently holding a named permission |
| `specific_membership` | one named member of this organization |

**Holding a role never confers approval authority.** `hr_manager`,
`department_head` and `org_admin` mean nothing to this system on their own.
Department Head authority resolves through `resolveDepartmentHeadAsOf`, which
honours `validFrom`/`validTo` — a replaced head cannot approve today.

Authority is re-resolved **at the moment of each decision** and never accepted
from the client.

### History is never rewritten

Each decision snapshots the stage name, resolver type, **authority basis**, and
the actor's name as it was. Replacing a department head, revoking a role or
reconfiguring the chain changes who may decide *next*; it never alters what was
already decided. Current authority and historical decision identity are
different facts.

`totalStages` is frozen when an authorization is raised, so reconfiguring
mid-flight cannot retroactively change whether it counts as complete. A stage is
decided exactly once, enforced by a unique index that also serves as the
concurrency guard.

**Delegation is not implemented.** No generalized delegation primitive exists in
this platform — only Office Inventory's own table, which WS-16 would generalize.
Building a second one here was out of scope and would have pre-empted that
workstream.

---

## Offer lifecycle

`accepted`, `declined` and `withdrawn` existed in the status enum with **no code
path writing them**. Each is now a real action, and **every response binds to an
exact `offerVersionId`** — an acceptance of revision 1 can never read as
acceptance of revision 2.

| Action | Who | Notes |
| --- | --- | --- |
| Accept | candidate (link) or staff | one terminal response per version |
| Decline | candidate (link) or staff | reason optional; candidate history never deleted |
| Withdraw | staff, `offer.withdraw` | reason **required**; refused after conversion completes |

**Expiry is computed, never scheduled.** `offer_versions.expiryDate` is
authoritative and is evaluated on every read and enforced on every write. A
scheduled job could only lag that truth. WS-6 is therefore used for reminders
only, never to determine state — §25.11 explicitly warns against creating a job
merely because WS-6 exists. An offer expiring "on the 5th" remains acceptable
throughout the 5th.

Supersession is unchanged: only the current, non-expired, issued version can
receive a response.

### Candidate response links

Candidates have no accounts, and **none was invented** — §25.12 forbids building
one solely for offer acceptance. Instead a single-purpose link, modelled on the
platform's existing candidate-facing precedent (`applications.statusCheckToken`
plus its dedicated rate limiter) but **deliberately hardened beyond it**:

| Property | Status-check precedent | Offer response link |
| --- | --- | --- |
| Storage | plaintext | **SHA-256 hash only** |
| Comparison | direct equality | hash lookup + constant-time compare |
| Scope | one application | one organization, one offer, **one version**, one action |
| Reuse | reusable | **single-use** (`usedAt`) |
| Revocation | none | revoked on response, withdrawal or re-issue |

The divergence is intentional: the existing token authorizes a *read*, this one
authorizes a *decision that changes employment state*, so a database disclosure
must not yield usable links. Every failure mode — expired, revoked, used, wrong
version, wrong organization, simply wrong — returns an identical 404, so probing
reveals nothing. **Tokens are never logged and never appear in audit metadata.**

Acceptance is a recruitment business event, **not a digital-signature claim.**
Evidence recorded is the version, timestamp, channel and optional staff note.

---

## Conversion gate

Conversion itself is **not rebuilt**. The single authoritative creation path and
the `candidate_employee_links` uniqueness guarantees in both directions are
untouched; only the eligibility guard is extended.

The Recruitment path now requires all four:

1. hire authorization complete (where stages are configured);
2. current offer approved;
3. current offer **accepted**;
4. offer not withdrawn, superseded or expired.

### Scope, and why enforcement is conditional

**This applies only to Recruitment conversion.** Direct employee creation,
legacy import, WS-7 bulk migration, existing employees and rehire are untouched
— an organization that did not recruit through this system is not required to
manufacture an offer in order to employ someone.

Enforcement is **prospective**, and deliberately engages only where the
organization has adopted the new lifecycle:

- hire authorization is required **only if** hire stages are configured;
- offer acceptance is required **only if** an offer exists for the application.

Existing records predate the accept/decline statuses entirely, because no code
could write them. Applying the gate to that history would strand legitimately
hired candidates behind an acceptance that was never possible to record.

What is **never** permitted, in any configuration, is converting against an
offer that was declined, withdrawn, superseded or expired. That is a correctness
rule, not an adoption question.

Already-converted employees are never invalidated and historical conversions are
never rewritten.

---

## Employment particulars

Structured employment terms implementing Ghana's Labour Act, 2003 (Act 651) §13
— a written statement of main terms, in the form set out in Schedule 1, within
two months of commencement, signed by both parties.

**The product is not branded as a jurisdiction-specific form.** Fields use
ordinary HR terminology and are usable by any organization; only a generated
document would carry statutory wording.

### Architecture decision

A **separate, strictly linked versioned record**, not sixteen more columns on
`offer_versions`. Reasons, in order of weight:

1. An offer and the employment terms it proposes have different lifetimes.
   Later workstreams (confirmation, promotion, transfer, service letters) need
   particulars **without an offer at all**; a row keyed on `offerVersionId`
   today can gain a second nullable owner later without disturbing offers.
2. Sixteen text fields describing employment terms are a document's content, not
   attributes of an offer revision.
3. Document generation reads one coherent record rather than a projection spread
   across an offer version and several live policy tables.

### Draft versus issued — the snapshot rule

While a draft, particulars may be re-derived from authoritative owners. **At
issuance the record freezes and every further edit is refused.**

That is the entire point: if an organization changes its leave policy next year,
a statement already furnished to a worker must still read exactly as furnished.
A live test asserts this by renaming the organization after issuance and
confirming the stored particulars do not move.

`derivedFrom` records which sources were consulted — **provenance, not a live
reference.**

### No invented law

Nothing computes a probation duration, notice period or leave entitlement.

- **Probation** — free text, **no default**. §25.9 forbids hard-coding any
  universal duration, and the reconciliation records that no numeric Ghana limit
  was established from primary text.
- **Notice** — two fields preserving Schedule 1's employer/worker sub-parts. **No
  universal period is hard-coded.**
- **Leave/holiday** — Leave configuration is *read* to suggest text and then
  frozen. The Leave engine is never duplicated and no entitlement is calculated
  here.

Fields the platform cannot know (notice, disciplinary rules, grievance
procedure, probation) are suggested **blank** rather than guessed. An invented
notice period in a statutory statement would be worse than an empty one.

---

## Document generation

WS-5's engine only — **no second PDF or template engine.** The generated
artifact is immutable by construction (`generated_documents` has no update path)
and bound to the offer version through WS-5's existing `sourceType`/`sourceId`
linkage. The reserved `letterTemplateId` and `generatedDocumentStorageKey`
columns are **wired**, not duplicated.

Seventeen `particulars.*` merge fields were added to WS-5's allow-list — that
module's own comment states adding a field there is the only way to make it
resolvable. They stay within its existing exclusion rule: nothing comes from
banking details, statutory identifiers or compensation components.

Generation reads only the frozen snapshot, so regenerating produces the same
content.

---

## Permissions, audit, isolation

**No new permission key was minted.** Every action maps onto an authority the
platform already names.

> **A security fact that shaped the gates**: the seeded `employee` role holds
> `offer.manage`. Record-level narrowing for the pre-existing offer routes lives
> in the service layer, but any *new* route gated only on `offer.manage` would
> be reachable by every employee. Consequential WS-9 actions are therefore gated
> on `offer.issue`, `offer.withdraw`, `candidate.manage`,
> `recruitment_settings.manage` — never `offer.manage` alone.

Configuration authority (`recruitment_settings.manage`) is separate from
operational approval authority, which comes from the stage resolver. Approving
one stage never grants authority over another.

Audited via WS-3: manual capture, stage configuration changes, hire
authorization requested and decided, offer accepted/declined/withdrawn, response
link issued, particulars issued. **Never audited**: response tokens, CV
contents, document contents, candidate personal detail.

Every new resource is organization-scoped, and cross-organization access is
refused with errors that reveal nothing about other tenants.

---

## Public endpoint hardening

The careers portal already carried `applyRateLimiter` (5 / 15 min) and
`statusCheckRateLimiter` (20 / 15 min); WS-9 extends that baseline with a
dedicated limiter on the offer-response endpoints.

Public responses expose a **minimal candidate-safe projection** — never internal
approval data, scorecards, notes, other candidates, unpublished vacancies,
employee data or organization configuration.

**CAPTCHA: not wired, deliberately.** §25.14 makes provider integration
conditional and forbids hard-coding a vendor. Adding one would have meant
committing the platform to an external service without Owner authorization, so
WS-9 implements the other anti-abuse controls and leaves provider integration
configurable and deferred. **No CAPTCHA exists — this is stated rather than
implied.**

**Malware/AV scanning does not exist**, in WS-9 or anywhere in this platform.
MIME and magic-byte validation is not malware scanning and is not described as
such. This remains a disclosed security follow-up.

---

## Known limitations

- No CAPTCHA provider (interface deferred, above).
- No malware scanning on uploads.
- No delegation of approval authority — pending WS-16's generalized primitive.
- Requisition approval keeps its existing single-step service; the multi-stage
  configuration model exists for both purposes, but only the `hire` purpose has
  a service consuming it. Extending the requisition service to walk configured
  stages is a small, additive follow-on that WS-9 did not need.
- Candidate retention/purge is not built; the boundary remains unresolved.

## WWM boundary

No WWM configuration was performed: no approval stages, no sources, no
signatory, no published vacancy, no candidate, no generated offer, no permission
change. All QA ran against disposable synthetic organizations.
