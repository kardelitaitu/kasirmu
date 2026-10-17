# 134 lines of cart keyboard logic, and a comment claiming it was tested — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 196 · status: the POS cart key handler
     had NO behavioural test while its own doc said it did; 7 cases added and kill-tested on
     the two money-facing branches · branch: 0.0.41 · commit: 21533ec7b -->

<!-- Scope: defect hunting by measurement, using the round-195 corrected scan. -->

## How it surfaced

Round 195 taught two things I applied here: walk the WHOLE tree for a coverage query, and grep
by BEHAVIOUR rather than by filename. A size-vs-reference scan over restaurant/POS files listed
`useCartKeyboardNav.ts` (4KB) with **zero** test references. The hook docstring then supplied
the claim to check:

> so no memo boundary widens - **which is what the keyboard tests pin down.**

So there either were keyboard tests, or the comment was wrong. Grepping for the symbols the
handler exports — `handleCartPanelKeyDown`, `focusLineByIndex`, `cartLineRefs` — found the
opposite of coverage:

```
CartPanel.test.tsx:275   const handleCartPanelKeyDown = vi.fn();   // MOCKED
CartPanel.test.tsx:288   expect(handleCartPanelKeyDown).toHaveBeenCalledTimes(1);
```

**The panel-to-handler wiring is covered; the handler is not.** Not one of its branches was
exercised, and the comment asserting otherwise made that look settled.

## What was actually untested

134 lines, all reachable from the cart the operator looks at all service:

| key | behaviour |
|---|---|
| ArrowDown / ArrowUp | move focus between cart lines, from top/bottom when nothing is focused |
| + and = / - and _ | change quantity on the focused line |
| Delete / Backspace | remove the focused line |
| **Enter** | **pay** |

Two branches are money-facing rather than convenience:

1. **Enter calls `handlePay`, gated on `total`.** A stray Enter in the cart paying an
   empty sale is the worst failure in the set, and the gate was asserted by nothing.
2. **+, - and Delete resolve the line from a `data-line-id` ANCESTOR**, because the key
   bubbles from a button inside the row rather than from the row itself. A mis-resolved id
   would silently adjust or delete the WRONG line — a cash error with no error message.

## Seven cases, two kill-tested

Coverage: focus movement in both directions and from nothing focused; the input guard (a plus
typed into a field must not change a quantity, and Enter there must not pay); the Enter pay gate
both ways; the id resolution asserted **by identity** rather than call count; the negative case
where no line is under the key; and that an unhandled key is not `preventDefault`ed.

Kill-tests:

| mutation | result |
|---|---|
| remove the `if (!total) return;` Enter gate | **red** — Enter must not pay with no total |
| make Delete act on `lines[0]` instead of the resolved id | **red** — the identity case |

Both restored byte-identically by sha256 (`e147de039ff7e97f`).

## The false comment, corrected

The docstring now records that the claim WAS false, what the grep showed, and that the sibling
suite is what makes it true — rather than quietly deleting the sentence. A wrong "this is tested"
note is worse than no note: it is the first thing the next reader checks and it sends them away.

## A harness mistake, caught before it was reported as a defect

My first two focus cases failed with `expected <body>…`. The cause was mine: I spied on a
DETACHED div focus method and then asserted `document.activeElement`, which can never become a
detached, non-focusable node. The fix was to attach the stubs with `tabIndex` so the assertion is
meaningful — not to weaken the assertion. Recorded in the test header, because the failure
looked exactly like a product failure.

## Verified

| check | result |
|---|---|
| the new suite | **7 passed** |
| kill-test (Enter gate) | red |
| kill-test (id resolution) | red |
| restore of the hook | byte-identical; only the docstring changed in production |
| `npx tsc --noEmit` | **0 errors** (round-195 lesson applied) |
| `npm run lint` | 0 errors (116 warnings, baseline) |

## Carried forward

1. **A doc comment that asserts its own test coverage is a claim to verify, not a fact.** This
   one was wrong and acted as a reason not to look. Grepping the exported symbol names is the
   cheap check, and it is what found this.
2. The remaining thin file from the same scan is `RestaurantShortcutsHelp.tsx` (3KB, 1
   reference) — likely presentational like `KdsMainContent`, but unverified.

> last audited 18-10-26 by docs-auditor round-2
