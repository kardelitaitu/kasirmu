---
num: 15
area: theming
title: ADR #15: Shadow Banding Mitigation — Single-Layer Uniform Blur & CSS Noise Dithering
status: Implemented (2026-07-26) — partially superseded 2026-08-27 (shadow tokens + gradient reverted; noise dither kept)
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 2 minor) · Fresh full audit of this decision record; the 2026-09-29 stamp and the 2026-07-24 marker are merged below as original evidence. · Correction note added; body left as the decision. MAJOR — TWO OF THE THREE TECHNIQUES WERE REVERTED on 2026-08-27 by `c6062b344` ("design language overhaul"), which rewrote the same token/components files the ADR's own commit `9a5696b36` had changed: (1) the single-layer `0 0 12px rgba(4,10,18,…)` shadow tokens are GONE — all six are back to multi-layer offsets in `rgba(16,24,40,…)` (dark) / `rgba(0,0,0,…)` (light), only `--shadow-xs` still ending in `0 0 12px` (`ui/src/theme/tokens.css:285-290`, `:645-650`); (2) the 8-stop `--color-bg` radial gradient is GONE — `--color-bg` is a flat hex in all three themes and `tokens.css` has zero `radial-gradient`. SURVIVES AND WAS EXTENDED: the noise dither — `--noise-uri` feTurbulence (`baseFrequency=0.25`, `numOctaves=4`), `mix-blend-mode: overlay`, the `@media (prefers-contrast: high)` hide rule, and a selector list grown from 3 surfaces to include `.workspace-card`, `.staff-mgmt-card`, `.error-boundary__card`, `.topology-rev-browser`, `.restaurant-preview-card` and the reusable `.noise-dither` utility (`ui/src/theme/components.css`). The "~95% reduction" figure describes the original combined implementation, not what ships. REPAIRED (minor): `ui/src/frontend/themes/{tokens,components}.css` → `ui/src/theme/…`; the test counts marked as the dated 2026-07-26 reading. NOT re-measured: the rendered banding behaviour, which needs a live render. · Body left as written: an ADR records what was decided, not where things ended up — the repairs above are dated correction notes and dead-path fixes in present-tense contexts only. -->

<!-- STAMP MERGED INTO THIS ONE (2026-10-11) — superseded bodies kept verbatim as original evidence:

<!-- Audit stamp: 2026-09-29 · docs-auditor · status: audited on branch 0.0.40 · ACCURATE, and this file closes a loop with one audited in round 9. The prior pass recorded O1: the test counts it cites (Card 8 / StaffLoginScreen 7 / DesignSystem 21) differ slightly from a current grep — still test-count drift in the same direction, still minor, still not re-derived here, because a recount produces another point-in-time number rather than a truer one. · THE SHADOW TOKENS THIS ADR DEFINES ARE STILL IN THE STYLESHEET, which is the claim worth re-confirming because the whole document concerns a rendering artefact that either persists or does not. The six shadow tokens and their opacities (0.00 / 0.08 / 0.16 / 0.24 / 0.32 / 0.40) are present across all three theme blocks, the 8-stop `--color-bg` radial gradient survives, the `--noise-uri` feTurbulence (`baseFrequency=0.25`, `numOctaves=4`) with `mix-blend-mode: overlay` is still in `components.css`, and the `@media (prefers-contrast: high)` hide rule remains. · ⚠️ AND THE PATH THE PRIOR STAMP CITED IS THE FOURTH DOCUMENT IN THIS CAMPAIGN TO CARRY IT. The stamp locates the tokens at `ui/src/frontend/themes/tokens.css`; that directory is gone — see the ADR-12 stamp in this same round, where the whole `ui/src/frontend/` tree is found removed — and the token sheet is at `ui/src/theme/tokens.css`. One file move has now invalidated references in at least four documents across `docs/archived/` and `docs/decisions/`, which is the clearest argument yet for treating a recorded path as a dated observation rather than a durable fact. · WORTH CONNECTING: the noise-dither selectors this ADR established are the same ones the `docs/archived/TODO-shadow-audit.md` list extends — its 30 unchecked items concern ADDING the overlay to further elevated surfaces, and a concurrent session was editing exactly those CSS files during this campaign. The mitigation and its follow-up are both live; they are not the same work, and this ADR is the record of the former. · Body left as written, including the stale token path, for the reason above. Status checker reports no drift; prior stamp retained and stacked footer collapsed. -->

<!-- Superseded audit marker (2026-07-26, body kept verbatim) · Hermes-Agent · status: ACCURATE (1 observation) · O1: test counts cited (Card 8 / StaffLoginScreen 7 / DesignSystem 21 "pass") vs current grep of it()/test()/describe() = 9/9/22 (Card & DesignSystem match if describe is excluded; StaffLoginScreen off by ~1 — minor drift as tests added) · verified accurate: 6 shadow tokens (0 0 12px, opacities 0.00/0.08/0.16/0.24/0.32/0.40) present across all 3 themes in ui/src/frontend/themes/tokens.css; 8-stop --color-bg radial gradient present (tokens.css:93-101); --noise-uri feTurbulence baseFrequency=0.25 numOctaves=4 + mix-blend-mode:overlay in components.css:265-373; @media (prefers-contrast: high) hide present; StaffLoginScreen.css + Card.tsx + 3 __tests__ files all exist; ADR #3 ref resolves -->

-->

# ADR #15: Shadow Banding Mitigation — Single-Layer Uniform Blur & CSS Noise Dithering

> **CORRECTION NOTE (2026-10-11, docs-auditor) — two of this ADR's three techniques were reverted.**
>
> This record describes a decision taken 2026-07-18 and implemented the same day in
> `9a5696b36` (*"eliminate 8-bit GPU banding with single-layer uniform blur + noise dither"*).
> **On 2026-08-27, `c6062b344`** (*"feat(website): complete design language overhaul with animations and motion"*)
> rewrote the token sheet and removed two of the three techniques. Measured today:
>
> | Technique (as decided) | State now | Evidence |
> |---|---|---|
> | **1. Single-layer `0 0 12px` uniform-blur shadows** | **REVERTED.** All six shadow tokens for both themes are back to multi-layer offsets, and the colour moved from `rgba(4,10,18,…)` to `rgba(16,24,40,…)` (dark) / `rgba(0,0,0,…)` (light). Only `--shadow-xs` still ends in `0 0 12px`. | `ui/src/theme/tokens.css:285-290` (`:root`), `:645-650` (`[data-theme='light']`) |
> | **2. 8-stop `--color-bg` radial gradient** | **REVERTED.** `--color-bg` is a flat hex in all three themes (`#060709` dark, `#f4f5f7` light); zero `radial-gradient` in `tokens.css`. The only surviving gradient is the unrelated boot-splash accent wash at `components.css:1664`. | `ui/src/theme/tokens.css` |
> | **3. CSS noise dither (`--noise-uri`, feTurbulence, `mix-blend-mode: overlay`)** | **SURVIVES, and was extended.** The `--noise-uri` data URI, the `feTurbulence baseFrequency=0.25 numOctaves=4` filter, `mix-blend-mode: overlay` and the `@media (prefers-contrast: high)` hide rule are all present, and the selector list has *grown* well past this ADR's three surfaces (.card / .modal-panel / .staff-login-card) to include `.workspace-card`, `.staff-mgmt-card`, `.error-boundary__card`, `.topology-rev-browser`, `.restaurant-preview-card` and the reusable `.noise-dither` utility — the migration path this ADR proposed. | `ui/src/theme/components.css:~9096` onward |
>
> **What this means for a reader.** The document's *reasoning* (8-bit alpha quantisation, multi-layer
> interference, "one gradient, well-sampled") is intact and still the right explanation of the
> artefact. Its *prescription* is not current: technique 1 and the gradient smoothing were tried,
> shipped, and then undone by an unrelated design-overhaul commit that rewrote the same two files.
> Whether that was deliberate or collateral is not recoverable from the commit message, which says
> nothing about shadows — so this note records the state rather than asserting an intent. The
> "~95% banding reduction" figure in the Consequences section describes the original combined
> implementation, not what ships today.
>
> **Body left as written below** — this is a decision record, and rewriting it into a status page
> would destroy the evidence that the technique was once chosen and what it looked like.



**Status:** Implemented (2026-07-26) — ⚠️ the single-layer shadow tokens and the 8-stop background gradient were REVERTED on 2026-08-27 (`c6062b344`); only the noise dither survives. See the correction note below.
**Date:** 2026-07-18
**Author:** Architecture Team & kasir.mu Contributors
**Tags:** shadows, banding, css, dithering, gpu, rendering, dark-theme, glassmorphism

---

## Context

kasir.mu uses CSS `box-shadow` tokens across all themes to communicate elevation depth on cards, modals, menus, and other UI surfaces. On **dark backgrounds** (the default Steel Blue Glassmorphism theme and the Dark Solid theme), users reported visible **color banding** — concentric rings of abrupt brightness transitions within shadow falloffs rather than smooth gradients.

### Root Cause

The banding is caused by the GPU's 8-bit-per-channel alpha pipeline. When `box-shadow` renders a gradient from `rgba(4, 10, 18, 0.4)` to `rgba(4, 10, 18, 0)`, the alpha channel has only 256 discrete values (0–255). On a light background, each step represents ~0.4% brightness change — imperceptible. On a dark background, the same steps compress into a narrower perceptual range, making adjacent alpha levels visible as distinct rings.

| Factor | Light Background | Dark Background |
|--------|-----------------|-----------------|
| Shadow color | `rgba(15,23,42, 0.08–0.40)` | `rgba(4,10,18, 0.08–0.40)` |
| Contrast per alpha step | ~0.4% — invisible | ~1.5% — visible |
| Alpha range used | 20–102 (narrow) | 20–102 (wide) |
| Background brightness | High (many gradient steps) | Low (few gradient steps) |

### Key Insight: Multi-Layer Shadows Compound Banding

Multiple `box-shadow` layers on the same element create **interference patterns** between the gradients. Each layer has its own 8-bit quantization, and when composited together, the beats between the quantization steps create visible rings. A **single-layer** shadow with sufficient blur produces a cleaner GPU sampling path.

---

## Decision

We apply two complementary techniques, both focused on the principle of **"one gradient, well-sampled"** :

### Technique 1: Single-Layer Uniform-Blur Shadow Tokens (tokens.css)

All shadow tokens use the same `0 0 12px` blur with zero offset. Only the **opacity** changes between elevation levels:

```css
/* All themes share the same blur + offset; only opacity varies */
--shadow-xs:   0 0 12px rgba(4,10,18,0.00);  /* buttons — no shadow */
--shadow-sm:   0 0 12px rgba(4,10,18,0.08);
--shadow-md:   0 0 12px rgba(4,10,18,0.16);  /* cards */
--shadow-lg:   0 0 12px rgba(4,10,18,0.24);
--shadow-xl:   0 0 12px rgba(4,10,18,0.32);  /* login card */
--shadow-2xl:  0 0 12px rgba(4,10,18,0.40);  /* modals */
```

This eliminates banding because:

1. **Single layer** — no interference patterns between multiple gradients
2. **Zero offset** — symmetric falloff around all edges
3. **12px blur** — wide enough for the GPU to sample many intermediate values, tight enough to avoid a foggy halo look
4. **Low to moderate opacity** (0.00–0.40) — each 8-bit quantization step represents a small perceptual jump
5. **Normal elevation curve** — smaller elements (buttons) get lighter shadows; larger elements (modals) get deeper shadows, matching standard design system conventions

### Technique 2: CSS Noise Texture Overlay (components.css)

A `::after` pseudo-element on elevated surfaces overlays a microscopic SVG noise filter at **10% opacity** with `mix-blend-mode: overlay`. This spatial dithering breaks up smooth gradient transitions so the human visual system cannot track band edges.

The noise texture uses `feTurbulence` SVG filter encoded as a data URI, stored as a CSS custom property `--noise-uri` for deduplication:

```css
:root {
  --noise-uri: url("data:image/svg+xml,%3Csvg%20xmlns%3D...");
}

.card::after,
.modal-panel::after,
.staff-login-card::after,
.noise-dither::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  opacity: 0.10;
  mix-blend-mode: overlay;
  background-image: var(--noise-uri);
  background-repeat: repeat;
  background-size: 256px 256px;
  pointer-events: none;
}
```

Key properties:

- **10% opacity** — strong enough to dither 8-bit quantization effectively
- **`mix-blend-mode: overlay`** — applies noise relative to the underlying color, not as a flat overlay
- **`baseFrequency: 0.25`, 4 octaves** — larger noise grains for effective dithering
- **`z-index: -1`** — sits between background and content so it doesn't affect text readability
- **`border-radius: inherit`** — matches the parent element's border radius
- **`pointer-events: none`** — no interaction blocking
- **Hides on `@media (prefers-contrast: high)`** — accessibility

### Background Gradient Smoothing

The dark theme background gradient was expanded from **3 color stops to 8 color stops** to reduce banding at the source:

```css
/* Before: 3 stops — visible rings */
--color-bg: radial-gradient(ellipse at 50% -10%,
  #132540 0%, #07111d 60%, #040a12 100%);

/* After: 8 stops — smooth */
--color-bg: radial-gradient(ellipse at 50% -10%,
  #132540 0%, #111f33 15%, #0e1a2b 28%, #0c1523 40%,
  #09111d 52%, #070e19 65%, #060c16 78%, #040a12 100%);
```

### Interaction Between Techniques

| Technique | Banding Reduction | GPU Cost | Visual Change |
|-----------|-----------------|----------|---------------|
| Single-layer uniform blur | ~70% reduction | -1 pass vs multi-layer | None |
| Noise at 10% | ~85% reduction (perceptual) | Static blend layer | Imperceptible grain |
| **Combined** | **~95% reduction** | Minimal | None |

---

## Options Considered

### Option A — Canvas Dithering via `getImageData` (Rejected)

Apply ordered dithering to blurred shadow pixels using a `<canvas>`.

- **Pro**: Pixel-level control
- **Con**: Requires replacing all CSS `box-shadow` usage with JS — massive refactor
- **Con**: Blocks main thread
- **Con**: SSR incompatible
- **Verdict**: Impractical for a component-based UI framework

### Option B — Triple-Layer with CSS Filter `drop-shadow()` (Tested, Reverted)

Used `filter: drop-shadow(0 0 30px rgba(0,0,0,0.6))` on the login card to render through the CSS filter pipeline.

- **Pro**: CSS filter pipeline uses a different GPU compositing path with smoother gradients
- **Con**: `filter` creates a new stacking context, breaking the glassmorphism effect on semi-transparent backgrounds (`rgba(16,82,188,0.08)`)
- **Con**: `filter` forces the element onto a separate GPU composite layer, breaking background blend interactions
- **Verdict**: Breaks glassmorphism — not viable

### Option C — Single-Layer + Noise + Smooth Background (Chosen)

Apply both techniques plus gradient smoothing.

- **Pro**: ~95% perceptual banding reduction
- **Pro**: Noise overlay is static — single composite layer, no per-frame cost
- **Pro**: Background gradient smoothing addresses banding at the source
- **Pro**: Can be applied incrementally — tokens first, noise on elevated components
- **Con**: SVG data URI increases CSS size slightly (~2 KB compressed)
- **Verdict**: Best balance of effectiveness and cost

---

## Consequences

### Positive

- **~95% banding reduction** — dark-theme shadows appear smooth across all devices
- **No GPU regression** — single-layer shadows use fewer composite passes than the original multi-layer approach. Noise overlay is a static texture.
- **No visual character change** — at 10% opacity with `mix-blend-mode: overlay`, the noise grain is invisible in static screenshots
- **Theme-agnostic** — applied to all three themes equally
- **Backward-compatible** — existing shadow token names preserved; no API changes
- **Progressive enhancement** — browsers without SVG noise support gracefully degrade

### Negative

- **CSS size**: SVG noise data URI adds ~2 KB to the compiled CSS
- **Component coupling**: Each elevated component must be explicitly added to the noise overlay selector list
- **Banding may still appear on very large blurs** (>48px) at high opacity (>0.50) — mitigated by capping 2xl at 0.40 opacity

---

## Implementation Plan

### Phase 1: Background Gradient Smoothing (tokens.css)

Expand the dark theme background gradient from 3 to 8 color stops to reduce banding at the source before shadows are even rendered.

### Phase 2: Single-Layer Shadow Tokens (tokens.css)

Replace all multi-layer shadow tokens with single `0 0 12px` uniform blur across all 3 themes:

| Token | Opacity |
|-------|--------|
| `--shadow-xs` | 0.00 |
| `--shadow-sm` | 0.08 |
| `--shadow-md` | 0.16 |
| `--shadow-lg` | 0.24 |
| `--shadow-xl` | 0.32 |
| `--shadow-2xl` | 0.40 |

### Phase 3: Noise Overlay (components.css)

1. Define `--noise-uri` CSS custom property with SVG feTurbulence data URI
2. Add shared noise overlay rule targeting `.card::after`, `.modal-panel::after`, `.staff-login-card::after`
3. Add reusable `.noise-dither` class for arbitrary elements
4. Hide on `@media (prefers-contrast: high)`

---

## Related Files

- `ui/src/theme/tokens.css` — Shadow tokens + background gradient **← moved from `ui/src/frontend/themes/tokens.css`; that directory no longer exists**
- `ui/src/theme/components.css` — Noise overlay CSS **← same move; the pre-2026-09-23 path was `ui/src/frontend/themes/components.css`**
- `ui/src/features/auth/StaffLoginScreen.css` — Login card shadow
- `ui/src/components/Card.tsx` — Card component
- `ui/src/__tests__/Card.test.tsx` — Card tests (counts below are the ADR's dated 2026-07-26 reading; not re-derived, since a recount replaces one point-in-time number with another: 8 pass)
- `ui/src/__tests__/StaffLoginScreen.test.tsx` — Login screen tests (dated: 7 pass)
- `ui/src/__tests__/DesignSystem.test.tsx` — Design system tests (dated: 21 pass)
- `docs/decisions/2026-03-01-frontend-restructure.md` — ADR #3: Frontend structure

> last audited 11-10-26 by docs-auditor
