---
title: Licensing & Plans
description: Plans, the free-forever tier, expiry, and the grace period.
category: reference
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · The plan matrix's QRIS row claimed "✓ (static + dynamic)" on the Free column. Verified false for the DYNAMIC half: SubscriptionTier::supports_qris() returns false on Free/OneTime (crates/kasirmu-core/src/subscription/tier.rs:217-222) and the POS gates the rail behind the upgrade prompt (ui/src/features/sales/PaymentModal.tsx:1909, QrisTenderPanel.tsx). STATIC QR needs no entitlement and does ride every plan. The row now reads "Static only" on Free with a footnote splitting the two, and subscription-tiers.md §3 (the declared single source of truth) was corrected to record the owner's 2026-09-29 ruling that dynamic QRIS SHOULD be on Free — a decision the app does not yet enforce, pinned by website/src/components/__tests__/pricing-content-invariants.test.ts. The nav pointers on this page were also updated: "Settings → License" is now "License & Subscription" (SettingsNavTree.tsx:54). · Repaired against branch 0.0.41. -->

## Plans

kasir.mu has five tiers: `free`, `plus`, `pro`, `premium`, and `enterprise`.
What each plan unlocks — locations, registers, warehouses, QRIS payments, cloud
sync, and scripting — is shown on the [pricing page](../../pricing/).

| Capability      | Free | Plus | Pro | Premium | Enterprise |
| --------------- | ---- | ---- | --- | ------- | ---------- |
| Locations          | 1    | 1    | 2   | 5       | Unlimited |
| Registers / location | 1  | 2    | 5   | Unlimited | Unlimited |
| Warehouses      | No   | No   | No  | Unlimited | Unlimited |
| Staff users     | 1    | 5    | 20  | 50      | Unlimited |
| Sales history   | 3 months | 1 year | 5 years | Unlimited | Unlimited |
| QRIS payments   | Static only ¹ | ✓ (static + dynamic) | ✓ | ✓ | ✓ |
| Cloud sync      | No   | ✓    | ✓   | ✓       | ✓         |

¹ **Static QR** (your own store QR sticker, reconciled on the receipt) needs no
entitlement and rides every plan. **Dynamic QR** (the checkout generates a
per-transaction QR through Midtrans) is gated behind the Plus plan, matching
`SubscriptionTier::supports_qris()` — on Free the checkout shows the upgrade
prompt instead of the QR.
| Scripting (Lua) | No   | No   | No  | ✓       | ✓         |

Yearly plans = 2 months free (pay 10 months, get 12).

## The Free plan

The Free plan is **free forever** — one location, one register, and 3 months of
sales history. No license key is needed to start: the Free
plan begins at first launch, and you can upgrade at any point without
reinstalling. After 3 months of history, older transactions are hidden behind
an upgrade prompt — nothing is deleted.

## Buying and activating

Paid plans are bought on the website checkout. Payment is register-first:
the checkout asks you to sign in with your email (a one-time code or your
password) so the subscription attaches to your account. The license key and
receipt arrive by email, and you paste the key into **Settings → License & Subscription** to
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

**Settings → License & Subscription** shows your tier, status, expiry date, grace period
until, max locations and POS instances, tenant ID, and allowed workspace types.
The website's account page shows the same from your browser, with machine
management. See [License Activation](../activation/).

> last audited 08-10-26 by docs-auditor
