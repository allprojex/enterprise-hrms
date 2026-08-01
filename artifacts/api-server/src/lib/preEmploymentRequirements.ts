/**
 * Pre-Employment Requirements (Phase 3A, W58): a checklist tracked against
 * an application before convert-to-employee
 * (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9/§13). This
 * workstream only tracks completion status — it never creates an
 * employee, activates payroll/leave/attendance/HR records, or creates an
 * organization membership; §13's own `convert-to-employee` (a later
 * workstream, W59) is the only thing that ever reads this table to decide
 * readiness, and it does so by re-querying these rows itself, not by
 * calling anything exported here.
 *
 * No dedicated `pre_employment_requirement.*` permission exists in §7's
 * matrix at all (no row for this resource whatsoever) — reuses the
 * existing `application.read`/`.manage` pair, the same precedent W56's
 * reference_checks already established for an identical "org-scoped (via
 * application)" RLS descriptor and comparably low sensitivity (§9 marks
 * this row's sensitive-data column "none directly", reference_checks'
 * reads "referee PII"). Reuses `applicationPipeline.ts`'s own visibility
 * resolver directly rather than re-deriving the candidate->vacancy->
 * requisition chain a second time.
 *
 * Status model: §9's own table marks this resource's "status derivation"
 * column "n/a" — unlike reference_checks/background_checks, which cite
 * §4.7's one-way lifecycle diagram, no such diagram exists here. Status is
 * therefore freely settable between pending/satisfied/waived (a checklist
 * correction — e.g. reverting a mistaken "satisfied" back to "pending" —
 * is not forbidden), a deliberate difference from reference/background
 * checks' terminal-once-decided immutability. `satisfiedAt` reflects only
 * the most recent transition into "satisfied" — set when the status
 * becomes "satisfied", cleared whenever it becomes anything else, so it
 * never lingers as stale evidence of a since-reverted decision.
 *
 * Documents: the frozen §9 row has no document/storageKey column at all
 * (unlike e.g. background_checks' own `documentStorageKey`) and no
 * internal candidate-document-upload route exists yet in this codebase
 * (§10's `GET/POST/DELETE .../candidates/:id/documents` line is not part
 * of this workstream's own `Scope:` — it names only
 * `pre_employment_requirements`). This workstream therefore builds no
 * document upload/storage mechanism at all — a deliberate scope boundary,
 * not an oversight. Any supporting evidence a candidate already uploaded
 * during application (W49's `candidate_documents`) remains visible via the
 * application detail's existing `documents` list (W51) without this
 * resource owning or referencing any storage key itself.
 */
import { and, eq } from "drizzle-orm";
import { db, preEmploymentRequirementsTable, type PreEmploymentRequirement } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { getVisibleApplicationById, type ApplicationVisibilityContext } from "./applicationPipeline";
import { isUniqueViolation } from "./dbErrors";

export class ApplicationNotFoundForRequirementError extends Error {
  constructor() {
    super("Application not found");
    this.name = "ApplicationNotFoundForRequirementError";
  }
}

export class PreEmploymentRequirementNotFoundError extends Error {
  constructor() {
    super("Pre-employment requirement not found");
    this.name = "PreEmploymentRequirementNotFoundError";
  }
}

export class InvalidPreEmploymentRequirementError extends Error {}

export class DuplicatePreEmploymentRequirementError extends Error {
  constructor() {
    super("This requirement is already tracked for this application");
    this.name = "DuplicatePreEmploymentRequirementError";
  }
}

export type PreEmploymentRequirementStatus = "pending" | "satisfied" | "waived";

async function assertApplicationVisible(organizationId: number, applicationId: number, visibility: ApplicationVisibilityContext): Promise<void> {
  const application = await getVisibleApplicationById(organizationId, applicationId, visibility);
  if (!application) throw new ApplicationNotFoundForRequirementError();
}

async function findOwnRequirement(organizationId: number, requirementId: number): Promise<PreEmploymentRequirement | null> {
  const [row] = await db
    .select()
    .from(preEmploymentRequirementsTable)
    .where(and(eq(preEmploymentRequirementsTable.id, requirementId), eq(preEmploymentRequirementsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export interface PreEmploymentRequirementSummary {
  totalCount: number;
  pendingCount: number;
  satisfiedCount: number;
  waivedCount: number;
  /** Mirrors §13's own convert-to-employee readiness rule exactly ("every non-waived row is satisfied") — computed on every read, never stored, the same discipline as W52's scoreRollup/W55's panelSummary. Vacuously true when no requirements are tracked at all. */
  readyForConversion: boolean;
}

function computeSummary(items: PreEmploymentRequirement[]): PreEmploymentRequirementSummary {
  const pendingCount = items.filter((r) => r.status === "pending").length;
  const satisfiedCount = items.filter((r) => r.status === "satisfied").length;
  const waivedCount = items.filter((r) => r.status === "waived").length;
  return {
    totalCount: items.length,
    pendingCount,
    satisfiedCount,
    waivedCount,
    readyForConversion: items.every((r) => r.status === "waived" || r.status === "satisfied"),
  };
}

export async function listPreEmploymentRequirements(params: {
  organizationId: number;
  applicationId: number;
  visibility: ApplicationVisibilityContext;
}): Promise<{ items: PreEmploymentRequirement[]; summary: PreEmploymentRequirementSummary }> {
  await assertApplicationVisible(params.organizationId, params.applicationId, params.visibility);
  const items = await db
    .select()
    .from(preEmploymentRequirementsTable)
    .where(and(eq(preEmploymentRequirementsTable.organizationId, params.organizationId), eq(preEmploymentRequirementsTable.applicationId, params.applicationId)));
  return { items, summary: computeSummary(items) };
}

export async function createPreEmploymentRequirement(params: {
  organizationId: number;
  applicationId: number;
  visibility: ApplicationVisibilityContext;
  requirementCode: string;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PreEmploymentRequirement> {
  await assertApplicationVisible(params.organizationId, params.applicationId, params.visibility);

  const requirementCode = params.requirementCode.trim();
  if (!requirementCode) {
    throw new InvalidPreEmploymentRequirementError("requirementCode is required");
  }

  try {
    const [row] = await db
      .insert(preEmploymentRequirementsTable)
      .values({
        organizationId: params.organizationId,
        applicationId: params.applicationId,
        requirementCode,
        notes: params.notes ?? null,
        status: "pending",
      })
      .returning();

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "pre_employment_requirement.created",
      targetType: "pre_employment_requirement",
      targetId: String(row.id),
      afterState: { applicationId: row.applicationId, requirementCode: row.requirementCode, status: row.status },
    });

    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicatePreEmploymentRequirementError();
    throw err;
  }
}

export async function updatePreEmploymentRequirementStatus(params: {
  organizationId: number;
  applicationId: number;
  requirementId: number;
  visibility: ApplicationVisibilityContext;
  status: PreEmploymentRequirementStatus;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PreEmploymentRequirement> {
  await assertApplicationVisible(params.organizationId, params.applicationId, params.visibility);

  const before = await findOwnRequirement(params.organizationId, params.requirementId);
  if (!before || before.applicationId !== params.applicationId) throw new PreEmploymentRequirementNotFoundError();

  const patch: Record<string, unknown> = {
    status: params.status,
    satisfiedAt: params.status === "satisfied" ? new Date() : null,
  };
  if (params.notes !== undefined) patch.notes = params.notes;

  const [updated] = await db.update(preEmploymentRequirementsTable).set(patch).where(eq(preEmploymentRequirementsTable.id, params.requirementId)).returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "pre_employment_requirement.status_changed",
    targetType: "pre_employment_requirement",
    targetId: String(params.requirementId),
    beforeState: { status: before.status },
    afterState: { status: updated.status },
  });

  return updated;
}
