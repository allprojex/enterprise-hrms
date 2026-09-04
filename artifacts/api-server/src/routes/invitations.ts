import { Router } from "express";
import { CreateInvitationBody, AcceptInvitationBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership } from "../middlewares/requireMembership";
import { requireDelegationAuthority, type DelegationRequest } from "../middlewares/requireDelegationAuthority";
import { loadAssignableRole, roleDelegationVerdict } from "../lib/roleDelegation";
import {
  inviteMember,
  getInvitationByToken,
  acceptInvitation,
  AlreadyMemberError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationNotPendingError,
  type Membership,
} from "../lib/membership";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function formatMembership(membership: Membership) {
  return {
    membershipId: membership.id,
    applicationUserId: membership.applicationUserId,
    organizationId: membership.organizationId,
    status: membership.status,
  };
}

// POST /organizations/:organizationId/invitations
// Administrative User Management (W10): invite someone who does not yet
// have a login. Returns the raw accept token/link to the inviting admin --
// no email is sent (ADR-017's "never fake email delivery" applies here too).
router.post(
  "/organizations/:organizationId/invitations",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("membership.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const parsed = CreateInvitationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.delegation!.organizationId;

    // The initial role goes through the same ownership / template / subset /
    // prohibited-key guards as a direct assignment (lib/roleDelegation.ts).
    let roleKey: string | null = null;
    if (parsed.data.roleId != null) {
      const role = await loadAssignableRole(organizationId, parsed.data.roleId);
      if (!role) {
        res.status(404).json({ error: "Role not found" });
        return;
      }
      const verdict = roleDelegationVerdict(req.delegation!, role);
      if (!verdict.ok) {
        res.status(403).json({ error: verdict.reason });
        return;
      }
      roleKey = role.key;
    }

    try {
      const { membership, token } = await inviteMember({
        organizationId,
        email: parsed.data.email,
        roleId: parsed.data.roleId,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
        organizationId,
        eventType: "membership.invited",
        targetType: "organization_membership",
        targetId: String(membership.id),
        afterState: formatMembership(membership),
        metadata: { roleKey, delegationMode: req.delegation!.mode },
      });

      res.status(201).json({ ...formatMembership(membership), inviteToken: token });
    } catch (err) {
      if (err instanceof AlreadyMemberError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /invitations/:token
// Public (no auth) -- lets the accept page show who's inviting the visitor
// before they commit to setting a password.
router.get("/invitations/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    res.status(404).json({ error: "Invalid invitation link" });
    return;
  }

  const expired = !!invitation.membership.inviteTokenExpiresAt && invitation.membership.inviteTokenExpiresAt < new Date();
  const status = invitation.membership.status !== "invited" ? "accepted" : expired ? "expired" : "pending";

  res.json({
    organizationName: invitation.organizationName,
    email: invitation.user.email,
    status,
  });
});

// POST /invitations/:token/accept
// Public (no auth) -- sets the invitee's real name and password, activates
// the membership. Does not log the user in; they log in separately
// afterward (First Login, ADR-014).
router.post("/invitations/:token/accept", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  const parsed = AcceptInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const { membership, user } = await acceptInvitation({ token, ...parsed.data });

    await recordAuditEvent({
      actorApplicationUserId: user.id,
      actorMembershipId: membership.id,
      organizationId: membership.organizationId,
      eventType: "membership.invitation_accepted",
      targetType: "organization_membership",
      targetId: String(membership.id),
      afterState: formatMembership(membership),
    });

    res.json({ message: "Invitation accepted. You can now log in." });
  } catch (err) {
    if (err instanceof InvitationNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof InvitationExpiredError) {
      res.status(410).json({ error: err.message });
      return;
    }
    if (err instanceof InvitationNotPendingError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
