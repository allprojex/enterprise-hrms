# WS-25A — Enterprise Design Foundation

**Workstream:** WS-25 — Enterprise UI/UX Modernization (registered in `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20; the blueprint's draft identifier WS-22 is reserved by the owner for Fleet Agent & Executor Credentials).
**Phase:** WS-25A — Enterprise Design Foundation. **Status: COMPLETE, not deployed.**
**Blueprint:** `docs/UI_MODERNIZATION_BLUEPRINT.md`.
**Scope:** frontend only (`artifacts/hrms`). No schema, migration, API or backend change. No Production data touched.

This phase establishes the visual system every later UI phase inherits. It does not redesign business workflows or pages: pages change visually through the shared tokens and primitives they already use.

---

## 1. Reconciliation against the blueprint

Repository at start: `main` = `origin/main` = `73c18b7`. Since the blueprint (`faec47f`) the following landed and are preserved untouched by this phase: explicit `/admin/:organizationId` context and the organization ownership boundary (`faec47f`), invitation onboarding safety and tenant-scoped invite branding (`a878555`), Primary HR Authority and HR Administrator (`bc8e2b9`), WS-18 host protections, and the tenant branding pipeline (`GET /tenant-context`, `GET /invitations/:token`, `branding` config namespace). No hook, role check, route guard, `data-testid` or asserted string was changed.

Blueprint assumptions found stale:

| Assumption | Reality at reconciliation |
|---|---|
| "WS-22 — Enterprise UI Modernization" | WS-22 is reserved by the owner; registered as **WS-25**. |
| 80 test files / 741 tests | 80 files / 858 tests before this phase (invitation and ownership work added tests). Now 88 files / 957 tests. |
| Lint debt: 13 errors + 9 warnings | 45 problems (19 errors, 26 warnings) in files this phase does not touch; CI lint step remains non-blocking by design (`docs/CI_CD.md` §7). |
| `hover-elevate` used across pages | Only `ui/button.tsx` and `ui/badge.tsx` used it — removed with no page edits. |
| `text-[11px]` in two places | Both in `layout/app-shell.tsx` (org slug); replaced with the 12px `text-helper` style. |

Everything else in the blueprint (fonts, CSP conflict, tinted shadows, missing semantic tokens, unreachable dark theme, card-everywhere, heading drift) was confirmed and is addressed below.

## 2. Design direction

Classy, confident, business-first. Deep enterprise blue primary (`222 47% 31%`) with a restrained warm accent, cool neutral canvas, crisp white surfaces with hairline borders, subtle neutral elevation only where content floats, 6px base radius, 120–240ms motion with standard easing. Nothing playful: no serif display face, no coloured shadows, no gradient, no stagger entrances.

## 3. Typography

- **One family, self-hosted:** Inter Variable via `@fontsource-variable/inter` 5.3.0 (SIL OFL-1.1; the package ships the font files). Imported in `src/main.tsx`; Google Fonts `<link>`s removed from `index.html`; DM Sans and Fraunces `@import` removed from `index.css`. The only font origin is `'self'`, which the edge Report-Only CSP already allows.
- Headings are Inter 600 with −0.01em tracking (the global serif rule is gone). `text-wrap: balance` on headings.
- Body 14/20, `font-feature-settings: 'cv11','ss01','calt'`.
- Type scale utilities (`src/index.css`): `text-display` 28/34, `text-title` 22/28, `text-heading` 18/24, `text-section` 17/24, `text-card-title` 15/22, `text-body` 14/20, `text-body-sm` 13/18, `text-label` 13/18 medium, `text-helper` 12/16, `text-meta` 12/16 subtle, `text-kpi` 28/32 tabular, `text-kpi-sm` 20/24 tabular, `text-button` 14/20 medium, `text-table` 13/20, `text-table-head` 12/16 medium, `text-overline` 11/16 uppercase (labels only — the single sub-12px style; enforced by test).

## 4. Token architecture (`src/index.css`, mirrored in `src/lib/design-tokens.ts`)

HSL-triple CSS-variable contract retained (`--x: h s% l%`, consumed as `hsl(var(--x))`), because the backend branding schema and the tenant runtime already write into it. Every token is defined in `:root` and `.dark`, and exposed to Tailwind through `@theme inline` (`bg-surface`, `text-foreground-muted`, `border-border-strong`, `bg-success-soft`, `ring-focus`, …).

| Group | Tokens |
|---|---|
| Canvas / text | `background`, `foreground`, `foreground-muted`, `foreground-subtle` |
| Surfaces | `surface`, `surface-elevated`, `surface-muted`, `surface-sunken`, `surface-hover` |
| Lines | `border`, `border-strong`, `input` |
| Brand (tenant-writable) | `primary`, `primary-foreground`, `accent`, `accent-foreground`, `sidebar`, `sidebar-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `ring` |
| Brand (derived, never tenant-set) | `primary-hover`, `primary-soft`, `primary-soft-foreground`, `accent-soft`, `accent-soft-foreground`, `focus`, `sidebar-hover`, `sidebar-active`, `sidebar-active-foreground`, `sidebar-primary(-foreground)` |
| Semantic status (platform-owned) | `success`, `warning`, `danger`, `info`, each with `-foreground`, `-soft`, `-soft-foreground`; `destructive` aliases `danger` |
| Interaction | `focus`, `disabled-surface`, `disabled-foreground`, `overlay` + `overlay-opacity` |
| Charts | `chart-1..5` = primary, info, success, warning, neutral (tenant primary influences series 1 only) |
| Shape | `--radius` 6px; sm 4 / md 6 / lg 8 / xl 12 / 2xl 16 |
| Depth | `shadow-xs/sm/md/lg`, neutral slate tint only (test rejects any red-dominant shadow) |
| Layout | control heights 32/36/40, sidebar 264 / rail 56, header 56, content max 1440 / narrow 720 / form 960, touch target 44 |
| Layering | `z-base 0`, `raised 10`, `sticky 20`, `sidebar/header 30`, `overlay 40`, `modal 50`, `popover 60`, `toast 100` (utilities `z-modal`, `z-toast`, …) |
| Motion | `--dur-fast 120ms`, `--dur-base 180ms`, `--dur-slow 240ms`; `ease-standard`, `ease-enter`, `ease-exit` |

shadcn aliases (`card`, `popover`, `muted`, `secondary`, `destructive`, `ring`) resolve to the new tokens, so every existing `bg-card` / `text-muted-foreground` class keeps working.

## 5. Theme architecture

- **Light theme is the product** and was tuned to WCAG AA: 33 text/background and component pairs are asserted at 4.5:1 (text) or 3:1 (UI) by `src/test/design-tokens.test.ts` in **both** themes.
- **Dark theme is token-complete** (every token defined under `.dark`, contrast-tested) but **no toggle is exposed**. Pages still carry ~90 hard-coded `bg-*-100` status classes, so a toggle belongs to Phase F after StatusBadge migration. Zero backend impact.

## 6. Tenant branding on top of the system (`src/lib/tenant-theme-tokens.ts`)

`components/tenant-theme.tsx` (hostname-resolved) and `pages/invite-accept.tsx` (invitation-resolved) now share one resolver:

- Reads only the nine accepted keys; unknown keys and non-HSL values (hex, `hsl()`, `url(…)`) are ignored and never written to the DOM.
- Derives `primary-hover`, `primary-soft(-foreground)`, `accent-soft(-foreground)`, `focus`, `sidebar-hover`, `sidebar-active(-foreground)` from the tenant colours.
- **Readability clamp:** a supplied foreground that fails 4.5:1 against its background is replaced by a readable one; a missing foreground is derived.
- Never touches semantic status colours, text, borders, surfaces, spacing, radius or type (asserted against a hostile theme that tries to set them).
- Clearing removes brand *and* derived tokens, so one organization's colours cannot persist onto another's render.
- WWM's stored navy/gold values (`220 55% 16%` / `38 70% 50%` …) pass the clamp and are applied unchanged — asserted by test with the exact Production values. **No Production branding data was changed.**

## 7. Component changes (`src/components/ui`)

| Primitive | Change |
|---|---|
| `button` | variants default / secondary / outline / ghost / destructive / link; sizes default / sm / lg / icon / icon-sm / icon-lg on the control-height scale; explicit hover/press feedback from tokens; `loading` prop (spinner, `aria-busy`, keeps label and width); disabled uses disabled tokens; pseudo-element elevate system removed |
| `badge` | soft tone variants `success / warning / danger / info / neutral / brand / accent` + the four shadcn variants; optional `dot` |
| `card` | flat by default (border, no shadow, radius-lg); `variant` standard / metric / actionable / information / alert (`tone`) / summary / elevated; `data-variant` attribute |
| `input`, `textarea`, `select` trigger | 36px control height, surface background, hairline input border, one focus ring, `aria-invalid` error state, disabled tokens (no opacity), file-input styling |
| `checkbox`, `radio-group`, `switch` | token borders, primary checked state, indeterminate checkbox, focus ring, disabled tokens |
| `label` | 13px medium, `required` marker (aria-hidden `*`) |
| `table` | muted header, 13px cells, 44px rows (`density="compact"` 36px), hover / selected (brand soft + left bar) / focus-visible row, `numeric` cells (right, tabular), `TableActionCell`, `stickyHeader`, scroll container that never lets the page overflow |
| `tabs` | `variant="line"` (default, underline indicator) and `pill` |
| `dialog` | elevated surface, neutral overlay, 180/120ms, bottom sheet below `sm`, 36px close target |
| `toast` | elevated surface with semantic left rule + icon; variants default / destructive / success / warning / info; limit raised 1 → 3 |
| `skeleton`, `spinner` | neutral surface pulse, `aria-hidden` skeleton, spinner is a status |
| `dropdown-menu`, `select`, `popover`, `context-menu`, `menubar`, `hover-card`, `tooltip`, `navigation-menu`, `command`, `alert-dialog`, `sheet`, `calendar`, `form`, `toggle` and all others | one focus treatment (`ring-2 ring-focus offset-2`), neutral `surface-hover` for item hover/highlight (the brand accent no longer colours menu hover), `bg-overlay`, motion classes per family |

New shared components (`src/components/foundation`, import from `@/components/foundation`):
`StatusBadge` (+ `lib/status-tone.ts` mapping), `MetricCard`, `PageHeader` / `SectionHeader`, `PageContainer`, `EmptyState` / `NoResultsState`, `ErrorState` (now backing `QueryError`), `LoadingState` / `TableSkeleton` / `ListSkeleton`, `PasswordInput`, `SearchInput`.

Other: skip link (`.skip-link` → `#main-content`) mounted in `App.tsx`; `useToast` limit 3.

## 8. Motion system

CSS-first. `index.css` defines `motion-interactive` (120ms colour/border/shadow feedback), `motion-menu` (180ms in, transform-origin from Radix), `motion-dialog`, `motion-sheet` (240ms), `motion-toast`, `motion-exit` (120ms, exit easing), `motion-collapse(-open)` (grid-rows technique for nav groups), `motion-indicator` (tabs), plus `duration-fast/base/slow`. Radix `data-[state]` enter/exit classes from `tw-animate-css` are kept; framer-motion stays in its five call sites until Phase C and is wrapped in `<MotionConfig reducedMotion="user">` at the root so it honours the OS preference now. No new animation dependency.

## 9. Reduced motion

Global rule in `index.css`: under `prefers-reduced-motion: reduce` every animation and transition collapses to 0.01ms and smooth scrolling is disabled. Runtime helpers in `src/lib/motion.ts` (`prefersReducedMotion`, `usePrefersReducedMotion`, `scrollBehavior`) for JS-driven cases. Tested.

## 10. Responsive foundation

Tailwind default breakpoints (640/768/1024/1280/1536) unchanged. `PageContainer` pads 16 / 24 / 32px and centres at 1440. Dialog becomes a bottom sheet below 640. Tables scroll inside their own container. Touch-target token (44px) and `min-touch` utility. No base component assumes desktop; the showcase renders at any width.

## 11. Accessibility

One visible focus treatment everywhere (2px focus ring, 2px offset; a `:where()` base rule covers bare elements). Text contrast AA in both themes by test. Colour is never the only status carrier (`StatusBadge` always renders text). Labels support a required marker; errors use `aria-invalid` + `text-danger`. Loading, empty and error states are `role="status"` / `role="alert"` live regions. Skeletons are `aria-hidden`. Skip link added. Keyboard operation of buttons and tabs is tested.

## 12. Visual proof

`src/pages/dev/design-foundation.tsx`, routed at `/dev/design-foundation` **only inside `import.meta.env.DEV`** — verified absent from the production bundle (`grep` of `dist/public/assets` finds no showcase string). It shows typography, buttons, every form control, card variants, status badges, the table foundation, tabs, dialog, dropdown, toasts, loading/empty/error states, and a tenant-theme switch (Platform / WWM navy-gold / an unreadable pair that the clamp corrects). `src/test/design-foundation.test.tsx` mounts it as the component-level proof. Run `pnpm --filter @workspace/hrms run dev` and open the route.

## 13. Files changed

Frontend (`artifacts/hrms`): `index.html`, `package.json` (+`@fontsource-variable/inter`), `src/main.tsx`, `src/index.css` (rewritten), `src/App.tsx`, `src/components/tenant-theme.tsx`, `src/components/query-error.tsx`, `src/components/layout/app-shell.tsx` (two class strings), `src/pages/invite-accept.tsx` (theme effect), `src/hooks/use-toast.ts` (limit), `src/components/ui/*` (button, badge, card, input, textarea, select, checkbox, radio-group, switch, label, table, tabs, dialog, toast, skeleton, spinner rewritten; class-level updates across the rest), new `src/components/foundation/*` (10 files), new `src/lib/{color,design-tokens,motion,status-tone,tenant-theme-tokens}.ts`, new `src/pages/dev/design-foundation.tsx`, tests below. Root: `pnpm-lock.yaml`. Docs: this file, `docs/UI_MODERNIZATION_BLUEPRINT.md` (identifier), `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20 (WS-22 reserved, WS-25 registered), `PROJECT_STATUS.md`.

## 14. Tests

New: `color.test.ts` (12), `design-tokens.test.ts` (17 — token presence, alias resolution, ownership split, AA contrast both themes, neutral shadows, pinned dimensions / z-index / durations, utilities, no sub-12px running text, self-hosted fonts, heading weight, reduced motion, focus rule, elevate removed), `tenant-theme-tokens.test.ts` (12), `tenant-theme.test.tsx` (+4: derived companions cleared, clamp, platform-owned tokens untouched, malformed values ignored), `status-badge.test.tsx` (21), `button.test.tsx` (7), `foundation.test.tsx` (18 — card variants, badge tones, input/label, MetricCard, PageHeader/Container, empty/error/loading, PasswordInput, SearchInput, table, tabs incl. keyboard), `motion.test.ts` (3), `design-foundation.test.tsx` (5). One existing assertion updated: `employee-detail.test.tsx` located a card by `.rounded-xl`; it now uses the Card's `data-variant` attribute.

Frontend suite: **88 files, 957 tests, all passing** (`pnpm --filter @workspace/hrms run test`; run with `--maxWorkers=3` on this machine to avoid jsdom environment timeouts). Typecheck clean. Production build succeeds (main chunk unchanged at ~2.0 MB — route splitting is Phase C). Lint: 0 findings in files touched by this phase; the pre-existing 45 findings in untouched HR pages/tests remain and the CI lint step stays non-blocking as documented.

## 15. Explicitly not done (later phases)

Phase B: `AuthLayout`, premium tenant login, tenant-aware forgot/reset, logo upload UI. Phase C: shell on `ui/sidebar`, rail, context bar, mobile sheet, lazy routes, framer-motion removal. Phase D: `DataTable` with responsive modes, form primitives adoption, page migrations. Phase E: Super Admin surfaces. Phase F: dark toggle, remaining `bg-*-100` migration, axe sweep, visual regression baselines. Backend contrast `.refine()` on the branding schema (optional, blueprint §30) was not added — no backend change in this phase.

## 16. Production

Nothing deployed. No database, WWM, logo, invitation, membership, Primary HR, domain, module, licence or AfriPebbles change.
