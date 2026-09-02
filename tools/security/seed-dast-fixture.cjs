/**
 * WS-18 Pass 3 — disposable adversarial fixture for the DAST environment.
 * Two isolated tenants, three disposable users. Synthetic data only; no real
 * HR records, no WWM data. Destroyed with the container at the end of the pass.
 */
const crypto = require("node:crypto");
const { promisify } = require("node:util");
// `pg` is a dependency of @workspace/db, not of the repo root, and Node resolves
// from THIS file's directory — so a bare require("pg") fails. Resolve it through
// the workspace package that actually declares it, which keeps this script
// runnable from anywhere without adding a root dependency just for a test tool.
const { createRequire } = require("node:module");
const path = require("node:path");
const dbRequire = createRequire(path.join(__dirname, "..", "..", "lib", "db", "package.json"));
const { Client } = dbRequire("pg");

const scrypt = promisify(crypto.scrypt);

// Mirrors artifacts/api-server/src/lib/auth.ts exactly.
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

const URL = process.env.SEED_URL;

(async () => {
  const c = new Client({ connectionString: URL });
  await c.connect();

  // Idempotent: clear any prior disposable fixture so re-running is safe.
  //
  // Order matters. Several tables reference `organizations` WITHOUT a cascade,
  // so deleting the organizations first fails on a foreign key and leaves the
  // fixture half-removed — which then looks like a seeding bug on the next run.
  // Dependants are cleared first, scoped to the two disposable slugs only, so
  // this can never touch anything but its own fixture.
  const scoped = `(select id from organizations where slug in ('tenant-alpha','tenant-beta'))`;

  await c.query(`delete from payroll_runs where organization_id in ${scoped}`);
  await c.query(`delete from payroll_periods where organization_id in ${scoped}`);
  await c.query(`delete from branches where organization_id in ${scoped}`);
  await c.query(`delete from organization_domains where organization_id in ${scoped}`);
  await c.query(`delete from organization_modules where organization_id in ${scoped}`);
  await c.query(`delete from users where email like '%@dast.invalid'`);
  await c.query(`delete from organizations where slug in ('tenant-alpha','tenant-beta')`);


  // NOT A SECRET. This is a synthetic password for disposable fixture accounts in a
  // throwaway local database, seeded and destroyed within a single security-test
  // run. It never applies to any real account, environment, or deployment. Kept
  // literal (rather than env-driven) so a security run is reproducible from the
  // repository alone; override with DAST_FIXTURE_PASSWORD if a scanner policy
  // requires it.
  const pw = await hashPassword(process.env.DAST_FIXTURE_PASSWORD ?? "DisposableDastPassw0rd!");

  const orgType = (await c.query(`select id from organization_types limit 1`)).rows[0];

  const orgA = (
    await c.query(
      `insert into organizations (name, slug, organization_type_id, status)
       values ('Tenant Alpha','tenant-alpha',$1,'active') returning id`,
      [orgType.id],
    )
  ).rows[0].id;
  const orgB = (
    await c.query(
      `insert into organizations (name, slug, organization_type_id, status)
       values ('Tenant Beta','tenant-beta',$1,'active') returning id`,
      [orgType.id],
    )
  ).rows[0].id;

  async function mkUser(email, role, orgId) {
    const u = (
      await c.query(
        `insert into users (email, password_hash, first_name, last_name, role, organization_id)
         values ($1,$2,'Dast','User',$3,$4) returning id`,
        [email, pw, role, orgId],
      )
    ).rows[0].id;
    let membershipId = null;
    if (orgId) {
      membershipId = (
        await c.query(
          `insert into organization_memberships (application_user_id, organization_id, status)
           values ($1,$2,'active') returning id`,
          [u, orgId],
        )
      ).rows[0].id;
    }
    return { userId: u, membershipId };
  }

  const aAdmin = await mkUser("alpha.admin@dast.invalid", "org_admin", orgA);
  const aEmp = await mkUser("alpha.employee@dast.invalid", "employee", orgA);
  const bAdmin = await mkUser("beta.admin@dast.invalid", "org_admin", orgB);

  // Give Tenant Alpha's admin every role so authenticated scanning reaches real
  // handlers rather than stopping at requirePermission. Deliberately NOT
  // super_admin: platform authority is sampled separately, per §7.
  const roles = (await c.query(`select id from roles where organization_id is null`)).rows;
  for (const r of roles) {
    await c.query(
      `insert into membership_roles (membership_id, role_id) values ($1,$2) on conflict do nothing`,
      [aAdmin.membershipId, r.id],
    );
    await c.query(
      `insert into membership_roles (membership_id, role_id) values ($1,$2) on conflict do nothing`,
      [bAdmin.membershipId, r.id],
    );
  }

  // Enable every module for both tenants so module gating is not what blocks
  // the scanner — authorization is what we want exercised.
  const modules = (await c.query(`select id from modules`)).rows;
  for (const orgId of [orgA, orgB]) {
    for (const m of modules) {
      await c.query(
        `insert into organization_modules (organization_id, module_id, enabled)
         values ($1,$2,true) on conflict do nothing`,
        [orgId, m.id],
      );
    }
  }

  // One resource per tenant, so cross-tenant identifier substitution has a real
  // target on both sides.
  const branchA = (
    await c.query(
      `insert into branches (organization_id, name, code) values ($1,'Alpha HQ','A-HQ') returning id`,
      [orgA],
    )
  ).rows[0].id;
  const branchB = (
    await c.query(
      `insert into branches (organization_id, name, code) values ($1,'Beta Confidential Site','B-SEC') returning id`,
      [orgB],
    )
  ).rows[0].id;

  console.log(
    JSON.stringify(
      { orgA, orgB, branchA, branchB, aAdmin, aEmp, bAdmin, password: "DisposableDastPassw0rd!" },
      null,
      2,
    ),
  );
  await c.end();
})().catch((e) => {
  console.error("SEED FAILED:", e.message);
  process.exit(1);
});
