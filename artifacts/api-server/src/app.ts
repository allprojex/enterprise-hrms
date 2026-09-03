import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { resolveTenantHost } from "./middlewares/resolveTenantHost";
import {
  createRequestContextStore,
  runWithRequestContext,
  requestLogContextFor,
  type RequestContextStore,
} from "./lib/requestContext";

const app: Express = express();

// TRUST_PROXY — WS-18 Pass 2 (finding WS18-P2-04).
//
// Express derives `req.ip` from the socket peer unless told otherwise. Behind a
// TLS-terminating load balancer or reverse proxy — the normal production
// topology — that peer is the PROXY, identically for every visitor. Every
// per-IP rate limiter in this codebase (/auth/login, the careers portal, offer
// responses, and F-2's password-recovery limiters) then keys every request in
// the fleet to one bucket. That is worse than no limiter: it stops isolating
// attackers and starts denying service to everyone, because a single abuser
// exhausts the shared budget for the entire user base.
//
// The fix is opt-in rather than automatic, because `trust proxy: true` is
// itself a vulnerability when nothing strips inbound X-Forwarded-For: a client
// can then forge the header and mint an unlimited supply of rate-limit
// identities, defeating the very limiters this is meant to repair. Only the
// operator knows how many proxies actually sit in front, so only the operator
// can set it.
//
//   unset      -> trust nothing (previous behavior; safe, but see the warning)
//   a number   -> that many proxy hops are trusted (typical: "1")
//   "true"     -> trust every hop; ONLY valid when an edge proxy overwrites
//                 X-Forwarded-For on the way in
//   otherwise  -> passed through to Express (IP / CIDR / comma-separated list)
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const hops = Number(trustProxy);
  app.set("trust proxy", Number.isInteger(hops) ? hops : trustProxy === "true" ? true : trustProxy);
} else if (process.env.NODE_ENV === "production") {
  logger.warn(
    "TRUST_PROXY is not set. If this process sits behind a load balancer or reverse proxy, " +
      "req.ip is the proxy's address for every request and all per-IP rate limits share a single " +
      "bucket across the whole fleet. Set TRUST_PROXY to the number of trusted proxy hops (e.g. \"1\").",
  );
}

// Tenant identity hardening: pino-http writes its completion line from a
// response event, outside the AsyncLocalStorage context the mixin reads, so
// the request's identity is added here explicitly from the store attached to
// the request. Same fields, same source of truth (lib/requestContext.ts).
function requestIdentity(req: unknown): Record<string, unknown> {
  return requestLogContextFor((req as { requestContext?: RequestContextStore }).requestContext);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
    customSuccessObject(req, _res, val) {
      return { ...val, ...requestIdentity(req) };
    },
    customErrorObject(req, _res, _err, val) {
      return { ...val, ...requestIdentity(req) };
    },
  }),
);

// WS-3 (§8): makes pino-http's own per-request id available to
// recordAuditEvent() for the whole lifetime of the request, without every
// audit call site needing to thread it through explicitly. Placed
// immediately after pinoHttp so req.id already exists. The same store now
// also carries the request's user and authorized tenant (set later by
// requireAuth / the membership guards) for every log line — see
// lib/requestContext.ts.
app.use((req, _res, next) => {
  const store = createRequestContextStore(String((req as unknown as { id: string | number }).id));
  (req as unknown as { requestContext: RequestContextStore }).requestContext = store;
  runWithRequestContext(store, next);
});

// This API only ever returns JSON, so a strict default-src is safe and adds
// baseline hardening (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
// at no risk to existing responses. The frontend is built and served
// separately (see README) and should set its own CSP at that layer.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        connectSrc: ["'self'"],
      },
    },
  }),
);

// CORS_ORIGIN: comma-separated allowlist of origins permitted to call this
// API cross-origin (e.g. "https://app.example.com,https://admin.example.com").
//
// WS-18 Pass 2 (finding WS18-P2-03) — production no longer falls back to
// allowing every origin.
//
// The previous behavior reflected any Origin header when CORS_ORIGIN was unset,
// logged a warning, and carried on. A warning in a log is not a control: the
// insecure state was the *default*, so the deployment that most needed the
// allowlist — one where nobody had thought about CORS — was exactly the one that
// ran without it. Any website could then read this API's responses from a
// visitor's browser.
//
// Cross-origin reads are now denied in production unless explicitly allowed.
// This is safe for the shipped topology: the SPA is served by this same Express
// process (see the static handler below), so the browser treats it as
// same-origin and never performs a CORS check at all. Only a genuinely separate
// front-end origin needs CORS_ORIGIN set — and that deployment should be
// declaring its origins anyway.
//
// Outside production the permissive default is kept, so local development and
// tests against http://localhost:5173 continue to work unchanged.
const corsOrigin = process.env.CORS_ORIGIN;
const allowedOrigins = corsOrigin
  ? corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean)
  : undefined;

const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !allowedOrigins) {
  logger.warn(
    "CORS_ORIGIN is not set in production; cross-origin requests are DENIED. " +
      "This is safe when the SPA is served by this process (same-origin). " +
      "Set CORS_ORIGIN to a comma-separated allowlist if a separate front-end origin must call this API.",
  );
}

// `false` disables CORS headers entirely, so a cross-origin caller's browser
// blocks the read. `true` reflects the request origin. Never a wildcard in
// production.
app.use(cors({ origin: allowedOrigins ?? (isProduction ? false : true) }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multi-Organization Tenant Infrastructure: resolves which organization (if
// any) the request's hostname belongs to, before auth and before routing —
// see middlewares/resolveTenantHost.ts. Purely informational; sits below
// every permission/module check, never replaces one.
app.use(resolveTenantHost as any);

/**
 * No-store on the whole API surface — WS-18 Pass 3 (finding WS18-P3-09).
 *
 * Flagged by the ZAP baseline scan ("Storable and Cacheable Content") and
 * confirmed by hand: API responses carried an `ETag` and no `Cache-Control`, so
 * every authenticated response — employee records, payroll, banking details —
 * was heuristically cacheable. A browser on a shared machine could write HR
 * data to disk where the next user finds it, and any intermediary proxy could
 * store and re-serve it.
 *
 * `no-store` is applied to the entire `/api` surface rather than a hand-picked
 * list of "sensitive" routes, because that list would be wrong the first time
 * someone adds an endpoint and forgets to classify it. This API is not a CDN
 * origin and nothing under it benefits from HTTP caching: the SPA holds server
 * state in memory (TanStack Query), so losing conditional-GET revalidation
 * costs nothing measurable here.
 *
 * Registered before the router so it covers every response the router produces,
 * including errors.
 */
app.use("/api", (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use("/api", router);

/**
 * JSON 404 for unmatched API routes — WS-18 Pass 3 (finding WS18-P3-08).
 *
 * Without this, an unknown `/api/...` path fell through to Express's default
 * handler, which returns an HTML document containing the reflected method and
 * path (`<pre>Cannot GET /api/does-not-exist</pre>`). Two problems: the API's
 * error contract silently became HTML at exactly the moment a client was
 * already confused, and the response echoed attacker-supplied path content into
 * a markup context. `X-Content-Type-Options: nosniff` and the CSP make that
 * echo non-exploitable, so this is hygiene rather than an XSS fix — but an API
 * that answers in HTML is a defect regardless.
 *
 * Mounted after the router and before the error handler, so it only sees
 * requests no route claimed.
 */
app.use("/api", (req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

/**
 * Root catch-all — WS-18 Pass 3 (finding WS18-P3-08, second half).
 *
 * A request like `/api/../../etc/passwd` is normalised by the HTTP layer to
 * `/etc/passwd` BEFORE routing, so it never reaches the `/api` handler above
 * and fell through to Express's default HTML 404, reflecting the requested
 * path back. No traversal occurs and the reflection is inert behind `nosniff`
 * and `default-src 'none'`, but there is no reason for this process to emit
 * HTML at all.
 *
 * ORDERING: if static SPA serving is ever added to this process, register it
 * BEFORE this handler — a catch-all registered first would shadow every
 * client-side route.
 */
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

/**
 * Terminal error handler — WS-18 Pass 2 (finding WS18-P2-06), §25.
 *
 * Until this existed, an unhandled throw fell through to Express's built-in
 * handler, which renders an HTML page containing the exception message and the
 * full stack — including absolute filesystem paths like
 * `C:/.../artifacts/api-server/src/routes/branches.ts:40:63`. Express suppresses
 * the stack when NODE_ENV === "production", so the exposure was conditional on
 * one environment variable being spelled exactly right in every deployment. That
 * is not a control; it is a coincidence that holds until someone ships with
 * NODE_ENV unset, or set to "prod", or "Production".
 *
 * It also meant the API's error contract was inconsistent: every deliberate
 * failure returns JSON `{ error }`, while any unexpected one returned an HTML
 * document — so a client parsing errors got a surprise exactly when things were
 * already going wrong.
 *
 * This handler removes both problems unconditionally, in every environment:
 * the response is always generic JSON, and the detail goes to the server log
 * (where it is genuinely useful) instead of to the caller. Nothing about what a
 * client sees now depends on NODE_ENV.
 *
 * The four-argument signature is required — Express identifies error handlers by
 * arity, so `next` must stay even though it is unused.
 */
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Structured, full-fidelity, server-side only. requestId ties this line to the
  // pino-http request log and to the value handed back to the caller.
  const requestId = (req as { id?: string | number }).id;
  logger.error(
    { err, requestId, method: req.method, url: req.originalUrl, ...requestIdentity(req) },
    "Unhandled error",
  );

  // Express may have already begun streaming (e.g. a throw mid-response); in
  // that case the only safe action is to destroy the socket rather than append
  // a second, conflicting body.
  if (res.headersSent) {
    res.destroy();
    return;
  }

  // WS-18 Pass 3 (finding WS18-P3-07) — honour a client-error status.
  //
  // Middleware such as body-parser rejects a malformed request by throwing an
  // error that already carries `status`/`statusCode` 400. Collapsing those to
  // 500 blamed the server for the client's bad input, made genuine server
  // faults indistinguishable from routine 400s in monitoring, and told the
  // caller nothing about how to fix their request.
  //
  // Only 4xx values are trusted, and only the STATUS is taken from the error —
  // never its message, which for a JSON parse failure embeds the offending
  // request body. Anything else remains a generic 500.
  const raw = (err as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (err as { statusCode?: unknown } | null)?.statusCode;
  const status = typeof raw === "number" && raw >= 400 && raw <= 499 ? raw : 500;

  // No message, no stack, no paths, no SQL, no cause chain. The requestId is the
  // only correlation the caller gets, which is all they need to quote in a
  // support request and all an attacker learns.
  res.status(status).json({
    error: status === 500 ? "Internal server error" : "Bad request",
    ...(requestId == null ? {} : { requestId }),
  });
});

export default app;
