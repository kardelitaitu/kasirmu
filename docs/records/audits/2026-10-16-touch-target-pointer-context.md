# Touch targets: measure under the pointer the device actually reports

**Date:** 2026-10-16
**Scope:** the live-DOM reachability/target probe, extended to the retail POS, warehouse and KDS.
**Verdict:** three candidate defects raised, **none of them real**. The probe was measuring the
wrong thing in each case. No production code changed.

## Candidate 1 — a "36-control WCAG 2.5.8 violation" that is 44x44 on the device

At the **desktop** project (1366x768, fine pointer) the retail product table reported 36
controls below the WCAG 2.2 AA 24px floor:

    retail-table-add-btn    18   25x22px
    retail-table-edit-btn   18   25x22px

Hit-testing a 60x60 grid around the first button confirmed the real target equalled the rect
(`hitArea 25x22`, no invisible padding). The CSS is `width: 1.75rem; height: 1.5rem`
(`RetailPosScreen.css:584-585`), which renders 25x21 at a 15px root font.

**It is not a violation, because the desktop is not the device.** The catch-all at
`theme/components.css:1455-1467` applies under `@media (pointer: coarse)`:

    button, a, [role="button"], input, select, textarea, ... {
      min-height: var(--touch-target-min);   /* 44px */
      min-width:  var(--touch-target-min);
    }

`width`/`height` and `min-*` are DIFFERENT properties, so the used value is
`max(25, 44) = 44`. Measured on the **tablet** project, which reports a coarse pointer:

| Reading | Value |
|---|---|
| button rect | **44 x 44** |
| computed `min-width` / `min-height` | `44px` / `44px` |
| `matchMedia('(pointer: coarse)')` | **true** |

The owning guard, `ui/src/__tests__/touchTargetSizing.test.tsx`, documents this exact split at
`:204-215` and grades it as compliant. It is right, and the probe was wrong.

## Candidate 2 — "unreachable skip link"

`retail-skip-link` reported off-viewport. It is `position: absolute; top: -768` — the
skip-to-content link, hidden off-screen until focused, with `top` set to exactly
`-viewportHeight`. That is the standard technique and it is correct.

## Candidate 3 — "five 11px controls"

`retail-th-content` (the sort-label wrapper) is 126x11, but its enclosing `<th>` is 140x24 and
`clickable: true`. The click target is the cell, not the inner span.

## The corrected method

For target size, the question is not "how big is the box in my viewport" but "how big is it on
the device that has to hit it". A desktop run cannot answer that, because the coarse-pointer
catch-all is deliberately inactive there. **The tablet project is the only one that can.**

For reachability the earlier correction stands and is retained: walk the ancestor chain for a
scroll container, and call a control unreachable only when none exists
(`2026-10-16-reachability-vs-position-probe-correction.md`).

## Cleared with the corrected method

| Surface | Unreachable | Sub-44 on the target device | Doc overflow |
|---|---|---|---|
| Retail POS | 0 | 0 (44x44 measured) | none |
| Warehouse | 0 | 0 | none |
| KDS | 0 | 0 | none |
| Restaurant: menu, cart, sheet, Menu Editor, Receipts, Payments, History | 0 | 0 | none |

## Lesson

This is the sixth scoped-query false result of the session and the third caused by my own
probe. Two of the three, and this one, shared a single root error: **measuring an artifact in
the environment I happened to be in rather than the environment the artifact is for.** A
desktop viewport cannot grade a touch target; a static viewport cannot grade reachability. I
also raised a non-zero reading as a probable defect twice before proving it broken — the
positive-control discipline applies in both directions, and a non-zero needs disproving just
as a zero needs a control.

> last audited 16-10-26 by docs-auditor
