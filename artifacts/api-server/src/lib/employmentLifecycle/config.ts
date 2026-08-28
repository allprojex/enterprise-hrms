import { getNamespaceConfig } from "../../services/organizationConfig";

/**
 * WS-11 — resolved employment-lifecycle configuration (§27.17).
 *
 * Every field is an organization policy choice. `defaultProbationDurationDays`
 * and `maxProbationExtensions` are deliberately nullable with no fallback: the
 * platform has no basis for inventing either, and §27.18 forbids encoding an
 * unverified statutory figure as a default.
 */
export interface EmploymentLifecycleConfig {
  defaultProbationDurationDays: number | null;
  probationReminderDaysBefore: number;
  probationExtensionsAllowed: boolean;
  maxProbationExtensions: number | null;
  contractExpiryReminderDaysBefore: number;
  actingAppointmentsEnabled: boolean;
  secondmentsEnabled: boolean;
}

export async function resolveEmploymentLifecycleConfig(organizationId: number): Promise<EmploymentLifecycleConfig> {
  const result = await getNamespaceConfig(organizationId, "employment_lifecycle");
  const settings = result.data ?? {};

  const num = (key: string, fallback: number | null): number | null => {
    const value = settings[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const value = settings[key];
    return typeof value === "boolean" ? value : fallback;
  };

  return {
    defaultProbationDurationDays: num("defaultProbationDurationDays", null),
    probationReminderDaysBefore: num("probationReminderDaysBefore", 14) ?? 14,
    probationExtensionsAllowed: bool("probationExtensionsAllowed", true),
    maxProbationExtensions: num("maxProbationExtensions", null),
    contractExpiryReminderDaysBefore: num("contractExpiryReminderDaysBefore", 30) ?? 30,
    actingAppointmentsEnabled: bool("actingAppointmentsEnabled", true),
    secondmentsEnabled: bool("secondmentsEnabled", true),
  };
}
