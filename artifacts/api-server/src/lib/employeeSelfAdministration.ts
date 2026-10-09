/**
 * Self-administration boundary — owner-approved governance policy
 * (2026-10-09, final governance hardening of the employee backend):
 *
 *   An HR officer or any other privileged user must not use administrative
 *   employee-management privileges to modify their OWN HR-controlled employee
 *   record. Self-service remains available through the governed data-change
 *   request workflow (WS-13), where a different authorized person decides.
 *
 * IDENTITY. "Own record" is resolved ONLY through the authoritative
 * employee ↔ user relationship (`employee_user_links`, joined to `employees`
 * and scoped to the organization the request is bound to). Names, emails and
 * staff numbers are never compared — they are data, not identity. A user
 * with no link in this organization has no own record here, so every
 * existing administrative capability is preserved for them.
 *
 * ROLE-INDEPENDENT. The rule keys on the acting USER, not on a role or a
 * membership: holding hr, org_admin, a custom HR role, several roles at once,
 * or a platform super_admin membership changes nothing. There is no caller-
 * supplied flag that disables it. The only paths that do not pass through
 * it are server-internal operations whose actor identity is not what makes
 * them legitimate (candidate conversion creates a record nobody is linked to
 * yet; the WS-13 apply step is itself maker-checker governed; imports and
 * migrations run under their own governance keys) — each documented at its
 * call site, none reachable with an `employeeId` chosen by the caller.
 *
 * SUPER ADMIN. A platform super_admin reaches these routes either through a
 * real membership (then they are an ordinary actor here and the rule applies
 * to their linked record like anyone else's) or under a break-glass grant.
 * Under a grant the organization is still bound (resolveOrganizationId), so
 * the rule applies there too; cross-tenant administration of OTHER people's
 * records is untouched.
 *
 * ENFORCEMENT. Two layers, same predicate:
 *   - `forbidSelfAdministration(...)` — route middleware on every category-A
 *     endpoint (the HR-administrative mutations), answering a stable 403 with
 *     `code: "self_administration_forbidden"` before the handler runs;
 *   - `assertNotSelfAdministration(...)` — called inside the core employee
 *     services (update/separate/rehire/transfer/promote/confirm) so a future
 *     route cannot reuse them to bypass the policy.
 * Every refusal is audited with outcome "denied" and never writes anything.
 */
import type { NextFunction, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  employeeUserLinksTable,
  employmentTermsTable,
  employmentAssignmentsTable,
  employeeExitProcessesTable,
  employeeSkillRecordsTable,
  exitInterviewsTable,
} from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { resolveOrganizationId, type MembershipRequest } from "../middlewares/requireMembership";

export const SELF_ADMINISTRATION_ERROR_CODE = "self_administration_forbidden";

export class SelfAdministrationForbiddenError extends Error {
  readonly code = SELF_ADMINISTRATION_ERROR_CODE;
  readonly employeeId: number;
  readonly action: string;
  constructor(employeeId: number, action: string) {
    super(
      "You cannot perform this administrative action on your own employee record. " +
        "Ask another authorized HR officer or organisation administrator to make the change, " +
        "or submit a data-change request from My Requests.",
    );
    this.name = "SelfAdministrationForbiddenError";
    this.employeeId = employeeId;
    this.action = action;
  }
}

// Structurally accepts either the global `db` or a transaction client.
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The acting user's own employee record in THIS organization, or null.
 * Joined to `employees` so a link in another organization can never
 * resolve here (one user may be linked in several tenants).
 */
export async function resolveActorEmployeeId(
  organizationId: number,
  applicationUserId: number,
  client: QueryClient = db,
): Promise<number | null> {
  // Two plain lookups rather than a join: the user's links (one per
  // organization they are linked in), then the employee row that must sit in
  // THIS organization. Every returned row is re-checked in code so neither a
  // link that is not the actor's nor an employee outside this organization can
  // ever be mistaken for the actor's own record.
  const links = await client
    .select({ employeeId: employeeUserLinksTable.employeeId, applicationUserId: employeeUserLinksTable.applicationUserId })
    .from(employeeUserLinksTable)
    .where(eq(employeeUserLinksTable.applicationUserId, applicationUserId));
  for (const link of links) {
    if (link.applicationUserId !== applicationUserId || link.employeeId == null) continue;
    const [employee] = await client
      .select({ id: employeesTable.id, organizationId: employeesTable.organizationId })
      .from(employeesTable)
      .where(and(eq(employeesTable.id, link.employeeId), eq(employeesTable.organizationId, organizationId)))
      .limit(1);
    if (employee && employee.id === link.employeeId && employee.organizationId === organizationId) return employee.id;
  }
  return null;
}

export interface SelfAdministrationCheck {
  organizationId: number;
  /** The employee record the administrative action targets. */
  employeeId: number;
  actorApplicationUserId: number;
  actorMembershipId?: number | null;
  /** Short action label for the audit trail, e.g. "employee.update", "employee.separate". */
  action: string;
  client?: QueryClient;
}

/** Throws `SelfAdministrationForbiddenError` (after auditing the denial) when the actor targets their own record. */
export async function assertNotSelfAdministration(params: SelfAdministrationCheck): Promise<void> {
  const own = await resolveActorEmployeeId(params.organizationId, params.actorApplicationUserId, params.client);
  if (own === null || own !== params.employeeId) return;
  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId ?? null,
    organizationId: params.organizationId,
    eventType: "employee.self_administration_denied",
    targetType: "employee",
    targetId: String(params.employeeId),
    metadata: { action: params.action },
    outcome: "denied",
  });
  throw new SelfAdministrationForbiddenError(params.employeeId, params.action);
}

/** One response shape for every refusal, so clients can recognise it reliably. */
export function respondSelfAdministrationForbidden(res: Response, err: SelfAdministrationForbiddenError): void {
  res.status(403).json({ error: err.message, code: err.code, employeeId: err.employeeId });
}

/**
 * How a route names the employee it targets. The default reads
 * `req.params.employeeId`; a nested resource (a contract term, an acting
 * assignment, an exit process) supplies a resolver that loads the parent row
 * within the bound organization and returns its employee id, or null when
 * the row does not exist (the handler's own 404 then applies).
 */
export type TargetEmployeeResolver = (req: MembershipRequest, organizationId: number) => Promise<number | null>;

export function targetFromParam(paramName = "employeeId"): TargetEmployeeResolver {
  return async (req) => {
    const raw = req.params[paramName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const id = parseInt(value ?? "", 10);
    return Number.isNaN(id) ? null : id;
  };
}

/**
 * Resolver for routes addressed by a child row (a contract term, an acting
 * assignment, an exit process): loads the row inside the bound organization
 * and returns the employee it belongs to. A missing or foreign row resolves
 * null, so the handler's own 404 still applies.
 */
export function targetFromOwnedRow(
  table: { id: unknown; organizationId: unknown; employeeId: unknown },
  paramName: string,
): TargetEmployeeResolver {
  return async (req, organizationId) => {
    const raw = req.params[paramName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const id = parseInt(value ?? "", 10);
    if (Number.isNaN(id)) return null;
    // The three child tables (employment terms, assignments, exit processes)
    // share the id/organizationId/employeeId column triplet this query needs;
    // employeesTable's shape is borrowed only to satisfy the query builder.
    const t = table as unknown as typeof employeesTable;
    const [row] = await db
      .select({ employeeId: (table as unknown as { employeeId: typeof employeesTable.id }).employeeId })
      .from(t)
      .where(and(eq(t.id, id), eq(t.organizationId, organizationId)))
      .limit(1);
    return row?.employeeId ?? null;
  };
}

// Named resolvers for the three nested-resource route families. The table
// objects are read when the resolver RUNS (inside a request), never while a
// route module is being evaluated — route files therefore import only these
// functions, and a test harness that mocks `@workspace/db` with a narrower
// export list still loads every router.
export const targetFromEmploymentTerm = (paramName = "termId"): TargetEmployeeResolver => (req, organizationId) =>
  targetFromOwnedRow(employmentTermsTable, paramName)(req, organizationId);
export const targetFromEmploymentAssignment = (paramName = "assignmentId"): TargetEmployeeResolver => (req, organizationId) =>
  targetFromOwnedRow(employmentAssignmentsTable, paramName)(req, organizationId);
export const targetFromExitProcess = (paramName = "exitProcessId"): TargetEmployeeResolver => (req, organizationId) =>
  targetFromOwnedRow(employeeExitProcessesTable, paramName)(req, organizationId);
export const targetFromSkillRecord = (paramName = "recordId"): TargetEmployeeResolver => (req, organizationId) =>
  targetFromOwnedRow(employeeSkillRecordsTable, paramName)(req, organizationId);

/** Exit interviews hang off an exit process (two hops), both rows checked inside the bound organization. */
export const targetFromExitInterview = (paramName = "interviewId"): TargetEmployeeResolver => async (req, organizationId) => {
  const raw = req.params[paramName];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(value ?? "", 10);
  if (Number.isNaN(id)) return null;
  const [interview] = await db
    .select({ exitProcessId: exitInterviewsTable.exitProcessId })
    .from(exitInterviewsTable)
    .where(and(eq(exitInterviewsTable.id, id), eq(exitInterviewsTable.organizationId, organizationId)))
    .limit(1);
  if (!interview?.exitProcessId) return null;
  const [process] = await db
    .select({ employeeId: employeeExitProcessesTable.employeeId })
    .from(employeeExitProcessesTable)
    .where(and(eq(employeeExitProcessesTable.id, interview.exitProcessId), eq(employeeExitProcessesTable.organizationId, organizationId)))
    .limit(1);
  return process?.employeeId ?? null;
};

/**
 * Custom-field values are written per (scope, entityId). Only the `employee`
 * scope names an employee record; every other scope resolves null and is
 * left to its own authorization.
 */
export const targetFromCustomFieldEntity = (): TargetEmployeeResolver => async (req) => {
  const scope = Array.isArray(req.params.scope) ? req.params.scope[0] : req.params.scope;
  if (scope !== "employee") return null;
  return targetFromParam("entityId")(req, 0);
};

/**
 * Route middleware for category-A (HR-administrative) employee mutations.
 * Must run AFTER requireAuth and requireMembership. It only refuses; when the
 * target cannot be resolved it defers to the handler, which answers 400/404
 * exactly as before.
 */
export function forbidSelfAdministration(action: string, resolveTarget: TargetEmployeeResolver = targetFromParam()) {
  return async (req: MembershipRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const organizationId = resolveOrganizationId(req);
      const employeeId = await resolveTarget(req, organizationId);
      if (employeeId == null) {
        next();
        return;
      }
      await assertNotSelfAdministration({
        organizationId,
        employeeId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership?.id ?? null,
        action,
      });
      next();
    } catch (err) {
      if (err instanceof SelfAdministrationForbiddenError) {
        respondSelfAdministrationForbidden(res, err);
        return;
      }
      next(err);
    }
  };
}
