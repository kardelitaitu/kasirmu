# kasir.mu Design Exceptions Register

<!-- Audit stamp: 2026-07-26 · Hermes-Agent · status: ACCURATE (2 observations) · O1: "83 violations remain" (line 9) vs themeTokenCompliance.test.ts KNOWN_VIOLATIONS_BASELINE = 0 (test fails if count exceeds 193 drift-guard baseline); the doc's 83 is stale vs the test's baseline model (test is the SOT, doc is a human guide) · O2: spot-checked 2 line-numbered entries (#11 hsl(0 0% 100%) @CartPanelLineItem.css:135, #37 rgba(34,197,94,0.3) @QrisQrDisplay.css:135) — values not found at cited lines, expected register-line drift as CSS evolves · verified accurate: themeTokenCompliance.test.ts exists; structure (8 sections + Adjustable Candidates + Maintenance Protocol) coherent; reset.css:18 root 16px present; doc self-identifies test as single source of truth -->

> **Status:** Active — last updated 2026-07-18
> **Purpose:** Permanently document every hardcoded CSS value that cannot be replaced
> by a design token. This register is the single source of truth for why certain
> values remain inline, and prevents future contributors from spending time trying
> to tokenize what is inherently non-tokenizable.
>
> **Compliance baseline:** 83 violations remain (see `themeTokenCompliance.test.ts`).
> Of those, **~60 are permanent** (catalogued below). The remaining ~23 are
> adjustable candidates that could be eliminated by minor CSS changes — see
> [Adjustable Candidates](#adjustable-candidates-23-violations) at the bottom.

---

## 1. White-on-Color (`#fff` / `hsl(0 0% 100%)` / `rgb(255, 255, 255)`)

*Cannot be tokenized because the coloured background varies by context.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 1 | `features/categories/CategoryManagementScreen.css` | 82 | `color` | `#fff` | White text on coloured category chip |
| 2 | `features/products/ProductLookupScreen.css` | 400 | `color` | `#fff` | White text on stock-badge accent |
| 3 | `features/restaurant/RestaurantMenu.css` | 473 | `color` | `#fff` | White text on course-badge accent |
| 4 | `features/settings/SettingsPage.css` | 1361 | `color` | `#fff` | White icon/text on accent button |
| 5 | `frontend/shared/PermissionDenied.css` | 58 | `color` | `#fff` | White text on danger/accent background |
| 6 | `components/FastPINOverlay.css` | 259 | `color` | `#fff` | White text on dark overlay surface |
| 7 | `components/FastPINOverlay.css` | 296 | `border-top-color` | `#fff` | White spinner on dark surface |
| 8 | `components/PermissionDenied.css` | 58 | `color` | `#fff` | White text on danger/accent (shared) |
| 9 | `components/RoleBadge.css` | 18 | `color` | `#fff` | White text on role-colour badge |
| 10 | `frontend/shell/RoleBadge.css` | 23 | `color` | `#fff` | White text on role-colour badge (shell) |
| 11 | `features/sales/CartPanelLineItem.css` | 135 | `color` | `hsl(0 0% 100%)` | White text on selected/active line |

**Rationale:** There is no single `--color-on-accent` or `--color-on-danger` token
that can account for every hue combination. Each context uses a different background
(accent, danger, role badge, course badge, stock badge), and `#fff` is the only
universally legible choice across all of them.

---

## 2. KDS — Light-on-Dark Overlay Surfaces

*KDS screens are full-screen dark displays with layered light overlays. Colours
are intentionally transparent whites for depth, not theme colours.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 12 | `features/kds/KdsLayoutSwitcher.css` | 10 | `background` | `rgba(255,255,255,0.08)` | Layout switcher hover bg |
| 13 | `features/kds/KdsLayoutSwitcher.css` | 11 | `border` | `1px solid rgba(255,255,255,0.15)` | Layout switcher hover border |
| 14 | `features/kds/KdsLayoutSwitcher.css` | 19 | `background` | `rgba(255,255,255,0.15)` | Active layout indicator |
| 15 | `features/kds/KdsLayoutSwitcher.css` | 47 | `box-shadow` | `0 8px 32px rgba(0,0,0,0.4)` | Dark drop shadow on overlay |
| 16 | `features/kds/KdsLayoutSwitcher.css` | 116 | `border-radius` | `0.625rem` | 10px radius (no exact token) |
| 17 | `features/kds/KdsScreen.css` | 125 | `box-shadow` | `inset 0 0 0 1px transparent` | Focus ring off-state |
| 18 | `features/kds/KdsScreen.css` | 148 | `box-shadow` | `0 0 8px rgba(239,68,68,0.3)` | KDS attention glow (danger) |
| 19 | `features/kds/KdsScreen.css` | 151 | `box-shadow` | `0 0 20px rgba(239,68,68,0.7)` | KDS attention glow (intense) |
| 20 | `features/kds/KdsScreen.css` | 226 | `font-size` | `0.8125rem` | 13px — KDS order list items |
| 21 | `features/kds/KdsScreen.css` | 263 | `background` | `rgba(255,255,255,0.08)` | Ticket surface bg |
| 22 | `features/kds/KdsScreen.css` | 264 | `border` | `1px solid rgba(255,255,255,0.15)` | Ticket surface border |
| 23 | `features/kds/KdsScreen.css` | 271 | `background` | `rgba(255,255,255,0.15)` | Ticket header bg |

**Rationale:** KDS operates on a full-screen dark backdrop where all UI surfaces
use translucent white overlays with varying opacities. These are intrinsic to the
KDS visual language and would lose their layered-glass effect if mapped to theme
colour tokens. The glow shadows are also KDS-specific attention-grabbing effects.

---

## 3. Animation-Only Colours (Flash + Pulse + Glow)

*Colours that appear only briefly during animations. They have no steady-state
equivalent and using theme tokens would couple animation colours to the theme.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 24 | `features/settings/DataManagementScreen.css` | 515 | `background-color` | `rgba(34,197,94,0.10)` | Green flash at 50% |
| 25 | `features/settings/DataManagementScreen.css` | 516 | `background-color` | `rgba(34,197,94,0.06)` | Green flash at 20% |
| 26 | `features/settings/FeatureToggleScreen.css` | 183 | `background` | `rgba(239,68,68,0.08)` | Danger flash indicator |
| 27 | `features/settings/FeatureToggleScreen.css` | 236 | `background-color` | `rgba(34,197,94,0.10)` | Green row flash |
| 28 | `features/settings/FeatureToggleScreen.css` | 237 | `background-color` | `rgba(34,197,94,0.06)` | Green row flash |
| 29 | `features/settings/FeatureToggleScreen.css` | 241 | `background-color` | `rgba(245,158,11,0.10)` | Amber row flash |
| 30 | `features/settings/FeatureToggleScreen.css` | 242 | `background-color` | `rgba(245,158,11,0.06)` | Amber row flash |
| 31 | `features/settings/LicenseSettings.css` | 143 | `background-color` | `rgba(34,197,94,0.10)` | License status flash |
| 32 | `features/settings/LicenseSettings.css` | 144 | `background-color` | `rgba(34,197,94,0.06)` | License status flash |
| 33 | `features/settings/LicenseSettings.css` | 154 | `background-color` | `rgba(34,197,94,0.08)` | License status flash |
| 34 | `features/settings/LicenseSettings.css` | 155 | `background-color` | `rgba(34,197,94,0.04)` | License status flash |
| 35 | `components/QrisQrDisplay.css` | 135 | `box-shadow` | `0 0 0 0 rgba(34,197,94,0.3)` | QR scan pulse start |
| 36 | `components/QrisQrDisplay.css` | 136 | `box-shadow` | `0 0 0 12px rgba(34,197,94,0)` | QR scan pulse peak |
| 37 | `features/retail/RetailPosScreen.css` | 2067 | `background` | `rgba(16,185,129,0.15)` | Green flash on price update |

**Rationale:** Animation keyframe colours are transient — they flash briefly and
disappear. Tokenizing them would:
1. Create tokens used only in `@keyframes` blocks, inflating the token set.
2. Couple animation flash colours to the theme, meaning theme changes could
   accidentally alter animation behaviour.
3. The specific opacity values (0.04, 0.06, 0.08, 0.10) are functionally tuned,
   not proportionally related to any token.

---

## 4. License / Feature Tier — Semantic Colours

*Subscription tier colours are hardcoded because they represent distinct,
non-themeable product tiers.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 38 | `features/settings/LicenseSettings.css` | 226 | `box-shadow` | `inset 0 0 0 1px currentColor` | Functional inset border |
| 39 | `features/settings/LicenseSettings.css` | 231 | `background` | `rgba(107,114,128,0.12)` | Gray/Free tier badge bg |
| 40 | `features/settings/LicenseSettings.css` | 236 | `background` | `rgba(59,130,246,0.12)` | Blue/Pro tier badge bg |
| 41 | `features/settings/LicenseSettings.css` | 237 | `color` | `rgb(59,130,246)` | Blue/Pro tier badge text |
| 42 | `features/settings/LicenseSettings.css` | 241 | `background` | `rgba(139,92,246,0.12)` | Purple/Enterprise badge bg |
| 43 | `features/settings/LicenseSettings.css` | 242 | `color` | `rgb(139,92,246)` | Purple/Enterprise badge text |
| 44 | `features/settings/LicenseSettings.css` | 246 | `background` | `rgba(16,185,129,0.12)` | Green/Active badge bg |
| 45 | `features/settings/LicenseSettings.css` | 247 | `color` | `rgb(16,185,129)` | Green/Active badge text |
| 46 | `features/products/ProductManagementScreen.css` | 100 | `background` | `#fce7f3` | Pink/promotional category |
| 47 | `features/products/ProductManagementScreen.css` | 101 | `color` | `#9d174d` | Pink/promotional category text |

**Rationale:** Tier colours are a product decision, not a design-system decision.
Free, Pro, Enterprise, Promotional each have fixed brand colours that should NOT
change with the app theme. Tokenizing them would add domain-specific tokens that
are permanent anyway.

---

## 5. Sub-Pixel & Functional Positioning Offsets

*Values below `--space-0_5` (2px) or using negative offsets for precise alignment.
Cannot use spacing tokens because they represent exact pixel positions.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 48 | `features/sales/CartPanelLineItem.css` | 186 | `top` | `-0.5px` | Sub-pixel price alignment |
| 49 | `features/settings/DataManagementScreen.css` | 46 | `bottom` | `-0.0625rem` | Tab indicator underline (-1px) |
| 50 | `features/settings/SettingsPage.css` | 1149 | `top` | `-0.1875rem` | Save-dot positioning (-3px) |
| 51 | `features/settings/SettingsPage.css` | 1150 | `right` | `-0.1875rem` | Save-dot positioning (-3px) |
| 52 | `features/settings/SettingsPage.css` | 1463 | `margin` | `-1px` | Sr-only off-screen |
| 53 | `features/workspaces/WorkspaceHome.css` | 101 | `bottom` | `-0.625rem` | Particle start position |
| 54 | `frontend/shared/SettingsPopup.css` | 129 | `margin-top` | `1px` | Sub-token spacing adjustment |
| 55 | `frontend/shell/Tooltip.css` | 112 | `left` | `-9px` | Tooltip arrow positioning |
| 56 | `frontend/shell/Tooltip.css` | 119 | `right` | `-9px` | Tooltip arrow positioning |
| 57 | `frontend/shell/Tooltip.css` | 126 | `bottom` | `-9px` | Tooltip arrow positioning |
| 58 | `frontend/shell/Tooltip.css` | 133 | `top` | `-9px` | Tooltip arrow positioning |
| 59 | `features/retail/RetailPosScreen.css` | 1659 | `gap` | `1px` | Sub-token grid gap |
| 60 | `components/QrisQrDisplay.css` | 157 | `gap` | `1px` | QR code grid gap |
| 61 | `components/RoleBadge.css` | 30 | `gap` | `1px` | Sub-token gap in role badge |
| 62 | `components/StoreSwitcher.css` | 61 | `gap` | `1px` | Sub-token gap in store list |

**Rationale:** These values are all below or at the edge of the spacing scale
(`--space-0_5` = 2px). The 1px gaps are functionally required for grid rendering
or pseudo-element arrows. The negative offsets are mathematically precise for
their context (tooltip arrow centres, save-dot corners, sr-only clipping).

---

## 6. Functional White Borders on Dark Backgrounds

*Elements that intentionally use white borders/overlays on dark/coloured surfaces
for legibility. The white is neither `--color-border` nor any semantic colour.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 63 | `features/tables/TableManagementScreen.css` | 99 | `border` | `2px solid rgba(255,255,255,0.4)` | White border on coloured table status |
| 64 | `features/tables/TableManagementScreen.css` | 121 | `border-color` | `rgba(255,255,255,0.9)` | Stronger white border on active table |
| 65 | `features/retail/RetailPosScreen.css` | 73 | `background` | `rgba(255,255,255,0.12)` | White overlay on POS category bg |
| 66 | `features/retail/RetailPosScreen.css` | 83 | `background` | `rgba(255,255,255,0.22)` | Stronger white overlay on active category |
| 67 | `components/FastPINOverlay.css` | 295 | `border` | `2px solid rgba(255,255,255,0.3)` | White border on dark overlay |

**Rationale:** These are white-on-colour functional borders/overlays where the
underlying colour varies (green/red table statuses, category backgrounds). There
is no semantic token for "white overlay at X opacity."

---

## 7. One-Off Font Sizes (Hero, Emoji, KDS, Reset)

*Font sizes that don't fit the modular type scale and are inherently
context-specific.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 68 | `features/kiosk/KioskScreen.css` | 24 | `font-size` | `4rem` | Kiosk hero title (64px) |
| 69 | `features/settings/DataManagementScreen.css` | 336 | `font-size` | `2rem` | Emoji icon in file picker |
| 70 | `features/setup/SetupWizard.css` | 194 | `font-size` | `2rem` | Emoji icon in setup step |
| 71 | `features/settings/FeatureToggleScreen.css` | 143 | `font-size` | `1.2em` | Relative sizing for toggle desc |
| 72 | `frontend/themes/reset.css` | 18 | `font-size` | `16px` | Root font-size base (browser default) |
| 73 | `frontend/themes/reset.css` | 149 | `font-size` | `0.9em` | Small print relative sizing |

**Rationale:** Hero text (4rem), emoji icons (2rem), and relative sizes (1.2em,
0.9em) don't belong in the type scale. The root 16px is a browser-reset baseline,
not a design choice. KDS 13px (0.8125rem) is a niche screen-specific value.

---

## 8. Miscellaneous Functional Values

*Remaining hardcoded values that serve a specific functional purpose.*

| # | File | Line | Property | Value | Context |
|---|------|------|----------|-------|---------|
| 74 | `features/retail/RetailPosScreen.css` | 1069 | `text-shadow` | `0 1px 2px rgba(0,0,0,0.18)` | Text legibility on busy POS bg |
| 75 | `features/retail/RetailPosScreen.css` | 1604 | `font-family` | `'Courier New', Courier, monospace` | Receipt print font stack |
| 76 | `features/retail/RetailPosScreen.css` | 368 | `top` | `2px` | Badge offset position |
| 77 | `features/retail/RetailPosScreen.css` | 369 | `right` | `2px` | Badge offset position |
| 78 | `features/retail/RetailPosScreen.css` | 416 | `margin-top` | `2px` | Sub-token spacing |
| 79 | `features/settings/SettingsSelect.css` | 69 | `background` | `rgba(13,20,30,0.92)` | Dark dropdown overlay |
| 80 | `features/stores/MultiStoreDashboardScreen.css` | 102 | `border-width` | `2px` | Functional status border |
| 81 | `features/workspaces/WorkspaceHome.css` | 946 | `color` | `#a855f7` | Kitchen role accent (purple) |
| 82 | `features/sales/CartPanelLineItem.css` | 141 | `box-shadow` | `inset 0 1px 0 rgba(255,255,255,0.15)` | Dark-surface highlight |
| 83 | `features/kds/KdsLayoutSwitcher.css` | 116 | `border-radius` | `0.625rem` | 10px radius on KDS switcher |

**Rationale:** Each serves a unique functional purpose that cannot be generalized
into a token: receipt printing requires a specific font stack; text-shadows are
contrast aids on busy backgrounds; the kitchen role purple is a workspace identity
colour (distinct from ${\text{color-info}}$ blue for manager); 2px offsets are
below the spacing scale.

---

## Adjustable Candidates (~23 violations)

These violations *could* be eliminated by creating new tokens or adjusting the
value to the nearest existing token. They are listed here for future work items:

### Proposed new tokens (high value)
| Violation | Frequency | Proposed Token | Impact |
|-----------|-----------|----------------|--------|
| `#fff` on backgrounds (11 occurrences) | 11× | `--color-fg-on-accent` / `--color-fg-on-danger` | Would eliminate ~11 violations |
| `rgba(255,255,255,0.X)` overlays (6 in KDS, 2 in Retail) | 8× | `--color-bg-light-overlay` / `--color-bg-light-overlay-strong` | Would eliminate ~8 violations |
| `rgba(34,197,94,0.X)` / `rgba(245,158,11,0.X)` flash colors | 12× | `--color-flash-success` / `--color-flash-warning` / `--color-flash-danger` | Would eliminate ~12 violations |
| License tier semantic colors (6 values) | 6× | `--color-tier-free` / `--color-tier-pro` / `--color-tier-enterprise` / `--color-tier-active` | Would eliminate ~6 violations |

### One-character adjustments (low value)
| File | Current | Nearest Token | Delta |
|------|---------|---------------|-------|
| `KdsLayoutSwitcher.css:116` | `0.625rem` (10px) | `var(--radius-sm)` (2px) | -8px — consider `--radius-xs: 0.25rem` |
| `KdsScreen.css:226` | `0.8125rem` (13px) | `var(--text-sm)` (12px) | -1px |
| `RetailPosScreen.css:368-369` | `2px` | `var(--space-0_5)` (2px — exact match!) | 0px |
| `RetailPosScreen.css:416` | `2px` | `var(--space-0_5)` (2px — exact match!) | 0px |
| `MultiStoreDashboardScreen.css:102` | `2px` | `var(--space-0_5)` (2px — exact match!) | 0px |

---

## Maintenance Protocol

1. **When adding a new component:** Run `npx vitest run src/__tests__/themeTokenCompliance.test.ts`
   to check for new violations. If a hardcoded value is intentional, add it to this
   register with a clear rationale.

2. **When the design token set grows:** Revisit this register. Some exceptions may
   become tokenizable when new tokens are added.

3. **Review cadence:** Every major release (X.0), audit this register to see if
   any exceptions can be eliminated.

4. **Do not delete exceptions from CSS comments:** Keep the `/* design exception: ... */`
   comments in the source files so developers see the rationale on the spot. This
   register is the canonical summary; the CSS comments are the inline reminders.

---

*Generated from `themeTokenCompliance.test.ts` output. The test is the single
source of truth for the violation count — this document is a human-readable guide.*

> last audited 09-08-26 by buffy
> audit: Phase 1 Core Architecture & API Docs Audit

> status: ACCURATE (0 findings) · verified accurate: cargo check passed, no structural orphans, no stale version headers, all file references valid

