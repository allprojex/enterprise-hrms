/**
 * HR role consolidation — migrate deprecated HR templates onto the canonical
 * `hr` role (explicit, governed, out-of-band).
 *
 * For every membership holding `hr_administrator` or `hr_manager`, this ADDS
 * the canonical `hr` role and then REMOVES the deprecated one. The canonical
 * role is a superset of both, so no holder loses authority at any point; the
 * add happens before the remove, so there is no window in which a live HR user
 * has less than they started with.
 *
 * It NEVER runs on boot or from seed:roles. It is a DRY RUN unless --confirm
 * is passed, and the actor is authorized exactly as the template-activation CLI
 * is (lib/actorAuthorization.ts): the ids supplied are proven against real
 * effective permissions, never trusted. Migrating role assignments is
 * membership administration, so it requires `role.manage` AND
 * `membership.manage` in the target organization.
 *
 *   DATABASE_URL=... npx tsx scripts/migrate-hr-roles.ts \
 *     --org <id> --actor-user <id> --actor-membership <id> [--confirm]
 *
 * Idempotent: a membership already on `hr` with no deprecated role is reported
 * as `already_migrated` and left alone. Revoked memberships are migrated too
 * (their role links are still real assignments) but are reported separately.
 *
 * Historical audit events are NEVER rewritten — they keep naming whichever role
 * was in force at the time. This script only appends new events.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  rolesTable,
  membershipRolesTable,
  organizationMembershipsTable,
} from "@workspace/db";
import { DEPRECATED_ROLE_KEYS, CANONICAL_HR_ROLE_KEY } from "@workspace/db/seed/roles-permissions-definitions";
import { authorizeActor } from "../src/lib/actorAuthorization";
import { recordAuditEvent } from "../src/lib/auditLog";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

interface Plan {
  membershipId: number;
  applicationUserId: number;
  membershipStatus: string;
  fromRoleKeys: string[];
  action: "migrate" | "already_migrated";
}

async function main() {
  const org = Number(arg("org"));
  const actorUser = Number(arg("actor-user"));
  const actorMembership = Number(arg("actor-membership"));
  const confirm = has("confirm");

  if (!Number.isInteger(org) || org <= 0) throw new Error("--org <id> is required (explicit target organization)");
  if (!Number.isInteger(actorUser) || actorUser <= 0) throw new Error("--actor-user <id> is required (governed actor)");
  if (!Number.isInteger(actorMembership) || actorMembership <= 0) throw new Error("--actor-membership <id> is required (governed actor membership)");

  console.log(`HR role consolidation: org=${org} confirm=${confirm}`);

  // Same proof-not-trust gate as the activation CLI. Reassigning roles is
  // membership administration, so both administrative keys are required.
  const actor = await authorizeActor({
    organizationId: org,
    actorApplicationUserId: actorUser,
    actorMembershipId: actorMembership,
    requiredPermissions: ["role.manage", "membership.manage"],
  });
  console.log(`Actor authorized: user ${actor.applicationUserId} via membership ${actor.membershipId} in org ${actor.organizationId}`);

  const [canonical] = await db
    .select()
    .from(rolesTable)
    .where(and(eq(rolesTable.key, CANONICAL_HR_ROLE_KEY), eq(rolesTable.isSystemRole, true)))
    .limit(1);
  if (!canonical) throw new Error(`The canonical "${CANONICAL_HR_ROLE_KEY}" role template is missing — run seed:roles first`);

  const deprecated = await db.select().from(rolesTable).where(inArray(rolesTable.key, [...DEPRECATED_ROLE_KEYS]));
  const deprecatedById = new Map(deprecated.map((r) => [r.id, r]));
  if (deprecated.length === 0) {
    console.log("No deprecated HR role templates exist in this database. Nothing to do.");
    return;
  }

  // Every membership in THIS organization holding a deprecated HR template.
  const rows = await db
    .select({
      membershipId: organizationMembershipsTable.id,
      applicationUserId: organizationMembershipsTable.applicationUserId,
      status: organizationMembershipsTable.status,
      roleId: membershipRolesTable.roleId,
    })
    .from(membershipRolesTable)
    .innerJoin(organizationMembershipsTable, eq(organizationMembershipsTable.id, membershipRolesTable.membershipId))
    .where(
      and(
        eq(organizationMembershipsTable.organizationId, org),
        inArray(membershipRolesTable.roleId, deprecated.map((r) => r.id)),
      ),
    );

  const byMembership = new Map<number, Plan>();
  for (const row of rows) {
    const plan = byMembership.get(row.membershipId) ?? {
      membershipId: row.membershipId,
      applicationUserId: row.applicationUserId,
      membershipStatus: row.status,
      fromRoleKeys: [],
      action: "migrate" as const,
    };
    plan.fromRoleKeys.push(deprecatedById.get(row.roleId)!.key);
    byMembership.set(row.membershipId, plan);
  }
  const plans = [...byMembership.values()].sort((a, b) => a.membershipId - b.membershipId);

  if (plans.length === 0) {
    console.log("No membership in this organization holds a deprecated HR role. Nothing to migrate.");
    return;
  }

  console.log(`\nPlan (${plans.length} membership(s)):`);
  for (const p of plans) {
    console.log(`  membership ${p.membershipId} (user ${p.applicationUserId}, ${p.membershipStatus}): ${p.fromRoleKeys.sort().join(" + ")} -> ${CANONICAL_HR_ROLE_KEY}`);
  }

  if (!confirm) {
    console.log("\nDRY RUN (no --confirm): nothing written. Re-run with --confirm to migrate.");
    return;
  }

  for (const p of plans) {
    await db.transaction(async (tx) => {
      // Grant first, then revoke: the holder is never below their starting
      // authority, not even momentarily.
      await tx
        .insert(membershipRolesTable)
        .values({ membershipId: p.membershipId, roleId: canonical.id })
        .onConflictDoNothing({ target: [membershipRolesTable.membershipId, membershipRolesTable.roleId] });
      await tx
        .delete(membershipRolesTable)
        .where(
          and(
            eq(membershipRolesTable.membershipId, p.membershipId),
            inArray(membershipRolesTable.roleId, deprecated.map((r) => r.id)),
          ),
        );
    });
    await recordAuditEvent({
      actorApplicationUserId: actor.applicationUserId,
      actorMembershipId: actor.membershipId,
      organizationId: org,
      eventType: "membership.hr_role_migrated",
      targetType: "organization_membership",
      targetId: String(p.membershipId),
      metadata: { from: p.fromRoleKeys.sort(), to: CANONICAL_HR_ROLE_KEY, membershipStatus: p.membershipStatus },
    });
    console.log(`  migrated membership ${p.membershipId}`);
  }
  console.log("Migration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("HR role migration failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
