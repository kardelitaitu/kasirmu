# The menu rail occlusion is real after all, and round 251 measured the skeleton (round 252)

## The reversal, and why it happened

Round 251 withdrew this defect on a measurement of `h 128`. **That reading was of the rail's
SKELETON** — taken before its categories had rendered. This round measured it with the content
present, and the original finding holds:

```
rail     y 105..803    h 698    scrollHeight 696    13 categories, 12 edit buttons
stack    y 610..747
viewport 768
```

Stable across **8 samples over 5.6 seconds**, and across a second run of 5 samples. 193px of the
rail sits inside the stack's band, and three of its controls hit-test there — including a
category's **delete**.

## What separated the real reading from the false one

| Probe | Wait | Result |
|---|---|---|
| round 251's | `toBeVisible()` on the rail | `h 128` — the skeleton |
| round 252's | first `…cat-edit-*` button visible | `h 698` — the settled rail |

**The rail is `position: sticky` and populates asynchronously, so its own visibility proves
nothing.** The category buttons are what make it tall, so they are what a measurement of its height
must wait for. The spec now carries that wait, with the round-251 reading named in the comment as
the reason.

This is the third distinct trap in the same investigation (round 226's record lists the class):

1. rounds 249-250 measured **mid-transition** and reported the right defect for unclear reasons;
2. round 251 measured **pre-content** and withdrew it wrongly;
3. round 252 measures **post-content** and the kill-test finally binds.

## The fix, now demonstrable

Two rules on the rail, both required:

```css
.restaurant-menu-editor-rail { max-height: calc(100dvh - var(--space-8)); overflow-y: auto; }
body:has(.memo-stack) .restaurant-menu-editor-rail {
  max-height: calc(100dvh - var(--memo-bottom-inset, var(--space-6)) - 215px - var(--space-4));
}
```

Measured: `h 698 -> 518`, `bottom 803 -> 623`, `by 35 -> -145`, with `scrollHeight 696 >
clientHeight 516` so the rail owns a scroll rather than clipping.

**Kill-tested with the content-aware spec**: removing both rules now **fails** the bound case. Round
250's identical mutation passed, which is exactly why it was reverted then and lands now — the
difference is the spec, not the CSS.

## The CSS syntax gate caught the splice shape a THIRD time

Every one of these three rounds left an orphan `}` from a `splice` whose replacement count did not
match what it replaced — `:176`, `:80`, and `:77` before them. `postcss` reports it as `Unexpected
}`; a browser would not. **The shape is now identifiable in advance**: a splice into a CSS rule body
needs the original closing brace removed explicitly, every time.

## Verified

| Item | Result |
|---|---|
| The rail, content-loaded, 8 samples | `h 698`, `bottom 803`, stable |
| With the cap, 5 samples | `h 518`, `bottom 623`, stable, overflows with a scroll |
| Kill-test (both rules, content-aware spec) | **1 failed** |
| `cssCommentIntegrity` / `screenExtraction` | 4 / 323 passed |
| eslint | 0 |
| Full UI suite | 12,716 passed — 0 failed |

## The memo-stack class, restored to four

| Screen | Outcome |
|---|---|
| workspace picker | clearance rule, 2026-09-30 |
| staff roles list | clearance rule, 2026-10-01 |
| receipts preview column | clearance rule; **partial** — works at the scroll end only |
| **menu editor rail** | **clearance rule, round 252 — and the kill-test binds** |

## The lesson, sharper than round 251's

Round 251 concluded *"the probe read at the wrong moment"* — and then read at a **different** wrong
moment. The publishable rule is not "wait before measuring" but **"wait for the thing whose size
you are measuring"**: the rail's visibility says nothing about its height, because the height comes
from children that arrive later.

**A rule that names the wrong cause is as dangerous as no rule**: it withdrew a true finding and
would have prevented this one from being made.

> last audited 15-10-26 by docs-auditor
