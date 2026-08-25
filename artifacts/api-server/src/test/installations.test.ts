/**
 * WS-4 (Installation Registry, Owner Decision #29) — unit tests for
 * lib/installations.ts against a mocked @workspace/db (no real database
 * connection), following the same returning()-based mock convention as
 * lib/organizationDomains.ts's own test file.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { fixtures, installationsTable, installationOrganizationsTable, organizationsTable, auditEventsTable } = vi.hoisted(() => {
  return {
    fixtures: {
      installationRows: [] as Record<string, unknown>[],
      linkRows: [] as Record<string, unknown>[],
      orgRows: [] as Record<string, unknown>[],
      inserted: [] as { table: string; values: unknown }[],
      updated: [] as { table: string; values: unknown }[],
      auditInserts: [] as Record<string, unknown>[],
      insertShouldConflict: false,
    },
    installationsTable: { __name: "installations" },
    installationOrganizationsTable: { __name: "installation_organizations" },
    organizationsTable: { __name: "organizations" },
    auditEventsTable: { __name: "audit_events" },
  };
});

vi.mock("@workspace/db", () => ({
  installationsTable,
  installationOrganizationsTable,
  organizationsTable,
  auditEventsTable,
  db: {
    select: (_cols?: unknown) => ({
      from(table: { __name: string }) {
        const rows =
          table === installationsTable ? fixtures.installationRows :
          table === installationOrganizationsTable ? fixtures.linkRows :
          table === organizationsTable ? fixtures.orgRows : [];
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
        // recordAuditEvent() never calls .returning() — it just awaits the
        // insert directly — so the audit-events side effect must happen
        // here, unconditionally, not only inside returning() below.
        if (table === auditEventsTable) fixtures.auditInserts.push(v);
        return {
          returning: () => {
            if (fixtures.insertShouldConflict) {
              return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
            }
            const row = { id: (table === installationsTable ? fixtures.installationRows.length : fixtures.linkRows.length) + 1, ...v };
            fixtures.inserted.push({ table: table.__name, values: row });
            if (table === installationsTable) fixtures.installationRows.push(row);
            if (table === installationOrganizationsTable) fixtures.linkRows.push(row);
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
            const base = table === installationsTable ? fixtures.installationRows[0] : fixtures.linkRows[0];
            return Promise.resolve([{ ...base, ...v }]);
          },
        }),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => "eq",
  and: () => "and",
  isNull: () => "isNull",
}));

const {
  createInstallation,
  updateInstallation,
  linkOrganization,
  unlinkOrganization,
  getInstallationById,
  DuplicateInstallationKeyError,
  InstallationNotFoundError,
  OrganizationNotFoundError,
  OrganizationAlreadyLinkedError,
  OrganizationNotLinkedError,
} = await import("../lib/installations");

describe("installations service", () => {
  beforeEach(() => {
    fixtures.installationRows = [];
    fixtures.linkRows = [];
    fixtures.orgRows = [];
    fixtures.inserted = [];
    fixtures.updated = [];
    fixtures.auditInserts = [];
    fixtures.insertShouldConflict = false;
  });

  it("createInstallation generates an installationKey when none is supplied", async () => {
    const installation = await createInstallation(
      { name: "QA", environmentType: "development", hostingModel: "shared" },
      1,
    );
    expect(typeof installation.installationKey).toBe("string");
    expect(installation.installationKey.length).toBeGreaterThan(0);
  });

  it("createInstallation preserves a caller-supplied installationKey", async () => {
    const installation = await createInstallation(
      { installationKey: "wwm-prod", name: "WWM Production", environmentType: "production", hostingModel: "dedicated_owner_managed" },
      1,
    );
    expect(installation.installationKey).toBe("wwm-prod");
  });

  it("createInstallation records installation.created", async () => {
    await createInstallation({ name: "QA", environmentType: "development", hostingModel: "shared" }, 7);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "installation.created", actorApplicationUserId: 7 });
  });

  it("createInstallation surfaces a duplicate installationKey as DuplicateInstallationKeyError, not a raw DB error", async () => {
    fixtures.insertShouldConflict = true;
    await expect(
      createInstallation({ installationKey: "dupe", name: "QA", environmentType: "development", hostingModel: "shared" }, 1),
    ).rejects.toThrow(DuplicateInstallationKeyError);
  });

  it("updateInstallation 404s when the installation doesn't exist", async () => {
    fixtures.installationRows = [];
    await expect(updateInstallation(999, { name: "X" }, 1)).rejects.toThrow(InstallationNotFoundError);
  });

  it("updateInstallation records installation.status_changed distinctly from installation.updated", async () => {
    fixtures.installationRows = [
      { id: 1, installationKey: "k", name: "QA", environmentType: "development", hostingModel: "shared", status: "active" },
    ];
    await updateInstallation(1, { status: "decommissioned" }, 1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "installation.status_changed" });

    fixtures.auditInserts = [];
    await updateInstallation(1, { name: "Renamed" }, 1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "installation.updated" });
  });

  it("linkOrganization 404s when the installation doesn't exist", async () => {
    fixtures.installationRows = [];
    fixtures.orgRows = [{ id: 1, name: "Acme", slug: "acme" }];
    await expect(linkOrganization(999, 1, 1)).rejects.toThrow(InstallationNotFoundError);
  });

  it("linkOrganization 404s when the organization doesn't exist", async () => {
    fixtures.installationRows = [{ id: 1, installationKey: "k", status: "active" }];
    fixtures.orgRows = [];
    await expect(linkOrganization(1, 999, 1)).rejects.toThrow(OrganizationNotFoundError);
  });

  it("linkOrganization records installation.organization_linked", async () => {
    fixtures.installationRows = [{ id: 1, installationKey: "k", status: "active" }];
    fixtures.orgRows = [{ id: 5, name: "Acme", slug: "acme" }];
    await linkOrganization(1, 5, 1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "installation.organization_linked", organizationId: 5 });
  });

  it("linkOrganization surfaces a duplicate active link as OrganizationAlreadyLinkedError", async () => {
    fixtures.installationRows = [{ id: 1, installationKey: "k", status: "active" }];
    fixtures.orgRows = [{ id: 5, name: "Acme", slug: "acme" }];
    fixtures.insertShouldConflict = true;
    await expect(linkOrganization(1, 5, 1)).rejects.toThrow(OrganizationAlreadyLinkedError);
  });

  it("unlinkOrganization 404s (OrganizationNotLinkedError) when there is no active link", async () => {
    fixtures.linkRows = [];
    await expect(unlinkOrganization(1, 5, 1)).rejects.toThrow(OrganizationNotLinkedError);
  });

  it("unlinkOrganization records installation.organization_unlinked", async () => {
    fixtures.linkRows = [{ id: 3, installationId: 1, organizationId: 5, unlinkedAt: null }];
    await unlinkOrganization(1, 5, 1);
    expect(fixtures.auditInserts[0]).toMatchObject({ eventType: "installation.organization_unlinked", organizationId: 5 });
  });

  it("getInstallationById returns null for an unknown id", async () => {
    fixtures.installationRows = [];
    await expect(getInstallationById(999)).resolves.toBeNull();
  });
});
