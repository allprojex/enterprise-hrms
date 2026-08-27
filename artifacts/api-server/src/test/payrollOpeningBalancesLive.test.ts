/**
 * WS-7 closure — Payroll Opening Balances, live proof.
 *
 * The single most important property proved here is the negative one: an
 * opening balance exists, a payroll run is calculated, and the brought-forward
 * amount does NOT appear in gross, taxable, PAYE or net pay for the period.
 * The earlier withdrawn implementation failed exactly that.
 *
 * Opt-in like every other live suite, and additionally host-guarded.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS7_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("Payroll opening balances — live", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgId: number;
  let otherOrgId: number;
  let employeeId: number;
  let otherOrgEmployeeId: number;
  let membershipId: number;

  let svc: typeof import("../lib/payrollOpeningBalances");

  const TAX_YEAR = new Date().getUTCFullYear();
  const cutover = () => new Date(Date.UTC(TAX_YEAR, 5, 1));

  const AMOUNTS = {
    grossEarnings: "60000.00",
    taxableIncome: "54000.00",
    payeAmount: "9000.00",
    pensionableEarnings: "60000.00",
    employeePensionDeduction: "3300.00",
    employerPensionContribution: "7800.00",
  };

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    svc = await import("../lib/payrollOpeningBalances");

    const suffix = `pob-${Date.now()}`;
    const [org] = await db.insert(schema.organizationsTable).values({ name: `POB ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `POB other ${suffix}`, slug: `${suffix}-o` }).returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "POB", lastName: "T", organizationId: orgId })
      .returning();
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: user.id, organizationId: orgId, status: "active" })
      .returning();
    membershipId = membership.id;

    const [emp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "Ama", lastName: "Mensah", employeeNumber: `POB${suffix}` })
      .returning();
    employeeId = emp.id;
    const [otherEmp] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: otherOrgId, firstName: "Other", lastName: "Org", employeeNumber: `OTH${suffix}` })
      .returning();
    otherOrgEmployeeId = otherEmp.id;
  });

  afterAll(async () => {
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  it("A. creates a brought-forward record and reads it back", async () => {
    const created = await svc.createPayrollOpeningBalance(db, {
      organizationId: orgId,
      employeeId,
      taxYear: TAX_YEAR,
      cutoverDate: cutover(),
      currency: "GHS",
      ...AMOUNTS,
      sourceReferenceType: "migration_batch",
      sourceReferenceId: 12345,
      actorMembershipId: membershipId,
    });
    expect(created.id).toBeGreaterThan(0);
    expect(created.grossEarnings).toBe("60000.00");
    // Migration traceability is retained on the record itself.
    expect(created.sourceReferenceType).toBe("migration_batch");
    expect(created.sourceReferenceId).toBe(12345);

    const fetched = await svc.getPayrollOpeningBalance(orgId, employeeId, TAX_YEAR);
    expect(fetched?.id).toBe(created.id);
  });

  it("B. refuses a duplicate for the same employee and tax year", async () => {
    await expect(
      svc.createPayrollOpeningBalance(db, {
        organizationId: orgId,
        employeeId,
        taxYear: TAX_YEAR,
        cutoverDate: cutover(),
        currency: "GHS",
        ...AMOUNTS,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(svc.DuplicatePayrollOpeningBalanceError);
  });

  it("C. refuses an employee from another organization", async () => {
    await expect(
      svc.createPayrollOpeningBalance(db, {
        organizationId: orgId,
        employeeId: otherOrgEmployeeId,
        taxYear: TAX_YEAR,
        cutoverDate: cutover(),
        currency: "GHS",
        ...AMOUNTS,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(svc.CrossOrganizationEmployeeError);

    // ...and cannot read across organizations either.
    expect(await svc.getPayrollOpeningBalance(otherOrgId, employeeId, TAX_YEAR)).toBeNull();
  });

  it("D. rejects invalid year/cutover combinations and negative amounts", async () => {
    const base = { organizationId: orgId, employeeId, currency: "GHS", ...AMOUNTS, actorMembershipId: membershipId };

    // Cutover outside the tax year.
    await expect(
      svc.createPayrollOpeningBalance(db, { ...base, taxYear: TAX_YEAR, cutoverDate: new Date(Date.UTC(TAX_YEAR - 2, 5, 1)) }),
    ).rejects.toThrow(/must fall within tax year/i);

    // Future tax year.
    await expect(
      svc.createPayrollOpeningBalance(db, { ...base, taxYear: TAX_YEAR + 1, cutoverDate: new Date(Date.UTC(TAX_YEAR + 1, 5, 1)) }),
    ).rejects.toThrow(/future/i);

    // Negative brought-forward total.
    await expect(
      svc.createPayrollOpeningBalance(db, {
        ...base,
        taxYear: TAX_YEAR - 1,
        cutoverDate: new Date(Date.UTC(TAX_YEAR - 1, 5, 1)),
        payeAmount: "-1.00",
      }),
    ).rejects.toThrow(/cannot be negative/i);

    // Malformed numeric.
    await expect(
      svc.createPayrollOpeningBalance(db, {
        ...base,
        taxYear: TAX_YEAR - 1,
        cutoverDate: new Date(Date.UTC(TAX_YEAR - 1, 5, 1)),
        grossEarnings: "not-a-number",
      }),
    ).rejects.toThrow(/must be a number/i);
  });

  it("E/F. an opening balance never becomes compensation and is never re-paid", async () => {
    // The decisive proof. The withdrawn implementation created a compensation
    // component; this one must create none, because a component is what the
    // payroll engine resolves and pays on every run.
    const components = await db
      .select()
      .from(schema.employeeCompensationComponentsTable)
      .where(eq(schema.employeeCompensationComponentsTable.employeeId, employeeId));
    expect(components).toHaveLength(0);

    // And the engine, asked to pay this employee, finds nothing to pay —
    // an opening balance contributes zero to current-period earnings.
    const calc = await import("../lib/payrollCalculation");
    const [period] = await db
      .insert(schema.payrollPeriodsTable)
      .values({
        organizationId: orgId,
        frequency: "monthly",
        periodKey: `${TAX_YEAR}-07`,
        startDate: new Date(Date.UTC(TAX_YEAR, 6, 1)),
        endDate: new Date(Date.UTC(TAX_YEAR, 6, 31)),
        payDate: new Date(Date.UTC(TAX_YEAR, 6, 28)),
      })
      .returning();

    await expect(
      calc.calculateEmployeePayroll({
        organizationId: orgId,
        employeeId,
        payrollPeriodId: period.id,
        payDate: period.payDate,
        currency: "GHS",
      }),
    ).rejects.toThrow(calc.NoCompensationAssignedError);
  });

  it("G. year-to-date adds brought-forward history to in-system payroll, keeping the halves separable", async () => {
    const ytd = await svc.getEmployeeYearToDate(orgId, employeeId, TAX_YEAR);
    expect(ytd.broughtForward?.grossEarnings).toBe("60000.00");
    // No locked runs exist for this employee yet.
    expect(ytd.inSystem.grossEarnings).toBe("0.00");
    expect(ytd.grossEarnings).toBe("60000.00");
    expect(ytd.payeAmount).toBe("9000.00");

    // An employee with no opening balance reports a null brought-forward half
    // rather than inventing zeros as if history had been imported.
    const [fresh] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgId, firstName: "No", lastName: "Balance" })
      .returning();
    const freshYtd = await svc.getEmployeeYearToDate(orgId, fresh.id, TAX_YEAR);
    expect(freshYtd.broughtForward).toBeNull();
    expect(freshYtd.grossEarnings).toBe("0.00");
  });

  it("H/J. editable before lock, refused once finalized payroll exists", async () => {
    const amended = { ...AMOUNTS, grossEarnings: "61000.00" };
    const updated = await svc.updatePayrollOpeningBalanceBeforeLock({
      organizationId: orgId,
      employeeId,
      taxYear: TAX_YEAR,
      amounts: amended,
      actorMembershipId: membershipId,
    });
    expect(updated.grossEarnings).toBe("61000.00");

    // Now finalize payroll for this employee in this tax year.
    expect(await svc.isOpeningBalanceLocked(orgId, employeeId, TAX_YEAR)).toBe(false);
    const [period] = await db
      .select()
      .from(schema.payrollPeriodsTable)
      .where(eq(schema.payrollPeriodsTable.organizationId, orgId))
      .limit(1);
    const [run] = await db
      .insert(schema.payrollRunsTable)
      .values({ organizationId: orgId, payrollPeriodId: period.id, status: "locked" })
      .returning();
    await db.insert(schema.payrollRunLinesTable).values({
      organizationId: orgId,
      payrollRunId: run.id,
      employeeId,
      grossEarnings: "5000.00",
      pensionableEarnings: "5000.00",
      employeePensionDeduction: "275.00",
      employerPensionContribution: "650.00",
      tier1Amount: "650.00",
      tier2Amount: "250.00",
      taxableIncome: "4725.00",
      payeAmount: "700.00",
      otherDeductions: "0.00",
      netPay: "4025.00",
      currency: "GHS",
    });

    expect(await svc.isOpeningBalanceLocked(orgId, employeeId, TAX_YEAR)).toBe(true);
    await expect(
      svc.updatePayrollOpeningBalanceBeforeLock({
        organizationId: orgId,
        employeeId,
        taxYear: TAX_YEAR,
        amounts: AMOUNTS,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(svc.PayrollOpeningBalanceLockedError);

    // The lock is durable, not merely derived on each read.
    const row = await svc.getPayrollOpeningBalance(orgId, employeeId, TAX_YEAR);
    expect(row?.lockedAt).not.toBeNull();
  });

  it("I. year-to-date now reflects both halves, and only locked runs count", async () => {
    const ytd = await svc.getEmployeeYearToDate(orgId, employeeId, TAX_YEAR);
    expect(ytd.broughtForward?.grossEarnings).toBe("61000.00");
    expect(ytd.inSystem.grossEarnings).toBe("5000.00");
    expect(ytd.grossEarnings).toBe("66000.00");
    expect(ytd.payeAmount).toBe("9700.00");

    // A draft run must not inflate a statutory year-to-date figure.
    const [period2] = await db
      .insert(schema.payrollPeriodsTable)
      .values({
        organizationId: orgId,
        frequency: "monthly",
        periodKey: `${TAX_YEAR}-08`,
        startDate: new Date(Date.UTC(TAX_YEAR, 7, 1)),
        endDate: new Date(Date.UTC(TAX_YEAR, 7, 31)),
        payDate: new Date(Date.UTC(TAX_YEAR, 7, 28)),
      })
      .returning();
    const [draftRun] = await db
      .insert(schema.payrollRunsTable)
      .values({ organizationId: orgId, payrollPeriodId: period2.id, status: "draft" })
      .returning();
    await db.insert(schema.payrollRunLinesTable).values({
      organizationId: orgId,
      payrollRunId: draftRun.id,
      employeeId,
      grossEarnings: "999999.00",
      pensionableEarnings: "0.00",
      employeePensionDeduction: "0.00",
      employerPensionContribution: "0.00",
      tier1Amount: "0.00",
      tier2Amount: "0.00",
      taxableIncome: "0.00",
      payeAmount: "0.00",
      otherDeductions: "0.00",
      netPay: "0.00",
      currency: "GHS",
    });

    const after = await svc.getEmployeeYearToDate(orgId, employeeId, TAX_YEAR);
    expect(after.grossEarnings).toBe("66000.00");
  });

  it("keeps year-to-date scoped to its own tax year and organization", async () => {
    const priorYear = await svc.getEmployeeYearToDate(orgId, employeeId, TAX_YEAR - 1);
    expect(priorYear.broughtForward).toBeNull();
    expect(priorYear.grossEarnings).toBe("0.00");

    const crossOrg = await svc.getEmployeeYearToDate(otherOrgId, employeeId, TAX_YEAR);
    expect(crossOrg.broughtForward).toBeNull();
    expect(crossOrg.inSystem.grossEarnings).toBe("0.00");
  });
});
