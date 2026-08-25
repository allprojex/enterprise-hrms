/**
 * WS-3 (§8) / WS-4 (Break-Glass Access Foundation, §28-29) —
 * request/correlation ID and (when the caller is operating under an active
 * break-glass grant) elevation context, both threaded to recordAuditEvent()
 * via Node's built-in AsyncLocalStorage rather than a new dependency or a
 * distributed-tracing system. Reuses pino-http's own already-generated
 * per-request `req.id` (see app.ts's requestContext middleware, wired right
 * after pinoHttp) — no second ID generator was introduced.
 *
 * A background/non-HTTP caller (a seed script, a backfill) simply never
 * enters this context, so both getters return undefined and
 * recordAuditEvent() writes `requestId`/`breakGlassGrantId` as null — safe,
 * compatible, no error.
 *
 * The store object is intentionally mutable: requestId is fixed for the
 * lifetime of the request (set once, in app.ts), while breakGlassGrantId is
 * set later, mid-request, by requireMembership.ts only on the specific
 * requests where a break-glass grant was actually resolved and used —
 * mutating the same store (rather than re-running storage.run) keeps every
 * audit event written afterward in that same request correctly correlated
 * without threading the grant id through every call site by hand.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContextStore {
  requestId: string;
  breakGlassGrantId?: number;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
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
