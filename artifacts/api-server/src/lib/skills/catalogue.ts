import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  skillsTable,
  proficiencyScalesTable,
  proficiencyLevelsTable,
  masterDataItemsTable,
  type Skill,
  type ProficiencyScale,
  type ProficiencyLevel,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-14 — the Skills catalogue and the proficiency scale (§30.2–30.4).
 *
 * THE MASTER DATA `skill` DOMAIN IS READ, NEVER WRITTEN OR WIDENED (§30.4).
 * `master_data_items` is shared by 25 other domains, so this module imports
 * FROM it and leaves it exactly as it is. The import is idempotent through
 * `sourceMasterDataCode`: running it twice finds the existing skill rather than
 * creating a second one, the same guarantee §26 demanded of the onboarding
 * handoff.
 */

export class SkillNotFoundError extends Error {
  constructor() {
    super("Skill not found");
    this.name = "SkillNotFoundError";
  }
}

export class InvalidSkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSkillError";
  }
}

export class ScaleNotFoundError extends Error {
  constructor() {
    super("Proficiency scale not found");
    this.name = "ScaleNotFoundError";
  }
}

export class InvalidScaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidScaleError";
  }
}

export class DuplicateSkillCodeError extends Error {
  constructor(code: string) {
    super(`A skill with code "${code}" already exists in this organization.`);
    this.name = "DuplicateSkillCodeError";
  }
}

/** SQLSTATE 23505 arrives on `cause` because drizzle wraps the driver error. */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function listSkills(
  organizationId: number,
  filters: { activeOnly?: boolean; category?: Skill["category"] } = {},
): Promise<Skill[]> {
  const predicates = [eq(skillsTable.organizationId, organizationId)];
  if (filters.activeOnly) predicates.push(eq(skillsTable.active, true));
  if (filters.category) predicates.push(eq(skillsTable.category, filters.category));
  return db
    .select()
    .from(skillsTable)
    .where(and(...predicates))
    .orderBy(skillsTable.name);
}

export async function getSkill(organizationId: number, skillId: number): Promise<Skill | undefined> {
  const [row] = await db
    .select()
    .from(skillsTable)
    .where(and(eq(skillsTable.id, skillId), eq(skillsTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function createSkill(params: {
  organizationId: number;
  code: string;
  name: string;
  description?: string | null;
  category?: Skill["category"];
  proficiencyApplicable?: boolean;
  evidenceExpected?: boolean;
  certificationApplicable?: boolean;
  sourceMasterDataCode?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Skill> {
  if (!params.code.trim()) throw new InvalidSkillError("A stable code is required.");
  if (!params.name.trim()) throw new InvalidSkillError("A name is required.");

  try {
    const [created] = await db
      .insert(skillsTable)
      .values({
        organizationId: params.organizationId,
        code: params.code.trim(),
        name: params.name.trim(),
        description: params.description ?? null,
        category: params.category ?? "technical",
        proficiencyApplicable: params.proficiencyApplicable ?? true,
        evidenceExpected: params.evidenceExpected ?? false,
        certificationApplicable: params.certificationApplicable ?? false,
        sourceMasterDataCode: params.sourceMasterDataCode ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "skill.created",
      targetType: "skill",
      targetId: String(created!.id),
      afterState: { code: created!.code, name: created!.name, category: created!.category },
    });
    return created!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateSkillCodeError(params.code.trim());
    throw err;
  }
}

export async function updateSkill(params: {
  organizationId: number;
  skillId: number;
  name?: string;
  description?: string | null;
  category?: Skill["category"];
  active?: boolean;
  proficiencyApplicable?: boolean;
  evidenceExpected?: boolean;
  certificationApplicable?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<Skill> {
  const before = await getSkill(params.organizationId, params.skillId);
  if (!before) throw new SkillNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) {
    if (!params.name.trim()) throw new InvalidSkillError("A name is required.");
    patch.name = params.name.trim();
  }
  if (params.description !== undefined) patch.description = params.description;
  if (params.category !== undefined) patch.category = params.category;
  if (params.active !== undefined) patch.active = params.active;
  if (params.proficiencyApplicable !== undefined) patch.proficiencyApplicable = params.proficiencyApplicable;
  if (params.evidenceExpected !== undefined) patch.evidenceExpected = params.evidenceExpected;
  if (params.certificationApplicable !== undefined) patch.certificationApplicable = params.certificationApplicable;

  const [updated] = await db
    .update(skillsTable)
    .set(patch)
    .where(and(eq(skillsTable.id, params.skillId), eq(skillsTable.organizationId, params.organizationId)))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: params.active === false ? "skill.deactivated" : "skill.updated",
    targetType: "skill",
    targetId: String(params.skillId),
    beforeState: { name: before.name, category: before.category, active: before.active },
    afterState: { name: updated!.name, category: updated!.category, active: updated!.active },
  });

  return updated!;
}

/**
 * Imports the organization's existing `skill` Master Data items into the typed
 * catalogue (§30.4).
 *
 * IDEMPOTENT BY CONSTRUCTION. It matches on `sourceMasterDataCode`, so a second
 * run creates nothing and reports what it skipped. Master Data itself is only
 * READ — the domain and its items are left exactly as they are, because they
 * belong to a table 25 other domains share.
 */
export async function importFromMasterData(params: {
  organizationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ imported: number; skipped: number; skills: Skill[] }> {
  const items = await db
    .select({ code: masterDataItemsTable.code, label: masterDataItemsTable.label })
    .from(masterDataItemsTable)
    .where(
      and(eq(masterDataItemsTable.domain, "skill"), eq(masterDataItemsTable.organizationId, params.organizationId)),
    );
  if (items.length === 0) return { imported: 0, skipped: 0, skills: [] };

  const existing = await db
    .select({ code: skillsTable.code, sourceMasterDataCode: skillsTable.sourceMasterDataCode })
    .from(skillsTable)
    .where(eq(skillsTable.organizationId, params.organizationId));
  const taken = new Set<string>();
  for (const row of existing) {
    taken.add(row.code);
    if (row.sourceMasterDataCode) taken.add(row.sourceMasterDataCode);
  }

  const created: Skill[] = [];
  let skipped = 0;
  for (const item of items) {
    if (taken.has(item.code)) {
      skipped += 1;
      continue;
    }
    const [row] = await db
      .insert(skillsTable)
      .values({
        organizationId: params.organizationId,
        code: item.code,
        name: item.label || item.code,
        // Imported items carry no category information, so the neutral default
        // is used rather than guessing one.
        category: "other",
        sourceMasterDataCode: item.code,
        createdBy: params.actorApplicationUserId,
      })
      .returning();
    created.push(row!);
    taken.add(item.code);
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "skill.imported_from_master_data",
    targetType: "skill",
    targetId: String(params.organizationId),
    metadata: { imported: created.length, skipped },
  });

  return { imported: created.length, skipped, skills: created };
}

// ---------------------------------------------------------------------------
// Proficiency scale (§30.3)
// ---------------------------------------------------------------------------

export async function getActiveScale(
  organizationId: number,
): Promise<{ scale: ProficiencyScale; levels: ProficiencyLevel[] } | null> {
  const [scale] = await db
    .select()
    .from(proficiencyScalesTable)
    .where(
      and(eq(proficiencyScalesTable.organizationId, organizationId), eq(proficiencyScalesTable.active, true)),
    )
    .limit(1);
  if (!scale) return null;
  const levels = await listLevels(organizationId, scale.id);
  return { scale, levels };
}

export async function listLevels(organizationId: number, scaleId: number): Promise<ProficiencyLevel[]> {
  return db
    .select()
    .from(proficiencyLevelsTable)
    .where(
      and(eq(proficiencyLevelsTable.organizationId, organizationId), eq(proficiencyLevelsTable.scaleId, scaleId)),
    )
    .orderBy(asc(proficiencyLevelsTable.ordinal));
}

export async function getLevel(organizationId: number, levelId: number): Promise<ProficiencyLevel | undefined> {
  const [row] = await db
    .select()
    .from(proficiencyLevelsTable)
    .where(and(eq(proficiencyLevelsTable.id, levelId), eq(proficiencyLevelsTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

/** Resolves several level ids at once, proving every one belongs to this organization. */
export async function getLevels(organizationId: number, levelIds: number[]): Promise<Map<number, ProficiencyLevel>> {
  if (levelIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(proficiencyLevelsTable)
    .where(
      and(eq(proficiencyLevelsTable.organizationId, organizationId), inArray(proficiencyLevelsTable.id, levelIds)),
    );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Creates a scale with its levels in one act.
 *
 * ONE ACTIVE SCALE PER ORGANIZATION is a partial unique index, so creating a
 * second active scale is refused by the database rather than by a check two
 * concurrent requests could both pass. A previous scale is ARCHIVED, never
 * deleted — historical assessments point at its levels, and deleting it would
 * make past judgements unreadable.
 */
export async function createScale(params: {
  organizationId: number;
  name: string;
  description?: string | null;
  levels: Array<{ label: string; description?: string | null }>;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ scale: ProficiencyScale; levels: ProficiencyLevel[] }> {
  if (!params.name.trim()) throw new InvalidScaleError("A scale name is required.");
  if (params.levels.length < 2) throw new InvalidScaleError("A proficiency scale needs at least two levels.");
  if (params.levels.some((l) => !l.label.trim())) throw new InvalidScaleError("Every level needs a label.");

  const result = await db.transaction(async (tx) => {
    // Archive the incumbent first so the partial unique index stays satisfiable.
    await tx
      .update(proficiencyScalesTable)
      .set({ active: false })
      .where(
        and(
          eq(proficiencyScalesTable.organizationId, params.organizationId),
          eq(proficiencyScalesTable.active, true),
        ),
      );

    const [scale] = await tx
      .insert(proficiencyScalesTable)
      .values({
        organizationId: params.organizationId,
        name: params.name.trim(),
        description: params.description ?? null,
        active: true,
        createdBy: params.actorApplicationUserId,
      })
      .returning();

    const levels: ProficiencyLevel[] = [];
    for (const [index, level] of params.levels.entries()) {
      const [row] = await tx
        .insert(proficiencyLevelsTable)
        .values({
          organizationId: params.organizationId,
          scaleId: scale!.id,
          // 1-based, ascending. The ordinal is the comparison key and is never
          // surfaced as an objective competence score (§30.3).
          ordinal: index + 1,
          label: level.label.trim(),
          description: level.description ?? null,
        })
        .returning();
      levels.push(row!);
    }
    return { scale: scale!, levels };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "proficiency_scale.created",
    targetType: "proficiency_scale",
    targetId: String(result.scale.id),
    afterState: { name: result.scale.name, levels: result.levels.map((l) => ({ ordinal: l.ordinal, label: l.label })) },
  });

  return result;
}

/**
 * Relabels an existing level.
 *
 * Labels may change; ORDER MAY NOT. Reordering would silently reinterpret every
 * historical assessment that points at this level — the same "in-flight work
 * must not be rewritten by later configuration" principle §26, §27 and §29 each
 * enforced through snapshots. An organization that needs a different ordering
 * creates a new scale, and the old one is archived intact.
 */
export async function relabelLevel(params: {
  organizationId: number;
  levelId: number;
  label?: string;
  description?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ProficiencyLevel> {
  const before = await getLevel(params.organizationId, params.levelId);
  if (!before) throw new ScaleNotFoundError();

  const patch: Record<string, unknown> = {};
  if (params.label !== undefined) {
    if (!params.label.trim()) throw new InvalidScaleError("A level needs a label.");
    patch.label = params.label.trim();
  }
  if (params.description !== undefined) patch.description = params.description;

  const [updated] = await db
    .update(proficiencyLevelsTable)
    .set(patch)
    .where(
      and(eq(proficiencyLevelsTable.id, params.levelId), eq(proficiencyLevelsTable.organizationId, params.organizationId)),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "proficiency_scale.level_relabelled",
    targetType: "proficiency_scale",
    targetId: String(before.scaleId),
    beforeState: { ordinal: before.ordinal, label: before.label },
    afterState: { ordinal: updated!.ordinal, label: updated!.label },
  });

  return updated!;
}
