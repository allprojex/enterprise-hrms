/**
 * Performance Rating Scales (Phase 3C, W74 — Rating Scales & Review
 * Templates): CRUD + ordered-level management over W73's schema
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.1/§8.2, §27).
 * Mirrors leaveTypes.ts's shape (organization-owned, archive via status,
 * no hard delete — §27's own "no DELETE on any instance-level record").
 *
 * Historical integrity (§9, §26): a scale's *levels* become structurally
 * immutable once any performance_reviews row references the scale — never
 * once a template merely references it, since a template only snapshots a
 * scale's levels into a review at review-*creation* time (a later
 * workstream); referencing a scale from a template is just configuration,
 * not yet a captured historical fact. The scale's own name/description
 * remain always editable (cosmetic, no scoring impact) and status may
 * always move to/from "archived" — only the level *set* (values, labels,
 * ordering, count) is locked once used. No stored `usageCount` column —
 * "used" is derived live from performance_reviews, matching
 * leave_balance_entries' "reconstructed live, never stored" discipline.
 *
 * Audit: only `performance_rating_scale.created`/`.archived` are in the
 * frozen plan's own exhaustive §22 event list — unlike review templates,
 * there is deliberately no `.updated` event for scales (name/description/
 * level edits emit no audit event), followed here literally rather than
 * inventing one the frozen plan doesn't name.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  performanceRatingScalesTable,
  performanceRatingScaleLevelsTable,
  performanceReviewsTable,
  type PerformanceRatingScale,
  type PerformanceRatingScaleLevel,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class PerformanceRatingScaleNotFoundError extends Error {
  constructor() {
    super("Rating scale not found");
    this.name = "PerformanceRatingScaleNotFoundError";
  }
}

export class InvalidPerformanceRatingScaleLevelsError extends Error {}

export class PerformanceRatingScaleLevelsLockedError extends Error {
  constructor() {
    super("This rating scale's levels can no longer be edited because it has already been used by a review — archive it and create a new scale instead");
    this.name = "PerformanceRatingScaleLevelsLockedError";
  }
}

async function findOwnRatingScale(organizationId: number, ratingScaleId: number) {
  const [row] = await db
    .select()
    .from(performanceRatingScalesTable)
    .where(and(eq(performanceRatingScalesTable.id, ratingScaleId), eq(performanceRatingScalesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listRatingScales(organizationId: number): Promise<PerformanceRatingScale[]> {
  return db.select().from(performanceRatingScalesTable).where(eq(performanceRatingScalesTable.organizationId, organizationId));
}

async function listLevels(ratingScaleId: number): Promise<PerformanceRatingScaleLevel[]> {
  return db
    .select()
    .from(performanceRatingScaleLevelsTable)
    .where(eq(performanceRatingScaleLevelsTable.ratingScaleId, ratingScaleId))
    .orderBy(performanceRatingScaleLevelsTable.sortOrder);
}

export async function getRatingScaleWithLevels(
  organizationId: number,
  ratingScaleId: number,
): Promise<{ scale: PerformanceRatingScale; levels: PerformanceRatingScaleLevel[]; levelsLocked: boolean } | null> {
  const scale = await findOwnRatingScale(organizationId, ratingScaleId);
  if (!scale) return null;
  const [levels, levelsLocked] = await Promise.all([listLevels(ratingScaleId), isRatingScaleUsed(organizationId, ratingScaleId)]);
  return { scale, levels, levelsLocked };
}

/** "Used" = referenced by at least one performance_reviews row — never a template/cycle reference alone (see file header). */
export async function isRatingScaleUsed(organizationId: number, ratingScaleId: number): Promise<boolean> {
  const rows = await db
    .select({ id: performanceReviewsTable.id })
    .from(performanceReviewsTable)
    .where(and(eq(performanceReviewsTable.organizationId, organizationId), eq(performanceReviewsTable.ratingScaleId, ratingScaleId)))
    .limit(1);
  return rows.length > 0;
}

export async function createRatingScale(params: {
  organizationId: number;
  name: string;
  description?: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PerformanceRatingScale> {
  const [scale] = await db
    .insert(performanceRatingScalesTable)
    .values({ organizationId: params.organizationId, name: params.name, description: params.description ?? null })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_rating_scale.created",
    targetType: "performance_rating_scale",
    targetId: String(scale.id),
    afterState: { name: scale.name, status: scale.status },
  });

  return scale;
}

export async function updateRatingScale(params: {
  organizationId: number;
  ratingScaleId: number;
  name?: string;
  description?: string;
  status?: "active" | "archived";
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PerformanceRatingScale> {
  const before = await findOwnRatingScale(params.organizationId, params.ratingScaleId);
  if (!before) throw new PerformanceRatingScaleNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.status !== undefined) patch.status = params.status;

  const [updated] = await db
    .update(performanceRatingScalesTable)
    .set(patch)
    .where(eq(performanceRatingScalesTable.id, params.ratingScaleId))
    .returning();

  // Only a genuine transition into "archived" is audited, matching §22's
  // exhaustive two-event list for this table (no generic ".updated").
  if (params.status === "archived" && before.status !== "archived") {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "performance_rating_scale.archived",
      targetType: "performance_rating_scale",
      targetId: String(params.ratingScaleId),
      beforeState: { status: before.status },
      afterState: { status: updated.status },
    });
  }

  return updated;
}

export interface RatingScaleLevelInput {
  value: number;
  label: string;
  description?: string;
  sortOrder: number;
}

function validateLevels(levels: RatingScaleLevelInput[]): void {
  if (levels.length === 0) {
    throw new InvalidPerformanceRatingScaleLevelsError("At least one level is required");
  }
  const seenValues = new Set<number>();
  const seenOrders = new Set<number>();
  for (const level of levels) {
    if (!level.label || !level.label.trim()) {
      throw new InvalidPerformanceRatingScaleLevelsError("Every level requires a non-empty label");
    }
    if (seenValues.has(level.value)) {
      throw new InvalidPerformanceRatingScaleLevelsError(`Duplicate level value: ${level.value}`);
    }
    seenValues.add(level.value);
    if (seenOrders.has(level.sortOrder)) {
      throw new InvalidPerformanceRatingScaleLevelsError(`Duplicate level sortOrder: ${level.sortOrder}`);
    }
    seenOrders.add(level.sortOrder);
    if (level.sortOrder < 0) {
      throw new InvalidPerformanceRatingScaleLevelsError("sortOrder must not be negative");
    }
  }
}

/** Replace-all semantics — the full level set is validated and swapped atomically. Blocked entirely once the scale is used by any review. */
export async function replaceRatingScaleLevels(params: {
  organizationId: number;
  ratingScaleId: number;
  levels: RatingScaleLevelInput[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PerformanceRatingScaleLevel[]> {
  const scale = await findOwnRatingScale(params.organizationId, params.ratingScaleId);
  if (!scale) throw new PerformanceRatingScaleNotFoundError();

  if (await isRatingScaleUsed(params.organizationId, params.ratingScaleId)) {
    throw new PerformanceRatingScaleLevelsLockedError();
  }

  validateLevels(params.levels);

  return db.transaction(async (tx) => {
    await tx.delete(performanceRatingScaleLevelsTable).where(eq(performanceRatingScaleLevelsTable.ratingScaleId, params.ratingScaleId));
    const inserted = await tx
      .insert(performanceRatingScaleLevelsTable)
      .values(
        params.levels.map((level) => ({
          ratingScaleId: params.ratingScaleId,
          value: level.value.toString(),
          label: level.label,
          description: level.description ?? null,
          sortOrder: level.sortOrder,
        })),
      )
      .returning();
    return inserted.sort((a, b) => a.sortOrder - b.sortOrder);
  });
}

