/**
 * Manager Portal (Phase 3G, W109 — Foundation & Team Overview). Frozen plan:
 * docs/PHASE_3G_MANAGER_PORTAL_IMPLEMENTATION_PLAN.md.
 *
 * GET /organizations/:organizationId/manager-portal/team (frozen plan §27):
 * requireAuth -> requireMembership -> requireModuleEnabled("manager_portal")
 * -> live direct-report resolution. Deliberately NO requirePermission call —
 * the frozen plan mandates zero new permissions (§13/§37); there is no
 * `manager_portal.read`/`manager.read.team` key to require, mirroring
 * GET /me/employee's own zero-permission precedent (module gate +
 * server-derived identity only). Read-only, audit-silent (frozen plan §35).
 * No client-supplied employeeId/organizationId is ever trusted as authority
 * — both are always server-resolved (req.userId from the session,
 * organizationId from req.membership, set by requireMembership).
 */
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { MANAGER_PORTAL_MODULE_KEY } from "../lib/managerPortalAuthorization";
import { resolveTeamOverview } from "../lib/managerPortal";

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

export default router;
