/**
 * WS-16 Pass 2B — the shared authority-delegation foundation
 * (docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §32.10–§32.19, Owner
 * Decisions #14 and #15).
 *
 * This module answers exactly one bounded question:
 *
 *   "does this membership hold effective department-head authority for this
 *    department, right now — directly, or through a currently-valid
 *    delegation?"
 *
 * and owns the create/revoke/read primitives for the delegations that answer
 * it. It is NOT a workflow engine: it holds no workflow state, inspects no
 * module's business rules, and decides nothing about whether an action may
 * proceed beyond that one authority question.
 *
 * FIVE THINGS THIS MODULE DELIBERATELY IS NOT
 *
 *   1. NOT a permission grant (§32.12). A delegation never mutates RBAC. A
 *      delegate still needs whatever permission the source module requires;
 *      the composition rule is `source permission AND effective delegated
 *      authority AND source business state`, and this module supplies only
 *      the middle term.
 *   2. NOT a transfer of authority (§32.5). The direct Head keeps everything.
 *      A delegation ADDS a substitute; `department_heads` is never written.
 *   3. NOT a competing department-head source of truth (§32.23). Direct
 *      authority is resolved by `departmentHeads.ts`'s existing
 *      `getCurrentDepartmentHead`, which this module composes with.
 *   4. NOT chainable (§32.13). Creation demands DIRECT authority, so a
 *      delegate — who is by definition not the Head — can never delegate
 *      onward. A → B → C is structurally impossible, not merely forbidden.
 *   5. NOT Office Inventory's delegation (§32.20). That module keeps its own
 *      table, resolver and routes, unmigrated and un-dual-written. Its known
 *      FK-only delegate-validation gap remains open and is registered as its
 *      own separate decision in §32.25 — it is NOT fixed here, and this
 *      module is deliberately stricter than that prototype.
 *
 * NO BUSINESS CONSUMER EXISTS, AND THAT IS INTENTIONAL (§32.21). Leave,
 * Recruitment, WS-13, Onboarding and Payroll are all expressly not
 * delegatable; the initial consumer set is frozen as EMPTY, and a consumer
 * must not be invented merely to prove this works. There is likewise no HTTP
 * route and no UI: the holder-facing surface is Pass 2C, gated on an explicit
 * Owner Decision naming a first consumer.
 *
 * NO JOB IS REQUIRED FOR CORRECTNESS (§32.13). Validity is evaluated at
 * resolution time from `[validFrom, validTo)` plus a live re-check of the
 * delegator's underlying authority and the delegate's membership. Nothing
 * expires a delegation on a schedule, and nothing may be built that depends
 * on one having run.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  authorityDelegationsTable,
  departmentsTable,
  organizationMembershipsTable,
  type AuthorityDelegation,
} from "@workspace/db";
import { getCurrentDepartmentHead } from "./departmentHeads";
import { activeAndUnexpired } from "./membership";
import { recordAuditEvent } from "./auditLog";

/** The only authority type WS-16 supports. Widening requires an Owner Decision (§32.25). */
export const SUPPORTED_AUTHORITY_TYPE = "department_head" as const;

// --- Typed errors (§42) -----------------------------------------------------
// Each names one distinguishable cause. None of them is a generic
// "unauthorized": an operational failure must never be reported as an
// authorization result (§32.13), so database errors are deliberately allowed
// to propagate rather than being caught and flattened here.

export class DelegationDepartmentNotFoundError extends Error {
  constructor() {
    super("Department not found in this organization");
    this.name = "DelegationDepartmentNotFoundError";
  }
}
export class NotDirectAuthorityHolderError extends Error {
  constructor() {
    super("Only the department's current head may create or revoke a delegation for it");
    this.name = "NotDirectAuthorityHolderError";
  }
}
export class UnsupportedAuthorityTypeError extends Error {
  constructor(received: string) {
    super(`Unsupported authority type: ${received}`);
    this.name = "UnsupportedAuthorityTypeError";
  }
}
export class DelegateNotActiveError extends Error {
  constructor() {
    super("Delegate must be an active membership of this organization");
    this.name = "DelegateNotActiveError";
  }
}
export class CrossTenantMembershipError extends Error {
  constructor() {
    super("Membership does not belong to this organization");
    this.name = "CrossTenantMembershipError";
  }
}
export class SelfDelegationError extends Error {
  constructor() {
    super("A delegation's delegate must differ from its delegator");
    this.name = "SelfDelegationError";
  }
}
export class DelegationReasonRequiredError extends Error {
  constructor() {
    super("A delegation reason is required");
    this.name = "DelegationReasonRequiredError";
  }
}
export class DelegationNotFoundError extends Error {
  constructor() {
    super("Delegation not found in this organization");
    this.name = "DelegationNotFoundError";
  }
}
export class DelegationAlreadyRevokedError extends Error {
  constructor() {
    super("Delegation is already closed");
    this.name = "DelegationAlreadyRevokedError";
  }
}

// --- Authority result (§32.12, §24) -----------------------------------------

/**
 * The minimal frozen shape (§32.12): enough for a future consumer to gate an
 * action AND to attribute it correctly (§32.18), and nothing more. No
 * metadata blob, no workflow state, no permission list — a caller learns
 * whether authority exists and on what basis, never how authorization is
 * configured.
 */
export interface DepartmentHeadAuthority {
  /** "direct" — the actor IS the current head; "delegated" — a valid substitute. */
  basis: "direct" | "delegated";
  /**
   * The membership that actually holds the underlying authority. For a direct
   * grant this equals the actor; for a delegated one it is the head the
   * delegate is standing in for, which is what a source record must store
   * alongside the ACTUAL actor so an action is never attributed as though the
   * head performed it personally (§32.18).
   */
  directAuthorityHolderMembershipId: number;
  /** Present only when `basis` is "delegated" — recorded on the source record. */
  delegationId: number | null;
}

// --- Internal helpers -------------------------------------------------------

/**
 * A membership that exists, belongs to THIS organization, and is active right
 * now. The organization predicate is the point: a foreign key proves a
 * membership exists, never that it is ours (§37) — precisely the gap the
 * Office Inventory prototype left open (§32.6).
 */
async function findActiveMembershipInOrganization(organizationId: number, membershipId: number) {
  const [row] = await db
    .select({ id: organizationMembershipsTable.id })
    .from(organizationMembershipsTable)
    .where(
      and(
        eq(organizationMembershipsTable.id, membershipId),
        eq(organizationMembershipsTable.organizationId, organizationId),
        activeAndUnexpired(),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** A department that exists AND belongs to this organization. */
async function findDepartmentInOrganization(organizationId: number, departmentId: number) {
  const [row] = await db
    .select({ id: departmentsTable.id })
    .from(departmentsTable)
    .where(and(eq(departmentsTable.id, departmentId), eq(departmentsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * The currently-open delegation from `delegatorMembershipId` for this scope,
 * if any. Note it filters on the DELEGATOR, never merely on the delegate:
 * because the open-row uniqueness is keyed on the delegator (§32.11), one
 * delegate can hold an open-but-inert row from a FORMER head alongside a
 * valid one from the current head, and an unordered "any open row for this
 * delegate" query could return either non-deterministically. This is the
 * concurrency defect Office Inventory's own live QA found (§32.5), avoided
 * here by construction rather than rediscovered.
 */
async function findOpenDelegation(params: {
  organizationId: number;
  departmentId: number;
  delegatorMembershipId: number;
  delegateMembershipId?: number;
}): Promise<AuthorityDelegation | null> {
  const [row] = await db
    .select()
    .from(authorityDelegationsTable)
    .where(
      and(
        eq(authorityDelegationsTable.organizationId, params.organizationId),
        eq(authorityDelegationsTable.authorityType, SUPPORTED_AUTHORITY_TYPE),
        eq(authorityDelegationsTable.departmentId, params.departmentId),
        eq(authorityDelegationsTable.delegatorMembershipId, params.delegatorMembershipId),
        ...(params.delegateMembershipId != null
          ? [eq(authorityDelegationsTable.delegateMembershipId, params.delegateMembershipId)]
          : []),
        isNull(authorityDelegationsTable.validTo),
      ),
    );
  return row ?? null;
}

// --- Resolution (§22, §32.12, §32.17) ---------------------------------------

/**
 * Does `actorMembershipId` hold effective department-head authority for this
 * department, right now? Returns `null` when it does not.
 *
 * Every clause is re-derived on each call — nothing is cached and nothing is
 * inferred from a delegation row merely existing:
 *
 *   - a VACANCY denies everyone. With no current head there is no authority
 *     to hold and nobody for a delegation to be validated against, so an open
 *     delegation resolves to nothing;
 *   - AUTHORITY LOSS makes a delegation inert (§32.17, the load-bearing §5.3
 *     rule). The row survives its delegator's replacement and stays fully
 *     historically queryable, but it grants nothing, because this query
 *     matches only a row whose delegator IS the department's current head. A
 *     new head does NOT inherit it;
 *   - a REVOKED delegation is outside `[validFrom, validTo)` from the instant
 *     of revocation, denied by pure date evaluation with no job involved;
 *   - an INACTIVE DELEGATE is denied even while the row is open, because the
 *     delegate's membership is re-checked here, not trusted from creation.
 */
export async function resolveDepartmentHeadAuthority(
  organizationId: number,
  departmentId: number,
  actorMembershipId: number,
): Promise<DepartmentHeadAuthority | null> {
  const currentHead = await getCurrentDepartmentHead(organizationId, departmentId);
  if (!currentHead) return null; // vacancy — nothing to hold, nothing to delegate

  if (currentHead.headMembershipId === actorMembershipId) {
    return { basis: "direct", directAuthorityHolderMembershipId: currentHead.headMembershipId, delegationId: null };
  }

  const now = new Date();
  const [delegation] = await db
    .select()
    .from(authorityDelegationsTable)
    .where(
      and(
        eq(authorityDelegationsTable.organizationId, organizationId),
        eq(authorityDelegationsTable.authorityType, SUPPORTED_AUTHORITY_TYPE),
        eq(authorityDelegationsTable.departmentId, departmentId),
        eq(authorityDelegationsTable.delegateMembershipId, actorMembershipId),
        // The live re-check that makes authority loss inert: only a row whose
        // delegator is STILL the head can grant anything.
        eq(authorityDelegationsTable.delegatorMembershipId, currentHead.headMembershipId),
        // `[validFrom, validTo)` evaluated now — no job, no scheduled expiry.
        sql`${authorityDelegationsTable.validFrom} <= ${now}`,
        isNull(authorityDelegationsTable.validTo),
      ),
    );
  if (!delegation) return null;

  // The delegate must still be an active member of this organization. A
  // delegation does not keep a departed or suspended person working.
  const activeDelegate = await findActiveMembershipInOrganization(organizationId, actorMembershipId);
  if (!activeDelegate) return null;

  return {
    basis: "delegated",
    directAuthorityHolderMembershipId: currentHead.headMembershipId,
    delegationId: delegation.id,
  };
}

// --- Create (§38) -----------------------------------------------------------

export interface CreateDepartmentHeadDelegationParams {
  organizationId: number;
  departmentId: number;
  delegateMembershipId: number;
  reason: string;
  /** The AUTHENTICATED actor's membership. Never a client-supplied delegator id. */
  actorMembershipId: number;
  actorApplicationUserId: number | null;
  /** Defaults to the only supported type; an explicit wrong value is rejected. */
  authorityType?: string;
}

/**
 * Creates a delegation. HOLDER-ONLY (Owner Decision Q3): the delegator is
 * always the authenticated actor, taken from `actorMembershipId` and verified
 * against the live department-head resolver. There is no `delegatorMembershipId`
 * parameter to forge, and no administrative on-behalf-of path — not for Org
 * Admin, HR, Super Admin or a workflow administrator. Administrative privilege
 * does not manufacture another person's workflow authority.
 *
 * Creating a second delegation REPLACES the actor's own open one inside a
 * single transaction (§32.11): the existing row is read `FOR UPDATE`, closed
 * with `validTo` and `revokedByMembershipId`, and the new row inserted. The
 * partial unique index remains the database backstop if two transactions ever
 * escape the row lock. Under holder-only creation the replaced row is always
 * the actor's own, and its closure is audited.
 */
export async function createDepartmentHeadDelegation(
  params: CreateDepartmentHeadDelegationParams,
): Promise<AuthorityDelegation> {
  // 1. Supported authority type. The enum makes anything else unrepresentable
  //    in the database; this rejects it before we get that far, with a name.
  const authorityType = params.authorityType ?? SUPPORTED_AUTHORITY_TYPE;
  if (authorityType !== SUPPORTED_AUTHORITY_TYPE) throw new UnsupportedAuthorityTypeError(authorityType);

  // 2. A reason is required and must survive trimming (§32.10).
  const reason = params.reason?.trim() ?? "";
  if (reason.length === 0) throw new DelegationReasonRequiredError();

  // 3. Self-delegation is meaningless — a head already holds the authority.
  if (params.delegateMembershipId === params.actorMembershipId) throw new SelfDelegationError();

  // 4. The scope must be a real department OF THIS ORGANIZATION.
  const department = await findDepartmentInOrganization(params.organizationId, params.departmentId);
  if (!department) throw new DelegationDepartmentNotFoundError();

  // 5. DIRECT authority is required, resolved live and never trusted from the
  //    request. This is also what makes chaining impossible: a delegate is by
  //    definition not the head, so this check rejects them (§32.13).
  const currentHead = await getCurrentDepartmentHead(params.organizationId, params.departmentId);
  if (!currentHead || currentHead.headMembershipId !== params.actorMembershipId) {
    throw new NotDirectAuthorityHolderError();
  }

  // 6. The actor's own membership must still be active in this organization.
  const activeActor = await findActiveMembershipInOrganization(params.organizationId, params.actorMembershipId);
  if (!activeActor) throw new CrossTenantMembershipError();

  // 7. The delegate must exist, belong to THIS organization, and be active.
  //    A foreign key would have proved only the first of the three — the
  //    precise gap that makes the Office Inventory prototype unsafe (§32.6).
  const activeDelegate = await findActiveMembershipInOrganization(params.organizationId, params.delegateMembershipId);
  if (!activeDelegate) throw new DelegateNotActiveError();

  // 8. Insert under the concurrency-safe invariant.
  const { record, previous } = await db.transaction(async (tx) => {
    const [openRow] = await tx
      .select()
      .from(authorityDelegationsTable)
      .where(
        and(
          eq(authorityDelegationsTable.organizationId, params.organizationId),
          eq(authorityDelegationsTable.authorityType, SUPPORTED_AUTHORITY_TYPE),
          eq(authorityDelegationsTable.departmentId, params.departmentId),
          eq(authorityDelegationsTable.delegatorMembershipId, params.actorMembershipId),
          isNull(authorityDelegationsTable.validTo),
        ),
      )
      .for("update");

    const now = new Date();
    if (openRow) {
      await tx
        .update(authorityDelegationsTable)
        .set({ validTo: now, revokedByMembershipId: params.actorMembershipId })
        .where(eq(authorityDelegationsTable.id, openRow.id));
    }

    const [created] = await tx
      .insert(authorityDelegationsTable)
      .values({
        organizationId: params.organizationId,
        authorityType: SUPPORTED_AUTHORITY_TYPE,
        departmentId: params.departmentId,
        delegatorMembershipId: params.actorMembershipId,
        delegateMembershipId: params.delegateMembershipId,
        reason,
        validFrom: now,
      })
      .returning();

    return { record: created, previous: openRow ?? null };
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "authority_delegation.created",
    targetType: "authority_delegation",
    targetId: String(record.id),
    beforeState: previous
      ? { replacedDelegationId: previous.id, delegateMembershipId: previous.delegateMembershipId }
      : null,
    afterState: {
      authorityType: record.authorityType,
      departmentId: record.departmentId,
      delegatorMembershipId: record.delegatorMembershipId,
      delegateMembershipId: record.delegateMembershipId,
      validFrom: record.validFrom,
      validTo: record.validTo,
      reason: record.reason,
    },
  });

  return record;
}

// --- Revoke (§39) -----------------------------------------------------------

export interface RevokeDelegationParams {
  organizationId: number;
  delegationId: number;
  actorMembershipId: number;
  actorApplicationUserId: number | null;
}

/**
 * Revokes a delegation. Immediate: authority is re-derived per action, so the
 * next resolution denies it with no job involved.
 *
 * The row is NEVER deleted and never rewritten to impersonate another holder
 * (§32.17) — `validTo` and `revokedByMembershipId` are stamped and everything
 * else stays, so prior delegated actions remain attributable and historical
 * audit is untouched.
 *
 * Only the delegator may revoke, and only while they still hold the
 * underlying authority — the prototype's rule (§32.17). There is deliberately
 * NO administrative override: repository evidence establishes no safe
 * revocation rule after authority loss, and none is invented here. A
 * delegation whose delegator is no longer head is already inert, so it needs
 * no revoking, and the new head cannot revoke a grant they did not make.
 */
export async function revokeDelegation(params: RevokeDelegationParams): Promise<AuthorityDelegation> {
  // Loaded WITH the organization predicate — never by id alone, so a
  // cross-tenant delegation id is simply not found rather than acted upon.
  const [existing] = await db
    .select()
    .from(authorityDelegationsTable)
    .where(
      and(
        eq(authorityDelegationsTable.id, params.delegationId),
        eq(authorityDelegationsTable.organizationId, params.organizationId),
      ),
    );
  if (!existing) throw new DelegationNotFoundError();
  if (existing.validTo != null) throw new DelegationAlreadyRevokedError();

  const currentHead = await getCurrentDepartmentHead(params.organizationId, existing.departmentId);
  if (!currentHead || currentHead.headMembershipId !== params.actorMembershipId) {
    throw new NotDirectAuthorityHolderError();
  }
  // Belt and braces: the actor must also be this row's own delegator. Being
  // the current head of the department is not, by itself, licence to close
  // somebody else's grant.
  if (existing.delegatorMembershipId !== params.actorMembershipId) throw new NotDirectAuthorityHolderError();

  const [revoked] = await db
    .update(authorityDelegationsTable)
    .set({ validTo: new Date(), revokedByMembershipId: params.actorMembershipId })
    .where(
      and(
        eq(authorityDelegationsTable.id, params.delegationId),
        eq(authorityDelegationsTable.organizationId, params.organizationId),
        isNull(authorityDelegationsTable.validTo),
      ),
    )
    .returning();
  // Lost a race with a concurrent revoke: the row is already closed, which is
  // the same outcome the caller wanted, but reported honestly rather than
  // silently returning a stale row.
  if (!revoked) throw new DelegationAlreadyRevokedError();

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "authority_delegation.revoked",
    targetType: "authority_delegation",
    targetId: String(params.delegationId),
    beforeState: {
      delegateMembershipId: existing.delegateMembershipId,
      delegatorMembershipId: existing.delegatorMembershipId,
      departmentId: existing.departmentId,
      validTo: null,
    },
    afterState: { validTo: revoked.validTo, revokedByMembershipId: revoked.revokedByMembershipId },
  });

  return revoked;
}

// --- Bounded reads (§40) ----------------------------------------------------

/**
 * The delegations a holder has granted for one department — their own current
 * and historical grants, oldest first.
 *
 * Deliberately keyed on the DELEGATOR rather than the department alone: this
 * is a holder's view of what they themselves granted, not an
 * organization-wide register of who may act for whom. There is no
 * "list every delegation in the tenant" capability and no administrative
 * backdoor (§40) — one would be an authority-visibility surface that §32
 * never froze, and Pass 2C is gated regardless.
 */
export async function listDelegationsGrantedBy(params: {
  organizationId: number;
  departmentId: number;
  delegatorMembershipId: number;
}): Promise<AuthorityDelegation[]> {
  return db
    .select()
    .from(authorityDelegationsTable)
    .where(
      and(
        eq(authorityDelegationsTable.organizationId, params.organizationId),
        eq(authorityDelegationsTable.authorityType, SUPPORTED_AUTHORITY_TYPE),
        eq(authorityDelegationsTable.departmentId, params.departmentId),
        eq(authorityDelegationsTable.delegatorMembershipId, params.delegatorMembershipId),
      ),
    )
    .orderBy(authorityDelegationsTable.validFrom);
}

/** One delegation, always organization-scoped. Never a lookup by id alone. */
export async function getDelegation(organizationId: number, delegationId: number): Promise<AuthorityDelegation | null> {
  const [row] = await db
    .select()
    .from(authorityDelegationsTable)
    .where(
      and(eq(authorityDelegationsTable.id, delegationId), eq(authorityDelegationsTable.organizationId, organizationId)),
    );
  return row ?? null;
}

/** The actor's own currently-open grant for a scope, if any. */
export async function getOpenDelegationGrantedBy(params: {
  organizationId: number;
  departmentId: number;
  delegatorMembershipId: number;
}): Promise<AuthorityDelegation | null> {
  return findOpenDelegation(params);
}
