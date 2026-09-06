/**
 * WWM Readiness, Workstream 3 — Organization Logo.
 *
 * `organizations.logoUrl` already existed as a plain text column, and
 * `lib/fileStorage.ts` already existed as the platform's one private,
 * organization-scoped disk-storage primitive (used today for employee
 * avatars/documents) — but nothing before this workstream let an
 * organization actually store a logo through it, and that primitive's own
 * read route is deliberately authenticated-only (see employees.ts's
 * profile-picture GET), which cannot serve the *login page* — rendered
 * before authentication exists. This file adds the one missing piece: a
 * public, minimal GET (mirroring GET /tenant-context's own "one
 * deliberately public, narrow, safe route" precedent) plus the
 * authenticated PATCH an org admin uses to set it. No new storage
 * mechanism, no second branding mechanism — the same writeOrgFile/
 * readOrgFile every other upload in this codebase already uses.
 *
 * `logoUrl` itself encodes the storage key: `/organizations/:id/logo/:key`
 * — there is nowhere else to persist the random storage key returned by
 * writeOrgFile (organizations has no dedicated key column, and adding one
 * for a single reference already fully expressible in the existing
 * `logoUrl` text column would be pure duplication). The key is a random,
 * unguessable, server-generated filename — never derived from anything
 * client-supplied — matching every other storage key in this codebase;
 * embedding it in a public URL is the same trust level already extended
 * to organization name/type/slug via GET /tenant-context.
 */
import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "path";
import { eq } from "drizzle-orm";
import { db, organizationsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireMembership, type MembershipRequest } from "../middlewares/requireMembership";
import { requirePermission } from "../middlewares/requirePermission";
import { writeOrgFile, readOrgFile, deleteOrgFile } from "../lib/fileStorage";
import { validateImageUpload, processLogoImage, InvalidImageError } from "../lib/imageProcessing";
import { recordAuditEvent } from "../lib/auditLog";
import { logger } from "../lib/logger";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Converts a MulterError (e.g. LIMIT_FILE_SIZE for a >5MB body, or an
 * unexpected field name) into the same res.status(400).json({ error })
 * shape every other validation failure on this route already returns,
 * mirroring learningEnrollmentEvidence.ts's identical wrapper. Runs only
 * after requireAuth/requireMembership/requirePermission have passed, so an
 * unauthorized caller never reaches the parser at all.
 */
function handleLogoUpload(req: MembershipRequest & AuthenticatedRequest, res: Response, next: NextFunction): void {
  upload.single("file")(req as never, res as never, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 5MB size limit" : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

const LOGO_SUBDIR = "branding";
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
};
const EXTENSION_BY_MIME: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" };

// Logo URLs are consumed directly as <img src> in the frontend — never
// routed through custom-fetch.ts's API-client base URL — so the stored
// value must already carry the same `/api` prefix every other request the
// frontend makes relies on (Vite's dev proxy, and Nginx in production,
// both only forward paths under /api).
function buildLogoUrl(organizationId: number, key: string): string {
  const filename = path.posix.basename(key);
  return `/api/organizations/${organizationId}/logo/${filename}`;
}

// GET /organizations/:organizationId/logo/:filename
// Public — no authentication. Serves only what GET /tenant-context already
// tells any caller it may fetch (a logoUrl for a resolved, non-suspended
// organization) — never a directory listing, never any other stored file.
router.get("/organizations/:organizationId/logo/:filename", async (req, res): Promise<void> => {
  const organizationId = parseInt(String(req.params.organizationId), 10);
  const filename = String(req.params.filename);
  if (isNaN(organizationId) || !/^[a-f0-9]{48}\.(png|webp|jpg)$/.test(filename)) {
    res.status(404).end();
    return;
  }

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
  const expectedUrl = buildLogoUrl(organizationId, filename);
  if (!org || org.status === "suspended" || org.logoUrl !== expectedUrl) {
    res.status(404).end();
    return;
  }

  try {
    const extension = filename.split(".").pop()!;
    const buffer = await readOrgFile(organizationId, path.posix.join(LOGO_SUBDIR, filename));
    res.set("Content-Type", CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch {
    res.status(404).end();
  }
});

// PATCH /organizations/:organizationId/logo
router.patch(
  "/organizations/:organizationId/logo",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization.update"),
  handleLogoUpload,
  async (req: MembershipRequest & AuthenticatedRequest, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const organizationId = req.membership!.organizationId;

    try {
      validateImageUpload({ mimetype: req.file.mimetype, size: req.file.size, buffer: req.file.buffer });
      const processed = await processLogoImage(req.file.buffer, req.file.mimetype);
      const extension = EXTENSION_BY_MIME[req.file.mimetype] ?? "jpg";
      const key = await writeOrgFile(organizationId, LOGO_SUBDIR, extension, processed);
      const logoUrl = buildLogoUrl(organizationId, path.posix.basename(key));

      const [before] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
      const [updated] = await db
        .update(organizationsTable)
        .set({ logoUrl })
        .where(eq(organizationsTable.id, organizationId))
        .returning();

      if (before?.logoUrl) {
        const oldFilename = before.logoUrl.split("/").pop();
        if (oldFilename && oldFilename !== path.posix.basename(key)) {
          await deleteOrgFile(organizationId, path.posix.join(LOGO_SUBDIR, oldFilename)).catch(() => undefined);
        }
      }

      await recordAuditEvent({
        actorApplicationUserId: req.userId!,
        actorMembershipId: req.membership!.id,
        organizationId,
        eventType: "organization.logo_updated",
        targetType: "organization",
        targetId: String(organizationId),
        beforeState: { logoUrl: before?.logoUrl ?? null },
        afterState: { logoUrl: updated.logoUrl },
      });

      res.json({ logoUrl: updated.logoUrl });
    } catch (err) {
      if (err instanceof InvalidImageError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  },
);

// DELETE /organizations/:organizationId/logo
// Governed removal of an organization's logo, restoring the neutral fallback
// identity. Same authorization model as the PATCH upload (authenticated,
// active membership in the PATH organization, organization.update); the target
// is the server-authoritative :organizationId, never anything client-supplied.
// Sets logoUrl to null and best-effort deletes the current object through the
// same storage abstraction the replace path uses — a already-missing file
// (e.g. a dangling reference whose binary was lost) must not fail the removal,
// and a storage-delete failure is logged, not surfaced. Audited with the same
// organization.logo_updated family (after: logoUrl null).
router.delete(
  "/organizations/:organizationId/logo",
  requireAuth as any,
  requireMembership("organizationId"),
  requirePermission("organization.update"),
  async (req: MembershipRequest & AuthenticatedRequest, res): Promise<void> => {
    const organizationId = req.membership!.organizationId;

    const [before] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1);
    if (!before) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    if (!before.logoUrl) {
      // Idempotent: nothing to remove; the organization already shows the fallback.
      res.json({ logoUrl: null });
      return;
    }

    const [updated] = await db
      .update(organizationsTable)
      .set({ logoUrl: null })
      .where(eq(organizationsTable.id, organizationId))
      .returning();

    // Storage cleanup is scoped to THIS organization's branding boundary: the
    // filename comes from the organization's own stored logoUrl, and
    // deleteOrgFile is itself org-scoped, so it can never reach another
    // tenant's object. Best-effort, exactly like the replace path.
    const filename = before.logoUrl.split("/").pop();
    if (filename) {
      await deleteOrgFile(organizationId, path.posix.join(LOGO_SUBDIR, filename)).catch((err) => {
        logger.warn(
          { organizationId, err: err instanceof Error ? err.message : String(err) },
          "organization logo removed from the record; storage object could not be deleted (non-fatal)",
        );
      });
    }

    await recordAuditEvent({
      actorApplicationUserId: req.userId!,
      actorMembershipId: req.membership!.id,
      organizationId,
      eventType: "organization.logo_updated",
      targetType: "organization",
      targetId: String(organizationId),
      beforeState: { logoUrl: before.logoUrl },
      afterState: { logoUrl: updated.logoUrl },
    });

    res.json({ logoUrl: updated.logoUrl });
  },
);

export default router;
