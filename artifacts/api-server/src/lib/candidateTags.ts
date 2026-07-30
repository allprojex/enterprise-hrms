/**
 * Candidate Tags (Phase 3A, W53 — Candidate Notes, Tags, and Talent
 * Pools): simple, free-text labels — never a fixed enum or Master Data
 * domain, so tag values are never hard-coded. Add/remove only; low
 * sensitivity per §9 (unlike candidate_notes), gated by the general
 * `candidate.read`/`.manage` pair rather than a dedicated tags permission.
 */
import { and, eq, asc } from "drizzle-orm";
import { db, candidateTagsTable, type CandidateTag } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class InvalidCandidateTagError extends Error {}
export class DuplicateCandidateTagError extends Error {
  constructor() {
    super("This candidate already has that tag");
    this.name = "DuplicateCandidateTagError";
  }
}
export class CandidateTagNotFoundError extends Error {
  constructor() {
    super("Tag not found");
    this.name = "CandidateTagNotFoundError";
  }
}

export async function listCandidateTags(organizationId: number, candidateId: number): Promise<CandidateTag[]> {
  return db
    .select()
    .from(candidateTagsTable)
    .where(and(eq(candidateTagsTable.organizationId, organizationId), eq(candidateTagsTable.candidateId, candidateId)))
    .orderBy(asc(candidateTagsTable.tag));
}

export async function addCandidateTag(params: {
  organizationId: number;
  candidateId: number;
  tag: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<CandidateTag> {
  const tag = params.tag.trim();
  if (!tag) {
    throw new InvalidCandidateTagError("tag is required");
  }

  try {
    const [row] = await db
      .insert(candidateTagsTable)
      .values({ organizationId: params.organizationId, candidateId: params.candidateId, tag })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "candidate_tag.added",
      targetType: "candidate",
      targetId: String(params.candidateId),
      afterState: { tag },
    });

    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateCandidateTagError();
    throw err;
  }
}

export async function removeCandidateTag(params: {
  organizationId: number;
  candidateId: number;
  tagId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const [removed] = await db
    .delete(candidateTagsTable)
    .where(and(eq(candidateTagsTable.id, params.tagId), eq(candidateTagsTable.organizationId, params.organizationId), eq(candidateTagsTable.candidateId, params.candidateId)))
    .returning();
  if (!removed) throw new CandidateTagNotFoundError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "candidate_tag.removed",
    targetType: "candidate",
    targetId: String(params.candidateId),
    beforeState: { tag: removed.tag },
  });
}
