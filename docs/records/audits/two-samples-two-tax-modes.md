# The two sample receipts are two tax MODES, not an inconsistency (round 134)

## The question round 132 left

`receipt-preview-quantity.md` noted in passing that `Test Print` (`:868-897`) uses a DIFFERENT
fixture from the on-screen preview — subtotal `30000`, items `25000` + `5000`, cash `35000`,
against the preview's `35000 / 16000 / 42000`. This round checked whether that is drift.

It is not, and the answer is worth recording because it is easy to read the other way.

## The apparent contradiction

On a screen with **no** tax-inclusive/exclusive toggle (`grep inclusive|exclusive` under
`features/restaurant` returns one unrelated hit in `RestaurantMenu.tsx:543`), the two samples
compute tax opposite ways:

| | Subtotal | Tax | Total |
|---|---|---|---|
| Preview (`receiptLogic.ts:169-184`) | net = gross x 100/(100+rate) | net x rate/100 | net + tax == gross |
| Test Print (`:871-873`) | `30000` | `30000 x rate/100` | `30000 x (1 + rate/100)` |

At 10%: the preview reads `109.000 = 99.091 + 9.909`; the test print reads `33.000 = 30.000 + 3.000`.
Same screen, opposite conventions — looked like a real bug.

## Why it is not

The backend supports **both**, as a configured property of the tax rate:

```ts
// sales_tests.rs:1161  exclusive
// seed_tax_rate(&conn, "VAT 10%", 1000, true, false);
//   tax = 700 * 1000/10000 = 70;  total = 700 + 70
// sales_tests.rs:1284  inclusive
// seed_tax_rate(&conn, "GST 10%", 1000, true, true);
//   total stays 700;  tax 63 is extracted for reporting only
```

Both tests sit beside the assertions that name the behaviour (`compute_tax_exclusive_adds_tax_
to_the_sale_total`, `compute_tax_inclusive_does_not_inflate_sale_total`). The fourth argument to
`seed_tax_rate` is the inclusive flag.

So each sample demonstrates a mode the store can be configured for. Neither is wrong, and the
screen does not need a toggle of its own — the mode lives on the tax rate, in the store's
configuration, and the real receipt simply reads all three figures back from the database
(`completedSale.ts:154-161`) without deriving anything.

## The one thing that IS a gap, and it is small

The two fixtures differ silently, with no comment on either side saying so. A reader comparing
them — as this round did — has to reach the Rust tests to learn that the difference is
meaningful. The cost of not knowing is a plausible-looking correction that would destroy the
coverage: "make the test print match the preview" would delete the exclusive mode from the
preview's own demonstration surface.

Recorded rather than fixed because the fix is a comment, and this round's finding is that the
**behaviour is already correct**. Worth doing at the same time as any future edit to either
fixture — one line above each, naming the mode it demonstrates.

## Method note

The first check produced a false alarm and I nearly recorded it. What settled it was asking what
the product allows rather than comparing the two literals: `grep inclusive|exclusive` in the
restaurant feature found nothing, which looked like *one mode*, which made the two samples
conflict. The mode is configured in **core**, on the tax rate row, so the feature-level grep was
the wrong place to look.

## Verified

| Item | Result |
|---|---|
| Test-print payload self-consistency | items 25000+5000 == subtotal 30000 |
| Backend exclusive convention | `sales_tests.rs:1161-1174`, total = subtotal + tax |
| Backend inclusive convention | `sales_tests.rs:1284-1299`, total unchanged, tax extracted |
| Tax-mode toggle in the restaurant feature | none — it is configured on the tax rate |
| Tests covering the printed payload figures | none (`printSalesReceipt` mocked, payload unasserted) |
| Tree | no source changed this round |