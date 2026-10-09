/**
 * Shared numbering infrastructure — live concurrency proof for
 * `lockAndIncrementSequence`, the one counter every generated reference in the
 * platform goes through (employee numbers, personnel files, office inventory,
 * vehicle requests).
 *
 * Opt-in (NUMBERING_LIVE_DATABASE_URL, a disposable LOCAL database — liveDbGuard
 * refuses anything else). Row locking and ON CONFLICT behavior cannot be proved
 * against a mock; every mocked suite says so and defers to live QA. This is it.
 *
 * The regression it pins: a concurrent FIRST allocation for an
 * (organization, sequenceKey, periodKey) used to fail for every caller but the
 * winner — the losing plain INSERT raised a unique violation, which aborts a
 * Postgres transaction, so its recovery SELECT died with 25P02.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("NUMBERING_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("lockAndIncrementSequence — live concurrency", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let and: any;
  let lockAndIncrementSequence: typeof import("../lib/numbering").lockAndIncrementSequence;
  const suffix = `num-${Date.now()}`;
  let seq = 0;

  async function makeOrg(): Promise<number> {
    seq += 1;
    const [org] = await db
      .insert(schema.organizationsTable)
      .values({ name: `Numbering ${suffix} ${seq}`, slug: `numbering-${suffix}-${seq}` })
      .returning();
    return org.id;
  }

  const allocate = (organizationId: number, sequenceKey = "k", periodKey = "", startingSequence = 1) =>
    lockAndIncrementSequence({ organizationId, sequenceKey, periodKey, startingSequence });

  const burst = (n: number, f: () => Promise<number>) => Promise.all(Array.from({ length: n }, () => f()));
  const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

  async function counter(organizationId: number, sequenceKey = "k", periodKey = ""): Promise<number | null> {
    const rows = await db
      .select({ v: schema.numberingSequencesTable.currentValue })
      .from(schema.numberingSequencesTable)
      .where(
        and(
          eq(schema.numberingSequencesTable.organizationId, organizationId),
          eq(schema.numberingSequencesTable.sequenceKey, sequenceKey),
          eq(schema.numberingSequencesTable.periodKey, periodKey),
        ),
      );
    expect(rows.length).toBeLessThanOrEqual(1); // one counter row, never two
    return rows[0]?.v ?? null;
  }

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;
    ({ lockAndIncrementSequence } = await import("../lib/numbering"));
  });

  it("two simultaneous FIRST allocations both succeed with distinct values", async () => {
    const org = await makeOrg();
    const values = await burst(2, () => allocate(org));
    expect(sorted(values)).toEqual([1, 2]);
    expect(await counter(org)).toBe(2);
  });

  it("sixteen simultaneous FIRST allocations yield exactly 1..16", async () => {
    const org = await makeOrg();
    const values = await burst(16, () => allocate(org));
    expect(sorted(values)).toEqual(range(1, 16));
    expect(await counter(org)).toBe(16);
  });

  it("simultaneous allocations after the counter exists continue without gaps or duplicates", async () => {
    const org = await makeOrg();
    await burst(3, () => allocate(org));
    const values = await burst(16, () => allocate(org));
    expect(sorted(values)).toEqual(range(4, 16));
    expect(await counter(org)).toBe(19);
  });

  it("the first value is still startingSequence, and progression continues from it", async () => {
    const org = await makeOrg();
    const first = await burst(5, () => allocate(org, "k", "", 100));
    expect(sorted(first)).toEqual(range(100, 5));
    expect(await allocate(org, "k", "", 100)).toBe(105);
  });

  it("different organizations are independent, even when racing at the same moment", async () => {
    const [a, b] = [await makeOrg(), await makeOrg()];
    const [va, vb] = await Promise.all([burst(8, () => allocate(a)), burst(8, () => allocate(b))]);
    expect(sorted(va)).toEqual(range(1, 8));
    expect(sorted(vb)).toEqual(range(1, 8));
  });

  it("different sequence keys are independent", async () => {
    const org = await makeOrg();
    const [x, y] = await Promise.all([burst(6, () => allocate(org, "alpha")), burst(6, () => allocate(org, "beta"))]);
    expect(sorted(x)).toEqual(range(1, 6));
    expect(sorted(y)).toEqual(range(1, 6));
    expect(await counter(org, "alpha")).toBe(6);
    expect(await counter(org, "beta")).toBe(6);
  });

  it("different period keys are independent", async () => {
    const org = await makeOrg();
    const [p1, p2] = await Promise.all([burst(6, () => allocate(org, "k", "2026")), burst(6, () => allocate(org, "k", "2027"))]);
    expect(sorted(p1)).toEqual(range(1, 6));
    expect(sorted(p2)).toEqual(range(1, 6));
  });

  it("a large mixed burst never issues a duplicate anywhere", async () => {
    const org = await makeOrg();
    const values = await burst(40, () => allocate(org, "mixed"));
    expect(new Set(values).size).toBe(40);
    expect(sorted(values)).toEqual(range(1, 40));
    expect(await counter(org, "mixed")).toBe(40);
  });

  it("an existing counter is never reset by a later allocation", async () => {
    const org = await makeOrg();
    await allocate(org, "keep");
    await allocate(org, "keep");
    expect(await allocate(org, "keep", "", 1)).toBe(3);
  });
});
