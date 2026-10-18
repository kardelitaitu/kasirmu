# The EDC wait window: a suspected gap that the code does not have

Date: 2026-10-18 (round 122). Surface: the card-present (EDC) tender of the
payment modal. Commit: `f7e637965` — *test(payments): pin that no sale is booked
while the terminal holds the card*.

## The suspicion

Reading `useEdcTenderPhase` against the shell that consumes it, the card arm of
`canComplete` (`PaymentModal.tsx:1276-1280`) reads exactly two operands:
`cardOffered` and `edcTerminalFailed`. Neither is true during the
tap/insert/swipe wait. The settle handler `complete` (`:1304`) has no card branch
of its own — it runs `startSaleScoped` -> `addLineScoped` -> `completeSaleScoped`
with `storedMethod` 'card'. So a Complete press during the wait would, on that
reading, book a CARD sale for money the terminal had not taken. The declined case
was already pinned by a sibling test; the WAITING case looked unreachable.

## What was actually measured

A probe on this exact window, with `edc_sale` left unsettled, printed:

```
settleButton disabled= true | role=status present= true
complete_sale_scoped calls= 0 | edcSale calls= 1
operands { method:"card", sufficient:true, edcTerminalFailed:false,
           cashOffered:true, cardOffered:true, totalMin:700, splitMode:false }
```

So `canComplete` was TRUE, and the button was disabled anyway. My claimed
mechanism was wrong. The real one is `Button.tsx:70-72`:

```ts
const isProcessing = state === 'processing' || loading === true;
const isDisabled  = disabled || isProcessing || isSuccess;
```

The settle button passes `loading={processing}` and no `state="processing"` of
its own (`PaymentModal.tsx:2340` is the only settle `<Button>`).
`handleTerminalPay` sets `processing` at its top and clears it in its `finally`
(`useEdcTenderPhase.ts:169`, `:261`), and `setEdc({ phase: 'waiting' })` is written
synchronously BEFORE the `await edcSale`, so the flag spans the whole terminal
window. The guard is real; it is just not where I looked.

## Why it is still worth committing

The protection rests on ONE shared flag that `canComplete` never reads. Nothing
in the card arm reads the live EDC overlay, and the button carries no independent
`state="processing"`. That is a genuine single-point fragility, and it is exactly
the class of coupling the declined-capture case (`PaymentModalSaleFlow.test.tsx
:2310`) was written to pin — reached here through the *other* branch of the same
phase machine.

## The test, and why it asserts the ledger

`books no sale while the card-present capture is still waiting` holds `edc_sale`
unsettled and asserts, in priority order:

1. `callsOf('complete_sale_scoped')` is EMPTY — the invariant that holds
   regardless of which mechanism disables the control.
2. `settle-button` is disabled — the weaker, second assertion, documented as
   today's mechanism rather than the reason the case exists, so a refactor that
   keeps the ledger safe but changes the button's gating shows exactly which half
   moved.

## Verification (kill-tested)

* GREEN at HEAD first — the suspicion was refuted, and the probe above is the
  evidence, not a guess. The test as first written asserted only the button state
  and PASSED; that version was rewritten rather than kept, because a passing test
  that measures the wrong thing is worse than none.
* KILL: inserting `setProcessing(false)` immediately after `setEdc({phase:
  'waiting'})` — the exact future edit this case exists to catch — turned the
  button assertion RED with `Complete must stay dark while the terminal holds
  the card: Received element is not disabled`. The hook was then restored from the
  HEAD blob and verified clean by grep.
* Neighbour suites: all 6 PaymentModal files, `145 passed / 1 skipped / 2 todo`
  (148 total). The `createKdsOrderFromSale failed TypeError: orders is not
  iterable` lines in stderr are the files' own pre-existing intentional-failure
  simulations.
* Full suite: `808 passed | 3 failed (811)` files, `12892 passed | 4 failed`
  tests — the SAME four failures as rounds 120 and 121, all naming
  `TableManagementScreen.css` / `.tsx` from commit `4347b36d2` (another lane).
  This round adds exactly one test (12891 -> 12892) and touches no CSS.
* `npm run typecheck` clean; `npm run lint` 0 errors (114 pre-existing warnings);
  records index `--check` exit 0.

## Note for the next round

During this round a probe edit was spliced into `PaymentModal.tsx` and reverted
with a mis-sliced cut that destroyed part of the `canComplete` memo. It was
recovered with `git checkout --` and re-verified by grep for `const canComplete =
useMemo` and `if (edcTerminalFailed) return false;` — never by a line count. The
same failure mode as round 101, from the same cause: slicing by a nearby
character offset instead of the exact string.

Untouched surface still open: the retail held-cart RESUME path was the round-121
subject; the retail held-cart BROWSE path (opening the list from a non-empty
cart, and dismissing the reminder popup) has not been executed.

> last audited 18-10-26 by docs-auditor
