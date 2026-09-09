import { Router } from "express";


import { AddMemberBody, AssignMemberRoleBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireDelegationAuthority, type DelegationRequest } from "../middlewares/requireDelegationAuthority";
import {
  loadAssignableRole,
  roleDelegationVerdict,
  membershipScopeVerdict,
  effectivePermissionsOfMembership,
} from "../lib/roleDelegation";
import {
  listOrganizationMembers,
  addMemberByEmail,
  assignRoleToMembership,
  revokeRoleFromMembership,
  revokeMembership as revokeMembershipRow,
  UserNotFoundError,
  AlreadyMemberError,
  type MemberSummary,
} from "../lib/membership";
import { recordAuditEvent } from "../lib/auditLog";

const router = Router();

function formatMember(member: MemberSummary) {
  return member;
}

async function memberSummaryFor(organizationId: number, membershipId: number): Promise<MemberSummary | null> {
  const members = await listOrganizationMembers(organizationId);
  return members.find((m) => m.membershipId === membershipId) ?? null;
}

// GET /organizations/:organizationId/members
router.get(
  "/organizations/:organizationId/members",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("membership.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const members = await listOrganizationMembers(req.membership!.organizationId);
    res.json(members.map(formatMember));
  },
);

// POST /organizations/:organizationId/members
router.post(
  "/organizations/:organizationId/members",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("membership.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const parsed = AddMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.delegation!.organizationId;

    try {
      const membership = await addMemberByEmail(organizationId, parsed.data.email);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
        organizationId,
        eventType: "membership.added",
        targetType: "organization_membership",
        targetId: String(membership.id),
        afterState: membership,
        metadata: { delegationMode: req.delegation!.mode },
      });
      const summary = await memberSummaryFor(organizationId, membership.id);
      res.status(201).json(summary);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof AlreadyMemberError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/members/:membershipId
router.delete(
  "/organizations/:organizationId/members/:membershipId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("membership.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const membershipIdRaw = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
    const membershipId = parseInt(membershipIdRaw, 10);
    if (isNaN(membershipId)) {
      res.status(400).json({ error: "Invalid membership ID" });
      return;
    }

    const organizationId = req.delegation!.organizationId;
    const before = await memberSummaryFor(organizationId, membershipId);
    if (!before) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    // HR-team path: only members entirely within the actor's own HR boundary
    // (never an org_admin, never anyone holding authority the actor lacks).
    const targetKeys = (await effectivePermissionsOfMembership(organizationId, membershipId)) ?? new Set<string>();
    const scope = membershipScopeVerdict(req.delegation!, [...targetKeys]);
    if (!scope.ok) {
      res.status(403).json({ error: scope.reason });
      return;
    }
    const updated = await revokeMembershipRow(membershipId, req.userId!);
    if (!updated || updated.organizationId !== organizationId) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership?.id ?? null,
      organizationId,
      eventType: "membership.revoked",
      targetType: "organization_membership",
      targetId: String(membershipId),
      beforeState: before,
      metadata: { delegationMode: req.delegation!.mode },
    });

    const summary = await memberSummaryFor(organizationId, membershipId);
    res.json(summary);
  },
);

// POST /organizations/:organizationId/members/:membershipId/roles
router.post(
  "/organizations/:organizationId/members/:membershipId/roles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("membership.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const membershipIdRaw = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
    const membershipId = parseInt(membershipIdRaw, 10);
    if (isNaN(membershipId)) {
      res.status(400).json({ error: "Invalid membership ID" });
      return;
    }

    const parsed = AssignMemberRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.delegation!.organizationId;
    const before = await memberSummaryFor(organizationId, membershipId);
    if (!before) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    // Ownership rule: a system template or a role owned by THIS organization —
    // another tenant's role is indistinguishable from a nonexistent one.
    const role = await loadAssignableRole(organizationId, parsed.data.roleId);
    if (!role) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    // Template + subset + prohibited-key rules (lib/roleDelegation.ts).
    const verdict = roleDelegationVerdict(req.delegation!, role);
    if (!verdict.ok) {
      res.status(403).json({ error: verdict.reason });
      return;
    }
    await assignRoleToMembership(membershipId, role.id);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership?.id ?? null,
      organizationId,
      eventType: "membership.role_assigned",
      targetType: "organization_membership",
      targetId: String(membershipId),
      metadata: { roleKey: role.key, delegationMode: req.delegation!.mode },
    });

    const summary = await memberSummaryFor(organizationId, membershipId);
    res.json(summary);
  },
);

// DELETE /organizations/:organizationId/members/:membershipId/roles/:roleId
router.delete(
  "/organizations/:organizationId/members/:membershipId/roles/:roleId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("membership.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const membershipIdRaw = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
    const membershipId = parseInt(membershipIdRaw, 10);
    const roleIdRaw = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const roleId = parseInt(roleIdRaw, 10);
    if (isNaN(membershipId) || isNaN(roleId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const organizationId = req.delegation!.organizationId;
    const before = await memberSummaryFor(organizationId, membershipId);
    if (!before) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    const role = await loadAssignableRole(organizationId, roleId);
    if (!role) {
      res.status(404).json({ error: "Role not found" });
      return;
    }
    // HR-team path may only remove roles it could have delegated, and only from
    // members within its boundary — it cannot strip an org_admin. Removal is
    // explicitly "revoke": a deprecated template can no longer be assigned but
    // must still be removable, otherwise existing holders could never be
    // migrated onto the canonical HR role.
    const verdict = roleDelegationVerdict(req.delegation!, role, { intent: "revoke" });
    if (!verdict.ok) {
      res.status(403).json({ error: verdict.reason });
      return;
    }
    const targetKeys = (await effectivePermissionsOfMembership(organizationId, membershipId)) ?? new Set<string>();
    const scope = membershipScopeVerdict(req.delegation!, [...targetKeys]);
    if (!scope.ok) {
      res.status(403).json({ error: scope.reason });
      return;
    }
    await revokeRoleFromMembership(membershipId, role.id);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership?.id ?? null,
      organizationId,
      eventType: "membership.role_revoked",
      targetType: "organization_membership",
      targetId: String(membershipId),
      metadata: { roleId: role.id, roleKey: role.key, delegationMode: req.delegation!.mode },
    });

    const summary = await memberSummaryFor(organizationId, membershipId);
    res.json(summary);
  },
);

export default router;
