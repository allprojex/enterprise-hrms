/**
 * In-app notifications for form workflow transitions (WS-26, S1).
 *
 * The form engine had no delivery surface at all: a form could sit waiting for
 * an employee who was never told. This module is that surface, and it is
 * deliberately thin — it creates notifications through the EXISTING, deployed
 * notifications infrastructure (lib/notifications.ts) rather than introducing a
 * parallel one, and it adds no new capability, permission or table.
 *
 * Four rules shape everything below.
 *
 *  1. NOTIFICATION FAILURE MUST NEVER AFFECT THE FORM. Every entry point is
 *     called AFTER the workflow transaction has committed and can only ever
 *     resolve; a failure is logged and swallowed. A form that moved stage has
 *     moved stage whether or not anyone could be told about it.
 *
 *  2. ONLY PEOPLE WHO CAN ACT. Recipients mirror the stage resolver, so the set
 *     is exactly the set `membershipSatisfiesFormStage` would authorize — never
 *     the wider group who can merely watch. Maker-checker is applied the same
 *     way `listSubmissionsAwaitingViewer` applies it: at a stage whose actions
 *     are all decisions, the person who raised the form and the person it
 *     concerns are excluded, because they would be refused if they acted.
 *
 *  3. NOTHING SENSITIVE TRAVELS. A notification carries the form's title, the
 *     stage name and the subject's name. Never an answer value, never
 *     `assistanceNotes` (which may carry medical or accessibility detail), and
 *     never an internal identifier.
 *
 *  4. AN UNRESOLVABLE RECIPIENT IS NORMAL, NOT AN ERROR. An employee with no
 *     account that can sign in — never linked, or linked to a membership since
 *     revoked, suspended or expired — has no user to notify. That is the
 *     documented assisted-form case, not a fault: nothing is created, nothing
 *     throws, and the form waits safely (the UI explains why).
 */
import { and, eq, gte } from "drizzle-orm";
import {
  db,
  notificationsTable,
  organizationMembershipsTable,
  employeesTable,
  type FormSubmission,
  type FormWorkflowStage,
} from "@workspace/db";
import { logger } from "../logger";
import { notifyUser, resolveRecipients, type RecipientSpec } from "../notifications";
import { getCurrentDepartmentHead } from "../departmentHeads";

/** Everything the engine records against belongs to one submission. */
const SOURCE_REFERENCE_TYPE = "form_submission";

export type FormNotificationKind =
  | "stage_entered"
  | "returned"
  | "approved"
  | "rejected"
  | "finalized";

/**
 * The recipient specification a stage resolves to. This is the notification
 * mirror of `membershipSatisfiesFormStage` and must stay in step with it: if a
 * resolver kind is added there and not here, the stage simply notifies nobody
 * (fail quiet), which is the safe direction.
 */
async function recipientForStage(
  organizationId: number,
  stage: FormWorkflowStage,
  subjectEmployeeId: number,
): Promise<RecipientSpec | null> {
  const config = (stage.resolverConfig ?? {}) as Record<string, unknown>;
  switch (stage.resolver) {
    case "subject_employee":
      return { kind: "employee", employeeId: subjectEmployeeId };
    case "permission_holder":
      return typeof config.permissionKey === "string" ? { kind: "permission_holders", permissionKey: config.permissionKey } : null;
    case "specific_membership":
      return typeof config.membershipId === "number" ? { kind: "membership", membershipId: config.membershipId } : null;
    case "reporting_manager":
      return { kind: "manager_of_employee", employeeId: subjectEmployeeId };
    case "department_head": {
      const [subject] = await db
        .select({ departmentId: employeesTable.departmentId })
        .from(employeesTable)
        .where(and(eq(employeesTable.id, subjectEmployeeId), eq(employeesTable.organizationId, organizationId)))
        .limit(1);
      if (!subject?.departmentId) return null;
      const head = await getCurrentDepartmentHead(organizationId, subject.departmentId);
      return head?.headMembershipId != null ? { kind: "membership", membershipId: head.headMembershipId } : null;
    }
    default:
      return null;
  }
}

/** The user ids that maker-checker would refuse at a decision-only stage. */
async function makerUserIds(organizationId: number, submission: FormSubmission): Promise<Set<number>> {
  const ids = new Set<number>();
  const [creator] = await db
    .select({ userId: organizationMembershipsTable.applicationUserId })
    .from(organizationMembershipsTable)
    .where(eq(organizationMembershipsTable.id, submission.createdByMembershipId))
    .limit(1);
  if (creator?.userId != null) ids.add(creator.userId);
  try {
    for (const r of await resolveRecipients({ kind: "employee", employeeId: submission.subjectEmployeeId }, organizationId)) {
      ids.add(r.userId);
    }
  } catch {
    // The subject has no linked account. Nothing to exclude.
  }
  return ids;
}

/**
 * How recently an identical message must have been created for a second one to
 * count as a duplicate rather than a new event.
 *
 * The guard is deliberately NARROW. A workflow transition cannot commit twice —
 * every state change is a conditional UPDATE that throws when it matches
 * nothing — so the only duplicate this can legitimately prevent is one request
 * firing the notifier twice. A wider rule (for instance "suppress while an
 * identical notification is unread") would also swallow a genuine later event:
 * a form returned, corrected and sent back to the same stage produces the same
 * sentence, and the earlier notification may well still be unread. Being told
 * twice is a far smaller harm than not being told at all.
 */
export const DUPLICATE_WINDOW_MS = 60_000;

/** True when this exact message was created for this recipient moments ago. */
async function justSent(userId: number, submissionId: number, title: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.sourceReferenceType, SOURCE_REFERENCE_TYPE),
        eq(notificationsTable.sourceReferenceId, submissionId),
        eq(notificationsTable.title, title),
        gte(notificationsTable.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS)),
      ),
    )
    .limit(1);
  return existing != null;
}

interface Message {
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "alert";
}

function messageFor(kind: FormNotificationKind, ctx: { templateTitle: string; subjectName: string; stageName: string | null }): Message {
  switch (kind) {
    case "stage_entered":
      return {
        title: "A form needs your attention",
        message: `${ctx.templateTitle} for ${ctx.subjectName} is waiting at "${ctx.stageName ?? "the next step"}".`,
        type: "info",
      };
    case "returned":
      return {
        title: "A form was returned to you",
        message: `${ctx.templateTitle} for ${ctx.subjectName} was returned for correction. Review the notes on the form, make the changes and send it back.`,
        type: "warning",
      };
    case "approved":
      return { title: "Your form was approved", message: `${ctx.templateTitle} for ${ctx.subjectName} has been approved.`, type: "success" };
    case "rejected":
      return { title: "Your form was not approved", message: `${ctx.templateTitle} for ${ctx.subjectName} was rejected. Open the form to read the reason recorded with it.`, type: "warning" };
    case "finalized":
      return { title: "Your form is complete", message: `${ctx.templateTitle} for ${ctx.subjectName} is complete and has been filed to the employee record.`, type: "success" };
  }
}

async function deliver(params: {
  organizationId: number;
  submissionId: number;
  recipient: RecipientSpec;
  exclude: ReadonlySet<number>;
  message: Message;
}): Promise<number> {
  let resolved;
  try {
    resolved = await resolveRecipients(params.recipient, params.organizationId);
  } catch {
    // RecipientNotAuthorizedError / RecipientNotFoundError: nobody to tell.
    return 0;
  }
  let sent = 0;
  for (const { userId } of resolved) {
    if (params.exclude.has(userId)) continue;
    if (await justSent(userId, params.submissionId, params.message.title)) continue;
    await notifyUser({
      recipient: { kind: "user", userId },
      organizationId: params.organizationId,
      title: params.message.title,
      message: params.message.message,
      type: params.message.type,
      sourceReferenceType: SOURCE_REFERENCE_TYPE,
      sourceReferenceId: params.submissionId,
      actionPath: `/forms/${params.submissionId}`,
    });
    sent += 1;
  }
  return sent;
}

/**
 * Notify whoever can now act, or whom the outcome concerns.
 *
 * NEVER THROWS. Call it after the workflow transaction has committed.
 * Returns the number of notifications created, which is 0 whenever there is
 * nobody to tell — an unlinked employee being the ordinary case.
 */
export async function notifyFormTransition(params: {
  organizationId: number;
  submission: FormSubmission;
  templateTitle: string;
  subjectName: string;
  stages: readonly FormWorkflowStage[];
  kind: FormNotificationKind;
}): Promise<number> {
  try {
    const { organizationId, submission, kind } = params;
    const stage = params.stages.find((s) => s.stageOrder === submission.currentStageOrder) ?? null;
    const message = messageFor(kind, {
      templateTitle: params.templateTitle,
      subjectName: params.subjectName,
      stageName: stage?.name ?? null,
    });

    if (kind === "stage_entered") {
      if (!stage) return 0;
      const recipient = await recipientForStage(organizationId, stage, submission.subjectEmployeeId);
      if (!recipient) return 0;
      // A stage that offers `complete` is one the maker may legitimately take
      // (the subject confirming their own form). A decision-only stage is not.
      const decisionOnly = !(stage.allowedActions as string[]).includes("complete");
      const exclude = decisionOnly ? await makerUserIds(organizationId, submission) : new Set<number>();
      return await deliver({ organizationId, submissionId: submission.id, recipient, exclude, message });
    }

    // Outcome and return notifications always concern the subject employee.
    return await deliver({
      organizationId,
      submissionId: submission.id,
      recipient: { kind: "employee", employeeId: submission.subjectEmployeeId },
      exclude: new Set<number>(),
      message,
    });
  } catch (err) {
    logger.warn(
      { err, submissionId: params.submission.id, kind: params.kind },
      "form notification could not be delivered; the workflow transition is unaffected",
    );
    return 0;
  }
}
