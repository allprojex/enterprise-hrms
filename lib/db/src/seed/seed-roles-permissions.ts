/**
 * Idempotent seed for system roles, permissions, and their default
 * role_permissions mapping. Safe to re-run — every insert conflicts
 * harmlessly on the table's unique key. Never touches existing data in
 * other tables, and never touches an organization-owned role (templates are
 * resolved by their system identity, not by key — see roles-permissions-seeder.ts).
 * Run manually after applying migrations:
 *   pnpm --filter @workspace/db run seed:roles
 */
import { seedRolesAndPermissions } from "./roles-permissions-seeder";

async function main() {
  await seedRolesAndPermissions();
  console.log("Seeded roles, permissions, and role_permissions.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
