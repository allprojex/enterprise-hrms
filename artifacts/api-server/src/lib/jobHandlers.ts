/**
 * WS-6 — the shipped, platform-generic job handlers. Registered once at
 * process startup (imported by both src/index.ts and src/worker.ts) so the
 * registry (lib/jobHandlerRegistry.ts) is populated identically in both
 * runtimes.
 *
 * Exactly two handlers ship with this workstream, and both are
 * domain-neutral by construction — neither one knows anything about
 * Recruitment, Onboarding, Probation, Contracts, Leave, Assets, or any
 * other business domain, which is what keeps this WS-6 infrastructure
 * rather than a smuggled-in domain feature:
 *
 *   diagnostics.ping   — proves the engine end to end (schedule -> claim ->
 *                        execute -> complete) with zero side effects. Used
 *                        by the worker-health/QA surface, never scheduled
 *                        automatically for any organization.
 *
 *   reminder.notify    — the generic "reminder" primitive itself (§15/§42-
 *                        45): deliver a notification, reliably, once, to an
 *                        authorized recipient, at a time the caller chose.
 *                        WS-9/WS-10/WS-11/WS-13/WS-15 will each call
 *                        `scheduleJob("reminder.notify", {...})` with their
 *                        own title/message/recipient/timing decisions; this
 *                        handler contains no business rule about what
 *                        should be reminded or when.
 */
import { z } from "zod/v4";
import { registerJobHandler, zodPayloadParser } from "./jobHandlerRegistry";
import { registerOnboardingJobHandlers } from "./onboarding/reminders";
import { registerEmploymentLifecycleJobHandlers } from "./employmentLifecycle/reminders";
import { notifyUser, type RecipientSpec } from "./notifications";

const recipientSpecSchema: z.ZodType<RecipientSpec> = z.union([
  z.object({ kind: z.literal("user"), userId: z.number().int().positive() }),
  z.object({ kind: z.literal("membership"), membershipId: z.number().int().positive() }),
  z.object({ kind: z.literal("employee"), employeeId: z.number().int().positive() }),
  z.object({ kind: z.literal("manager_of_employee"), employeeId: z.number().int().positive() }),
  z.object({ kind: z.literal("permission_holders"), permissionKey: z.string().min(1).max(128) }),
]);

const reminderNotifyPayloadSchema = z.object({
  recipient: recipientSpecSchema,
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.enum(["info", "success", "warning", "alert"]).optional(),
  actionPath: z.string().max(500).optional(),
});

export type ReminderNotifyPayload = z.infer<typeof reminderNotifyPayloadSchema>;

let handlersRegistered = false;

/**
 * Idempotent registration — safe to call from both entrypoints, and from a
 * test that imports this module more than once in the same process, without
 * tripping `DuplicateJobHandlerError`.
 */
export function registerShippedJobHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  registerJobHandler("diagnostics.ping", {
    parsePayload: (raw) => raw,
    execute: async () => undefined,
  });

  registerJobHandler<ReminderNotifyPayload>("reminder.notify", {
    parsePayload: zodPayloadParser(reminderNotifyPayloadSchema),
    execute: async (ctx) => {
      if (ctx.organizationId == null) {
        // A reminder.notify job is always about something in some
        // organization's context — a platform-scoped (organizationId null)
        // use of this particular handler is a caller error, not a
        // transient condition retrying could fix.
        const { PermanentJobError } = await import("./jobHandlerRegistry");
        throw new PermanentJobError("reminder.notify requires a job scoped to an organization");
      }
      await notifyUser({
        recipient: ctx.payload.recipient,
        organizationId: ctx.organizationId,
        title: ctx.payload.title,
        message: ctx.payload.message,
        type: ctx.payload.type,
        sourceReferenceType: ctx.sourceReferenceType,
        sourceReferenceId: ctx.sourceReferenceId,
        sourceJobId: ctx.jobId,
        actionPath: ctx.payload.actionPath,
      });
    },
  });

  // WS-10 — onboarding's own reminder handlers, registered from here so both
  // entrypoints pick them up without either needing to know about onboarding,
  // and so scheduleJob()'s jobType validation accepts them in the web process
  // too. They are separate handlers rather than reuses of reminder.notify
  // because §26.14 requires each to re-fetch authoritative onboarding state and
  // no-op when stale, which a domain-neutral notifier cannot do.
  registerOnboardingJobHandlers();

  // WS-11 — employment lifecycle reminders. Separate handlers rather than
  // reuses of reminder.notify because §27.10 requires each to re-fetch
  // authoritative state and no-op when stale. They are observers only: §27.11
  // forbids a scheduled job making a consequential employment decision.
  registerEmploymentLifecycleJobHandlers();
}
