/**
 * Core-HR Phase 1 — evidence on a service request must be a document on THAT
 * request's employee record in this organization (belonging to the
 * organization alone let an employee cite a colleague's document), and
 * through self-service only a `normal`-tier document. Every refusal is the same
 * message, so a caller cannot learn whether someone else's document exists.
 *
 * @workspace/db is mocked with field-based condition evaluation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, tables } = vi.hoisted(() => {
  const mk = (name: string, cols: string[]) => {
    const t: Record<string, string> & { __name: string } = { __name: name } as never;
    for (const c of cols) t[c] = `${name}.${c}`;
    return t;
  };
  return {
    fixtures: {
      types: [] as Record<string, unknown>[],
      employees: [] as Record<string, unknown>[],
      documents: [] as Record<string, unknown>[],
      writes: 0,
    },
    tables: {
      serviceRequestTypesTable: mk("service_request_types", ["id", "organizationId"]),
      serviceRequestsTable: mk("service_requests", ["id", "organizationId"]),
      serviceRequestEventsTable: mk("service_request_events", ["id"]),
      employeesTable: mk("employees", ["id", "organizationId"]),
      departmentsTable: mk("departments", ["id"]),
      customFormsTable: mk("custom_forms", ["id"]),
      organizationMembershipsTable: mk("organization_memberships", ["id"]),
      customFormSubmissionsTable: mk("custom_form_submissions", ["id", "organizationId"]),
      generatedDocumentsTable: mk("generated_documents", ["id"]),
      employeeDocumentsTable: mk("employee_documents", ["id", "organizationId", "employeeId", "confidentiality"]),
    },
  };
});

type Cond = { __op: "eq"; field: string; val: unknown } | { __op: "and"; conds: Cond[] } | undefined;
const matches = (row: Record<string, unknown>, cond: Cond): boolean =>
  !cond ? true : cond.__op === "eq" ? row[cond.field] === cond.val : cond.conds.every((c) => matches(row, c));

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ __op: "eq", field: col.split(".").pop(), val }),
  and: (...conds: Cond[]) => ({ __op: "and", conds: conds.filter(Boolean) }),
  desc: () => undefined,
  inArray: () => undefined,
}));

vi.mock("@workspace/db", () => ({
  ...tables,
  db: {
    select: () => ({
      from(table: { __name: string }) {
        const rows =
          table === tables.serviceRequestTypesTable
            ? fixtures.types
            : table === tables.employeesTable
              ? fixtures.employees
              : table === tables.employeeDocumentsTable
                ? fixtures.documents
                : [];
        let filtered = rows;
        const builder = {
          where(cond: Cond) {
            filtered = rows.filter((r) => matches(r, cond));
            return builder;
          },
          limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
        };
        return builder;
      },
    }),
    transaction: async () => {
      // Validation passed: this is where the request would be written.
      fixtures.writes += 1;
      throw new Error("WRITE_REACHED");
    },
  },
}));

vi.mock("../lib/employeeRequests/approvalStages", () => ({
  listStages: vi.fn(async () => []),
  getStage: vi.fn(),
  membershipSatisfiesStage: vi.fn(),
}));

const { assertEvidenceDocumentUsable, submitRequest, InvalidServiceRequestError } = await import("../lib/employeeRequests/serviceRequests");

const ORG = 10;
const OTHER_ORG = 20;
const ME = 42;
const COLLEAGUE = 43;

beforeEach(() => {
  fixtures.types = [{ id: 1, organizationId: ORG, active: true, employeeVisible: true, approvalRequired: false }];
  fixtures.employees = [
    { id: ME, organizationId: ORG },
    { id: COLLEAGUE, organizationId: ORG },
  ];
  fixtures.documents = [
    { id: 100, organizationId: ORG, employeeId: ME, confidentiality: "normal" },
    { id: 101, organizationId: ORG, employeeId: ME, confidentiality: "confidential" },
    { id: 200, organizationId: ORG, employeeId: COLLEAGUE, confidentiality: "normal" },
    { id: 300, organizationId: OTHER_ORG, employeeId: ME, confidentiality: "normal" },
  ];
  fixtures.writes = 0;
});

const check = (evidenceDocumentId: number, viaSelfService = true, employeeId = ME) =>
  assertEvidenceDocumentUsable({ organizationId: ORG, employeeId, evidenceDocumentId, viaSelfService });

describe("assertEvidenceDocumentUsable", () => {
  it("accepts the employee's own normal document", async () => {
    await expect(check(100)).resolves.toBeUndefined();
  });

  it("refuses a colleague's document in the same organization", async () => {
    await expect(check(200)).rejects.toThrow(InvalidServiceRequestError);
  });

  it("refuses a document from another organization, even on the same employee id", async () => {
    await expect(check(300)).rejects.toThrow(InvalidServiceRequestError);
  });

  it("refuses the employee's own confidential document through self-service", async () => {
    await expect(check(101)).rejects.toThrow(InvalidServiceRequestError);
  });

  it("lets HR attach any tier, but only from that request's employee", async () => {
    await expect(check(101, false)).resolves.toBeUndefined();
    await expect(check(200, false)).rejects.toThrow(InvalidServiceRequestError);
  });

  it("gives the same answer for a colleague's, a foreign and a non-existent document", async () => {
    const messages = await Promise.all(
      [200, 300, 999_999].map((id) =>
        check(id).then(
          () => "accepted",
          (err: Error) => err.message,
        ),
      ),
    );
    expect(new Set(messages)).toEqual(new Set(["Evidence document not found."]));
  });
});

describe("submitRequest evidence ownership", () => {
  const submit = (evidenceDocumentId: number) =>
    submitRequest({
      organizationId: ORG,
      typeId: 1,
      employeeId: ME,
      subject: "Employment letter",
      details: null,
      formSubmissionId: null,
      evidenceDocumentId,
      viaSelfService: true,
      actorApplicationUserId: 1,
      actorMembershipId: 5,
    });

  it("refuses a colleague's evidence before anything is written", async () => {
    await expect(submit(200)).rejects.toThrow("Evidence document not found.");
    expect(fixtures.writes).toBe(0);
  });

  it("refuses cross-tenant evidence before anything is written", async () => {
    await expect(submit(300)).rejects.toThrow("Evidence document not found.");
    expect(fixtures.writes).toBe(0);
  });

  it("proceeds to write with the employee's own evidence", async () => {
    await expect(submit(100)).rejects.toThrow("WRITE_REACHED");
    expect(fixtures.writes).toBe(1);
  });
});
