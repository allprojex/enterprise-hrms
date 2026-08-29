import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  employeeExitProcessesTable,
  employeesTable,
  employmentTermsTable,
  clearanceItemsTable,
  clearanceTemplatesTable,
  clearanceTemplateItemsTable,
  type EmployeeExitProcess,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";

/**
 * WS-12 — Offboarding (§28.6, §28.7, §28.8).
 *
 * THE ONE RULE THIS FILE EXISTS TO HOLD: offboarding never terminates anybody.
 * Not on initiation, not on final clearance, not ever. §28.7 freezes it, and it
 * is the same boundary §27.6 drew for contract expiry and §27.8 for unsuccessful
 * probation — a checklist reaching 100% is not a legal act. Completing every
 * item produces a READY state and stops. `separateEmployee` is not imported
 * here, and a test asserts the employee is untouched after final clearance.
 *
 * THE SECOND RULE: an offboarding case can never be its own separation basis.
 * §28.6 permits starting before separation, but only against an AUTHORITATIVE
 * record, and `resolveSeparationBasis` below is the only way in. A client cannot
 * assert a basis; it is discovered from the employee's own state and from WS-11's
 * employment terms. That is what stops "we opened an offboarding" from becoming
 * evidence that somebody is leaving.
 */

export class OffboardingNotFoundError extends Error {
  constructor() {
    super("Offboarding not found");
    this.name = "OffboardingNotFoundError";
  }
}

export class NoSeparationBasisError extends Error {
  constructor() {
    super(
      "This employee has no authoritative separation basis. Offboarding may begin only for someone already separated, " +
        "or holding an active fixed-term contract with an end date. Record the separation or the contract term first.",
    );
    this.name = "NoSeparationBasisError";
  }
}

export class OffboardingAlreadyOpenError extends Error {
  constructor() {
    super("An offboarding is already running for this employee.");
    this.name = "OffboardingAlreadyOpenError";
  }
}

export class OffboardingNotActionableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffboardingNotActionableError";
  }
}

export class RequiredClearanceOutstandingError extends Error {
  constructor(public readonly outstanding: number) {
    super(`${outstanding} required clearance item(s) are still outstanding.`);
    this.name = "RequiredClearanceOutstandingError";
  }
}

export interface SeparationBasis {
  basis: NonNullable<EmployeeExitProcess["separationBasis"]>;
  expectedSeparationDate: Date;
  /** What the basis was read from, so a caller can explain the decision. */
  evidence: string;
}

/**
 * Discovers whether an authoritative separation basis exists (§28.6).
 *
 * ONLY TWO BASES ARE RECOGNIZED, and the shortness of that list is a repository
 * finding rather than an omission — see the `exit_separation_basis` enum header.
 * Accepted resignation, retirement and approved termination have no authoritative
 * record anywhere in this platform: `employees` carries only `employmentStatus`,
 * `separationDate` and a free-text `separationReason`, all describing a
 * separation that has ALREADY happened. Minting a record here to stand for
 * "resignation accepted" would be the parallel separation record WS-12 is
 * forbidden to invent, and would let an offboarding case authorize itself.
 *
 * Returns null rather than throwing, so callers can offer a useful explanation.
 */
export async function resolveSeparationBasis(
  organizationId: number,
  employeeId: number,
): Promise<SeparationBasis | null> {
  const [employee] = await db
    .select({
      id: employeesTable.id,
      employmentStatus: employeesTable.employmentStatus,
      separationDate: employeesTable.separationDate,
    })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!employee) return null;

  // Basis 1 — already separated. The shipped precondition, preserved exactly.
  if (employee.employmentStatus === "terminated" && employee.separationDate) {
    return {
      basis: "already_separated",
      expectedSeparationDate: employee.separationDate,
      evidence: "The employee is recorded as terminated with a separation date.",
    };
  }

  // Basis 2 — a confirmed contract end, read from WS-11's authoritative term.
  // Note what this does NOT do: it does not create, alter or close the term, and
  // an end date in the past still separates nobody (§27.6).
  const [term] = await db
    .select({ id: employmentTermsTable.id, endDate: employmentTermsTable.endDate })
    .from(employmentTermsTable)
    .where(
      and(
        eq(employmentTermsTable.organizationId, organizationId),
        eq(employmentTermsTable.employeeId, employeeId),
        eq(employmentTermsTable.status, "active"),
      ),
    )
    .limit(1);
  if (term?.endDate) {
    return {
      basis: "contract_end",
      expectedSeparationDate: term.endDate,
      evidence: `Active fixed-term employment term #${term.id} ends on ${term.endDate.toISOString().slice(0, 10)}.`,
    };
  }

  return null;
}

const RUNNING_STATUSES: ReadonlyArray<EmployeeExitProcess["status"]> = [
  "initiated",
  "clearance_in_progress",
  "ready_for_separation",
];

export async function listOffboarding(
  organizationId: number,
  filters: { employeeId?: number; status?: EmployeeExitProcess["status"] } = {},
): Promise<EmployeeExitProcess[]> {
  const predicates = [eq(employeeExitProcessesTable.organizationId, organizationId)];
  if (filters.employeeId != null) predicates.push(eq(employeeExitProcessesTable.employeeId, filters.employeeId));
  if (filters.status) predicates.push(eq(employeeExitProcessesTable.status, filters.status));

  return db
    .select()
    .from(employeeExitProcessesTable)
    .where(and(...predicates))
    .orderBy(desc(employeeExitProcessesTable.createdAt));
}

export async function getOffboarding(
  organizationId: number,
  exitProcessId: number,
): Promise<EmployeeExitProcess | undefined> {
  const [row] = await db
    .select()
    .from(employeeExitProcessesTable)
    .where(
      and(
        eq(employeeExitProcessesTable.id, exitProcessId),
        eq(employeeExitProcessesTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Starts an offboarding and snapshots its clearance items from a template.
 *
 * The snapshot is the point (§28.8): items are COPIED, so revising the template
 * tomorrow cannot rewrite what this person is already discharging today. That is
 * the WS-10 precedent, and `sourceTemplateItemId` is kept purely as provenance.
 */
export async function initiateOffboarding(params: {
  organizationId: number;
  employeeId: number;
  clearanceTemplateId?: number | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ exitProcess: EmployeeExitProcess; itemsCreated: number; basis: SeparationBasis }> {
  const basis = await resolveSeparationBasis(params.organizationId, params.employeeId);
  if (!basis) throw new NoSeparationBasisError();

  // A template supplied by the client is proved to be this organization's own
  // and actually usable before anything is copied out of it.
  let template: { id: number } | undefined;
  if (params.clearanceTemplateId != null) {
    const [found] = await db
      .select({ id: clearanceTemplatesTable.id, status: clearanceTemplatesTable.status })
      .from(clearanceTemplatesTable)
      .where(
        and(
          eq(clearanceTemplatesTable.id, params.clearanceTemplateId),
          eq(clearanceTemplatesTable.organizationId, params.organizationId),
        ),
      )
      .limit(1);
    if (!found) throw new OffboardingNotActionableError("Clearance template not found in this organization.");
    if (found.status !== "active") {
      throw new OffboardingNotActionableError("Only an active clearance template can be used.");
    }
    template = { id: found.id };
  } else {
    const [fallback] = await db
      .select({ id: clearanceTemplatesTable.id })
      .from(clearanceTemplatesTable)
      .where(
        and(
          eq(clearanceTemplatesTable.organizationId, params.organizationId),
          eq(clearanceTemplatesTable.isDefault, true),
          eq(clearanceTemplatesTable.status, "active"),
        ),
      )
      .limit(1);
    template = fallback;
  }

  return db.transaction(async (tx) => {
    // The partial unique index is the real guarantee against a concurrent double
    // initiation; this check exists to return a clear error rather than a raw
    // constraint violation in the ordinary case.
    const existing = await tx
      .select({ id: employeeExitProcessesTable.id, status: employeeExitProcessesTable.status })
      .from(employeeExitProcessesTable)
      .where(
        and(
          eq(employeeExitProcessesTable.organizationId, params.organizationId),
          eq(employeeExitProcessesTable.employeeId, params.employeeId),
        ),
      );
    if (existing.some((row) => RUNNING_STATUSES.includes(row.status))) throw new OffboardingAlreadyOpenError();

    const [created] = await tx
      .insert(employeeExitProcessesTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        // Null unless the person has ALREADY gone. An expectation is not a fact.
        separationDate: basis.basis === "already_separated" ? basis.expectedSeparationDate : null,
        status: "initiated",
        separationBasis: basis.basis,
        separationBasisRecordedAt: new Date(),
        expectedSeparationDate: basis.expectedSeparationDate,
        clearanceTemplateId: template?.id ?? null,
        initiatedBy: params.actorApplicationUserId,
      })
      .returning();

    let itemsCreated = 0;
    if (template) {
      const templateItems = await tx
        .select()
        .from(clearanceTemplateItemsTable)
        .where(
          and(
            eq(clearanceTemplateItemsTable.organizationId, params.organizationId),
            eq(clearanceTemplateItemsTable.templateId, template.id),
          ),
        )
        .orderBy(clearanceTemplateItemsTable.sequence, clearanceTemplateItemsTable.id);

      if (templateItems.length > 0) {
        await tx.insert(clearanceItemsTable).values(
          templateItems.map((item) => ({
            organizationId: params.organizationId,
            exitProcessId: created!.id,
            sourceTemplateItemId: item.id,
            sequence: item.sequence,
            // Copied, not referenced — see this function's header.
            label: item.label,
            description: item.description,
            itemType: item.itemType,
            required: item.required,
            responsibleDepartmentId: item.responsibleDepartmentId,
            status: "pending" as const,
          })),
        );
        itemsCreated = templateItems.length;
      }
    }

    await recordAuditEvent({
      actorApplicationUserId: params.actorApplicationUserId,
      actorMembershipId: params.actorMembershipId,
      organizationId: params.organizationId,
      eventType: "employee_exit_process.initiated",
      targetType: "employee_exit_process",
      targetId: String(created!.id),
      afterState: {
        employeeId: created!.employeeId,
        status: created!.status,
        separationBasis: created!.separationBasis,
        expectedSeparationDate: created!.expectedSeparationDate,
      },
      metadata: { clearanceTemplateId: template?.id ?? null, itemsCreated, basisEvidence: basis.evidence },
    });

    return { exitProcess: created!, itemsCreated, basis };
  });
}

export interface ClearanceProgress {
  total: number;
  required: number;
  completed: number;
  waived: number;
  pending: number;
  returned: number;
  requiredOutstanding: number;
  /** Derived, never stored — the same treatment §26 gave onboarding completion. */
  clearanceComplete: boolean;
}

/**
 * Derives clearance progress from the items themselves.
 *
 * A waived REQUIRED item counts as discharged: the waiver is the organization's
 * audited decision that it could not be satisfied, and refusing to let it close
 * the file would make the escape hatch useless (§28.8).
 */
export async function computeClearanceProgress(
  organizationId: number,
  exitProcessId: number,
): Promise<ClearanceProgress> {
  const items = await db
    .select({
      required: clearanceItemsTable.required,
      status: clearanceItemsTable.status,
    })
    .from(clearanceItemsTable)
    .where(
      and(
        eq(clearanceItemsTable.organizationId, organizationId),
        eq(clearanceItemsTable.exitProcessId, exitProcessId),
      ),
    );

  const progress: ClearanceProgress = {
    total: items.length,
    required: items.filter((i) => i.required).length,
    completed: items.filter((i) => i.status === "completed").length,
    waived: items.filter((i) => i.status === "waived").length,
    pending: items.filter((i) => i.status === "pending").length,
    returned: items.filter((i) => i.status === "returned").length,
    requiredOutstanding: items.filter((i) => i.required && i.status !== "completed" && i.status !== "waived").length,
    clearanceComplete: false,
  };
  // An offboarding with no items at all is not "complete" — it is unconfigured.
  progress.clearanceComplete = progress.total > 0 && progress.requiredOutstanding === 0;
  return progress;
}

/**
 * Reflects an actual separation onto a running offboarding, by READING WS-11's
 * authoritative employee state.
 *
 * This is the "actual employment separation" step of §28.6's sequence, and it is
 * strictly observational: it copies the separation instant that `separateEmployee`
 * already recorded. It never sets one, and never asks WS-11 to.
 */
export async function syncActualSeparation(params: {
  organizationId: number;
  exitProcessId: number;
}): Promise<EmployeeExitProcess | undefined> {
  const process = await getOffboarding(params.organizationId, params.exitProcessId);
  if (!process) throw new OffboardingNotFoundError();
  if (process.separationDate) return process;

  const [employee] = await db
    .select({ employmentStatus: employeesTable.employmentStatus, separationDate: employeesTable.separationDate })
    .from(employeesTable)
    .where(
      and(eq(employeesTable.id, process.employeeId), eq(employeesTable.organizationId, params.organizationId)),
    )
    .limit(1);
  if (!employee || employee.employmentStatus !== "terminated" || !employee.separationDate) return process;

  const [updated] = await db
    .update(employeeExitProcessesTable)
    .set({ separationDate: employee.separationDate })
    .where(
      and(
        eq(employeeExitProcessesTable.id, params.exitProcessId),
        eq(employeeExitProcessesTable.organizationId, params.organizationId),
        isNull(employeeExitProcessesTable.separationDate),
      ),
    )
    .returning();
  return updated ?? process;
}

/**
 * Final HR clearance — a distinct terminal act, not the arithmetic of the item
 * list (§28.8).
 *
 * It refuses while a required item is outstanding, and it changes NOBODY's
 * employment status. The result is `completed` clearance, not a terminated
 * person: §28.7 again.
 */
export async function grantFinalClearance(params: {
  organizationId: number;
  exitProcessId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ exitProcess: EmployeeExitProcess; progress: ClearanceProgress }> {
  const process = await getOffboarding(params.organizationId, params.exitProcessId);
  if (!process) throw new OffboardingNotFoundError();
  if (process.status === "completed") throw new OffboardingNotActionableError("Final clearance is already granted.");
  if (process.status === "cancelled") throw new OffboardingNotActionableError("This offboarding was cancelled.");
  if (process.status === "legacy") {
    throw new OffboardingNotActionableError(
      "This offboarding predates structured clearance and cannot be granted final clearance.",
    );
  }

  const progress = await computeClearanceProgress(params.organizationId, params.exitProcessId);
  if (progress.requiredOutstanding > 0) throw new RequiredClearanceOutstandingError(progress.requiredOutstanding);

  const now = new Date();
  const [updated] = await db
    .update(employeeExitProcessesTable)
    .set({
      status: "completed",
      finalClearedAt: now,
      finalClearedBy: params.actorApplicationUserId,
      // The legacy boolean is written here so a `legacy`-era reader still sees a
      // truthful value — but it is written FROM the derived result, never
      // accepted from a client (see updateEmployeeExitProcess's guard).
      clearanceCompleted: true,
    })
    .where(
      and(
        eq(employeeExitProcessesTable.id, params.exitProcessId),
        eq(employeeExitProcessesTable.organizationId, params.organizationId),
      ),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_exit_process.final_cleared",
    targetType: "employee_exit_process",
    targetId: String(params.exitProcessId),
    beforeState: { status: process.status },
    afterState: { status: updated!.status, finalClearedAt: updated!.finalClearedAt },
    metadata: { requiredItems: progress.required, waived: progress.waived },
  });

  return { exitProcess: updated!, progress };
}

export async function cancelOffboarding(params: {
  organizationId: number;
  exitProcessId: number;
  reason: string;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmployeeExitProcess> {
  const process = await getOffboarding(params.organizationId, params.exitProcessId);
  if (!process) throw new OffboardingNotFoundError();
  if (!RUNNING_STATUSES.includes(process.status)) {
    throw new OffboardingNotActionableError("Only a running offboarding can be cancelled.");
  }
  if (!params.reason.trim()) throw new OffboardingNotActionableError("A reason is required to cancel an offboarding.");

  const [updated] = await db
    .update(employeeExitProcessesTable)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(employeeExitProcessesTable.id, params.exitProcessId),
        eq(employeeExitProcessesTable.organizationId, params.organizationId),
      ),
    )
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "employee_exit_process.cancelled",
    targetType: "employee_exit_process",
    targetId: String(params.exitProcessId),
    beforeState: { status: process.status },
    afterState: { status: updated!.status },
    metadata: { reason: params.reason.trim() },
  });

  return updated!;
}
