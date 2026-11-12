/**
 * VR-02B — the authorization correction (owner decision, 2026-09-21).
 *
 * Vehicle Request submission is an explicit, organization-controlled grant, so
 * the SYSTEM employee template must hold no `vehicle_request.*` key. Two
 * mechanisms, both pinned here:
 *   - the seed definition no longer lists it (fresh databases, future seeds);
 *   - migration 0082 removes the mapping VR-02A's seed already wrote, because
 *     seed:roles only ever inserts.
 *
 * The static half reads the committed files and always runs. The live half
 * executes the exact migration SQL against a disposable LOCAL database and is
 * opt-in (VR02B_MIGRATION_LIVE_DATABASE_URL) — it is kept on its own variable
 * because it deliberately flips a platform-wide template mapping back and
 * forth, which another live suite running in parallel must never observe.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const DRIZZLE = join(REPO, "lib", "db", "drizzle");
const TAG = "0082_vr02b_revoke_employee_write_own";
const UP = readFileSync(join(DRIZZLE, `${TAG}.sql`), "utf8");
const DOWN = readFileSync(join(DRIZZLE, `${TAG}.down.sql`), "utf8");
const JOURNAL = JSON.parse(readFileSync(join(DRIZZLE, "meta", "_journal.json"), "utf8")) as {
  entries: { idx: number; when: number; tag: string }[];
};

/** SQL with comments removed, whitespace collapsed — what actually executes. */
const executable = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const LIVE_URL = resolveLiveDatabaseUrl("VR02B_MIGRATION_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describe("seed definitions", () => {
  it("the employee template holds no vehicle_request key", async () => {
    const { ROLE_PERMISSIONS } = await import("@workspace/db/seed/roles-permissions-definitions");
    expect(ROLE_PERMISSIONS.employee.filter((k: string) => k.startsWith("vehicle_request."))).toEqual([]);
  });

  it("super_admin still holds all four, and the permission itself still exists", async () => {
    const { ROLE_PERMISSIONS, PERMISSIONS } = await import("@workspace/db/seed/roles-permissions-definitions");
    const four = ["vehicle_request.write.own", "vehicle_request.write.department", "vehicle_request.approve", "vehicle_request.read.all"];
    for (const key of four) {
      expect(ROLE_PERMISSIONS.super_admin).toContain(key);
      expect(PERMISSIONS.map((p: { key: string }) => p.key)).toContain(key);
    }
  });

  it("no other template grants any vehicle_request key by default", async () => {
    const { ROLE_PERMISSIONS } = await import("@workspace/db/seed/roles-permissions-definitions");
    for (const [role, keys] of Object.entries(ROLE_PERMISSIONS)) {
      if (role === "super_admin") continue; // the platform blanket map, by construction
      expect({ role, keys: (keys as readonly string[]).filter((k) => k.startsWith("vehicle_request.")) }).toEqual({ role, keys: [] });
    }
  });
});

describe("migration 0082 — committed files", () => {
  it("is the next journal entry after 0081, later in time, and appears exactly once", () => {
    const tags = JOURNAL.entries.map((e) => e.tag);
    const i81 = tags.indexOf("0081_empty_prodigy");
    expect(tags[i81 + 1]).toBe(TAG);
    expect(JOURNAL.entries[i81 + 1]!.idx).toBe(82);
    expect(JOURNAL.entries[i81 + 1]!.when).toBeGreaterThan(JOURNAL.entries[i81]!.when);
    expect(tags.filter((t) => t.startsWith("0082"))).toEqual([TAG]);
    // Later migrations may follow, but only ever later in time.
    for (const later of JOURNAL.entries.slice(i81 + 2)) {
      expect(later.when).toBeGreaterThan(JOURNAL.entries[i81 + 1]!.when);
    }
  });

  it("follows the SQL-only precedent: no snapshot, like 0036", () => {
    expect(existsSync(join(DRIZZLE, "meta", "0082_snapshot.json"))).toBe(false);
    expect(existsSync(join(DRIZZLE, "meta", "0036_snapshot.json"))).toBe(false);
  });

  it("forward: exactly one DELETE, from role_permissions only, pinned to the system employee template and the one key", () => {
    const sql = executable(UP);
    expect(sql.match(/\bDELETE\b/gi)?.length).toBe(1);
    expect(sql).toMatch(/^DELETE FROM "role_permissions" rp USING "roles" r, "permissions" p WHERE/);
    expect(sql).toContain(`r."organization_id" IS NULL`);
    expect(sql).toContain(`r."is_system_role" = true`);
    expect(sql).toContain(`r."key" = 'employee'`);
    expect(sql).toContain(`p."key" = 'vehicle_request.write.own'`);
    expect(sql).toContain(`rp."role_id" = r."id"`);
    expect(sql).toContain(`rp."permission_id" = p."id"`);
  });

  it("forward: touches no permission row, no membership, no schema object", () => {
    const sql = executable(UP);
    expect(sql).not.toMatch(/DELETE FROM "permissions"/i);
    expect(sql).not.toMatch(/membership_roles|organization_memberships/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  });

  it("down: one idempotent INSERT restoring only that mapping", () => {
    const sql = executable(DOWN);
    expect(sql.match(/\bINSERT\b/gi)?.length).toBe(1);
    expect(sql).toMatch(/^INSERT INTO "role_permissions" \("role_id", "permission_id"\) SELECT/);
    expect(sql).toContain(`r."organization_id" IS NULL`);
    expect(sql).toContain(`r."is_system_role" = true`);
    expect(sql).toContain(`r."key" = 'employee'`);
    expect(sql).toContain(`p."key" = 'vehicle_request.write.own'`);
    expect(sql).toMatch(/ON CONFLICT \("role_id", "permission_id"\) DO NOTHING;?$/);
    expect(sql).not.toMatch(/\b(DELETE|UPDATE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  });
});

describeLive("migration 0082 — executed against a real database", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let pool: any;
  let orgId: number;
  let orgEmployeeCopyId: number;
  let orgRequesterRoleId: number;
  let permissionId: number;
  let systemEmployeeId: number;
  let superAdminId: number;

  const holders = async (): Promise<string[]> => {
    const { rows } = await pool.query(
      `select coalesce(r.organization_id::text, 'SYSTEM') || ':' || r.key as h
         from role_permissions rp join roles r on r.id = rp.role_id
        where rp.permission_id = $1 order by 1`,
      [permissionId],
    );
    return rows.map((r: { h: string }) => r.h);
  };
  const total = async (): Promise<number> => Number((await pool.query("select count(*)::int n from role_permissions")).rows[0].n);
  const superAdminVehicleKeys = async (): Promise<number> =>
    Number(
      (
        await pool.query(
          `select count(*)::int n from role_permissions rp join permissions p on p.id = rp.permission_id
            where rp.role_id = $1 and p.key like 'vehicle\\_request.%'`,
          [superAdminId],
        )
      ).rows[0].n,
    );

  beforeAll(async () => {
    pool = (await import("@workspace/db")).pool;
    const one = async (q: string, p: unknown[] = []) => (await pool.query(q, p)).rows[0];
    permissionId = (await one(`select id from permissions where key = 'vehicle_request.write.own'`)).id;
    systemEmployeeId = (await one(`select id from roles where organization_id is null and key = 'employee'`)).id;
    superAdminId = (await one(`select id from roles where organization_id is null and key = 'super_admin'`)).id;
    const stamp = Date.now();
    orgId = (await one(`insert into organizations(name, slug) values ($1, $2) returning id`, [`0082 RT ${stamp}`, `rt-0082-${stamp}`])).id;
    // An org-owned copy keyed `employee` and a purpose-made requester role,
    // both holding the key deliberately — neither may be touched.
    orgEmployeeCopyId = (
      await one(`insert into roles(key, organization_id, label, is_system_role) values ('employee', $1, 'Org employee copy', false) returning id`, [orgId])
    ).id;
    orgRequesterRoleId = (
      await one(`insert into roles(key, organization_id, label, is_system_role) values ('vehicle_requester', $1, 'Vehicle Requester', false) returning id`, [orgId])
    ).id;
    for (const roleId of [orgEmployeeCopyId, orgRequesterRoleId]) {
      await pool.query(`insert into role_permissions(role_id, permission_id) values ($1, $2) on conflict do nothing`, [roleId, permissionId]);
    }
    // Reproduce the VR-02A Production state: the system template holds it.
    await pool.query(`insert into role_permissions(role_id, permission_id) values ($1, $2) on conflict do nothing`, [systemEmployeeId, permissionId]);
  });

  it("forward removes exactly the system-template mapping and nothing else", async () => {
    const before = await total();
    expect(await holders()).toContain("SYSTEM:employee");
    await pool.query(UP);
    expect(await total()).toBe(before - 1);
    const after = await holders();
    expect(after).not.toContain("SYSTEM:employee");
    expect(after).toContain("SYSTEM:super_admin");
    expect(after).toContain(`${orgId}:employee`);
    expect(after).toContain(`${orgId}:vehicle_requester`);
    expect(await superAdminVehicleKeys()).toBe(4);
    expect((await pool.query(`select 1 from permissions where id = $1`, [permissionId])).rowCount).toBe(1);
  });

  it("forward is idempotent", async () => {
    const before = await total();
    await pool.query(UP);
    expect(await total()).toBe(before);
  });

  it("down restores only that mapping, and is idempotent", async () => {
    const before = await total();
    await pool.query(DOWN);
    expect(await total()).toBe(before + 1);
    expect(await holders()).toContain("SYSTEM:employee");
    await pool.query(DOWN);
    expect(await total()).toBe(before + 1);
    expect(await holders()).toContain(`${orgId}:employee`);
    expect(await holders()).toContain(`${orgId}:vehicle_requester`);
  });

  it("re-applying forward returns to the corrected state", async () => {
    await pool.query(UP);
    expect(await holders()).not.toContain("SYSTEM:employee");
    expect(await superAdminVehicleKeys()).toBe(4);
  });
});
