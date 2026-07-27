import { Router } from "express";
import { CopyRoleTemplateBody, GrantRolePermissionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
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
}) {
  return {
    id: role.id,
    key: role.key,
    organizationId: role.organizationId,
    label: role.label,
    description: role.description,
    isSystemRole: role.isSystemRole,
    permissionKeys: role.permissionKeys ?? [],
  };
}

// GET /organizations/:organizationId/roles
router.get(
  "/organizations/:organizationId/roles",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const roles = await listOrganizationRoles(req.membership!.organizationId);
    res.json(roles.map(formatRole));
  },
);

// POST /organizations/:organizationId/roles
router.post(
  "/organizations/:organizationId/roles",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("role.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CopyRoleTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const role = await copyRoleTemplate({
        organizationId: req.membership!.organizationId,
        templateRoleId: parsed.data.templateRoleId,
        key: parsed.data.key,
        label: parsed.data.label,
        description: parsed.data.description,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
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
  requirePermission("role.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
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

    try {
      await grantPermissionToOrgRole({
        organizationId: req.membership!.organizationId,
        roleId,
        permissionId: parsed.data.permissionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
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
  requirePermission("role.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const roleIdRaw = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const roleId = parseInt(roleIdRaw, 10);
    const permissionIdRaw = Array.isArray(req.params.permissionId) ? req.params.permissionId[0] : req.params.permissionId;
    const permissionId = parseInt(permissionIdRaw, 10);
    if (isNaN(roleId) || isNaN(permissionId)) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    try {
      await revokePermissionFromOrgRole({
        organizationId: req.membership!.organizationId,
        roleId,
        permissionId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
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
