/**
 * WS-26C — WWM template activation (explicit, governed, out-of-band).
 *
 * Installs + publishes the four authoritative WWM form templates into ONE
 * explicitly-named organization (org 3 in Production). It NEVER runs on boot or
 * from seed:roles — only when an operator runs it deliberately with an explicit
 * organization and actor, and it is a DRY RUN unless --confirm is passed.
 * Idempotent: rerunning leaves existing templates untouched.
 *
 *   DATABASE_URL=... npx tsx scripts/activate-wwm-templates.ts \
 *     --org 3 --actor-user <id> --actor-membership <id> [--no-publish] [--confirm]
 *
 * Without --confirm it prints the plan and exits (nothing is written).
 */
import { WWM_FORM_TEMPLATES } from "../src/formTemplates/wwm";
import { installTemplates } from "../src/lib/formEngine/templateInstaller";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const org = Number(arg("org"));
  const actorUser = Number(arg("actor-user"));
  const actorMembership = Number(arg("actor-membership"));
  const publish = !has("no-publish");
  const confirm = has("confirm");

  if (!Number.isInteger(org) || org <= 0) throw new Error("--org <id> is required (explicit target organization)");
  if (!Number.isInteger(actorUser) || actorUser <= 0) throw new Error("--actor-user <id> is required (governed actor)");
  if (!Number.isInteger(actorMembership) || actorMembership <= 0) throw new Error("--actor-membership <id> is required (governed actor membership)");

  console.log(`WWM template activation: org=${org} publish=${publish} confirm=${confirm}`);
  console.log(`Templates: ${WWM_FORM_TEMPLATES.map((t) => t.templateKey).join(", ")}`);

  if (!confirm) {
    console.log("DRY RUN (no --confirm): nothing written. Re-run with --confirm to activate.");
    return;
  }
  const results = await installTemplates({
    organizationId: org,
    seeds: WWM_FORM_TEMPLATES,
    actorApplicationUserId: actorUser,
    actorMembershipId: actorMembership,
    publish,
  });
  for (const r of results) console.log(`  ${r.templateKey}: ${r.action}${r.action === "installed" ? ` (template ${r.templateId}, version ${r.versionId}, published=${r.published})` : ` (template ${r.templateId})`}`);
  console.log("Activation complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Activation failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
