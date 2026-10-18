# The tablet shell's POS had never been driven past the login screen

**Date:** 2026-10-16
**Scope:** `ui/e2e/tablet-shell.spec.ts`.
**Result:** new case added; the tablet POS is clean. **No product defect.** Two of my own
assertions were wrong first and were corrected.

## The gap

`tablet-shell.spec.ts` exercises the REAL tablet entry (`index.mobile.html` ->
`main.mobile.tsx` -> `TabletAppShell`) — a different shell from the desktop app. But every
case in it stopped at the **login screen** or the **workspace picker**. The till itself had
never been run through that entry, so the shell the restaurant actually ships on had its POS
path unverified end to end.

## What driving it found: nothing broken

Measured 2026-10-17, tablet project (1024x1366), restaurant workspace via
`index.mobile.html`:

| Reading | Value |
|---|---|
| Menu cards | 27 |
| Floating cart bar | present (portrait shape) |
| Inline `.pos-cart-panel` | absent, as portrait requires |
| Bar position | y 1306-1355 in a 1366 viewport — in view, clear of the tab bar |
| `--memo-bottom-inset` | `3.75rem + 0.75rem + 0px + 1.5rem` (tab-bar clearance) |
| Unreachable controls | 0 |
| Controls under 44px (coarse pointer) | 0 |
| Error boundary / page errors | none |

## A lead that resolved to "correct by design", verified not assumed

The POS renders with **no `.tablet-shell` class** (`tabletShell: 0`), which looked wrong:
`tablet.css` has 62 rules and `components.css` 5 that key off it, and
`TabletAppLayout.tsx:118` is where the class is applied.

It is deliberate. `main.mobile.tsx:27-35` states that fullscreen routes "render outside
TabletAppLayout, so they never carry its `.tablet-shell` class", which is exactly why the
entry also sets `document.documentElement.dataset.shell = 'tablet'` as the marker a
tablet-only rule can key off. The probe confirms `dataset.shell === 'tablet'`. And the
restaurant CSS does not depend on the absent class at all: its four `.tablet-shell`
mentions are **all inside comments** (`RestaurantCartSheet.css:93-95`,
`RestaurantFloatingCartBar.css:195-210`). So the new case asserts the `data-shell` marker
and NOT the wrapper class — asserting the class would pin the wrong contract.

## Two of my own assertions were wrong, and the suite said so

Both were caught by running the case in **both** Playwright projects, which is what this file
already does:

| First draft | Why it failed on desktop | Fix |
|---|---|---|
| Asserted the floating cart bar unconditionally | Landscape renders the cart INLINE; the cart surface is orientation-dependent, not project-dependent | Branch on the MEASURED viewport (`innerHeight > innerWidth`), matching the file's existing pattern |
| Asserted the 44px floor unconditionally | The floor is a `@media (pointer: coarse)` rule; the desktop project is a fine pointer, and 12 controls are deliberately compact for a mouse | Branch on the MEASURED pointer, as the sibling touch-target case already does |

The second is the same correction recorded in
`2026-10-16-touch-target-pointer-context.md` — a fine pointer cannot be graded by a
coarse-pointer rule. It recurred here because I wrote a new assertion without carrying the
lesson across, which is why the fix now states it inline.

## Kill test

`RestaurantMenu` forced to render null:

    × [tablet] the restaurant POS runs inside the tablet shell

Restored byte-identically afterwards (`git diff --stat` empty). The case discriminates.

## Result

`tablet-shell.spec.ts`: **10 passed / 0 failed across both projects** (was 4 cases, all
stopping before the POS). `tsc --noEmit` clean, `lint` 0 errors.
Committed `91c4925fd`.

> last audited 16-10-26 by docs-auditor
