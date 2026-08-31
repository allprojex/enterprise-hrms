/**
 * WS-17 Slice 1 — platform-operations authority.
 *
 * WHY THESE KEYS ARE NOT IN THE ORDINARY `permissions` CATALOGUE
 *
 * Two independent reasons, both decisive:
 *
 *  1. `seed-roles-permissions.ts` grants the super-admin role
 *     `PERMISSIONS.map((p) => p.key)` — EVERY key, blanket. Adding platform
 *     keys there would hand every super-admin every dangerous operational
 *     mutation automatically, which is precisely what the frozen decision
 *     ("role alone must not automatically grant every dangerous mutation")
 *     exists to prevent.
 *  2. That catalogue is tenant-assignable: its keys appear in organization
 *     role configuration. A platform key must never be grantable by an
 *     organization to one of its own members.
 *
 * So the keys are declared here and granted through `platform_operation_grants`
 * on the USER axis — the shape `break_glass_grants` already established for
 * user-scoped, reasoned, revocable, time-limitable platform authority. This is
 * the same pattern (string keys, one central declaration, a grant record,
 * audit) applied on the only axis that is correct for operations that have no
 * organization.
 *
 * AUTHORITY IS A CONJUNCTION, ALWAYS
 *
 *     platform context (super-admin)  AND  a live grant of the specific key
 *
 * Neither half suffices. A grant without platform context does nothing; super-
 * admin without the grant cannot perform the protected mutation. Read-only
 * fleet viewing is deliberately the least of these and still requires a grant,
 * so that "can look at the fleet" and "can request a backup" are separable.
 */
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { db, platformOperationGrantsTable } from "@workspace/db";
import { isSuperAdmin } from "../authorization";
import type { User } from "../membership";

/**
 * Every platform-operation key this platform defines. Declared as one closed
 * list so there is a single place to read what platform authority can exist —
 * the same discipline the tenant catalogue follows, on the correct axis.
 */
export const PLATFORM_OPERATION_PERMISSIONS = {
  /** See the fleet, installation detail, health, history. Read-only. */
  FLEET_READ: "platform.fleet.read",
  /** Record deployment evidence and correct installation current state. */
  DEPLOYMENT_MANAGE: "platform.deployment.manage",
  /** Create and change backup policy targets. */
  BACKUP_POLICY_MANAGE: "platform.backup.policy.manage",
  /** Ask an executor to take a backup. Not the same as taking one. */
  BACKUP_REQUEST: "platform.backup.request",
  /** Record backup evidence and telemetry reported by an executor. */
  BACKUP_EVIDENCE_RECORD: "platform.backup.evidence.record",
} as const;

export type PlatformOperationPermission =
  (typeof PLATFORM_OPERATION_PERMISSIONS)[keyof typeof PLATFORM_OPERATION_PERMISSIONS];

/**
 * RESERVED FOR THE GATED RESTORE PASS — declared, never granted, never checked
 * by any route in this slice.
 *
 * They are written down now for one reason: the frozen decision requires that
 * a requester can never approve their own production restore, and that is only
 * expressible if the two authorities are separate keys from the outset.
 * Reserving them here stops a future pass from collapsing them into a single
 * "restore" permission for convenience.
 */
export const RESERVED_RESTORE_PERMISSIONS = {
  RESTORE_REQUEST: "platform.restore.request",
  RESTORE_APPROVE: "platform.restore.approve",
} as const;

/** Keys a grant may legitimately carry today. Reserved restore keys are excluded on purpose. */
export const GRANTABLE_PLATFORM_PERMISSIONS: readonly string[] = Object.values(PLATFORM_OPERATION_PERMISSIONS);

export class PlatformAuthorityError extends Error {
  constructor(message = "Platform operation authority required") {
    super(message);
    this.name = "PlatformAuthorityError";
  }
}

/**
 * Does this user hold a LIVE grant of `permissionKey` right now?
 *
 * Live means: not revoked, and either no expiry or an expiry still in the
 * future. Evaluated per call — a revoked or expired grant stops working
 * immediately, with no job and no cache.
 */
export async function hasPlatformPermission(userId: number, permissionKey: string): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .select({ id: platformOperationGrantsTable.id })
    .from(platformOperationGrantsTable)
    .where(
      and(
        eq(platformOperationGrantsTable.userId, userId),
        eq(platformOperationGrantsTable.permissionKey, permissionKey),
        isNull(platformOperationGrantsTable.revokedAt),
        or(isNull(platformOperationGrantsTable.expiresAt), gt(platformOperationGrantsTable.expiresAt, now)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The conjunction. `user` must be a platform super-admin AND hold the key.
 *
 * Deliberately takes the whole user rather than an id: the super-admin check
 * reads `user.role`, and requiring the caller to pass the authenticated user
 * makes it impossible to authorize on an id alone.
 */
export async function hasPlatformAuthority(user: User | undefined, permissionKey: string): Promise<boolean> {
  if (!user || !isSuperAdmin(user)) return false;
  return hasPlatformPermission(user.id, permissionKey);
}

/** Throwing form, for service layers that should fail closed. */
export async function assertPlatformAuthority(user: User | undefined, permissionKey: string): Promise<void> {
  if (!(await hasPlatformAuthority(user, permissionKey))) throw new PlatformAuthorityError();
}

/** Every live platform key a user holds — for surfacing capability, never for authorizing. */
export async function listLivePlatformPermissions(userId: number): Promise<string[]> {
  const now = new Date();
  const rows = await db
    .select({ permissionKey: platformOperationGrantsTable.permissionKey })
    .from(platformOperationGrantsTable)
    .where(
      and(
        eq(platformOperationGrantsTable.userId, userId),
        isNull(platformOperationGrantsTable.revokedAt),
        or(isNull(platformOperationGrantsTable.expiresAt), gt(platformOperationGrantsTable.expiresAt, now)),
      ),
    );
  return rows.map((r) => r.permissionKey);
}
