import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { hasPermission } from "../lib/permissions";
import { listReports, getReportDefinition, runReport, toCsv, ReportNotFoundError } from "../lib/reporting";

const router = Router();

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

    const allowed = await hasPermission(req.membership!.id, definition.requiredPermissionKey);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const result = await runReport(reportKey, req.membership!.organizationId);

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof ReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
