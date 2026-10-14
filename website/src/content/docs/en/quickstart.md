---
title: Quickstart
description: From download to a working counter in about 15 minutes.
category: gettingStarted
order: 2
updated: "2026-09-30"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 minor) · First audit of this page. · MINOR: its install line read "the free plan starts on first launch, no account required", which implied the app begins account-free. At HEAD the provisioning wizard DEFAULTS to linking an account — `useState<ProvisioningMode>('linked')` (ProvisioningFlow.tsx:218), with the component's own comment (:213-217) recording why: the free plan attaches to a kasir.mu account, and 'local' is "the deliberate exception rather than the path of least resistance". Running with no account IS supported and is described further down this same page (step 2, "or pick Offline only"), so the claim was not false — but its placement overstated, and a reader who skipped step 2 would expect the wrong first screen. Reworded to state both routes. · VERIFIED AND LEFT ALONE: all nine relative links resolve; the five numbered steps and their timings are presentational, not measured; "setup runs in IDR (Asia/Jakarta)" matches PROVISION_CURRENCY/PROVISION_TIMEZONE (ProvisioningFlow.tsx:147-148); the IDR/retail/restaurant/PIN elements are as the wizard has them; front matter parity with id/quickstart.md is exact (category/order/updated all agree). · NOT reviewed: the Indonesian counterpart's prose as copywriting. -->

## The short path

This page is the impatient route through setup: install, provision, add two
products, ring one sale. Each number links the detailed page if you want the
full explanation instead.

## 1. Install (3 min)

Download and install kasir.mu for Windows. The free plan starts on first
launch; you can run it offline without an account, or link one to use cloud
sync and hardware. Details and system requirements are on
[Installation](../installation/).

## 2. Provision (5 min)

On first launch the setup wizard asks for three things, in one screen with a
progress rail: link an account (or pick **Offline only**), choose whether the
shop is **retail** or **restaurant**, and create the owner login with a PIN.
Setup runs in IDR (Asia/Jakarta); you can change this later in Settings. The
wizard is explained field by field on [Setup Wizard](../setup-wizard/).

## 3. Add a product or two (3 min)

Open the workspace the wizard created for you and add a category
(Hands-on: **Drinks**), then a product with a name, price, and category.
Two products are enough for a test. The full catalog workflow — variants,
stock, barcodes — lives on [Inventory & Warehouses](../inventory/) and
[Your First Sale](../first-sale/).

## 4. Ring one sale (2 min)

Tap a product, press **Pay**, take cash (change is calculated for you) or
show a QRIS code, and print the receipt. That is the whole loop your staff
will repeat all day. See [Your First Sale](../first-sale/) for the
screen-by-screen version.

## 5. After the test sale

- **Sell for real** — activate a license to unlock more locations, QRIS
  payments, and cloud sync: [License Activation](../activation/).
- **Bind your hardware** — receipt printer, cash drawer, scanner:
  [Terminals](../terminals/).
- **Add staff and shifts** — so the day's takings reconcile:
  [Shifts & Reconciliation](../shifts/) and [User Roles](../user-roles/).

---

Keep reading · **Previous:** [Welcome](../welcome/) · **Next:** [Installation](../installation/)

> last audited 11-10-26 by docs-auditor