/**
 * WS-15 — the HR Action Centre's normalized contract (§31.6).
 *
 * THIS FILE DEFINES A POINTER, NOT A COPY. A row carries only enough to
 * identify work and navigate to it. The source module remains authoritative for
 * real state, and §31.14 forbids narrative, evidence, readiness, pay data,
 * proposed sensitive values and confidential document content in every field
 * below — including `title`, which is a generic operational label and never a
 * summary of content.
 *
 * WHAT IS DELIBERATELY ABSENT IS AS FROZEN AS WHAT IS PRESENT (§31.6):
 * no arbitrary metadata blob, no source payload passthrough, no WS-15-minted
 * lifecycle, no universal priority or severity (§31.17), and no assignee
 * identity beyond what Assigned Work needs. If a future change wants one of
 * these, that is an architecture change and needs an Owner Decision — not a
 * field added here because a screen would look better with it.
 */

/** Fixed vocabulary (§31.6). Never free text, and never a table or module path from a client. */
export type ActionSourceModule =
  | "leave"
  | "learning"
  | "onboarding"
  | "skills"
  | "performance"
  | "recruitment"
  | "employee_requests"
  | "employee_relations"
  | "succession"
  | "employment_lifecycle";

/** What is being asked of the actor. Not a workflow state — the source owns state. */
export type ActionKind = "approve" | "complete" | "verify" | "review" | "decide" | "fulfil" | "acknowledge";

/**
 * The four inline commands §31.8 allows, and nothing else.
 *
 * This is a CLOSED VOCABULARY, and the closure is the security property: the
 * command endpoint validates against this union before it does anything at all,
 * so a client can never name a module, table or method (§31.33).
 */
export const INLINE_COMMANDS = [
  "leave.approve",
  "leave.reject",
  "learning.approve",
  "learning.reject",
  "onboarding.complete",
  "skill.verify",
  "skill.reject",
] as const;

export type InlineCommand = (typeof INLINE_COMMANDS)[number];

export function isInlineCommand(value: string): value is InlineCommand {
  return (INLINE_COMMANDS as readonly string[]).includes(value);
}

/** §31.19's scopes. `assigned` exists only for sources with a genuine assignment concept (§31.10). */
export type ActionScope = "my_actions" | "assigned" | "oversight";

/** §31.16's tri-state. `undated` is a real answer, never a synonym for "on time". */
export type DueState = "overdue" | "due_soon" | "undated";

/** The frozen row. These fields and no others (§31.6). */
export interface ActionItem {
  sourceModule: ActionSourceModule;
  /** The source's own resource kind, e.g. `leave_request`, `onboarding_task`. */
  sourceType: string;
  /** The source record's own existing id. Never a WS-15-minted identifier. */
  sourceId: number;
  actionKind: ActionKind;
  /** A safe, generic operational label. §31.14 governs — never narrative. */
  title: string;
  /** Present only where the actor may already see that employee through the source (§31.6). */
  employeeId: number | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  /** The source's own status string, passed through and never re-mapped (§31.6). */
  status: string;
  createdAt: Date;
  /** The source's own authoritative date. `null` where the source has none (§31.16). */
  dueAt: Date | null;
  /**
   * Derived from `dueAt`. **`null` where `dueAt` is `null`** — "not overdue" and
   * "no concept of overdue" are different statements and a UI must be able to
   * tell them apart (§31.16). Never `false` merely because a date is absent.
   */
  overdue: boolean | null;
  /** Route into the owning module's own surface. The destination re-gates. */
  deepLink: string;
  /** Allow-listed command identifiers. Empty for every deep-link-only item (§31.9). */
  inlineCommands: InlineCommand[];
}

/**
 * A provider's outcome.
 *
 * THE THREE STATES ARE NOT INTERCHANGEABLE, AND THE DIFFERENCE IS THE WHOLE
 * CONFIDENTIALITY MODEL (§31.19, §31.22):
 *
 *   `ok`     — the actor is authorized; the item list is complete, and `0` items
 *              genuinely means "nothing to do".
 *   `hidden` — the module is disabled OR the actor lacks its permission. These
 *              are deliberately INDISTINGUISHABLE, and the source is omitted
 *              entirely: no row, no count, no zero. A zero would assert that the
 *              module exists and is empty, which is itself a disclosure.
 *   `failed` — the actor IS authorized, but querying the source failed
 *              operationally. Reported by name, because a queue that quietly
 *              under-reports is worse than one that admits it is incomplete.
 *
 * A `failed` outcome is only ever reachable AFTER authorization succeeded — see
 * the `authorize`/`query` split below. That is what keeps the named-failure
 * signal from disclosing the existence of a module the actor may not see.
 */
export type ProviderOutcome =
  | { state: "ok"; items: ActionItem[] }
  | { state: "hidden" }
  | { state: "failed" };

export interface ProviderContext {
  organizationId: number;
  applicationUserId: number;
  membershipId: number;
  scope: ActionScope;
}

/**
 * The bounded adapter contract (§31.5).
 *
 * The `authorize` / `query` SPLIT IS DELIBERATE AND LOAD-BEARING. Authorization
 * failures must collapse to `hidden` and disclose nothing; only a failure of the
 * state query — reached only once the actor is known to be authorized — may be
 * named as unavailable. Collapsing both into one try/catch would let an
 * operational error inside a permission check disclose that a protected module
 * exists.
 *
 * A provider calls its module's EXISTING service functions. Nothing here
 * authorizes restructuring a module, and nothing here generalizes authority
 * resolution or delegation — that is OD #14/#15 and belongs to WS-16 (§31.5).
 */
export interface ActionProvider {
  sourceModule: ActionSourceModule;
  /**
   * Organization scope, module enablement and the source's own permission.
   * Returns false — never throws for an authorization reason — when the actor
   * may not see this source at all.
   */
  authorize(ctx: ProviderContext): Promise<boolean>;
  /** Current authoritative work, already safe-mapped. May throw; the aggregator isolates it. */
  query(ctx: ProviderContext): Promise<ActionItem[]>;
}

/** What the aggregator returns. */
export interface ActionCentreResult {
  items: ActionItem[];
  /**
   * Sources the actor is authorized for whose work could not be loaded (§31.22).
   * Never contains a source the actor may not see.
   */
  unavailableSources: ActionSourceModule[];
}

export interface ActionCentreCounts {
  total: number;
  overdue: number;
  /** Only for sources that returned `ok`. A hidden source is absent, never zero (§31.19). */
  byModule: { sourceModule: ActionSourceModule; count: number }[];
  unavailableSources: ActionSourceModule[];
}

/** Derives §31.16's tri-state. `null` in, `null` out — never a fabricated `false`. */
export function deriveOverdue(dueAt: Date | null, asOf: Date): boolean | null {
  if (dueAt == null) return null;
  return dueAt.getTime() < asOf.getTime();
}

export function dueStateOf(item: ActionItem): DueState {
  if (item.dueAt == null) return "undated";
  return item.overdue ? "overdue" : "due_soon";
}
