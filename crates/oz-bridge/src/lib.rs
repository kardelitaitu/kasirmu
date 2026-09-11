//! `oz-bridge` — headless command middleware for the OZ-POS desktop and
//! tablet IPC shells (refactor campaign Phase 2).
//!
//! Command bodies move here so they can be compiled, tested and reused
//! without a UI toolkit: this crate depends on no tauri, gtk or webkit type,
//! and nothing in it can construct a window or reach an `AppHandle`.
//!
//! Key types:
//! - [`ctx::BridgeCtx`] — a per-call bundle of borrows from the shell's
//!   `AppState` (global DB, store manager, session map, cache, kernel,
//!   terminal id, resolved media root) plus the shared session/scope/authz
//!   helpers every scoped command needs.
//! - [`error::BridgeError`] — the tauri-free mirror of `AppError`; each shim
//!   converts it back variant-for-variant so the wire shape stays identical.
//!
//! Consumers are the `#[tauri::command]` shims in `apps/desktop-client` and
//! `apps/tablet-client`: a shim builds a `BridgeCtx`, calls the bridge body,
//! and maps the result. Later waves add one module per command domain
//! (catalog: `categories`, `products`, `product_variants`, `products_images`;
//! fiscal: `tax`, `fiscal`, `regional`; money: `currencies`, `exchange_rates`;
//! then crm/auth/staff, inventory, pos/kds/hardware, enterprise/settings),
//! wired in as they are extracted; the Wave-A catalog/fiscal/money modules
//! below are all landed.

pub mod ctx;
pub mod error;

/// Category CRUD command bodies — the first Wave-A slice and the pattern
/// the remaining catalog/fiscal/money modules follow.
pub mod categories;
/// Currency + exchange-rate command bodies (Wave A / S4).
pub mod currency;
/// Fiscalization command bodies (Wave A / S6).
pub mod fiscal;
/// Product-variant command bodies (Wave A / S7).
pub mod product_variants;
/// Product CRUD, barcode lookup and stock command bodies (Wave A / S9).
pub mod products;
/// Product-image ingest command bodies (Wave A / S8).
pub mod products_images;
/// Regional-configuration command bodies (Wave A / S6).
pub mod regional;
/// Tax-rate command bodies (Wave A / S5).
pub mod tax;

/// Login, session and staff-auth command bodies (Wave B). Not yet extracted.
pub mod auth;
/// CRM customer profiles and purchase history (Wave B). Not yet extracted.
pub mod customers;
/// Loyalty program command bodies (Wave B). Not yet extracted.
pub mod loyalty;
/// Picker-ticket minting and verification (Wave B). Not yet extracted.
pub mod picker;
/// Encryption / keyring command bodies (Wave B). Not yet extracted.
pub mod security;
/// Staff and role command bodies (Wave B). Not yet extracted.
pub mod staff;

/// EDC payment-terminal command bodies (Wave D). Not yet extracted.
pub mod edc;
/// Gift-card command bodies (Wave D). Not yet extracted.
pub mod gift_cards;
/// HAL hardware control command bodies (Wave D). Not yet extracted.
pub mod hardware;
/// Inventory CRUD and stock-adjustment command bodies (Wave C). Not yet extracted.
pub mod inventory;
/// Stock-count command bodies (Wave C). Not yet extracted.
pub mod inventory_counts;
/// Kitchen-display command bodies (Wave D). Not yet extracted.
pub mod kds;
/// KDS device-registration command bodies (Wave D). Not yet extracted.
pub mod kds_device;
/// KDS order-routing command bodies (Wave D). Not yet extracted.
pub mod kds_routing;
/// Accounts-payable command bodies (Wave C). Not yet extracted.
pub mod payables;
/// POS cart, checkout and held-bill command bodies (Wave D). Not yet extracted.
pub mod pos;
/// Promotion command bodies (Wave D). Not yet extracted.
pub mod promotions;
/// Purchase-order command bodies (Wave C). Not yet extracted.
pub mod purchasing;
/// Receipt-format template command bodies (Wave D). Not yet extracted.
pub mod receipt_format;
/// Refund command bodies (Wave D). Not yet extracted.
pub mod refunds;
/// Weight-scale command bodies (Wave D). Not yet extracted.
pub mod scale;
/// Cash-shift command bodies (Wave D). Not yet extracted.
pub mod shifts;
/// Inter-location stock-transfer command bodies (Wave C). Not yet extracted.
pub mod stock_transfers;
/// Void command bodies (Wave D). Not yet extracted.
pub mod void;

/// Product-usage and sales analytics command bodies (Wave E). Not yet extracted.
pub mod analytics;
/// Audit-trail read and export command bodies (Wave E). Not yet extracted.
pub mod audit;
/// License status and hardware-fingerprint command bodies (Wave E). Not yet extracted.
pub mod license;
/// Location-profile command bodies (Wave E). Not yet extracted.
pub mod locations;
/// Report generation command bodies (Wave E). Not yet extracted.
pub mod reports;
/// Settings command bodies (Wave E). Not yet extracted.
pub mod settings;
/// Setup-wizard command bodies (Wave E). Not yet extracted.
pub mod setup;
/// Subscription and entitlement command bodies (Wave E). Not yet extracted.
pub mod subscription;
/// Topology command bodies (Wave E). Not yet extracted.
pub mod topology;
/// Workspace and instance command bodies (Wave E). Not yet extracted.
pub mod workspaces;

/// Brand / white-label command bodies (Wave F). Stub: the bodies land with its lane.
pub mod branding;
/// External-browser command bodies (ADR #38 opener surface) (Wave F). Stub: the bodies land with its lane.
pub mod browser;
/// Product-bundle command bodies (Wave F).
pub mod bundles;
/// Data-management command bodies (backup, restore, .ozpkg export / import) (Wave F). Stub: the bodies land with its lane.
pub mod data;
/// Email command bodies (SMTP settings and test-report sending) (Wave F). Stub: the bodies land with its lane.
pub mod email;
/// Feature-flag command bodies (Wave F). Stub: the bodies land with its lane.
pub mod features;
/// Health-check command bodies (Wave F). Stub: the bodies land with its lane.
pub mod health;
/// Sales-history command bodies (list, get, export summaries) (Wave F). Stub: the bodies land with its lane.
pub mod history;
/// Legal-entity command bodies (Wave F).
pub mod legal_entities;
/// Local payment-method command bodies (the market rail surface) (Wave F). Stub: the bodies land with its lane.
pub mod local_payment;
/// Memo command bodies (Wave F).
pub mod memo;
/// Offline-queue command bodies (enqueue, list, sync parked transactions) (Wave F). Stub: the bodies land with its lane.
pub mod offline;
/// Cloud-sync command bodies (configure, push, pull) (Wave F). Stub: the bodies land with its lane.
pub mod sync;
/// Restaurant table and section command bodies (Wave F). Stub: the bodies land with its lane.
pub mod tables;
/// Terminal-management command bodies (Wave F).
pub mod terminals;

#[cfg(test)]
mod testing;
