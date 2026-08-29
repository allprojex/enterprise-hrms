import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  employeeSkillRecordsTable,
  employeeSkillAssessmentsTable,
  positionSkillRequirementsTable,
  skillsTable,
  proficiencyLevelsTable,
  employeesTable,
  positionsTable,
  employeeDocumentsTable,
  employeeCertificationsTable,
  employeeUserLinksTable,
  type EmployeeSkillRecord,
  type EmployeeSkillAssessment,
  type PositionSkillRequirement,
  type ProficiencyLevel,
} from "@workspace/db";
import { assertBelongsToOrganization } from "../orgScopedRefs";
import { recordAuditEvent } from "../auditLog";
import { getSkill, getLevel } from "./catalogue";

/**
 * WS-14 — employee capability: claim, assessment, verification, and gaps
 * (§30.5–30.10).
 *
 * THE RULE THIS MODULE EXISTS TO HOLD: a claim is not a verification, and only
 * a VERIFIED level may satisfy a position requirement (§30.6). An employee
 * saying they can do something, and the organization confirming it, are
 * different facts, and the platform never conflates them — `verifiedLevelId` is
 * written by exactly one function, `verify()`, and by nothing else.
 *
 * THE SECOND RULE: "not recorded" is never evidence of incapability (§30.6).
 * `GapState` therefore distinguishes an absent record from a shortfall, and no
 * surface in WS-14 may collapse the two.
 *
 * THE THIRD RULE: a manager assessment is not a verification (§30.8). A manager
 * may record what they observed; confirming it as organizational truth is a
 * separate, separately-permissioned act.
 *
 * Nothing here writes to `employee_skills` (Phase 2A, W24). That table keeps
 * its rows and routes exactly as shipped (§30.22).
 */

export class RecordNotFoundError extends Error {
  constructor() {
    super("Employee skill record not found");
    this.name = "RecordNotFoundError";
  }
}

export class InvalidCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCapabilityError";
  }
}

export class NotAuthorizedAssessorError extends Error {
  constructor() {
    super("You are not an authorized assessor for this employee.");
    this.name = "NotAuthorizedAssessorError";
  }
}

export class SelfVerificationForbiddenError extends Error {
  constructor() {
    super("An employee may not verify their own skill claim.");
    this.name = "SelfVerificationForbiddenError";
  }
}

/**
 * Resolves which authority an actor holds over a subject employee (§30.8).
 *
 * Two, and only two: HR holding the explicit permission, and the employee's
 * AUTHORITATIVE reporting manager resolved from `employees.reportingManagerId`.
 * Manager authority is never inferred from a role name — the §25.2 ruling — and
 * never accepted from the client. A changed reporting line takes effect
 * immediately because this is resolved live at every action.
 */
export async function resolveAssessorRole(params: {
  organizationId: number;
  subjectEmployeeId: number;
  actorApplicationUserId: number;
  hasHrAssessPermission: boolean;
}): Promise<"hr" | "reporting_manager" | null> {
  if (params.hasHrAssessPermission) return "hr";

  const [subject] = await db
    .select({ reportingManagerId: employeesTable.reportingManagerId })
    .from(employeesTable)
    .where(
      and(
        eq(employeesTable.id, params.subjectEmployeeId),
        eq(employeesTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!subject?.reportingManagerId) return null;

  // The actor's own employee identity, resolved server-side from their link.
  const [link] = await db
    .select({ employeeId: employeeUserLinksTable.employeeId })
    .from(employeeUserLinksTable)
    .where(eq(employeeUserLinksTable.applicationUserId, params.actorApplicationUserId))
    .limit(1);
  if (!link) return null;

  // And that employee must itself belong to this organization.
  const [actorEmployee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, link.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!actorEmployee) return null;

  return actorEmployee.id === subject.reportingManagerId ? "reporting_manager" : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRecords(
  organizationId: number,
  filters: { employeeId?: number; skillId?: number; status?: EmployeeSkillRecord["status"] } = {},
): Promise<EmployeeSkillRecord[]> {
  const predicates = [eq(employeeSkillRecordsTable.organizationId, organizationId)];
  if (filters.employeeId != null) predicates.push(eq(employeeSkillRecordsTable.employeeId, filters.employeeId));
  if (filters.skillId != null) predicates.push(eq(employeeSkillRecordsTable.skillId, filters.skillId));
  if (filters.status) predicates.push(eq(employeeSkillRecordsTable.status, filters.status));
  return db
    .select()
    .from(employeeSkillRecordsTable)
    .where(and(...predicates))
    .orderBy(desc(employeeSkillRecordsTable.updatedAt));
}

export async function getRecord(organizationId: number, recordId: number): Promise<EmployeeSkillRecord | undefined> {
  const [row] = await db
    .select()
    .from(employeeSkillRecordsTable)
    .where(
      and(eq(employeeSkillRecordsTable.id, recordId), eq(employeeSkillRecordsTable.organizationId, organizationId)),
    )
    .limit(1);
  return row;
}

export async function listAssessments(
  organizationId: number,
  recordId: number,
): Promise<EmployeeSkillAssessment[]> {
  return db
    .select()
    .from(employeeSkillAssessmentsTable)
    .where(
      and(
        eq(employeeSkillAssessmentsTable.organizationId, organizationId),
        eq(employeeSkillAssessmentsTable.recordId, recordId),
      ),
    )
    .orderBy(desc(employeeSkillAssessmentsTable.assessedAt), desc(employeeSkillAssessmentsTable.id));
}

// ---------------------------------------------------------------------------
// Claim (§30.5)
// ---------------------------------------------------------------------------

/**
 * Records a claim. For ESS the route derives `employeeId` from the caller's own
 * link and the body carries no employee identifier at all (§30.5).
 *
 * A claim NEVER sets `verifiedLevelId`. That is the whole point.
 */
export async function claimSkill(params: {
  organizationId: number;
  employeeId: number;
  skillId: number;
  claimedLevelId?: number | null;
  source: EmployeeSkillRecord["source"];
  evidenceDocumentId?: number | null;
  certificationId?: number | null;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeSkillRecord> {
  await assertBelongsToOrganization(employeesTable, params.employeeId, params.organizationId, "Employee");
  const skill = await getSkill(params.organizationId, params.skillId);
  if (!skill) throw new InvalidCapabilityError("Skill not found in this organization.");
  if (!skill.active) throw new InvalidCapabilityError("That skill is not active.");

  if (params.claimedLevelId != null) {
    if (!skill.proficiencyApplicable) {
      throw new InvalidCapabilityError("This skill does not use proficiency levels.");
    }
    const level = await getLevel(params.organizationId, params.claimedLevelId);
    if (!level) throw new InvalidCapabilityError("Proficiency level not found in this organization.");
  }
  if (params.evidenceDocumentId != null) {
    await assertBelongsToOrganization(
      employeeDocumentsTable,
      params.evidenceDocumentId,
      params.organizationId,
      "Evidence document",
    );
  }
  if (params.certificationId != null) {
    await assertBelongsToOrganization(
      employeeCertificationsTable,
      params.certificationId,
      params.organizationId,
      "Certification",
    );
  }

  const existing = await db
    .select()
    .from(employeeSkillRecordsTable)
    .where(
      and(
        eq(employeeSkillRecordsTable.organizationId, params.organizationId),
        eq(employeeSkillRecordsTable.employeeId, params.employeeId),
        eq(employeeSkillRecordsTable.skillId, params.skillId),
      ),
    )
    .limit(1);

  let record: EmployeeSkillRecord;
  if (existing.length > 0) {
    // Re-claiming updates the CLAIM only. An existing verification is left
    // untouched — an employee restating a claim cannot disturb what the
    // organization already confirmed.
    const [updated] = await db
      .update(employeeSkillRecordsTable)
      .set({
        claimedLevelId: params.claimedLevelId ?? existing[0]!.claimedLevelId,
        evidenceDocumentId: params.evidenceDocumentId ?? existing[0]!.evidenceDocumentId,
        certificationId: params.certificationId ?? existing[0]!.certificationId,
        notes: params.notes ?? existing[0]!.notes,
        status: existing[0]!.status === "verified" ? "verified" : "claimed",
      })
      .where(eq(employeeSkillRecordsTable.id, existing[0]!.id))
      .returning();
    record = updated!;
  } else {
    const [created] = await db
      .insert(employeeSkillRecordsTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        skillId: params.skillId,
        status: "claimed",
        source: params.source,
        claimedLevelId: params.claimedLevelId ?? null,
        evidenceDocumentId: params.evidenceDocumentId ?? null,
        certificationId: params.certificationId ?? null,
        notes: params.notes ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();
    record = created!;
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.claimed",
    targetType: "employee_skill_record",
    targetId: String(record.id),
    afterState: {
      employeeId: record.employeeId,
      skillId: record.skillId,
      status: record.status,
      source: record.source,
    },
  });

  return record;
}

// ---------------------------------------------------------------------------
// Assessment and verification (§30.7, §30.8)
// ---------------------------------------------------------------------------

/**
 * Records an assessment. Append-only: this never overwrites a previous one.
 *
 * It moves the record to `assessed` but deliberately does NOT set
 * `verifiedLevelId` — a manager's observation is not the organization's
 * confirmation (§30.8).
 */
export async function assess(params: {
  organizationId: number;
  recordId: number;
  levelId: number;
  assessorRole: "hr" | "reporting_manager";
  assessedAt: Date;
  notes?: string | null;
  evidenceDocumentId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ record: EmployeeSkillRecord; assessment: EmployeeSkillAssessment }> {
  const record = await getRecord(params.organizationId, params.recordId);
  if (!record) throw new RecordNotFoundError();

  const level = await getLevel(params.organizationId, params.levelId);
  if (!level) throw new InvalidCapabilityError("Proficiency level not found in this organization.");
  if (params.evidenceDocumentId != null) {
    await assertBelongsToOrganization(
      employeeDocumentsTable,
      params.evidenceDocumentId,
      params.organizationId,
      "Evidence document",
    );
  }

  const result = await db.transaction(async (tx) => {
    const [assessment] = await tx
      .insert(employeeSkillAssessmentsTable)
      .values({
        organizationId: params.organizationId,
        recordId: params.recordId,
        kind: "assessment",
        levelId: params.levelId,
        assessorRole: params.assessorRole,
        assessorUserId: params.actorApplicationUserId,
        assessorMembershipId: params.actorMembershipId,
        assessedAt: params.assessedAt,
        notes: params.notes ?? null,
        evidenceDocumentId: params.evidenceDocumentId ?? null,
      })
      .returning();

    const [updated] = await tx
      .update(employeeSkillRecordsTable)
      // Verified stays verified: a later assessment does not silently revoke an
      // existing organizational confirmation.
      .set({ status: record.status === "verified" ? "verified" : "assessed" })
      .where(eq(employeeSkillRecordsTable.id, params.recordId))
      .returning();

    return { record: updated!, assessment: assessment! };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.assessed",
    targetType: "employee_skill_record",
    targetId: String(params.recordId),
    afterState: { levelOrdinal: level.ordinal, assessorRole: params.assessorRole, status: result.record.status },
  });

  return result;
}

/**
 * Verification — the ONLY function that writes `verifiedLevelId`.
 *
 * An employee may never verify their own claim (§30.9). The check is on the
 * actor's own employee link rather than on anything the client sends.
 */
export async function verify(params: {
  organizationId: number;
  recordId: number;
  levelId?: number | null;
  assessedAt: Date;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ record: EmployeeSkillRecord; assessment: EmployeeSkillAssessment }> {
  const record = await getRecord(params.organizationId, params.recordId);
  if (!record) throw new RecordNotFoundError();

  const [link] = await db
    .select({ employeeId: employeeUserLinksTable.employeeId })
    .from(employeeUserLinksTable)
    .where(eq(employeeUserLinksTable.applicationUserId, params.actorApplicationUserId))
    .limit(1);
  if (link?.employeeId === record.employeeId) throw new SelfVerificationForbiddenError();

  const skill = await getSkill(params.organizationId, record.skillId);
  let level: ProficiencyLevel | undefined;
  if (params.levelId != null) {
    level = await getLevel(params.organizationId, params.levelId);
    if (!level) throw new InvalidCapabilityError("Proficiency level not found in this organization.");
  } else if (skill?.proficiencyApplicable) {
    throw new InvalidCapabilityError("This skill uses proficiency levels, so a level is required to verify it.");
  }

  const result = await db.transaction(async (tx) => {
    const [assessment] = await tx
      .insert(employeeSkillAssessmentsTable)
      .values({
        organizationId: params.organizationId,
        recordId: params.recordId,
        kind: "verification",
        levelId: params.levelId ?? null,
        assessorRole: "hr",
        assessorUserId: params.actorApplicationUserId,
        assessorMembershipId: params.actorMembershipId,
        assessedAt: params.assessedAt,
        notes: params.notes ?? null,
      })
      .returning();

    const [updated] = await tx
      .update(employeeSkillRecordsTable)
      .set({
        status: "verified",
        verifiedLevelId: params.levelId ?? null,
        verifiedAt: params.assessedAt,
        verifiedByUserId: params.actorApplicationUserId,
      })
      .where(eq(employeeSkillRecordsTable.id, params.recordId))
      .returning();

    return { record: updated!, assessment: assessment! };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.verified",
    targetType: "employee_skill_record",
    targetId: String(params.recordId),
    beforeState: { status: record.status, verifiedLevelId: record.verifiedLevelId },
    afterState: { status: result.record.status, verifiedLevelId: result.record.verifiedLevelId },
  });

  return result;
}

/** Declines a claim. Retained, never deleted, and it clears no prior verification silently. */
export async function reject(params: {
  organizationId: number;
  recordId: number;
  reason: string;
  assessedAt: Date;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeSkillRecord> {
  const record = await getRecord(params.organizationId, params.recordId);
  if (!record) throw new RecordNotFoundError();
  if (!params.reason.trim()) throw new InvalidCapabilityError("A reason is required to reject a claim.");

  const updated = await db.transaction(async (tx) => {
    await tx.insert(employeeSkillAssessmentsTable).values({
      organizationId: params.organizationId,
      recordId: params.recordId,
      kind: "rejection",
      levelId: null,
      assessorRole: "hr",
      assessorUserId: params.actorApplicationUserId,
      assessorMembershipId: params.actorMembershipId,
      assessedAt: params.assessedAt,
      notes: params.reason.trim(),
    });
    const [row] = await tx
      .update(employeeSkillRecordsTable)
      .set({ status: "rejected", verifiedLevelId: null, verifiedAt: null, verifiedByUserId: null })
      .where(eq(employeeSkillRecordsTable.id, params.recordId))
      .returning();
    return row!;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_skill.rejected",
    targetType: "employee_skill_record",
    targetId: String(params.recordId),
    beforeState: { status: record.status },
    afterState: { status: updated.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Position requirements (§30.9)
// ---------------------------------------------------------------------------

export async function listRequirements(
  organizationId: number,
  positionId: number,
): Promise<PositionSkillRequirement[]> {
  return db
    .select()
    .from(positionSkillRequirementsTable)
    .where(
      and(
        eq(positionSkillRequirementsTable.organizationId, organizationId),
        eq(positionSkillRequirementsTable.positionId, positionId),
      ),
    )
    .orderBy(positionSkillRequirementsTable.id);
}

export async function addRequirement(params: {
  organizationId: number;
  positionId: number;
  skillId: number;
  minimumLevelId?: number | null;
  mandatory?: boolean;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<PositionSkillRequirement> {
  // Both references are proved to belong to this organization before storage —
  // a cross-tenant position or skill must never be linkable.
  await assertBelongsToOrganization(positionsTable, params.positionId, params.organizationId, "Position");
  const skill = await getSkill(params.organizationId, params.skillId);
  if (!skill) throw new InvalidCapabilityError("Skill not found in this organization.");
  if (params.minimumLevelId != null) {
    const level = await getLevel(params.organizationId, params.minimumLevelId);
    if (!level) throw new InvalidCapabilityError("Proficiency level not found in this organization.");
  }

  // A withdrawn requirement is reinstated in place rather than duplicated:
  // the table is unique on (organization, position, skill), so one position
  // states one expectation about one skill and never two conflicting ones.
  const [existing] = await db
    .select()
    .from(positionSkillRequirementsTable)
    .where(
      and(
        eq(positionSkillRequirementsTable.organizationId, params.organizationId),
        eq(positionSkillRequirementsTable.positionId, params.positionId),
        eq(positionSkillRequirementsTable.skillId, params.skillId),
      ),
    )
    .limit(1);

  const [created] = existing
    ? await db
        .update(positionSkillRequirementsTable)
        .set({
          minimumLevelId: params.minimumLevelId ?? null,
          mandatory: params.mandatory ?? true,
          active: true,
        })
        .where(eq(positionSkillRequirementsTable.id, existing.id))
        .returning()
    : await db
        .insert(positionSkillRequirementsTable)
        .values({
          organizationId: params.organizationId,
          positionId: params.positionId,
          skillId: params.skillId,
          minimumLevelId: params.minimumLevelId ?? null,
          mandatory: params.mandatory ?? true,
          createdBy: params.actorApplicationUserId,
        })
        .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "position_requirement.created",
    targetType: "position_skill_requirement",
    targetId: String(created!.id),
    afterState: { positionId: params.positionId, skillId: params.skillId, mandatory: created!.mandatory },
  });

  return created!;
}

export async function removeRequirement(params: {
  organizationId: number;
  requirementId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(positionSkillRequirementsTable)
    .where(
      and(
        eq(positionSkillRequirementsTable.id, params.requirementId),
        eq(positionSkillRequirementsTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!existing) throw new InvalidCapabilityError("Requirement not found in this organization.");

  // Withdrawn, not deleted. The row is what an audit reader resolves the
  // removed requirement back to, and `computeGaps` already measures only
  // active requirements — so deactivating is the whole withdrawal.
  await db
    .update(positionSkillRequirementsTable)
    .set({ active: false })
    .where(eq(positionSkillRequirementsTable.id, params.requirementId));

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "position_requirement.removed",
    targetType: "position_skill_requirement",
    targetId: String(params.requirementId),
    beforeState: { positionId: existing.positionId, skillId: existing.skillId },
  });
}

// ---------------------------------------------------------------------------
// Gap engine (§30.10)
// ---------------------------------------------------------------------------

/**
 * The four states §30.6 requires be kept apart.
 *
 * `no_verified_evidence` deliberately does NOT mean "the employee lacks this".
 * It means the organization has not confirmed it — which may be because nobody
 * has looked. Presenting it as incapability is the misreading §30.6 forbids,
 * and no WS-14 surface may do it.
 */
export type GapState = "no_verified_evidence" | "below_requirement" | "meets_requirement" | "exceeds_requirement";

export interface SkillGap {
  skillId: number;
  skillName: string;
  mandatory: boolean;
  requiredLevelOrdinal: number | null;
  requiredLevelLabel: string | null;
  verifiedLevelOrdinal: number | null;
  verifiedLevelLabel: string | null;
  /** True when a claim exists but has not been verified — shown separately, never counted. */
  hasUnverifiedClaim: boolean;
  /** True when the backing certification has expired, so the evidence is no longer current (§30.20). */
  evidenceExpired: boolean;
  state: GapState;
}

/**
 * Compares one employee against one position's requirements.
 *
 * ONLY VERIFIED CAPABILITY COUNTS (§30.6). A claimed-but-unverified skill is
 * reported through `hasUnverifiedClaim` so a human can see it, and never
 * satisfies a requirement.
 */
export async function computeGaps(params: {
  organizationId: number;
  employeeId: number;
  positionId: number;
  asOf?: Date;
}): Promise<SkillGap[]> {
  const asOf = params.asOf ?? new Date();

  const requirements = await db
    .select({
      requirement: positionSkillRequirementsTable,
      skillName: skillsTable.name,
    })
    .from(positionSkillRequirementsTable)
    .innerJoin(skillsTable, eq(skillsTable.id, positionSkillRequirementsTable.skillId))
    .where(
      and(
        eq(positionSkillRequirementsTable.organizationId, params.organizationId),
        eq(positionSkillRequirementsTable.positionId, params.positionId),
        eq(positionSkillRequirementsTable.active, true),
      ),
    );
  if (requirements.length === 0) return [];

  const skillIds = requirements.map((r) => r.requirement.skillId);
  const records = await db
    .select()
    .from(employeeSkillRecordsTable)
    .where(
      and(
        eq(employeeSkillRecordsTable.organizationId, params.organizationId),
        eq(employeeSkillRecordsTable.employeeId, params.employeeId),
        inArray(employeeSkillRecordsTable.skillId, skillIds),
      ),
    );
  const bySkill = new Map(records.map((r) => [r.skillId, r]));

  const levelIds = [
    ...requirements.map((r) => r.requirement.minimumLevelId),
    ...records.map((r) => r.verifiedLevelId),
  ].filter((id): id is number => id != null);
  const levels =
    levelIds.length > 0
      ? new Map(
          (
            await db
              .select()
              .from(proficiencyLevelsTable)
              .where(
                and(
                  eq(proficiencyLevelsTable.organizationId, params.organizationId),
                  inArray(proficiencyLevelsTable.id, levelIds),
                ),
              )
          ).map((l) => [l.id, l]),
        )
      : new Map<number, ProficiencyLevel>();

  // Certification expiry makes evidence no longer current, but it never becomes
  // a stored flag — it is derived against `asOf` every time (§30.20).
  const certIds = records.map((r) => r.certificationId).filter((id): id is number => id != null);
  const certExpiry = new Map<number, Date | null>();
  if (certIds.length > 0) {
    const certs = await db
      .select({ id: employeeCertificationsTable.id, expiryDate: employeeCertificationsTable.expiryDate })
      .from(employeeCertificationsTable)
      .where(
        and(
          eq(employeeCertificationsTable.organizationId, params.organizationId),
          inArray(employeeCertificationsTable.id, certIds),
        ),
      );
    for (const c of certs) certExpiry.set(c.id, c.expiryDate);
  }

  return requirements.map(({ requirement, skillName }) => {
    const record = bySkill.get(requirement.skillId);
    const requiredLevel = requirement.minimumLevelId != null ? levels.get(requirement.minimumLevelId) : undefined;
    const verifiedLevel = record?.verifiedLevelId != null ? levels.get(record.verifiedLevelId) : undefined;

    const expiry = record?.certificationId != null ? certExpiry.get(record.certificationId) : undefined;
    const evidenceExpired = expiry != null && expiry.getTime() < asOf.getTime();

    const isVerified = record?.status === "verified" && !evidenceExpired;
    const hasUnverifiedClaim = record != null && record.status !== "verified";

    let state: GapState;
    if (!isVerified) {
      // No confirmation — NOT a statement that the employee cannot do it.
      state = "no_verified_evidence";
    } else if (requiredLevel == null || verifiedLevel == null) {
      // The skill is verified and the requirement names no level, so holding it
      // is the whole requirement.
      state = "meets_requirement";
    } else if (verifiedLevel.ordinal < requiredLevel.ordinal) {
      state = "below_requirement";
    } else if (verifiedLevel.ordinal > requiredLevel.ordinal) {
      state = "exceeds_requirement";
    } else {
      state = "meets_requirement";
    }

    return {
      skillId: requirement.skillId,
      skillName,
      mandatory: requirement.mandatory,
      requiredLevelOrdinal: requiredLevel?.ordinal ?? null,
      requiredLevelLabel: requiredLevel?.label ?? null,
      verifiedLevelOrdinal: isVerified ? (verifiedLevel?.ordinal ?? null) : null,
      verifiedLevelLabel: isVerified ? (verifiedLevel?.label ?? null) : null,
      hasUnverifiedClaim,
      evidenceExpired,
      state,
    };
  });
}

/**
 * The employee's CURRENT position, used to answer "my gaps" without the
 * browser telling us which position to measure against (§30.18). A client-
 * supplied position on an own-gaps route would let an employee measure
 * themselves against a role they have no standing to inspect.
 */
export async function getEmployeeCurrentPositionId(
  organizationId: number,
  employeeId: number,
): Promise<number | null> {
  const [row] = await db
    .select({ positionId: employeesTable.positionId })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  return row?.positionId ?? null;
}
