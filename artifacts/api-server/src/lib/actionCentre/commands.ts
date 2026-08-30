import { and, eq } from "drizzle-orm";
import { db, onboardingTasksTable, onboardingInstancesTable } from "@workspace/db";
import { getModuleAccess } from "../organizationModules";
import { hasPermission } from "../permissions";
import { resolveOwnEmployeeId } from "../leaveRequests";
import { approveLeaveRequest, rejectLeaveRequest } from "../leaveApprovals";
import { decideEnrollmentApproval } from "../learningEnrollments";
import { resolveLearningActorEmployeeId, hasOrgWideLearningAccess } from "../learningAuthorization";
import { completeTask } from "../onboarding/instances";
import { isCurrentlyResponsible } from "../onboarding/responsibility";
import { ONBOARDING_MODULE_KEY } from "../onboarding/moduleKey";
import * as capability from "../skills/capability";
import { type InlineCommand } from "./types";

/**
 * WS-15 — the four inline commands §31.8 allows, and nothing else.
 *
 * EVERY HANDLER BELOW IS A CALL, NOT AN IMPLEMENTATION. No approval logic is
 * copied here, no source table is written directly, and no state transition is
 * decided by WS-15. Each handler resolves the same arguments the owning
 * module's own route resolves, then calls that module's existing service — so
 * the source transaction, its atomic state guard, its audit event, its
 * notifications and its maker-checker all happen exactly as if the action had
 * been taken in the source module (§31.8).
 *
 * IDEMPOTENCY IS THE SOURCE'S, NOT OURS (§31.23). `approveLeaveRequest` and
 * `decideEnrollmentApproval` both use a conditional `WHERE status = <expected>`
 * update; `completeTask` refuses a task that is not `pending`; `capability.verify`
 * refuses a record that is not open. A double click therefore fails on the
 * second attempt at the source, and WS-15 adds no persistence of its own to
 * re-solve a problem the sources already solved.
 *
 * AUTHORITY IS RE-CHECKED AT ACTION TIME, NOT AT RENDER TIME (§31.7, §31.8).
 * A row rendered a moment ago confers nothing. Each handler re-runs the same
 * gate its module's route runs — and the modules themselves re-resolve authority
 * a second time inside their services (Leave re-resolves the Department Head
 * live; Learning re-checks the manager-of-record; WS-14 refuses
 * self-verification), so there are two independent checks on every path.
 *
 * THE COMMAND VOCABULARY IS CLOSED. A caller names a command from
 * `INLINE_COMMANDS`; it can never name a module, a table or a method (§31.33).
 * There is no generic command bus.
 */

export class CommandNotAllowedError extends Error {
  constructor(message = "You are not authorized to take this action.") {
    super(message);
    this.name = "CommandNotAllowedError";
  }
}

export class CommandStateConflictError extends Error {
  constructor(message = "That item is no longer in a state where this action applies.") {
    super(message);
    this.name = "CommandStateConflictError";
  }
}

export class CommandTargetNotFoundError extends Error {
  constructor(message = "That item no longer exists.") {
    super(message);
    this.name = "CommandTargetNotFoundError";
  }
}

export interface CommandContext {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
  sourceId: number;
  /** Required by commands whose source needs one; validated per command. */
  reason?: string | null;
  notes?: string | null;
  levelId?: number | null;
  assessedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Leave (§31.8 #1)
// ---------------------------------------------------------------------------

async function leaveDecision(ctx: CommandContext, decision: "approve" | "reject"): Promise<unknown> {
  if (!(await getModuleAccess(ctx.organizationId, "leave")).enabled) throw new CommandNotAllowedError();
  if (!(await hasPermission(ctx.membershipId, "leave_request.approve"))) throw new CommandNotAllowedError();

  const { leaveRequestsTable } = await import("@workspace/db");
  const [request] = await db
    .select({ id: leaveRequestsTable.id, employeeId: leaveRequestsTable.employeeId })
    .from(leaveRequestsTable)
    .where(and(eq(leaveRequestsTable.id, ctx.sourceId), eq(leaveRequestsTable.organizationId, ctx.organizationId)))
    .limit(1);
  // A cross-tenant or unknown id is refused here, before any service is called.
  if (!request) throw new CommandTargetNotFoundError();

  const callerEmployeeId = await resolveOwnEmployeeId(ctx.organizationId, ctx.applicationUserId);
  const isHr = await hasPermission(ctx.membershipId, "leave_request.manage");
  const params = {
    organizationId: ctx.organizationId,
    employeeId: request.employeeId,
    leaveRequestId: request.id,
    callerEmployeeId,
    actorMembershipId: ctx.membershipId,
    actorApplicationUserId: ctx.applicationUserId,
    isHr,
  };

  // Leave re-resolves the current Department Head inside these services and
  // refuses self-approval on its own — WS-15 does not re-derive either.
  if (decision === "approve") return approveLeaveRequest(params);
  const reason = (ctx.reason ?? "").trim();
  if (!reason) throw new CommandNotAllowedError("A reason is required to reject a leave request.");
  return rejectLeaveRequest({ ...params, reason });
}

// ---------------------------------------------------------------------------
// Learning (§31.8 #2)
// ---------------------------------------------------------------------------

async function learningDecision(ctx: CommandContext, decision: "approved" | "rejected"): Promise<unknown> {
  if (!(await getModuleAccess(ctx.organizationId, "learning")).enabled) throw new CommandNotAllowedError();
  const allowed =
    (await hasPermission(ctx.membershipId, "learning.manage")) ||
    (await hasPermission(ctx.membershipId, "learning.review.write"));
  if (!allowed) throw new CommandNotAllowedError();

  const isOrgWide = await hasOrgWideLearningAccess(ctx.membershipId, "learning.manage");
  const callerEmployeeId = await resolveLearningActorEmployeeId(ctx.organizationId, ctx.applicationUserId);

  // The service scopes by organization and re-checks the manager-of-record
  // relationship itself; a foreign enrolment id fails there.
  return decideEnrollmentApproval({
    organizationId: ctx.organizationId,
    enrollmentId: ctx.sourceId,
    decision,
    callerEmployeeId,
    isOrgWide,
    actorApplicationUserId: ctx.applicationUserId,
    actorMembershipId: ctx.membershipId,
  });
}

// ---------------------------------------------------------------------------
// Onboarding (§31.8 #3)
// ---------------------------------------------------------------------------

async function onboardingComplete(ctx: CommandContext): Promise<unknown> {
  if (!(await getModuleAccess(ctx.organizationId, ONBOARDING_MODULE_KEY)).enabled) throw new CommandNotAllowedError();
  if (!(await hasPermission(ctx.membershipId, "onboarding.task.complete"))) throw new CommandNotAllowedError();

  const [row] = await db
    .select({ task: onboardingTasksTable, employeeId: onboardingInstancesTable.employeeId })
    .from(onboardingTasksTable)
    .innerJoin(onboardingInstancesTable, eq(onboardingInstancesTable.id, onboardingTasksTable.instanceId))
    .where(
      and(eq(onboardingTasksTable.id, ctx.sourceId), eq(onboardingTasksTable.organizationId, ctx.organizationId)),
    )
    .limit(1);
  if (!row) throw new CommandTargetNotFoundError();

  // WS-10's own resolver decides responsibility, re-evaluated now rather than
  // when the row was rendered. This is stricter than the shipped completion
  // route, which gates on the permission alone — stricter is safe, because
  // WS-15 must never offer an action the owning module would refuse.
  const responsible = await isCurrentlyResponsible(
    ctx.organizationId,
    row.employeeId,
    {
      resolver: row.task.responsibleResolver,
      permissionKey: row.task.responsiblePermissionKey,
      membershipId: row.task.responsibleMembershipId,
    },
    ctx.membershipId,
  );
  if (!responsible) throw new CommandNotAllowedError();

  return completeTask({
    organizationId: ctx.organizationId,
    taskId: row.task.id,
    notes: ctx.notes ?? null,
    actorApplicationUserId: ctx.applicationUserId,
    actorMembershipId: ctx.membershipId,
  });
}

// ---------------------------------------------------------------------------
// WS-14 skill verification (§31.8 #4)
// ---------------------------------------------------------------------------

async function skillDecision(ctx: CommandContext, decision: "verify" | "reject"): Promise<unknown> {
  if (!(await hasPermission(ctx.membershipId, "skill_verification.decide"))) throw new CommandNotAllowedError();

  // Organization-scoped read first: a foreign record id is refused before any
  // WS-14 service is reached.
  const record = await capability.getRecord(ctx.organizationId, ctx.sourceId);
  if (!record) throw new CommandTargetNotFoundError();

  // Step 4 of the inline-action sequence: re-check the SOURCE STATE before
  // invoking. WS-14 deliberately permits re-verification of an already-decided
  // record — a later verifier may confirm capability again — so its own service
  // carries no "already verified" guard the way Leave, Learning and Onboarding
  // do. That is correct for WS-14 and is not changed here. But it means a
  // repeated Action Centre request would append a second verification event,
  // which is exactly the duplicate business effect 31.23 forbids. Refusing a
  // record that is no longer actionable closes that without reimplementing any
  // of WS-14 own rules: this is a state check, not a decision.
  if (record.status !== "claimed" && record.status !== "assessed") {
    throw new CommandStateConflictError("That skill claim has already been decided.");
  }

  const assessedAt = ctx.assessedAt ?? new Date();
  if (decision === "verify") {
    // `capability.verify` refuses self-verification against the actor's own
    // employee link and requires a level for a proficiency skill — both stay
    // WS-14's rules, re-evaluated here rather than mirrored.
    return capability.verify({
      organizationId: ctx.organizationId,
      recordId: record.id,
      levelId: ctx.levelId ?? null,
      assessedAt,
      notes: ctx.notes ?? null,
      actorApplicationUserId: ctx.applicationUserId,
      actorMembershipId: ctx.membershipId,
    });
  }

  const reason = (ctx.reason ?? "").trim();
  if (!reason) throw new CommandNotAllowedError("A reason is required to reject a skill claim.");
  return capability.reject({
    organizationId: ctx.organizationId,
    recordId: record.id,
    reason,
    assessedAt,
    actorApplicationUserId: ctx.applicationUserId,
    actorMembershipId: ctx.membershipId,
  });
}

/**
 * Typed dispatch over the closed vocabulary.
 *
 * Explicit per-command handling rather than a generic bus: a client supplies a
 * command name from the frozen list and a source id, and can never reach an
 * arbitrary module, table or method (§31.33).
 */
export async function executeInlineCommand(command: InlineCommand, ctx: CommandContext): Promise<unknown> {
  switch (command) {
    case "leave.approve":
      return leaveDecision(ctx, "approve");
    case "leave.reject":
      return leaveDecision(ctx, "reject");
    case "learning.approve":
      return learningDecision(ctx, "approved");
    case "learning.reject":
      return learningDecision(ctx, "rejected");
    case "onboarding.complete":
      return onboardingComplete(ctx);
    case "skill.verify":
      return skillDecision(ctx, "verify");
    case "skill.reject":
      return skillDecision(ctx, "reject");
  }
}
