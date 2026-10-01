/*
last audited (date unknown) by DSH-Agent (Money audit)
crate: foundation | status: SAFE | lint: CLEAN
findings: zero unsafe, no IO in its own source, minimal deps (tracing + chrono added 2026-09-28 — see Cargo.toml; chrono's clock feature reaches the OS clock transitively, so this is a claim about this crate, not its graph), missing_docs enforced. Money audit COMPLETE: money.rs and percentage.rs arithmetic verified exemplary (overflow-free decomposition, i64::MIN-safe format_minor, checked_* everywhere, currency-mismatch -> None, no floats); MONEY-AUDIT-2/3 fixes verified intact; no float misuse in money paths (popularity.rs floats are non-money analytics). COR-33 FIXED (date unknown) — inline tests extracted to sibling files for percentage, cart, barcode, sku (4 crates of the COR-33 sweep).
next: none | perf: Copy types in hot paths
Slice E (dto/contracts/contact/enums) is CLOSED 2026-10-04, not open: the
archived audit records it complete — '### Slice E — contracts.rs (476),
enums.rs (359), contact.rs (393), dto.rs (447) -- foundation COMPLETE'
(docs/archived/2026-08-31-glm-5.3f-crates-audit.md:1147-1148) — and all four
files plus their _tests.rs siblings ship (foundation/src/{contracts,enums,
contact,dto}.rs). The former 'still open' text was the pre-audit queue, not
live work.
*/

// P2-5: `clippy::pedantic` is enabled HERE, at the crate root, rather than in
// `Cargo.toml`. Both this crate and `kasirmu-core` carry `[lints] workspace = true`,
// and Cargo refuses to combine that with a local `[lints.clippy]` table —
// `cargo metadata` fails with "cannot override `workspace.lints` in `lints`, either
// remove the overrides or `lints.workspace = true` and manually specify the lints".
// A crate-root attribute *composes* with the workspace table instead of conflicting
// with it, so `missing_docs` and any future workspace lint are still inherited and
// no crate has to opt out of the shared table.
#![warn(clippy::pedantic)]
// Documentation lints — 107 findings, prose rather than behaviour (`# Errors`
// sections, backticks, `#[must_use]`). Named explicitly rather than left off, so
// the debt stays visible instead of silently absent.
#![allow(clippy::missing_errors_doc)]
#![allow(clippy::doc_markdown)]
#![allow(clippy::must_use_candidate)]
#![allow(clippy::missing_panics_doc)]
// `dto.rs` uses `Option<Option<T>>` as the PATCH tri-state — key absent vs
// explicitly null vs present. Collapsing it to `Option<T>` would delete a
// distinction the wire contract depends on, so the lint is wrong here.
#![allow(clippy::option_option)]
// `validate_range` is generic over `T: PartialOrd + Display`. Taking `T` by value
// is the right signature for a numeric range check; `&T` would force every caller
// to borrow literals for no benefit.
#![allow(clippy::needless_pass_by_value)]

//! Foundation crate for kasir.mu.
//!
//! Contains the value objects, contracts, enums, and error types that
//! are shared across all other crates. This crate has minimal
//! dependencies so it can be used everywhere without pulling in heavy
//! transitive deps. The one logging dep, `tracing`, arrived with
//! [`ProductType::parse_stored_or_default`] (2026-09-28): that parser is needed
//! below `kasirmu-core` and inside `modules-inventory` alike, so this tier is its
//! only non-duplicating home.
//!
//! # What may live here
//!
//! This crate is the bottom of the dependency graph, so anything it takes on is taken on by every
//! other crate. The rule: **pure computation, value types and thin facades are welcome; a database
//! driver, an async runtime, network or filesystem IO, or a platform service is not.** Two judgement
//! calls are recorded rather than hidden: `tracing` (a facade that does nothing without a subscriber
//! installed) arrived with `ProductType::parse_stored_or_default`'s documented warning, and `chrono`
//! arrived with three sales constructors that stamp `created_at`. Both came in on 2026-09-28 with
//! moved domain types — see `docs/decisions/2026-09-28-adr61-architecture-boundary-rule-tiers.md`,
//! D6 and D7, which also record why the clock was not chased out of this tier.
//!
//! # Contents
//!
//! - [`money`] — [`Money`] and [`Currency`] primitives
//! - [`sku`] — [`Sku`] and [`LineId`] identifiers
//! - [`cart`] — [`Cart`], [`CartLine`], [`CartId`], [`CartError`]
//! - [`enums`] — shared enums ([`SaleStatus`], [`PaymentMethod`])
//! - [`contracts`] — [`Module`], [`Service`], [`EventHandler`] traits
//! - [`errors`] — shared error types

#![deny(unsafe_code)]

pub mod barcode;
pub mod cart;
pub mod constants;
pub mod contact;
pub mod contracts;
pub mod customer;
pub mod dto;
pub mod enums;
pub mod errors;
pub mod events;
pub mod inventory;
pub mod loyalty;
pub mod money;
pub mod percentage;
pub mod sales;
pub mod sku;
pub mod tax;
pub mod terminal;
pub mod validation;

pub use barcode::Barcode;
pub use cart::{Cart, CartError, CartId, CartLine, normalize_course};
pub use constants::{
    BASIS_POINTS_DENOMINATOR, DEFAULT_CURRENCY_CODE, MAX_DISCOUNT_PERCENT, MAX_NAME_LENGTH,
    MAX_SKU_LENGTH, PIN_MIN_LENGTH,
};
pub use contact::{Email, Phone};
pub use contracts::{EventHandler, HandlerType, Module, ModuleContext, Service};
pub use customer::Customer;
pub use enums::{InvalidTransition, PaymentMethod, SaleStatus};
pub use errors::{ConflictError, NotFoundError, ValidationError};
pub use inventory::{
    CANONICAL_DEFAULT_LOCATION_UUID, Category, Inventory, InventoryLocation, InventoryShift,
    LocationId, Product, ProductType, StockThreshold, WorkspaceInventoryLocation,
};
pub use loyalty::{
    GiftCard, GiftCardFilter, GiftCardTransaction, GiftCardWithTransactions, IssueGiftCardInput,
    LoyaltyAccount, LoyaltyAccountWithDetails, LoyaltyTier, LoyaltyTransaction,
    RedeemGiftCardResult,
};
pub use money::{Currency, InvalidCurrencyCode, Money, format_minor};
pub use percentage::Percentage;
pub use sales::{Refund, RefundLine, Sale, SaleLine, default_version};
pub use sku::{LineId, Sku};
pub use tax::{RoundingMode, TaxRate};
pub use terminal::{Terminal, TerminalId};
pub use validation::{
    validate_alphanumeric, validate_ascii_alphanumeric, validate_email, validate_max_length,
    validate_min_length, validate_money_range, validate_non_empty_bounded, validate_not_empty,
    validate_phone, validate_range, validate_regex, validate_sku, validate_string_length,
};
