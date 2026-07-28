// Generalized upload validation for Employee Documents (Phase 2A, W23,
// Architecture Decision 4): same "sniff real bytes, don't just trust
// Content-Type" rigor as imageProcessing.ts's validateImageUpload, extended
// to non-image document types. Does not use sharp — that's image-specific
// re-encoding, out of scope for a general document upload.
export class InvalidDocumentError extends Error {}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB — larger than the 5MB avatar limit; documents (scans, contracts) run bigger.

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function isPdf(b: Buffer): boolean {
  return b.length > 4 && b.toString("ascii", 0, 5) === "%PDF-";
}

function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isPng(b: Buffer): boolean {
  return (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

// docx/xlsx are both ZIP containers (OOXML) — the signature alone can't tell
// them apart, so it only proves "this is really a ZIP", and the declared
// mimetype disambiguates docx vs xlsx from there.
function isZipContainer(b: Buffer): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
}

function matchesSignature(mimetype: string, buffer: Buffer): boolean {
  if (mimetype === "application/pdf") return isPdf(buffer);
  if (mimetype === "image/jpeg") return isJpeg(buffer);
  if (mimetype === "image/png") return isPng(buffer);
  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return isZipContainer(buffer);
  }
  return false;
}

/** Returns the storage file extension for an allowed, signature-verified upload. Throws InvalidDocumentError otherwise. */
export function validateDocumentUpload(file: { mimetype: string; size: number; buffer: Buffer }): string {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new InvalidDocumentError("File exceeds the 10MB size limit");
  }
  const extension = ALLOWED_MIME_TYPES[file.mimetype];
  if (!extension) {
    throw new InvalidDocumentError("Unsupported file type — PDF, JPEG, PNG, DOCX, and XLSX only");
  }
  if (!matchesSignature(file.mimetype, file.buffer)) {
    throw new InvalidDocumentError("File content does not match the declared file type");
  }
  return extension;
}
