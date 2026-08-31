/**
 * Payroll, Workstream 5 (frozen plan §12/§13 — Workstream 7 "Statutory
 * Schedules & Reports"). A dedicated, scope-aware route (not the generic
 * GET .../reports/:reportKey/run — that route's RUNNERS map has no entries
 * for payroll_* keys, so it safely 404s "Unknown report" for any of them),
 WS-15 P3 (§31.30) UPDATE: this key IS now also executable through the
 generic GET .../reports/:reportKey/run. That path delegates to this
 module's own reporting service and resolves this module's own scope
 resolver first, so it is no longer non-scope-aware and enforces the
 same permission. This route is unchanged and remains authoritative for
 its own contract; the two paths converge on the same source logic.
 * mirroring assetReporting.ts/personnelReporting.ts exactly. Every report
 * requires the run to be "locked" — a draft/calculated/approved run never
 * masquerades as a final payroll output.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { toCsv } from "../lib/reporting";
import {
  runPayrollReport,
  isKnownPayrollReportKey,
  PayrollRunNotFoundError,
  PayrollRunNotLockedError,
  PayrollReportNotFoundError,
} from "../lib/payrollReporting";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// toCsv (formula-injection-safe) is now the shared lib/reporting.ts primitive
// (WS-1) — this file's own local, unhardened copy was removed.

// GET /organizations/:organizationId/payroll/runs/:runId/reports/:reportKey?format=
router.get(
  "/organizations/:organizationId/payroll/runs/:runId/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled("payroll"),
  requirePermission("payroll.report.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const runId = parseId(req.params.runId);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;
    if (!isKnownPayrollReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown payroll report "${reportKey}"` });
      return;
    }
    const organizationId = req.membership!.organizationId;

    try {
      // Narrower than payroll.report.read (mirroring W2's own
      // banking/statutory-identifier permission separation) — SSNIT
      // numbers only ever appear on the pension schedule for an actor who
      // additionally holds this permission; every such inclusion is
      // audited as a sensitive read (Decision 9).
      const includeStatutoryIdentifiers = reportKey === "payroll_pension_schedule" && (await hasPermission(req.membership!.id, "payroll.statutory_identifiers.read"));

      const result = await runPayrollReport(organizationId, runId, reportKey, includeStatutoryIdentifiers);

      if (includeStatutoryIdentifiers) {
        await recordAuditEvent({
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
          organizationId,
          eventType: "payroll_statutory_identifiers.read",
          targetType: "payroll_run",
          targetId: String(runId),
          metadata: { reportKey },
        });
      }

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}-run-${runId}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof PayrollRunNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollRunNotLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof PayrollReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
