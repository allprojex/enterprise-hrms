/**
 * Multer parser-contract regression tests (multer 2.3.0 security upgrade —
 * CVE-2026-77037 / CVE-2026-77078 / CVE-2026-82333).
 *
 * Every upload entry point in this service (employees.ts, me.ts,
 * organizationLogo.ts, organizationDocuments.ts, assets.ts,
 * formSignatures.ts, performanceReviewEvidence.ts,
 * learningEnrollmentEvidence.ts, backgroundChecks.ts, legacyImport.ts,
 * migrations.ts, publicCareers.ts) builds its parser the same way —
 * `multer({ storage: multer.memoryStorage(), limits: { fileSize: N } })`
 * followed by a wrapper that turns a MulterError into a 400 — and every one
 * of them re-validates the real bytes afterwards through
 * documentValidation.ts / imageProcessing.ts. These tests pin the parser
 * half of that contract directly, with no database and no route mocking, so
 * a future multer bump that changes parsing, the size boundary, error codes,
 * or `originalname` handling fails here rather than in production.
 *
 * 2.2.0 -> 2.3.0 changed four things that matter to this codebase, each
 * covered below:
 *   1. busboy is now given `fileSize + 1`, so the limit rejects only a file
 *      that genuinely EXCEEDS it (previously the boundary byte was ambiguous).
 *      This now matches the application-level `size > MAX` checks exactly.
 *   2. `originalname` is un-escaped per the WHATWG multipart spec, so %0A,
 *      %0D and %22 arrive as raw LF, CR and a double quote where 2.2.0 kept
 *      them encoded — i.e. a stored fileName can now contain a real newline.
 *   3. `next()` is wrapped in an AsyncResource, so AsyncLocalStorage
 *      (lib/requestContext.ts: tenant/request/user log correlation) survives
 *      multipart parsing instead of being lost across busboy stream events.
 *   4. append-field throwing is now a typed MulterError instead of an
 *      uncaught exception.
 *
 * Disk storage (storage/disk.js) also changed substantially in 2.3.0, but no
 * route here uses it — all twelve use memoryStorage — so it is out of scope.
 */
import { describe, it, expect } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import multer from "multer";
import { validateDocumentUpload, InvalidDocumentError } from "../lib/documentValidation";
import { validateImageUpload, InvalidImageError } from "../lib/imageProcessing";
import {
  createRequestContextStore,
  runWithRequestContext,
  bindTenantContext,
  getCurrentTenantContext,
} from "../lib/requestContext";

/** A real PNG header, so signature validation sees genuine bytes, padded to an exact length. */
function pngOfExactly(bytes: number): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  if (bytes <= header.length) return header.subarray(0, bytes);
  return Buffer.concat([header, Buffer.alloc(bytes - header.length, 0x00)]);
}

function pdfOfExactly(bytes: number): Buffer {
  const header = Buffer.from("%PDF-1.7\n", "ascii");
  return Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x20)]);
}

/**
 * The exact wrapper shape every upload route in this service uses: a
 * MulterError becomes a typed 400, anything else goes to the error handler.
 * Reproduced here rather than imported because each route keeps its own copy
 * with its own message (organizationLogo.ts, migrations.ts,
 * learningEnrollmentEvidence.ts, assets.ts, organizationDocuments.ts and
 * performanceReviewEvidence.ts all have the identical structure).
 */
function buildUploadApp(opts: {
  limitBytes: number;
  field?: string;
  onFile?: (req: Request, res: Response) => void;
  wrap?: (handler: express.RequestHandler) => express.RequestHandler;
}) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: opts.limitBytes } });
  const field = opts.field ?? "file";
  const app = express();

  const parse = (req: Request, res: Response, next: NextFunction): void => {
    upload.single(field)(req as never, res as never, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        res.status(400).json({ error: err.message, code: err.code, field: err.field });
        return;
      }
      if (err) {
        next(err);
        return;
      }
      next();
    });
  };

  const handler: express.RequestHandler = (req, res) => {
    if (opts.onFile) return opts.onFile(req, res);
    if (!req.file) {
      res.status(400).json({ error: "A file is required" });
      return;
    }
    res.status(200).json({
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferLength: req.file.buffer.length,
      body: req.body,
    });
  };

  app.post("/upload", opts.wrap ? opts.wrap(parse) : parse, handler);
  // Express's default error handler would leak a stack trace; every route in
  // this service sits behind the app-level JSON handler instead.
  app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "Internal server error" });
  });
  return app;
}

/** Hand-built multipart body, so the part headers can say things supertest will not emit. */
function rawMultipart(
  parts: { name: string; filename?: string; contentType?: string; body: Buffer | string }[],
  boundary: string,
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"`;
    let head = `--${boundary}\r\nContent-Disposition: ${disposition}\r\n`;
    if (part.contentType) head += `Content-Type: ${part.contentType}\r\n`;
    head += "\r\n";
    chunks.push(
      Buffer.from(head, "utf8"),
      Buffer.isBuffer(part.body) ? part.body : Buffer.from(part.body, "utf8"),
      Buffer.from("\r\n", "utf8"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

describe("multer parser contract (2.3.0 upgrade regression)", () => {
  describe("valid uploads still parse into memory intact", () => {
    it("delivers the exact bytes, size, mimetype and field name to the route", async () => {
      const png = pngOfExactly(2048);
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024 });

      const res = await request(app)
        .post("/upload")
        .attach("file", png, { filename: "badge.png", contentType: "image/png" });

      expect(res.status).toBe(200);
      expect(res.body.originalname).toBe("badge.png");
      expect(res.body.mimetype).toBe("image/png");
      expect(res.body.size).toBe(2048);
      // memoryStorage: req.file.buffer is the whole file, which is what every
      // route hands to validateDocumentUpload/validateImageUpload/fileStorage.
      expect(res.body.bufferLength).toBe(2048);
    });

    it("still parses text fields alongside the file (append-field path)", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024 });

      const res = await request(app)
        .post("/upload")
        .field("categoryCode", "contract")
        .field("notes", "signed copy")
        .attach("file", pdfOfExactly(512), { filename: "contract.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({ categoryCode: "contract", notes: "signed copy" });
    });
  });

  describe("file-size limits remain enforced, and agree with the application-level ceiling", () => {
    const LIMIT = 64 * 1024;

    it("accepts a file of exactly the limit", async () => {
      const app = buildUploadApp({ limitBytes: LIMIT });
      const res = await request(app)
        .post("/upload")
        .attach("file", pngOfExactly(LIMIT), { filename: "exact.png", contentType: "image/png" });

      // 2.3.0 passes busboy `fileSize + 1`, so the boundary byte is accepted.
      // This is the documented meaning of the option and matches the
      // `file.size > MAX_UPLOAD_BYTES` checks in documentValidation.ts and
      // imageProcessing.ts, which reject only when the limit is EXCEEDED.
      expect(res.status).toBe(200);
      expect(res.body.size).toBe(LIMIT);
    });

    it("rejects a file one byte over the limit as a typed 400, never a 500", async () => {
      const app = buildUploadApp({ limitBytes: LIMIT });
      const res = await request(app)
        .post("/upload")
        .attach("file", pngOfExactly(LIMIT + 1), { filename: "over.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIMIT_FILE_SIZE");
      expect(res.body.field).toBe("file");
    });

    it("rejects a grossly oversized file without handing it to the route", async () => {
      const app = buildUploadApp({ limitBytes: LIMIT });
      const res = await request(app)
        .post("/upload")
        .attach("file", pngOfExactly(LIMIT * 8), { filename: "huge.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIMIT_FILE_SIZE");
    });

    it("the application-level ceiling still rejects above its own limit independently of multer", () => {
      // The 10MB document ceiling (documentValidation.ts) — a route whose
      // multer limit were ever widened would still be stopped here.
      expect(() =>
        validateDocumentUpload({ mimetype: "application/pdf", size: 10 * 1024 * 1024, buffer: pdfOfExactly(64) }),
      ).not.toThrow();
      expect(() =>
        validateDocumentUpload({ mimetype: "application/pdf", size: 10 * 1024 * 1024 + 1, buffer: pdfOfExactly(64) }),
      ).toThrow(InvalidDocumentError);

      // The 5MB image ceiling (imageProcessing.ts).
      expect(() =>
        validateImageUpload({ mimetype: "image/png", size: 5 * 1024 * 1024, buffer: pngOfExactly(64) }),
      ).not.toThrow();
      expect(() =>
        validateImageUpload({ mimetype: "image/png", size: 5 * 1024 * 1024 + 1, buffer: pngOfExactly(64) }),
      ).toThrow(InvalidImageError);
    });
  });

  describe("magic-byte / MIME validation is unaffected by the parser upgrade", () => {
    it("still rejects a declared-PDF whose bytes are not a PDF", async () => {
      const app = buildUploadApp({
        limitBytes: 5 * 1024 * 1024,
        onFile: (req, res) => {
          try {
            const ext = validateDocumentUpload({
              mimetype: req.file!.mimetype,
              size: req.file!.size,
              buffer: req.file!.buffer,
            });
            res.status(200).json({ ext });
          } catch (err) {
            res.status(400).json({ error: (err as Error).message });
          }
        },
      });

      const lying = await request(app)
        .post("/upload")
        .attach("file", Buffer.from("<script>alert(1)</script>", "utf8"), {
          filename: "invoice.pdf",
          contentType: "application/pdf",
        });
      expect(lying.status).toBe(400);
      expect(lying.body.error).toMatch(/does not match the declared file type/i);

      const honest = await request(app)
        .post("/upload")
        .attach("file", pdfOfExactly(256), { filename: "invoice.pdf", contentType: "application/pdf" });
      expect(honest.status).toBe(200);
      expect(honest.body.ext).toBe("pdf");
    });

    it("still rejects a disallowed MIME type outright", () => {
      expect(() =>
        validateDocumentUpload({ mimetype: "application/x-msdownload", size: 32, buffer: Buffer.alloc(32) }),
      ).toThrow(InvalidDocumentError);
    });
  });

  describe("unexpected fields fail safely", () => {
    it("returns a typed 400 LIMIT_UNEXPECTED_FILE for a file under the wrong field name", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024, field: "file" });
      const res = await request(app)
        .post("/upload")
        .attach("attachment", pngOfExactly(128), { filename: "x.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIMIT_UNEXPECTED_FILE");
      expect(res.body.field).toBe("attachment");
    });

    it("returns a typed 400 when a second file is sent to a single-file route", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024, field: "file" });
      const res = await request(app)
        .post("/upload")
        .attach("file", pngOfExactly(64), { filename: "a.png", contentType: "image/png" })
        .attach("file", pngOfExactly(64), { filename: "b.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe("LIMIT_UNEXPECTED_FILE");
    });
  });

  describe("malformed multipart fails safely", () => {
    /**
     * Busboy raises a plain `Error("Unexpected end of form")` for a malformed
     * body, not a MulterError, so the route wrappers pass it to the app-level
     * error handler and the caller gets a generic 500 rather than a 400. That
     * is PRE-EXISTING and identical on 2.2.0 and 2.3.0 (verified by running
     * both against these same bodies) — the upgrade neither introduced nor
     * fixed it. What matters for safety is asserted here: the process does not
     * crash, the request always terminates, and the response body carries no
     * parser message, stack trace or file detail.
     */
    it("a truncated body with no closing boundary terminates with a generic error and no internals", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024 });
      const boundary = "----multerRegressionTruncated";
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
          "Content-Type: image/png\r\n\r\n\x89PNG\r\n\x1a\n",
        "binary",
      );

      const res = await request(app)
        .post("/upload")
        .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
        .send(body);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      expect(res.text).not.toMatch(/Unexpected end of form|at .*\.js:|node_modules/);
    });

    it("a body whose boundary does not match the declared one is rejected the same safe way", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024 });
      const res = await request(app)
        .post("/upload")
        .set("Content-Type", "multipart/form-data; boundary=----declaredBoundary")
        .send(
          rawMultipart(
            [{ name: "file", filename: "a.png", contentType: "image/png", body: pngOfExactly(64) }],
            "----differentBoundary",
          ),
        );

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "Internal server error" });
      // The important half: no file was ever handed to the route handler, so
      // nothing downstream saw a partially-parsed upload.
      expect(res.text).not.toContain("a.png");
    });

    it("a non-multipart body on an upload route is passed through with no file, not parsed", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024 });
      const res = await request(app)
        .post("/upload")
        .set("Content-Type", "application/json")
        .send({ file: "not-a-file" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("A file is required");
    });
  });

  describe("originalname escaping (2.3.0 behaviour change) cannot become header injection", () => {
    // Only %0A, %0D and %22 are decoded — a bare %20 stays literal, because a
    // full decodeURIComponent would corrupt legitimate names like "50%.pdf".
    const HOSTILE_ENCODED = "payroll%0D%0AX-Injected:%20yes%22.pdf";
    const HOSTILE_DECODED = 'payroll\r\nX-Injected:%20yes".pdf';

    it("decodes %0A/%0D/%22 in a filename into raw characters, and nothing else", async () => {
      const app = buildUploadApp({ limitBytes: 5 * 1024 * 1024 });
      const boundary = "----multerRegressionName";
      const res = await request(app)
        .post("/upload")
        .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
        .send(
          rawMultipart(
            [
              {
                name: "file",
                filename: HOSTILE_ENCODED,
                contentType: "application/pdf",
                body: pdfOfExactly(64),
              },
            ],
            boundary,
          ),
        );

      expect(res.status).toBe(200);
      // This is the change: 2.2.0 delivered the whole string literally, so
      // originalname could never contain a real CR, LF or double quote.
      expect(res.body.originalname).toBe(HOSTILE_DECODED);
      expect(res.body.originalname).toContain("\r\n");
      expect(res.body.originalname).toContain("%20");
    });

    it("every Content-Disposition in this service percent-encodes the stored name, so a decoded CRLF is neutralised", () => {
      // Mirrors the exact expression used by assets.ts, organizationDocuments.ts,
      // performanceReviewEvidence.ts, learningEnrollmentEvidence.ts,
      // documentTemplates.ts, formTemplates.ts and formSubmissions.ts:
      //   `attachment; filename="${encodeURIComponent(row.fileName)}"`
      const header = `attachment; filename="${encodeURIComponent(HOSTILE_DECODED)}"`;

      expect(header).not.toMatch(/[\r\n]/);
      expect(header).not.toContain('yes%20"');
      expect(header).toContain("%0D%0A");
      // Nothing can terminate the header value early: exactly the two quotes
      // this service writes itself, so the split yields three segments.
      expect(header.split('"').length).toBe(3);
    });
  });

  describe("request context survives the parser", () => {
    it("AsyncLocalStorage tenant context set before multer is still readable in the route", async () => {
      const app = buildUploadApp({
        limitBytes: 5 * 1024 * 1024,
        // Stands in for the real chain: requestContext is established by the
        // request-logging middleware and the tenant is bound by
        // requireMembership, both of which run BEFORE any upload parser.
        wrap: (parse) => (req, res, next) => {
          runWithRequestContext(createRequestContextStore("multer-regression"), () => {
            bindTenantContext(3, "membership");
            parse(req, res, next);
          });
        },
        onFile: (_req, res) => {
          res.status(200).json({ tenant: getCurrentTenantContext()?.organizationId ?? null });
        },
      });

      const res = await request(app)
        .post("/upload")
        .attach("file", pdfOfExactly(256), { filename: "doc.pdf", contentType: "application/pdf" });

      expect(res.status).toBe(200);
      // 2.3.0 wraps next() in an AsyncResource; without it the context is lost
      // across busboy stream events and tenant_id vanishes from the log/audit
      // correlation for every multipart request.
      expect(res.body.tenant).toBe(3);
    });
  });
});
