/**
 * WS-10 — the module key every onboarding route is gated on.
 *
 * Kept in its own file, mirroring `recruitmentAuthorization.ts`'s
 * `RECRUITMENT_MODULE_KEY`, so route files depend on the constant rather than
 * repeating a string literal. Onboarding is `defaultEnabled: false` like every
 * other module: no organization gains it silently.
 */
export const ONBOARDING_MODULE_KEY = "onboarding";
