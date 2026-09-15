import type { InstallableTemplateSeed } from "../lib/formEngine/templateInstaller";
import { WWM_FORM_TEMPLATES } from "./wwm";

/**
 * Every official form template seed the platform knows about, across all
 * tenants.
 *
 * The form engine itself is organization-neutral: `installTemplates` and
 * `prepareSubmissionPolicyVersions` take an explicit organization and, for each
 * seed, look up that template BY KEY IN THAT ORGANIZATION — a seed whose
 * template is not installed there is reported `not_installed` and skipped. So
 * handing the whole catalogue to an operation targeting one tenant is already
 * scoped: it can only ever touch that tenant's own templates.
 *
 * That is what makes a single generic operator entry point safe, instead of one
 * script per tenant. A new organization adds its own seed module here; the
 * execution mechanism, its authorization and its governed wrapper operation all
 * stay exactly as they are.
 *
 * Template KEYS are namespaced per tenant (`wwm_…`), so two organizations never
 * collide by accident, and the installer's content lock means a seed can never
 * silently rewrite a published version that does not match it.
 */
export const FORM_TEMPLATE_SEEDS: readonly InstallableTemplateSeed[] = [...WWM_FORM_TEMPLATES];
