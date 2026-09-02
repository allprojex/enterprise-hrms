/**
 * WS-18 Pass 4, finding WS18-P4-02 — separation-of-duties comparisons must fail
 * CLOSED when the maker cannot be identified.
 *
 * ## The defect this exists to prevent
 *
 * Every maker-checker guard in this codebase was written as a direct equality:
 *
 *     if (run.preparedByMembershipId === params.approverMembershipId) throw ...
 *
 * That reads correctly and is correct — right up until the left side is `null`.
 * Every attribution column these guards compare (`prepared_by_membership_id`,
 * `created_by_membership_id`, `created_by`, `requested_by_user_id`, …) carries a
 * foreign key declared `ON DELETE SET NULL`. So when the maker's membership or
 * user row is deleted — which is what routine offboarding does — the database
 * quietly rewrites the attribution to `null`, and `null === 5` is `false`.
 *
 * The guard does not fail. It stops existing. The same human can then approve
 * the payroll run they prepared, and nothing anywhere reports that a financial
 * control was dropped. Confirmed live during Pass 4 against a disposable stack:
 * deleting the preparer's membership changed `preparedBy=4` to `preparedBy=NULL`
 * and the self-approval branch became unreachable.
 *
 * This is not primarily an attack path — it is a control that decays through
 * ordinary HR activity. An attacker with membership-management rights can also
 * trigger it deliberately, which is worse, because maker-checker exists
 * precisely to constrain privileged insiders.
 *
 * ## The rule
 *
 * An unidentifiable maker is not a permissive default. If we cannot prove the
 * approver is a different person from the maker, we must refuse — the same
 * fail-closed posture this codebase already applies to tenant resolution
 * (`shouldFailClosedForTenantResolution`) when it cannot determine tenancy.
 *
 * The practical consequence is deliberate: a run whose preparer has been
 * offboarded can no longer be approved as-is. That is the correct outcome. The
 * record no longer supports the claim "two different people handled this", and
 * re-preparing it under a current maker restores a claim that is actually true.
 */

/**
 * True when a separation-of-duties guard must refuse.
 *
 * Refuses in two cases, which callers should treat identically:
 *   - the maker is unknown (`null`/`undefined`) — unverifiable, so not allowed;
 *   - the maker and the actor are the same principal — self-approval.
 *
 * `makerId` and `actorId` must be the same KIND of identifier (both membership
 * ids, or both user ids). Comparing a membership id to a user id would silently
 * never match, which is the same class of bug this module exists to stop.
 */
export function violatesSeparationOfDuties(
  makerId: number | null | undefined,
  actorId: number | null | undefined,
): boolean {
  if (makerId == null || actorId == null) return true;
  return makerId === actorId;
}

/**
 * Multi-identity variant, for records that attribute a maker by BOTH user and
 * membership (data change requests, service requests).
 *
 * Refuses unless at least one identity pair is fully known AND every known pair
 * shows a different principal. Requiring one *verifiable* pair is what stops an
 * all-null record from sliding through; checking every known pair is what stops
 * the same human approving through a second identity.
 */
export function violatesSeparationOfDutiesMulti(
  pairs: Array<{ makerId: number | null | undefined; actorId: number | null | undefined }>,
): boolean {
  const verifiable = pairs.filter((p) => p.makerId != null && p.actorId != null);
  if (verifiable.length === 0) return true;
  return verifiable.some((p) => p.makerId === p.actorId);
}
