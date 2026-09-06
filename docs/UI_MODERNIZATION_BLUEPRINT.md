# Enterprise UI Modernization Blueprint

**Status: Approved. Phase A (Design Foundation) implemented as WS-25A — see `docs/WS25_DESIGN_FOUNDATION.md`. Nothing deployed.**
**Workstream identifier: WS-25 — Enterprise UI/UX Modernization.** (The draft proposed WS-22; the owner reserved WS-22 for Fleet Agent & Executor Credentials, so this workstream is registered as WS-25 in `docs/ENTERPRISE_HRMS_MASTER_OWNER_REVIEW.md` §20.)

Repository state at assessment (2026-09-05): `main` = `origin/main` = `faec47f`. Production runs `a878555`; `faec47f` (platform ownership boundary) is committed but not deployed. Untracked files in the working tree (`CLAUDE.md`, `CONTRIBUTING.md`, `.claude/`, `.agents/`, `skills-lock.json`) and the modified generated file under `artifacts/mockup-sandbox` were left untouched. This document is the only file this workstream added.

Every statement below was traced in code, not inferred from screenshots. File references are relative to `artifacts/hrms/src` unless stated.

---

## 1. Current UI architecture

| Layer | What exists |
|---|---|
| Framework | React 18 + TypeScript (strict), Vite 6, `wouter` routing, TanStack Query, generated hooks from `lib/api-spec/openapi.yaml` (`@workspace/api-client-react`) |
| Styling | Tailwind CSS v4 (`@import 'tailwindcss'`, `@theme inline`), `tw-animate-css`, `@tailwindcss/typography`, shadcn/ui "new-york" (`components.json`), Radix primitives |
| Component library | 55 shadcn primitives in `components/ui/` (button, badge, card, table, dialog, sheet, sidebar, form, field, empty, skeleton, spinner, chart, …) |
| Shell | One hand-built `components/layout/app-shell.tsx` (1,034 lines): desktop fixed sidebar (hidden below `lg`), mobile drawer via framer-motion, top bar with notifications + account menu. The shadcn `ui/sidebar.tsx` is installed but unused. |
| Pages | 99 route pages (46,886 lines). Largest: `office-inventory.tsx` 3,843, `employee-self-service.tsx` 3,010, `employee-detail.tsx` 2,517, `assets.tsx` 1,708, `admin.tsx` 1,623 |
| Routing | All 99 pages imported eagerly in `App.tsx`; zero `React.lazy`. Production bundle is one 1.98 MB JS chunk + 120 KB CSS |
| Theme runtime | `components/tenant-theme.tsx` applies up to 9 tenant HSL tokens as inline overrides on `<html>` from `GET /tenant-context` (hostname-resolved, server side); invite page scopes its own theme to the invited org |
| Tests | Vitest + Testing Library, 80 test files (741 tests at last status), CI runs test + lint + Docker build. No Playwright, Storybook, or axe in dependencies |
| Icons | `lucide-react` only (consistent). `react-icons` is a declared dependency with zero imports |
| Motion | framer-motion in 5 files (`app-shell`, `dashboard`, `organizations`, `notifications`, unused `landing.tsx`); Radix enter/exit via `tw-animate-css`. No `prefers-reduced-motion` handling anywhere |
| Toasts | Custom Radix `use-toast` (limit 1) used by 74 pages; Sonner installed, wired in `ui/sonner.tsx`, used nowhere |

## 2. Design-system weaknesses (root causes)

1. **Three font families requested, one wasted, all remote.** `index.html` preconnects and loads **Inter** from Google Fonts; `index.css` imports **DM Sans** and **Fraunces** from Google Fonts. `--app-font-sans` is DM Sans, so Inter is downloaded and never used. Global `h1–h6 { font-family: Fraunces }` makes every page title a serif display face, which is the single biggest reason the product does not read as business software.
2. **CSP conflict.** The edge Report-Only CSP (`deploy/nginx/snippets/hrms-security-headers.conf`) is `style-src 'self' 'unsafe-inline'; font-src 'self' data:`. Both Google Fonts origins violate it. The CSP cannot move to enforcement while fonts are remote.
3. **Tinted shadows.** Every light-mode shadow is `rgba(217, 30, 70, …)`, a crimson tint under a blue palette. Reads as muddy on white cards.
4. **No semantic status tokens.** The token set is primary / secondary / accent / destructive / muted / chart-1..5. There is no success, warning, info, surface-elevated, focus, or disabled token. Pages therefore hard-code `bg-amber-100` (29×), `bg-green-100` (24×), `bg-blue-100` (18×), `bg-red-100` (8×) with one `dark:` class in the entire app.
5. **Dark theme is defined but unreachable.** `.dark` variables exist; nothing ever toggles the class. `next-themes` is imported only by the unused Sonner wrapper.
6. **"Elevate" pseudo-element hover system** (`hover-elevate`, `::after` overlays with `z-index: 999`) is baked into Button and Badge. It is unusual, breaks with `overflow: hidden`, and fights ordinary hover/focus styling.
7. **Card is the default container.** 376 `<Card>` in pages; default Card is `rounded-xl` + `shadow`. Everything floats, including plain form sections and single tables.
8. **Page header drift.** Eight distinct `<h1>` class recipes across pages (`text-3xl font-bold` ×70, `text-2xl font-semibold` ×21, others). Container padding is `p-6 lg:p-8 space-y-8` in 81 pages but varies elsewhere.
9. **Forms bypass the form primitives.** `react-hook-form`, `@hookform/resolvers`, `ui/form.tsx`, `ui/field.tsx` are installed; **zero** pages use them. 70 pages hand-roll `useState` + `Label` + `Input` with ad hoc validation and toast-only errors.
10. **Tables have no shared behaviour.** `ui/table` is used by 51 pages, but there is no DataTable: no sorting affordance, sticky header in 2 places, `overflow-x-auto` in 7, pagination re-implemented per page, empty/loading/error states duplicated per page.
11. **Empty states are ad hoc.** `ui/empty.tsx` is unused; each page composes its own centered icon + text.
12. **Auth pages are copy-pasted.** `login`, `forgot-password`, `reset-password`, `invite-accept` each duplicate the split layout. Forgot/reset are hard-coded "Enterprise HRMS" and ignore tenant context. Logo is constrained to 32 px inside a 48 px white square. No show/hide password. Errors surface only as toasts.
13. **Bundle.** No route splitting; Recharts, framer-motion, embla, cmdk, vaul all load on the login page.

## 3. Inconsistent components and styles (inventory)

| Area | Evidence |
|---|---|
| Status badges | `variant="outline"` 310, `secondary` 72, `destructive` 40; colour applied via ad hoc `className` per page; `fleet-health.tsx`, `platform-admin.tsx`, `organizations.tsx` each define their own status→variant mapper |
| Loading | Skeleton in 83 pages (good), `Loader2` spinner in 8, shapes differ page to page |
| Page shell | Mix of `p-6 lg:p-8 space-y-8`, `p-6 space-y-4`, bare `space-y-6` (platform-admin) |
| Headings | Serif (global) on tenant pages; some pages override with `font-sans` |
| Auth layouts | 4 near-identical split layouts |
| Toasts | Two systems installed, one used |
| Motion | framer stagger on dashboard KPI cards and organization list; spring drawer; Radix CSS elsewhere |
| Org identity | `OrgBrandHeader` and `OrgBrandSwitcher` in app-shell duplicate the same 20-line block |
| Sidebar | Custom implementation; shadcn `ui/sidebar.tsx` (collapsible, tooltips, rail) unused |

## 4. Typography assessment

- Body: DM Sans 14 px regular. Acceptable but geometric and slightly playful.
- Headings: Fraunces serif 600, letter-spacing −0.02 em. Editorial, not enterprise.
- Metadata: `text-xs` (12 px) and two `text-[11px]` uses (org slug). 11 px is below the readable floor.
- Numbers: no `tabular-nums` anywhere; KPI values are `text-3xl font-bold` inside CardTitle wrappers.
- Tables: `text-sm` (14 px) rows, `h-10` header, `p-2` cells. Reasonable density, no compact option.
- Weight usage is inconsistent (`font-bold` vs `font-semibold` for the same level).

## 5. Recommended typography system

**Single family: Inter (variable), self-hosted.** Ship via the `@fontsource-variable/inter` npm package (SIL Open Font License, redistributable, no Google Fonts request). Remove DM Sans, Fraunces, and the Google Fonts `<link>`s. Fallback stack: `Inter Variable, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`. Enable `font-feature-settings: "cv11", "ss01"` optional; always `tabular-nums` on numeric cells and KPIs.

| Role | Size / line | Weight | Tracking | Token |
|---|---|---|---|---|
| Display (auth, dashboards greeting) | 28 / 34 | 600 | −0.02 em | `text-display` |
| Page title | 22 / 28 | 600 | −0.015 em | `text-title` |
| Section title | 17 / 24 | 600 | −0.01 em | `text-section` |
| Card title | 15 / 22 | 600 | 0 | `text-card-title` |
| Body | 14 / 20 | 400 | 0 | `text-body` |
| Label | 13 / 18 | 500 | 0 | `text-label` |
| Meta / supporting | 12 / 16 | 400, muted-foreground | 0 | `text-meta` |
| KPI value | 28 / 32 | 600, `tabular-nums` | −0.02 em | `text-kpi` |
| Table cell | 13 / 20 | 400 (numeric: tabular) | 0 | `text-table` |
| Table header | 12 / 16 | 500, uppercase optional, muted | +0.02 em | `text-table-head` |
| Button | 14 / 20 (sm 13) | 500 | 0 | inherits |

Floor: nothing below 12 px. Replace both `text-[11px]` uses.

## 6. Proposed design tokens

Keep the **HSL-triple CSS-variable contract** (`--x: h s% l%`, consumed as `hsl(var(--x))`) because the backend `brandingThemeSchema` and `TenantThemeTokens` already write into it. Add semantic tokens alongside, all defined in `:root` and `.dark`.

```
/* Surfaces */
--background            page canvas (cool white, 210 20% 98%)
--surface               default panel/card (0 0% 100%)
--surface-elevated      popover, dialog, dropdown (0 0% 100% + shadow-md)
--surface-muted         table header, section band, code (215 20% 96%)
--surface-sunken        input wells on muted (215 20% 94%)

/* Lines */
--border                default hairline (215 16% 88%)
--border-strong         emphasized (215 16% 78%)
--input                 field border (215 16% 80%)

/* Text */
--foreground            (222 30% 12%)
--foreground-muted      (215 14% 42%)   AA on background/surface
--foreground-subtle     (215 12% 55%)   AA-large only; meta text >= 12 px

/* Brand (tenant may override primary + accent only, see §8) */
--primary / --primary-foreground / --primary-soft / --primary-hover
--accent  / --accent-foreground  / --accent-soft
--secondary / --secondary-foreground   (neutral, never tenant-set)

/* Semantic status (never tenant-set) */
--success  / --success-foreground / --success-soft   (152 60% 34% on 150 55% 94%)
--warning  / --warning-foreground / --warning-soft   (38 85% 40% on 42 90% 94%)
--danger   / --danger-foreground  / --danger-soft    (alias of --destructive)
--info     / --info-foreground    / --info-soft      (212 80% 44% on 212 90% 95%)

/* Interaction */
--focus                 2 px ring (primary) + 2 px offset background
--disabled-foreground   (215 12% 60%)  --disabled-surface (215 20% 95%)

/* Sidebar (tenant may set tone) */
--sidebar / --sidebar-foreground / --sidebar-border / --sidebar-active / --sidebar-active-foreground / --sidebar-hover

/* Shape, depth, motion */
--radius: 6px  (sm 4, md 6, lg 8, xl 12, full)
--shadow-xs: 0 1px 2px rgba(15,23,42,.05)
--shadow-sm: 0 1px 3px rgba(15,23,42,.08), 0 1px 2px rgba(15,23,42,.04)
--shadow-md: 0 4px 12px rgba(15,23,42,.08)   (popovers, dialogs only)
--shadow-lg: 0 12px 32px rgba(15,23,42,.12)  (modals only)
--ease-standard: cubic-bezier(.2,0,0,1)
--ease-exit: cubic-bezier(.4,0,1,1)
--dur-fast: 120ms  --dur-base: 180ms  --dur-slow: 240ms
```

Remove the crimson-tinted shadows and the `hover-elevate` pseudo-element system; replace with explicit `hover:bg-*` / `active:` classes in Button and Badge.

## 7. Colour and theme architecture

- **Light theme is the product.** Ship it first and make it excellent.
- **Dark theme:** keep the existing `.dark` block, map every new token into it, but do **not** expose a toggle in Phase A–E. The 1 `dark:` class in pages and the hard-coded `bg-*-100` badges mean dark would ship broken today. A Light / Dark / System toggle (via the already-installed `next-themes`) belongs in Phase F after the status-token migration removes hard-coded colours. Zero backend impact.
- Charts: `--chart-1..5` re-derived from primary, info, success, warning, and a neutral, so tenant primary influences series 1 only.
- Contrast budget: all text tokens meet WCAG AA (4.5:1) against `--surface` and `--background`; `--foreground-subtle` is restricted to ≥12 px meta text.

## 8. Tenant-branding architecture

**What exists and must be preserved:** `branding` config namespace (`systemDisplayName`, `theme` with 9 optional HSL triples), `PATCH /organizations/:id/config/branding` (Primary HR & Settings tab, raw JSON card), `GET /tenant-context` (hostname-resolved, public, no client-supplied hostname), `MembershipSummary.logoUrl/systemDisplayName`, `TenantTheme` runtime overrides, invite-page scoping. `POST /organizations/:id/logo` exists and validates uploads, but **no frontend page calls `useUploadOrganizationLogo`**.

**Proposed controlled model (no schema change; backend validation addition is optional):**

| Tenant may set | System derives | Never tenant-set |
|---|---|---|
| `primary` (one hue) | `primary-foreground` (auto white/near-black by luminance), `primary-soft`, `primary-hover`, `ring`/`focus` | success, warning, danger, info, foreground, borders, surfaces, spacing, radius, type |
| `accent` (optional) | `accent-foreground`, `accent-soft` | |
| `sidebar` tone (optional: `light` / `tinted` / `brand`) | sidebar foreground, hover, active from the chosen tone | |
| logo (existing upload endpoint) | fitted rendering (contain, max 160×64 desktop / 120×48 mobile / 36×36 rail) | |
| `systemDisplayName` | | |

Guardrails: the client-side `TenantTheme` continues to accept the existing nine keys (WWM's stored navy/gold values keep working unchanged) but additionally **clamps**: if a stored foreground fails 4.5:1 against its background, the derived foreground is used instead. Server side, a `.refine()` on `brandingThemeSchema` rejecting pairs below 4.5:1 is a small additive change (see §30). Tenant primary influences buttons, links, active nav, focus ring, and chart series 1 only; it never recolours status badges, table headers, or body text.

## 9. Login redesign

Shared `AuthLayout` used by login, forgot-password, reset-password, and invite-accept (removes 4 duplicated layouts).

Desktop (≥1024): split composition. Left 45 %: `--primary` panel with a CSS-only geometric line pattern at 6 % opacity (no imagery), tenant logo on a white fitted plate (max 160×64, `object-contain`), organization name (display), "Human Resource Management System" or `systemDisplayName` (label, 80 % white), footer with year + organization name. Right 55 %: centered 400 px card on `--background`.

Below 1024: single centered card, logo above the card on a neutral plate, name + system line, then the card.

Card hierarchy (matches the owner's example): `[Logo]` → **Organization name** (title) → *Human Resource Management System* (meta) → "Sign in to continue" (section) → Email → Password with show/hide toggle (`aria-pressed`, `aria-label`) → "Forgot password?" → primary button full width → inline `role="alert"` error region under the form (toast retained for success only) → loading state disables inputs and shows spinner in button.

Platform host (unresolved tenant) keeps "Enterprise HRMS" with the mark. `document.title` becomes `Sign in · {org}` from tenant context only. No hostname is ever read on the client; theme tokens continue to come only from `/tenant-context` and `/invitations/:token`.

## 10. Navigation redesign

Adopt the installed shadcn `ui/sidebar.tsx` (collapsible, rail, tooltips, keyboard shortcut, cookie-persisted state) instead of the bespoke sidebar; migrate the existing `navGroups` data (unchanged conditions, labels, hrefs, and `data-testid`s) into it.

- Width 264 px expanded, 56 px icon rail collapsed, `--dur-base` width transition; tooltips on the rail.
- Organization identity block at top (logo plate 36 px, name, system name, monospace slug at 12 px), switcher when multiple memberships.
- Section labels 11→12 px uppercase medium, muted; groups collapsible with a 180 ms `grid-template-rows` transition; active group auto-expands (existing behaviour).
- Active item: 2 px `--primary` bar on the left, `--sidebar-active` background, 500 weight, icon in primary. Hover: `--sidebar-hover` only.
- Operational groups first; a divider and an "Administration" section pinned last (Organisations, Organization Administration / HR Team Management, Platform Administration).
- User block at bottom with avatar, name, role label; log out moves into the account menu to reduce sidebar noise (keep `button-logout` test id on the menu item).
- Mobile (<1024): drawer via `ui/sheet.tsx` (CSS slide 200 ms), 288 px, focus trap, Escape, backdrop; replaces the framer drawer.
- Top bar: 56 px, page breadcrumb slot (from a `PageHeader` component), notifications, account.

## 11. Animation and motion specification

| Element | Motion | Duration | Easing |
|---|---|---|---|
| Sidebar expand/collapse | width + label opacity | 180 ms | standard |
| Nav group | grid-rows 0fr→1fr + chevron rotate | 180 ms | standard |
| Dropdown / select / popover | opacity 0→1, translateY 4→0 (scale 0.98→1 for popover) | 140 ms in / 100 ms out | standard / exit |
| Dialog | overlay opacity; panel opacity + scale 0.97→1 | 180 ms in / 120 ms out | standard / exit |
| Sheet / mobile drawer | translateX | 200 ms in / 160 ms out | standard / exit |
| Tabs | underline indicator translate (CSS `transition` on a positioned bar) | 160 ms | standard |
| Buttons | background 120 ms; press `scale(.98)` optional | 120 ms | standard |
| Interactive cards / rows | background or border only | 120 ms | standard |
| Toast | translateY 8→0 + opacity in; opacity out | 180 / 120 ms | standard / exit |
| Skeleton | existing `animate-pulse` | — | — |
| KPI cards / list items | **no stagger entrance** (remove framer stagger) | — | — |

Implementation: CSS transitions and the existing `tw-animate-css` utilities only. **Remove `framer-motion`** (5 call sites, all replaceable) and `react-icons` (unused). Global rule:

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

No motion on data-entry surfaces beyond focus rings and validation appearance.

## 12. Page transitions

Not recommended for the first release. If added in Phase F: a single 120 ms opacity fade on `<main>` keyed by route, CSS only, disabled under reduced motion. No vertical movement, no per-section animation.

## 13. Dashboard redesign

Backend provides `DashboardSummary { totalEmployees, activeModules, unreadNotifications, leaveMetrics, attendanceMetrics, assetMetrics, inventoryMetrics }` plus module enablement. The design uses only that.

- `PageHeader`: "Good morning, {firstName}" + organization name + date; right slot: quick actions that already exist as routes and pass the same role/module checks as the sidebar (e.g. My Leave, Requests, Attendance Register).
- KPI row (`MetricCard`): Employees, Active modules, Unread notifications, plus one leave KPI. Values in `text-kpi tabular-nums`, label above, optional supporting text; no icons unless they disambiguate.
- Module summary sections rendered only for enabled modules with data (leave by status as a compact horizontal bar list rather than a decorative chart; attendance, assets, inventory as compact metric groups).
- Remove the "Available Modules" card grid (decorative navigation duplicate) and the "System Status" card unless backed by a real signal.
- Trends: not shown until an endpoint returns history (none does today).

## 14. Tables

Create `components/data-table/` (headless, built on the existing `ui/table`; consider `@tanstack/react-table` ~14 KB gz only if column state grows beyond what a 200-line hand-rolled reducer handles):

- Column definitions with `align`, `width`, `priority` (1 = always visible, 2 = hide < 1024, 3 = hide < 768), `numeric`, `sortable`, `cell`.
- Sticky header (`position: sticky; top: 0` inside the scroll container), header `--surface-muted`, 12 px medium uppercase optional.
- Density `comfortable` (44 px rows) default, `compact` (36 px) via toolbar toggle persisted per table id.
- Row hover `--surface-muted`, selected row `--primary-soft` with left bar, focus-visible row outline for keyboard navigation.
- Toolbar slot: search input (debounced), filter chips, bulk action bar appearing when rows are selected, column visibility.
- Sort indicators (chevron, `aria-sort`), pagination footer (rows-per-page, range text, prev/next) that accepts either client-side or server-side paging (the 26 pages already using `limit`/`page` keep their server params).
- Built-in `EmptyState`, `LoadingState` (skeleton rows matching column count), `ErrorState` (reuses `QueryError`).
- Row actions: trailing kebab `DropdownMenu`, never more than two inline buttons.
- Responsive strategy per table, chosen by `responsive` prop: `scroll` (default: horizontal scroll with sticky first column and edge fade), `priority` (drops priority-3 then priority-2 columns), `expand` (chevron reveals hidden columns in a detail row), `cards` (≤640 px renders each row as a compact list card with the primary column as title and 2–3 key fields; used for employees, applications, requests).

## 15. Forms

Adopt the already-installed `react-hook-form` + `zod` + `ui/form.tsx` on all new and migrated forms. Add:

- `FormSection` (title, description, 2-column grid ≥768, 1 column below), `FormRow`, `FormActions` (sticky footer on long forms: Cancel secondary left, Save primary right, unsaved-changes guard).
- Label 13 px medium; required marked with `*` + `aria-required`; helper text 12 px muted; error 12 px danger with icon and `aria-describedby`; disabled uses `--disabled-*` tokens.
- `PasswordInput` (show/hide), `DatePicker` (existing `calendar.tsx` + popover), `Combobox`/multi-select via `command.tsx`, `FileDropzone` (accept, size, progress, uses existing upload endpoints only).
- Long HR forms (employee detail 38 labels, self-service 28) become sectioned pages with a left-hand section index ≥1280 px, sections stacked below.
- Field spacing: 16 px between fields, 32 px between sections.

## 16. Cards and badges

**Card variants** (`variant` prop on `ui/card.tsx`; default becomes flat):

| Variant | Style | Use |
|---|---|---|
| `standard` | border, `--surface`, radius-lg, no shadow | grouping |
| `metric` | standard + KPI slot + optional delta | dashboards |
| `actionable` | standard + hover border-strong + `shadow-xs` + focus ring | clickable lists (organizations) |
| `alert` | 3 px left border in semantic colour + `--*-soft` | actionable warnings |
| `summary` | `--surface-muted`, no border | read-only summaries |
| `information` | `--info-soft` + info icon | guidance |

Plain content (a single table, a form) is not wrapped in a Card.

**`StatusBadge`** (`components/status-badge.tsx`), one mapping table, soft style (`--*-soft` background, `--*-foreground` text, hairline border), 12 px medium, dot optional:

| Tone | Statuses |
|---|---|
| success | Active, Approved, Healthy, Completed, Enabled |
| warning | Trial, Pending, Warning, Degraded, Stale, Expiring |
| danger | Suspended, Rejected, Revoked, Critical, Unhealthy, Failed |
| info | Invited, In review, Running, Scheduled |
| neutral | Expired, Draft, Unknown, Disabled, Archived |

Replaces the three page-local status mappers and all `bg-*-100` classes.

## 17. Responsive strategy

Breakpoints: 640 / 768 / 1024 / 1280 / 1536 (Tailwind defaults). Audit widths: 320, 360, 375, 390, 414, 430, 768, 820, 1024, 1180, 1280, 1440.

| Width | Shell | Tables | Forms | Dialogs |
|---|---|---|---|---|
| < 640 | drawer nav, 16 px page padding, header 56 px | `cards` or `scroll` | 1 column, sticky actions | full-screen sheet |
| 640–1023 | drawer nav, 24 px padding | `priority` / `scroll` | 1–2 columns | centered ≤ 90 vw |
| 1024–1279 | sidebar 264 (collapsible) | full | 2 columns | centered |
| ≥ 1280 | sidebar + content max 1440 centered | full + column picker | 2 columns + section index | centered |

Rules: no horizontal page overflow (`overflow-x: clip` on `<main>`, scroll only inside table containers); logos always `object-contain` inside fixed boxes; dropdowns use Radix collision handling (already), dialogs `max-h-[85vh]` with internal scroll (already); minimum 44×44 px touch targets below 1024.

## 18. Accessibility strategy

- Keep every existing `aria-*`, `role`, and `data-testid` (741 tests depend on them).
- Add a skip link to `#main-content` (target exists, link does not).
- Global focus style: 2 px `--focus` ring with 2 px offset on all interactive elements; remove `focus:ring` variants that differ per component.
- Form errors linked via `aria-describedby`, region `aria-live="polite"`; login error `role="alert"`.
- Colour never the sole status carrier: badges carry text; health states carry words (fleet-health already does this).
- Reduced motion global rule (§11). Contrast verified by a unit test over the token file (§25).
- Target WCAG 2.1 AA on: login, dashboard, employees table, employee form, admin console, organizations, platform admin.

## 19. Super Admin redesign

**Identity:** when `me.role === 'super_admin'` on the platform host, the shell renders the control-plane variant: a graphite sidebar tone (not tenant-themed; the platform host has no tenant theme), header label "Enterprise HRMS · Platform Administration", and a persistent context bar "Managing: {Organization} · {slug}" whenever the route is `/admin/:organizationId` (preserves the existing safety context and the existing typed confirmation + identity card for sensitive actions).

**Platform Home** (`/platform-admin`, redesigned as an overview; all values from existing endpoints):

| Panel | Source |
|---|---|
| Organizations: total / active / trial / suspended | `GET /organizations` (client-side counts) |
| Installations and health | `GET /platform/fleet`, per-installation health (existing `FleetHealth`, unchanged semantics: no composite score, unknown/stale shown as themselves) |
| Backups | installation backup policy + last runs |
| Restore governance | existing `restore-governance.tsx` |
| Break-glass grants (live) | existing panel |
| Scheduled jobs (failed / running) | `GET /platform/scheduled-jobs` |
| Recent platform activity | platform audit events **only if** an endpoint exists; otherwise omitted |

Not shown (no backend): licences approaching expiry, security alerts, incidents.

## 20. Organizations management redesign

Replace the card list + sticky detail card with a `DataTable`:

Columns: Logo plate (36 px), Name + slug, Type, Status (`StatusBadge`), Employees (`employeeCount`), Created. Toolbar: search (name/slug), Type filter (8 enum values), Status filter (active/trial/suspended), sort by name/created/employees. Row click → `/admin/:organizationId`. Row kebab: Open workspace, Suspend / Reactivate (existing dialogs, Super Admin only per `faec47f`). Primary action "Create organization" (Super Admin only).

Because `GET /organizations` has no query parameters, filtering/sorting/paging is **client-side** in the first release (fleet is small). Primary domain, installation, health, and last activity are **not** in the list payload; showing them in the table needs the backend addition in §30. Until then, they appear in the workspace header only.

## 21. Organization detail redesign

`/admin/:organizationId` already is the organization workspace (fail-closed, "Managing:" header). Extend it rather than build a second one:

Header: logo plate, name, slug (monospace), status badge, type, primary domain (from `useListOrganizationDomains`), installation (from `useGetTenantIdentity`).

Tabs (existing functionality only): Overview (identity card, domains summary, modules summary, members count) · Profile & Branding (name/industry edit; **logo upload using the existing endpoint**; `systemDisplayName`; primary + accent pickers with live contrast preview, writing the same `branding` namespace) · Members · Roles · Modules · Domains (moved from `organizations.tsx`) · Installation (links, health, deployments, backup runs for the linked installation) · Security (feature flags, break-glass grants scoped to this org, platform user disable/enable) · Audit Log · Reports.

Danger zone at the bottom of Overview: Suspend / Reactivate with the existing typed confirmation. Not offered: Delete, Maintenance mode, Licence (no backend).

## 22. Create Organization experience

Today: one dialog (name, auto-slug, type). Logo, branding, domain, modules, and first administrator are separate endpoints called from separate screens. A multi-step wizard would issue several non-transactional requests; a failure midway leaves a partially configured tenant with no backend rollback. **Recommendation:** keep creation atomic (identity + type only) and land the Super Admin in the new workspace with a **Setup progress panel** (Overview tab) listing: Upload logo · Set branding · Add and verify domain · Set primary domain · Enable modules · Invite first administrator · Link installation. Each row deep-links to its tab and reflects real state from existing GETs. No backend change needed. A transactional onboarding endpoint is listed as an optional gap (§30).

## 23. Reusable components to create or refactor

Create: `AuthLayout`, `PageHeader`, `PageContainer`, `Section`, `MetricCard`, `StatusBadge`, `EmptyState` (wire `ui/empty.tsx`), `ErrorState` (wrap `QueryError`), `DataTable` (+ toolbar, pagination, responsive modes), `FormSection` / `FormRow` / `FormActions`, `PasswordInput`, `FileDropzone`, `LogoPlate` (fitted logo with fallback), `ConfirmDialog` (severity: normal / destructive / typed-confirmation, wrapping existing flows), `ContextBar` (Managing:), `SetupProgress`.

Refactor: `ui/button.tsx`, `ui/badge.tsx` (drop elevate system), `ui/card.tsx` (variants, flat default), `ui/table.tsx` (sticky, density), `ui/dialog.tsx` / `dropdown-menu.tsx` / `popover.tsx` / `sheet.tsx` / `toast.tsx` (durations per §11), `ui/tabs.tsx` (underline indicator), `ui/input.tsx` / `textarea.tsx` / `select.tsx` (height 36 px, focus token), `layout/app-shell.tsx` (onto `ui/sidebar.tsx`), `tenant-theme.tsx` (derivation + clamp), `index.css` (tokens, fonts, motion), `index.html` (remove Google Fonts), `hooks/use-toast.ts` (limit 3, auto-dismiss).

Remove: `framer-motion`, `react-icons`, `pages/landing.tsx` (unrouted), Google Fonts links, DM Sans / Fraunces imports.

## 24. Pages and components affected

- Phase A touches only `index.css`, `index.html`, `components/ui/*`, and adds new components; pages change visually through tokens without edits.
- Phase B: `login`, `forgot-password`, `reset-password`, `invite-accept`, `tenant-theme`.
- Phase C: `layout/app-shell.tsx`, `App.tsx` (lazy routes).
- Phase D: `dashboard`, `employees`, `employee-detail`, `employee-self-service`, `requests`, `my-requests`, `leave-*`, `attendance-*`, `branches`, `departments`, `positions`, then module tables in order of use.
- Phase E: `organizations`, `platform-admin`, `admin`, `components/platform/*`.
- Phase F: everything for responsive/a11y pass; `dark` toggle.

## 25. Implementation phases (refined)

| Phase | Scope | Backend | Exit criteria |
|---|---|---|---|
| **0 — Baseline** | Playwright screenshot set of 12 screens × 7 widths on a local seed DB; token contrast test | none | Baseline images committed under `artifacts/hrms/visual/` |
| **A1 — Foundation tokens & type** | tokens, self-hosted Inter, shadows, radius, motion vars, reduced-motion rule, remove serif headings and Google Fonts | none | 741 tests green; CSP report shows zero font/style violations from the app |
| **A2 — Primitives** | Button/Badge/Card/Table/Input/Dialog/Tabs/Toast refactor; StatusBadge, EmptyState, ErrorState, PageHeader, PageContainer, MetricCard, ConfirmDialog | none | component tests; screenshot diff reviewed |
| **B — Authentication & branding** | AuthLayout, premium tenant login, PasswordInput, tenant-aware forgot/reset, invite polish, theme derivation + clamp, logo upload UI in admin | optional contrast refine | login tests + new a11y tests; WWM navy/gold still renders |
| **C — Shell** | sidebar on `ui/sidebar`, rail, tooltips, context bar, mobile sheet, lazy routes, remove framer | none | app-shell tests; bundle: main chunk < 600 KB, login route < 250 KB |
| **D — Core HR surfaces** | DataTable + responsive modes, form primitives, dashboard, employees/requests/leave/attendance/master-data migrations | none | page tests; 320–430 px pass on migrated pages |
| **E — Super Admin** | control-plane shell variant, Platform Home, Organizations table, workspace tabs, Setup progress | list-payload additions optional | admin-guard and organizations tests; "Managing:" preserved |
| **F — Polish** | remaining pages, dark toggle, page fade (optional), full responsive/a11y sweep, performance budget check | none | axe clean on target pages; screenshot set re-baselined |

Sequencing note versus the owner's draft: Phase C (shell) is ordered before D because the DataTable responsive modes depend on the new content-width behaviour of the collapsible sidebar; B stays second because it is isolated and delivers the most visible tenant value early.

## 26. Test strategy

- Keep the 80 existing test files green at every phase; preserve `data-testid`s and visible strings that tests assert.
- New unit tests: token contrast (parse `index.css`, assert AA pairs), `StatusBadge` mapping, `DataTable` sorting/paging/responsive mode, `PasswordInput`, `AuthLayout` tenant fallback, theme derivation/clamp (extends `tenant-theme.test.tsx`), `ConfirmDialog` typed confirmation, lazy-route loading.
- Accessibility: `vitest-axe` on login, dashboard, employees, admin, organizations, platform-admin.
- Security regressions: existing `admin-guard`, `organizations-create-guard`, `invite-accept`, `login`, `tenant-theme` tests remain the authority that visual changes did not alter authorization semantics.
- CI: add the new suites to the existing "Frontend tests + lint" job.

## 27. Visual regression strategy

Feasible. Playwright (already used locally for screenshots) as a dev dependency of `artifacts/hrms` only, `pnpm --filter @workspace/hrms run visual`, run against the local Docker DB with the seeded demo organizations, never against Production. 12 screens (login platform, login WWM-themed, dashboard, employees, employee detail, requests, leave calendar, admin console, organizations, platform-admin, invite accept, 404) × 7 widths (360, 390, 430, 768, 1024, 1280, 1440). Threshold 0.2 %. Baselines re-approved at each phase exit. Optional CI job, non-blocking at first.

## 28. Performance considerations

- Fonts: one self-hosted variable woff2 (~100 KB, cached, `font-display: swap`), removes two third-party origins.
- Routes: `React.lazy` per page with a skeleton fallback; `manualChunks` for `recharts` and `date-fns`; expected main chunk from 1.98 MB to well under 600 KB, login route under 250 KB.
- Remove framer-motion and react-icons.
- CSS transitions only; `will-change` never set globally; sidebar uses `contain: layout paint`.
- Tables: no virtualization until a page exceeds ~500 rendered rows; server paging already exists where lists are large.
- Budget check in Phase C and F via `vite build --report`.

## 29. Risks

| Risk | Mitigation |
|---|---|
| Regressing authorization UI (create/suspend gating, Managing context, admin guard) | No changes to hooks or role checks; tests listed in §26 are the gate |
| WWM stored theme tokens (navy/gold) rendering differently after token restructuring | Keep the nine legacy keys as first-class inputs; add a test that renders WWM's exact stored values |
| Test brittleness (741 tests reference structure) | Preserve test ids and strings; refactor shells around content rather than rewriting pages |
| Giant pages (office-inventory 3,843 lines) cannot be safely restyled quickly | Restyle through primitives; migrate to DataTable/forms only in Phase F, page by page |
| Concurrent workstreams editing the same pages | Phase A/A2 touches only `ui/*` and CSS; land as small PRs; rebase often |
| Dark mode exposed too early | Toggle stays out until Phase F and hard-coded colours are gone |
| CSP enforcement flipped before fonts are self-hosted | Fonts move first (A1); CSP change stays an operations decision after report data is clean |

## 30. Backend and schema boundary

**Achievable with no backend or schema change:** everything in §5–§18, §19 (with the listed omissions), §20 (client-side filtering), §21, §22 (setup checklist), §23–§28, logo upload UI (endpoint exists), branding UI with derived colours (same namespace), dark toggle.

**Genuine backend gaps for the full proposed UX (all additive, none required for Phases A–D):**

1. `GET /organizations`: optional `q`, `type`, `status`, `sort`, `page`, `limit` query parameters, and `primaryDomain`, `installationId`, `installationHealth`, `memberCount`, `lastActivityAt` in the list item. Enables server-side organization filtering and the richer table.
2. `brandingThemeSchema`: `.refine()` rejecting foreground/background pairs under 4.5:1, plus acceptance of a simplified `{ primary, accent, sidebarTone }` input from which the server derives the nine legacy tokens (keeps existing consumers unchanged).
3. Platform activity feed: a `GET /platform/audit-events` (or equivalent) if "Recent platform activity" is wanted on Platform Home.
4. Licensing: no licence model exists anywhere in the API or schema. "Licence status", "approaching expiry", and licence filters cannot be shown until a licensing workstream defines them.
5. Incidents / security alerts: no endpoints. Omit from the design until they exist.
6. Organization-level maintenance mode and delete: no endpoints; not offered.
7. Optional: transactional onboarding endpoint (identity + branding + domain + modules + first admin in one request) if the owner later wants a true wizard.

---

### Recommended workstream identifier

**WS-22 — Enterprise UI Modernization** (sub-tasks numbered from W122 onward, following the existing W-numbering).

### Recommended next task

Owner approval of this blueprint, then Phase 0 (baseline screenshots + contrast test) and Phase A1 on a branch `ws-22/a1-foundation`, with no deployment.
