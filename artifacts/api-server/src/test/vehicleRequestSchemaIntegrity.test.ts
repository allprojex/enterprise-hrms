/**
 * VR-02A — the delete semantics of the three vehicle-request tables.
 *
 * The decision log is the permanent record of who decided what under whose
 * authority. If its parent FK cascades, deleting a request takes the whole
 * history with it, silently, and no code review catches it because the delete
 * that does the damage lives in some later workstream.
 *
 * WS-9 settled this for the identical relationship — `hire_authorization_
 * decisions.hire_authorization_id` is `restrict` — so these assertions pin the
 * same answer here, across all three places it has to agree: the Drizzle
 * schema, the forward migration, and the snapshot the drift gate compares.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(__dirname, "..", "..", "..", "..");
const SCHEMA = readFileSync(join(REPO, "lib", "db", "src", "schema", "vehicle-requests.ts"), "utf8");
const MIGRATION = readFileSync(join(REPO, "lib", "db", "drizzle", "0081_empty_prodigy.sql"), "utf8");
const SNAPSHOT = JSON.parse(readFileSync(join(REPO, "lib", "db", "drizzle", "meta", "0081_snapshot.json"), "utf8")) as {
  tables: Record<string, { foreignKeys?: Record<string, { columnsFrom: string[]; onDelete: string }> }>;
};

/** onDelete by originating column, for one of the three new tables. */
function deleteRules(table: string): Record<string, string> {
  const fks = SNAPSHOT.tables[`public.${table}`]?.foreignKeys ?? {};
  const out: Record<string, string> = {};
  for (const fk of Object.values(fks)) out[fk.columnsFrom.join(",")] = fk.onDelete;
  return out;
}

describe("the decision log cannot be deleted out from under a request", () => {
  it("declares request_id as restrict in the Drizzle schema", () => {
    const requestIdRef = SCHEMA.match(/requestId: integer\("request_id"\)[\s\S]{0,200}?onDelete: "(\w+)"/);
    expect(requestIdRef).not.toBeNull();
    expect(requestIdRef![1]).toBe("restrict");
  });

  it("declares it as restrict in the forward migration", () => {
    expect(MIGRATION).toContain(
      `ALTER TABLE "vehicle_request_approvals" ADD CONSTRAINT "vehicle_request_approvals_request_id_vehicle_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."vehicle_requests"("id") ON DELETE restrict`,
    );
  });

  it("records it as restrict in the snapshot the drift gate reads", () => {
    expect(deleteRules("vehicle_request_approvals").request_id).toBe("restrict");
  });

  it("introduces no cascading delete anywhere in migration 0081", () => {
    // A cascade on any of these three tables would let one delete reach further
    // than its author intended. None of them needs one.
    expect(MIGRATION).not.toContain("ON DELETE cascade");
  });
});

describe("identity and scope restrict; attribution sets null", () => {
  it("vehicle_request_approval_stages", () => {
    expect(deleteRules("vehicle_request_approval_stages")).toEqual({
      organization_id: "restrict",
      created_by_membership_id: "set null",
      updated_by_membership_id: "set null",
    });
  });

  it("vehicle_requests — including the snapshotted requesting department", () => {
    expect(deleteRules("vehicle_requests")).toEqual({
      organization_id: "restrict",
      submitted_by_membership_id: "restrict",
      requester_employee_id: "restrict",
      // The department is the approval-routing key, resolved once at
      // submission. Restrict is what stops it being deleted away from under a
      // historical request.
      requesting_department_id: "restrict",
      vehicle_id: "restrict",
      cancelled_by_membership_id: "set null",
    });
  });

  it("vehicle_request_approvals", () => {
    expect(deleteRules("vehicle_request_approvals")).toEqual({
      organization_id: "restrict",
      request_id: "restrict",
      decided_by_membership_id: "restrict",
      decided_by_user_id: "set null",
      delegator_head_membership_id: "set null",
    });
  });
});

describe("the down migration still reverses cleanly", () => {
  it("drops the decision log before the requests it points at", () => {
    const down = readFileSync(join(REPO, "lib", "db", "drizzle", "0081_empty_prodigy.down.sql"), "utf8");
    const approvals = down.indexOf(`DROP TABLE IF EXISTS "vehicle_request_approvals"`);
    const requests = down.indexOf(`DROP TABLE IF EXISTS "vehicle_requests"`);
    expect(approvals).toBeGreaterThan(-1);
    expect(requests).toBeGreaterThan(-1);
    // With restrict, this ordering is enforced by the database, not merely tidy.
    expect(approvals).toBeLessThan(requests);
  });
});
