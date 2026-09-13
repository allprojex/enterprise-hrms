/**
 * Unit tests for processAvatarImage — no HTTP, no database, pure image
 * transformation via sharp.
 *
 * These exist because the destructive behaviour they now forbid shipped
 * unnoticed: processAvatarImage used to `resize(512, 512, { fit: "cover" })`,
 * which crops to a centred square and permanently threw away the top of the
 * head and the shoulders of any portrait photograph before storage. The
 * original upload is never retained (lib/employeeProfilePicture.ts writes only
 * the processed bytes), so that loss was unrecoverable — and invisible to CSS,
 * because a square image in a square avatar box has no overflow for
 * `object-position` to act on.
 *
 * processLogoImage had exactly this coverage ("never crops") and processAvatarImage
 * had none, which is how the two diverged.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processAvatarImage } from "../lib/imageProcessing";

/** A portrait-shaped source with a distinctly coloured top band, so a crop of the top is detectable. */
async function makePortrait(width: number, height: number): Promise<Buffer> {
  const topBandHeight = Math.round(height * 0.1);
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 40, b: 200 } },
  })
    .composite([
      {
        input: {
          create: { width, height: topBandHeight, channels: 3, background: { r: 240, g: 10, b: 10 } },
        },
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

/**
 * Mean red channel of the image's topmost strip — high when the red band
 * survived. The strip is materialised to its own buffer first: sharp's
 * `.stats()` reports on the INPUT image and ignores queued operations, so
 * calling it straight after `.extract()` would measure the whole frame.
 */
async function topBandIsPresent(buffer: Buffer): Promise<boolean> {
  const { width, height } = await sharp(buffer).metadata();
  const stripHeight = Math.max(1, Math.round(height! * 0.05));
  const strip = await sharp(buffer)
    .extract({ left: 0, top: 0, width: width!, height: stripHeight })
    .toBuffer();
  const { channels } = await sharp(strip).stats();
  // channels[0] is red; the band is (240,10,10) and the body is (20,40,200).
  // The band is only the top 10% so a centred square crop removes it entirely.
  return channels[0].mean > 128;
}

describe("processAvatarImage", () => {
  it("preserves the aspect ratio of a portrait photograph — never crops to a square", async () => {
    const source = await makePortrait(600, 900);
    const result = await processAvatarImage(source);
    const metadata = await sharp(result).metadata();

    expect(metadata.width! / metadata.height!).toBeCloseTo(600 / 900, 2);
    // The regression this guards: a square output means the head was cropped away.
    expect(metadata.width).not.toBe(metadata.height);
  });

  it("keeps the top of the frame, where the head is in a head-and-shoulders portrait", async () => {
    const source = await makePortrait(600, 900);
    expect(await topBandIsPresent(source)).toBe(true);

    const result = await processAvatarImage(source);
    // A centre-crop to a square would have removed this band entirely.
    expect(await topBandIsPresent(result)).toBe(true);
  });

  it("shrinks a source larger than the 512px cap on its long edge, without cropping", async () => {
    const source = await makePortrait(1200, 1800);
    const result = await processAvatarImage(source);
    const metadata = await sharp(result).metadata();

    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(512);
    expect(metadata.width! / metadata.height!).toBeCloseTo(1200 / 1800, 2);
    expect(await topBandIsPresent(result)).toBe(true);
  });

  it("does not upscale a source already smaller than the cap", async () => {
    const source = await makePortrait(200, 300);
    const result = await processAvatarImage(source);
    const metadata = await sharp(result).metadata();

    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(300);
  });

  it("handles a landscape source without distortion", async () => {
    const source = await makePortrait(900, 600);
    const result = await processAvatarImage(source);
    const metadata = await sharp(result).metadata();

    expect(metadata.width! / metadata.height!).toBeCloseTo(900 / 600, 2);
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(512);
  });

  it("re-encodes as JPEG and strips EXIF metadata", async () => {
    const source = await makePortrait(400, 600);
    const result = await processAvatarImage(source);
    const metadata = await sharp(result).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
  });
});
