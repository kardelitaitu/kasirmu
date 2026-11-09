# Split tender: an unreadable row was read as zero — and the shortfall blamed the cashier

**Date:** 2026-10-11 · **Round:** 42 (session) · **Status:** FIXED
**Area:** `ui/src/features/sales/payment/` — `useTenderMath.ts`, `SplitTenderRows.tsx`,
`PaymentModal.tsx`, `PaymentModal.css`

## What the cashier saw

A $100.00 cart, split tender, two rows:

| Row | Method | Typed | What the app said |
|---|---|---|---|
| 1 | Cash | `1,234` | *(nothing)* |
| 2 | Card | `100.00` | — |

The Remaining read-out said **`$ 0,00`** and **Complete stayed disabled**. No explanation
appeared anywhere on the modal.

## Why

`parseSplitMinor` (`useTenderMath.ts:183-188`) coerces a refused parse to `0n`:

```ts
const parsed = parseMoneyInput(val, cartCurrency);
if (parsed === null || parsed < 0) return 0n;
```

`1,234` in a USD cart is **deliberately refused**: `domain.ts:430` treats a single comma
group as ambiguous between a thousands separator and a decimal point
(`exp === 0 || multiCommaGroup`), so a decimal-exponent currency never accepts it.

Coercing to `0n` is right for **the sum** — an unreadable row must not contribute to the
total. It is wrong for **the feedback**: it makes an unreadable row indistinguishable from
a blank or genuine-zero one. The arithmetic stays safe (`splitComplete` requires
`remaining === 0n` **and** every row `> 0n`, `:210-218`, so an unreadable row can never
settle a sale), but the display collapses:

- row 2 alone covers `$ 100.00`, so `splitSum = 0n + 10000n` = the total;
- `remaining` therefore reads **0**;
- `splitComplete` still refuses, because row 1 is not `> 0n`.

The cashier is shown a satisfied total beside a dead button, and the natural response is to
retype a *bigger* number into a field that will refuse it again.

This is the **same defect round 41 fixed on the single-tender path** (`tenderedUnparseable`
→ `payment-tender-unreadable`). It was fixed there for cash and left standing for splits:
the two paths compute "did the parser refuse this?" in two different places.

## Fix

`splitTotals` now also returns **which** rows the parser refused
(`useTenderMath.ts:200-207`), positionally aligned with `splits`:

```ts
const unreadableRows = splits.map(
  (s) => s.amountMinor.trim() !== '' && parseMoneyInput(s.amountMinor, cartCurrency) === null,
);
```

The `trim() !== ''` guard is what keeps a **blank** row (the seed state of every new split)
out of the warning — an empty field is not a refusal, and warning about it would fire on a
just-opened modal.

The flag is surfaced through `splitTotals` (no new hook return) into either
`<SplitTenderRows>` call site — `part="toggle"` and `part="section"` — as
`unreadableRows`, and the offending row renders `payment-tender-unreadable`
(`role="alert"`) on itself, styled by `.payment-split-unreadable`.

The same Fluent key carries the message on both tender paths. No new string.

## Evidence

- `T2b` in `PaymentModalSplitTenderState.test.tsx` — **RED with the bug, GREEN with the fix.**
  Kill-tested by gating the branch on `false &&`; it failed with
  `an unreadable split amount was presented as an ordinary value: expected 'Split
  PaymentsSplit:2x3x4x5xSplit Evenly+ Add Split…Remaining$ 0,00' to match /check the
  amount|unreadable/i`.
- `T2c` — the **control**: row 1 `50.00` + row 2 `20.00` on a $100 cart parses fine and
  merely falls short. Asserts the warning does **not** fire and that
  `.payment-split-unreadable` has length 0, so a warning that fires on any shortfall
  cannot pass. Without this, T2b would be satisfied by blaming the cashier for arithmetic.
- `PaymentModalSplitTenderState.test.tsx` 22 passed (was 21).
- Full UI suite: **784 files, 12,435 passed**, 3 skipped, 3 todo.
- `npm run typecheck` clean · `npm run lint` no new errors · `npm run lint:i18n` clean.

## Follow-up, done in the next round: the predicate is now single-sourced

The duplication this section originally flagged is closed. `useTenderMath.ts` now has one
module-private predicate, and both feedback sites call it:

```ts
function isUnparseable(value: string, currency: string): boolean {
  return value.trim() !== '' && parseMoneyInput(value, currency) === null;
}
```

- `tenderedUnparseable` (the cash path) → `isUnparseable(tendered, total.currency)`
- `splitTotals.unreadableRows` (the split path) → `splits.map((s) =>
  isUnparseable(s.amountMinor, cartCurrency))`

The `trim() !== ''` blank-row guard now lives in exactly one place.

**What deliberately did NOT change:** the two *arithmetic* coercions
(`tenderedMinorInCartCurrency`, `parseSplitMinor`) still return `0`/`0n` on a refusal.
Those are a different question — "what value does a refused amount contribute to the sum?"
— and `0n` is the right answer. Only the *reporting* predicate was unified.

**Evidence:** `T2d` in `PaymentModalSplitTenderState.test.tsx` pins the equivalence
behaviourally — the identical string `1,234` on a USD cart must be reported as unreadable in
**both** the cash and split surfaces, with the **same wording** (same predicate, same Fluent
key). Kill-tested by severing the cash path's delegation (`() => false && isUnparseable(...)`);
it failed with `the cash path did not call a refused amount unreadable: expected
'Insufficient amount' to match /check the amount|unreadable/i`.

Split suite 23 passed (was 22) · `PaymentModalSaleFlow` 69 passed · typecheck clean.

> last audited 11-10-26 by docs-auditor
