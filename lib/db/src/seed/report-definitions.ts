/**
 * Reporting Foundation registry data (ADR-016), split out from
 * seed-reports.ts so it has no dependency on `../index` (which requires
 * DATABASE_URL to import at all) — mirrors module-definitions.ts.
 */

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
  requiredPermissionKey: string;
}

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    key: "headcount",
    label: "Headcount",
    description: "Current employee headcount broken down by branch.",
    category: "workforce",
    requiredPermissionKey: "employee.read",
  },
  {
    key: "workforce_status",
    label: "Workforce Status",
    description: "Current employee count broken down by employment status.",
    category: "workforce",
    requiredPermissionKey: "employee.read",
  },
  {
    key: "audit_summary",
    label: "Audit Summary",
    description: "Count of recorded audit events broken down by event type.",
    category: "compliance",
    requiredPermissionKey: "audit.read",
  },
  // Phase 3A, W61 — Recruitment Dashboard & Reporting (§18). Registered here
  // for catalog discoverability via the existing GET /reports (ADR-016), per
  // the frozen plan's "reuse the reports registry" instruction — but, unlike
  // the three reports above, these are NOT executed through the generic
  // GET .../reports/:reportKey/run route (lib/reporting.ts's RUNNERS map has
  // no entries for these keys, so that route safely 404s "Unknown report"
  // for any of them). Recruitment reports need the assigned-recruiter/
  // hiring-manager-vs-organization-wide visibility tier §7 requires, which
  // the generic runner (organizationId only, no scope) cannot express —
  // execution is instead a dedicated, scope-aware route
  // (GET .../recruitment/reports/:reportKey, artifacts/api-server/src/routes/recruitmentReporting.ts)
  // that still reuses the same {columns, rows}/CSV export shape and
  // requiredPermissionKey convention this registry already established.
  {
    key: "recruitment_applicants_by_vacancy",
    label: "Applicants by Vacancy",
    description: "Total applications received, broken down by vacancy.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_applicants_by_source",
    label: "Applicants by Source",
    description: "Total applications received, broken down by candidate source.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_time_to_fill",
    label: "Time to Fill",
    description: "Days elapsed between requisition approval and the requisition reaching \"filled\" status, per requisition.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_time_to_hire",
    label: "Time to Hire",
    description: "Average days elapsed between application submission and reaching a hired-category stage, broken down by vacancy.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_age_in_stage",
    label: "Age in Stage",
    description: "Average time applications have spent in their current (non-terminal) pipeline stage.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_conversion_funnel",
    label: "Conversion Funnel",
    description: "Applied-to-hired funnel counts and stage-to-stage conversion rates, plus rejected/withdrawn outcome counts.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_interview_to_offer_ratio",
    label: "Interview-to-Offer Ratio",
    description: "Share of interviewed applications that received an offer.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_offer_acceptance_rate",
    label: "Offer Acceptance Rate",
    description: "Share of decided offer versions (accepted vs. declined) that were accepted.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  {
    key: "recruitment_rejection_reasons",
    label: "Rejection Reason Breakdown",
    description: "Rejected applications broken down by rejection reason code.",
    category: "recruitment",
    requiredPermissionKey: "recruitment.reports.read",
  },
  // Phase 3B, W70 — Attendance Dashboard & Reporting (§7/§10 W70 row).
  // Registered here for catalog discoverability via the existing GET
  // /reports (ADR-016), but — like the recruitment_* keys above — NOT
  // executed through the generic GET .../reports/:reportKey/run route
  // (lib/reporting.ts's RUNNERS map has no entries for these keys, so that
  // route safely 404s "Unknown report" for any of them). Attendance reports
  // need the own/team/organization-wide visibility tiers the generic runner
  // cannot express — execution is a dedicated, scope-aware route instead
  // (GET .../attendance/reports/:reportKey,
  // artifacts/api-server/src/routes/attendanceReporting.ts), reusing the
  // same {columns, rows}/CSV export shape and requiredPermissionKey
  // convention this registry already established.
  {
    key: "attendance_daily_register",
    label: "Daily Register",
    description: "Per-employee, per-day attendance status for a date range, flattened for export.",
    category: "attendance",
    requiredPermissionKey: "attendance.read.own",
  },
  {
    key: "attendance_monthly_summary",
    label: "Monthly Summary",
    description: "Per-employee attendance status counts (present/late/partial/absent/on leave/holiday/non-working day) across a date range.",
    category: "attendance",
    requiredPermissionKey: "attendance.read.own",
  },
  {
    key: "attendance_late_arrivals",
    label: "Late Arrivals",
    description: "Every late-arrival instance in a date range, with clock-in time and minutes late.",
    category: "attendance",
    requiredPermissionKey: "attendance.read.own",
  },
  {
    key: "attendance_absenteeism",
    label: "Absenteeism",
    description: "Every unexplained-absence instance in a date range (excludes approved leave, holidays, and non-working days).",
    category: "attendance",
    requiredPermissionKey: "attendance.read.own",
  },
] as const;

/** Throws on a duplicate key — the only integrity rule this registry has (no dependency graph, unlike modules). */
export function validateReportDefinitions(definitions: readonly ReportDefinition[]): void {
  const seen = new Set<string>();
  for (const report of definitions) {
    if (seen.has(report.key)) {
      throw new Error(`Duplicate report key "${report.key}" in REPORT_DEFINITIONS.`);
    }
    seen.add(report.key);
  }
}
