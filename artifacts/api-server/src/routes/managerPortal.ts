/**
 * Manager Portal (Phase 3G). Frozen plan:
 * docs/PHASE_3G_MANAGER_PORTAL_IMPLEMENTATION_PLAN.md.
 *
 * All three routes below share the same chain: requireAuth ->
 * requireMembership -> requireModuleEnabled("manager_portal") -> caller
 * identity/authority resolved inside the lib layer. Deliberately NO
 * requirePermission call on any of them — the frozen plan mandates zero new
 * permissions (§13/§37); there is no `manager_portal.read`/
 * `manager.read.team` key to require, mirroring GET /me/employee's own
 * zero-permission precedent (module gate + server-derived identity only).
 * Every underlying module's own existing permission is still enforced
 * inside managerPortalDashboard.ts/managerPortalPendingActions.ts (a tile/
 * item is silently omitted, never a 403 for the whole request). Read-only,
 * audit-silent throughout (frozen plan §35). No client-supplied
 * employeeId/organizationId is ever trusted as authority — both are always
 * server-resolved (req.userId from the session, organizationId from
 * req.membership, set by requireMembership).
 *
 * GET .../manager-portal/team (W109, frozen plan §27).
 * GET .../manager-portal/dashboard (W110, frozen plan §28/Decision 9).
 * GET .../manager-portal/pending-actions (W110, frozen plan §29/Decision 8).
 */
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { MANAGER_PORTAL_MODULE_KEY } from "../lib/managerPortalAuthorization";
import { resolveTeamOverview } from "../lib/managerPortal";
import { resolveManagerPortalDashboard } from "../lib/managerPortalDashboard";
import { resolveManagerPortalPendingActions } from "../lib/managerPortalPendingActions";
import { resolveManagerPortalRecruitmentParticipation } from "../lib/managerPortalRecruitmentParticipation";

const router: IRouter = Router();

router.get(
  "/organizations/:organizationId/manager-portal/team",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(MANAGER_PORTAL_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const overview = await resolveTeamOverview(organizationId, req.userId!);
    res.json(overview);
  },
);

router.get(
  "/organizations/:organizationId/manager-portal/dashboard",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(MANAGER_PORTAL_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const dashboard = await resolveManagerPortalDashboard(organizationId, req.userId!, req.membership!.id);
    res.json(dashboard);
  },
);

router.get(
  "/organizations/:organizationId/manager-portal/pending-actions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(MANAGER_PORTAL_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    // WS-15 P2 (§31.28) — Recruitment participation is returned as a SIBLING
    // field rather than merged into `items`. The shipped item shape requires an
    // employee id and name, and Recruitment participation has no employee
    // subject at all: an interview panel seat is about a candidate, not a direct
    // report. Merging would have meant either a breaking change to a live
    // contract or placeholder employee values, and a placeholder is a lie the
    // frontend would render. Additive keeps the P1 surface byte-identical.
    const [pendingActions, recruitmentParticipation] = await Promise.all([
      resolveManagerPortalPendingActions(organizationId, req.userId!, req.membership!.id),
      resolveManagerPortalRecruitmentParticipation(organizationId, req.userId!, req.membership!.id),
    ]);
    res.json({ ...pendingActions, recruitmentParticipation: recruitmentParticipation.items });
  },
);

export default router;
