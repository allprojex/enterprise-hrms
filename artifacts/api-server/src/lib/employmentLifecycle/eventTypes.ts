/**
 * WS-11 — the registry of SYSTEM-GENERATED employment lifecycle event types
 * (see docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md §27.4, §27.15, §27.19).
 *
 * §27.22 ITEM 4 RESOLVED — THIS LIVES BESIDE THE SERVICE, NOT IN @workspace/db.
 * It governs what the *server may write*, not what the *column may hold*.
 * `employment_periods.eventType` is `text` and stays `text`: placing a closed
 * list next to the schema would imply a database constraint that deliberately
 * does not exist, and would invite someone to "finish the job" by adding an
 * enum. WS-6's job-handler registry sits in api-server for the same reason.
 *
 * WHY NO DATABASE ENUM (§27.4). WS-7's employment-history import adapter
 * accepts arbitrary historical `eventType` strings by design — its own comment
 * refuses to "force an imported history row into a stricter taxonomy than the
 * domain itself enforces". Arbitrary strings therefore already exist in
 * production data. An enum would invalidate real customer history.
 *
 * THE RESULTING SPLIT, which the rest of this module depends on:
 *
 *   SYSTEM events    — written only through the lifecycle services, always a
 *                      registered type, shape-validated, and the ONLY events
 *                      permitted to participate in state derivation.
 *   IMPORTED/legacy  — preserved, readable, rendered as-is, and inert. Never
 *                      rejected, never rewritten, never reinterpreted, never
 *                      capable of causing a side effect (§27.19).
 */

/** Event types that existed before WS-11. Unchanged; listed so the registry is complete. */
export const PRE_EXISTING_EVENT_TYPES = ["transfer", "promotion", "confirmation"] as const;

/** Event types WS-11 adds, exactly as enumerated in §27.2. */
export const WS11_EVENT_TYPES = [
  "separation",
  "rehire",
  "probation_extension",
  "probation_unsuccessful",
  "contract_renewal",
  "acting_start",
  "acting_end",
  "secondment_start",
  "secondment_end",
] as const;

export const SYSTEM_EVENT_TYPES = [...PRE_EXISTING_EVENT_TYPES, ...WS11_EVENT_TYPES] as const;

export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

const SYSTEM_EVENT_TYPE_SET: ReadonlySet<string> = new Set(SYSTEM_EVENT_TYPES);

/**
 * Whether a stored event was written by this platform's own lifecycle services.
 *
 * A `false` result is NOT an error and must never be treated as one: it is the
 * ordinary answer for legitimate imported history. Callers use it to decide
 * whether an event may influence state (it may not) — never to decide whether
 * the event is valid.
 */
export function isSystemEventType(eventType: string): eventType is SystemEventType {
  return SYSTEM_EVENT_TYPE_SET.has(eventType);
}

export class UnregisteredLifecycleEventError extends Error {
  constructor(eventType: string) {
    super(
      `"${eventType}" is not a registered system lifecycle event type. ` +
        `Imported history may contain any event type, but the platform may only WRITE a registered one.`,
    );
    this.name = "UnregisteredLifecycleEventError";
  }
}

/**
 * Guards the write path. Every system-generated lifecycle event passes through
 * here, so a caller cannot invent an event type — which is what stops a client
 * from fabricating, say, a "confirmation" through a generic endpoint.
 */
export function assertSystemEventType(eventType: string): asserts eventType is SystemEventType {
  if (!isSystemEventType(eventType)) throw new UnregisteredLifecycleEventError(eventType);
}

/**
 * The fields each system event is expected to carry in `newState`.
 *
 * Deliberately a *shape* check (§27.4 item 4), not a value check: it keeps a
 * controlled event carrying what its consumers need, without turning this into
 * a second validation engine that would drift from the services themselves.
 */
const REQUIRED_NEW_STATE_KEYS: Partial<Record<SystemEventType, readonly string[]>> = {
  separation: ["employmentStatus", "separationDate"],
  rehire: ["employmentStatus"],
  probation_extension: ["previousProbationEndDate", "newProbationEndDate"],
  probation_unsuccessful: ["outcome"],
  contract_renewal: ["employmentTermId", "startDate"],
  acting_start: ["assignmentId"],
  acting_end: ["assignmentId"],
  secondment_start: ["assignmentId"],
  secondment_end: ["assignmentId"],
};

export class LifecycleEventShapeError extends Error {
  constructor(eventType: string, missing: readonly string[]) {
    super(`A "${eventType}" lifecycle event is missing required newState fields: ${missing.join(", ")}`);
    this.name = "LifecycleEventShapeError";
  }
}

export function assertNewStateShape(eventType: SystemEventType, newState: unknown): void {
  const required = REQUIRED_NEW_STATE_KEYS[eventType];
  if (!required || required.length === 0) return;
  const record = (newState ?? {}) as Record<string, unknown>;
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(record, key));
  if (missing.length > 0) throw new LifecycleEventShapeError(eventType, missing);
}

/**
 * A human-readable label for a history row.
 *
 * An unregistered (imported) type falls back to its raw string rather than
 * being hidden or rejected — §27.19 requires imported history to remain
 * readable, and the existing UI already renders the raw value.
 */
export function labelForEventType(eventType: string): string {
  const labels: Record<SystemEventType, string> = {
    transfer: "Transfer",
    promotion: "Promotion",
    confirmation: "Confirmation",
    separation: "Separation",
    rehire: "Rehire",
    probation_extension: "Probation extended",
    probation_unsuccessful: "Probation outcome — unsuccessful",
    contract_renewal: "Contract renewal",
    acting_start: "Acting appointment started",
    acting_end: "Acting appointment ended",
    secondment_start: "Secondment started",
    secondment_end: "Secondment ended",
  };
  return isSystemEventType(eventType) ? labels[eventType] : eventType;
}
