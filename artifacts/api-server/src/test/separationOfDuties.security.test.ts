/**
 * WS-18 Pass 4, finding WS18-P4-02 — separation-of-duties must fail CLOSED when
 * the maker cannot be identified.
 *
 * Every maker-checker guard in this codebase compared an attribution column with
 * `===`. Each of those columns carries a foreign key declared `ON DELETE SET
 * NULL`, so deleting the maker's membership or user — routine offboarding —
 * rewrote the attribution to `null`, and `null === <approver id>` is `false`.
 * The guard did not fail; it stopped existing, and the same human could approve
 * their own payroll run.
 *
 * Proven live during Pass 4 against a disposable stack: deleting the preparer's
 * membership changed `preparedBy=4` to `preparedBy=NULL` on a `calculated` run,
 * after which the self-approval branch was unreachable.
 *
 * These tests pin the predicate itself. They are deliberately at the pure-
 * function level: the property is not "one route rejects one payload", it is
 * "an unknown maker is never treated as a different person", and that must hold
 * identically at all five call sites (payroll run approve, payroll run lock,
 * payroll correction approve, service request approve, data change approve).
 */
import { describe, it, expect } from "vitest";
import {
  violatesSeparationOfDuties,
  violatesSeparationOfDutiesMulti,
} from "../lib/separationOfDuties";

describe("WS18-P4-02 — single-identity separation of duties", () => {
  it("allows a genuinely different actor (positive control)", () => {
    // Without this passing, every refusal below would be meaningless — a
    // predicate that always refuses proves nothing.
    expect(violatesSeparationOfDuties(4, 5)).toBe(false);
  });

  it("refuses self-approval", () => {
    expect(violatesSeparationOfDuties(4, 4)).toBe(true);
  });

  it("refuses when the maker is NULL — the offboarding case", () => {
    // This is the whole finding: before the fix this returned false, and the
    // caller silently approved.
    expect(violatesSeparationOfDuties(null, 5)).toBe(true);
  });

  it("refuses when the maker is undefined", () => {
    expect(violatesSeparationOfDuties(undefined, 5)).toBe(true);
  });

  it("refuses when the actor is unknown", () => {
    expect(violatesSeparationOfDuties(4, null)).toBe(true);
    expect(violatesSeparationOfDuties(4, undefined)).toBe(true);
  });

  it("refuses when both are unknown", () => {
    expect(violatesSeparationOfDuties(null, null)).toBe(true);
  });

  it("does not treat id 0 as unknown", () => {
    // `== null` rather than falsiness matters: a legitimate id of 0 must still
    // compare as an identity, not be mistaken for a missing maker.
    expect(violatesSeparationOfDuties(0, 0)).toBe(true);
    expect(violatesSeparationOfDuties(0, 5)).toBe(false);
  });
});

describe("WS18-P4-02 — multi-identity separation of duties", () => {
  const pair = (makerId: number | null, actorId: number | null) => ({ makerId, actorId });

  it("allows when every verifiable identity names a different principal", () => {
    expect(
      violatesSeparationOfDutiesMulti([pair(10, 11), pair(20, 21)]),
    ).toBe(false);
  });

  it("refuses when the user identity matches", () => {
    expect(violatesSeparationOfDutiesMulti([pair(10, 10), pair(20, 21)])).toBe(true);
  });

  it("refuses when only the membership identity matches", () => {
    // The second-membership loophole: same human, different user-level id.
    expect(violatesSeparationOfDutiesMulti([pair(10, 11), pair(20, 20)])).toBe(true);
  });

  it("refuses when NO identity pair is verifiable — the offboarding case", () => {
    // Both attribution columns nulled by ON DELETE SET NULL. Before the fix,
    // neither arm matched and the request was approved.
    expect(violatesSeparationOfDutiesMulti([pair(null, 11), pair(null, 21)])).toBe(true);
  });

  it("still allows when one pair is unverifiable but another proves difference", () => {
    // A partially-attributed record is fine as long as something can actually
    // be checked and it shows two different principals.
    expect(violatesSeparationOfDutiesMulti([pair(null, 11), pair(20, 21)])).toBe(false);
  });

  it("refuses when the only verifiable pair is a self-match", () => {
    expect(violatesSeparationOfDutiesMulti([pair(null, 11), pair(20, 20)])).toBe(true);
  });

  it("refuses an empty identity set", () => {
    expect(violatesSeparationOfDutiesMulti([])).toBe(true);
  });
});
