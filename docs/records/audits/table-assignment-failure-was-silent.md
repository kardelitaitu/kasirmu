# A completed sale that never claimed its table, reported to nobody

**Round 37 · 2026-10-11 · restaurant POS · table assignment after settlement**

Continuing round 36's list of `console`-only failure reports. The two that mattered were
both `assignTableOrderScoped` failures in `PaymentModal` — one in `settleGatewaySale`
(QRIS/EDC), one in `complete` (cash and the rest).

## Why this is worse than the chit case

The chit failure (round 36) means the kitchen has no paper record. This one means **the
floor plan is wrong**: the sale completed, the table was never marked occupied, and
nothing re-reads it — so `TableManagementScreen` keeps showing the table as *available*
while a party is sitting at it. The next waiter can seat someone there.

Measured, with `assign_table_order_scoped` rejecting and the sale otherwise succeeding:

```
AssertionError: a failed table assignment left the floor plan wrong with nothing shown:
  expected '' to match /table/i
```

Empty toast area. The two catches warned to the console only.

The file's own policy supported the fix: `PaymentModal.tsx:1713-1717` states the rule —
report when the operator must act (*"a missing token means the invoice cannot be issued
and the operator has to know"*), stay silent when it is merely a screen state. A table
that failed to claim is squarely the first.

**Fixed both copies**, with a new localized string naming the action rather than the
mechanism:

```
payment-toast-table-assign-failed = The sale went through, but the table was not marked
                                    occupied - re-assign it on the floor plan
```

## The test that covered half the fix

My first test drove `completeWithKdsOrder()` — the **cash** path — and passed. But the
source has **two** identical copies of this block, in `settleGatewaySale` and `complete`
respectively, and `replace_all` had fixed both. A single passing test would have left the
gateway copy unverified.

I settled it by removing both toasts: **both tests failed with distinct messages**, one
naming the empty toast area and the other `'the gateway path reported nothing'` while
showing the KDS toast present. That is the proof each case drives its own site, rather
than one case covering the file.

A second case now drives the QRIS tender end to end so `settleGatewaySale`'s copy has its
own guard.

## Verification

| Check | Result |
|---|---|
| both table toasts removed (kill-test) | **2** cases -> **red**, distinct messages |
| `PaymentModalSaleFlow.test.tsx` | **65 passed** (2 new) |
| PaymentModal sweep (4 files) | **139 passed**, 1 skipped |
| ESLint / typecheck / `lint:i18n` | **clean** |

## Still open, recorded

Four `console`-only sites remain, re-read individually rather than assumed:

- `PaymentModal:379` (credit settings load) and `:1457` (cash drawer auto-kick) — both
  non-blocking optimisations where silence is defensible; the drawer has a sibling string
  (`pos-toast-drawer-unconfirmed`) if it ever needs one.
- `StockShortfallDialog:272` (no session token) and `:386` (resolution failed) — the first
  is a guard clause mirroring `pos-toast-auth-required` elsewhere, and the second looks
  like the same shape as this round's finding. **Not yet read in context** — recorded as
  the next target rather than claimed.

## Method notes

- **Duplicated blocks need one test each.** `replace_all` is the right fix for identical
  copies and the wrong unit for verification: the green test told me about `complete` and
  said nothing about `settleGatewaySale`. Removing both and reading the two failure
  messages is what separated them.
- **Verify the fix's reach, not just its effect.** The question after a green test is
  "which copy did that exercise?" — and here the answer was "half of them".
- A file's own stated policy (report when the operator must act) is usable evidence, and
  cheaper than inventing a rule: `PaymentModal` had already written this one down for a
  different condition.

> last audited 16-10-26 by docs-auditor
