/**
 * Asset Dashboard & Reporting (Phase 3E, W102 per the frozen plan's own §24
 * numbering — see lib/assetReporting.ts's own file header for the full
 * W101-vs-W102 reconciliation): docs/PHASE_3E_ASSETS_IMPLEMENTATION_PLAN.md
 * §17/§18/§20 — a dedicated, visibility-scoped route (not the generic
 * GET .../reports/:reportKey/run), mirroring performanceReporting.ts and
 * learningReporting.ts exactly, for the identical reason: the generic
 * runner takes only an organizationId and cannot express Assets' own own/
 * manager-current-only/organization-wide visibility tiers. Both routes are
 * gated asset_management.reports.read only — §20's own literal permission
 * for each — with fine-grained scope (own/manager-current/org-wide, or
 * org-wide-only for asset_register/asset_maintenance_history) resolved
 * entirely in the service layer.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { ASSET_MANAGEMENT_MODULE_KEY } from "../lib/assetManagementAuthorization";
import { getReportDefinition } from "../lib/reporting";
import {
  resolveAssetReportScope,
  getAssetDashboard,
  runAssetReport,
  isKnownAssetReportKey,
  AssetReportNotFoundError,
  AssetReportOrgWideOnlyError,
} from "../lib/assetReporting";

const router = Router();

function optionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}
function optionalString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Mirrors performanceReporting.ts's/learningReporting.ts's own local toCsv
 * exactly — same established convention, including the same known,
 * pre-existing, platform-wide gap: no spreadsheet-formula-injection
 * escaping (a leading =/+/-/@ is passed through unescaped). Shared with
 * every other reporting surface on this platform (lib/reporting.ts's own
 * generic toCsv has the identical gap) — not introduced by Assets, and not
 * silently redesigned here. Flagged, not fixed, in the W102 completion
 * report.
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

// GET /organizations/:organizationId/assets/dashboard
router.get(
  "/organizations/:organizationId/assets/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const scope = await resolveAssetReportScope({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const dashboard = await getAssetDashboard(organizationId, scope);
    res.json(dashboard);
  },
);

// GET /organizations/:organizationId/assets/reports/:reportKey?categoryCode=&status=&branchId=&employeeId=&departmentId=&assetId=&maintenanceStatus=&dateFrom=&dateTo=&format=
router.get(
  "/organizations/:organizationId/assets/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ASSET_MANAGEMENT_MODULE_KEY),
  requirePermission("asset_management.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    // Reuses the shared reports registry (ADR-016/W17) for metadata only,
    // guarded to this route's own "asset_management" category — mirrors
    // performanceReporting.ts's/learningReporting.ts's identical guard: an
    // Assets report key can never be executed through the generic,
    // non-scope-aware GET .../reports/:reportKey/run (that route's RUNNERS
    // map has no entries for these keys and safely 404s instead).
    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "asset_management" || !isKnownAssetReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown asset report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const scope = await resolveAssetReportScope({
        organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });

      const filters = {
        categoryCode: optionalString(req.query.categoryCode),
        status: optionalString(req.query.status),
        branchId: optionalId(req.query.branchId),
        employeeId: optionalId(req.query.employeeId),
        departmentId: optionalId(req.query.departmentId),
        assetId: optionalId(req.query.assetId),
        maintenanceStatus: optionalString(req.query.status),
        dateFrom: optionalString(req.query.dateFrom),
        dateTo: optionalString(req.query.dateTo),
      };

      const result = await runAssetReport({ key: definition.key, label: definition.label, description: definition.description, organizationId, scope, filters });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof AssetReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof AssetReportOrgWideOnlyError) {
        res.status(403).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
