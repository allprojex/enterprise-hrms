import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, rolesTable, rolePermissionsTable, permissionsTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class RoleTemplateNotFoundError extends Error {
  constructor(templateRoleId: number) {
    super(`No system role template with id ${templateRoleId}`);
    this.name = "RoleTemplateNotFoundError";
  }
}

export class OrgRoleNotFoundError extends Error {
  constructor(roleId: number) {
    super(`No customizable role with id ${roleId} in this organization`);
    this.name = "OrgRoleNotFoundError";
  }
}

export class ProtectedSystemRoleError extends Error {
  constructor(roleId: number) {
    super(`Role ${roleId} is a system role template and cannot be modified directly`);
    this.name = "ProtectedSystemRoleError";
  }
}

export class PermissionNotFoundError extends Error {
  constructor(permissionId: number) {
    super(`No permission with id ${permissionId}`);
    this.name = "PermissionNotFoundError";
  }
}

/** System role templates (organizationId null) plus this organization's own customized copies, each with its permission keys. */
export async function listOrganizationRoles(organizationId: number) {
  const roles = await db
    .select()
    .from(rolesTable)
    .where(or(isNull(rolesTable.organizationId), eq(rolesTable.organizationId, organizationId)));

  if (roles.length === 0) return [];

  const permissionRows = await db
    .select({ roleId: rolePermissionsTable.roleId, key: permissionsTable.key })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(inArray(rolePermissionsTable.roleId, roles.map((r) => r.id)));

  const keysByRoleId = new Map<number, string[]>();
  for (const row of permissionRows) {
    const list = keysByRoleId.get(row.roleId) ?? [];
    list.push(row.key);
    keysByRoleId.set(row.roleId, list);
  }

  return roles.map((role) => ({ ...role, permissionKeys: keysByRoleId.get(role.id) ?? [] }));
}

/**
 * Looks up a role by ID and verifies it's an organization-owned, editable
 * role (not a system template, and belonging to this organization). Split
 * into "does it exist" vs "is it protected" so a system role template
 * (organizationId null, so it can never match an org-scoped lookup) is
 * correctly reported as protected (400) rather than not found (404).
 */
async function findOrgOwnedRole(organizationId: number, roleId: number) {
  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId)).limit(1);
  if (!role) return { role: null, protected: false } as const;
  if (role.isSystemRole || role.organizationId === null) return { role: null, protected: true } as const;
  if (role.organizationId !== organizationId) return { role: null, protected: false } as const;
  return { role, protected: false } as const;
}

/**
 * Copies a system role template into this organization's own, customizable
 * role, along with the template's current permission set — the template
 * row itself is never modified. See ADR-015.
 */
export async function copyRoleTemplate(params: {
  organizationId: number;
  templateRoleId: number;
  key: string;
  label: string;
  description?: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}) {
  const [template] = await db
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.id, params.templateRoleId), isNull(rolesTable.organizationId), eq(rolesTable.isSystemRole, true)))
    .limit(1);
  if (!template) {
    throw new RoleTemplateNotFoundError(params.templateRoleId);
  }

  const [role] = await db
    .insert(rolesTable)
    .values({
      key: params.key,
      organizationId: params.organizationId,
      label: params.label,
      description: params.description ?? template.description,
      isSystemRole: false,
    })
    .returning();

  const templatePermissionKeys = await db
    .select({ key: permissionsTable.key })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(eq(rolePermissionsTable.roleId, template.id));

  if (templatePermissionKeys.length > 0) {
    const permissions = await db
      .select()
      .from(permissionsTable)
      .where(inArray(permissionsTable.key, templatePermissionKeys.map((p) => p.key)));
    for (const permission of permissions) {
      await db.insert(rolePermissionsTable).values({ roleId: role.id, permissionId: permission.id });
    }
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "role.copied_from_template",
    targetType: "role",
    targetId: String(role.id),
    metadata: { templateRoleId: template.id, templateKey: template.key },
    afterState: role,
  });

  return role;
}

export async function grantPermissionToOrgRole(params: {
  organizationId: number;
  roleId: number;
  permissionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}) {
  const found = await findOrgOwnedRole(params.organizationId, params.roleId);
  if (found.protected) throw new ProtectedSystemRoleError(params.roleId);
  if (!found.role) throw new OrgRoleNotFoundError(params.roleId);
  const role = found.role;

  const [permission] = await db
    .select()
    .from(permissionsTable)
    .where(eq(permissionsTable.id, params.permissionId))
    .limit(1);
  if (!permission) throw new PermissionNotFoundError(params.permissionId);

  await db
    .insert(rolePermissionsTable)
    .values({ roleId: role.id, permissionId: permission.id })
    .onConflictDoNothing({ target: [rolePermissionsTable.roleId, rolePermissionsTable.permissionId] });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "role.permission_granted",
    targetType: "role",
    targetId: String(role.id),
    metadata: { permissionKey: permission.key },
  });
}

export async function revokePermissionFromOrgRole(params: {
  organizationId: number;
  roleId: number;
  permissionId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}) {
  const found = await findOrgOwnedRole(params.organizationId, params.roleId);
  if (found.protected) throw new ProtectedSystemRoleError(params.roleId);
  if (!found.role) throw new OrgRoleNotFoundError(params.roleId);
  const role = found.role;

  await db
    .delete(rolePermissionsTable)
    .where(and(eq(rolePermissionsTable.roleId, role.id), eq(rolePermissionsTable.permissionId, params.permissionId)));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "role.permission_revoked",
    targetType: "role",
    targetId: String(role.id),
    metadata: { permissionId: params.permissionId },
  });
}
