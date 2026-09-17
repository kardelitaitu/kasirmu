---
title: Your First Sale
description: Ring up a sale end to end — even with no internet.
category: gettingStarted
order: 3
updated: "2026-08-16"
---

## Set up a workspace

Create a workspace for the register: **Store POS** for retail (product grid,
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
