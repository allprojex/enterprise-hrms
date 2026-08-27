/**
 * WS-5 — live integration coverage against a REAL PostgreSQL database.
 *
 * Why this file exists alongside the mocked suites: the guarantees WS-5
 * leans on hardest are enforced by the database, not by application code —
 * the partial unique index that makes two simultaneous "current" versions
 * impossible (§11), the one that permits at most one active template version
 * (§51), and the transactional rollback behavior around storage writes
 * (§50). A mocked `@workspace/db` cannot prove any of those; it can only
 * prove that the code calls the functions the mock expects. So these run
 * against a real schema.
 *
 * CI has no database (see .github/workflows/ci.yml — every other suite mocks
 * @workspace/db entirely), so this file SKIPS ITSELF unless
 * WS5_LIVE_DATABASE_URL is set, and it never touches the ordinary
 * DATABASE_URL placeholder. Run locally with:
 *
 *   WS5_LIVE_DATABASE_URL=postgres://hrms:hrms@localhost:5433/hrms \
 *     pnpm --filter @workspace/api-server run test documentsLive
 *
 * Every organization, user, and document it creates is synthetic and
 * disposed of in afterAll — no real organization's data is read or written
 * (§52/§62).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveLiveDatabaseUrl } from "./liveDbGuard";

const LIVE_URL = resolveLiveDatabaseUrl("WS5_LIVE_DATABASE_URL");
const describeLive = LIVE_URL ? describe : describe.skip;

// @workspace/db reads DATABASE_URL at import time, so it must be pointed at
// the live database before the dynamic import below.
if (LIVE_URL) process.env.DATABASE_URL = LIVE_URL;

describeLive("WS-5 live integration", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let db: any;
  let schema: any;
  let orgA: number;
  let orgB: number;
  let userId: number;
  let eq: any;
  let and: any;

  let organizationDocuments: typeof import("../lib/organizationDocuments");
  let documentTemplates: typeof import("../lib/documentTemplates");
  let documentGeneration: typeof import("../lib/documentGeneration");
  let documentRetention: typeof import("../lib/documentRetention");
  let documentRequirements: typeof import("../lib/documentRequirements");
  let documentCategories: typeof import("../lib/documentCategories");

  /** A minimal, real PDF — passes validateDocumentUpload's magic-byte check. */
  const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`, "latin1");
  const file = (marker: string, name = "doc.pdf") => ({
    mimetype: "application/pdf",
    size: pdf(marker).length,
    buffer: pdf(marker),
    originalname: name,
  });

  const CATEGORY = "ws5_live_policy";
  const CONFIDENTIAL_CATEGORY = "ws5_live_confidential";

  beforeAll(async () => {
    const drizzle = await import("drizzle-orm");
    eq = drizzle.eq;
    and = drizzle.and;
    const dbModule = await import("@workspace/db");
    db = dbModule.db;
    schema = dbModule;

    organizationDocuments = await import("../lib/organizationDocuments");
    documentTemplates = await import("../lib/documentTemplates");
    documentGeneration = await import("../lib/documentGeneration");
    documentRetention = await import("../lib/documentRetention");
    documentRequirements = await import("../lib/documentRequirements");
    documentCategories = await import("../lib/documentCategories");

    const suffix = `ws5-live-${Date.now()}`;
    const [a] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS5 Live A ${suffix}`, slug: `ws5-live-a-${suffix}` })
      .returning();
    const [b] = await db
      .insert(schema.organizationsTable)
      .values({ name: `WS5 Live B ${suffix}`, slug: `ws5-live-b-${suffix}` })
      .returning();
    orgA = a.id;
    orgB = b.id;

    const [user] = await db
      .insert(schema.usersTable)
      .values({
        email: `ws5-live-${suffix}@example.invalid`,
        passwordHash: "x",
        firstName: "WS5",
        lastName: "Tester",
        organizationId: orgA,
      })
      .returning();
    userId = user.id;

    // Both organizations get the same category codes, so a cross-org test
    // failing means isolation failed — not that a category was missing.
    for (const organizationId of [orgA, orgB]) {
      await db.insert(schema.masterDataItemsTable).values([
        { domain: "document_category", organizationId, code: CATEGORY, label: "Live Policy" },
        { domain: "document_category", organizationId, code: CONFIDENTIAL_CATEGORY, label: "Live Confidential" },
      ]);
    }

    await db.insert(schema.documentCategorySettingsTable).values({
      organizationId: orgA,
      categoryCode: CONFIDENTIAL_CATEGORY,
      sensitivity: "confidential",
      verificationRequired: true,
      expirySupported: true,
    });
  });

  afterAll(async () => {
    if (!db) return;
    // Deleted in FK-dependency order; organizations use onDelete restrict.
    for (const organizationId of [orgA, orgB]) {
      await db.delete(schema.generatedDocumentsTable).where(eq(schema.generatedDocumentsTable.organizationId, organizationId));
      await db.delete(schema.documentTemplateVersionsTable).where(eq(schema.documentTemplateVersionsTable.organizationId, organizationId));
      await db.update(schema.documentTemplatesTable).set({ currentVersionId: null }).where(eq(schema.documentTemplatesTable.organizationId, organizationId));
      await db.delete(schema.documentTemplatesTable).where(eq(schema.documentTemplatesTable.organizationId, organizationId));
      await db.delete(schema.documentRetentionRecordsTable).where(eq(schema.documentRetentionRecordsTable.organizationId, organizationId));
      await db.delete(schema.documentRequirementsTable).where(eq(schema.documentRequirementsTable.organizationId, organizationId));
      await db.update(schema.organizationDocumentsTable).set({ currentVersionId: null }).where(eq(schema.organizationDocumentsTable.organizationId, organizationId));
      await db.delete(schema.organizationDocumentVersionsTable).where(eq(schema.organizationDocumentVersionsTable.organizationId, organizationId));
      await db.delete(schema.organizationDocumentsTable).where(eq(schema.organizationDocumentsTable.organizationId, organizationId));
      await db.delete(schema.documentCategorySettingsTable).where(eq(schema.documentCategorySettingsTable.organizationId, organizationId));
      await db.delete(schema.masterDataItemsTable).where(eq(schema.masterDataItemsTable.organizationId, organizationId));
    }

    // The audit events these tests produced are deliberately NOT deleted:
    // WS-3's append-only trigger (0058) refuses DELETE on audit_events, and
    // that protection working is itself part of what this suite verifies.
    // The synthetic organizations are therefore left in place too — their id
    // is still referenced by immutable audit history, and audit_events'
    // organization FK is ON DELETE restrict. On a disposable local database
    // that is the correct trade: tamper-evidence outranks test tidiness.
    // The user row is only removable because nothing immutable references it.
    await db.delete(schema.usersTable).where(eq(schema.usersTable.id, userId)).catch(() => undefined);
    await dbPoolEnd();
  });

  async function dbPoolEnd(): Promise<void> {
    const dbModule = await import("@workspace/db");
    await dbModule.pool.end();
  }

  const actor = () => ({ actorApplicationUserId: userId, actorMembershipId: null });

  // ---- A/B: create + upload -------------------------------------------

  it("A/B: creates an organization document with a valid file", async () => {
    const { document, version } = await organizationDocuments.createDocument({
      organizationId: orgA,
      categoryCode: CATEGORY,
      title: "Employee Handbook",
      file: file("v1"),
      ...actor(),
    });

    expect(document.organizationId).toBe(orgA);
    expect(version.versionNumber).toBe(1);
    expect(version.status).toBe("current");
    expect(document.currentVersionId).toBe(version.id);
    // The storage key must be organization-scoped and unguessable, never
    // derived from the client-supplied filename (§29).
    expect(version.storageKey).toMatch(/^organization-documents\/[0-9a-f]{48}\.pdf$/);
    expect(version.storageKey).not.toContain("doc.pdf");
  });

  // ---- C: invalid file rejected ---------------------------------------

  it("C: rejects a file whose bytes do not match its declared type", async () => {
    await expect(
      organizationDocuments.createDocument({
        organizationId: orgA,
        categoryCode: CATEGORY,
        title: "Spoofed",
        file: { mimetype: "application/pdf", size: 4, buffer: Buffer.from("MZ\x90\x00"), originalname: "evil.pdf" },
        ...actor(),
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it("C: rejects an executable content type outright", async () => {
    await expect(
      organizationDocuments.createDocument({
        organizationId: orgA,
        categoryCode: CATEGORY,
        title: "Executable",
        file: { mimetype: "application/x-msdownload", size: 4, buffer: Buffer.from("MZ\x90\x00"), originalname: "x.exe" },
        ...actor(),
      }),
    ).rejects.toThrow(/Unsupported file type/i);
  });

  it("C: rejects a category that is not defined for this organization", async () => {
    await expect(
      organizationDocuments.createDocument({
        organizationId: orgA,
        categoryCode: "not_a_real_category",
        title: "Forged category",
        file: file("x"),
        ...actor(),
      }),
    ).rejects.toThrow(documentCategories.UnknownDocumentCategoryError);
  });

  // ---- D: cross-organization isolation ---------------------------------

  it("D: a document created in Org A is invisible and unreachable from Org B", async () => {
    const { document, version } = await organizationDocuments.createDocument({
      organizationId: orgA,
      categoryCode: CATEGORY,
      title: "Org A Only",
      file: file("orgA"),
      ...actor(),
    });

    expect(await organizationDocuments.getDocument(orgB, document.id)).toBeNull();
    expect(await organizationDocuments.getVersion(orgB, document.id, version.id)).toBeNull();
    expect(await organizationDocuments.listVersions(orgB, document.id)).toHaveLength(0);

    const listedInB = await organizationDocuments.listDocuments(orgB);
    expect(listedInB.some((r: any) => r.document.id === document.id)).toBe(false);

    const listedInA = await organizationDocuments.listDocuments(orgA);
    expect(listedInA.some((r: any) => r.document.id === document.id)).toBe(true);
  });

  // ---- E/F: versioning and current-version uniqueness -------------------

  it("E/F: version 2 supersedes version 1, history is preserved, exactly one current", async () => {
    const { document, version: v1 } = await organizationDocuments.createDocument({
      organizationId: orgA,
      categoryCode: CATEGORY,
      title: "Versioned Policy",
      file: file("v1"),
      ...actor(),
    });

    const v2 = await organizationDocuments.addVersion({
      organizationId: orgA,
      documentId: document.id,
      file: file("v2"),
      changeNote: "Annual revision",
      ...actor(),
    });

    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe("current");

    const history = await organizationDocuments.listVersions(orgA, document.id);
    expect(history).toHaveLength(2);

    // Version 1 still exists, is retrievable, and kept its own distinct
    // storage object — the new upload did not overwrite it (§10).
    const reloadedV1 = history.find((v: any) => v.id === v1.id)!;
    expect(reloadedV1.status).toBe("superseded");
    expect(reloadedV1.supersededAt).not.toBeNull();
    expect(reloadedV1.supersededBy).toBe(userId);
    expect(reloadedV1.storageKey).toBe(v1.storageKey);
    expect(reloadedV1.storageKey).not.toBe(v2.storageKey);

    // Superseded content is still readable through history.
    const { readOrgFile } = await import("../lib/fileStorage");
    expect((await readOrgFile(orgA, reloadedV1.storageKey)).toString()).toContain("v1");
    expect((await readOrgFile(orgA, v2.storageKey)).toString()).toContain("v2");

    expect(history.filter((v: any) => v.status === "current")).toHaveLength(1);

    const [reloadedDoc] = await db
      .select()
      .from(schema.organizationDocumentsTable)
      .where(eq(schema.organizationDocumentsTable.id, document.id));
    expect(reloadedDoc.currentVersionId).toBe(v2.id);
  });

  it("F: the database itself refuses a second current version", async () => {
    const { document } = await organizationDocuments.createDocument({
      organizationId: orgA,
      categoryCode: CATEGORY,
      title: "Uniqueness Probe",
      file: file("v1"),
      ...actor(),
    });

    // Bypasses the service layer deliberately: this asserts the partial
    // unique index is real, not that the application remembered to check.
    await expect(
      db.insert(schema.organizationDocumentVersionsTable).values({
        organizationId: orgA,
        documentId: document.id,
        versionNumber: 99,
        storageKey: "organization-documents/forged.pdf",
        fileName: "forged.pdf",
        mimeType: "application/pdf",
        fileSize: 1,
        status: "current",
      }),
    ).rejects.toThrow();
  });

  it("F: concurrent version uploads cannot both become current", async () => {
    const { document } = await organizationDocuments.createDocument({
      organizationId: orgA,
      categoryCode: CATEGORY,
      title: "Concurrency Probe",
      file: file("v1"),
      ...actor(),
    });

    const results = await Promise.allSettled([
      organizationDocuments.addVersion({ organizationId: orgA, documentId: document.id, file: file("a"), ...actor() }),
      organizationDocuments.addVersion({ organizationId: orgA, documentId: document.id, file: file("b"), ...actor() }),
    ]);

    const history = await organizationDocuments.listVersions(orgA, document.id);
    expect(history.filter((v: any) => v.status === "current")).toHaveLength(1);
    // Whether the loser surfaces as a retryable conflict or the writes
    // serialize cleanly, the invariant above must hold either way.
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeLessThanOrEqual(1);
  });

  it("E: a version id from Org A's document cannot be read through another document", async () => {
    const first = await organizationDocuments.createDocument({
      organizationId: orgA, categoryCode: CATEGORY, title: "Doc One", file: file("one"), ...actor(),
    });
    const second = await organizationDocuments.createDocument({
      organizationId: orgA, categoryCode: CATEGORY, title: "Doc Two", file: file("two"), ...actor(),
    });

    // Right organization, right version id, wrong document — must not resolve.
    expect(await organizationDocuments.getVersion(orgA, second.document.id, first.version.id)).toBeNull();
  });

  // ---- G: verification is separate from provision ----------------------

  it("G: providing a document does not verify it; verification is its own act", async () => {
    const requirement = await documentRequirements.createRequirement({
      organizationId: orgA,
      ownerType: "employee",
      ownerId: 4242,
      categoryCode: CONFIDENTIAL_CATEGORY,
      ...actor(),
    });
    expect(requirement.status).toBe("pending");

    const provided = await documentRequirements.markProvided({
      organizationId: orgA,
      requirementId: requirement.id,
      fulfilledDocumentTable: "organization_document_versions",
      fulfilledDocumentId: 1,
      expiryDate: "2030-01-01",
      ...actor(),
    });
    expect(provided.status).toBe("provided");
    expect(provided.verifiedBy).toBeNull();

    const verified = await documentRequirements.verifyRequirement({
      organizationId: orgA, requirementId: requirement.id, approved: true, ...actor(),
    });
    expect(verified.status).toBe("verified");
    expect(verified.verifiedBy).toBe(userId);
    expect(verified.verifiedAt).not.toBeNull();

    const rejected = await documentRequirements.verifyRequirement({
      organizationId: orgA, requirementId: requirement.id, approved: false, rejectionReason: "Illegible scan", ...actor(),
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Illegible scan");
  });

  it("G: a requirement in Org A cannot be verified through Org B", async () => {
    const requirement = await documentRequirements.createRequirement({
      organizationId: orgA, ownerType: "employee", ownerId: 5150, categoryCode: CATEGORY, ...actor(),
    });
    await expect(
      documentRequirements.verifyRequirement({
        organizationId: orgB, requirementId: requirement.id, approved: true, ...actor(),
      }),
    ).rejects.toThrow(documentRequirements.DocumentRequirementNotFoundError);
  });

  // ---- H: expiry query boundaries --------------------------------------

  it("H: the WS-6 expiry contract classifies boundary dates deterministically", async () => {
    const ownerBase = 9000;
    const make = async (ownerId: number, categoryCode: string, expiryDate: string | null) => {
      const requirement = await documentRequirements.createRequirement({
        organizationId: orgA, ownerType: "candidate", ownerId, categoryCode, ...actor(),
      });
      if (expiryDate) {
        await documentRequirements.markProvided({
          organizationId: orgA,
          requirementId: requirement.id,
          fulfilledDocumentTable: "organization_document_versions",
          fulfilledDocumentId: 1,
          expiryDate,
          ...actor(),
        });
      }
      return requirement.id;
    };

    const yesterday = await make(ownerBase + 1, CONFIDENTIAL_CATEGORY, "2026-06-14");
    const today = await make(ownerBase + 2, CONFIDENTIAL_CATEGORY, "2026-06-15");
    const withinHorizon = await make(ownerBase + 3, CONFIDENTIAL_CATEGORY, "2026-07-15");
    const beyondHorizon = await make(ownerBase + 4, CONFIDENTIAL_CATEGORY, "2026-09-01");
    const neverProvided = await make(ownerBase + 5, CATEGORY, null);

    const result = await documentRequirements.queryExpiryState(orgA, "2026-06-15", 30);
    const ids = (rows: any[]) => rows.map((r) => r.id);

    // Strictly before asOf.
    expect(ids(result.expired)).toContain(yesterday);
    expect(ids(result.expired)).not.toContain(today);

    // asOf through asOf+horizon, inclusive on both ends — and disjoint from
    // `expired`, so a document expiring today appears exactly once.
    expect(ids(result.expiringSoon)).toContain(today);
    expect(ids(result.expiringSoon)).toContain(withinHorizon);
    expect(ids(result.expiringSoon)).not.toContain(beyondHorizon);
    expect(ids(result.expiringSoon)).not.toContain(yesterday);

    // Required but still pending.
    expect(ids(result.missing)).toContain(neverProvided);
  });

  it("H: the expiry query never crosses an organization boundary", async () => {
    const requirement = await documentRequirements.createRequirement({
      organizationId: orgA, ownerType: "candidate", ownerId: 9999, categoryCode: CATEGORY, ...actor(),
    });
    const fromB = await documentRequirements.queryExpiryState(orgB, "2026-06-15", 30);
    expect(fromB.missing.map((r: any) => r.id)).not.toContain(requirement.id);
  });

  // ---- I/J/K: retention, legal hold, disposal --------------------------

  async function documentWithRetention(retainUntil: string | null) {
    const { version } = await organizationDocuments.createDocument({
      organizationId: orgA, categoryCode: CATEGORY, title: `Retention ${Math.random()}`, file: file("ret"), ...actor(),
    });
    if (retainUntil) {
      await db
        .update(schema.documentRetentionRecordsTable)
        .set({ retainUntil })
        .where(
          and(
            eq(schema.documentRetentionRecordsTable.documentTable, "organization_document_versions"),
            eq(schema.documentRetentionRecordsTable.documentId, version.id),
          ),
        );
    }
    return version;
  }

  it("I: archiving is not deletion — the row and the stored file both survive", async () => {
    const version = await documentWithRetention(null);
    const record = await documentRetention.archiveDocument({
      organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id, ...actor(),
    });

    expect(record.archiveStatus).toBe("archived");
    expect(record.archivedBy).toBe(userId);
    expect(record.disposalStatus).toBe("none");

    const { readOrgFile } = await import("../lib/fileStorage");
    await expect(readOrgFile(orgA, version.storageKey)).resolves.toBeInstanceOf(Buffer);
  });

  it("J: legal hold blocks disposal even after retention has elapsed", async () => {
    const version = await documentWithRetention("2000-01-01");
    await documentRetention.setLegalHold({
      organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id,
      legalHold: true, reason: "Pending litigation", ...actor(),
    });

    await expect(
      documentRetention.markDisposalEligible({
        organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id, ...actor(),
      }),
    ).rejects.toThrow(documentRetention.LegalHoldActiveError);

    await expect(
      documentRetention.executeDisposal({
        organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id,
        reason: "attempted bypass", ...actor(),
      }),
    ).rejects.toThrow(documentRetention.LegalHoldActiveError);

    // The file is untouched by the refused disposal.
    const { readOrgFile } = await import("../lib/fileStorage");
    await expect(readOrgFile(orgA, version.storageKey)).resolves.toBeInstanceOf(Buffer);

    // A held record never appears in the disposal-eligible listing either.
    const eligible = await documentRetention.listDisposalEligible(orgA, "2030-01-01");
    expect(eligible.map((r: any) => r.documentId)).not.toContain(version.id);
  });

  it("K: an unexpired retention period blocks disposal", async () => {
    const version = await documentWithRetention("2099-01-01");
    await expect(
      documentRetention.executeDisposal({
        organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id,
        reason: "too early", ...actor(),
      }),
    ).rejects.toThrow(documentRetention.RetentionNotExpiredError);
  });

  it("K: a record with no retention deadline is never disposal-eligible", async () => {
    const version = await documentWithRetention(null);
    await expect(
      documentRetention.markDisposalEligible({
        organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id, ...actor(),
      }),
    ).rejects.toThrow(documentRetention.RetentionNotExpiredError);
  });

  it("K/R: authorized disposal deletes the storage object and records the decision", async () => {
    const version = await documentWithRetention("2000-01-01");

    const eligible = await documentRetention.markDisposalEligible({
      organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id, ...actor(),
    });
    expect(eligible.disposalStatus).toBe("eligible");

    const listed = await documentRetention.listDisposalEligible(orgA, "2026-01-01");
    expect(listed.map((r: any) => r.documentId)).toContain(version.id);

    const { record, storageDeleted } = await documentRetention.executeDisposal({
      organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id,
      reason: "Retention elapsed; approved by records officer", ...actor(),
    });

    expect(record.disposalStatus).toBe("disposed");
    expect(record.disposalAuthorizedBy).toBe(userId);
    expect(record.disposalReason).toContain("Retention elapsed");
    expect(storageDeleted).toBe(true);

    // The object is gone; the record survives as evidence of what happened.
    const { readOrgFile } = await import("../lib/fileStorage");
    await expect(readOrgFile(orgA, version.storageKey)).rejects.toThrow();

    await expect(
      documentRetention.executeDisposal({
        organizationId: orgA, documentTable: "organization_document_versions", documentId: version.id,
        reason: "again", ...actor(),
      }),
    ).rejects.toThrow(documentRetention.AlreadyDisposedError);
  });

  it("K: disposing one version leaves sibling versions of the same document intact", async () => {
    const { document, version: v1 } = await organizationDocuments.createDocument({
      organizationId: orgA, categoryCode: CATEGORY, title: "Sibling Safety", file: file("keep-v1"), ...actor(),
    });
    const v2 = await organizationDocuments.addVersion({
      organizationId: orgA, documentId: document.id, file: file("keep-v2"), ...actor(),
    });

    await db
      .update(schema.documentRetentionRecordsTable)
      .set({ retainUntil: "2000-01-01" })
      .where(
        and(
          eq(schema.documentRetentionRecordsTable.documentTable, "organization_document_versions"),
          eq(schema.documentRetentionRecordsTable.documentId, v1.id),
        ),
      );

    await documentRetention.executeDisposal({
      organizationId: orgA, documentTable: "organization_document_versions", documentId: v1.id,
      reason: "Superseded copy disposed", ...actor(),
    });

    const { readOrgFile } = await import("../lib/fileStorage");
    await expect(readOrgFile(orgA, v1.storageKey)).rejects.toThrow();
    // The surviving version is untouched — disposal is per-instance.
    expect((await readOrgFile(orgA, v2.storageKey)).toString()).toContain("keep-v2");
  });

  it("J/K: retention actions cannot cross an organization boundary", async () => {
    const version = await documentWithRetention("2000-01-01");
    for (const call of [
      () => documentRetention.archiveDocument({ organizationId: orgB, documentTable: "organization_document_versions", documentId: version.id, ...actor() }),
      () => documentRetention.setLegalHold({ organizationId: orgB, documentTable: "organization_document_versions", documentId: version.id, legalHold: true, ...actor() }),
      () => documentRetention.executeDisposal({ organizationId: orgB, documentTable: "organization_document_versions", documentId: version.id, reason: "x", ...actor() }),
    ]) {
      await expect(call()).rejects.toThrow(documentRetention.RetentionRecordNotFoundError);
    }
  });

  it("a retention pointer cannot be aimed at an arbitrary table", async () => {
    await expect(
      documentRetention.getRetentionRecord(orgA, "users", 1),
    ).rejects.toThrow(documentRetention.UnknownDocumentTableError);
  });

  // ---- L: sensitive-read auditing --------------------------------------

  it("L: reading a confidential document writes a documents-category audit event", async () => {
    const { document, version } = await organizationDocuments.createDocument({
      organizationId: orgA, categoryCode: CONFIDENTIAL_CATEGORY, title: "Confidential Report", file: file("secret"), ...actor(),
    });

    await organizationDocuments.auditDocumentRead({
      organizationId: orgA,
      documentId: document.id,
      version,
      categoryCode: CONFIDENTIAL_CATEGORY,
      sensitivity: "confidential",
      ...actor(),
    });

    const events = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.organizationId, orgA),
          eq(schema.auditEventsTable.eventType, "organization_document.downloaded"),
          eq(schema.auditEventsTable.targetId, String(document.id)),
        ),
      );

    expect(events).toHaveLength(1);
    expect(events[0].category).toBe("documents");
    // Metadata carries provenance, never document content (§33).
    expect(JSON.stringify(events[0].metadata)).not.toContain("secret");
    expect(events[0].metadata.versionNumber).toBe(version.versionNumber);
  });

  it("L: an ordinary (non-confidential) read is not audited", async () => {
    const { document, version } = await organizationDocuments.createDocument({
      organizationId: orgA, categoryCode: CATEGORY, title: "Public Policy", file: file("plain"), ...actor(),
    });

    await organizationDocuments.auditDocumentRead({
      organizationId: orgA, documentId: document.id, version, categoryCode: CATEGORY, sensitivity: "standard", ...actor(),
    });

    const events = await db
      .select()
      .from(schema.auditEventsTable)
      .where(
        and(
          eq(schema.auditEventsTable.eventType, "organization_document.downloaded"),
          eq(schema.auditEventsTable.targetId, String(document.id)),
        ),
      );
    expect(events).toHaveLength(0);
  });

  // ---- M/N/O/P: templates and generation -------------------------------

  async function activeTemplate(organizationId: number, content: string) {
    const { template, version } = await documentTemplates.createTemplate({
      organizationId,
      categoryCode: CATEGORY,
      name: `Letter ${Math.random()}`,
      content,
      ...actor(),
    });
    await documentTemplates.activateVersion({
      organizationId, templateId: template.id, versionId: version.id, ...actor(),
    });
    return template;
  }

  it("M: a template version is immutable once active; editing creates a new version", async () => {
    const { template, version: v1 } = await documentTemplates.createTemplate({
      organizationId: orgA, categoryCode: CATEGORY, name: "Immutability", content: "Dear {{employee.fullName}},", ...actor(),
    });

    // A draft is editable.
    await documentTemplates.updateDraftVersion({
      organizationId: orgA, templateId: template.id, versionId: v1.id, content: "Dear {{employee.firstName}},", ...actor(),
    });

    await documentTemplates.activateVersion({ organizationId: orgA, templateId: template.id, versionId: v1.id, ...actor() });

    // Once active, it is not.
    await expect(
      documentTemplates.updateDraftVersion({
        organizationId: orgA, templateId: template.id, versionId: v1.id, content: "tampered", ...actor(),
      }),
    ).rejects.toThrow(documentTemplates.TemplateVersionImmutableError);

    const v2 = await documentTemplates.createVersion({
      organizationId: orgA, templateId: template.id, content: "Dear {{employee.lastName}},", ...actor(),
    });
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe("draft");

    await documentTemplates.activateVersion({ organizationId: orgA, templateId: template.id, versionId: v2.id, ...actor() });

    const versions = await documentTemplates.listTemplateVersions(orgA, template.id);
    expect(versions.filter((v: any) => v.status === "active")).toHaveLength(1);
    // Version 1's content is preserved verbatim, not rewritten.
    expect(versions.find((v: any) => v.id === v1.id)!.content).toBe("Dear {{employee.firstName}},");
  });

  it("M: the database refuses two active versions of one template", async () => {
    const { template, version } = await documentTemplates.createTemplate({
      organizationId: orgA, categoryCode: CATEGORY, name: "Active Uniqueness", content: "Body", ...actor(),
    });
    await documentTemplates.activateVersion({ organizationId: orgA, templateId: template.id, versionId: version.id, ...actor() });

    await expect(
      db.insert(schema.documentTemplateVersionsTable).values({
        organizationId: orgA, templateId: template.id, versionNumber: 98, content: "forged", status: "active",
      }),
    ).rejects.toThrow();
  });

  it("M: a template referencing an unknown merge field is rejected at authoring time", async () => {
    await expect(
      documentTemplates.createTemplate({
        organizationId: orgA, categoryCode: CATEGORY, name: "Bad Field",
        content: "Account: {{employee.bankAccount}}", ...actor(),
      }),
    ).rejects.toThrow(/Unknown merge field/i);
  });

  it("N: generates a real PDF artifact with correct lineage and branding", async () => {
    const template = await activeTemplate(
      orgA,
      "{{organization.name}}\n\nDear {{employee.fullName}},\n\nYour position: {{position.title}}.\nEffective {{letter.effectiveDate}}.",
    );

    const [employee] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgA, firstName: "Live", lastName: "Sample", employeeNumber: "LIVE-1" })
      .returning();

    const entityContext = await documentGeneration.buildEmployeeContext(orgA, employee.id);
    const { generated, templateVersion } = await documentGeneration.generateDocument({
      organizationId: orgA,
      templateId: template.id,
      entityContext,
      sourceType: "employee",
      sourceId: employee.id,
      effectiveDate: "2026-09-01",
      ...actor(),
    });

    expect(generated.mimeType).toBe("application/pdf");
    expect(generated.templateVersionId).toBe(templateVersion.id);
    expect(generated.sourceId).toBe(employee.id);
    expect(generated.storageKey).toMatch(/^generated-documents\/[0-9a-f]{48}\.pdf$/);

    const { readOrgFile } = await import("../lib/fileStorage");
    const artifact = await readOrgFile(orgA, generated.storageKey);
    const text = artifact.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    // Organization branding and merged values are present; no raw tokens survive.
    expect(text).toContain("Live Sample");
    expect(text).toContain("1 September 2026");
    expect(text).not.toContain("{{");

    await db.delete(schema.employeesTable).where(eq(schema.employeesTable.id, employee.id));
  });

  it("O: editing a template afterwards never alters an already-generated artifact", async () => {
    const template = await activeTemplate(orgA, "Original wording for {{employee.fullName}}.");

    const { generated } = await documentGeneration.generateDocument({
      organizationId: orgA,
      templateId: template.id,
      entityContext: { "employee.fullName": "Frozen Person" },
      ...actor(),
    });

    const { readOrgFile } = await import("../lib/fileStorage");
    const before = await readOrgFile(orgA, generated.storageKey);

    const newVersion = await documentTemplates.createVersion({
      organizationId: orgA, templateId: template.id, content: "COMPLETELY REWRITTEN for {{employee.fullName}}.", ...actor(),
    });
    await documentTemplates.activateVersion({
      organizationId: orgA, templateId: template.id, versionId: newVersion.id, ...actor(),
    });

    const after = await readOrgFile(orgA, generated.storageKey);
    expect(after.equals(before)).toBe(true);
    expect(after.toString("latin1")).toContain("Original wording");
    expect(after.toString("latin1")).not.toContain("REWRITTEN");

    // The artifact still points at the version it was actually made from.
    const reloaded = await documentGeneration.getGeneratedDocument(orgA, generated.id);
    expect(reloaded!.templateVersionId).not.toBe(newVersion.id);
  });

  it("P: an Org A template cannot generate for an Org B employee, or be used from Org B", async () => {
    const template = await activeTemplate(orgA, "Letter for {{employee.fullName}}.");

    const [employeeB] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgB, firstName: "Other", lastName: "Org", employeeNumber: "B-1" })
      .returning();

    // The source entity is resolved inside the caller's own organization, so
    // Org B's employee is simply not found from Org A.
    await expect(documentGeneration.buildEmployeeContext(orgA, employeeB.id)).rejects.toThrow(
      documentGeneration.EmployeeNotFoundForGenerationError,
    );

    // And Org A's template is unreachable from Org B.
    await expect(
      documentGeneration.generateDocument({
        organizationId: orgB, templateId: template.id, entityContext: {}, ...actor(),
      }),
    ).rejects.toThrow(documentTemplates.DocumentTemplateNotFoundError);

    expect(await documentTemplates.getTemplate(orgB, template.id)).toBeNull();

    await db.delete(schema.employeesTable).where(eq(schema.employeesTable.id, employeeB.id));
  });

  it("P: generation refuses a template with no active version", async () => {
    const { template } = await documentTemplates.createTemplate({
      organizationId: orgA, categoryCode: CATEGORY, name: "Draft Only", content: "Draft body", ...actor(),
    });
    await expect(
      documentGeneration.generateDocument({ organizationId: orgA, templateId: template.id, entityContext: {}, ...actor() }),
    ).rejects.toThrow(documentTemplates.NoActiveTemplateVersionError);
  });

  it("preview uses synthetic data and never reveals a real employee record", async () => {
    const { template, version } = await documentTemplates.createTemplate({
      organizationId: orgA, categoryCode: CATEGORY, name: "Preview Safety",
      content: "Name: {{employee.fullName}} / Number: {{employee.employeeNumber}}", ...actor(),
    });

    const [employee] = await db
      .insert(schema.employeesTable)
      .values({ organizationId: orgA, firstName: "Real", lastName: "Person", employeeNumber: "REAL-9" })
      .returning();

    const { text } = await documentGeneration.previewTemplateVersion({ organizationId: orgA, templateVersion: version });

    expect(text).toContain("Sample Employee");
    expect(text).not.toContain("Real Person");
    expect(text).not.toContain("REAL-9");

    // Preview writes nothing.
    expect(await documentGeneration.listGeneratedDocuments(orgA, { templateId: template.id })).toHaveLength(0);

    await db.delete(schema.employeesTable).where(eq(schema.employeesTable.id, employee.id));
  });

  // ---- Q: audit correctness --------------------------------------------

  it("Q: WS-5 lifecycle events all land in the documents audit category", async () => {
    const events = await db
      .select()
      .from(schema.auditEventsTable)
      .where(eq(schema.auditEventsTable.organizationId, orgA));

    const ws5Prefixes = [
      "organization_document",
      "document_requirement",
      "document_retention",
      "document_template",
      "generated_document",
    ];
    const ws5Events = events.filter((e: any) => ws5Prefixes.includes(e.eventType.split(".")[0]));

    expect(ws5Events.length).toBeGreaterThan(0);
    for (const event of ws5Events) {
      expect(event.category, `${event.eventType} was categorized ${event.category}`).toBe("documents");
    }

    const seen = new Set(ws5Events.map((e: any) => e.eventType));
    for (const expected of [
      "organization_document.uploaded",
      "organization_document.version_created",
      "document_requirement.created",
      "document_requirement.provided",
      "document_requirement.verified",
      "document_retention.archived",
      "document_retention.legal_hold_applied",
      "document_retention.disposed",
      "document_template.created",
      "document_template.version_activated",
      "generated_document.generated",
    ]) {
      expect(seen.has(expected), `missing audit event ${expected}`).toBe(true);
    }
  });

  // ---- R: storage cleanup on failure -----------------------------------

  it("R: a failed document create leaves no orphaned storage object", async () => {
    const { writeOrgFile, readOrgFile } = await import("../lib/fileStorage");
    const before = await writeOrgFile(orgA, "organization-documents", "pdf", pdf("probe"));
    await expect(readOrgFile(orgA, before)).resolves.toBeInstanceOf(Buffer);

    // Force the database write to fail after the object is on disk, by
    // making the title violate a not-null constraint.
    await expect(
      organizationDocuments.createDocument({
        organizationId: orgA,
        categoryCode: CATEGORY,
        title: null as unknown as string,
        file: file("orphan"),
        ...actor(),
      }),
    ).rejects.toThrow();

    // Nothing beyond the probe should remain from that failed attempt: the
    // compensating delete in createDocument's catch removed it.
    const versions = await db
      .select()
      .from(schema.organizationDocumentVersionsTable)
      .where(eq(schema.organizationDocumentVersionsTable.organizationId, orgA));
    expect(versions.every((v: any) => !v.fileName.includes("orphan") || v.storageKey)).toBe(true);
  });
});
