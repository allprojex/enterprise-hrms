import { eq, and, gt, or, isNull, inArray } from "drizzle-orm";
import {
  db,
  organizationMembershipsTable,
  rolesTable,
  membershipRolesTable,
  usersTable,
  primaryHrAssignmentsTable,
} from "@workspace/db";

export type Membership = typeof organizationMembershipsTable.$inferSelect;

function activeAndUnexpired() {
  const now = new Date();
  return and(
    eq(organizationMembershipsTable.status, "active"),
    or(isNull(organizationMembershipsTable.expiresAt), gt(organizationMembershipsTable.expiresAt, now)),
  );
}

/** The caller's active, unexpired membership for a specific organization, or null. */
export async function getActiveMembership(
  applicationUserId: number,
  organizationId: number,
): Promise<Membership | null> {
  const rows = await db
    .select()
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.applicationUserId, applicationUserId),
        eq(organizationMembershipsTable.organizationId, organizationId),
        activeAndUnexpired(),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** All of the caller's active, unexpired memberships, across every organization. */
export async function getActiveMembershipsForUser(applicationUserId: number): Promise<Membership[]> {
  return db
    .select()
    .from(organizationMembershipsTable)
    .where(and(eq(organizationMembershipsTable.applicationUserId, applicationUserId), activeAndUnexpired()));
}

/**
 * Resolves which organization the caller is currently working in. Prefers the
 * session's stored active organization, but only if that membership is still
 * live (it may have been revoked since the session last switched). Falls back
 * to the user's legacy home organization, then to any other active
 * membership, so a caller who lost access to their preferred org still lands
 * somewhere valid instead of being silently scoped to nothing.
 */
export async function resolveActiveOrganizationId(
  applicationUserId: number,
  sessionActiveOrganizationId: number | null | undefined,
  legacyOrganizationId: number | null | undefined,
): Promise<number | null> {
  if (sessionActiveOrganizationId != null) {
    const membership = await getActiveMembership(applicationUserId, sessionActiveOrganizationId);
    if (membership) return sessionActiveOrganizationId;
  }

  if (legacyOrganizationId != null && legacyOrganizationId !== sessionActiveOrganizationId) {
    const membership = await getActiveMembership(applicationUserId, legacyOrganizationId);
    if (membership) return legacyOrganizationId;
  }

  const memberships = await getActiveMembershipsForUser(applicationUserId);
  return memberships[0]?.organizationId ?? null;
}

/** Creates an active membership and, if the role key is known, attaches that role. */
export async function createMembershipWithRole(params: {
  applicationUserId: number;
  organizationId: number;
  roleKey: string;
}): Promise<Membership> {
  const [membership] = await db
    .insert(organizationMembershipsTable)
    .values({
      applicationUserId: params.applicationUserId,
      organizationId: params.organizationId,
      status: "active",
      joinedAt: new Date(),
    })
    .returning();

  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.key, params.roleKey)).limit(1);
  if (role) {
    await db.insert(membershipRolesTable).values({ membershipId: membership.id, roleId: role.id });
  }

  return membership;
}

export class UserNotFoundError extends Error {}
export class AlreadyMemberError extends Error {}

export interface MemberSummary {
  membershipId: number;
  applicationUserId: number;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: string[];
  isPrimaryHr: boolean;
  joinedAt: Date | null;
}

/** All memberships in an organization (any status), with roles and Primary HR flag — for admin membership management. */
export async function listOrganizationMembers(organizationId: number): Promise<MemberSummary[]> {
  const memberships = await db
    .select({
      id: organizationMembershipsTable.id,
      applicationUserId: organizationMembershipsTable.applicationUserId,
      status: organizationMembershipsTable.status,
      joinedAt: organizationMembershipsTable.joinedAt,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
    })
    .from(organizationMembershipsTable)
    .innerJoin(usersTable, eq(organizationMembershipsTable.applicationUserId, usersTable.id))
    .where(eq(organizationMembershipsTable.organizationId, organizationId));

  if (!memberships.length) return [];
  const membershipIds = memberships.map((m) => m.id);

  const roleRows = await db
    .select({ membershipId: membershipRolesTable.membershipId, key: rolesTable.key })
    .from(membershipRolesTable)
    .innerJoin(rolesTable, eq(membershipRolesTable.roleId, rolesTable.id))
    .where(inArray(membershipRolesTable.membershipId, membershipIds));
  const rolesByMembership = new Map<number, string[]>();
  for (const row of roleRows) {
    const list = rolesByMembership.get(row.membershipId) ?? [];
    list.push(row.key);
    rolesByMembership.set(row.membershipId, list);
  }

  const primaryHrRows = await db
    .select({ membershipId: primaryHrAssignmentsTable.membershipId })
    .from(primaryHrAssignmentsTable)
    .where(
      and(
        inArray(primaryHrAssignmentsTable.membershipId, membershipIds),
        isNull(primaryHrAssignmentsTable.revokedAt),
      ),
    );
  const primaryHrMembershipIds = new Set(primaryHrRows.map((r) => r.membershipId));

  return memberships.map((m) => ({
    membershipId: m.id,
    applicationUserId: m.applicationUserId,
    email: m.email,
    firstName: m.firstName,
    lastName: m.lastName,
    status: m.status,
    roles: rolesByMembership.get(m.id) ?? [],
    isPrimaryHr: primaryHrMembershipIds.has(m.id),
    joinedAt: m.joinedAt,
  }));
}

/** Adds an existing user (looked up by email) as an active member of an organization. */
export async function addMemberByEmail(organizationId: number, email: string): Promise<Membership> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
  if (!user) throw new UserNotFoundError(`No user with email ${email}`);

  const existing = await getActiveMembership(user.id, organizationId);
  if (existing) throw new AlreadyMemberError(`User is already an active member of this organization`);

  const [membership] = await db
    .insert(organizationMembershipsTable)
    .values({
      applicationUserId: user.id,
      organizationId,
      status: "active",
      joinedAt: new Date(),
    })
    .returning();

  return membership;
}

/** Grants a role to a membership. Idempotent — assigning an already-held role is a no-op. */
export async function assignRoleToMembership(membershipId: number, roleId: number): Promise<void> {
  await db
    .insert(membershipRolesTable)
    .values({ membershipId, roleId })
    .onConflictDoNothing({ target: [membershipRolesTable.membershipId, membershipRolesTable.roleId] });
}

/** Revokes a role from a membership. A no-op if the membership didn't hold that role. */
export async function revokeRoleFromMembership(membershipId: number, roleId: number): Promise<void> {
  await db
    .delete(membershipRolesTable)
    .where(and(eq(membershipRolesTable.membershipId, membershipId), eq(membershipRolesTable.roleId, roleId)));
}

/** Revokes a membership (soft — sets status/revokedAt/revokedBy; the row and its history are kept). */
export async function revokeMembership(membershipId: number, revokedBy: number): Promise<Membership | null> {
  const [updated] = await db
    .update(organizationMembershipsTable)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy })
    .where(eq(organizationMembershipsTable.id, membershipId))
    .returning();
  return updated ?? null;
}
