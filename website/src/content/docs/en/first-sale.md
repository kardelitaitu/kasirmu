---
title: Your First Sale
description: Ring up a sale end to end — even with no internet.
category: gettingStarted
order: 6
updated: "2026-10-01"
---

## Set up a workspace

Create a workspace for the register: **Retail POS** for retail (product grid,
barcodes, stock) or **Restaurant POS** for table service (menu categories,
tables). The workspace you create decides what the checkout screen looks
like. See [Workspaces](../workspaces/).

## Add categories

Add the category tabs first — Drinks, Food, and so on — so products and menu
items have somewhere to live. Categories are what the cashier sees at the
top of the checkout grid.

## Add products or menu items

- **Retail** — add a product with a name, SKU, price, starting stock, and
  category. A barcode makes scanning fast.
- **Restaurant** — add a menu item with a name, price, and menu category.

Prices are stored as exact integer minor units, so there are never
floating-point rounding surprises. See [Inventory & Warehouses](../inventory/)
for the full catalog workflow.

### Adding many products

Products and menu items are added **one at a time** — there is no bulk or
CSV import today. For a menu of dozens of items, work this pattern to
avoid re-typing:

- **Categories first.** Add all your category tabs (Drinks, Food, Sides, …)
  up front; a product needs one to live in, and the cashier sees them at the
top of the grid.
- **Use variants for price-varied items.** Same name, different size or
  portion — e.g. iced coffee Small/Medium/Large — belongs in one product
  with variants, not three near-duplicate products.
- **Enter the barcode as you add.** Scanning is the fastest way to ring a
  sale later, and typing a code at add-time is cheaper than missing it at
  the counter. Add barcodes as you unbox stock for a fresh line of SKUs.
- **Keep adders in the store app.** Add from the Register app while the day
  is quiet; changes appear on every register after sync.

It is a few minutes of up-front typing, but it is the same input the rest
of the catalog (variants, bundles, stock) builds on.

## The checkout screen

Open the workspace you created. The screen shows the product or menu grid
with your category tabs, a search box, and an SKU or barcode field, with
the cart panel on the side.

## Ring up a sale

Tap a product to add it to the cart — or scan its barcode, or type its SKU.
Adjust the quantity if the customer wants more than one. Line items appear
in the cart with the running total, and can be removed or corrected before
payment. Discounts and PIN-verified price overrides are available at the
cashier's level.

## Take payment

Press **Pay**. Cash and QRIS are available — enter the cash amount
tendered and the change is calculated for you, or show a dynamic QR for
the customer to scan (or your store's static QR). Debit and credit cards,
and e-wallets are coming soon and will appear here as options. Attaching
a customer for loyalty is supported.

## Receipt and record

A receipt preview appears, ready to print. The sale is committed locally and
appears in the day's history instantly, and it counts toward the open
cashier shift — see [Shifts & Reconciliation](../shifts/).

## What happens offline

The sale is queued locally and synced automatically once the device is back
online. Nothing is lost and nothing blocks the counter.

## Next steps

See [Payments & QRIS](../payments/) for the payment methods in depth, or
[Shifts & Reconciliation](../shifts/) to close out the day cleanly.

---

Keep reading · **Previous:** [License Activation](../activation/) · **Next:** [Workspaces](../workspaces/)
