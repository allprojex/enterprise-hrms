import { Router } from "express";
import { CopyRoleTemplateBody, GrantRolePermissionBody } from "@workspace/api-zod";
import { db, permissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireDelegationAuthority, type DelegationRequest } from "../middlewares/requireDelegationAuthority";
import {
  resolveDelegationAuthority,
  roleDelegationVerdict,
  permissionGrantVerdict,
  loadAssignableRole,
} from "../lib/roleDelegation";
import { isUniqueViolation } from "../lib/dbErrors";
import {
  listOrganizationRoles,
  copyRoleTemplate,
  grantPermissionToOrgRole,
  revokePermissionFromOrgRole,
  RoleTemplateNotFoundError,
  OrgRoleNotFoundError,
  ProtectedSystemRoleError,
  PermissionNotFoundError,
} from "../lib/roleTemplates";

const router = Router();

function formatRole(role: {
  id: number;
  key: string;
  organizationId: number | null;
  label: string;
  description: string | null;
  isSystemRole: boolean;
  permissionKeys?: string[];
  delegable?: boolean;
}) {
  return {
    id: role.id,
    key: role.key,
    organizationId: role.organizationId,
    label: role.label,
    description: role.description,
    isSystemRole: role.isSystemRole,
    permissionKeys: role.permissionKeys ?? [],
    ...(role.delegable === undefined ? {} : { delegable: role.delegable }),
  };
}

// GET /organizations/:organizationId/roles
// `delegable` is the server's own answer to "may the caller assign this role
// here?" (ownership / template / subset / prohibited-key rules). The UI uses
// it to hide non-delegable roles; the write routes re-check regardless.
//
// WWM Employee Access Remediation (2026-09-07): gated on membership.read,
// not organization.read. The role catalogue (every role's full permission
// key list) is membership-administration metadata consumed only by the
// Admin console's member/invite/HR-team screens; organization.read is held
// by every employee and ESS never needs the catalogue. org_admin,
// hr_manager and hr_administrator all hold membership.read, so no
// legitimate role-management path changes.
router.get(
  "/organizations/:organizationId/roles",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("membership.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const roles = await listOrganizationRoles(req.membership!.organizationId);
    const authority = await resolveDelegationAuthority(req, "membership.manage");
    res.json(
      roles.map((role) =>
        formatRole({
          ...role,
          delegable: authority
            ? roleDelegationVerdict(authority, {
                key: role.key,
                isSystemRole: role.isSystemRole,
                permissionKeys: role.permissionKeys ?? [],
              }).ok
            : false,
        }),
      ),
    );
  },
);

// POST /organizations/:organizationId/roles
router.post(
  "/organizations/:organizationId/roles",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("role.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const parsed = CopyRoleTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.delegation!.organizationId;

    // The template must be a system template (never another tenant's role,
    // never the super_admin template) and, on the HR-team path, entirely
    // inside the actor's own boundary -- a copy is only ever a subset.
    const template = await loadAssignableRole(organizationId, parsed.data.templateRoleId);
    if (!template || !template.isSystemRole) {
      res.status(404).json({ error: "Role template not found" });
      return;
    }
    const verdict = roleDelegationVerdict(req.delegation!, template);
    if (!verdict.ok) {
      res.status(403).json({ error: verdict.reason });
      return;
    }

    try {
      const role = await copyRoleTemplate({
        organizationId,
        templateRoleId: template.id,
        key: parsed.data.key,
        label: parsed.data.label,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
      });
      res.status(201).json(formatRole(role));
    } catch (err) {
      if (err instanceof RoleTemplateNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "A role with this key already exists in the organization" });
        return;
      }
      throw err;
    }
  },
);

// POST /organizations/:organizationId/roles/:roleId/permissions
router.post(
  "/organizations/:organizationId/roles/:roleId/permissions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("role.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const roleIdRaw = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const roleId = parseInt(roleIdRaw, 10);
    if (isNaN(roleId)) {
      res.status(400).json({ error: "Invalid role ID" });
      return;
    }

    const parsed = GrantRolePermissionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.delegation!.organizationId;

    // Grant rule: nobody may put a permission on a role that they could not
    // themselves delegate (closes the role.manage self-escalation path).
    const [permission] = await db
      .select({ key: permissionsTable.key })
      .from(permissionsTable)
      .where(eq(permissionsTable.id, parsed.data.permissionId))
      .limit(1);
    // An unknown permission id is left to grantPermissionToOrgRole, which
    // reports it (or a protected target role) with the established statuses.
    if (permission) {
      const grant = permissionGrantVerdict(req.delegation!, permission.key);
      if (!grant.ok) {
        res.status(403).json({ error: grant.reason });
        return;
      }
    }
    // Target role must be one the actor could delegate (HR team cannot touch
    // a role that already reaches outside its boundary, e.g. an admin copy).
    const target = await loadAssignableRole(organizationId, roleId);
    if (target) {
      const verdict = roleDelegationVerdict(req.delegation!, target);
      if (!verdict.ok) {
        res.status(403).json({ error: verdict.reason });
        return;
      }
    }

    try {
      await grantPermissionToOrgRole({
        organizationId,
        roleId,
        permissionId: parsed.data.permissionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
      });
      res.status(204).send();
    } catch (err) {
      if (err instanceof OrgRoleNotFoundError || err instanceof PermissionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof ProtectedSystemRoleError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/roles/:roleId/permissions/:permissionId
router.delete(
  "/organizations/:organizationId/roles/:roleId/permissions/:permissionId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireDelegationAuthority("role.manage"),
  async (req: DelegationRequest, res): Promise<void> => {
    const roleIdRaw = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const roleId = parseInt(roleIdRaw, 10);
    const permissionIdRaw = Array.isArray(req.params.permissionId) ? req.params.permissionId[0] : req.params.permissionId;
    const permissionId = parseInt(permissionIdRaw, 10);
    if (isNaN(roleId) || isNaN(permissionId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const organizationId = req.delegation!.organizationId;

    const target = await loadAssignableRole(organizationId, roleId);
    if (target) {
      const verdict = roleDelegationVerdict(req.delegation!, target);
      if (!verdict.ok) {
        res.status(403).json({ error: verdict.reason });
        return;
      }
    }

    try {
      await revokePermissionFromOrgRole({
        organizationId,
        roleId,
        permissionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
      });
      res.status(204).send();
    } catch (err) {
      if (err instanceof OrgRoleNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof ProtectedSystemRoleError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
