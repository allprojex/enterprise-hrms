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
import { Router } from "express";
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

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
  upload.single("file"),
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

export default router;
