/**
 * WS-26B — signature engine routes.
 *
 * Two resource groups, both under the tenant-scoped path and behind
 * requireAuth → requireMembership(:organizationId); the service performs the
 * per-object authorization (owner-only for assets; slot-participant resolution
 * for applications) and answers "not found" for anything the caller may not
 * see, so an id's existence is never confirmed across tenants or users.
 *
 *   /organizations/:organizationId/signature-assets                 — a person's stored signatures
 *   /organizations/:organizationId/form-submissions/:id/signatures  — applications to a submission
 *
 * Signature and asset images are streamed ONLY through the permission-checked
 * image routes here; they are never served as static/public files. The client
 * never nominates a storage key — the server generates every one.
 */
import { Router } from "express";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireMembership, resolveOrganizationId, resolveActorMembershipId, type MembershipRequest } from "../middlewares/requireMembership";
import { computeSha256 } from "../lib/fileStorage";
import { InvalidImageError } from "../lib/imageProcessing";
import { buildViewerContext, type FormActor } from "../lib/formEngine/submissions";
import {
  uploadSignatureAsset,
  listSignatureAssets,
  revokeSignatureAsset,
  readSignatureAssetImage,
  applySignature,
  listSubmissionSignatures,
  readAppliedSignatureImage,
  revokeSignature,
  toAssetView,
  toSignatureView,
  SignatureNotFoundError,
  SignatureAuthorityError,
  SignatureStateError,
  SignatureValidationError,
  type SignatureMethod,
} from "../lib/formEngine/signatures";

const router = Router();
type Req = MembershipRequest & AuthenticatedRequest;

// Memory storage; the 5MB cap is enforced again in validateImageUpload.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function parseId(raw: unknown): number {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

function actorOf(req: Req): FormActor {
  return {
    userId: req.userId!,
    membershipId: resolveActorMembershipId(req) ?? req.membership!.id,
    requestId: (req as { id?: string | number }).id != null ? String((req as { id?: string | number }).id) : null,
  };
}

/** Evidence of the signing session without storing the credential itself. */
function sessionIdHashOf(req: Req): string | null {
  const auth = req.headers.authorization;
  return auth ? computeSha256(Buffer.from(auth)) : null;
}

function handleError(err: unknown, res: import("express").Response): boolean {
  if (err instanceof SignatureNotFoundError) {
    res.status(404).json({ error: "Not found" });
    return true;
  }
  if (err instanceof SignatureAuthorityError) {
    res.status(403).json({ error: err.message });
    return true;
  }
  if (err instanceof SignatureStateError) {
    res.status(409).json({ error: err.message });
    return true;
  }
  if (err instanceof SignatureValidationError || err instanceof InvalidImageError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

/** Wrap multer so a parser error (e.g. oversize) becomes a clean 400, never a 500. */
function withUpload(handler: (req: Req, res: import("express").Response) => Promise<void>) {
  return (req: Req, res: import("express").Response) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = (err as { code?: string }).code === "LIMIT_FILE_SIZE" ? "File exceeds the 5MB size limit" : "Invalid upload";
        res.status(400).json({ error: msg });
        return;
      }
      handler(req, res).catch((e) => {
        if (!handleError(e, res)) {
          res.status(500).json({ error: "Internal error" });
        }
      });
    });
  };
}

// ---- Signature assets ------------------------------------------------------

// GET /organizations/:organizationId/signature-assets — the caller's own stored signatures.
router.get(
  "/organizations/:organizationId/signature-assets",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const organizationId = resolveOrganizationId(req);
    const rows = await listSignatureAssets(organizationId, actorOf(req));
    res.json({ items: rows.map(toAssetView) });
  },
);

// POST /organizations/:organizationId/signature-assets — upload a stored signature (multipart "file").
router.post(
  "/organizations/:organizationId/signature-assets",
  requireAuth as any,
  requireMembership("organizationId"),
  withUpload(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "A signature image file is required" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const asset = await uploadSignatureAsset({
      organizationId,
      actor: actorOf(req),
      file: { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer },
    });
    res.status(201).json(toAssetView(asset));
  }),
);

// GET /organizations/:organizationId/signature-assets/:assetId/image — owner-only stream.
router.get(
  "/organizations/:organizationId/signature-assets/:assetId/image",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const assetId = parseId(req.params.assetId);
    if (Number.isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const { buffer, mimeType } = await readSignatureAssetImage(organizationId, actorOf(req), assetId);
      res.set("Content-Type", mimeType);
      res.set("Cache-Control", "private, no-store");
      res.send(buffer);
    } catch (e) {
      if (!handleError(e, res)) throw e;
    }
  },
);

// POST /organizations/:organizationId/signature-assets/:assetId/revoke
router.post(
  "/organizations/:organizationId/signature-assets/:assetId/revoke",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const assetId = parseId(req.params.assetId);
    if (Number.isNaN(assetId)) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;
      const asset = await revokeSignatureAsset({ organizationId, actor: actorOf(req), assetId, reason });
      res.json(toAssetView(asset));
    } catch (e) {
      if (!handleError(e, res)) throw e;
    }
  },
);

// ---- Applied signatures ----------------------------------------------------

// GET .../form-submissions/:submissionId/signatures — visible applications.
router.get(
  "/organizations/:organizationId/form-submissions/:submissionId/signatures",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const submissionId = parseId(req.params.submissionId);
    if (Number.isNaN(submissionId)) {
      res.status(400).json({ error: "Invalid submission id" });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const viewer = await buildViewerContext(organizationId, actorOf(req));
      const rows = await listSubmissionSignatures(organizationId, viewer, submissionId);
      res.json({ items: rows.map(toSignatureView) });
    } catch (e) {
      if (!handleError(e, res)) throw e;
    }
  },
);

// POST .../form-submissions/:submissionId/signatures — apply a signature (multipart).
// drawn/device carry a "file"; uploaded carries "sourceAssetId" and no file.
router.post(
  "/organizations/:organizationId/form-submissions/:submissionId/signatures",
  requireAuth as any,
  requireMembership("organizationId"),
  withUpload(async (req, res) => {
    const submissionId = parseId(req.params.submissionId);
    if (Number.isNaN(submissionId)) {
      res.status(400).json({ error: "Invalid submission id" });
      return;
    }
    const slotKey = typeof req.body?.slotKey === "string" ? req.body.slotKey : "";
    const method = req.body?.method as SignatureMethod;
    if (!slotKey || !["drawn", "uploaded", "device"].includes(method)) {
      res.status(400).json({ error: "slotKey and a valid method (drawn|uploaded|device) are required" });
      return;
    }
    const organizationId = resolveOrganizationId(req);
    const actor = actorOf(req);
    const viewer = await buildViewerContext(organizationId, actor);
    let deviceMetadata: unknown = null;
    if (typeof req.body?.deviceMetadata === "string" && req.body.deviceMetadata.trim() !== "") {
      try {
        deviceMetadata = JSON.parse(req.body.deviceMetadata);
      } catch {
        res.status(400).json({ error: "deviceMetadata must be valid JSON" });
        return;
      }
    }
    const sig = await applySignature({
      organizationId,
      actor,
      viewer,
      submissionId,
      slotKey,
      method,
      imageFile: req.file ? { mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer } : null,
      sourceAssetId: req.body?.sourceAssetId ? parseId(req.body.sourceAssetId) : null,
      deviceProvider: typeof req.body?.deviceProvider === "string" ? req.body.deviceProvider : null,
      deviceMetadata,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 500) : null,
      sessionIdHash: sessionIdHashOf(req),
    });
    res.status(201).json(toSignatureView(sig));
  }),
);

// GET .../form-submissions/:submissionId/signatures/:signatureId/image — permission-checked stream.
router.get(
  "/organizations/:organizationId/form-submissions/:submissionId/signatures/:signatureId/image",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const submissionId = parseId(req.params.submissionId);
    const signatureId = parseId(req.params.signatureId);
    if (Number.isNaN(submissionId) || Number.isNaN(signatureId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const viewer = await buildViewerContext(organizationId, actorOf(req));
      const { buffer, mimeType } = await readAppliedSignatureImage(organizationId, viewer, submissionId, signatureId);
      res.set("Content-Type", mimeType);
      res.set("Cache-Control", "private, no-store");
      res.send(buffer);
    } catch (e) {
      if (!handleError(e, res)) throw e;
    }
  },
);

// POST .../form-submissions/:submissionId/signatures/:signatureId/revoke
router.post(
  "/organizations/:organizationId/form-submissions/:submissionId/signatures/:signatureId/revoke",
  requireAuth as any,
  requireMembership("organizationId"),
  async (req: Req, res): Promise<void> => {
    const submissionId = parseId(req.params.submissionId);
    const signatureId = parseId(req.params.signatureId);
    if (Number.isNaN(submissionId) || Number.isNaN(signatureId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      const organizationId = resolveOrganizationId(req);
      const actor = actorOf(req);
      const viewer = await buildViewerContext(organizationId, actor);
      const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;
      const sig = await revokeSignature({ organizationId, actor, viewer, submissionId, signatureId, reason });
      res.json(toSignatureView(sig));
    } catch (e) {
      if (!handleError(e, res)) throw e;
    }
  },
);

export default router;
