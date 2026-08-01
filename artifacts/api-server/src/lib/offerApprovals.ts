/**
 * Offer Approval Workflow (Phase 3A, W57 — Offers): a single required
 * approval step per submitted offer version, mirroring
 * requisitionApprovals.ts's own transactional conditional-update decision
 * pattern exactly (docs/PHASE_3A_RECRUITMENT_IMPLEMENTATION_PLAN.md §9's
 * own text: offer_approvals "mirrors requisition_approvals"). Lives in its
 * own file for the same reason requisitionApprovals.ts is separate from
 * jobRequisitions.ts — offers.ts's submitOfferVersionForApproval calls
 * createPendingApprovalStep here; this file deliberately never imports
 * from offers.ts, keeping the dependency one-directional.
 *
 * Approver model — organization-wide offer.approve holders only, the same
 * narrowed "no delegated-approver tier" simplification
 * requisitionApprovals.ts already documents (no delegation configuration
 * exists anywhere in Recruitment yet).
 *
 * No `rejectOfferVersion` export exists here — §10 names only
 * submit-for-approval / approve / issue / withdraw, no reject route.
 * `decision` still carries the same three-value enum as
 * requisition_approvals (§9's own "mirrors" instruction), so "rejected" is
 * a structurally valid but currently unreachable value — see offers.ts's
 * withdrawOfferVersion, the only abort path this workstream builds for a
 * pending_approval version.
 */
import { and, eq, asc } from "drizzle-orm";
import { db, offerVersionsTable, offerApprovalsTable, type OfferVersion, type OfferApproval } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";

export class OfferApprovalNotPendingError extends Error {
  constructor() {
    super("This offer version is no longer awaiting a decision — it may already have been decided or withdrawn");
    this.name = "OfferApprovalNotPendingError";
  }
}

/** A distinct not-found error, not offers.ts's OfferVersionNotFoundError — this file deliberately has no import from offers.ts (see module header) to keep the dependency one-directional. The route layer catches both as 404. */
export class OfferApprovalTargetNotFoundError extends Error {
  constructor() {
    super("Offer version not found");
    this.name = "OfferApprovalTargetNotFoundError";
  }
}

// Structurally accepts either the global `db` or a `db.transaction(...)`
// callback's `tx` — lets step creation run inside
// submitOfferVersionForApproval's own transaction without a second query-
// client type (same pattern requisitionApprovals.ts's QueryClient
// established).
type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function findOfferVersionInOrg(organizationId: number, offerVersionId: number): Promise<OfferVersion | null> {
  const [row] = await db
    .select()
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.id, offerVersionId), eq(offerVersionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * Creates the single pending approval step (sequence 1) for a
 * just-submitted offer version. Must be called with the same transaction
 * client that flips offer_versions.status to pending_approval (see
 * offers.ts's submitOfferVersionForApproval) — the (offerVersionId,
 * sequence) unique index is the structural guarantee that a concurrent or
 * repeated submit can never create a second active approval instance for
 * the same offer version.
 */
export async function createPendingApprovalStep(
  client: QueryClient,
  params: { organizationId: number; offerVersionId: number },
): Promise<OfferApproval> {
  const [row] = await client
    .insert(offerApprovalsTable)
    .values({
      organizationId: params.organizationId,
      offerVersionId: params.offerVersionId,
      sequence: 1,
      decision: "pending",
    })
    .returning();
  return row;
}

/**
 * Every pending-approval offer version in the organization — the only
 * visibility tier this workstream implements for the approval inbox
 * (organization-wide offer.approve holders; no delegated-approver tier
 * exists yet, per the module-level note above).
 */
export async function listPendingOfferApprovals(organizationId: number): Promise<OfferVersion[]> {
  return db
    .select()
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.organizationId, organizationId), eq(offerVersionsTable.status, "pending_approval")))
    .orderBy(asc(offerVersionsTable.createdAt));
}

/**
 * Immutable decision history for one offer version, oldest sequence first.
 * The caller is responsible for independently confirming the offer itself
 * is visible to the caller before calling this — it does not re-check
 * visibility, mirroring listRequisitionApprovalHistory's own contract
 * (approval history carries no sensitivity beyond the offer it belongs to).
 */
export async function listOfferApprovalHistory(organizationId: number, offerVersionId: number): Promise<OfferApproval[]> {
  return db
    .select()
    .from(offerApprovalsTable)
    .where(and(eq(offerApprovalsTable.offerVersionId, offerVersionId), eq(offerApprovalsTable.organizationId, organizationId)))
    .orderBy(asc(offerApprovalsTable.sequence));
}

/**
 * Approves the single pending approval step, finalizing the offer version
 * as approved in the same transaction — mirrors requisitionApprovals.ts's
 * decide()/approveJobRequisition exactly, minus the reject branch (see
 * module header).
 */
export async function approveOfferVersion(params: {
  organizationId: number;
  offerVersionId: number;
  comment?: string | null;
  actorApplicationUserId: number;
  actorMembershipId: number;
}): Promise<OfferVersion> {
  const before = await findOfferVersionInOrg(params.organizationId, params.offerVersionId);
  if (!before) throw new OfferApprovalTargetNotFoundError();

  const offerVersion = await db.transaction(async (tx) => {
    const [approval] = await tx
      .update(offerApprovalsTable)
      .set({
        decision: "approved",
        decidedAt: new Date(),
        approverMembershipId: params.actorMembershipId,
        comment: params.comment ?? null,
      })
      .where(
        and(
          eq(offerApprovalsTable.offerVersionId, params.offerVersionId),
          eq(offerApprovalsTable.organizationId, params.organizationId),
          eq(offerApprovalsTable.sequence, 1),
          eq(offerApprovalsTable.decision, "pending"),
        ),
      )
      .returning();
    if (!approval) throw new OfferApprovalNotPendingError();

    const [row] = await tx
      .update(offerVersionsTable)
      .set({ status: "approved" })
      .where(
        and(
          eq(offerVersionsTable.id, params.offerVersionId),
          eq(offerVersionsTable.organizationId, params.organizationId),
          eq(offerVersionsTable.status, "pending_approval"),
        ),
      )
      .returning();
    if (!row) throw new OfferApprovalNotPendingError();

    return row;
  });

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "offer_version.approved",
    targetType: "offer_version",
    targetId: String(params.offerVersionId),
    beforeState: { status: before.status },
    afterState: { status: offerVersion.status, comment: params.comment ?? null },
  });

  return offerVersion;
}
