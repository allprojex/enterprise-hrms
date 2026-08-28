import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db, employeesTable, employmentTermsTable } from "@workspace/db";
import { registerJobHandler, zodPayloadParser, PermanentJobError } from "../jobHandlerRegistry";
import { scheduleJob, listScheduledJobs, cancelJob } from "../scheduledJobs";
import { notifyUser } from "../notifications";
import { resolveProbationEnd } from "./probation";
import { deriveExpiryState } from "./employmentTerms";
import { resolveEmploymentLifecycleConfig } from "./config";

/**
 * WS-11 — employment lifecycle reminders through WS-6 (§27.10, §27.11).
 *
 * THE RULE THIS FILE MOST EXISTS TO HOLD: these handlers are OBSERVERS. They
 * calculate, detect, remind and notify. They do not — and must never — confirm
 * an employee, extend a probation, separate anyone, renew a contract, or end an
 * acting appointment or secondment. §27.11 freezes that as a platform-wide
 * safety rule, and it deliberately qualifies OD #13's "auto-revert" phrasing:
 * a job may notice an expected end has passed and surface it, but ENDING it is
 * an authorized human act.
 *
 * If you are here to add "just one" automatic transition, that is the change
 * §27.11 forbids without its own approval.
 *
 * In-app notifications only. No email or SMS capability exists in this platform.
 */

export const PROBATION_REMINDER = "employment.probation_reminder";
export const CONTRACT_EXPIRY_REMINDER = "employment.contract_expiry_reminder";

/** Narrow identifiers only — never a domain snapshot. */
const probationPayload = z.object({ employeeId: z.number().int().positive() });
const contractPayload = z.object({ employmentTermId: z.number().int().positive() });

/**
 * Reminders go to whoever currently holds employee-management authority,
 * resolved at SEND time by WS-6's own recipient resolution. An organization
 * with nobody holding the permission is notified nobody — a safe no-op, not an
 * error.
 */
const RECIPIENT_PERMISSION = "employment_lifecycle.manage";

let registered = false;

export function registerEmploymentLifecycleJobHandlers(): void {
  if (registered) return;
  registered = true;

  registerJobHandler<z.infer<typeof probationPayload>>(PROBATION_REMINDER, {
    parsePayload: zodPayloadParser(probationPayload),
    execute: async (ctx) => {
      if (ctx.organizationId == null) throw new PermanentJobError("Employment reminders are organization-scoped.");

      const [employee] = await db
        .select({
          id: employeesTable.id,
          firstName: employeesTable.firstName,
          lastName: employeesTable.lastName,
          employmentStatus: employeesTable.employmentStatus,
        })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, ctx.payload.employeeId), eq(employeesTable.organizationId, ctx.organizationId)))
        .limit(1);
      if (!employee) throw new PermanentJobError("The employee no longer exists in this organization.");

      // Authoritative state re-fetched at execution. Confirmation or separation
      // between scheduling and firing makes this reminder meaningless.
      if (employee.employmentStatus !== "probation") {
        throw new PermanentJobError("The employee is no longer on probation.");
      }

      // A valid extension moves the expected end, which supersedes the date
      // this reminder was scheduled against.
      const { probationEndDate } = await resolveProbationEnd(ctx.organizationId, employee.id);
      if (!probationEndDate) throw new PermanentJobError("No probation end date is recorded.");

      const config = await resolveEmploymentLifecycleConfig(ctx.organizationId);
      const windowMs = config.probationReminderDaysBefore * 24 * 60 * 60 * 1000;
      if (probationEndDate.getTime() - Date.now() > windowMs) {
        throw new PermanentJobError("The probation end has moved beyond the reminder window.");
      }

      const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ");
      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: RECIPIENT_PERMISSION },
        organizationId: ctx.organizationId,
        title: "Probation ending soon",
        // Deliberately factual and non-prescriptive: the platform does not tell
        // an organization what its decision should be.
        message: `${name || "An employee"}'s probation period is due to end. Review and record the outcome.`,
        type: "info",
        sourceReferenceType: "employee",
        sourceReferenceId: employee.id,
        sourceJobId: ctx.jobId,
        actionPath: `/employees/${employee.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof contractPayload>>(CONTRACT_EXPIRY_REMINDER, {
    parsePayload: zodPayloadParser(contractPayload),
    execute: async (ctx) => {
      if (ctx.organizationId == null) throw new PermanentJobError("Employment reminders are organization-scoped.");

      const [term] = await db
        .select()
        .from(employmentTermsTable)
        .where(
          and(
            eq(employmentTermsTable.id, ctx.payload.employmentTermId),
            eq(employmentTermsTable.organizationId, ctx.organizationId),
          ),
        )
        .limit(1);
      if (!term) throw new PermanentJobError("The employment term no longer exists in this organization.");

      // A renewal supersedes the term, and a closure ends it — either way this
      // reminder is stale and must not fire.
      if (term.status !== "active") throw new PermanentJobError("The employment term is no longer active.");

      const config = await resolveEmploymentLifecycleConfig(ctx.organizationId);
      const state = deriveExpiryState(term, config.contractExpiryReminderDaysBefore);
      if (state !== "expiring_soon" && state !== "expired") {
        throw new PermanentJobError("The term is not within its expiry window.");
      }

      const [employee] = await db
        .select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName })
        .from(employeesTable)
        .where(eq(employeesTable.id, term.employeeId))
        .limit(1);
      const name = employee ? [employee.firstName, employee.lastName].filter(Boolean).join(" ") : "";

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: RECIPIENT_PERMISSION },
        organizationId: ctx.organizationId,
        title: state === "expired" ? "Employment contract has passed its end date" : "Employment contract ending soon",
        // The wording matters: a passed end date is information, not an
        // instruction, and the employee remains employed until an authorized
        // action says otherwise (§27.6).
        message:
          state === "expired"
            ? `${name || "An employee"}'s contract end date has passed. Renew, close or record the appropriate action — employment is unchanged until you do.`
            : `${name || "An employee"}'s contract is approaching its end date.`,
        type: state === "expired" ? "warning" : "info",
        sourceReferenceType: "employment_term",
        sourceReferenceId: term.id,
        sourceJobId: ctx.jobId,
        actionPath: `/employees/${term.employeeId}`,
      });
    },
  });
}

/**
 * Schedules the probation reminder for an employee.
 *
 * The idempotency key embeds the target date, so extending probation schedules
 * a genuinely new occurrence while a retry of the same operation dedupes —
 * WS-6's documented convention.
 */
export async function scheduleProbationReminder(params: {
  organizationId: number;
  employeeId: number;
  probationEndDate: Date;
  daysBefore: number;
  createdBy?: number | null;
}): Promise<void> {
  const fireAt = new Date(params.probationEndDate.getTime() - params.daysBefore * 24 * 60 * 60 * 1000);
  if (fireAt.getTime() <= Date.now()) return;

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: PROBATION_REMINDER,
    idempotencyKey: `employment:probation:${params.employeeId}:${params.probationEndDate.toISOString().slice(0, 10)}`,
    scheduledFor: fireAt,
    sourceReferenceType: "employee",
    sourceReferenceId: params.employeeId,
    payload: { employeeId: params.employeeId },
    createdBy: params.createdBy ?? null,
  });
}

export async function scheduleContractExpiryReminder(params: {
  organizationId: number;
  employmentTermId: number;
  endDate: Date;
  daysBefore: number;
  createdBy?: number | null;
}): Promise<void> {
  const fireAt = new Date(params.endDate.getTime() - params.daysBefore * 24 * 60 * 60 * 1000);
  if (fireAt.getTime() <= Date.now()) return;

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: CONTRACT_EXPIRY_REMINDER,
    idempotencyKey: `employment:term:${params.employmentTermId}:${params.endDate.toISOString().slice(0, 10)}`,
    scheduledFor: fireAt,
    sourceReferenceType: "employment_term",
    sourceReferenceId: params.employmentTermId,
    payload: { employmentTermId: params.employmentTermId },
    createdBy: params.createdBy ?? null,
  });
}

/**
 * Cancels still-scheduled reminders for a source record.
 *
 * The handlers are already stale-safe, so this is hygiene rather than
 * correctness — but leaving dead jobs queued to discover their own irrelevance
 * is worse operational practice than cancelling them.
 */
export async function cancelRemindersFor(params: {
  organizationId: number;
  sourceReferenceType: "employee" | "employment_term";
  sourceReferenceId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
}): Promise<number> {
  const jobs = await listScheduledJobs({ organizationId: params.organizationId, status: "scheduled" });
  let cancelled = 0;
  for (const job of jobs) {
    if (job.sourceReferenceType !== params.sourceReferenceType) continue;
    if (job.sourceReferenceId !== params.sourceReferenceId) continue;
    if (job.jobType !== PROBATION_REMINDER && job.jobType !== CONTRACT_EXPIRY_REMINDER) continue;
    try {
      await cancelJob({
        jobId: job.id,
        actorApplicationUserId: params.actorApplicationUserId,
        actorMembershipId: params.actorMembershipId,
      });
      cancelled += 1;
    } catch {
      // A job a worker already claimed cannot be cancelled; its handler
      // re-fetches state and no-ops on its own.
    }
  }
  return cancelled;
}
