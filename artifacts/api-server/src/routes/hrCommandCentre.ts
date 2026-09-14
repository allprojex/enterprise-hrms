import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { resolveHrCommandCentre } from "../lib/hrCommandCentre";

/**
 * HR Dashboard Command Centre — GET only, no mutation.
 *
 * NO PERMISSION IS MINTED (same precedent as the Action Centre, §31.12): each
 * section enforces its own module's permission inside the service, so a
 * member with no eligible source receives an empty response, not a 403 that
 * would reveal which modules exist.
 *
 * THE ORGANIZATION IS NEVER TAKEN FROM THE CLIENT. requireMembership proves
 * the caller is an active member of `:organizationId`, and every query is
 * scoped to `req.membership.organizationId`. A break-glass grant has no
 * membership and no personal workload, so it is refused rather than guessed.
 */
const router = Router();

router.get(
  "/organizations/:organizationId/dashboard/command-centre",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    if (!req.membership) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json(
      await resolveHrCommandCentre({
        organizationId: req.membership.organizationId,
        applicationUserId: req.userId!,
        membershipId: req.membership.id,
      }),
    );
  },
);

export default router;
