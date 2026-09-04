/**
 * Helmet remains the API's own authority for browser security headers
 * (post-deployment edge hardening).
 *
 * In the Production topology the Nginx edge hides Helmet's HSTS and emits a
 * single copy itself, and does NOT re-add X-Frame-Options / nosniff /
 * Referrer-Policy on /api/ because Helmet already sends them. These tests pin
 * the Helmet side of that contract so the API stays correctly hardened when
 * it is reached without a proxy (local runs, a future direct deployment) and
 * so an edge change can be reasoned about against a known API baseline.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";

describe("API security headers (Helmet, no proxy)", () => {
  it("sends HSTS for one year with includeSubDomains and no preload", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("sends its own Referrer-Policy, X-Frame-Options and nosniff exactly once", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // supertest joins duplicates with ", " — a comma would mean two headers.
    for (const h of ["strict-transport-security", "referrer-policy", "x-frame-options", "x-content-type-options"]) {
      expect(res.headers[h]).not.toContain(",");
    }
  });

  it("enforces an API-only CSP and never a report-only one, and exposes no X-Powered-By", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy-report-only"]).toBeUndefined();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("does not set X-Robots-Tag itself — that is an edge responsibility", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.headers["x-robots-tag"]).toBeUndefined();
  });
});
