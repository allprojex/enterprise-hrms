/**
 * Unit tests for the pure CSV parser (Phase 3H, W119) — no DB, no mocks.
 * parseCsv only ever splits characters into string cells; it never
 * executes, evaluates, or interprets content in any way.
 */
import { describe, it, expect } from "vitest";
import { parseCsv, toRecords, MalformedCsvError, IMPORT_TEMPLATE_HEADERS } from "../lib/legacyImport";

describe("parseCsv", () => {
  it("parses a simple two-row CSV", () => {
    const rows = parseCsv("firstName,lastName\nJane,Doe\n");
    expect(rows).toEqual([
      ["firstName", "lastName"],
      ["Jane", "Doe"],
    ]);
  });

  it("handles a quoted field containing an embedded comma", () => {
    const rows = parseCsv('firstName,lastName\n"Doe, Jr.",Jane\n');
    expect(rows[1]).toEqual(["Doe, Jr.", "Jane"]);
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    const rows = parseCsv('firstName,note\nJane,"She said ""hello"""\n');
    expect(rows[1]).toEqual(["Jane", 'She said "hello"']);
  });

  it("handles a quoted field containing an embedded newline", () => {
    const rows = parseCsv('firstName,note\nJane,"Line one\nLine two"\n');
    expect(rows[1]).toEqual(["Jane", "Line one\nLine two"]);
  });

  it("strips a UTF-8 BOM if present", () => {
    const rows = parseCsv("﻿firstName,lastName\nJane,Doe\n");
    expect(rows[0]).toEqual(["firstName", "lastName"]);
  });

  it("throws MalformedCsvError for an unterminated quoted field", () => {
    expect(() => parseCsv('firstName\n"unterminated')).toThrow(MalformedCsvError);
  });

  it("never evaluates or executes cell content — a formula-looking value is just a string", () => {
    const rows = parseCsv("firstName,lastName\n=SUM(A1:A2),Doe\n");
    expect(rows[1][0]).toBe("=SUM(A1:A2)");
  });
});

describe("toRecords", () => {
  it("maps rows to header-keyed records", () => {
    const records = toRecords(parseCsv("firstName,lastName\nJane,Doe\n"));
    expect(records).toEqual([{ firstName: "Jane", lastName: "Doe" }]);
  });

  it("throws MalformedCsvError for an empty file", () => {
    expect(() => toRecords([])).toThrow(MalformedCsvError);
  });
});

describe("IMPORT_TEMPLATE_HEADERS", () => {
  it("includes the required identity fields", () => {
    expect(IMPORT_TEMPLATE_HEADERS).toContain("firstName");
    expect(IMPORT_TEMPLATE_HEADERS).toContain("lastName");
  });

  it("includes the legacy-identifier-preservation fields", () => {
    expect(IMPORT_TEMPLATE_HEADERS).toContain("employeeNumber");
    expect(IMPORT_TEMPLATE_HEADERS).toContain("pifNumber");
  });
});
