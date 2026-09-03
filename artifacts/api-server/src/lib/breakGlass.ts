/**
 * WS-4 (Break-Glass Access Foundation, Owner Decision #31) — the temporary,
 * scoped grant that lets a platform actor (isSuperAdmin) exercise a narrow,
 * explicit, read-only set of permissions against one organization's data,
 * through the same requireMembership/requirePermission chain every ordinary
 * org-scoped route already uses (see middlewares/requireMembership.ts). A
 * grant changes WHO may call a normal service; it never changes WHAT that
 * service validates.
 *
 * No separate request/approval workflow exists in this foundation
 * workstream — a grant is activated by the same platform actor who creates
 * it (requestedAt === activatedAt), and there is no stored "expired"/"ended"
 * state: every consumer re-derives liveness from (status === "active") AND
 * (expiresAt > now()) at the moment of use — see getActiveGrantForActorAndOrg,
 * the ONLY function privileged requests should call to decide whether a
 * grant may be used right now. Never cache its result beyond one request.
 */
import { eq, and, gt, inArray } from "drizzle-orm";
import { db, breakGlassGrantsTable, permissionsTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { classifyOperation, auditScopeMetadata } from "./platformOperations/blastRadius";

export type BreakGlassGrant = typeof breakGlassGrantsTable.$inferSelect;

export class InvalidGrantInputError extends Error {}
export class GrantNotFoundError extends Error {}
export class GrantAlreadyRevokedError extends Error {}

// §22 option A: an explicit permission-key allow-list, never "all
// permissions" and never a policy-language bundle. §23's read-only default
// is enforced here mechanically, not by a hand-maintained bundle list: any
// permission key containing a ".read" segment (the repo-wide convention —
// verified against every key in seed-roles-permissions.ts, e.g.
// "employee.read", "audit.read.hr", "asset_management.read.own") qualifies;
// anything else (".manage", ".write", ".approve", etc.) is rejected.
const READ_ONLY_SCOPE_KEY_PATTERN = /(^|\.)read(\.|$)/;

// Platform policy, not customer-specific (§24: "Do not hard-code
// customer-specific rules") — configurable per deployment via env var, same
// safe-fallback pattern as routes/health.ts's RELEASE_VERSION.
const DEFAULT_MAX_DURATION_HOURS = 8;
function maxGrantDurationMs(): number {
  const raw = process.env.BREAK_GLASS_MAX_DURATION_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DURATION_HOURS;
  return hours * 60 * 60 * 1000;
}

async function assertValidScope(scope: string[]): Promise<string[]> {
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new InvalidGrantInputError("scope must be a non-empty array of permission keys");
  }
  const unique = [...new Set(scope)];
  for (const key of unique) {
    if (typeof key !== "string" || !READ_ONLY_SCOPE_KEY_PATTERN.test(key)) {
      throw new InvalidGrantInputError(`"${key}" is not a read-only permission key and cannot be granted via break-glass`);
    }
  }
  const rows = await db.select({ key: permissionsTable.key }).from(permissionsTable).where(inArray(permissionsTable.key, unique));
  const found = new Set(rows.map((r) => r.key));
  const missing = unique.filter((k) => !found.has(k));
  if (missing.length) {
    throw new InvalidGrantInputError(`Unknown permission key(s): ${missing.join(", ")}`);
  }
  return unique;
}

export interface CreateGrantInput {
  actorUserId: number;
  targetOrganizationId: number;
  targetInstallationId?: number | null;
  reason: string;
  scope: string[];
  expiresAt: Date;
  metadata?: Record<string, unknown> | null;
}

export async function createBreakGlassGrant(input: CreateGrantInput): Promise<BreakGlassGrant> {
  if (!input.reason?.trim()) {
    throw new InvalidGrantInputError("reason is required");
  }
  const scope = await assertValidScope(input.scope);

  const now = new Date();
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime()) || input.expiresAt <= now) {
    throw new InvalidGrantInputError("expiresAt must be a future date");
  }
  const maxExpiresAt = new Date(now.getTime() + maxGrantDurationMs());
  if (input.expiresAt > maxExpiresAt) {
    throw new InvalidGrantInputError(
      `expiresAt exceeds the maximum allowed break-glass grant duration (${maxGrantDurationMs() / 3_600_000}h)`,
    );
  }

  const [grant] = await db
    .insert(breakGlassGrantsTable)
    .values({
      actorUserId: input.actorUserId,
      targetOrganizationId: input.targetOrganizationId,
      targetInstallationId: input.targetInstallationId ?? null,
      reason: input.reason.trim(),
      scope,
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: input.actorUserId,
    organizationId: input.targetOrganizationId,
    eventType: "break_glass_grant.activated",
    targetType: "break_glass_grant",
    targetId: String(grant.id),
    afterState: { scope: grant.scope, expiresAt: grant.expiresAt, targetInstallationId: grant.targetInstallationId },
    metadata: {
      reason: grant.reason,
      ...auditScopeMetadata(
        classifyOperation("break_glass.grant", {
          organizationId: input.targetOrganizationId,
          installationId: input.targetInstallationId ?? null,
        }),
      ),
    },
    outcome: "success",
  });

  return grant;
}

export async function listBreakGlassGrants(filter?: {
  targetOrganizationId?: number;
}): Promise<BreakGlassGrant[]> {
  if (filter?.targetOrganizationId != null) {
    return db.select().from(breakGlassGrantsTable).where(eq(breakGlassGrantsTable.targetOrganizationId, filter.targetOrganizationId));
  }
  return db.select().from(breakGlassGrantsTable);
}

export async function getBreakGlassGrantById(id: number): Promise<BreakGlassGrant | null> {
  const rows = await db.select().from(breakGlassGrantsTable).where(eq(breakGlassGrantsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Immediate revocation (§26): flips status so the very next privileged
 * request re-derives liveness as false — no session invalidation or
 * frontend flag involved, and no delay for it to take effect.
 */
export async function revokeBreakGlassGrant(id: number, revokedBy: number): Promise<BreakGlassGrant> {
  const existing = await getBreakGlassGrantById(id);
  if (!existing) throw new GrantNotFoundError(`No break-glass grant with id ${id}`);
  if (existing.status === "revoked") {
    throw new GrantAlreadyRevokedError("This grant has already been revoked");
  }

  const [updated] = await db
    .update(breakGlassGrantsTable)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy })
    .where(eq(breakGlassGrantsTable.id, id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: revokedBy,
    organizationId: updated!.targetOrganizationId,
    eventType: "break_glass_grant.revoked",
    targetType: "break_glass_grant",
    targetId: String(id),
    outcome: "success",
  });

  return updated!;
}

/**
 * The ONE function requireMembership.ts calls to decide whether an
 * unauthenticated-by-membership platform actor may proceed against a
 * specific organization. Every condition is re-evaluated from the database
 * on every call — active status, not expired, correct actor, correct target
 * organization — never cached across requests, never inferred from a
 * frontend flag (§25/§47).
 */
export async function getActiveGrantForActorAndOrg(
  actorUserId: number,
  targetOrganizationId: number,
): Promise<BreakGlassGrant | null> {
  const now = new Date();
  const rows = await db
    .select()
    .from(breakGlassGrantsTable)
    .where(
      and(
        eq(breakGlassGrantsTable.actorUserId, actorUserId),
        eq(breakGlassGrantsTable.targetOrganizationId, targetOrganizationId),
        eq(breakGlassGrantsTable.status, "active"),
        gt(breakGlassGrantsTable.expiresAt, now),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
