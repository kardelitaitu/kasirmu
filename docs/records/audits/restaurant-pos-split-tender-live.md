# Split tender — driven end to end in the browser (2026-10-12)

Completes the payment-method coverage begun in rounds 34-37. Split tender is the
last destination that had only unit coverage; this pass drove it through the real
UI to a printed receipt.

## Split Evenly divides exactly, with the remainder on the LAST row

Four totals x row counts, each read back from the rendered inputs:

| Total | Rows | Amounts | Sum |
|---|---|---|---|
| Rp 45.000 | 3 | 15000, 15000, 15000 | 45000 |
| Rp 87.000 | 4 | 21750, 21750, 21750, 21750 | 87000 |
| Rp 95.000 | 3 | 31666, 31666, **31668** | 95000 |
| Rp 100.000 | 3 | 33333, 33333, **33334** | 100000 |

The two uneven cases are the ones that matter: 95.000/3 = 31,666.67 and
100.000/3 = 33,333.33, and in both the odd rupiah lands on the LAST row so the
rows sum to the total EXACTLY. No rupiah is lost or invented — the classic
even-split bug is absent.

In every case `RemainingRp 0` and Complete armed. Settling produced a receipt
that itemises the split:

```
TOTAL:  Rp 45.000
cash    Rp 15.000
card    Rp 15.000
cash    Rp 15.000
```

## Manual entry recalculates live and refuses over-tender

Two rows against a Rp 45.000 total:

| Step | Remaining | Complete |
|---|---|---|
| initial | Rp 45.000 | disabled |
| row 0 = 20000 | Rp 25.000 | disabled |
| row 1 = 25000 | **Rp 0** | **enabled** |
| row 1 = 999999 | (over) | **disabled** |

So the remainder updates as the cashier types, Complete arms only at exactly
zero, and an over-tender is refused rather than accepted into a negative
remainder.

## Corrections to my own harness (not defects)

- **Cart totals accumulated across iterations of my loop.** I read "ES TEH 8.000"
  and saw a Rp 95.000 total, which looked wrong. The cause was my own harness
  reusing one page: the clear button is ABSENT when the cart is already empty, so
  my `clear` click was a no-op and items piled up. Verified separately that clear
  works: fresh load 0 lines -> add 1 -> clear -> 0 lines, footer gone.
- **The grand total in a split always comes from the cart, not the clicked card.**
  Reading it per-iteration was meaningless.

## QRIS — the last unsettled method, driven to a receipt

Split tender shipped alongside a QRIS pass, completing the payment-method set.

Choosing QRIS renders two actions ("Pay with QR", "Pay with dynamic QR") and
**Complete is correctly disabled** until a reference exists — the settle predicate
requires `qrReference.length > 0`.

Pressing **Pay with QR** opens the customer-facing screen:

```
Scan with your payment app
QRIS
Amount      45000 IDR
Reference   QR-1791776183824-B74AS0
Merchant    kasir.mu Store
Waiting for payment...
[ I received the payment ]
```

with a Close control, and Complete becomes enabled because a reference now exists.
**No auto-settle on timeout**: the sale waits for the merchant to confirm, which
is the right shape for a customer-present QR.

The QR itself was verified to be REAL, not a placeholder box. The SVG is
`viewBox="0 0 45 45"`, 224x224, with a white background path and a black path
encoding hundreds of modules; rendered and inspected, it shows three finder
patterns, an alignment pattern and dense data — a scannable code.
(`scratch-qr.png` was a probe artefact and is not kept.)

Confirming with **"I received the payment"** settled the sale and printed:

```
TOTAL:  Rp 45.000
QRIS    Rp 45.000
```

Zero console or page errors at any step.

## Not covered

- A split row using QRIS or Other (only cash/card rows were exercised).
- Removing a row mid-split, and re-adding it.
- Split + a cart discount or promotion applied at the same time.
- "Pay with dynamic QR" (only the static QR path was driven).
- Whether the merchant's confirmation is the ONLY settle path when a payment
  gateway is configured to auto-confirm — that needs the real bridge.
