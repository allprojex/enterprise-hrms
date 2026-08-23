/**
 * Phase 3H, W119 — Legacy Import routes. Gated by BOTH personnel_file.manage
 * (creates personnel files) AND employee_number.allocate (allocates staff
 * numbers) — the exact frozen §13 permission set this action genuinely
 * exercises, composed via two chained requirePermission checks rather than
 * routing through the broad employee.write (this session's own explicit
 * instruction) or minting a new "import" permission the frozen plan never
 * named. Both are already org_admin/hr_manager-only, so this does not
 * broaden who can import beyond who could already do both underlying
 * actions separately.
 *
 * Stateless: /preview and /commit each accept the same uploaded CSV file
 * independently — nothing about a previewed file is cached or trusted
 * across requests, and no persistent import-job table exists (none was
 * needed: the whole workflow is re-validate-then-write in one call).
 */
import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import {
  IMPORT_TEMPLATE_HEADERS,
  parseCsv,
  toRecords,
  validateImportRows,
  commitImport,
  MalformedCsvError,
  ImportHasInvalidRowsError,
} from "../lib/legacyImport";
import { EmployeeNumberReuseDisabledError, EmployeeNumberCollisionError, EmployeeNumberMissingTokenDataError, InvalidManualEmployeeNumberError } from "../lib/numbering";
import { PifNumberCollisionError, InvalidManualPifNumberError } from "../lib/personnelFiles";
import { CrossOrganizationReferenceError } from "../lib/orgScopedRefs";
import { isUniqueViolation } from "../lib/dbErrors";

const router = Router();

const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2MB — a plain-text row-per-employee CSV; generous for thousands of rows.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES } });

class InvalidImportFileError extends Error {}

/**
 * CSV has no binary "magic bytes" the way PDF/JPEG do (documentValidation.ts's
 * own signature-sniffing approach doesn't apply) — the equivalent rigor here
 * is: reject anything that isn't plausibly UTF-8 plain text (a null byte is
 * the standard binary-content tell), enforce the size limit, and require a
 * .csv-shaped declared type. Never executes, evaluates, or opens the content
 * in any spreadsheet engine — parseCsv only ever splits characters into
 * string cells.
 */
function validateCsvUpload(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }): string {
  if (file.size === 0) throw new InvalidImportFileError("The uploaded file is empty");
  if (file.size > MAX_IMPORT_BYTES) throw new InvalidImportFileError("File exceeds the 2MB size limit");

  const looksLikeCsv = file.originalname.toLowerCase().endsWith(".csv") || file.mimetype === "text/csv" || file.mimetype === "application/vnd.ms-excel" || file.mimetype === "application/csv";
  if (!looksLikeCsv) throw new InvalidImportFileError("Unsupported file type — CSV only");

  if (file.buffer.includes(0)) throw new InvalidImportFileError("File content does not look like plain-text CSV");

  try {
    return file.buffer.toString("utf-8");
  } catch {
    throw new InvalidImportFileError("File is not valid UTF-8 text");
  }
}

function handleImportError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof InvalidImportFileError || err instanceof MalformedCsvError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof ImportHasInvalidRowsError) {
    res.status(400).json({ error: err.message, summary: err.summary });
    return true;
  }
  if (
    err instanceof EmployeeNumberReuseDisabledError ||
    err instanceof EmployeeNumberMissingTokenDataError ||
    err instanceof InvalidManualEmployeeNumberError ||
    err instanceof InvalidManualPifNumberError ||
    err instanceof CrossOrganizationReferenceError
  ) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof EmployeeNumberCollisionError || err instanceof PifNumberCollisionError || isUniqueViolation(err)) {
    res.status(409).json({ error: "A staff number or PIF number in this file collided with an existing allocation during commit — re-run preview and try again" });
    return true;
  }
  return false;
}

// GET /organizations/:organizationId/personnel-records/import/template
router.get(
  "/organizations/:organizationId/personnel-records/import/template",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  requirePermission("employee_number.allocate"),
  async (_req: MembershipRequest, res): Promise<void> => {
    const header = IMPORT_TEMPLATE_HEADERS.join(",");
    const example = "Jane,Doe,,,female,active,2020-01-15,,,,,,,,jane.doe@example.com,,,";
    const csv = `${header}\n${example}\n`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="personnel-import-template.csv"');
    res.send(csv);
  },
);

// POST /organizations/:organizationId/personnel-records/import/preview (multipart, field "file")
router.post(
  "/organizations/:organizationId/personnel-records/import/preview",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  requirePermission("employee_number.allocate"),
  upload.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "A CSV file is required (field \"file\")" });
      return;
    }
    try {
      const text = validateCsvUpload(req.file);
      const records = toRecords(parseCsv(text));
      const summary = await validateImportRows(req.membership!.organizationId, records);
      res.json(summary);
    } catch (err) {
      if (handleImportError(err, res)) return;
      throw err;
    }
  },
);

// POST /organizations/:organizationId/personnel-records/import/commit (multipart, field "file")
router.post(
  "/organizations/:organizationId/personnel-records/import/commit",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("personnel_file.manage"),
  requirePermission("employee_number.allocate"),
  upload.single("file"),
  async (req: MembershipRequest, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "A CSV file is required (field \"file\")" });
      return;
    }
    try {
      const text = validateCsvUpload(req.file);
      const records = toRecords(parseCsv(text));
      const created = await commitImport({
        organizationId: req.membership!.organizationId,
        rows: records,
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
      });
      res.status(201).json({ count: created.length, created });
    } catch (err) {
      if (handleImportError(err, res)) return;
      throw err;
    }
  },
);

export default router;
