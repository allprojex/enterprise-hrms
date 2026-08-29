import { and, eq } from "drizzle-orm";
import {
  db,
  exitInterviewsTable,
  employeeExitProcessesTable,
  type ExitInterview,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-12 — Exit interviews (§28.15).
 *
 * NO QUESTIONNAIRE ENGINE LIVES HERE. The questions and answers are WS-8 Custom
 * Fields bound to the `exit_interview` scope with this row's id as the entity
 * (§28.19 forbids a second engine, and WS-8 already has versioning, typing and
 * validation). This module owns only what a form cannot: when the interview
 * happened, who ran it, and the confidential HR note that is not an answer.
 *
 * NO REHIRE ELIGIBILITY. §28.15 withholds it, and no `rehireEligible`,
 * `doNotRehire`, `rehireStatus`, `rehireRecommendation` or equivalent inferred
 * flag exists in this module, in the schema, or anywhere else in WS-12.
 */

export class ExitInterviewNotFoundError extends Error {
  constructor() {
    super("Exit interview not found");
    this.name = "ExitInterviewNotFoundError";
  }
}

export class ExitInterviewAlreadyExistsError extends Error {
  constructor() {
    super("An exit interview already exists for this offboarding");
    this.name = "ExitInterviewAlreadyExistsError";
  }
}

export class InvalidExitInterviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExitInterviewError";
  }
}

export async function getByExitProcess(
  organizationId: number,
  exitProcessId: number,
): Promise<ExitInterview | undefined> {
  const [row] = await db
    .select()
    .from(exitInterviewsTable)
    .where(
      and(
        eq(exitInterviewsTable.organizationId, organizationId),
        eq(exitInterviewsTable.exitProcessId, exitProcessId),
      ),
    )
    .limit(1);
  return row;
}

export async function getById(organizationId: number, interviewId: number): Promise<ExitInterview | undefined> {
  const [row] = await db
    .select()
    .from(exitInterviewsTable)
    .where(and(eq(exitInterviewsTable.id, interviewId), eq(exitInterviewsTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function scheduleInterview(params: {
  organizationId: number;
  exitProcessId: number;
  interviewDate?: Date | null;
  interviewerMembershipId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ExitInterview> {
  // The offboarding must be this organization's own — the interview inherits its
  // separation cycle, so a cross-tenant id here would misfile the answers.
  const [process] = await db
    .select({ id: employeeExitProcessesTable.id })
    .from(employeeExitProcessesTable)
    .where(
      and(
        eq(employeeExitProcessesTable.id, params.exitProcessId),
        eq(employeeExitProcessesTable.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!process) throw new InvalidExitInterviewError("Offboarding not found in this organization.");

  const existing = await getByExitProcess(params.organizationId, params.exitProcessId);
  if (existing) throw new ExitInterviewAlreadyExistsError();

  const [created] = await db
    .insert(exitInterviewsTable)
    .values({
      organizationId: params.organizationId,
      exitProcessId: params.exitProcessId,
      status: "scheduled",
      interviewDate: params.interviewDate ?? null,
      interviewerMembershipId: params.interviewerMembershipId ?? null,
      createdBy: params.actorApplicationUserId,
    })
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "exit_interview.scheduled",
    targetType: "exit_interview",
    targetId: String(created!.id),
    afterState: { exitProcessId: created!.exitProcessId, interviewDate: created!.interviewDate },
  });

  return created!;
}

export async function completeInterview(params: {
  organizationId: number;
  interviewId: number;
  interviewDate?: Date | null;
  reasonForLeavingCode?: string | null;
  confidentialNotes?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ExitInterview> {
  const before = await getById(params.organizationId, params.interviewId);
  if (!before) throw new ExitInterviewNotFoundError();
  if (before.status === "cancelled") throw new InvalidExitInterviewError("This interview was cancelled.");

  const [updated] = await db
    .update(exitInterviewsTable)
    .set({
      status: "completed",
      interviewDate: params.interviewDate ?? before.interviewDate ?? new Date(),
      reasonForLeavingCode: params.reasonForLeavingCode ?? before.reasonForLeavingCode,
      confidentialNotes: params.confidentialNotes ?? before.confidentialNotes,
    })
    .where(
      and(
        eq(exitInterviewsTable.id, params.interviewId),
        eq(exitInterviewsTable.organizationId, params.organizationId),
      ),
    )
    .returning();

  // The legacy boolean on the exit process is kept truthful, written FROM the
  // interview's own state rather than accepted from a client.
  await db
    .update(employeeExitProcessesTable)
    .set({ exitInterviewCompleted: true })
    .where(
      and(
        eq(employeeExitProcessesTable.id, before.exitProcessId),
        eq(employeeExitProcessesTable.organizationId, params.organizationId),
      ),
    );

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "exit_interview.completed",
    targetType: "exit_interview",
    targetId: String(params.interviewId),
    beforeState: { status: before.status },
    // Deliberately NOT copying `confidentialNotes` into the audit trail: audit
    // events have different read rules from the interview itself, so mirroring
    // the note there would widen who can read it.
    afterState: { status: updated!.status, interviewDate: updated!.interviewDate },
  });

  return updated!;
}

export async function cancelInterview(params: {
  organizationId: number;
  interviewId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<ExitInterview> {
  const before = await getById(params.organizationId, params.interviewId);
  if (!before) throw new ExitInterviewNotFoundError();
  if (before.status === "completed") throw new InvalidExitInterviewError("A completed interview cannot be cancelled.");
  if (!params.reason.trim()) throw new InvalidExitInterviewError("A reason is required to cancel an interview.");

  const [updated] = await db
    .update(exitInterviewsTable)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(exitInterviewsTable.id, params.interviewId),
        eq(exitInterviewsTable.organizationId, params.organizationId),
      ),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "exit_interview.cancelled",
    targetType: "exit_interview",
    targetId: String(params.interviewId),
    beforeState: { status: before.status },
    afterState: { status: updated!.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated!;
}
