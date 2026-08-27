/**
 * WS-7 (§6) — the server-defined entity-adapter registry. An `entityType`
 * string is never client-executable content: every read/write path
 * validates it against this allow-list before a migration_sources row is
 * ever created, before a staged row is planned, and before anything is
 * executed — the exact same discipline WS-6 established for
 * `scheduled_jobs.jobType` (lib/jobHandlerRegistry.ts).
 */
import type { QueryClient, ResolutionMode } from "./referenceResolution";

export interface CanonicalField {
  key: string;
  label: string;
  required: boolean;
  type: "string" | "number" | "date" | "enum" | "boolean";
  enumValues?: readonly string[];
  /** Source-header aliases auto-mapped to this field when the match is unambiguous (§10: "auto-map only when confident"). */
  aliases: readonly string[];
}

export interface FieldMessage {
  field?: string;
  message: string;
  severity: "warning" | "error";
}

export interface NormalizeResult {
  data: Record<string, unknown>;
  messages: FieldMessage[];
}

export type RowOperation = "create" | "match_existing" | "skip" | "error";

export interface PlanResult {
  operation: RowOperation;
  matchedEntityId?: number;
  messages: FieldMessage[];
}

// Deliberately non-nullable: every migration mutation is performed by an
// authenticated organization member holding `migration.execute` (see
// routes/migrations.ts) — break-glass grants are read-only by WS-4's own
// boundary and are never in scope for a mutating action like this, so
// there is no real code path where migration execution runs without a
// real membership id. Some reused domain primitives (e.g.
// recordEmploymentPeriodEvent) require a real membership id outright;
// keeping this non-nullable here means every adapter gets that guarantee
// for free rather than each one re-deriving/asserting it.
export interface ActorContext {
  organizationId: number;
  batchId: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}

export type ExecutionOutcome = "created" | "updated" | "matched";

export interface ExecuteResult {
  status: ExecutionOutcome;
  resultId: number;
}

export interface EntityAdapter {
  entityType: string;
  label: string;
  /** Other entity types that must fully execute before this one — see referenceResolution.ts for how a dependency reference is checked. */
  dependsOn: readonly string[];
  fields: readonly CanonicalField[];
  /** Pure and synchronous: coerces/validates one mapped row. Never touches the database — cross-entity reference checks happen in `planRow`. */
  normalizeRow(raw: Record<string, string>): NormalizeResult;
  /**
   * Read-only. Resolves duplicates/matches and cross-entity references
   * against either live authoritative data or (in "dry_run" mode) an
   * earlier valid staged row in the same batch — never mutates anything.
   */
  planRow(tx: QueryClient, mode: ResolutionMode, data: Record<string, unknown>, ctx: ActorContext): Promise<PlanResult>;
  /**
   * Mutating. Called only for a staged row whose `operation` is `create`
   * or `match_existing` and whose `executionStatus` is still `pending`
   * (the orchestration layer's own idempotency guard — see
   * lib/migrations/execution.ts). References are re-resolved fresh here
   * (mode "execute"), never trusted from the dry-run plan.
   */
  executeRow(tx: QueryClient, data: Record<string, unknown>, ctx: ActorContext): Promise<ExecuteResult>;
}

const registry = new Map<string, EntityAdapter>();

export function registerEntityAdapter(adapter: EntityAdapter): void {
  if (registry.has(adapter.entityType)) throw new Error(`Entity adapter "${adapter.entityType}" is already registered`);
  registry.set(adapter.entityType, adapter);
}

export function getEntityAdapter(entityType: string): EntityAdapter | undefined {
  return registry.get(entityType);
}

export function listEntityTypes(): string[] {
  return [...registry.keys()];
}

export function isKnownEntityType(entityType: string): boolean {
  return registry.has(entityType);
}

/**
 * Topologically orders `entityTypes` by each adapter's own `dependsOn`
 * (§16/§38) — structure before employees, employees before every
 * employee-dependent entity. Throws if `entityTypes` contains an unknown
 * type or a dependency cycle (which would only ever indicate a bug in this
 * registry itself, never something a client input can trigger).
 */
export function orderEntityTypesByDependency(entityTypes: readonly string[]): string[] {
  const included = new Set(entityTypes);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: string[] = [];

  function visit(entityType: string, path: readonly string[]): void {
    if (visited.has(entityType)) return;
    if (visiting.has(entityType)) throw new Error(`Circular entity dependency: ${[...path, entityType].join(" -> ")}`);
    const adapter = registry.get(entityType);
    if (!adapter) throw new Error(`Unknown entity type "${entityType}"`);
    visiting.add(entityType);
    for (const dep of adapter.dependsOn) {
      if (included.has(dep)) visit(dep, [...path, entityType]);
    }
    visiting.delete(entityType);
    visited.add(entityType);
    ordered.push(entityType);
  }

  for (const entityType of entityTypes) visit(entityType, []);
  return ordered;
}
