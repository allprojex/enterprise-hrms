import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  onboardingInstancesTable,
  onboardingTasksTable,
  onboardingTemplatesTable,
  onboardingTemplateVersionsTable,
  employeesTable,
  type OnboardingInstance,
  type OnboardingTask,
} from "@workspace/db";
import {
  CreateOnboardingTemplateBody,
  UpdateOnboardingTemplateBody,
  CreateOnboardingTemplateVersionBody,
  AddOnboardingTemplateTaskBody,
  StartOnboardingBody,
  CancelOnboardingBody,
  AddSupplementaryOnboardingTaskBody,
  CompleteOnboardingTaskBody,
  WaiveOnboardingTaskBody,
  ScheduleOnboardingInductionBody,
  RecordInductionAttendanceBody,
  AssignDocumentAcknowledgementBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { requireModuleEnabled } from "../middlewares/requireModuleEnabled";
import { resolveOwnEmployeeId } from "../lib/leaveRequests";
import { ONBOARDING_MODULE_KEY } from "../lib/onboarding/moduleKey";
import {
  listTemplates,
  createTemplate,
  updateTemplate,
  listVersions,
  createVersion,
  listVersionTasks,
  addVersionTask,
  deleteVersionTask,
  activateVersion,
  archiveVersion,
  OnboardingTemplateNotFoundError,
  OnboardingTemplateVersionNotFoundError,
  TemplateVersionNotEditableError,
  TemplateVersionNotActivatableError,
  InvalidTaskDefinitionError,
} from "../lib/onboarding/templates";
import {
  startOnboarding,
  getInstance,
  listInstanceTasks,
  completeTask,
  waiveTask,
  cancelOnboarding,
  addSupplementaryTask,
  summarizeProgress,
  getInductionDetail,
  scheduleInduction,
  recordInductionAttendance,
  resolveResponsibility,
  OnboardingInstanceNotFoundError,
  OnboardingTaskNotFoundError,
  EmployeeNotFoundForOnboardingError,
  NoApplicableTemplateError,
  OnboardingAlreadyOpenError,
  OnboardingNotOpenError,
  TaskNotOpenError,
  ReferenceNotSatisfiedError,
  WaiverReasonRequiredError,
  CancellationReasonRequiredError,
} from "../lib/onboarding/instances";
import {
  assignDocumentToAudience,
  raiseReacknowledgements,
  listForEmployee,
  listOutstandingForOrganization,
  acknowledge,
  AcknowledgementNotFoundError,
  DocumentNotAcknowledgeableError,
  NotYourAcknowledgementError,
} from "../lib/onboarding/acknowledgements";
import { checkReference, isReferenceKind, PayrollReferenceNotPermittedError, type OnboardingTaskKind } from "../lib/onboarding/kinds";
import { cancelRemindersForInstance } from "../lib/onboarding/reminders";
import { UnknownDocumentCategoryError } from "../lib/documentCategories";

const router = Router();

/**
 * WS-10 — onboarding, induction and handbook acknowledgement (§26.33).
 *
 * Explicit domain endpoints only. There is no generic "run a workflow step"
 * route here, and nothing accepts an expression, a rule or a query — OD #14
 * forbids a second general workflow engine, and §26.11/§26.13 forbid the DSL
 * that would make one possible.
 *
 * Three audiences are kept strictly apart:
 *   - HR/configuration routes require an onboarding permission;
 *   - `/my-onboarding` resolves the employee from the caller's own identity and
 *     never trusts an id from the request;
 *   - `/onboarding-responsibilities` returns only what the resolvers currently
 *     point at the caller, so a manager gains no organization-wide visibility.
 */

function mapDomainError(err: unknown, res: import("express").Response): boolean {
  if (
    err instanceof InvalidTaskDefinitionError ||
    err instanceof TemplateVersionNotEditableError ||
    err instanceof TemplateVersionNotActivatableError ||
    err instanceof UnknownDocumentCategoryError ||
    err instanceof DocumentNotAcknowledgeableError ||
    err instanceof NoApplicableTemplateError ||
    err instanceof EmployeeNotFoundForOnboardingError ||
    err instanceof OnboardingNotOpenError ||
    err instanceof TaskNotOpenError ||
    err instanceof WaiverReasonRequiredError ||
    err instanceof CancellationReasonRequiredError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof PayrollReferenceNotPermittedError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (err instanceof NotYourAcknowledgementError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (
    err instanceof OnboardingTemplateNotFoundError ||
    err instanceof OnboardingTemplateVersionNotFoundError ||
    err instanceof OnboardingInstanceNotFoundError ||
    err instanceof OnboardingTaskNotFoundError ||
    err instanceof AcknowledgementNotFoundError
  ) {
    res.status(404).json({ error: err.message });
    return true;
  }
  // A conflict, not a failure: the state exists and the caller must resolve it.
  if (err instanceof OnboardingAlreadyOpenError || err instanceof ReferenceNotSatisfiedError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  return false;
}

/** Serializes a task, deriving `overdue` rather than reading a stored flag. */
async function serializeTask(organizationId: number, employeeId: number, task: OnboardingTask, now: Date) {
  const responsibility = await resolveResponsibility(organizationId, employeeId, {
    resolver: task.responsibleResolver,
    permissionKey: task.responsiblePermissionKey,
    membershipId: task.responsibleMembershipId,
  });
  return {
    ...task,
    overdue: task.status === "pending" && task.dueAt != null && task.dueAt.getTime() < now.getTime(),
    responsibleBasis: responsibility.basis,
    responsibleMembershipIds: responsibility.membershipIds,
  };
}

async function buildDetail(organizationId: number, instance: OnboardingInstance) {
  const now = new Date();
  const tasks = await listInstanceTasks(organizationId, instance.id);

  const [employee] = await db
    .select({
      firstName: employeesTable.firstName,
      lastName: employeesTable.lastName,
      employeeNumber: employeesTable.employeeNumber,
    })
    .from(employeesTable)
    .where(eq(employeesTable.id, instance.employeeId))
    .limit(1);

  const [template] = await db
    .select({ name: onboardingTemplatesTable.name })
    .from(onboardingTemplatesTable)
    .where(eq(onboardingTemplatesTable.id, instance.templateId))
    .limit(1);

  const [version] = await db
    .select({ versionNumber: onboardingTemplateVersionsTable.versionNumber })
    .from(onboardingTemplateVersionsTable)
    .where(eq(onboardingTemplateVersionsTable.id, instance.templateVersionId))
    .limit(1);

  const detailed = [];
  for (const task of tasks) {
    const base = await serializeTask(organizationId, instance.employeeId, task, now);
    const induction = task.taskKind === "induction" ? await getInductionDetail(organizationId, task.id) : null;
    // Reference state is read live so the UI shows the truth in the other
    // module rather than a cached guess.
    const reference = isReferenceKind(task.taskKind as OnboardingTaskKind)
      ? await checkReference(task.taskKind as OnboardingTaskKind, organizationId, instance.employeeId)
      : null;
    detailed.push({
      ...base,
      induction,
      referenceSatisfied: reference?.satisfied ?? null,
      referenceDetail: reference?.detail ?? null,
    });
  }

  return {
    instance,
    employeeName: employee ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") : null,
    employeeNumber: employee?.employeeNumber ?? null,
    templateName: template?.name ?? null,
    templateVersionNumber: version?.versionNumber ?? null,
    progress: summarizeProgress(instance, tasks, now),
    tasks: detailed,
    acknowledgements: await listForEmployee(organizationId, instance.employeeId),
  };
}

// ---------------------------------------------------------------------------
// Configuration — onboarding.configure
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/onboarding-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ templates: await listTemplates(req.membership!.organizationId) });
  },
);

router.post(
  "/organizations/:organizationId/onboarding-templates",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOnboardingTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const created = await createTemplate({
        organizationId: req.membership!.organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        applicability: {
          branchId: parsed.data.branchId ?? null,
          departmentId: parsed.data.departmentId ?? null,
          positionId: parsed.data.positionId ?? null,
          employmentType: (parsed.data.employmentType ?? null) as never,
        },
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
  "/organizations/:organizationId/onboarding-templates/:templateId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = UpdateOnboardingTemplateBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const updated = await updateTemplate({
        organizationId: req.membership!.organizationId,
        templateId: Number(req.params["templateId"]),
        name: parsed.data.name,
        description: parsed.data.description,
        applicability: {
          branchId: parsed.data.branchId ?? null,
          departmentId: parsed.data.departmentId ?? null,
          positionId: parsed.data.positionId ?? null,
          employmentType: (parsed.data.employmentType ?? null) as never,
        },
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(updated);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.get(
  "/organizations/:organizationId/onboarding-templates/:templateId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({
      versions: await listVersions(req.membership!.organizationId, Number(req.params["templateId"])),
    });
  },
);

router.post(
  "/organizations/:organizationId/onboarding-templates/:templateId/versions",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CreateOnboardingTemplateVersionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const version = await createVersion({
        organizationId: req.membership!.organizationId,
        templateId: Number(req.params["templateId"]),
        copyFromVersionId: parsed.data.copyFromVersionId ?? null,
        changeNote: parsed.data.changeNote ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(version);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.get(
  "/organizations/:organizationId/onboarding-template-versions/:versionId/tasks",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({
      tasks: await listVersionTasks(req.membership!.organizationId, Number(req.params["versionId"])),
    });
  },
);

router.post(
  "/organizations/:organizationId/onboarding-template-versions/:versionId/tasks",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AddOnboardingTemplateTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const task = await addVersionTask({
        organizationId: req.membership!.organizationId,
        versionId: Number(req.params["versionId"]),
        definition: parsed.data as never,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(task);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.delete(
  "/organizations/:organizationId/onboarding-template-versions/:versionId/tasks/:taskId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      await deleteVersionTask({
        organizationId: req.membership!.organizationId,
        versionId: Number(req.params["versionId"]),
        taskId: Number(req.params["taskId"]),
      });
      res.status(204).send();
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/onboarding-template-versions/:versionId/activate",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const version = await activateVersion({
        organizationId: req.membership!.organizationId,
        versionId: Number(req.params["versionId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(version);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/onboarding-template-versions/:versionId/archive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.configure"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const version = await archiveVersion({
        organizationId: req.membership!.organizationId,
        versionId: Number(req.params["versionId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(version);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Operations — onboarding.read / onboarding.manage
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/onboarding",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const status = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
    const overdueOnly = req.query["overdueOnly"] === "true";

    const conditions = [eq(onboardingInstancesTable.organizationId, organizationId)];
    if (status) conditions.push(eq(onboardingInstancesTable.status, status as never));

    const instances = await db
      .select()
      .from(onboardingInstancesTable)
      .where(and(...conditions));

    const now = new Date();
    const items = [];
    for (const instance of instances) {
      const tasks = await listInstanceTasks(organizationId, instance.id);
      const progress = summarizeProgress(instance, tasks, now);
      if (overdueOnly && progress.overdue === 0) continue;

      const [employee] = await db
        .select({
          firstName: employeesTable.firstName,
          lastName: employeesTable.lastName,
          employeeNumber: employeesTable.employeeNumber,
        })
        .from(employeesTable)
        .where(eq(employeesTable.id, instance.employeeId))
        .limit(1);
      const [template] = await db
        .select({ name: onboardingTemplatesTable.name })
        .from(onboardingTemplatesTable)
        .where(eq(onboardingTemplatesTable.id, instance.templateId))
        .limit(1);

      items.push({
        instance,
        employeeName: employee ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") : null,
        employeeNumber: employee?.employeeNumber ?? null,
        templateName: template?.name ?? null,
        progress,
      });
    }
    res.json({ items });
  },
);

router.post(
  "/organizations/:organizationId/onboarding",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = StartOnboardingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      // No candidate record is required — this is the path for legacy,
      // migrated and manually created employees (§26.35).
      const { instance } = await startOnboarding({
        organizationId: req.membership!.organizationId,
        employeeId: parsed.data.employeeId,
        templateVersionId: parsed.data.templateVersionId ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(instance);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.get(
  "/organizations/:organizationId/onboarding/:instanceId",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const instance = await getInstance(req.membership!.organizationId, Number(req.params["instanceId"]));
    if (!instance) {
      res.status(404).json({ error: "Onboarding not found." });
      return;
    }
    res.json(await buildDetail(req.membership!.organizationId, instance));
  },
);

router.post(
  "/organizations/:organizationId/onboarding/:instanceId/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CancelOnboardingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const instanceId = Number(req.params["instanceId"]);
      const instance = await cancelOnboarding({
        organizationId: req.membership!.organizationId,
        instanceId,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      // Stop future reminders (§26.28). The handlers are stale-safe anyway.
      await cancelRemindersForInstance({
        organizationId: req.membership!.organizationId,
        instanceId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(instance);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/onboarding/:instanceId/supplementary-tasks",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AddSupplementaryOnboardingTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const task = await addSupplementaryTask({
        organizationId: req.membership!.organizationId,
        instanceId: Number(req.params["instanceId"]),
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        required: parsed.data.required,
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(task);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/onboarding-tasks/:taskId/complete",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.task.complete"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = CompleteOnboardingTaskBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const task = await completeTask({
        organizationId: req.membership!.organizationId,
        taskId: Number(req.params["taskId"]),
        notes: parsed.data.notes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(task);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/onboarding-tasks/:taskId/waive",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = WaiveOnboardingTaskBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const task = await waiveTask({
        organizationId: req.membership!.organizationId,
        taskId: Number(req.params["taskId"]),
        reason: parsed.data.reason,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(task);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.patch(
  "/organizations/:organizationId/onboarding-tasks/:taskId/induction",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = ScheduleOnboardingInductionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const detail = await scheduleInduction({
        organizationId: req.membership!.organizationId,
        taskId: Number(req.params["taskId"]),
        facilitatorMembershipId: parsed.data.facilitatorMembershipId,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : parsed.data.scheduledAt,
        deliveryMode: parsed.data.deliveryMode as never,
        location: parsed.data.location,
        meetingDetails: parsed.data.meetingDetails,
        rescheduleReason: parsed.data.rescheduleReason ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(detail);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

router.post(
  "/organizations/:organizationId/onboarding-tasks/:taskId/induction/attendance",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = RecordInductionAttendanceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const detail = await recordInductionAttendance({
        organizationId: req.membership!.organizationId,
        taskId: Number(req.params["taskId"]),
        attendedAt: new Date(parsed.data.attendedAt),
        attendanceNotes: parsed.data.attendanceNotes ?? null,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(detail);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Handbook and policy acknowledgement
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/document-acknowledgements",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ acknowledgements: await listOutstandingForOrganization(req.membership!.organizationId) });
  },
);

router.post(
  "/organizations/:organizationId/document-acknowledgements",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const parsed = AssignDocumentAcknowledgementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const result = await assignDocumentToAudience({
        organizationId: req.membership!.organizationId,
        documentId: parsed.data.documentId,
        selector: {
          audience: parsed.data.audience as never,
          branchId: parsed.data.branchId ?? null,
          departmentId: parsed.data.departmentId ?? null,
          positionId: parsed.data.positionId ?? null,
          employmentType: (parsed.data.employmentType ?? null) as never,
          employeeIds: parsed.data.employeeIds ?? undefined,
        },
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
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
  "/organizations/:organizationId/documents/:documentId/reacknowledge",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  requirePermission("onboarding.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const result = await raiseReacknowledgements({
        organizationId: req.membership!.organizationId,
        documentId: Number(req.params["documentId"]),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(result);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Employee self-service — self-scope, NOT onboarding.read
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/my-onboarding",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    // The employee is derived from the caller's own identity. A supplied
    // employeeId is not validated — it is never read at all (§26.26).
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.json({ onboarding: null, acknowledgements: [] });
      return;
    }

    const [instance] = await db
      .select()
      .from(onboardingInstancesTable)
      .where(
        and(eq(onboardingInstancesTable.organizationId, organizationId), eq(onboardingInstancesTable.employeeId, employeeId)),
      )
      .orderBy(onboardingInstancesTable.id)
      .limit(1);

    res.json({
      onboarding: instance ? await buildDetail(organizationId, instance) : null,
      acknowledgements: await listForEmployee(organizationId, employeeId),
    });
  },
);

router.post(
  "/organizations/:organizationId/my-acknowledgements/:acknowledgementId/acknowledge",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const employeeId = await resolveOwnEmployeeId(organizationId, req.userId!);
    if (!employeeId) {
      res.status(403).json({ error: "Your user account is not linked to an employee record." });
      return;
    }
    try {
      const result = await acknowledge({
        organizationId,
        acknowledgementId: Number(req.params["acknowledgementId"]),
        employeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(result);
    } catch (err) {
      if (!mapDomainError(err, res)) throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Manager / Department Head — only what the resolvers point at the caller
// ---------------------------------------------------------------------------

router.get(
  "/organizations/:organizationId/onboarding-responsibilities",
  requireAuth as any,
  requireMembership("organizationId"),
  requireModuleEnabled(ONBOARDING_MODULE_KEY),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const membershipId = req.membership!.id;
    const now = new Date();

    const openInstances = await db
      .select()
      .from(onboardingInstancesTable)
      .where(
        and(
          eq(onboardingInstancesTable.organizationId, organizationId),
          inArray(onboardingInstancesTable.status, ["not_started", "in_progress"]),
        ),
      );

    const items = [];
    for (const instance of openInstances) {
      const tasks = await db
        .select()
        .from(onboardingTasksTable)
        .where(and(eq(onboardingTasksTable.instanceId, instance.id), eq(onboardingTasksTable.status, "pending")));

      for (const task of tasks) {
        const serialized = await serializeTask(organizationId, instance.employeeId, task, now);
        // The gate: only tasks the resolvers currently point at this caller.
        if (!serialized.responsibleMembershipIds.includes(membershipId)) continue;

        const [employee] = await db
          .select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName })
          .from(employeesTable)
          .where(eq(employeesTable.id, instance.employeeId))
          .limit(1);

        items.push({
          task: serialized,
          instanceId: instance.id,
          employeeId: instance.employeeId,
          employeeName: employee ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") : null,
        });
      }
    }
    res.json({ items });
  },
);

export default router;
