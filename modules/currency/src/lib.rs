/*
last audited 25-07-26 by RSA-Agent
crate: modules-currency | status: SAFE | lint: CLEAN
findings: Implements Module trait, exchange-rate domain model, repository, and error type.
  Re-exports Currency from foundation and ExchangeRateRow from models. No unsafe code.
next: Migrate currency/exchange-rate callers from oz-core Store to CurrencyRepository.
fixed 2026-07-25 (glm-5.3 review P2 pass): F-022 — repository write paths (create/upsert/delete
  exchange rate) now run inside transactions (INSERT + read-back SELECT share one consistent
  commit; delete wrapped per the never-write-outside-a-transaction rule); all five production
  files' inline test mods moved to sibling *_tests.rs per AGENTS.md. 84 unit tests green.
*/

//! Currency/Exchange Module — ISO-4217 currencies and exchange rates.
//!
//! This module owns the currency and exchange rate management
//! vertical: ISO-4217 currency table, default currency, and
//! exchange rate CRUD for multi-currency transactions.
//!
//! ## Current state
//!
//! The CurrencyModule implements the [`Module`] trait and is registered
//! with the kernel during application startup. The underlying backend
//! and frontend still live in their original locations:
//!
//! - Backend: `modules/currency/src/repository.rs` + `crates/kasirmu-core/src/db/settings.rs` (exchange rate methods)
//! - Commands: `apps/desktop-client/src/commands/currencies.rs` + `apps/desktop-client/src/commands/exchange_rates.rs`
//! - Frontend: `ui/src/features/currency/`
//! - API: `ui/src/api/currency.ts`
//!
//! The exchange-rate model and repository have now been moved into
//! `modules/currency/`. The Tauri command handlers still live in
//! `apps/desktop-client/src/commands/exchange_rates.rs` and will be
//! migrated in a later phase.
//!
//! ## Module manifest
//!
//! See `modules/currency/manifest.json` for the module metadata.

pub mod commands;
pub mod error;
pub mod models;
pub mod repository;

pub use commands::{CreateExchangeRateArgs, CurrencyDto, ExchangeRateDto};
pub use error::CurrencyError;
pub use models::ExchangeRateRow;
pub use repository::CurrencyRepository;

// Re-export key currency/exchange domain type from foundation.
pub use foundation::money::Currency;

use std::fmt::Debug;

use foundation::contracts::{Module, ModuleResult};
use tracing::info;

/// The Currency/Exchange module.
///
/// Implements the [`Module`] trait to participate in the kernel
/// lifecycle. Currently acts as a registration and configuration
/// layer; the actual currency logic lives in the existing codebase.
#[derive(Debug)]
pub struct CurrencyModule;

impl CurrencyModule {
    /// Create a new CurrencyModule instance.
    pub fn new() -> Self {
        Self
    }
}

impl Default for CurrencyModule {
    fn default() -> Self {
        Self::new()
    }
}

impl Module for CurrencyModule {
    fn id(&self) -> &'static str {
        "currency"
    }

    fn on_load(&mut self) -> ModuleResult {
        info!("currency module: on_load — validating configuration");
        // In future phases, this will:
        // 1. Validate exchange rate configuration
        // 2. Register event handlers (e.g., cache latest rates)
        Ok(())
    }

    fn on_start(&mut self) -> ModuleResult {
        info!("currency module: on_start — ready for currency operations");
        // In future phases, this will:
        // 1. Initialize exchange rate cache
        // 2. Register scheduled updates for auto-sync rates
        Ok(())
    }

    fn on_stop(&mut self) -> ModuleResult {
        info!("currency module: on_stop — cleaning up");
        // In future phases, this will:
        // 1. Flush exchange rate cache
        // 2. Persist in-memory state
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
