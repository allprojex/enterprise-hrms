import sharp from "sharp";

export class InvalidImageError extends Error {}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Long-edge cap for a stored avatar. Not a crop box: the image keeps its own
// aspect ratio and is only shrunk if it exceeds this on either edge, so a
// portrait photograph stays a portrait photograph.
const AVATAR_MAX_DIMENSION = 512;

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
  // WS-25 Organization Branding: the declared type must also AGREE with the
  // signature. Before this, a JPEG declared as image/png passed both checks
  // independently and was silently re-encoded under the declared type; a
  // spoofed extension/Content-Type is now rejected outright, so the stored
  // object's format is always the one the bytes actually carry.
  if (detected !== file.mimetype) {
    throw new InvalidImageError("File content does not match its declared image type");
  }
}

/**
 * Bounds an avatar to a sensible stored size and re-encodes as JPEG.
 * `.rotate()` with no argument applies the EXIF orientation tag before sharp
 * discards it — sharp does not copy source metadata into its output unless
 * `.withMetadata()` is called, so this strips EXIF (GPS, camera info, etc.)
 * by default.
 *
 * `fit: "inside"` (never crops, only shrinks an oversized source, preserving
 * the original aspect ratio), matching processLogoImage's own precedent.
 *
 * This deliberately replaced `resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "inside", withoutEnlargement: true })`.
 * That variant discarded pixels permanently at upload: sharp's "cover" crops to
 * the requested box around `position` (default `centre`), so a normal portrait
 * photograph — where the head sits in the upper part of the frame — had the top
 * of the head and the shoulders cut away before anything was ever stored. The
 * original upload buffer is not retained anywhere (see
 * lib/employeeProfilePicture.ts: only the processed bytes are written), so that
 * crop was unrecoverable, and no amount of CSS could put the head back: a square
 * stored image inside a square avatar box has no overflow for `object-position`
 * to act on.
 *
 * Framing is now a RENDERING decision, made per context by the circular avatar
 * (see components/ui/avatar.tsx), where it can differ between a 96px profile
 * header and a 32px list row and can be changed later without a re-upload.
 * Storage keeps the whole photograph.
 *
 * NOTE FOR EXISTING PICTURES: avatars uploaded before this change are already
 * stored square-cropped. They are not rewritten (that would be a destructive
 * migration of customer data); those employees must simply re-upload to get the
 * full composition.
 */
export async function processAvatarImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize(AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION, { fit: "inside", withoutEnlargement: true })
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
