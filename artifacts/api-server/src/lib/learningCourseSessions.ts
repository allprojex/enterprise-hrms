/**
 * Learning Course Sessions (Phase 3D, W86 — Course Catalog & Sessions):
 * CRUD + lifecycle over W85's schema
 * (docs/PHASE_3D_LEARNING_IMPLEMENTATION_PLAN.md §8.2, §10.2, §21).
 *
 * LIFECYCLE (§10.2): scheduled -> completed | cancelled, mirroring
 * interviews.status's own discipline exactly — "rescheduling cancels the
 * existing row and creates a brand new one... rather than mutating a
 * scheduled interview's date in place." Once a session leaves `scheduled`,
 * it is PERMANENTLY LOCKED: no further field edit and no further status
 * transition of any kind (no un-cancel, no un-complete, no
 * completed->cancelled). The atomic conditional
 * `UPDATE ... WHERE status = 'scheduled'` performs both an ordinary field
 * edit and/or a status transition in the same call — a concurrent or
 * repeat transition affects zero rows and returns a controlled 409, the
 * same discipline every Performance transition already established.
 *
 * SAME-ORGANIZATION VALIDATION: both `courseId` and (when supplied)
 * `instructorEmployeeId` are verified to belong to the caller's own
 * organization via the existing assertBelongsToOrganization helper — the
 * identical mechanism Performance's own templates use for `ratingScaleId`
 * — never trusting the raw FK constraint alone (a syntactically valid ID
 * from another organization must never be silently accepted).
 *
 * NO CAPACITY CONSUMPTION, NO SEAT RESERVATION, NO ENROLLMENT LOGIC OF ANY
 * KIND HERE — `capacity` is configured and stored only; enforcing it
 * against actual enrollments is W87's job entirely, per the frozen plan's
 * own explicit "session capacity is enforced atomically at enrollment
 * time" line (§8.2/§10.2), never here.
 *
 * NO EMPLOYEE ATTENDANCE, NO COMPLETION MARKING FOR AN ENROLLMENT HERE —
 * completing or cancelling a SESSION (this file) is a scheduling-record
 * event only; it must never write to learning_enrollments, issue a
 * certificate, or touch employee_certifications/employee_skills. Those
 * remain entirely W87+'s job.
 */
import { and, eq } from "drizzle-orm";
import { db, learningCourseSessionsTable, learningCoursesTable, employeesTable, type LearningCourseSession } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { assertBelongsToOrganization, CrossOrganizationReferenceError } from "./orgScopedRefs";

export { CrossOrganizationReferenceError };

export class LearningCourseSessionNotFoundError extends Error {
  constructor() {
    super("Session not found");
    this.name = "LearningCourseSessionNotFoundError";
  }
}

export class LearningCourseNotFoundForSessionError extends Error {
  constructor() {
    super("Course not found");
    this.name = "LearningCourseNotFoundForSessionError";
  }
}

export class InvalidLearningCourseSessionError extends Error {}

export class LearningCourseSessionLockedError extends Error {
  constructor() {
    super("This session is no longer scheduled and can no longer be edited or transitioned");
    this.name = "LearningCourseSessionLockedError";
  }
}

async function findOwnCourse(organizationId: number, courseId: number) {
  const [row] = await db
    .select()
    .from(learningCoursesTable)
    .where(and(eq(learningCoursesTable.id, courseId), eq(learningCoursesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function findOwnSession(organizationId: number, sessionId: number): Promise<LearningCourseSession | null> {
  const [row] = await db
    .select()
    .from(learningCourseSessionsTable)
    .where(and(eq(learningCourseSessionsTable.id, sessionId), eq(learningCourseSessionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function listSessionsForCourse(organizationId: number, courseId: number): Promise<LearningCourseSession[]> {
  return db
    .select()
    .from(learningCourseSessionsTable)
    .where(and(eq(learningCourseSessionsTable.organizationId, organizationId), eq(learningCourseSessionsTable.courseId, courseId)));
}

export async function getSession(organizationId: number, sessionId: number): Promise<LearningCourseSession | null> {
  return findOwnSession(organizationId, sessionId);
}

function validateSessionFields(durationMinutes: number, capacity: number | null | undefined): void {
  if (durationMinutes <= 0) {
    throw new InvalidLearningCourseSessionError("durationMinutes must be greater than 0");
  }
  if (capacity != null && capacity <= 0) {
    throw new InvalidLearningCourseSessionError("capacity must be a positive number of seats");
  }
}

export interface CreateLearningCourseSessionParams {
  organizationId: number;
  courseId: number;
  scheduledAt: Date;
  durationMinutes: number;
  location?: string;
  meetingLink?: string;
  instructorEmployeeId?: number;
  capacity?: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export async function createSession(params: CreateLearningCourseSessionParams): Promise<LearningCourseSession> {
  const course = await findOwnCourse(params.organizationId, params.courseId);
  if (!course) throw new LearningCourseNotFoundForSessionError();

  validateSessionFields(params.durationMinutes, params.capacity);
  if (params.instructorEmployeeId != null) {
    await assertBelongsToOrganization(employeesTable, params.instructorEmployeeId, params.organizationId, "Instructor");
  }

  const [session] = await db
    .insert(learningCourseSessionsTable)
    .values({
      organizationId: params.organizationId,
      courseId: params.courseId,
      scheduledAt: params.scheduledAt,
      durationMinutes: params.durationMinutes,
      location: params.location ?? null,
      meetingLink: params.meetingLink ?? null,
      instructorEmployeeId: params.instructorEmployeeId ?? null,
      capacity: params.capacity ?? null,
      status: "scheduled",
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "learning_course_session.created",
    targetType: "learning_course_session",
    targetId: String(session.id),
    afterState: { courseId: session.courseId, scheduledAt: session.scheduledAt, status: session.status },
  });

  return session;
}

export interface UpdateLearningCourseSessionParams {
  organizationId: number;
  sessionId: number;
  scheduledAt?: Date;
  durationMinutes?: number;
  location?: string;
  meetingLink?: string;
  instructorEmployeeId?: number | null;
  capacity?: number | null;
  status?: "completed" | "cancelled";
  actorApplicationUserId: number;
  actorMembershipId: number;
}

/**
 * A single atomic conditional UPDATE ... WHERE status = 'scheduled' — both
 * ordinary field edits and, optionally in the same call, the one-way
 * transition to 'completed'/'cancelled'. A session that has already left
 * 'scheduled' rejects every further call, field-edit or transition alike
 * (§10.2 — permanently locked, never reactivated, never re-edited).
 */
export async function updateSession(params: UpdateLearningCourseSessionParams): Promise<LearningCourseSession> {
  const before = await findOwnSession(params.organizationId, params.sessionId);
  if (!before) throw new LearningCourseSessionNotFoundError();
  if (before.status !== "scheduled") {
    throw new LearningCourseSessionLockedError();
  }

  const nextDuration = params.durationMinutes ?? before.durationMinutes;
  const nextCapacity = params.capacity !== undefined ? params.capacity : before.capacity;
  if (params.durationMinutes !== undefined || params.capacity !== undefined) {
    validateSessionFields(nextDuration, nextCapacity);
  }
  if (params.instructorEmployeeId) {
    await assertBelongsToOrganization(employeesTable, params.instructorEmployeeId, params.organizationId, "Instructor");
  }

  const patch: Record<string, unknown> = {};
  if (params.scheduledAt !== undefined) patch.scheduledAt = params.scheduledAt;
  if (params.durationMinutes !== undefined) patch.durationMinutes = params.durationMinutes;
  if (params.location !== undefined) patch.location = params.location;
  if (params.meetingLink !== undefined) patch.meetingLink = params.meetingLink;
  if (params.instructorEmployeeId !== undefined) patch.instructorEmployeeId = params.instructorEmployeeId;
  if (params.capacity !== undefined) patch.capacity = params.capacity;
  if (params.status !== undefined) patch.status = params.status;
  patch.updatedAt = new Date();

  const [updated] = await db
    .update(learningCourseSessionsTable)
    .set(patch)
    .where(and(eq(learningCourseSessionsTable.id, params.sessionId), eq(learningCourseSessionsTable.organizationId, params.organizationId), eq(learningCourseSessionsTable.status, "scheduled")))
    .returning();
  if (!updated) {
    // Lost a race against a concurrent transition between the read above and this write.
    throw new LearningCourseSessionLockedError();
  }

  if (params.status !== undefined) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: params.status === "completed" ? "learning_course_session.completed" : "learning_course_session.cancelled",
      targetType: "learning_course_session",
      targetId: String(params.sessionId),
      beforeState: { status: before.status },
      afterState: { status: updated.status },
    });
  } else {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "learning_course_session.updated",
      targetType: "learning_course_session",
      targetId: String(params.sessionId),
      beforeState: { scheduledAt: before.scheduledAt, capacity: before.capacity },
      afterState: { scheduledAt: updated.scheduledAt, capacity: updated.capacity },
    });
  }

  return updated;
}
