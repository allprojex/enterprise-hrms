/**
 * WS-26B — the signature capture provider/adapter contract.
 *
 * Pins the separation the task requires: browser pointer capture and upload are
 * always offerable; the external-device adapters are interface SHELLS that stay
 * unavailable (no universal hardware compatibility is claimed) until a concrete
 * adapter is installed; and a slot's permitted methods filter what is offered.
 */
import { describe, it, expect } from "vitest";
import {
  createDefaultSignatureRegistry,
  canvasPointerProvider,
  uploadProvider,
  webHidDeviceProvider,
  webSerialDeviceProvider,
  vendorSdkDeviceProvider,
  SignatureCaptureUnsupportedError,
  SignatureProviderRegistry,
} from "@/components/signature/signature-providers";

describe("signature providers — the adapter contract", () => {
  it("registers canvas, upload and the three device shells", () => {
    const r = createDefaultSignatureRegistry();
    expect(r.all().map((p) => p.id).sort()).toEqual(["canvas", "upload", "vendor-sdk", "webhid", "webserial"]);
  });

  it("offers browser pointer capture for a drawn slot", async () => {
    const r = createDefaultSignatureRegistry();
    const available = await r.available(["drawn"]);
    expect(available.map((p) => p.id)).toEqual(["canvas"]);
    expect(await canvasPointerProvider.isAvailable()).toBe(true);
  });

  it("offers upload for an uploaded slot", async () => {
    const r = createDefaultSignatureRegistry();
    const available = await r.available(["uploaded"]);
    expect(available.map((p) => p.id)).toEqual(["upload"]);
    expect(await uploadProvider.isAvailable()).toBe(true);
  });

  it("offers NO device provider until a concrete adapter is installed", async () => {
    const r = createDefaultSignatureRegistry();
    expect(await r.available(["device"])).toEqual([]);
    expect(await webHidDeviceProvider.isAvailable()).toBe(false);
    expect(await webSerialDeviceProvider.isAvailable()).toBe(false);
    expect(await vendorSdkDeviceProvider.isAvailable()).toBe(false);
  });

  it("filters offered providers by the slot's permitted methods", async () => {
    const r = createDefaultSignatureRegistry();
    const available = await r.available(["drawn", "uploaded", "device"]);
    // device stays off; only the two browser paths are offered.
    expect(available.map((p) => p.id).sort()).toEqual(["canvas", "upload"]);
  });

  it("device shells reject capture() — the core never fakes a signature", async () => {
    await expect(webHidDeviceProvider.capture()).rejects.toBeInstanceOf(SignatureCaptureUnsupportedError);
    await expect(webSerialDeviceProvider.capture()).rejects.toBeInstanceOf(SignatureCaptureUnsupportedError);
    await expect(vendorSdkDeviceProvider.capture()).rejects.toBeInstanceOf(SignatureCaptureUnsupportedError);
  });

  it("canvas and upload capture() are UI-driven and reject direct calls", async () => {
    await expect(canvasPointerProvider.capture()).rejects.toBeInstanceOf(SignatureCaptureUnsupportedError);
    await expect(uploadProvider.capture()).rejects.toBeInstanceOf(SignatureCaptureUnsupportedError);
  });

  it("a newly installed device adapter is registered without touching the core", async () => {
    const r = new SignatureProviderRegistry();
    r.register({ id: "acme-pad", method: "device", label: "Acme pad", isAvailable: async () => true, capture: async () => ({ method: "device", widthPx: 100, heightPx: 40, deviceProvider: "acme-pad" }) });
    const available = await r.available(["device"]);
    expect(available.map((p) => p.id)).toEqual(["acme-pad"]);
    const cap = await available[0].capture();
    expect(cap.method).toBe("device");
    expect(cap.deviceProvider).toBe("acme-pad");
  });
});
