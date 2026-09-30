---
title: Welcome to kasir.mu
description: What kasir.mu is and how this documentation is organized.
category: gettingStarted
order: 1
updated: "2026-08-30"
---

## What is kasir.mu?

kasir.mu is an offline-first point-of-sale platform for cafes, restaurants, and
retail. Every feature keeps working with no internet connection — sales,
shifts, stock, and settings all write to the local database first, then sync
to the cloud the moment the connection returns.

It ships for Windows today, with macOS, Linux, Android, and iOS on the way,
and speaks both English and Bahasa Indonesia out of the box.

## What makes it different

- **Offline-first** — a lost connection never blocks a transaction. Keep
  working with zero connectivity, and everything catches up when you're back
  online.
- **QRIS-native** — accept Indonesian QR payments natively, with cards and
  e-wallets on the way, tuned for the Indonesian market.
- **Workspaces** — one app, many roles: checkout for retail or table
  service, a kitchen display, inventory, and admin in the same install.
- **Cloud sync** — every register sees the same products, prices, and stock,
  with the tenant isolated per account.

## What you can do

- **Sell** — ring up retail or table-service orders, take cash and QRIS
  payments, and split the day into cashier shifts with a full audit trail.
- **Track stock** — inventory with warehouses, transfers, counts, and
  purchase orders.
- **Run the team** — staff roles from owner to auditor, shift
  reconciliation, and an audit log.
- **Decide with data** — a daily sales dashboard, sales reports, menu
  engineering, and analytics.
- **Grow** — loyalty, gift cards, promotions, self-service kiosks, and
  multi-store topology.

## Hardware & devices

kasir.mu works with the hardware a counter already has: barcode scanners,
receipt printers, cash drawers, customer displays, and NFC readers. Devices
are managed as terminals — register them, bind them to a location and a
workspace, and tune features per device. See [Terminals](../terminals/) and
[Locations & Topology](../location/).

## Plans & pricing

kasir.mu is **free forever** to get started — one location, one register, and
3 months of sales history. Paid plans add more locations and registers, plus QRIS
payments, cloud sync, and automation; warehouse workspaces come with Premium.
See [Licensing & Plans](../licensing/).

## Pick your starting point

The setup wizard and workspace picker are built around a handful of shop
shapes. Pick yours and the docs line up with the screens you will actually
see:

- **A retail shop or warung** — product grid, barcodes, stock. Provision
  as 🛒 **Shop**; work in **Retail POS**. Start with
  [Your First Sale](../first-sale/) and [Inventory & Warehouses](../inventory/).
- **A restaurant or cafe** — menu categories, tables, kitchen.
  Provision as 🍽️ **Restaurant or cafe**; work in **Restaurant POS**, and
  add a **Kitchen Display** when cooks need a ticket queue. Start with
  [Your First Sale](../first-sale/) and [Workspaces](../workspaces/).
- **A warehouse or back office** — inward/outward stock and reports. The
  **Warehouse** workspace covers products, stock levels, bundles, and
  inventory reports; managers work from **Admin**. Start with
  [Inventory & Warehouses](../inventory/).

Not sure? The [Quickstart](../quickstart/) path works for every shape —
it provisions one of the above, adds a test product, and rings a test sale
regardless of which you picked.

## Where to start

In a hurry? [Quickstart](../quickstart/) takes you from download to a
working counter in about 15 minutes.

1. [Install kasir.mu](../installation/) on Windows — the free plan starts on
   first launch, no account required. Other platforms are coming soon.
2. Run the [Setup Wizard](../setup-wizard/) — account (or offline only),
   shop type, owner login.
3. [Activate a license key](../activation/) when you're ready to unlock more
   locations, QRIS payments, and cloud sync.
4. [Ring up your first sale](../first-sale/) from the workspace you need —
   [Workspaces](../workspaces/) covers Retail POS, Restaurant POS, Kitchen
   Display, and Warehouse — even without internet.

Going live today? The [First Day Live](../first-day/) checklist covers
hardware verification, an opening shift, and handing the counter to staff.

## Reinstalling or locked out?

New register, wiped disk, or the app says your license needs a **recovery
code**? That's normal and safe: re-activating with your email + license key
keeps the POS working, and a 6-digit code from your email restores license
management. Every key rotation also emails you a notice, at most once per
24 hours. See [Reinstalling or recovering your license](../activation/#reinstalling-or-recovering-your-license).

## How the docs are organized

- **Getting Started** — install, activate, ring up your first sale, and pick
  a workspace to work in.
- **Guides** — day-to-day workflows: payments, shifts, inventory,
  locations, terminals, and how offline mode and cloud sync keep you running.
- **Reference** — licensing, plans, and settings.

## Getting help

Stuck? The [support page](../../support/) reaches the team, and the rest of
these docs cover activation, payments, sync, and more.
