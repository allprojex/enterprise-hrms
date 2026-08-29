import { Router } from "express";
import {
  OpenDisciplinaryCaseBody,
  RecordDisciplinaryEventBody,
  ChangeDisciplinaryStageBody,
  RecordDisciplinaryOutcomeBody,
  CloseDisciplinaryCaseBody,
  ReopenDisciplinaryCaseBody,
  AttachDisciplinaryEvidenceBody,
  AttachGrievanceEvidenceBody,
  SubmitGrievanceBody,
  AcknowledgeGrievanceBody,
  AssignGrievanceBody,
  ResolveGrievanceBody,
  CloseGrievanceBody,
  WithdrawMyGrievanceBody,
  SubmitMyGrievanceBody,
  RecordGrievanceEventBody,
  CreateClearanceTemplateBody,
  UpdateClearanceTemplateBody,
  AddClearanceTemplateItemBody,
  InitiateOffboardingBody,
  AddClearanceItemBody,
  CompleteClearanceItemBody,
  ReturnClearanceItemBody,
  WaiveClearanceItemBody,
  CancelOffboardingBody,
  ScheduleExitInterviewBody,
  CompleteExitInterviewBody,
  CancelExitInterviewBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { hasPermission } from "../lib/permissions";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { recordSensitiveRead } from "../lib/sensitiveRead";
import * as disciplinary from "../lib/employeeRelations/disciplinary";
import * as grievance from "../lib/employeeRelations/grievance";
import * as offboarding from "../lib/employeeRelations/offboarding";
import * as clearance from "../lib/employeeRelations/clearance";
import * as exitInterview from "../lib/employeeRelations/exitInterview";
import * as readModels from "../lib/employeeRelations/readModels";

/**
 * WS-12 — Employee Relations & Offboarding Clearance routes (§28).
 *
 * AUTHORIZATION IS ENFORCED HERE, ON THE SERVER, ON EVERY ROUTE. Frontend
 * hiding is not authorization, and §28.17's grievance rule in particular only
 * means anything because `requirePermission("grievance.read")` sits in front of
 * every grievance surface below — an Organization Administrator who has not been
 * granted the key gets a 403 from this file, regardless of what any UI shows.
 *
 * THE ORGANIZATION ID IS NEVER TAKEN FROM THE CLIENT. Every handler reads
 * `req.membership!.organizationId`, which `requireMembership` resolved from the
 * caller's own verified membership. The `:organizationId` path parameter is
 * matched against it by that middleware and is never used as a query predicate
 * here — which is what makes a forged cross-tenant id fail safely rather than
 * silently address another organization's rows.
 */

const router = Router();

function mapDomainError(err: unknown, res: import("express").Response): boolean {
  if (
    err instanceof disciplinary.DisciplinaryCaseNotFoundError ||
    err instanceof grievance.GrievanceCaseNotFoundError ||
    err instanceof offboarding.OffboardingNotFoundError ||
    err instanceof clearance.ClearanceTemplateNotFoundError ||
    err instanceof clearance.ClearanceItemNotFoundError ||
    err instanceof exitInterview.ExitInterviewNotFoundError ||
    err instanceof disciplinary.EmployeeNotFoundForCaseError ||
    err instanceof grievance.EmployeeNotFoundForGrievanceError
  ) {
    res.status(404).json({ error: (err as Error).message });
    return true;
  }
  if (
    err instanceof offboarding.OffboardingAlreadyOpenError ||
    err instanceof exitInterview.ExitInterviewAlreadyExistsError
  ) {
    res.status(409).json({ error: (err as Error).message });
    return true;
  }
  if (
    err instanceof disciplinary.InvalidDisciplinaryCaseError ||
    err instanceof disciplinary.CaseNotOpenError ||
    err instanceof grievance.InvalidGrievanceError ||
    err instanceof grievance.GrievanceNotActionableError ||
    err instanceof offboarding.NoSeparationBasisError ||
    err instanceof offboarding.OffboardingNotActionableError ||
    err instanceof offboarding.RequiredClearanceOutstandingError ||
    err instanceof clearance.InvalidClearanceError ||
    err instanceof clearance.WaiverReasonRequiredError ||
    err instanceof exitInterview.InvalidExitInterviewError
  ) {
    res.status(422).json({ error: (err as Error).message });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Disciplinary cases (§28.3)
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/disciplinary-cases",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = req.query["employeeId"] ? Number(req.query["employeeId"]) : undefined;
    const status = req.query["status"] as "open" | "closed" | undefined;
    // No sensitive-read audit on the LIST: §28.12 keeps OD #18 risk-based rather
    // than noisy, and seeing the queue is not reading anybody's evidence.
    const cases = await disciplinary.listCases(req.membership!.organizationId, { employeeId, status });
    res.json(cases);
  },
);

router.get(
  "/organizations/:organizationId/disciplinary-cases/:caseId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const caseId = Number(req.params["caseId"]);
    const record = await disciplinary.getCase(organizationId, caseId);
    if (!record) {
      res.status(404).json({ error: "Disciplinary case not found" });
      return;
    }
    const events = await disciplinary.listCaseEvents(organizationId, caseId);

    // OD #18 (§28.12): opening a specific case IS a sensitive read.
    await recordSensitiveRead({
      organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      targetType: "disciplinary_case",
      targetId: caseId,
      subjectEmployeeId: record.employeeId,
      reason: record.confidentiality,
    });

    res.json({ ...record, events });
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = OpenDisciplinaryCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await disciplinary.openCase({
        organizationId: req.membership!.organizationId,
        employeeId: parsed.data.employeeId,
        categoryCode: parsed.data.categoryCode,
        severityCode: parsed.data.severityCode ?? null,
        stageCode: parsed.data.stageCode ?? null,
        subject: parsed.data.subject,
        description: parsed.data.description ?? null,
        confidentiality: parsed.data.confidentiality,
        responsibleMembershipId: parsed.data.responsibleMembershipId ?? null,
        openedAt: new Date(parsed.data.openedAt),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases/:caseId/events",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RecordDisciplinaryEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const event = await disciplinary.recordEvent({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        eventType: parsed.data.eventType,
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(event);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases/:caseId/stage",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ChangeDisciplinaryStageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await disciplinary.changeStage({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        stageCode: parsed.data.stageCode,
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases/:caseId/outcome",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RecordDisciplinaryOutcomeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      // Recording an outcome separates nobody (§28.7). No employment status is
      // touched by anything downstream of this call.
      const updated = await disciplinary.recordOutcome({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        outcomeCode: parsed.data.outcomeCode,
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        warningExpiresAt: parsed.data.warningExpiresAt ? new Date(parsed.data.warningExpiresAt) : null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases/:caseId/close",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CloseDisciplinaryCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await disciplinary.closeCase({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases/:caseId/reopen",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ReopenDisciplinaryCaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await disciplinary.reopenCase({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        occurredAt: new Date(parsed.data.occurredAt),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/disciplinary-cases/:caseId/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AttachDisciplinaryEvidenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const event = await disciplinary.attachEvidence({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        documentId: parsed.data.documentId,
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(event);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Grievance cases (§28.4) — HR-facing surfaces, gated on the grievance keys
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/grievances",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const status = req.query["status"] as never;
    const cases = await grievance.listCases(req.membership!.organizationId, { status });
    res.json(cases);
  },
);

router.get(
  "/organizations/:organizationId/grievances/:caseId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const caseId = Number(req.params["caseId"]);
    const record = await grievance.getCase(organizationId, caseId);
    if (!record) {
      res.status(404).json({ error: "Grievance case not found" });
      return;
    }
    const events = await grievance.listCaseEvents(organizationId, caseId);

    await recordSensitiveRead({
      organizationId,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      targetType: "grievance_case",
      targetId: caseId,
      subjectEmployeeId: record.complainantEmployeeId,
      reason: record.confidentiality,
    });

    res.json({ ...record, events });
  },
);

router.post(
  "/organizations/:organizationId/grievances",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = SubmitGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await grievance.submitGrievance({
        organizationId: req.membership!.organizationId,
        complainantEmployeeId: parsed.data.complainantEmployeeId,
        categoryCode: parsed.data.categoryCode,
        respondentType: parsed.data.respondentType,
        respondentEmployeeId: parsed.data.respondentEmployeeId ?? null,
        respondentDepartmentId: parsed.data.respondentDepartmentId ?? null,
        subject: parsed.data.subject,
        description: parsed.data.description,
        submittedAt: new Date(parsed.data.submittedAt),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/grievances/:caseId/acknowledge",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AcknowledgeGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await grievance.acknowledge({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/grievances/:caseId/assign",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AssignGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await grievance.assign({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        assignedMembershipId: parsed.data.assignedMembershipId,
        occurredAt: new Date(parsed.data.occurredAt),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/grievances/:caseId/events",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RecordGrievanceEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const event = await grievance.appendEvent({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        eventType: parsed.data.eventType,
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        // Defaults to false in the service. Making a note employee-visible is a
        // deliberate act by whoever writes it (§28.5).
        visibleToComplainant: parsed.data.visibleToComplainant ?? false,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(event);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/grievances/:caseId/resolve",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ResolveGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await grievance.resolve({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        resolutionSummary: parsed.data.resolutionSummary,
        occurredAt: new Date(parsed.data.occurredAt),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/grievances/:caseId/close",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CloseGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await grievance.closeCase({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/grievances/:caseId/evidence",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AttachGrievanceEvidenceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const event = await grievance.attachEvidence({
        organizationId: req.membership!.organizationId,
        caseId: Number(req.params["caseId"]),
        documentId: parsed.data.documentId,
        occurredAt: new Date(parsed.data.occurredAt),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(event);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Grievance — Employee Self-Service (§28.5)
// ---------------------------------------------------------------------------

/**
 * An employee's OWN grievances.
 *
 * Note what gates this: NOT a permission key. §28.17 mints none for ESS,
 * following the WS-10 precedent — an employee's right to their own grievance
 * comes from `employee_user_links`, resolved server-side by
 * `resolveOwnEmployeeId`. A caller with no linked employee record gets an empty
 * list, and a caller cannot ask about anybody else because no employee id is
 * accepted from the request at all.
 */
router.get(
  "/organizations/:organizationId/my-grievances",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!ownEmployeeId) {
      res.json([]);
      return;
    }
    const cases = await grievance.listCases(organizationId, { complainantEmployeeId: ownEmployeeId });
    // The ESS view is built field by field — never a spread of the full record.
    const views = await Promise.all(
      cases.map(async (c) => {
        const events = await grievance.listCaseEvents(organizationId, c.id, { onlyVisibleToComplainant: true });
        return grievance.toEssView(c, events);
      }),
    );
    res.json(views);
  },
);

router.get(
  "/organizations/:organizationId/my-grievances/:caseId",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const record = await grievance.getCase(organizationId, Number(req.params["caseId"]));
    // A grievance belonging to somebody else is reported as NOT FOUND rather
    // than FORBIDDEN: a 403 would confirm the case exists, which is itself a
    // disclosure about a colleague's complaint.
    if (!record || !ownEmployeeId || record.complainantEmployeeId !== ownEmployeeId) {
      res.status(404).json({ error: "Grievance case not found" });
      return;
    }
    const events = await grievance.listCaseEvents(organizationId, record.id, { onlyVisibleToComplainant: true });
    // Deliberately NOT sensitive-read audited: §28.12 excludes an employee
    // reading their own complaint. Auditing somebody for looking at their own
    // grievance would be its own kind of wrong.
    res.json(grievance.toEssView(record, events));
  },
);

router.post(
  "/organizations/:organizationId/my-grievances",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = SubmitMyGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!ownEmployeeId) {
      res.status(403).json({ error: "No employee record is linked to this account." });
      return;
    }
    try {
      const created = await grievance.submitGrievance({
        organizationId,
        // Taken from the link, never from the body — an employee cannot file a
        // grievance in a colleague's name.
        complainantEmployeeId: ownEmployeeId,
        categoryCode: parsed.data.categoryCode,
        respondentType: parsed.data.respondentType,
        respondentEmployeeId: parsed.data.respondentEmployeeId ?? null,
        respondentDepartmentId: parsed.data.respondentDepartmentId ?? null,
        subject: parsed.data.subject,
        description: parsed.data.description,
        submittedAt: new Date(parsed.data.submittedAt),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const events = await grievance.listCaseEvents(organizationId, created.id, { onlyVisibleToComplainant: true });
      res.status(201).json(grievance.toEssView(created, events));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/my-grievances/:caseId/withdraw",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = WithdrawMyGrievanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const ownEmployeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    const record = await grievance.getCase(organizationId, Number(req.params["caseId"]));
    if (!record || !ownEmployeeId || record.complainantEmployeeId !== ownEmployeeId) {
      res.status(404).json({ error: "Grievance case not found" });
      return;
    }
    try {
      const updated = await grievance.withdraw({
        organizationId,
        caseId: record.id,
        occurredAt: new Date(parsed.data.occurredAt),
        reason: parsed.data.reason ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      const events = await grievance.listCaseEvents(organizationId, updated.id, { onlyVisibleToComplainant: true });
      res.json(grievance.toEssView(updated, events));
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Clearance templates (§28.8, §28.18) — configuration authority
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/clearance-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json(await clearance.listTemplates(req.membership!.organizationId));
  },
);

router.get(
  "/organizations/:organizationId/clearance-templates/:templateId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const templateId = Number(req.params["templateId"]);
    const template = await clearance.getTemplate(organizationId, templateId);
    if (!template) {
      res.status(404).json({ error: "Clearance template not found" });
      return;
    }
    res.json({ ...template, items: await clearance.listTemplateItems(organizationId, templateId) });
  },
);

router.post(
  "/organizations/:organizationId/clearance-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateClearanceTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await clearance.createTemplate({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.patch(
  "/organizations/:organizationId/clearance-templates/:templateId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = UpdateClearanceTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await clearance.updateTemplate({
        organizationId: req.membership!.organizationId,
        templateId: Number(req.params["templateId"]),
        name: parsed.data.name,
        description: parsed.data.description,
        status: parsed.data.status,
        isDefault: parsed.data.isDefault,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/clearance-templates/:templateId/items",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AddClearanceTemplateItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await clearance.addTemplateItem({
        organizationId: req.membership!.organizationId,
        templateId: Number(req.params["templateId"]),
        label: parsed.data.label,
        description: parsed.data.description ?? null,
        itemType: parsed.data.itemType,
        required: parsed.data.required,
        responsibleDepartmentId: parsed.data.responsibleDepartmentId ?? null,
        sequence: parsed.data.sequence,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.delete(
  "/organizations/:organizationId/clearance-templates/:templateId/items/:itemId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      await clearance.removeTemplateItem({
        organizationId: req.membership!.organizationId,
        templateId: Number(req.params["templateId"]),
        itemId: Number(req.params["itemId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(204).send();
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Offboarding (§28.6–28.8)
// ---------------------------------------------------------------------------

/**
 * Whether an offboarding may begin, and on what authoritative basis.
 *
 * Exposed as its own read so a UI can explain the refusal rather than only
 * showing a disabled button — the reason a basis is missing is actionable.
 */
router.get(
  "/organizations/:organizationId/employees/:employeeId/offboarding-eligibility",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const basis = await offboarding.resolveSeparationBasis(
      req.membership!.organizationId,
      Number(req.params["employeeId"]),
    );
    res.json({
      eligible: basis !== null,
      basis: basis?.basis ?? null,
      expectedSeparationDate: basis?.expectedSeparationDate ?? null,
      evidence: basis?.evidence ?? null,
    });
  },
);

router.get(
  "/organizations/:organizationId/offboarding",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const employeeId = req.query["employeeId"] ? Number(req.query["employeeId"]) : undefined;
    res.json(await offboarding.listOffboarding(req.membership!.organizationId, { employeeId }));
  },
);

router.get(
  "/organizations/:organizationId/offboarding/:exitProcessId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const exitProcessId = Number(req.params["exitProcessId"]);
    const process = await offboarding.getOffboarding(organizationId, exitProcessId);
    if (!process) {
      res.status(404).json({ error: "Offboarding not found" });
      return;
    }
    // Reflects an actual separation that WS-11 already recorded. Observational.
    const synced = await offboarding.syncActualSeparation({ organizationId, exitProcessId });
    const [items, progress, custody, interview] = await Promise.all([
      clearance.listItems(organizationId, exitProcessId),
      offboarding.computeClearanceProgress(organizationId, exitProcessId),
      clearance.summarizeOutstandingCustody(organizationId, process.employeeId),
      exitInterview.getByExitProcess(organizationId, exitProcessId),
    ]);
    res.json({ ...(synced ?? process), items, progress, outstandingCustody: custody, exitInterview: interview ?? null });
  },
);

router.post(
  "/organizations/:organizationId/employees/:employeeId/offboarding",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = InitiateOffboardingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await offboarding.initiateOffboarding({
        organizationId: req.membership!.organizationId,
        employeeId: Number(req.params["employeeId"]),
        clearanceTemplateId: parsed.data.clearanceTemplateId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(result);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/offboarding/:exitProcessId/final-clearance",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      // Grants clearance. Terminates nobody (§28.7).
      const result = await offboarding.grantFinalClearance({
        organizationId: req.membership!.organizationId,
        exitProcessId: Number(req.params["exitProcessId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(result);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/offboarding/:exitProcessId/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CancelOffboardingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await offboarding.cancelOffboarding({
        organizationId: req.membership!.organizationId,
        exitProcessId: Number(req.params["exitProcessId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Clearance items (§28.8–28.10)
// ---------------------------------------------------------------------------

router.post(
  "/organizations/:organizationId/offboarding/:exitProcessId/clearance-items",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AddClearanceItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await clearance.addItem({
        organizationId: req.membership!.organizationId,
        exitProcessId: Number(req.params["exitProcessId"]),
        label: parsed.data.label,
        description: parsed.data.description ?? null,
        itemType: parsed.data.itemType,
        required: parsed.data.required,
        responsibleDepartmentId: parsed.data.responsibleDepartmentId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

/**
 * Acting on a clearance item.
 *
 * Gated on `clearance.act` — the key a stores officer or IT desk holds. It
 * authorizes this and nothing else: no case access, no grievance access, and no
 * final clearance. Completing an item here returns no asset and moves no stock
 * (§28.9, §28.10).
 */
router.post(
  "/organizations/:organizationId/clearance-items/:itemId/complete",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("clearance.act"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CompleteClearanceItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await clearance.completeItem({
        organizationId: req.membership!.organizationId,
        itemId: Number(req.params["itemId"]),
        comment: parsed.data.comment ?? null,
        evidenceDocumentId: parsed.data.evidenceDocumentId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/clearance-items/:itemId/return",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("clearance.act"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ReturnClearanceItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await clearance.returnItem({
        organizationId: req.membership!.organizationId,
        itemId: Number(req.params["itemId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

/**
 * Waiving an item is `offboarding.manage`, NOT `clearance.act`.
 *
 * Deliberate: the desk that cannot recover a laptop should report that, and
 * whoever runs the offboarding should decide to let the file close without it.
 * Letting the same person do both would make the escape hatch self-service.
 */
router.post(
  "/organizations/:organizationId/clearance-items/:itemId/waive",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = WaiveClearanceItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await clearance.waiveItem({
        organizationId: req.membership!.organizationId,
        itemId: Number(req.params["itemId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Exit interviews (§28.15)
// ---------------------------------------------------------------------------

router.post(
  "/organizations/:organizationId/offboarding/:exitProcessId/exit-interview",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ScheduleExitInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await exitInterview.scheduleInterview({
        organizationId: req.membership!.organizationId,
        exitProcessId: Number(req.params["exitProcessId"]),
        interviewDate: parsed.data.interviewDate ? new Date(parsed.data.interviewDate) : null,
        interviewerMembershipId: parsed.data.interviewerMembershipId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(created);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/exit-interviews/:interviewId/complete",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CompleteExitInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await exitInterview.completeInterview({
        organizationId: req.membership!.organizationId,
        interviewId: Number(req.params["interviewId"]),
        interviewDate: parsed.data.interviewDate ? new Date(parsed.data.interviewDate) : null,
        reasonForLeavingCode: parsed.data.reasonForLeavingCode ?? null,
        confidentialNotes: parsed.data.confidentialNotes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/exit-interviews/:interviewId/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CancelExitInterviewBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await exitInterview.cancelInterview({
        organizationId: req.membership!.organizationId,
        interviewId: Number(req.params["interviewId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Reporting read models (§28.23)
// ---------------------------------------------------------------------------

/**
 * Each read model is gated on the SAME permission as the records it aggregates.
 *
 * The disciplinary and grievance models are split across two endpoints for that
 * reason: merging them into one "employee relations dashboard" would force a
 * single key over both, and §28.17 keeps grievance visibility separate from
 * disciplinary visibility on purpose.
 */
router.get(
  "/organizations/:organizationId/employee-relations/reports/disciplinary",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("employee_relations.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ openCases: await readModels.openDisciplinaryCases(req.membership!.organizationId) });
  },
);

router.get(
  "/organizations/:organizationId/employee-relations/reports/grievances",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("grievance.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ openGrievances: await readModels.openGrievances(req.membership!.organizationId) });
  },
);

router.get(
  "/organizations/:organizationId/employee-relations/reports/offboarding",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("offboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const [inProgress, completed, outstandingAssets] = await Promise.all([
      readModels.employeesCurrentlyOffboarding(organizationId),
      readModels.completedOffboarding(organizationId),
      readModels.outstandingAssetsForOffboarding(organizationId),
    ]);
    res.json({ inProgress, completed, outstandingAssets });
  },
);

/**
 * The clearance approver queue.
 *
 * Readable by `clearance.act` holders as well as offboarding readers, because an
 * approver who cannot see their own queue cannot do the job the key exists for.
 */
router.get(
  "/organizations/:organizationId/employee-relations/reports/clearance-queue",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const membershipId = req.membership!.id;
    const allowed =
      (await hasPermission(membershipId, "clearance.act")) || (await hasPermission(membershipId, "offboarding.read"));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const responsibleDepartmentId = req.query["responsibleDepartmentId"]
      ? Number(req.query["responsibleDepartmentId"])
      : undefined;
    res.json({ outstanding: await readModels.outstandingClearance(organizationId, { responsibleDepartmentId }) });
  },
);

export default router;
