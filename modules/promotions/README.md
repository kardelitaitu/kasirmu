# Promotions Module

**Status:** Module crate is a lifecycle stub — the promotion engine itself shipped in `crates/kasirmu-core` (PROMO-3)

## Overview

Discount evaluation is **live**: the engine in `crates/kasirmu-core/src/promotion_engine.rs`
computes Fixed / buy-X-get-Y discounts, and `compute_checkout_promotions` applies
them at checkout (PROMO-3). This module crate is the *eventual* home for that
logic — percentage and fixed-amount discounts, buy-X-get-Y, bundle pricing,
time-windowed campaigns, and coupon codes — but the working engine currently
lives in `kasirmu-core`, not here. It answers one question for the cart: given these
lines, which discounts apply and what do they subtract?

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | `promotions` |
| Crate        | `modules-promotions` |
| Version      | `0.1.0` |
| Dependencies | `["sales"]` — discounts are evaluated against a cart |
| Permissions  | `promotions:view`, `promotions:apply`, `promotions:manage` |
| Feature flag | `promotions-engine` (`crates/kasirmu-core/src/features.rs`) |

## Currently Owns

Nothing yet. `PromotionsModule` registers with the kernel, declares its dependency
on `sales`, and logs its lifecycle transitions. The working promotion logic lives
in `crates/kasirmu-core` — see the `promotion_engine` row in `crates/kasirmu-core/README.md`,
plus `db/promotions.rs` and the checkout application in `db/sales_checkout.rs`.

## Design notes for the promotion

- Discount amounts are `Money` (`i64` minor units). Percentage rules must
  round once, at the line level, and the rounding direction must be explicit —
  never accumulate fractional minor units.
- Rule evaluation should be pure: `(cart, active_rules) -> Vec<DiscountLine>`.
  Keeping it free of database access makes it cheap to property-test against
  the "total never goes negative" invariant.
- Stacking order matters and must be deterministic. Decide it once, encode it
  in the rule type, and test it.

## Promotion Checklist

> The engine already exists in `kasirmu-core` (PROMO-3); these are **migration**
> tasks to lift it into this module, not greenfield work.

- [ ] `models.rs` — `PromotionRule`, `RuleKind`, `DiscountLine`, `Coupon`
- [ ] `repository.rs` — rule storage (namespace: `promotions_*`)
- [ ] `service.rs` — pure evaluation + coupon redemption in a transaction
- [ ] Property tests: total never negative, stacking is order-stable
- [ ] Gate the UI on the `promotions-engine` feature flag

See `modules/README.md` for the full promotion path.

> last audited 31-08-26 by docs-auditor
