import { Router } from "express";
import { CreateInvitationBody, AcceptInvitationBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership } from "../middlewares/requireMembership";
import { requireDelegationAuthority, type DelegationRequest } from "../middlewares/requireDelegationAuthority";
import {
  loadAssignableRole,
  roleDelegationVerdict,
  membershipScopeVerdict,
  effectivePermissionsOfMembership,
} from "../lib/roleDelegation";
import {
  inviteMember,
  findInvitationTarget,
  isReissuableInvitation,
  getInvitationByToken,
  acceptInvitation,
  AlreadyMemberError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationNotPendingError,
  InvitationRevokedError,
  type Membership,
} from "../lib/membership";
import { resolveInvitationOrigin, getPublicTenantContext } from "../lib/organizationDomains";
import { recordAuditEvent } from "../lib/auditLog";
import { logger } from "../lib/logger";

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
//
// The organization is the PATH parameter, authorized by requireMembership +
// requireDelegationAuthority against that same id -- never a session default.
// The accept link is built server-side from the organization's governed
// domain configuration (resolveInvitationOrigin), never from request headers.
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
    const email = parsed.data.email.trim().toLowerCase();

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

    // Governed re-invite: a revoked or expired-pending membership of this
    // same organization is re-issued in place. On the HR-team path the
    // former member must have been inside the actor's boundary (their old
    // roles are what is being replaced) -- an HR administrator cannot
    // re-invite a former org_admin.
    const target = await findInvitationTarget(organizationId, email);
    if (target.membership) {
      if (!isReissuableInvitation(target.membership)) {
        res.status(409).json({ error: "User already has a membership in this organization" });
        return;
      }
      const previousKeys = (await effectivePermissionsOfMembership(organizationId, target.membership.id)) ?? new Set<string>();
      const scope = membershipScopeVerdict(req.delegation!, [...previousKeys]);
      if (!scope.ok) {
        res.status(403).json({ error: scope.reason });
        return;
      }
    }

    // Fail closed BEFORE any write: no governed origin means no link, and no
    // link means no invitation.
    const origin = await resolveInvitationOrigin(organizationId);
    if (!origin) {
      logger.error({ organizationId }, "cannot issue invitation: no active domain and APP_BASE_URL is not set");
      res.status(503).json({ error: "Invitation links are not configured for this organization" });
      return;
    }

    try {
      const { membership, token, reissued, previousStatus } = await inviteMember({
        organizationId,
        email,
        roleId: parsed.data.roleId,
      });

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
        organizationId,
        eventType: reissued ? "membership.reinvited" : "membership.invited",
        targetType: "organization_membership",
        targetId: String(membership.id),
        afterState: formatMembership(membership),
        metadata: {
          roleKey,
          delegationMode: req.delegation!.mode,
          inviteUrlSource: origin.source,
          ...(reissued ? { previousStatus } : {}),
        },
      });

      res.status(201).json({
        ...formatMembership(membership),
        inviteToken: token,
        inviteUrl: `${origin.origin}/invite/${token}`,
        inviteUrlSource: origin.source,
        reinvited: reissued,
      });
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
// before they commit to setting a password. The INVITATION decides the
// organization: its public branding is returned from the invited
// organization's own configuration, regardless of which hostname the link
// was opened on (a tenant host never re-brands another tenant's invitation).
router.get("/invitations/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
  const invitation = await getInvitationByToken(token);
  if (!invitation) {
    res.status(404).json({ error: "Invalid invitation link" });
    return;
  }

  const m = invitation.membership;
  const expired = !!m.inviteTokenExpiresAt && m.inviteTokenExpiresAt < new Date();
  const status =
    m.status === "revoked" ? "revoked" : m.status !== "invited" ? "accepted" : expired ? "expired" : "pending";

  const branding = await getPublicTenantContext(m.organizationId);

  res.json({
    organizationName: invitation.organizationName,
    email: invitation.user.email,
    status,
    organization: branding
      ? {
          organizationName: branding.organizationName,
          logoUrl: branding.logoUrl,
          systemDisplayName: branding.systemDisplayName,
          theme: branding.theme,
        }
      : null,
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
    if (err instanceof InvitationRevokedError || err instanceof InvitationNotPendingError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
