/**
 * Unit tests for processLogoImage (WWM Readiness, Workstream 3) — no HTTP,
 * no database, pure image transformation via sharp.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processLogoImage } from "../lib/imageProcessing";

async function makePng(width: number, height: number, alpha = true): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: alpha ? 4 : 3, background: { r: 200, g: 150, b: 50, alpha: alpha ? 0.5 : 1 } },
  })
    .png()
    .toBuffer();
}

describe("processLogoImage", () => {
  it("preserves PNG format and transparency (never flattens onto a solid background)", async () => {
    const source = await makePng(200, 200);
    const result = await processLogoImage(source, "image/png");
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.hasAlpha).toBe(true);
  });

  it("preserves the original aspect ratio for a non-square emblem — never crops", async () => {
    const source = await makePng(300, 900);
    const result = await processLogoImage(source, "image/png");
    const metadata = await sharp(result).metadata();
    expect(metadata.width! / metadata.height!).toBeCloseTo(300 / 900, 2);
  });

  it("does not upscale or otherwise alter a source already under the size cap", async () => {
    const source = await makePng(100, 100);
    const result = await processLogoImage(source, "image/png");
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(100);
  });

  it("shrinks (fit: inside, never crops) a source larger than the 1024px cap on its long edge", async () => {
    const source = await makePng(2000, 1000);
    const result = await processLogoImage(source, "image/png");
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBeLessThanOrEqual(1024);
    expect(metadata.height).toBeLessThanOrEqual(1024);
    expect(metadata.width! / metadata.height!).toBeCloseTo(2, 1);
  });
});
