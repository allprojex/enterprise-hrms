/**
 * WS-26B — signature capture provider/adapter contract.
 *
 * Three DISJOINT capture paths, each behind the same small contract so the
 * core form engine never speaks a vendor SDK:
 *
 *   - `canvas`  — browser Pointer Events (mouse, touch, finger, pen/stylus) on
 *                 a <canvas>. The drawing UI is SignaturePad; this descriptor
 *                 only advertises availability and method.
 *   - `upload`  — an authorized image the signer already stored, or a new image
 *                 file, validated server-side; applying it is an explicit action.
 *   - device    — external signature pads exposed over WebHID / WebSerial, or a
 *                 self-hosted vendor SDK. Only INTERFACE SHELLS ship in WS-26B:
 *                 no manufacturer named, no compatibility claimed. A real
 *                 adapter implements `capture()` to talk to its hardware and is
 *                 registered here; the core is unchanged.
 *
 * No universal hardware compatibility is asserted. A device is used only when
 * its adapter reports `isAvailable()` true; otherwise the method is hidden.
 */
export type SignatureMethod = "drawn" | "uploaded" | "device";

export interface SignatureCapture {
  method: SignatureMethod;
  /** The captured signature as PNG bytes (drawn/device). Absent for an uploaded stored asset. */
  pngBlob?: Blob;
  /** For method "uploaded": a stored signature_assets id owned by the signer (server copies its bytes). */
  sourceAssetId?: number;
  widthPx?: number;
  heightPx?: number;
  /** For method "device": the adapter id and any opaque, non-sensitive device metadata. */
  deviceProvider?: string;
  deviceMetadata?: Record<string, unknown>;
}

export interface SignatureCaptureOptions {
  widthPx?: number;
  heightPx?: number;
  signal?: AbortSignal;
}

export interface SignatureCaptureProvider {
  /** 'canvas' | 'upload' | a vendor adapter id. */
  id: string;
  method: SignatureMethod;
  label: string;
  /** Whether this path can be used in the current browser/device right now. */
  isAvailable(): Promise<boolean>;
  /**
   * Device adapters implement this to talk to hardware and resolve a capture.
   * Canvas and upload are driven by their own UI (SignaturePad / file input),
   * so their `capture` rejects — the dialog never calls it for those methods.
   */
  capture(options?: SignatureCaptureOptions): Promise<SignatureCapture>;
}

export class SignatureCaptureUnsupportedError extends Error {}

const hasWindow = () => typeof window !== "undefined";

/** Browser pointer capture (mouse/touch/pen). The drawing surface is SignaturePad. */
export const canvasPointerProvider: SignatureCaptureProvider = {
  id: "canvas",
  method: "drawn",
  label: "Draw signature",
  async isAvailable() {
    return hasWindow() && typeof document !== "undefined" && typeof document.createElement("canvas").getContext === "function";
  },
  async capture() {
    throw new SignatureCaptureUnsupportedError("Canvas capture is driven by the SignaturePad UI, not this method");
  },
};

/** An authorized stored/uploaded image. Applying it is an explicit action in the UI. */
export const uploadProvider: SignatureCaptureProvider = {
  id: "upload",
  method: "uploaded",
  label: "Use a stored signature",
  async isAvailable() {
    return hasWindow() && typeof FileReader !== "undefined";
  },
  async capture() {
    throw new SignatureCaptureUnsupportedError("Upload capture is driven by the file/stored-asset UI, not this method");
  },
};

/**
 * Device adapter shell — WebHID. A concrete adapter would open the device and
 * stream strokes; WS-26B ships only the availability probe and the contract.
 */
export const webHidDeviceProvider: SignatureCaptureProvider = {
  id: "webhid",
  method: "device",
  label: "Signature pad (WebHID)",
  async isAvailable() {
    // Present the method only where the platform capability exists AND a
    // concrete adapter has been supplied. The shell has none, so it stays off.
    return false;
  },
  async capture() {
    throw new SignatureCaptureUnsupportedError("No WebHID signature-pad adapter is installed");
  },
};

/** Device adapter shell — WebSerial. Same contract; no hardware assumed. */
export const webSerialDeviceProvider: SignatureCaptureProvider = {
  id: "webserial",
  method: "device",
  label: "Signature pad (serial)",
  async isAvailable() {
    return false;
  },
  async capture() {
    throw new SignatureCaptureUnsupportedError("No WebSerial signature-pad adapter is installed");
  },
};

/**
 * Vendor SDK slot — a self-hosted SDK (loaded under CSP 'self') would register
 * a provider with this shape. No vendor is named or bundled in WS-26B.
 */
export const vendorSdkDeviceProvider: SignatureCaptureProvider = {
  id: "vendor-sdk",
  method: "device",
  label: "Signature pad (vendor SDK)",
  async isAvailable() {
    return false;
  },
  async capture() {
    throw new SignatureCaptureUnsupportedError("No vendor signature SDK is installed");
  },
};

/** A registry so future supported hardware is added without touching the form engine. */
export class SignatureProviderRegistry {
  private providers = new Map<string, SignatureCaptureProvider>();

  register(provider: SignatureCaptureProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): SignatureCaptureProvider | undefined {
    return this.providers.get(id);
  }

  all(): SignatureCaptureProvider[] {
    return [...this.providers.values()];
  }

  /** Available providers whose method is permitted by the slot policy (order preserved). */
  async available(allowedMethods: SignatureMethod[]): Promise<SignatureCaptureProvider[]> {
    const set = new Set(allowedMethods);
    const out: SignatureCaptureProvider[] = [];
    for (const p of this.providers.values()) {
      if (!set.has(p.method)) continue;
      if (await p.isAvailable()) out.push(p);
    }
    return out;
  }
}

/** The default registry: canvas + upload always; device adapters are shells (off) until one is installed. */
export function createDefaultSignatureRegistry(): SignatureProviderRegistry {
  const r = new SignatureProviderRegistry();
  r.register(canvasPointerProvider);
  r.register(uploadProvider);
  r.register(webHidDeviceProvider);
  r.register(webSerialDeviceProvider);
  r.register(vendorSdkDeviceProvider);
  return r;
}

export const defaultSignatureRegistry = createDefaultSignatureRegistry();
