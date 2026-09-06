/**
 * WS-26B — Signature engine service.
 *
 * Sits above the WS-26A submission lifecycle without modifying it. Two concerns:
 *
 *   Signature assets  — a person's stored, authorized signature image. Owned by
 *                       one user; only the owner may read, list or nominate it.
 *                       Possession is NEVER authorization to sign.
 *   Applied signatures — one immutable `form_signatures` row per application to a
 *                       slot on a submission revision. Authorization to apply is
 *                       checked INDEPENDENTLY (the caller must resolve as the
 *                       participant of the workflow stage that owns the slot),
 *                       never inferred from holding an image. Applying from a
 *                       stored asset copies fresh bytes and re-hashes them, so a
 *                       later asset revocation can never alter a signed document.
 *
 * Every write records an audit event; images and answers never enter audit
 * metadata. Immutability: a finalized/archived submission's signatures cannot be
 * applied or revoked.
 */
import { and, eq, desc } from "drizzle-orm";
import sharp from "sharp";
import {
  db,
  signatureAssetsTable,
  formSignaturesTable,
  formSubmissionEventsTable,
  formTemplateVersionsTable,
  type SignatureAsset,
  type FormSignature,
} from "@workspace/db";
import { recordAuditEvent } from "../auditLog";
import { writeOrgFile, readOrgFile, discardOrphanedFile, computeSha256 } from "../fileStorage";
import { validateImageUpload } from "../imageProcessing";
import { getSubmission, canViewSubmission, type FormActor, type ViewerContext } from "./submissions";
import { listStages, membershipSatisfiesFormStage } from "./templates";

// ---- Errors (the route maps these to status codes) -------------------------
export class SignatureNotFoundError extends Error {}
export class SignatureAuthorityError extends Error {}
export class SignatureStateError extends Error {}
export class SignatureValidationError extends Error {}

export type SignatureMethod = "drawn" | "uploaded" | "device";

const TERMINAL_STATES = new Set(["finalized", "archived", "rejected"]);

type UploadFile = { mimetype: string; size: number; buffer: Buffer };

/** Re-encode to PNG (strips any embedded metadata) and read bounded dimensions. */
async function toSignaturePng(buffer: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  let out: Awaited<ReturnType<ReturnType<typeof sharp>["toBuffer"]>> extends infer _ ? { data: Buffer; info: { width?: number; height?: number } } : never;
  try {
    out = (await sharp(buffer).rotate().png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })) as { data: Buffer; info: { width?: number; height?: number } };
  } catch {
    throw new SignatureValidationError("The signature image could not be decoded");
  }
  const width = out.info.width ?? 0;
  const height = out.info.height ?? 0;
  if (width < 8 || height < 8) throw new SignatureValidationError("The signature image is too small");
  if (width > 4000 || height > 4000) throw new SignatureValidationError("The signature image dimensions are too large");
  return { png: out.data, width, height };
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** Public-safe view of a stored asset: never exposes the opaque storage key. */
export interface SignatureAssetView {
  id: number;
  status: SignatureAsset["status"];
  mimeType: string;
  widthPx: number | null;
  heightPx: number | null;
  byteSize: number | null;
  sha256: string;
  uploadedAt: Date;
  revokedAt: Date | null;
}
export function toAssetView(a: SignatureAsset): SignatureAssetView {
  return {
    id: a.id,
    status: a.status,
    mimeType: a.mimeType,
    widthPx: a.widthPx,
    heightPx: a.heightPx,
    byteSize: a.byteSize,
    sha256: a.sha256,
    uploadedAt: a.uploadedAt,
    revokedAt: a.revokedAt,
  };
}

/** Public-safe view of an applied signature: never exposes the opaque storage key. */
export interface FormSignatureView {
  id: number;
  submissionId: number;
  revisionId: number;
  slotKey: string;
  signerUserId: number;
  signerMembershipId: number;
  representedEmployeeId: number | null;
  authority: string;
  stageOrder: number | null;
  method: SignatureMethod;
  sourceAssetId: number | null;
  deviceProvider: string | null;
  sha256: string;
  mimeType: string;
  widthPx: number | null;
  heightPx: number | null;
  signedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
}
export function toSignatureView(s: FormSignature): FormSignatureView {
  return {
    id: s.id,
    submissionId: s.submissionId,
    revisionId: s.revisionId,
    slotKey: s.slotKey,
    signerUserId: s.signerUserId,
    signerMembershipId: s.signerMembershipId,
    representedEmployeeId: s.representedEmployeeId,
    authority: s.authority,
    stageOrder: s.stageOrder,
    method: s.method,
    sourceAssetId: s.sourceAssetId,
    deviceProvider: s.deviceProvider,
    sha256: s.sha256,
    mimeType: s.mimeType,
    widthPx: s.widthPx,
    heightPx: s.heightPx,
    signedAt: s.signedAt,
    revokedAt: s.revokedAt,
    revokeReason: s.revokeReason,
  };
}

function policyMethodsForSlot(signaturePolicy: unknown, slotKey: string): SignatureMethod[] {
  const all: SignatureMethod[] = ["drawn", "uploaded", "device"];
  if (!signaturePolicy || typeof signaturePolicy !== "object") return all;
  const slots = (signaturePolicy as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) return all;
  const slot = slots.find((s) => s && typeof s === "object" && (s as { key?: string }).key === slotKey) as
    | { methods?: unknown }
    | undefined;
  if (!slot || !Array.isArray(slot.methods) || slot.methods.length === 0) return all;
  const methods = (slot.methods as unknown[]).filter((m): m is SignatureMethod => m === "drawn" || m === "uploaded" || m === "device");
  return methods.length > 0 ? methods : all;
}

// ---- Signature assets ------------------------------------------------------

export async function uploadSignatureAsset(params: {
  organizationId: number;
  actor: FormActor;
  file: UploadFile;
}): Promise<SignatureAsset> {
  const { organizationId, actor, file } = params;
  validateImageUpload(file); // size/allowlist/magic-byte/spoof — throws InvalidImageError (route → 400)
  const { png, width, height } = await toSignaturePng(file.buffer);
  const sha256 = computeSha256(png);
  const storageKey = await writeOrgFile(organizationId, "signature-assets", "png", png);
  try {
    const [row] = await db
      .insert(signatureAssetsTable)
      .values({
        organizationId,
        ownerUserId: actor.userId,
        ownerMembershipId: actor.membershipId,
        storageKey,
        sha256,
        mimeType: "image/png",
        widthPx: width,
        heightPx: height,
        byteSize: png.length,
        uploadedByMembershipId: actor.membershipId,
      })
      .returning();
    await recordAuditEvent({
      actorApplicationUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      organizationId,
      eventType: "signature_asset.uploaded",
      targetType: "signature_asset",
      targetId: String(row.id),
      afterState: { sha256, widthPx: width, heightPx: height, byteSize: png.length },
    });
    return row;
  } catch (e) {
    await discardOrphanedFile(organizationId, storageKey);
    throw e;
  }
}

/** The caller's own stored signatures (active first). Never another user's. */
export async function listSignatureAssets(organizationId: number, actor: FormActor): Promise<SignatureAsset[]> {
  return db
    .select()
    .from(signatureAssetsTable)
    .where(and(eq(signatureAssetsTable.organizationId, organizationId), eq(signatureAssetsTable.ownerUserId, actor.userId)))
    .orderBy(desc(signatureAssetsTable.uploadedAt));
}

/** Owner-scoped fetch — a non-owner (or cross-tenant) id is a 404, never a disclosure. */
async function ownedAsset(organizationId: number, actor: FormActor, assetId: number): Promise<SignatureAsset> {
  const [asset] = await db
    .select()
    .from(signatureAssetsTable)
    .where(and(eq(signatureAssetsTable.id, assetId), eq(signatureAssetsTable.organizationId, organizationId), eq(signatureAssetsTable.ownerUserId, actor.userId)))
    .limit(1);
  if (!asset) throw new SignatureNotFoundError();
  return asset;
}

export async function revokeSignatureAsset(params: {
  organizationId: number;
  actor: FormActor;
  assetId: number;
  reason?: string | null;
}): Promise<SignatureAsset> {
  const { organizationId, actor, assetId } = params;
  const asset = await ownedAsset(organizationId, actor, assetId);
  if (asset.status === "revoked") return asset; // idempotent
  const [row] = await db
    .update(signatureAssetsTable)
    .set({ status: "revoked", revokedAt: new Date(), revokedByMembershipId: actor.membershipId, revokeReason: params.reason ?? null })
    .where(and(eq(signatureAssetsTable.id, assetId), eq(signatureAssetsTable.organizationId, organizationId)))
    .returning();
  await recordAuditEvent({
    actorApplicationUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    organizationId,
    eventType: "signature_asset.revoked",
    targetType: "signature_asset",
    targetId: String(assetId),
    beforeState: { status: asset.status },
    afterState: { status: "revoked" },
    metadata: params.reason ? { reason: params.reason } : undefined,
  });
  return row;
}

export async function readSignatureAssetImage(
  organizationId: number,
  actor: FormActor,
  assetId: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const asset = await ownedAsset(organizationId, actor, assetId);
  const buffer = await readOrgFile(organizationId, asset.storageKey);
  return { buffer, mimeType: asset.mimeType };
}

// ---- Applied signatures ----------------------------------------------------

export async function applySignature(params: {
  organizationId: number;
  actor: FormActor;
  viewer: ViewerContext;
  submissionId: number;
  slotKey: string;
  method: SignatureMethod;
  imageFile?: UploadFile | null;
  sourceAssetId?: number | null;
  deviceProvider?: string | null;
  deviceMetadata?: unknown;
  userAgent?: string | null;
  sessionIdHash?: string | null;
}): Promise<FormSignature> {
  const { organizationId, actor, viewer, submissionId, slotKey, method } = params;

  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) throw new SignatureNotFoundError();
  if (TERMINAL_STATES.has(submission.status)) throw new SignatureStateError("This form can no longer be signed");

  const stages = await listStages(organizationId, submission.templateVersionId);
  const stage = stages.find((s) => s.signatureSlotKey === slotKey);
  if (!stage) throw new SignatureValidationError("This slot is not signable in the form's workflow");

  // INDEPENDENT authorization: the caller must resolve as the participant of the
  // stage that owns this slot. Never inferred from holding a signature image.
  const authorized = await membershipSatisfiesFormStage({
    organizationId,
    stage,
    membershipId: viewer.membershipId,
    subjectEmployeeId: submission.subjectEmployeeId,
  });
  if (!authorized) throw new SignatureAuthorityError("You are not authorized to sign this slot");

  // The slot's stage must be reachable at the submission's current position.
  const minOrder = Math.min(...stages.map((s) => s.stageOrder));
  const reachable =
    submission.currentStageOrder === stage.stageOrder ||
    (submission.currentStageOrder == null && stage.stageOrder === minOrder) ||
    (submission.status === "draft" && stage.stageOrder === minOrder);
  if (!reachable) throw new SignatureStateError("This slot cannot be signed at the form's current stage");

  const [ver] = await db
    .select({ signaturePolicy: formTemplateVersionsTable.signaturePolicy })
    .from(formTemplateVersionsTable)
    .where(and(eq(formTemplateVersionsTable.id, submission.templateVersionId), eq(formTemplateVersionsTable.organizationId, organizationId)))
    .limit(1);
  const methods = policyMethodsForSlot(ver?.signaturePolicy, slotKey);
  if (!methods.includes(method)) throw new SignatureValidationError(`The "${method}" method is not permitted for this slot`);

  // Obtain fresh PNG bytes. Uploaded signatures COPY the asset's bytes — never a reference.
  let source: SignatureAsset | null = null;
  let bytes: Buffer;
  if (method === "uploaded") {
    if (!params.sourceAssetId) throw new SignatureValidationError("An uploaded signature requires a stored signature asset");
    const [asset] = await db
      .select()
      .from(signatureAssetsTable)
      .where(and(eq(signatureAssetsTable.id, params.sourceAssetId), eq(signatureAssetsTable.organizationId, organizationId)))
      .limit(1);
    if (!asset) throw new SignatureNotFoundError();
    if (asset.ownerUserId !== actor.userId) throw new SignatureAuthorityError("You may only apply your own stored signature");
    if (asset.status !== "active") throw new SignatureStateError("This stored signature has been revoked");
    source = asset;
    bytes = await readOrgFile(organizationId, asset.storageKey);
  } else {
    if (!params.imageFile) throw new SignatureValidationError("A signature image is required");
    validateImageUpload(params.imageFile);
    bytes = params.imageFile.buffer;
  }

  const { png, width, height } = await toSignaturePng(bytes);
  const sha256 = computeSha256(png);
  const revisionId = submission.currentRevisionId;
  if (revisionId == null) throw new SignatureStateError("The form has no revision to sign");

  const representedEmployeeId =
    stage.participant === "employee" || stage.resolver === "subject_employee" ? submission.subjectEmployeeId : viewer.employeeId ?? null;

  const storageKey = await writeOrgFile(organizationId, "signatures", "png", png);
  try {
    const created = await db.transaction(async (tx) => {
      const [sig] = await tx
        .insert(formSignaturesTable)
        .values({
          organizationId,
          submissionId,
          revisionId,
          templateVersionId: submission.templateVersionId,
          slotKey,
          signerUserId: actor.userId,
          signerMembershipId: actor.membershipId,
          representedEmployeeId,
          authority: stage.participant,
          stageOrder: stage.stageOrder,
          method,
          sourceAssetId: source?.id ?? null,
          deviceProvider: method === "device" ? params.deviceProvider ?? null : null,
          deviceMetadata: method === "device" ? (params.deviceMetadata as object | null) ?? null : null,
          storageKey,
          sha256,
          mimeType: "image/png",
          widthPx: width,
          heightPx: height,
          byteSize: png.length,
          requestId: actor.requestId ?? null,
          sessionIdHash: params.sessionIdHash ?? null,
          userAgent: params.userAgent ?? null,
        })
        .returning();
      await tx.insert(formSubmissionEventsTable).values({
        organizationId,
        submissionId,
        eventType: "signature_applied",
        stageOrder: stage.stageOrder,
        stageName: stage.name,
        revisionId,
        details: { slotKey, method, signatureId: sig.id, sha256 },
        actorUserId: actor.userId,
        actorMembershipId: actor.membershipId,
        requestId: actor.requestId ?? null,
      });
      return sig;
    });
    await recordAuditEvent({
      actorApplicationUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      organizationId,
      eventType: "form.signature_applied",
      targetType: "form_signature",
      targetId: String(created.id),
      afterState: { submissionId, slotKey, method, sha256, stageOrder: stage.stageOrder },
    });
    return created;
  } catch (e) {
    await discardOrphanedFile(organizationId, storageKey);
    if (isUniqueViolation(e)) throw new SignatureStateError("This slot already has an active signature");
    throw e;
  }
}

async function loadSubmissionSignature(organizationId: number, submissionId: number, signatureId: number): Promise<FormSignature> {
  const [sig] = await db
    .select()
    .from(formSignaturesTable)
    .where(and(eq(formSignaturesTable.id, signatureId), eq(formSignaturesTable.organizationId, organizationId), eq(formSignaturesTable.submissionId, submissionId)))
    .limit(1);
  if (!sig) throw new SignatureNotFoundError();
  return sig;
}

/** Visible signatures for a submission the viewer may see (metadata only). */
export async function listSubmissionSignatures(
  organizationId: number,
  viewer: ViewerContext,
  submissionId: number,
): Promise<FormSignature[]> {
  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) throw new SignatureNotFoundError();
  const stages = await listStages(organizationId, submission.templateVersionId);
  if (!(await canViewSubmission(organizationId, submission, viewer, stages))) throw new SignatureNotFoundError();
  return db
    .select()
    .from(formSignaturesTable)
    .where(and(eq(formSignaturesTable.organizationId, organizationId), eq(formSignaturesTable.submissionId, submissionId)))
    .orderBy(formSignaturesTable.stageOrder, formSignaturesTable.signedAt);
}

export async function readAppliedSignatureImage(
  organizationId: number,
  viewer: ViewerContext,
  submissionId: number,
  signatureId: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) throw new SignatureNotFoundError();
  const stages = await listStages(organizationId, submission.templateVersionId);
  if (!(await canViewSubmission(organizationId, submission, viewer, stages))) throw new SignatureNotFoundError();
  const sig = await loadSubmissionSignature(organizationId, submissionId, signatureId);
  const buffer = await readOrgFile(organizationId, sig.storageKey);
  return { buffer, mimeType: sig.mimeType };
}

export async function revokeSignature(params: {
  organizationId: number;
  actor: FormActor;
  viewer: ViewerContext;
  submissionId: number;
  signatureId: number;
  reason?: string | null;
}): Promise<FormSignature> {
  const { organizationId, actor, viewer, submissionId, signatureId } = params;
  const submission = await getSubmission(organizationId, submissionId);
  if (!submission) throw new SignatureNotFoundError();
  // Immutability: a finalized/archived document's signature state is historical.
  if (submission.status === "finalized" || submission.status === "archived") {
    throw new SignatureStateError("A finalized document's signatures cannot be changed");
  }
  const sig = await loadSubmissionSignature(organizationId, submissionId, signatureId);
  if (sig.revokedAt) return sig; // idempotent

  // Authorization: the original signer, or a caller who resolves as the slot's participant.
  const stages = await listStages(organizationId, submission.templateVersionId);
  const stage = stages.find((s) => s.signatureSlotKey === sig.slotKey);
  const isSigner = sig.signerUserId === actor.userId;
  const isStageActor =
    stage != null &&
    (await membershipSatisfiesFormStage({ organizationId, stage, membershipId: viewer.membershipId, subjectEmployeeId: submission.subjectEmployeeId }));
  if (!isSigner && !isStageActor) throw new SignatureAuthorityError("You are not authorized to revoke this signature");

  const [row] = await db
    .update(formSignaturesTable)
    .set({ revokedAt: new Date(), revokedByMembershipId: actor.membershipId, revokeReason: params.reason ?? null })
    .where(and(eq(formSignaturesTable.id, signatureId), eq(formSignaturesTable.organizationId, organizationId)))
    .returning();
  await db.insert(formSubmissionEventsTable).values({
    organizationId,
    submissionId,
    eventType: "signature_revoked",
    stageOrder: sig.stageOrder,
    revisionId: sig.revisionId,
    details: { slotKey: sig.slotKey, signatureId: sig.id },
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    requestId: actor.requestId ?? null,
  });
  await recordAuditEvent({
    actorApplicationUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    organizationId,
    eventType: "form.signature_revoked",
    targetType: "form_signature",
    targetId: String(signatureId),
    afterState: { submissionId, slotKey: sig.slotKey },
    metadata: params.reason ? { reason: params.reason } : undefined,
  });
  return row;
}
