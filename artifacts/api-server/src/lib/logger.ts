import pino from "pino";
import { APP_ENVIRONMENT, APP_VERSION, INSTALLATION_KEY } from "./releaseInfo";
import { getRequestLogContext } from "./requestContext";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Paths pino censors before a line is written. Headers were redacted from the
 * start; the body-shaped paths were added by the tenant identity hardening so
 * that binding request context to every log line could never become a way of
 * leaking a credential that a call site happened to include in a log object.
 * Wildcards match one level, which is the shape every call site in this code
 * base uses (`logger.error({ err, input }, ...)`). Nothing here is a substitute
 * for not logging HR payloads in the first place — see
 * docs/TENANT_IDENTITY_AND_CUSTOMIZATION.md §5.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "currentPassword",
  "*.currentPassword",
  "newPassword",
  "*.newPassword",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "resetToken",
  "*.resetToken",
  "authorization",
  "*.authorization",
];

/**
 * Every line carries the deployment identity (`environment`, `app_version`,
 * and `installation_key` when the process declares one) as base bindings, and
 * — through `mixin` — the per-request identity from lib/requestContext.ts
 * (`request_id`, `tenant_id`, `tenant_source`, `user_id`, ...). `mixin` runs
 * for every log call, including pino-http's, so a route that simply calls
 * `logger.warn(...)` inside a request is tenant-attributed with no extra code.
 * Outside a request the mixin contributes nothing, so worker/seed logs are
 * unchanged apart from the deployment bindings.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    pid: process.pid,
    environment: APP_ENVIRONMENT,
    app_version: APP_VERSION,
    ...(INSTALLATION_KEY ? { installation_key: INSTALLATION_KEY } : {}),
  },
  mixin() {
    return getRequestLogContext();
  },
  redact: { paths: [...LOG_REDACT_PATHS], censor: "[REDACTED]" },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
