/*
last audited DD-MM-YY by DSH-Agent (Money audit)
crate: foundation | status: SAFE | lint: CLEAN
findings: zero unsafe, no FFI/IO, minimal deps, missing_docs enforced. Money audit COMPLETE: money.rs and percentage.rs arithmetic verified exemplary (overflow-free decomposition, i64::MIN-safe format_minor, checked_* everywhere, currency-mismatch -> None, no floats); MONEY-AUDIT-2/3 fixes verified intact; no float misuse in money paths (popularity.rs floats are non-money analytics). COR-33 FIXED DD-MM-YY — inline tests extracted to sibling files for percentage, cart, barcode, sku (4 crates of the COR-33 sweep).
next: slice E (dto/contracts/contact/enums) still open | perf: Copy types in hot paths
*/

//! Foundation crate for OZ-POS.
//!
//! Contains the value objects, contracts, enums, and error types that
//! are shared across all other crates. This crate has minimal
//! dependencies so it can be used everywhere without pulling in heavy
//! transitive deps.
//!
//! # Contents
//!
//! - [`money`] — [`Money`] and [`Currency`] primitives
//! - [`sku`] — [`Sku`] and [`LineId`] identifiers
//! - [`cart`] — [`Cart`], [`CartLine`], [`CartId`], [`CartError`]
//! - [`enums`] — shared enums ([`SaleStatus`], [`PaymentMethod`])
//! - [`contracts`] — [`Module`], [`Service`], [`EventHandler`] traits
//! - [`errors`] — shared error types

pub mod barcode;
pub mod cart;
pub mod constants;
pub mod contact;
pub mod contracts;
pub mod dto;
pub mod enums;
pub mod errors;
pub mod events;
pub mod money;
pub mod percentage;
pub mod sku;
pub mod validation;

pub use barcode::Barcode;
pub use cart::{Cart, CartError, CartId, CartLine, normalize_course};
pub use constants::{
    BASIS_POINTS_DENOMINATOR, DEFAULT_CURRENCY_CODE, MAX_DISCOUNT_PERCENT, MAX_NAME_LENGTH,
    MAX_SKU_LENGTH, PIN_MIN_LENGTH,
};
pub use contact::{Email, Phone};
pub use contracts::{EventHandler, Module, Service};
pub use enums::{InvalidTransition, PaymentMethod, SaleStatus};
pub use errors::{ConflictError, NotFoundError, ValidationError};
pub use money::{Currency, InvalidCurrencyCode, Money, format_minor};
pub use percentage::Percentage;
pub use sku::{LineId, Sku};
pub use validation::{
    validate_alphanumeric, validate_ascii_alphanumeric, validate_email, validate_max_length,
    validate_min_length, validate_money_range, validate_non_empty_bounded, validate_not_empty,
    validate_phone, validate_range, validate_regex, validate_sku, validate_string_length,
};
