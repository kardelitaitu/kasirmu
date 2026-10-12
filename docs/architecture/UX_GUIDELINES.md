<!-- Superseded audit marker (2026-09-08 · DSH, body kept verbatim) · retained · status: ACCURATE (0 findings, re-verified) · Replaces the 2026-07-22 Hermes-Agent stamp, whose scope note still holds: this is a guideline document, not a description of code, so it is judged on whether the rules it states match what the implementation actually does. Every falsifiable claim was checked today against ui/src/contexts/ZoomContext.tsx and the per-component CSS, and all of them hold: base resolution 1920px = root font 16px (line 35), scale DOWN below 1920 and never up (line 36, with the Tauri/WebView2 reason in the code comment too), clamp Math.max(14, Math.min(16, 16 * scale)) (line 41), the 14px floor justified exactly as the guide justifies it — readable at 1366x768 (line 40), useAppZoom exported at line 104 and consumed by ui/src/features/settings/AppearanceSettings.tsx, and --color-accent in real use (FastPINOverlay.css, PermissionDenied.css, the canvas chart components). · One thing worth saying about the design-token claim: there is no central ui/src/styles/*.css. The tokens live in per-component stylesheets, so grepping one file for a variable name returns nothing and looks like a dead reference. That is a trap for anyone auditing this page from a shell. · Not everything that is stamped is stale and not everything old is wrong: this page was audited 2026-07-22, is the second-oldest stamp in docs/guides/, and needed no change. The footer already read 09-08-26 from a lighter pass; the stamp now agrees with it. -->

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor, structural) · Re-audit of the adaptive-scaling guidelines; the 2026-09-29 and 2026-09-08 stamps are merged at the bottom as original evidence. · VERIFIED AGAINST CODE, and every coordinate the earlier stamps cite is still EXACT: `ui/src/contexts/ZoomContext.tsx` has the base-resolution comment at :35, the "scale DOWN below 1920 but never UP" comment at :36 (with the Tauri/WebView2 reason), the formula `scale = windowWidth / 1920` at :39, the clamp `Math.max(14, Math.min(16, 16 * scale))` at :41, `ZoomLevel = 'auto' | '100' | '125' | '150' | '200'` at :7, and `useAppZoom` exported at :104. The picker the §2 bullet names is where it says: `AppearanceSettings.tsx:361-365` offers exactly auto/100/125/150/200. So the mechanism this document prescribes is the one the application runs. · THE 2026-10-07 CORRECTION STILL HOLDS, and I re-tested it rather than inheriting it: `SETTINGS_SCREENS` in `ui/src/features/settings/screens/registry.ts:59-74` has exactly 14 keys and NONE of them is `appearance`; `SettingsNavTree.tsx` has 14 NAV_ITEMS and no appearance entry; and `AppearanceSection.tsx` — the only production importer of the panel that owns the zoom select — is therefore unmountable. The override remains unreachable from the UI, which is what the correction says. (`AppearanceSection.tsx:4`'s own comment claims the panel "IS registered as a screen"; that is a stale source comment, not a doc claim, and is left for its author under the doc→code rule.) · STRUCTURAL, REPAIRED: the footer carried a TWO-LINE SHADOW STAMP below it — `> audit: Phase 1 Core Architecture & API Docs Audit` and a `> status: ACCURATE …` line. Those have the shape and authority of an audit stamp but sit in footer position outside any HTML comment, so no tool reads them and no rule governs them; the same shadow-stamp defect `docs/guides/developer/admin-guide.md` already documents and removed. Folded into this stamp and the footer collapsed to the single machine-read line. · LEFT AS WRITTEN: the formulas, the clamp rationale, the rem-everywhere rule with its 1px border exception, the 1366×768 minimum, and the focus-ring pattern (`box-shadow: inset` over `outline`) — all prescriptive and all still matching the implementation. · NOT re-measured: rendered scaling behaviour at any viewport (that needs a running window, and this document's claims are about the mechanism, not a screenshot). · Prior stamps retained below as original evidence. -->
# UX Guidelines: Adaptive Rendering & Fluid Scaling

## 1. The Scaling Strategy

To support a wide range of devices—from small 1366x768 checkout laptops to massive 4K self-service kiosks—kasir.mu employs **Adaptive Fluid Scaling**.

Instead of writing dozens of CSS media queries with rigid break points (e.g., changing sizes suddenly at 1080p, 1440p, etc.), we map the entire application's sizing to a single root value, and smoothly interpolate that value based on the exact width of the user's browser window.

### How It Works

1. **Relative Units (`rem`)**: 
   All typography, padding, margins, and layout widths in kasir.mu must be defined using `rem` units (where `1rem` equals the root `html` font size). 
   
   *Rule of thumb:* Never use hardcoded `px` values for large layout containers (e.g., `width: 500px`), because they will not scale. Use `rem` (e.g., `width: 31.25rem`) instead.

2. **The Base Resolution (1920px)**:
   Our standard design baseline assumes a 1920px window width. At this width, the root font size is exactly `16px`.

3. **Fluid Calculation**:
   We use a ResizeObserver-style hook (`useAppZoom` in `ZoomContext.tsx`) to recalculate the root font size on the fly whenever the window is resized.
   
   The mathematical formula is:
   `scale = window.innerWidth / 1920`
   `font-size = 16 * scale`

4. **Clamping (CSS Locks)**:
   To prevent the UI from becoming unreadably microscopic on tiny screens, we apply a mathematical clamp:
   - **Minimum size:** `14px` (Ensures legibility on 1366x768 monitors).
   - **Maximum size:** `16px` (the 1920px base — the app scales **down** below 1920px but never up above it; see `ZoomContext.tsx`, which caps `font-size` at 16px by design).

## 2. Best Practices for Developers

When building UI components for kasir.mu, adhere to these guidelines to ensure they play nicely with the Adaptive Rendering engine:

- **Do not fight the browser zoom:** Because we scale based on `window.innerWidth`, native browser zoom (`Ctrl + / -`) is intentionally preserved and supported, as zooming physically shrinks or expands the reported `innerWidth` of the document.
- **Use `rem` everywhere:** Borders (1px) are the only exception. Everything else—fonts, padding, shadows, border-radii, container widths and heights—should be built using `rem` so they scale synchronously. Never use fixed `px` for layout containers (e.g., `width: 500px`); use `rem` (e.g., `width: 31.25rem`) instead.
- **Minimum sizing (`min-width` / `min-height`):** 1366×768 is the **minimum resolution that must be 100% supported**. Interactive elements (buttons, inputs) that would become unusable below this resolution **must** set a `min-width` and/or `min-height` in `px` or `rem`. This guarantees tappability at the minimum supported scale while still scaling up on larger screens.  
  Example: a square icon button can use `min-width: 64px; min-height: 64px; aspect-ratio: 1` — at 1366×768 (root font ~11.4px) this stays a comfortable tap target, and on 4K it scales up proportionally.
- **Flexbox and Grid over Absolute Positioning:** Absolute positioning (e.g., pinning something `1.5rem` from the right edge) can cause overlapping on extremely wide or scaled screens. Always prefer robust flexbox or CSS grid layouts for positioning.
- **Support Manual Overrides:** The zoom override exists in code and must keep working: `ZoomLevel` accepts `100`/`125`/`150`/`200` and the hook honours it (`ui/src/contexts/ZoomContext.tsx:44`), and the picker that offers those four values is `ui/src/features/settings/AppearanceSettings.tsx:361-365`. Never assume `window.innerWidth` is the sole source of truth for the active font size.

> ⚠️ **Corrected 2026-10-07 — the panel this bullet used to name no longer mounts the control.**
> It read "Users can disable auto-scaling via the General Settings panel". They cannot today.
> `AppearanceSettings` (which owns the zoom select) is imported by exactly one production file,
> `ui/src/features/settings/sections/AppearanceSection.tsx:11`, and that section is **DEAD**: there is
> no `appearance` key among the 14 entries in `SETTINGS_SCREENS`
> (`ui/src/features/settings/screens/registry.ts:59-74`) and no appearance entry among the 14 `NAV_ITEMS`
> (`ui/src/features/settings/SettingsNavTree.tsx`), so `renderSection` can never mount it. The live
> General screen does not carry it either — the registry's own device-verified control list for General
> is "Store name / Address / Tax-VAT ID / Branch", and `GeneralSection.tsx` has zero `zoom` references.
> **So the override is currently unreachable from the UI**: the context, the clamp and the FTL keys
> (`appearance-zoom-100/125/150/200`) are all present and tested, but nothing renders the picker.
> Treat this bullet as the intended contract, not a description of what a user can do — and if the
> appearance screen is re-registered, this note is what says the behaviour was never removed.

## 3. Focus Indicator Pattern

All text inputs (and any focusable element with a visible border) **must** use `box-shadow: inset` for their focus ring, not `outline`:

```css
.element:focus {
  border-color: var(--color-accent);
  box-shadow: inset 0 0 0 1px var(--color-accent);
  outline: none;
}
```

This draws the focus ring **inside** the element, sitting on top of the border. Using `outline` places the ring outside the border, which:

- Breaks the visual boundary of the input
- Requires negative `outline-offset` hacks to pull inward
- Inconsistently renders across OS/browser focus engines

Always pair with `outline: none` to suppress the native focus ring.

> last audited 11-10-26 by docs-auditor
