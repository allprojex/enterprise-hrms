/**
 * WS-7 — Bulk Import / Multi-Entity Migration routes.
 *
 * Gated by the dedicated `migration.read` / `migration.manage` /
 * `migration.execute` triad (see seed-roles-permissions.ts for why a new
 * triad rather than a union of six domains' existing keys), with `.execute`
 * separated from `.manage` so that preparing an import and authorizing it
 * are distinct grants.
 *
 * Every route is organization-scoped through requireMembership, and every
 * service call takes its organizationId from `req.membership`, never from a
 * body field — a batch id belonging to another organization is
 * indistinguishable from a nonexistent one (404, never 403, so the routes
 * do not confirm that another tenant's id exists).
 *
 * There is deliberately no generic "run this entity type against this table"
 * endpoint: `entityType` is validated against the server-side adapter
 * registry allow-list on the way in, and the registry is the only thing that
 * can ever execute a mutation.
 */
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { toCsv } from "../lib/reporting";
import { getEntityAdapter, isKnownEntityType, listEntityTypes, orderEntityTypesByDependency } from "../lib/migrations/adapterRegistry";
import { InvalidColumnMappingError, type ColumnMapping } from "../lib/migrations/columnMapping";
import {
  createBatch,
  getBatch,
  listBatches,
  listSources,
  setSourceMapping,
  uploadSource,
  InvalidMigrationStateError,
  MigrationNotFoundError,
  SourceIntegrityError,
  UnknownEntityTypeError,
} from "../lib/migrations/batchService";
import {
  approveBatch,
  buildReconciliation,
  cancelBatch,
  executeBatch,
  getBatchIssues,
  validateBatch,
  resolveExecutionPolicy,
  AtomicMigrationRolledBackError,
} from "../lib/migrations/executionService";
import { enqueueMigrationExecution } from "../lib/migrations/jobHandler";
import { MIGRATION_FILE_LIMITS, MigrationFileParseError } from "../lib/migrations/fileParsing";

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MIGRATION_FILE_LIMITS.maxFileBytes } });

/**
 * Above this many staged rows, execution is handed to the WS-6 worker
 * instead of running inside the HTTP request. Small migrations stay
 * synchronous so the common case (a few hundred rows) returns a finished
 * result immediately rather than making the user poll.
 */
const SYNCHRONOUS_EXECUTION_ROW_LIMIT = 1_000;

function handleMigrationError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof MigrationNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  if (err instanceof InvalidMigrationStateError || err instanceof InvalidColumnMappingError || err instanceof UnknownEntityTypeError || err instanceof MigrationFileParseError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof SourceIntegrityError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (err instanceof AtomicMigrationRolledBackError) {
    // 422: the request was well-formed and authorized, but the data could
    // not be applied. Nothing was written — the message says so explicitly.
    res.status(422).json({ error: err.message, rolledBack: true });
    return true;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? `File exceeds the ${MIGRATION_FILE_LIMITS.maxFileBytes / 1024 / 1024}MB limit` : err.message });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/migrations/entity-types
router.get(
  "/organizations/:organizationId/migrations/entity-types",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (_req: MembershipRequest, res): Promise<void> => {
    const entityTypes = orderEntityTypesByDependency(listEntityTypes()).map((entityType) => {
      const adapter = getEntityAdapter(entityType)!;
      return {
        entityType,
        label: adapter.label,
        dependsOn: adapter.dependsOn,
        fields: adapter.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, type: f.type, enumValues: f.enumValues ?? null })),
      };
    });
    res.json({ entityTypes });
  },
);

// GET /organizations/:organizationId/migrations/templates/:entityType — a CSV starter file
router.get(
  "/organizations/:organizationId/migrations/templates/:entityType",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    const entityType = String(req.params.entityType);
    if (!isKnownEntityType(entityType)) {
      res.status(404).json({ error: `"${entityType}" is not a supported migration entity type` });
      return;
    }
    const adapter = getEntityAdapter(entityType)!;
    // Reuses the platform's own CSV writer so a template can never itself
    // become a formula-injection vector in the user's spreadsheet.
    const columns = adapter.fields.map((f) => ({ key: f.key, label: f.required ? `${f.label} *` : f.label }));
    const csv = toCsv(columns, []);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${entityType}-template.csv"`);
    res.send(`${csv}\n`);
  },
);

// GET /organizations/:organizationId/migrations
router.get(
  "/organizations/:organizationId/migrations",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    res.json({ migrations: await listBatches(req.membership!.organizationId) });
  },
);

// POST /organizations/:organizationId/migrations
router.post(
  "/organizations/:organizationId/migrations",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "A migration name is required" });
      return;
    }
    const batch = await createBatch({
      organizationId: req.membership!.organizationId,
      name,
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
    });
    res.status(201).json(batch);
  },
);

// GET /organizations/:organizationId/migrations/:migrationId
router.get(
  "/organizations/:organizationId/migrations/:migrationId",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const batchId = Number(req.params.migrationId);
      const batch = await getBatch(organizationId, batchId);
      res.json({
        migration: batch,
        sources: await listSources(organizationId, batchId),
        // Surfaced on every read so the approval screen can state the
        // execution model BEFORE approval, rather than leaving the
        // administrator to assume an import is atomic when it is not.
        executionPolicy: await resolveExecutionPolicy(organizationId, batchId),
      });
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/migrations/:migrationId/sources (multipart, field "file")
router.post(
  "/organizations/:organizationId/migrations/:migrationId/sources",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.manage"),
  upload.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'A CSV or XLSX file is required (field "file")' });
      return;
    }
    const entityType = typeof req.body?.entityType === "string" ? req.body.entityType : "";
    try {
      const result = await uploadSource({
        organizationId: req.membership!.organizationId,
        batchId: Number(req.params.migrationId),
        entityType,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        sheetName: typeof req.body?.sheetName === "string" && req.body.sheetName ? req.body.sheetName : undefined,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json(result);
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// PUT /organizations/:organizationId/migrations/:migrationId/sources/:sourceId/mapping
router.put(
  "/organizations/:organizationId/migrations/:migrationId/sources/:sourceId/mapping",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    const mapping = req.body?.mapping as ColumnMapping | undefined;
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      res.status(400).json({ error: "A column mapping object is required" });
      return;
    }
    try {
      const result = await setSourceMapping({
        organizationId: req.membership!.organizationId,
        batchId: Number(req.params.migrationId),
        sourceId: Number(req.params.sourceId),
        mapping,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(result);
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/migrations/:migrationId/validate — the dry run
router.post(
  "/organizations/:organizationId/migrations/:migrationId/validate",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const result = await validateBatch({
        organizationId: req.membership!.organizationId,
        batchId: Number(req.params.migrationId),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(result);
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/migrations/:migrationId/issues
router.get(
  "/organizations/:organizationId/migrations/:migrationId/issues",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const batchId = Number(req.params.migrationId);
      await getBatch(organizationId, batchId); // org-scope check before exposing rows
      res.json({ issues: await getBatchIssues(organizationId, batchId) });
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/migrations/:migrationId/approve
router.post(
  "/organizations/:organizationId/migrations/:migrationId/approve",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.execute"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const batchId = Number(req.params.migrationId);
      const batch = await approveBatch({
        organizationId,
        batchId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      // Echo the execution model back with the approval, so the decision the
      // approver just made is recorded in the response they received.
      res.json({ ...batch, executionPolicy: await resolveExecutionPolicy(organizationId, batchId) });
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/migrations/:migrationId/execute
router.post(
  "/organizations/:organizationId/migrations/:migrationId/execute",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.execute"),
  async (req: MembershipRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;
    const batchId = Number(req.params.migrationId);
    try {
      const batch = await getBatch(organizationId, batchId);
      const sources = await listSources(organizationId, batchId);
      const totalRows = sources.reduce((sum, s) => sum + (s.rowCount ?? 0), 0);

      if (totalRows > SYNCHRONOUS_EXECUTION_ROW_LIMIT) {
        if (batch.status !== "approved") {
          res.status(400).json({ error: `Only an approved migration can be executed (this one is "${batch.status}")` });
          return;
        }
        await enqueueMigrationExecution({
          organizationId,
          batchId,
          actorApplicationUserId: req.userId!,
          actorMembershipId: req.membership!.id,
        });
        res.status(202).json({ mode: "background", batchId, totalRows, message: "This migration is large enough to run in the background — poll the migration for progress." });
        return;
      }

      const progress = await executeBatch({
        organizationId,
        batchId,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json({ mode: "synchronous", ...progress });
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/migrations/:migrationId/reconciliation
router.get(
  "/organizations/:organizationId/migrations/:migrationId/reconciliation",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const batchId = Number(req.params.migrationId);
      await getBatch(organizationId, batchId);
      res.json(await buildReconciliation(organizationId, batchId));
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// GET /organizations/:organizationId/migrations/:migrationId/reconciliation.csv
router.get(
  "/organizations/:organizationId/migrations/:migrationId/reconciliation.csv",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.read"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const organizationId = req.membership!.organizationId;
      const batchId = Number(req.params.migrationId);
      await getBatch(organizationId, batchId);
      const summary = await buildReconciliation(organizationId, batchId);
      const columns = [
        { key: "label", label: "Entity" },
        { key: "sourceRows", label: "Source Rows" },
        { key: "created", label: "Created" },
        { key: "matched", label: "Matched" },
        { key: "skipped", label: "Skipped" },
        { key: "failed", label: "Failed" },
        { key: "pending", label: "Pending" },
      ];
      const rows = summary.entities.map((e) => ({ ...e }));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="migration-${batchId}-reconciliation.csv"`);
      res.send(`${toCsv(columns, rows)}\n`);
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/migrations/:migrationId/cancel
router.post(
  "/organizations/:organizationId/migrations/:migrationId/cancel",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("migration.manage"),
  async (req: MembershipRequest, res): Promise<void> => {
    try {
      const batch = await cancelBatch({
        organizationId: req.membership!.organizationId,
        batchId: Number(req.params.migrationId),
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.json(batch);
    } catch (err) {
      if (handleMigrationError(err, res)) return;
      throw err;
    }
  },
);

export default router;
