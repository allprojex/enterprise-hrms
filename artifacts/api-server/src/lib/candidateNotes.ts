/**
 * Candidate Notes (Phase 3A, W53 — Candidate Notes, Tags, and Talent
 * Pools): free-text recruiter notes, create-only (§9 marks this table "on
 * write" only — a correction is a new note, never an edit of a past one,
 * mirroring `candidate_consents`'/`application_scores`' append-only
 * precedent). `applicationId` is how the frozen plan distinguishes a
 * candidate-level note (omitted) from an application-level note (set) —
 * both live in this one table. Never exposed to an applicant — no
 * candidate-session read path exists anywhere in this codebase (W50
 * deferred).
 */
import { and, eq, desc } from "drizzle-orm";
import { db, candidateNotesTable, applicationsTable, type CandidateNote } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import type { CandidateVisibilityContext } from "./candidates";

export class InvalidCandidateNoteError extends Error {}

/**
 * Owner decision (2026-09-15): recruiter notes are HR/recruitment material.
 * Being able to SEE a candidate — as a requisition's hiring manager or
 * assigned recruiter — does not open their notes; only organization-wide
 * recruitment authority over candidates (`candidate.manage`, the same signal
 * resolveCandidateVisibilityContext uses) does. The assigned tier is
 * deliberately not honoured here: this platform has no recruiter role, and
 * visibility treats recruiter and hiring manager identically, so an
 * assignment alone cannot distinguish recruitment staff from line managers.
 * Applies to reads and writes alike, so nobody writes notes they cannot read.
 */
export function canAccessCandidateNotes(visibility: CandidateVisibilityContext): boolean {
  return visibility.isOrgWide;
}

export async function listCandidateNotes(organizationId: number, candidateId: number): Promise<CandidateNote[]> {
  return db
    .select()
    .from(candidateNotesTable)
    .where(and(eq(candidateNotesTable.organizationId, organizationId), eq(candidateNotesTable.candidateId, candidateId)))
    .orderBy(desc(candidateNotesTable.createdAt));
}

export async function createCandidateNote(params: {
  organizationId: number;
  candidateId: number;
  applicationId?: number | null;
  note: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<CandidateNote> {
  if (!params.note.trim()) {
    throw new InvalidCandidateNoteError("note text is required");
  }

  if (params.applicationId != null) {
    const [application] = await db
      .select()
      .from(applicationsTable)
      .where(and(eq(applicationsTable.id, params.applicationId), eq(applicationsTable.organizationId, params.organizationId)))
      .limit(1);
    if (!application || application.candidateId !== params.candidateId) {
      throw new InvalidCandidateNoteError("applicationId does not belong to this candidate");
    }
  }

  const [row] = await db
    .insert(candidateNotesTable)
    .values({
      organizationId: params.organizationId,
      candidateId: params.candidateId,
      applicationId: params.applicationId ?? null,
      authorMembershipId: params.actorMembershipId,
      note: params.note,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "candidate_note.created",
    targetType: "candidate",
    targetId: String(params.candidateId),
    afterState: { noteId: row.id, applicationId: row.applicationId },
  });

  return row;
}
