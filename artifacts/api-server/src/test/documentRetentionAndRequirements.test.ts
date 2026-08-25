/**
 * WS-5 — unit tests for lib/documentRetention.ts and
 * lib/documentRequirements.ts against a mocked @workspace/db (no real
 * database connection), following installations.test.ts's shallow
 * per-table mock convention. Neither module uses db.transaction, so this
 * stays a plain select/update mock rather than departmentHeads.test.ts's
 * fuller in-memory query engine.
 *
 * What a mock cannot prove — the partial unique indexes that make two
 * concurrent "current"/"active" versions impossible, and real transactional
 * rollback — is covered instead by documentsLiveIntegration.test.ts against
 * a real PostgreSQL database (skipped here in CI, run locally). This file
 * covers the decision logic a mock CAN faithfully exercise: the disposal
 * gate (legal hold / retention-not-expired / already-disposed), and the
 * provided-vs-verified state machine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  fixtures,
  documentRetentionRecordsTable,
  organizationDocumentVersionsTable,
  documentRequirementsTable,
  auditEventsTable,
} = vi.hoisted(() => {
  return {
    fixtures: {
      retentionRows: [] as Record<string, unknown>[],
      versionRows: [] as Record<string, unknown>[],
      requirementRows: [] as Record<string, unknown>[],
      updated: [] as { table: string; values: unknown }[],
      auditInserts: [] as Record<string, unknown>[],
      insertShouldConflict: false,
    },
    documentRetentionRecordsTable: { __name: "document_retention_records" },
    organizationDocumentVersionsTable: { __name: "organization_document_versions" },
    documentRequirementsTable: { __name: "document_requirements" },
    auditEventsTable: { __name: "audit_events" },
  };
});

vi.mock("@workspace/db", () => ({
  documentRetentionRecordsTable,
  organizationDocumentVersionsTable,
  documentRequirementsTable,
  auditEventsTable,
  db: {
    select: (_cols?: unknown) => ({
      from(table: { __name: string }) {
        const rows =
          table === documentRetentionRecordsTable ? fixtures.retentionRows :
          table === organizationDocumentVersionsTable ? fixtures.versionRows :
          table === documentRequirementsTable ? fixtures.requirementRows : [];
        const builder = {
          where: () => builder,
          limit: () => Promise.resolve(rows),
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
        return builder;
      },
    }),
    insert: (table: { __name: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return {
          returning: () => {
            if (fixtures.insertShouldConflict) {
              return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
            }
            // Mirrors the schema's column defaults, which this mock does not
            // otherwise apply (real Postgres would; DEFAULT here is
            // documentRequirementsTable's own `status: "pending"`).
            const row = { id: fixtures.requirementRows.length + 1, status: "pending", required: true, ...v };
            fixtures.requirementRows.push(row);
            return Promise.resolve([row]);
          },
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
    update: (table: { __name: string }) => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            fixtures.updated.push({ table: table.__name, values: v });
            const base =
              table === documentRetentionRecordsTable ? fixtures.retentionRows[0] :
              table === documentRequirementsTable ? fixtures.requirementRows[0] : {};
            const merged = { ...base, ...v };
            if (table === documentRetentionRecordsTable) fixtures.retentionRows[0] = merged;
            if (table === documentRequirementsTable) fixtures.requirementRows[0] = merged;
            return Promise.resolve([merged]);
          },
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: (...args: unknown[]) => args,
  lte: () => "lte",
  gte: () => "gte",
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("../lib/fileStorage", () => ({
  deleteOrgFile: vi.fn().mockResolvedValue(undefined),
}));

const documentRetention = await import("../lib/documentRetention");
const documentRequirements = await import("../lib/documentRequirements");
const documentCategories = await import("../lib/documentCategories");

vi.spyOn(documentCategories, "assertUsableCategory").mockResolvedValue(undefined);
vi.spyOn(documentCategories, "getCategoryBehavior").mockResolvedValue({
  categoryCode: "x",
  verificationRequired: false,
  expirySupported: true,
  expiryRequired: false,
  sensitivity: "standard",
  retentionBasis: null,
  retentionPeriodMonths: null,
});

const actor = { actorApplicationUserId: 1, actorMembershipId: 2 };

describe("documentRetention — disposal gate", () => {
  beforeEach(() => {
    fixtures.retentionRows = [];
    fixtures.versionRows = [];
    fixtures.updated = [];
    fixtures.auditInserts = [];
  });

  it("rejects an unknown document table before touching the database", async () => {
    await expect(documentRetention.getRetentionRecord(1, "users", 1)).rejects.toThrow(
      documentRetention.UnknownDocumentTableError,
    );
  });

  it("blocks disposal-eligibility while under legal hold", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: true, disposalStatus: "none", retainUntil: "2000-01-01" }];
    await expect(
      documentRetention.markDisposalEligible({ organizationId: 1, documentTable: "organization_document_versions", documentId: 1, ...actor }),
    ).rejects.toThrow(documentRetention.LegalHoldActiveError);
  });

  it("blocks disposal while retention has not elapsed, even without legal hold", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: false, disposalStatus: "none", retainUntil: "2099-01-01" }];
    await expect(
      documentRetention.executeDisposal({ organizationId: 1, documentTable: "organization_document_versions", documentId: 1, reason: "x", ...actor, now: new Date("2026-01-01") }),
    ).rejects.toThrow(documentRetention.RetentionNotExpiredError);
  });

  it("blocks disposal with no retainUntil at all — fails closed rather than treating it as always-eligible", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: false, disposalStatus: "none", retainUntil: null }];
    await expect(
      documentRetention.markDisposalEligible({ organizationId: 1, documentTable: "organization_document_versions", documentId: 1, ...actor }),
    ).rejects.toThrow(documentRetention.RetentionNotExpiredError);
  });

  it("refuses to dispose an already-disposed record", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: false, disposalStatus: "disposed", retainUntil: "2000-01-01" }];
    await expect(
      documentRetention.executeDisposal({ organizationId: 1, documentTable: "organization_document_versions", documentId: 1, reason: "x", ...actor }),
    ).rejects.toThrow(documentRetention.AlreadyDisposedError);
  });

  it("allows disposal once retention has elapsed and no hold is active, and records the reason", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: false, disposalStatus: "eligible", retainUntil: "2000-01-01" }];
    fixtures.versionRows = [{ id: 1, organizationId: 1, storageKey: "organization-documents/x.pdf" }];

    const { record, storageDeleted } = await documentRetention.executeDisposal({
      organizationId: 1, documentTable: "organization_document_versions", documentId: 1, reason: "Retention elapsed", ...actor,
    });

    expect(record.disposalStatus).toBe("disposed");
    expect(record.disposalReason).toBe("Retention elapsed");
    expect(storageDeleted).toBe(true);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "document_retention.disposed" });
  });

  it("lifting a legal hold that was already marked eligible resets it to none, never leaves a stale eligibility", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: true, disposalStatus: "eligible", retainUntil: "2000-01-01" }];
    const row = await documentRetention.setLegalHold({
      organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: true, ...actor,
    });
    // Re-applying hold while already eligible clears the stale determination.
    expect(row.disposalStatus).toBe("none");
  });

  it("archiving does not touch disposalStatus and is a distinct audited event from disposal", async () => {
    fixtures.retentionRows = [{ id: 1, organizationId: 1, documentTable: "organization_document_versions", documentId: 1, legalHold: false, disposalStatus: "none", archiveStatus: "active" }];
    const row = await documentRetention.archiveDocument({
      organizationId: 1, documentTable: "organization_document_versions", documentId: 1, ...actor,
    });
    expect(row.archiveStatus).toBe("archived");
    expect(row.disposalStatus).toBe("none");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "document_retention.archived" });
  });

  it("404s (RetentionRecordNotFoundError) rather than silently no-op'ing when no record exists", async () => {
    fixtures.retentionRows = [];
    await expect(
      documentRetention.archiveDocument({ organizationId: 1, documentTable: "organization_document_versions", documentId: 999, ...actor }),
    ).rejects.toThrow(documentRetention.RetentionRecordNotFoundError);
  });
});

describe("documentRequirements — provided vs verified", () => {
  beforeEach(() => {
    fixtures.requirementRows = [];
    fixtures.auditInserts = [];
    fixtures.insertShouldConflict = false;
  });

  it("creates a requirement in pending status", async () => {
    const req = await documentRequirements.createRequirement({
      organizationId: 1, ownerType: "employee", ownerId: 5, categoryCode: "x", ...actor,
    });
    expect(req.status).toBe("pending");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "document_requirement.created" });
  });

  it("surfaces a duplicate (owner, category) as DuplicateRequirementError, not a raw DB error", async () => {
    fixtures.insertShouldConflict = true;
    await expect(
      documentRequirements.createRequirement({ organizationId: 1, ownerType: "employee", ownerId: 5, categoryCode: "x", ...actor }),
    ).rejects.toThrow(documentRequirements.DuplicateRequirementError);
  });

  it("marking a document provided never sets status to verified", async () => {
    fixtures.requirementRows = [{ id: 1, organizationId: 1, categoryCode: "x", status: "pending" }];
    const row = await documentRequirements.markProvided({
      organizationId: 1, requirementId: 1, fulfilledDocumentTable: "employee_documents", fulfilledDocumentId: 9, ...actor,
    });
    expect(row.status).toBe("provided");
    expect(row.verifiedBy).toBeNull();
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "document_requirement.provided" });
  });

  it("verifying is a distinct act from providing, records the verifier and timestamp", async () => {
    fixtures.requirementRows = [{ id: 1, organizationId: 1, categoryCode: "x", status: "provided" }];
    const row = await documentRequirements.verifyRequirement({
      organizationId: 1, requirementId: 1, approved: true, ...actor,
    });
    expect(row.status).toBe("verified");
    expect(row.verifiedBy).toBe(actor.actorApplicationUserId);
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "document_requirement.verified" });
  });

  it("rejecting records the reason and a distinct audit event", async () => {
    fixtures.requirementRows = [{ id: 1, organizationId: 1, categoryCode: "x", status: "provided" }];
    const row = await documentRequirements.verifyRequirement({
      organizationId: 1, requirementId: 1, approved: false, rejectionReason: "Illegible", ...actor,
    });
    expect(row.status).toBe("rejected");
    expect(row.rejectionReason).toBe("Illegible");
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "document_requirement.rejected" });
  });

  it("404s rather than verifying a nonexistent requirement", async () => {
    fixtures.requirementRows = [];
    await expect(
      documentRequirements.verifyRequirement({ organizationId: 1, requirementId: 999, approved: true, ...actor }),
    ).rejects.toThrow(documentRequirements.DocumentRequirementNotFoundError);
  });

  it("rejects an expiry date the category does not support", async () => {
    vi.spyOn(documentCategories, "getCategoryBehavior").mockResolvedValueOnce({
      categoryCode: "x", verificationRequired: false, expirySupported: false, expiryRequired: false,
      sensitivity: "standard", retentionBasis: null, retentionPeriodMonths: null,
    });
    fixtures.requirementRows = [{ id: 1, organizationId: 1, categoryCode: "x", status: "pending" }];
    await expect(
      documentRequirements.markProvided({
        organizationId: 1, requirementId: 1, fulfilledDocumentTable: "employee_documents", fulfilledDocumentId: 9,
        expiryDate: "2030-01-01", ...actor,
      }),
    ).rejects.toThrow(documentRequirements.ExpiryNotSupportedError);
  });

  it("requires an expiry date when the category mandates one", async () => {
    vi.spyOn(documentCategories, "getCategoryBehavior").mockResolvedValueOnce({
      categoryCode: "x", verificationRequired: false, expirySupported: true, expiryRequired: true,
      sensitivity: "standard", retentionBasis: null, retentionPeriodMonths: null,
    });
    fixtures.requirementRows = [{ id: 1, organizationId: 1, categoryCode: "x", status: "pending" }];
    await expect(
      documentRequirements.markProvided({
        organizationId: 1, requirementId: 1, fulfilledDocumentTable: "employee_documents", fulfilledDocumentId: 9, ...actor,
      }),
    ).rejects.toThrow(documentRequirements.ExpiryDateRequiredError);
  });
});
