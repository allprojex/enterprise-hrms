/**
 * Recruitment Dashboard & Reporting (Phase 3A, W61):
 * docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §23 (W61's own frozen API
 * line: `GET .../recruitment/dashboard`, `.../recruitment/reports/:reportKey`).
 * Both routes are read-only — see lib/recruitmentReporting.ts's header for
 * the full visibility/privacy/database-impact reasoning.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { RECRUITMENT_MODULE_KEY } from "../lib/recruitmentAuthorization";
import { getReportDefinition, toCsv } from "../lib/reporting";
import {
  resolveRecruitmentReportScope,
  buildRecruitmentReportContext,
  getRecruitmentDashboard,
  runRecruitmentReport,
  isKnownRecruitmentReportKey,
  RecruitmentReportNotFoundError,
} from "../lib/recruitmentReporting";

const router = Router();

// toCsv (formula-injection-safe) is now the shared lib/reporting.ts primitive
// (WS-1) — this file's own local, unhardened copy was removed.

// GET /organizations/:organizationId/recruitment/dashboard
router.get(
  "/organizations/:organizationId/recruitment/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const scope = await resolveRecruitmentReportScope({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const ctx = await buildRecruitmentReportContext(organizationId, scope);
    const dashboard = await getRecruitmentDashboard(ctx);
    res.json(dashboard);
  },
);

// GET /organizations/:organizationId/recruitment/reports/:reportKey
router.get(
  "/organizations/:organizationId/recruitment/reports/:reportKey",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(RECRUITMENT_MODULE_KEY),
  requirePermission("recruitment.reports.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const reportKey = Array.isArray(req.params.reportKey) ? req.params.reportKey[0] : req.params.reportKey;

    // Reuses the shared reports registry (ADR-016/W17) for metadata only —
    // guarded to this route's own "recruitment" category so a caller can
    // never reach an unrelated report (e.g. "headcount") through this
    // scope-aware route, and so a recruitment key can never be executed
    // through the generic, non-scope-aware GET .../reports/:reportKey/run
    // (see report-definitions.ts's own note: that route's RUNNERS map has
    // no entries for these keys and safely 404s instead).
    // WS-15 P3 (§31.30) UPDATE: this key IS now also executable through the
    // generic GET .../reports/:reportKey/run. That path delegates to this
    // module's own reporting service and resolves this module's own scope
    // resolver first, so it is no longer non-scope-aware and enforces the
    // same permission. This route is unchanged and remains authoritative for
    // its own contract; the two paths converge on the same source logic.
    const definition = await getReportDefinition(reportKey);
    if (!definition || definition.category !== "recruitment" || !isKnownRecruitmentReportKey(reportKey)) {
      res.status(404).json({ error: `Unknown recruitment report "${reportKey}"` });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const scope = await resolveRecruitmentReportScope({
      organizationId,
      applicationUserId: req.userId!,
      membershipId: req.membership!.id,
    });
    const ctx = await buildRecruitmentReportContext(organizationId, scope);

    try {
      const result = await runRecruitmentReport({ key: definition.key, label: definition.label, description: definition.description, ctx });

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${result.key}.csv"`);
        res.send(toCsv(result.columns, result.rows));
        return;
      }

      res.json(result);
    } catch (err) {
      if (err instanceof RecruitmentReportNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
