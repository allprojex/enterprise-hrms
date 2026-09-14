/**
 * Prepares (never publishes) new DRAFT versions for WWM form templates whose
 * seed submission policy differs from the published version — e.g. the Staff
 * Personal Information Form v2 with allowOnBehalfSubmission=true.
 *
 * Content-locked: see prepareSubmissionPolicyVersions. Published versions and
 * existing submissions are never modified. Publishing the prepared draft is a
 * separate, explicitly approved act through the governed publish route.
 *
 * Dry run by default. Requires an explicit organization and governed actor:
 *
 *   tsx scripts/prepare-wwm-submission-policy-versions.ts --org <id> \
 *     --actor-user <id> --actor-membership <id> [--confirm]
 */
import { WWM_FORM_TEMPLATES } from "../src/formTemplates/wwm";
import { prepareSubmissionPolicyVersions } from "../src/lib/formEngine/templateInstaller";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const org = Number(arg("org"));
  const actorUser = Number(arg("actor-user"));
  const actorMembership = Number(arg("actor-membership"));
  const confirm = process.argv.includes("--confirm");

  if (!Number.isInteger(org) || org <= 0) throw new Error("--org <id> is required (explicit target organization)");
  if (!Number.isInteger(actorUser) || actorUser <= 0) throw new Error("--actor-user <id> is required (governed actor)");
  if (!Number.isInteger(actorMembership) || actorMembership <= 0) throw new Error("--actor-membership <id> is required (governed actor membership)");

  console.log(`WWM submission-policy version preparation: org=${org} confirm=${confirm} (drafts only, never published)`);
  const results = await prepareSubmissionPolicyVersions({
    organizationId: org,
    seeds: WWM_FORM_TEMPLATES,
    actorApplicationUserId: actorUser,
    actorMembershipId: actorMembership,
    dryRun: !confirm,
  });
  for (const r of results) {
    const where = r.templateId ? ` (template ${r.templateId}, published v${r.publishedVersionNumber ?? "?"}${r.draftVersionId ? `, draft ${r.draftVersionId}` : ""})` : "";
    console.log(`  ${r.templateKey}: ${r.action}${where}`);
  }
  if (!confirm) console.log("DRY RUN (no --confirm): nothing written.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Preparation failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
