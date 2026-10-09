/**
 * WS-16 Pass 2A — structural guards on the shared direct-report helper.
 *
 * These assertions are about the SHAPE of the codebase rather than its
 * runtime behaviour, and they exist because the failure they guard against is
 * silent: nothing breaks, no test goes red, and historical workflow authority
 * quietly becomes live. A grep in CI is the only thing that catches it.
 *
 * They need no database, so they run in every suite execution.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test" || entry === "node_modules") continue;
      walk(full, out);
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(SRC);
const read = (path: string) => readFileSync(path, "utf8");

describe("WS-16 Pass 2A — shared direct-report helper boundaries", () => {
  it("is never imported by a Performance or Learning authority path (§32.3, §32.23 #34)", () => {
    // Performance's reviewerEmployeeId and Learning's managerEmployeeIdSnapshot
    // are SNAPSHOT authority: they record who owned a review or an enrolment at
    // the time. Routing either through the live helper would silently rewrite
    // history. This asserts the import edge simply does not exist.
    const offenders = sourceFiles
      .filter((f) => /(performance|learning)/i.test(f.split(/[\\/]/).pop() ?? ""))
      .filter((f) => /from "\.\.?\/(lib\/)?directReports"/.test(read(f)))
      .map((f) => f.replace(SRC, ""));

    expect(offenders).toEqual([]);
  });

  it("leaves exactly one live direct-report query in the shared helper, plus the retained roster (§32.9)", () => {
    // Every forward `reportingManagerId = <manager>` query should now live in
    // one of exactly two places. A third would mean a new inline copy has
    // appeared — the duplication this pass removed, growing back.
    const forwardQuery = /eq\(\s*employeesTable\.reportingManagerId\s*,/;
    const sites = sourceFiles.filter((f) => forwardQuery.test(read(f))).map((f) => f.replace(SRC, "").replace(/\\/g, "/"));

    expect(sites.sort()).toEqual(["/lib/directReports.ts", "/lib/managerPortalAuthorization.ts"]);
  });

  it("the shared helper applies no employment-status filter (§32.7)", () => {
    // Adding one here would narrow six shipped scopes at once, silently.
    const helper = read(join(SRC, "lib", "directReports.ts"));
    const body = helper.slice(helper.indexOf("export async function"));
    expect(body).not.toMatch(/employmentStatus/);
  });

  it("the shared helper predicates organizationId explicitly (§32.7, §9)", () => {
    const helper = read(join(SRC, "lib", "directReports.ts"));
    expect(helper).toMatch(/eq\(employeesTable\.organizationId,\s*organizationId\)/);
  });

  it("the retained roster helper still excludes terminated employees (§32.9 #7)", () => {
    const retained = read(join(SRC, "lib", "managerPortalAuthorization.ts"));
    expect(retained).toMatch(/ne\(employeesTable\.employmentStatus,\s*"terminated"\)/);
  });

  it("the delegation foundation has only its ONE approved business consumer (§32.21)", () => {
    // This guard was written in Pass 2A to assert the delegation foundation
    // did not exist yet. Pass 2B built it, so the guard now protects the
    // boundary that actually matters: adoption requires an explicit Owner
    // Decision naming a module (Pass 2D, gated), and a file appearing here
    // that is not on this list means a consumer was wired without one.
    //
    // The set was frozen EMPTY until 2026-09-20, when the owner authorized
    // VR-02 Vehicle Requests to compose the shared department-head and
    // authority-delegation primitives for its configurable approval chain.
    // That is the FIRST and so far ONLY approved consumer: Leave, Recruitment,
    // WS-13, Onboarding, Payroll, Performance, Learning, Assets, Office
    // Inventory, Employee Relations, Skills/Succession and Lifecycle all
    // remain expressly not delegatable, and each would need its own decision.
    //
    // Note what this consumer does NOT do: it never writes a delegation, never
    // exposes one over HTTP (the test below still holds), and never treats a
    // delegation as a permission — a delegate still needs
    // vehicle_request.approve in their own right.
    const ALLOWED = new Set(["/lib/authorityDelegations.ts", "/lib/vehicleRequestAuthority.ts"]);
    const consumers = sourceFiles
      .filter((f) => /authorityDelegationsTable|from "\.\.?\/(lib\/)?authorityDelegations"/.test(read(f)))
      .map((f) => f.replace(SRC, "").replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f));

    expect(consumers).toEqual([]);
  });

  it("the delegation foundation is not exposed over HTTP yet (Pass 2C is gated)", () => {
    // The holder-facing API and UI are Pass 2C, gated on a first approved
    // consumer (§32.21, §32.24). A dormant foundation needs no public route,
    // and shipping one would be an authority surface nobody approved.
    const routeFiles = sourceFiles.filter((f) => f.includes(`${require("node:path").sep}routes${require("node:path").sep}`));
    const exposed = routeFiles
      .filter((f) => /authorityDelegations|authority_delegations/.test(read(f)))
      .map((f) => f.replace(SRC, ""));

    expect(exposed).toEqual([]);
  });

  it("only department_head authority is representable (§32.10, Owner Decision Q5)", () => {
    // A single-member enum makes any other authority type unrepresentable in
    // the database rather than merely rejected at runtime. Widening it needs
    // its own Owner Decision (§32.25).
    const schemaFile = readFileSync(
      join(SRC, "..", "..", "..", "lib", "db", "src", "schema", "authority-delegations.ts"),
      "utf8",
    );
    const enumLine = schemaFile.match(/pgEnum\("delegatable_authority_type",\s*\[([^\]]*)\]/);
    expect(enumLine).not.toBeNull();
    const members = (enumLine![1].match(/"([^"]+)"/g) ?? []).map((m) => m.replace(/"/g, ""));
    expect(members).toEqual(["department_head"]);
  });

  it("Office Inventory's own delegation module is untouched by the shared foundation (§32.20)", () => {
    // No migration, no dual-write, no cutover: Office Inventory must not read
    // or write the shared table, and the shared service must not reach into
    // Office Inventory's.
    const officeInventory = read(join(SRC, "lib", "officeInventoryDelegations.ts"));
    expect(officeInventory).not.toMatch(/authorityDelegations/);

    const shared = read(join(SRC, "lib", "authorityDelegations.ts"));
    expect(shared).not.toMatch(/officeInventory/i);
  });
});
