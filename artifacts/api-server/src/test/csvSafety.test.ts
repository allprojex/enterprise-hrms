/**
 * WS-1 (Engineering & Security Foundation) — CSV formula-injection hardening.
 *
 * lib/reporting.ts's `safeCsvCell`/`toCsv` is now the ONE shared CSV
 * serialization primitive for this platform. Before WS-1, `lib/reporting.ts`
 * and six route-local copies (assetReporting.ts, attendanceReporting.ts,
 * learningReporting.ts, payrollReports.ts, performanceReporting.ts,
 * personnelReporting.ts, recruitmentReporting.ts) each escaped only quotes/
 * commas/newlines — a cell whose value began with `=`, `+`, `-`, `@`, a tab,
 * or a carriage return was written to the CSV unescaped, letting a
 * spreadsheet application interpret it as a formula (e.g. a candidate/
 * employee free-text name field containing `=HYPERLINK(...)`). Two routes
 * (officeInventoryReporting.ts, payrollPaymentBatches.ts) had already,
 * independently, adopted the correct leading-`'` guard — that proven pattern
 * is what this file's shared primitive now applies everywhere.
 *
 * These are permanent regression tests directly against the shared pure
 * function — no HTTP/DB mocking needed, since the security property lives
 * entirely in this one function and every CSV-producing route now calls it.
 */
import { describe, it, expect } from "vitest";
import { safeCsvCell, toCsv } from "../lib/reporting";

describe("safeCsvCell — formula-injection hardening", () => {
  it("prefixes a leading '=' with a guard apostrophe (and still quotes the cell, since it contains commas/quotes)", () => {
    expect(safeCsvCell("=HYPERLINK(\"http://evil.example\",\"click\")")).toBe(
      `"'=HYPERLINK(""http://evil.example"",""click"")"`,
    );
  });

  it("prefixes a leading '+' with a guard apostrophe", () => {
    expect(safeCsvCell("+1+1")).toBe("'+1+1");
  });

  it("prefixes a leading '-' with a guard apostrophe when the value is text, not a number", () => {
    expect(safeCsvCell("-CMD|'/C calc'")).toBe("'-CMD|'/C calc'");
  });

  it("prefixes a leading '@' with a guard apostrophe (and still quotes the cell, since it contains a comma)", () => {
    expect(safeCsvCell("@SUM(1,1)")).toBe(`"'@SUM(1,1)"`);
  });

  it("prefixes a leading tab with a guard apostrophe", () => {
    expect(safeCsvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("prefixes a leading carriage return with a guard apostrophe", () => {
    expect(safeCsvCell("\r=1+1")).toBe("'\r=1+1");
  });

  it("does not alter an ordinary text value with no dangerous leading character", () => {
    expect(safeCsvCell("Kwame Mensah")).toBe("Kwame Mensah");
  });

  it("does not treat a real negative number as dangerous — numeric type is preserved as a plain numeral", () => {
    // The vulnerable case is *text* a user typed that happens to start with
    // '-'; a genuine numeric cell (JS `number`, not `string`) must still
    // export as an ordinary negative number, never gain a guard apostrophe.
    expect(safeCsvCell(-42)).toBe("-42");
    expect(safeCsvCell(-0.5)).toBe("-0.5");
  });

  it("still guards a text value that merely looks numeric-negative but is a string", () => {
    // A string "-42" typed into a free-text field is indistinguishable from
    // a formula-leading '-' by content alone, so the guard is deliberately
    // conservative and applies to it too — this is the documented, accepted
    // trade-off (matches the existing Office Inventory / Payroll precedent).
    expect(safeCsvCell("-42")).toBe("'-42");
  });

  it("still quotes/escapes embedded quotes, commas, and newlines after guarding", () => {
    expect(safeCsvCell('=A,"B"')).toBe(`"'=A,""B"""`);
  });

  it("renders null/undefined as an empty cell, not the literal string 'null'/'undefined'", () => {
    expect(safeCsvCell(null)).toBe("");
    expect(safeCsvCell(undefined)).toBe("");
  });

  it("passes through a boolean value as its string form", () => {
    expect(safeCsvCell(true)).toBe("true");
    expect(safeCsvCell(false)).toBe("false");
  });
});

describe("toCsv — end-to-end row serialization", () => {
  const columns = [
    { key: "name", label: "Name" },
    { key: "balance", label: "Balance" },
  ];

  it("neutralizes a malicious column value while leaving legitimate rows untouched", () => {
    const rows = [
      { name: "Ama Owusu", balance: -12.5 },
      { name: "=cmd|' /C calc'!A1", balance: 100 },
    ];
    const csv = toCsv(columns, rows);
    expect(csv).toBe(["Name,Balance", "Ama Owusu,-12.5", "'=cmd|' /C calc'!A1,100"].join("\n"));
  });

  it("does not corrupt the underlying JSON/API row data — hardening is CSV-serialization-only", () => {
    // The fix lives entirely in the CSV serialization step; the row objects
    // callers pass in (and would return as JSON from the non-CSV branch of
    // the same route) are never mutated by toCsv/safeCsvCell.
    const original = { name: "=HYPERLINK(1)", balance: 5 };
    const rows = [original];
    toCsv(columns, rows);
    expect(rows[0]).toBe(original);
    expect(rows[0].name).toBe("=HYPERLINK(1)");
  });

  it("still produces a well-formed header row from column labels", () => {
    const csv = toCsv(columns, []);
    expect(csv).toBe("Name,Balance");
  });
});
