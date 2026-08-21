/**
 * Learning Dashboard & Reporting (Phase 3D, W92):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §16/§17 — a dedicated,
 * visibility-scoped route (not the generic GET .../reports/:reportKey/run),
 * mirroring performanceReporting.ts/attendanceReporting.ts exactly, for the
 * identical reason: the generic runner takes only an organizationId and
 * cannot express Learning's own/manager-of-record/organization-wide
 * visibility tiers. See lib/learningReporting.ts for the full scope/
 * aggregation logic. Both routes are gated learning.reports.read only —
 * §17's own literal permission — with scope (own/manager-of-record vs.
 * org-wide) resolved in the service layer via learning.manage, never a
 * second permission key. No instructor reporting tier (Owner Decision 6).
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { LEARNING_MODULE_KEY } from "../lib/learningAuthorization";
import { getReportDefinition } from "../lib/reporting";
import {
  resolveLearningReportScope,
  buildLearningReportContext,
  getLearningDashboard,
  runLearningReport,
  isKnownLearningReportKey,
  LearningReportNotFoundError,
} from "../lib/learningReporting";

const router = Router();

function optionalId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value === "") return undefined;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Mirrors performanceReporting.ts's own local toCsv exactly — same
 * established convention, including the same known, pre-existing gap: no
 * spreadsheet-formula-injection escaping (a leading =/+/-/@ is passed
 * through unescaped). Shared with every other reporting surface on this
 * platform, not introduced or redesigned here — flagged, not fixed, in the
 * W92 completion report.
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

// GET /organizations/:organizationId/learning/dashboard
router.get(
  "/organizations/:organizationId/learning/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const scope = await resolveLearningReportScope({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const dashboard = await getLearningDashboard(organizationId, scope);
    res.json(dashboard);
  },
);

// GET /organizations/:organizationId/learning/reports/:reportKey?courseId=&status=&approvalStatus=&departmentId=&positionId=&managerId=&employeeId=&format=
router.get(
  "/organizations/:organizationId/learning/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    // Reuses the shared reports registry (ADR-016/W17) for metadata only,
    // guarded to this route's own "learning" category — mirrors
    // performanceReporting.ts's/attendanceReporting.ts's identical guard: a
    // learning key can never be executed through the generic, non-scope-
    // aware GET .../reports/:reportKey/run route (that route's RUNNERS map
    // has no entries for these keys, so it safely 404s instead).
    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "learning" || !isKnownLearningReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown learning report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const scope = await resolveLearningReportScope({
        organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership!.id,
      });

      const filters = {
        courseId: optionalId(req.query.courseId),
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        approvalStatus: typeof req.query.approvalStatus === "string" ? req.query.approvalStatus : undefined,
        departmentId: optionalId(req.query.departmentId),
        positionId: optionalId(req.query.positionId),
        managerId: optionalId(req.query.managerId),
        employeeId: optionalId(req.query.employeeId),
      };

      const ctx = await buildLearningReportContext(organizationId, scope, filters);
      const result = await runLearningReport({
        key: definition.key,
        label: definition.label,
        description: definition.description,
        organizationId,
        scope,
        ctx,
        certificateFilters: { employeeId: filters.employeeId, status: filters.status },
      });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof LearningReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
