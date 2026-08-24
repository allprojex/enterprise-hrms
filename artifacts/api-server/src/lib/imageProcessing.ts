import sharp from "sharp";

export class InvalidImageError extends Error {}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_SIZE = 512;

const SIGNATURES: { mime: string; check: (buf: Buffer) => boolean }[] = [
  { mime: "image/jpeg", check: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    check: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: "image/webp",
    check: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  },
];

/** Sniffs the actual file-signature bytes — never trust the client-supplied Content-Type/extension alone. */
export function detectImageMimeFromSignature(buffer: Buffer): string | null {
  return SIGNATURES.find((s) => s.check(buffer))?.mime ?? null;
}

export function validateImageUpload(file: { mimetype: string; size: number; buffer: Buffer }): void {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new InvalidImageError("File exceeds the 5MB size limit");
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new InvalidImageError("Unsupported file type — JPEG, PNG, and WebP only");
  }
  const detected = detectImageMimeFromSignature(file.buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
    throw new InvalidImageError("File content does not match an allowed image type");
  }
}

/**
 * Resizes to a square avatar and re-encodes as JPEG. `.rotate()` with no
 * argument applies the EXIF orientation tag before sharp discards it —
 * sharp does not copy source metadata into its output unless
 * `.withMetadata()` is called, so this strips EXIF (GPS, camera info, etc.)
 * by default.
 */
export async function processAvatarImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toBuffer();
}

const LOGO_MAX_DIMENSION = 1024;

/**
 * Organization logo processing — deliberately different from
 * processAvatarImage: `fit: "inside"` (never crops, only shrinks an
 * oversized source, preserving the original aspect ratio) and no format
 * conversion (stays PNG/WebP/JPEG as uploaded, so a transparent-background
 * emblem stays transparent — forcing JPEG here would flatten it onto a
 * black background). `.rotate()` with no argument still applies EXIF
 * orientation then strips EXIF, matching processAvatarImage's own
 * precedent. A source already at or under the cap passes through with
 * only EXIF-stripping applied — no re-encode quality loss for the common
 * case of an already-reasonably-sized logo.
 */
export async function processLogoImage(buffer: Buffer, mimeType: string): Promise<Buffer> {
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const needsResize =
    (metadata.width ?? 0) > LOGO_MAX_DIMENSION || (metadata.height ?? 0) > LOGO_MAX_DIMENSION;
  const resized = needsResize
    ? image.resize(LOGO_MAX_DIMENSION, LOGO_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
    : image;

  if (mimeType === "image/png") return resized.png().toBuffer();
  if (mimeType === "image/webp") return resized.webp().toBuffer();
  return resized.jpeg({ quality: 90 }).toBuffer();
}
