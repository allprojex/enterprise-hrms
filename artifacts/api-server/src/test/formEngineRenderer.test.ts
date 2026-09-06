/**
 * WS-26A — structured PDF renderer: deterministic bytes, drawn text and
 * checkboxes, header repetition across pages, status marker outside the body.
 */
import { describe, it, expect } from "vitest";
import { renderLayoutPdf, extractPdfTextRuns, encodeText, measureText, type LayoutDocument } from "../lib/pdf/layoutRenderer";
import { buildLayoutDocument } from "../lib/formEngine/render";
import { wwmLeaveApplicationDefinition } from "../formTemplates/wwm/leaveApplication";

describe("layoutRenderer", () => {
  it("produces identical bytes for identical input and a valid PDF skeleton", () => {
    const doc: LayoutDocument = {
      title: "T",
      statusMarker: "DRAFT",
      elements: [
        { type: "heading", text: "Heading" },
        { type: "table", columns: [1, 1], rows: [{ cells: [{ text: "A", bold: true }, { text: "B" }], header: true }, { cells: [{ text: "cell", checkbox: true }, { text: "x" }] }] },
      ],
    };
    const a = renderLayoutPdf(doc);
    const b = renderLayoutPdf(doc);
    expect(a.equals(b)).toBe(true);
    const text = a.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text.trim().endsWith("%%EOF")).toBe(true);
    // A checked box draws an X (two line segments) — visible in the content stream as line operators.
    expect(text).toMatch(/ m [\d.]+ [\d.]+ l S/);
    expect(extractPdfTextRuns(a).join(" ")).toContain("Heading");
    expect(extractPdfTextRuns(a).join(" ")).toContain("DRAFT");
  });

  it("encodes WinAnsi typography and escapes delimiters; drops what it cannot draw", () => {
    expect(encodeText("a(b)c\\")).toBe("a\\(b\\)c\\\\");
    expect(encodeText("x—y")).toBe(`x${String.fromCharCode(0x97)}y`);
    expect(encodeText("☐ box")).toBe(" box");
    expect(measureText("Hello", true, 10)).toBeGreaterThan(measureText("Hello", false, 10));
  });

  it("repeats a table header row on a continuation page", () => {
    const rows = [{ cells: [{ text: "Header", bold: true }], header: true }, ...Array.from({ length: 80 }, (_, i) => ({ cells: [{ text: `Row ${i}` }] }))];
    const pdf = renderLayoutPdf({ elements: [{ type: "table", columns: [1], rows }] });
    const runs = extractPdfTextRuns(pdf);
    expect(runs.filter((r) => r === "Header").length).toBeGreaterThanOrEqual(2);
    const count = Number(/\/Count (\d+)/.exec(pdf.toString("latin1"))?.[1]);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("renders a blank WWM form with the status marker outside the body and no certificate appendix", () => {
    const doc = buildLayoutDocument({
      definition: wwmLeaveApplicationDefinition,
      kind: "blank",
      answers: {},
      autofill: {},
      computed: {},
      organizationName: "Test Org",
      logo: null,
      templateTitle: "Employee Leave Application Form",
      versionNumber: 1,
      definitionSha256: "abc",
    });
    expect(doc.statusMarker).toBeUndefined();
    expect(doc.elements.some((e) => e.type === "heading")).toBe(false);
    const draft = buildLayoutDocument({ ...docInput(), kind: "draft" });
    expect(draft.statusMarker).toBe("DRAFT — NOT SUBMITTED");
    const submitted = buildLayoutDocument({ ...docInput(), kind: "submitted", history: [{ step: "submitted", stage: "", actor: "Ama Boateng", at: new Date("2026-09-06T10:00:00Z"), notes: "" }] });
    const text = extractPdfTextRuns(renderLayoutPdf(submitted)).join(" ");
    expect(text).toContain("Approval & Signature Certificate");
    expect(text).toContain("Ama Boateng");
    // The certificate comes AFTER the form body's last note.
    expect(text.indexOf("7 working days")).toBeLessThan(text.indexOf("Approval & Signature Certificate"));
  });
});

function docInput() {
  return {
    definition: wwmLeaveApplicationDefinition,
    answers: { leave_type: "annual_leave", from_date: "2026-10-01" },
    autofill: { employee_name: "Ama Boateng" },
    computed: {},
    organizationName: "Test Org",
    logo: null,
    templateTitle: "Employee Leave Application Form",
    versionNumber: 1,
    definitionSha256: "abc",
    submissionId: 7,
    revisionNumber: 2,
  } as const;
}
