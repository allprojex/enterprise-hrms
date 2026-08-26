/**
 * WS-6 (§16) — the shared deadline/overdue primitive.
 *
 * This is deliberately a pure computation, not a table. Overdue state is
 * derived from `dueAt + completion state + current time` on demand, rather
 * than a persisted `overdue = true` flag any domain module would otherwise
 * need to remember to update — matching the brief's explicit preference:
 * "prefer deriving overdue state... rather than permanently mutating a flag
 * unless a persisted flag has a clear performance/business need." No such
 * need exists yet for any consumer, so nothing is persisted here.
 *
 * WS-6 does not own any domain due-date column (a contract's end date, a
 * probation period's end, a document's expiry date all belong to their own
 * domain tables — see WS-5's `organization_document_versions.expiryDate` for
 * an example already in the codebase). This function is the shared
 * vocabulary a future domain module applies to its own due-date column; it
 * is called directly by nothing in WS-6 itself except its own test and the
 * optional WS-5 integration proof in documentGeneration... (see
 * documentExpiryReminderSample.test.ts).
 */

export type DeadlineState = "upcoming" | "due" | "overdue" | "completed";

export interface DeadlineStatusInput {
  /** When the underlying obligation is due. */
  dueAt: Date;
  /** When it was actually completed/cleared, if it has been. */
  completedAt?: Date | null;
  /** The instant to evaluate against — always pass this explicitly (§55: no hidden `new Date()` inside logic under test). */
  asOf: Date;
  /**
   * How long before `dueAt` the state becomes "due" rather than "upcoming".
   * Zero means there is no separate "due" window — the state jumps directly
   * from "upcoming" to "overdue" at `dueAt`.
   */
  dueWindowMs?: number;
}

/**
 * `completed` wins regardless of timing — a deadline met late is still met,
 * never "overdue" forever after the fact. Otherwise: strictly after `dueAt`
 * is `overdue`; within `dueWindowMs` before `dueAt` (inclusive) is `due`;
 * anything earlier is `upcoming`.
 */
export function computeDeadlineStatus(input: DeadlineStatusInput): DeadlineState {
  if (input.completedAt) return "completed";

  const dueAtMs = input.dueAt.getTime();
  const asOfMs = input.asOf.getTime();
  const dueWindowMs = input.dueWindowMs ?? 0;

  if (asOfMs > dueAtMs) return "overdue";
  if (asOfMs >= dueAtMs - dueWindowMs) return "due";
  return "upcoming";
}
