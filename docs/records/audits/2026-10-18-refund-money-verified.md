# The refund money path verified across three layers — 2026-10-18

<!- - Audit stamp: 2026-10-18 · autonomous goal round 116 · status: NO DEFECT — the refund
     arithmetic verified in the UI, the invariant, and the server enforcement ·
     branch: 0.0.41 · no code change -->

<!- - Scope: round 115's detector ("check the code honours its own comment") applied to the
     round-92 refund fix and the money contract its comment states. Tree verified green at
     813/813 (12,905 passed) going in. -->

## What the comment claims, and the check

`RefundModal.tsx:78-89` states a contract and calls it exhaustive:

```
client sends   round(total_minor * qty / line.qty)
server accepts <= floor(total_minor * qty / line.qty) + 1
because round(x) <= floor(x) + 1 for every x >= 0 ...
Verified exhaustively for total_minor 0..=400, line.qty 1..=12, qty 1..=line.qty
```

**Re-run, not trusted.** Over the stated range AND a much wider one (total 0..=200,000,
line.qty 1..=20), the identity `round(x) <= floor(x) + 1` has **zero violations**.

## Three layers, each verified in its own terms

1. **The client uses the documented formula.** `lineShare` (:120-125) is
   `Math.round((totalMinor * selectedQty) / lineQty)` — exactly what :84 says is sent.
2. **The server enforces the documented ceiling.** `refunds.rs:337-338` computes
   `floor(line_minor * qty / sold_qty) + 1` in `i128` with no float, and :339 compares
   against it.
3. **They agree on the bound.** The reported disagreement runs BOTH ways, up to 6 minor
   units in absolute terms — but the OVER-refund direction (the one the ceiling guards)
   never exceeds `ceil(sold_qty / 2)`, which is the bound the server comment states. **Zero
   violations across 672,000 combinations.**

## A suspected defect that did not survive, recorded

:149 derives `unitPriceMinor = Math.round(lineTotalMinor / qty)` and sends it alongside
`lineTotalMinor`. I measured 25,455 cases where `unit * qty != lineTotal` and suspected a
multiplied rounding loss.

**It is inert.** The server reads `claimed`, which :185 populates from
`line.line_total.minor_units` — the payload's `lineTotalMinor`, the correct share. The
derived unit price is presentational and the refunded amount never comes from it.

**And the behaviour is already documented and tested on the server side**
(`refunds.rs:283-294` explains the range-not-equality choice with the UI's rounding as
reason (b)), with tests at :1637 (above the ceiling refused), :1669 (one minor unit is the
tolerance, not two) and :1702 (accepted, credited and booked unchanged below it).

## What was already covered, so nothing was added

- the display/send identity — `RefundModal.test.tsx:360`, "the displayed total and the
  submitted payload used to disagree";
- the proration helper — `refundAllocationInvariant.test.ts`, which mirrors it and says why
  it is mirrored rather than exported;
- the tolerance boundary — the three backend cases above.

Adding a fourth assertion over the same property would be duplication, so the round ships a
verified negative instead.

## Verification

- **Full suite: 813/813 files, 12,905 passed, 0 failed** — no code changed.
- The arithmetic sweeps are reproducible from the record: the identity over 200,000 totals,
  and the `ceil(sold_qty/2)` bound over the stated range.

> last audited 18-10-26 by autonomous-goal-round-116

