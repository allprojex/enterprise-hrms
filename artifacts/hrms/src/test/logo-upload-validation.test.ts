/**
 * WS-25 Organization Branding — client-side logo validation mirrors the
 * server contract (artifacts/api-server/src/lib/imageProcessing.ts): PNG /
 * JPEG / WebP by declared type AND signature, 5 MB cap, SVG refused.
 */
import { describe, it, expect } from 'vitest';
import {
  detectImageTypeFromBytes,
  formatFileSize,
  validateLogoFile,
  LOGO_ACCEPT_ATTRIBUTE,
  LOGO_MAX_BYTES,
} from '@/lib/logo-upload-validation';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56];

function file(bytes: number[] | Uint8Array, name: string, type: string, padTo = 0): File {
  const body = new Uint8Array(Math.max(bytes.length, padTo));
  body.set(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  return new File([body], name, { type });
}

describe('detectImageTypeFromBytes', () => {
  it('recognises the three accepted signatures and nothing else', () => {
    expect(detectImageTypeFromBytes(Uint8Array.from(PNG_HEADER))).toBe('image/png');
    expect(detectImageTypeFromBytes(Uint8Array.from(JPEG_HEADER))).toBe('image/jpeg');
    expect(detectImageTypeFromBytes(Uint8Array.from(WEBP_HEADER))).toBe('image/webp');
    expect(detectImageTypeFromBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageTypeFromBytes(new Uint8Array(0))).toBeNull();
  });
});

describe('validateLogoFile', () => {
  it('exposes the same allowlist the server enforces', () => {
    expect(LOGO_ACCEPT_ATTRIBUTE).toBe('image/png,image/jpeg,image/webp');
    expect(LOGO_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('accepts a PNG whose declared type matches its bytes', async () => {
    await expect(validateLogoFile(file(PNG_HEADER, 'logo.png', 'image/png'))).resolves.toEqual({
      ok: true,
      detectedType: 'image/png',
    });
  });

  it('accepts JPEG and WebP', async () => {
    expect((await validateLogoFile(file(JPEG_HEADER, 'logo.jpg', 'image/jpeg'))).ok).toBe(true);
    expect((await validateLogoFile(file(WEBP_HEADER, 'logo.webp', 'image/webp'))).ok).toBe(true);
  });

  it('rejects an empty file', async () => {
    const result = await validateLogoFile(new File([], 'empty.png', { type: 'image/png' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/i);
  });

  it('rejects a file over 5 MB with the size in the message', async () => {
    const result = await validateLogoFile(file(PNG_HEADER, 'big.png', 'image/png', LOGO_MAX_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/5 MB or smaller/);
  });

  it('rejects SVG by type and by extension', async () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const byType = await validateLogoFile(file(svgBytes, 'logo.svg', 'image/svg+xml'));
    expect(byType.ok).toBe(false);
    if (!byType.ok) expect(byType.reason).toMatch(/SVG/);
    const byExtension = await validateLogoFile(file(PNG_HEADER, 'logo.svg', ''));
    expect(byExtension.ok).toBe(false);
  });

  it('rejects an unsupported declared type', async () => {
    const result = await validateLogoFile(file(PNG_HEADER, 'logo.gif', 'image/gif'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unsupported file type/);
  });

  it('rejects a spoofed extension: PNG type declared but JPEG bytes inside', async () => {
    const result = await validateLogoFile(file(JPEG_HEADER, 'logo.png', 'image/png'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/does not match its content/);
  });

  it('rejects content that is not an image at all even with an image type', async () => {
    const result = await validateLogoFile(file(new TextEncoder().encode('hello world, not an image'), 'logo.png', 'image/png'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a valid PNG, JPEG or WebP/);
  });
});

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(20 * 1024)).toBe('20 KB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});
