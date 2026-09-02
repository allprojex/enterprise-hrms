/**
 * WS-18 Pass 2, F-2 — shared abuse controls for the unauthenticated
 * credential-recovery surface.
 *
 * These build on `express-rate-limit`, which this codebase already uses for
 * `/auth/login`, the careers portal, and offer responses. That is deliberate:
 * F-2's brief is to reuse the existing rate-limit foundation rather than grow a
 * second, divergent limiter. Everything here is a thin, well-labelled
 * configuration of that same primitive.
 *
 * ## Why more than one dimension
 *
 * A single per-IP limit is not enough for password recovery. The three abuse
 * shapes are different and need different keys:
 *
 *   - **Per IP** stops one host hammering the endpoint at all (mail flooding,
 *     token brute-force).
 *   - **Per normalized account identifier** stops one victim being targeted
 *     from many IPs — mailbox flooding a specific person, which a per-IP limit
 *     from a botnet would never catch.
 *   - **Per reset token** bounds guessing attempts against one token
 *     independently of source address.
 *
 * Limiters are composed as ordinary middleware, so a request must satisfy every
 * dimension that applies to it.
 *
 * ## Enumeration safety
 *
 * Every limiter here returns the SAME body and status regardless of whether the
 * identifier it keyed on belongs to a real account. A limiter that only fired
 * for registered emails would itself be an account-enumeration oracle — the
 * exact thing `/auth/forgot-password` is written to avoid. The per-email
 * limiter therefore keys on the *submitted* string, hashed, without ever
 * consulting the database.
 *
 * Submitted identifiers are hashed before being used as a key so that raw email
 * addresses and raw reset tokens never become map keys held in process memory
 * or printed by a store's diagnostics.
 *
 * ## Deployment limitation — READ THIS BEFORE SCALING OUT
 *
 * `express-rate-limit`'s default store is `MemoryStore`, which is **per
 * process**. With N application instances behind a load balancer, the effective
 * limit is N x the configured value, and an attacker who reconnects lands on a
 * different instance with a fresh budget. This is a real, deliberate limitation:
 * introducing a shared store means introducing Redis (or equivalent), which is
 * infrastructure this workstream is not authorized to add.
 *
 * These limits are therefore **best-effort abuse damping, not a cluster-wide
 * guarantee**, and must not be described as one. If the deployment moves beyond
 * a single application instance, the correct fix is a shared store
 * (`rate-limit-redis`) wired into these same limiters — none of the call sites
 * would change. See docs/SECURITY.md.
 */

import crypto from "node:crypto";
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

/**
 * Single generic throttle response, shared by every limiter below.
 *
 * It deliberately says nothing about which dimension tripped, and nothing about
 * whether the account, email, or token involved exists. "Too many requests" is
 * all a client ever learns.
 */
const THROTTLED_BODY = {
  error: "Too many requests. Please try again later.",
} as const;

const SHARED: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  message: THROTTLED_BODY,
};

/** Keys derived from user input are hashed so raw secrets never become map keys. */
function hashKey(prefix: string, value: string): string {
  return `${prefix}:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Per-IP limit on requesting a reset link.
 *
 * Deliberately tighter than `/auth/login`'s 10/15min: each accepted request can
 * send an email, so the cost of abuse is borne by a third party (the mail
 * provider and the victim's inbox), not just by this server.
 */
export const forgotPasswordIpRateLimiter = rateLimit({
  ...SHARED,
  windowMs: 15 * 60 * 1000,
  limit: 5,
});

/**
 * Per-target limit on requesting a reset link, keyed on the SUBMITTED address.
 *
 * This is what stops a distributed mailbox-flooding campaign against one
 * person: the attacker can rotate source addresses freely, but every request
 * naming the same victim shares this budget. Because the key is the submitted
 * string and the database is never consulted, an unregistered address is
 * throttled identically to a registered one — no enumeration signal.
 *
 * The window is long (1 hour) and the limit low, because a legitimate user has
 * no reason to request more than a handful of reset links for one address per
 * hour, and each link stays valid for that whole hour anyway.
 */
export const forgotPasswordAccountRateLimiter = rateLimit({
  ...SHARED,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: (req: Request) => {
    const email = normalizeEmail((req.body as { email?: unknown } | undefined)?.email);
    // A malformed body has no address to key on; fall back to the IP so the
    // request is still counted rather than silently exempt. ipKeyGenerator is
    // express-rate-limit's own helper, which normalizes IPv6 into a /56 block
    // so a single IPv6 allocation cannot mint unlimited distinct keys.
    return email ? hashKey("acct", email) : ipKeyGenerator(req.ip ?? "");
  },
});

/**
 * Per-IP limit on submitting or previewing a reset token.
 *
 * Reset tokens are 256 bits of `crypto.randomBytes` entropy, so guessing one is
 * not a practical attack even unthrottled. This exists so that "not practical"
 * does not quietly depend on that entropy never being weakened, and to stop the
 * endpoint being used as a cheap liveness/oracle probe.
 */
export const resetTokenIpRateLimiter = rateLimit({
  ...SHARED,
  windowMs: 15 * 60 * 1000,
  limit: 20,
});

/**
 * Per-token attempt limit.
 *
 * Bounds how many times ONE token may be presented, independently of source
 * address. A token that has been guessed at repeatedly is far more likely to be
 * under attack than in use, and a real user needs only one or two attempts.
 */
export const resetTokenAttemptRateLimiter = rateLimit({
  ...SHARED,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (req: Request) => {
    const raw = req.params?.token;
    const token = Array.isArray(raw) ? raw[0] : raw;
    return typeof token === "string" && token.length > 0
      ? hashKey("rst", token)
      : ipKeyGenerator(req.ip ?? "");
  },
});

/**
 * Minimum wall-clock duration for a `/auth/forgot-password` response.
 *
 * Without this, the endpoint leaks account existence through timing alone: an
 * unregistered address costs one indexed SELECT that misses, while a registered
 * one costs a token generation, an UPDATE, and (previously) a fully awaited
 * outbound email — a difference of hundreds of milliseconds, trivially
 * measurable and entirely sufficient to enumerate a user base.
 *
 * Email delivery is now dispatched without blocking the response, and this
 * floor absorbs the remaining database-write difference. 400ms is comfortably
 * above the spread between the two paths on this workload while staying
 * unremarkable to a human.
 */
export const FORGOT_PASSWORD_MIN_RESPONSE_MS = 400;

/**
 * Resolves once at least `FORGOT_PASSWORD_MIN_RESPONSE_MS` has elapsed since
 * `startedAt`. Returns immediately if the work already took longer, so this
 * only ever pads the fast path — it never adds latency to the slow one.
 */
export async function padToMinimumDuration(
  startedAt: number,
  minimumMs: number = FORGOT_PASSWORD_MIN_RESPONSE_MS,
): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
