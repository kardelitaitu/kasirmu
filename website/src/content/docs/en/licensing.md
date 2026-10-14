---
title: Licensing & Plans
description: Plans, the free-forever tier, expiry, and the grace period.
category: reference
order: 1
updated: "2026-10-01"
---
<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings (0 major, 0 minor, 0 ambiguous) · Second pass over this page; its 2026-10-08 stamp is merged below as original evidence. Re-derived every number in the plan matrix against the tier implementation rather than inheriting the prior reading: crates/kasirmu-core/src/subscription/tier.rs. VERIFIED ROW BY ROW — Locations (max_locations :85-93: Free/OneTime/Plus 1, Pro 2, Premium 5, Enterprise None=unlimited) matches the matrix exactly, including the Plus column reading 1; Registers/location (max_pos_instances :102-110: 1/2/5/None/None); Warehouses (max_warehouses :123-131: Some(0) below Premium, unlimited Premium+) matches "No|No|No|Unlimited|Unlimited"; Staff (max_staff_users :134-143: 1/5/20/50/None); Sales history (sales_history_days :176-184: 90/365/1825/None/None = 3 months/1 year/5 years/unlimited); grace windows (offline_grace_days :279-287: Free+OneTime 7, Plus 14, Pro 14, Premium 30, Enterprise 60) match the prose exactly. Tier lineup free/plus/pro/premium/enterprise matches the SubscriptionTier enum (:20-30, with OneTime explicitly deprecated for DB back-compat). The QRIS split the 2026-10-08 stamp repaired still holds: supports_qris (:217-222) is false on Free/OneTime, true Plus-up, so "Static only" on Free with the static/dynamic footnote is correct. Nav pointer "Settings → License & Subscription" matches the app's own label (ui/src/features/settings/SettingsNavTree.tsx:54, resolved string settings.ftl:217). The grace-vs-lock narrative is consistent with SubscriptionLifecycleState (crates/kasirmu-core/src/subscription.rs:899-919: Grace = "operational entitlements continue; grace never grants new access", Expired = locked) and the read-only enforcement is real at crates/kasirmu-core/src/db/offline/enqueue.rs:198. The 6-digit recovery code + 24h rotation cooldown are real (apps/license-server/activate.go:56,73). NOT re-measured: a live activation handshake, the Paddle checkout, and whether every row behaves as the table says on a running tenant of each tier — those need a running system, the same limit the 2026-10-08 stamp recorded. No repair was needed; the stamp and footer are refreshed.

STAMP MERGED INTO THIS ONE (2026-10-11) — superseded body kept verbatim as plain text:

Audit stamp: 2026-10-08 · docs-auditor · status: ACCURATE AFTER REPAIR (1 major finding) · The plan matrix's QRIS row claimed "✓ (static + dynamic)" on the Free column. Verified false for the DYNAMIC half: SubscriptionTier::supports_qris() returns false on Free/OneTime (crates/kasirmu-core/src/subscription/tier.rs:217-222) and the POS gates the rail behind the upgrade prompt (ui/src/features/sales/PaymentModal.tsx:1909, QrisTenderPanel.tsx). STATIC QR needs no entitlement and does ride every plan. The row now reads "Static only" on Free with a footnote splitting the two, and subscription-tiers.md §3 (the declared single source of truth) was corrected to record the owner's 2026-09-29 ruling that dynamic QRIS SHOULD be on Free — a decision the app does not yet enforce, pinned by website/src/components/__tests__/pricing-content-invariants.test.ts. The nav pointers on this page were also updated: "Settings → License" is now "License & Subscription" (SettingsNavTree.tsx:54). · Repaired against branch 0.0.41. -->

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
| Scripting (Lua) | No   | No   | No  | ✓       | ✓         |

¹ **Static QR** (your own store QR sticker, reconciled on the receipt) needs no
entitlement and rides every plan. **Dynamic QR** (the checkout generates a
per-transaction QR through Midtrans) is gated behind the Plus plan, matching
`SubscriptionTier::supports_qris()` — on Free the checkout shows the upgrade
prompt instead of the QR.

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

> last audited 11-10-26 by docs-auditor
