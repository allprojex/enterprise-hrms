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
  // Phase 3C, W81 — Performance Dashboard & Reporting (§20/§21 of the
  // frozen plan). Registered here for catalog discoverability via the
  // existing GET /reports (ADR-016), but — like the recruitment_*/
  // attendance_* keys above — NOT executed through the generic
  // GET .../reports/:reportKey/run route (lib/reporting.ts's RUNNERS map
  // has no entries for these keys, so that route safely 404s "Unknown
  // report" for any of them). Performance reports need the own/reviewer-
  // of-record/organization-wide visibility tiers the generic runner cannot
  // express — execution is a dedicated, scope-aware route instead
  // (GET .../performance/reports/:reportKey,
  // artifacts/api-server/src/routes/performanceReporting.ts), reusing the
  // same {columns, rows}/CSV export shape and requiredPermissionKey
  // convention this registry already established. A 4th frozen key,
  // performance_rating_distribution, is deliberately NOT registered here —
  // the frozen plan names no actual score-band/bin definition for it, and
  // none was invented (see performanceReporting.ts's own file header).
  {
    key: "performance_review_status",
    label: "Review Status",
    description: "Every in-scope Performance review's current lifecycle status, reviewer, and historical department/position snapshot.",
    category: "performance",
    requiredPermissionKey: "performance.reports.read",
  },
  {
    key: "performance_scores",
    label: "Performance Scores",
    description: "Manager score, HR override, and effective score for every in-scope Performance review.",
    category: "performance",
    requiredPermissionKey: "performance.reports.read",
  },
  {
    key: "performance_goal_results",
    label: "Goal Results",
    description: "Every accepted, official goal across in-scope Performance reviews, with its measured result and computed score.",
    category: "performance",
    requiredPermissionKey: "performance.reports.read",
  },
  // Phase 3D, W92 — Learning Dashboard & Reporting (§16/§17 of the frozen
  // plan). Registered here for catalog discoverability via the existing
  // GET /reports (ADR-016), but — like every dedicated-route module above —
  // NOT executed through the generic GET .../reports/:reportKey/run route
  // (lib/reporting.ts's RUNNERS map has no entries for these keys, so that
  // route safely 404s "Unknown report" for any of them). Learning reports
  // need the own/manager-of-record/organization-wide visibility tiers the
  // generic runner cannot express — execution is a dedicated, scope-aware
  // route instead (GET .../learning/reports/:reportKey,
  // artifacts/api-server/src/routes/learningReporting.ts), reusing the same
  // {columns, rows}/CSV export shape and requiredPermissionKey convention
  // this registry already established.
  {
    key: "learning_enrollment_status",
    label: "Enrollment Status",
    description: "Every in-scope Learning enrollment's status, approval state, dates, and mandatory flag, with historical snapshot dimensions.",
    category: "learning",
    requiredPermissionKey: "learning.reports.read",
  },
  {
    key: "learning_completion_summary",
    label: "Completion Summary",
    description: "Completions and failures per course, with assigned/in-progress/failed/cancelled counts and a completion percentage.",
    category: "learning",
    requiredPermissionKey: "learning.reports.read",
  },
  {
    key: "learning_certificate_expiry",
    label: "Certificate Expiry",
    description: "Issued Learning certificates with issue/expiry dates and computed active/expired/revoked state.",
    category: "learning",
    requiredPermissionKey: "learning.reports.read",
  },
  // Phase 3E, W102 — Asset Dashboard & Reporting (§17/§20 of the frozen
  // plan; the frozen plan's own §24 numbers this W102, not W101 — W101 is
  // "Internal Asset Workspace," a separate, still-unbuilt frontend-only
  // workstream). Registered here for catalog discoverability via the
  // existing GET /reports (ADR-016), but — like every dedicated-route
  // module above — NOT executed through the generic
  // GET .../reports/:reportKey/run route (lib/reporting.ts's RUNNERS map
  // has no entries for these keys, so that route safely 404s "Unknown
  // report" for any of them). asset_unreturned_by_employee needs the own/
  // manager-of-record-CURRENT-only/organization-wide visibility tiers the
  // generic runner cannot express (and Assets' own manager tier is LIVE,
  // never a snapshot, per Owner Decision 3 — unlike Performance's/
  // Learning's own snapshot-based reviewer/manager-of-record model);
  // asset_register and asset_maintenance_history are organization-wide
  // only, per §17's own literal Scope column. Execution is a dedicated,
  // scope-aware route instead (GET .../assets/reports/:reportKey,
  // artifacts/api-server/src/routes/assetReporting.ts), reusing the same
  // {columns, rows}/CSV export shape and requiredPermissionKey convention
  // this registry already established. No 4th report (incidents) — §17's
  // own explicit "the incident queue is better served as a live
  // operational list inside the internal workspace than a historical
  // report" reasoning, not an oversight.
  {
    key: "asset_register",
    label: "Asset Register",
    description: "Every in-scope asset's current status, condition, location, and current holder.",
    category: "asset_management",
    requiredPermissionKey: "asset_management.reports.read",
  },
  {
    key: "asset_unreturned_by_employee",
    label: "Unreturned Assets by Employee",
    description: "Outstanding (currently-assigned) assets, one row per active custody record. Informational only — never a hard offboarding block (§10).",
    category: "asset_management",
    requiredPermissionKey: "asset_management.reports.read",
  },
  {
    key: "asset_maintenance_history",
    label: "Maintenance History",
    description: "Maintenance events over a date range, including completed events for assets whose current status or custody has since changed.",
    category: "asset_management",
    requiredPermissionKey: "asset_management.reports.read",
  },
  // Phase 3H, W119 — Reporting & Legacy Import (frozen plan Decision 18).
  // Registered here for catalog discoverability via the existing GET
  // /reports (ADR-016), but — like every dedicated-route module above — NOT
  // executed through the generic GET .../reports/:reportKey/run route
  // (lib/reporting.ts's RUNNERS map has no entries for these keys, so that
  // route safely 404s "Unknown report" for any of them). Execution is a
  // dedicated route instead (GET .../personnel-records/reports/:reportKey,
  // artifacts/api-server/src/routes/personnelReporting.ts), gated
  // personnel_file.read — the frozen plan's own §13 permission for viewing
  // a personnel record's PIF number/physical location/movement history,
  // reused here rather than minting a 7th permission, since every one of
  // these five reports is exactly that kind of read. Never gated by the
  // broad employee.read, per the frozen plan's own least-privilege
  // instruction (Decision 20/§13). Report keys are this session's own
  // faithful snake_case rendering of Decision 18's five literal descriptive
  // names — no machine key was frozen verbatim.
  {
    key: "personnel_current_staff_number_allocations",
    label: "Current Staff-Number Allocations",
    description: "Every currently-open staff-number allocation (CURRENT — resolved from employee_number_allocations where still open, never a live employees.employeeNumber join).",
    category: "personnel_records",
    requiredPermissionKey: "personnel_file.read",
  },
  {
    key: "personnel_historical_staff_number_allocations",
    label: "Historical Staff-Number Allocations",
    description: "Every staff-number allocation ever recorded, current and historical alike (HISTORICAL — a reused number always appears as separate, clearly labeled rows, never collapsed to its current holder).",
    category: "personnel_records",
    requiredPermissionKey: "personnel_file.read",
  },
  {
    key: "personnel_files_by_location",
    label: "Personnel Files by Physical Location",
    description: "Every personnel file (and volume, where in use) and its current physical location (CURRENT — reflects personnel_files'/personnel_file_volumes' own current-location cache, never derived from movement history).",
    category: "personnel_records",
    requiredPermissionKey: "personnel_file.read",
  },
  {
    key: "personnel_checked_out_overdue_files",
    label: "Checked-Out / Overdue Personnel Files",
    description: "Every personnel file or volume not currently in the registry (checked out or missing), with overdue always computed live against the current unresolved checkout's own expected return date — never a stored status.",
    category: "personnel_records",
    requiredPermissionKey: "personnel_file.read",
  },
  {
    key: "personnel_separated_unreleased_numbers",
    label: "Separated Employees with Unreleased Staff Numbers",
    description: "Terminated employees who still hold an open staff-number allocation. Informational only — never blocks separation, never auto-releases a number.",
    category: "personnel_records",
    requiredPermissionKey: "personnel_file.read",
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
