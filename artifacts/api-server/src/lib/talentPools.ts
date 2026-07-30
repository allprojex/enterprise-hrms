/**
 * Talent Pools (Phase 3A, W53 — Candidate Notes, Tags, and Talent Pools):
 * reusable, org-scoped candidate groupings, never tied to a single vacancy
 * or requisition — mirrors recruitmentWorkflows.ts's archive/reactivate
 * shape. Org-wide only (§7 — no "assigned" tier: a pool isn't reachable
 * through any one requisition's recruiter/hiring-manager), so callers only
 * need `talent_pool.read`/`.manage`, never a visibility resolver.
 */
import { and, eq, asc } from "drizzle-orm";
import { db, talentPoolsTable, talentPoolMembersTable, candidatesTable, type TalentPool, type TalentPoolMember } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";
import { CandidateNotFoundError } from "./candidates";

export class TalentPoolNotFoundError extends Error {
  constructor() {
    super("Talent pool not found");
    this.name = "TalentPoolNotFoundError";
  }
}

export class DuplicateTalentPoolNameError extends Error {
  constructor() {
    super("A talent pool with this name already exists in the organization");
    this.name = "DuplicateTalentPoolNameError";
  }
}

export class TalentPoolMemberNotFoundError extends Error {
  constructor() {
    super("Candidate is not a member of this talent pool");
    this.name = "TalentPoolMemberNotFoundError";
  }
}

export class DuplicateTalentPoolMemberError extends Error {
  constructor() {
    super("Candidate is already a member of this talent pool");
    this.name = "DuplicateTalentPoolMemberError";
  }
}

export async function listTalentPools(organizationId: number): Promise<TalentPool[]> {
  return db.select().from(talentPoolsTable).where(eq(talentPoolsTable.organizationId, organizationId)).orderBy(asc(talentPoolsTable.name));
}

async function findOwnTalentPool(organizationId: number, poolId: number): Promise<TalentPool | null> {
  const [row] = await db
    .select()
    .from(talentPoolsTable)
    .where(and(eq(talentPoolsTable.id, poolId), eq(talentPoolsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getTalentPoolById(organizationId: number, poolId: number): Promise<TalentPool | null> {
  return findOwnTalentPool(organizationId, poolId);
}

export async function createTalentPool(params: {
  organizationId: number;
  name: string;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<TalentPool> {
  try {
    const [pool] = await db
      .insert(talentPoolsTable)
      .values({
        organizationId: params.organizationId,
        name: params.name,
        description: params.description ?? null,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "talent_pool.created",
      targetType: "talent_pool",
      targetId: String(pool.id),
      afterState: { name: pool.name },
    });

    return pool;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTalentPoolNameError();
    throw err;
  }
}

export async function updateTalentPool(params: {
  organizationId: number;
  poolId: number;
  name?: string;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<TalentPool> {
  const before = await findOwnTalentPool(params.organizationId, params.poolId);
  if (!before) throw new TalentPoolNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;

  try {
    const [updated] = await db.update(talentPoolsTable).set(patch).where(eq(talentPoolsTable.id, params.poolId)).returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "talent_pool.updated",
      targetType: "talent_pool",
      targetId: String(params.poolId),
      beforeState: { name: before.name, description: before.description },
      afterState: { name: updated.name, description: updated.description },
    });

    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTalentPoolNameError();
    throw err;
  }
}

async function setTalentPoolActive(params: {
  organizationId: number;
  poolId: number;
  isActive: boolean;
  eventType: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<TalentPool> {
  const before = await findOwnTalentPool(params.organizationId, params.poolId);
  if (!before) throw new TalentPoolNotFoundError();

  const [updated] = await db.update(talentPoolsTable).set({ isActive: params.isActive }).where(eq(talentPoolsTable.id, params.poolId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.eventType,
    targetType: "talent_pool",
    targetId: String(params.poolId),
    beforeState: { isActive: before.isActive },
    afterState: { isActive: updated.isActive },
  });

  return updated;
}

export const archiveTalentPool = (params: { organizationId: number; poolId: number; actorApplicationUserId: number; actorMembershipId: number }) =>
  setTalentPoolActive({ ...params, isActive: false, eventType: "talent_pool.archived" });

export const reactivateTalentPool = (params: { organizationId: number; poolId: number; actorApplicationUserId: number; actorMembershipId: number }) =>
  setTalentPoolActive({ ...params, isActive: true, eventType: "talent_pool.reactivated" });

export async function listTalentPoolMembers(organizationId: number, poolId: number): Promise<TalentPoolMember[]> {
  return db
    .select()
    .from(talentPoolMembersTable)
    .where(and(eq(talentPoolMembersTable.organizationId, organizationId), eq(talentPoolMembersTable.talentPoolId, poolId)))
    .orderBy(asc(talentPoolMembersTable.createdAt));
}

export async function addTalentPoolMember(params: {
  organizationId: number;
  poolId: number;
  candidateId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<TalentPoolMember> {
  const pool = await findOwnTalentPool(params.organizationId, params.poolId);
  if (!pool) throw new TalentPoolNotFoundError();

  const [candidate] = await db
    .select()
    .from(candidatesTable)
    .where(and(eq(candidatesTable.id, params.candidateId), eq(candidatesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!candidate) throw new CandidateNotFoundError();

  try {
    const [member] = await db
      .insert(talentPoolMembersTable)
      .values({
        organizationId: params.organizationId,
        talentPoolId: params.poolId,
        candidateId: params.candidateId,
        addedByMembershipId: params.actorMembershipId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "talent_pool.member_added",
      targetType: "talent_pool",
      targetId: String(params.poolId),
      afterState: { candidateId: params.candidateId },
    });

    return member;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateTalentPoolMemberError();
    throw err;
  }
}

export async function removeTalentPoolMember(params: {
  organizationId: number;
  poolId: number;
  candidateId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const [removed] = await db
    .delete(talentPoolMembersTable)
    .where(
      and(
        eq(talentPoolMembersTable.organizationId, params.organizationId),
        eq(talentPoolMembersTable.talentPoolId, params.poolId),
        eq(talentPoolMembersTable.candidateId, params.candidateId),
      ),
    )
    .returning();
  if (!removed) throw new TalentPoolMemberNotFoundError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "talent_pool.member_removed",
    targetType: "talent_pool",
    targetId: String(params.poolId),
    beforeState: { candidateId: params.candidateId },
  });
}
