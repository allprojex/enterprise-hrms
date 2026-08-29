import { recordAuditEvent } from "./auditLog";

/**
 * WS-12 (§28.12) — Owner Decision #18's sensitive-read auditing.
 *
 * OD #18 approved risk-based auditing of reads of "Personnel Files,
 * disciplinary/grievance evidence, sensitive exports, banking, statutory
 * identifiers, privileged support access". §28.1(9) recorded the uncomfortable
 * finding that it had never been implemented for ANY of them: a repository-wide
 * search for a read-shaped audit event type found none, so every one of the
 * ~340 existing audit call sites records a MUTATION and nothing records a look.
 * WS-12 closes that for the data §28 puts in scope.
 *
 * THIS IS NOT A SECOND AUDIT SYSTEM. It is a thin, deliberate front door onto
 * WS-3's `recordAuditEvent` (OD #16 forbids a parallel system). All it adds is a
 * consistent event-type shape and a place to state the rule below.
 *
 * "RISK-BASED, NOT NOISY" IS A REAL CONSTRAINT, NOT A DISCLAIMER. OD #18 says so
 * explicitly, and §28.12 repeats it: do not over-classify ordinary HR reads for
 * convenience. So this is called on a genuinely narrow set of paths:
 *
 *   - opening a specific disciplinary case or grievance case record
 *   - listing or downloading evidence attached to one
 *
 * It is deliberately NOT called on: the case LIST endpoints (a caller who may
 * see the queue is not thereby reading anybody's evidence), the offboarding and
 * clearance surfaces (they are operational, not confidential-evidence reads),
 * the reporting read models (aggregate, and already permission-filtered), or
 * any employee's read of their own grievance status through ESS — auditing an
 * employee for looking at their own complaint would be its own kind of wrong.
 *
 * A failure here must never break the read it is describing: the audit write is
 * best-effort in the same way `recordAuditEvent` already is for its callers.
 */

/** The record kinds §28 classifies as sensitive for read purposes. */
export type SensitiveReadTargetType =
  | "disciplinary_case"
  | "grievance_case"
  | "employee_relations_evidence"
  // WS-14 (§30.17) — succession is confidential HR information, and OD #18 is
  // reused here rather than a second read-audit subsystem being built. Only
  // these three reads are classified sensitive: opening a plan, reading its
  // candidate list, and reading a confidential note or rationale. Listing which
  // positions have plans is NOT sensitive, for the same "risk-based, not noisy"
  // reason the disciplinary LIST endpoint is excluded above.
  | "succession_plan"
  | "succession_candidate";

export interface SensitiveReadInput {
  organizationId: number;
  actorApplicationUserId: number;
  actorMembershipId: number | null;
  targetType: SensitiveReadTargetType;
  targetId: number;
  /** The employee the record concerns, so an audit reader can answer "who was looked at?". */
  subjectEmployeeId?: number | null;
  /**
   * Why this read is classified sensitive — the confidentiality tier of the
   * record, or the evidence relationship. Kept small: metadata here must never
   * become a copy of the confidential content the read returned.
   */
  reason?: string | null;
}

/**
 * Records that somebody READ a sensitive Employee Relations record.
 *
 * The event type is `<targetType>.read`, so it lands in the "hr" audit category
 * through the existing prefix map with no special-casing anywhere — see
 * auditCategories.ts for why "hr" rather than "security" is deliberate.
 */
export async function recordSensitiveRead(input: SensitiveReadInput): Promise<void> {
  await recordAuditEvent({
    actorApplicationUserId: input.actorApplicationUserId,
    actorMembershipId: input.actorMembershipId,
    organizationId: input.organizationId,
    eventType: `${input.targetType}.read`,
    targetType: input.targetType,
    targetId: String(input.targetId),
    // No before/after state: nothing changed, and copying the record into its
    // own audit trail would put confidential content somewhere with different
    // read rules from the record itself.
    metadata: {
      sensitiveRead: true,
      ...(input.subjectEmployeeId != null ? { employeeId: input.subjectEmployeeId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    outcome: "success",
  });
}

/**
 * Records that a sensitive read was REFUSED.
 *
 * Worth capturing separately: a denied attempt on somebody's grievance file is
 * exactly the signal an audit reader wants, and it is invisible if only
 * successful reads are recorded.
 */
export async function recordSensitiveReadDenied(input: SensitiveReadInput): Promise<void> {
  await recordAuditEvent({
    actorApplicationUserId: input.actorApplicationUserId,
    actorMembershipId: input.actorMembershipId,
    organizationId: input.organizationId,
    eventType: `${input.targetType}.read`,
    targetType: input.targetType,
    targetId: String(input.targetId),
    metadata: {
      sensitiveRead: true,
      ...(input.subjectEmployeeId != null ? { employeeId: input.subjectEmployeeId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    outcome: "denied",
  });
}
