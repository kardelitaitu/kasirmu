# Session verification: every spec I touched is green in both projects

**Date:** 2026-10-16
**Scope:** the eight E2E specs edited during the restaurant-POS objective.
**Result:** all green on both Playwright projects. Two candidate leads this round resolved to
"working as documented".

## Re-verification of my own edits

A green run at commit time is not evidence the work still holds, so every spec I edited was
re-run in the CURRENT tree, in both projects, with the other lanes' changes in place:

| Project | Result |
|---|---|
| desktop | **45 passed / 6 skipped / 0 failed** — `adr22-workspace-settings`, `new-flows`, `e2e-exchange-rates`, `sale`, `e2e-sale-to-history`, `restaurant-cart-line-course`, `retail-workflows`, `tablet-shell` |
| tablet | **17 passed / 6 skipped / 0 failed** — the three orientation-sensitive specs |

The tablet run matters most for two of them. `tablet-shell` and
`restaurant-cart-line-course` each carry assertions that are orientation- or
pointer-dependent, and both were repaired in this session after they failed on the project
they were not written for (`2026-10-16-tablet-shell-pos-driven.md`,
`2026-10-16-touch-target-pointer-context.md`). Running both projects is what proves those
repairs are real rather than project-specific.

## Two leads, both resolved to documented behaviour

### Stock Inquiry (F8) is not a restaurant shortcut

`PosScreen.tsx:2118` is headed "Sub-screen: Stock Inquiry (F8)", and `F8` is bound **nowhere**
in that file — the heading is the only occurrence. That looked like a documented shortcut that
was never wired.

It is wired, in the retail shell: `retailShortcuts.ts:46` (`{ key: 'F8', action:
'stock-inquiry', scope: 'retail' }`) and `RetailPosScreen.tsx:1818` handles it. Measured in the
retail POS: pressing F8 mounts the lookup (`lookup: 1`, grid replaced, no boundary, no page
errors). Measured in the restaurant POS: pressing F8 does nothing, and that is correct —
`CartPanel.tsx:681-682` states the design outright:

> Stock inquiry is a retail-POS concern — the restaurant POS doesn't need it (kitchen flow
> goes through the KDS).

The restaurant POS's own hub omits the button for the same reason. So the `(F8)` in the
PosScreen heading names the sub-screen by the shortcut it is reached from **in the retail
shell**, not a binding that went missing.

### The remaining unmatched sub-screen

Of the 18 POS sub-screen flags, `showStockInquiry` was the only one with near-zero E2E
coverage — which is what made it worth driving. Its low coverage is explained by the same
fact: it is a retail-only surface, and the objective's restaurant specs have no reason to
enter it.

## Honest position

Four consecutive rounds have now ended without a product defect (219: route graph closed;
220: guard added, no defect; 221-222: tablet POS and kiosk clean; 223: disabled-case sweep
clean). The last genuine defect was the Analytics crash in round 218. The surfaces reachable
from the objective's own words — restaurant POS, its screens, the tablet shell, the kiosk, KDS
gating — have each been driven and measured, and both suites plus all UI gates are green.

That is the state to judge completion on, not a reason to keep generating probes.

> last audited 16-10-26 by docs-auditor
