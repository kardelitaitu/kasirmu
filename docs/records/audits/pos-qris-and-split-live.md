# QRIS and split-tender driven live — the last two gaps closed (round 119)

## What this closes

`restaurant-pos-cart-footer-live-controls.md` declared three gaps. Round 118 closed the Card
one; this round closed the other two:

| Gap | Status |
|---|---|
| Card/QRIS driven to a receipt | **closed** (round 118: Card, round 119: QRIS) |
| Split-tender arithmetic against a real backend | **closed** — arithmetic verified; backend is dev-mock |

## QRIS to a receipt

Selecting QRIS renders a real payment panel, not a placeholder:

```
Scan with your payment app
  QRIS | Amount 45000 IDR | Reference QR-1791930012342-2B2EET | Merchant kasir.mu Store
  Waiting for payment...            [ I received the payment ]
```

`I received the payment` then `settle-button` completes the sale:

```
kasir.mu Store | Oct 14, 2026 | SALE-mock-sale-1791930097161
Caffe Latte              1  Rp 45.000   Rp 45.000
SUBTOTAL:  Rp 45.000
TOTAL:     Rp 45.000
QRIS       Rp 45.000
Thank you for your purchase!   [ Print Receipt ] [ Issue Tax Invoice ] [ Skip ]
```
The reference is generated, the amount matches, and the method is recorded as QRIS.

## Split-tender arithmetic

Two items — Caffe Latte `Rp 45.000` and Cappuccino `Rp 42.000`, cart total `Rp 87.000`.
The split modal reports:

```
Pay Selected Now   Rp 45.000
Keep on Tab        Rp 42.000
| Pay Selected (Rp 45.000) |
```

**The two parts sum to the cart total exactly**, and the confirm button repeats the figure
it will charge. After confirming, the selected part is paid and the remainder is held —
`Open Bills` shows **1**, so the `Rp 42.000` line became a tab rather than being dropped.
That is the failure a split invites (one part paid, the other lost) and it does not happen.

## A harness finding worth recording

**`locator.click({ force: true })` on the cart-footer buttons is silently swallowed.**
Three attempts to open the split modal via `force: true` produced no dialog and no console
error — it looked exactly like a dead control. Dispatching the DOM click directly
(`el.evaluate((el) => el.click())`) mounts `pos-split-bill-modal` immediately.

So the earlier reading *"the Split Bill button does nothing"* was MY instrument, not the
app. The button is wrapped by a fixed overlay that intercepts real pointer events, and
`force` skips the actionability check without delivering the event where the handler can
see it. **A `force` click that produces no effect is not evidence of an inert control** —
it is evidence that the event did not land. That is the same shape as the 2026-10-12
record's own third correction ("my selector used the wrong class").

## Incidental confirmation

The two-item cart totalled `Rp 87.000` from `Rp 45.000 + Rp 42.000` — the addition is exact
through the integer-minor-unit path.

## Still not verified

**Docker is unavailable** (`docker info` fails), so every pass here is against the dev-mock
handlers, never a real SQLite backend or the Tauri IPC. The split's *persistence* — that the
`Open Bills` row survives a reload against a real database — is untested and not claimed.

## Verified

| Item | Result |
|---|---|
| QRIS | drove to a receipt, reference generated, method recorded |
| Split | parts sum to the total; remainder held as a tab (Open Bills 1) |
| Tree | `ui/src` clean but for another lane's file; scratch script deleted; Vite stopped |