/**
 * Unit tests for appointPrimaryHr. The real guarantee ("exactly one active
 * Primary HR per organization") lives in the database's partial unique
 * index, not in this code — these tests verify that a unique-constraint
 * violation (SQLSTATE 23505) is correctly translated into
 * PrimaryHrAlreadyAssignedError rather than leaking a raw DB error, and
 * that a successful appointment is audited.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, primaryHrAssignmentsTable, auditEventsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      forceConflict: false,
      auditInserts: [] as unknown[],
    },
    primaryHrAssignmentsTable: { __name: "primary_hr_assignments" },
    auditEventsTable: { __name: "audit_events" },
  };
});

vi.mock("@workspace/db", () => ({
  primaryHrAssignmentsTable,
  auditEventsTable,
  db: {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) {
          fixtures.auditInserts.push(v);
          return Promise.resolve(undefined);
        }
        return {
          returning: () => {
            if (fixtures.forceConflict) {
              return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
            }
            return Promise.resolve([{ id: 1, ...v }]);
          },
        };
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  isNull: () => "isNull",
}));

const { appointPrimaryHr, PrimaryHrAlreadyAssignedError } = await import("../lib/primaryHr");

describe("appointPrimaryHr", () => {
  beforeEach(() => {
    fixtures.forceConflict = false;
    fixtures.auditInserts = [];
  });

  it("appoints a Primary HR and records an audit event", async () => {
    const assignment = await appointPrimaryHr({ organizationId: 10, membershipId: 5, assignedBy: 1 });

    expect(assignment.organizationId).toBe(10);
    expect(assignment.membershipId).toBe(5);
    expect(fixtures.auditInserts).toHaveLength(1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "primary_hr.appointed", organizationId: 10 });
  });

  it("throws PrimaryHrAlreadyAssignedError when the organization already has an active Primary HR", async () => {
    fixtures.forceConflict = true;

    await expect(
      appointPrimaryHr({ organizationId: 10, membershipId: 5, assignedBy: 1 }),
    ).rejects.toBeInstanceOf(PrimaryHrAlreadyAssignedError);
    expect(fixtures.auditInserts).toHaveLength(0);
  });
});
