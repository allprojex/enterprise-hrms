import { db, organizationsTable, organizationMembershipsTable, membershipRolesTable, primaryHrAssignmentsTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { resolveSystemRoleTemplate } from "./systemRoles";

type OrgType = "business" | "church" | "ngo" | "school" | "hospital" | "hotel" | "government" | "other";

/**
 * Creates a new organization and, in the same transaction, makes the
 * creator its first (active) member, grants them the org_admin role, and
 * appoints them as Primary HR. This is the only way an organization comes
 * into existence with a working admin — never insert into `organizations`
 * directly from a route.
 *
 * The creator always receives the SYSTEM `org_admin` template, resolved by
 * system identity (systemRoles.ts) — never by key alone, which could select a
 * role that some other organization owns under the same key. If the template
 * cannot be resolved the whole transaction fails: no organization, membership,
 * role link or Primary HR row is left behind, because an organization with no
 * administrator is not a valid outcome.
 */
export async function onboardOrganization(params: {
  name: string;
  slug: string;
  type: OrgType;
  creatorApplicationUserId: number;
}) {
  const result = await db.transaction(async (tx) => {
    // Before anything is written, so a missing template aborts cleanly.
    const orgAdminTemplate = await resolveSystemRoleTemplate(tx, "org_admin");

    const [organization] = await tx
      .insert(organizationsTable)
      .values({ name: params.name, slug: params.slug, type: params.type })
      .returning();

    const [membership] = await tx
      .insert(organizationMembershipsTable)
      .values({
        applicationUserId: params.creatorApplicationUserId,
        organizationId: organization.id,
        status: "active",
        joinedAt: new Date(),
      })
      .returning();

    await tx.insert(membershipRolesTable).values({ membershipId: membership.id, roleId: orgAdminTemplate.id });

    const [primaryHr] = await tx
      .insert(primaryHrAssignmentsTable)
      .values({
        organizationId: organization.id,
        membershipId: membership.id,
        assignedBy: params.creatorApplicationUserId,
      })
      .returning();

    return { organization, membership, primaryHr };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.creatorApplicationUserId,
    actorMembershipId: result.membership.id,
    organizationId: result.organization.id,
    eventType: "organization.onboarded",
    targetType: "organization",
    targetId: String(result.organization.id),
    afterState: result.organization,
  });
  await recordAuditEvent({
    actorApplicationUserId: params.creatorApplicationUserId,
    actorMembershipId: result.membership.id,
    organizationId: result.organization.id,
    eventType: "primary_hr.appointed",
    targetType: "primary_hr_assignment",
    targetId: String(result.primaryHr.id),
    afterState: result.primaryHr,
  });

  return result;
}
