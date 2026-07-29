/**
 * Recruitment Settings (Phase 3A, W44): one validated row per organization.
 * Mirrors organizationConfig.ts's "no row is created on read, safe defaults
 * returned instead" behavior, but against a dedicated table rather than the
 * generic JSON-namespace engine (see recruitment-settings.ts for why).
 */
import { eq } from "drizzle-orm";
import { db, recruitmentSettingsTable, type RecruitmentSettings } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";
import { recruitmentWorkflowsTable } from "@workspace/db";

export class InvalidRecruitmentSettingsError extends Error {}
export { CrossOrganizationReferenceError };

export interface RecruitmentSettingsView {
  organizationId: number;
  enabled: boolean;
  internalRecruitmentEnabled: boolean;
  externalRecruitmentEnabled: boolean;
  requireCandidateAccount: boolean;
  defaultWorkflowId: number | null;
  candidateDataRetentionMonths: number | null;
  reapplicationWaitingDays: number;
  duplicateCandidatePolicy: "allow" | "flag" | "block";
  defaultOfferExpiryDays: number | null;
  defaultDocumentRequirements: string[];
  applicationLimitPerCandidate: number | null;
  updatedAt: Date | null;
}

const DEFAULTS: Omit<RecruitmentSettingsView, "organizationId" | "updatedAt"> = {
  enabled: false,
  internalRecruitmentEnabled: true,
  externalRecruitmentEnabled: true,
  requireCandidateAccount: false,
  defaultWorkflowId: null,
  candidateDataRetentionMonths: null,
  reapplicationWaitingDays: 0,
  duplicateCandidatePolicy: "flag",
  defaultOfferExpiryDays: null,
  defaultDocumentRequirements: [],
  applicationLimitPerCandidate: null,
};

export interface RecruitmentSettingsPatch {
  enabled?: boolean;
  internalRecruitmentEnabled?: boolean;
  externalRecruitmentEnabled?: boolean;
  requireCandidateAccount?: boolean;
  defaultWorkflowId?: number | null;
  candidateDataRetentionMonths?: number | null;
  reapplicationWaitingDays?: number;
  duplicateCandidatePolicy?: "allow" | "flag" | "block";
  defaultOfferExpiryDays?: number | null;
  defaultDocumentRequirements?: string[];
  applicationLimitPerCandidate?: number | null;
}

async function findSettingsRow(organizationId: number): Promise<RecruitmentSettings | null> {
  const [row] = await db
    .select()
    .from(recruitmentSettingsTable)
    .where(eq(recruitmentSettingsTable.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

function toView(row: RecruitmentSettings | null, organizationId: number): RecruitmentSettingsView {
  if (!row) return { organizationId, ...DEFAULTS, updatedAt: null };
  return {
    organizationId,
    enabled: row.enabled,
    internalRecruitmentEnabled: row.internalRecruitmentEnabled,
    externalRecruitmentEnabled: row.externalRecruitmentEnabled,
    requireCandidateAccount: row.requireCandidateAccount,
    defaultWorkflowId: row.defaultWorkflowId,
    candidateDataRetentionMonths: row.candidateDataRetentionMonths,
    reapplicationWaitingDays: row.reapplicationWaitingDays,
    duplicateCandidatePolicy: row.duplicateCandidatePolicy,
    defaultOfferExpiryDays: row.defaultOfferExpiryDays,
    defaultDocumentRequirements: (row.defaultDocumentRequirements as string[]) ?? [],
    applicationLimitPerCandidate: row.applicationLimitPerCandidate,
    updatedAt: row.updatedAt,
  };
}

/** Returns the org's saved settings, or safe defaults if nothing has been saved yet — no row is created on read. */
export async function getRecruitmentSettings(organizationId: number): Promise<RecruitmentSettingsView> {
  return toView(await findSettingsRow(organizationId), organizationId);
}

function validatePatch(patch: RecruitmentSettingsPatch): void {
  if (patch.reapplicationWaitingDays != null && patch.reapplicationWaitingDays < 0) {
    throw new InvalidRecruitmentSettingsError("reapplicationWaitingDays cannot be negative");
  }
  if (patch.candidateDataRetentionMonths != null && patch.candidateDataRetentionMonths <= 0) {
    throw new InvalidRecruitmentSettingsError("candidateDataRetentionMonths must be positive");
  }
  if (patch.defaultOfferExpiryDays != null && patch.defaultOfferExpiryDays <= 0) {
    throw new InvalidRecruitmentSettingsError("defaultOfferExpiryDays must be positive");
  }
  if (patch.applicationLimitPerCandidate != null && patch.applicationLimitPerCandidate <= 0) {
    throw new InvalidRecruitmentSettingsError("applicationLimitPerCandidate must be positive");
  }
}

/**
 * Merges `patch` into the org's existing settings (or defaults) and
 * persists the merged result — mirrors organizationConfig.ts's
 * merge-then-validate-then-persist shape. `defaultWorkflowId`, if supplied,
 * is independently re-verified to belong to this organization
 * (Architecture Principle: a route-level permission check is never treated
 * as sufficient proof a body-supplied ID belongs to the caller's org).
 */
export async function updateRecruitmentSettings(params: {
  organizationId: number;
  patch: RecruitmentSettingsPatch;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<RecruitmentSettingsView> {
  validatePatch(params.patch);
  if (params.patch.defaultWorkflowId != null) {
    await assertBelongsToOrganization(
      recruitmentWorkflowsTable,
      params.patch.defaultWorkflowId,
      params.organizationId,
      "Default workflow",
    );
  }

  const existing = await findSettingsRow(params.organizationId);
  const before = toView(existing, params.organizationId);

  let row: RecruitmentSettings;
  if (existing) {
    [row] = await db
      .update(recruitmentSettingsTable)
      .set(params.patch)
      .where(eq(recruitmentSettingsTable.id, existing.id))
      .returning();
  } else {
    const [created] = await db
      .insert(recruitmentSettingsTable)
      .values({ organizationId: params.organizationId, ...params.patch })
      .onConflictDoNothing({ target: recruitmentSettingsTable.organizationId })
      .returning();
    if (created) {
      row = created;
    } else {
      // Lost a race with a concurrent first write for this organization.
      const raced = await findSettingsRow(params.organizationId);
      [row] = await db
        .update(recruitmentSettingsTable)
        .set(params.patch)
        .where(eq(recruitmentSettingsTable.id, raced!.id))
        .returning();
    }
  }

  const after = toView(row, params.organizationId);
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "recruitment_settings.updated",
    targetType: "recruitment_settings",
    targetId: String(params.organizationId),
    beforeState: before as unknown as Record<string, unknown>,
    afterState: after as unknown as Record<string, unknown>,
  });

  return after;
}
