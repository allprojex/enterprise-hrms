import { Router } from "express";
import { db, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AddMemberBody, AssignMemberRoleBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
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
  requirePermission("membership.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AddMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      const membership = await addMemberByEmail(organizationId, parsed.data.email);
      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "membership.added",
        targetType: "organization_membership",
        targetId: String(membership.id),
        afterState: membership,
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
  requirePermission("membership.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const membershipIdRaw = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
    const membershipId = parseInt(membershipIdRaw, 10);
    if (isNaN(membershipId)) {
      res.status(400).json({ error: "Invalid membership ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const before = await memberSummaryFor(organizationId, membershipId);
    if (!before) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    const updated = await revokeMembershipRow(membershipId, req.userId!);
    if (!updated || updated.organizationId !== organizationId) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId,
      eventType: "membership.revoked",
      targetType: "organization_membership",
      targetId: String(membershipId),
      beforeState: before,
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
  requirePermission("membership.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
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

    const organizationId = req.membership!.organizationId;
    const before = await memberSummaryFor(organizationId, membershipId);
    if (!before) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, parsed.data.roleId)).limit(1);
    if (!role) {
      res.status(404).json({ error: "Role not found" });
      return;
    }

    await assignRoleToMembership(membershipId, parsed.data.roleId);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId,
      eventType: "membership.role_assigned",
      targetType: "organization_membership",
      targetId: String(membershipId),
      metadata: { roleKey: role.key },
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
  requirePermission("membership.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const membershipIdRaw = Array.isArray(req.params.membershipId) ? req.params.membershipId[0] : req.params.membershipId;
    const membershipId = parseInt(membershipIdRaw, 10);
    const roleIdRaw = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const roleId = parseInt(roleIdRaw, 10);
    if (isNaN(membershipId) || isNaN(roleId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const organizationId = req.membership!.organizationId;
    const before = await memberSummaryFor(organizationId, membershipId);
    if (!before) {
      res.status(404).json({ error: "Membership not found in this organization" });
      return;
    }

    await revokeRoleFromMembership(membershipId, roleId);

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId,
      eventType: "membership.role_revoked",
      targetType: "organization_membership",
      targetId: String(membershipId),
      metadata: { roleId },
    });

    const summary = await memberSummaryFor(organizationId, membershipId);
    res.json(summary);
  },
);

export default router;
