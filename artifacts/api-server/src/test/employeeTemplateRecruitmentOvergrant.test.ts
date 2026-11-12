/**
 * Employee template recruitment over-grant — the correction in both places.
 *
 * 1. The seed DEFINITION: the system `employee` template no longer lists the
 *    eight recruitment keys that opened organization-wide recruitment records
 *    (and offer write) to every employee, and still lists everything an
 *    ordinary employee legitimately needs.
 * 2. Migration 0083: removes exactly those eight existing grants from the
 *    system `employee` template and nothing else, with a break-glass down.
 *
 * The migration's live half is opt-in (EMPLOYEE_TEMPLATE_MIGRATION_LIVE_DATABASE_URL)
 * and kept on its own variable because it writes platform-wide template rows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@workspace/db/seed/roles-permissions-definitions";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DRIZZLE = join(REPO, "lib", "db", "drizzle");
const TAG = "0083_employee_template_recruitment_overgrant";
const UP = readFileSync(join(DRIZZLE, `${TAG}.sql`), "utf8");
const DOWN = readFileSync(join(DRIZZLE, `${TAG}.down.sql`), "utf8");
const JOURNAL = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};

const REMOVED = [
  "requisition.read",
  "vacancy.read",
  "application.read",
  "candidate.read",
  "candidate.notes.read",
  "offer.read",
  "offer.manage",
  "recruitment.reports.read",
] as const;

/** What an ordinary employee keeps — own-scoped, attempt-only and panel-participation keys. */
const KEPT = [
  "organization.read",
  "employee.read",
  "branch.read",
  "department.read",
  "position.read",
  "leave_type.read",
  "public_holiday.read",
  "leave_request.read.own",
  "leave_request.write.own",
  "leave_request.approve",
  "interview.read",
  "scorecard.submit",
  "attendance.read.own",
  "attendance.clock.own",
  "performance.read.own",
  "performance.write.own",
  "performance.review.write",
  "performance.reports.read",
  "learning.read.own",
  "learning.write.own",
  "learning.review.write",
  "learning.reports.read",
  "asset_management.read.own",
  "asset_management.write.own",
  "asset_management.reports.read",
] as const;

const executable = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

describe("seed definition — the ordinary employee template", () => {
  const employee = ROLE_PERMISSIONS.employee!;

  it("holds none of the eight recruitment over-grant keys", () => {
    for (const k of REMOVED) expect({ k, held: employee.includes(k) }).toEqual({ k, held: false });
  });

  it("is exactly the 25 legitimate ordinary-employee keys", () => {
    expect([...employee].sort()).toEqual([...KEPT].sort());
    expect(employee).toHaveLength(25);
  });

  it("keeps interview-panel participation and the attempt-only keys the services re-check", () => {
    for (const k of ["interview.read", "scorecard.submit", "leave_request.approve", "performance.review.write", "learning.review.write"]) {
      expect(employee).toContain(k);
    }
  });

  it("does not take the keys away from HR or administration templates, or from the catalogue", () => {
    const catalogue = new Set(PERMISSIONS.map((p) => p.key));
    for (const k of REMOVED) expect(catalogue.has(k)).toBe(true);
    for (const role of ["hr", "hr_manager", "hr_administrator", "super_admin"]) {
      for (const k of REMOVED) expect({ role, k, held: ROLE_PERMISSIONS[role]!.includes(k) }).toEqual({ role, k, held: true });
    }
  });

  it("canonical hr is still a strict superset of the ordinary employee", () => {
    const hr = new Set(ROLE_PERMISSIONS.hr);
    for (const k of ROLE_PERMISSIONS.employee!) expect({ k, inHr: hr.has(k) }).toEqual({ k, inHr: true });
  });
});

describe("migration 0083 — committed files", () => {
  it("is the next journal entry after 0082, later in time", () => {
    const tags = JOURNAL.entries.map((e) => e.tag);
    const i82 = tags.indexOf("0082_vr02b_revoke_employee_write_own");
    expect(tags[i82 + 1]).toBe(TAG);
    expect(JOURNAL.entries[i82 + 1]!.idx).toBe(83);
    expect(JOURNAL.entries[i82 + 1]!.when).toBeGreaterThan(JOURNAL.entries[i82]!.when);
    expect(tags.filter((t) => t.startsWith("0083"))).toEqual([TAG]);
  });

  it("follows the SQL-only precedent: no snapshot, like 0036 and 0082", () => {
    expect(existsSync(join(DRIZZLE, "meta", "0083_snapshot.json"))).toBe(false);
  });

  it("forward: exactly one DELETE, from role_permissions only, pinned to the system employee template and the eight keys", () => {
    const sql = executable(UP);
    expect(sql.match(/\bDELETE\b/gi)?.length).toBe(1);
    expect(sql).toMatch(/^DELETE FROM "role_permissions" rp USING "roles" r, "permissions" p WHERE/);
    expect(sql).toContain(`r."organization_id" IS NULL`);
    expect(sql).toContain(`r."is_system_role" = true`);
    expect(sql).toContain(`r."key" = 'employee'`);
    const listed = [...sql.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).filter((k) => k !== "employee");
    expect(listed.sort()).toEqual([...REMOVED].sort());
    expect(sql).not.toMatch(/interview\.read|scorecard\.submit/);
  });

  it("forward: touches no permission row, no membership, no schema object", () => {
    const sql = executable(UP);
    expect(sql).not.toMatch(/DELETE FROM "permissions"/i);
    expect(sql).not.toMatch(/membership_roles|organization_memberships/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  });

  it("down: one idempotent INSERT restoring only those eight mappings", () => {
    const sql = executable(DOWN);
    expect(sql.match(/\bINSERT\b/gi)?.length).toBe(1);
    expect(sql).toMatch(/^INSERT INTO "role_permissions" \("role_id", "permission_id"\) SELECT/);
    expect(sql).toContain(`r."organization_id" IS NULL`);
    expect(sql).toContain(`r."is_system_role" = true`);
    expect(sql).toContain(`r."key" = 'employee'`);
    const listed = [...sql.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).filter((k) => k !== "employee");
    expect(listed.sort()).toEqual([...REMOVED].sort());
    expect(sql).toMatch(/ON CONFLICT \("role_id", "permission_id"\) DO NOTHING;?$/);
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  });
});

const LIVE_URL = resolveLiveDatabaseUrl("EMPLOYEE_TEMPLATE_MIGRATION_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("migration 0083 — executed against a real database", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let pool: any;
  let orgId: number;
  let systemEmployeeId: number;
  let orgEmployeeCopyId: number;
  let orgRecruiterId: number;

  const keysOf = async (roleId: number): Promise<string[]> =>
    (
      await pool.query(
        `select p.key from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = $1 order by 1`,
        [roleId],
      )
    ).rows.map((r: { key: string }) => r.key);
  const total = async (): Promise<number> => Number((await pool.query("select count(*)::int n from role_permissions")).rows[0].n);
  const templateKeys = async (key: string) =>
    keysOf((await pool.query(`select id from roles where organization_id is null and key = $1`, [key])).rows[0].id);

  beforeAll(async () => {
    pool = (await import("@workspace/db")).pool;
    const one = async (q: string, p: unknown[] = []) => (await pool.query(q, p)).rows[0];
    systemEmployeeId = (await one(`select id from roles where organization_id is null and key = 'employee' and is_system_role`)).id;
    const stamp = Date.now();
    orgId = (await one(`insert into organizations(name, slug) values ($1, $2) returning id`, [`0083 RT ${stamp}`, `rt-0083-${stamp}`])).id;
    // An organization-owned copy keyed `employee` and a purpose-made recruiter
    // role, both holding the eight keys deliberately — neither may be touched.
    orgEmployeeCopyId = (
      await one(`insert into roles(key, organization_id, label, is_system_role) values ('employee', $1, 'Org employee copy', false) returning id`, [orgId])
    ).id;
    orgRecruiterId = (
      await one(`insert into roles(key, organization_id, label, is_system_role) values ('recruiter', $1, 'Recruiter', false) returning id`, [orgId])
    ).id;
    for (const roleId of [orgEmployeeCopyId, orgRecruiterId, systemEmployeeId]) {
      await pool.query(
        `insert into role_permissions(role_id, permission_id) select $1, id from permissions where key = any($2::text[]) on conflict do nothing`,
        [roleId, [...REMOVED]],
      );
    }
  });

  it("forward removes exactly the eight system-template mappings and nothing else", async () => {
    const before = await total();
    const hrBefore = await templateKeys("hr");
    const superBefore = await templateKeys("super_admin");
    await pool.query(UP);
    expect(await total()).toBe(before - REMOVED.length);
    const employeeAfter = await keysOf(systemEmployeeId);
    for (const k of REMOVED) expect(employeeAfter).not.toContain(k);
    expect(employeeAfter).toEqual(expect.arrayContaining(["interview.read", "scorecard.submit", "leave_request.approve"]));
    for (const roleId of [orgEmployeeCopyId, orgRecruiterId]) expect(await keysOf(roleId)).toEqual([...REMOVED].sort());
    expect(await templateKeys("hr")).toEqual(hrBefore);
    expect(await templateKeys("super_admin")).toEqual(superBefore);
    expect(Number((await pool.query(`select count(*)::int n from permissions where key = any($1::text[])`, [[...REMOVED]])).rows[0].n)).toBe(8);
  });

  it("forward is idempotent", async () => {
    const before = await total();
    await pool.query(UP);
    expect(await total()).toBe(before);
  });

  it("down restores only those eight mappings, and is idempotent", async () => {
    const before = await total();
    await pool.query(DOWN);
    expect(await total()).toBe(before + REMOVED.length);
    expect(await keysOf(systemEmployeeId)).toEqual(expect.arrayContaining([...REMOVED]));
    await pool.query(DOWN);
    expect(await total()).toBe(before + REMOVED.length);
    for (const roleId of [orgEmployeeCopyId, orgRecruiterId]) expect(await keysOf(roleId)).toEqual([...REMOVED].sort());
  });

  it("re-applying forward returns to the corrected state", async () => {
    await pool.query(UP);
    const employeeAfter = await keysOf(systemEmployeeId);
    for (const k of REMOVED) expect(employeeAfter).not.toContain(k);
  });
});
