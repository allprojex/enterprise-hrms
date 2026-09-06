/**
 * WS-26 — structured PDF renderer.
 *
 * lib/pdfWriter.ts renders left-aligned paragraphs for letters and says, in
 * its own header, that tables and images should not be bolted on to it. This
 * sibling keeps every property that made it safe — dependency-free, the
 * standard-14 Helvetica pair, WinAnsi with explicit escaping, no clock and no
 * RNG so identical input yields identical bytes — and adds what an official
 * form needs: a logo header block, bordered tables with wrapped cells and
 * repeated header rows across page breaks, drawn checkboxes, rules, signature
 * lines, a page-margin status marker and page numbers.
 *
 * Text is DRAWN from data, never parsed: nothing reaching a content stream
 * came from a template author without passing through `encodeText`, which
 * maps the handful of typographic characters the WWM forms use (em dash,
 * curly quotes, ellipsis) to their WinAnsi bytes and drops everything else.
 *
 * Images arrive pre-encoded as baseline JPEG (the caller flattens a logo with
 * sharp); they become /DCTDecode XObjects, which needs no decoder here.
 */

export type Align = "left" | "center" | "right";

export interface TextRun {
  text: string;
  bold?: boolean;
  size?: number;
}

export interface Cell {
  text?: string;
  runs?: TextRun[];
  bold?: boolean;
  align?: Align;
  /** Draws a checkbox before the text; `true` renders it checked, `null` empty. */
  checkbox?: boolean | null;
  colSpan?: number;
  /** Light grey background — section header rows. */
  shade?: boolean;
  /** Minimum height in points (blank answer space). */
  minHeight?: number;
  size?: number;
}

export interface TableRow {
  cells: Cell[];
  /** Repeated at the top of a continuation page. */
  header?: boolean;
}

export interface TableElement {
  type: "table";
  /** Column width fractions of the content width; must sum to ~1. */
  columns: number[];
  rows: TableRow[];
  borders?: boolean;
  size?: number;
  spaceAfter?: number;
}

export interface ParagraphElement {
  type: "paragraph";
  runs: TextRun[];
  align?: Align;
  size?: number;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface HeadingElement {
  type: "heading";
  text: string;
  size?: number;
  align?: Align;
  spaceBefore?: number;
  spaceAfter?: number;
}

export interface SpacerElement {
  type: "spacer";
  height: number;
}

export interface JpegImage {
  jpeg: Buffer;
  pixelWidth: number;
  pixelHeight: number;
}

/** Logo (fitted into a fixed box) at the left, title lines centred in the remaining width. */
export interface HeaderBlockElement {
  type: "header_block";
  image?: JpegImage | null;
  lines: TextRun[];
  /** When no image is available, a neutral placeholder box is drawn only if true. */
  placeholderWhenNoImage?: boolean;
}

export interface SignatureLineElement {
  type: "signature_line";
  label: string;
  dateLabel?: string;
  /** WS-26B: a captured signature image drawn above the line. */
  image?: JpegImage | null;
  /** Text printed under the line (signer name / timestamp) — WS-26B. */
  caption?: string;
}

export type LayoutElement = TableElement | ParagraphElement | HeadingElement | SpacerElement | HeaderBlockElement | SignatureLineElement;

export interface LayoutDocument {
  title?: string;
  /** Printed small in the top-right margin of every page, outside the form body. */
  statusMarker?: string;
  /** Printed small in the bottom-left margin of every page. */
  footerText?: string;
  elements: LayoutElement[];
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const TOP = PAGE_HEIGHT - MARGIN;
const BOTTOM = MARGIN + 18; // room for the footer line
const DEFAULT_SIZE = 9.5;
const LEADING = 1.3;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 3;
const CHECKBOX_SIZE = 8;

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

/** Typographic characters the official forms use, mapped to WinAnsi code points. */
const WINANSI_MAP: Record<string, number> = {
  "—": 0x97, // em dash
  "–": 0x96, // en dash
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "…": 0x85, // ellipsis
  "•": 0x95, // bullet
  " ": 0x20,
};

function charCode(char: string): number | null {
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return code;
  if (code >= 0xa0 && code <= 0xff) return code; // Latin-1 supplement is WinAnsi-compatible
  const mapped = WINANSI_MAP[char];
  return mapped ?? null;
}

function widthOfCode(code: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  if (code >= 32 && code <= 126) return table[code - 32];
  // Dashes and quotes are roughly the width of a hyphen/quote; ellipsis ≈ 1em.
  if (code === 0x97) return 1000;
  if (code === 0x96) return 556;
  if (code === 0x85) return 1000;
  return table["n".charCodeAt(0) - 32];
}

export function measureText(text: string, bold: boolean, size: number): number {
  let total = 0;
  for (const char of text) {
    const code = charCode(char);
    if (code === null) continue;
    total += widthOfCode(code, bold);
  }
  return (total * size) / 1000;
}

/** Escapes and encodes a string for a PDF literal in WinAnsi (emitted as latin1 bytes). */
export function encodeText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = charCode(char);
    if (code === null) continue;
    if (code === 0x5c) out += "\\\\";
    else if (code === 0x28) out += "\\(";
    else if (code === 0x29) out += "\\)";
    else out += String.fromCharCode(code);
  }
  return out;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Wraps runs into lines that fit `width`; each line is a list of runs. */
function wrapRuns(runs: TextRun[], width: number, defaultSize: number, defaultBold: boolean): TextRun[][] {
  const lines: TextRun[][] = [];
  let current: TextRun[] = [];
  let currentWidth = 0;
  const flush = () => {
    lines.push(current);
    current = [];
    currentWidth = 0;
  };
  for (const run of runs) {
    const bold = run.bold ?? defaultBold;
    const size = run.size ?? defaultSize;
    const parts = run.text.split(/(\n)/);
    for (const part of parts) {
      if (part === "\n") {
        flush();
        continue;
      }
      const words = part.split(/(\s+)/).filter((w) => w.length > 0);
      for (const word of words) {
        const w = measureText(word, bold, size);
        if (/^\s+$/.test(word)) {
          if (current.length === 0) continue;
          current.push({ text: " ", bold, size });
          currentWidth += measureText(" ", bold, size);
          continue;
        }
        if (currentWidth + w > width && current.length > 0) {
          // Drop a trailing space before breaking.
          const last = current[current.length - 1];
          if (last && last.text === " ") current.pop();
          flush();
        }
        current.push({ text: word, bold, size });
        currentWidth += w;
      }
    }
  }
  if (current.length > 0 || lines.length === 0) lines.push(current);
  return lines;
}

function lineHeight(line: TextRun[], defaultSize: number): number {
  const size = line.reduce((m, r) => Math.max(m, r.size ?? defaultSize), 0) || defaultSize;
  return size * LEADING;
}

interface PageState {
  ops: string[];
  images: Map<string, JpegImage>;
}

interface Ctx {
  pages: PageState[];
  page: PageState;
  y: number;
  imageIds: Map<Buffer, string>;
}

function newPage(ctx: Ctx): void {
  ctx.page = { ops: [], images: new Map() };
  ctx.pages.push(ctx.page);
  ctx.y = TOP;
}

function ensureSpace(ctx: Ctx, height: number): void {
  if (ctx.y - height < BOTTOM && ctx.y < TOP - 1) newPage(ctx);
}

function drawTextLine(ctx: Ctx, x: number, baselineY: number, line: TextRun[], defaultSize: number, defaultBold: boolean, align: Align, width: number): void {
  const total = line.reduce((s, r) => s + measureText(r.text, r.bold ?? defaultBold, r.size ?? defaultSize), 0);
  let cursor = x;
  if (align === "center") cursor = x + (width - total) / 2;
  else if (align === "right") cursor = x + width - total;
  ctx.page.ops.push("BT");
  for (const run of line) {
    const bold = run.bold ?? defaultBold;
    const size = run.size ?? defaultSize;
    ctx.page.ops.push(`${bold ? "/F2" : "/F1"} ${fmt(size)} Tf`);
    ctx.page.ops.push(`1 0 0 1 ${fmt(cursor)} ${fmt(baselineY)} Tm`);
    ctx.page.ops.push(`(${encodeText(run.text)}) Tj`);
    cursor += measureText(run.text, bold, size);
  }
  ctx.page.ops.push("ET");
}

function drawRect(ctx: Ctx, x: number, y: number, w: number, h: number, mode: "stroke" | "fill", gray = 0): void {
  if (mode === "fill") {
    ctx.page.ops.push(`${fmt(gray)} g ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f 0 g`);
  } else {
    ctx.page.ops.push(`0.5 w 0 G ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`);
  }
}

function drawCheckbox(ctx: Ctx, x: number, y: number, checked: boolean | null): void {
  drawRect(ctx, x, y, CHECKBOX_SIZE, CHECKBOX_SIZE, "stroke");
  if (checked) {
    ctx.page.ops.push(
      `0.9 w 0 G ${fmt(x + 1.5)} ${fmt(y + 1.5)} m ${fmt(x + CHECKBOX_SIZE - 1.5)} ${fmt(y + CHECKBOX_SIZE - 1.5)} l S ` +
        `${fmt(x + 1.5)} ${fmt(y + CHECKBOX_SIZE - 1.5)} m ${fmt(x + CHECKBOX_SIZE - 1.5)} ${fmt(y + 1.5)} l S`,
    );
  }
}

function imageId(ctx: Ctx, image: JpegImage): string {
  let id = ctx.imageIds.get(image.jpeg);
  if (!id) {
    id = `Im${ctx.imageIds.size + 1}`;
    ctx.imageIds.set(image.jpeg, id);
  }
  ctx.page.images.set(id, image);
  return id;
}

function drawImage(ctx: Ctx, image: JpegImage, x: number, y: number, boxW: number, boxH: number): void {
  const scale = Math.min(boxW / image.pixelWidth, boxH / image.pixelHeight);
  const w = image.pixelWidth * scale;
  const h = image.pixelHeight * scale;
  const ox = x + (boxW - w) / 2;
  const oy = y + (boxH - h) / 2;
  const id = imageId(ctx, image);
  ctx.page.ops.push(`q ${fmt(w)} 0 0 ${fmt(h)} ${fmt(ox)} ${fmt(oy)} cm /${id} Do Q`);
}

/* ---------------------------------------------------------------------- */
/* Elements                                                                */
/* ---------------------------------------------------------------------- */

function renderParagraph(ctx: Ctx, el: ParagraphElement): void {
  const size = el.size ?? DEFAULT_SIZE;
  const lines = wrapRuns(el.runs, CONTENT_WIDTH, size, false);
  const before = el.spaceBefore ?? 2;
  const after = el.spaceAfter ?? 4;
  const height = before + lines.reduce((s, l) => s + lineHeight(l, size), 0) + after;
  ensureSpace(ctx, Math.min(height, TOP - BOTTOM));
  ctx.y -= before;
  for (const line of lines) {
    const lh = lineHeight(line, size);
    if (ctx.y - lh < BOTTOM) newPage(ctx);
    ctx.y -= lh;
    drawTextLine(ctx, MARGIN, ctx.y + lh * 0.28, line, size, false, el.align ?? "left", CONTENT_WIDTH);
  }
  ctx.y -= after;
}

function renderHeading(ctx: Ctx, el: HeadingElement): void {
  renderParagraph(ctx, {
    type: "paragraph",
    runs: [{ text: el.text, bold: true, size: el.size ?? 11 }],
    align: el.align,
    size: el.size ?? 11,
    spaceBefore: el.spaceBefore ?? 8,
    spaceAfter: el.spaceAfter ?? 4,
  });
}

function renderHeaderBlock(ctx: Ctx, el: HeaderBlockElement): void {
  const boxW = 64;
  const boxH = 64;
  const gap = 10;
  const textX = MARGIN + boxW + gap;
  const textW = CONTENT_WIDTH - boxW - gap;
  const lines = el.lines.map((run) => wrapRuns([run], textW, run.size ?? 12, run.bold ?? true)).flat();
  const textH = lines.reduce((s, l) => s + lineHeight(l, 12), 0);
  const height = Math.max(boxH, textH) + 8;
  ensureSpace(ctx, height);
  const top = ctx.y;
  if (el.image) {
    drawImage(ctx, el.image, MARGIN, top - boxH, boxW, boxH);
  } else if (el.placeholderWhenNoImage) {
    drawRect(ctx, MARGIN, top - boxH, boxW, boxH, "stroke");
  }
  let y = top - (Math.max(boxH, textH) - textH) / 2;
  for (const line of lines) {
    const lh = lineHeight(line, 12);
    y -= lh;
    drawTextLine(ctx, textX, y + lh * 0.28, line, 12, true, "center", textW);
  }
  ctx.y = top - height;
}

interface MeasuredCell {
  cell: Cell;
  x: number;
  width: number;
  lines: TextRun[][];
  height: number;
}

function measureRow(row: TableRow, colWidths: number[], size: number): { cells: MeasuredCell[]; height: number } {
  const cells: MeasuredCell[] = [];
  let col = 0;
  let x = MARGIN;
  let height = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colSpan ?? 1);
    const width = colWidths.slice(col, col + span).reduce((a, b) => a + b, 0);
    const cellSize = cell.size ?? size;
    const runs = cell.runs ?? [{ text: cell.text ?? "", bold: cell.bold, size: cellSize }];
    const textWidth = width - CELL_PAD_X * 2 - (cell.checkbox !== undefined ? CHECKBOX_SIZE + 4 : 0);
    const lines = wrapRuns(runs, Math.max(10, textWidth), cellSize, cell.bold ?? false);
    const textH = lines.reduce((s, l) => s + lineHeight(l, cellSize), 0);
    const h = Math.max(textH + CELL_PAD_Y * 2, cell.minHeight ?? 0, cellSize * LEADING + CELL_PAD_Y * 2);
    cells.push({ cell, x, width, lines, height: h });
    height = Math.max(height, h);
    x += width;
    col += span;
  }
  return { cells, height };
}

function drawRow(ctx: Ctx, measured: { cells: MeasuredCell[]; height: number }, size: number, borders: boolean): void {
  const top = ctx.y;
  const h = measured.height;
  for (const mc of measured.cells) {
    if (mc.cell.shade) drawRect(ctx, mc.x, top - h, mc.width, h, "fill", 0.9);
    if (borders) drawRect(ctx, mc.x, top - h, mc.width, h, "stroke");
    const cellSize = mc.cell.size ?? size;
    let textX = mc.x + CELL_PAD_X;
    let textW = mc.width - CELL_PAD_X * 2;
    if (mc.cell.checkbox !== undefined) {
      drawCheckbox(ctx, textX, top - CELL_PAD_Y - CHECKBOX_SIZE - 1, mc.cell.checkbox);
      textX += CHECKBOX_SIZE + 4;
      textW -= CHECKBOX_SIZE + 4;
    }
    let y = top - CELL_PAD_Y;
    for (const line of mc.lines) {
      const lh = lineHeight(line, cellSize);
      y -= lh;
      drawTextLine(ctx, textX, y + lh * 0.28, line, cellSize, mc.cell.bold ?? false, mc.cell.align ?? "left", textW);
    }
  }
  ctx.y = top - h;
}

function renderTable(ctx: Ctx, el: TableElement): void {
  const size = el.size ?? DEFAULT_SIZE;
  const sum = el.columns.reduce((a, b) => a + b, 0) || 1;
  const colWidths = el.columns.map((f) => (f / sum) * CONTENT_WIDTH);
  const borders = el.borders ?? true;
  const headerRows = el.rows.filter((r) => r.header);
  const measuredHeader = headerRows.map((r) => measureRow(r, colWidths, size));
  // Header rows already drawn on the current page — a page break repeats
  // every header row once; a header row met again on the same page (its own
  // first appearance) is drawn exactly once.
  let drawnOnPage = new Set<TableRow>();
  for (const row of el.rows) {
    const measured = measureRow(row, colWidths, size);
    if (ctx.y - measured.height < BOTTOM) {
      newPage(ctx);
      drawnOnPage = new Set();
      if (!row.header) {
        headerRows.forEach((hr, i) => {
          drawRow(ctx, measuredHeader[i], size, borders);
          drawnOnPage.add(hr);
        });
      }
    }
    if (row.header && drawnOnPage.has(row)) continue;
    drawRow(ctx, measured, size, borders);
    if (row.header) drawnOnPage.add(row);
  }
  ctx.y -= el.spaceAfter ?? 8;
}

function renderSignatureLine(ctx: Ctx, el: SignatureLineElement): void {
  const height = (el.image ? 40 : 0) + 26 + (el.caption ? 12 : 0);
  ensureSpace(ctx, height);
  const size = DEFAULT_SIZE;
  const half = CONTENT_WIDTH / 2;
  let y = ctx.y;
  if (el.image) {
    drawImage(ctx, el.image, MARGIN + measureText(el.label + " ", true, size), y - 40, 140, 38);
    y -= 40;
  }
  y -= size * LEADING + 4;
  const labelW = measureText(el.label + " ", true, size);
  drawTextLine(ctx, MARGIN, y + 2, [{ text: el.label, bold: true, size }], size, true, "left", half);
  ctx.page.ops.push(`0.5 w 0 G ${fmt(MARGIN + labelW)} ${fmt(y)} m ${fmt(MARGIN + half - 12)} ${fmt(y)} l S`);
  if (el.dateLabel) {
    const dx = MARGIN + half;
    const dW = measureText(el.dateLabel + " ", true, size);
    drawTextLine(ctx, dx, y + 2, [{ text: el.dateLabel, bold: true, size }], size, true, "left", half);
    ctx.page.ops.push(`0.5 w 0 G ${fmt(dx + dW)} ${fmt(y)} m ${fmt(MARGIN + CONTENT_WIDTH)} ${fmt(y)} l S`);
  }
  if (el.caption) {
    y -= 11;
    drawTextLine(ctx, MARGIN, y, [{ text: el.caption, size: 7.5 }], 7.5, false, "left", CONTENT_WIDTH);
  }
  ctx.y = y - 8;
}

/* ---------------------------------------------------------------------- */
/* Document assembly                                                       */
/* ---------------------------------------------------------------------- */

export function renderLayoutPdf(doc: LayoutDocument): Buffer {
  const ctx: Ctx = { pages: [], page: { ops: [], images: new Map() }, y: TOP, imageIds: new Map() };
  newPage(ctx);

  for (const el of doc.elements) {
    switch (el.type) {
      case "paragraph":
        renderParagraph(ctx, el);
        break;
      case "heading":
        renderHeading(ctx, el);
        break;
      case "spacer":
        ensureSpace(ctx, el.height);
        ctx.y -= el.height;
        break;
      case "table":
        renderTable(ctx, el);
        break;
      case "header_block":
        renderHeaderBlock(ctx, el);
        break;
      case "signature_line":
        renderSignatureLine(ctx, el);
        break;
    }
  }

  // Page furniture: status marker (top right), footer (bottom left), page numbers (bottom right).
  const total = ctx.pages.length;
  ctx.pages.forEach((page, index) => {
    const furniture: string[] = [];
    const push = (x: number, y: number, text: string, align: Align, width: number, bold = false) => {
      const size = 7.5;
      const w = measureText(text, bold, size);
      const start = align === "right" ? x + width - w : x;
      furniture.push("BT", `${bold ? "/F2" : "/F1"} ${fmt(size)} Tf`, `0.35 g 1 0 0 1 ${fmt(start)} ${fmt(y)} Tm`, `(${encodeText(text)}) Tj`, "0 g", "ET");
    };
    if (doc.statusMarker) push(MARGIN, PAGE_HEIGHT - MARGIN / 2, doc.statusMarker, "right", CONTENT_WIDTH, true);
    if (doc.footerText) push(MARGIN, MARGIN / 2, doc.footerText, "left", CONTENT_WIDTH);
    push(MARGIN, MARGIN / 2, `Page ${index + 1} of ${total}`, "right", CONTENT_WIDTH);
    page.ops.push(...furniture);
  });

  return assemble(ctx, doc.title);
}

function assemble(ctx: Ctx, title?: string): Buffer {
  const objects: string[] = [];
  const binaryObjects = new Map<number, Buffer>();
  // 1 Catalog, 2 Pages, 3 F1, 4 F2, then images, then pages (page + contents).
  const imageObjectNumbers = new Map<string, number>();
  const allImages = new Map<string, JpegImage>();
  for (const page of ctx.pages) for (const [id, img] of page.images) allImages.set(id, img);

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("PAGES_PLACEHOLDER");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  for (const [id, img] of allImages) {
    const num = objects.length + 1;
    imageObjectNumbers.set(id, num);
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${img.pixelWidth} /Height ${img.pixelHeight} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`,
    );
    binaryObjects.set(num, img.jpeg);
  }

  const pageNumbers: number[] = [];
  for (const page of ctx.pages) {
    const pageNum = objects.length + 1;
    const contentsNum = pageNum + 1;
    pageNumbers.push(pageNum);
    const xobjects = [...page.images.keys()].map((id) => `/${id} ${imageObjectNumbers.get(id)} 0 R`).join(" ");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xobjects ? `/XObject << ${xobjects} >> ` : ""}>> /Contents ${contentsNum} 0 R >>`,
    );
    const stream = page.ops.join("\n");
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNumbers.length} >>`;

  let infoNum: number | null = null;
  if (title) {
    infoNum = objects.length + 1;
    objects.push(`<< /Title (${encodeText(title)}) >>`);
  }

  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (data: string | Buffer) => {
    const buf = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    chunks.push(buf);
    offset += buf.length;
  };
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const xref: number[] = [];
  objects.forEach((body, index) => {
    const num = index + 1;
    xref.push(offset);
    push(`${num} 0 obj\n${body}`);
    const bin = binaryObjects.get(num);
    if (bin) {
      push(bin);
      push("\nendstream");
    }
    push("\nendobj\n");
  });
  const xrefStart = offset;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of xref) table += `${o.toString().padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoNum ? ` /Info ${infoNum} 0 R` : ""} >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

/**
 * Test helper: every text-showing operand in content-stream order, decoded
 * from WinAnsi. Streams are never compressed by this renderer, so a plain
 * scan of `(...) Tj` is exact.
 */
export function extractPdfTextRuns(pdf: Buffer): string[] {
  const text = pdf.toString("latin1");
  const lines: string[] = [];
  // Every drawn line is one BT … ET block; its Tj literals concatenate to the line's text.
  const blockRe = /\bBT\b([\s\S]*?)\bET\b/g;
  const literalRe = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(text))) {
    let line = "";
    let m: RegExpExecArray | null;
    literalRe.lastIndex = 0;
    while ((m = literalRe.exec(block[1]))) {
      const literal = m[0].slice(1, m[0].lastIndexOf(")"));
      for (let i = 0; i < literal.length; i++) {
        const ch = literal[i];
        if (ch === "\\" && i + 1 < literal.length) {
          line += literal[++i];
          continue;
        }
        const code = ch.charCodeAt(0);
        const back = Object.entries(WINANSI_MAP).find(([, v]) => v === code);
        line += back && code >= 0x80 && code <= 0x9f ? back[0] : ch;
      }
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}
