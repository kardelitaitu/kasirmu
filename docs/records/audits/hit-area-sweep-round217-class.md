# Sweeping for round 217's hit-area class, and finding none (round 218)

## Why this round

Round 217 found that an invisible 32px touch target on a 4px resize handle had been swallowing
clicks on a live button — and the CSS comment said "on mobile/tablet" while the rule was
unconditional. One instance of that divergence is a bug; the question is whether it is a class.

## Three scans, and the first two were noise

| Scan | Signal | Hits | Verdict |
|---|---|---|---|
| 1 | `content: ''` + `position: absolute` + any negative value | 17 | too broad |
| 2 | the same, not inside `@media (pointer: coarse)` | 15 | still too broad |
| 3 | the pseudo-element reaches OUTSIDE its box | **1** | the real question |

Scan 2's 15 hits were almost all **switch knobs** — a `::after` inside a bounded parent with
`transform: translate(-50%, -50%)`. The minus sign in a transform is not a reach-out, and one
clear false positive was the retail resize handle's `::after` (`RetailPosScreen.css:160`), which is
the **visible** accent line (`width: var(--space-0_5)`), not a hit area.

**That is round 175's lesson in a stylesheet: a regex sees text, not layout.** Scan 3 asked the
question that matters — does this box extend past its parent — and got one answer.

## The one hit, and why it is safe

```css
.memo-stack-item:last-child .memo-banner::after {
  bottom: -6.5px;  left: var(--space-6);
  width: 12px;  height: 12px;
  transform: rotate(45deg);
}
```

A **speech-bubble tail** — a rotated square peeking from the bottom edge of the bottom-most
memo. It reaches out by 6.5px and sits over the stack's own margin, not over a control. It is
`pointer-events` default (`auto`) but there is nothing beneath it to intercept: `.memo-stack-item`
is a grid row in the same stack.

## What the sweep establishes

**No second instance of round 217's class.** The restaurant and retail resize handles are the only
two hit-area expansions in the tree, and:

| Handle | State |
|---|---|
| `.pos-resize-handle::before` | **fixed in round 217** — scoped to `@media (pointer: coarse)` |
| `.retail-resize-handle` | never had a `::before` expansion; its `::after` is the visible line |

## Verified

| Item | Result |
|---|---|
| Scan 3, the precise shape | 1 hit, explained and safe |
| Scan 2, the broad shape | 15 hits, all bounded knobs or visible accents |
| New defects | **none** |
| Source changed | none |

## The useful output

A cheap hedge for the next sweep of this kind: **the shape is `position: absolute` + a negative
inset**, and the tell for a hit area rather than a decoration is that the pseudo-element has no
`background` of its own and no size worth seeing. Both 217's `::before` and this round's tail
match the first half; only 217's matched the second.

> last audited 14-10-26 by docs-auditor
