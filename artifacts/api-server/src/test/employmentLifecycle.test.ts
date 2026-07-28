/**
 * Focused unit tests for the Employment Lifecycle Service (Phase 2A, W22:
 * Employment Period History). @workspace/db is mocked — no real database
 * connection is made. No route exists yet to exercise through supertest —
 * same reason W5/W12's precursor capabilities were unit-tested directly
 * before their first consuming route shipped — so this calls the service
 * functions directly instead.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, employeesTable, employmentPeriodsTable, auditEventsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      employeeRows: [] as { id: number; organizationId: number }[],
      periodRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      idCounters: new Map<string, number>(),
    },
    employeesTable: { __name: "employees" },
    employmentPeriodsTable: { __name: "employment_periods" },
    auditEventsTable: { __name: "audit_events" },
  };
});

function nextId(table: { __name: string }): number {
  const current = fixtures.idCounters.get(table.__name) ?? 0;
  const id = current + 1;
  fixtures.idCounters.set(table.__name, id);
  return id;
}

vi.mock("@workspace/db", () => ({
  employeesTable,
  employmentPeriodsTable,
  auditEventsTable,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        const rows = table === employeesTable ? fixtures.employeeRows : fixtures.periodRows;
        const builder = {
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        fixtures.inserted.push({ table: table.__name, values: v });
        return { returning: () => Promise.resolve([{ id: nextId(table), createdAt: new Date(), ...v }]) };
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col, val }),
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
  desc: (col: string) => ({ __op: "desc", field: col }),
}));

const { recordEmploymentPeriodEvent, listEmploymentPeriods } = await import("../lib/employmentLifecycleService");

beforeEach(() => {
  fixtures.employeeRows = [];
  fixtures.periodRows = [];
  fixtures.inserted = [];
  fixtures.idCounters = new Map();
});

describe("recordEmploymentPeriodEvent", () => {
  it("rejects an employee that does not belong to the organization (tenant isolation)", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: 99 }];

    await expect(
      recordEmploymentPeriodEvent({
        organizationId: 10,
        employeeId: 1,
        eventType: "transfer",
        effectiveDate: new Date(),
        newState: { departmentId: 2 },
        actorApplicationUserId: 1,
        actorMembershipId: 5,
      }),
    ).rejects.toThrow();

    expect(fixtures.inserted).toHaveLength(0);
  });

  it("records the employment_periods row and a mirrored audit event", async () => {
    fixtures.employeeRows = [{ id: 1, organizationId: 10 }];
    const effectiveDate = new Date("2026-01-01T00:00:00Z");

    const result = await recordEmploymentPeriodEvent({
      organizationId: 10,
      employeeId: 1,
      eventType: "transfer",
      effectiveDate,
      previousState: { departmentId: 1 },
      newState: { departmentId: 2 },
      actorApplicationUserId: 1,
      actorMembershipId: 5,
    });

    expect(result.eventType).toBe("transfer");
    expect(fixtures.inserted).toHaveLength(2);
    expect(fixtures.inserted[0]).toMatchObject({
      table: "employment_periods",
      values: { organizationId: 10, employeeId: 1, eventType: "transfer", newState: { departmentId: 2 } },
    });
    expect(fixtures.inserted[1]).toMatchObject({
      table: "audit_events",
      values: { organizationId: 10, eventType: "employment_period.transfer", targetType: "employee", targetId: "1" },
    });
  });
});

describe("listEmploymentPeriods", () => {
  it("returns only rows for the given organization/employee scope as provided by the query layer", async () => {
    fixtures.periodRows = [{ id: 1, organizationId: 10, employeeId: 1, eventType: "transfer" }];

    const rows = await listEmploymentPeriods(10, 1);

    expect(rows).toEqual(fixtures.periodRows);
  });
});
