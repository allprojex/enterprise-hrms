/**
 * Phase 3H, W119 — Reporting & Legacy Import. A dedicated, permission-scoped
 * route (not the generic GET .../reports/:reportKey/run), mirroring
 * assetReporting.ts/performanceReporting.ts/learningReporting.ts exactly —
 * personnel_file.read is this route's own gate (never the broad
 * employee.read), matching every other personnel-records route already
 * shipped in W115/W116.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { getReportDefinition, toCsv } from "../lib/reporting";
import { runPersonnelReport, isKnownPersonnelReportKey, PersonnelReportNotFoundError } from "../lib/personnelReporting";

const router = Router();

function optionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

// toCsv (formula-injection-safe) is now the shared lib/reporting.ts primitive
// (WS-1) — this file's own local, unhardened copy was removed.

// GET /organizations/:organizationId/personnel-records/reports/:reportKey?employeeId=&format=
router.get(
  "/organizations/:organizationId/personnel-records/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    // Reuses the shared reports registry (ADR-016/W17) for metadata only,
    // guarded to this route's own "personnel_records" category — a
    // personnel report key can never be executed through the generic,
    // non-scope-aware GET .../reports/:reportKey/run (that route's RUNNERS
    // map has no entries for these keys and safely 404s instead).
    // WS-15 P3 (§31.30) UPDATE: this key IS now also executable through the
    // generic GET .../reports/:reportKey/run. That path delegates to this
    // module's own reporting service and resolves this module's own scope
    // resolver first, so it is no longer non-scope-aware and enforces the
    // same permission. This route is unchanged and remains authoritative for
    // its own contract; the two paths converge on the same source logic.
    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "personnel_records" || !isKnownPersonnelReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown personnel report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const filters = { employeeId: optionalId(req.query.employeeId) };

    try {
      const result = await runPersonnelReport({ key: definition.key, label: definition.label, description: definition.description, organizationId, filters });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof PersonnelReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
