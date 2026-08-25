/**
 * WS-3 (Audit & Sensitive-Data Security Hardening, §8) — request/correlation
 * ID propagation for recordAuditEvent(), using Node's built-in
 * AsyncLocalStorage rather than a new dependency or a distributed-tracing
 * system. Reuses pino-http's own already-generated per-request `req.id`
 * (see app.ts's requestContext middleware, wired right after pinoHttp) —
 * no second ID generator was introduced.
 *
 * A background/non-HTTP caller (a seed script, a backfill) simply never
 * enters this context, so getCurrentRequestId() returns undefined and
 * recordAuditEvent() writes `requestId: null` — safe, compatible, no error.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ requestId: string }>();

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getCurrentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
