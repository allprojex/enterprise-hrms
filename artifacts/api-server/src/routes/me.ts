import { Router } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { db, organizationsTable, membershipRolesTable, rolesTable, primaryHrAssignmentsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { getActiveMembershipsForUser } from "../lib/membership";

const router = Router();

// GET /me/organizations
router.get("/me/organizations", requireAuth as any, async (req: AuthenticatedRequest, res): Promise<void> => {
  const memberships = await getActiveMembershipsForUser(req.userId!);

  if (!memberships.length) {
    res.json([]);
    return;
  }

  const organizationIds = memberships.map((m) => m.organizationId);
  const membershipIds = memberships.map((m) => m.id);

  const organizations = await db
    .select()
    .from(organizationsTable)
    .where(inArray(organizationsTable.id, organizationIds));
  const organizationById = new Map(organizations.map((o) => [o.id, o]));

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

  const summaries = memberships
    .map((membership) => {
      const organization = organizationById.get(membership.organizationId);
      if (!organization) return null;
      return {
        organizationId: organization.id,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        status: membership.status,
        roles: rolesByMembership.get(membership.id) ?? [],
        isPrimaryHr: primaryHrMembershipIds.has(membership.id),
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  res.json(summaries);
});

export default router;
