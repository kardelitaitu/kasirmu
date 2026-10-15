# The specification, and the clip rule that made it fair (round 254)

## What round 253 asked for, and what was built

Round 253 closed with: *"state what must be true, assert it at BOTH profiles, and let the CSS
answer to it."* This round wrote that file —
`ui/e2e/restaurant-memo-clearance.spec.ts` — and it is the round's durable output.

## The property, stated once

> With the memo stack present and a surface's **content loaded**, no interactive control in that
> surface may have its **centre hit-test to a `memo-*` node**, measured **at rest**.

Two clauses, each named because a previous round got it wrong:

| Clause | The round it answers |
|---|---|
| content-loaded — wait for a named control, never a wrapper | 251 measured a 128px skeleton and withdrew a real defect |
| at rest — nothing scrolls first | 248 and 252 both proved their rules by scrolling to the end |

## The clause the specification itself needed

The first version reported the rail's last three categories as occluded — `cat-del-dessert` at
y=744 while the rail's own box ended at **614**. They are not covered; they are **outside their
container**, and an operator scrolls the rail to reach them.

`getBoundingClientRect` reports LAYOUT positions, including for a button scrolled out of an
`overflow-y: auto` box. So the hit test was sampling points that are not on screen. The fix is a
clip walk:

```ts
for (let n = el.parentElement; n; n = n.parentElement) {
  const cs = getComputedStyle(n);
  if (cs.overflowY === 'visible' && cs.overflowX === 'visible') continue;
  const nr = n.getBoundingClientRect();
  if (r.top >= nr.bottom - 1 || r.bottom <= nr.top + 1) { clipped = true; break; }
}
if (clipped) continue;
```

**A control clipped by its own scroll container is not occluded.** Without that clause the
specification demanded a CSS change nothing could satisfy — which is how five rounds of CSS were
written to answer a measurement that had been wrong each time.

## What the corrected specification reports

| Screen | At rest, desktop | At rest, tablet |
|---|---|---|
| receipts | **2 occluded** — preview-chit, drawer | clear |
| menu editor | **1 occluded** — `cat-edit-cat-snack` at y=601, centre 623 | clear |

`cat-edit-cat-snack` is genuinely inside the rail's visible box (`rail.bottom 697`) and genuinely
under the stack (`stackTop 610`). **That one is a real 9px overlap**, and the specification is now
the thing that says so reproducibly instead of six probes disagreeing.

## The CSS was not fixed, and that is deliberate

Five rule variants were written this round and **all were reverted** — `RestaurantMenuEditorScreen.css`
is byte-identical to HEAD, confirmed with `git hash-object`.

The blocker is arithmetic, not insight: the rail's own top is **105px** from the viewport (`top:
var(--space-4)` is the sticky PIN, not its resting offset, because the screen has chrome above it),
so a `max-height` expressed as `100dvh − inset − N` cannot reach the stack without knowing that
105. Deriving it from tokens was attempted and did not close; guessing it is the 2px game round 253
refused to play.

**What the round leaves is a specification that fails honestly and names its two controls**, which
is a better starting point than any of the six CSS variants.

## Verified

| Item | Result |
|---|---|
| Specification | 2 failed (desktop) / 2 passed (tablet) — **it grades** |
| Stack geometry, measured | desktop h 137, tablet h 141, both 2 bubbles |
| `215px` constant | the THREE-bubble height — over-reserves by ~74px at both profiles |
| `RestaurantMenuEditorScreen.css` | byte-identical to HEAD |
| `cssCommentIntegrity` | 4 passed |
| Probes | 3, all removed |

## The next round's first step

Make the rail's `max-height` account for its own resting offset — either by measuring it into a
custom property on the layout, or by bounding the rail's grid row on `.restaurant-menu-editor-layout`
instead of the sticky child. Then the same for the receipts preview column, whose offset is the
sticky pin `top: 0` and is therefore already known.

**The specification is the acceptance test. It should keep failing until the CSS answers it.**

> last audited 15-10-26 by docs-auditor
