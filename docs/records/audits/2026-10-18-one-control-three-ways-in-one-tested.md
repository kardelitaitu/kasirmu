# One control, three ways in, one tested — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 194 · status: the order-type slider
     keyboard and swipe paths had no coverage; both added and kill-tested, including the
     boundary clamp only those two paths can reach · branch: 0.0.41 · commit: cad54776a -->

<!-- Scope: apply the rule from rounds 191-193 — coverage per MECHANISM, not per file. -->

## How the target was found

The rule from the last three rounds is that a control reachable by more than one mechanic will
look covered while only one path is exercised. Rather than guess, I enumerated the population:
every `useSwipe` consumer in production (10), then checked which had a test that drives the
GESTURE rather than a neighbouring click.

That cleared most of them: KDS drives its tab swipe with real touch events
(`KdsScreen.test.tsx:970`), and SalesHistory is now fully covered from rounds 191-193. It also
found `KdsMainContent` with no test file at all — which turned out to be fine, because it is
presentational: it owns no state and receives `swipeProps` from the screen, so its own absence
of tests hides nothing.

The real hit was the `CartPanel` order-type slider.

## The gap

The slider offers three ways to change the order type:

| path | wiring | coverage before |
|---|---|---|
| click a radio | `onClick={() => setOrderType(opt.id)}` | labels asserted; the click itself incidental |
| **arrow keys** | `onKeyDown` on the radiogroup | **none** |
| **swipe** | `useSwipe({ onSwipeLeft: next, onSwipeRight: prev })` | **none** |

The two uncovered paths share a helper the click path never touches: `handleOrderTypeNext/Prev`,
which index into `ORDER_TYPES` and guard at both ends. **The boundary clamp is reachable ONLY
through those two** — so the one piece of real logic in this control was the piece with no test.

## Checking it was not dead code first

The keyboard handler sits on a div with `tabIndex={-1}`, which cannot be Tab-focused — which made
"dead code" a live hypothesis worth testing rather than assuming away. It is NOT dead: the radio
buttons inside have no `tabIndex`, so they are naturally focusable, and a keydown on a focused
child **bubbles** to the radiogroup div. A keyboard user can therefore Tab to a radio and drive the
slider with arrows. The path is reachable; only its coverage was missing.

## Two cases, both kill-tested

| case | asserts |
|---|---|
| arrow keys + clamp | ArrowRight advances; ArrowRight from the LAST type sets nothing; ArrowLeft from the FIRST sets nothing |
| swipe | a left swipe advances one order type |

Kill-tests, because "passes" is not evidence:

| mutation | result |
|---|---|
| make the next-clamp wrap to the first type | **red** — the last order type has no next, but the spy was called |
| swap the two swipe directions | **red** — the case names the direction, so it fires |

Both restored byte-identically by sha256 (`28ef97c4eb960910`); production is unchanged.

## A test-side mistake worth recording

My first version pressed ArrowRight twice in a row and expected `takeaway` then `delivery`. It
got `takeaway` twice, and I nearly wrote that up as a defect. The cause was mine:
`orderType` is a CONTROLLED prop, so a recorded `setOrderType` does not change what the component
sees on the next press. Each step needs its own render with the value the parent would now pass.
A second harness trap followed: this file has no auto-cleanup, so repeated renders stack
`role="region" name="Cart"` in one document and the next query throws. The case now renders and
unmounts per step, with both reasons in the comments.

## Verified

| check | result |
|---|---|
| `CartPanel.test.tsx` | **33 passed** |
| kill-test (clamp wraps) | red |
| kill-test (swipe swapped) | red |
| `git status` on `CartPanel.tsx` | clean — only the test was committed |
| `npm run lint` | 0 errors (116 warnings, baseline) |

## Carried forward

1. The remaining `useSwipe` consumers were checked and are fine: KDS drives its gesture with real
   touch events, and `KdsMainContent` is presentational. No further swipe-coverage work is
   warranted on this tree without a new reproduction.
2. The rule has now paid off four rounds running: **enumerate the mechanics, not the files.**
   A grep for the hook or callback that a NON-click path goes through is the cheap version of it,
   and it is what found this one.

> last audited 18-10-26 by docs-auditor
