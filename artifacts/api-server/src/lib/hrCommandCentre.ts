/**
 * HR Dashboard Command Centre — one aggregated read for the operational
 * parts of the dashboard (My HR Tasks, HR Attention, upcoming holidays,
 * recent HR activity). Workforce and Leave figures stay on
 * GET /dashboard/summary, which already computes them.
 *
 * COMPOSITION, NOT A SECOND ENGINE. Every figure comes from the owning
 * module's existing service: the WS-15 Action Centre providers, the form
 * engine's live stage resolver, Performance's review list, Employment
 * Lifecycle's probation dates, the personnel custody report, Asset and
 * Attendance reporting, public holidays and the audit log. Nothing is stored.
 *
 * THE SAME THREE OUTCOMES AS THE ACTION CENTRE (§31.19, §31.22). Each section
 * is authorized first — module enabled AND the source's own permission — and
 * only then queried:
 *
 *   hidden — omitted entirely: no card, no count, no zero. Disabled and
 *            unauthorized are deliberately indistinguishable.
 *   failed — authorized but the query threw; named in `unavailableSections`
 *            so the page can say a section is incomplete.
 *   ok     — a real value, where 0 genuinely means nothing to do.
 *
 * MONITOR IS NOT ACTION. `tasks` holds only work the current membership can
 * perform now. Oversight-only items (a leave request still with its
 * Department Head, a form at someone else's stage) never appear there; where
 * useful they surface as a secondary figure on the matching attention card.
 *
 * NO PRIORITY IS INVENTED (§31.17). Tasks use the Action Centre's
 * deterministic four-tier order from authoritative dates only.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, auditEventsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { getModuleAccess } from "./organizationModules";
import { getEffectivePermissions } from "./permissions";
import { collectActionItems, sortActionItems } from "./actionCentre/aggregate";
import { nameMap, withName } from "./actionCentre/providers";
import type { ActionItem, ActionSourceModule } from "./actionCentre/types";
import { deriveOverdue } from "./actionCentre/types";
import { buildViewerContext, listSubmissionsAwaitingViewer } from "./formEngine/submissions";
import { listReviews } from "./performanceCycles";
import { listProbationsEndingOnOrBefore } from "./employmentLifecycle/probation";
import { resolveEmploymentLifecycleConfig } from "./employmentLifecycle/config";
import { runPersonnelReport } from "./personnelReporting";
import { resolveAssetReportScope, getAssetDashboard } from "./assetReporting";
import {
  resolveAttendanceReportScope,
  buildAttendanceReportContext,
  resolveOrganizationTodayCivilDate,
  getAttendanceDashboard,
} from "./attendanceReporting";
import { OrganizationTimezoneNotConfiguredError } from "./attendanceDailySummary";
import { listHolidayOccurrencesInRange, type HolidayOccurrence } from "./publicHolidays";
import { resolveAllowedAuditCategories } from "./auditAuthorization";
import { toIsoDate } from "./leaveRequests";

export const TASK_LIST_LIMIT = 25;
export const HOLIDAY_WINDOW_DAYS = 60;
export const HOLIDAY_LIST_LIMIT = 5;
export const ACTIVITY_LIST_LIMIT = 8;
/** Attendance statuses that need a look today. `on_leave`/`holiday`/`non_working_day` are expected absences. */
export const ATTENDANCE_EXCEPTION_STATUSES = ["late", "partial", "absent"] as const;

export type HrTaskSourceModule = ActionSourceModule | "forms";

/** A task row: the Action Centre's safe pointer shape, read-only (no inline commands here). */
export interface HrTask extends Omit<ActionItem, "sourceModule" | "inlineCommands"> {
  sourceModule: HrTaskSourceModule;
  /** A short, safe context line (e.g. the workflow stage), never narrative. */
  context: string | null;
}

export type HrAttentionKey =
  | "attendance_exceptions"
  | "probation_reviews_due"
  | "performance_reviews_due"
  | "personnel_files_attention"
  | "assets_awaiting_return"
  | "forms_awaiting_review";

export interface HrAttentionCard {
  key: HrAttentionKey;
  count: number;
  /** Secondary monitoring figure where the source has one (e.g. forms at other stages). */
  secondaryCount: number | null;
  deepLink: string;
}

export interface HrActivityItem {
  id: number;
  occurredAt: Date;
  eventType: string;
  targetType: string | null;
  actorName: string | null;
}

export interface HrCommandCentre {
  organizationId: number;
  generatedAt: Date;
  /** Null when the caller is authorized for no task source at all. */
  tasks: { items: HrTask[]; total: number; overdue: number; unavailableSources: string[] } | null;
  attention: HrAttentionCard[];
  upcomingHolidays: HolidayOccurrence[] | null;
  recentActivity: HrActivityItem[] | null;
  unavailableSections: string[];
}

export interface CommandCentreContext {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
}

type SectionOutcome<T> = { state: "ok"; value: T } | { state: "hidden" } | { state: "failed" };

/** Authorize-then-query, isolating failures exactly like the Action Centre's runProvider. */
async function runSection<T>(
  name: string,
  organizationId: number,
  authorize: () => Promise<boolean>,
  query: () => Promise<T | null>,
): Promise<SectionOutcome<T>> {
  try {
    if (!(await authorize())) return { state: "hidden" };
  } catch (err) {
    logger.error({ err, section: name, organizationId }, "hr command centre authorization failed");
    return { state: "hidden" };
  }
  try {
    const value = await query();
    // A source may itself decide there is nothing it can honestly report
    // (e.g. attendance with no timezone configured) — that is hidden, not zero.
    return value == null ? { state: "hidden" } : { state: "ok", value };
  } catch (err) {
    logger.error({ err, section: name, organizationId }, "hr command centre section failed");
    return { state: "failed" };
  }
}

async function moduleEnabled(organizationId: number, moduleKey: string): Promise<boolean> {
  return (await getModuleAccess(organizationId, moduleKey)).enabled;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function resolveHrCommandCentre(ctx: CommandCentreContext, now: Date = new Date()): Promise<HrCommandCentre> {
  const { organizationId, membershipId, applicationUserId } = ctx;
  const permissions = await getEffectivePermissions(membershipId);
  const has = (key: string) => permissions.has(key);

  const [actionCentre, forms, performance, probation, attendance, personnel, assets, holidays, activity] = await Promise.all([
    // WS-15 My Actions: already permission- and stage-authority-filtered per source.
    collectActionItems(ctx, "my_actions"),

    runSection(
      "forms",
      organizationId,
      async () => true,
      async () => listSubmissionsAwaitingViewer(organizationId, await buildViewerContext(organizationId, { userId: applicationUserId, membershipId })),
    ),

    runSection(
      "performance",
      organizationId,
      async () => (has("performance.manage") || has("performance.finalize")) && (await moduleEnabled(organizationId, "performance")),
      // hr_review is the stage HR finalizes (performance.finalize); the list route is gated on performance.manage.
      async () => listReviews({ organizationId, status: "hr_review", page: 1, pageSize: 100 }),
    ),

    runSection(
      "probation",
      organizationId,
      async () => has("employment_lifecycle.read") || has("employment_lifecycle.manage"),
      async () => {
        const config = await resolveEmploymentLifecycleConfig(organizationId);
        return listProbationsEndingOnOrBefore(organizationId, addDays(now, config.probationReminderDaysBefore));
      },
    ),

    runSection(
      "attendance",
      organizationId,
      async () => has("attendance.read.own") && (await moduleEnabled(organizationId, "attendance")),
      async () => {
        const scope = await resolveAttendanceReportScope({ organizationId, applicationUserId, membershipId });
        // An HR attention card is organization-wide by definition; a manager's
        // team view already lives on the attendance dashboard itself.
        if (!scope.isOrgWide) return null;
        try {
          const today = await resolveOrganizationTodayCivilDate(organizationId);
          const dashboard = await getAttendanceDashboard(await buildAttendanceReportContext(organizationId, scope), today);
          return dashboard.statusBreakdown
            .filter((s) => s.status != null && (ATTENDANCE_EXCEPTION_STATUSES as readonly string[]).includes(s.status))
            .reduce((sum, s) => sum + s.count, 0);
        } catch (err) {
          if (err instanceof OrganizationTimezoneNotConfiguredError) return null;
          throw err;
        }
      },
    ),

    runSection(
      "personnel_files",
      organizationId,
      async () => has("personnel_file.read"),
      async () => {
        const report = await runPersonnelReport({
          key: "personnel_checked_out_overdue_files",
          label: "Checked-out overdue files",
          description: "Personnel files checked out past their expected return",
          organizationId,
          filters: {},
        });
        return report.rows.filter((r) => r.overdue === "Yes").length;
      },
    ),

    runSection(
      "assets",
      organizationId,
      async () => has("asset_management.reports.read") && (await moduleEnabled(organizationId, "asset_management")),
      async () => {
        const scope = await resolveAssetReportScope({ organizationId, applicationUserId, membershipId });
        return (await getAssetDashboard(organizationId, scope)).overdueReturnCount;
      },
    ),

    runSection(
      "holidays",
      organizationId,
      async () => has("public_holiday.read") && (await moduleEnabled(organizationId, "leave")),
      async () => {
        const occurrences = await listHolidayOccurrencesInRange(organizationId, toIsoDate(now), toIsoDate(addDays(now, HOLIDAY_WINDOW_DAYS)));
        return [...occurrences].sort((a, b) => a.date.localeCompare(b.date)).slice(0, HOLIDAY_LIST_LIMIT);
      },
    ),

    runSection(
      "activity",
      organizationId,
      async () => {
        const allowed = await resolveAllowedAuditCategories(membershipId);
        return allowed === "all" || allowed.includes("hr");
      },
      // HR-category events only, even for an audit.read holder: security,
      // payroll and platform events never reach this operational widget, and
      // no before/after state, IP, user agent or metadata is returned.
      async () => {
        const rows = await db
          .select({
            id: auditEventsTable.id,
            occurredAt: auditEventsTable.occurredAt,
            eventType: auditEventsTable.eventType,
            targetType: auditEventsTable.targetType,
            actorFirstName: usersTable.firstName,
            actorLastName: usersTable.lastName,
          })
          .from(auditEventsTable)
          .leftJoin(usersTable, eq(usersTable.id, auditEventsTable.actorApplicationUserId))
          .where(and(eq(auditEventsTable.organizationId, organizationId), inArray(auditEventsTable.category, ["hr"])))
          .orderBy(desc(auditEventsTable.occurredAt))
          .limit(ACTIVITY_LIST_LIMIT);
        return rows.map<HrActivityItem>((r) => ({
          id: r.id,
          occurredAt: r.occurredAt,
          eventType: r.eventType,
          targetType: r.targetType,
          actorName: [r.actorFirstName, r.actorLastName].filter(Boolean).join(" ") || null,
        }));
      },
    ),
  ]);

  const unavailableSections: string[] = [];
  const attention: HrAttentionCard[] = [];
  const extraTasks: HrTask[] = [];
  const answeredTaskSources = new Set<string>(actionCentre.answeredSources);
  const unavailableTaskSources = new Set<string>(actionCentre.unavailableSources);

  const failed = (name: string, outcome: SectionOutcome<unknown>) => {
    if (outcome.state === "failed") unavailableSections.push(name);
  };
  [
    ["forms", forms],
    ["performance", performance],
    ["probation", probation],
    ["attendance", attendance],
    ["personnel_files", personnel],
    ["assets", assets],
    ["holidays", holidays],
    ["activity", activity],
  ].forEach(([name, outcome]) => failed(name as string, outcome as SectionOutcome<unknown>));

  if (attendance.state === "ok") {
    attention.push({ key: "attendance_exceptions", count: attendance.value, secondaryCount: null, deepLink: "/attendance-dashboard" });
  }

  if (probation.state === "ok") {
    const rows = probation.value;
    if (has("employment_lifecycle.read")) {
      attention.push({ key: "probation_reviews_due", count: rows.length, secondaryCount: null, deepLink: "/employees" });
    }
    // Confirming, extending or ending probation is employment_lifecycle.manage work.
    if (has("employment_lifecycle.manage")) {
      answeredTaskSources.add("employment_lifecycle");
      for (const e of rows) {
        extraTasks.push({
          sourceModule: "employment_lifecycle",
          sourceType: "employee_probation",
          sourceId: e.id,
          actionKind: "review",
          title: "Probation review",
          employeeId: e.id,
          employeeFirstName: e.firstName,
          employeeLastName: e.lastName,
          status: "probation",
          createdAt: e.createdAt,
          // §31.16: a probation end is an employment fact, not an actor deadline,
          // so it is shown as context rather than turned into a due date.
          dueAt: null,
          overdue: null,
          context: e.probationEndDate ? `Probation ends ${toIsoDate(e.probationEndDate)}` : null,
          deepLink: `/employees/${e.id}`,
        });
      }
    }
  } else if (probation.state === "failed" && has("employment_lifecycle.manage")) {
    unavailableTaskSources.add("employment_lifecycle");
  }

  if (performance.state === "ok") {
    if (has("performance.manage")) {
      attention.push({ key: "performance_reviews_due", count: performance.value.total, secondaryCount: null, deepLink: "/performance-reviews" });
    }
    if (has("performance.finalize")) {
      answeredTaskSources.add("performance");
      const names = await nameMap(organizationId, performance.value.items.map((r) => r.employeeId));
      for (const r of performance.value.items) {
        extraTasks.push({
          sourceModule: "performance",
          sourceType: "performance_review",
          sourceId: r.id,
          actionKind: "review",
          title: "Performance review awaiting HR",
          ...withName(names, r.employeeId),
          status: r.status,
          createdAt: r.createdAt,
          dueAt: null,
          overdue: null,
          context: null,
          deepLink: "/performance-reviews",
        });
      }
    }
  } else if (performance.state === "failed" && has("performance.finalize")) {
    unavailableTaskSources.add("performance");
  }

  if (forms.state === "ok") {
    const { awaiting, awaitingOthers } = forms.value;
    if (has("form.read")) {
      attention.push({ key: "forms_awaiting_review", count: awaiting.length, secondaryCount: awaitingOthers, deepLink: "/forms" });
    }
    // Forms have no module switch, so the source "answers" only for an HR
    // oversight holder or someone with work actually waiting on them — an
    // ordinary employee does not get an empty task panel from it.
    if (has("form.read") || awaiting.length > 0) answeredTaskSources.add("forms");
    const names = await nameMap(organizationId, awaiting.map((s) => s.subjectEmployeeId));
    for (const s of awaiting) {
      const submittedAt = s.submittedAt ?? s.createdAt;
      extraTasks.push({
        sourceModule: "forms",
        sourceType: "form_submission",
        sourceId: s.id,
        actionKind: "review",
        title: s.templateTitle,
        ...withName(names, s.subjectEmployeeId),
        status: s.status,
        createdAt: submittedAt,
        dueAt: null,
        overdue: deriveOverdue(null, now),
        // The assistance CATEGORY marker only; assistance notes never reach the dashboard.
        context: s.assisted ? `Stage: ${s.stageName} · HR-assisted` : `Stage: ${s.stageName}`,
        deepLink: `/forms/${s.id}`,
      });
    }
  } else if (forms.state === "failed") {
    unavailableTaskSources.add("forms");
  }

  if (personnel.state === "ok") {
    attention.push({ key: "personnel_files_attention", count: personnel.value, secondaryCount: null, deepLink: "/personnel-reports" });
  }
  if (assets.state === "ok") {
    attention.push({ key: "assets_awaiting_return", count: assets.value, secondaryCount: null, deepLink: "/assets-dashboard" });
  }

  const allTasks = sortActionItems<HrTask>([
    ...actionCentre.items.map<HrTask>(({ inlineCommands: _commands, ...item }) => ({ ...item, context: null })),
    ...extraTasks,
  ]);

  const tasks =
    answeredTaskSources.size > 0 || unavailableTaskSources.size > 0
      ? {
          items: allTasks.slice(0, TASK_LIST_LIMIT),
          total: allTasks.length,
          overdue: allTasks.filter((t) => t.overdue === true).length,
          unavailableSources: [...unavailableTaskSources].sort(),
        }
      : null;

  return {
    organizationId,
    generatedAt: now,
    tasks,
    attention,
    upcomingHolidays: holidays.state === "ok" ? holidays.value : null,
    recentActivity: activity.state === "ok" ? activity.value : null,
    unavailableSections: unavailableSections.sort(),
  };
}
