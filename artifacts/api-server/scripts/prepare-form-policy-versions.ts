/**
 * Prepares (never publishes) new DRAFT versions for any form template whose
 * seed submission policy or workflow differs from the version published in the
 * target organization — for example the Staff Personal Information Form v2 with
 * allowOnBehalfSubmission=true.
 *
 * Tenant-neutral by construction. The seed catalogue covers every organization
 * the platform knows about, and prepareSubmissionPolicyVersions resolves each
 * seed BY KEY WITHIN THE GIVEN ORGANIZATION — a template not installed there is
 * reported not_installed and skipped. So one operator entry point serves every
 * tenant without ever being able to reach across them.
 *
 * Content-locked: see prepareSubmissionPolicyVersions. Published versions and
 * existing submissions are never modified. Publishing the prepared draft is a
 * separate, explicitly approved act through the governed publish route, and
 * needs form_template.publish, which this path never exercises.
 *
 * Dry run by default. Requires an explicit organization and governed actor,
 * both proven through authorizeActor rather than trusted:
 *
 *   tsx scripts/prepare-form-policy-versions.ts --org <id>  *     --actor-user <id> --actor-membership <id> [--confirm]
 */
import { FORM_TEMPLATE_SEEDS } from "../src/formTemplates";
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

  console.log(`Form policy/version preparation: org=${org} confirm=${confirm} (drafts only, never published)`);
  const results = await prepareSubmissionPolicyVersions({
    organizationId: org,
    seeds: FORM_TEMPLATE_SEEDS,
    actorApplicationUserId: actorUser,
    actorMembershipId: actorMembership,
    dryRun: !confirm,
  });
  for (const r of results) {
    const where = r.templateId ? ` (template ${r.templateId}${r.draftVersionId ? `, draft version ${r.draftVersionId}` : ""})` : "";
    console.log(`${r.templateKey}: ${r.action}${where}`);
    if (r.publishedVersionNumber != null) console.log(`  v${r.publishedVersionNumber} published — unchanged`);
    if (r.proposedChanges && r.proposedChanges.length > 0) {
      console.log(`  v${(r.publishedVersionNumber ?? 0) + 1} draft — proposed changes:`);
      for (const change of r.proposedChanges) console.log(`    - ${change}`);
    }
  }
  if (!confirm) console.log("DRY RUN (no --confirm): nothing written.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Preparation failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
