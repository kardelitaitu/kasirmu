---
title: License Activation
description: Get a license key, activate it in the app, and manage your machines.
category: gettingStarted
order: 4
updated: "2026-10-01"
---

<!-- Audit stamp: 2026-10-11 · docs-auditor · status: ACCURATE — 0 findings · First audit stamp on this page. Every truth anchor re-verified against the code: the license-key placeholder shape `OZ-PRO-XXXX-XXXX-XXXX` matches the app's own `auth-license-placeholder` string (shared-ui/locales/shared.ftl:517); the six-digit recovery code and its inbox-proof flow are real (apps/license-server/main.go:332, license_recover_test.go:121 asserts "expected a 6-digit recovery code"); the rotation throttle is real and its window is exactly what the page says — `window: 24 * time.Hour` at apps/license-server/activate.go:73, with the per-tenant limiter documented at :66-78 as "at most one rotation per 24h", and phase A's recovery-code gate at :315-316; the Settings → License & Subscription destination and the website login/account page match the in-app nav (SettingsNavTree.tsx) and the site's own login route. · VERIFIED AND LEFT ALONE: the offline-grace wording ("keeps working offline through the expiry date plus a grace period, then degrades to the free tier") matches the shipped lifecycle — `SubscriptionLifecycleState::Grace => "grace_period"` and the active/grace fail-closed rule at crates/kasirmu-core/src/availability.rs:209. · NOT re-measured: the end-to-end activation handshake against a live license server, and the Paddle checkout itself. · Convention note: this page is a USER-FACING Astro page; the footer below is an internal marker stripped from the built site by `website/src/plugins/rehype-strip-audit-footer.mjs`, so it does not render to a reader. -->

## Get a license key

Paid plans are bought on the website: open the
[pricing page](../../pricing/), choose a plan, and pay through the Paddle
checkout. Payment is register-first — the checkout asks you to sign in with
your email (a one-time code or your password), so the subscription attaches
to your account. The license key and receipt are emailed to you
automatically.

The Free plan needs no key; it starts on first launch. Activation is for
moving to a paid plan.

## Enter the key in the app

Open Settings → License & Subscription, paste your license key (for example
`OZ-PRO-ABCD-EFGH`), and activate. The key is verified against the license
server and a signed subscription is stored on the device.

## Machine binding

Activation binds the license to the device hardware. The same key can be
activated on as many registers as your plan allows, and a tenant admin can
revoke a machine remotely.

## Reinstalling or recovering your license

Moving to a new register, or reinstalling after a wipe? Enter the same
email and license key again — the app re-activates, returns your existing
subscription, and the POS keeps working. Your plan, machines, and data are
untouched.

The app also holds a **license management key** behind the scenes. It is
what lets the app renew your subscription and check license status, and it
is separate from the license key you type in. If the new install doesn't
have it (a wiped disk, a new register), the app asks you to **recover**
it:

1. In the app, choose **Recover license** (or just try to renew — the app
   walks you through it).
2. kasir.mu emails a **6-digit recovery code** to your account address.
3. Enter the code in the app. Your management key is restored and the old
   one stops working.

Two safeguards protect you here:

- The management key is rotated **at most once per 24 hours**. If someone
  (or something) asks again sooner, the request is refused — try again
  later or contact support.
- **Every rotation emails you a notice.** If you get a rotation notice or
  a recovery code you didn't request, someone may be trying to use your
  license key: sign in on the [login page](../../login/), review and
  revoke unknown devices under your account, and
  [contact support](../../support/).

## Your account on the website

Sign in on the website [login page](../../login/) with your email and a
one-time code or your password. The account page shows your license key,
tier, and expiry, and is where you manage your machines.

## Offline and grace

Once activated, the signed payload keeps the app working offline through the
expiry date plus a grace period, then degrades to the free tier. See
[Licensing & Plans](../licensing/).

---

Keep reading · **Previous:** [Setup Wizard](../setup-wizard/) · **Next:** [Your First Sale](../first-sale/)

> last audited 11-10-26 by docs-auditor
