# The round-248 clearance only works at the scroll end, and a sweep found the class (round 249)

## What the round found

Round 248 fixed the drawer button by reserving the memo stack's height inside
`.restaurant-settings-main`. This round measured **when** that fix applies, and wrote a sweep for
the class it belongs to.

### The fix is scroll-position dependent

At the default resting position:

```
restaurant-receipts-test-drawer-btn        y=682   top="memo-banner-title"   scrollTop=0
restaurant-receipts-preview-test-chit-btn  y=628   top="memo-banner-text"    scrollTop=0
```

**Both are still occluded at rest.** The padding raises `scrollHeight` from 1467 to 1682, so the
buttons clear once the operator **scrolls to the end** — which is what the round-248 spec does. An
operator meets the screen at `scrollTop: 0`, so **the fix helps only after they act.**

That is not a reason to undo it: the scroll-end path was genuinely broken and now works. It is a
reason to say the fix is **partial**, which round 248's record called complete.

### The correction to the column, and why it did not hold

The right place looked obvious — the column is `position: sticky; top: 0`, so bounding **its** height
should keep its last child above the stack at any scroll offset. Applied:

```css
body:has(.memo-stack) .restaurant-preview-column {
  max-height: calc(100dvh - var(--memo-bottom-inset, var(--space-6)) - 215px);
  overflow-y: auto;
}
```

**Measured, it did not help.** The column's natural height is already shorter than the viewport, so
the cap never engages; the `overflow-y: auto` only made it a *second* scroller (`clientHeight` 532)
with the buttons still outside it. The change was reverted — `git hash-object` confirmed the file
is byte-identical to HEAD.

## The sweep, and what it found

Rather than work screen by screen, the round wrote a hit-test sweep: on each restaurant surface,
walk every interactive element and record those whose centre hit-tests to a `memo-*` node.

| Surface | Occluded (excluding the stack's own dismiss button) |
|---|---|
| payments | none |
| receipts | **2** — the drawer and preview-chit buttons |
| settings | none |
| menu-editor | **5** — a category row's edit, delete and several tiles |
| kds | none |

`memo-banner-open` appears on every surface and is **not** a finding: it is the stack's own dismiss
control, and its hit-testing to itself is correct.

**The Menu Editor owes a clearance rule too** — five controls, including a category's **delete**, are
under the stack there. That is the next screen in this class.

## Verified

| Item | Result |
|---|---|
| Round 248's fix | intact, byte-identical to HEAD |
| The column-cap attempt | measured, did not help, reverted |
| Probes | 2, both removed |
| New tests | zero |

## The correction, stated plainly

Round 248's record said the defect was fixed and measured the button moving 682 -> 470. **That
measurement was taken after scrolling to the end**, which the spec does and an operator does not.
The fix is real and partial; the record overclaimed, and this one corrects it.

## The next round's first step

The Menu Editor's five occluded controls, found by this round's sweep. And for receipts, the honest
remaining question: whether a sticky column can be bounded at all, or whether the 215px reserve
belongs on `.restaurant-settings-layout` so the column's **sibling** carries it.