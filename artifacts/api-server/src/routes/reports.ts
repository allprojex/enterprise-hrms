import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { hasPermission } from "../lib/permissions";
import {
  listReports,
  getReportDefinition,
  runReport,
  toCsv,
  ReportNotFoundError,
  ReportParameterError,
  type ReportParams,
} from "../lib/reporting";
import { REPORT_DEFINITIONS } from "@workspace/db/seed/report-definitions";

const router = Router();

const REQUIRED_PERMISSION_BY_REPORT_KEY = new Map(REPORT_DEFINITIONS.map((r) => [r.key, r.requiredPermissionKey]));

/**
 * The permission a report run requires, from the code registry
 * (lib/db/src/seed/report-definitions.ts). The `reports` table carries a copy
 * of this key, but seed-reports only ever INSERTs (onConflictDoNothing), so a
 * key tightened in code never reaches an already-seeded database — trusting
 * the row would silently keep the old, broader gate. Null for a report the
 * registry does not define, which the caller must refuse.
 */
export function resolveRequiredReportPermissionKey(reportKey: string): string | null {
  return REQUIRED_PERMISSION_BY_REPORT_KEY.get(reportKey) ?? null;
}

/**
 * WS-15 P3 (§31.30) — explicit, typed report parameters.
 *
 * Every supported parameter is named and coerced individually. Nothing is
 * spread from the query string into a module's filter object, so an invented
 * or unsupported parameter cannot reach a query builder — an unknown key is
 * simply never read. A malformed number is dropped rather than becoming NaN.
 */
function readReportParams(query: Record<string, unknown>): ReportParams {
  const str = (key: string): string | undefined => {
    const value = query[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const num = (key: string): number | undefined => {
    const raw = str(key);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };

  return {
    from: str("from"),
    to: str("to"),
    runId: num("runId"),
    employeeId: num("employeeId"),
    departmentId: num("departmentId"),
    branchId: num("branchId"),
    positionId: num("positionId"),
    cycleId: num("cycleId"),
    reviewerId: num("reviewerId"),
    courseId: num("courseId"),
    managerId: num("managerId"),
    approvalStatus: str("approvalStatus"),
    itemId: num("itemId"),
    storeId: num("storeId"),
    movementType: str("movementType"),
    assetId: num("assetId"),
    categoryCode: str("categoryCode"),
    maintenanceStatus: str("maintenanceStatus"),
    status: str("status"),
  };
}

function formatReport(report: Awaited<ReturnType<typeof listReports>>[number]) {
  return {
    key: report.key,
    label: report.label,
    description: report.description,
    category: report.category,
  };
}

// GET /reports
// The report registry (reference data, not org-scoped) — any authenticated
// user can list it, matching the modules/master-data catalog pattern.
router.get("/reports", requireAuth as any, async (_req, res): Promise<void> => {
  const reports = await listReports();
  res.json(reports.map(formatReport));
});

// GET /organizations/:organizationId/reports/:reportKey/run
router.get(
  "/organizations/:organizationId/reports/:reportKey/run",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    const definition = await getReportDefinition(reportKey);
    if (!definition) {
      res.status(404).json({ error: `Unknown report "${reportKey}"` });
      return;
    }

    // The required key comes from the code registry, never the row's stored
    // copy: seed-reports is insert-only, so a database seeded before a key was
    // tightened keeps the old, broader key. A report the registry does not
    // know is refused rather than trusted from its row (fail closed).
    const requiredPermissionKey = resolveRequiredReportPermissionKey(definition.key);
    const allowed = requiredPermissionKey !== null && (await hasPermission(req.membership!.id, requiredPermissionKey));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      // The actor is passed so a consolidated report can resolve its own
      // module's scope (§31.30). The definition's permission was already
      // enforced above; scope narrows what that permission may see.
      const result = await runReport(
        reportKey,
        req.membership!.organizationId,
        { applicationUserId: req.userId!, membershipId: req.membership!.id },
        readReportParams(req.query as Record<string, unknown>),
      );

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      // A required parameter is a client error, and must not be confused with
      // an unknown report (404) or an empty result (200 with zero rows).
      if (err instanceof ReportParameterError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof ReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
