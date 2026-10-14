# A line added during the kitchen send was silently dropped (round 201)

## The defect

`handleSendToKitchen` (`PosScreen.tsx`) computes a DELTA of undispatched lines, sends it, and
then records what was sent:

```ts
await handleDispatchKitchenDelta(deltaLines);
const updatedLines = lines.map((l) => ({ ...l, dispatchedQty: l.qty }));
setLines(updatedLines);   // REPLACES the cart
```

`lines` is this render's CLOSURE, captured before the await. The cart stays editable while the
send is in flight — `sendingToKitchen` drives only a button's processing state and is **never read
as a guard** — so a line added during the await is absent from `updatedLines`, and `setLines`
drops it.

## Measured, not reasoned

A live probe added a third product immediately after pressing Send:

```
BEFORE=[Latte, Cappuccino]
AFTER =[Latte | Sent, Cappuccino | Sent]     LINES=2  BADGES=2
```

**Two lines, not three.** The operator's added item vanished with no message. That is worse than
a wrong badge: a wrong 'Sent' misleads, a lost line loses an order.

## The fix

```ts
const sentBySku = new Map(deltaLines.map((d) => [d.sku, d.qty]));
const updatedLines = lines.map((l) => {
  const sentQty = sentBySku.get(l.sku);
  if (sentQty === undefined) return l;      // untouched, never dropped
  return { ...l, dispatchedQty: (l.dispatchedQty ?? 0) + sentQty };
});
```

Two properties, and both matter:

| Property | Why |
|---|---|
| a line the delta did not carry is returned UNCHANGED | it stays in the cart instead of being dropped |
| the record ADVANCES by the sent amount | a quantity raised during the await is not marked sent |

After the fix the same probe reports `LINES=3 BADGES=2` — the added Es Jeruk Peras survives, and
only the two actually sent carry 'Sent'.

**Kill-tested**: reverting to the closure form fails the regression case.

## A guard fired, and it was right to

`RestaurantOrderTypeFieldConsumers.test.ts` inspects `handleSendToKitchen` for the dine-in rule and
**failed RED** on my change — a change that did not touch that rule at all. The cause: it slices a
**3000-character window** from the handler's head, and my comment pushed `trimmedTable` from ~2700
to **3956**.

The window was fragile before this round — the rule sat within 300 chars of the edge. Widened to
6000 with the reason recorded, so the next comment in that handler does not red the guard.

## Verified

| Item | Result |
|---|---|
| Regression spec | 3 passed, 1 skipped |
| Kill-test | fails correctly |
| `RestaurantOrderTypeFieldConsumers` | 13 passed after the window fix |
| `tsc` / `eslint` | 0 / 0 |
| Full UI suite | 12,707 passed — 0 failed |

## A tablet constraint, measured

The race case is **desktop-only**, and that is a finding rather than a convenience: the race needs
the product grid clickable while the cart is visible. In portrait the cart IS the sheet —
`restaurant-cart-sheet-backdrop` is `position: fixed; inset: 0; z-index: 100` while open, and
dismissing it unmounts the cart panel entirely. There is no portrait layout in which both are
reachable, so the case skips there with the reason in the file.

## The shape worth keeping

**An async handler that replaces state from a closure captured before its await will discard
anything that arrived during it.** The tell is `setX(closure.map(...))` after an `await` in a
handler whose surface stays interactive. Functional updates or delta-derived records are the fix;
a guard on the in-flight flag would also work and is the cheaper change where the surface can be
disabled.