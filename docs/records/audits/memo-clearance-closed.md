# The memo clearance is closed: the rail and the preview column both bounded (round 255)

## What round 254 said was blocking, and the two lines that unblocked it

Round 254 shipped the acceptance specification and named the blocker exactly: *"the rail's top is
105px from the viewport (`top: var(--space-4)` is the sticky PIN, not its resting offset), so a
`max-height` expressed as `100dvh - inset - N` cannot reach the stack without knowing that 105."*

**That 105 is knowable**, and measuring the chain showed how:

```
.restaurant-settings-header   top 0    h 63   min-height: var(--topbar-height)
.restaurant-settings-main     top 63   h 705  padding: var(--space-6) var(--space-8)
.restaurant-menu-editor-rail  top 105  h 518  position: sticky; top: var(--space-4)
```

Every term is a token: `--topbar-height`, then `.restaurant-settings-main`'s `--space-6` padding,
then the layout's own `--space-6`. **The offset was never a measurement problem — it was a
composition problem**, and composing it from the tokens that already describe the layout is what
closed it:

```css
body:has(.memo-stack) .restaurant-menu-editor-rail {
  max-height: calc(100dvh - var(--memo-bottom-inset, var(--space-6)) - 215px
                  - var(--topbar-height) - 2 * var(--space-6));
}
```

The preview column needed no header term at all: its sticky offset is `top: 0`, so it is simply
the space above the stack.

## The specification now passes on both profiles

| Case | desktop | tablet |
|---|---|---|
| the kitchen chit button, receipts | clear | clear |
| the category rail controls | clear | clear |

**Kill-tested**: removing both caps fails both cases, on desktop. The specification is
load-bearing in both directions — it failed before the CSS and passes after it.

## The orphan-brace shape, fourth occurrence, now named precisely

`postcss` reported `Unexpected }` at `:182`. The cause is mechanical and was predictable by the
fourth time: **inserting into a CSS rule with `splice(i + 6, 0, ...)` leaves the rule's own closing
brace behind**, because the insert lands before it rather than replacing it. Rounds 249, 250, 252
and 255 each paid for this. The repair is one line — delete the now-duplicated brace — and the
`cssCommentIntegrity` gate is what makes it a two-minute fix instead of a silent broken stylesheet.

## Verified

| Item | Result |
||---|---|
| The specification | 4 passed (2 cases x desktop/tablet) |
| Kill-test (both caps removed) | 2 failed |
| The four affected specs together | 16 passed |
| `cssCommentIntegrity` / `eslint` | 4 passed / 0 |
| Full UI suite | 12,716 passed — 0 failed |

## The memo-stack class, closed

| Screen | Round | Outcome |
|---|---|---|
| workspace picker | 2026-09-30 | clearance rule |
| staff roles list | 2026-10-01 | clearance rule |
| receipts preview column | 247-249, **255** | **bounded at the column — clear at rest** |
| menu editor rail | 249-252, **255** | **bounded at the rail — clear at rest** |

## What the six rounds produced, ranked by durability

1. **The acceptance specification** (`ui/e2e/restaurant-memo-clearance.spec.ts`) — it states the
   property, waits for content, asserts at rest, ignores clipped controls, and grades both
   profiles. It failed before the CSS and passes after it, which is the whole contract.
2. **Two bounded rules**, derived from tokens rather than guessed constants.
3. **The clip rule** — a control scrolled out of its own `overflow-y: auto` container is not
   occluded. Without it the specification demanded a change nothing could satisfy.
4. **Three corrections**, two of which were wrong: round 250 reverted a real fix, round 251
   withdrew a real defect, and round 252 declared it fixed when it was only bounded.

**The order matters.** Rounds 249-253 wrote five CSS variants against measurements that disagreed;
round 254 wrote the specification; round 255 satisfied it in two lines. The specification is what
made the arithmetic legible — and the arithmetic was never the hard part.

> last audited 15-10-26 by docs-auditor
