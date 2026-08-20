/**
 * Learning Courses (Phase 3D, W86 — Course Catalog & Sessions): CRUD over
 * W85's schema (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.1, §21).
 *
 * LIFECYCLE (§10.1): draft -> active -> archived is descriptive, not a
 * strictly-enforced forward-only state machine — unlike enrollment's own
 * explicit atomic-transition table (§10.3), §10.1 never enumerates illegal
 * transitions. This mirrors Performance's own review-template precedent
 * (lib/performanceReviewTemplates.ts) exactly, not Performance's review/
 * enrollment precedent: `status` may be set to any of the three values via
 * PATCH; the only hard rule is that an already-archived course blocks
 * every other field edit until it is un-archived in that same call
 * ("archived means retired; reactivate first to keep editing" — a W74-
 * local business rule there, applied identically here for consistency
 * with every other "archived means retired" resource on this platform:
 * leave_types, positions, performance_review_templates, ...). Flagged here
 * as the same kind of interpretation W74's own file header flagged.
 *
 * CATEGORY VALIDATION (§8.1, Owner Decision 7): `categoryCode` is a
 * free-text code from the `training_category` Master Data domain — NOT
 * validated against the domain's item list, explicitly per the frozen
 * plan's own text ("same precedent as employeeDocuments.categoryCode").
 * Because it is a plain string column (not a foreign key), there is no
 * cross-organization "ID" to inject or leak in the first place — the
 * value is stored entirely within the course's own already
 * organization-scoped row. No additional organization-scoping check is
 * therefore needed beyond the course row's own `organizationId`.
 *
 * CERTIFICATE CONFIG VALIDATION: `certificateValidityMonths` is only
 * meaningful when `issuesCertificate = true` (§8.1) — rejected as invalid
 * input if supplied while `issuesCertificate` is false, preventing
 * contradictory stored configuration (mirrors the platform's general
 * "don't allow nonsensical state" discipline, e.g. Performance's own
 * hrOverrideScore/hrOverrideReason pairing check).
 *
 * NO CERTIFICATE ISSUANCE, NO ASSESSMENT SUBMISSION, NO ENROLLMENT LOGIC
 * OF ANY KIND HERE — this file only configures what a course *would* do;
 * W87+ owns every actual employee-facing transition.
 */
import { and, eq } from "drizzle-orm";
import { db, learningCoursesTable, type LearningCourse } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class LearningCourseNotFoundError extends Error {
  constructor() {
    super("Course not found");
    this.name = "LearningCourseNotFoundError";
  }
}

export class InvalidLearningCourseError extends Error {}

export class LearningCourseArchivedError extends Error {
  constructor() {
    super("This course is archived and cannot be edited — reactivate it first");
    this.name = "LearningCourseArchivedError";
  }
}

async function findOwnCourse(organizationId: number, courseId: number): Promise<LearningCourse | null> {
  const [row] = await db
    .select()
    .from(learningCoursesTable)
    .where(and(eq(learningCoursesTable.id, courseId), eq(learningCoursesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listCourses(organizationId: number): Promise<LearningCourse[]> {
  return db.select().from(learningCoursesTable).where(eq(learningCoursesTable.organizationId, organizationId));
}

export async function getCourse(organizationId: number, courseId: number): Promise<LearningCourse | null> {
  return findOwnCourse(organizationId, courseId);
}

function validateCertificateConfig(issuesCertificate: boolean, certificateValidityMonths: number | null | undefined): void {
  if (!issuesCertificate && certificateValidityMonths != null) {
    throw new InvalidLearningCourseError("certificateValidityMonths may only be set when issuesCertificate is true");
  }
  if (certificateValidityMonths != null && certificateValidityMonths <= 0) {
    throw new InvalidLearningCourseError("certificateValidityMonths must be a positive number of months");
  }
}

export interface CreateLearningCourseParams {
  organizationId: number;
  categoryCode: string;
  title: string;
  description?: string;
  deliveryMode: "self_paced" | "instructor_led";
  mandatoryDefault?: boolean;
  requiresApproval?: boolean;
  hasAssessment?: boolean;
  issuesCertificate?: boolean;
  certificateValidityMonths?: number;
  status?: "draft" | "active" | "archived";
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function createCourse(params: CreateLearningCourseParams): Promise<LearningCourse> {
  const issuesCertificate = params.issuesCertificate ?? false;
  validateCertificateConfig(issuesCertificate, params.certificateValidityMonths);

  const [course] = await db
    .insert(learningCoursesTable)
    .values({
      organizationId: params.organizationId,
      categoryCode: params.categoryCode,
      title: params.title,
      description: params.description ?? null,
      deliveryMode: params.deliveryMode,
      mandatoryDefault: params.mandatoryDefault ?? false,
      requiresApproval: params.requiresApproval ?? false,
      hasAssessment: params.hasAssessment ?? false,
      issuesCertificate,
      certificateValidityMonths: params.certificateValidityMonths ?? null,
      status: params.status ?? "draft",
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "learning_course.created",
    targetType: "learning_course",
    targetId: String(course.id),
    afterState: { title: course.title, status: course.status, deliveryMode: course.deliveryMode },
  });

  return course;
}

export interface UpdateLearningCourseParams {
  organizationId: number;
  courseId: number;
  categoryCode?: string;
  title?: string;
  description?: string;
  deliveryMode?: "self_paced" | "instructor_led";
  mandatoryDefault?: boolean;
  requiresApproval?: boolean;
  hasAssessment?: boolean;
  issuesCertificate?: boolean;
  certificateValidityMonths?: number | null;
  status?: "draft" | "active" | "archived";
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function updateCourse(params: UpdateLearningCourseParams): Promise<LearningCourse> {
  const before = await findOwnCourse(params.organizationId, params.courseId);
  if (!before) throw new LearningCourseNotFoundError();

  // Archived courses require reactivation first — except the one PATCH that reactivates them.
  const reactivating = params.status !== undefined && params.status !== "archived";
  if (before.status === "archived" && !reactivating) {
    throw new LearningCourseArchivedError();
  }

  const nextIssuesCertificate = params.issuesCertificate ?? before.issuesCertificate;
  const nextCertificateValidityMonths = params.certificateValidityMonths !== undefined ? params.certificateValidityMonths : before.certificateValidityMonths;
  if (params.issuesCertificate !== undefined || params.certificateValidityMonths !== undefined) {
    validateCertificateConfig(nextIssuesCertificate, nextCertificateValidityMonths);
  }

  const patch: Record<string, unknown> = {};
  if (params.categoryCode !== undefined) patch.categoryCode = params.categoryCode;
  if (params.title !== undefined) patch.title = params.title;
  if (params.description !== undefined) patch.description = params.description;
  if (params.deliveryMode !== undefined) patch.deliveryMode = params.deliveryMode;
  if (params.mandatoryDefault !== undefined) patch.mandatoryDefault = params.mandatoryDefault;
  if (params.requiresApproval !== undefined) patch.requiresApproval = params.requiresApproval;
  if (params.hasAssessment !== undefined) patch.hasAssessment = params.hasAssessment;
  if (params.issuesCertificate !== undefined) patch.issuesCertificate = params.issuesCertificate;
  if (params.certificateValidityMonths !== undefined) patch.certificateValidityMonths = params.certificateValidityMonths;
  if (params.status !== undefined) patch.status = params.status;
  patch.updatedAt = new Date();

  const [updated] = await db.update(learningCoursesTable).set(patch).where(eq(learningCoursesTable.id, params.courseId)).returning();

  const nowArchived = params.status === "archived" && before.status !== "archived";
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: nowArchived ? "learning_course.archived" : "learning_course.updated",
    targetType: "learning_course",
    targetId: String(params.courseId),
    beforeState: { title: before.title, status: before.status, deliveryMode: before.deliveryMode },
    afterState: { title: updated.title, status: updated.status, deliveryMode: updated.deliveryMode },
  });

  return updated;
}
