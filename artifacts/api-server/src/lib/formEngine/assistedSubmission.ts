/**
 * Assisted ("on behalf of employee") submission governance.
 *
 * The engine could ALREADY raise a submission for another employee — the create
 * route gated it on `form.assess`, a permission that exists for assessor-stage
 * participation and authorized this only by accident. There was no reason
 * recorded, no per-template opt-in, and nothing marking the resulting submission
 * as assisted rather than self-completed. This module is the governance layer
 * over that behaviour; it does not add a new capability so much as make an
 * existing one accountable.
 *
 * What it deliberately does NOT do:
 *  - impersonate. `form_submissions.subjectEmployeeId` (whose form it is) and
 *    `createdByMembershipId` (who actually raised it) are separate columns and
 *    stay that way; every revision additionally records `savedByMembershipId`.
 *  - touch signatures. Slot authority is `membershipSatisfiesFormStage`, which
 *    for `subject_employee` resolves to the subject's OWN membership, so an
 *    assisting HR user still cannot sign the employee's slot. No waiver exists
 *    and none is introduced here.
 *  - cross tenants. `createSubmission` already requires the subject employee to
 *    belong to the same organization.
 */
import type { FormTemplateVersion } from "@workspace/db";

/** The permission that authorizes raising a form for someone else. */
export const CREATE_ON_BEHALF_PERMISSION = "form_submission.create_on_behalf";

export const ASSISTANCE_REASONS = [
  "system_access_unavailable",
  "medical_or_incapacity",
  "accessibility_assistance",
  "administrative_assistance",
  "other",
] as const;

export type AssistanceReason = (typeof ASSISTANCE_REASONS)[number];

export function isAssistanceReason(value: unknown): value is AssistanceReason {
  return typeof value === "string" && (ASSISTANCE_REASONS as readonly string[]).includes(value);
}

export class AssistedSubmissionPolicyError extends Error {}
export class AssistedSubmissionValidationError extends Error {}

/**
 * Version-level submission policy. FAIL CLOSED at every step: a null policy, a
 * non-object policy, a missing key, or anything that is not literally `true`
 * all mean "not allowed". Every version published before this field existed
 * therefore stays closed until a new version deliberately opens it — which is
 * the whole point of putting the switch on the immutable version rather than on
 * the mutable template.
 */
export function allowsOnBehalfSubmission(version: Pick<FormTemplateVersion, "submissionPolicy">): boolean {
  const policy = version.submissionPolicy;
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return false;
  return (policy as Record<string, unknown>).allowOnBehalfSubmission === true;
}

export interface AssistanceInput {
  reason?: unknown;
  notes?: unknown;
}

export interface ResolvedAssistance {
  assisted: true;
  assistanceReason: AssistanceReason;
  assistanceNotes: string | null;
}

/**
 * Validates the assistance declaration that must accompany an on-behalf
 * creation. Reason is mandatory and constrained; free text is accepted only as
 * supporting notes, and is REQUIRED when the reason is "other" (otherwise
 * "other" would be an unaccountable catch-all).
 */
export function resolveAssistance(input: AssistanceInput): ResolvedAssistance {
  if (!isAssistanceReason(input.reason)) {
    throw new AssistedSubmissionValidationError(
      `An assistance reason is required, and must be one of: ${ASSISTANCE_REASONS.join(", ")}`,
    );
  }
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (input.reason === "other" && notes.length === 0) {
    throw new AssistedSubmissionValidationError('Notes are required when the assistance reason is "other"');
  }
  if (notes.length > 2000) {
    throw new AssistedSubmissionValidationError("Assistance notes are too long (2000 characters maximum)");
  }
  return { assisted: true, assistanceReason: input.reason, assistanceNotes: notes.length > 0 ? notes : null };
}

/**
 * The full gate for raising a form for someone other than yourself.
 *
 * Order matters and is deliberate: permission first (so a caller without the
 * capability learns nothing about which templates permit assistance), then the
 * version policy, then the assistance declaration. Tenant scoping is not
 * repeated here because createSubmission enforces it against the database,
 * which is the only place it can be enforced truthfully.
 */
export function authorizeOnBehalf(params: {
  permissions: ReadonlySet<string>;
  version: Pick<FormTemplateVersion, "submissionPolicy">;
  assistance: AssistanceInput;
}): ResolvedAssistance {
  if (!params.permissions.has(CREATE_ON_BEHALF_PERMISSION)) {
    throw new AssistedSubmissionPolicyError(
      `${CREATE_ON_BEHALF_PERMISSION} is required to complete a form on behalf of another employee`,
    );
  }
  if (!allowsOnBehalfSubmission(params.version)) {
    throw new AssistedSubmissionPolicyError("This form does not permit completion on behalf of an employee");
  }
  return resolveAssistance(params.assistance);
}
