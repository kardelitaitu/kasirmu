//! Re-exports every `#[tauri::command]` module.
//!
//! Adding a new feature module:
//! 1. Create `commands/<feature>.rs` with at least one `#[tauri::command]` async fn.
//! 2. Add `pub mod <feature>;` here.
//! 3. Add the command(s) to the `invoke_handler!` macro in `lib.rs`.

/// Analytics commands (analytics:view — owner/admin/manager only).
pub mod analytics;
/// Audit log commands.
pub mod audit;
/// Authentication commands.
pub mod auth;
/// Authorization commands.
pub mod authz;
/// Store branding commands.
pub mod branding;
/// External-browser commands (ADR #38).
pub mod browser;
/// Product bundle commands.
pub mod bundles;
/// Category CRUD commands.
pub mod categories;
/// Currency management commands.
pub mod currencies;
/// Customer CRUD commands.
pub mod customers;
/// Exchange-rate commands.
pub mod exchange_rates;
/// Feature-flag commands.
pub mod features;
/// Fiscal scheme + statutory numbering commands.
pub mod fiscal;
/// Gift-card management commands.
pub mod gift_cards;
/// Hardware / peripheral commands.
pub mod hardware;
/// Health-check commands.
pub mod health;
/// Sales-history commands.
pub mod history;
/// Inventory-count commands.
pub mod inventory_counts;
/// KDS commands.
pub mod kds;
/// Organization/Tenant Legal Entity commands.
pub mod legal_entities;
/// Local payment method commands (slice 6).
pub mod local_payment;
/// Loyalty / rewards commands.
pub mod loyalty;
/// Memo read/consumer commands (list/acknowledge).
pub mod memo;
/// Offline-mode commands.
pub mod offline;
/// Pre-session picker-ticket HMAC (audit-open-findings residual, desktop parity).
pub mod picker_ticket;
/// POS flow commands.
pub mod pos;
/// Product-variant commands.
pub mod product_variants;
/// Product CRUD commands.
pub mod products;
/// Promotion commands.
pub mod promotions;
/// Purchasing / supplier / purchase-order commands.
pub mod purchasing;
/// QRIS Auto dynamic charge & settlement-poll IPC (cloud Midtrans).
pub mod qris_auto;
/// Receipt format commands (receipt-format axis).
pub mod receipt_format;
/// Refund commands.
pub mod refunds;
/// Regional-configuration read commands (settings:read).
pub mod regional;
#[cfg(test)]
#[path = "registration_gate_tests.rs"]
mod registration_gate_tests;
/// Reporting commands.
pub mod reports;
/// Weight-scale commands.
pub mod scale;
/// Settings CRUD commands.
pub mod settings;
/// Initial-setup commands.
pub mod setup;
/// Staff / employee commands.
pub mod staff;
/// Stock transfer commands.
pub mod stock_transfers;
/// Subscription capability commands (C2.2 tier gates).
pub mod subscription;
/// Sync commands.
pub mod sync;
/// Table management commands.
pub mod tables;
/// Tax-rate / tax-rule commands.
pub mod tax;
/// Payment-terminal commands.
pub mod terminals;
/// Void / cancel commands.
pub mod void;
/// Workspace listing + boot-resolution commands (audit-open-findings residual, desktop parity).
pub mod workspaces;
