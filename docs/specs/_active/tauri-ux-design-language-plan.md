# Tauri App UX Update Plan — Design Language Adoption

> **Status:** Proposed · **Area:** desktop-client + tablet-client UI · **Version:** 1.0
> **Guideline source:** `dev/design-language.html` (the single source of truth — tabs: Color Palette, Buttons, Typography, Spacing & Layout, Icons, Elements, Components, Feedback, Forms, Audit)
> **Reference prototype:** `dev/kds-prototype.html` (what the design language looks like applied to a real screen)
> **Plan type:** Checklist — tick each item as it lands.

## How to use this document

Each section maps one design-language tab to concrete work in the Tauri apps. Checkboxes are actionable units of work. Where a token already exists in the app (`--brand-*`, `--neutral-*`), the item says *adopt*; otherwise *introduce*.

**Reading order for implementers:** 1. Tokens → 2. Typography → 3. Buttons → 4. Spacing & Layout → 5. Color Palette → 6. Forms → 7. Components → 8. Icons → 9. Feedback → 10. Elements → 11. Audit (testids). The plan is ordered so earlier items unlock later ones (tokens before components, type before forms).

---

## 0. Baseline & Source of Truth

- [ ] Confirm `dev/design-language.html` is the canonical guideline; any conflict between this plan and the page is resolved in favour of the page.
- [ ] Audit `ui/src/features/design/` — decide if the in-app DesignSystem showcase (tokens, swatches) is kept in sync with `design-language.html` or retired in favour of the static page.
- [ ] Capture current screenshots of desktop-client + tablet-client for before/after comparison.
- [ ] Enumerate the surfaces the plan touches: shell (topbar/nav/footer), settings panels, order forms, tables/menu, reports, modals/dialogs, empty/error states, toasts.

---

## 1. Design Tokens (prerequisite)

Reference: design-language #colors / #spacing (radii, elevation, motion tokens).

- [x] **Primary:** resolved 0.0.37 (round AH) — the semantic tokens are `--color-primary` (user-facing brand blue: **light `#147EFB`, dark `#1155CC`**; overridden at runtime by Settings → Appearance via `applyAccentPalette`; an empty persisted colour means "follow the theme") and `--color-accent` (the contrast-managed fill/text hover-active ladder, WCAG-gated per theme by `colorContrastCompliance.test.ts` — do NOT swap it with primary: a naive swap fails 4.5:1 on both themes).
- [ ] **Semantic tokens:** introduce `--success`, `--warning`, `--danger`, `--info` as semantic *roles* (not raw brand hex) — components must reference roles only.
- [ ] **Text tokens:** `--text`, `--text-muted`, `--text-on-color`; document the AA floor (muted is decorative-only, never essential info).
- [ ] **Surfaces:** `--bg`, `--bg-surface`, `--ghost-bg`, `--border`, `--border-strong`; verify dark + light both defined.
- [ ] **Radii:** one scale — `--r-sm` (8) / `--r-md` (10) / `--r-lg` (12) / `--r-pill`; replace ad-hoc radii (6px, 7px, 13px…).
- [ ] **Elevation:** `--shadow-sm` / `--shadow-md` / `--shadow-lg` ladder; map "more shadow = closer" (cards sm, modals md, overlays lg).
- [ ] **Motion tokens:** `--dur-instant/fast/base/slow` (0/120/200/350ms) + `--ease-standard/bounce/exit`; wire into the existing animation utilities.
- [ ] **Font tokens:** `--font` (Inter stack) + `--font-mono` (JetBrains Mono) matching the page's fallback order; keep `font-display: swap`.
- [ ] Document the token block in one place (mirror the page's theme-token section) so a rebrand touches one block.

---

## 2. Typography

Reference: design-language #typography.

- [ ] **Font family:** adopt Inter as the primary UI font in both apps (variable 400–800), JetBrains Mono for data (codes, hex, IPs, receipt totals).
- [ ] **Type scale:** adopt the strict ladder — 32 Display / 24 H1 / 20 H2 / 16 H3 / 14 Body / 12 Small / 11 Label; never skip rungs.
- [ ] **Weight roles:** 800 display · 700 headings + buttons · 600 subheads · 500 emphasis · 400 body; no faked weights (Inter is variable).
- [ ] **Letter-spacing:** tighten as size grows (−0.03em @32 → 0 @body); 0.08em on uppercase labels.
- [ ] **Line length:** body text capped at 65–75ch (~45rem).
- [ ] **Truncate, don't wrap** in controls: `white-space: nowrap` + ellipsis on buttons/pills/labels.
- [ ] **Anti-aliasing:** pin `-webkit-font-smoothing: antialiased` + `-moz-osx-font-smoothing: grayscale` on body.
- [ ] **Rem units:** text scale in rem (respects the app's adaptive scaling — see UX_GUIDELINES.md fluid zoom); px values on the page are design reference only.
- [ ] Sweep every screen for stray `px` font sizes that skip the ladder (e.g. 10px, 13px, 15px, 18px) and map to a ladder rung.

---

## 3. Buttons

Reference: design-language #buttons.

- [ ] **Size ladder:** Large 48px (primary CTA, full-width) / Medium 42px (default inline) / Small 34px (dense rows, toolbars, dialogs — never the primary action).
- [ ] **Touch floor:** 48px minimum hit target for anything a finger taps; 40px for icon-only (hit area, not visual).
- [ ] **Emphasis ladder:** one `primary` per view; `secondary` for the escape hatch; `ghost` for row-level actions; `danger`/`success` carry meaning, not volume.
- [ ] **One primary per view:** audit every screen for two competing primary buttons; resolve hierarchy first.
- [ ] **Icon combos:** leading/trailing icons allowed; icon+text never colour-alone for meaning.
- [ ] **Icon-only:** every icon-only button has `aria-label`; add tooltip in dense UIs.
- [ ] **Disabled:** 45% opacity + `pointer-events: none`; native `disabled` for keyboard-skipped; `aria-disabled="true"` when temporarily unavailable with a reason.
- [ ] **Menu slider (2–3 options):** adopt the pill-slider pattern (track padding 3px, indicator slides, `cubic-bezier(0.33,1,0.68,1)`) for mutually-exclusive choices; 4+ options → tabs or select.
- [ ] **Busy:** no double-fire — disable + feedback while in flight (see Feedback).
- [ ] Replace any native `<button>` styling drift with the button component so variants come from the ladder.

---

## 4. Spacing & Layout

Reference: design-language #spacing.

- [ ] **4px base scale:** spacing from 4 / 8 / 12 / 16 / 24 / 32; no arbitrary gaps (5px, 14px, 18px…).
- [ ] **Gap, not margins:** flex/grid `gap` + surface `padding`; no margins on shared children.
- [ ] **rem for padding** that scales with font size; px only for hairlines/shadows.
- [ ] **Strategy by size:** 4 micro (icon↔text), 8 default between related controls, 12 between groups, 16 card padding, 24 section separation, 32+ page rhythm.
- [ ] **Flexbox/Grid over absolute** positioning; min-width: 0 where a child can force overflow.
- [ ] **% + gap trap:** use `flex-basis: calc(100% / N - gap × (N-1) / N)` or `flex: 1` for exact equal columns; never `N × (100/N)%` + gaps.
- [ ] **Radii discipline:** corner never exceeds half the smaller dimension (else it reads as a pill accidentally).
- [ ] **Elevation ladder** applied (see §1): resting cards sm, floating layers md, overlays lg.

---

## 5. Color Palette

Reference: design-language #colors.

- [ ] **Semantic mapping** document: Primary-interact · Success-confirm · Danger-destroy · Warning-near-limit · Info-notify · Alert-act-now · Accent-decorate.
- [ ] **Components use semantic tokens only** — never raw brand hex in components.
- [ ] **Contrast check** on new token pairs (esp. muted-on-white ≈ 3:1; white-on-success is low — that's why success always pairs with a checkmark icon).
- [ ] **Dark + light parity:** both themes defined for every token; verify text/surface/border pairs on both.
- [ ] Reconcile `--brand-*` (auto-generated by sync-branding) with the semantic roles — the generated block may only define a subset.

---

## 6. Forms

Reference: design-language #forms.

- [ ] **Toggle switch:** track 2.5rem × 1.375rem, knob 1.125rem, bounce ease `cubic-bezier(0.34,1.56,0.64,1)`; use `input[role="switch"]`; testid on the input.
- [ ] **Text input / select:** 36px (2.25rem) height, padding 0 0.75rem, radius `--r-sm`; focus ring = `outline: 2px solid var(--primary); outline-offset: -2px; border-color: var(--primary)`.
- [ ] **Select:** same dimensions; custom chevron via `appearance: none` + SVG background.
- [ ] **Validation states:** 2px border in semantic colour + caption below; focus transitions border to primary over 0.2s.
- [ ] **Checkbox & radio:** native `accent-color: var(--primary)`, 16px; suppress outer focus ring (`outline: none`).
- [ ] **Range slider:** 6px track, pill radius, semantic-colour fill.
- [ ] **Textarea:** same border/radius/font; `resize: vertical`.
- [ ] **Error recovery:** shake + red border + caption together; never red alone, never caption alone.
- [ ] **Required fields:** clear `aria-required`/`aria-invalid` + `aria-describedby` wired to captions.
- [ ] Audit every settings panel against the KDS hamburger (the applied example): grouped cards, 44px rows, inset separators, 15px labels.

---

## 7. Components

Reference: design-language #components.

- [ ] **Cards:** default (border + shadow-sm + radius-lg) / highlight (brand fill, one per view) / ghost (tinted bg, no border — never nested inside a default card).
- [ ] **Card colour variants (stat cards):** 8–10% bg + 20% border in semantic colour; one number, one colour, one label; ≤3 stats per summary.
- [ ] **Modals:** dimmed overlay `rgba(0,0,0,0.4)`, centred surface (shadow-md), header (title + ✕ 28px circle), body = the *consequence* (never bare "Are you sure?"), footer (Cancel left, action right). Only for irreversible decisions or single-focus; reversible side tasks → inline panel.
- [ ] **Tooltips:** 11px/600, dark surface, arrow; never critical content.
- [ ] **Alerts:** persistent, `role="alert"`; close affordance; not toasts for irreversible outcomes.
- [ ] **Badges / status pills:** status pill = labelled state (10–15% tint, 11px); count badge = solid number capped 99+; dot = presence only. Pick the format needing least reading (dot beats pill beats count).
- [ ] Reconcile with the KDS prototype's order-card conventions (header colour coding by service type, per-item checkoff, footer action ladder).

---

## 8. Icons

Reference: design-language #icons.

- [ ] **Grid ladder:** 24 simple → 48/96 complex → 256 precision line art; grid = drawing resolution, render 14–32px.
- [ ] **currentColor everywhere** — an icon never makes its own colour decision.
- [ ] **Stroke scales with grid** (24→2, 48→4); filled silhouettes and stroke line-art both allowed.
- [ ] Reuse the KDS icons (dine-in utensils, takeaway bag, pause/resume, finish check) as the app's icon set where applicable.
- [ ] Every icon has a purpose; decorative icons are `aria-hidden="true"`, meaningful icons paired with text or aria-label.

---

## 9. Feedback

Reference: design-language #feedback.

- [ ] **The Rule:** every action has Before → Feedback → After; after-state must differ from before and confirm by pixels alone.
- [ ] **Before–Feedback–After cheat sheet:** press → scale(.97) + darker bg (fast/120ms) · busy → spinner (slow/350ms+) · success → checkmark pop (base/200ms) · error → shake + red + caption (fast/120ms) · remove → slide (slow/350ms) · toggle → knob bounce (base/200ms) · instant flip → 0ms.
- [ ] **Motion on transform/opacity only** — never width/height/top/margin (keeps old hardware at 60fps).
- [ ] **Never animate instant flips** (theme, filters, counts) — those are 0ms state changes.
- [ ] **Error = motion + colour + text** together; **success = checkmark, not just green**.
- [ ] **Reduced motion:** honour `prefers-reduced-motion` + the app's in-app toggle; durations → 0 but after-state never disappears.
- [ ] **Busy buttons:** disabled + spinner while in flight (no double-fire).
- [ ] **Least motion that confirms:** smallest duration/amplitude that reads clearly.

---

## 10. Elements

Reference: design-language #elements (flex/grid patterns).

- [ ] **Row pattern:** `display:flex; gap` for toolbars, action groups, label+value lines.
- [ ] **Stack pattern:** `flex-direction:column; gap` for settings lists, forms, card bodies.
- [ ] **Wrap pattern:** `flex-wrap:wrap` for unknown-count collections (tags, chips, payment buttons).
- [ ] **Split:** % widths + min-width:0 (see §4 gap trap).
- [ ] Sweep for margins-on-children and fixed-width containers on the flex axis; move spacing to the container.

---

## 11. Audit (data-testid)

Reference: design-language #audit.

- [ ] **Convention:** `feature-element[-action]`, kebab-case, lowercase, feature-scope-first, semantic (never `button-3`), stable across locales, unique per screen.
- [ ] **Prefix per screen:** e.g. `settings-sound-toggle`, `orderlist-filter-dine-in`, `kds-order-card-{id}-item-{slug}`.
- [ ] One id per control wherever it appears; duplicate controls in two features get feature prefixes.
- [ ] Add testids to every interactive element in the shells + high-traffic screens (settings, orders, tables, reports).
- [ ] Spot-check with a CDP query (like the KDS audit): zero interactive elements missing a `data-testid`.
- [ ] (Reference) The KDS prototype already conforms — use its ids as the naming style guide.

---

## 12. Delivery Checklist

- [ ] Tokens land first (this is the single biggest enabler).
- [ ] DesignSystem showcase in `ui/src/features/design/` updated to match (or removed).
- [ ] Both apps build clean: `npm run check:all` from `ui/` (lint → typecheck → test → i18n → E2E).
- [ ] Playwright/E2E selectors migrated from text/class to `data-testid` where applicable.
- [ ] Before/after screenshots captured; diff reviewed against `design-language.html`.
- [ ] Version stays `0.0.29` — no version bumps without explicit instruction.
- [ ] Commit per logical section (tokens, typography, buttons, …) with `--no-verify`; never push without an explicit order.

---

## Source files this plan touches (indicative)

- `ui/src/App.tsx`, `ui/src/main.tsx`, `ui/src/main.tablet.tsx` — shells
- `ui/src/features/design/` — tokens + showcase
- `ui/src/components/` — shared primitives (Button, Badge, Spinner, etc.)
- `ui/src/features/*` (settings, sales, orders, tables, reports, kds, …) — per-screen adoption
- `apps/desktop-client/`, `apps/tablet-client/` — Tauri entry/registration (commands stay per AGENTS.md)
- `dev/design-language.html`, `dev/kds-prototype.html` — guideline + reference prototype (read-only here)
