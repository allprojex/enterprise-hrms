/**
 * Guard: a role may never be LOOKED UP by its key without the system-template
 * scope.
 *
 * `roles.key` is unique only per scope, so `where(eq(rolesTable.key, …))` on
 * its own can return an organization-owned role — possibly another tenant's.
 * That exact shape let organization onboarding hand a new organization's
 * creator a foreign role. Every query that filters roles by key must also carry
 * the scope (`systemRoleTemplateScope()` from lib/systemRoles.ts, or an explicit
 * `rolesTable.organizationId` condition) in the same statement.
 *
 * Deliberately narrow: it inspects only statements that FILTER `rolesTable`
 * by key. Selecting or displaying `rolesTable.key` (e.g. listing a member's
 * role names) and conflict targets are untouched.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const ROOTS = [
  path.join(repoRoot, "artifacts/api-server/src"),
  path.join(repoRoot, "artifacts/api-server/scripts"),
  path.join(repoRoot, "lib/db/src"),
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "test" || name === "dist") continue;
      out.push(...sourceFiles(full));
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** A key filter on the roles table: eq(rolesTable.key, …) or inArray(rolesTable.key, …). */
const KEY_FILTER = /\b(eq|inArray)\(\s*rolesTable\.key\s*,/g;
const SCOPED = /systemRoleTemplateScope|rolesTable\.organizationId/;

/** The statement around `index`: back to the previous `;`, forward to the next one. */
function statementAround(source: string, index: number): string {
  const start = source.lastIndexOf(";", index) + 1;
  const endIdx = source.indexOf(";", index);
  return source.slice(start, endIdx === -1 ? source.length : endIdx);
}

describe("role lookups by key carry the system-template scope", () => {
  it("finds no unscoped key-only role lookup anywhere in server or db code", () => {
    const offenders: string[] = [];
    let inspected = 0;
    for (const file of ROOTS.flatMap(sourceFiles)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(KEY_FILTER)) {
        inspected += 1;
        if (!SCOPED.test(statementAround(source, match.index!))) {
          const line = source.slice(0, match.index!).split("\n").length;
          offenders.push(`${path.relative(repoRoot, file).replace(/\\/g, "/")}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The resolver itself filters by key, so the scan is known to be looking.
    expect(inspected).toBeGreaterThan(0);
  });

  it("the guard recognises the exact shape of the original onboarding defect", () => {
    const original = `const [orgAdminRole] = await tx.select().from(rolesTable).where(eq(rolesTable.key, "org_admin")).limit(1);`;
    const [match] = [...original.matchAll(KEY_FILTER)];
    expect(match).toBeTruthy();
    expect(SCOPED.test(statementAround(original, match!.index!))).toBe(false);
  });

  it("createMembershipWithRole — a dormant key-only assignment primitive — no longer exists anywhere", () => {
    const mentions = ROOTS.flatMap(sourceFiles).filter((file) => readFileSync(file, "utf8").includes("createMembershipWithRole"));
    expect(mentions).toEqual([]);
  });
});
