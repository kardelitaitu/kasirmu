<!-- Audit stamp: 2026-09-29 · docs-auditor · status: VERIFIED-CLAIMS RE-CONFIRMED, body preserved unchanged · Audited on branch 0.0.40. The 2026-07-28 Buffy stamp above is the original verification record and is retained verbatim; this entry confirms it rather than restating it. The P0 fixes this audit closed are genuinely closed, checked in the file itself rather than trusted from the stamp: `ui/src/features/retail/RetailPosScreen.tsx` calls `useOptionalTheme` at line 36, and both `localStorage['retail-theme']` and `_setTheme` return ZERO matches — the shadow state, the private storage key and the dead setter the audit named are all gone. The P0 finding that POS-domain tokens were "DEFINED ZERO TIMES anywhere in `ui/src/`" is the one that must not be re-broken, and the file that now defines them is `ui/src/theme/tokens.css`. · TWO CURRENT-STATE NOTES recorded here rather than written into the body, because both sit inside the Verification Summary where they are statements about branch `0.0.24` and rewriting them would falsify that record: (1) the summary cites `ui/src/frontend/themes/tokens.css`, and that directory no longer exists — the token sheet is now `ui/src/theme/tokens.css`; (2) the summary says "The four `data-theme={theme}` sites all mirror the live global value", and the file now has exactly ONE, at line 1441 on the root `<div className="retail-pos">`. That is a consolidation, not a regression — one root-level site driven by the live global theme is strictly better than four, and it still satisfies this audit's intent that the POS sub-tree follow `<html data-theme>`. · The Findings sections (shadow theme state, undefined tokens, storage-key collision, the `hsl()` escapes, the dead setter) are the audit's evidence describing the PRE-FIX state and are left exactly as written, down to the commit `972e4b0c` that closed Step A. An audit whose findings are edited to match the fixed code is no longer an audit. · REPAIRED: the machine-read footer claimed "ACCURATE (0 findings) · … all file references valid" — but this file HAS findings, seven of them, which is its entire purpose, and its own cited token path no longer resolves. The false footer block is replaced with the single machine-read line; this is the same defect found in `docs/archived/code-quality-2026-07-20.md` and `docs/archived/i18n-todo.md`. · The author's 2026-07-28 marker is the only pre-existing stamp; it was kept, not replaced, because it is the verification of record for this audit. -->

# Retail POS Theming Audit — 2026-07-28

<!-- Original audit marker (2026-07-28, kept verbatim — not superseded, it is the verification of record) · Buffy · status: VERIFIED (fix cycle closed) · branch: 0.0.24 -->
<!-- Scope: ui/src/features/retail/RetailPosScreen.tsx + RetailPosScreen.css + sibling theme files -->

## Verification Summary

Verification completed on branch `0.0.24`:

- `RetailPosScreen.tsx` consumes the global theme via `useOptionalTheme()?.theme`; no shadow `useState`, no `localStorage['retail-theme']` key, no `_setTheme` dead setter, and no narrowed `'light' | 'dark'` type remain. The four `data-theme={theme}` sites all mirror the live global value.
- All POS-only CSS tokens used in `RetailPosScreen.css` are defined in `ui/src/frontend/themes/tokens.css` (`:root`) and inherited across all theme blocks (`[data-theme="light"]`, `[data-theme="dark"]`).
- TypeScript typecheck passes.
- Theme-related test suites pass: `RetailPosScreen.test.tsx` (25 tests), `themeRegression.test.tsx` (10 tests), `themeRegressionRetailPosScreen.test.tsx` (4 tests).

## TL;DR

`RetailPosScreen` does not participate in the global theme system. It declares a **shadow `theme` state** with its own localStorage key (`retail-theme` vs the global `oz-pos-theme-v4`), an outdated type set (`'light' \| 'dark'` vs the 3-value global `'default' \| 'light' \| 'dark'`), and an underscore-prefixed setter (`_setTheme`) that is never called. The component then writes `data-theme={theme}` onto its own `<div className="retail-pos">` sub-tree, creating a non-reactive scope that drifts away from the global `<html data-theme>` whenever the user toggles the global theme via `ThemeToggle`. Worse, the **POS-domain tokens it heavily relies on (`--color-primary-pos`, `--color-success-pos`, `--color-warning-pos`, `--color-bg-pos`, `--color-dark-bg-pos`, `--color-fn-key-pos`, `--color-dark-border-pos`) are RENDERED at the CSS level ~30 times but are DEFINED ZERO TIMES anywhere in `ui/src/`** — neither in `tokens.css` (`:root`, `[data-theme="light"]`, or `[data-theme="dark"]`), nor via runtime injection in `applyAccentPalette`. The CSS comment at RetailPosScreen.css:1–6 explicitly claims the POS tokens "live in that tokens file" but the claim is false.

Three compounding issues produce the user's observation: (1) shadow theme state that goes stale, (2) sub-tree `data-theme` mismatch with `<html>` scope, (3) undefined POS tokens that should exist in every theme variant.

## Findings — ranked

| # | Sev  | Location                                     | Issue (summary)                                                                                      |
|---|------|----------------------------------------------|------------------------------------------------------------------------------------------------------|
| 1 | **P0** | `RetailPosScreen.tsx:166–172`               | Shadow `theme` state shadows global ThemeProvider; never updates reactively.                         |
| 2 | **P0** | `RetailPosScreen.css` × 30+ usages of POS tokens | `--color-primary-pos` etc. have **0 definitions** anywhere in `ui/src/` (CSS-level orphan refs). |
| 3 | **P0** | `RetailPosScreen.tsx:167`                   | Storage-key collision: `localStorage['retail-theme']` vs global `'oz-pos-theme-v4'`.                  |
| 4 | **P1** | `RetailPosScreen.css:1068`                  | Hardcoded `#000` literal in `.retail-low-stock-banner` border-bottom (token-compliance violation).    |
| 5 | **P1** | `RetailPosScreen.css:321 / 334 / 341`       | `hsl(var(--cat-hue, 210), 30%, 70%)` etc. — hardcoded lightness/saturation escape token rail.          |
| 6 | **P2** | `RetailPosScreen.tsx:166`                   | Type set is `'light' \| 'dark'`, omitting global `'default'`; setter never invoked (`_setTheme`).     |
| 7 | **P2** | `RetailPosScreen.tsx` (whole file)          | Zero `useTheme`/`ThemeProvider` imports — does not subscribe to global theme.                        |

## Finding 1 — shadow theme state (P0)

**Where**: `ui/src/features/retail/RetailPosScreen.tsx:166–172`

```tsx
const [theme, _setTheme] = useState<'light' | 'dark'>(() => {
  const saved = localStorage.getItem('retail-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
});
```

Why this is broken:

- **The setter `_setTheme` is never called** anywhere in the file (grep: zero call sites). The state is initialised from the OS preference on mount and then frozen — it is functionally a one-shot read of `prefers-color-scheme: dark` with a stale localStorage fallback persisted under a key the global ThemeProvider never sees.- **`data-theme={theme}` is set on multiple root wrappers** (the main `<div className="retail-pos">`, plus the wrapper divs that render SalesHistory, StockInquiry, TableManagement swap-ins — see `RetailPosScreen.tsx:692, 721, 750` for the three `data-theme={theme}` occurrences). This scopes a sub-tree's tokens under the *frozen* local value rather than the live global one on `<html>`.

  > **Resolved by [`972e4b0c`]:** Step A replaced the shadow `useState` with `const theme = useOptionalTheme()?.theme;` so all four `data-theme={theme}` sites now consume the same live global theme — there is no longer a frozen local value sub-tree.
- **Type set only contains `'light' | 'dark'`** while `ThemeProvider` exports `Theme = 'default' | 'light' | 'dark'` (see `ThemeProvider.tsx:24`). The two state machines never reconcile.

**What the user observes in practice**:

1. User opens retail POS at 09:00 with OS set to light. `prefers-color-scheme: dark` returns `false`, local state initialises to `'light'`. The screen renders in light mode.
2. User opens `ThemeToggle` (in the global shell) and switches app theme to `dark`. `<html data-theme="dark">` flips. Other screens re-theme via token cascade.
3. Retail POS does **not** pick this up. Its `<div className="retail-pos" data-theme="light">` is still light. Result: visual mismatch between retail POS chrome (light) and the rest of the app (dark).

## Finding 2 — POS-domain tokens defined zero times (P0)

The CSS at `RetailPosScreen.css:1–6` says:

> "POS-domain extensions (navy primary, bronzy warning, F-key yellow) live in that tokens file so retail-pos and the cousin tablet-pos keep a single source of truth. There is intentionally no local :root here."

This claim is **false**. Direct evidence:

```
ui/src/frontend/themes/tokens.css has 0 definitions of:
  --color-primary-pos
  --color-primary-pos-dark
  --color-primary-pos-light
  --color-success-pos
  --color-success-pos-darker
  --color-warning-pos
  --color-fn-key-pos
  --color-bg-pos
  --color-dark-bg-pos
  --color-dark-border-pos

applyAccentPalette() injects at runtime:
  --color-accent, --color-accent-hover, --color-accent-active,
  --color-accent-subtle, --color-accent-fg, --color-accent-dim,
  --color-accent-alpha, --color-accent-secondary,
  --color-accent-subtle-fg, --color-accent-hover-fg, --color-accent-active-fg
  (ui/src/utils/color.ts:129–139)
```

`-color-primary-pos` is referenced **30 times** in `RetailPosScreen.css` (lines 36, 40, 73, 122, 141, 161, 221, 270, 289, 296, 297, 335, 346, plus `color-mix(...)` variants). None of those references resolve to a defined CSS custom property — by the CSS spec they fall back to the property's initial value (or `unset` for substitutes like `background`), so:

- `<div className="retail-pos">` background falls to `transparent` (the `--color-bg-pos` lookup fails).
- `.retail-product-btn` border-top, hover/active backgrounds, outline fall back to defaults — category hue colour (`hsl(var(--cat-hue), 30%, 70%)`) inherits the parent `--cat-hue, 210` but the outer literal saturation/lightness are hardcoded (Finding 5).
- `.retail-cart-action-btn--pay` (success colour), `--void` (danger), `--discount` (info) and primary-pos highlights all silently miss their navy / green / red colours.

Peer audit screens in `__tests__/themeRegression.test.tsx` and `__tests__/colorContrastCompliance.test.ts` already encode an SOT model. Adding `--color-primary-pos` (etc.) as **unenforced design exceptions** is the only reason this regression stayed hidden from the theme-compliance test surface — the test doesn't track POS-only tokens because no POS-only tokens are *supposed* to exist as hardcoded escapes; the comment in `RetailPosScreen.css:1–6` is the only place that names them.

## Finding 3 — storage key collision (P0)

- `RetailPosScreen.tsx:172` writes **`localStorage['retail-theme']`**.
- `ThemeProvider.tsx:42` writes **`localStorage['oz-pos-theme-v4']`** (a different v4-suffixed key, deliberately versioned to invalidate pre-existing settings).

Two systems, one component ignored by the other, two storage entries that can disagree. App theme on `<html>` follows `oz-pos-theme-v4`; retail sub-tree follows `retail-theme`. A user who goes to Settings → Display → toggle theme updates `oz-pos-theme-v4`. Retail never notices — it still has the original `retail-theme` value (or `null`, which falls back to `prefers-color-scheme`).

## Finding 4 — hardcoded `#000` literal (P1)

`RetailPosScreen.css:1068`:

```css
border-bottom: 1px solid color-mix(in srgb, var(--color-warning-pos) 60%, #000);
```

Why this is wrong:

- The other 80+ colour references in the file are token-driven (`var(--color-...)`). This single `#000` is the only hardcoded hex in the entire file.
- It was likely copy-pasted from the existing warning-pos border styling; the original intent was probably "darken the warning-pos by 60%" — but the darken target should be **a token** that itself responds to theme, not `#000`, which is permanently black in light/dark/default theme equally.
- Documented register reference: this matches the `design-exceptions.md` "Adjustable" / "Hardcoded-Not-Allowed" pattern that the repo enumerates. The exception register (latest audit stamp: 2026-07-26) is the single source of truth for *why* a hardcoded escape exists; this `#000` is not listed there → outlier.

Replacement candidate: `color-mix(in srgb, var(--color-warning-pos) 60%, var(--color-ink))` or define a new `--color-warning-pos-edge` token.

## Finding 5 — `hsl()` saturation/lightness escapes (P1)

`RetailPosScreen.css:321 / 334 / 341`:

```css
border-top: 0.1875rem solid hsl(var(--cat-hue, 210), 30%, 70%);
background: hsl(var(--cat-hue, 210), 40%, 92%);  /* hover */
background: hsl(var(--cat-hue, 210), 40%, 82%);  /* active */
```

Why this is wrong:

- The `--cat-hue` hue *does* vary per category (good), but the lightness/saturation `30% / 40% / 70 / 82 / 92` are baked in. In a light theme the hover (`40%, 92%`) is near-white — fine for the background-elevated embedded inside a light-theme chrome. In the dark theme it would render as a near-white-on-dark hover (visible on dark surface) — but here the screen reads the dark-theme `--color-bg-elevated` would *flip* to the dark-theme value, and `hsl(cat-hue, 40%, 92%)` (no theme relation) would still render near-white, producing wrong contrast.
- Better: derive colours from `--color-bg-surface` and `--cat-hue` only — `color-mix(in srgb, var(--color-bg-surface), hsl(var(--cat-hue) 60% 50%) 18%)` — so lightness tracks theme tokens. Or expose `--color-product-idle`, `--color-product-hover`, `--color-product-active` triplets and define them per theme.

## Finding 6 — type set + dead setter (P2)

- The setter returned by `useState` is renamed to `_setTheme` (TS/JS convention: underscore prefix signals "intentionally unused"). However, this is **not** a valid "intentionally unused" pattern when the value is declared with `const` at the top of a public React component. ESLint rules (`@typescript-eslint/no-unused-vars` ignoring `_`-prefix) will silent OK, but the rendering consequence is real.
- The type `'light' | 'dark'` is **smaller** than the global `Theme = 'default' | 'light' | 'dark'`. The local state has no `'default'` representation; if the user toggles to `default`, the local state cannot mirror it.

Fix concept: remove the local `useState` entirely. Consume `useTheme()` from `ThemeProvider` and pass `theme` directly into `data-theme={theme}` on the root wrapper so the React tree mirrors the global theme one-for-one.

## Finding 7 — no `useTheme` / `ThemeProvider` import (P2)

`RetailPosScreen.tsx` imports nothing from `@/frontend/shell/ThemeProvider.tsx`. None of:

- `useTheme()` (live `{ theme, toggleTheme, setTheme }`)
- `useOptionalTheme()` (safe variant)

are referenced anywhere in the file. peer screens (`KdsScreen`, `SettingsPage`, `WorkspaceHome`) all subscribe to the global theme via `useTheme()` and reflect its value through the cascade — no per-screen shadow state.

## Architecture comparison — peer screens

| Screen                          | Local theme state? | useTheme? | data-theme attribute | Notes |
|---------------------------------|--------------------|-----------|---------------------|-------|
| `RetailPosScreen.tsx`           | YES (shadow)       | NO        | YES on `.retail-pos` divs | **the outlier** |
| `KdsScreen.tsx` (kds/)          | NO                 | YES       | NO                  | Uses global tokens via cascade. |
| `SettingsPage.tsx` (settings/)  | NO                 | YES       | NO                  | Scrollbar contrast handled at body. |
| `WorkspaceHome.tsx`             | NO                 | YES       | NO                  | Brand accent + theme both via context. |
| `PaymentModal.tsx`              | NO                 | YES       | NO                  | Modal backdrop uses `--color-bg-overlay` (themed). |

Retail POS is the **only POS-class screen** that maintains its own theme state besides subscribing to nothing.

## Risk assessment for users

1. App set to `light`, OS dark mode off: retail POS shows light chrome ✓ — but if `retail-theme` localStorage exists from a prior session it might still be `dark`, producing mismatched chrome vs rest-of-app on first render.
2. App set to `dark`, user toggles to `light` via ThemeToggle: retail POS still shows whatever it was initialised to (frozen).
3. Brand accent changes (Settings → Display → primary colour): `applyAccentPalette` repaints `--color-accent*` runtime and `applyThemeContrasts` reconciles fg. Retail POS does *not* receive --color-primary-pos at runtime (it's not in the runtime injection list) so its primary colour never updates to brand — it's keyed to whatever undefined value it has.
4. ThemeRegression test (`/__tests__/themeRegression.test.tsx`) does not render RetailPosScreen, so the orphan POS tokens don't fail the regression suite — silent visual drift.

## Recommendation — minimum diff for full fix

**Step A — [CLOSED via `972e4b0c`] Replace local shadow state with `useOptionalTheme()?.theme` consumption**:

  - _Implicit closure: deleting the shadow state also closes P0-3 storage-key shadow, P2-6 dead underscore-prefixed setter, and P2-7 missing-useTheme import. All four findings are satisfied by the same edit._

```tsx
// RetailPosScreen.tsx (where the local useState lives)
- const [theme, _setTheme] = useState<'light' | 'dark'>(() => { ... localStorage.getItem('retail-theme') ... });
+ import { useTheme } from '@/frontend/shell/ThemeProvider';
+ const { theme } = useTheme();
```

`useTheme()` already returns `Theme = 'default' | 'light' | 'dark'`. The `<div className="retail-pos">` `data-theme={theme}` continues to work, but now mirrors the live global value instead of the frozen initial one. **No other changes to the rendering tree are needed.**

**Step B — [CLOSED via `c888b142`] Add POS-domain tokens to `tokens.css`** in **all three** theme blocks (`:root` + `[data-theme="light"]` + `[data-theme="dark"]`):

```css
:root {
  --color-primary-pos: #1e3a5f;       /* navy */
  --color-primary-pos-dark: #14253d;
  --color-primary-pos-light: #2c5286;
  --color-bg-pos: #0d0d14;            /* matches default theme bg */
  --color-success-pos: #2e7d32;
  --color-success-pos-darker: #1b5e20;
  --color-warning-pos: #b7791f;
  --color-danger: #c62828;
  --color-danger-700: #8e0000;
  --color-danger-hover: #b71c1c;
  --color-danger-bg: #2a1010;
  --color-info: #1976d2;
  --color-info-bg: #0a1830;
  --color-fn-key-pos: #ffd54f;
  --color-dark-bg-pos: #06060c;
  --color-dark-border-pos: #1a1a2e;
  --color-fg-primary: #e0e0e0;
  --color-fg-secondary: #b0b0b0;
  --color-fg-tertiary: #808080;
  /* ...etc, light and dark variants override background tiles
     while keeping primary-pos palette stable across themes (POS brand-locked) */
}
[data-theme="light"] { --color-bg-pos: #f4f6fb; /* ... */ }
[data-theme="dark"]  { --color-bg-pos: #0d0d14; /* matches defaults */ }
```

POS palette tokens (`--color-primary-pos*`, `--color-fn-key-pos`, `--color-success-pos`, `--color-warning-pos`, `--color-danger*`) stay stable across themes (the navy/bronzy brand-locked identity). Surface tokens (`--color-bg-pos`, `--color-fg-primary`, `--color-fg-secondary`, `--color-fg-tertiary`, `--color-info-bg`, `--color-danger-bg`) flip per theme.

**Step C — [CLOSED via `c888b142`] Tokenize the `#000` literal**:

```css
- border-bottom: 1px solid color-mix(in srgb, var(--color-warning-pos) 60%, #000);
+ border-bottom: 1px solid color-mix(in srgb, var(--color-warning-pos) 60%, var(--color-ink));
```

Add `--color-ink` to each of the three theme blocks: dark navy in `:root`/dark, near-black in light.

**Step D — [CLOSED via `c888b142` + WKWebView fallback in `b274d860`] Convert `hsl()` lightness/saturation escapes to theme-aware colour-mix**:

```css
- border-top: 0.1875rem solid hsl(var(--cat-hue, 210), 30%, 70%);
+ border-top-color: color-mix(in srgb, var(--color-bg-surface), hsl(var(--cat-hue, 210) 50% 50%) 18%);
```

The hue remains per-category; the surface blend now tracks `--color-bg-surface` which *does* theme correctly.

**Step E — Runtime theme-sync guard for RetailPosScreen** so the orphan POS-token issue is caught by a rendered test going forward.

## Residual Risks

These items are out-of-scope for the initial audit closure but worth tracking:

- **Unremediated colour-mix sites — CLOSED**: The six additional `color-mix(in srgb, …)` uses in `RetailPosScreen.css` (lines 73, 83, 122, 141, 1594, 1844) now have paired solid-token fallbacks (`--color-bg-elevated`, `--color-primary-pos`, `--color-primary-pos-light`, `--color-success-pos`) using the same `/* P1-5 fallback: WKWebView <Safari 16.4 ignores colour-mix */` dual-declaration pattern introduced for the cat-strip sites. The previous `unset` worst case is replaced by a predictable solid colour on older WebKit engines, while modern engines continue to render the mixed overlay.
- **macOS ≤ 13.3 WKWebView floor**: `color-mix(in srgb, …)` shipped in Safari 16.4 (March 2023). Pre-13.3 macOS workstations fall back through the dual-declaration pattern but lose the hue-driven category blend; this is documented inline at the three cat-strip rules via `/* P1-5 fallback */` comments. New `color-mix` sites must follow the same dual-declaration convention.
- **Vite-virtual-URL trap for source-grep tests**: mitigated. Vitest transforms `.tsx` test files under a virtual URL (e.g. `/@vite-stub/…`), so any new source-grep test that uses `new URL('<rel>', import.meta.url).pathname` will resolve against the virtual directory rather than the on-disk path and fail with `ENOENT`. The Step E source-grep guard uses `path.resolve(__dirname, …)` (vitest polyfills `__dirname` for `.tsx` test files) — copy that pattern in any new source-grep test.
- **Theme-regression test coverage — CLOSED**: A runtime test in `ui/src/__tests__/RetailPosScreen.test.tsx` renders `<RetailPosScreen />` inside `ThemeProvider`, toggles the theme via `useTheme().setTheme('dark' | 'light')`, and asserts that the `.retail-pos` root's `data-theme` attribute stays in lockstep with the global `<html data-theme>` attribute. This closes the acceptance-criterion gap (previously called for `themeRegression.test.tsx`).

## Acceptance criteria for the fix

1. ThemeToggle (in `<html data-theme>`) and retail POS chrome (`<div className="retail-pos" data-theme>`) — when theme is changed — re-render in lockstep.
2. Retail POS primary colour tracks the brand accent palette (Settings → Display → primary colour) at runtime via a widened `applyAccentPalette` that also writes `--color-primary-pos*`.
3. The single `#000` literal is gone; the design-exceptions register only documents POS-specific brand-locked escapes if absolutely necessary.
4. `hsl(..., 30%, 70%)` / `40%, 92%` / `40%, 82%` are replaced with theme-aware colour-mix.
5. `__tests__/RetailPosScreen.test.tsx` mounts `<RetailPosScreen />`, flips the global theme via `useTheme().setTheme('dark' | 'light')`, and asserts that the `.retail-pos` root's `data-theme` attribute tracks the global `<html data-theme>` attribute. POS token resolution is guarded separately by `__tests__/themeRegression.test.tsx`, which includes `--color-primary-pos`, `--color-success-pos`, and `--color-warning-pos` in its theme-token resolution checks.
6. Cargo check + npm typecheck + eslint + vitest stay green.
7. Working-tree cleanliness: pre-existing dirty `LICENSE` and `docs/admin-guide.md` lines out of scope (no edits there).

## Branch state

```
0.0.22 ───────► 0.0.23 ───────► 0.0.24 (current)
                  (audit)         (audit + this file)
```

This audit doc is the only deliverable for 0.0.24's theming investigation. No code changes have landed yet — the fix cycle is staged for followup commit(s) on the same branch.

## Open questions for the user

1. Should POS brand colours (navy primary, bronzy warning, gold F-key) be **theme-locked** (same in all 3 themes, preserves brand), or **theme-adaptive** (light theme uses desaturated variants for contrast)?
   - Brand-locked (recommended): POS keeps its visual identity in any theme; tokens stay brand-stable across themes.
   - Theme-adaptive: POS blends with the rest of the UI; primary colour shifts per theme.
2. Should `localStorage['oz-pos-theme-v4']` be **retired in favour of themed session** so that POS stops writing its own `retail-theme`? (yes, implicit in Step A — drop the local key entirely).

> last audited 29-09-26 by docs-auditor

