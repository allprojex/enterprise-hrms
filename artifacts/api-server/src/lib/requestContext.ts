/**
 * Per-request context, carried on Node's built-in AsyncLocalStorage rather
 * than a new dependency or a distributed-tracing system.
 *
 * History: WS-3 (§8) introduced the request/correlation id, reusing
 * pino-http's own `req.id` (see app.ts — no second ID generator exists);
 * WS-4 (Break-Glass Access Foundation, §28-29) added the elevation grant id.
 * Both are threaded to recordAuditEvent() without any of the ~340 audit call
 * sites needing to change.
 *
 * Tenant identity hardening (pre-production, 2026-09-03) extends the same
 * store — deliberately NOT a second mechanism — with the identity every
 * tenant-relevant log line must carry so an operator can tell
 * "organization X has an error" from "every tenant has the same platform
 * error":
 *
 *   userId       — set by requireAuth once the session is verified.
 *   hostTenant   — the organization the connection's Host header resolved
 *                  to (resolveTenantHost). Informational: it never grants
 *                  anything, exactly as before.
 *   tenant       — the ONE organization this request is authorized to act
 *                  on, bound by the existing authorization points
 *                  (requireMembership, requireActiveOrganizationMembership,
 *                  the organization-record routes, login/switch). A request
 *                  can only ever be bound to one tenant: binding a second,
 *                  different organization throws, because a request that
 *                  silently spans two tenants is precisely the bug this
 *                  context exists to make impossible.
 *
 * Nothing here is ever read from a client header or body. The values are
 * written only by server-side code that has already validated them.
 *
 * A background/non-HTTP caller (a seed script, a backfill, the worker)
 * simply never enters this context, so every getter returns undefined and
 * recordAuditEvent() writes null — safe, compatible, no error.
 *
 * The store object is intentionally mutable: requestId is fixed for the
 * lifetime of the request (set once, in app.ts), while everything else is
 * set later, mid-request, by the middleware that establishes it. Mutating the
 * same store (rather than re-running storage.run) keeps every audit event and
 * log line written afterward in that same request correctly correlated
 * without threading values through every call site by hand.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** How the request's authorized tenant was established. */
export type TenantContextSource =
  | "membership" // a live organization_memberships row (requireMembership and friends)
  | "break_glass" // a live break-glass grant for exactly this organization
  | "platform_authority" // a super_admin acting on an organization RECORD via authorizeOrganizationAction
  | "session"; // login / switch-organization scoping a session to a tenant

export interface TenantContext {
  organizationId: number;
  source: TenantContextSource;
}

export interface RequestContextStore {
  requestId: string;
  breakGlassGrantId?: number;
  userId?: number;
  /** Set (possibly to null) once resolveTenantHost has run. */
  hostTenantOrganizationId?: number | null;
  tenant?: TenantContext;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export function createRequestContextStore(requestId: string): RequestContextStore {
  return { requestId };
}

export function runWithRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}

/** Kept for existing callers and tests: a context carrying only a request id. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run(createRequestContextStore(requestId), fn);
}

export function getCurrentRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}

export function getCurrentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Marks the current request as operating under this break-glass grant. */
export function setCurrentBreakGlassGrantId(grantId: number): void {
  const store = storage.getStore();
  if (store) store.breakGlassGrantId = grantId;
}

export function getCurrentBreakGlassGrantId(): number | undefined {
  return storage.getStore()?.breakGlassGrantId;
}

export function setCurrentUserId(userId: number): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}

export function setCurrentHostTenant(organizationId: number | null): void {
  const store = storage.getStore();
  if (store) store.hostTenantOrganizationId = organizationId;
}

export class TenantContextConflictError extends Error {
  constructor(
    public readonly boundOrganizationId: number,
    public readonly attemptedOrganizationId: number,
  ) {
    super(
      `Request is already bound to organization ${boundOrganizationId}; refusing to rebind it to organization ${attemptedOrganizationId}`,
    );
    this.name = "TenantContextConflictError";
  }
}

/**
 * Binds the current request to exactly one authorized tenant. Idempotent for
 * the same organization (several guards on one route may each confirm the
 * same tenant); throws for a different one. Callers pass an organization id
 * they have ALREADY authorized — this function records, it never grants.
 */
export function bindTenantContext(organizationId: number, source: TenantContextSource): void {
  const store = storage.getStore();
  if (!store) return;
  if (store.tenant && store.tenant.organizationId !== organizationId) {
    throw new TenantContextConflictError(store.tenant.organizationId, organizationId);
  }
  store.tenant = { organizationId, source };
}

export function getCurrentTenantContext(): TenantContext | undefined {
  return storage.getStore()?.tenant;
}

/**
 * The canonical identity fields for structured logs, derived from a store.
 * Snake_case keys are deliberate — they are the field names operators grep
 * for, shared with docs/TENANT_IDENTITY_AND_CUSTOMIZATION.md §5. Only fields
 * that are actually known are emitted; nothing is defaulted or fabricated.
 * `tenant_id` is the authorized tenant when one is bound, otherwise the
 * hostname-resolved tenant (marked by `tenant_source: "hostname"`), so an
 * unauthenticated login failure on a tenant hostname is still attributable.
 */
export function requestLogContextFor(store: RequestContextStore | undefined): Record<string, unknown> {
  if (!store) return {};
  const out: Record<string, unknown> = { request_id: store.requestId };
  if (store.userId != null) out.user_id = store.userId;
  if (store.tenant) {
    out.tenant_id = store.tenant.organizationId;
    out.tenant_source = store.tenant.source;
  } else if (store.hostTenantOrganizationId != null) {
    out.tenant_id = store.hostTenantOrganizationId;
    out.tenant_source = "hostname";
  }
  if (store.hostTenantOrganizationId != null) out.host_tenant_id = store.hostTenantOrganizationId;
  if (store.breakGlassGrantId != null) out.break_glass_grant_id = store.breakGlassGrantId;
  return out;
}

export function getRequestLogContext(): Record<string, unknown> {
  return requestLogContextFor(storage.getStore());
}
