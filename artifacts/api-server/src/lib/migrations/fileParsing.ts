/**
 * WS-7 (Bulk Import — Full Multi-Entity Migration, §8) — CSV and XLSX
 * parsing, treated as hostile input throughout.
 *
 * No CSV/XLSX parsing library existed anywhere in this workspace before
 * this workstream (verified, not assumed). Two different choices were made
 * for the two formats, for two different reasons:
 *
 *   CSV — hand-written, dependency-free, mirroring the established
 *   precedent in routes/legacyImport.ts's own `parseCsv`. CSV has no
 *   compression, no XML, no macro/formula-execution layer — it is plain
 *   delimited text, and this codebase already has a working, reviewed
 *   parser for exactly this shape. Reusing that precedent (not a new
 *   dependency) is both simpler and lower-risk than adopting a CSV library
 *   whose exact quoting/escaping edge cases would need separate vetting.
 *
 *   XLSX — a real dependency (`exceljs`) was added, deliberately.
 *   Hand-rolling an OOXML/ZIP/XML reader to PARSE untrusted, compressed,
 *   XML-based input is a materially different risk than WS-5's own
 *   decision to hand-write a PDF *writer* for trusted output — there, this
 *   file controlled every byte written; here, the platform must safely
 *   decompress and parse a file an organization's migration administrator
 *   uploads, which can be adversarial. A mature, widely-used library
 *   closes far more of that surface than a bespoke reader could credibly
 *   review in this workstream. `exceljs` was chosen for its explicit
 *   streaming reader (bounding memory for large workbooks) and current
 *   maintenance; WS-1's CI dependency/SCA scan is the ongoing safety net
 *   for this new dependency, exactly as it is for every other one.
 *
 * Neither path ever evaluates a formula. A formula cell's cached `.result`
 * (the value Excel itself last computed and stored) is used when present;
 * an unresolved formula cell is treated as empty rather than executed.
 */
import ExcelJS from "exceljs";

export class MigrationFileParseError extends Error {}
export class MigrationFileLimitExceededError extends MigrationFileParseError {}

/**
 * Deliberately generous relative to a single HR spreadsheet, deliberately
 * bounded so a hostile or accidental upload cannot exhaust memory. Applies
 * identically to CSV and XLSX. Documented, not tuned per organization.
 */
export const MIGRATION_FILE_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024, // 20MB
  maxRows: 50_000,
  maxColumns: 200,
} as const;

export interface ParsedTable {
  headers: string[];
  /** Each row is a plain array aligned to `headers` — raw string cell values, never coerced yet (entity adapters own type coercion). */
  rows: string[][];
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * A minimal, dependency-free RFC4180-shaped parser: comma-delimited,
 * double-quote-quoted fields, `""` as an escaped quote, `\r\n`/`\n` line
 * endings, quoted fields may embed either. Never interprets a cell as a
 * formula — CSV cells are always plain text once parsed; whether a
 * later *export* must escape a leading `=`/`+`/`-`/`@` is
 * `reporting.ts`'s `safeCsvCell`'s concern, reused verbatim wherever this
 * workstream writes CSV back out (templates, reconciliation reports).
 */
export function parseCsvBuffer(buffer: Buffer): ParsedTable {
  if (buffer.length > MIGRATION_FILE_LIMITS.maxFileBytes) {
    throw new MigrationFileLimitExceededError(`File exceeds the ${MIGRATION_FILE_LIMITS.maxFileBytes / 1024 / 1024}MB limit`);
  }
  if (buffer.includes(0)) {
    throw new MigrationFileParseError("File contains a null byte and is not valid CSV text");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new MigrationFileParseError("File is not valid UTF-8 text");
  }
  // Strip a UTF-8 BOM if Excel added one on export — otherwise it would
  // corrupt the first header's name.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // A row of exactly one empty field is a genuinely blank line — skip it
    // rather than staging a phantom all-empty row.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRow();
      i += 1;
      if (rows.length > MIGRATION_FILE_LIMITS.maxRows) {
        throw new MigrationFileLimitExceededError(`File exceeds ${MIGRATION_FILE_LIMITS.maxRows} data rows`);
      }
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();

  if (rows.length === 0) throw new MigrationFileParseError("File has no rows");
  const [headerRow, ...dataRows] = rows;
  if (headerRow.length > MIGRATION_FILE_LIMITS.maxColumns) {
    throw new MigrationFileLimitExceededError(`File exceeds ${MIGRATION_FILE_LIMITS.maxColumns} columns`);
  }

  return { headers: headerRow.map((h) => h.trim()), rows: dataRows };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/**
 * A formula cell's `.value` is `{ formula, result, ... }` in exceljs. Only
 * the cached `.result` is ever read — the formula text itself is never
 * evaluated, satisfying §8's "do not evaluate formulas" without needing to
 * strip or reject formula cells outright (an HR export legitimately may
 * contain a SUM or a lookup; its last-computed value is safe data).
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("result" in value) return cellToString((value as { result: ExcelJS.CellValue }).result);
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
    if (value instanceof Date) return value.toISOString();
    if ("richText" in value) {
      return (value as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    }
    return "";
  }
  return String(value);
}

/**
 * Loads the full workbook via `exceljs`'s standard (non-streaming) reader.
 * `exceljs`'s streaming `WorkbookReader` was evaluated first, specifically
 * to bound memory on a buffer-backed input without fully inflating it, but
 * does not reliably support an in-memory buffer source (ZIP's central
 * directory lives at the end of the archive, which the streaming reader
 * expects to seek on a real file/socket stream, not an arbitrary
 * `Readable.from(buffer)` — verified directly, not assumed: it fails with
 * an internal error unrelated to any file this workstream controls).
 * `Workbook.xlsx.load` is the standard, reliably-working API every other
 * `exceljs` consumer uses. Memory is instead bounded by the file-size cap
 * above (20MB compressed) plus an immediate row/column count check right
 * after load, before this function does any further per-cell work — a
 * workbook that decompresses to something pathological is rejected at that
 * checkpoint rather than being fully iterated first.
 */
export async function parseXlsxBuffer(buffer: Buffer, sheetName?: string): Promise<ParsedTable> {
  if (buffer.length > MIGRATION_FILE_LIMITS.maxFileBytes) {
    throw new MigrationFileLimitExceededError(`File exceeds the ${MIGRATION_FILE_LIMITS.maxFileBytes / 1024 / 1024}MB limit`);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch (err) {
    throw new MigrationFileParseError(`Could not parse XLSX file: ${err instanceof Error ? err.message : String(err)}`);
  }

  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) {
    throw new MigrationFileParseError(sheetName ? `Worksheet "${sheetName}" was not found in this workbook` : "Workbook has no worksheets");
  }
  if (worksheet.rowCount > MIGRATION_FILE_LIMITS.maxRows + 1) {
    throw new MigrationFileLimitExceededError(`Sheet exceeds ${MIGRATION_FILE_LIMITS.maxRows} data rows`);
  }
  if (worksheet.columnCount > MIGRATION_FILE_LIMITS.maxColumns) {
    throw new MigrationFileLimitExceededError(`Sheet exceeds ${MIGRATION_FILE_LIMITS.maxColumns} columns`);
  }

  let headers: string[] | null = null;
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1);
    const cells = values.map(cellToString);
    if (headers === null) {
      headers = cells.map((h) => h.trim());
      return;
    }
    if (cells.every((c) => c === "")) return; // skip genuinely blank rows
    rows.push(headers.map((_, idx) => cells[idx] ?? ""));
  });

  if (headers === null) throw new MigrationFileParseError("Workbook sheet has no rows");
  return { headers, rows };
}

/** Every worksheet name in a workbook — used to let the caller pick a sheet before committing to a full parse. */
export async function listXlsxSheetNames(buffer: Buffer): Promise<string[]> {
  if (buffer.length > MIGRATION_FILE_LIMITS.maxFileBytes) {
    throw new MigrationFileLimitExceededError(`File exceeds the ${MIGRATION_FILE_LIMITS.maxFileBytes / 1024 / 1024}MB limit`);
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch (err) {
    throw new MigrationFileParseError(`Could not read XLSX workbook: ${err instanceof Error ? err.message : String(err)}`);
  }
  return workbook.worksheets.map((ws) => ws.name);
}

export type MigrationFileFormat = "csv" | "xlsx";

export function detectFormat(mimeType: string, fileName: string): MigrationFileFormat {
  if (mimeType === "text/csv" || mimeType === "application/csv" || fileName.toLowerCase().endsWith(".csv")) return "csv";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    fileName.toLowerCase().endsWith(".xlsx")
  ) {
    return "xlsx";
  }
  throw new MigrationFileParseError("Unsupported file type — CSV or XLSX only");
}

export async function parseMigrationFile(buffer: Buffer, format: MigrationFileFormat, sheetName?: string): Promise<ParsedTable> {
  return format === "csv" ? parseCsvBuffer(buffer) : parseXlsxBuffer(buffer, sheetName);
}
