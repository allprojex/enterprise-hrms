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

  it("no delegation foundation was introduced by this pass (§22)", () => {
    // Pass 2A is a helper consolidation. authority_delegations, its enum and
    // its service belong to Pass 2B and must not appear yet.
    const hasDelegationTable = sourceFiles.some((f) => /authorityDelegationsTable|authority_delegations/.test(read(f)));
    expect(hasDelegationTable).toBe(false);
  });
});
