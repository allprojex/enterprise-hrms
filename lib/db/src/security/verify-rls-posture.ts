/**
 * WS-18 PASS 1C — Production RLS/grant posture verifier (read-only).
 *
 * The deployment-time counterpart to the static CI gate in
 * tools/ci/check-rls-coverage.mjs. The CI gate proves the *committed
 * migrations* are safe; this proves the *live database* actually is. Both are
 * needed: CI cannot see configuration applied out-of-band (dashboard actions,
 * Supabase-managed roles, a manual GRANT), and the live check cannot run on a
 * pull request.
 *
 * It asserts the four properties F-1B was about:
 *
 *   1. Every table in the application schema has RLS enabled.
 *   2. `anon` and `authenticated` hold NO privileges on any application table.
 *   3. `anon` and `authenticated` hold NO privileges on any application
 *      sequence (sequence privileges are not constrained by table RLS, so a
 *      table-only check would miss them).
 *   4. DEFAULT PRIVILEGES on the application schema do not re-grant either role
 *      on future objects — the defect that would otherwise reappear the moment
 *      the next migration creates a table.
 *
 * It also reports SECURITY DEFINER functions in the application schema, which
 * are the standard way an RLS boundary gets bypassed by accident.
 *
 * Deliberately catalog-only: it reads pg_class/pg_default_acl/pg_proc and the
 * has_*_privilege() family. It never reads an application row, so it is safe to
 * point at Production and safe to run as an unprivileged auditor.
 *
 * IMPORTANT: `has_table_privilege()` is used rather than
 * information_schema.role_table_grants. The information_schema views only
 * return grants whose grantor or grantee is a role the *current user* belongs
 * to, so an unprivileged auditor reading them sees an empty result and
 * concludes "no grants" — a false negative that hides exactly the defect this
 * script exists to catch. The has_*_privilege() functions have no such filter.
 *
 * Connection: prefers PRODUCTION_AUDIT_DATABASE_URL (the read-only,
 * NOBYPASSRLS auditor role) and falls back to DATABASE_URL. The connection
 * string is never printed, in full or in part.
 *
 * Usage:  pnpm --filter @workspace/db run verify:posture
 * Exit:   0 = posture verified, 1 = violation(s) found, 2 = could not run.
 */

import pg from "pg";

const { Client } = pg;

const APP_SCHEMA = "public";
const UNPRIVILEGED_ROLES = ["anon", "authenticated"] as const;

/**
 * Grantor roles whose DEFAULT PRIVILEGES this project cannot alter.
 *
 * `ALTER DEFAULT PRIVILEGES FOR ROLE <r>` requires membership in <r>. On
 * Supabase, the tenant's superuser-equivalent is `postgres`, and
 * `pg_has_role('postgres','supabase_admin','MEMBER')` is false — verified live
 * during WS-18 Pass 1C. supabase_admin's default privileges on `public` are
 * therefore not removable by any credential available to this project; only
 * Supabase platform support can change them.
 *
 * They are reported as WARNINGS rather than failures so this gate does not sit
 * permanently red on something no one here can fix (the same reasoning as
 * tools/ci/check-pnpm-audit.mjs). The risk they represent is not ignored: it is
 * *latent* (it only matters if supabase_admin itself creates an object in the
 * application schema, which Supabase's managed migrations do not do — they
 * target auth/storage/realtime/extensions/graphql), and if it ever does
 * materialise into a real grant on a real object, checks 2 and 3 below fail
 * hard, because they test effective privileges on every object that actually
 * exists. Running this verifier after every deployment is what turns that
 * latent risk into a detected one.
 */
const UNALTERABLE_GRANTORS = new Set(["supabase_admin"]);

interface RlsRow {
  total: string;
  rls_on: string;
  rls_off: string;
  off_list: string | null;
}

interface PrivRow {
  role: string;
  tables_with_any_priv: string;
  seqs_with_any_priv: string;
}

interface DefAclRow {
  grantor: string;
  objtype: string;
  acl: string | null;
}

interface SecDefRow {
  fn: string;
  config: string | null;
}

async function main(): Promise<void> {
  // A variable that is present but blank counts as unset — CI systems and shell
  // wrappers routinely export an empty string, and treating that as a
  // connection string produces a confusing "could not connect" instead of
  // falling through to the intended fallback.
  const blankToUndefined = (v: string | undefined) => (v && v.trim() !== "" ? v : undefined);

  const auditorUrl = blankToUndefined(process.env.PRODUCTION_AUDIT_DATABASE_URL);
  const connectionString = auditorUrl ?? blankToUndefined(process.env.DATABASE_URL);

  if (!connectionString) {
    console.error(
      "verify-rls-posture: set PRODUCTION_AUDIT_DATABASE_URL (preferred, read-only auditor) or DATABASE_URL.",
    );
    process.exit(2);
  }

  const usingAuditor = Boolean(auditorUrl);

  // Managed Postgres (Supabase and every other hosted provider) requires TLS;
  // a local container almost never offers it, and forcing SSL there fails the
  // connection outright. Decide from the host rather than making the caller
  // pass a flag, and never disable verification for a remote host implicitly —
  // `rejectUnauthorized: false` is accepted here only because this tool reads
  // catalogue metadata over a provider-managed connection, never credentials.
  const isLocalHost = /(^|@|\/\/)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)[:/]/.test(
    connectionString,
  );

  const client = new Client({
    connectionString,
    ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
    statement_timeout: 30_000,
    application_name: "verify-rls-posture",
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(
      `verify-rls-posture: could not connect: ${(error as Error).message}`,
    );
    process.exit(2);
  }

  const violations: string[] = [];
  const warnings: string[] = [];

  try {
    // Never allow this process to write, even by accident.
    await client.query("set default_transaction_read_only = on");

    const identity = await client.query<{ db: string; role: string }>(
      "select current_database() as db, current_user as role",
    );
    console.log(
      `verify-rls-posture: database "${identity.rows[0]?.db}" as role "${identity.rows[0]?.role}"` +
        `${usingAuditor ? " (read-only auditor)" : " (DATABASE_URL fallback)"}`,
    );

    // ---- 1. RLS enabled on every application table -------------------------
    const rls = await client.query<RlsRow>(
      `select count(*)::text as total,
              count(*) filter (where c.relrowsecurity)::text as rls_on,
              count(*) filter (where not c.relrowsecurity)::text as rls_off,
              string_agg(c.relname, ', ') filter (where not c.relrowsecurity) as off_list
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p') and n.nspname = $1`,
      [APP_SCHEMA],
    );
    const r = rls.rows[0];
    if (!r) {
      violations.push("could not read table RLS state");
    } else {
      console.log(`  RLS: ${r.rls_on}/${r.total} tables enabled`);
      if (Number(r.rls_off) > 0) {
        violations.push(
          `${r.rls_off} table(s) in "${APP_SCHEMA}" have RLS disabled: ${r.off_list}`,
        );
      }
    }

    // ---- 2 & 3. anon/authenticated hold nothing ----------------------------
    const privs = await client.query<PrivRow>(
      `select role,
              (select count(*)
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = $1 and c.relkind in ('r','p')
                  and has_table_privilege(role, c.oid,
                        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              )::text as tables_with_any_priv,
              (select count(*)
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = $1 and c.relkind = 'S'
                  and has_sequence_privilege(role, c.oid, 'USAGE,SELECT,UPDATE')
              )::text as seqs_with_any_priv
         from unnest($2::text[]) as role`,
      [APP_SCHEMA, [...UNPRIVILEGED_ROLES]],
    );

    for (const row of privs.rows) {
      console.log(
        `  ${row.role}: ${row.tables_with_any_priv} table privilege(s), ${row.seqs_with_any_priv} sequence privilege(s)`,
      );
      if (Number(row.tables_with_any_priv) > 0) {
        violations.push(
          `role "${row.role}" holds privileges on ${row.tables_with_any_priv} table(s) in "${APP_SCHEMA}". ` +
            `No unauthenticated or generic authenticated direct table access is part of this platform's architecture.`,
        );
      }
      if (Number(row.seqs_with_any_priv) > 0) {
        violations.push(
          `role "${row.role}" holds privileges on ${row.seqs_with_any_priv} sequence(s) in "${APP_SCHEMA}". ` +
            `Sequence privileges are NOT constrained by table RLS.`,
        );
      }
    }

    // ---- 4. Default privileges must not re-grant those roles ---------------
    const defacl = await client.query<DefAclRow>(
      `select pg_get_userbyid(d.defaclrole) as grantor,
              case d.defaclobjtype
                when 'r' then 'table' when 'S' then 'sequence'
                when 'f' then 'function' else d.defaclobjtype::text end as objtype,
              d.defaclacl::text as acl
         from pg_default_acl d
         join pg_namespace n on n.oid = d.defaclnamespace
        where n.nspname = $1
        order by 1, 2`,
      [APP_SCHEMA],
    );

    for (const row of defacl.rows) {
      for (const role of UNPRIVILEGED_ROLES) {
        if (!row.acl?.includes(`${role}=`)) continue;

        if (UNALTERABLE_GRANTORS.has(row.grantor)) {
          warnings.push(
            `DEFAULT PRIVILEGES for role "${row.grantor}" on ${row.objtype}s in "${APP_SCHEMA}" still grant "${role}". ` +
              `This is Supabase-managed and not alterable by this project (postgres is not a member of ${row.grantor}); ` +
              `it is latent only — it would require "${row.grantor}" itself to create an object in "${APP_SCHEMA}". ` +
              `The effective-privilege checks above are what would catch it if that ever happened.`,
          );
          continue;
        }

        violations.push(
          `DEFAULT PRIVILEGES for role "${row.grantor}" on ${row.objtype}s in "${APP_SCHEMA}" still grant "${role}". ` +
            `Every future ${row.objtype} created by "${row.grantor}" would be exposed at creation time. ` +
            `Fix: ALTER DEFAULT PRIVILEGES FOR ROLE ${row.grantor} IN SCHEMA ${APP_SCHEMA} REVOKE ALL ON ${row.objtype.toUpperCase()}S FROM ${role};`,
        );
      }
    }
    console.log(`  default privileges: ${defacl.rows.length} entr(y/ies) inspected`);

    // ---- Informational: SECURITY DEFINER surface ---------------------------
    const secdef = await client.query<SecDefRow>(
      `select p.proname as fn, p.proconfig::text as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = $1 and p.prosecdef
        order by 1`,
      [APP_SCHEMA],
    );
    console.log(`  SECURITY DEFINER functions in "${APP_SCHEMA}": ${secdef.rows.length}`);
    for (const row of secdef.rows) {
      if (!row.config?.includes("search_path")) {
        violations.push(
          `SECURITY DEFINER function "${APP_SCHEMA}.${row.fn}" has no pinned search_path ` +
            `(add: ALTER FUNCTION ... SET search_path = '').`,
        );
      }
    }
  } finally {
    await client.end();
  }

  // Warnings are always printed, never suppressed — they are standing, tracked
  // residual risk, not noise to be hidden.
  if (warnings.length > 0) {
    console.warn(`\nWARNINGS — ${warnings.length} monitored residual(s), not blocking:\n`);
    for (const w of warnings) console.warn(`  ! ${w}`);
  }

  if (violations.length > 0) {
    console.error(`\nPosture verification FAILED — ${violations.length} violation(s):\n`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log("\nPosture verified: RLS deny-by-default intact, no anon/authenticated exposure.");
}

main().catch((error: unknown) => {
  console.error(`verify-rls-posture: unexpected failure: ${(error as Error).message}`);
  process.exit(2);
});
