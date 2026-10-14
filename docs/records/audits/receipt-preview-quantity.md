# The receipt preview says `2x` and prices one (round 132)

## The finding

`RestaurantReceiptsScreen.tsx:1686-1687` renders the sample receipt's middle line:

```tsx
<span className="resto-receipt-item-name">2x Es Teh Manis</span>
<span className="resto-receipt-item-price">{formatPrice(sampleItem2Price)}</span>
```

`sampleItem2Price` is `preview.itemPrices[1]` (`:1344`), and `computeReceiptPreview`
(`receiptLogic.ts:164-189`) defines that as the net of **one** unit:

```ts
const item2Exact = 16000 * taxMultiplier;
const exactSubtotal = item1Exact + item2Exact + item3Exact;   // ONE of each
```

Its doc block says *"The three sample gross prices (35.000 / 16.000 / 42.000)"* — three
prices, summed once each. So the row is labelled `2x` and shows a `1x` figure.

## Measured live

Vite + Playwright, `owner` / PIN 1234, press `1`, sidebar -> Receipts. The preview rendered:

```
1x Nasi Goreng Spesial      31818
2x Es Teh Manis             14545     <- the unit price, labelled 2x
1x Ayam Bakar Madu          38182
Subtotal                    84545
PB1/TAX (10%)                8455
TOTAL                       93000
Cash                       100000
Change                       7000
```

**Every total is correct for three single-unit lines.** Checked against the formula:
`34848.48... -> 31818`? No — `35000*100/110 = 31818.18 -> 31818`, `16000*100/110 = 14545.45 ->
14545`, `42000*100/110 = 38181.82 -> 38182`; sum `84545.45 -> 84545`; tax `8454.54 -> 8455`;
total `93000`; change `7000`. Each figure matches what is on screen.

If the row really meant two units, the figures would be `99091 / 9909 / 109000` instead.
They are not, so the quantity is a **label with no arithmetic behind it**.

## Severity, stated carefully

**Not a money bug.** This is a fixed sample for choosing paper width, font size and margins;
it computes no real sale and `receiptLogic.ts` says "sample" in its own name and doc. Nothing
settles through it.

**It is a usability defect in the instrument a merchant configures from.** A receipt preview
exists to show what the printed slip will look like, and a printed slip shows **line totals** —
`2x ... 29090`, not the unit price. A merchant reading this preview sees an example that the
real receipt will never reproduce, and the one thing the sample gets wrong is the one thing a
multi-quantity line is for.

The fix is small and either direction is defensible:

* make the row `1x Es Teh Manis` — then every figure already on screen is exactly right, and
  the sample simply never exercises `qty > 1`;
* keep `2x` and multiply — `itemPrices[1]` becomes `29090` and `subtotal/tax/total/change`
  recompute to `99091 / 9909 / 109000 / 0`, which changes every number in the preview and the
  `receiptLogic.test.ts` expectations (`:174-178`) with it.

The first is a one-word edit with no arithmetic consequence; the second makes the sample
exercise the quantity path a real receipt has. **Choosing between them is a decision about what
the sample is for** — a plausible-looking layout, or a demonstration of the line arithmetic —
which is why this record states both rather than picking.

## What was verified on the way

The preview's arithmetic is **correct and matches its unit test's own derivation**
(`receiptLogic.test.ts:174-178` walks the same numbers). My first pass at checking it produced a
mismatch because I assumed the catalog prices (`Es Teh 8000`) were the sample's; the fixture is
self-contained at `35000 / 16000 / 42000` and unrelated to the catalog. The record above is the
second pass, against `receiptLogic.ts` itself.

## Also present, not examined

The screen offers `Test Print` and `Print Test Chit` (`:868-897`, payload `subtotal 30000`,
`Nasi Goreng 25000`, `Es Teh 5000`, `payments.cash 35000`) — a DIFFERENT fixture from the
on-screen preview, with its own numbers. Whether the two should agree is a separate question,
not measured here.

## Verified

| Item | Result |
|---|---|
| Live preview figures | `31818 / 14545 / 38182 / 84545 / 8455 / 93000 / 7000` |
| All totals match `computeReceiptPreview` | yes, exactly |
| `2x` label vs arithmetic | label only; `itemPrices[1]` is one unit |
| Sample prices | self-contained `35000 / 16000 / 42000`, not the catalog's |
| Tree | no source changed this round |