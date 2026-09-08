# ui-coder-2 journal — KDS token migration + modal exit animations

Branch: `0.0.37` (no branch created/switched, no stash, no amend, no push).
Skills loaded and followed: `ui-components`, `exit-animation-pattern`.
Ground truth for token names: `ui/src/frontend/themes/tokens.css` (dark = `:root`, light = `[data-theme='light']`).

## Commits

| SHA | Subject | Files | Ancestry proof |
|---|---|---|---|
| `47182b68eb4cfb53b571bcfeca1bf96face033f8` | `style(ui): migrate kds surfaces to design tokens` | 4 CSS files (all fenced) | `git merge-base --is-ancestor 47182b68 HEAD` → OK |
| `d30d16357ed8414a219d713f082f4614d81689ce` | `feat(ui): add exit animations to kds enrollment and picker modals` | KdsEnrollmentModal.tsx/.css + KdsProductPickerModal.tsx/.css | `git merge-base --is-ancestor d30d1635 HEAD` → OK |
| `145e0265c485ca544d2f15766789eb25a52ccbef` | `fix(ui): pin kds qr pairing to scannable paper-white` | KdsEnrollmentModal.tsx + .css (follow-up, TASK 2) | `git merge-base --is-ancestor 145e0265 HEAD` → OK |

All three commits made with an explicit pathspec after `git status --porcelain` + `git add <paths>`; the index
never held another agent's file. Pre-commit ran all ten gates on each (step 9 `ui typecheck` fired on the two
commits that staged `.tsx`) and passed. One `index.lock` collision hit the first attempt at commit A; waited
16 s and retried the identical command — no `--no-verify`, no work-around.

`ui/src/features/kds/KdsScreen.tsx` was **not** touched (read-only inspection only).

## Files changed (complete list)

1. `ui/src/features/kds/KdsScreen.css`
2. `ui/src/features/kds/components/KdsEnrollmentModal.css`
3. `ui/src/features/kds/components/KdsProductPickerModal.css`
4. `ui/src/features/kds/components/KdsDeviceStatusIndicator.css`
5. `ui/src/features/kds/components/KdsEnrollmentModal.tsx`
6. `ui/src/features/kds/components/KdsProductPickerModal.tsx`

## Mission A — token migration

Raw hex per file, before → after:

| File | before | after | note |
|---|---|---|---|
| `KdsScreen.css` | 54 | 7 | 1 is a header comment; 6 are documented no-token candidates |
| `KdsEnrollmentModal.css` | 29 | 1 | QR quiet zone (see below) |
| `KdsProductPickerModal.css` | 50 | 0 | clean |
| `KdsDeviceStatusIndicator.css` | 15 | 0 | clean — now has **zero** `--kds-*` references |
| **total** | **148** | **8** | 140 removed |

### What was actually wrong (this is not a cosmetic sweep)

`KdsScreen.css` defines a KDS-scoped token layer on `.kds` (65 `--kds-*` names) plus a
`[data-theme='light'] .kds` override block. The three component stylesheets referenced **14 `--kds-*` names
that are defined nowhere in the tree** (`--kds-hover`, `--kds-input-bg`, `--kds-primary`,
`--kds-primary-hover`, `--kds-primary-ring`, `--kds-success`, `--kds-tag-bg`, `--kds-tag-text`,
`--kds-text-muted`, `--kds-text-secondary`, `--kds-danger`, `--kds-warning`, `--kds-error`,
`--kds-success-border`, `--kds-warning-border`, `--kds-border-light`). Every one carried a **light-theme hex
fallback**, so in dark mode they silently rendered light values (`--kds-text-secondary` → `#6b7280`,
`--kds-tag-bg` → `#eff6ff`). The fallback was not a safety net — it was the only value ever used. Repointing
them at real `--color-*` tokens fixes dark mode rather than restyling it.

### Repoints (undefined var → real token, fallback dropped)

`--kds-danger` → `--color-danger` · `--kds-warning` → `--color-warning` · `--kds-error` → `--color-danger` ·
`--kds-success` → `--color-success` · `--kds-primary` → `--color-accent` (→ `--color-border-focus` where it was a
focus border) · `--kds-primary-hover` → `--color-accent-hover` · `--kds-primary-ring` → `--color-accent-alpha` ·
`--kds-text` → `--color-fg` · `--kds-text-secondary` → `--color-fg-secondary` · `--kds-text-muted` → `--color-fg-muted` ·
`--kds-border` → `--color-border` · `--kds-border-light` → `--color-border-subtle` · `--kds-hover` → `--color-bg-hover` ·
`--kds-input-bg` → `--color-bg-input` · `--kds-tag-bg` → `--color-accent-subtle` · `--kds-tag-text` → `--color-accent` ·
`--kds-error-bg` → `--color-danger-bg` · `--kds-error-text` → `--color-danger` · `--space-0_25` → `--space-0_5`
(the name never existed, so those `gap`/`padding` declarations were resolving to invalid/`normal`).

State-pill borders in `KdsDeviceStatusIndicator.css` now use
`color-mix(in srgb, var(--color-success|warning|danger) 25%, transparent)` — the design language's
"20–25 % border in the semantic colour" rule, no new token.

### Light-theme intent preserved

`[data-theme='light'] .kds` previously re-declared values the global tokens already flip.
`--kds-bg` → `var(--color-bg)`, `--kds-bg-top` → `var(--color-bg-surface)`,
`--kds-bg-surface` → `var(--color-bg-elevated)`, `--kds-text` → `var(--color-fg)`; the four corresponding light
overrides (old lines 112–114, 121) were **deleted as redundant** — the token now carries the flip. The light
block keeps only the six translucent white-alpha tokens with no global equivalent. Same treatment for
`--bg-surface` on `.kds-hamburger-panel` (→ `var(--color-bg-surface)`), which let
`[data-theme='light'] .kds-hamburger-panel { --bg-surface: #ffffff }` go away too.

### Deliberate visual deltas (called out, not hidden)

* `.kds-enrollment-modal` panel: `var(--kds-bg, #fff)` → `var(--color-bg-popover)`. The old value resolved to
  `#0f0f14` in dark — identical to the page behind it, so the panel had no elevation. `--color-bg-popover` is
  the project's own rule for overlay surfaces (`popoverSurfaceCompliance.test.ts` THM-08: any surface that
  overlays content must use it, opaque in every theme); `.kds-picker-modal` already obeys it.
* `.kds-btn` accent ladder now *is* the semantic ladder: `--color-accent` / `--color-accent-hover` /
  `--color-accent-active` / `--color-pos-on-primary` (exactly `#ffffff` in both themes) / `--color-danger`. In
  dark, hover moves from `#1168D4` (darker than rest) to `#1A8FFF` (brighter) — the design language's "dark
  pushes semantic colours brighter" direction. In light, buttons go from `#147EFB` (3.0:1 on white, below AA)
  to `#1155CC`, which is the point of the ladder.
* `.kds-modal-actions .kds-btn.danger` → `--color-danger` / `--color-danger-hover` / `--color-danger-700`
  (`--color-danger-700` is exactly `#b91c1c` in dark).
* `z-index` raw values → exact-value tokens: `100` → `var(--z-dropdown)`, `300` → `var(--z-overlay)`, and the
  enrollment overlay `1000` → `var(--z-modal)` so it stacks identically to `.kds-picker-overlay`. Consequence
  worth knowing: toasts (`--z-toast` 500) and tooltips now paint above the enrollment modal, not under it.
* `font-weight: 400|500|600|700` → `var(--font-weight-normal|medium|semibold|bold)` across all four
  stylesheets (45 occurrences in `KdsScreen.css` alone). Zero computed change.
* `font-family: var(--font-sans, 'Inter', …)` → `var(--font-sans)`.

### No-token candidates left in place (per mission: do not invent tokens)

| Location | Value | Why it stays |
|---|---|---|
| `KdsScreen.css:75` | `--kds-ink: #1a1a1a` | "always-dark ink" for text on light/accent chips. `--color-fg-inverse` and `--color-text-on-color` both **flip** to light values. |
| `KdsScreen.css:76` | `--kds-fg-inverse: #fff` | Same problem inverted — `--color-fg-inverse` is `#12141a` in dark. |
| `KdsScreen.css:399-400` | `--btn-hover: #22c55e` / `--btn-active: #16a34a` | Shift-start green hover/press pair. `--color-success` is `#6FE884`/`#2E9E3E`, `--color-success-pos` is `#10b981` — neither is this pair; the mission names state greens as expected survivors. |
| `KdsScreen.css:825` | `background: #3a3f4c` | Inside `[data-theme='dark'] .kds-slider-knob`. Numerically equals `--neutral-400` (internal palette — components must not reach for it) and no semantic surface token holds that value. |
| `KdsScreen.css:1161` | `#f56565` | Mid-stop of the urgent-ticket sweep gradient; edges are already `--kds-error-border`. Any status token there flattens the gradient. |
| `KdsEnrollmentModal.css:185` | QR quiet zone | ~~`var(--kds-bg, #ffffff)`~~ — needed **paper white in both themes**, which no surface token gives. Resolved in follow-up commit `145e0265` to `var(--color-pos-on-primary)` (the only theme-invariant white in `tokens.css`); see the follow-up section. |
| `KdsScreen.css:5` | `#147EFB` in a header comment | prose, not a value. |

Also left alone and flagged: the `.kds` translucent white-alpha layer (`--kds-bg-tabs`,
`--kds-bg-tab-active`, `--kds-bg-hover`, `--kds-bg-active`, `--kds-border`, `--kds-border-strong`), the KDS
radius/type/spacing scales (`--kds-r-*` 20/14/10/5 px, `--kds-font-*` 11/13/15 px, `--kds-space-*`
5/9/11/13/18/27 px) and the composite shadows/glows — none has an exact token equivalent, and all live in a
custom-property definition block that `themeTokenCompliance` does not count. Scrollbar alphas
(`KdsScreen.css:129-132`) likewise.

### Follow-up commit `145e0265` — the QR pairing bug (TASK 2, assigned by the orchestrator)

`KdsEnrollmentModal.tsx` passed `bgColor="var(--kds-bg, #ffffff)"` / `fgColor="var(--kds-text, #111827)"` to
`QRCodeSVG`. Verified against `ui/node_modules/qrcode.react/lib/esm/index.js:1123-1128`: the library writes
those strings into **SVG `fill` presentation attributes** (`createElement("path", { fill: bgColor })`), and
`var()` does not resolve there — an unparseable attribute value is discarded, so *both* paths fell back to
the initial `fill` (black) and the code rendered as a solid black square in **every** theme, not just dark.
Fixed by pinning the pair to the author's intended literals (`#ffffff` / `#111827`) with a comment naming the
mechanism, and by giving the wrapper the same paper-white: its 16 px of padding **is** the QR's outer quiet
zone, and a dark quiet zone fails scanning on its own. The wrapper cannot take a literal hex (that would be
a new hardcoded value against a `themeTokenCompliance` baseline of 0), so it uses
`--color-pos-on-primary` — verified `#ffffff` in all three theme blocks (`tokens.css` 276, 465, 588), i.e.
the only theme-invariant white in the system. It is a foreground token pressed into service as a surface;
the honest fix is a `--color-paper` token, which is a `feat(tokens)` change and not this commit's.

No test asserted the `var()` strings (`KdsEnrollmentModalPure.test.ts` covers the exported pure helpers
only), so no spec was touched — the change stays entirely inside the fence.

Verification for this commit: `npx tsc --noEmit` clean; `npx eslint` on the `.tsx` → 0 errors, 3 pre-existing
`react-refresh` warnings; `npx vitest run` over the 4 named compliance suites + `popoverSurfaceCompliance` +
`KdsEnrollment*` + `KdsProductPicker*` → **13 files / 266 tests passed**. Pre-commit step 9 re-ran the
typecheck on the staged `.tsx` and passed.

---

**Original finding, for the record:** `KdsEnrollmentModal.tsx` passes
`bgColor="var(--kds-bg, #ffffff)"` / `fgColor="var(--kds-text, #111827)"` to `QRCodeSVG`. Those resolve through
the `.kds` scope, so in **dark** theme the QR renders light modules on near-black — an inverted code many
kitchen scanners reject; the author's fallbacks show the intent was dark-on-light. A fix needs either a fixed
paper-white token (a `feat(tokens)` change) or a hardcoded hex in the props, both outside "zero new tokens"
+ "no new hardcoded values". Left byte-identical and reported. **→ Since fixed by commit `145e0265` (see the follow-up section above).**

## Mission B — exit animations

The scout brief said "entry keyframes in their css". **Neither modal had any entry animation** —
`KdsProductPickerModal.css` contained zero `animation`/`@keyframes`, and `KdsEnrollmentModal.css` had only the
`kds-enrollment-spin` loader. There was nothing to mirror, so a symmetric pair was added from the shipped
shapes: overlay fade + panel `translateY(12px) scale(0.98)` slide-up, i.e. exactly `modal-fade-in` /
`modal-slide-up` in `components.css` and the `overlayIn`/`overlayOut` pair in
`WorkspaceSettingsModal.module.css`.

All four components of the skill are present in each modal:

1. **CSS mirror + `--exiting` rule** inside one `@media (prefers-reduced-motion: no-preference)` block, in the
   required source order (entry rule → entry keyframe → exit keyframe → exit rule), with
   `animation-fill-mode: both`, `pointer-events: none`, animating only `transform` + `opacity`.
2. **`exiting` flag + conditional className** on the overlay *and* the panel — the two elements whose JSX is
   gated. Class names kept as static string literals so the prefix-based `screenExtraction` allowlists stay
   valid.
3. **`useRef` timer + empty-deps `useEffect` cleanup** that clears it on unmount only.
4. **Race guard**: `prevOpenRef` transition detection, `clearTimeout` before rescheduling, and a
   reopen-during-fade branch that cancels the exit and drops the class.

**Deviation from `useExitAnimation`, deliberate:** the shipped hook defers the parent's `onClose()` until
*after* the fade. That contract breaks two pinned assertions in
`ui/src/__tests__/KdsProductPickerModal.test.tsx` (lines 112 and 126 assert
`expect(onClose).toHaveBeenCalledTimes(1)` synchronously after the backdrop click / Escape), and that test
file is outside my fence — I could not adapt it, and weakening it was not an option. The shipped consumer
`WorkspaceSettingsModal.test.tsx` gets away with the hook only because it mocks `useExitAnimation` outright
(`requestClose: onClose`); these two specs do not.

The pattern is therefore applied in its **controlled-component form**: `onClose()` still fires synchronously
from every existing handler (X, Cancel, Done, backdrop, Escape — none changed), and the modal defers only
**its own unmount** by one fade length, gated on `if (!isOpen && !exiting) return null;`. Both modals are
rendered unconditionally by `KdsScreen.tsx` (lines 1103, 1145) with an `isOpen` prop, so the component
survives the parent's flip and the keyframe actually runs. `useFocusTrap(panelRef, isOpen, onClose)` is
unchanged: the trap deactivates the moment `isOpen` drops, so focus returns to the trigger immediately and
Escape cannot double-fire during the fade. `animDuration(200)` from `@/utils/animation` drives the timer, so
reduced-motion users snap. Zero new tokens: `var(--duration-200)`, `var(--ease-out)`, `var(--ease-in)`.

## Verification evidence

From `ui/`:

* `npx vitest run` over `animationCompliance`, `reducedMotion`, `themeTokenCompliance`, `screenExtraction`,
  `popoverSurfaceCompliance`, `noiseDitherCompliance`, `KdsEnrollment*`, `KdsProductPicker*`,
  `KdsScreen.test.tsx`, `loadingStateCompliance` → **16 files / 337 tests passed** (default reporter),
  including `KdsScreen.test.tsx` 56/56 and `KdsProductPickerModal.test.tsx` 6/6. The known
  `KdsEnrollmentModalPure.test.ts` wall-clock flake did not reproduce (passed in both the pre- and
  post-change runs).
* Baseline run of the four named compliance suites **before any edit**: 4 files / 153 tests passed — every
  green above is against an already-green baseline, not a lowered bar.
* `npm run typecheck` (`tsc --noEmit`) → clean, run three times: after Mission A, after Mission B, and again
  inside the pre-commit hook (step 9 fired on 2 staged `.tsx`).
* `npx eslint` on both modified `.tsx` files → **0 errors**, 7 warnings, all pre-existing
  `react-refresh/only-export-components` on the exported pure helpers (`addStationToList`,
  `secondsUntilExpiry`, `shouldFireOnEnrolledOnDone`, `addOrUpdatePicked`, `resolveCourseFromCategory`,
  `clampQty`, `updateQtyEntry`). None introduced here.
* `themeTokenCompliance` baseline stayed at **0** — no new hardcoded value added anywhere; the count only
  went down.
* `git log -1 --stat` audited per commit: A = 4 CSS files, B = 2 TSX + 2 CSS files. Nothing outside the
  fence appears in either diff, and `git status --porcelain` after each commit showed only other agents'
  files still dirty.

## Follow-ups for the orchestrator (not done — outside fence)

1. Register `.kds-enrollment-modal` in `POPOVER_SURFACES` (`popoverSurfaceCompliance.test.ts`) now that it
   uses `--color-bg-popover`, so a future refactor cannot walk it back to a translucent token.
2. ~~QR palette~~ — **done** in `145e0265`. Remaining nit for the token owner: `--color-pos-on-primary` is a foreground token used as the QR quiet-zone surface because no `--color-paper` exists; a `feat(tokens)` change would let that read correctly.
3. Retiring the `.kds` local token layer (65 `--kds-*` names, 6 surviving hex) in favour of global tokens is a
   screen-wide change, larger than a polish commit.
4. `z-index: 1` locals in `KdsScreen.css` (lines 202, 270, 661, 1062) left raw — `--z-base` is `0`, not `1`.
