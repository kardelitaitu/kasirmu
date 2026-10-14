# The POS-to-KDS chain in the dev mock: a sale pushes the ticket, not a dispatch (round 138)

## What round 137 could not close

`restaurant-kitchen-dispatch-live.md` left one item unverified: whether a Send-to-Kitchen
dispatch from the POS puts a ticket on the KDS board. It named navigating via the workspace
picker as the method. This round ran it and has an answer.

## The chain, measured in one browser context

Route found: the app restores the active workspace across a reload and does not return to the
picker, so the working navigation is the app's own hash route — `window.location.hash =
'#/kds'`. With that:

| Step | Evidence |
|---|---|
| KDS board before | `#101 #104 #107 #110 #102 #105 #108 #103 #106 #109` — ten seeded tickets |
| POS: add an item, set table `T77`, Send to Kitchen | `KITCHEN_BTN=1`, `LINE_SENT=true` |
| KDS board after | **the same ten ids** — no `#111` |
| `T77` on the board | **`false`** |

So a dispatch does **not** create a KDS ticket in the dev mock.

## Why that is the mock's design, not a defect

`ui/src/dev-mock/handlers/kds.ts:598`:

```ts
'create_kds_order_from_sale_scoped': () => saleDerivedKdsOrders(),
```

That handler only **reads** `mockKdsOrders` filtered by an `kds-order-e2e-*` id prefix. It
creates nothing, despite the name. The actual creator is `pushKdsOrderFromCart`, which lives in
`handlers/sales.ts` and is called from the three sale-completion paths (`:523`, `:571`, `:600`)
— each with the same comment:

```ts
// Push a KDS mock order so POS -> KDS E2E flow works.
pushKdsOrderFromCart(cartState.lines, 'store-1');
```

So the mock models the ticket as a **consequence of a completed sale**, which matches
`ui/e2e/e2e-pos-to-kds.spec.ts`'s subject. A dispatch is not a sale, so no ticket appears. The
mock says its own intent in that comment.

## The sale leg was attempted and did not complete

To close the chain the other way — complete a sale, then look for its ticket — I opened the
payment modal, chose cash and clicked `settle-button`. `SALE_DONE=false`: the receipt never
rendered and the board still showed the same ten ids. A bare cart with no sufficient tender
leaves Complete disabled, and no amount of retrying the click changes that.

**So the mock-supported leg is also unverified by me.** What IS established is the mechanism
that explains round 137's negative: the ticket comes from `pushKdsOrderFromCart` on
`complete_sale`, and the dispatch command is a reader. That is a static fact, not an inference.

## A false positive worth recording, for the second time

`HAS_LATTE=true` appeared in **every** run above, including the ones with no sale and no
dispatch. The board carries seeded tickets (`#101`, `#107`) whose lines include
`Nasi Goreng Spesial` and drinks, so a substring search for a common menu item always matches.

Round 137 recorded the same trap with `HAS_T5`. The lesson generalises: **on a board seeded
with realistic data, matching by product name proves nothing.** Only the ticket ID set is
discriminating, and the count `#101..#110` held constant through every attempt.

## Verified

| Item | Result |
|---|---|
| KDS ticket ids before and after a dispatch | identical, `#101`-#`110` |
| `T77` on the board after dispatching to `T77` | absent |
| `create_kds_order_from_sale_scoped` | a reader; `kds.ts:598` |
| The creator | `pushKdsOrderFromCart`, `sales.ts:523/571/600` on sale completion |
| Sale leg | attempted, `SALE_DONE=false`, unverified |
| Tree | clean but for another lane's file; scratch script deleted |