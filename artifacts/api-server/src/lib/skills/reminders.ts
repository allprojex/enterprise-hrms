import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import {
  db,
  employeeSkillRecordsTable,
  employeeCertificationsTable,
  successionPlansTable,
  developmentActionsTable,
} from "@workspace/db";
import { registerJobHandler, zodPayloadParser, PermanentJobError } from "../jobHandlerRegistry";
import { scheduleJob } from "../scheduledJobs";
import { notifyUser } from "../notifications";

/**
 * WS-14 — capability and succession reminders through WS-6 (§30.21).
 *
 * THESE HANDLERS ARE OBSERVERS, AND IN THIS DOMAIN THAT MATTERS PARTICULARLY.
 * §30.21 and §27.11's platform-wide rule: no job may assess proficiency, verify
 * a claim, nominate or remove a candidate, change readiness, or promote,
 * transfer or appoint anybody. Readiness in particular is HUMAN-OWNED (§30.13) —
 * a scheduled process has no standing to decide that somebody is ready to
 * succeed into a role, and nothing in this file can reach `setReadiness`.
 *
 * If you are here to add "just one" automatic transition, that is the change
 * §30.21 forbids without its own Owner Decision.
 *
 * NOTIFICATION BODIES CARRY NO PROFICIENCY VALUE AND NO SUCCESSION CONTENT.
 * A notification list is a wider audience than a record's own permission, and
 * succession is confidential (§30.17) — so the succession reminder says a review
 * is due and names nobody.
 *
 * Every handler re-fetches authoritative state and returns a PERMANENT no-op
 * when overtaken by events, the shipped `onboarding.*`, `employment.*`,
 * `employee_relations.*` and WS-13 pattern. In-app only.
 */

export const SKILL_VERIFICATION_PENDING = "skill.verification_pending";
export const SKILL_CERTIFICATION_EXPIRING = "skill.certification_expiring";
export const SUCCESSION_REVIEW_DUE = "succession.review_due";
export const DEVELOPMENT_ACTION_DUE = "development.action_due";

/** Narrow identifiers only — never a domain snapshot, and never a level or a name. */
const recordPayload = z.object({ recordId: z.number().int().positive() });
const certificationPayload = z.object({ certificationId: z.number().int().positive() });
const planPayload = z.object({ planId: z.number().int().positive() });
const actionPayload = z.object({ actionId: z.number().int().positive() });

const VERIFIER_RECIPIENT = "skill_verification.decide";
const CAPABILITY_RECIPIENT = "employee_skill.manage";
/**
 * Succession reminders go ONLY to succession holders (§30.17). Routing them to
 * a broader HR audience would disclose that a succession plan exists to people
 * deliberately withheld from succession access — the notification itself being
 * the disclosure, the risk WS-6's recipient design exists to close.
 */
const SUCCESSION_RECIPIENT = "succession.manage";

let registered = false;

export function registerSkillsJobHandlers(): void {
  if (registered) return;
  registered = true;

  const requireOrg = (organizationId: number | null | undefined): number => {
    if (organizationId == null) throw new PermanentJobError("WS-14 reminders are organization-scoped.");
    return organizationId;
  };

  registerJobHandler<z.infer<typeof recordPayload>>(SKILL_VERIFICATION_PENDING, {
    parsePayload: zodPayloadParser(recordPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({ id: employeeSkillRecordsTable.id, status: employeeSkillRecordsTable.status })
        .from(employeeSkillRecordsTable)
        .where(
          and(
            eq(employeeSkillRecordsTable.id, ctx.payload.recordId),
            eq(employeeSkillRecordsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The skill record no longer exists in this organization.");
      // Already decided one way or the other — the reminder is stale.
      if (row.status === "verified" || row.status === "rejected") {
        throw new PermanentJobError("The claim has already been decided.");
      }

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: VERIFIER_RECIPIENT },
        organizationId,
        title: "A skill claim is awaiting verification",
        // Content-free: the claimed level is not put in front of a notification audience.
        message: "An employee skill claim has been waiting for a verification decision.",
        type: "info",
        sourceReferenceType: "employee_skill_record",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/capability`,
      });
    },
  });

  registerJobHandler<z.infer<typeof certificationPayload>>(SKILL_CERTIFICATION_EXPIRING, {
    parsePayload: zodPayloadParser(certificationPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [cert] = await db
        .select({ id: employeeCertificationsTable.id, expiryDate: employeeCertificationsTable.expiryDate })
        .from(employeeCertificationsTable)
        .where(
          and(
            eq(employeeCertificationsTable.id, ctx.payload.certificationId),
            eq(employeeCertificationsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!cert) throw new PermanentJobError("The certification no longer exists in this organization.");
      // The expiry may have been extended since this was scheduled.
      if (!cert.expiryDate) throw new PermanentJobError("The certification no longer records an expiry date.");

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: CAPABILITY_RECIPIENT },
        organizationId,
        title: "A certification is approaching its expiry",
        message:
          "A certification supporting an employee capability is due to expire. Once it lapses it no longer evidences that skill.",
        type: "warning",
        sourceReferenceType: "employee_certification",
        sourceReferenceId: cert.id,
        sourceJobId: ctx.jobId,
        actionPath: `/capability`,
      });
    },
  });

  registerJobHandler<z.infer<typeof planPayload>>(SUCCESSION_REVIEW_DUE, {
    parsePayload: zodPayloadParser(planPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [plan] = await db
        .select({ id: successionPlansTable.id, status: successionPlansTable.status })
        .from(successionPlansTable)
        .where(
          and(
            eq(successionPlansTable.id, ctx.payload.planId),
            eq(successionPlansTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!plan) throw new PermanentJobError("The succession plan no longer exists in this organization.");
      if (plan.status === "closed") throw new PermanentJobError("The succession plan is closed.");

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: SUCCESSION_RECIPIENT },
        organizationId,
        title: "A succession plan is due for review",
        // Names no position, no candidate and no readiness — succession is
        // confidential, and this reminder reaches only succession holders.
        message: "A succession plan has reached its review date.",
        type: "info",
        sourceReferenceType: "succession_plan",
        sourceReferenceId: plan.id,
        sourceJobId: ctx.jobId,
        actionPath: `/succession`,
      });
    },
  });

  registerJobHandler<z.infer<typeof actionPayload>>(DEVELOPMENT_ACTION_DUE, {
    parsePayload: zodPayloadParser(actionPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [action] = await db
        .select({ id: developmentActionsTable.id, status: developmentActionsTable.status })
        .from(developmentActionsTable)
        .where(
          and(
            eq(developmentActionsTable.id, ctx.payload.actionId),
            eq(developmentActionsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!action) throw new PermanentJobError("The development action no longer exists in this organization.");
      if (action.status === "completed" || action.status === "cancelled") {
        throw new PermanentJobError("The development action is already resolved.");
      }

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: CAPABILITY_RECIPIENT },
        organizationId,
        title: "A development action is due",
        message: "A recorded development action has reached its target date.",
        type: "info",
        sourceReferenceType: "development_action",
        sourceReferenceId: action.id,
        sourceJobId: ctx.jobId,
        actionPath: `/capability`,
      });
    },
  });
}

/**
 * Schedules a WS-14 reminder.
 *
 * The idempotency key embeds the target date, so a genuinely later reminder
 * creates a new occurrence while a retry of the same operation dedupes — WS-6's
 * documented convention.
 */
export async function scheduleSkillsReminder(params: {
  organizationId: number;
  jobType:
    | typeof SKILL_VERIFICATION_PENDING
    | typeof SKILL_CERTIFICATION_EXPIRING
    | typeof SUCCESSION_REVIEW_DUE
    | typeof DEVELOPMENT_ACTION_DUE;
  referenceId: number;
  fireAt: Date;
  sourceReferenceType: "employee_skill_record" | "employee_certification" | "succession_plan" | "development_action";
  createdBy?: number | null;
}): Promise<void> {
  if (params.fireAt.getTime() <= Date.now()) return;

  const payloadKey =
    params.jobType === SKILL_VERIFICATION_PENDING
      ? { recordId: params.referenceId }
      : params.jobType === SKILL_CERTIFICATION_EXPIRING
        ? { certificationId: params.referenceId }
        : params.jobType === SUCCESSION_REVIEW_DUE
          ? { planId: params.referenceId }
          : { actionId: params.referenceId };

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: params.jobType,
    idempotencyKey: `ws14:${params.jobType}:${params.referenceId}:${params.fireAt.toISOString().slice(0, 10)}`,
    scheduledFor: params.fireAt,
    sourceReferenceType: params.sourceReferenceType,
    sourceReferenceId: params.referenceId,
    payload: payloadKey,
    createdBy: params.createdBy ?? null,
  });
}
