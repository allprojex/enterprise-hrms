/**
 * Application Scoring (Phase 3A, W52 — Screening Questions & Scoring):
 * append-only scoring entries against an application
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9/§12). Distinct from
 * W51's pipeline movement — scoring evaluates an application, it never
 * changes its stage — so it's gated by `application.manage` (already named
 * in the frozen §7 permission matrix, just unused until now), not
 * `application.pipeline.move`.
 *
 * `applications.score` (defined since W49, always null) is never written
 * to by anything here — §12 is explicit that it "is a computed,
 * non-authoritative rollup ... recomputed from application_scores on read,
 * not trusted as stored state," mirroring `leave_balance_entries`' ledger
 * precedent (a balance is reconstructed live, never stored). This module's
 * rollup is a response-shaping concern only, never persisted.
 *
 * Deliberately never imports from applicationPipeline.ts (which itself
 * imports this module's rollup helpers for the detail DTO) — mirrors
 * requisitionApprovals.ts's exact precedent for keeping the two files'
 * mutual dependency one-directional rather than circular. A distinct
 * not-found error is defined here for that reason; the route layer catches
 * both as 404.
 */
import { and, eq, desc } from "drizzle-orm";
import { db, applicationScoresTable, applicationsTable, type ApplicationScore } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class ApplicationScoreTargetNotFoundError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationScoreTargetNotFoundError";
  }
}

export class InvalidApplicationScoreError extends Error {}

async function findApplicationInOrg(organizationId: number, applicationId: number) {
  const [row] = await db
    .select()
    .from(applicationsTable)
    .where(and(eq(applicationsTable.id, applicationId), eq(applicationsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function submitApplicationScore(params: {
  organizationId: number;
  applicationId: number;
  scoreType: ApplicationScore["scoreType"];
  score: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ApplicationScore> {
  const application = await findApplicationInOrg(params.organizationId, params.applicationId);
  if (!application) throw new ApplicationScoreTargetNotFoundError();
  if (!Number.isFinite(params.score)) {
    throw new InvalidApplicationScoreError("score must be a finite number");
  }

  const [row] = await db
    .insert(applicationScoresTable)
    .values({
      organizationId: params.organizationId,
      applicationId: params.applicationId,
      scoredByMembershipId: params.actorMembershipId,
      scoreType: params.scoreType,
      score: String(params.score),
      notes: params.notes ?? null,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "application.scored",
    targetType: "application",
    targetId: String(params.applicationId),
    afterState: { scoreType: params.scoreType, score: params.score },
  });

  return row;
}

export async function listApplicationScores(organizationId: number, applicationId: number): Promise<ApplicationScore[]> {
  return db
    .select()
    .from(applicationScoresTable)
    .where(and(eq(applicationScoresTable.organizationId, organizationId), eq(applicationScoresTable.applicationId, applicationId)))
    .orderBy(desc(applicationScoresTable.createdAt));
}

/**
 * The latest entry per scoreType, then a single overall rollup: an
 * explicit "overall" entry wins outright if one exists; otherwise the
 * average of whichever of screening/interview have a latest entry. Null
 * when no scores exist at all — never a fabricated zero.
 */
export function computeScoreRollup(scores: ApplicationScore[]): number | null {
  const latestByType = new Map<ApplicationScore["scoreType"], ApplicationScore>();
  // `scores` is expected newest-first (see listApplicationScores) — the
  // first row seen per type is therefore its latest.
  for (const s of scores) {
    if (!latestByType.has(s.scoreType)) latestByType.set(s.scoreType, s);
  }

  const overall = latestByType.get("overall");
  if (overall) return Number(overall.score);

  const componentValues = [latestByType.get("screening"), latestByType.get("interview")]
    .filter((s): s is ApplicationScore => !!s)
    .map((s) => Number(s.score));
  if (componentValues.length === 0) return null;
  return componentValues.reduce((sum, v) => sum + v, 0) / componentValues.length;
}
