/**
 * Learning Course Sessions (Phase 3D, W86 — Course Catalog & Sessions):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §21's own frozen route
 * list — GET is "read broad" (learning.read.own); every mutating route
 * requires learning.manage.
 */
import { Router } from "express";
import { CreateLearningCourseSessionBody, UpdateLearningCourseSessionBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { LEARNING_MODULE_KEY } from "../lib/learningAuthorization";
import {
  listSessionsForCourse,
  getSession,
  createSession,
  updateSession,
  LearningCourseSessionNotFoundError,
  LearningCourseNotFoundForSessionError,
  InvalidLearningCourseSessionError,
  LearningCourseSessionLockedError,
  CrossOrganizationReferenceError,
} from "../lib/learningCourseSessions";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/learning/courses/:id/sessions
router.get(
  "/organizations/:organizationId/learning/courses/:id/sessions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const courseId = parseId(req.params.id);
    if (isNaN(courseId)) {
      res.status(400).json({ error: "Invalid course ID" });
      return;
    }
    const sessions = await listSessionsForCourse(req.membership!.organizationId, courseId);
    res.json(sessions);
  },
);

// POST /organizations/:organizationId/learning/courses/:id/sessions
router.post(
  "/organizations/:organizationId/learning/courses/:id/sessions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const courseId = parseId(req.params.id);
    if (isNaN(courseId)) {
      res.status(400).json({ error: "Invalid course ID" });
      return;
    }

    const parsed = CreateLearningCourseSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const session = await createSession({
        organizationId: req.membership!.organizationId,
        courseId,
        scheduledAt: parsed.data.scheduledAt,
        durationMinutes: parsed.data.durationMinutes,
        location: parsed.data.location,
        meetingLink: parsed.data.meetingLink,
        instructorEmployeeId: parsed.data.instructorEmployeeId,
        capacity: parsed.data.capacity,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(session);
    } catch (err) {
      if (err instanceof LearningCourseNotFoundForSessionError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidLearningCourseSessionError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/learning/sessions/:id
router.get(
  "/organizations/:organizationId/learning/sessions/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const sessionId = parseId(req.params.id);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }

    const session = await getSession(req.membership!.organizationId, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  },
);

// PATCH /organizations/:organizationId/learning/sessions/:id
router.patch(
  "/organizations/:organizationId/learning/sessions/:id",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const sessionId = parseId(req.params.id);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: "Invalid session ID" });
      return;
    }

    const parsed = UpdateLearningCourseSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateSession({
        organizationId: req.membership!.organizationId,
        sessionId,
        scheduledAt: parsed.data.scheduledAt,
        durationMinutes: parsed.data.durationMinutes,
        location: parsed.data.location,
        meetingLink: parsed.data.meetingLink,
        instructorEmployeeId: parsed.data.instructorEmployeeId,
        capacity: parsed.data.capacity,
        status: parsed.data.status,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof LearningCourseSessionNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof LearningCourseSessionLockedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidLearningCourseSessionError || err instanceof CrossOrganizationReferenceError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
