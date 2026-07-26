# Architectural Decisions

## ADR-001

One configurable enterprise HR platform.

---

## ADR-002

One tenant represents one organization.

---

## ADR-003

Organization behavior is configuration-driven.

---

## ADR-004

Modules are enabled per organization.

---

## ADR-005

Permissions are enforced server-side.

---

## ADR-006

Everything belongs to an organization.

---

## ADR-007

Payroll is outside the scope of the initial HR foundation.

---

## ADR-008

Module Management is part of the Foundation, not a later phase. Disabling a module must be enforced on backend, frontend, navigation, routes, permissions, and background processing — never menu-hiding alone.

---

## ADR-009

Organization Settings becomes a validated, versioned Configuration Engine, not an uncontrolled JSON blob. Normalized tables where appropriate; validated versioned configuration for genuinely flexible settings.

---

## ADR-010

Master Data Management is part of the Foundation. Each reference-data domain is explicitly classified as system-defined, organization-overridable, or organization-defined; a generic model serves simple lookups, dedicated schemas are used where a domain doesn't fit it.

---

## ADR-011

No repository-wide refactor. Existing simple CRUD keeps using existing route → lib patterns. New transactional or policy-heavy business logic (lifecycle transitions, separation, document versioning, structure rules, timeline aggregation) is implemented through focused service classes.

---

## ADR-012

Branch, organizational-unit, and position business rules (hierarchy validation, dependency validation, archive validation, restructuring) belong to one shared Organization Structure Service, not three parallel implementations.

---

## ADR-013

Employee records are never hard-deleted. Rehiring creates a new employment period while preserving historical records.

---

## ADR-014

Administrative user management is invitation-first: invite → accept → set password → first login → forced password change if policy requires it. Passwords are never emailed.

---

## ADR-015

Roles and permissions support reusable templates (Primary HR, HR Administrator, HR Officer, Manager, Department Head, Records Officer, Auditor, Employee, Organization Administrator) that organizations can copy and customize. System roles remain protected from unsafe editing or deletion.

---

## ADR-016

Reporting is a reusable Reporting Foundation (registry + metadata + permissions + export abstraction), not isolated report routes. Only Headcount, Workforce Status, and Audit Summary are registered initially.

---

## ADR-017

Forgot-password delivery uses a provider abstraction and remains blocked until an email provider is selected. Fake/no-op email delivery is never implemented as a stand-in.
