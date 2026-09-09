//! Re-exports every `#[tauri::command]` module.
//!
//! Adding a new feature module:
//! 1. Create `commands/<feature>.rs` with at least one `#[tauri::command]` async fn.
//! 2. Add `pub mod <feature>;` here.
//! 3. Add the command(s) to the `invoke_handler!` macro in `lib.rs`.

/// Analytics commands (analytics:view — owner/admin/manager only).
pub mod analytics;
/// Audit log commands (view, filter, export).
pub mod audit;
/// Authentication commands (login, logout, refresh).
pub mod auth;
/// Authorization commands (roles, permissions).
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
/// Data export / import commands.
pub mod data;
/// EDC card-present payment terminal commands.
pub mod edc;
/// Email report commands.
pub mod email;
/// Exchange-rate commands.
pub mod exchange_rates;
/// Feature-flag commands.
pub mod features;
/// Gift-card management commands.
pub mod gift_cards;
/// Hardware / peripheral commands.
pub mod hardware;
/// Health-check commands.
pub mod health;
/// Sales-history commands.
pub mod history;
/// Multi-location inventory, shifts, transactions, and thresholds commands.
pub mod inventory;
/// Inventory-count commands.
pub mod inventory_counts;
/// Kitchen Display System commands.
pub mod kds;
/// KDS device management commands (register, list, status, ack).
pub mod kds_device;
/// KDS order routing resolution.
pub mod kds_routing;
/// Organization/Tenant Legal Entity commands.
pub mod legal_entities;
/// License commands.
pub mod license;
/// Local REST API server commands (loopback `oz-api` embed).
pub mod local_api;
/// Local payment method commands (slice 6).
pub mod local_payment;
/// Location-profile commands.
pub mod locations;
/// Loyalty / rewards commands.
pub mod loyalty;
/// Memo lifecycle commands (create/publish/list/acknowledge).
pub mod memo;
/// Offline-mode commands.
pub mod offline;
/// Accounts Payable (Hutang) commands — desktop-only authoring.
pub mod payables;
/// Pre-session picker-ticket signing / verification.
pub mod picker_ticket;
/// Plugin management commands.
pub mod plugins;
/// Point-of-sale flow commands.
pub mod pos;
/// Product-variant commands.
pub mod product_variants;
/// Product CRUD commands.
pub mod products;
/// Product/Menu image ingest commands (spec 0046b).
pub mod products_images;
/// Promotion commands.
pub mod promotions;
/// Purchasing / purchase-order commands.
pub mod purchasing;
/// Receipt format commands (receipt-format axis).
pub mod receipt_format;
/// Refund commands.
pub mod refunds;
/// Regional-configuration read commands (settings:read).
pub mod regional;
/// Reporting commands.
pub mod reports;
/// Weight-scale commands.
pub mod scale;
/// Security / key-rotation commands.
pub mod security;
/// Settings CRUD commands.
pub mod settings;
/// Initial-setup commands.
pub mod setup;
/// Shift management commands.
pub mod shifts;
/// Staff / employee commands.
pub mod staff;
/// Stock-transfer commands.
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
/// Node-topology persistence commands.
pub mod topology;
/// Void / cancel commands.
pub mod void;
/// Workspace / register layout commands.
pub mod workspaces;
