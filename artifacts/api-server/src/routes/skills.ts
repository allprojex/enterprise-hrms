import { Router } from "express";
import {
  CreateSkillBody,
  UpdateSkillBody,
  CreateProficiencyScaleBody,
  RelabelProficiencyLevelBody,
  ClaimEmployeeSkillBody,
  ClaimMySkillBody,
  AssessEmployeeSkillBody,
  VerifyEmployeeSkillBody,
  RejectEmployeeSkillBody,
  AddPositionRequirementBody,
  CreateReadinessLevelBody,
  CreateSuccessionPlanBody,
  UpdateSuccessionPlanBody,
  NominateSuccessionCandidateBody,
  SetSuccessionReadinessBody,
  RemoveSuccessionCandidateBody,
  CreateDevelopmentActionBody,
  UpdateDevelopmentActionBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { recordSensitiveRead } from "../lib/sensitiveRead";
import * as catalogue from "../lib/skills/catalogue";
import * as capability from "../lib/skills/capability";
import * as succession from "../lib/skills/succession";

/**
 * WS-14 — Skills, Competency Framework & Succession routes (§30).
 *
 * THREE THINGS THIS FILE ENFORCES THAT NOTHING ELSE CAN.
 *
 * SUCCESSION IS NEVER EMPLOYEE-FACING (§30.17). There is no ESS succession
 * route anywhere below — not candidacy, not readiness, not target roles. An
 * employee's own capability is theirs to see; their standing in somebody's
 * succession plan is not, and the absence of a route is the enforcement.
 *
 * ASSESSOR AUTHORITY IS RESOLVED, NEVER CLAIMED (§30.8). The assess endpoint
 * cannot use `requirePermission` alone, because a reporting manager is a
 * legitimate assessor without holding an HR key. It resolves the actor's
 * authority live from `employees.reportingManagerId` — never from a role name,
 * and never from anything the client sends.
 *
 * THE ORGANIZATION IS NEVER TAKEN FROM THE CLIENT. Every handler reads
 * `req.membership!.organizationId`, so a forged `:organizationId` fails safely.
 */

const router = Router();

function mapDomainError(err: unknown, res: import("express").Response): boolean {
  if (
    err instanceof catalogue.SkillNotFoundError ||
    err instanceof catalogue.ScaleNotFoundError ||
    err instanceof capability.RecordNotFoundError ||
    err instanceof succession.SuccessionPlanNotFoundError ||
    err instanceof succession.SuccessionCandidateNotFoundError ||
    err instanceof succession.ReadinessLevelNotFoundError ||
    err instanceof succession.DevelopmentActionNotFoundError
  ) {
    res.status(404).json({ error: (err as Error).message });
    return true;
  }
  // Authority failures are 403, not validation errors — a caller must not
  // mistake "you may not do this" for "your payload was malformed".
  if (
    err instanceof capability.NotAuthorizedAssessorError ||
    err instanceof capability.SelfVerificationForbiddenError
  ) {
    res.status(403).json({ error: (err as Error).message });
    return true;
  }
  if (err instanceof catalogue.DuplicateSkillCodeError) {
    res.status(409).json({ error: (err as Error).message });
    return true;
  }
  if (
    err instanceof catalogue.InvalidSkillError ||
    err instanceof catalogue.InvalidScaleError ||
    err instanceof capability.InvalidCapabilityError ||
    err instanceof succession.InvalidSuccessionError
  ) {
    res.status(422).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

const guard =
  (handler: (req: MembershipRequest, res: import("express").Response) => Promise<void>) =>
  async (req: MembershipRequest, res: import("express").Response): Promise<void> => {
    try {
      await handler(req, res);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  };

// ---------------------------------------------------------------------------
// Skills catalogue (§30.2–30.4)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/skills",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.read"),
  guard(async (req, res) => {
    const activeOnly = req.query["activeOnly"] === "true";
    res.json(await catalogue.listSkills(req.membership!.organizationId, { activeOnly }));
  }),
);

router.post(
  "/organizations/:organizationId/skills",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.configure"),
  guard(async (req, res) => {
    const parsed = CreateSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.status(201).json(
      await catalogue.createSkill({
        organizationId: req.membership!.organizationId,
        ...parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.patch(
  "/organizations/:organizationId/skills/:skillId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.configure"),
  guard(async (req, res) => {
    const parsed = UpdateSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(
      await catalogue.updateSkill({
        organizationId: req.membership!.organizationId,
        skillId: Number(req.params["skillId"]),
        ...parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

/** Idempotent import from the existing `skill` Master Data domain, which is read-only here (§30.4). */
router.post(
  "/organizations/:organizationId/skills/import-master-data",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.configure"),
  guard(async (req, res) => {
    const result = await catalogue.importFromMasterData({
      organizationId: req.membership!.organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.json({ imported: result.imported, skipped: result.skipped });
  }),
);

router.get(
  "/organizations/:organizationId/proficiency-scale",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.read"),
  guard(async (req, res) => {
    const active = await catalogue.getActiveScale(req.membership!.organizationId);
    res.json(active ?? { scale: null, levels: [] });
  }),
);

router.post(
  "/organizations/:organizationId/proficiency-scale",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.configure"),
  guard(async (req, res) => {
    const parsed = CreateProficiencyScaleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.status(201).json(
      await catalogue.createScale({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        levels: parsed.data.levels.map((l) => ({ label: l.label, description: l.description ?? null })),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

/**
 * Relabels a level. Labels may change; ORDER MAY NOT — reordering would
 * silently reinterpret every historical assessment pointing at it (§30.3).
 */
router.patch(
  "/organizations/:organizationId/proficiency-levels/:levelId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_catalogue.configure"),
  guard(async (req, res) => {
    const parsed = RelabelProficiencyLevelBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(
      await catalogue.relabelLevel({
        organizationId: req.membership!.organizationId,
        levelId: Number(req.params["levelId"]),
        ...parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Employee capability (§30.5–30.9)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/employee-skills",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.read"),
  guard(async (req, res) => {
    const employeeId = req.query["employeeId"] ? Number(req.query["employeeId"]) : undefined;
    const skillId = req.query["skillId"] ? Number(req.query["skillId"]) : undefined;
    res.json(await capability.listRecords(req.membership!.organizationId, { employeeId, skillId }));
  }),
);

router.get(
  "/organizations/:organizationId/employee-skills/:recordId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.read"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const recordId = Number(req.params["recordId"]);
    const record = await capability.getRecord(organizationId, recordId);
    if (!record) {
      res.status(404).json({ error: "Employee skill record not found" });
      return;
    }
    // Assessment history is append-only and returned whole: the point of
    // keeping it is that a reader can see what was judged, by whom and when.
    res.json({ ...record, assessments: await capability.listAssessments(organizationId, recordId) });
  }),
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/skill-records",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.manage"),
  guard(async (req, res) => {
    const parsed = ClaimEmployeeSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.status(201).json(
      await capability.claimSkill({
        organizationId: req.membership!.organizationId,
        employeeId: Number(req.params["employeeId"]),
        skillId: parsed.data.skillId,
        claimedLevelId: parsed.data.claimedLevelId ?? null,
        // Fixed by the route, not the body.
        source: "hr_entry",
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        certificationId: parsed.data.certificationId ?? null,
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

/**
 * Assessment — the one endpoint whose authority cannot be a single permission.
 *
 * HR holding `skill_assessment.record`, or the employee's authoritative
 * reporting manager, may assess (§30.8). Manager authority is resolved live from
 * `employees.reportingManagerId`; a manager of somebody else, or of nobody, is
 * refused. Recording an assessment does NOT verify anything.
 */
router.post(
  "/organizations/:organizationId/employee-skills/:recordId/assess",
  requireAuth as any,
  requireMembership("organizationId"),
  guard(async (req, res) => {
    const parsed = AssessEmployeeSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const record = await capability.getRecord(organizationId, Number(req.params["recordId"]));
    if (!record) {
      res.status(404).json({ error: "Employee skill record not found" });
      return;
    }

    const assessorRole = await capability.resolveAssessorRole({
      organizationId,
      subjectEmployeeId: record.employeeId,
      actorApplicationUserId: req.userId!,
      hasHrAssessPermission: await hasPermission(req.membership!.id, "skill_assessment.record"),
    });
    if (!assessorRole) throw new capability.NotAuthorizedAssessorError();

    res.status(201).json(
      await capability.assess({
        organizationId,
        recordId: record.id,
        levelId: parsed.data.levelId,
        assessorRole,
        assessedAt: new Date(parsed.data.assessedAt),
        notes: parsed.data.notes ?? null,
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.post(
  "/organizations/:organizationId/employee-skills/:recordId/verify",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_verification.decide"),
  guard(async (req, res) => {
    const parsed = VerifyEmployeeSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Self-verification is refused inside the service, on the actor's own
    // employee link rather than on anything the client sent.
    res.json(
      await capability.verify({
        organizationId: req.membership!.organizationId,
        recordId: Number(req.params["recordId"]),
        levelId: parsed.data.levelId ?? null,
        assessedAt: new Date(parsed.data.assessedAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.post(
  "/organizations/:organizationId/employee-skills/:recordId/reject",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("skill_verification.decide"),
  guard(async (req, res) => {
    const parsed = RejectEmployeeSkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(
      await capability.reject({
        organizationId: req.membership!.organizationId,
        recordId: Number(req.params["recordId"]),
        reason: parsed.data.reason,
        assessedAt: new Date(parsed.data.assessedAt),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

// ---------------------------------------------------------------------------
// Employee Self-Service (§30.18) — capability only, never succession
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/my-skills",
  requireAuth as any,
  requireMembership("organizationId"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.json([]);
      return;
    }
    res.json(await capability.listRecords(organizationId, { employeeId }));
  }),
);

/**
 * An employee's own claim.
 *
 * No permission key gates this (§30.22): the right comes from the employee
 * link, resolved server-side. The body carries no employee identifier, so a
 * browser cannot claim a skill on somebody else's record.
 */
router.post(
  "/organizations/:organizationId/my-skills",
  requireAuth as any,
  requireMembership("organizationId"),
  guard(async (req, res) => {
    const parsed = ClaimMySkillBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.status(403).json({ error: "No employee record is linked to this account." });
      return;
    }
    res.status(201).json(
      await capability.claimSkill({
        organizationId,
        employeeId,
        skillId: parsed.data.skillId,
        claimedLevelId: parsed.data.claimedLevelId ?? null,
        source: "employee_self_service",
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        certificationId: parsed.data.certificationId ?? null,
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

/** The skills an employee may claim, and the current scale, without needing a catalogue key. */
router.get(
  "/organizations/:organizationId/my-skill-options",
  requireAuth as any,
  requireMembership("organizationId"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const [skills, scale] = await Promise.all([
      catalogue.listSkills(organizationId, { activeOnly: true }),
      catalogue.getActiveScale(organizationId),
    ]);
    res.json({
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        proficiencyApplicable: s.proficiencyApplicable,
      })),
      levels: (scale?.levels ?? []).map((l) => ({ id: l.id, label: l.label })),
    });
  }),
);

/** An employee's own gaps against their own current position (§30.18). */
router.get(
  "/organizations/:organizationId/my-skill-gaps",
  requireAuth as any,
  requireMembership("organizationId"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.json({ positionId: null, gaps: [] });
      return;
    }
    // The position comes from the employee record, never from the query string.
    const positionId = await capability.getEmployeeCurrentPositionId(organizationId, employeeId);
    if (!positionId) {
      res.json({ positionId: null, gaps: [] });
      return;
    }
    res.json({
      positionId,
      gaps: await capability.computeGaps({ organizationId, employeeId, positionId }),
    });
  }),
);

// ---------------------------------------------------------------------------
// Position requirements and gaps (§30.9, §30.10)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/positions/:positionId/skill-requirements",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position_requirement.read"),
  guard(async (req, res) => {
    res.json(await capability.listRequirements(req.membership!.organizationId, Number(req.params["positionId"])));
  }),
);

router.post(
  "/organizations/:organizationId/positions/:positionId/skill-requirements",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position_requirement.configure"),
  guard(async (req, res) => {
    const parsed = AddPositionRequirementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.status(201).json(
      await capability.addRequirement({
        organizationId: req.membership!.organizationId,
        positionId: Number(req.params["positionId"]),
        skillId: parsed.data.skillId,
        minimumLevelId: parsed.data.minimumLevelId ?? null,
        mandatory: parsed.data.mandatory,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.delete(
  "/organizations/:organizationId/position-skill-requirements/:requirementId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("position_requirement.configure"),
  guard(async (req, res) => {
    await capability.removeRequirement({
      organizationId: req.membership!.organizationId,
      requirementId: Number(req.params["requirementId"]),
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(204).send();
  }),
);

/**
 * One employee against one position.
 *
 * The response distinguishes no-verified-evidence from below-requirement
 * (§30.6). A caller must never render the first as "lacks skill".
 */
router.get(
  "/organizations/:organizationId/employees/:employeeId/skill-gaps",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.read"),
  guard(async (req, res) => {
    const positionId = Number(req.query["positionId"]);
    if (!Number.isInteger(positionId) || positionId <= 0) {
      res.status(400).json({ error: "positionId is required" });
      return;
    }
    res.json({
      gaps: await capability.computeGaps({
        organizationId: req.membership!.organizationId,
        employeeId: Number(req.params["employeeId"]),
        positionId,
      }),
    });
  }),
);

// ---------------------------------------------------------------------------
// Succession (§30.11–30.17) — no ESS route exists anywhere in this section
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/readiness-levels",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.read"),
  guard(async (req, res) => {
    res.json(await succession.listReadinessLevels(req.membership!.organizationId));
  }),
);

router.post(
  "/organizations/:organizationId/readiness-levels",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.manage"),
  guard(async (req, res) => {
    const parsed = CreateReadinessLevelBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.status(201).json(
      await succession.createReadinessLevel({
        organizationId: req.membership!.organizationId,
        ...parsed.data,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

/** Which positions have plans. NOT a sensitive read — no candidate or note is returned. */
router.get(
  "/organizations/:organizationId/succession-plans",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.read"),
  guard(async (req, res) => {
    const plans = await succession.listPlans(req.membership!.organizationId);
    res.json(
      plans.map((p) => ({
        id: p.id,
        positionId: p.positionId,
        status: p.status,
        reviewDueAt: p.reviewDueAt,
        createdAt: p.createdAt,
      })),
    );
  }),
);

/**
 * A plan in full, including its confidential criticality notes.
 *
 * `succession.confidential.read` — deliberately narrower than `succession.read`,
 * and audited through OD #18's existing helper (§30.17).
 */
router.get(
  "/organizations/:organizationId/succession-plans/:planId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.confidential.read"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const planId = Number(req.params["planId"]);
    const plan = await succession.getPlan(organizationId, planId);
    if (!plan) {
      res.status(404).json({ error: "Succession plan not found" });
      return;
    }
    await recordSensitiveRead({
      organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      targetType: "succession_plan",
      targetId: planId,
      reason: "confidential succession plan",
    });
    res.json(plan);
  }),
);

router.post(
  "/organizations/:organizationId/succession-plans",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.manage"),
  guard(async (req, res) => {
    const parsed = CreateSuccessionPlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Creating a plan marks a position as succession-managed. It changes
    // nothing about the position itself (§30.11).
    res.status(201).json(
      await succession.createPlan({
        organizationId: req.membership!.organizationId,
        positionId: parsed.data.positionId,
        criticalityNotes: parsed.data.criticalityNotes ?? null,
        reviewDueAt: parsed.data.reviewDueAt ? new Date(parsed.data.reviewDueAt) : null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.patch(
  "/organizations/:organizationId/succession-plans/:planId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.manage"),
  guard(async (req, res) => {
    const parsed = UpdateSuccessionPlanBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(
      await succession.updatePlan({
        organizationId: req.membership!.organizationId,
        planId: Number(req.params["planId"]),
        status: parsed.data.status,
        criticalityNotes: parsed.data.criticalityNotes,
        reviewDueAt: parsed.data.reviewDueAt ? new Date(parsed.data.reviewDueAt) : undefined,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

/**
 * The candidate pool. Confidential, and a sensitive read (§30.17).
 *
 * Grouped by readiness band for presentation. There is NO rank field, and none
 * may be added (§30.12).
 */
router.get(
  "/organizations/:organizationId/succession-plans/:planId/candidates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.confidential.read"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const planId = Number(req.params["planId"]);
    const plan = await succession.getPlan(organizationId, planId);
    if (!plan) {
      res.status(404).json({ error: "Succession plan not found" });
      return;
    }
    await recordSensitiveRead({
      organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      targetType: "succession_candidate",
      targetId: planId,
      reason: "confidential candidate pool",
    });
    const includeRemoved = req.query["includeRemoved"] === "true";
    res.json(await succession.listCandidates(organizationId, planId, { includeRemoved }));
  }),
);

router.post(
  "/organizations/:organizationId/succession-plans/:planId/candidates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.manage"),
  guard(async (req, res) => {
    const parsed = NominateSuccessionCandidateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Nominating appoints nobody and changes no employment state (§30.16).
    res.status(201).json(
      await succession.nominateCandidate({
        organizationId: req.membership!.organizationId,
        planId: Number(req.params["planId"]),
        employeeId: parsed.data.employeeId,
        readinessLevelId: parsed.data.readinessLevelId ?? null,
        rationale: parsed.data.rationale ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.post(
  "/organizations/:organizationId/succession-candidates/:candidateId/readiness",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.manage"),
  guard(async (req, res) => {
    const parsed = SetSuccessionReadinessBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // A human chose this level. Nothing computes it (§30.13).
    res.json(
      await succession.setReadiness({
        organizationId: req.membership!.organizationId,
        candidateId: Number(req.params["candidateId"]),
        readinessLevelId: parsed.data.readinessLevelId,
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.post(
  "/organizations/:organizationId/succession-candidates/:candidateId/remove",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.manage"),
  guard(async (req, res) => {
    const parsed = RemoveSuccessionCandidateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(
      await succession.removeCandidate({
        organizationId: req.membership!.organizationId,
        candidateId: Number(req.params["candidateId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.get(
  "/organizations/:organizationId/succession-candidates/:candidateId/history",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.confidential.read"),
  guard(async (req, res) => {
    const organizationId = req.membership!.organizationId;
    const candidateId = Number(req.params["candidateId"]);
    const candidate = await succession.getCandidate(organizationId, candidateId);
    if (!candidate) {
      res.status(404).json({ error: "Succession candidate not found" });
      return;
    }
    await recordSensitiveRead({
      organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      targetType: "succession_candidate",
      targetId: candidateId,
      subjectEmployeeId: candidate.employeeId,
      reason: "candidate readiness history",
    });
    res.json(await succession.listCandidateEvents(organizationId, candidateId));
  }),
);

/** Coverage counts only. No candidate identity, rationale or note (§30.25). */
router.get(
  "/organizations/:organizationId/succession/coverage",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("succession.read"),
  guard(async (req, res) => {
    res.json({ coverage: await succession.successionCoverage(req.membership!.organizationId) });
  }),
);

// ---------------------------------------------------------------------------
// Development actions (§30.14)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/development-actions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.read"),
  guard(async (req, res) => {
    const employeeId = req.query["employeeId"] ? Number(req.query["employeeId"]) : undefined;
    res.json(await succession.listDevelopmentActions(req.membership!.organizationId, { employeeId }));
  }),
);

router.post(
  "/organizations/:organizationId/development-actions",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.manage"),
  guard(async (req, res) => {
    const parsed = CreateDevelopmentActionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Learning references are validated for ownership and then left alone —
    // nothing enrols anybody (§30.14).
    res.status(201).json(
      await succession.createDevelopmentAction({
        organizationId: req.membership!.organizationId,
        employeeId: parsed.data.employeeId,
        action: parsed.data.action,
        skillId: parsed.data.skillId ?? null,
        successionCandidateId: parsed.data.successionCandidateId ?? null,
        targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : null,
        learningCourseId: parsed.data.learningCourseId ?? null,
        learningEnrollmentId: parsed.data.learningEnrollmentId ?? null,
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

router.patch(
  "/organizations/:organizationId/development-actions/:actionId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_skill.manage"),
  guard(async (req, res) => {
    const parsed = UpdateDevelopmentActionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    res.json(
      await succession.updateDevelopmentAction({
        organizationId: req.membership!.organizationId,
        actionId: Number(req.params["actionId"]),
        action: parsed.data.action,
        status: parsed.data.status,
        targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      }),
    );
  }),
);

export default router;
