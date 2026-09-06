/**
 * WS-26A — fidelity of the four WWM templates to the official documents.
 *
 * The authority is the docx structure fixture (src/test/fixtures/wwm-forms,
 * regenerated from the owner's files by src/test/tools/docxStructure.ts).
 * Three checks per form:
 *
 *   1. ORDERED TEXT — the complete text stream the template definition
 *      produces (header, intro, every section title, label, option, rating
 *      column, criterion, total and note, in definition order) equals the
 *      complete text stream of the docx body in document order. Not "every
 *      string appears somewhere": the sequences must be identical.
 *   2. STRUCTURE — every section title is a real docx heading (a table's
 *      first cell or a paragraph); every rating matrix's column labels are a
 *      real docx table row in that order; every checkbox group's options sit
 *      in the same docx table as their section title.
 *   3. RENDERED PDF — the text drawn by the structured renderer for the blank
 *      form contains that same stream, in order.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WWM_FORM_TEMPLATES } from "../formTemplates/wwm";
import { validateFormDefinition, type FormDefinition, type FormItem } from "../lib/formEngine/definition";
import { normalizeDocxText, type DocxStructure } from "./tools/docxStructure";
import { buildLayoutDocument } from "../lib/formEngine/render";
import { renderLayoutPdf, extractPdfTextRuns } from "../lib/pdf/layoutRenderer";

const FIXTURE_DIR = path.resolve(__dirname, "fixtures", "wwm-forms");

function loadFixture(name: string): DocxStructure {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.structure.json`), "utf8")) as DocxStructure;
}

/** Normalisation shared by both sides: case, whitespace, fill lines, glyphs, colons. */
function norm(text: string): string {
  return normalizeDocxText(text).replace(/:/g, "").replace(/\s+/g, " ").trim();
}

function docxTokens(structure: DocxStructure): string[] {
  const tokens: string[] = [];
  for (const block of structure.blocks) {
    if (block.type === "paragraph") tokens.push(norm(block.text));
    else for (const row of block.rows) for (const cell of row) for (const part of cell.split(" ¶ ")) tokens.push(norm(part));
  }
  return tokens.filter((t) => t.length > 0);
}

function itemTokens(item: FormItem): string[] {
  switch (item.kind) {
    case "field":
      return [item.label, item.helpText ?? ""];
    case "choice_group":
      return [item.label ?? "", ...item.options.map((o) => o.label), item.otherField?.label ?? ""];
    case "matrix": {
      const header = [...(item.ratingHeader ? [item.criteriaHeader ?? "", item.ratingHeader] : [item.criteriaHeader ?? ""]), ...item.columns.map((c) => c.label)];
      const rows: string[] = [];
      for (const row of item.rows) {
        if (row.repeatHeaderBefore) rows.push(...item.columns.map((c) => c.label));
        rows.push(row.label);
      }
      return [item.label ?? "", item.scaleText ?? "", ...header, ...rows, item.total?.label ?? ""];
    }
    case "rated_table":
      return [item.label ?? "", ...item.textColumns.map((c) => c.label), item.ratingHeader, ...item.ratingColumns.map((c) => c.label), ...item.rows.map((r) => r.label), item.total?.label ?? ""];
    case "table":
      return [item.label ?? "", ...item.columns.map((c) => c.label)];
    case "note":
      return [item.text];
    case "signature":
      return [item.label, item.dateLabel ?? ""];
    case "computed":
      return [item.label];
  }
}

function definitionTokens(definition: FormDefinition): string[] {
  const tokens: string[] = [...definition.header.lines, ...(definition.intro ?? [])];
  for (const section of definition.sections) {
    tokens.push(section.title ?? "");
    for (const item of section.items) tokens.push(...itemTokens(item));
  }
  tokens.push(...(definition.footerNotes ?? []));
  return tokens.map(norm).filter((t) => t.length > 0);
}

function tablesContaining(structure: DocxStructure, text: string) {
  return structure.blocks.filter((b): b is Extract<typeof b, { type: "table" }> => b.type === "table" && b.rows.some((r) => r.some((c) => c.split(" ¶ ").some((p) => norm(p) === text))));
}

describe.each(WWM_FORM_TEMPLATES.map((t) => [t.templateKey, t] as const))("WWM template fidelity — %s", (_key, seed) => {
  const definition = validateFormDefinition(seed.definition);
  const fixture = loadFixture(seed.fixture);

  it("definition text stream equals the official document's text stream, in order", () => {
    const expected = definitionTokens(definition).join(" ");
    const actual = docxTokens(fixture).join(" ");
    expect(expected).toBe(actual);
  });

  it("section titles are real document headings", () => {
    for (const section of definition.sections) {
      if (!section.title) continue;
      const title = norm(section.title);
      const asParagraph = fixture.blocks.some((b) => b.type === "paragraph" && norm(b.text) === title);
      const asTableHeading = fixture.blocks.some((b) => b.type === "table" && b.rows.some((r) => r.length > 0 && r.some((c) => c.split(" ¶ ").some((p) => norm(p) === title))));
      expect(asParagraph || asTableHeading, `section "${section.title}" is not a heading in the document`).toBe(true);
    }
  });

  it("rating columns are a real document row in the same order, and checkbox options share their section's table", () => {
    for (const section of definition.sections) {
      for (const item of section.items) {
        if (item.kind === "matrix" || item.kind === "rated_table") {
          const labels = (item.kind === "matrix" ? item.columns : item.ratingColumns).map((c) => norm(c.label));
          const found = fixture.blocks.some(
            (b) => b.type === "table" && b.rows.some((r) => r.map(norm).filter((c) => c.length > 0).join("|") === labels.join("|")),
          );
          expect(found, `rating columns ${labels.join(",")} for "${item.key}" are not a document row`).toBe(true);
        }
        if (item.kind === "choice_group") {
          const anchor = section.title ? norm(section.title) : norm(item.options[0].label);
          const tables = tablesContaining(fixture, anchor);
          expect(tables.length, `no document table holds "${anchor}"`).toBeGreaterThan(0);
          for (const option of item.options) {
            const label = norm(option.label);
            const inSameTable = tables.some((t) => t.rows.some((r) => r.some((c) => c.split(" ¶ ").some((p) => norm(p) === label))));
            expect(inSameTable, `option "${option.label}" is not in the same table as "${anchor}"`).toBe(true);
          }
        }
      }
    }
  });

  it("the rendered blank PDF draws the same text stream in order", () => {
    const doc = buildLayoutDocument({
      definition,
      kind: "blank",
      answers: {},
      autofill: {},
      computed: {},
      organizationName: "Worldwide Word Ministries",
      logo: null,
      templateTitle: seed.title,
      versionNumber: 1,
      definitionSha256: "0".repeat(64),
    });
    const pdfText = norm(extractPdfTextRuns(renderLayoutPdf(doc)).join(" "));
    let cursor = 0;
    for (const token of definitionTokens(definition)) {
      const at = pdfText.indexOf(token, cursor);
      expect(at, `"${token}" not found in rendered PDF after position ${cursor}`).toBeGreaterThanOrEqual(0);
      cursor = at + token.length;
    }
  });
});
