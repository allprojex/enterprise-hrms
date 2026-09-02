// WS-18 PASS 1C (Production Security Gate, F-1B remediation) — RLS coverage gate.
//
// WHY THIS EXISTS
// ---------------
// Production carried the stock Supabase posture in which `anon` and
// `authenticated` held blanket privileges on every table in `public`, and
// DEFAULT PRIVILEGES re-granted them on every newly created table. The only
// thing preventing unauthenticated read/write of HR data was that every table
// had RLS enabled with zero policies (deny-by-default, migration
// `0036_enable_rls_deny_default`).
//
// PASS 1C removed those grants and the default privileges in Production. That
// closes the exposure, but it removes only ONE of the two failure modes. The
// other is still live: PostgreSQL creates tables with RLS OFF, so a future
// migration that creates a table without `ENABLE ROW LEVEL SECURITY` silently
// loses deny-by-default for that table. Grants alone no longer expose it, but
// the platform's stated security posture ("every application table is RLS
// deny-by-default") would quietly stop being true, and any future decision to
// re-grant `authenticated` for a browser client would turn that gap into a
// real exposure.
//
// This gate makes that impossible to merge. It is a STATIC check: it reads the
// committed Drizzle schema and the committed migration SQL. It needs no
// database, no credentials, and no network — which is exactly why it can run
// on every pull request (CI has only a placeholder DATABASE_URL).
//
// It enforces two independent rules:
//
//   RULE 1 (repo-wide coverage): every table declared via `pgTable(...)` in
//   lib/db/src/schema must be enabled for RLS by some committed migration.
//   This is the "N/N tables covered" assertion.
//
//   RULE 2 (migration-local atomicity): any migration at or after the baseline
//   below that CREATEs a table must ENABLE RLS for that same table in the SAME
//   migration file. Drizzle wraps each migration file in a transaction, so
//   same-file means the table and its RLS state become visible atomically —
//   there is never a committed window in which a new table exists without
//   deny-by-default. Migrations before the baseline are exempt because their
//   tables were retro-enabled in bulk by 0036.
//
// A `DISABLE ROW LEVEL SECURITY` anywhere in a forward migration is always a
// failure; there is no legitimate reason for one in this codebase.
//
// Plain Node ESM, no dependencies (repo convention — see tools/preinstall.mjs
// and tools/ci/check-pnpm-audit.mjs).
//
// Usage:
//   node tools/ci/check-rls-coverage.mjs              # check the real repo
//   node tools/ci/check-rls-coverage.mjs --self-test  # negative-fixture tests
//
// Exit code 0 = pass, 1 = fail.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_DIR = join(REPO_ROOT, "lib", "db", "src", "schema");
const MIGRATIONS_DIR = join(REPO_ROOT, "lib", "db", "drizzle");

// Migrations numbered >= this must enable RLS in-file for tables they create.
// 0036_enable_rls_deny_default is the bulk retro-enable for everything before
// it, so 0037 is the first migration held to the migration-local rule.
const MIGRATION_LOCAL_BASELINE = 37;

// ---------------------------------------------------------------------------
// Pure parsing helpers (exported so the self-test can drive them directly).
// ---------------------------------------------------------------------------

/**
 * Table names declared with `pgTable("name", ...)`. Drizzle's formatter puts
 * the name on the same line as `pgTable(` for short declarations and on the
 * next line for long ones, so both shapes must be handled.
 */
export function parseSchemaTables(source) {
  const names = new Set();
  const sameLine = /pgTable\(\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g;
  for (const m of source.matchAll(sameLine)) names.add(m[1]);
  const nextLine = /pgTable\(\s*\n\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/g;
  for (const m of source.matchAll(nextLine)) names.add(m[1]);
  return names;
}

/** Table names a migration CREATEs. Handles optional quoting and IF NOT EXISTS. */
export function parseCreatedTables(sql) {
  const names = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  for (const m of sql.matchAll(re)) names.add(m[1]);
  return names;
}

/** Table names a migration ENABLEs RLS on. */
export function parseRlsEnabled(sql) {
  const names = new Set();
  const re = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  for (const m of sql.matchAll(re)) names.add(m[1]);
  return names;
}

/** Table names a migration DISABLEs RLS on — always a failure. */
export function parseRlsDisabled(sql) {
  const names = new Set();
  const re = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  for (const m of sql.matchAll(re)) names.add(m[1]);
  return names;
}

/** Leading migration number, e.g. "0074_stale_rachel_grey.sql" -> 74. */
export function migrationNumber(filename) {
  const m = /^(\d+)_/.exec(basename(filename));
  return m ? Number(m[1]) : null;
}

/**
 * The whole gate, as a pure function over already-read files, so the self-test
 * can exercise it on synthetic fixtures with no filesystem involved.
 *
 * @param {Set<string>} schemaTables
 * @param {Array<{name: string, sql: string}>} migrations forward migrations only
 * @returns {{ok: boolean, violations: string[], covered: number, total: number}}
 */
export function evaluate(schemaTables, migrations) {
  const violations = [];
  const enabledSomewhere = new Set();

  for (const { name, sql } of migrations) {
    const num = migrationNumber(name);
    const created = parseCreatedTables(sql);
    const enabled = parseRlsEnabled(sql);
    const disabled = parseRlsDisabled(sql);

    for (const t of enabled) enabledSomewhere.add(t);

    for (const t of disabled) {
      violations.push(
        `${name}: DISABLE ROW LEVEL SECURITY on "${t}". Disabling RLS is never permitted in this repository.`,
      );
    }

    if (num !== null && num >= MIGRATION_LOCAL_BASELINE) {
      for (const t of created) {
        if (!enabled.has(t)) {
          violations.push(
            `${name}: creates table "${t}" but does not ENABLE ROW LEVEL SECURITY on it in the same migration. ` +
              `Add: ALTER TABLE "public"."${t}" ENABLE ROW LEVEL SECURITY;`,
          );
        }
      }
    }
  }

  const uncovered = [...schemaTables].filter((t) => !enabledSomewhere.has(t)).sort();
  for (const t of uncovered) {
    violations.push(
      `schema table "${t}" is never enabled for RLS by any committed migration. ` +
        `Add: ALTER TABLE "public"."${t}" ENABLE ROW LEVEL SECURITY;`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    covered: schemaTables.size - uncovered.length,
    total: schemaTables.size,
  };
}

// ---------------------------------------------------------------------------
// Filesystem loading
// ---------------------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function loadSchemaTables() {
  const tables = new Set();
  for (const file of walk(SCHEMA_DIR)) {
    if (!file.endsWith(".ts")) continue;
    for (const t of parseSchemaTables(readFileSync(file, "utf8"))) tables.add(t);
  }
  return tables;
}

function loadForwardMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

// ---------------------------------------------------------------------------
// Self-test: negative fixtures. CI runs this first so the gate is proven to
// actually FAIL on bad input before its pass on the real repo means anything.
// A checker that can only ever say "ok" is worthless as a gate.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [
    {
      name: "table created after baseline without in-file RLS is rejected",
      schema: new Set(["widgets"]),
      migrations: [{ name: "0099_add_widgets.sql", sql: `CREATE TABLE "widgets" ("id" serial PRIMARY KEY);` }],
      expectFail: /creates table "widgets" but does not ENABLE ROW LEVEL SECURITY/,
    },
    {
      name: "table created after baseline WITH in-file RLS passes",
      schema: new Set(["widgets"]),
      migrations: [
        {
          name: "0099_add_widgets.sql",
          sql:
            `CREATE TABLE "widgets" ("id" serial PRIMARY KEY);--> statement-breakpoint\n` +
            `ALTER TABLE "public"."widgets" ENABLE ROW LEVEL SECURITY;`,
        },
      ],
      expectFail: null,
    },
    {
      name: "explicit DISABLE ROW LEVEL SECURITY is rejected",
      schema: new Set(["widgets"]),
      migrations: [
        {
          name: "0099_add_widgets.sql",
          sql:
            `CREATE TABLE "widgets" ("id" serial PRIMARY KEY);--> statement-breakpoint\n` +
            `ALTER TABLE "public"."widgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint\n` +
            `ALTER TABLE "public"."widgets" DISABLE ROW LEVEL SECURITY;`,
        },
      ],
      expectFail: /DISABLE ROW LEVEL SECURITY on "widgets"/,
    },
    {
      name: "schema table with no RLS anywhere in any migration is rejected",
      schema: new Set(["widgets", "orphans"]),
      migrations: [
        {
          name: "0099_add_widgets.sql",
          sql:
            `CREATE TABLE "widgets" ("id" serial PRIMARY KEY);--> statement-breakpoint\n` +
            `ALTER TABLE "public"."widgets" ENABLE ROW LEVEL SECURITY;`,
        },
      ],
      expectFail: /schema table "orphans" is never enabled for RLS/,
    },
    {
      name: "pre-baseline migration creating a table is exempt (0036 retro-enables it)",
      schema: new Set(["legacy"]),
      migrations: [
        { name: "0010_legacy.sql", sql: `CREATE TABLE "legacy" ("id" serial PRIMARY KEY);` },
        { name: "0036_enable_rls_deny_default.sql", sql: `ALTER TABLE "public"."legacy" ENABLE ROW LEVEL SECURITY;` },
      ],
      expectFail: null,
    },
    {
      name: "multiline pgTable declaration is still detected",
      schema: parseSchemaTables(`export const wide = pgTable(\n  "wide_table",\n  { id: serial("id") },\n);`),
      migrations: [],
      expectFail: /schema table "wide_table" is never enabled for RLS/,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const result = evaluate(c.schema, c.migrations);
    const matched = c.expectFail
      ? !result.ok && result.violations.some((v) => c.expectFail.test(v))
      : result.ok;
    if (matched) {
      console.log(`  PASS  ${c.name}`);
    } else {
      failed += 1;
      console.error(`  FAIL  ${c.name}`);
      console.error(`        expected: ${c.expectFail ? `violation matching ${c.expectFail}` : "no violations"}`);
      console.error(`        actual:   ${result.violations.length ? result.violations.join("; ") : "no violations"}`);
    }
  }

  if (failed > 0) {
    console.error(`\nRLS gate self-test FAILED (${failed} case(s)). The gate itself is broken.`);
    process.exit(1);
  }
  console.log(`\nRLS gate self-test passed (${cases.length} cases). The gate provably rejects unsafe migrations.`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (process.argv.includes("--self-test")) {
  console.log("RLS coverage gate — self-test (negative fixtures):\n");
  selfTest();
  process.exit(0);
}

const schemaTables = loadSchemaTables();
const migrations = loadForwardMigrations();
const result = evaluate(schemaTables, migrations);

console.log(
  `RLS coverage gate: ${result.covered}/${result.total} schema tables enabled for RLS ` +
    `across ${migrations.length} forward migrations.`,
);

if (!result.ok) {
  console.error(`\n::error::RLS coverage gate FAILED — ${result.violations.length} violation(s):\n`);
  for (const v of result.violations) console.error(`  - ${v}`);
  console.error(
    `\nEvery application table must be RLS deny-by-default before it reaches Production.\n` +
      `See docs/SUPABASE_SECURITY_REMEDIATION.md.`,
  );
  process.exit(1);
}

console.log("All application tables are RLS-covered, and no migration disables RLS.");
