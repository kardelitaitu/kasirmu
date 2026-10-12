---
title: Setup Wizard
description: What the first-launch provisioning screen asks and when each step matters.
category: gettingStarted
order: 4
updated: "2026-09-30"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major, 1 minor) · Re-audit at HEAD after this page's "When it appears" paragraph was found to describe the wizard's FORMER layout. · MAJOR: the paragraph said "Later sections stay collapsed until the earlier ones are complete, except the shop-type choice, which stays visible so you can always see what you chose." Both halves are false at HEAD. ProvisioningFlow.tsx now renders ONE step at a time — each panel is gated on `{activeStep === N && …}` (:695/:1076/:1153) and the component's own comment (:534-544) records the change: "The card used to show every section at once and COLLAPSE the ones past the current step … It now shows ONE step at a time", because at 1366x768 the earlier card was 1423px and put the submit button below the fold. So a later section is not "collapsed until earlier ones complete" — it is not rendered at all — and the shop-type choice does NOT stay visible; it is inside the Step 2 panel (`{activeStep === 1}`). Rewritten to describe the one-step-at-a-time flow and the progress rail. · MINOR: "the three steps fill a progress rail marked Account, Shop, Owner ('Step N of 3')" — the rail is real (STEPS :199-203, labelId fallbacks account/store/owner; `setup-provision-step-progress` with vars current/total at :669-674), so only the wording that implied all three panels are simultaneously laid out needed the fix. · VERIFIED AND LEFT ALONE, every field the page names: STEPS :199, STORE_TYPES :90 (two entries — `simple-retail` 🛒 and `restaurant` 🍽️), PROVISION_CURRENCY = 'IDR' :147, PROVISION_TIMEZONE = 'Asia/Jakarta' :148, stepAccountDone/stepStoreDone/stepOwnerDone :509-511, the ≥4-digit PIN entered twice (pinTooShort :410, pinMismatch :411, "PIN (at least 4 digits)" :1204, Confirm PIN :1219-1229), and the two Step-1 routes — 'linked' is the DEFAULT (`useState<ProvisioningMode>('linked')` :218) with 'local' the deliberate opt-out, which the page already describes correctly in the right order. · Prior evidence retained verbatim below: field names, step names, gates, and defaults verified
     against ui/src/features/setup/ProvisioningFlow.tsx (STEPS, STORE_TYPES,
     PROVISION_CURRENCY = 'IDR', PROVISION_TIMEZONE = 'Asia/Jakarta',
     stepAccountDone/stepStoreDone/stepOwnerDone). -->

## When it appears

The wizard runs on first launch of a new install. Until it completes, the
app waits on this one screen — the three steps fill a progress rail marked
**Account**, **Shop**, **Owner** ("Step N of 3"), each with a check as it
is done. The wizard shows **one step at a time**: only the step you are on is
on screen, and moving back or forward keeps anything you already typed. The
rail is how you see the whole shape of it — where you are, what is done, and
what is left.

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

> last audited 11-10-26 by docs-auditor