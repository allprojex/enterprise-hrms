import { and, desc, eq } from "drizzle-orm";
import {
  db,
  onboardingInstancesTable,
  onboardingTasksTable,
  employeeDisciplinaryRecordsTable,
  skillsTable,
} from "@workspace/db";
import { getModuleAccess } from "../organizationModules";
import { hasPermission } from "../permissions";
import { listTerms } from "../employmentLifecycle/employmentTerms";
import { listAssignments } from "../employmentLifecycle/assignments";
import * as disciplinary from "../employeeRelations/disciplinary";
import * as dataChange from "../employeeRequests/dataChange";
import * as serviceRequests from "../employeeRequests/serviceRequests";
import * as capability from "../skills/capability";
import { listLeaveRequests } from "../leaveRequests";
import { getEmployeeBalances } from "../leaveBalances";
import { listMyEnrollments } from "../learningEnrollments";
import { getAttendanceDailySummaryRange } from "../attendanceDailySummary";
import { ONBOARDING_MODULE_KEY } from "../onboarding/moduleKey";
import { type Employee360Provider, type Employee360Row, limitRows } from "./types";

/**
 * WS-15 P2/P3 — the eight Employee 360 section providers (§31.29).
 *
 * §31.29's discovery IS the specification: the employee detail page already
 * showed the core record, numbering, qualifications, certifications, documents,
 * employment history, personnel file and custody, exit processes, performance
 * reviews and an asset report — and was missing WS-11 employment terms, WS-12
 * cases, WS-13 requests, WS-14 skill records, Leave, Learning, Attendance and
 * Onboarding. These eight providers add exactly those, and nothing else.
 *
 * THE LEGACY RECONCILIATION, WHICH IS THE RISKY PART. Two shipped sections
 * showed SUPERSEDED models, so the page was not merely incomplete but in two
 * places out of date:
 *
 *   - `employee_skills` (free-text code and free-text proficiency string, no
 *     scale, no verification, no assessor, no evidence, no expiry, no history)
 *     versus WS-14's typed `employee_skill_records`;
 *   - `employee_disciplinary_records` (a flat note) versus WS-12's structured
 *     `disciplinary_cases` with stages, events and a confidentiality tier.
 *
 * NEITHER LEGACY TABLE IS MIGRATED, CONVERTED, INFERRED FROM OR DELETED
 * (§31.37, §31.29). Instead each provider below returns the CURRENT model, and
 * carries the legacy rows beside it marked `provenance: "legacy"` with a plain
 * note. A legacy proficiency string is never presented as a verified level, and
 * a legacy disciplinary note is never presented as a structured case — the
 * distinction §30.6 and §28 both depend on. Hiding the legacy rows instead
 * would have been worse than showing them: it would erase genuine history
 * somebody may need to explain later.
 *
 * NOTHING HERE WRITES. Every function is a read, every section ends in a deep
 * link, and the owning module re-gates at the destination (§31.29).
 *
 * SUCCESSION AND PAYROLL HAVE NO PROVIDER, DELIBERATELY. §30.17 forbids an
 * employee's succession standing appearing on their own 360 view at all, and
 * §31.29's missing-section list does not name Payroll. Both absences are
 * architecture, not oversight.
 */

const fmt = (value: number) => String(value);

// ---------------------------------------------------------------------------
// WS-11 — employment terms and lifecycle assignments
// ---------------------------------------------------------------------------

const lifecycleProvider: Employee360Provider = {
  key: "employment_lifecycle",
  async authorize(ctx) {
    return hasPermission(ctx.membershipId, "employment_lifecycle.read");
  },
  async query(ctx) {
    const [terms, assignments] = await Promise.all([
      listTerms(ctx.organizationId, ctx.employeeId),
      listAssignments(ctx.organizationId, ctx.employeeId),
    ]);
    if (terms.length === 0 && assignments.length === 0) return null;

    const active = terms.find((t) => t.status === "active") ?? null;
    const openAssignments = assignments.filter((a) => a.actualEndDate == null);

    const rows: Employee360Row[] = [
      ...terms.map((t) => ({
        id: t.id,
        label: t.termType === "fixed_term" ? "Fixed-term contract" : "Permanent terms",
        status: t.status,
        occurredAt: t.startDate ?? t.createdAt,
        provenance: "current" as const,
      })),
      ...assignments.map((a) => ({
        id: a.id,
        // The assignment KIND, never the reason or any note attached to it.
        label: a.assignmentType === "acting" ? "Acting appointment" : "Secondment",
        status: a.actualEndDate == null ? "open" : "ended",
        occurredAt: a.startDate,
        provenance: "current" as const,
      })),
    ].sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));

    const limited = limitRows(rows);
    return {
      key: "employment_lifecycle",
      title: "Employment terms and lifecycle",
      provenance: "current",
      stats: [
        { label: "Current terms", value: active ? (active.termType === "fixed_term" ? "Fixed term" : "Permanent") : "None recorded" },
        { label: "Open assignments", value: fmt(openAssignments.length) },
      ],
      ...limited,
      deepLink: `/employees/${ctx.employeeId}`,
    };
  },
};

// ---------------------------------------------------------------------------
// WS-12 — structured Employee Relations, plus labelled legacy notes
// ---------------------------------------------------------------------------

const employeeRelationsProvider: Employee360Provider = {
  key: "employee_relations",
  async authorize(ctx) {
    return hasPermission(ctx.membershipId, "employee_relations.read");
  },
  async query(ctx) {
    const [cases, legacy] = await Promise.all([
      disciplinary.listCases(ctx.organizationId, { employeeId: ctx.employeeId }),
      db
        .select()
        .from(employeeDisciplinaryRecordsTable)
        .where(
          and(
            eq(employeeDisciplinaryRecordsTable.organizationId, ctx.organizationId),
            eq(employeeDisciplinaryRecordsTable.employeeId, ctx.employeeId),
          ),
        )
        .orderBy(desc(employeeDisciplinaryRecordsTable.createdAt)),
    ]);
    if (cases.length === 0 && legacy.length === 0) return null;

    // GRIEVANCES ARE ABSENT FROM THIS SECTION ENTIRELY. `grievance.read` is
    // withheld from org_admin by default (§28.17), and a grievance concerning
    // this employee is not theirs to have surfaced on a general HR page. The
    // Employee Relations workspace remains the only route to it.
    const rows: Employee360Row[] = [
      ...cases.map((c) => ({
        id: c.id,
        // The case REFERENCE only — never the allegation, the stage detail or
        // any evidence (§28, §31.14).
        label: `Disciplinary case #${c.id}`,
        status: c.status,
        occurredAt: c.openedAt,
        provenance: "current" as const,
      })),
      ...legacy.map((r) => ({
        id: r.id,
        // The legacy model is a flat note. Its TYPE is shown; its content is
        // not, and it is never presented as a structured case.
        label: "Legacy disciplinary record",
        status: null,
        occurredAt: r.createdAt,
        provenance: "legacy" as const,
      })),
    ].sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));

    const limited = limitRows(rows);
    return {
      key: "employee_relations",
      title: "Employee Relations",
      provenance: cases.length > 0 ? "current" : "legacy",
      stats: [
        { label: "Open cases", value: fmt(cases.filter((c) => c.status === "open").length) },
        { label: "Legacy records", value: fmt(legacy.length) },
      ],
      ...limited,
      deepLink: `/employee-relations`,
      note:
        legacy.length > 0
          ? "Legacy records pre-date structured disciplinary cases. They are retained as history and are not part of the current case model."
          : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// WS-13 — requests
// ---------------------------------------------------------------------------

const requestsProvider: Employee360Provider = {
  key: "employee_requests",
  async authorize(ctx) {
    return (
      (await hasPermission(ctx.membershipId, "data_change.read")) ||
      (await hasPermission(ctx.membershipId, "service_request.read"))
    );
  },
  async query(ctx) {
    // Each half is gated separately: holding one read key never reveals the
    // other's volume (§29.21).
    const canReadDataChange = await hasPermission(ctx.membershipId, "data_change.read");
    const canReadService = await hasPermission(ctx.membershipId, "service_request.read");

    const [changes, services] = await Promise.all([
      canReadDataChange ? dataChange.listRequests(ctx.organizationId, { employeeId: ctx.employeeId }) : [],
      canReadService ? serviceRequests.listRequests(ctx.organizationId, { employeeId: ctx.employeeId }) : [],
    ]);
    if (changes.length === 0 && services.length === 0) return null;

    const rows: Employee360Row[] = [
      ...changes.map((r) => ({
        id: r.id,
        // NEITHER the field nor the proposed value. OD #23 masking lives in
        // WS-13's own approval view, and this row must never become a route
        // around it — a masked National ID is still a National ID.
        label: "Data change request",
        status: r.status,
        occurredAt: r.requestedAt,
        provenance: "current" as const,
      })),
      ...services.map((r) => ({
        id: r.id,
        // The request reference, never the employee's own free-text subject.
        label: `Service request #${r.id}`,
        status: r.status,
        occurredAt: r.submittedAt,
        provenance: "current" as const,
      })),
    ].sort((x, y) => (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0));

    const stats = [];
    if (canReadDataChange) stats.push({ label: "Data changes", value: fmt(changes.length) });
    if (canReadService) stats.push({ label: "Service requests", value: fmt(services.length) });

    const limited = limitRows(rows);
    return {
      key: "employee_requests",
      title: "Requests",
      provenance: "current",
      stats,
      ...limited,
      deepLink: `/requests`,
    };
  },
};

// ---------------------------------------------------------------------------
// WS-14 — typed capability, plus labelled legacy free-text skills
// ---------------------------------------------------------------------------

const skillsProvider: Employee360Provider = {
  key: "skills",
  async authorize(ctx) {
    return hasPermission(ctx.membershipId, "employee_skill.read");
  },
  async query(ctx) {
    const { employeeSkillsTable } = await import("@workspace/db");
    const [records, legacy] = await Promise.all([
      capability.listRecords(ctx.organizationId, { employeeId: ctx.employeeId }),
      db
        .select()
        .from(employeeSkillsTable)
        .where(
          and(
            eq(employeeSkillsTable.organizationId, ctx.organizationId),
            eq(employeeSkillsTable.employeeId, ctx.employeeId),
          ),
        ),
    ]);
    if (records.length === 0 && legacy.length === 0) return null;

    const skillNames = new Map<number, string>();
    if (records.length > 0) {
      const rows = await db
        .select({ id: skillsTable.id, name: skillsTable.name })
        .from(skillsTable)
        .where(eq(skillsTable.organizationId, ctx.organizationId));
      for (const r of rows) skillNames.set(r.id, r.name);
    }

    const verified = records.filter((r) => r.status === "verified").length;

    const rows: Employee360Row[] = [
      ...records.map((r) => ({
        id: r.id,
        label: skillNames.get(r.skillId) ?? "Skill",
        // The WS-14 status verbatim, so `claimed` is never rendered as
        // capability the organization has confirmed (§30.5, §30.6).
        status: r.status,
        occurredAt: r.updatedAt,
        provenance: "current" as const,
      })),
      ...legacy.map((r) => ({
        id: r.id,
        label: r.skillCode,
        // The legacy free-text proficiency string is DELIBERATELY NOT SHOWN as
        // a status: it has no scale behind it, and nothing may be inferred from
        // it (§31.37, §30.1). The row exists so the history is not erased.
        status: null,
        occurredAt: r.createdAt,
        provenance: "legacy" as const,
      })),
    ];

    const limited = limitRows(rows);
    return {
      key: "skills",
      title: "Skills and capability",
      provenance: records.length > 0 ? "current" : "legacy",
      stats: [
        { label: "Verified", value: fmt(verified) },
        // Claimed-but-unverified is reported separately and never counted as
        // capability (§30.6).
        { label: "Awaiting verification", value: fmt(records.length - verified) },
        { label: "Legacy entries", value: fmt(legacy.length) },
      ],
      ...limited,
      deepLink: `/capability`,
      note:
        legacy.length > 0
          ? "Legacy entries are free-text records with no proficiency scale and no verification. They are retained as history and are not verified capability."
          : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

const leaveProvider: Employee360Provider = {
  key: "leave",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "leave")).enabled) return false;
    return hasPermission(ctx.membershipId, "leave_request.manage");
  },
  async query(ctx) {
    const [requests, balances] = await Promise.all([
      listLeaveRequests(ctx.organizationId, ctx.employeeId),
      getEmployeeBalances(ctx.organizationId, ctx.employeeId),
    ]);
    if (requests.length === 0 && balances.length === 0) return null;

    const rows: Employee360Row[] = requests.map((r) => ({
      id: r.id,
      // NEVER the leave reason — the Manager Portal precedent, and §31.14.
      label: "Leave request",
      status: r.status,
      occurredAt: r.createdAt,
      provenance: "current" as const,
    }));

    const limited = limitRows(rows);
    return {
      key: "leave",
      title: "Leave",
      provenance: "current",
      stats: [
        { label: "Pending", value: fmt(requests.filter((r) => r.status === "pending" || r.status === "pending_hr").length) },
        { label: "Leave types with balance", value: fmt(balances.length) },
      ],
      ...limited,
      deepLink: `/leave-approvals`,
    };
  },
};

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

const learningProvider: Employee360Provider = {
  key: "learning",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "learning")).enabled) return false;
    return hasPermission(ctx.membershipId, "learning.manage");
  },
  async query(ctx) {
    const enrollments = await listMyEnrollments(ctx.organizationId, ctx.employeeId);
    if (enrollments.length === 0) return null;

    const completed = enrollments.filter((e) => e.status === "completed").length;
    const rows: Employee360Row[] = enrollments.map((e) => ({
      id: e.id,
      label: e.courseTitleSnapshot,
      status: e.status,
      occurredAt: e.createdAt,
      provenance: "current" as const,
    }));

    const limited = limitRows(rows);
    return {
      key: "learning",
      title: "Learning",
      provenance: "current",
      stats: [
        { label: "Enrolments", value: fmt(enrollments.length) },
        { label: "Completed", value: fmt(completed) },
      ],
      ...limited,
      deepLink: `/learning-enrollments`,
      // No score, no assessment result and no certificate content — only what
      // the employee is enrolled on and whether it finished.
    };
  },
};

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const attendanceProvider: Employee360Provider = {
  key: "attendance",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, "attendance")).enabled) return false;
    return hasPermission(ctx.membershipId, "attendance.manage");
  },
  async query(ctx) {
    // A 30-day OPERATIONAL SUMMARY, never a raw event dump. Individual
    // punch events, devices and locations stay in Attendance's own surfaces.
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // ATTENDANCE HAS A DOCUMENTED CONFIGURATION EDGE CASE. Its own service
    // hard-errors when the organization has not set general.timezone, because
    // a silent UTC fallback would produce systematically wrong "late" figures.
    // managerPortalDashboard.ts already catches exactly this and treats the
    // tile as unavailable rather than failing the whole response; the same
    // reasoning applies here, and it is OMISSION rather than a named failure —
    // "enabled but not yet configured" is a state, not an outage, and putting a
    // permanent warning banner on every 360 page would be noise, not honesty.
    let summaries;
    try {
      summaries = await getAttendanceDailySummaryRange(ctx.organizationId, ctx.employeeId, iso(from), iso(to));
    } catch (err) {
      if ((err as Error)?.name === "OrganizationTimezoneNotConfiguredError") return null;
      throw err;
    }
    if (summaries.length === 0) return null;

    const present = summaries.filter((s) => s.status === "present").length;
    const absent = summaries.filter((s) => s.status === "absent").length;
    // "Late" is derived from the module s own lateMinutes figure rather than a
    // flag WS-15 invents, so the definition stays Attendance own.
    const late = summaries.filter((s) => (s.lateMinutes ?? 0) > 0).length;

    return {
      key: "attendance",
      title: "Attendance (last 30 days)",
      provenance: "current",
      stats: [
        { label: "Present", value: fmt(present) },
        { label: "Absent", value: fmt(absent) },
        { label: "Late", value: fmt(late) },
      ],
      // Counts only: no per-day rows, so no movement pattern is reconstructable
      // from this page.
      rows: [],
      truncated: summaries.length > 0,
      deepLink: `/attendance-register`,
    };
  },
};

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const onboardingProvider: Employee360Provider = {
  key: "onboarding",
  async authorize(ctx) {
    if (!(await getModuleAccess(ctx.organizationId, ONBOARDING_MODULE_KEY)).enabled) return false;
    return hasPermission(ctx.membershipId, "onboarding.read");
  },
  async query(ctx) {
    const instances = await db
      .select()
      .from(onboardingInstancesTable)
      .where(
        and(
          eq(onboardingInstancesTable.organizationId, ctx.organizationId),
          eq(onboardingInstancesTable.employeeId, ctx.employeeId),
        ),
      )
      .orderBy(desc(onboardingInstancesTable.id));
    if (instances.length === 0) return null;

    const instance = instances[0]!;
    const tasks = await db
      .select({ id: onboardingTasksTable.id, title: onboardingTasksTable.title, status: onboardingTasksTable.status, dueAt: onboardingTasksTable.dueAt })
      .from(onboardingTasksTable)
      .where(
        and(
          eq(onboardingTasksTable.organizationId, ctx.organizationId),
          eq(onboardingTasksTable.instanceId, instance.id),
        ),
      );

    const pending = tasks.filter((t) => t.status === "pending");
    const rows: Employee360Row[] = pending.map((t) => ({
      id: t.id,
      label: t.title,
      status: t.status,
      occurredAt: t.dueAt ?? null,
      provenance: "current" as const,
    }));

    const limited = limitRows(rows);
    return {
      key: "onboarding",
      title: "Onboarding",
      provenance: "current",
      stats: [
        { label: "Status", value: instance.status.replace(/_/g, " ") },
        { label: "Tasks outstanding", value: fmt(pending.length) },
        { label: "Tasks total", value: fmt(tasks.length) },
      ],
      ...limited,
      deepLink: `/onboarding`,
    };
  },
};

/**
 * The frozen §31.29 section set.
 *
 * Succession and Payroll are absent by design (see this file's header), and
 * Documents, Performance, Personnel Files, qualifications, certifications and
 * assets already ship on the employee page and are not re-implemented here.
 */
export const EMPLOYEE_360_PROVIDERS: readonly Employee360Provider[] = [
  lifecycleProvider,
  employeeRelationsProvider,
  requestsProvider,
  skillsProvider,
  leaveProvider,
  learningProvider,
  attendanceProvider,
  onboardingProvider,
];

