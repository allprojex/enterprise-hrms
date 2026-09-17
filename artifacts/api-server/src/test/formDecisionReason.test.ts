/**
 * Core-HR Phase 1 — rejecting a form or returning it for correction must record
 * a reason, enforced by the API (the notification tells the employee to read
 * it). Complete and approve are unaffected. The full stageAction path is also
 * covered, against a real database, in formEngineLive.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const { stageActionMock, rule } = vi.hoisted(() => {
  const rule: { assert?: (action: "complete" | "approve" | "return" | "reject", notes?: string | null) => void } = {};
  // The route's own pipeline, with stageAction reduced to the rule under test.
  const stageActionMock = vi.fn(async (params: { action: "complete" | "approve" | "return" | "reject"; notes?: string | null }) => {
    rule.assert!(params.action, params.notes);
  });
  return { stageActionMock, rule };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: { userId?: number; user?: unknown }, _res: unknown, next: () => void) => {
    req.userId = 1;
    req.user = { id: 1, role: "employee" };
    next();
  },
}));

vi.mock("../middlewares/requireMembership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../middlewares/requireMembership")>()),
  requireMembership: () => (req: { membership?: unknown }, _res: unknown, next: () => void) => {
    req.membership = { id: 5, organizationId: 10, applicationUserId: 1 };
    next();
  },
}));

vi.mock("../lib/formEngine/submissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/formEngine/submissions")>();
  rule.assert = actual.assertDecisionReason;
  return {
    ...actual,
    buildViewerContext: vi.fn(async () => ({ userId: 1, membershipId: 5, employeeId: null })),
    getSubmission: vi.fn(async () => ({ id: 7, organizationId: 10 })),
    canViewSubmission: vi.fn(async () => true),
    getSubmissionDetail: vi.fn(async () => ({ id: 7, status: "pending_approval" })),
    stageAction: stageActionMock,
  };
});

const { assertDecisionReason, FormDecisionReasonRequiredError } = await import("../lib/formEngine/submissions");
const { default: router } = await import("../routes/formSubmissions");
const app = express();
app.use(express.json());
app.use(router);

const act = (body: Record<string, unknown>) => request(app).post("/organizations/10/form-submissions/7/stage-action").send(body);

beforeEach(() => {
  stageActionMock.mockClear();
});

describe("assertDecisionReason", () => {
  it.each([["reject"], ["return"]] as const)("refuses %s without a reason, or with a blank one", (action) => {
    for (const notes of [undefined, null, "", "   \n\t "]) {
      expect(() => assertDecisionReason(action, notes)).toThrow(FormDecisionReasonRequiredError);
    }
  });

  it.each([["reject"], ["return"]] as const)("accepts %s with a meaningful reason", (action) => {
    expect(() => assertDecisionReason(action, "Dates overlap the approved leave in March")).not.toThrow();
  });

  it.each([["approve"], ["complete"]] as const)("leaves %s unaffected", (action) => {
    expect(() => assertDecisionReason(action, null)).not.toThrow();
    expect(() => assertDecisionReason(action, "")).not.toThrow();
  });
});

describe("POST /organizations/:orgId/form-submissions/:id/stage-action — reasons", () => {
  it("400s a rejection without a reason", async () => {
    const res = await act({ action: "reject" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason is required to reject/i);
  });

  it("400s a return for correction with only whitespace", async () => {
    const res = await act({ action: "return", notes: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason is required to return/i);
  });

  it("accepts a rejection with a meaningful reason", async () => {
    const res = await act({ action: "reject", notes: "Outside the leave window" });
    expect(res.status).toBe(200);
    expect(stageActionMock).toHaveBeenCalledWith(expect.objectContaining({ action: "reject", notes: "Outside the leave window" }));
  });

  it("does not require a reason to approve", async () => {
    const res = await act({ action: "approve" });
    expect(res.status).toBe(200);
  });
});
