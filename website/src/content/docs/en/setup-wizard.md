---
title: Setup Wizard
description: What the first-launch provisioning screen asks and when each step matters.
category: gettingStarted
order: 4
updated: "2026-09-30"
---

<!-- Audit stamp 30-09-26: field names, step names, gates, and defaults verified
     against ui/src/features/setup/ProvisioningFlow.tsx (STEPS, STORE_TYPES,
     PROVISION_CURRENCY = 'IDR', PROVISION_TIMEZONE = 'Asia/Jakarta',
     stepAccountDone/stepStoreDone/stepOwnerDone). -->

## When it appears

The wizard runs on first launch of a new install. Until it completes, the
app waits on this one screen — the three steps fill a progress rail marked
**Account**, **Shop**, **Owner** ("Step N of 3"), each with a check as it
is done. Later sections stay collapsed until the earlier ones are complete,
except the shop-type choice, which stays visible so you can always see what
you chose.

## Step 1 — Account

Two ways to start:

- **Link an account** — email sign-up/sign-in on this device. Internet is
  required *only for this step*: creating or linking an account cannot be
  done offline.
- **Offline only** — set up without an account. The terminal provisions
  locally with no tenant, and you can link an account later from Settings.

## Step 2 — Shop

Pick the kind of shop; it decides which workspace is created first and how
the checkout screen is built:

| Choice | Built for | First workspace |
|---|---|---|
| 🛒 **Shop** (simple retail) | product grid, barcodes, stock | Retail POS |
| 🍽️ **Restaurant or cafe** | menu categories and tables | Restaurant POS |

Then give the shop a name. The name becomes the location that workspaces
and devices bind to — see [Locations & Topology](../location/).

## Step 3 — Owner

Create the owner login: your name, a login username, and a PIN of at least
4 digits (entered twice). The owner role has every permission from the
start — see [User Roles](../user-roles/) for the other roles you can add
later.

## Locale defaults

Provisioning fixes **IDR** and the **Asia/Jakarta** timezone; the wizard
says so and notes they can be changed later in Settings. When an account is
linked through the cloud, the same currency and timezone are sent.

## What happens after

The wizard opens the workspace it created (Retail POS or Restaurant POS
from your shop-type choice). From there the recommended path is adding a
category and a couple of products, then a test sale —
[Your First Sale](../first-sale/) picks up exactly there, and is part of the
[Quickstart](../quickstart/) route.

---

Keep reading · **Previous:** [Installation](../installation/) · **Next:** [License Activation](../activation/)

> last audited 30-09-26 by docs-auditor
