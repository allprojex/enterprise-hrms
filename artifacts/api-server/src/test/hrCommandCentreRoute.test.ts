/**
 * GET /organizations/:organizationId/dashboard/command-centre — route contract.
 *
 * The service is mocked; these tests prove what the ROUTE guarantees:
 *   - it sits behind requireAuth and requireMembership (a rejected membership
 *     never reaches the service);
 *   - the organization handed to the service is the verified membership's,
 *     never the client-supplied path parameter;
 *   - a break-glass request with no membership receives 403, not a guess.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const m = vi.hoisted(() => ({
  resolveHrCommandCentre: vi.fn(),
  authenticated: true,
  membership: null as { id: number; organizationId: number } | null,
  membershipAllowed: true,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: { userId?: number }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (!m.authenticated) return res.status(401).json({ error: "Unauthorized" });
    req.userId = 7;
    next();
  },
}));
vi.mock("../middlewares/requireMembership", () => ({
  requireMembership:
    () =>
    (req: { membership?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
      if (!m.membershipAllowed) return res.status(403).json({ error: "Forbidden" });
      if (m.membership) req.membership = m.membership;
      next();
    },
}));
vi.mock("../lib/hrCommandCentre", () => ({ resolveHrCommandCentre: m.resolveHrCommandCentre }));

import router from "../routes/hrCommandCentre";

const app = express();
app.use(router);

beforeEach(() => {
  m.authenticated = true;
  m.membership = { id: 70, organizationId: 10 };
  m.membershipAllowed = true;
  m.resolveHrCommandCentre.mockReset().mockResolvedValue({ organizationId: 10, tasks: null, attention: [] });
});

describe("GET /organizations/:organizationId/dashboard/command-centre", () => {
  it("resolves the command centre for the verified membership", async () => {
    const res = await request(app).get("/organizations/10/dashboard/command-centre");
    expect(res.status).toBe(200);
    expect(m.resolveHrCommandCentre).toHaveBeenCalledWith({ organizationId: 10, applicationUserId: 7, membershipId: 70 });
  });

  it("uses the membership's organization, never the client-supplied path id", async () => {
    // A membership middleware that resolved org 10 while the path names 99.
    const res = await request(app).get("/organizations/99/dashboard/command-centre");
    expect(res.status).toBe(200);
    expect(m.resolveHrCommandCentre.mock.calls[0]![0]).toMatchObject({ organizationId: 10 });
  });

  it("never reaches the service for a non-member (cross-tenant) request", async () => {
    m.membershipAllowed = false;
    const res = await request(app).get("/organizations/11/dashboard/command-centre");
    expect(res.status).toBe(403);
    expect(m.resolveHrCommandCentre).not.toHaveBeenCalled();
  });

  it("never reaches the service for an unauthenticated request", async () => {
    m.authenticated = false;
    const res = await request(app).get("/organizations/10/dashboard/command-centre");
    expect(res.status).toBe(401);
    expect(m.resolveHrCommandCentre).not.toHaveBeenCalled();
  });

  it("refuses a break-glass request that carries no membership", async () => {
    m.membership = null;
    const res = await request(app).get("/organizations/10/dashboard/command-centre");
    expect(res.status).toBe(403);
    expect(m.resolveHrCommandCentre).not.toHaveBeenCalled();
  });
});
