import { and, eq } from "drizzle-orm";
import { db, employeesTable } from "@workspace/db";
import { logger } from "../logger";
import { EMPLOYEE_360_PROVIDERS } from "./providers";
import type { Employee360Context, Employee360Result, Employee360Section, Employee360SectionKey } from "./types";

/**
 * WS-15 P2/P3 — the Employee 360 section aggregator (§31.29).
 *
 * READ COMPOSITION ONLY. This fans out to bounded per-module providers in
 * parallel and returns their safe summaries. It stores nothing, caches nothing
 * and writes nothing, so a changed permission or module state is reflected on
 * the very next request.
 *
 * THREE OUTCOMES, TREATED DIFFERENTLY ON PURPOSE — the same convention the
 * Action Centre uses, because §31.29 says to follow §31.5 exactly:
 *
 *   omitted     — the caller may not read the module, OR the module is
 *                 disabled, OR it genuinely holds nothing for this employee.
 *                 All three look identical from outside, and that is the point:
 *                 an empty grievance section would assert that grievances exist
 *                 and this employee has none, which is itself a disclosure.
 *   unavailable — the caller IS authorized but the module's query failed.
 *                 Named, because a page that quietly drops a section the reader
 *                 was entitled to is worse than one that admits it.
 *   present     — a safe summary plus a deep link.
 *
 * An error thrown inside an authorization check collapses to OMITTED rather
 * than unavailable, so an operational fault in a permission lookup can never
 * disclose that a protected module exists.
 */

export class Employee360EmployeeNotFoundError extends Error {
  constructor() {
    super("Employee not found in this organization.");
    this.name = "Employee360EmployeeNotFoundError";
  }
}

/**
 * Proves the employee belongs to the caller's organization before any provider
 * runs. A forged cross-tenant employee id fails here, once, rather than being
 * caught eight times over (§31.24).
 */
async function assertEmployeeInOrganization(organizationId: number, employeeId: number): Promise<void> {
  const [row] = await db
    .select({ id: employeesTable.id })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new Employee360EmployeeNotFoundError();
}

export async function resolveEmployee360(ctx: Employee360Context): Promise<Employee360Result> {
  await assertEmployeeInOrganization(ctx.organizationId, ctx.employeeId);

  const outcomes = await Promise.all(
    EMPLOYEE_360_PROVIDERS.map(async (provider): Promise<
      { state: "omitted" } | { state: "unavailable" } | { state: "ok"; section: Employee360Section | null }
    > => {
      let authorized = false;
      try {
        authorized = await provider.authorize(ctx);
      } catch (err) {
        logger.error(
          { err, section: provider.key, organizationId: ctx.organizationId },
          "employee 360 provider authorization failed",
        );
        return { state: "omitted" };
      }
      if (!authorized) return { state: "omitted" };

      try {
        return { state: "ok", section: await provider.query(ctx) };
      } catch (err) {
        // The real failure goes to the server log through the existing
        // observability convention; the client learns only which section could
        // not be loaded, never why (§31.22).
        logger.error(
          { err, section: provider.key, organizationId: ctx.organizationId },
          "employee 360 provider query failed",
        );
        return { state: "unavailable" };
      }
    }),
  );

  const sections: Employee360Section[] = [];
  const unavailable: Employee360SectionKey[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.state === "unavailable") {
      unavailable.push(EMPLOYEE_360_PROVIDERS[index]!.key);
      return;
    }
    // A `null` section means the module is readable but holds nothing for this
    // employee — indistinguishable from omission, deliberately.
    if (outcome.state === "ok" && outcome.section) sections.push(outcome.section);
  });

  return { sections, unavailableSections: unavailable };
}
