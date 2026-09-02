/**
 * WS-18 Pass 2 §26 — reusable adversarial security fixtures.
 *
 * Every security suite in this directory needs the same cast: two organizations
 * that must never see each other, a spread of authority levels inside each, and
 * the platform-level actors that sit outside both. Rebuilding that per file (the
 * pattern the older single-purpose suites use) makes each new adversarial test
 * expensive to write and easy to get subtly wrong — and a subtly wrong security
 * test is worse than none, because it reports green.
 *
 * This module provides:
 *
 *   - `createEngine()`   a small in-memory query engine covering the Drizzle
 *                        surface the authorization chain actually uses;
 *   - `seedTwoOrgs()`    the deterministic Org A / Org B fixture;
 *   - `bearer()`         session tokens for each seeded actor.
 *
 * ## The false-green problem, and how this handles it
 *
 * A mocked database can make a security test pass for the wrong reason: if the
 * mock cannot answer a route's query it may throw, the route may 500, and a test
 * asserting "not 200" goes green while proving nothing about authorization.
 *
 * Two rules keep that from happening, and callers must honour both:
 *
 *   1. Assert the SPECIFIC denial status (403/404), never merely `not 200`, and
 *      never accept 500 as a pass. `expectDenied()` enforces this.
 *   2. Pair every negative case with a POSITIVE CONTROL — the same route, same
 *      shape, with a legitimately entitled same-organization actor — and assert
 *      it succeeds. If the positive control fails, the negative result is
 *      meaningless and the suite must fail. `expectAllowed()` enforces this.
 *
 * A denial that is not accompanied by a passing positive control proves only
 * that the route is broken, not that it is secure.
 */
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Condition algebra — mirrors the drizzle-orm operators the chain uses.
// ---------------------------------------------------------------------------

export type Cond =
  | { __op: "eq"; field: string; val: unknown }
  | { __op: "ne"; field: string; val: unknown }
  | { __op: "gt"; field: string; val: unknown }
  | { __op: "gte"; field: string; val: unknown }
  | { __op: "lt"; field: string; val: unknown }
  | { __op: "lte"; field: string; val: unknown }
  | { __op: "isNull"; field: string }
  | { __op: "isNotNull"; field: string }
  | { __op: "inArray"; field: string; vals: unknown[] }
  | { __op: "and"; conds: (Cond | undefined)[] }
  | { __op: "or"; conds: (Cond | undefined)[] }
  | undefined;

/** Drop the `table.` prefix drizzle column references carry in these mocks. */
function col(field: string): string {
  const dot = field.indexOf(".");
  return dot === -1 ? field : field.slice(dot + 1);
}

function asTime(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Resolves the right-hand side of a comparison.
 *
 * Drizzle uses the same `eq()` for a column-to-literal filter and a
 * column-to-column join predicate (`eq(sessions.userId, users.id)`). In these
 * mocks a column reference arrives as the string "table.column", so a bare
 * string that names a column actually present on the row is treated as a
 * reference to that column's value rather than as a literal. Anything else —
 * including a string that merely contains a dot, such as an email address — is
 * a literal.
 */
function rhs(row: Record<string, unknown>, val: unknown): unknown {
  if (typeof val === "string" && /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(val)) {
    const key = col(val);
    if (key in row) return row[key];
  }
  return val;
}

export function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (!cond) return true;
  switch (cond.__op) {
    case "and":
      return cond.conds.every((c) => matches(row, c));
    case "or":
      return cond.conds.some((c) => matches(row, c));
    case "eq":
      return row[col(cond.field)] === rhs(row, cond.val);
    case "ne":
      return row[col(cond.field)] !== rhs(row, cond.val);
    case "isNull":
      return row[col(cond.field)] == null;
    case "isNotNull":
      return row[col(cond.field)] != null;
    case "inArray":
      return cond.vals.includes(row[col(cond.field)]);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asTime(row[col(cond.field)]);
      const b = asTime(cond.val);
      const left = a ?? (row[col(cond.field)] as number);
      const right = b ?? (cond.val as number);
      if (left == null || right == null) return false;
      if (cond.__op === "gt") return left > right;
      if (cond.__op === "gte") return left >= right;
      if (cond.__op === "lt") return left < right;
      return left <= right;
    }
    default:
      return true;
  }
}

/** The drizzle-orm operator mock. Register with `vi.mock("drizzle-orm", ...)`. */
export function drizzleOperators(actual: Record<string, unknown>) {
  return {
    ...actual,
    eq: (field: string, val: unknown) => ({ __op: "eq", field, val }),
    ne: (field: string, val: unknown) => ({ __op: "ne", field, val }),
    gt: (field: string, val: unknown) => ({ __op: "gt", field, val }),
    gte: (field: string, val: unknown) => ({ __op: "gte", field, val }),
    lt: (field: string, val: unknown) => ({ __op: "lt", field, val }),
    lte: (field: string, val: unknown) => ({ __op: "lte", field, val }),
    isNull: (field: string) => ({ __op: "isNull", field }),
    isNotNull: (field: string) => ({ __op: "isNotNull", field }),
    inArray: (field: string, vals: unknown[]) => ({ __op: "inArray", field, vals }),
    and: (...conds: (Cond | undefined)[]) => ({ __op: "and", conds }),
    or: (...conds: (Cond | undefined)[]) => ({ __op: "or", conds }),
  };
}

// ---------------------------------------------------------------------------
// Table + engine
// ---------------------------------------------------------------------------

export interface MockTable {
  __name: string;
  [column: string]: string;
}

export function mockTable(name: string, columns: string[]): MockTable {
  const table = { __name: name } as MockTable;
  for (const c of columns) table[c] = `${name}.${c}`;
  return table;
}

export interface Store {
  [tableName: string]: Record<string, unknown>[];
}

/**
 * In-memory query engine for the Drizzle surface the authorization chain uses:
 * select (with optional projection, innerJoin, where, limit), insert/returning,
 * update, delete, and transaction.
 *
 * `unsupported` records any query shape the engine could not answer. Suites
 * assert it stays empty, so a route that outgrows the mock fails loudly instead
 * of silently producing a 500 that a careless test would read as "denied".
 */
export function createEngine(store: Store) {
  const unsupported: string[] = [];
  const rows = (t: MockTable) => (store[t.__name] ??= []);

  function project(row: Record<string, unknown>, projection?: Record<string, string | MockTable>) {
    if (!projection) return { ...row };
    const out: Record<string, unknown> = {};
    for (const [alias, ref] of Object.entries(projection)) {
      if (typeof ref === "object" && ref.__name) out[alias] = { ...row };
      else out[alias] = row[col(ref as string)];
    }
    return out;
  }

  function selectBuilder(projection?: Record<string, string | MockTable>) {
    return {
      from(table: MockTable) {
        let working: Record<string, unknown>[] = rows(table).map((r) => ({ ...r, __table: table.__name }));

        const chain = {
          innerJoin(other: MockTable, cond: Cond) {
            const right = rows(other);
            const joined: Record<string, unknown>[] = [];
            for (const l of working) {
              for (const r of right) {
                // Merge then test, so the condition can reference either side.
                const merged = { ...r, ...l };
                if (matches(merged, cond)) {
                  joined.push({
                    ...merged,
                    __left: { ...l, __table: table.__name },
                    __right: { ...r, __table: other.__name },
                    __table: table.__name,
                    __joined: other.__name,
                  });
                }
              }
            }
            working = joined;
            return chain;
          },
          leftJoin(other: MockTable, cond: Cond) {
            return chain.innerJoin(other, cond);
          },
          where(cond: Cond) {
            working = working.filter((r) => matches(r, cond));
            return chain;
          },
          orderBy() {
            return chain;
          },
          groupBy() {
            return chain;
          },
          limit(n: number) {
            return finish(working.slice(0, n));
          },
          offset() {
            return chain;
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(finish(working)).then(resolve, reject);
          },
        };

        /** Strips the engine's bookkeeping keys so they never reach a response body. */
        function clean(row: Record<string, unknown>) {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (!k.startsWith("__")) out[k] = v;
          }
          return out;
        }

        function finish(list: Record<string, unknown>[]) {
          return list.map((r) => {
            if (!projection) return clean(r);
            const out: Record<string, unknown> = {};
            for (const [alias, ref] of Object.entries(projection)) {
              if (typeof ref === "object" && (ref as MockTable).__name) {
                const name = (ref as MockTable).__name;
                const side = (r.__left as Record<string, unknown>)?.__table === name
                  ? (r.__left as Record<string, unknown>)
                  : (r.__right as Record<string, unknown>)?.__table === name
                    ? (r.__right as Record<string, unknown>)
                    : r;
                out[alias] = clean(side);
              } else {
                out[alias] = r[col(ref as string)];
              }
            }
            return out;
          });
        }

        return chain;
      },
    };
  }

  const api: Record<string, unknown> = {
    select: (projection?: Record<string, string | MockTable>) => selectBuilder(projection),
    insert: (table: MockTable) => ({
      values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(vals) ? vals : [vals];
        const inserted = list.map((v) => {
          const row = { id: rows(table).length + 1, ...v };
          rows(table).push(row);
          return row;
        });
        const result = {
          returning: () => Promise.resolve(inserted.map((r) => ({ ...r }))),
          onConflictDoNothing: () => result,
          onConflictDoUpdate: () => result,
          then: (res: (v: unknown) => unknown) => Promise.resolve(inserted).then(res),
        };
        return result;
      },
    }),
    update: (table: MockTable) => ({
      set: (values: Record<string, unknown>) => {
        const apply = (cond: Cond) => {
          const changed: Record<string, unknown>[] = [];
          for (const row of rows(table)) {
            if (matches(row, cond)) {
              Object.assign(row, values);
              changed.push(row);
            }
          }
          return changed;
        };
        return {
          where: (cond: Cond) => {
            const changed = apply(cond);
            return {
              returning: () => Promise.resolve(changed.map((r) => ({ ...r }))),
              then: (res: (v: unknown) => unknown) => Promise.resolve(changed).then(res),
            };
          },
        };
      },
    }),
    delete: (table: MockTable) => ({
      where: (cond: Cond) => {
        const list = rows(table);
        const removed: Record<string, unknown>[] = [];
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (matches(list[i], cond)) removed.push(...list.splice(i, 1));
        }
        return {
          returning: () => Promise.resolve(removed),
          then: (res: (v: unknown) => unknown) => Promise.resolve(removed).then(res),
        };
      },
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(api),
    execute: () => {
      unsupported.push("db.execute() is not modelled by the adversarial harness");
      return Promise.resolve([]);
    },
  };

  return { db: api, unsupported };
}

// ---------------------------------------------------------------------------
// The two-organization fixture
// ---------------------------------------------------------------------------

export const TABLES = {
  users: mockTable("users", ["id", "email", "role", "organizationId", "disabledAt"]),
  sessions: mockTable("sessions", ["token", "userId", "expiresAt"]),
  organizationMemberships: mockTable("organization_memberships", [
    "id",
    "applicationUserId",
    "organizationId",
    "status",
    "expiresAt",
  ]),
  membershipRoles: mockTable("membership_roles", ["membershipId", "roleId"]),
  rolePermissions: mockTable("role_permissions", ["roleId", "permissionId"]),
  permissions: mockTable("permissions", ["id", "key"]),
  modules: mockTable("modules", ["id", "key", "status", "requiredModuleKeys"]),
  organizationModules: mockTable("organization_modules", ["organizationId", "moduleId", "enabled"]),
  // `status` (not a revokedAt timestamp) is what lib/breakGlass.ts actually
  // filters on — see getActiveGrantForActorAndOrg. The fixture mirrors the real
  // column set so a revoked grant is revoked the way production revokes one.
  breakGlassGrants: mockTable("break_glass_grants", [
    "id",
    "actorUserId",
    "targetOrganizationId",
    "scope",
    "status",
    "expiresAt",
    "revokedAt",
  ]),
  platformOperationGrants: mockTable("platform_operation_grants", [
    "id",
    "userId",
    "operation",
    "expiresAt",
    "revokedAt",
  ]),
};

/** Stable ids so tests can reference cross-tenant resources by literal value. */
export const ORG_A = 101;
export const ORG_B = 202;

export interface Actor {
  userId: number;
  membershipId: number | null;
  token: string;
  organizationId: number | null;
}

export interface TwoOrgFixture {
  store: Store;
  /** Org A actors. */
  a: { employee: Actor; manager: Actor; hr: Actor; admin: Actor };
  /** Org B actors. */
  b: { employee: Actor; hr: Actor };
  /** Platform-level actors, members of neither organization. */
  superAdminNoGrant: Actor;
  superAdminWithBreakGlass: Actor;
  superAdminExpiredBreakGlass: Actor;
  superAdminRevokedBreakGlass: Actor;
  superAdminWrongOrgBreakGlass: Actor;
}

const HOUR = 60 * 60 * 1000;

/**
 * Seeds two fully isolated organizations plus the platform actors.
 *
 * Role shapes are expressed as permission-key lists rather than named roles so a
 * suite can grant exactly the key a route requires without depending on how the
 * production role seed happens to be arranged at the time.
 */
export function seedTwoOrgs(options?: {
  /** Permission keys held by each Org A / Org B role. */
  permissions?: Partial<Record<"employee" | "manager" | "hr" | "admin", string[]>>;
  /** Module keys enabled for Org A. Org B gets the same unless overridden. */
  modulesEnabledForA?: string[];
  modulesEnabledForB?: string[];
  /** Module keys that exist in the registry at all. */
  moduleRegistry?: string[];
  /** Break-glass scope granted to `superAdminWithBreakGlass`. */
  breakGlassScope?: string[];
}): TwoOrgFixture {
  const store: Store = {};
  for (const t of Object.values(TABLES)) store[t.__name] = [];

  const perms = {
    employee: options?.permissions?.employee ?? [],
    manager: options?.permissions?.manager ?? [],
    hr: options?.permissions?.hr ?? [],
    admin: options?.permissions?.admin ?? [],
  };

  // Permission catalogue — one row per distinct key across all roles.
  const allKeys = [...new Set([...perms.employee, ...perms.manager, ...perms.hr, ...perms.admin])];
  allKeys.forEach((key, i) => store.permissions.push({ id: i + 1, key }));
  const permIdByKey = new Map(allKeys.map((k, i) => [k, i + 1]));

  let userSeq = 1;
  let membershipSeq = 1;
  let roleSeq = 1;

  function makeActor(params: {
    organizationId: number | null;
    permissionKeys: string[];
    platformRole?: string;
    membershipStatus?: string;
    membershipExpiresAt?: Date | null;
  }): Actor {
    const userId = userSeq++;
    const token = `tok-${params.platformRole ?? "user"}-${userId}`;
    store.users.push({
      id: userId,
      email: `user${userId}@fixture.test`,
      role: params.platformRole ?? "user",
      organizationId: params.organizationId,
      disabledAt: null,
    });
    store.sessions.push({ token, userId, expiresAt: new Date(Date.now() + HOUR) });

    let membershipId: number | null = null;
    if (params.organizationId != null) {
      membershipId = membershipSeq++;
      store.organization_memberships.push({
        id: membershipId,
        applicationUserId: userId,
        organizationId: params.organizationId,
        status: params.membershipStatus ?? "active",
        expiresAt: params.membershipExpiresAt ?? null,
      });
      if (params.permissionKeys.length > 0) {
        const roleId = roleSeq++;
        store.membership_roles.push({ membershipId, roleId });
        for (const key of params.permissionKeys) {
          store.role_permissions.push({ roleId, permissionId: permIdByKey.get(key) });
        }
      }
    }

    return { userId, membershipId, token, organizationId: params.organizationId };
  }

  const a = {
    employee: makeActor({ organizationId: ORG_A, permissionKeys: perms.employee }),
    manager: makeActor({ organizationId: ORG_A, permissionKeys: perms.manager }),
    hr: makeActor({ organizationId: ORG_A, permissionKeys: perms.hr }),
    admin: makeActor({ organizationId: ORG_A, permissionKeys: perms.admin }),
  };
  const b = {
    employee: makeActor({ organizationId: ORG_B, permissionKeys: perms.employee }),
    hr: makeActor({ organizationId: ORG_B, permissionKeys: perms.hr }),
  };

  const superAdminNoGrant = makeActor({ organizationId: null, permissionKeys: [], platformRole: "super_admin" });
  const superAdminWithBreakGlass = makeActor({ organizationId: null, permissionKeys: [], platformRole: "super_admin" });
  const superAdminExpiredBreakGlass = makeActor({ organizationId: null, permissionKeys: [], platformRole: "super_admin" });
  const superAdminRevokedBreakGlass = makeActor({ organizationId: null, permissionKeys: [], platformRole: "super_admin" });
  const superAdminWrongOrgBreakGlass = makeActor({ organizationId: null, permissionKeys: [], platformRole: "super_admin" });

  const scope = options?.breakGlassScope ?? [];
  store.break_glass_grants.push(
    {
      id: 1,
      actorUserId: superAdminWithBreakGlass.userId,
      targetOrganizationId: ORG_A,
      scope,
      status: "active",
      expiresAt: new Date(Date.now() + HOUR),
      revokedAt: null,
    },
    {
      // Active status, but past its expiry.
      id: 2,
      actorUserId: superAdminExpiredBreakGlass.userId,
      targetOrganizationId: ORG_A,
      scope,
      status: "active",
      expiresAt: new Date(Date.now() - HOUR),
      revokedAt: null,
    },
    {
      // Still inside its window, but revoked.
      id: 3,
      actorUserId: superAdminRevokedBreakGlass.userId,
      targetOrganizationId: ORG_A,
      scope,
      status: "revoked",
      expiresAt: new Date(Date.now() + HOUR),
      revokedAt: new Date(Date.now() - 60_000),
    },
    {
      // Correct in every respect except the organization it points at.
      id: 4,
      actorUserId: superAdminWrongOrgBreakGlass.userId,
      targetOrganizationId: ORG_B,
      scope,
      status: "active",
      expiresAt: new Date(Date.now() + HOUR),
      revokedAt: null,
    },
  );

  // Module registry + per-organization enablement.
  const registry = options?.moduleRegistry ?? [];
  registry.forEach((key, i) =>
    store.modules.push({ id: i + 1, key, status: "active", requiredModuleKeys: [] }),
  );
  const moduleIdByKey = new Map(registry.map((k, i) => [k, i + 1]));
  for (const key of options?.modulesEnabledForA ?? registry) {
    store.organization_modules.push({ organizationId: ORG_A, moduleId: moduleIdByKey.get(key), enabled: true });
  }
  for (const key of options?.modulesEnabledForB ?? registry) {
    store.organization_modules.push({ organizationId: ORG_B, moduleId: moduleIdByKey.get(key), enabled: true });
  }

  return {
    store,
    a,
    b,
    superAdminNoGrant,
    superAdminWithBreakGlass,
    superAdminExpiredBreakGlass,
    superAdminRevokedBreakGlass,
    superAdminWrongOrgBreakGlass,
  };
}

export function bearer(actor: Actor): string {
  return `Bearer ${actor.token}`;
}

// ---------------------------------------------------------------------------
// Assertions that refuse to pass for the wrong reason
// ---------------------------------------------------------------------------

export interface Httpish {
  status: number;
  body: unknown;
  text?: string;
}

/**
 * Asserts a request was refused by the authorization layer.
 *
 * Rejects 500 explicitly: a server error is a broken route, not a secured one,
 * and treating it as a pass is the single easiest way to ship a security suite
 * that proves nothing.
 */
export function expectDenied(res: Httpish, allowed: number[] = [403, 404]): void {
  if (res.status === 500) {
    throw new Error(
      `Expected an authorization denial but got 500 — the route errored, which proves nothing about ` +
        `authorization. Body: ${JSON.stringify(res.body)}`,
    );
  }
  if (!allowed.includes(res.status)) {
    throw new Error(
      `Expected one of ${allowed.join("/")} but got ${res.status}. Body: ${JSON.stringify(res.body)}`,
    );
  }
}

/** Asserts the positive control succeeded, so the matching denial means something. */
export function expectAllowed(res: Httpish): void {
  if (res.status >= 400) {
    throw new Error(
      `Positive control FAILED with ${res.status}. Every negative case sharing this route is now ` +
        `meaningless — the route denies everyone, including the entitled caller. ` +
        `Body: ${JSON.stringify(res.body)}`,
    );
  }
}

/**
 * Asserts a denial response body carries no information about the resource that
 * was probed — no names, no counts, no "exists but forbidden" phrasing.
 */
export function expectNoLeakage(res: Httpish, forbiddenSubstrings: string[]): void {
  const serialized = JSON.stringify(res.body ?? "") + (res.text ?? "");
  for (const needle of forbiddenSubstrings) {
    if (serialized.toLowerCase().includes(needle.toLowerCase())) {
      throw new Error(`Denial response leaked "${needle}": ${serialized}`);
    }
  }
}
