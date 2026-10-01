/*
last audited 25-07-26 by RSA-Agent (modules-giftcards slice A: lib deep read)
crate: modules-giftcards | status: SAFE | lint: CLEAN
findings: clean documented STUB correcting misplaced ownership (GiftCard types currently re-exported from modules/loyalty; move here on promotion with one-release re-export); kernel registration + sales dependency; promotion path documents tx-scoped issuance/redemption so a partial redeem can never leave a card debited without a matching sale line; gift-cards feature flag gates capability; sibling tests per convention
next: none (promote GiftCard types when built; the MSL-10 pin-redaction note is obsolete — the field was removed outright on 2026-09-29, see 20261015_gift_cards_drop_pin.sql) | perf: N/A
*/

//! Gift Cards Module — issuance, balances, and redemption.
//!
//! Owns gift-card instruments: issuance, stored balance in `Money` minor
//! units, partial redemption against a sale, and per-card transaction
//! history.
//!
//! Key types: [`GiftCardsModule`] (kernel lifecycle), [`GiftCardsError`].
//!
//! ## Stub status
//!
//! This is a **stub**, and it exists to correct a misplaced ownership: the
//! `GiftCard`, `GiftCardFilter`, `GiftCardTransaction`,
//! `GiftCardWithTransactions`, `IssueGiftCardInput`, and
//! `RedeemGiftCardResult` types are currently re-exported from
//! `modules/loyalty`, which is a different vertical (points and tiers, not
//! stored-value instruments). Those types move here when the stub is
//! promoted. The `gift-cards` feature flag already gates the capability.
//!
//! Promotion path — see `modules/README.md`:
//! 1. Move the `GiftCard*` types from `modules/loyalty/src/models.rs` into
//!    this crate's `models.rs`, re-exporting from loyalty for one release.
//! 2. Move card tables and queries into `repository.rs`.
//! 3. Put issuance and redemption in `service.rs` inside a single
//!    transaction so a partial redeem can never leave a card debited
//!    without a matching sale line.

#![deny(unsafe_code)]

pub mod error;

pub use error::GiftCardsError;

use foundation::contracts::{Module, ModuleId, ModuleResult};
use tracing::info;

/// Stable module id, matching the `id` field in `manifest.json`.
pub const MODULE_ID: ModuleId = "giftcards";

/// The Gift Cards module.
///
/// Implements [`Module`] so the kernel can order it after `sales` during
/// load/start and before it during shutdown.
#[derive(Debug, Default)]
pub struct GiftCardsModule;

impl GiftCardsModule {
    /// Create a new `GiftCardsModule`.
    pub fn new() -> Self {
        Self
    }
}

impl Module for GiftCardsModule {
    fn id(&self) -> ModuleId {
        MODULE_ID
    }

    fn dependencies(&self) -> &'static [ModuleId] {
        // Redemption debits a card as part of a sale's tender.
        &["sales"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("giftcards module: on_load (stub — no handlers registered yet)");
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("giftcards module: on_start (stub)");
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("giftcards module: on_stop (stub)");
        Ok(())
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
