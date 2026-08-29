import { z } from "zod/v4";
import { and, eq } from "drizzle-orm";
import { db, dataChangeRequestsTable, serviceRequestsTable, serviceRequestTypesTable } from "@workspace/db";
import { registerJobHandler, zodPayloadParser, PermanentJobError } from "../jobHandlerRegistry";
import { scheduleJob } from "../scheduledJobs";
import { notifyUser } from "../notifications";

/**
 * WS-13 — request reminders through WS-6 (§29.15).
 *
 * THESE HANDLERS ARE OBSERVERS, AND HERE THAT RULE HAS TEETH. §29.15 and
 * §27.11's platform-wide boundary: no job may approve a request, reject one,
 * apply an employee mutation, alter a sensitive field or perform fulfilment.
 * A scheduled process has no standing to decide that somebody's name may be
 * changed, and nothing in this file can reach `applyRequest` — that function is
 * only callable from an authorized human's API call (§29.11).
 *
 * A FUTURE EFFECTIVE DATE IS NOT A TRIGGER. §29.11 is explicit that recording
 * an effective date does not licence a job to write the record when it arrives.
 * There is deliberately no "apply due changes" handler here, and adding one is
 * the change §29.11 forbids without its own Owner Decision.
 *
 * NOTIFICATION BODIES CARRY NO REQUESTED VALUE. A notification list is a wider
 * audience than the request's own permission, and some requested values are
 * sensitive identifiers — so the messages say that something needs attention,
 * never what it contains (§29.15, §29.16).
 *
 * Every handler re-fetches authoritative state and returns a PERMANENT no-op
 * when overtaken by events, following the shipped `onboarding.*`,
 * `employment.*` and `employee_relations.*` pattern. In-app only.
 */

export const DATA_CHANGE_APPROVAL_PENDING = "data_change.approval_pending";
export const SERVICE_REQUEST_APPROVAL_PENDING = "service_request.approval_pending";
export const SERVICE_REQUEST_OVERDUE = "service_request.overdue";
export const SERVICE_REQUEST_AWAITING_EMPLOYEE = "service_request.awaiting_employee";

/** Narrow identifiers only — never a domain snapshot, and never a field value. */
const requestPayload = z.object({ requestId: z.number().int().positive() });

const DATA_CHANGE_APPROVER = "data_change.approve";
const SERVICE_REQUEST_APPROVER = "service_request.approve";
const SERVICE_REQUEST_OWNER = "service_request.manage";

let registered = false;

export function registerEmployeeRequestJobHandlers(): void {
  if (registered) return;
  registered = true;

  const requireOrg = (organizationId: number | null | undefined): number => {
    if (organizationId == null) throw new PermanentJobError("WS-13 reminders are organization-scoped.");
    return organizationId;
  };

  registerJobHandler<z.infer<typeof requestPayload>>(DATA_CHANGE_APPROVAL_PENDING, {
    parsePayload: zodPayloadParser(requestPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({ id: dataChangeRequestsTable.id, status: dataChangeRequestsTable.status })
        .from(dataChangeRequestsTable)
        .where(
          and(
            eq(dataChangeRequestsTable.id, ctx.payload.requestId),
            eq(dataChangeRequestsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The data change request no longer exists in this organization.");
      // Decided, withdrawn or already applied — the reminder is stale.
      if (row.status !== "pending" && row.status !== "returned") {
        throw new PermanentJobError("The request is no longer awaiting a decision.");
      }

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: DATA_CHANGE_APPROVER },
        organizationId,
        title: "A data change request is awaiting a decision",
        // Content-free on purpose: some requested values are statutory identifiers.
        message: "An employee data change request has been waiting for a decision. Review it.",
        type: "info",
        sourceReferenceType: "data_change_request",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/requests/data-changes/${row.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof requestPayload>>(SERVICE_REQUEST_APPROVAL_PENDING, {
    parsePayload: zodPayloadParser(requestPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({
          id: serviceRequestsTable.id,
          status: serviceRequestsTable.status,
          approvalStatus: serviceRequestsTable.approvalStatus,
        })
        .from(serviceRequestsTable)
        .where(
          and(
            eq(serviceRequestsTable.id, ctx.payload.requestId),
            eq(serviceRequestsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The service request no longer exists in this organization.");
      if (row.approvalStatus !== "pending") throw new PermanentJobError("The request is no longer awaiting approval.");

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: SERVICE_REQUEST_APPROVER },
        organizationId,
        title: "A service request is awaiting approval",
        message: "An HR service request has been waiting for approval. Review it.",
        type: "info",
        sourceReferenceType: "service_request",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/requests/service/${row.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof requestPayload>>(SERVICE_REQUEST_OVERDUE, {
    parsePayload: zodPayloadParser(requestPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({
          id: serviceRequestsTable.id,
          status: serviceRequestsTable.status,
          submittedAt: serviceRequestsTable.submittedAt,
          targetDays: serviceRequestTypesTable.targetDays,
        })
        .from(serviceRequestsTable)
        .innerJoin(serviceRequestTypesTable, eq(serviceRequestTypesTable.id, serviceRequestsTable.typeId))
        .where(
          and(
            eq(serviceRequestsTable.id, ctx.payload.requestId),
            eq(serviceRequestsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The service request no longer exists in this organization.");
      if (["fulfilled", "closed", "cancelled", "withdrawn"].includes(row.status)) {
        throw new PermanentJobError("The request is already resolved.");
      }
      // Overdue is DERIVED here too, never read from a stored flag (§29.22).
      if (row.targetDays == null) throw new PermanentJobError("This request type has no target, so it cannot be overdue.");
      const ageDays = Math.floor((Date.now() - row.submittedAt.getTime()) / (24 * 60 * 60 * 1000));
      if (ageDays <= row.targetDays) throw new PermanentJobError("The request is not yet overdue.");

      await notifyUser({
        recipient: { kind: "permission_holders", permissionKey: SERVICE_REQUEST_OWNER },
        organizationId,
        title: "A service request is overdue",
        message: "An open HR service request has passed its target. Review it.",
        type: "warning",
        sourceReferenceType: "service_request",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/requests/service/${row.id}`,
      });
    },
  });

  registerJobHandler<z.infer<typeof requestPayload>>(SERVICE_REQUEST_AWAITING_EMPLOYEE, {
    parsePayload: zodPayloadParser(requestPayload),
    execute: async (ctx) => {
      const organizationId = requireOrg(ctx.organizationId);
      const [row] = await db
        .select({
          id: serviceRequestsTable.id,
          status: serviceRequestsTable.status,
          employeeId: serviceRequestsTable.employeeId,
        })
        .from(serviceRequestsTable)
        .where(
          and(
            eq(serviceRequestsTable.id, ctx.payload.requestId),
            eq(serviceRequestsTable.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!row) throw new PermanentJobError("The service request no longer exists in this organization.");
      if (row.status !== "awaiting_employee") throw new PermanentJobError("The request is no longer awaiting the employee.");

      // The one reminder addressed to the employee themselves, using WS-6's own
      // employee recipient resolution.
      await notifyUser({
        recipient: { kind: "employee", employeeId: row.employeeId },
        organizationId,
        title: "HR needs more information",
        message: "HR has asked for more information on one of your requests.",
        type: "info",
        sourceReferenceType: "service_request",
        sourceReferenceId: row.id,
        sourceJobId: ctx.jobId,
        actionPath: `/my-requests`,
      });
    },
  });
}

/**
 * Schedules a reminder.
 *
 * The idempotency key embeds the target date, so a genuinely later reminder
 * creates a new occurrence while a retry of the same operation dedupes — WS-6's
 * documented convention, and what keeps §29's idempotency requirement true
 * under retry.
 */
export async function scheduleRequestReminder(params: {
  organizationId: number;
  jobType:
    | typeof DATA_CHANGE_APPROVAL_PENDING
    | typeof SERVICE_REQUEST_APPROVAL_PENDING
    | typeof SERVICE_REQUEST_OVERDUE
    | typeof SERVICE_REQUEST_AWAITING_EMPLOYEE;
  requestId: number;
  fireAt: Date;
  sourceReferenceType: "data_change_request" | "service_request";
  createdBy?: number | null;
}): Promise<void> {
  if (params.fireAt.getTime() <= Date.now()) return;

  await scheduleJob({
    organizationId: params.organizationId,
    jobType: params.jobType,
    idempotencyKey: `ws13:${params.jobType}:${params.requestId}:${params.fireAt.toISOString().slice(0, 10)}`,
    scheduledFor: params.fireAt,
    sourceReferenceType: params.sourceReferenceType,
    sourceReferenceId: params.requestId,
    payload: { requestId: params.requestId },
    createdBy: params.createdBy ?? null,
  });
}
