/**
 * WS-7 (§8) — CSV and XLSX parsing correctness and safety.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  parseCsvBuffer,
  parseXlsxBuffer,
  listXlsxSheetNames,
  detectFormat,
  MigrationFileParseError,
  MigrationFileLimitExceededError,
  MIGRATION_FILE_LIMITS,
} from "../lib/migrations/fileParsing";

describe("parseCsvBuffer", () => {
  it("parses a simple CSV", () => {
    const result = parseCsvBuffer(Buffer.from("Name,Age\nAda,30\nGrace,32\n"));
    expect(result.headers).toEqual(["Name", "Age"]);
    expect(result.rows).toEqual([
      ["Ada", "30"],
      ["Grace", "32"],
    ]);
  });

  it("handles quoted fields with embedded commas, quotes, and newlines", () => {
    const result = parseCsvBuffer(Buffer.from('Name,Note\n"Doe, Jane","She said ""hi""\nagain"\n'));
    expect(result.rows).toEqual([["Doe, Jane", 'She said "hi"\nagain']]);
  });

  it("strips a UTF-8 BOM", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Name\nAda\n")]);
    const result = parseCsvBuffer(withBom);
    expect(result.headers).toEqual(["Name"]);
  });

  it("skips genuinely blank lines", () => {
    const result = parseCsvBuffer(Buffer.from("Name\nAda\n\nGrace\n"));
    expect(result.rows).toEqual([["Ada"], ["Grace"]]);
  });

  it("rejects a file containing a null byte", () => {
    expect(() => parseCsvBuffer(Buffer.from("Name\n\x00\n"))).toThrow(MigrationFileParseError);
  });

  it("rejects invalid UTF-8", () => {
    expect(() => parseCsvBuffer(Buffer.from([0xff, 0xfe, 0xfd]))).toThrow(MigrationFileParseError);
  });

  it("rejects an empty file", () => {
    expect(() => parseCsvBuffer(Buffer.from(""))).toThrow(MigrationFileParseError);
  });

  it("rejects a file over the size limit", () => {
    const big = Buffer.alloc(MIGRATION_FILE_LIMITS.maxFileBytes + 1, "a");
    expect(() => parseCsvBuffer(big)).toThrow(MigrationFileLimitExceededError);
  });

  it("rejects too many columns", () => {
    const header = Array.from({ length: MIGRATION_FILE_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`).join(",");
    expect(() => parseCsvBuffer(Buffer.from(`${header}\n`))).toThrow(MigrationFileLimitExceededError);
  });

  it("rejects too many rows", () => {
    const lines = Array.from({ length: MIGRATION_FILE_LIMITS.maxRows + 2 }, () => "x").join("\n");
    expect(() => parseCsvBuffer(Buffer.from(`h\n${lines}\n`))).toThrow(MigrationFileLimitExceededError);
  });

  // §33: a formula-injection-shaped cell is just inert text once parsed —
  // never evaluated, never treated specially on the READ path (only a later
  // CSV *export* needs to guard it, via reporting.ts's safeCsvCell).
  it("treats a formula-injection-shaped cell as plain text", () => {
    const result = parseCsvBuffer(Buffer.from('Name\n"=cmd|\'/c calc\'!A1"\n'));
    expect(result.rows).toEqual([["=cmd|'/c calc'!A1"]]);
  });
});

describe("parseXlsxBuffer", () => {
  async function buildWorkbook(sheets: Record<string, (string | number)[][]>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of Object.entries(sheets)) {
      const ws = wb.addWorksheet(name);
      for (const row of rows) ws.addRow(row);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("parses a simple workbook's first sheet", async () => {
    const buf = await buildWorkbook({
      Sheet1: [
        ["Name", "Age"],
        ["Ada", 30],
      ],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.headers).toEqual(["Name", "Age"]);
    expect(result.rows).toEqual([["Ada", "30"]]);
  });

  it("parses a specific named sheet, not just the first", async () => {
    const buf = await buildWorkbook({
      Branches: [["Name"], ["Accra HQ"]],
      Employees: [["Name"], ["Ada"]],
    });
    const result = await parseXlsxBuffer(buf, "Employees");
    expect(result.rows).toEqual([["Ada"]]);
  });

  it("lists every sheet name in a workbook", async () => {
    const buf = await buildWorkbook({ Branches: [["Name"]], Employees: [["Name"]] });
    expect(await listXlsxSheetNames(buf)).toEqual(["Branches", "Employees"]);
  });

  it("throws a clear error for a nonexistent sheet name", async () => {
    const buf = await buildWorkbook({ Sheet1: [["Name"]] });
    await expect(parseXlsxBuffer(buf, "DoesNotExist")).rejects.toThrow(/not found/i);
  });

  it("reads a formula cell's cached result, never the formula text, and never evaluates it", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Total"]);
    ws.getCell("A2").value = { formula: "1+1", result: 2 } as unknown as ExcelJS.CellValue;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseXlsxBuffer(buf);
    expect(result.rows).toEqual([["2"]]);
  });

  it("rejects a workbook over the size limit", async () => {
    const big = Buffer.alloc(MIGRATION_FILE_LIMITS.maxFileBytes + 1);
    await expect(parseXlsxBuffer(big)).rejects.toThrow(MigrationFileLimitExceededError);
  });

  it("rejects a malformed (non-ZIP) file presented as XLSX", async () => {
    await expect(parseXlsxBuffer(Buffer.from("not a real xlsx file"))).rejects.toThrow(MigrationFileParseError);
  });

  it("skips genuinely blank rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Name"]);
    ws.addRow(["Ada"]);
    ws.addRow([]);
    ws.addRow(["Grace"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await parseXlsxBuffer(buf);
    expect(result.rows).toEqual([["Ada"], ["Grace"]]);
  });
});

describe("detectFormat", () => {
  it("detects CSV by MIME type", () => {
    expect(detectFormat("text/csv", "file.dat")).toBe("csv");
  });
  it("detects CSV by extension when MIME is generic", () => {
    expect(detectFormat("application/octet-stream", "export.csv")).toBe("csv");
  });
  it("detects XLSX by MIME type", () => {
    expect(detectFormat("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "file.dat")).toBe("xlsx");
  });
  it("rejects an unsupported type", () => {
    expect(() => detectFormat("application/pdf", "file.pdf")).toThrow(MigrationFileParseError);
  });
});
