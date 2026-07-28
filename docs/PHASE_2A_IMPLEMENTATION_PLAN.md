# Phase 2A Implementation Plan (Core HR)

**Status:** APPROVED — FROZEN.

This document is the frozen implementation plan for Phase 2A. After approval and commit, changes require an ADR or an approved change request.

Referred to elsewhere as "Phase 2A (Core Employee Domain)" (see `docs/FOUNDATION_IMPLEMENTATION_PLAN.md`'s Phase 2A Blocking Items and `PROJECT_STATUS.md`) — same phase, `ROADMAP.md`'s naming ("Core HR") is used as this document's title since it's the source of the actual scope list.

## Purpose

This document is the proposed implementation roadmap for Phase 2A: **Core HR**, per `ROADMAP.md`'s Phase 2 list (Employee Lifecycle, Documents, Skills, Qualifications, Transfers, Promotions, Confirmations, Disciplinary Records, Exit Management).

Phase 2A builds HR functionality on top of the completed Enterprise Foundation (W1–W21, see `PROJECT_STATUS.md`'s Foundation Completion Report). It does not touch platform infrastructure — that work is finished and frozen.

`ROADMAP.md`'s Phase 2 list is nine flat, unordered items with no acceptance criteria or dependency order. This document proposes a concrete dependency order and a frozen scope per item, in the same style `docs/FOUNDATION_IMPLEMENTATION_PLAN.md` used for the Foundation — nothing here is authoritative until you approve it.

---

# Implementation Rules

Same rules that governed the Foundation, unchanged:

1. Read before implementing any workstream: `CLAUDE.md`, `PROJECT_STATUS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DECISIONS.md`, `MODULES.md`, `CONTRIBUTING.md`, `docs/FOUNDATION_IMPLEMENTATION_PLAN.md`, this document.
2. Treat the repository implementation as the source of truth.
3. Verify documentation against the current code before making changes.
4. Reuse existing Foundation architecture wherever possible (see Architecture Decisions below).
5. Do not introduce unnecessary frameworks or abstractions.
6. Follow the approved dependency order.
7. Complete one workstream at a time.
8. Fully test each completed workstream.
9. Update documentation immediately after completion.
10. Commit before starting the next workstream.
11. Stop after each completed workstream and wait for approval.

---

# Phase 2A Scope Freeze

Do not introduce, during Phase 2A:

- Phase 3 (Workforce Operations) functionality: Recruitment, Attendance, Leave, Performance, Learning, Assets, Employee Self Service, Manager Portal.
- Payroll, Tax, SSNIT, Benefits, or any Future Expansion item.
- New platform/foundation infrastructure (module system, permission model, audit system, reporting registry, master data engine) — extend the existing ones, never rebuild them.

The objective is HR functionality only, on the existing platform.

---

# Architecture Decisions (Proposed)

## For your approval

### 1. Employment Period History

ADR-013 anticipated this ("future rehiring must create a new employment period while preserving historical records") but W15 (Employee Separation) deliberately deferred it, using `audit_events` instead, since Foundation scope needed only a before/after diff. Every workstream below that records a dated employment event (transfer, promotion, confirmation) needs somewhere richer than an audit diff to attach it. Proposal: one `employment_periods` table + a focused `EmploymentLifecycleService` (per ADR-011's Services Layer pattern), not a repo-wide refactor of how employees are stored.

### 2. Reuse Master Data, don't re-invent it

`document_categories`, `skills`, `qualification_types`, `certification_types` are already named in `docs/FOUNDATION_IMPLEMENTATION_PLAN.md`'s Master Data Management decision (ADR-010) as domains the Master Data engine (W7) was built to support. Documents/Skills/Qualifications workstreams below register domains into the existing `master_data_domains`/`master_data_items` tables via the existing seed pattern — no new registry.

### 3. Reuse Organization Structure Service for reassignment validation

Transfers move an employee between branches/departments/positions. Cross-org reference validation and hierarchy checks already exist in `lib/organizationStructureService.ts` (ADR-012, W12) — Transfers calls into it, it does not duplicate it.

### 4. File storage for documents

Employee Documents needs general file upload (not image-only). Reuse the existing upload middleware/storage pattern from profile picture upload (`lib/fileStorage.ts`, `multer`), generalized to accept document MIME types instead of images-only; does not reuse `sharp` (image-specific).

### 5. Sensitive-record permission precedent

Disciplinary Records is a new sensitive-data class. Reuse the precedent already established for `employee.notes.read` (a narrower read permission than general `employee.read`) rather than inventing a new authorization pattern.

### 6. Exit Management builds on Separation, does not duplicate it

W15 already made `POST .../employees/:id/separate` set `employmentStatus: terminated` with date/reason, audit-logged, never-hard-deleted. Exit Management adds the surrounding off-boarding *process* (checklist, clearance, exit interview record) attached to that same separation event — it does not re-implement separation.

---

# Dependency Order (Proposed)

## W22

Employment Period History Service

Foundational dependency for W25–W27. `employment_periods` table (org-scoped, references `employees`) + `EmploymentLifecycleService`. No user-facing feature by itself — mirrors the W5/W12 precedent of shipping a capability ahead of its first consumer.

---

## W23

Employee Documents

Upload, categorize (via Master Data `document_categories`), list, and remove documents per employee. Versioning is in scope only if a single "documents have exactly one current version, replacing on re-upload" rule satisfies it — no separate version-history UI unless you approve expanding scope.

---

## W24

Skills & Qualifications

Employee skills and qualifications, sourced from Master Data (`skills`, `qualification_types`, `certification_types`). CRUD of an employee's own list; does not include skill-matching, gap analysis, or any Phase 3 recruitment tie-in.

---

## W25

Transfers

Department/branch/position reassignment recorded as an `employment_periods` event (W22), validated through the Organization Structure Service (W12). Distinct from W12's existing `restructure` endpoints, which move a department/position itself, not an employee.

---

## W26

Promotions

Position/title change with an effective date, recorded via W22. Does not include compensation/salary — no such field or concept exists anywhere in the current schema, and inventing one is out of this workstream's scope.

---

## W27

Confirmations

Formalizes the existing `employmentStatus: "probation"` → `"active"` transition (the field and enum value already exist on `employees`) into an audited, permission-gated action via W22, mirroring W15's `separate`/`rehire` endpoint shape.

---

## W28

Disciplinary Records

New org-scoped entity for recording warnings/disciplinary actions per employee, gated by a narrower read permission than `employee.read` (see Architecture Decision 5).

---

## W29

Exit Management

Off-boarding workflow (checklist/clearance/exit interview record) attached to an existing separation event (W15). Does not modify or duplicate the separation endpoint itself.

---

## W30

Phase 2A Verification

Must include:

- typecheck
- lint
- tests
- migrations
- OpenAPI generation
- generated clients
- production build

---

## W31

Phase 2A Completion Report

Update:

- PROJECT_STATUS.md
- ROADMAP.md
- MODULES.md
- ARCHITECTURE.md
- DECISIONS.md

Produce a final readiness assessment for Phase 2B / Phase 3.

---

# Definition of Phase 2A Complete

Phase 2A is complete only when:

- Every workstream (W22–W31) satisfies its acceptance criteria.
- Documentation matches implementation.
- Repository builds successfully; all tests pass.
- No destructive migration risks remain; every migration generated, none applied without your explicit approval (same rule as Foundation).
- OpenAPI and generated clients are synchronized.
- Multi-tenant isolation, permission enforcement, and audit logging are verified for every new entity.
- Phase 2A Completion Report declares zero remaining blockers.

---

# Implementation Output

After every completed workstream, provide:

- Summary of work completed
- Database changes
- API changes
- Frontend changes
- Permissions added or changed
- Tests added
- Documentation updated
- Risks
- Next recommended workstream

Then stop and wait for approval. No additional work should begin automatically.
