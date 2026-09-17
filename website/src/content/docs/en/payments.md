---
title: Payments & QRIS
description: Accept cash and QRIS on every plan — static and dynamic QR, no extra hardware.
category: guides
order: 3
updated: "2026-09-17"
---

## Payment methods

- **Cash** — available today. Enter the amount tendered and the change is
  calculated for you.
- **Debit** — coming soon.
- **Credit** — coming soon.
- **QRIS** — available on every plan, including Free. Two ways to use it:
  - **Dynamic QR** — the checkout shows a QR code with the transaction amount
    (via Midtrans); the customer scans it, settlement status is polled
    automatically and matched back to the sale.
  - **Static QR (manual)** — show your own store QR sticker (stored NMID
    payload); the cashier records a cashier-asserted reference and the
    server read-back reconciles it for the receipt.
- **E-wallet** — coming soon.

Debit, credit, and e-wallets follow the same pattern as QRIS: the sale is
recorded immediately and reconciled when the gateway responds, so a gateway
timeout never blocks the counter.

## Open bills

**Open Bill** is a choice in the payment screen that saves the cart *without*
taking payment, under a customer name — for example `John Doe` or a table.
Open bills are listed separately from held orders, are not tied to a shift,
and can be resumed and paid later — a running tab. When a bill is finally
paid, it is removed from the list.

## Hold orders

Cashiers can park the current sale without paying for it. **Hold** in the cart
panel opens a prompt to name the order so it can be found later, and the sale
leaves the screen with a counter showing how many orders are held. Resume any
held order from the held orders list (or press **F4**). Multiple holds can be
open at once, and they survive restarts and app updates.

Parking is for busy counters: ring up a customer, hold the sale, serve the
next one, and resume when the first customer is ready to pay.

## Refunds and voids

A refund requires manager permission and writes a matching stock movement, so
inventory and the audit log stay consistent.
