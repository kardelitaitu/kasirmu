# Locked the sales-history scroll to the bar; no single declaration fixes it — 2026-10-18

<!- - Audit stamp: 2026-10-18 - autonomous goal round 168 - status: the round-167 defect is
     now FULLY isolated (source, carrier, and absence of auto-scroll), still NOT fixed:
     ~15 candidate declarations measured, none satisfies both assertions - branch: 0.0.41 -
     commit: none (no production file changed) -->

<!- - Scope: finish the one defect round 167 opened rather than start another, as its own
     carry-forward instructed. -->

## What round 167 left, and what this round pinned

Round 167 established that at 480x800 the sales-history page has a 197px horizontal scroll
range and that hiding the filter bar removes it. This round isolated it to a single element
and then corrected the harm model. Three measurements did the work:

**1. The carrier is one of two scrollers, and it is the bar.** `.sales-history` contains two
`overflow-x: auto` children. Hiding each in turn: the bar -> `scrollX 0`, `html.scrollWidth
480`; the table wrap -> `scrollX 197` unchanged. So `.sales-history-table-wrap` (which reports
`cw 452 sw 452`) is correctly contained and the filter bar is the sole source.

**2. The two scrollers are geometrically IDENTICAL, so the difference is content, not box.**
Both are `w=452 left=14 right=466 ovx=auto`, same parent chain, same computed `min-width`. What
differs is what is inside them: the table wrap holds a `<table>` that can shrink, the bar is a
`flex-wrap: nowrap` row whose children each carry a `min-width`, so its min-content width is the
sum. Hiding the bar's CHILDREN also removes the leak (`scrollX 0`), which confirms the
content width is the carrier.

**3. THE HARM MODEL WAS WRONG, and this is the round's main correction.** The page does
NOT scroll by itself. Measured on load, with no interaction:

```
window.scrollX on load = 0
document.activeElement = BODY
after scrollTo(0) -> scrollX 0, and still 0 after 1.2s
```

So round 167's phrasing — "a tablet user can drag the page 197px sideways" — describes a
scroll RANGE, not an observed symptom. The 197 only appears when something asks the document to
scroll. That is still a real defect (an unintended scroll range on a touch target is exactly
what the assertion exists to catch, and a stray focus or a stray gesture can consume it), but it
is a latent hazard rather than an active one, and the record needs to say so.

## The measured candidate table

Every candidate was applied inline at 480x800 and scored against BOTH assertions
(`scrollX == 0` AND `root.scrollWidth == root.clientWidth`):

| candidate | scrollX | root.sw |
|---|---|---|
| baseline | 197 | 480 |
| `contain: paint` on `.sales-history` | 0 | **677** |
| `contain: inline-size paint` on `.sales-history` | 0 | **677** |
| `overflow-x: clip` on `.sales-history` | 197 | 480 |
| `overflow-x: auto` on `.sales-history` | 197 | 480 |
| `overflow-x: clip` on the bar | 197 | 480 |
| `overflow-x: hidden` on the bar | 197 | 480 |
| `contain: inline-size` on the bar | 197 | 480 |
| bar `min-width: 0` + `width: 100%` | 197 | 480 |
| `.sales-history` `min-width: 0` | 197 | 480 |
| `overflow-x: clip` on `.app-content-inner` | 197 | 480 |
| `overflow-x: hidden` on `.app-content-inner` | 197 | 480 |
| `overflow-x: clip` on `.app-layout-body` | 197 | 480 |
| `overflow-x: hidden` on `html` | 197 | 480 |

**No declaration satisfies both.** The two that reach `scrollX 0` do it by making
`root.scrollWidth` report 677, which trades one failing assertion for the other — and would be a
worse bug in production, because a 677 scrollWidth on a 480 box is a genuinely overflowing
page rather than a suppressed one.

The most informative negative: **`overflow-x: hidden` on the bar does NOT stop the root scroll.**
If the leak were the bar's painted overflow, hiding it would fix it. It does not, which says
the 197px is contributed to the root scrollport by something other than the bar's box —
consistent with finding 3, where nothing on screen is actually scrolled.

Retail POS remains the counter-example that proves a fix exists: its root reports
`480 / 480` AND `scrollX 0` while carrying `.retail-categories sw 1632 / cw 192`. Whatever
differs is structural and is NOT any `overflow`, `contain`, `min-width` or `width` on the boxes
this round tested — that space is now exhausted and recorded so it is not re-walked.

## Evidence

- Seven probes this round (plus nine last round), each deleted; verified 0 `zz-*` remain and both
  sales-history files clean against HEAD.
- The candidate table is measurement output, not inference; each row is a single-line inline
  style applied and scored in the same page session.
- **No production file changed.** Nothing to commit but this record.

## Carried forward

1. STOP probing `overflow`/`contain` on these boxes — that space is exhausted and tabulated
   above. The next probe must be structural: compare the RENDERED TREE of `.retail-pos` against
   `.sales-history` at 480px for extra wrapper elements, `display: contents`, or a positioned
   ancestor that retail has and sales-history lacks.
2. The `:303` assertion still needs an owner decision (it encodes the pre-`f5772454c`
   filter-bar design). Round 167 raised this and it remains open.
3. Harm-model correction to carry into any future write-up: this is a latent scroll RANGE, not
   an observed auto-scroll. Do not restate it as "the page scrolls on its own".

> last audited 18-10-26 by docs-auditor
