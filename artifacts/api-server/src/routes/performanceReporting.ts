/**
 * Performance Dashboard & Reporting (Phase 3C, W81):
 * docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §20/§21/§27 — a
 * dedicated, visibility-scoped route (not the generic
 * GET .../reports/:reportKey/run), mirroring recruitmentReporting.ts and
 * attendanceReporting.ts exactly, for the identical reason: the generic
 * runner takes only an organizationId, and cannot express Performance's
 * own/reviewer-of-record/organization-wide visibility tiers. See
 * lib/performanceReporting.ts for the full scope/aggregation logic. Both
 * routes are gated performance.reports.read only — §27's own literal
 * permission for each — with scope (own/reviewer vs. org-wide) resolved in
 * the service layer via performance.manage, never a second permission key.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { PERFORMANCE_MODULE_KEY } from "../lib/performanceAuthorization";
import { getReportDefinition, toCsv } from "../lib/reporting";
import {
  resolvePerformanceReportScope,
  buildPerformanceReportContext,
  getPerformanceDashboard,
  runPerformanceReport,
  isKnownPerformanceReportKey,
  PerformanceReportNotFoundError,
} from "../lib/performanceReporting";

const router = Router();

function optionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

// toCsv (formula-injection-safe) is now the shared lib/reporting.ts primitive
// (WS-1) — this file's own local, unhardened copy was removed.

// GET /organizations/:organizationId/performance/dashboard?cycleId=
router.get(
  "/organizations/:organizationId/performance/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const scope = await resolvePerformanceReportScope({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const cycleId = optionalId(req.query.cycleId);
    const dashboard = await getPerformanceDashboard(organizationId, scope, cycleId);
    res.json(dashboard);
  },
);

// GET /organizations/:organizationId/performance/reports/:reportKey?cycleId=&status=&departmentId=&positionId=&reviewerId=&employeeId=&format=
router.get(
  "/organizations/:organizationId/performance/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(PERFORMANCE_MODULE_KEY),
  requirePermission("performance.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    // Reuses the shared reports registry (ADR-016/W17) for metadata only,
    // guarded to this route's own "performance" category — mirrors
    // attendanceReporting.ts's identical guard: a performance key can never
    // be executed through the generic, non-scope-aware
    // GET .../reports/:reportKey/run (that route's RUNNERS map has no
    // entries for these keys and safely 404s instead).
    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "performance" || !isKnownPerformanceReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown performance report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const scope = await resolvePerformanceReportScope({
        organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });

      const filters = {
        cycleId: optionalId(req.query.cycleId),
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        departmentId: optionalId(req.query.departmentId),
        positionId: optionalId(req.query.positionId),
        reviewerId: optionalId(req.query.reviewerId),
        employeeId: optionalId(req.query.employeeId),
      };

      const ctx = await buildPerformanceReportContext(organizationId, scope, filters);
      const result = await runPerformanceReport({ key: definition.key, label: definition.label, description: definition.description, ctx });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof PerformanceReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
