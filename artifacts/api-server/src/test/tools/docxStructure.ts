/**
 * WS-26 fidelity fixtures — extracts the ordered block structure of a .docx
 * (paragraphs and tables with their rows and cells) from word/document.xml,
 * dependency-free (a minimal ZIP central-directory reader + zlib).
 *
 * The output is the authority the fidelity tests compare a template
 * definition against: text in document order AND the table/row/cell shape,
 * so a label rendered in the wrong section or column fails even though the
 * string exists somewhere.
 *
 * Regenerate a fixture from the owner's official file with:
 *   npx tsx src/test/tools/docxStructure.ts <file.docx> > src/test/fixtures/wwm-forms/<name>.structure.json
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export type DocxBlock = { type: "paragraph"; text: string } | { type: "table"; rows: string[][] };

export interface DocxStructure {
  blocks: DocxBlock[];
}

function readZipEntry(buf: Buffer, wanted: string): Buffer {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip file");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const localOffset = buf.readUInt32LE(p + 42);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    if (name === wanted) {
      const lnameLen = buf.readUInt16LE(localOffset + 26);
      const lextraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lnameLen + lextraLen;
      const data = buf.subarray(start, start + compSize);
      return method === 8 ? inflateRawSync(data) : Buffer.from(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip entry not found: ${wanted}`);
}

/** Text of one paragraph's XML: runs, tabs, breaks, symbol checkboxes. */
function paragraphText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<w14:checked w14:val="1"\/>/g, "[x]")
    .replace(/<w14:checked w14:val="0"\/>/g, "[ ]")
    .replace(/<w:sym[^>]*w:char="F0FE"[^>]*\/>/g, "[x]")
    .replace(/<w:sym[^>]*\/>/g, "[ ]")
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t ]+/g, " ")
    .trim();
}

function parseTable(body: string, start: number): { end: number; rows: string[][] } {
  let depth = 0;
  let end = start;
  const re = /<w:tbl>|<\/w:tbl>/g;
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    depth += m[0] === "<w:tbl>" ? 1 : -1;
    if (depth === 0) {
      end = m.index + m[0].length;
      break;
    }
  }
  const tbl = body.slice(start, end);
  const rows: string[][] = [];
  const rowRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(tbl))) {
    const cells: string[] = [];
    const cellRe = /<w:tc>[\s\S]*?<\/w:tc>/g;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(r[0]))) {
      const paras = [...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((x) => paragraphText(x[0])).filter(Boolean);
      cells.push(paras.join(" ¶ "));
    }
    rows.push(cells);
  }
  return { end, rows };
}

export function extractDocxStructure(docx: Buffer): DocxStructure {
  const xml = readZipEntry(docx, "word/document.xml").toString("utf8");
  const body = xml.slice(xml.indexOf("<w:body>"), xml.lastIndexOf("</w:body>"));
  const blocks: DocxBlock[] = [];
  let i = 0;
  const next = (from: number): number => {
    const candidates = [body.indexOf("<w:tbl>", from), body.indexOf("<w:p ", from), body.indexOf("<w:p>", from)].filter((x) => x >= 0);
    return candidates.length ? Math.min(...candidates) : -1;
  };
  while (i < body.length) {
    const at = next(i);
    if (at < 0) break;
    if (body.startsWith("<w:tbl>", at)) {
      const { end, rows } = parseTable(body, at);
      blocks.push({ type: "table", rows });
      i = end;
    } else {
      const end = body.indexOf("</w:p>", at);
      if (end < 0) break;
      const text = paragraphText(body.slice(at, end + 6));
      if (text) blocks.push({ type: "paragraph", text });
      i = end + 6;
    }
  }
  return { blocks };
}

/** Normalises a cell/paragraph for comparison: collapse whitespace, drop underscore fill lines and trailing colons. */
export function normalizeDocxText(text: string): string {
  return text
    .replace(/_{2,}/g, "")
    .replace(/\[ \]|\[x\]|[☐☒□■]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*$/, "")
    .trim()
    .replace(/[:\s]+$/, "")
    .toLowerCase();
}

if (process.argv[1] && /docxStructure\.ts$/.test(process.argv[1]) && process.argv[2]) {
  const structure = extractDocxStructure(readFileSync(process.argv[2]));
  process.stdout.write(JSON.stringify(structure, null, 2) + "\n");
}
