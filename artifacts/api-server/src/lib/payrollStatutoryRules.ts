/**
 * Payroll, Workstream 1 — Statutory-Rule Foundation
 * (docs/PAYROLL_IMPLEMENTATION_PLAN.md §8, §9.2, §13). Platform-global (not
 * organization-scoped — Ghana statutory law does not vary per organization).
 *
 * Lifecycle: draft -> validated -> approved. "active"/"superseded" are never
 * stored — a version is active purely because its effectiveFrom has arrived
 * and no later approved version of the same ruleType has superseded it,
 * resolved the same way employee_number_allocations' own validFrom/validTo
 * pair is resolved. Approving a version closes the previously-open version's
 * effectiveTo the instant the new one opens — mirrors releaseEmployeeNumber
 * closing validTo on the old allocation the moment a new one is created.
 *
 * Maker-checker (Owner Review, explicit): the membership that approves a
 * version must differ from the membership that created it — enforced here,
 * server-side, not merely by a missing frontend affordance.
 *
 * NO STATUTORY NUMERICAL FIGURES ARE SEEDED OR ASSUMED BY THIS MODULE. Every
 * value passed to these functions is caller-supplied; this workstream builds
 * the engine, never populates it with real Ghana figures.
 */
import { and, eq, isNull, desc } from "drizzle-orm";
import {
  db,
  payrollStatutoryRuleVersionsTable,
  payrollPayeBandsTable,
  payrollPensionRatesTable,
  payrollPensionEarningsCeilingTable,
  type PayrollStatutoryRuleVersion,
  type PayrollPayeBand,
  type PayrollPensionRate,
  type PayrollPensionEarningsCeiling,
} from "@workspace/db";
import { isUniqueViolation } from "./dbErrors";

type QueryClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type StatutoryRuleType = "paye_bands" | "pension_rates" | "pension_earnings_ceiling";

export class StatutoryRuleVersionNotFoundError extends Error {
  constructor() {
    super("Statutory rule version not found");
  }
}
export class StatutoryRuleVersionNotDraftError extends Error {
  constructor(status: string) {
    super(`This action requires the version to be in "draft" status (currently "${status}")`);
  }
}
export class StatutoryRuleVersionNotValidatedError extends Error {
  constructor(status: string) {
    super(`This action requires the version to be in "validated" status (currently "${status}")`);
  }
}
export class StatutorySelfApprovalError extends Error {
  constructor() {
    super("The membership that created a statutory rule version may not also approve it");
  }
}
export class InvalidStatutoryRulePayloadError extends Error {}
export class StatutoryRuleVersionCollisionError extends Error {
  constructor() {
    super("Another version of this rule type is already open for an overlapping effective period");
  }
}

interface PayeBandInput {
  bandOrder: number;
  taxpayerCategory: "resident" | "non_resident";
  thresholdAmount: string | null;
  ratePercent: string;
}
interface PensionRatesInput {
  employeeRatePercent: string;
  employerRatePercent: string;
  tier1AllocationPercent: string;
  tier2AllocationPercent: string;
}
interface PensionEarningsCeilingInput {
  minimumInsurableEarnings?: string | null;
  maximumInsurableEarnings?: string | null;
}

export interface CreateStatutoryRuleVersionParams {
  ruleType: StatutoryRuleType;
  effectiveFrom: Date;
  sourceUrl?: string | null;
  sourceDescription?: string | null;
  sourceRetrievedAt?: Date | null;
  reasonNote?: string | null;
  payeBands?: PayeBandInput[];
  pensionRates?: PensionRatesInput;
  pensionEarningsCeiling?: PensionEarningsCeilingInput;
  actorMembershipId: number;
}

function validateRuleTypePayload(params: CreateStatutoryRuleVersionParams): void {
  if (params.ruleType === "paye_bands") {
    if (!params.payeBands || params.payeBands.length === 0) {
      throw new InvalidStatutoryRulePayloadError("paye_bands requires a non-empty payeBands array");
    }
    const byCategory = new Map<string, PayeBandInput[]>();
    for (const band of params.payeBands) {
      const list = byCategory.get(band.taxpayerCategory) ?? [];
      list.push(band);
      byCategory.set(band.taxpayerCategory, list);
    }
    for (const [category, bands] of byCategory) {
      const sorted = [...bands].sort((a, b) => a.bandOrder - b.bandOrder);
      sorted.forEach((band, i) => {
        if (band.bandOrder !== i + 1) {
          throw new InvalidStatutoryRulePayloadError(`paye_bands for "${category}" must have sequential bandOrder starting at 1`);
        }
      });
      const nullThresholdCount = sorted.filter((b) => b.thresholdAmount === null).length;
      if (nullThresholdCount > 1 || (nullThresholdCount === 1 && sorted[sorted.length - 1].thresholdAmount !== null)) {
        throw new InvalidStatutoryRulePayloadError(
          `paye_bands for "${category}": only the final band may have a null (open-ended) thresholdAmount`,
        );
      }
    }
  } else if (params.ruleType === "pension_rates") {
    if (!params.pensionRates) throw new InvalidStatutoryRulePayloadError("pension_rates requires a pensionRates object");
  } else if (params.ruleType === "pension_earnings_ceiling") {
    if (!params.pensionEarningsCeiling) {
      throw new InvalidStatutoryRulePayloadError("pension_earnings_ceiling requires a pensionEarningsCeiling object");
    }
  }
}

async function writeChildRows(
  tx: QueryClient,
  versionId: number,
  params: CreateStatutoryRuleVersionParams,
): Promise<void> {
  if (params.ruleType === "paye_bands" && params.payeBands) {
    await tx.insert(payrollPayeBandsTable).values(
      params.payeBands.map((b) => ({
        statutoryRuleVersionId: versionId,
        bandOrder: b.bandOrder,
        taxpayerCategory: b.taxpayerCategory,
        thresholdAmount: b.thresholdAmount,
        ratePercent: b.ratePercent,
      })),
    );
  } else if (params.ruleType === "pension_rates" && params.pensionRates) {
    await tx.insert(payrollPensionRatesTable).values({ statutoryRuleVersionId: versionId, ...params.pensionRates });
  } else if (params.ruleType === "pension_earnings_ceiling" && params.pensionEarningsCeiling) {
    await tx
      .insert(payrollPensionEarningsCeilingTable)
      .values({ statutoryRuleVersionId: versionId, ...params.pensionEarningsCeiling });
  }
}

export async function createStatutoryRuleVersion(
  params: CreateStatutoryRuleVersionParams,
): Promise<PayrollStatutoryRuleVersion> {
  validateRuleTypePayload(params);
  return db.transaction(async (tx) => {
    const [version] = await tx
      .insert(payrollStatutoryRuleVersionsTable)
      .values({
        ruleType: params.ruleType,
        status: "draft",
        effectiveFrom: params.effectiveFrom,
        createdByMembershipId: params.actorMembershipId,
        sourceUrl: params.sourceUrl ?? null,
        sourceDescription: params.sourceDescription ?? null,
        sourceRetrievedAt: params.sourceRetrievedAt ?? null,
        reasonNote: params.reasonNote ?? null,
      })
      .returning();
    await writeChildRows(tx, version.id, params);
    return version;
  });
}

async function getVersionOrThrow(tx: QueryClient, id: number): Promise<PayrollStatutoryRuleVersion> {
  const [version] = await tx.select().from(payrollStatutoryRuleVersionsTable).where(eq(payrollStatutoryRuleVersionsTable.id, id)).for("update");
  if (!version) throw new StatutoryRuleVersionNotFoundError();
  return version;
}

/** Draft -> validated. Re-runs the same structural validation as creation, against the version's already-stored child rows. */
export async function validateStatutoryRuleVersion(id: number): Promise<PayrollStatutoryRuleVersion> {
  return db.transaction(async (tx) => {
    const version = await getVersionOrThrow(tx, id);
    if (version.status !== "draft") throw new StatutoryRuleVersionNotDraftError(version.status);

    const [updated] = await tx
      .update(payrollStatutoryRuleVersionsTable)
      .set({ status: "validated" })
      .where(eq(payrollStatutoryRuleVersionsTable.id, id))
      .returning();
    return updated;
  });
}

/**
 * Validated -> approved. Maker-checker enforced here: approverMembershipId
 * must differ from the version's own createdByMembershipId. Closes the
 * previously-open approved version of the same ruleType (if any) by setting
 * its effectiveTo to this version's effectiveFrom, inside the same
 * transaction — the partial unique index
 * (payroll_statutory_rule_versions_open_approved_unique) is the final,
 * database-level backstop against two versions of one ruleType ending up
 * simultaneously open, exactly mirroring employee_number_allocations' own
 * two-layer (row-lock + partial-unique-index) concurrency guarantee.
 */
export async function approveStatutoryRuleVersion(
  id: number,
  approverMembershipId: number,
): Promise<PayrollStatutoryRuleVersion> {
  try {
    return await db.transaction(async (tx) => {
      const version = await getVersionOrThrow(tx, id);
      if (version.status !== "validated") throw new StatutoryRuleVersionNotValidatedError(version.status);
      if (version.createdByMembershipId === approverMembershipId) throw new StatutorySelfApprovalError();

      const [currentOpen] = await tx
        .select()
        .from(payrollStatutoryRuleVersionsTable)
        .where(
          and(
            eq(payrollStatutoryRuleVersionsTable.ruleType, version.ruleType),
            eq(payrollStatutoryRuleVersionsTable.status, "approved"),
            isNull(payrollStatutoryRuleVersionsTable.effectiveTo),
          ),
        )
        .for("update");

      if (currentOpen) {
        await tx
          .update(payrollStatutoryRuleVersionsTable)
          .set({ effectiveTo: version.effectiveFrom })
          .where(eq(payrollStatutoryRuleVersionsTable.id, currentOpen.id));
      }

      const [approved] = await tx
        .update(payrollStatutoryRuleVersionsTable)
        .set({ status: "approved", approvedByMembershipId: approverMembershipId, approvedAt: new Date() })
        .where(eq(payrollStatutoryRuleVersionsTable.id, id))
        .returning();
      return approved;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new StatutoryRuleVersionCollisionError();
    throw err;
  }
}

export async function getStatutoryRuleVersionDetail(id: number): Promise<{
  version: PayrollStatutoryRuleVersion;
  payeBands: PayrollPayeBand[];
  pensionRates: PayrollPensionRate | null;
  pensionEarningsCeiling: PayrollPensionEarningsCeiling | null;
} | null> {
  const [version] = await db.select().from(payrollStatutoryRuleVersionsTable).where(eq(payrollStatutoryRuleVersionsTable.id, id)).limit(1);
  if (!version) return null;

  const payeBands =
    version.ruleType === "paye_bands"
      ? await db.select().from(payrollPayeBandsTable).where(eq(payrollPayeBandsTable.statutoryRuleVersionId, id))
      : [];
  const [pensionRates] =
    version.ruleType === "pension_rates"
      ? await db.select().from(payrollPensionRatesTable).where(eq(payrollPensionRatesTable.statutoryRuleVersionId, id))
      : [];
  const [pensionEarningsCeiling] =
    version.ruleType === "pension_earnings_ceiling"
      ? await db.select().from(payrollPensionEarningsCeilingTable).where(eq(payrollPensionEarningsCeilingTable.statutoryRuleVersionId, id))
      : [];

  return { version, payeBands, pensionRates: pensionRates ?? null, pensionEarningsCeiling: pensionEarningsCeiling ?? null };
}

export async function listStatutoryRuleVersions(ruleType?: StatutoryRuleType): Promise<PayrollStatutoryRuleVersion[]> {
  const query = db.select().from(payrollStatutoryRuleVersionsTable);
  const rows = ruleType
    ? await query.where(eq(payrollStatutoryRuleVersionsTable.ruleType, ruleType)).orderBy(desc(payrollStatutoryRuleVersionsTable.effectiveFrom))
    : await query.orderBy(desc(payrollStatutoryRuleVersionsTable.effectiveFrom));
  return rows;
}

/**
 * Resolves the approved version of `ruleType` in force as of `asOfDate` —
 * the same half-open [effectiveFrom, effectiveTo) resolution already proven
 * by numbering.ts's pickAllocationAsOf, applied here to statutory rules.
 * Guarantees a finalized payroll (a later workstream) always resolves the
 * version that was in force when it ran, never a version approved
 * afterward — the exact invariant the Owner Review gave verbatim.
 */
export async function resolveStatutoryRuleVersionAsOf(
  ruleType: StatutoryRuleType,
  asOfDate: Date,
): Promise<PayrollStatutoryRuleVersion | null> {
  const rows = await db
    .select()
    .from(payrollStatutoryRuleVersionsTable)
    .where(and(eq(payrollStatutoryRuleVersionsTable.ruleType, ruleType), eq(payrollStatutoryRuleVersionsTable.status, "approved")))
    .orderBy(desc(payrollStatutoryRuleVersionsTable.effectiveFrom));

  const at = asOfDate.getTime();
  for (const row of rows) {
    const from = row.effectiveFrom.getTime();
    const to = row.effectiveTo ? row.effectiveTo.getTime() : Infinity;
    if (at >= from && at < to) return row;
  }
  return null;
}
