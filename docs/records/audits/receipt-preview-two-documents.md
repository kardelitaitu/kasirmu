# Two preview documents behind one tab strip, now both covered (round 178)

## The target

Round 177's sweep found 94 restaurant/tables testids with no e2e reference. The tables block is
now covered; the receipts block is the next largest — 27 testids, of which E2E touched the
route and the Save gate, never what the operator actually READS.

## The surface

`RestaurantReceiptsScreen` has a `role="tablist"` with two tabs that render **genuinely
different documents**, and the difference is the point:

| Document | Contains |
|---|---|
| customer receipt | store header (logo position dependent), address lines, priced line items, subtotal / tax / total |
| kitchen chit (KOT) | `*** KITCHEN ORDER TICKET ***`, ONE large table or order number, time / staff / pax, items **grouped by course** as `1x Lumpia Goreng`, item notes when enabled — **no prices** |

The assertion that carries the weight is the negative one: **`Total` must not appear on the
chit.** A regression that merged the two branches would produce a ticket the cook reads with
money on it — an operational error, not a cosmetic one.

## Verified live

`ui/e2e/restaurant-receipt-preview-documents.spec.ts` — **4 passed** (2 cases x desktop/tablet):

| Case | Asserts |
|---|---|
| customer preview | `aria-selected=true` on the customer tab, the total is visible, the KOT testid is absent |
| kitchen chit | tab switches, KOT header and `END OF KOT` frame it, all three courses, quantities, item names, the table/order number, and **`Total` has count 0** |

**Kill-tested**: making the kitchen branch unreachable (`{false ? (` at `:1542`) fails **both
projects** on the chit case. Restored, blank diff.

## Two things I got wrong on the way, both from writing rather than reading

1. My first draft of the second case contained a nonsense placeholder — I invented a
   testid (`restaurant-preview-tab-kital`) and then tried to assert on a variable holding it,
   which is a test that could never fail. Caught by re-reading the draft before running it.
2. The kill-test needed `{false ? (`, and finding it needed the actual line number. Reading
   `:1542` first rather than guessing the shape is what made the mutation exact.

## Verified

| Item | Result |
|---|---|
| New spec | **4 passed** |
| Kill-test (kitchen branch dead) | **2 failed**, both projects |
| `RestaurantReceiptsScreen.tsx` | blank diff after the restore |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,693 passed |