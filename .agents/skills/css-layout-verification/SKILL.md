---
name: css-layout-verification
description: Prove what an OZ-POS stylesheet actually does when jsdom cannot compute layout — which edge a fixed bar lands on, whether a strip overflows, whether a label is clipped or wrapped. Use when a layout claim is about effect rather than declaration, when a CSS-contract test passes but the UI looks wrong, when a declaration may be present yet inert, or before asserting that a stylesheet change fixes a visible defect.
---

<!-- Audit stamp: 2026-09-22 · Budak-Korporat · status: ACCURATE — 0 findings · Audited against branch `0.0.39` at `e56bf8307`, working tree clean. Re-measured this pass: all six paths the skill names exist — `ui/src/app/tablet/tablet.css`, `ui/src/app/tablet/TabletAppLayout.tsx`, `ui/src/__tests__/restaurantCardHeight.test.ts`, `ui/e2e/playwright.config.ts`, `ui/src/theme/tokens.css` and `ui/node_modules/@playwright/test`. The "declaration present and inert" trap is confirmed to have been REPAIRED in the code since the incident it narrates: `tablet.css:55-57` now reads `.tablet-shell .app-layout { display: flex; flex-direction: column; }` — `column`, not the dormant `column-reverse` — so the skill's history is accurate and its present tense is not a live defect. The ZoomContext claim was verified in source: `ui/src/contexts/ZoomContext.tsx:40-41` clamps `Math.max(14, Math.min(16, 16 * scale))` against a 1920px base, so 14px root and `40rem` = 560px both hold. The tablet viewport arithmetic is self-consistent (1920/1.75 = 1097, 1200/1.75 = 686). NOT re-measured (needs a headless Chromium run the audit did not perform): the 1024x1366 bar-position figures, the seven-tab width array `[53,75,93,73,131,100,79]`, and the 13-tab counterfactual. Those stand on their 2026-09-20 measurements. -->

<!-- Superseded audit stamp: 2026-09-20 · DSH · status: ACCURATE at audit time (0 findings on 22-09-26; kept verbatim — this file preserves superseded readings) (new skill — created after the tablet tab bar was found rendering at the top of the screen for ~7 weeks while its own comment claimed the bottom; every measurement below was taken this pass against ui/src/app/tablet/tablet.css, which exists, and the Playwright recipes were run, not sketched) · verified this pass: ui/src/app/tablet/tablet.css, ui/src/app/tablet/TabletAppLayout.tsx, ui/src/__tests__/restaurantCardHeight.test.ts, ui/e2e/playwright.config.ts and ui/src/theme/tokens.css all exist; `@playwright/test` resolves from ui/node_modules with Chromium installed under AppData/Local/ms-playwright; the 1024x1366 measurement returned bar y 0-65 under column-reverse and y 1301-1366 under column -->

# CSS Layout Verification

The repo's CSS-contract tests (`ui/src/__tests__/restaurantCardHeight.test.ts` is the model) read a
stylesheet with `readFileSync` and assert that a declaration is present. That is the right regression
guard, and it is **not** evidence about behaviour: jsdom computes no layout, so nothing in a unit test
can tell you which edge a bar landed on or whether a strip overflows. When the question is about
*effect*, a string assertion cannot settle it — measure it.

## Two tiers, and which one you owe

| Question | Instrument |
|---|---|
| "Must this declaration stay?" | `readFileSync` contract test in `ui/src/__tests__/` — fast, always runs |
| "What does this declaration do?" | Playwright against the **real** sheet, `getBoundingClientRect` |

Do the second once to learn the truth, then encode the first so it cannot regress. Do not substitute
one for the other: a contract test written from a guess about the effect is how a wrong claim gets
frozen into a comment.

## The recipe

Run the browser out of a temp directory **outside the shared checkout** — a script dropped into the
repo is an untracked file a peer may commit.

1. **Copy the real sheet** next to the harness. A `file://` page cannot reliably read a stylesheet from
   another directory, and a hand-transcribed copy is worthless — it tests what you meant, not what
   shipped.
   ```bash
   cp ui/src/app/tablet/tablet.css "$TMP/real-tablet.css"
   ```
2. **Stub only the tokens the sheet reads**, in a separate `:root` block. Not cosmetic: an unresolved
   token makes a whole declaration invalid-at-computed-value-time, so `padding: 0 var(--space-2)`
   silently becomes `padding: 0` and your widths are wrong.
3. **Reproduce the real DOM order**, including elements that are out of flow in the app. Copy the order
   out of the component, do not reorder it to suit the hypothesis — the order is usually the thing
   under test.
4. **Measure rects, not styles.** `getComputedStyle` reports the declared value even when the
   declaration does nothing. `getBoundingClientRect()` reports the outcome.
5. `require` by absolute path when the script lives outside the repo — `NODE_PATH` does not rescue a
   `require('@playwright/test')` from outside the package tree:
   ```js
   const { chromium } = require('C:/dev/ozpos/ui/node_modules/@playwright/test');
   ```

Useful fields to return: `{barTop, barBottom, mainTop, mainBottom, vh}` and an `atBottom` flag computed
as `Math.abs(rect.bottom - window.innerHeight) < 2`; `scrollWidth` vs `clientWidth` for overflow; a
`clipped` count of `el.scrollWidth > el.clientWidth + 1`; and label height `> 20` as a wrap detector at
the 16px line box. Scroll a strip to `scrollWidth` and re-measure to prove the last item is reachable
rather than merely present.

## Traps this caught

**A declaration can be present and inert.** `.tablet-shell .app-layout` carried
`flex-direction: column-reverse` from the file's creation while the rule had **no `display: flex`** — so
it stayed a block, the children stacked in DOM order, and the bar sat at the bottom *by accident*.
Adding `display: flex` in a later "make the shell self-contained" commit activated the dormant
`column-reverse` and moved the bar to the top for ~7 weeks, while that commit's own comment claimed it
put the bar at the bottom. A contract test asserting the direction alone would have passed throughout.
Pin the **pair**, and pin the DOM order the pair depends on, in the component test.

**A plausible claim can be false.** A commit message and a CSS comment both asserted the old seven-tab
bar was "squeezed narrower than their own labels". Measured, it was not: 7 tabs at both tablet
viewports gave widths `[53,75,93,73,131,100,79]`, zero wrapped labels, no overflow. The squeeze is what
happens when the cap is lifted *without* `flex: 0 0 auto` plus an overflow rule — 13 tabs then collapse
to the 48px floor in portrait and 6 labels wrap. Measure the counterfactual before describing a defect.

**The e2e tablet project cannot see the shell.** `ui/e2e/playwright.config.ts` defines a tablet project
on the iPad Pro 11 profile, but the tablet specs stop at the login screen, so no Playwright test there
can reach `TabletAppLayout`. Plan on the harness above instead of extending those specs.

**Landscape on this tablet is height-constrained.** 1920x1200 physical at 280dpi gives density 1.75, so
the CSS viewport is **1097x686** in landscape and 686x1097 in portrait. Measure both; a fix that only
works in one orientation is half a fix. The root font is 14px (`ZoomContext` clamps
`window.innerWidth / 1920` to 14-16), so `40rem` is 560px.

## Writing the contract test that follows

Anchor the selector to a line start **and** allow leading whitespace:
`(?:^|\n)[ \t]*<selector>\s*\{([^}]*)\}`. Unanchored, it matches a descendant selector's body first;
strictly anchored, it misses every rule indented inside a `@media` block. Where a selector legitimately
has two top-level rules (`.tablet-shell` is both the shell root and a safe-area block), collect **all**
bodies and assert on the one that carries the properties — "the first body" is then the wrong one.

Follow the liveness-by-injection rule: after writing the guard, break the declaration and watch the
test fail with its own message before you trust it.

> last audited 22-09-26 by Budak-Korporat
