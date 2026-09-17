<!-- Audit stamp: 2026-07-26 · rewritten after the previous file was found corrupted (2.8 MB of repeated garbage text); content reconstructed from modules/loyalty/manifest.json, src/{lib,models,repository,service,error}.rs, and platform/startup/src/lib.rs · RE-AUDITED 31-08 (cont) by docs-auditor: lifecycle hooks are stubs (lib.rs:98-118) — corrected the Lifecycle section which claimed on_load "validates dependencies" and on_start "initialises state" (both are "future phases" comments); earn-handler-wired-in-platform and the not-registered-history claims re-confirmed. CAUTION resolved: src/models.rs has since LANDED (LOYALTY-01, 803f6239 — earn_multiplier f64 -> earn_multiplier_millionths i64 fixed-point); re-verified the Models list (LoyaltyTier/Account/Transaction/AccountWithDetails all present) and the "Misplaced: gift cards" section (GiftCard/GiftCardTransaction/GiftCardWithTransactions/IssueGiftCardInput/GiftCardFilter/RedeemGiftCardResult still live here — the gift-card migration has NOT landed, so that section remains accurate); Overview updated to note the fixed-point multiplier -->

# Loyalty Module

**Status:** Active (registered with the kernel; domain logic still in its original locations)

## Overview

The Loyalty module owns the customer loyalty program: tier definitions with
per-tier earning multipliers (fixed-point millionths — `LoyaltyTier::earn_multiplier_millionths: i64`, LOYALTY-01, never an `f64`), point earn and redeem, and member account
management. Points are earned automatically from completed sales via the
`sale.completed` event, and reversed proportionally when a sale is refunded
(LOY-03) — the reversal runs inside the refund transaction via
`reverse_loyalty_on_refund` (`crates/kasirmu-core/src/db/loyalty.rs`), using integer
round-half-up so no float ever touches the points.

## Module Info

| Field        | Value |
|--------------|-------|
| ID           | `loyalty` |
| Crate        | `modules-loyalty` |
| Version      | `1.0.0` |
| Dependencies | `["crm"]` — a loyalty account belongs to a CRM customer |
| Permissions  | `loyalty:view`, `loyalty:earn`, `loyalty:redeem`, `loyalty:manage` |

## Currently Owns

- **Models** — `LoyaltyTier`, `LoyaltyAccount`, `LoyaltyTransaction`,
  `LoyaltyAccountWithDetails` (`src/models.rs`)
- **Repository** — account and transaction queries (`src/repository.rs`)
- **Service** — earn/redeem orchestration (`src/service.rs`)
- **Errors** — `LoyaltyError` (`src/error.rs`)
- **Event handler** — `LoyaltyEarnHandler` is wired on `sale.completed` in
  `platform/startup/src/lib.rs`, not in this crate's `on_load`

## Misplaced: gift cards

`src/models.rs` also defines `GiftCard`, `GiftCardTransaction`,
`GiftCardWithTransactions`, `IssueGiftCardInput`, `GiftCardFilter`, and
`RedeemGiftCardResult`. These are stored-value instruments, not loyalty
points, and belong to `modules/giftcards` — which now exists as a stub for
exactly that reason. Until the migration lands, treat these types as
deprecated in this crate and do not add to them here.

## Lifecycle

Implements `foundation::contracts::Module`. The lifecycle hooks are currently **stubs** — each logs and returns `Ok(())` (lib.rs:98-118); the earn handler is wired in `platform/startup`, not here (see *Currently Owns*):

1. **`on_load`** — logs "validating configuration" (a future phase will check the `crm` dependency and validate tier seed data)
2. **`on_start`** — logs "ready to process loyalty operations" (a future phase will start the point-expiry checker and cache tier definitions)
3. **`on_stop`** — logs "cleaning up"

`dependencies()` returns `&["crm"]`, matching `manifest.json`; a test asserts
the two cannot drift apart.

## Registration

Registered in `platform_startup::init_module_system` alongside every other
vertical. Note that this module was defined but **not registered** for
several releases, so its lifecycle hooks never ran even though
`LoyaltyEarnHandler` was subscribed on the bus. The
`every_module_manifest_is_registered` test in
`platform/startup/src/startup_tests.rs` now prevents that class of bug.

```rust
use modules_loyalty::LoyaltyModule;
use platform_kernel::Kernel;

let mut kernel = Kernel::new();
kernel.register(Box::new(modules_crm::CrmModule::new()))?; // dependency
kernel.register(Box::new(LoyaltyModule::new()))?;
kernel.load_all()?;   // topologically sorts crm before loyalty
kernel.start_all()?;
```

## Manifest

```json
{
  "id": "loyalty",
  "name": "Loyalty",
  "version": "1.0.0",
  "dependencies": ["crm"],
  "permissions": [
    "loyalty:view",
    "loyalty:earn",
    "loyalty:redeem",
    "loyalty:manage"
  ]
}
```

> last audited 31-08-26 by docs-auditor
