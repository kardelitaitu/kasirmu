---
title: Payments & QRIS
description: Accept cash and QRIS on every plan — static and dynamic QR, no extra hardware.
category: guides
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · The QRIS bullet said "available on every plan, including Free" and listed dynamic QR first. Verified: only STATIC QR is on every plan; DYNAMIC QR requires the Plus entitlement (SubscriptionTier::supports_qris(), crates/kasirmu-core/src/subscription/tier.rs:217-222; checkout gate at ui/src/features/sales/PaymentModal.tsx:1909). The bullet now separates the two and states the split. · Repaired against branch 0.0.41. -->

## Payment methods

- **Cash** — available today. Enter the amount tendered and the change is
  calculated for you.
- **Card** — available today. Record a debit or credit card payment by hand,
  or — when a card terminal (EDC) is configured for the location — send the
  total to the connected terminal and let the customer tap or insert on it.
  The terminal button appears only when the site's rail list offers one;
  without it, the manual card entry still works.
- **QRIS** — two ways to use it, and they are not on the same plans:
  - **Static QR (manual)** — available on **every plan, including Free**. Show your
    own store QR sticker (stored NMID payload); the cashier records a
    cashier-asserted reference and the server read-back reconciles it for the receipt.
  - **Dynamic QR** — **Plus and above**. The checkout shows a QR code with the
    transaction amount (via Midtrans); the customer scans it, settlement status is
    polled automatically and matched back to the sale. On Free the checkout shows the
    upgrade prompt instead of the QR, because the entitlement gates this rail.
- **Credit** — available today. A **Credit Sale** takes no payment at the
  counter: the sale is recorded against a named customer (required) and
  shows up in the credit list with reminders and an outstanding balance.
- **E-wallet** — coming soon: the checkout has no e-wallet tender yet.

QRIS settles asynchronously — the sale is recorded immediately and
reconciled when the gateway responds, so a gateway timeout never blocks the
counter. The payment modal also supports **split tender** (pay one cart
across several methods) and **multi-currency** payment.

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
