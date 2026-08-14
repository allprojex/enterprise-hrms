/**
 * Proves resolveTenantHost (Multi-Organization Tenant Infrastructure) is
 * safe to run globally on every request, including in every other test
 * file's own @workspace/db mock — none of which know about
 * organizationDomainsTable/organizationsTable. This mock deliberately
 * exports neither, the same shape a pre-existing, unrelated test file's
 * mock has. If the middleware weren't defensive, every request in every
 * test file in this directory would start throwing the moment it was wired
 * into app.ts.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from() {
        throw new Error("this mock does not know about this table");
      },
    }),
  },
}));

const { default: app } = await import("../app");

describe("resolveTenantHost fails open", () => {
  it("does not break an unrelated request when @workspace/db can't resolve a tenant", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  });

  it("does not break an unrelated request even with a spoofed X-Tenant-Hostname header", async () => {
    const res = await request(app).get("/api/healthz").set("X-Tenant-Hostname", "anything.example.com");
    expect(res.status).toBe(200);
  });
});
