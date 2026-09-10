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
//! wired in as they are extracted — no placeholder module is declared early.

pub mod ctx;
pub mod error;

/// Category CRUD command bodies — the first Wave-A slice and the pattern
/// the remaining catalog/fiscal/money modules follow.
pub mod categories;
/// Currency + exchange-rate command bodies (Wave A / S4 — not yet extracted).
pub mod currency;
/// Fiscalization command bodies (Wave A / S6 — not yet extracted).
pub mod fiscal;
/// Product-variant command bodies (Wave A / S7 — not yet extracted).
pub mod product_variants;
/// Product CRUD, barcode lookup and stock command bodies (Wave A / S9 —
/// not yet extracted).
pub mod products;
/// Product-image ingest command bodies (Wave A / S8 — not yet extracted).
pub mod products_images;
/// Regional-configuration command bodies (Wave A / S6 — not yet extracted).
pub mod regional;
/// Tax-rate command bodies (Wave A / S5 — not yet extracted).
pub mod tax;

#[cfg(test)]
mod testing;
