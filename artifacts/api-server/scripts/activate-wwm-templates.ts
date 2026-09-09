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
 * Without --confirm it validates the actor and prints the plan, then exits
 * (nothing is written). The actor must hold form_template.manage, plus
 * form_template.publish unless --no-publish is passed — the same authority the
 * governed template routes demand.
 */
import { WWM_FORM_TEMPLATES } from "../src/formTemplates/wwm";
import { authorizeActor } from "../src/lib/actorAuthorization";
import { installTemplates, TEMPLATE_INSTALL_PERMISSION, TEMPLATE_PUBLISH_PERMISSION } from "../src/lib/formEngine/templateInstaller";

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

  // Authorization preflight. installTemplates enforces this itself before it
  // writes anything, but the dry run must exercise the SAME check — otherwise
  // a dry run "passes" for an actor who cannot actually perform the act, and
  // the first real validation would only happen under --confirm. This reads;
  // it never writes.
  const required = publish ? [TEMPLATE_INSTALL_PERMISSION, TEMPLATE_PUBLISH_PERMISSION] : [TEMPLATE_INSTALL_PERMISSION];
  const actor = await authorizeActor({
    organizationId: org,
    actorApplicationUserId: actorUser,
    actorMembershipId: actorMembership,
    requiredPermissions: required,
  });
  console.log(`Actor authorized: user ${actor.applicationUserId} via membership ${actor.membershipId} in org ${actor.organizationId} (${required.join(", ")})`);

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
