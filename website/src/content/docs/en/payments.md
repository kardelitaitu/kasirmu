---
title: Payments & QRIS
description: Accept cash and QRIS on every plan — static and dynamic QR, no extra hardware.
category: guides
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (0 major, 2 minor) · Second pass; the 2026-10-08 stamp is merged below as original evidence. The QRIS static/dynamic split it repaired is re-verified: supports_qris() is false on Free/OneTime and true Plus-up (crates/kasirmu-core/src/subscription/tier.rs:217-222), so the bullet is correct as it stands. TWO MINORS REPAIRED, both omissions of SCOPE rather than wrong facts: (1) **Open bills were presented unqualified.** The backend refuses bill_type 'open_bill' outside restaurant-pos, so the tender is gated by BOTH the workspace capability and the merchant rail flag (ui/src/features/sales/PaymentModal.tsx:139-154, :316-330 — isRestaurantPos is a capability, coreRailWithheld is a preference, and the file says both must hold). A store-pos cashier reading the page expected a tender their checkout does not offer. The section now states the Restaurant POS scope and names the two gates. (2) **"or press F4" was written without a workspace.** F4 is bound in RetailPosScreen (ui/src/features/retail/RetailPosScreen.tsx:1519), declared as action 'hold-resume' in retailShortcuts.ts:42 — a RETAIL-pos function-bar binding, not a global one; the restaurant POS has its own function bar. Qualified, with the held-orders list named as the portable route. VERIFIED AND LEFT ALONE, including two claims that LOOK false and are not: (a) "**E-wallet — coming soon: the checkout has no e-wallet tender yet**" is CORRECT — the tender strip's union is TenderMethod = 'cash' | 'card' | 'qris' | 'credit' (ui/src/features/sales/useLocalPaymentRails.ts:119), and TENDER_RAILS (:142-147) has exactly those four; 'ewallet' exists only in the wider PaymentMethod message-id map (PaymentModal.tsx:81), which is why a grep for it looks like an offered tender. (b) The EDC card button "appears only when the site's rail list offers one" is real — edcOffered is a separate rail read (PaymentModal.tsx:138). Also verified: static QR reads a stored NMID payload (readStaticQrPayload, ui/src/api/local-payment.ts:81; the operator's entry field is RestaurantPaymentsScreen's Merchant NMID input), split tender and multi-currency are real, and QRIS settles asynchronously. NOT re-measured: a live QRIS settlement cycle, the Midtrans gateway round-trip, a card terminal tap, and the split-tender UI on a running register.

STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim as plain text:

Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · The QRIS bullet said "available on every plan, including Free" and listed dynamic QR first. Verified: only STATIC QR is on every plan; DYNAMIC QR requires the Plus entitlement (SubscriptionTier::supports_qris(), crates/kasirmu-core/src/subscription/tier.rs:217-222; checkout gate at ui/src/features/sales/PaymentModal.tsx:1909). The bullet now separates the two and states the split. · Repaired against branch 0.0.41. -->

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

**Open bills are a Restaurant POS feature.** The backend refuses an open bill
outside that workspace, so the tender is only offered in **Restaurant POS**
and only while the `open_bill` rail is enabled for the site
(`ui/src/features/sales/PaymentModal.tsx` — the capability and the merchant
rail flag are two separate gates and both must hold).

## Hold orders

Cashiers can park the current sale without paying for it. **Hold** in the cart
panel opens a prompt to name the order so it can be found later, and the sale
leaves the screen with a counter showing how many orders are held. Resume any
held order from the held orders list. In **Retail POS** the function bar also
binds **F4** to hold/resume (`ui/src/features/retail/retailShortcuts.ts` —
action `hold-resume`); the restaurant POS has its own house style, so treat
the list as the portable route. Multiple holds can be open at once, and they
survive restarts and app updates.

Parking is for busy counters: ring up a customer, hold the sale, serve the
next one, and resume when the first customer is ready to pay.

## Refunds and voids

A refund requires manager permission and writes a matching stock movement, so
inventory and the audit log stay consistent.

> last audited 11-10-26 by docs-auditor
