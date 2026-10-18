/**
 * Office Inventory, Workstream 3 — Approval Delegation
 * (docs/OFFICE_INVENTORY_IMPLEMENTATION_PLAN.md §5.3, §6). A Department
 * Head may delegate approval authority for their own department to another
 * membership. Half-open `[validFrom, validTo)` interval, identical pattern
 * to `department_heads.ts`. Only a department's CURRENT Head may create a
 * delegation for that department — enforced here, not by the DB.
 *
 * The load-bearing rule this file owns: `resolveApprovalAuthority` is the
 * SINGLE place that decides whether a membership may approve a request for
 * a given department, right now — either because they ARE the current
 * Head, or because they hold an open delegation AND the delegation's own
 * `delegatingHeadMembershipId` is STILL the department's actual current
 * Head (re-checked fresh every call, never cached, never assumed from the
 * delegation row's own existence — see officeInventoryApprovalDelegations
 * schema's own header comment for why).
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  departmentsTable,
  officeInventoryApprovalDelegationsTable,
  organizationMembershipsTable,
  type OfficeInventoryApprovalDelegation,
} from "@workspace/db";
import { getCurrentDepartmentHead } from "./departmentHeads";
import { recordAuditEvent } from "./auditLog";

export class DepartmentNotFoundError extends Error {
  constructor() {
    super("Department not found");
  }
}
export class NotCurrentDepartmentHeadError extends Error {
  constructor() {
    super("Only the department's current Head may create or revoke a delegation for it");
  }
}
export class DelegationNotFoundError extends Error {
  constructor() {
    super("Delegation not found");
  }
}
/**
 * WS-18 Pass 2, finding F-4 — the delegate was previously never validated.
 *
 * `createDelegation` checked that the caller really is the department's current
 * Head, but accepted `delegateMembershipId` verbatim: a membership id belonging
 * to another organization, a suspended or expired membership, or the head's own
 * membership all wrote a delegation row happily.
 *
 * That was correctly graded Low rather than an escalation path, because
 * `resolveApprovalAuthority` is not the only gate — a delegate still has to get
 * through requireAuth -> requireMembership -> requirePermission for the target
 * organization to use the authority, and a foreign or inactive membership never
 * does. So the row was inert. It was still wrong to store: it produced
 * authority records that assert a relationship the platform would never honour,
 * misleads anyone reading the delegation list or the audit trail, and leaves the
 * isolation guarantee resting entirely on a downstream check rather than on the
 * data being right in the first place.
 *
 * Validation now happens where the row is created. This is deliberately a
 * module-local fix: it adds no new delegation concepts and changes nothing about
 * how authority is resolved.
 */
export class InvalidDelegateError extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

export interface ApprovalAuthority {
  capacity: "department_head" | "delegate";
  headMembershipId: number;
  delegation: OfficeInventoryApprovalDelegation | null;
}

/**
 * Resolves who may approve a request for `departmentId`, right now (or as
 * of `asOfDate` for historical evidence purposes — approval actions
 * themselves always call this with the current instant). Returns null if
 * `actorMembershipId` has no authority (not Head, not a currently-valid
 * delegate) — including the vacancy case (no current Head at all, so no
 * delegation can be "currently valid" either, since there is no Head to
 * validate it against).
 */
export async function resolveApprovalAuthority(organizationId: number, departmentId: number, actorMembershipId: number): Promise<ApprovalAuthority | null> {
  const currentHead = await getCurrentDepartmentHead(organizationId, departmentId);
  if (!currentHead) return null; // vacancy — no Head, so no delegation can be valid either (§5.3)

  if (currentHead.headMembershipId === actorMembershipId) {
    return { capacity: "department_head", headMembershipId: currentHead.headMembershipId, delegation: null };
  }

  // Bug found via live concurrency QA, fixed before commit: the unique
  // constraint is (organizationId, departmentId, delegatingHeadMembershipId)
  // — NOT unique per delegate — so the same delegate can simultaneously
  // hold an open (but now-inert) delegation row from a FORMER Head
  // alongside a genuinely valid open delegation from the CURRENT Head
  // (e.g. Head A delegates to X, Head A is replaced by Head B, Head B also
  // delegates to X — A's row is never auto-revoked per §5.3). Querying "any
  // open delegation for this delegate" and taking the first row back
  // (no ORDER BY) could non-deterministically return either row — filter
  // directly on `delegatingHeadMembershipId = currentHead.headMembershipId`
  // instead of filtering after the fact, so the correct, currently-valid
  // row is the ONLY one this query can ever match.
  const [delegation] = await db
    .select()
    .from(officeInventoryApprovalDelegationsTable)
    .where(
      and(
        eq(officeInventoryApprovalDelegationsTable.organizationId, organizationId),
        eq(officeInventoryApprovalDelegationsTable.departmentId, departmentId),
        eq(officeInventoryApprovalDelegationsTable.delegateMembershipId, actorMembershipId),
        eq(officeInventoryApprovalDelegationsTable.delegatingHeadMembershipId, currentHead.headMembershipId),
        isNull(officeInventoryApprovalDelegationsTable.validTo),
      ),
    );
  if (!delegation) return null;

  return { capacity: "delegate", headMembershipId: currentHead.headMembershipId, delegation };
}

export interface CreateDelegationParams {
  organizationId: number;
  departmentId: number;
  delegateMembershipId: number;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

/** Only the department's current Head may call this successfully — enforced by checking `actorMembershipId` against the live resolver, not by trusting the caller's own claim. */
export async function createDelegation(params: CreateDelegationParams): Promise<OfficeInventoryApprovalDelegation> {
  const [department] = await db
    .select()
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, params.departmentId), eq(departmentsTable.organizationId, params.organizationId)));
  if (!department) throw new DepartmentNotFoundError();

  const currentHead = await getCurrentDepartmentHead(params.organizationId, params.departmentId);
  if (!currentHead || currentHead.headMembershipId !== params.actorMembershipId) throw new NotCurrentDepartmentHeadError();

  // F-4 — validate the delegate before writing an authority record about them.
  // Self-delegation is rejected first because it is meaningless rather than
  // dangerous: the Head already holds the authority they would be delegating,
  // and storing it creates a row that can never widen anyone's access while
  // implying a separation of duties that does not exist.
  if (params.delegateMembershipId === params.actorMembershipId) {
    throw new InvalidDelegateError("A department Head cannot delegate approval authority to themselves");
  }

  const [delegate] = await db
    .select()
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.id, params.delegateMembershipId),
        // Scoped to the delegating organization, so a membership id from
        // another tenant simply does not resolve here.
        eq(organizationMembershipsTable.organizationId, params.organizationId),
      ),
    );

  // One message for "no such membership" and for "belongs to another
  // organization": distinguishing them would let a Head probe whether a given
  // membership id exists elsewhere on the platform.
  if (!delegate) {
    throw new InvalidDelegateError("The delegate must be an active member of this organization");
  }
  if (delegate.status !== "active") {
    throw new InvalidDelegateError("The delegate must be an active member of this organization");
  }

  const { record, previous } = await db.transaction(async (tx) => {
    const [openRow] = await tx
      .select()
      .from(officeInventoryApprovalDelegationsTable)
      .where(
        and(
          eq(officeInventoryApprovalDelegationsTable.organizationId, params.organizationId),
          eq(officeInventoryApprovalDelegationsTable.departmentId, params.departmentId),
          eq(officeInventoryApprovalDelegationsTable.delegatingHeadMembershipId, params.actorMembershipId),
          isNull(officeInventoryApprovalDelegationsTable.validTo),
        ),
      )
      .for("update");

    const now = new Date();
    if (openRow) {
      await tx
        .update(officeInventoryApprovalDelegationsTable)
        .set({ validTo: now, revokedByMembershipId: params.actorMembershipId })
        .where(eq(officeInventoryApprovalDelegationsTable.id, openRow.id));
    }

    const [created] = await tx
      .insert(officeInventoryApprovalDelegationsTable)
      .values({
        organizationId: params.organizationId,
        departmentId: params.departmentId,
        delegatingHeadMembershipId: params.actorMembershipId,
        delegateMembershipId: params.delegateMembershipId,
        validFrom: now,
        createdByMembershipId: params.actorMembershipId,
      })
      .returning();

    return { record: created, previous: openRow ?? null };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_delegation.created",
    targetType: "office_inventory_approval_delegation",
    targetId: String(record.id),
    beforeState: previous ? { delegateMembershipId: previous.delegateMembershipId } : null,
    afterState: { departmentId: params.departmentId, delegateMembershipId: record.delegateMembershipId },
  });

  return record;
}

export interface RevokeDelegationParams {
  organizationId: number;
  delegationId: number;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

export async function revokeDelegation(params: RevokeDelegationParams): Promise<OfficeInventoryApprovalDelegation> {
  const [existing] = await db
    .select()
    .from(officeInventoryApprovalDelegationsTable)
    .where(
      and(
        eq(officeInventoryApprovalDelegationsTable.id, params.delegationId),
        eq(officeInventoryApprovalDelegationsTable.organizationId, params.organizationId),
        isNull(officeInventoryApprovalDelegationsTable.validTo),
      ),
    );
  if (!existing) throw new DelegationNotFoundError();

  const currentHead = await getCurrentDepartmentHead(params.organizationId, existing.departmentId);
  if (!currentHead || currentHead.headMembershipId !== params.actorMembershipId) throw new NotCurrentDepartmentHeadError();

  const [revoked] = await db
    .update(officeInventoryApprovalDelegationsTable)
    .set({ validTo: new Date(), revokedByMembershipId: params.actorMembershipId })
    .where(eq(officeInventoryApprovalDelegationsTable.id, params.delegationId))
    .returning();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "office_inventory_delegation.revoked",
    targetType: "office_inventory_approval_delegation",
    targetId: String(params.delegationId),
    beforeState: { delegateMembershipId: existing.delegateMembershipId },
  });

  return revoked;
}

/** Current + historical delegations for a department, oldest first. */
export async function listDelegationsForDepartment(organizationId: number, departmentId: number): Promise<OfficeInventoryApprovalDelegation[]> {
  return db
    .select()
    .from(officeInventoryApprovalDelegationsTable)
    .where(and(eq(officeInventoryApprovalDelegationsTable.organizationId, organizationId), eq(officeInventoryApprovalDelegationsTable.departmentId, departmentId)))
    .orderBy(officeInventoryApprovalDelegationsTable.validFrom);
}

/**
 * True when `membershipId` currently holds VALID delegated approval authority
 * for at least one department. It is decided per open delegation row by
 * resolveApprovalAuthority itself — the single authority this file owns — so
 * an inert row left behind by a former Head never counts. Informational only
 * (it lets the dashboard offer the approval surface to a genuine delegate);
 * every approval action re-resolves authority on its own.
 */
export async function isCurrentInventoryApprovalDelegate(organizationId: number, membershipId: number): Promise<boolean> {
  const open = await db
    .select({ departmentId: officeInventoryApprovalDelegationsTable.departmentId })
    .from(officeInventoryApprovalDelegationsTable)
    .where(
      and(
        eq(officeInventoryApprovalDelegationsTable.organizationId, organizationId),
        eq(officeInventoryApprovalDelegationsTable.delegateMembershipId, membershipId),
        isNull(officeInventoryApprovalDelegationsTable.validTo),
      ),
    );
  for (const departmentId of new Set(open.map((r) => r.departmentId))) {
    const authority = await resolveApprovalAuthority(organizationId, departmentId, membershipId);
    if (authority?.capacity === "delegate") return true;
  }
  return false;
}

/** True only if `membershipId` is this department's CURRENT Head — used to gate delegation management routes (create/revoke/view), which are deliberately Head-only, never delegate-accessible (a delegate manages approvals, not who else may be delegated to). */
export async function getCurrentDepartmentHeadCheck(organizationId: number, departmentId: number, membershipId: number): Promise<boolean> {
  const currentHead = await getCurrentDepartmentHead(organizationId, departmentId);
  return currentHead !== null && currentHead.headMembershipId === membershipId;
}
