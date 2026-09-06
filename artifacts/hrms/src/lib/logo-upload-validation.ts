/**
 * Client-side organization logo validation (WS-25 Organization Branding).
 *
 * Mirrors — never replaces — the server's contract in
 * artifacts/api-server/src/lib/imageProcessing.ts and
 * routes/organizationLogo.ts:
 *
 *   - PNG, JPEG or WebP only (SVG and everything else rejected);
 *   - 5 MB maximum;
 *   - the file's declared type must match its signature bytes;
 *   - the server then scales anything larger than 1024px on its longest
 *     side down (aspect ratio preserved, never cropped, never enlarged) and
 *     keeps the original format so transparency survives.
 *
 * The purpose of checking here is to give the person a precise message
 * before a round-trip; the server remains authoritative and re-validates
 * every upload.
 */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_MAX_DIMENSION = 1024;
export const LOGO_ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoMimeType = (typeof LOGO_ACCEPTED_MIME_TYPES)[number];
/** Value for `<input type="file" accept>` — the same allowlist as the server. */
export const LOGO_ACCEPT_ATTRIBUTE = LOGO_ACCEPTED_MIME_TYPES.join(',');
/** Human wording of the contract, shown next to the upload control. */
export const LOGO_REQUIREMENTS_TEXT = 'PNG, JPEG or WebP · up to 5 MB · larger images are scaled to 1024 px, never cropped';

export type LogoValidationResult = { ok: true; detectedType: LogoMimeType } | { ok: false; reason: string };

function isAcceptedType(value: string): value is LogoMimeType {
  return (LOGO_ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

/** Sniffs the same signatures the server checks (JPEG SOI, PNG header, RIFF/WEBP). */
export function detectImageTypeFromBytes(bytes: Uint8Array): LogoMimeType | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length > 12) {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readLeadingBytes(file: Blob, count: number): Promise<Uint8Array | null> {
  const head = file.slice(0, count);
  if (typeof head.arrayBuffer !== 'function') return null;
  try {
    return new Uint8Array(await head.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Validates a chosen file against the server's logo contract. Resolves with
 * a reason a person can act on; the caller decides how to show it.
 */
export async function validateLogoFile(file: File): Promise<LogoValidationResult> {
  if (file.size === 0) {
    return { ok: false, reason: 'The selected file is empty. Choose a PNG, JPEG or WebP image.' };
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      reason: `This file is ${formatFileSize(file.size)}. Logos must be 5 MB or smaller.`,
    };
  }
  const declared = (file.type || '').toLowerCase();
  if (declared === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    return { ok: false, reason: 'SVG files are not accepted. Export the logo as PNG (with transparency) or WebP.' };
  }
  if (!isAcceptedType(declared)) {
    return { ok: false, reason: 'Unsupported file type. Choose a PNG, JPEG or WebP image.' };
  }

  const bytes = await readLeadingBytes(file, 16);
  // If the browser cannot expose the bytes the server still validates them.
  if (bytes === null) return { ok: true, detectedType: declared };

  const detected = detectImageTypeFromBytes(bytes);
  if (!detected) {
    return { ok: false, reason: 'The file content is not a valid PNG, JPEG or WebP image.' };
  }
  if (detected !== declared) {
    return {
      ok: false,
      reason: 'The file extension does not match its content. Save the image again in its real format and retry.',
    };
  }
  return { ok: true, detectedType: detected };
}
