/**
 * Tenant identity hardening — Phases 3 and 5, Phase 9 test 6 ("logs/audit
 * events identify the correct tenant").
 *
 * Proves, without a database or an HTTP server:
 *   - a request context binds to exactly ONE tenant and refuses a second;
 *   - the canonical log fields (request_id, tenant_id, tenant_source, user_id,
 *     host_tenant_id) are derived only from what server-side code bound —
 *     nothing here reads a header or a body;
 *   - the shared pino logger emits those fields on every line written inside
 *     the context (the `mixin`), carries the deployment identity as base
 *     bindings, and censors credentials that a call site might include;
 *   - outside a request, no tenant field is fabricated.
 */
import { describe, it, expect, vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import {
  createRequestContextStore,
  runWithRequestContext,
  runWithRequestId,
  bindTenantContext,
  setCurrentUserId,
  setCurrentHostTenant,
  getRequestLogContext,
  requestLogContextFor,
  getCurrentRequestId,
  TenantContextConflictError,
} from "../lib/requestContext";

vi.mock("../lib/releaseInfo", () => ({
  APP_ENVIRONMENT: "test-env",
  APP_VERSION: "abc1234",
  INSTALLATION_KEY: "inst-test",
  releaseInfo: () => ({ environment: "test-env", appVersion: "abc1234", installationKey: "inst-test" }),
}));

const { LOG_REDACT_PATHS } = await import("../lib/logger");

/** Builds a logger with the production options but a capturing destination. */
function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      for (const raw of chunk.toString().split("\n").filter(Boolean)) lines.push(JSON.parse(raw));
      cb();
    },
  });
  const logger = pino(
    {
      base: { environment: "test-env", app_version: "abc1234", installation_key: "inst-test" },
      mixin: () => getRequestLogContext(),
      redact: { paths: [...LOG_REDACT_PATHS], censor: "[REDACTED]" },
    },
    sink,
  );
  return { logger, lines };
}

describe("request context", () => {
  it("binds to exactly one tenant; a different second binding is refused", () => {
    runWithRequestId("req-1", () => {
      bindTenantContext(101, "membership");
      bindTenantContext(101, "membership"); // idempotent for the same tenant
      expect(() => bindTenantContext(202, "membership")).toThrow(TenantContextConflictError);
      expect(getRequestLogContext()).toMatchObject({ request_id: "req-1", tenant_id: 101, tenant_source: "membership" });
    });
  });

  it("derives the canonical fields only from server-side bindings", () => {
    const store = createRequestContextStore("req-2");
    runWithRequestContext(store, () => {
      setCurrentUserId(7);
      setCurrentHostTenant(101);
      expect(getRequestLogContext()).toEqual({
        request_id: "req-2",
        user_id: 7,
        tenant_id: 101,
        tenant_source: "hostname",
        host_tenant_id: 101,
      });
      bindTenantContext(101, "break_glass");
      expect(getRequestLogContext()).toMatchObject({ tenant_id: 101, tenant_source: "break_glass", host_tenant_id: 101 });
    });
    // The same store is readable off the request object after the fact
    // (pino-http's completion line is written outside the async context).
    expect(requestLogContextFor(store)).toMatchObject({ request_id: "req-2", tenant_id: 101, user_id: 7 });
  });

  it("contributes nothing outside a request — no fabricated tenant", () => {
    expect(getCurrentRequestId()).toBeUndefined();
    expect(getRequestLogContext()).toEqual({});
    expect(requestLogContextFor(undefined)).toEqual({});
  });
});

describe("structured logger", () => {
  it("stamps every line inside a request with request, user and tenant identity plus deployment identity", () => {
    const { logger, lines } = captureLogger();
    runWithRequestId("req-3", () => {
      setCurrentUserId(9);
      bindTenantContext(202, "membership");
      logger.info({ module: "leave", action: "request.approve" }, "approved");
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      request_id: "req-3",
      user_id: 9,
      tenant_id: 202,
      tenant_source: "membership",
      environment: "test-env",
      app_version: "abc1234",
      installation_key: "inst-test",
      module: "leave",
      action: "request.approve",
      msg: "approved",
    });
  });

  it("distinguishes 'organization X has an error' from 'the platform has an error'", () => {
    const { logger, lines } = captureLogger();
    runWithRequestId("req-a", () => {
      bindTenantContext(101, "membership");
      logger.error({ error_code: "E_LEAVE_BALANCE" }, "failed");
    });
    runWithRequestId("req-b", () => {
      bindTenantContext(202, "membership");
      logger.error({ error_code: "E_LEAVE_BALANCE" }, "failed");
    });
    logger.error({ error_code: "E_DB_UNREACHABLE" }, "failed"); // worker / startup: no tenant
    expect(lines.map((l) => [l.tenant_id ?? null, l.error_code])).toEqual([
      [101, "E_LEAVE_BALANCE"],
      [202, "E_LEAVE_BALANCE"],
      [null, "E_DB_UNREACHABLE"],
    ]);
  });

  it("censors credentials that a call site includes in a log object", () => {
    const { logger, lines } = captureLogger();
    logger.warn(
      { password: "hunter2", input: { newPassword: "x", token: "t0k", email: "a@b.c" }, req: { headers: { authorization: "Bearer abc", cookie: "s=1" } } },
      "login",
    );
    const line = lines[0] as Record<string, any>;
    expect(line.password).toBe("[REDACTED]");
    expect(line.input.newPassword).toBe("[REDACTED]");
    expect(line.input.token).toBe("[REDACTED]");
    expect(line.input.email).toBe("a@b.c");
    expect(line.req.headers.authorization).toBe("[REDACTED]");
    expect(line.req.headers.cookie).toBe("[REDACTED]");
  });
});
