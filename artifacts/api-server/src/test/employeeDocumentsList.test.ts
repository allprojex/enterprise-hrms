/**
 * Core-HR Phase 1 — listEmployeeDocuments applies the WS-12 confidentiality
 * tier in the query itself: a caller without the document permission gets
 * `normal` documents only. Organization and employee scoping always apply.
 * @workspace/db is mocked with field-based condition evaluation.
 */
import { describe, it, expect, vi } from "vitest";

const { rows, employeeDocumentsTable } = vi.hoisted(() => {
  const table: Record<string, string> = {};
  for (const col of ["id", "organizationId", "employeeId", "confidentiality", "createdAt"]) table[col] = `employee_documents.${col}`;
  return {
    employeeDocumentsTable: table,
    rows: [
      { id: 1, organizationId: 10, employeeId: 42, confidentiality: "normal", createdAt: new Date("2026-01-01") },
      { id: 2, organizationId: 10, employeeId: 42, confidentiality: "confidential", createdAt: new Date("2026-01-02") },
      { id: 3, organizationId: 10, employeeId: 42, confidentiality: "restricted", createdAt: new Date("2026-01-03") },
      { id: 4, organizationId: 10, employeeId: 43, confidentiality: "normal", createdAt: new Date("2026-01-04") },
      { id: 5, organizationId: 20, employeeId: 42, confidentiality: "normal", createdAt: new Date("2026-01-05") },
    ] as Record<string, unknown>[],
  };
});

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] };
const matches = (row: Record<string, unknown>, cond: Cond): boolean =>
  cond.__op === "eq" ? row[cond.field] === cond.val : cond.conds.every((c) => matches(row, c));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds }),
  desc: () => undefined,
}));

vi.mock("@workspace/db", () => ({
  employeeDocumentsTable,
  db: {
    select: () => ({
      from: () => ({
        where: (cond: Cond) => ({ orderBy: () => Promise.resolve(rows.filter((r) => matches(r, cond))) }),
      }),
    }),
  },
}));

const { listEmployeeDocuments } = await import("../lib/employeeDocuments");

describe("listEmployeeDocuments", () => {
  it("returns only normal documents when the caller may not see confidential tiers", async () => {
    const docs = await listEmployeeDocuments(10, 42, { includeConfidential: false });
    expect(docs.map((d) => d.id)).toEqual([1]);
  });

  it("returns every tier for a caller holding the document permission", async () => {
    const docs = await listEmployeeDocuments(10, 42, { includeConfidential: true });
    expect(docs.map((d) => d.id).sort()).toEqual([1, 2, 3]);
  });

  it("never returns another organization's or another employee's documents", async () => {
    for (const includeConfidential of [false, true]) {
      const docs = await listEmployeeDocuments(10, 42, { includeConfidential });
      expect(docs.every((d) => d.organizationId === 10 && d.employeeId === 42)).toBe(true);
    }
    const otherOrg = await listEmployeeDocuments(20, 42, { includeConfidential: true });
    expect(otherOrg.map((d) => d.id)).toEqual([5]);
  });
});
