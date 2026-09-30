/*
last audited 25-07-26 by RSA-Agent (modules-loyalty slice A: lib re-verify)
crate: modules-loyalty | status: SAFE | lint: CLEAN
findings: clean Module registration layer; unwraps test-only; prior 2026-07-22 Buffy stamp replaced per campaign convention
next: none | perf: N/A
*/

//! Loyalty Module — customer loyalty program and point management.
//!
//! This module owns the loyalty vertical: tier definitions, customer
//! loyalty accounts, point earn/redeem transactions, and tier-based
//! earning multipliers.
//!
//! ## Current state
//!
//! The LoyaltyModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! (domain types, database access, Tauri commands) and frontend
//! (screens, API calls, Fluent locale) still live in their
//! original locations:
//!
//! - Domain: `crates/kasirmu-core/src/loyalty.rs`
//! - DB: `crates/kasirmu-core/src/db/loyalty.rs`
//! - Commands: `apps/desktop-tauri/src/commands/` (TBD)
//! - Frontend: `ui/src/features/loyalty/` (LoyaltyManagementScreen)
//! - API: `ui/src/api/` (TBD)
//! - Locale: `shared-ui/locales/` (TBD)
//!
//! In subsequent phases, these files will be physically moved into
//! `modules/loyalty/` as the module system matures.
//!
//! ## Module manifest
//!
//! See `modules/loyalty/manifest.json` for the module metadata.

//! # Re-exports
//!
//! This module re-exports loyalty domain types from `kasirmu-core` so that
//! consumers can access all loyalty-related types through a single crate:
//!
//! ```
//! # use modules_loyalty::{LoyaltyModule, LoyaltyTier, LoyaltyAccount, LoyaltyTransaction, LoyaltyAccountWithDetails};
//! ```

#![deny(unsafe_code)]

pub mod error;
pub mod models;
pub mod repository;
pub mod service;

pub use error::LoyaltyError;

pub use models::{
    GiftCard, GiftCardFilter, GiftCardTransaction, GiftCardWithTransactions, IssueGiftCardInput,
    LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction,
    RedeemGiftCardResult,
};
pub use repository::LoyaltyRepository;
pub use service::LoyaltyService;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Loyalty module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual loyalty logic lives in the existing codebase
/// and will be migrated into this module in upcoming phases.
#[derive(Debug)]
pub struct LoyaltyModule;

impl LoyaltyModule {
    /// Create a new LoyaltyModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for LoyaltyModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for LoyaltyModule {
    fn id(&self) -> &'static str {
        "loyalty"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        // Mirrors `dependencies` in modules/loyalty/manifest.json: a loyalty
        // account belongs to a CRM customer, and loyalty redeems gift cards
        // whose table the `giftcards` module owns (P3.3 makes that declared).
        &["crm", "giftcards"]
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("loyalty module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Register event handlers (e.g., sale.completed → earn_points)
        // 2. Validate that loyalty tiers seed data exists
        // 3. Check that the CRM module is available
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("loyalty module: on_start — ready to process loyalty operations");
        // In future phases, this will:
        // 1. Start background point-expiry checker
        // 2. Cache tier definitions for fast lookup
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("loyalty module: on_stop — cleaning up");
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
