/**
 * Assisted ("on behalf of employee") submission governance — unit tests for the
 * policy/permission/reason gate that sits in front of createSubmission.
 *
 * These are deliberately pure: the gate is the security decision, and it should
 * be provable without a database, a request, or a mocked ORM. The route- and
 * engine-level consequences (provenance columns, event types, tenant scoping,
 * signature authority) are covered by the integration suites.
 *
 * Context for why this exists: the engine ALREADY allowed raising a form for
 * another employee, gated only on `form.assess` — a permission that exists for
 * assessor-stage participation and authorized this by accident, with no reason
 * recorded and no per-template opt-in. D4 narrowed that deliberately.
 */
import { describe, it, expect } from "vitest";
import {
  CREATE_ON_BEHALF_PERMISSION,
  ASSISTANCE_REASONS,
  allowsOnBehalfSubmission,
  authorizeOnBehalf,
  resolveAssistance,
  isAssistanceReason,
  AssistedSubmissionPolicyError,
  AssistedSubmissionValidationError,
} from "../lib/formEngine/assistedSubmission";

const OPEN = { submissionPolicy: { allowOnBehalfSubmission: true } } as never;
const CLOSED = { submissionPolicy: { allowOnBehalfSubmission: false } } as never;
const ABSENT = { submissionPolicy: null } as never;
const perms = (...keys: string[]) => new Set(keys);

describe("version submission policy", () => {
  it("permits assisted completion only when the version explicitly opts in", () => {
    expect(allowsOnBehalfSubmission(OPEN)).toBe(true);
  });

  it("fails closed when the policy is absent — every version published before this field existed", () => {
    expect(allowsOnBehalfSubmission(ABSENT)).toBe(false);
    expect(allowsOnBehalfSubmission({ submissionPolicy: undefined } as never)).toBe(false);
  });

  it("fails closed when the flag is false, missing, or not literally true", () => {
    expect(allowsOnBehalfSubmission(CLOSED)).toBe(false);
    expect(allowsOnBehalfSubmission({ submissionPolicy: {} } as never)).toBe(false);
    // A truthy-but-not-true value must not open the gate.
    for (const v of ["true", 1, "yes", {}, []]) {
      expect(allowsOnBehalfSubmission({ submissionPolicy: { allowOnBehalfSubmission: v } } as never)).toBe(false);
    }
  });

  it("fails closed for a non-object policy, including an array", () => {
    for (const p of ["allow", 42, true, [{ allowOnBehalfSubmission: true }]]) {
      expect(allowsOnBehalfSubmission({ submissionPolicy: p } as never)).toBe(false);
    }
  });
});

describe("assistance reason", () => {
  it("accepts only the constrained vocabulary", () => {
    expect(ASSISTANCE_REASONS).toEqual([
      "system_access_unavailable",
      "medical_or_incapacity",
      "accessibility_assistance",
      "administrative_assistance",
      "other",
    ]);
    for (const r of ASSISTANCE_REASONS) expect(isAssistanceReason(r)).toBe(true);
    for (const r of ["", "OTHER", "sick", null, undefined, 3]) expect(isAssistanceReason(r)).toBe(false);
  });

  it("is mandatory — an assisted creation cannot be unclassified", () => {
    expect(() => resolveAssistance({})).toThrow(AssistedSubmissionValidationError);
    expect(() => resolveAssistance({ reason: undefined })).toThrow(AssistedSubmissionValidationError);
    expect(() => resolveAssistance({ reason: "made it up" })).toThrow(AssistedSubmissionValidationError);
  });

  it('requires notes when the reason is "other", so it cannot become an unaccountable catch-all', () => {
    expect(() => resolveAssistance({ reason: "other" })).toThrow(/Notes are required/);
    expect(() => resolveAssistance({ reason: "other", notes: "   " })).toThrow(/Notes are required/);
    expect(resolveAssistance({ reason: "other", notes: "Employee is overseas until March" })).toEqual({
      assisted: true,
      assistanceReason: "other",
      assistanceNotes: "Employee is overseas until March",
    });
  });

  it("does not require notes for a classified reason, and normalises blank notes to null", () => {
    expect(resolveAssistance({ reason: "medical_or_incapacity" })).toEqual({
      assisted: true,
      assistanceReason: "medical_or_incapacity",
      assistanceNotes: null,
    });
    expect(resolveAssistance({ reason: "accessibility_assistance", notes: "  " }).assistanceNotes).toBeNull();
  });

  it("bounds the note length", () => {
    expect(() => resolveAssistance({ reason: "other", notes: "x".repeat(2001) })).toThrow(/too long/);
    expect(resolveAssistance({ reason: "other", notes: "x".repeat(2000) }).assistanceNotes).toHaveLength(2000);
  });
});

describe("authorizeOnBehalf — the full gate", () => {
  const assistance = { reason: "administrative_assistance" as const };

  it("admits a caller holding the explicit permission on an opted-in version", () => {
    const resolved = authorizeOnBehalf({ permissions: perms(CREATE_ON_BEHALF_PERMISSION), version: OPEN, assistance });
    expect(resolved).toEqual({ assisted: true, assistanceReason: "administrative_assistance", assistanceNotes: null });
  });

  it("D4: form.assess alone no longer authorizes raising a form for another employee", () => {
    // This is the intentional security narrowing. An org_admin or any other
    // form.assess holder without the new key must be refused.
    expect(() => authorizeOnBehalf({ permissions: perms("form.assess"), version: OPEN, assistance })).toThrow(
      AssistedSubmissionPolicyError,
    );
    expect(() => authorizeOnBehalf({ permissions: perms("form.assess"), version: OPEN, assistance })).toThrow(
      /form_submission\.create_on_behalf is required/,
    );
  });

  it("refuses a caller with broad form permissions but not this one", () => {
    const broad = perms("form.read", "form.assess", "form.approve", "form.finalize", "form_template.manage", "form_template.publish");
    expect(() => authorizeOnBehalf({ permissions: broad, version: OPEN, assistance })).toThrow(AssistedSubmissionPolicyError);
  });

  it("refuses an ordinary employee outright", () => {
    expect(() => authorizeOnBehalf({ permissions: perms("form.read"), version: OPEN, assistance })).toThrow(
      AssistedSubmissionPolicyError,
    );
  });

  it("refuses even the permitted caller when the template version has not opted in", () => {
    for (const version of [CLOSED, ABSENT]) {
      expect(() => authorizeOnBehalf({ permissions: perms(CREATE_ON_BEHALF_PERMISSION), version, assistance })).toThrow(
        /does not permit completion on behalf/,
      );
    }
  });

  it("checks permission BEFORE policy, so an unauthorized caller learns nothing about which forms allow assistance", () => {
    // Both wrong: the error must be the permission one, not the policy one.
    expect(() => authorizeOnBehalf({ permissions: perms("form.assess"), version: CLOSED, assistance })).toThrow(
      /form_submission\.create_on_behalf is required/,
    );
  });

  it("still requires a valid reason from an otherwise fully authorized caller", () => {
    expect(() =>
      authorizeOnBehalf({ permissions: perms(CREATE_ON_BEHALF_PERMISSION), version: OPEN, assistance: {} }),
    ).toThrow(AssistedSubmissionValidationError);
    expect(() =>
      authorizeOnBehalf({ permissions: perms(CREATE_ON_BEHALF_PERMISSION), version: OPEN, assistance: { reason: "other" } }),
    ).toThrow(/Notes are required/);
  });
});
