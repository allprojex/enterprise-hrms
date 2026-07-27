import { and, eq, isNull, or } from "drizzle-orm";
import { db, masterDataDomainsTable, masterDataItemsTable } from "@workspace/db";
import { recordAuditEvent } from "./auditLog";
import { isUniqueViolation } from "./dbErrors";

export class MasterDataDomainNotFoundError extends Error {
  constructor(domain: string) {
    super(`Unknown master data domain "${domain}"`);
    this.name = "MasterDataDomainNotFoundError";
  }
}

export class MasterDataDomainNotWritableError extends Error {
  constructor(domain: string) {
    super(`Domain "${domain}" is system-defined and does not accept organization-added items`);
    this.name = "MasterDataDomainNotWritableError";
  }
}

export class MasterDataItemAlreadyExistsError extends Error {
  constructor(domain: string, code: string) {
    super(`An item with code "${code}" already exists for domain "${domain}" in this organization`);
    this.name = "MasterDataItemAlreadyExistsError";
  }
}

export async function listMasterDataDomains() {
  return db.select().from(masterDataDomainsTable);
}

async function findDomain(domain: string) {
  const [row] = await db.select().from(masterDataDomainsTable).where(eq(masterDataDomainsTable.key, domain)).limit(1);
  return row ?? null;
}

/** System rows (organizationId null) plus this organization's own rows, sorted by sortOrder. */
export async function listMasterDataItems(organizationId: number, domain: string) {
  if (!(await findDomain(domain))) {
    throw new MasterDataDomainNotFoundError(domain);
  }

  const rows = await db
    .select()
    .from(masterDataItemsTable)
    .where(
      and(
        eq(masterDataItemsTable.domain, domain),
        or(isNull(masterDataItemsTable.organizationId), eq(masterDataItemsTable.organizationId, organizationId)),
      ),
    );

  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function createMasterDataItem(params: {
  organizationId: number;
  domain: string;
  code: string;
  label: string;
  sortOrder?: number;
  actorApplicationUserId: number;
  actorMembershipId: number;
}) {
  const domainRow = await findDomain(params.domain);
  if (!domainRow) {
    throw new MasterDataDomainNotFoundError(params.domain);
  }
  if (domainRow.classification === "system-defined") {
    throw new MasterDataDomainNotWritableError(params.domain);
  }

  let item;
  try {
    [item] = await db
      .insert(masterDataItemsTable)
      .values({
        organizationId: params.organizationId,
        domain: params.domain,
        code: params.code,
        label: params.label,
        sortOrder: params.sortOrder ?? 0,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new MasterDataItemAlreadyExistsError(params.domain, params.code);
    }
    throw err;
  }

  await recordAuditEvent({
    actorApplicationUserId: params.actorApplicationUserId,
    actorMembershipId: params.actorMembershipId,
    organizationId: params.organizationId,
    eventType: "master_data_item.created",
    targetType: "master_data_item",
    targetId: String(item.id),
    afterState: item,
  });

  return item;
}
