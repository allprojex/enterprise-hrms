/**
 * Learning Enrollments (Phase 3D, W87 — Enrollment, Assignment & Approval):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §21's own frozen route
 * list. Server-derived identity throughout — no client-supplied
 * employeeId/managerEmployeeId/approverId is ever trusted as authority.
 */
import { Router, type Response } from "express";
import {
  RequestLearningEnrollmentBody,
  AssignLearningEnrollmentsBody,
  CancelLearningEnrollmentBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { hasPermission } from "../lib/permissions";
import {
  LEARNING_MODULE_KEY,
  resolveLearningActorEmployeeId,
  hasOrgWideLearningAccess,
  isOwnLearningRecord,
  isManagerOfRecord,
  isInstructorOfRecord,
} from "../lib/learningAuthorization";
import { db, learningCourseSessionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { toIsoDate } from "../lib/leaveRequests";
import {
  requestEnrollment,
  assignEnrollments,
  listMyEnrollments,
  listTeamEnrollments,
  listEnrollments,
  getEnrollment,
  decideEnrollmentApproval,
  cancelEnrollment,
  LearningCourseNotEnrollableError,
  LearningCourseSessionNotEnrollableError,
  LearningSessionCapacityError,
  LearningDuplicateEnrollmentError,
  LearningEnrollmentNotFoundError,
  LearningEnrollmentForbiddenError,
  LearningApprovalConflictError,
  LearningCancelConflictError,
  InvalidLearningEnrollmentError,
  CrossOrganizationReferenceError,
} from "../lib/learningEnrollments";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

function iso(d: Date | null | undefined): string | undefined | null {
  if (d === undefined) return undefined;
  if (d === null) return null;
  return toIsoDate(d);
}

function handleEnrollmentError(err: unknown, res: Response): void {
  if (err instanceof LearningEnrollmentNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof LearningCourseNotEnrollableError && err.message === "Course not found") {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof LearningCourseSessionNotEnrollableError && err.message === "Session not found") {
    res.status(404).json({ error: err.message });
    return;
  }
  if (err instanceof LearningEnrollmentForbiddenError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (
    err instanceof LearningCourseNotEnrollableError ||
    err instanceof LearningCourseSessionNotEnrollableError ||
    err instanceof LearningSessionCapacityError ||
    err instanceof LearningDuplicateEnrollmentError ||
    err instanceof LearningApprovalConflictError ||
    err instanceof LearningCancelConflictError
  ) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof InvalidLearningEnrollmentError || err instanceof CrossOrganizationReferenceError) {
    res.status(400).json({ error: err.message });
    return;
  }
  throw err;
}

// POST /organizations/:organizationId/learning/courses/:id/enroll
router.post(
  "/organizations/:organizationId/learning/courses/:id/enroll",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.write.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const courseId = parseId(req.params.id);
    if (isNaN(courseId)) {
      res.status(400).json({ error: "Invalid course ID" });
      return;
    }
    const parsed = RequestLearningEnrollmentBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);

    try {
      const enrollment = await requestEnrollment({
        organizationId,
        courseId,
        sessionId: parsed.data.sessionId,
        callerEmployeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(enrollment);
    } catch (err) {
      handleEnrollmentError(err, res);
    }
  },
);

// POST /organizations/:organizationId/learning/courses/:id/assign
// Coarse floor: either learning.manage (HR/L&D, full audience targeting)
// or learning.review.write (manager of record, direct reports only via
// scope='manual') — the real dispatch happens in assignEnrollments itself
// via isOrgWide, mirroring performanceSelfAssessment.ts's own dual-floor
// competency-rating route.
router.post(
  "/organizations/:organizationId/learning/courses/:id/assign",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  async (req: MembershipRequest, res, next): Promise<void> => {
    const allowed = (await hasPermission(req.membership!.id, "learning.manage")) || (await hasPermission(req.membership!.id, "learning.review.write"));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
  async (req: MembershipRequest, res): Promise<void> => {
    const courseId = parseId(req.params.id);
    if (isNaN(courseId)) {
      res.status(400).json({ error: "Invalid course ID" });
      return;
    }
    const parsed = AssignLearningEnrollmentsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");
    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);

    try {
      const result = await assignEnrollments({
        organizationId,
        courseId,
        sessionId: parsed.data.sessionId,
        scope: parsed.data.scope,
        departmentIds: parsed.data.departmentId != null ? [parsed.data.departmentId] : undefined,
        positionIds: parsed.data.positionId != null ? [parsed.data.positionId] : undefined,
        employeeIds: parsed.data.employeeIds,
        mandatoryOverride: parsed.data.mandatory,
        dueDate: iso(parsed.data.dueDate) ?? undefined,
        isOrgWide,
        callerEmployeeId,
        assignedByMembershipId: req.membership!.id,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(result);
    } catch (err) {
      handleEnrollmentError(err, res);
    }
  },
);

// GET /organizations/:organizationId/learning/my-enrollments
router.get(
  "/organizations/:organizationId/learning/my-enrollments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    if (employeeId == null) {
      res.json([]);
      return;
    }
    res.json(await listMyEnrollments(organizationId, employeeId));
  },
);

// GET /organizations/:organizationId/learning/team-enrollments
router.get(
  "/organizations/:organizationId/learning/team-enrollments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.review.write"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const managerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    if (managerEmployeeId == null) {
      res.json([]);
      return;
    }
    res.json(await listTeamEnrollments(organizationId, managerEmployeeId));
  },
);

// GET /organizations/:organizationId/learning/enrollments
// learning.manage only, org-wide — mirrors Performance's own W80
// GET /reviews precedent exactly (my-enrollments/team-enrollments already
// cover own/manager-of-record scope; this route is not widened to
// resolve that scope a second way).
router.get(
  "/organizations/:organizationId/learning/enrollments",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const optionalId = (raw: unknown): number | undefined => {
      if (raw == null) return undefined;
      const parsed = parseId(raw as string);
      return isNaN(parsed) ? undefined : parsed;
    };
    const courseId = optionalId(req.query.courseId);
    const employeeId = optionalId(req.query.employeeId);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const approvalStatus = typeof req.query.approvalStatus === "string" ? req.query.approvalStatus : undefined;
    const rawPage = optionalId(req.query.page);
    const rawPageSize = optionalId(req.query.pageSize);
    const page = rawPage != null && rawPage > 0 ? rawPage : 1;
    const pageSize = rawPageSize != null && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 20;

    const result = await listEnrollments({
      organizationId: req.membership!.organizationId,
      courseId,
      employeeId,
      status,
      approvalStatus,
      page,
      pageSize,
    });
    res.json(result);
  },
);

// GET /organizations/:organizationId/learning/enrollments/:id
// Coarse floor: learning.read.own (broadest key, seeded to every role);
// fine-grained scope (own/manager-of-record/instructor-of-record/org-wide)
// resolved below, mirroring performanceCycles.ts's own GET .../reviews/:id.
router.get(
  "/organizations/:organizationId/learning/enrollments/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const enrollmentId = parseId(req.params.id);
    if (isNaN(enrollmentId)) {
      res.status(400).json({ error: "Invalid enrollment ID" });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const enrollment = await getEnrollment(organizationId, enrollmentId);
    if (!enrollment) {
      res.status(404).json({ error: "Enrollment not found" });
      return;
    }

    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);
    const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");
    const isOwn = isOwnLearningRecord(callerEmployeeId, enrollment.employeeId);
    const isManager = isManagerOfRecord(callerEmployeeId, enrollment.managerEmployeeIdSnapshot);
    let isInstructor = false;
    if (!isOrgWide && !isOwn && !isManager && enrollment.sessionId != null) {
      const [session] = await db
        .select()
        .from(learningCourseSessionsTable)
        .where(and(eq(learningCourseSessionsTable.id, enrollment.sessionId), eq(learningCourseSessionsTable.organizationId, organizationId)))
        .limit(1);
      isInstructor = isInstructorOfRecord(callerEmployeeId, session?.instructorEmployeeId ?? null);
    }
    if (!isOrgWide && !isOwn && !isManager && !isInstructor) {
      res.status(403).json({ error: "Not authorized to view this enrollment" });
      return;
    }
    res.json(enrollment);
  },
);

// POST /organizations/:organizationId/learning/enrollments/:id/approve
// POST /organizations/:organizationId/learning/enrollments/:id/reject
for (const decision of ["approve", "reject"] as const) {
  router.post(
    `/organizations/:organizationId/learning/enrollments/:id/${decision}`,
    requireAuth as any,
    requireMembership("organizationId"),
    requireModuleEnabled(LEARNING_MODULE_KEY),
    async (req: MembershipRequest, res, next): Promise<void> => {
      const allowed = (await hasPermission(req.membership!.id, "learning.manage")) || (await hasPermission(req.membership!.id, "learning.review.write"));
      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    },
    async (req: MembershipRequest, res): Promise<void> => {
      const enrollmentId = parseId(req.params.id);
      if (isNaN(enrollmentId)) {
        res.status(400).json({ error: "Invalid enrollment ID" });
        return;
      }
      const organizationId = req.membership!.organizationId;
      const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");
      const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);

      try {
        const updated = await decideEnrollmentApproval({
          organizationId,
          enrollmentId,
          decision: decision === "approve" ? "approved" : "rejected",
          callerEmployeeId,
          isOrgWide,
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
        });
        res.json(updated);
      } catch (err) {
        handleEnrollmentError(err, res);
      }
    },
  );
}

// POST /organizations/:organizationId/learning/enrollments/:id/cancel
// Coarse floor: learning.write.own (own not-yet-started, non-mandatory) or
// learning.manage (any enrollment, reason required) — dispatched inside
// cancelEnrollment itself via isOrgWide.
router.post(
  "/organizations/:organizationId/learning/enrollments/:id/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  async (req: MembershipRequest, res, next): Promise<void> => {
    const allowed = (await hasPermission(req.membership!.id, "learning.write.own")) || (await hasPermission(req.membership!.id, "learning.manage"));
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
  async (req: MembershipRequest, res): Promise<void> => {
    const enrollmentId = parseId(req.params.id);
    if (isNaN(enrollmentId)) {
      res.status(400).json({ error: "Invalid enrollment ID" });
      return;
    }
    const parsed = CancelLearningEnrollmentBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organizationId = req.membership!.organizationId;
    const isOrgWide = await hasOrgWideLearningAccess(req.membership!.id, "learning.manage");
    const callerEmployeeId = await resolveLearningActorEmployeeId(organizationId, req.userId!);

    try {
      const updated = await cancelEnrollment({
        organizationId,
        enrollmentId,
        callerEmployeeId,
        isOrgWide,
        reason: parsed.data.cancelReason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      handleEnrollmentError(err, res);
    }
  },
);

export default router;
