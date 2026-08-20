/**
 * Learning Courses (Phase 3D, W86 — Course Catalog & Sessions):
 * docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §21's own frozen route
 * list — GET is "read broad" (learning.read.own, mirroring
 * performance.read.own's identical precedent for templates); every
 * mutating route requires learning.manage.
 */
import { Router } from "express";
import { CreateLearningCourseBody, UpdateLearningCourseBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { LEARNING_MODULE_KEY } from "../lib/learningAuthorization";
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  LearningCourseNotFoundError,
  InvalidLearningCourseError,
  LearningCourseArchivedError,
} from "../lib/learningCourses";

const router = Router();

function parseId(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(value ?? "", 10);
}

// GET /organizations/:organizationId/learning/courses
router.get(
  "/organizations/:organizationId/learning/courses",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.read.own"),
  async (req: MembershipRequest, res): Promise<void> => {
    const courses = await listCourses(req.membership!.organizationId);
    res.json(courses);
  },
);

// POST /organizations/:organizationId/learning/courses
router.post(
  "/organizations/:organizationId/learning/courses",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(LEARNING_MODULE_KEY),
  requirePermission("learning.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateLearningCourseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const course = await createCourse({
        organizationId: req.membership!.organizationId,
        categoryCode: parsed.data.categoryCode,
        title: parsed.data.title,
        description: parsed.data.description,
        deliveryMode: parsed.data.deliveryMode,
        mandatoryDefault: parsed.data.mandatoryDefault,
        requiresApproval: parsed.data.requiresApproval,
        hasAssessment: parsed.data.hasAssessment,
        issuesCertificate: parsed.data.issuesCertificate,
        certificateValidityMonths: parsed.data.certificateValidityMonths,
        status: parsed.data.status,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(course);
    } catch (err) {
      if (err instanceof InvalidLearningCourseError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// GET /organizations/:organizationId/learning/courses/:id
router.get(
  "/organizations/:organizationId/learning/courses/:id",
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

    const course = await getCourse(req.membership!.organizationId, courseId);
    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }
    res.json(course);
  },
);

// PATCH /organizations/:organizationId/learning/courses/:id
router.patch(
  "/organizations/:organizationId/learning/courses/:id",
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

    const parsed = UpdateLearningCourseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const updated = await updateCourse({
        organizationId: req.membership!.organizationId,
        courseId,
        categoryCode: parsed.data.categoryCode,
        title: parsed.data.title,
        description: parsed.data.description,
        deliveryMode: parsed.data.deliveryMode,
        mandatoryDefault: parsed.data.mandatoryDefault,
        requiresApproval: parsed.data.requiresApproval,
        hasAssessment: parsed.data.hasAssessment,
        issuesCertificate: parsed.data.issuesCertificate,
        certificateValidityMonths: parsed.data.certificateValidityMonths,
        status: parsed.data.status,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (err instanceof LearningCourseNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err instanceof LearningCourseArchivedError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof InvalidLearningCourseError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

export default router;
