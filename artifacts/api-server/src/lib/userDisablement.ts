import { eq } from "drizzle-orm";
import { db, usersTable, sessionsTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export type User = typeof usersTable.$inferSelect;

export class UserNotFoundError extends Error {}
export class CannotDisableSelfError extends Error {}

/**
 * Platform-level user disablement (WS-2, Owner Decision #20). This is a
 * platform-wide action — reserved to super_admin (see
 * routes/platformUsers.ts's requireSuperAdmin gate) — distinct from, and
 * layered independently on top of, per-organization membership
 * status/revocation. Disabling a user here blocks them everywhere, in every
 * organization, regardless of how many active memberships they hold.
 *
 * Session revocation is immediate and explicit: every one of the user's
 * existing sessions is deleted in the same operation, so a disabled user
 * cannot continue acting on a token issued before disablement. This is
 * defense in depth, not the only enforcement — requireAuth also re-checks
 * `disabledAt IS NULL` live on every request (no caching), so even a
 * session that somehow survived (a race, a second token store) is still
 * rejected on its very next request.
 */
export async function disableUser(params: {
  userId: number;
  disabledBy: number;
  reason?: string | null;
}): Promise<User> {
  if (params.userId === params.disabledBy) {
    throw new CannotDisableSelfError("You cannot disable your own account");
  }

  const [before] = await db.select().from(usersTable).where(eq(usersTable.id, params.userId)).limit(1);
  if (!before) throw new UserNotFoundError(`No user with id ${params.userId}`);

  const [updated] = await db
    .update(usersTable)
    .set({ disabledAt: new Date(), disabledBy: params.disabledBy, disabledReason: params.reason ?? null })
    .where(eq(usersTable.id, params.userId))
    .returning();

  // Immediate revocation — every existing session for this user stops
  // working right away, not just once it happens to expire.
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, params.userId));

  await recordAuditEvent({
    actorApplicationUserId: params.disabledBy,
    eventType: "platform_user.disabled",
    targetType: "user",
    targetId: String(params.userId),
    beforeState: { disabledAt: before.disabledAt },
    afterState: { disabledAt: updated.disabledAt, disabledReason: updated.disabledReason },
    metadata: params.reason ? { reason: params.reason } : null,
  });

  return updated;
}

/**
 * Re-enables a previously disabled user. Restores platform account
 * eligibility ONLY — deliberately does not touch organization_memberships,
 * membership_roles, or any permission grant (Owner Decision #20's
 * re-enable-semantics requirement: revoked/expired memberships and roles
 * remain separately, independently authoritative and must be restored, if
 * at all, through their own existing membership-management operations, not
 * as a side effect of this one).
 */
export async function enableUser(params: { userId: number; enabledBy: number }): Promise<User> {
  const [before] = await db.select().from(usersTable).where(eq(usersTable.id, params.userId)).limit(1);
  if (!before) throw new UserNotFoundError(`No user with id ${params.userId}`);

  const [updated] = await db
    .update(usersTable)
    .set({ disabledAt: null, disabledBy: null, disabledReason: null })
    .where(eq(usersTable.id, params.userId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.enabledBy,
    eventType: "platform_user.enabled",
    targetType: "user",
    targetId: String(params.userId),
    beforeState: { disabledAt: before.disabledAt, disabledReason: before.disabledReason },
    afterState: { disabledAt: updated.disabledAt },
  });

  return updated;
}
