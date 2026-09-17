---
title: Licensing & Plans
description: Plans, the free-forever tier, expiry, and the grace period.
category: reference
order: 1
updated: "2026-08-17"
---

## Plans

kasir.mu has five tiers: `free`, `plus`, `pro`, `premium`, and `enterprise`.
What each plan unlocks — stores, registers, warehouses, QRIS payments, cloud
sync, and scripting — is shown on the [pricing page](../../pricing/).

| Capability      | Free | Plus | Pro | Premium | Enterprise |
| --------------- | ---- | ---- | --- | ------- | ---------- |
| Stores          | 1    | 1    | 2   | 5       | Unlimited |
| Registers / store | 1  | 2    | 5   | Unlimited | Unlimited |
| Warehouses      | 1    | 2    | 3   | Unlimited | Unlimited |
| Staff users     | 1    | 5    | 20  | 50      | Unlimited |
| Sales history   | 3 months | 1 year | 5 years | Unlimited | Unlimited |
| QRIS payments   | ✓ (static + dynamic) | ✓ (static + dynamic) | ✓ | ✓ | ✓ |
| Cloud sync      | No   | ✓    | ✓   | ✓       | ✓         |
| Scripting (Lua) | No   | No   | No  | ✓       | ✓         |

Yearly plans = 2 months free (pay 10 months, get 12).

## The Free plan

The Free plan is **free forever** — one store, one register, one warehouse,
and 3 months of sales history. No license key is needed to start: the Free
plan begins at first launch, and you can upgrade at any point without
reinstalling. After 3 months of history, older transactions are hidden behind
an upgrade prompt — nothing is deleted.

## Buying and activating

Paid plans are bought on the website checkout. Payment is register-first:
the checkout asks you to sign in with your email (a one-time code or your
password) so the subscription attaches to your account. The license key and
receipt arrive by email, and you paste the key into **Settings → License** to
activate. See [License Activation](../activation/) for the full journey, and
the [pricing page](../../pricing/) for current prices.

## Expiry and grace

Subscriptions carry an expiry date and a grace period. When the subscription
expires, the app enters the grace period and keeps working — including
offline — until the grace date. The window depends on your plan: Free and
One-Time 7 days, Plus 14, Pro 14, Premium 30, Enterprise 60.

After the grace window lapses, the register locks to a read-only state: no
new sales, order changes, or sync queueing — viewing, data export, and
sign-out remain available. Administrative features (Analytics, Reports,
Memo, and similar) lock earlier, at the expiry date itself. Nothing is
deleted; the register reopens automatically once connectivity returns and a
valid subscription is verified, and renewing restores your plan.

## Machine limits

Each paid plan allows a number of activated registers, and machines are
hardware-bound — a license key activates specific devices, not anyone with
the key. The tenant admin can revoke a machine remotely, which frees a slot
and signs the device out.

## Where to see it

**Settings → License** shows your tier, status, expiry date, grace period
until, max stores and POS instances, tenant ID, and allowed workspace types.
The website's account page shows the same from your browser, with machine
management. See [License Activation](../activation/).
