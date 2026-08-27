/**
 * WS-9 — Offer responses: accept, decline, withdraw, expiry
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §25.11–25.13).
 *
 * `offer_version_status` already carried `accepted`, `declined`, `withdrawn`
 * and `expired`; the reconciliation found that no code path ever wrote them,
 * so a recruitment pipeline could reach "issued" and then stop. This module
 * makes those states reachable.
 *
 * Every response binds to an exact `offerVersionId`. That is the property the
 * whole file exists to guarantee: an acceptance of revision 1 must never be
 * readable as acceptance of revision 2, and a link sent for one revision must
 * be inert against another.
 *
 * EXPIRY IS COMPUTED, NOT SCHEDULED. `offer_versions.expiryDate` is
 * authoritative, so expiry is derived from it on every read and enforced on
 * every write. A scheduled job would only be able to *lag* that truth, and
 * §25.11 explicitly warns against creating a job merely because WS-6 exists.
 * WS-6 is therefore used for reminders only, never to determine state.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  offersTable,
  offerVersionsTable,
  offerResponsesTable,
  offerResponseTokensTable,
  applicationsTable,
  candidatesTable,
  type OfferResponse,
  type OfferVersion,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

export class OfferResponseNotAllowedError extends Error {}
export class OfferResponseTokenInvalidError extends Error {
  constructor() {
    // Deliberately uniform for every failure mode — expired, revoked, used,
    // wrong version, wrong organization or simply wrong. A caller probing
    // tokens learns nothing from the message.
    super("This response link is no longer valid");
    this.name = "OfferResponseTokenInvalidError";
  }
}

/** Statuses from which a candidate may still respond. */
const RESPONDABLE_STATUSES = ["issued"] as const;

/** How long a response link stays usable. Independent of the offer's own expiry date. */
const RESPONSE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface OfferVersionState {
  version: OfferVersion;
  /** Derived: past its expiryDate, regardless of stored status. */
  isExpired: boolean;
  /** Derived: this is the offer's current revision. */
  isCurrent: boolean;
  /** Derived: a candidate could respond right now. */
  canRespond: boolean;
  response: OfferResponse | null;
}

function endOfDay(date: Date): number {
  // expiryDate is a DATE column: an offer expiring "on the 5th" is still
  // acceptable throughout the 5th, which is what a candidate would expect.
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}

export function isVersionExpired(version: OfferVersion, now: Date = new Date()): boolean {
  if (!version.expiryDate) return false;
  return now.getTime() > endOfDay(new Date(version.expiryDate));
}

/** Resolves everything a caller needs to decide what may happen to a version. */
export async function getOfferVersionState(organizationId: number, offerVersionId: number): Promise<OfferVersionState | null> {
  const [version] = await db
    .select()
    .from(offerVersionsTable)
    .where(and(eq(offerVersionsTable.id, offerVersionId), eq(offerVersionsTable.organizationId, organizationId)))
    .limit(1);
  if (!version) return null;

  const [offer] = await db
    .select({ currentVersionId: offersTable.currentVersionId })
    .from(offersTable)
    .where(eq(offersTable.id, version.offerId))
    .limit(1);

  const [response] = await db
    .select()
    .from(offerResponsesTable)
    .where(eq(offerResponsesTable.offerVersionId, offerVersionId))
    .limit(1);

  const isExpired = isVersionExpired(version);
  const isCurrent = offer?.currentVersionId === version.id;
  const canRespond =
    isCurrent && !isExpired && !response && (RESPONDABLE_STATUSES as readonly string[]).includes(version.status);

  return { version, isExpired, isCurrent, canRespond, response: response ?? null };
}

/**
 * Shared precondition for every candidate-facing response. Kept in one place
 * so accept and decline cannot drift apart.
 */
async function assertRespondable(organizationId: number, offerVersionId: number): Promise<OfferVersionState> {
  const state = await getOfferVersionState(organizationId, offerVersionId);
  if (!state) throw new OfferResponseNotAllowedError("Offer version not found");
  if (state.response) throw new OfferResponseNotAllowedError("This offer version has already been responded to");
  if (!state.isCurrent) throw new OfferResponseNotAllowedError("This offer has been revised — respond to the current version");
  if (state.version.status === "superseded") throw new OfferResponseNotAllowedError("This offer version has been superseded");
  if (state.version.status === "withdrawn") throw new OfferResponseNotAllowedError("This offer has been withdrawn");
  if (state.isExpired) throw new OfferResponseNotAllowedError("This offer has expired");
  if (!(RESPONDABLE_STATUSES as readonly string[]).includes(state.version.status)) {
    throw new OfferResponseNotAllowedError(`An offer with status "${state.version.status}" cannot be responded to`);
  }
  return state;
}

export interface RecordResponseParams {
  organizationId: number;
  offerVersionId: number;
  responseType: "accepted" | "declined";
  channel: "candidate_token" | "recorded_by_staff";
  reason?: string | null;
  evidence?: unknown;
  respondedByMembershipId?: number | null;
}

/**
 * Records an acceptance or decline and moves the version's status. The
 * conditional UPDATE is the concurrency guard: two simultaneous responses
 * cannot both win, and the loser sees the same "already responded" error a
 * sequential second attempt would.
 */
export async function recordOfferResponse(params: RecordResponseParams): Promise<OfferResponse> {
  await assertRespondable(params.organizationId, params.offerVersionId);

  return db.transaction(async (tx) => {
    let response: OfferResponse;
    try {
      [response] = await tx
        .insert(offerResponsesTable)
        .values({
          organizationId: params.organizationId,
          offerId: (await tx
            .select({ offerId: offerVersionsTable.offerId })
            .from(offerVersionsTable)
            .where(eq(offerVersionsTable.id, params.offerVersionId))
            .limit(1))[0].offerId,
          offerVersionId: params.offerVersionId,
          responseType: params.responseType,
          channel: params.channel,
          reason: params.reason?.trim() || null,
          evidence: params.evidence ?? null,
          respondedByMembershipId: params.respondedByMembershipId ?? null,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new OfferResponseNotAllowedError("This offer version has already been responded to");
      throw err;
    }

    const updated = await tx
      .update(offerVersionsTable)
      .set({ status: params.responseType })
      .where(and(eq(offerVersionsTable.id, params.offerVersionId), eq(offerVersionsTable.status, "issued")))
      .returning({ id: offerVersionsTable.id });
    if (updated.length === 0) throw new OfferResponseNotAllowedError("This offer is no longer awaiting a response");

    // A response settles every outstanding link for this version.
    await tx
      .update(offerResponseTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(offerResponseTokensTable.offerVersionId, params.offerVersionId), isNull(offerResponseTokensTable.revokedAt)));

    return response;
  });
}

/**
 * Records a withdrawal. Distinct from accept/decline because it is an
 * organization action, not a candidate one — and because it is permitted from
 * more states.
 *
 * §25.11: withdrawal after a completed conversion is prevented. The caller
 * supplies `conversionCompleted` because conversion lookup lives in another
 * module; keeping the check here would couple this file to it.
 */
export async function recordOfferWithdrawal(params: {
  organizationId: number;
  offerVersionId: number;
  reason: string;
  respondedByMembershipId: number;
  conversionCompleted: boolean;
}): Promise<OfferResponse> {
  if (!params.reason?.trim()) throw new OfferResponseNotAllowedError("A reason is required to withdraw an offer");
  if (params.conversionCompleted) {
    throw new OfferResponseNotAllowedError(
      "This candidate has already been converted to an employee — an offer cannot be withdrawn afterwards",
    );
  }

  const state = await getOfferVersionState(params.organizationId, params.offerVersionId);
  if (!state) throw new OfferResponseNotAllowedError("Offer version not found");
  if (state.response?.responseType === "withdrawn") throw new OfferResponseNotAllowedError("This offer is already withdrawn");
  if (!["pending_approval", "approved", "issued", "accepted"].includes(state.version.status)) {
    throw new OfferResponseNotAllowedError(`An offer with status "${state.version.status}" cannot be withdrawn`);
  }

  return db.transaction(async (tx) => {
    let response: OfferResponse;
    try {
      [response] = await tx
        .insert(offerResponsesTable)
        .values({
          organizationId: params.organizationId,
          offerId: state.version.offerId,
          offerVersionId: params.offerVersionId,
          responseType: "withdrawn",
          channel: "recorded_by_staff",
          reason: params.reason.trim(),
          respondedByMembershipId: params.respondedByMembershipId,
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new OfferResponseNotAllowedError("This offer version has already been responded to");
      throw err;
    }

    await tx.update(offerVersionsTable).set({ status: "withdrawn" }).where(eq(offerVersionsTable.id, params.offerVersionId));
    await tx
      .update(offerResponseTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(offerResponseTokensTable.offerVersionId, params.offerVersionId), isNull(offerResponseTokensTable.revokedAt)));

    return response;
  });
}

// --- candidate response links -------------------------------------------------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a single-purpose response link for one offer version.
 *
 * The plaintext token is returned ONCE and never stored — only its SHA-256
 * hash is persisted. This deliberately diverges from the existing
 * `applications.statusCheckToken` precedent, which stores its token in
 * plaintext: that token authorizes a read, whereas this one authorizes a
 * decision that changes employment state, so a database disclosure must not
 * yield usable links.
 */
export async function issueResponseToken(params: {
  organizationId: number;
  offerVersionId: number;
  actorMembershipId: number | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const state = await assertRespondable(params.organizationId, params.offerVersionId);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESPONSE_TOKEN_TTL_MS);

  await db.transaction(async (tx) => {
    // Only one live link per version — re-issuing invalidates the previous.
    await tx
      .update(offerResponseTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(offerResponseTokensTable.offerVersionId, params.offerVersionId), isNull(offerResponseTokensTable.revokedAt)));

    await tx.insert(offerResponseTokensTable).values({
      organizationId: params.organizationId,
      offerId: state.version.offerId,
      offerVersionId: params.offerVersionId,
      tokenHash: hashToken(token),
      expiresAt,
      createdByMembershipId: params.actorMembershipId,
    });
  });

  return { token, expiresAt };
}

export interface ResolvedResponseToken {
  organizationId: number;
  offerId: number;
  offerVersionId: number;
  tokenId: number;
}

/**
 * Resolves a presented token to its offer version, or throws a uniform error.
 *
 * The lookup is by hash, so the stored value is never compared against
 * attacker-supplied plaintext directly; the additional constant-time compare
 * guards the (already hashed) equality against timing analysis.
 */
export async function resolveResponseToken(token: string): Promise<ResolvedResponseToken> {
  if (typeof token !== "string" || token.length < 32) throw new OfferResponseTokenInvalidError();
  const hash = hashToken(token);

  const [row] = await db
    .select()
    .from(offerResponseTokensTable)
    .where(eq(offerResponseTokensTable.tokenHash, hash))
    .limit(1);
  if (!row) throw new OfferResponseTokenInvalidError();

  const a = Buffer.from(row.tokenHash, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new OfferResponseTokenInvalidError();

  if (row.revokedAt) throw new OfferResponseTokenInvalidError();
  if (row.usedAt) throw new OfferResponseTokenInvalidError();
  if (row.expiresAt.getTime() < Date.now()) throw new OfferResponseTokenInvalidError();

  return { organizationId: row.organizationId, offerId: row.offerId, offerVersionId: row.offerVersionId, tokenId: row.id };
}

/** Marks a link consumed. Called inside the same request that records the response. */
export async function consumeResponseToken(tokenId: number): Promise<void> {
  const updated = await db
    .update(offerResponseTokensTable)
    .set({ usedAt: new Date() })
    .where(and(eq(offerResponseTokensTable.id, tokenId), isNull(offerResponseTokensTable.usedAt)))
    .returning({ id: offerResponseTokensTable.id });
  // Replay protection: a second concurrent use finds nothing to consume.
  if (updated.length === 0) throw new OfferResponseTokenInvalidError();
}

/** Minimal, candidate-safe view of an offer behind a response link (§25.16 data minimization). */
export async function getCandidateOfferView(offerVersionId: number, organizationId: number) {
  const [row] = await db
    .select({
      offerVersionId: offerVersionsTable.id,
      versionNumber: offerVersionsTable.versionNumber,
      proposedStartDate: offerVersionsTable.proposedStartDate,
      employmentType: offerVersionsTable.employmentType,
      workplaceType: offerVersionsTable.workplaceType,
      location: offerVersionsTable.location,
      conditions: offerVersionsTable.conditions,
      expiryDate: offerVersionsTable.expiryDate,
      status: offerVersionsTable.status,
      candidateFirstName: candidatesTable.firstName,
    })
    .from(offerVersionsTable)
    .innerJoin(offersTable, eq(offersTable.id, offerVersionsTable.offerId))
    .innerJoin(applicationsTable, eq(applicationsTable.id, offersTable.applicationId))
    .innerJoin(candidatesTable, eq(candidatesTable.id, applicationsTable.candidateId))
    .where(and(eq(offerVersionsTable.id, offerVersionId), eq(offerVersionsTable.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/** Revokes outstanding links for versions that are no longer respondable — used when an offer is superseded. */
export async function revokeTokensForVersions(offerVersionIds: number[]): Promise<void> {
  if (offerVersionIds.length === 0) return;
  await db
    .update(offerResponseTokensTable)
    .set({ revokedAt: new Date() })
    .where(and(inArray(offerResponseTokensTable.offerVersionId, offerVersionIds), isNull(offerResponseTokensTable.revokedAt)));
}
