import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import {
  db,
  clearanceItemsTable,
  employeeExitProcessesTable,
  grievanceCasesTable,
  disciplinaryCasesTable,
} from "@workspace/db";
import { registerJobHandler, zodPayloadParser, PermanentJobError } from "../jobHandlerRegistry";
import { scheduleJob } from "../scheduledJobs";
import { notifyUser } from "../notifications";

/**
 * WS-12 — Employee Relations and offboarding reminders through WS-6 (§28.20).
 *
 * THESE HANDLERS ARE OBSERVERS, AND IN THIS DOMAIN THAT MATTERS MORE THAN
 * ANYWHERE ELSE IN THE PLATFORM. §28.20 and §27.11's platform-wide rule: no job
 * may record a finding, decide an outcome, close a case, waive a clearance item,
 * grant final clearance or separate anyone. A scheduled process must never be
 * able to conclude that somebody is guilty, that a grievance is unfounded, or
 * that a departure is cleared — those are human decisions, and a queue worker
 * has no standing to make them.
 *
 * If you are here to add "just one" automatic transition, that is the change
 * §28.20 forbids without its own Owner Decision.
 *
 * Every handler re-fetches authoritative state and returns a PERMANENT no-op
 * when the reminder has been overtaken by events — the shipped `onboarding.*`
 * and `employment.*` pattern. In-app notifications only; no email or SMS
 * capability exists in this platform.
 */

export const RESPONSE_DUE_REMINDER = "employee_relations.response_due";
export const HEARING_REMINDER = "employee_relations.hearing_reminder";
export const GRIEVANCE_ACKNOWLEDGEMENT_DUE = "grievance.acknowledgement_due";
export const GRIEVANCE_ACTION_OVERDUE = "grievance.action_overdue";
export const CLEARANCE_ASSIGNED = "offboarding.clearance_assigned";
export const CLEARANCE_OVERDUE = "offboarding.clearance_overdue";

/** Narrow identifiers only — never a domain snapshot, and never case content. */
const casePayload = z.object({ caseId: z.number().int().positive() });
const clearanceItemPayload = z.object({ clearanceItemId: z.number().int().positive() });

/**
 * Recipients are resolved at SEND time by WS-6's own resolution, so a change of
 * post-holder between scheduling and firing reaches the right desk.
 *
 * Note the deliberate split: disciplinary reminders go to employee-relations
 * holders and grievance reminders to grievance holders. Routing a grievance
 * reminder to the broader employee-relations audience would leak the existence
 * of a complaint to people §28.17 withholds grievance access from — the
 * notification itself being a disclosure is exactly the risk WS-6's own
 * recipient design was built to close.
 */
const ER_RECIPIENT = "employee_relations.manage";
const GRIEVANCE_RECIPIENT = "grievance.manage";
const OFFBOARDING_RECIPIENT = "offboarding.manage";
const CLEARANCE_RECIPIENT = "clearance.act";

let registered = false;

export function registerEmployeeRelationsJobHandlers(): void {
  if (registered) return;
  registered = true;

  const requireOrg = (organizationId: number | null | undefined): number => {
    if (organizationId == null) throw new PermanentJobError("Employee Relations reminders are organization-scoped.");
    return organizationId;
  };

  registerJobHandler<z.infer<typeof casePayload>>(RESPONSE_DUE_REMINDER, {
    parsePayload: zodPayloadParser(casePayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({ id: disciplinaryCasesTable.id, status: disciplinaryCasesTable.status })
        .from(disciplinaryCasesTable)
        .where(
          and(
            eq(disciplinaryCasesTable.id, ctx.payload.caseId),
            eq(disciplinaryCasesTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The disciplinary case no longer exists in this organization.");
      if (row.status !== "open") throw new PermanentJobError("The disciplinary case is closed.");

      // Deliberately content-free. A notification that quoted the allegation
      // would put case content in front of anyone who can see a notification
      // list, which is a wider audience than the case's own permission.
      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: ER_RECIPIENT },
        organizationId,
        title: "A disciplinary case is awaiting a response",
        message: "A response window on an open disciplinary case is due. Review the case and record the position.",
        type: "info",
        sourceReferenceType: "disciplinary_case",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/employee-relations/disciplinary/${row.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof casePayload>>(HEARING_REMINDER, {
    parsePayload: zodPayloadParser(casePayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({ id: disciplinaryCasesTable.id, status: disciplinaryCasesTable.status })
        .from(disciplinaryCasesTable)
        .where(
          and(
            eq(disciplinaryCasesTable.id, ctx.payload.caseId),
            eq(disciplinaryCasesTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The disciplinary case no longer exists in this organization.");
      if (row.status !== "open") throw new PermanentJobError("The disciplinary case is closed.");

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: ER_RECIPIENT },
        organizationId,
        title: "A disciplinary hearing is approaching",
        message: "A hearing recorded against an open disciplinary case is due shortly.",
        type: "info",
        sourceReferenceType: "disciplinary_case",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/employee-relations/disciplinary/${row.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof casePayload>>(GRIEVANCE_ACKNOWLEDGEMENT_DUE, {
    parsePayload: zodPayloadParser(casePayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({
          id: grievanceCasesTable.id,
          status: grievanceCasesTable.status,
          acknowledgedAt: grievanceCasesTable.acknowledgedAt,
        })
        .from(grievanceCasesTable)
        .where(
          and(eq(grievanceCasesTable.id, ctx.payload.caseId), eq(grievanceCasesTable.organizationId, organizationId)),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The grievance no longer exists in this organization.");
      // Already acknowledged, or already over — either way this reminder is stale.
      if (row.acknowledgedAt) throw new PermanentJobError("The grievance has already been acknowledged.");
      if (row.status === "closed" || row.status === "withdrawn") {
        throw new PermanentJobError("The grievance is closed or withdrawn.");
      }

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: GRIEVANCE_RECIPIENT },
        organizationId,
        title: "A grievance is awaiting acknowledgement",
        message: "A submitted grievance has not yet been acknowledged.",
        type: "warning",
        sourceReferenceType: "grievance_case",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/employee-relations/grievances/${row.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof casePayload>>(GRIEVANCE_ACTION_OVERDUE, {
    parsePayload: zodPayloadParser(casePayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({ id: grievanceCasesTable.id, status: grievanceCasesTable.status })
        .from(grievanceCasesTable)
        .where(
          and(eq(grievanceCasesTable.id, ctx.payload.caseId), eq(grievanceCasesTable.organizationId, organizationId)),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The grievance no longer exists in this organization.");
      if (row.status === "closed" || row.status === "withdrawn" || row.status === "resolved") {
        throw new PermanentJobError("The grievance has already reached an outcome.");
      }

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: GRIEVANCE_RECIPIENT },
        organizationId,
        title: "A grievance is still open",
        message: "An open grievance has had no recorded action for some time. Review it.",
        type: "warning",
        sourceReferenceType: "grievance_case",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/employee-relations/grievances/${row.id}`,
      });
    },
  });

  /**
   * Both clearance reminders share one body because they differ only in urgency
   * and audience: the assignment notice goes to whoever can act on the item, the
   * overdue notice escalates to whoever runs the offboarding.
   */
  const notifyClearance = async (
    ctx: { organizationId: number | null; payload: z.infer<typeof clearanceItemPayload>; jobId: number },
    overdue: boolean,
  ): Promise<void> => {
    {
      const organizationId = requireOrg(ctx.organizationId);
      const [item] = await db
        .select({
          id: clearanceItemsTable.id,
          status: clearanceItemsTable.status,
          label: clearanceItemsTable.label,
          exitProcessId: clearanceItemsTable.exitProcessId,
        })
        .from(clearanceItemsTable)
        .where(
          and(
            eq(clearanceItemsTable.id, ctx.payload.clearanceItemId),
            eq(clearanceItemsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!item) throw new PermanentJobError("The clearance item no longer exists in this organization.");
      // Completed or waived is done. The handler no-ops rather than nagging.
      if (item.status === "completed" || item.status === "waived") {
        throw new PermanentJobError("The clearance item is already resolved.");
      }

      const [process] = await db
        .select({ id: employeeExitProcessesTable.id, status: employeeExitProcessesTable.status })
        .from(employeeExitProcessesTable)
        .where(
          and(
            eq(employeeExitProcessesTable.id, item.exitProcessId),
            eq(employeeExitProcessesTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!process) throw new PermanentJobError("The offboarding no longer exists.");
      if (process.status === "completed" || process.status === "cancelled") {
        throw new PermanentJobError("The offboarding is no longer running.");
      }

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: overdue ? OFFBOARDING_RECIPIENT : CLEARANCE_RECIPIENT },
        organizationId,
        title: overdue ? "Clearance is overdue" : "A clearance item needs your action",
        message: overdue
          ? `An outstanding clearance item ("${item.label}") is overdue on a running offboarding.`
          : `A clearance item ("${item.label}") has been assigned for action.`,
        type: overdue ? "warning" : "info",
        sourceReferenceType: "clearance_item",
        sourceReferenceId: item.id,
        sourceJobId: ctx.jobId,
        actionPath: `/offboarding/${item.exitProcessId}`,
      });
    }
  };

  registerJobHandler<z.infer<typeof clearanceItemPayload>>(CLEARANCE_ASSIGNED, {
    parsePayload: zodPayloadParser(clearanceItemPayload),
    execute: async (ctx) => notifyClearance(ctx, false),
  });

  registerJobHandler<z.infer<typeof clearanceItemPayload>>(CLEARANCE_OVERDUE, {
    parsePayload: zodPayloadParser(clearanceItemPayload),
    execute: async (ctx) => notifyClearance(ctx, true),
  });

}

/**
 * Schedules a clearance reminder.
 *
 * The idempotency key embeds the target date, so rescheduling a genuinely later
 * reminder creates a new occurrence while a retry of the same operation dedupes
 * — WS-6's documented convention, and what keeps §28's idempotency requirement
 * true under retry.
 */
export async function scheduleClearanceReminder(params: {
  organizationId: number;
  clearanceItemId: number;
  fireAt: Date;
  overdue?: boolean;
  createdBy?: number | null;
}): Promise<void> {
  if (params.fireAt.getTime() <= Date.now()) return;
  const jobType = params.overdue ? CLEARANCE_OVERDUE : CLEARANCE_ASSIGNED;

  await scheduleJob({
    organizationId: params.organizationId,
    jobType,
    idempotencyKey: `er:clearance:${params.clearanceItemId}:${jobType}:${params.fireAt.toISOString().slice(0, 10)}`,
    scheduledFor: params.fireAt,
    sourceReferenceType: "clearance_item",
    sourceReferenceId: params.clearanceItemId,
    payload: { clearanceItemId: params.clearanceItemId },
    createdBy: params.createdBy ?? null,
  });
}

export async function scheduleGrievanceReminder(params: {
  organizationId: number;
  caseId: number;
  fireAt: Date;
  jobType: typeof GRIEVANCE_ACKNOWLEDGEMENT_DUE | typeof GRIEVANCE_ACTION_OVERDUE;
  createdBy?: number | null;
}): Promise<void> {
  if (params.fireAt.getTime() <= Date.now()) return;

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: params.jobType,
    idempotencyKey: `er:grievance:${params.caseId}:${params.jobType}:${params.fireAt.toISOString().slice(0, 10)}`,
    scheduledFor: params.fireAt,
    sourceReferenceType: "grievance_case",
    sourceReferenceId: params.caseId,
    payload: { caseId: params.caseId },
    createdBy: params.createdBy ?? null,
  });
}

export async function scheduleDisciplinaryReminder(params: {
  organizationId: number;
  caseId: number;
  fireAt: Date;
  jobType: typeof RESPONSE_DUE_REMINDER | typeof HEARING_REMINDER;
  createdBy?: number | null;
}): Promise<void> {
  if (params.fireAt.getTime() <= Date.now()) return;

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: params.jobType,
    idempotencyKey: `er:disciplinary:${params.caseId}:${params.jobType}:${params.fireAt.toISOString().slice(0, 10)}`,
    scheduledFor: params.fireAt,
    sourceReferenceType: "disciplinary_case",
    sourceReferenceId: params.caseId,
    payload: { caseId: params.caseId },
    createdBy: params.createdBy ?? null,
  });
}
