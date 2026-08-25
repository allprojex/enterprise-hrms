/**
 * WS-5 (Documents & Records Foundation, §23) — the authoritative generated-
 * document format for official HR letters is PDF, produced by this minimal,
 * dependency-free writer.
 *
 * Why not a PDF library: this repository had no PDF tooling at all before
 * WS-5 (verified against every workspace package.json), so "reuse existing
 * tooling" was not an option and the choice was between adding a rendering
 * dependency and writing the small amount of PDF this actually needs.
 * Generated letters are plain text (document_template_versions.format is
 * `plain_text` by construction — see document-template-versions.ts on why
 * template content is never HTML/a templating language), which needs none of
 * what a PDF library exists to provide: no images, no vector graphics, no
 * font embedding (the PDF standard-14 fonts are always available and require
 * no font program). What remains is page structure, text placement, and
 * escaping — all of it below, all of it auditable in one file.
 *
 * Three properties this buys that matter to this workstream specifically:
 *   - Deterministic bytes. Nothing here reads the clock or any RNG, so the
 *     same content always produces the identical file — which is what makes
 *     §24's "the generated artifact is exactly what was produced at
 *     generation time" checkable, and what generatedDocuments.test.ts
 *     asserts directly.
 *   - No new supply-chain surface for a security-hardened platform (WS-1),
 *     on a path that renders organization-controlled input.
 *   - Total control over escaping. Template content is untrusted input
 *     (§22); every byte reaching a content stream goes through escapePdfText
 *     below, and text is *drawn*, never parsed or evaluated.
 *
 * Scope boundary: this is deliberately not a general PDF library. It writes
 * left-aligned text in Helvetica/Helvetica-Bold at a fixed page size with
 * automatic wrapping and pagination. Anything beyond that (tables, images,
 * rich layout) is out of WS-5's scope and should not be bolted on here.
 */

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56.7; // ~20mm
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32-126,
 * from the standard AFM metrics. Needed to wrap text at the right column;
 * carried as a constant rather than measured at runtime because the
 * standard-14 fonts are fixed by the PDF specification itself.
 */
const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722,
  778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556,
  278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260,
  334, 584,
];

const HELVETICA_BOLD_WIDTHS: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584,
];

export type PdfFont = "regular" | "bold";

function widthsFor(font: PdfFont): readonly number[] {
  return font === "bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
}

/**
 * Width of `text` in points at `size`. Characters outside ASCII 32-126 fall
 * back to the width of a lowercase "n" — they are rare in this context and a
 * slightly imperfect wrap is strictly better than a thrown error mid-letter.
 */
function measure(text: string, font: PdfFont, size: number): number {
  const widths = widthsFor(font);
  let total = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    const width = code >= 32 && code <= 126 ? widths[code - 32] : widths["n".charCodeAt(0) - 32];
    total += width;
  }
  return (total * size) / 1000;
}

/**
 * PDF string-literal escaping: backslash first (so escapes added after are
 * not themselves re-escaped), then the parenthesis delimiters. Characters
 * outside WinAnsi's printable range are dropped rather than emitted raw —
 * an un-escapable byte in a content stream can terminate the string early
 * and corrupt the object, which is exactly the injection class §22 cares
 * about on a path that renders organization-controlled input.
 */
function escapePdfText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === "\\") out += "\\\\";
    else if (char === "(") out += "\\(";
    else if (char === ")") out += "\\)";
    else if (code >= 32 && code <= 126) out += char;
    else if (code === 9) out += "    ";
    // Anything else (control characters, unpaired surrogates, non-WinAnsi)
    // is dropped deliberately — see above.
  }
  return out;
}

export interface PdfLine {
  text: string;
  font?: PdfFont;
  size?: number;
  /** Extra vertical space (points) before this line — used for paragraph/section gaps. */
  spaceBefore?: number;
}

/**
 * Wraps `line` to CONTENT_WIDTH, returning one entry per rendered row. A
 * single word longer than the content width (a pasted URL, an unbroken
 * token) is emitted on its own overlong row rather than split mid-word or
 * dropped — it may overflow the right margin, which is visible and
 * correctable by the template author, unlike silently losing content.
 */
function wrapLine(line: PdfLine): PdfLine[] {
  const font = line.font ?? "regular";
  const size = line.size ?? 11;
  if (line.text.trim() === "") return [{ ...line, text: "" }];

  const words = line.text.split(/\s+/).filter((w) => w.length > 0);
  const rows: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (measure(candidate, font, size) <= CONTENT_WIDTH) {
      current = candidate;
    } else {
      if (current !== "") rows.push(current);
      current = word;
    }
  }
  if (current !== "") rows.push(current);
  if (rows.length === 0) rows.push("");

  return rows.map((text, index) => ({
    text,
    font,
    size,
    // The paragraph gap belongs to the first rendered row only; wrapped
    // continuation rows follow at normal leading.
    spaceBefore: index === 0 ? line.spaceBefore : 0,
  }));
}

/** Splits already-wrapped rows into pages that fit within the vertical margins. */
function paginate(rows: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  for (const row of rows) {
    const size = row.size ?? 11;
    const leading = size * 1.45;
    const advance = (row.spaceBefore ?? 0) + leading;

    if (y - advance < MARGIN && page.length > 0) {
      pages.push(page);
      page = [];
      y = PAGE_HEIGHT - MARGIN;
      // A paragraph gap is not carried across a page break — the break
      // itself already provides the separation.
      page.push({ ...row, spaceBefore: 0 });
      y -= (row.size ?? 11) * 1.45;
      continue;
    }
    y -= advance;
    page.push(row);
  }
  if (page.length > 0) pages.push(page);
  if (pages.length === 0) pages.push([]);
  return pages;
}

/** Builds one page's content stream: a sequence of positioned text-showing operators. */
function buildContentStream(rows: PdfLine[]): string {
  const parts: string[] = ["BT"];
  let y = PAGE_HEIGHT - MARGIN;

  for (const row of rows) {
    const font = row.font ?? "regular";
    const size = row.size ?? 11;
    y -= (row.spaceBefore ?? 0) + size * 1.45;

    parts.push(`${font === "bold" ? "/F2" : "/F1"} ${size} Tf`);
    parts.push(`1 0 0 1 ${MARGIN.toFixed(2)} ${y.toFixed(2)} Tm`);
    if (row.text !== "") {
      parts.push(`(${escapePdfText(row.text)}) Tj`);
    }
  }

  parts.push("ET");
  return parts.join("\n");
}

/**
 * Renders lines to a complete PDF document.
 *
 * Object layout is fixed and simple: 1 = Catalog, 2 = Pages, 3 = Helvetica,
 * 4 = Helvetica-Bold, then one Page + one Contents object per page. The xref
 * table records each object's true byte offset, computed from the buffer as
 * it is assembled rather than predicted, so the file stays valid regardless
 * of content length.
 *
 * No /CreationDate, /ModDate, or /ID is written — those are the only values
 * that would otherwise vary between two renders of identical content, and
 * omitting them is what makes output byte-deterministic (see file header).
 */
export function renderTextPdf(lines: PdfLine[], options?: { title?: string }): Buffer {
  const wrapped = lines.flatMap(wrapLine);
  const pages = paginate(wrapped);

  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];
  const firstPageObject = 5;

  for (let i = 0; i < pages.length; i++) {
    pageObjectNumbers.push(firstPageObject + i * 2);
  }

  // 1: Catalog
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages
  objects.push(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  // 3, 4: standard-14 fonts — no font program to embed, by definition.
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  for (let i = 0; i < pages.length; i++) {
    const contentsObjectNumber = firstPageObject + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentsObjectNumber} 0 R >>`,
    );
    const stream = buildContentStream(pages[i]);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }

  const infoObjectNumber = objects.length + 1;
  if (options?.title) {
    objects.push(`<< /Title (${escapePdfText(options.title)}) >>`);
  }

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (text: string): void => {
    const buf = Buffer.from(text, "latin1");
    chunks.push(buf);
    offset += buf.length;
  };

  push("%PDF-1.4\n");
  const xrefOffsets: number[] = [];
  objects.forEach((body, index) => {
    xrefOffsets.push(offset);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefStart = offset;
  const entryCount = objects.length + 1;
  let xref = `xref\n0 ${entryCount}\n0000000000 65535 f \n`;
  for (const objectOffset of xrefOffsets) {
    xref += `${objectOffset.toString().padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${entryCount} /Root 1 0 R${options?.title ? ` /Info ${infoObjectNumber} 0 R` : ""} >>\n` +
      `startxref\n${xrefStart}\n%%EOF\n`,
  );

  return Buffer.concat(chunks);
}
