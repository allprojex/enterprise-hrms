/**
 * Performance Review Templates (Phase 3C, W74 — Rating Scales & Review
 * Templates): CRUD + competency-set management over W73's schema
 * (docs/PHASE_3C_PERFORMANCE_IMPLEMENTATION_PLAN.md §8.3/§8.4, §27).
 *
 * Historical integrity (§9, "TEMPLATE HISTORICAL INTEGRITY"): unlike
 * rating scales, templates carry **no usage lock** — "Editing an active
 * template only affects reviews created *after* the edit; existing
 * reviews already snapshotted their competencies/weights" (§8.3). A
 * review created from a template (a later workstream) copies competency
 * rows into performance_review_competencies at *creation* time and never
 * re-reads the template afterward — the snapshot, not template
 * immutability, is what protects history. W74 therefore never writes to
 * performance_reviews as a side effect of any template edit.
 *
 * Editing is blocked only while a template's own status is "archived"
 * (archived = retired; reactivate first to keep editing) — a W74-local
 * business rule, not itself specified by the frozen plan, chosen for
 * consistency with every other "archived means retired" resource on this
 * platform (leave_types, positions, ...); flagged as an interpretation in
 * this workstream's own report.
 *
 * Audit: `performance_review_template.created` / `.updated` / `.archived`
 * per §22's own exhaustive list — `.updated` fires for any base-field
 * PATCH or any competency-set replacement (there is no separate
 * competency-specific event name in the frozen list).
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  performanceReviewTemplatesTable,
  performanceTemplateCompetenciesTable,
  type PerformanceReviewTemplate,
  type PerformanceTemplateCompetency,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization } from "./orgScopedRefs";
import { performanceRatingScalesTable } from "@workspace/db";

export class PerformanceReviewTemplateNotFoundError extends Error {
  constructor() {
    super("Review template not found");
    this.name = "PerformanceReviewTemplateNotFoundError";
  }
}

export class InvalidPerformanceReviewTemplateError extends Error {}

export class PerformanceReviewTemplateArchivedError extends Error {
  constructor() {
    super("This template is archived and cannot be edited — reactivate it first");
    this.name = "PerformanceReviewTemplateArchivedError";
  }
}

async function findOwnTemplate(organizationId: number, templateId: number) {
  const [row] = await db
    .select()
    .from(performanceReviewTemplatesTable)
    .where(and(eq(performanceReviewTemplatesTable.id, templateId), eq(performanceReviewTemplatesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function listCompetencies(templateId: number): Promise<PerformanceTemplateCompetency[]> {
  return db
    .select()
    .from(performanceTemplateCompetenciesTable)
    .where(eq(performanceTemplateCompetenciesTable.templateId, templateId))
    .orderBy(performanceTemplateCompetenciesTable.sortOrder);
}

export async function listReviewTemplates(organizationId: number): Promise<PerformanceReviewTemplate[]> {
  return db.select().from(performanceReviewTemplatesTable).where(eq(performanceReviewTemplatesTable.organizationId, organizationId));
}

export async function getReviewTemplateWithCompetencies(
  organizationId: number,
  templateId: number,
): Promise<{ template: PerformanceReviewTemplate; competencies: PerformanceTemplateCompetency[] } | null> {
  const template = await findOwnTemplate(organizationId, templateId);
  if (!template) return null;
  const competencies = await listCompetencies(templateId);
  return { template, competencies };
}

function validateWeights(goalsWeight: number, competenciesWeight: number): void {
  if (goalsWeight + competenciesWeight !== 100) {
    throw new InvalidPerformanceReviewTemplateError("goalsWeight and competenciesWeight must sum to exactly 100");
  }
  if (goalsWeight < 0 || competenciesWeight < 0) {
    throw new InvalidPerformanceReviewTemplateError("goalsWeight and competenciesWeight must not be negative");
  }
}

export async function createReviewTemplate(params: {
  organizationId: number;
  name: string;
  description?: string;
  ratingScaleId: number;
  goalsWeight: number;
  competenciesWeight: number;
  applicabilityScope: "all_active" | "department" | "position" | "manual";
  applicabilityDepartmentIds?: number[];
  applicabilityPositionIds?: number[];
  status?: "draft" | "active" | "archived";
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PerformanceReviewTemplate> {
  validateWeights(params.goalsWeight, params.competenciesWeight);
  await assertBelongsToOrganization(performanceRatingScalesTable, params.ratingScaleId, params.organizationId, "Rating scale");

  const [template] = await db
    .insert(performanceReviewTemplatesTable)
    .values({
      organizationId: params.organizationId,
      name: params.name,
      description: params.description ?? null,
      ratingScaleId: params.ratingScaleId,
      goalsWeight: params.goalsWeight,
      competenciesWeight: params.competenciesWeight,
      applicabilityScope: params.applicabilityScope,
      applicabilityDepartmentIds: params.applicabilityDepartmentIds ?? null,
      applicabilityPositionIds: params.applicabilityPositionIds ?? null,
      status: params.status ?? "draft",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review_template.created",
    targetType: "performance_review_template",
    targetId: String(template.id),
    afterState: { name: template.name, status: template.status, ratingScaleId: template.ratingScaleId },
  });

  return template;
}

export async function updateReviewTemplate(params: {
  organizationId: number;
  templateId: number;
  name?: string;
  description?: string;
  ratingScaleId?: number;
  goalsWeight?: number;
  competenciesWeight?: number;
  applicabilityScope?: "all_active" | "department" | "position" | "manual";
  applicabilityDepartmentIds?: number[];
  applicabilityPositionIds?: number[];
  status?: "draft" | "active" | "archived";
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PerformanceReviewTemplate> {
  const before = await findOwnTemplate(params.organizationId, params.templateId);
  if (!before) throw new PerformanceReviewTemplateNotFoundError();

  // Archived templates require reactivation first — except the one PATCH
  // that reactivates them.
  const reactivating = params.status !== undefined && params.status !== "archived";
  if (before.status === "archived" && !reactivating) {
    throw new PerformanceReviewTemplateArchivedError();
  }

  const nextGoalsWeight = params.goalsWeight ?? before.goalsWeight;
  const nextCompetenciesWeight = params.competenciesWeight ?? before.competenciesWeight;
  if (params.goalsWeight !== undefined || params.competenciesWeight !== undefined) {
    validateWeights(nextGoalsWeight, nextCompetenciesWeight);
  }
  if (params.ratingScaleId !== undefined) {
    await assertBelongsToOrganization(performanceRatingScalesTable, params.ratingScaleId, params.organizationId, "Rating scale");
  }

  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.ratingScaleId !== undefined) patch.ratingScaleId = params.ratingScaleId;
  if (params.goalsWeight !== undefined) patch.goalsWeight = params.goalsWeight;
  if (params.competenciesWeight !== undefined) patch.competenciesWeight = params.competenciesWeight;
  if (params.applicabilityScope !== undefined) patch.applicabilityScope = params.applicabilityScope;
  if (params.applicabilityDepartmentIds !== undefined) patch.applicabilityDepartmentIds = params.applicabilityDepartmentIds;
  if (params.applicabilityPositionIds !== undefined) patch.applicabilityPositionIds = params.applicabilityPositionIds;
  if (params.status !== undefined) patch.status = params.status;
  patch.updatedAt = new Date();

  const [updated] = await db
    .update(performanceReviewTemplatesTable)
    .set(patch)
    .where(eq(performanceReviewTemplatesTable.id, params.templateId))
    .returning();

  const nowArchived = params.status === "archived" && before.status !== "archived";
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: nowArchived ? "performance_review_template.archived" : "performance_review_template.updated",
    targetType: "performance_review_template",
    targetId: String(params.templateId),
    beforeState: { name: before.name, status: before.status, ratingScaleId: before.ratingScaleId },
    afterState: { name: updated.name, status: updated.status, ratingScaleId: updated.ratingScaleId },
  });

  return updated;
}

export interface TemplateCompetencyInput {
  label: string;
  description?: string;
  weight: number;
  sortOrder: number;
}

function validateCompetencies(competencies: TemplateCompetencyInput[], competenciesWeight: number): void {
  if (competenciesWeight === 0) {
    if (competencies.length > 0) {
      throw new InvalidPerformanceReviewTemplateError("competenciesWeight is 0 for this template — no competencies may be configured");
    }
    return;
  }
  if (competencies.length === 0) {
    throw new InvalidPerformanceReviewTemplateError("At least one competency is required when competenciesWeight is greater than 0");
  }
  const seenOrders = new Set<number>();
  let total = 0;
  for (const competency of competencies) {
    if (!competency.label || !competency.label.trim()) {
      throw new InvalidPerformanceReviewTemplateError("Every competency requires a non-empty label");
    }
    if (competency.weight < 0) {
      throw new InvalidPerformanceReviewTemplateError("Competency weight must not be negative");
    }
    if (seenOrders.has(competency.sortOrder)) {
      throw new InvalidPerformanceReviewTemplateError(`Duplicate competency sortOrder: ${competency.sortOrder}`);
    }
    seenOrders.add(competency.sortOrder);
    total += competency.weight;
  }
  if (total !== 100) {
    throw new InvalidPerformanceReviewTemplateError("Competency weights must sum to exactly 100");
  }
}

/** Replace-all semantics — always permitted while the template itself is not archived (no usage lock on templates, see file header). */
export async function replaceTemplateCompetencies(params: {
  organizationId: number;
  templateId: number;
  competencies: TemplateCompetencyInput[];
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PerformanceTemplateCompetency[]> {
  const template = await findOwnTemplate(params.organizationId, params.templateId);
  if (!template) throw new PerformanceReviewTemplateNotFoundError();
  if (template.status === "archived") throw new PerformanceReviewTemplateArchivedError();

  validateCompetencies(params.competencies, template.competenciesWeight);

  const inserted = await db.transaction(async (tx) => {
    await tx.delete(performanceTemplateCompetenciesTable).where(eq(performanceTemplateCompetenciesTable.templateId, params.templateId));
    if (params.competencies.length === 0) return [];
    return tx
      .insert(performanceTemplateCompetenciesTable)
      .values(
        params.competencies.map((c) => ({
          templateId: params.templateId,
          label: c.label,
          description: c.description ?? null,
          weight: c.weight,
          sortOrder: c.sortOrder,
        })),
      )
      .returning();
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "performance_review_template.updated",
    targetType: "performance_review_template",
    targetId: String(params.templateId),
    metadata: { competencyCount: inserted.length },
  });

  return inserted.sort((a, b) => a.sortOrder - b.sortOrder);
}
