import { and, eq, desc, isNotNull, inArray } from "drizzle-orm";
import { db, employmentTermsTable, employeesTable, type EmploymentTerm } from "@workspace/db";
import { recordEmploymentPeriodEvent } from "../employmentLifecycleService";
import { isUniqueViolation } from "../dbErrors";

/**
 * WS-11 — employment terms (contract terms)
 * (see §27.5–27.7, OD #8).
 *
 * THE RULE THIS FILE MOST EXISTS TO HOLD (§27.6): an expiry date passing does
 * NOT terminate anyone. Nothing in this file calls `separateEmployee`, and
 * nothing may be added that does. An employee whose term ended yesterday is
 * still employed today; renewal, extension, administrative delay or a statutory
 * requirement may all intervene, and the system cannot know which. Expiry is
 * information for a human, not an instruction to the machine.
 */

export class EmploymentTermNotFoundError extends Error {
  constructor() {
    super("Employment term not found.");
    this.name = "EmploymentTermNotFoundError";
  }
}
export class EmployeeNotFoundForTermError extends Error {
  constructor() {
    super("Employee not found in this organization.");
    this.name = "EmployeeNotFoundForTermError";
  }
}
export class InvalidEmploymentTermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmploymentTermError";
  }
}
export class ActiveTermAlreadyExistsError extends Error {
  constructor(readonly existingTermId: number) {
    super("This employee already has an active employment term. Renew or close it instead.");
    this.name = "ActiveTermAlreadyExistsError";
  }
}
export class TermNotActiveError extends Error {
  constructor() {
    super("Only an active employment term can be renewed or closed.");
    this.name = "TermNotActiveError";
  }
}

/** Expiry state is DERIVED, never stored (§27.6). */
export type TermExpiryState = "not_applicable" | "current" | "expiring_soon" | "expired";

async function assertEmployeeInOrganization(organizationId: number, employeeId: number): Promise<void> {
  const [employee] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!employee) throw new EmployeeNotFoundForTermError();
}

function validateTermDates(termType: EmploymentTerm["termType"], startDate: Date, endDate: Date | null): void {
  if (termType === "fixed_term" && !endDate) {
    throw new InvalidEmploymentTermError("A fixed-term contract needs an end date.");
  }
  if (termType === "permanent" && endDate) {
    throw new InvalidEmploymentTermError("A permanent term cannot have an end date.");
  }
  if (endDate && endDate.getTime() <= startDate.getTime()) {
    throw new InvalidEmploymentTermError("The end date must be after the start date.");
  }
}

/**
 * Derives expiry state from the term's own dates and a caller-supplied instant.
 *
 * `asOf` is explicit rather than reading the clock internally so tests are
 * deterministic and so a report can ask "what expired as at month end?" without
 * the answer depending on when the query ran.
 */
export function deriveExpiryState(term: EmploymentTerm, warningDays: number, asOf: Date = new Date()): TermExpiryState {
  if (term.termType === "permanent" || !term.endDate) return "not_applicable";
  const end = term.endDate.getTime();
  const now = asOf.getTime();
  if (end < now) return "expired";
  if (end - now <= warningDays * 24 * 60 * 60 * 1000) return "expiring_soon";
  return "current";
}

export async function listTerms(organizationId: number, employeeId: number): Promise<EmploymentTerm[]> {
  return db
    .select()
    .from(employmentTermsTable)
    .where(and(eq(employmentTermsTable.organizationId, organizationId), eq(employmentTermsTable.employeeId, employeeId)))
    .orderBy(desc(employmentTermsTable.startDate), desc(employmentTermsTable.id));
}

export async function getActiveTerm(organizationId: number, employeeId: number): Promise<EmploymentTerm | null> {
  const [row] = await db
    .select()
    .from(employmentTermsTable)
    .where(
      and(
        eq(employmentTermsTable.organizationId, organizationId),
        eq(employmentTermsTable.employeeId, employeeId),
        eq(employmentTermsTable.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getTerm(organizationId: number, termId: number): Promise<EmploymentTerm | null> {
  const [row] = await db
    .select()
    .from(employmentTermsTable)
    .where(and(eq(employmentTermsTable.id, termId), eq(employmentTermsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function createTerm(params: {
  organizationId: number;
  employeeId: number;
  termType: EmploymentTerm["termType"];
  startDate: Date;
  endDate?: Date | null;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmploymentTerm> {
  await assertEmployeeInOrganization(params.organizationId, params.employeeId);
  validateTermDates(params.termType, params.startDate, params.endDate ?? null);

  try {
    const [created] = await db
      .insert(employmentTermsTable)
      .values({
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        termType: params.termType,
        startDate: params.startDate,
        endDate: params.endDate ?? null,
        status: "active",
        reason: params.reason ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();
    return created;
  } catch (err) {
    // The partial unique index is the real guard against two concurrent
    // creations, not the read above.
    if (isUniqueViolation(err)) {
      const existing = await getActiveTerm(params.organizationId, params.employeeId);
      throw new ActiveTermAlreadyExistsError(existing?.id ?? 0);
    }
    throw err;
  }
}

/**
 * Renews a term: the prior term becomes `superseded` and a NEW term is created
 * pointing back at it, inside one transaction.
 *
 * The prior term's dates, type and reason are never touched (§27.7) — a
 * renewal chain must stay readable end to end. This is also why renewal is a
 * new row rather than an edit: the old term genuinely ended.
 */
export async function renewTerm(params: {
  organizationId: number;
  termId: number;
  termType: EmploymentTerm["termType"];
  startDate: Date;
  endDate?: Date | null;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<{ previous: EmploymentTerm; renewed: EmploymentTerm }> {
  const previous = await getTerm(params.organizationId, params.termId);
  if (!previous) throw new EmploymentTermNotFoundError();
  if (previous.status !== "active") throw new TermNotActiveError();
  validateTermDates(params.termType, params.startDate, params.endDate ?? null);

  const result = await db.transaction(async (tx) => {
    // Conditional on status so a concurrent renewal loses the race cleanly
    // rather than producing two live terms.
    const [superseded] = await tx
      .update(employmentTermsTable)
      .set({ status: "superseded" })
      .where(and(eq(employmentTermsTable.id, params.termId), eq(employmentTermsTable.status, "active")))
      .returning();
    if (!superseded) throw new TermNotActiveError();

    const [renewed] = await tx
      .insert(employmentTermsTable)
      .values({
        organizationId: params.organizationId,
        employeeId: previous.employeeId,
        termType: params.termType,
        startDate: params.startDate,
        endDate: params.endDate ?? null,
        status: "active",
        renewedFromTermId: previous.id,
        reason: params.reason ?? null,
        createdBy: params.actorApplicationUserId,
      })
      .returning();
    return { previous: superseded, renewed };
  });

  await recordEmploymentPeriodEvent({
    organizationId: params.organizationId,
    employeeId: previous.employeeId,
    eventType: "contract_renewal",
    effectiveDate: params.startDate,
    previousState: {
      employmentTermId: previous.id,
      termType: previous.termType,
      startDate: previous.startDate,
      endDate: previous.endDate,
    },
    newState: {
      employmentTermId: result.renewed.id,
      termType: result.renewed.termType,
      startDate: result.renewed.startDate,
      endDate: result.renewed.endDate,
      renewedFromTermId: previous.id,
    },
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
  });

  return result;
}

/**
 * Closes a term without renewing it.
 *
 * Note what this deliberately does NOT do: it does not separate the employee,
 * change `employmentStatus`, or touch any other module. Closing a contract term
 * records that the term ended — the employment decision is separate and
 * authoritative elsewhere (§27.6).
 */
export async function closeTerm(params: {
  organizationId: number;
  termId: number;
  reason?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<EmploymentTerm> {
  const existing = await getTerm(params.organizationId, params.termId);
  if (!existing) throw new EmploymentTermNotFoundError();
  if (existing.status !== "active") throw new TermNotActiveError();

  const [closed] = await db
    .update(employmentTermsTable)
    .set({
      status: "closed",
      closedAt: new Date(),
      closedBy: params.actorApplicationUserId,
      reason: params.reason ?? existing.reason,
    })
    .where(and(eq(employmentTermsTable.id, params.termId), eq(employmentTermsTable.status, "active")))
    .returning();
  if (!closed) throw new TermNotActiveError();
  return closed;
}

/**
 * Finds active fixed-term contracts at or past their end date, or approaching
 * it, for the HR action queue and the reminder sweep.
 *
 * This is a READ. It exists precisely so that expiry can be surfaced to a human
 * without anything being mutated (§27.6, §27.11).
 */
export async function findExpiringTerms(
  organizationId: number,
  warningDays: number,
  asOf: Date = new Date(),
): Promise<{ term: EmploymentTerm; state: TermExpiryState }[]> {
  const rows = await db
    .select()
    .from(employmentTermsTable)
    .where(
      and(
        eq(employmentTermsTable.organizationId, organizationId),
        eq(employmentTermsTable.status, "active"),
        isNotNull(employmentTermsTable.endDate),
      ),
    );

  return rows
    .map((term) => ({ term, state: deriveExpiryState(term, warningDays, asOf) }))
    .filter((row) => row.state === "expiring_soon" || row.state === "expired");
}

/** Batch lookup for list surfaces — avoids an N+1 across an employee list. */
export async function getActiveTermsForEmployees(
  organizationId: number,
  employeeIds: number[],
): Promise<Map<number, EmploymentTerm>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(employmentTermsTable)
    .where(
      and(
        eq(employmentTermsTable.organizationId, organizationId),
        eq(employmentTermsTable.status, "active"),
        inArray(employmentTermsTable.employeeId, employeeIds),
      ),
    );
  return new Map(rows.map((row) => [row.employeeId, row]));
}
