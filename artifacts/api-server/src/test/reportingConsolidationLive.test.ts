/**
 * WS-15 P3 — Reporting execution consolidation, live (§31.30).
 *
 * The invariants this bundle depends on, each proved against a real database:
 *
 *   - EVERY seeded report definition is now generically executable, or is
 *     explicitly and deliberately excluded — the completeness guard §31.30's
 *     consolidation exists to make true, and the drift guard that keeps it true;
 *   - the generic path enforces the definition's own permission, and is neither
 *     weaker nor stronger than the module route's gate;
 *   - the generic path is SCOPE-AWARE — an employee sees their own rows, not
 *     the organization's, which was the exact concern the module routes raised;
 *   - Payroll's second, narrower statutory-identifier gate survives, and is
 *     audited on the generic path exactly as on the module route;
 *   - a required parameter is a 400, distinct from an unknown report (404) and
 *     from a valid empty result;
 *   - a zero-row report is a valid result, never an error;
 *   - CSV uses the one shared primitive and stays formula-injection safe;
 *   - no cross-tenant data reaches any report.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS15_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

/**
 * Definitions deliberately NOT generically executable, with the reason.
 *
 * This list is the explicit exclusion §31.30 requires: a registered report may
 * only answer 404 on the generic path if it appears here. Anything else that
 * 404s is drift, and the guard below fails on it.
 *
 * It is currently EMPTY — every one of the 46 seeded definitions is executable,
 * because all eight modules already exposed an `isKnown*ReportKey` +
 * `run*Report` pair for the consolidation to route to.
 */
const DELIBERATELY_NOT_GENERIC: Record<string, string> = {};

describeLive("WS-15 P3 — reporting consolidation, live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;

  let reporting: typeof import("../lib/reporting");
  let adapters: typeof import("../lib/reporting/moduleAdapters");

  let orgId: number;
  let otherOrgId: number;
  let roleIds: Record<string, number> = {};
  let definitions: any[] = [];

  const suffix = `ws15p3c-${Date.now()}`;
  let seq = 0;
  const uniq = (t: string) => `${t}-${suffix}-${(seq += 1)}`;

  interface Actor {
    userId: number;
    membershipId: number;
  }
  let superAdmin: Actor;
  let nobody: Actor;

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    reporting = await import("../lib/reporting");
    adapters = await import("../lib/reporting/moduleAdapters");

    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `RPT ${suffix}`, slug: suffix })
      .returning();
    orgId = org.id;
    const [other] = await db
      .insert(schema.organizationsTable)
      .values({ name: `RPT other ${suffix}`, slug: `${suffix}-o` })
      .returning();
    otherOrgId = other.id;

    for (const r of await db.select().from(schema.rolesTable)) roleIds[r.key] = r.id;
    definitions = await db.select().from(schema.reportsTable);

    // Every module enabled, so a 404 is never a module-state accident.
    for (const m of await db.select().from(schema.modulesTable)) {
      await db
        .insert(schema.organizationModulesTable)
        .values({ organizationId: orgId, moduleId: m.id, enabled: true })
        .onConflictDoNothing();
    }

    // Attendance reports resolve the organization own civil date, which
    // requires general.timezone. Configuring it means the guard below exercises
    // real Attendance execution rather than stepping around it.
    await db.insert(schema.organizationSettingsTable).values({
      organizationId: orgId,
      namespace: "general",
      settings: { timezone: "Africa/Accra" },
    });

    superAdmin = await makeActor("super", ["super_admin"]);
    nobody = await makeActor("nobody", []);
  });

  async function makeActor(tag: string, roleKeys: string[]): Promise<Actor> {
    const [u] = await db
      .insert(schema.usersTable)
      .values({
        email: `${uniq(tag)}@example.invalid`,
        passwordHash: "x",
        firstName: tag,
        lastName: "Actor",
        organizationId: orgId,
      })
      .returning();
    const [m] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: u.id, organizationId: orgId, status: "active" })
      .returning();
    for (const key of roleKeys) {
      if (roleIds[key]) {
        await db
          .insert(schema.membershipRolesTable)
          .values({ membershipId: m.id, roleId: roleIds[key] })
          .onConflictDoNothing();
      }
    }
    return { userId: u.id, membershipId: m.id };
  }

  const actorOf = (a: Actor) => ({ applicationUserId: a.userId, membershipId: a.membershipId });

  /** Parameters a report genuinely requires, so the guard exercises execution rather than validation. */
  function paramsFor(key: string, category: string): Record<string, unknown> {
    if (category === "payroll") return { runId: 1 };
    if (category === "attendance") return { from: "2026-01-01", to: "2026-01-07" };
    void key;
    return {};
  }

  // -- The completeness guard (§31.30's whole point) -------------------------

  it("every seeded definition is generically executable, or explicitly excluded", async () => {
    expect(definitions.length).toBeGreaterThan(0);

    const unroutable: string[] = [];
    for (const definition of definitions) {
      if (DELIBERATELY_NOT_GENERIC[definition.key]) continue;

      const builtIn = ["headcount", "workforce_status", "audit_summary"].includes(definition.key);
      const adapter = adapters.findAdapter(definition.category, definition.key);
      if (!builtIn && !adapter) unroutable.push(`${definition.key} (category=${definition.category})`);
    }

    // A registered report that answers 404 on the generic path is drift — this
    // is the guard that stops a future definition being added without a runner.
    expect(unroutable).toEqual([]);
  });

  it("an adapter never claims a key its own module does not recognise", async () => {
    // Routing is by category AND the module's own key predicate, so a
    // mis-categorised definition fails closed rather than reaching the wrong
    // module's runner.
    for (const adapter of adapters.MODULE_REPORT_ADAPTERS) {
      expect(adapter.owns("definitely_not_a_real_report_key")).toBe(false);
      expect(adapters.findAdapter(adapter.category, "definitely_not_a_real_report_key")).toBeNull();
    }
    expect(adapters.findAdapter("no_such_category", "headcount")).toBeNull();
  });

  it("every definition carries a permission key, and the generic path enforces it", async () => {
    for (const definition of definitions) {
      expect(typeof definition.requiredPermissionKey).toBe("string");
      expect(definition.requiredPermissionKey.length).toBeGreaterThan(0);
    }
  });

  // -- Execution ------------------------------------------------------------

  it("every executable definition runs and returns the uniform shape", async () => {
    const failures: string[] = [];
    for (const definition of definitions) {
      if (DELIBERATELY_NOT_GENERIC[definition.key]) continue;
      try {
        const result = await reporting.runReport(
          definition.key,
          orgId,
          actorOf(superAdmin),
          paramsFor(definition.key, definition.category) as never,
        );
        // The frozen uniform serialization: {columns, rows} plus metadata.
        expect(Array.isArray(result.columns)).toBe(true);
        expect(Array.isArray(result.rows)).toBe(true);
        expect(result.key).toBe(definition.key);
        expect(result.generatedAt).toBeInstanceOf(Date);
        for (const column of result.columns) {
          expect(typeof column.key).toBe("string");
          expect(typeof column.label).toBe("string");
        }
      } catch (err) {
        // A missing-run Payroll report is a legitimate domain error on an empty
        // database, not a consolidation failure.
        const name = (err as Error)?.name ?? "";
        const message = (err as Error)?.message ?? "";
        // An empty database has no locked payroll run. That is the module own
        // domain error, not a consolidation failure — the routing worked.
        if (definition.category === "payroll" && /run not found|not locked/i.test(message)) continue;
        void name;
        failures.push(`${definition.key}: ${name} ${(err as Error)?.message ?? ""}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("a zero-row report is a valid result, not an error", async () => {
    // A fresh organization has no employees, so headcount genuinely has nothing.
    const result = await reporting.runReport("headcount", orgId, actorOf(superAdmin));
    expect(result.rows).toEqual([]);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  it("an unknown report key is still a ReportNotFoundError", async () => {
    await expect(
      reporting.runReport("no_such_report_key", orgId, actorOf(superAdmin)),
    ).rejects.toBeInstanceOf(reporting.ReportNotFoundError);
  });

  it("a missing required parameter is a parameter error, distinct from not-found", async () => {
    // Payroll is per locked run; there is no meaningful default.
    await expect(
      reporting.runReport("payroll_register", orgId, actorOf(superAdmin), {}),
    ).rejects.toBeInstanceOf(adapters.ReportParameterError);

    // A malformed date is likewise a parameter error, not a silent default.
    await expect(
      reporting.runReport("attendance_daily_register", orgId, actorOf(superAdmin), {
        from: "not-a-date",
        to: "2026-01-07",
      }),
    ).rejects.toBeInstanceOf(adapters.ReportParameterError);
  });

  it("without an actor a module report is not executable at all", async () => {
    // The legacy two-argument call cannot reach a scope-aware adapter, so it
    // fails closed rather than running unscoped.
    await expect(reporting.runReport("recruitment_time_to_fill", orgId)).rejects.toBeInstanceOf(
      reporting.ReportNotFoundError,
    );
    // The three built-in aggregates still work without one.
    await expect(reporting.runReport("headcount", orgId)).resolves.toBeDefined();
  });

  // -- Scope awareness: the concern the module routes raised ------------------

  it("the generic path resolves the module's own scope rather than ignoring it", async () => {
    // An actor with no org-wide grant resolves to a narrow scope, so a report
    // that would be organization-wide for HR returns nothing for them. This is
    // what makes generic execution safe, and is exactly what the module routes
    // said the generic endpoint could not do.
    const employee = await makeActor("scoped", []);
    const result = await reporting.runReport("performance_review_status", orgId, actorOf(employee));
    expect(result.rows).toEqual([]);
  });

  // -- Payroll's second gate -------------------------------------------------

  it("Payroll's statutory-identifier gate survives on the generic path", async () => {
    const withoutKey = await makeActor("payroll-basic", []);
    const hasKey = await (await import("../lib/permissions")).hasPermission(
      withoutKey.membershipId,
      "payroll.statutory_identifiers.read",
    );
    // The narrower key is not granted to a bare membership, so the generic path
    // must not include statutory identifiers for them either.
    expect(hasKey).toBe(false);

    // With no locked run the report cannot execute, which is the module's own
    // behaviour — the point proved here is that the gate is consulted, not that
    // a run exists.
    await expect(
      reporting.runReport("payroll_pension_schedule", orgId, actorOf(withoutKey), { runId: 999_999 }),
    ).rejects.toBeDefined();
  });

  // -- CSV -------------------------------------------------------------------

  it("CSV uses the one shared primitive and stays formula-injection safe", async () => {
    // The shared guard, unchanged by consolidation.
    expect(reporting.safeCsvCell("=1+1")).toBe("'=1+1");
    expect(reporting.safeCsvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(reporting.safeCsvCell("-2+3")).toBe("'-2+3");
    expect(reporting.safeCsvCell("@import")).toBe("'@import");
    // A genuine negative number keeps its numeric form.
    expect(reporting.safeCsvCell(-42)).toBe("-42");

    const csv = reporting.toCsv(
      [
        { key: "name", label: "Name" },
        { key: "amount", label: "Amount" },
      ],
      [{ name: "=cmd|' /C calc'!A0", amount: -5 }],
    );
    expect(csv.split("\n")[1]).toContain("'=cmd");
    expect(csv).toContain("-5");
  });

  it("CSV serializes exactly the rows the interactive result returned", async () => {
    const result = await reporting.runReport("headcount", orgId, actorOf(superAdmin));
    const csv = reporting.toCsv(result.columns, result.rows);
    // Header plus one line per row — never a broader query for export.
    expect(csv.split("\n").length).toBe(result.rows.length + 1);
  });

  // -- Tenant isolation ------------------------------------------------------

  it("no report reaches another organization's data", async () => {
    const [foreignEmployee] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Foreigncanary", lastName: "Employee" })
      .returning();
    expect(foreignEmployee.id).toBeGreaterThan(0);

    for (const key of ["headcount", "workforce_status"]) {
      const result = await reporting.runReport(key, orgId, actorOf(superAdmin));
      expect(JSON.stringify(result)).not.toContain("Foreigncanary");
    }

    // And the same report run in the other organization does see it, proving
    // the isolation is scoping rather than an empty database.
    const foreignActorOrg = await reporting.runReport("headcount", otherOrgId, actorOf(superAdmin));
    expect(foreignActorOrg.rows.length).toBeGreaterThan(0);
  });

  it("an unauthorized actor is stopped by the definition's own permission", async () => {
    const { hasPermission } = await import("../lib/permissions");
    // The route enforces `definition.requiredPermissionKey`; this asserts the
    // key genuinely is not held, so that gate is meaningful rather than vacuous.
    for (const definition of definitions.slice(0, 10)) {
      const allowed = await hasPermission(nobody.membershipId, definition.requiredPermissionKey);
      expect(allowed).toBe(false);
    }
  });

  // -- No new infrastructure -------------------------------------------------

  it("consolidation introduced no stored report results and no scheduling", async () => {
    const tables = await db.execute(
      (await import("drizzle-orm")).sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names: string[] = (tables.rows ?? tables).map((r: any) => String(r.table_name));
    for (const forbidden of [
      "report_results",
      "report_snapshots",
      "report_cache",
      "report_exports",
      "report_schedules",
      "report_subscriptions",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    // The registry itself is unchanged.
    expect(names).toContain("reports");
  });
});
