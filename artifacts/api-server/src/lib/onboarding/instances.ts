import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  onboardingInstancesTable,
  onboardingTasksTable,
  onboardingInductionDetailsTable,
  onboardingTemplateTasksTable,
  employeesTable,
  usersTable,
  documentRequirementsTable,
  type OnboardingInstance,
  type OnboardingTask,
  type OnboardingInductionDetail,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { createRequirement, DuplicateRequirementError, listRequirements } from "../documentRequirements";
import { isUniqueViolation } from "../dbErrors";
import { resolveApplicableVersion, listVersionTasks, getVersion } from "./templates";
import { checkReference, isReferenceKind, assertPayrollReferenceAllowed, type OnboardingTaskKind } from "./kinds";
import { resolveResponsibility, type ResponsibilityConfig } from "./responsibility";
import { assignDocumentToEmployee } from "./acknowledgements";

/**
 * WS-10 — onboarding instances and their tasks
 * (§26.4, §26.8-26.13, §26.28, §26.34, §26.35).
 */

export class OnboardingInstanceNotFoundError extends Error {
  constructor() {
    super("Onboarding not found.");
    this.name = "OnboardingInstanceNotFoundError";
  }
}
export class OnboardingTaskNotFoundError extends Error {
  constructor() {
    super("Onboarding task not found.");
    this.name = "OnboardingTaskNotFoundError";
  }
}
export class EmployeeNotFoundForOnboardingError extends Error {
  constructor() {
    super("Employee not found in this organization.");
    this.name = "EmployeeNotFoundForOnboardingError";
  }
}
export class NoApplicableTemplateError extends Error {
  constructor() {
    super("No active onboarding template applies to this employee.");
    this.name = "NoApplicableTemplateError";
  }
}
export class OnboardingAlreadyOpenError extends Error {
  constructor(
    message: string,
    readonly existingInstanceId: number,
  ) {
    super(message);
    this.name = "OnboardingAlreadyOpenError";
  }
}
export class OnboardingNotOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingNotOpenError";
  }
}
export class TaskNotOpenError extends Error {
  constructor() {
    super("This task is already resolved.");
    this.name = "TaskNotOpenError";
  }
}
export class ReferenceNotSatisfiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceNotSatisfiedError";
  }
}
export class RequiredTasksOutstandingError extends Error {
  constructor(
    message: string,
    readonly outstanding: number,
  ) {
    super(message);
    this.name = "RequiredTasksOutstandingError";
  }
}
export class WaiverReasonRequiredError extends Error {
  constructor() {
    super("A waiver needs a reason.");
    this.name = "WaiverReasonRequiredError";
  }
}
export class CancellationReasonRequiredError extends Error {
  constructor() {
    super("Cancelling onboarding needs a reason.");
    this.name = "CancellationReasonRequiredError";
  }
}

const OPEN_INSTANCE_STATUSES = ["not_started", "in_progress"] as const;

function taskResponsibility(task: OnboardingTask | { responsibleResolver: OnboardingTask["responsibleResolver"]; responsiblePermissionKey: string | null; responsibleMembershipId: number | null }): ResponsibilityConfig {
  return {
    resolver: task.responsibleResolver,
    permissionKey: task.responsiblePermissionKey,
    membershipId: task.responsibleMembershipId,
  };
}

/**
 * Resolves a due date from the constrained rule model (§26.13).
 *
 * There is no expression evaluation here at all: a basis names one of three
 * known dates and an offset is added in whole days. A `dependency_completion`
 * due date is deliberately left NULL until the predecessor actually completes —
 * inventing a date for work that cannot start yet would be a fiction.
 */
function resolveDueAt(
  basis: string | null,
  offsetDays: number | null,
  anchors: { onboardingStart: Date; commencementDate: Date | null },
): Date | null {
  if (!basis) return null;
  const offset = offsetDays ?? 0;
  let anchor: Date | null = null;
  if (basis === "onboarding_start") anchor = anchors.onboardingStart;
  else if (basis === "commencement_date") anchor = anchors.commencementDate;
  else return null; // dependency_completion — resolved later, on predecessor completion.

  if (!anchor) return null;
  const due = new Date(anchor.getTime());
  due.setUTCDate(due.getUTCDate() + offset);
  return due;
}

export async function getInstance(organizationId: number, instanceId: number): Promise<OnboardingInstance | null> {
  const [row] = await db
    .select()
    .from(onboardingInstancesTable)
    .where(and(eq(onboardingInstancesTable.id, instanceId), eq(onboardingInstancesTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function findOpenInstanceForEmployee(
  organizationId: number,
  employeeId: number,
): Promise<OnboardingInstance | null> {
  const [row] = await db
    .select()
    .from(onboardingInstancesTable)
    .where(
      and(
        eq(onboardingInstancesTable.organizationId, organizationId),
        eq(onboardingInstancesTable.employeeId, employeeId),
        inArray(onboardingInstancesTable.status, [...OPEN_INSTANCE_STATUSES]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listInstanceTasks(organizationId: number, instanceId: number): Promise<OnboardingTask[]> {
  return db
    .select()
    .from(onboardingTasksTable)
    .where(and(eq(onboardingTasksTable.instanceId, instanceId), eq(onboardingTasksTable.organizationId, organizationId)))
    .orderBy(onboardingTasksTable.displayOrder);
}

/**
 * Starts onboarding for an employee who already exists.
 *
 * WS-10 NEVER creates an employee (§26.35). This function takes an
 * `employeeId` that some other authoritative path — Recruitment conversion,
 * manual creation, legacy import, WS-7 migration — already produced.
 *
 * It is idempotent by construction: `onboarding_instances_open_per_employee_unique`
 * makes a second open instance impossible at the database, so two concurrent
 * conversion retries cannot both succeed (§26.34).
 */
export async function startOnboarding(params: {
  organizationId: number;
  employeeId: number;
  templateVersionId?: number | null;
  candidateId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
  /** When true, an already-open instance is returned rather than raising. */
  reuseExisting?: boolean;
}): Promise<{ instance: OnboardingInstance; reused: boolean }> {
  const [employee] = await db
    .select({
      id: employeesTable.id,
      branchId: employeesTable.branchId,
      departmentId: employeesTable.departmentId,
      positionId: employeesTable.positionId,
      employmentType: employeesTable.employmentType,
      hireDate: employeesTable.hireDate,
    })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, params.employeeId), eq(employeesTable.organizationId, params.organizationId)))
    .limit(1);
  if (!employee) throw new EmployeeNotFoundForOnboardingError();

  const existing = await findOpenInstanceForEmployee(params.organizationId, params.employeeId);
  if (existing) {
    if (params.reuseExisting) return { instance: existing, reused: true };
    throw new OnboardingAlreadyOpenError("This employee already has onboarding in progress.", existing.id);
  }

  const resolved = params.templateVersionId
    ? await (async () => {
        const version = await getVersion(params.organizationId, params.templateVersionId!);
        if (!version) throw new NoApplicableTemplateError();
        return { template: { id: version.templateId }, version };
      })()
    : await resolveApplicableVersion({
        organizationId: params.organizationId,
        branchId: employee.branchId,
        departmentId: employee.departmentId,
        positionId: employee.positionId,
        employmentType: employee.employmentType,
      });
  if (!resolved) throw new NoApplicableTemplateError();

  const definitions = await listVersionTasks(params.organizationId, resolved.version.id);
  const startDate = new Date();
  const anchors = { onboardingStart: startDate, commencementDate: employee.hireDate ?? null };

  let instance: OnboardingInstance;
  try {
    instance = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(onboardingInstancesTable)
        .values({
          organizationId: params.organizationId,
          employeeId: params.employeeId,
          templateId: resolved.template.id,
          // The snapshot anchor required by §26.7.
          templateVersionId: resolved.version.id,
          status: definitions.length > 0 ? "in_progress" : "not_started",
          startDate,
          commencementDate: employee.hireDate ?? null,
          candidateId: params.candidateId ?? null,
          createdBy: params.actorApplicationUserId,
        })
        .returning();

      // Definitions are COPIED, not referenced, so later template edits cannot
      // rewrite this onboarding (§26.7).
      const idMap = new Map<number, number>();
      for (const def of definitions) {
        const [task] = await tx
          .insert(onboardingTasksTable)
          .values({
            organizationId: params.organizationId,
            instanceId: created.id,
            templateTaskId: def.id,
            displayOrder: def.displayOrder,
            title: def.title,
            description: def.description,
            taskKind: def.taskKind,
            required: def.required,
            responsibleResolver: def.responsibleResolver,
            responsiblePermissionKey: def.responsiblePermissionKey,
            responsibleMembershipId: def.responsibleMembershipId,
            dueAt: resolveDueAt(def.dueBasis, def.dueOffsetDays, anchors),
          })
          .returning();
        idMap.set(def.id, task.id);

        if (def.taskKind === "induction") {
          await tx.insert(onboardingInductionDetailsTable).values({
            organizationId: params.organizationId,
            taskId: task.id,
          });
        }
      }
      return created;
    });
  } catch (err) {
    // A concurrent starter won the unique index. Return their instance rather
    // than failing the caller — this is what makes the conversion handoff
    // genuinely idempotent under retry (§26.34).
    if (isUniqueViolation(err)) {
      const winner = await findOpenInstanceForEmployee(params.organizationId, params.employeeId);
      if (winner) return { instance: winner, reused: true };
    }
    throw err;
  }

  // Document requirements and acknowledgement obligations are raised OUTSIDE
  // the transaction because WS-5 owns them and its services manage their own
  // connections. Each is individually idempotent, so a failure here leaves the
  // instance valid and the operation safely repeatable.
  await provisionExternalObligations({
    organizationId: params.organizationId,
    instanceId: instance.id,
    employeeId: params.employeeId,
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.instance_created",
    targetType: "onboarding_instance",
    targetId: String(instance.id),
    afterState: {
      employeeId: params.employeeId,
      templateVersionId: resolved.version.id,
      taskCount: definitions.length,
      candidateId: params.candidateId ?? null,
    },
  });

  return { instance, reused: false };
}

/**
 * Raises the WS-5 document requirements and acknowledgement obligations implied
 * by this instance's tasks.
 *
 * Both are idempotent: `document_requirements` is unique per
 * (org, ownerType, ownerId, categoryCode) and `document_acknowledgements` is
 * unique per (org, employee, documentVersion), so re-running this after a retry
 * links to what already exists rather than duplicating it (§26.34).
 */
async function provisionExternalObligations(params: {
  organizationId: number;
  instanceId: number;
  employeeId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<void> {
  const tasks = await listInstanceTasks(params.organizationId, params.instanceId);

  for (const task of tasks) {
    if (!task.templateTaskId) continue;
    const [def] = await db
      .select()
      .from(onboardingTemplateTasksTable)
      .where(eq(onboardingTemplateTasksTable.id, task.templateTaskId))
      .limit(1);
    if (!def) continue;

    if (task.taskKind === "document" && def.documentCategoryCode) {
      let requirementId: number | null = null;
      try {
        const created = await createRequirement({
          organizationId: params.organizationId,
          ownerType: "employee",
          ownerId: params.employeeId,
          categoryCode: def.documentCategoryCode,
          required: task.required,
          actorApplicationUserId: params.actorApplicationUserId,
          actorMembershipId: params.actorMembershipId,
        });
        requirementId = created.id;
      } catch (err) {
        if (!(err instanceof DuplicateRequirementError)) throw err;
        // Already required — carried forward from pre-onboarding, or from an
        // earlier run. Link to it rather than creating a second (§26.34).
        const existing = await listRequirements(params.organizationId, {
          ownerType: "employee",
          ownerId: params.employeeId,
        });
        requirementId = existing.find((r) => r.categoryCode === def.documentCategoryCode)?.id ?? null;
      }
      if (requirementId) {
        await db
          .update(onboardingTasksTable)
          .set({ documentRequirementId: requirementId })
          .where(eq(onboardingTasksTable.id, task.id));
      }
    }

    if (task.taskKind === "acknowledgement" && def.acknowledgementDocumentId) {
      await assignDocumentToEmployee({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        documentId: def.acknowledgementDocumentId,
        audience: "onboarding",
        onboardingInstanceId: params.instanceId,
        dueAt: task.dueAt,
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
      });
    }
  }
}

async function actorName(userId: number): Promise<string | null> {
  const [user] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
}

async function getTask(organizationId: number, taskId: number): Promise<OnboardingTask> {
  const [task] = await db
    .select()
    .from(onboardingTasksTable)
    .where(and(eq(onboardingTasksTable.id, taskId), eq(onboardingTasksTable.organizationId, organizationId)))
    .limit(1);
  if (!task) throw new OnboardingTaskNotFoundError();
  return task;
}

/**
 * After a task resolves, any dependent task whose due date was waiting on it
 * gets a concrete date. This is the only place `dependency_completion` produces
 * a timestamp, and it uses the predecessor's ACTUAL resolution time.
 */
async function resolveDependentDueDates(organizationId: number, instanceId: number, completedTemplateTaskId: number | null, at: Date): Promise<void> {
  if (!completedTemplateTaskId) return;
  const dependents = await db
    .select({ id: onboardingTemplateTasksTable.id, offset: onboardingTemplateTasksTable.dueOffsetDays })
    .from(onboardingTemplateTasksTable)
    .where(
      and(
        eq(onboardingTemplateTasksTable.dependsOnTemplateTaskId, completedTemplateTaskId),
        eq(onboardingTemplateTasksTable.dueBasis, "dependency_completion"),
        eq(onboardingTemplateTasksTable.organizationId, organizationId),
      ),
    );
  for (const dependent of dependents) {
    const due = new Date(at.getTime());
    due.setUTCDate(due.getUTCDate() + (dependent.offset ?? 0));
    await db
      .update(onboardingTasksTable)
      .set({ dueAt: due })
      .where(
        and(
          eq(onboardingTasksTable.instanceId, instanceId),
          eq(onboardingTasksTable.templateTaskId, dependent.id),
          eq(onboardingTasksTable.status, "pending"),
        ),
      );
  }
}

export async function completeTask(params: {
  organizationId: number;
  taskId: number;
  notes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OnboardingTask> {
  const task = await getTask(params.organizationId, params.taskId);
  if (task.status !== "pending") throw new TaskNotOpenError();

  const instance = await getInstance(params.organizationId, task.instanceId);
  if (!instance) throw new OnboardingInstanceNotFoundError();
  if (!OPEN_INSTANCE_STATUSES.includes(instance.status as (typeof OPEN_INSTANCE_STATUSES)[number])) {
    throw new OnboardingNotOpenError("This onboarding is no longer open.");
  }

  // Payroll authority is checked before anything is written (§26.24).
  if (task.taskKind === "payroll_reference") {
    await assertPayrollReferenceAllowed(params.organizationId, params.actorMembershipId);
  }

  // A reference task cannot be ticked into truth. If the referenced module does
  // not show the expected state, the task stays open — an authorized WAIVER is
  // the deliberate escape hatch (§26.10), which is audited and carries a reason.
  if (isReferenceKind(task.taskKind as OnboardingTaskKind)) {
    const check = await checkReference(task.taskKind as OnboardingTaskKind, params.organizationId, instance.employeeId);
    if (!check.satisfied) throw new ReferenceNotSatisfiedError(check.detail);
  }

  // A document task follows WS-5's own verification state — onboarding does not
  // hold a second opinion about whether a document is acceptable (§26.15).
  if (task.taskKind === "document" && task.documentRequirementId) {
    const [requirement] = await db
      .select({ status: documentRequirementsTable.status })
      .from(documentRequirementsTable)
      .where(
        and(
          eq(documentRequirementsTable.id, task.documentRequirementId),
          eq(documentRequirementsTable.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (requirement && requirement.status !== "verified") {
      throw new ReferenceNotSatisfiedError(
        "The required document has not been verified yet. Verify it in Documents & Records, or waive this task.",
      );
    }
  }

  const now = new Date();
  const name = await actorName(params.actorApplicationUserId);
  const [updated] = await db
    .update(onboardingTasksTable)
    .set({
      status: "completed",
      completedAt: now,
      completedBy: params.actorApplicationUserId,
      // Frozen as historical evidence — never re-resolved later (§26.12).
      completedByName: name,
      completionNotes: params.notes ?? null,
    })
    .where(and(eq(onboardingTasksTable.id, params.taskId), eq(onboardingTasksTable.status, "pending")))
    .returning();
  if (!updated) throw new TaskNotOpenError();

  await resolveDependentDueDates(params.organizationId, task.instanceId, task.templateTaskId, now);
  await refreshInstanceStatus(params.organizationId, task.instanceId, params.actorApplicationUserId, params.actorMembershipId);

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.task_completed",
    targetType: "onboarding_task",
    targetId: String(params.taskId),
    afterState: { instanceId: task.instanceId, taskKind: task.taskKind, required: task.required },
  });
  return updated;
}

export async function waiveTask(params: {
  organizationId: number;
  taskId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OnboardingTask> {
  if (!params.reason?.trim()) throw new WaiverReasonRequiredError();

  const task = await getTask(params.organizationId, params.taskId);
  if (task.status !== "pending") throw new TaskNotOpenError();

  const now = new Date();
  const name = await actorName(params.actorApplicationUserId);
  const [updated] = await db
    .update(onboardingTasksTable)
    .set({
      status: "waived",
      waivedAt: now,
      waivedBy: params.actorApplicationUserId,
      waivedByName: name,
      waiverReason: params.reason.trim(),
    })
    .where(and(eq(onboardingTasksTable.id, params.taskId), eq(onboardingTasksTable.status, "pending")))
    .returning();
  if (!updated) throw new TaskNotOpenError();

  await resolveDependentDueDates(params.organizationId, task.instanceId, task.templateTaskId, now);
  await refreshInstanceStatus(params.organizationId, task.instanceId, params.actorApplicationUserId, params.actorMembershipId);

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.task_waived",
    targetType: "onboarding_task",
    targetId: String(params.taskId),
    afterState: { instanceId: task.instanceId, required: task.required, reason: params.reason.trim() },
  });
  return updated;
}

/**
 * Recomputes and persists the instance status from its tasks.
 *
 * Completion is SERVER-DERIVED (§26.10, §26.12): there is no settable
 * "completed" flag anywhere in the API surface. An instance completes exactly
 * when every REQUIRED task is completed or validly waived — optional tasks
 * never block, and a percentage never decides anything.
 */
export async function refreshInstanceStatus(
  organizationId: number,
  instanceId: number,
  actorApplicationUserId: number,
  actorMembershipId: number | null,
): Promise<OnboardingInstance> {
  const instance = await getInstance(organizationId, instanceId);
  if (!instance) throw new OnboardingInstanceNotFoundError();
  if (instance.status === "completed" || instance.status === "cancelled") return instance;

  const tasks = await listInstanceTasks(organizationId, instanceId);
  const required = tasks.filter((t) => t.required && t.status !== "cancelled");
  const outstanding = required.filter((t) => t.status === "pending");
  const anyResolved = tasks.some((t) => t.status !== "pending");

  if (required.length > 0 && outstanding.length === 0) {
    const [completed] = await db
      .update(onboardingInstancesTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(onboardingInstancesTable.id, instanceId), inArray(onboardingInstancesTable.status, [...OPEN_INSTANCE_STATUSES])))
      .returning();
    if (completed) {
      await recordAuditEvent({
        actorApplicationUserId,
        actorMembershipId,
        organizationId,
        eventType: "onboarding.completed",
        targetType: "onboarding_instance",
        targetId: String(instanceId),
        afterState: {
          employeeId: instance.employeeId,
          requiredTasks: required.length,
          waived: required.filter((t) => t.status === "waived").length,
        },
      });
      return completed;
    }
  }

  if (instance.status === "not_started" && anyResolved) {
    const [started] = await db
      .update(onboardingInstancesTable)
      .set({ status: "in_progress" })
      .where(eq(onboardingInstancesTable.id, instanceId))
      .returning();
    return started;
  }
  return instance;
}

export async function cancelOnboarding(params: {
  organizationId: number;
  instanceId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingInstance> {
  if (!params.reason?.trim()) throw new CancellationReasonRequiredError();

  const instance = await getInstance(params.organizationId, params.instanceId);
  if (!instance) throw new OnboardingInstanceNotFoundError();
  if (!OPEN_INSTANCE_STATUSES.includes(instance.status as (typeof OPEN_INSTANCE_STATUSES)[number])) {
    throw new OnboardingNotOpenError("Only onboarding that is still open can be cancelled.");
  }

  const cancelled = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(onboardingInstancesTable)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        cancelledBy: params.actorApplicationUserId,
        cancellationReason: params.reason.trim(),
      })
      .where(eq(onboardingInstancesTable.id, params.instanceId))
      .returning();

    // Only PENDING tasks are cancelled. Completed and waived tasks keep their
    // status, actor and evidence untouched — cancellation preserves history and
    // never rewrites what actually happened (§26.28).
    await tx
      .update(onboardingTasksTable)
      .set({ status: "cancelled" })
      .where(and(eq(onboardingTasksTable.instanceId, params.instanceId), eq(onboardingTasksTable.status, "pending")));

    return row;
  });

  // Note what is NOT done here: employment is untouched. Cancelling onboarding
  // is not a separation, and separation remains its own domain (§26.28).
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.cancelled",
    targetType: "onboarding_instance",
    targetId: String(params.instanceId),
    beforeState: { status: instance.status },
    afterState: { employeeId: instance.employeeId, reason: params.reason.trim() },
  });
  return cancelled;
}

/**
 * The controlled correction path for onboarding that has already completed
 * (§26.28). Deliberately NOT a general "reopen": it appends one supplementary
 * task and returns the instance to `in_progress`, so the completed history
 * stays exactly as it was and the correction is visible as its own item.
 */
export async function addSupplementaryTask(params: {
  organizationId: number;
  instanceId: number;
  title: string;
  description?: string | null;
  required?: boolean;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingTask> {
  if (!params.reason?.trim()) throw new CancellationReasonRequiredError();
  const instance = await getInstance(params.organizationId, params.instanceId);
  if (!instance) throw new OnboardingInstanceNotFoundError();
  if (instance.status === "cancelled") {
    throw new OnboardingNotOpenError("Cancelled onboarding cannot be amended.");
  }

  const tasks = await listInstanceTasks(params.organizationId, params.instanceId);
  const created = await db.transaction(async (tx) => {
    const [task] = await tx
      .insert(onboardingTasksTable)
      .values({
        organizationId: params.organizationId,
        instanceId: params.instanceId,
        templateTaskId: null,
        displayOrder: tasks.length > 0 ? Math.max(...tasks.map((t) => t.displayOrder)) + 1 : 1,
        title: params.title.trim(),
        description: params.description ?? null,
        taskKind: "general",
        required: params.required ?? true,
        responsibleResolver: "permission_holder",
        responsiblePermissionKey: "onboarding.manage",
      })
      .returning();

    if (instance.status === "completed" && (params.required ?? true)) {
      await tx
        .update(onboardingInstancesTable)
        .set({ status: "in_progress", completedAt: null })
        .where(eq(onboardingInstancesTable.id, params.instanceId));
    }
    return task;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.supplementary_task_added",
    targetType: "onboarding_instance",
    targetId: String(params.instanceId),
    beforeState: { status: instance.status },
    afterState: { taskId: created.id, reason: params.reason.trim() },
  });
  return created;
}

export interface OnboardingProgress {
  total: number;
  required: number;
  completed: number;
  waived: number;
  pending: number;
  cancelled: number;
  overdue: number;
  /** Informational only — completion is decided by required-task state (§26.25). */
  completionPercentage: number;
  status: OnboardingInstance["status"];
}

/**
 * `overdue` is computed here and never stored (§26.8): a task is overdue when it
 * has a due date in the past and is still pending. A persisted flag would be
 * wrong the moment the clock moved.
 */
export function summarizeProgress(instance: OnboardingInstance, tasks: OnboardingTask[], now: Date = new Date()): OnboardingProgress {
  const active = tasks.filter((t) => t.status !== "cancelled");
  const completed = active.filter((t) => t.status === "completed").length;
  const waived = active.filter((t) => t.status === "waived").length;
  const pending = active.filter((t) => t.status === "pending").length;
  const overdue = active.filter((t) => t.status === "pending" && t.dueAt != null && t.dueAt.getTime() < now.getTime()).length;
  const resolved = completed + waived;
  return {
    total: tasks.length,
    required: active.filter((t) => t.required).length,
    completed,
    waived,
    pending,
    cancelled: tasks.length - active.length,
    overdue,
    completionPercentage: active.length === 0 ? 0 : Math.round((resolved / active.length) * 100),
    status: instance.status,
  };
}

export async function getInductionDetail(organizationId: number, taskId: number): Promise<OnboardingInductionDetail | null> {
  const [row] = await db
    .select()
    .from(onboardingInductionDetailsTable)
    .where(
      and(
        eq(onboardingInductionDetailsTable.taskId, taskId),
        eq(onboardingInductionDetailsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Schedules or reschedules an induction session (§26.22).
 *
 * Rescheduling increments a counter and records the reason rather than
 * overwriting silently, so a repeatedly-moved induction is visible as exactly
 * that. This is session logistics, not a course: there is no curriculum,
 * enrollment or completion certificate here — Learning remains separate.
 */
export async function scheduleInduction(params: {
  organizationId: number;
  taskId: number;
  facilitatorMembershipId?: number | null;
  scheduledAt?: Date | null;
  deliveryMode?: OnboardingInductionDetail["deliveryMode"];
  location?: string | null;
  meetingDetails?: string | null;
  rescheduleReason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingInductionDetail> {
  const task = await getTask(params.organizationId, params.taskId);
  if (task.taskKind !== "induction") throw new OnboardingTaskNotFoundError();

  const existing = await getInductionDetail(params.organizationId, params.taskId);
  if (!existing) throw new OnboardingTaskNotFoundError();

  const isReschedule = existing.scheduledAt != null && params.scheduledAt != null && existing.scheduledAt.getTime() !== params.scheduledAt.getTime();

  const [updated] = await db
    .update(onboardingInductionDetailsTable)
    .set({
      facilitatorMembershipId:
        params.facilitatorMembershipId === undefined ? existing.facilitatorMembershipId : params.facilitatorMembershipId,
      scheduledAt: params.scheduledAt === undefined ? existing.scheduledAt : params.scheduledAt,
      deliveryMode: params.deliveryMode === undefined ? existing.deliveryMode : params.deliveryMode,
      location: params.location === undefined ? existing.location : params.location,
      meetingDetails: params.meetingDetails === undefined ? existing.meetingDetails : params.meetingDetails,
      rescheduleCount: isReschedule ? existing.rescheduleCount + 1 : existing.rescheduleCount,
      lastRescheduledAt: isReschedule ? new Date() : existing.lastRescheduledAt,
      lastRescheduleReason: isReschedule ? (params.rescheduleReason ?? null) : existing.lastRescheduleReason,
    })
    .where(eq(onboardingInductionDetailsTable.id, existing.id))
    .returning();

  if (isReschedule) {
    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "onboarding.induction_rescheduled",
      targetType: "onboarding_task",
      targetId: String(params.taskId),
      beforeState: { scheduledAt: existing.scheduledAt },
      afterState: { scheduledAt: updated.scheduledAt, rescheduleCount: updated.rescheduleCount },
    });
  }
  return updated;
}

export async function recordInductionAttendance(params: {
  organizationId: number;
  taskId: number;
  attendedAt: Date;
  attendanceNotes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<OnboardingInductionDetail> {
  const existing = await getInductionDetail(params.organizationId, params.taskId);
  if (!existing) throw new OnboardingTaskNotFoundError();

  const [updated] = await db
    .update(onboardingInductionDetailsTable)
    .set({ attendedAt: params.attendedAt, attendanceNotes: params.attendanceNotes ?? null })
    .where(eq(onboardingInductionDetailsTable.id, existing.id))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "onboarding.induction_attendance_recorded",
    targetType: "onboarding_task",
    targetId: String(params.taskId),
    afterState: { attendedAt: params.attendedAt },
  });
  return updated;
}

export { taskResponsibility, resolveResponsibility };
