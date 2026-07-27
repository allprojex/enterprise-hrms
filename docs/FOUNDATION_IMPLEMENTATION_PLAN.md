# Foundation Implementation Plan

**Status:** APPROVED

## Purpose

This document is the authoritative implementation roadmap for completing the Enterprise HRMS Foundation.

The Foundation exists to provide the reusable enterprise platform on which all future HR modules will be built.

All implementation work must follow this document unless a later architectural decision explicitly supersedes it.

---

# Implementation Rules

Before implementing any workstream, work must:

1. Read:
   - CLAUDE.md
   - PROJECT_STATUS.md
   - ARCHITECTURE.md
   - ROADMAP.md
   - DECISIONS.md
   - MODULES.md
   - CONTRIBUTING.md

2. Treat the repository implementation as the source of truth.

3. Verify documentation against the current code before making changes.

4. Reuse existing architecture wherever possible.

5. Do not introduce unnecessary frameworks or abstractions.

6. Follow the approved dependency order.

7. Complete one workstream at a time.

8. Fully test each completed workstream.

9. Update documentation immediately after completion.

10. Commit before starting the next workstream.

11. Stop after each completed workstream and wait for approval.

---

# Foundation Scope Freeze

The Foundation scope is now frozen.

Do not introduce additional:

- foundation modules
- platform services
- architectural layers
- engines
- frameworks
- infrastructure capabilities

unless explicitly approved.

The objective is to complete the Foundation permanently so future phases focus on HR functionality rather than platform infrastructure.

---

# Architecture Decisions

## Approved

### 1. Module Management

Module Management is part of the Foundation.

Every organization must be able to enable only the modules it needs.

Module disabling must be enforced on:

- backend
- frontend
- navigation
- routes
- permissions
- background processing where applicable

---

### 2. Organization Configuration Engine

Organization Settings become a validated, versioned Configuration Engine.

Configuration should support areas such as:

- organization information
- terminology
- enabled modules
- numbering formats
- organizational structure
- employment statuses
- request types
- document categories
- workflow settings
- approval settings
- notification settings
- branding
- localization
- security

Use normalized tables where appropriate.

Use validated versioned configuration for flexible settings.

Avoid uncontrolled JSON blobs.

---

### 3. Master Data Management

Master Data is part of the Foundation.

Master Data must support reusable tenant-safe reference information including, where appropriate:

- titles
- genders
- marital statuses
- countries
- regions
- cities
- nationalities
- languages
- education levels
- employment types
- worker classifications
- employment statuses
- skills
- qualification types
- certification types
- professional memberships
- document categories
- asset categories
- request types
- separation reasons

Each domain should determine whether it is:

- system-defined
- organization-overridable
- organization-defined

Support:

- active/inactive
- sort order
- duplicate prevention
- dependency validation
- audit
- permissions
- organization isolation

---

### 4. Services Layer

Do not perform a repository-wide refactor.

Existing simple CRUD may continue using existing patterns.

New transactional or policy-heavy business logic should be implemented through focused service classes.

Examples include:

- lifecycle transitions
- separation
- document versioning
- organization structure
- timeline aggregation

---

### 5. Organization Structure Service

Business rules for:

- branches
- organizational units
- positions
- hierarchy validation
- dependency validation
- archive validation
- restructuring

should belong to a shared Organization Structure Service.

---

### 6. Employee Records

Employee records must never be hard deleted.

Future rehiring must create a new employment period while preserving historical records.

---

### 7. User Management

Administrative user management should use an invitation-first workflow.

Preferred flow:

Invite User

↓

Accept Invitation

↓

Set Password

↓

First Login

↓

Password Change (if required)

Never email passwords.

---

### 8. Roles & Permission Templates

Support reusable templates.

Examples include:

- Primary HR
- HR Administrator
- HR Officer
- Manager
- Department Head
- Records Officer
- Auditor
- Employee
- Organization Administrator

Organizations may customize copies.

System roles remain protected.

---

### 9. Reporting Foundation

Build a reusable Reporting Foundation rather than isolated reports.

Initially register only:

- Headcount
- Workforce Status
- Audit Summary

Future modules will register additional reports.

---

### 10. Forgot Password

Implement a provider abstraction.

Do not implement fake email delivery.

Remain blocked until a provider is selected.

---

# Dependency Order

Implement in this order unless repository dependencies require otherwise.

## W1

Active Organization Context — **Complete.**

---

## W2

Organization Configuration Engine — **Complete.**

---

## W3

Module Registry — **Complete.**

---

## W4

Per-Organization Module Enablement — **Complete.**

---

## W5

Backend Module Gating

---

## W6

Frontend Module Gating

---

## W7

Master Data Management

---

## W8

Organization CRUD Completion

---

## W9

Organization Permission Gates

---

## W10

Administrative User Management

---

## W11

Roles, Permissions and Templates

---

## W12

Organization Structure Service

---

## W13

Branch, Organizational Unit and Position Completion

---

## W14

Employee–User Linking Completion

---

## W15

Employee Separation

---

## W16

Tenant-safe Audit Log Reading

---

## W17

Reporting Foundation

---

## W18

Dashboard Completion

Remove all hardcoded values.

---

## W19

Forgot Password Email Delivery

Blocked until provider approval.

---

## W20

Foundation Verification

Must include:

- typecheck
- lint
- tests
- migrations
- OpenAPI generation
- generated clients
- production build

---

## W21

Foundation Completion Report

Update:

- PROJECT_STATUS.md
- ROADMAP.md
- MODULES.md
- ARCHITECTURE.md
- DECISIONS.md

Produce a final readiness assessment for Phase 2A.

---

# Phase 2A Blocking Items

Phase 2A must not begin until all blocking Foundation workstreams are complete.

Blocking items include:

- Active organization context
- Configuration Engine
- Module Management
- Module Gating
- Master Data
- Organization permission enforcement
- Administrative user management
- Organization Structure Service

Other workstreams may proceed immediately before Phase 2A if they do not compromise architectural integrity.

---

# Definition of Foundation Complete

The Foundation is complete only when:

- Every workstream satisfies its acceptance criteria.
- No foundation module remains Planned, Partial or Not Started.
- Documentation matches implementation.
- Repository builds successfully.
- All tests pass.
- No destructive migration risks remain.
- OpenAPI and generated clients are synchronized.
- Multi-tenant isolation is verified.
- Permission enforcement is verified.
- Module gating is verified.
- Organization switching is verified.
- Audit logging is verified.
- Foundation Completion Report declares zero remaining blockers.

Only after these conditions are met may implementation proceed to Phase 2A.

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

Then stop and wait for approval.

No additional work should begin automatically.
