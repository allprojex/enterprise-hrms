/**
 * WS-26 — from a template definition (+ a revision's values) to a printed
 * document.
 *
 * `buildLayoutDocument` is pure: definition, answers, autofill, computed,
 * organization identity and a document kind in; a LayoutDocument out. The
 * official form body is built from the definition alone, in definition
 * order, with no added or reworded content — the fidelity tests compare its
 * text stream to the docx fixtures. System information (status marker, page
 * footer, the Approval & Signature Certificate appendix) is placed OUTSIDE
 * the authoritative body: in the page margin, or on pages after it.
 *
 * `renderSubmissionDocument` and `renderBlankDocument` load what they need
 * (scoped by organization) and hand the result to the structured renderer.
 */
import { eq, and, isNull, asc, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, organizationsTable, formSignaturesTable, usersTable } from "@workspace/db";
import { readOrgFile } from "../fileStorage";
import { renderLayoutPdf, type LayoutDocument, type LayoutElement, type TableRow, type Cell, type JpegImage } from "../pdf/layoutRenderer";
import type { FormDefinition, FormItem, FormSection, ChoiceGroupItem, MatrixItem, RatedTableItem, TableItem, FieldItem } from "./definition";
import type { Answers, ComputedValues } from "./answers";
import type { AutofillSnapshot } from "./bindings";

export type DocumentKind = "blank" | "draft" | "submitted" | "returned" | "rejected" | "approved" | "final";

export interface HistoryLine {
  step: string;
  stage: string;
  actor: string;
  at: Date;
  notes: string;
}

/** WS-26B: an applied signature drawn on the certificate appendix (image + provenance). */
export interface SignatureCertLine {
  slotKey: string;
  slotLabel: string;
  signer: string;
  capacity: string;
  method: string;
  at: Date;
  sha256: string;
  image: JpegImage | null;
}

export interface BuildInput {
  definition: FormDefinition;
  kind: DocumentKind;
  answers: Answers;
  autofill: AutofillSnapshot;
  computed: ComputedValues;
  organizationName: string;
  logo: JpegImage | null;
  templateTitle: string;
  versionNumber: number;
  definitionSha256: string;
  submissionId?: number | null;
  revisionNumber?: number | null;
  history?: HistoryLine[];
  signatures?: SignatureCertLine[];
}

const STATUS_MARKER: Record<DocumentKind, string | undefined> = {
  blank: undefined,
  draft: "DRAFT — NOT SUBMITTED",
  submitted: "SUBMITTED — PENDING APPROVAL",
  returned: "RETURNED FOR CORRECTION",
  rejected: "REJECTED",
  approved: "APPROVED — AWAITING FINALIZATION",
  final: "FINAL — APPROVED",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function valueOf(item: FieldItem, answers: Answers, autofill: AutofillSnapshot): string {
  const raw = item.binding?.mode === "readonly" ? autofill[item.key] : (answers[item.key] ?? autofill[item.key]);
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (Array.isArray(raw)) return raw.map((v) => item.options?.find((o) => o.value === v)?.label ?? String(v)).join(", ");
  if (item.options) return item.options.find((o) => o.value === raw)?.label ?? String(raw);
  return String(raw);
}

function labelCell(label: string, value: string, opts: { minHeight?: number } = {}): Cell {
  const runs = label ? [{ text: value ? `${label}: ` : `${label}: `, bold: false }, { text: value, bold: true }] : [{ text: value, bold: true }];
  return { runs, minHeight: opts.minHeight };
}

function headerRow(title: string, span: number): TableRow {
  return { cells: [{ text: title, bold: true, shade: true, colSpan: span }] };
}

function gridRows(items: FormItem[], answers: Answers, autofill: AutofillSnapshot, computed: ComputedValues, kind: DocumentKind): { rows: TableRow[]; columns: number } {
  // Lay fields out in rows of up to 6 slots (full=6, half=3, third=2).
  const rows: TableRow[] = [];
  let current: Cell[] = [];
  let used = 0;
  const flush = () => {
    if (current.length === 0) return;
    if (used < 6) current[current.length - 1] = { ...current[current.length - 1], colSpan: (current[current.length - 1].colSpan ?? 1) + (6 - used) };
    rows.push({ cells: current });
    current = [];
    used = 0;
  };
  for (const item of items) {
    if (item.kind === "field") {
      const span = item.width === "third" ? 2 : item.width === "half" ? 3 : 6;
      if (used + span > 6) flush();
      const cell = labelCell(item.label, valueOf(item, answers, autofill), { minHeight: item.type === "long_text" ? 36 : 18 });
      current.push({ ...cell, colSpan: span });
      if (item.helpText) current[current.length - 1] = { ...current[current.length - 1], runs: [...(current[current.length - 1].runs ?? []), { text: `\n${item.helpText}` }] };
      used += span;
      if (used >= 6) flush();
      continue;
    }
    flush();
    rows.push(...itemRows(item, answers, autofill, computed, kind, 6));
  }
  flush();
  return { rows, columns: 6 };
}

function choiceRows(item: ChoiceGroupItem, answers: Answers, span: number): TableRow[] {
  const selected = answers[item.key];
  const isSelected = (value: string) => (Array.isArray(selected) ? selected.includes(value) : selected === value);
  const perRow = Math.max(1, Math.min(item.columns ?? 3, span));
  const rows: TableRow[] = [];
  if (item.label) rows.push({ cells: [{ text: item.label, bold: true, colSpan: span }] });
  for (let i = 0; i < item.options.length; i += perRow) {
    const slice = item.options.slice(i, i + perRow);
    const cells: Cell[] = slice.map((o) => ({ text: o.label, checkbox: isSelected(o.value) ? true : null, colSpan: Math.floor(span / perRow) }));
    const usedSpan = cells.reduce((s, c) => s + (c.colSpan ?? 1), 0);
    if (usedSpan < span) cells[cells.length - 1] = { ...cells[cells.length - 1], colSpan: (cells[cells.length - 1].colSpan ?? 1) + (span - usedSpan) };
    rows.push({ cells });
  }
  if (item.otherField) {
    const other = answers[item.otherField.key];
    rows.push({ cells: [{ ...labelCell(item.otherField.label, typeof other === "string" ? other : ""), colSpan: span }] });
  }
  return rows;
}

function matrixRows(item: MatrixItem, answers: Answers, computed: ComputedValues, span: number): TableRow[] {
  const values = isPlainObject(answers[item.key]) ? (answers[item.key] as Record<string, unknown>) : {};
  const rows: TableRow[] = [];
  const n = item.columns.length;
  const ratingSpan = Math.max(1, span - 1);
  if (item.label) rows.push({ cells: [{ text: item.label, bold: true, colSpan: span }] });
  if (item.scaleText) rows.push({ cells: [{ text: item.scaleText, colSpan: span }] });
  const header = (): TableRow[] => {
    const out: TableRow[] = [];
    if (item.ratingHeader) out.push({ cells: [{ text: item.criteriaHeader ?? "", bold: true }, { text: item.ratingHeader, bold: true, align: "center", colSpan: ratingSpan }], header: true });
    out.push({
      cells: [
        { text: item.ratingHeader ? "" : (item.criteriaHeader ?? ""), bold: true },
        ...item.columns.map((c, i) => ({ text: c.label, bold: true, align: "center" as const, colSpan: i === n - 1 ? ratingSpan - (n - 1) : 1 })),
      ],
      header: true,
    });
    return out;
  };
  rows.push(...header());
  for (const row of item.rows) {
    if (row.repeatHeaderBefore) rows.push(...header().map((r) => ({ ...r, header: false })));
    const v = values[row.key];
    const rated = row.rated !== false;
    rows.push({
      cells: [
        { text: row.label, minHeight: rated ? 18 : 30 },
        ...item.columns.map((c, i) => ({ checkbox: rated ? (v === c.value ? true : null) : undefined, text: "", align: "center" as const, colSpan: i === n - 1 ? ratingSpan - (n - 1) : 1 })),
      ],
    });
  }
  if (item.total) {
    const t = computed[item.total.key];
    rows.push({ cells: [{ text: item.total.label, bold: true }, { text: t == null ? "" : String(t), bold: true, align: "center", colSpan: ratingSpan }] });
  }
  return rows;
}

function ratedTableRows(item: RatedTableItem, answers: Answers, computed: ComputedValues, span: number): TableRow[] {
  const values = isPlainObject(answers[item.key]) ? (answers[item.key] as Record<string, Record<string, unknown>>) : {};
  const rows: TableRow[] = [];
  const textCols = item.textColumns.length;
  const n = item.ratingColumns.length;
  const ratingSpan = Math.max(n, span - textCols);
  if (item.label) rows.push({ cells: [{ text: item.label, bold: true, colSpan: span }] });
  rows.push({
    cells: [...item.textColumns.map((c) => ({ text: c.label, bold: true })), { text: item.ratingHeader, bold: true, align: "center" as const, colSpan: ratingSpan }],
    header: true,
  });
  rows.push({
    cells: [
      ...item.textColumns.map(() => ({ text: "" })),
      ...item.ratingColumns.map((c, i) => ({ text: c.label, bold: true, align: "center" as const, colSpan: i === n - 1 ? ratingSpan - (n - 1) : 1 })),
    ],
    header: true,
  });
  for (const row of item.rows) {
    const v = values[row.key] ?? {};
    const rating = v.rating;
    const extraLines = item.printedLinesPerRow ?? 0;
    rows.push({
      cells: [
        ...item.textColumns.map((c, ci) => ({
          runs: ci === 0 ? [{ text: row.label, bold: true }, { text: v[c.key] ? `\n${String(v[c.key])}` : "" }] : [{ text: v[c.key] ? String(v[c.key]) : "" }],
          minHeight: 18 + extraLines * 13,
        })),
        ...item.ratingColumns.map((c, i) => ({ checkbox: rating === c.value ? true : null, text: "", align: "center" as const, colSpan: i === n - 1 ? ratingSpan - (n - 1) : 1 })),
      ],
    });
  }
  if (item.total) {
    const t = computed[item.total.key];
    rows.push({ cells: [{ text: item.total.label, bold: true, colSpan: textCols }, { text: t == null ? "" : String(t), bold: true, align: "center", colSpan: ratingSpan }] });
  }
  return rows;
}

function tableRows(item: TableItem, answers: Answers, span: number): TableRow[] {
  const data = Array.isArray(answers[item.key]) ? (answers[item.key] as Record<string, string>[]) : [];
  const cols = item.columns.length;
  const per = Math.max(1, Math.floor(span / cols));
  const spanFor = (i: number) => (i === cols - 1 ? span - per * (cols - 1) : per);
  const rows: TableRow[] = [];
  if (item.label) rows.push({ cells: [{ text: item.label, bold: true, colSpan: span }] });
  rows.push({ cells: item.columns.map((c, i) => ({ text: c.label, bold: true, colSpan: spanFor(i) })), header: true });
  const count = Math.max(data.length, item.printedRows ?? 0);
  for (let r = 0; r < count; r++) {
    const row = data[r] ?? {};
    rows.push({ cells: item.columns.map((c, i) => ({ text: row[c.key] ?? "", colSpan: spanFor(i), minHeight: 18 })) });
  }
  return rows;
}

function itemRows(item: FormItem, answers: Answers, autofill: AutofillSnapshot, computed: ComputedValues, kind: DocumentKind, span: number): TableRow[] {
  switch (item.kind) {
    case "field": {
      const cell = labelCell(item.label, valueOf(item, answers, autofill), { minHeight: item.type === "long_text" ? 40 : 18 });
      if (item.helpText) cell.runs = [...(cell.runs ?? []), { text: `\n${item.helpText}` }];
      return [{ cells: [{ ...cell, colSpan: span }] }];
    }
    case "choice_group":
      return choiceRows(item, answers, span);
    case "matrix":
      return matrixRows(item, answers, computed, span);
    case "rated_table":
      return ratedTableRows(item, answers, computed, span);
    case "table":
      return tableRows(item, answers, span);
    case "note":
      return [{ cells: [{ text: item.text, bold: item.style === "note", colSpan: span }] }];
    case "signature": {
      const half = Math.floor(span / 2);
      const cells: Cell[] = [{ text: `${item.label}: `, minHeight: 30, colSpan: item.dateLabel ? half : span }];
      if (item.dateLabel) cells.push({ text: `${item.dateLabel}: `, minHeight: 30, colSpan: span - half });
      return [{ cells }];
    }
    case "computed": {
      const t = computed[item.key];
      return [{ cells: [{ text: item.label, bold: true, colSpan: span - 1 }, { text: t == null ? "" : String(t), bold: true, align: "center" }] }];
    }
  }
}

function keyValueRows(items: FormItem[], answers: Answers, autofill: AutofillSnapshot, computed: ComputedValues, kind: DocumentKind): TableRow[] {
  const rows: TableRow[] = [];
  for (const item of items) {
    if (item.kind === "field") {
      const labelRuns = item.helpText ? [{ text: item.label }, { text: `\n${item.helpText}` }] : [{ text: item.label }];
      rows.push({ cells: [{ runs: labelRuns, colSpan: 2 }, { text: valueOf(item, answers, autofill), bold: true, colSpan: 4, minHeight: item.type === "long_text" ? 36 : 18 }] });
      continue;
    }
    rows.push(...itemRows(item, answers, autofill, computed, kind, 6));
  }
  return rows;
}

function sectionElement(section: FormSection, input: BuildInput): LayoutElement {
  const { answers, autofill, computed, kind } = input;
  const rows: TableRow[] = [];
  if (section.title) rows.push(headerRow(section.title, 6));
  if (section.layout === "key_value") rows.push(...keyValueRows(section.items, answers, autofill, computed, kind));
  else if (section.layout === "grid") rows.push(...gridRows(section.items, answers, autofill, computed, kind).rows);
  else for (const item of section.items) rows.push(...itemRows(item, answers, autofill, computed, kind, 6));
  return { type: "table", columns: [1, 1, 1, 1, 1, 1], rows };
}

/** Pure: the official body in definition order, then the appendix outside it. */
export function buildLayoutDocument(input: BuildInput): LayoutDocument {
  const { definition } = input;
  const elements: LayoutElement[] = [];
  elements.push({
    type: "header_block",
    image: definition.header.logo === "organization" ? input.logo : null,
    lines: definition.header.lines.map((text, i) => ({ text, bold: true, size: i === 0 ? 13 : 11 })),
  });
  for (const line of definition.intro ?? []) elements.push({ type: "paragraph", runs: [{ text: line }], spaceAfter: 6 });
  for (const section of definition.sections) {
    const el = sectionElement(section, input);
    // A section whose only content is a heading paragraph on the official page
    // (evaluation form section titles) still renders as a shaded header row —
    // same text, same order.
    elements.push(el);
  }
  for (const note of definition.footerNotes ?? []) {
    elements.push({ type: "table", columns: [1], rows: [{ cells: [{ text: note, bold: true }] }] });
  }

  if (input.kind !== "blank" && input.kind !== "draft" && input.history && input.history.length > 0) {
    elements.push({ type: "spacer", height: 24 });
    elements.push({ type: "heading", text: "Approval & Signature Certificate", size: 12 });
    elements.push({
      type: "paragraph",
      runs: [
        {
          text: "System-generated record of the workflow applied to the form above. The form pages are reproduced exactly as issued by the organization; this certificate is appended outside them.",
        },
      ],
      size: 8.5,
    });
    const rows: TableRow[] = [
      { cells: [{ text: "Step", bold: true }, { text: "Stage", bold: true }, { text: "By", bold: true }, { text: "Date / time (UTC)", bold: true }, { text: "Notes", bold: true }], header: true },
      ...input.history.map((h) => ({
        cells: [{ text: h.step.replace(/_/g, " ") }, { text: h.stage }, { text: h.actor }, { text: h.at.toISOString().replace("T", " ").slice(0, 19) }, { text: h.notes }],
      })),
    ];
    elements.push({ type: "table", columns: [1.2, 1.6, 1.6, 1.4, 2.2], rows, size: 8.5 });
    elements.push({
      type: "paragraph",
      size: 8,
      runs: [
        {
          text: `Reference: submission ${input.submissionId ?? "—"}, revision ${input.revisionNumber ?? "—"}, template "${input.templateTitle}" version ${input.versionNumber}, definition ${input.definitionSha256.slice(0, 16)}…`,
        },
      ],
    });
  }

  // WS-26B — applied signatures on the certificate appendix. For source forms
  // with no signature lines (e.g. Staff Evaluation, Probationary Assessment)
  // the electronic signatures appear here, outside the authoritative body; for
  // forms with signature slots the body already carries their placement.
  if (input.kind !== "blank" && input.kind !== "draft" && input.signatures && input.signatures.length > 0) {
    elements.push({ type: "spacer", height: 14 });
    elements.push({ type: "heading", text: "Electronic Signatures", size: 11 });
    elements.push({
      type: "paragraph",
      size: 8,
      runs: [
        {
          text:
            "Each signature below was applied by an authorized signer through an explicit action. Identity is established by the signing session, intent by that action, and integrity by the SHA-256 of the signature image. This is not a claim of any particular legal standing.",
        },
      ],
    });
    for (const s of input.signatures) {
      elements.push({
        type: "signature_line",
        label: s.slotLabel,
        image: s.image,
        caption: `${s.signer} — ${s.capacity} — ${s.method} — ${s.at.toISOString().replace("T", " ").slice(0, 19)} UTC — SHA-256 ${s.sha256.slice(0, 16)}…`,
      });
    }
  }

  const footerParts = [input.organizationName, `${input.templateTitle} v${input.versionNumber}`];
  if (input.submissionId) footerParts.push(`Submission #${input.submissionId}`);
  if (input.revisionNumber) footerParts.push(`Revision ${input.revisionNumber}`);
  return {
    title: `${input.templateTitle}${input.submissionId ? ` #${input.submissionId}` : ""}`,
    statusMarker: STATUS_MARKER[input.kind],
    footerText: footerParts.join(" · "),
    elements,
  };
}

/** The governed organization logo as baseline JPEG for embedding; null when absent or unreadable (neutral header). */
export async function loadOrganizationLogo(organizationId: number): Promise<{ name: string; logo: JpegImage | null }> {
  const [org] = await db.select({ name: organizationsTable.name, logoUrl: organizationsTable.logoUrl }).from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  if (!org) return { name: "", logo: null };
  if (!org.logoUrl) return { name: org.name, logo: null };
  const match = /^\/api\/organizations\/(\d+)\/logo\/([a-f0-9]{48}\.(?:png|webp|jpg))$/.exec(org.logoUrl);
  if (!match || Number(match[1]) !== organizationId) return { name: org.name, logo: null };
  try {
    const bytes = await readOrgFile(organizationId, `branding/${match[2]}`);
    const { data, info } = await sharp(bytes)
      .flatten({ background: "#ffffff" })
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    return { name: org.name, logo: { jpeg: data, pixelWidth: info.width, pixelHeight: info.height } };
  } catch {
    return { name: org.name, logo: null };
  }
}

/** Renders a submission (current or given revision) as the requested kind. */
/** WS-26B: the active (non-revoked) applied signatures for the certificate, with embeddable images. */
async function loadAppliedSignatures(organizationId: number, submissionId: number, definition: FormDefinition): Promise<SignatureCertLine[]> {
  const rows = await db
    .select()
    .from(formSignaturesTable)
    .where(and(eq(formSignaturesTable.organizationId, organizationId), eq(formSignaturesTable.submissionId, submissionId), isNull(formSignaturesTable.revokedAt)))
    .orderBy(asc(formSignaturesTable.stageOrder), asc(formSignaturesTable.signedAt));
  if (rows.length === 0) return [];
  const labels = new Map<string, string>();
  for (const section of definition.sections) for (const item of section.items) if (item.kind === "signature") labels.set(item.key, item.label);
  const signerIds = [...new Set(rows.map((r) => r.signerUserId))];
  const users = await db.select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName }).from(usersTable).where(inArray(usersTable.id, signerIds));
  const names = new Map(users.map((u) => [u.id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || `User ${u.id}`]));
  const out: SignatureCertLine[] = [];
  for (const r of rows) {
    let image: JpegImage | null = null;
    try {
      const bytes = await readOrgFile(organizationId, r.storageKey);
      const { data, info } = await sharp(bytes).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
      image = { jpeg: data, pixelWidth: info.width, pixelHeight: info.height };
    } catch {
      image = null; // a missing image never blocks the certificate; provenance still prints
    }
    out.push({
      slotKey: r.slotKey,
      slotLabel: labels.get(r.slotKey) ?? r.slotKey,
      signer: names.get(r.signerUserId) ?? `User ${r.signerUserId}`,
      capacity: r.authority,
      method: r.method,
      at: r.signedAt,
      sha256: r.sha256,
      image,
    });
  }
  return out;
}

export async function renderSubmissionDocument(params: { organizationId: number; submissionId: number; kind: DocumentKind; revisionId?: number | null }): Promise<Buffer> {
  // Imported lazily to avoid a module cycle with submissions.ts.
  const submissions = await import("./submissions");
  const templates = await import("./templates");
  const submission = await submissions.getSubmission(params.organizationId, params.submissionId);
  if (!submission) throw new submissions.FormSubmissionNotFoundError();
  const template = await templates.getTemplate(params.organizationId, submission.templateId);
  const version = await templates.getVersion(params.organizationId, submission.templateVersionId);
  if (!template || !version) throw new submissions.FormSubmissionNotFoundError();
  const revisionId = params.revisionId ?? submission.currentRevisionId;
  const revision = revisionId ? await submissions.getRevision(params.organizationId, revisionId) : null;
  if (revision && revision.submissionId !== submission.id) throw new submissions.FormSubmissionNotFoundError();
  const { name, logo } = await loadOrganizationLogo(params.organizationId);
  const history = await submissions.historyForCertificate(params.organizationId, submission.id);
  const definition = templates.parseDefinition(version);
  const signatures = await loadAppliedSignatures(params.organizationId, submission.id, definition);
  const doc = buildLayoutDocument({
    definition,
    kind: params.kind,
    answers: (revision?.answers as Answers) ?? {},
    autofill: (revision?.autofillSnapshot as AutofillSnapshot) ?? {},
    computed: (revision?.computed as ComputedValues) ?? {},
    organizationName: name,
    logo,
    templateTitle: template.title,
    versionNumber: version.versionNumber,
    definitionSha256: version.definitionSha256,
    submissionId: submission.id,
    revisionNumber: revision?.revisionNumber ?? null,
    history,
    signatures,
  });
  return renderLayoutPdf(doc);
}

/** The blank official form for a template version. */
export async function renderBlankDocument(params: { organizationId: number; versionId: number }): Promise<Buffer> {
  const templates = await import("./templates");
  const version = await templates.getVersion(params.organizationId, params.versionId);
  if (!version) throw new templates.FormVersionNotFoundError();
  const template = await templates.getTemplate(params.organizationId, version.templateId);
  if (!template) throw new templates.FormTemplateNotFoundError();
  const { name, logo } = await loadOrganizationLogo(params.organizationId);
  const doc = buildLayoutDocument({
    definition: templates.parseDefinition(version),
    kind: "blank",
    answers: {},
    autofill: {},
    computed: {},
    organizationName: name,
    logo,
    templateTitle: template.title,
    versionNumber: version.versionNumber,
    definitionSha256: version.definitionSha256,
  });
  return renderLayoutPdf(doc);
}

/** Which document kind a submission's state maps to for a "current state" download. */
export function documentKindForStatus(status: string): DocumentKind {
  switch (status) {
    case "draft":
      return "draft";
    case "returned":
      return "returned";
    case "rejected":
      return "rejected";
    case "approved":
      return "approved";
    case "finalized":
    case "archived":
      return "final";
    default:
      return "submitted";
  }
}
