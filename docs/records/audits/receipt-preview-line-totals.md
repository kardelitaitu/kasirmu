# The receipt preview now prices each row as a LINE TOTAL (round 133)

## What decided it

Round 132 left the fix open: relabel the row `1x`, or multiply by the quantity. The tiebreak is
the product's own receipt renderer.

`completedSale.ts:132` and `:221`:

```ts
// the `unit_price.minor_units * qty` arithmetic
minorUnits: line.unit_price.minor_units * line.qty,
totalPrice: { minorUnits: line.unit_price.minor_units * line.qty, currency: ... },
```

and `:12` names it in the module doc. **The real receipt multiplies by quantity**, so its line
price is a LINE TOTAL. The preview is a stand-in for that slip, so `2x Es Teh Manis 14545` was
showing a figure the printer never emits. Multiplying is the fix that makes the sample say what
the slip says.

## The change

`receiptLogic.ts` gains the quantities its labels already asserted:

```ts
const QUANTITIES: [number, number, number] = [1, 2, 1];
const item1Exact = 35000 * taxMultiplier * QUANTITIES[0];
const item2Exact = 16000 * taxMultiplier * QUANTITIES[1];
const item3Exact = 42000 * taxMultiplier * QUANTITIES[2];
const subtotal = Math.round(exactSubtotal);   // no longer a flat 93000 when tax is hidden
```

The preview now reads:

| Row | Before | After |
|---|---|---|
| 1x Nasi Goreng Spesial | 31818 | 31818 |
| **2x Es Teh Manis** | **14545** | **29091** |
| 1x Ayam Bakar Madu | 38182 | 38182 |
| Subtotal | 84545 | 99091 |
| PB1/TAX (10%) | 8455 | 9909 |
| TOTAL | 93000 | 109000 |
| Change from 100.000 | 7000 | **0** |

The change figure moving to `0` is the honest consequence: a Rp 109.000 example cannot yield
change from a Rp 100.000 note, and `Math.max(0, ...)` — documented as "defensive for future
price changes" — is now exercised by the sample itself.

## Test-first, and what the kill-test showed

The guard was written RED: a case asserting `itemPrices[1] === 29091` failed with
*"expected 14545 to be 29091"* and the message *"the row labelled 2x must carry twice the unit
figure, not the unit figure"*.

Kill-tested by restoring `[1, 1, 1]`: **six cases fail**, including four pre-existing ones. The
quantity arithmetic is pinned by the whole block, not just the new case.

## Tests that had to move, and why that is the point

Five expectations in three files asserted the old arithmetic and were updated:

| File | What moved |
|---|---|
| `receiptLogic.test.ts` | the `computeReceiptPreview` block, rewritten to show the derivation |
| `RestaurantReceiptsScreen.test.tsx` | `93000` -> `109000`, `93.000` -> `109.000` |
| `RestaurantPosSidebar.test.tsx` | `84545/8455/93000/7000` -> `99091/9909/109000/0` |

Those failures are the evidence the fix is real: a behaviour that no test depended on would not
have moved any of them.

## Two mistakes of mine

1. **My first new case asserted `29090`.** The implementation rounds `29090.909...` to `29091`;
   I had rounded the unit figure before doubling. The failure text said so precisely.
2. **A line-index splice dropped a closing `});`**, leaving the file 795 lines with an
   "Unexpected end of file". Restored by inserting the closer — and the lesson from round 128
   held: patch by unique text, or replace the whole block, never by guessed offsets.

## Verified

| Gate | Result |
|---|---|
| New case | RED first (`14545` vs `29091`), green after |
| Kill-test | restoring `[1,1,1]` fails 6 cases |
| `receiptLogic` / `RestaurantReceiptsScreen` / `RestaurantPosSidebar` | 26 / 73 pass |
| Full suite | 12,664 passed, 0 failed |
| `tsc` / `eslint` | 0 / 0 |