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
