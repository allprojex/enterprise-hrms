import { logger } from "../logger";
import { P1_PROVIDERS, ASSIGNABLE_PROVIDERS } from "./providers";
import {
  type ActionCentreCounts,
  type ActionCentreResult,
  type ActionItem,
  type ActionProvider,
  type ActionScope,
  type ActionSourceModule,
  type DueState,
  type ProviderContext,
  type ProviderOutcome,
  dueStateOf,
} from "./types";

/**
 * WS-15 — the federation aggregator (§31.4).
 *
 * EVERY REQUEST RECOMPUTES FROM SOURCE. Nothing is stored, nothing is cached
 * and nothing is reconciled, which is precisely why a changed membership,
 * permission, reporting manager, delegation, stage, assignment or source status
 * is reflected on the very next call with nothing to invalidate (§31.4, §31.7).
 *
 * THREE OUTCOMES, TREATED DIFFERENTLY ON PURPOSE (§31.19, §31.22):
 *
 *   hidden  — omitted entirely. No row, no count, NOT a zero. A zero would
 *             assert the module exists and is empty, which is itself the
 *             disclosure §31.11 forbids, and it is the mechanism by which an
 *             org_admin could otherwise infer that a grievance or a succession
 *             plan exists.
 *   failed  — named in `unavailableSources`. Reachable only after authorization
 *             SUCCEEDED, so naming it never discloses a module the actor may
 *             not see.
 *   ok      — items included; `0` genuinely means nothing to do.
 *
 * Counts come from the same filtered item list as rows — there is deliberately
 * no second counting query that could drift from the row query's permissions
 * (§31.19).
 */

export interface ActionCentreQuery {
  scope: ActionScope;
  sourceModule?: ActionSourceModule;
  actionKind?: string;
  status?: string;
  dueState?: DueState;
  employeeId?: number;
}

/**
 * Runs one provider with the authorize/query split.
 *
 * An authorization failure — returned false OR thrown — collapses to `hidden`.
 * Throwing during authorization is treated as hidden rather than failed on
 * purpose: an operational error inside a permission check must not become a
 * signal that a protected module exists.
 */
async function runProvider(provider: ActionProvider, ctx: ProviderContext): Promise<ProviderOutcome> {
  let authorized = false;
  try {
    authorized = await provider.authorize(ctx);
  } catch (err) {
    logger.error(
      { err, sourceModule: provider.sourceModule, organizationId: ctx.organizationId },
      "action centre provider authorization failed",
    );
    return { state: "hidden" };
  }
  if (!authorized) return { state: "hidden" };

  try {
    return { state: "ok", items: await provider.query(ctx) };
  } catch (err) {
    // The real failure is logged server-side through the existing observability
    // convention; the client is told only which source is unavailable, never
    // why (§31.22 — no stack trace, no internal detail).
    logger.error(
      { err, sourceModule: provider.sourceModule, organizationId: ctx.organizationId },
      "action centre provider query failed",
    );
    return { state: "failed" };
  }
}

/**
 * §31.18's deterministic four-tier order.
 *
 * Overdue first by how overdue, then due-soon by how soon, then undated oldest
 * first. Undated work is never given fabricated urgency and never mixes into
 * the overdue tier. This departs from Manager Portal's `createdAt DESC` for the
 * reason §31.18 records: that surface has no due dates, and surfacing the newest
 * item above a three-week-overdue one would be the wrong operational answer.
 */
type SortableItem = Pick<ActionItem, "dueAt" | "overdue" | "createdAt" | "sourceId"> & { sourceModule: string };

function tierOf(item: SortableItem): number {
  if (item.dueAt == null) return 2;
  return item.overdue ? 0 : 1;
}

export function sortActionItems<T extends SortableItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const tierDiff = tierOf(a) - tierOf(b);
    if (tierDiff !== 0) return tierDiff;

    if (a.dueAt != null && b.dueAt != null) {
      const byDue = a.dueAt.getTime() - b.dueAt.getTime();
      if (byDue !== 0) return byDue;
    }

    const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
    const byModule = a.sourceModule.localeCompare(b.sourceModule);
    if (byModule !== 0) return byModule;
    return a.sourceId - b.sourceId;
  });
}

/** Filters apply AFTER permission filtering, never instead of it (§31.19). */
function applyFilters(items: ActionItem[], query: ActionCentreQuery): ActionItem[] {
  return items.filter((item) => {
    if (query.sourceModule && item.sourceModule !== query.sourceModule) return false;
    if (query.actionKind && item.actionKind !== query.actionKind) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.dueState && dueStateOf(item) !== query.dueState) return false;
    // An employee filter narrows what the actor may ALREADY see; it can never
    // widen it, because the providers have already returned only permitted rows.
    if (query.employeeId != null && item.employeeId !== query.employeeId) return false;
    return true;
  });
}

function providersFor(scope: ActionScope): readonly ActionProvider[] {
  // Assigned Work exists only for sources with a genuine assignment concept —
  // it is never fabricated for dynamic-authority sources (§31.10).
  return scope === "assigned" ? ASSIGNABLE_PROVIDERS : P1_PROVIDERS;
}

/**
 * Runs every provider for a scope once and keeps the three outcomes apart.
 * `answeredSources` lists sources that returned `ok` (even with zero items) —
 * it is how a composing surface such as the HR dashboard can tell "nothing to
 * do" from "no authorized source at all" without a second provider run.
 */
export async function collectActionItems(
  ctx: Omit<ProviderContext, "scope">,
  scope: ActionScope,
): Promise<{ items: ActionItem[]; answeredSources: ActionSourceModule[]; unavailableSources: ActionSourceModule[] }> {
  const providerCtx: ProviderContext = { ...ctx, scope };
  const providers = providersFor(scope);
  const outcomes = await Promise.all(providers.map((p) => runProvider(p, providerCtx)));

  const items: ActionItem[] = [];
  const answered = new Set<ActionSourceModule>();
  const unavailable = new Set<ActionSourceModule>();
  outcomes.forEach((outcome, index) => {
    const sourceModule = providers[index]!.sourceModule;
    if (outcome.state === "ok") {
      items.push(...outcome.items);
      answered.add(sourceModule);
    } else if (outcome.state === "failed") unavailable.add(sourceModule);
    // `hidden` contributes nothing at all — deliberately.
  });

  return { items, answeredSources: [...answered].sort(), unavailableSources: [...unavailable].sort() };
}

export async function resolveActionCentre(
  ctx: Omit<ProviderContext, "scope">,
  query: ActionCentreQuery,
): Promise<ActionCentreResult> {
  const { items, unavailableSources } = await collectActionItems(ctx, query.scope);
  return {
    items: sortActionItems(applyFilters(items, query)),
    unavailableSources,
  };
}

/**
 * Counts, computed from the same permission-filtered providers as rows.
 *
 * `byModule` contains an entry only for a source that returned `ok`. A hidden
 * source is ABSENT rather than zero, so a count can never be the route by which
 * an actor learns that a module they cannot read exists (§31.19).
 */
export async function resolveActionCentreCounts(
  ctx: Omit<ProviderContext, "scope">,
  query: ActionCentreQuery,
): Promise<ActionCentreCounts> {
  const providerCtx: ProviderContext = { ...ctx, scope: query.scope };
  const providers = providersFor(query.scope);
  const outcomes = await Promise.all(providers.map((p) => runProvider(p, providerCtx)));

  const perModule = new Map<ActionSourceModule, number>();
  const unavailable = new Set<ActionSourceModule>();
  let total = 0;
  let overdue = 0;

  outcomes.forEach((outcome, index) => {
    const sourceModule = providers[index]!.sourceModule;
    if (outcome.state === "failed") {
      unavailable.add(sourceModule);
      return;
    }
    if (outcome.state !== "ok") return;

    const visible = applyFilters(outcome.items, query);
    // A source that answered is represented even at zero — that zero is honest,
    // because the actor is authorized and there genuinely is nothing to do.
    perModule.set(sourceModule, (perModule.get(sourceModule) ?? 0) + visible.length);
    total += visible.length;
    overdue += visible.filter((i) => i.overdue === true).length;
  });

  return {
    total,
    overdue,
    byModule: [...perModule.entries()]
      .map(([sourceModule, count]) => ({ sourceModule, count }))
      .sort((a, b) => a.sourceModule.localeCompare(b.sourceModule)),
    unavailableSources: [...unavailable].sort(),
  };
}
