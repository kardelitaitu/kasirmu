# A spec assumed the till stays up after a sale — 2026-10-18

<!-- Audit stamp: 2026-10-18 · autonomous goal round 205 · status: the last failing spec from
     round 204 fixed; it asserted a flow the product does not have, and the real one is
     BETTER. A full-suite run was started to find the remaining state · commit: 0614a1721 -->

<!-- Scope: hunt real defects by running the suite, per round 204 lesson. -->

## Why the failure moved, which was the first clue

Round 204 recorded `refund.spec.ts` as *"a timing budget, not the navigation defect"* and left
it. That was wrong — the grid loads in **8 ms** — and the way it was wrong is instructive.

Asking for the failure line rather than the failure message moved it from `:34` to `:67`:

```
:34  await expect(page.locator(".retail-product-btn"))   <- the FIRST wait, and it passes
:67  await expect(page.locator(".retail-product-btn"))   <- AFTER the sale completes
```

Two identical assertions, and only the second fails. Round 204 only ever saw the first.

## What actually happens after a completed sale

Probed the real flow — add product, pay, tender, settle, wait:

```
PROBE=SALE{"grid":0,"pos":0,"receipts":35}
```

**The receipt preview replaces the POS.** The grid is gone, `.retail-pos` is gone, and 35
`.receipt-*` nodes are rendered. The controls offered are:

```
PROBE=CTRL["Skip","Issue Tax Invoice","Print Receipt"]
```

So the spec comment *"the cart should reset (product grid remains)"* asserted a flow the
product does not have. It is not a regression and not a timing problem: **the till is covered by
the receipt until the operator dismisses it.**

## The product is right and the test was wrong

`Skip` is the dismissal that returns to the till. Measured directly:

```
PROBE=SKIP{"grid":18,"pos":1,"receipts":0}
```

That is a **better** flow than the spec assumed. A receipt that covers the grid and must be
dismissed is the correct behaviour for a till: it makes the printed/skipped decision explicit
instead of letting the cashier start the next sale underneath an unacknowledged receipt.

The spec now presses `Skip` before expecting the grid again, with the measurement recorded in
a comment so the next reader knows the grid loss is intended.

## Same lesson as round 204, one layer down

Round 204 concluded: **a failing test names a SYMPTOM; whether it names the PRODUCT is a
separate and cheaper question.** This round is that rule applied to the failure I had already
dismissed. Round 204 looked at the spec, saw the selector, called it timing, and moved on —
because the FIRST assertion was passing and I never asked which line failed.

Two rounds, two test-only fixes, and in both the product was correct. That is now the third and
fourth E2E failure this session traced to a harness assumption rather than a defect, against one
real defect (the round-177 Escape cascade). **The suite is currently a better source of truth
about what the UI does than about what is broken in it** — which is a reason to keep running it,
and a reason to read a failure as a description of behaviour before reading it as a bug report.

## Verified

| check | result |
|---|---|
| `refund.spec.ts` | **1 passed in 4.4s** (was failing after the 8s wait) |
| grid load time | 8 ms after `selectWorkspace` — timing was never the issue |
| post-sale state | grid 0, pos 0, receipts 35 |
| after `Skip` | grid 18, pos 1, receipts 0 |
| `npx tsc --noEmit` | 0 errors |
| stray probes | none |

## Carried forward

1. **A full desktop-suite run was started this round and is still going**; its result is the
   first whole-suite picture since round 193 and should be read next, with each failure triaged
   by the round-204 rule (product or harness?) before any fix.
2. `refund.spec.ts` is the last spec known to be red at HEAD. If the full run finds no
   others, the E2E gate is green for the first time this session and that is worth recording as
   the baseline.

> last audited 18-10-26 by docs-auditor
