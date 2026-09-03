/**
 * Release / deployment identity of THIS running process — the single source
 * for the values that observability, health and the Super Admin tenant
 * identity surface all report. Read once at startup; nothing here is
 * fabricated: an unset value is reported honestly as "unknown" / null rather
 * than guessed (same rule GET /healthz has followed since the deployment
 * architecture workstream).
 *
 *   RELEASE_VERSION / GIT_COMMIT_SHA — set at deploy time by the operator or
 *     pipeline (docs/DEPLOYMENT_AND_TENANT_ARCHITECTURE.md §9).
 *   NODE_ENV — the runtime environment classification. Production is the only
 *     value with security consequences elsewhere in the code base
 *     (resolveTenantHost, CORS, cookies); here it is purely a label.
 *   INSTALLATION_KEY — optional. The `installations.installation_key` this
 *     process is deployed as, so a log line or identity card can say WHICH
 *     deployment served a tenant. Absent means "not declared", never a guess.
 */
export const APP_VERSION: string = process.env.RELEASE_VERSION ?? process.env.GIT_COMMIT_SHA ?? "unknown";

export const APP_ENVIRONMENT: string = process.env.NODE_ENV ?? "development";

export const INSTALLATION_KEY: string | null = process.env.INSTALLATION_KEY?.trim() || null;

export function releaseInfo(): { environment: string; appVersion: string; installationKey: string | null } {
  return { environment: APP_ENVIRONMENT, appVersion: APP_VERSION, installationKey: INSTALLATION_KEY };
}
