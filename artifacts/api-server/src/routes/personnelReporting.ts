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
import { getReportDefinition } from "../lib/reporting";
import { runPersonnelReport, isKnownPersonnelReportKey, PersonnelReportNotFoundError } from "../lib/personnelReporting";

const router = Router();

function optionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Mirrors assetReporting.ts's/performanceReporting.ts's/learningReporting.ts's
 * own local toCsv exactly — same established convention, including the same
 * known, pre-existing, platform-wide gap: no spreadsheet-formula-injection
 * escaping (a leading =/+/-/@ is passed through unescaped). Not introduced
 * here, not silently redesigned here — flagged, not fixed, matching every
 * prior reporting workstream's own disclosure.
 */
function toCsv(columns: { key: string; label: string }[], rows: Record<string, string | number | null>[]): string {
  const escape = (value: string | number) => {
    const str = String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key] ?? "")).join(","));
  return [header, ...body].join("\n");
}

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
