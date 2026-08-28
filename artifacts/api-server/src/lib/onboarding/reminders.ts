import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db, onboardingTasksTable, onboardingInstancesTable, documentAcknowledgementsTable } from "@workspace/db";
import { registerJobHandler, zodPayloadParser, PermanentJobError } from "../jobHandlerRegistry";
import { scheduleJob, listScheduledJobs, cancelJob } from "../scheduledJobs";
import { notifyUser } from "../notifications";
import { resolveResponsibility } from "./responsibility";

/**
 * WS-10 — onboarding reminders through WS-6 (§26.14).
 *
 * Three allow-listed job types, no more. WS-10 does not build a scheduler, and
 * it does not deliver by email or SMS — no such capability exists in this
 * platform, and inventing one is out of scope. These handlers create in-app
 * notifications only.
 *
 * Every handler RE-FETCHES authoritative state and no-ops when the reason for
 * the reminder has gone. A stale reminder must never nag someone about a task
 * that is already done, and must never resurrect a cancelled onboarding — so
 * "the state that justified this reminder no longer holds" is a
 * PermanentJobError (never retried), not a failure.
 */

export const ONBOARDING_TASK_REMINDER = "onboarding.task_reminder";
export const ONBOARDING_OVERDUE_REMINDER = "onboarding.overdue_reminder";
export const ONBOARDING_ACKNOWLEDGEMENT_REMINDER = "onboarding.acknowledgement_reminder";

/** Narrow identifiers only — never a domain snapshot (§26.14). */
const taskReminderPayload = z.object({ taskId: z.number().int().positive() });
const acknowledgementReminderPayload = z.object({ acknowledgementId: z.number().int().positive() });

const OPEN_STATUSES = ["not_started", "in_progress"] as const;

async function loadLiveTask(organizationId: number, taskId: number) {
  const [row] = await db
    .select({ task: onboardingTasksTable, instance: onboardingInstancesTable })
    .from(onboardingTasksTable)
    .innerJoin(onboardingInstancesTable, eq(onboardingInstancesTable.id, onboardingTasksTable.instanceId))
    .where(and(eq(onboardingTasksTable.id, taskId), eq(onboardingTasksTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function notifyResponsible(
  organizationId: number,
  row: NonNullable<Awaited<ReturnType<typeof loadLiveTask>>>,
  title: string,
  message: string,
  type: "info" | "warning",
  jobId: number,
): Promise<void> {
  // Responsibility is re-resolved AT SEND TIME, so a reminder follows the
  // person who currently holds the relationship rather than whoever held it
  // when the job was scheduled (§26.12).
  const responsibility = await resolveResponsibility(organizationId, row.instance.employeeId, {
    resolver: row.task.responsibleResolver,
    permissionKey: row.task.responsiblePermissionKey,
    membershipId: row.task.responsibleMembershipId,
  });
  // Nobody currently responsible is a safe no-op, not an error — the same
  // stance WS-6's own recipient resolution takes for an empty relationship.
  for (const membershipId of responsibility.membershipIds) {
    await notifyUser({
      recipient: { kind: "membership", membershipId },
      organizationId,
      title,
      message,
      type,
      sourceReferenceType: "onboarding_task",
      sourceReferenceId: row.task.id,
      sourceJobId: jobId,
      actionPath: `/onboarding/${row.instance.id}`,
    });
  }
}

let registered = false;

export function registerOnboardingJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerJobHandler<z.infer<typeof taskReminderPayload>>(ONBOARDING_TASK_REMINDER, {
    parsePayload: zodPayloadParser(taskReminderPayload),
    execute: async (ctx) => {
      if (ctx.organizationId == null) throw new PermanentJobError("Onboarding reminders are organization-scoped.");
      const row = await loadLiveTask(ctx.organizationId, ctx.payload.taskId);
      if (!row) throw new PermanentJobError("The task no longer exists.");
      if (row.task.status !== "pending") throw new PermanentJobError("The task is already resolved.");
      if (!OPEN_STATUSES.includes(row.instance.status as (typeof OPEN_STATUSES)[number])) {
        throw new PermanentJobError("The onboarding is no longer open.");
      }
      await notifyResponsible(
        ctx.organizationId,
        row,
        "Onboarding task due soon",
        `"${row.task.title}" is coming up.`,
        "info",
        ctx.jobId,
      );
    },
  });

  registerJobHandler<z.infer<typeof taskReminderPayload>>(ONBOARDING_OVERDUE_REMINDER, {
    parsePayload: zodPayloadParser(taskReminderPayload),
    execute: async (ctx) => {
      if (ctx.organizationId == null) throw new PermanentJobError("Onboarding reminders are organization-scoped.");
      const row = await loadLiveTask(ctx.organizationId, ctx.payload.taskId);
      if (!row) throw new PermanentJobError("The task no longer exists.");
      if (row.task.status !== "pending") throw new PermanentJobError("The task is already resolved.");
      if (!OPEN_STATUSES.includes(row.instance.status as (typeof OPEN_STATUSES)[number])) {
        throw new PermanentJobError("The onboarding is no longer open.");
      }
      // Overdue is derived here too, from the live due date — the job never
      // trusts a flag, and a due date moved into the future cancels the point
      // of the reminder.
      if (!row.task.dueAt || row.task.dueAt.getTime() > Date.now()) {
        throw new PermanentJobError("The task is not overdue.");
      }
      await notifyResponsible(
        ctx.organizationId,
        row,
        "Onboarding task overdue",
        `"${row.task.title}" is past its due date.`,
        "warning",
        ctx.jobId,
      );
    },
  });

  registerJobHandler<z.infer<typeof acknowledgementReminderPayload>>(ONBOARDING_ACKNOWLEDGEMENT_REMINDER, {
    parsePayload: zodPayloadParser(acknowledgementReminderPayload),
    execute: async (ctx) => {
      if (ctx.organizationId == null) throw new PermanentJobError("Onboarding reminders are organization-scoped.");
      const [row] = await db
        .select()
        .from(documentAcknowledgementsTable)
        .where(
          and(
            eq(documentAcknowledgementsTable.id, ctx.payload.acknowledgementId),
            eq(documentAcknowledgementsTable.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The acknowledgement no longer exists.");
      if (row.status === "acknowledged") throw new PermanentJobError("Already acknowledged.");

      await notifyUser({
        recipient: { kind: "employee", employeeId: row.employeeId },
        organizationId: ctx.organizationId,
        title: "Document awaiting your acknowledgement",
        message: "A document assigned to you is still waiting for your confirmation of receipt.",
        type: "info",
        sourceReferenceType: "document_acknowledgement",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: "/my-onboarding",
      });
    },
  });
}

/**
 * Schedules the due and overdue reminders for a task.
 *
 * Idempotency keys embed the task id AND the due date, so moving a due date
 * schedules a genuinely new occurrence rather than colliding with the old key,
 * while a retry of the same operation dedupes (WS-6's documented convention).
 */
export async function scheduleTaskReminders(params: {
  organizationId: number;
  taskId: number;
  dueAt: Date;
  createdBy?: number | null;
}): Promise<void> {
  const stamp = params.dueAt.toISOString().slice(0, 10);

  const dueSoon = new Date(params.dueAt.getTime() - 24 * 60 * 60 * 1000);
  if (dueSoon.getTime() > Date.now()) {
    await scheduleJob({
      organizationId: params.organizationId,
      jobType: ONBOARDING_TASK_REMINDER,
      idempotencyKey: `onboarding:task:${params.taskId}:due:${stamp}`,
      scheduledFor: dueSoon,
      sourceReferenceType: "onboarding_task",
      sourceReferenceId: params.taskId,
      payload: { taskId: params.taskId },
      createdBy: params.createdBy ?? null,
    });
  }

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: ONBOARDING_OVERDUE_REMINDER,
    idempotencyKey: `onboarding:task:${params.taskId}:overdue:${stamp}`,
    scheduledFor: new Date(params.dueAt.getTime() + 24 * 60 * 60 * 1000),
    sourceReferenceType: "onboarding_task",
    sourceReferenceId: params.taskId,
    payload: { taskId: params.taskId },
    createdBy: params.createdBy ?? null,
  });
}

/**
 * Cancels still-scheduled reminders for an onboarding's tasks.
 *
 * Called when onboarding is cancelled (§26.28). The handlers are already
 * stale-safe, so this is belt and braces — but leaving dead jobs queued to
 * discover their own irrelevance is worse operational hygiene than cancelling
 * them outright.
 */
export async function cancelRemindersForInstance(params: {
  organizationId: number;
  instanceId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<number> {
  const tasks = await db
    .select({ id: onboardingTasksTable.id })
    .from(onboardingTasksTable)
    .where(
      and(
        eq(onboardingTasksTable.instanceId, params.instanceId),
        eq(onboardingTasksTable.organizationId, params.organizationId),
      ),
    );
  if (tasks.length === 0) return 0;

  const taskIds = new Set(tasks.map((t) => t.id));
  const jobs = await listScheduledJobs({ organizationId: params.organizationId, status: "scheduled" });

  let cancelled = 0;
  for (const job of jobs) {
    if (job.sourceReferenceType !== "onboarding_task") continue;
    if (job.sourceReferenceId == null || !taskIds.has(job.sourceReferenceId)) continue;
    try {
      await cancelJob({
        jobId: job.id,
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
      });
      cancelled += 1;
    } catch {
      // A job a worker already claimed cannot be cancelled. That is fine: the
      // handler will re-fetch state and no-op on its own.
    }
  }
  return cancelled;
}
