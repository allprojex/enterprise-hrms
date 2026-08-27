/**
 * WS-7 — live end-to-end proof of the migration lifecycle against a real
 * database: upload -> map -> validate (dry run) -> approve -> execute ->
 * reconcile, across multiple entity types in dependency order, plus the
 * negative cases that matter most (duplicate staff number, unknown
 * reference, cross-organization isolation, source-changed-after-approval,
 * and execution idempotency).
 *
 * Follows the same opt-in pattern as WS-6's live test: skipped entirely
 * unless WS7_LIVE_DATABASE_URL points at a disposable database, so `pnpm
 * test` in CI stays hermetic.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS7_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

function csv(lines: string[][]): Buffer {
  return Buffer.from(lines.map((l) => l.join(",")).join("\n"), "utf-8");
}

describeLive("WS-7 — multi-entity migration, live lifecycle", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let eq: any;
  let orgId: number;
  let otherOrgId: number;
  let userId: number;
  let membershipId: number;

  let batchService: typeof import("../lib/migrations/batchService");
  let executionService: typeof import("../lib/migrations/executionService");
  let registry: typeof import("../lib/migrations/registerEntityAdapters");

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    registry = await import("../lib/migrations/registerEntityAdapters");
    registry.registerShippedEntityAdapters();
    batchService = await import("../lib/migrations/batchService");
    executionService = await import("../lib/migrations/executionService");

    const suffix = `ws7-${Date.now()}`;
    const [org] = await db.insert(schema.organizationsTable).values({ name: `WS7 ${suffix}`, slug: suffix }).returning();
    orgId = org.id;
    const [other] = await db.insert(schema.organizationsTable).values({ name: `WS7 other ${suffix}`, slug: `${suffix}-other` }).returning();
    otherOrgId = other.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({ email: `${suffix}@example.invalid`, passwordHash: "x", firstName: "WS7", lastName: "Tester", organizationId: orgId })
      .returning();
    userId = user.id;
    const [membership] = await db
      .insert(schema.organizationMembershipsTable)
      .values({ applicationUserId: userId, organizationId: orgId, status: "active" })
      .returning();
    membershipId = membership.id;
  });

  afterAll(async () => {
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  });

  async function newBatch(name: string) {
    return batchService.createBatch({ organizationId: orgId, name, actorApplicationUserId: userId, actorMembershipId: membershipId });
  }

  async function uploadAndMap(batchId: number, entityType: string, rows: string[][]) {
    const uploaded = await batchService.uploadSource({
      organizationId: orgId,
      batchId,
      entityType,
      fileName: `${entityType}.csv`,
      mimeType: "text/csv",
      buffer: csv(rows),
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    await batchService.setSourceMapping({
      organizationId: orgId,
      batchId,
      sourceId: uploaded.source.id,
      mapping: uploaded.autoMapping,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    return uploaded;
  }

  it("auto-maps recognizable headers and reports required fields that are missing", async () => {
    const batch = await newBatch("automap");
    const uploaded = await batchService.uploadSource({
      organizationId: orgId,
      batchId: batch.id,
      entityType: "branch",
      fileName: "branches.csv",
      mimeType: "text/csv",
      buffer: csv([["Branch Code", "Branch Name"], ["HQ", "Head Office"]]),
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(uploaded.autoMapping).toEqual({ "Branch Code": "code", "Branch Name": "name" });
    expect(uploaded.missingRequiredFields).toEqual([]);
    expect(uploaded.rowCount).toBe(1);
  });

  it("runs a full multi-entity migration in dependency order and reconciles every source row", async () => {
    const stamp = Date.now();
    const batch = await newBatch("full lifecycle");

    // Deliberately uploaded OUT of dependency order — the engine must
    // reorder them itself (employee depends on branch/department/position).
    await uploadAndMap(batch.id, "employee", [
      ["First Name", "Last Name", "Employee Number", "Department Code", "Branch Code"],
      ["Ama", "Mensah", `E${stamp}1`, `D${stamp}`, `B${stamp}`],
      ["Kofi", "Owusu", `E${stamp}2`, `D${stamp}`, `B${stamp}`],
    ]);
    await uploadAndMap(batch.id, "department", [
      ["Department Code", "Department Name", "Branch Code"],
      [`D${stamp}`, "Finance", `B${stamp}`],
    ]);
    await uploadAndMap(batch.id, "branch", [
      ["Branch Code", "Branch Name"],
      [`B${stamp}`, "Head Office"],
    ]);

    // Dry run: employees reference a branch/department that do not exist
    // live yet, but WILL once this batch executes — that must validate.
    const validation = await executionService.validateBatch({
      organizationId: orgId,
      batchId: batch.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(validation.totalErrors).toBe(0);
    expect(validation.totalRows).toBe(4);

    const approved = await executionService.approveBatch({
      organizationId: orgId,
      batchId: batch.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(approved.status).toBe("approved");
    expect(approved.approvedSourcesSnapshot).toHaveLength(3);

    const progress = await executionService.executeBatch({
      organizationId: orgId,
      batchId: batch.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(progress.failed).toBe(0);
    expect(progress.created).toBe(4);
    expect(progress.remaining).toBe(0);
    expect(progress.status).toBe("completed");

    // The employees really exist, really carry their supplied staff numbers,
    // and are really attached to the branch/department this same batch made.
    const employees = await db.select().from(schema.employeesTable).where(eq(schema.employeesTable.organizationId, orgId));
    expect(employees).toHaveLength(2);
    expect(employees.every((e: any) => e.departmentId != null && e.branchId != null)).toBe(true);

    const allocations = await db
      .select()
      .from(schema.employeeNumberAllocationsTable)
      .where(eq(schema.employeeNumberAllocationsTable.organizationId, orgId));
    expect(allocations.map((a: any) => a.employeeNumber).sort()).toEqual([`E${stamp}1`, `E${stamp}2`]);
    // Supplied numbers must be recorded as migrated, never as manual.
    expect(allocations.every((a: any) => a.allocationMethod === "migrated")).toBe(true);

    // Reconciliation accounts for every source row with no gaps.
    const summary = await executionService.buildReconciliation(orgId, batch.id);
    expect(summary.totals.sourceRows).toBe(4);
    expect(summary.totals.created).toBe(4);
    expect(summary.totals.failed + summary.totals.skipped + summary.totals.pending).toBe(0);
  });

  it("re-executing a completed batch is a no-op — nothing is imported twice", async () => {
    const stamp = Date.now();
    const batch = await newBatch("idempotency");
    await uploadAndMap(batch.id, "branch", [["Branch Code", "Branch Name"], [`IB${stamp}`, "Idem Branch"]]);
    await executionService.validateBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.approveBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.executeBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });

    const before = await db.select().from(schema.branchesTable).where(eq(schema.branchesTable.organizationId, orgId));

    // A completed batch refuses to execute again at all...
    await expect(
      executionService.executeBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId }),
    ).rejects.toThrow(/cannot|approved/i);

    // ...and no duplicate branch appeared.
    const after = await db.select().from(schema.branchesTable).where(eq(schema.branchesTable.organizationId, orgId));
    expect(after).toHaveLength(before.length);
  });

  it("rejects a duplicate staff number at dry run rather than silently merging two people", async () => {
    const stamp = Date.now();
    const first = await newBatch("dup a");
    await uploadAndMap(first.id, "employee", [["First Name", "Last Name", "Employee Number"], ["Yaa", "Asante", `DUP${stamp}`]]);
    await executionService.validateBatch({ organizationId: orgId, batchId: first.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.approveBatch({ organizationId: orgId, batchId: first.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.executeBatch({ organizationId: orgId, batchId: first.id, actorApplicationUserId: userId, actorMembershipId: membershipId });

    const second = await newBatch("dup b");
    await uploadAndMap(second.id, "employee", [["First Name", "Last Name", "Employee Number"], ["Someone", "Else", `DUP${stamp}`]]);
    const validation = await executionService.validateBatch({
      organizationId: orgId,
      batchId: second.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(validation.totalErrors).toBe(1);

    // And an error-carrying batch cannot be approved at all.
    await expect(
      executionService.approveBatch({ organizationId: orgId, batchId: second.id, actorApplicationUserId: userId, actorMembershipId: membershipId }),
    ).rejects.toThrow(/errors/i);
  });

  it("rejects a reference no source in the batch will ever satisfy", async () => {
    const stamp = Date.now();
    const batch = await newBatch("bad ref");
    await uploadAndMap(batch.id, "employee", [
      ["First Name", "Last Name", "Employee Number", "Department Code"],
      ["Ghost", "Ref", `GR${stamp}`, "DEPARTMENT-THAT-DOES-NOT-EXIST"],
    ]);
    const validation = await executionService.validateBatch({
      organizationId: orgId,
      batchId: batch.id,
      actorApplicationUserId: userId,
      actorMembershipId: membershipId,
    });
    expect(validation.totalErrors).toBe(1);
    const issues = await executionService.getBatchIssues(orgId, batch.id);
    expect(JSON.stringify(issues)).toMatch(/not found/i);
  });

  it("refuses to execute when a source file changed after approval", async () => {
    const stamp = Date.now();
    const batch = await newBatch("tampered");
    const uploaded = await uploadAndMap(batch.id, "branch", [["Branch Code", "Branch Name"], [`TB${stamp}`, "Before"]]);
    await executionService.validateBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.approveBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });

    // Simulate the stored blob being swapped underneath an approved batch.
    const [source] = await db.select().from(schema.migrationSourcesTable).where(eq(schema.migrationSourcesTable.id, uploaded.source.id));
    const fs = await import("fs/promises");
    const path = await import("path");
    const root = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");
    await fs.writeFile(path.join(root, "organizations", String(orgId), source.storageKey), csv([["Branch Code", "Branch Name"], [`TB${stamp}`, "After"]]));

    await expect(
      executionService.executeBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId }),
    ).rejects.toThrow(/checksum|changed/i);
  });

  it("re-uploading a source drops an approved batch back to draft", async () => {
    const stamp = Date.now();
    const batch = await newBatch("reupload");
    await uploadAndMap(batch.id, "branch", [["Branch Code", "Branch Name"], [`RB${stamp}`, "First"]]);
    await executionService.validateBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.approveBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });

    await uploadAndMap(batch.id, "branch", [["Branch Code", "Branch Name"], [`RB${stamp}b`, "Second"]]);
    const reloaded = await batchService.getBatch(orgId, batch.id);
    expect(reloaded.approvedAt).toBeNull();
    expect(reloaded.approvedSourcesSnapshot).toBeNull();
    expect(["draft", "mapped"]).toContain(reloaded.status);
  });

  it("does not expose another organization's migration", async () => {
    const batch = await newBatch("isolation");
    await expect(batchService.getBatch(otherOrgId, batch.id)).rejects.toThrow(/not found/i);
  });

  it("reports an ATOMIC execution policy for a structure+employee batch, and rolls the whole batch back on failure", async () => {
    const stamp = Date.now();
    const batch = await newBatch("atomic policy");
    await uploadAndMap(batch.id, "branch", [["Branch Code", "Branch Name"], [`AB${stamp}`, "Atomic Branch"]]);
    // Two employees; the SECOND one duplicates the first staff number, which
    // the dry run cannot catch (neither exists live yet) and which therefore
    // fails at execution — exactly the case atomicity must undo entirely.
    await uploadAndMap(batch.id, "employee", [
      ["First Name", "Last Name", "Employee Number", "Branch Code"],
      ["Atom", "One", `AE${stamp}`, `AB${stamp}`],
      ["Atom", "Two", `AE${stamp}`, `AB${stamp}`],
    ]);

    const policy = await executionService.resolveExecutionPolicy(orgId, batch.id);
    expect(policy.policy).toBe("atomic");
    expect(policy.nonTransactionalEntityTypes).toEqual([]);
    expect(policy.reasons.join(" ")).toMatch(/All-or-nothing/i);

    await executionService.validateBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });
    await executionService.approveBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId });

    await expect(
      executionService.executeBatch({ organizationId: orgId, batchId: batch.id, actorApplicationUserId: userId, actorMembershipId: membershipId }),
    ).rejects.toThrow(/rolled back/i);

    // Nothing at all was written — not even the branch, which itself succeeded.
    const branches = await db.select().from(schema.branchesTable).where(eq(schema.branchesTable.code, `AB${stamp}`));
    expect(branches).toHaveLength(0);
    const allocs = await db
      .select()
      .from(schema.employeeNumberAllocationsTable)
      .where(eq(schema.employeeNumberAllocationsTable.employeeNumber, `AE${stamp}`));
    expect(allocs).toHaveLength(0);

    const reloaded = await batchService.getBatch(orgId, batch.id);
    expect(reloaded.status).toBe("failed");
  });

  it("reports a BATCHED_RESUMABLE policy, naming the entity that prevents atomicity", async () => {
    const stamp = Date.now();
    const batch = await newBatch("resumable policy");
    await uploadAndMap(batch.id, "employee", [
      ["First Name", "Last Name", "Employee Number"],
      ["Res", "Umable", `RE${stamp}`],
    ]);
    await uploadAndMap(batch.id, "qualification", [
      ["Employee Number", "Qualification Type"],
      [`RE${stamp}`, "bsc"],
    ]);

    const policy = await executionService.resolveExecutionPolicy(orgId, batch.id);
    expect(policy.policy).toBe("batched_resumable");
    expect(policy.nonTransactionalEntityTypes).toContain("qualification");
    // The approver must be told, in words, that partial success is possible.
    expect(policy.reasons.join(" ")).toMatch(/stay committed even if later rows fail/i);
  });

  it("does not expose payroll_opening_balance — it is blocked pending an Owner decision", async () => {
    const batch = await newBatch("payroll blocked");
    await expect(
      batchService.uploadSource({
        organizationId: orgId,
        batchId: batch.id,
        entityType: "payroll_opening_balance",
        fileName: "p.csv",
        mimeType: "text/csv",
        buffer: csv([["Employee Number"], ["X"]]),
        actorApplicationUserId: userId,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(/not a supported/i);
  });

  it("rejects an unknown entity type instead of trusting client input", async () => {
    const batch = await newBatch("unknown entity");
    await expect(
      batchService.uploadSource({
        organizationId: orgId,
        batchId: batch.id,
        entityType: "employees; DROP TABLE employees",
        fileName: "x.csv",
        mimeType: "text/csv",
        buffer: csv([["a"], ["b"]]),
        actorApplicationUserId: userId,
        actorMembershipId: membershipId,
      }),
    ).rejects.toThrow(/not a supported/i);
  });
});
