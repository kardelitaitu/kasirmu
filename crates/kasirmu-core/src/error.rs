/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice A)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: typed error surface with serializable CoreErrorKind discriminator — sound; COR-4: TopologyValidation folds into Validation kind so the front-end subKind cannot distinguish it (structured code field mitigates)
next: none | perf: N/A
*/
//! Domain error type for `kasirmu-core`.
//!
//! Library crates in OZ-POS use `thiserror` to define a typed error enum
//! so consumers can match on variants. The enum is `#[non_exhaustive]`
//! so we can add variants without breaking semver.

use serde::Serialize;
use thiserror::Error;

/// Serializable discriminator for [`CoreError`] variants.
///
/// Mirrored on the front-end as `AppError.subKind` so UI code can branch
/// on the specific flavour of core error without parsing the message string.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CoreErrorKind {
    /// A database operation failed.
    Db,
    /// A platform infrastructure error.
    Platform,
    /// Money arithmetic overflowed `i64`.
    MoneyOverflow,
    /// Currency code mismatch in an operation requiring equal codes.
    CurrencyMismatch,
    /// A lookup by id returned no row.
    NotFound,
    /// A uniqueness constraint was violated.
    Conflict,
    /// Input validation failure.
    Validation,
    /// Unexpected internal error.
    Internal,
    /// Subscription limit exceeded (ADR #5).
    SubscriptionLimitExceeded,
    /// Invalid subscription signature (ADR #5).
    InvalidSubscriptionSignature,
    /// Workspace type requires a higher subscription tier (ADR #5).
    SubscriptionUpgradeRequired,
    /// The subscription's offline grace has lapsed — POS runtime is
    /// read-only (todo-global-saas-1.md §B).
    SubscriptionReadOnly,
    /// System clock tampering detected (ADR #5).
    SystemClockTampered,
    /// License or tenant has been explicitly revoked (ADR #58).
    LicenseRevoked,
    /// Authorization denied for the requested permission (ADR #35 D3).
    PermissionDenied,
    /// Stock insufficient at a specific location (ADR-19 §3.3).
    InsufficientStockAtLocation,
}

/// Errors that can originate in `kasirmu-core` domain logic.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum CoreError {
    /// A database operation failed.
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// A platform infrastructure error.
    #[error("platform error: {0}")]
    Platform(#[from] platform_core::PlatformError),

    /// Adding two [`crate::Money`] values overflowed `i64`.
    #[error("money overflow: {left} {currency} + {right}")]
    MoneyOverflow {
        /// Left-hand minor-unit operand.
        left: i64,
        /// Right-hand minor-unit operand.
        right: i64,
        /// ISO-4217 currency code, uppercased.
        currency: String,
    },

    /// A currency mismatch was passed to a function that requires equality.
    #[error("currency mismatch: {0} vs {1}")]
    CurrencyMismatch(String, String),

    /// A lookup by id returned no row.
    #[error("not found: {entity} {id}")]
    NotFound {
        /// The kind of entity that was being looked up.
        entity: &'static str,
        /// The id that was looked up.
        id: String,
    },

    /// A uniqueness constraint was violated (duplicate SKU, name, etc.).
    #[error("conflict: {entity} already exists ({field})")]
    Conflict {
        /// The entity type (e.g. "product", "category").
        entity: &'static str,
        /// The field that triggered the conflict (e.g. "sku", "name").
        field: &'static str,
    },

    /// A value failed input validation.
    #[error("validation error on {field}: {message}")]
    Validation {
        /// The field that failed validation.
        field: &'static str,
        /// Human-readable description of the failure.
        message: String,
    },

    /// An unexpected internal error (serialization, crypto, I/O, etc.).
    #[error("internal error: {0}")]
    Internal(String),

    /// A subscription limit was exceeded (ADR #5).
    #[error("subscription limit exceeded: {0}")]
    SubscriptionLimitExceeded(String),

    /// The subscription signature is invalid or tampered (ADR #5).
    #[error("invalid subscription signature: {0}")]
    InvalidSubscriptionSignature(String),

    /// The workspace type requires a higher subscription tier (ADR #5).
    #[error("subscription upgrade required: {0}")]
    SubscriptionUpgradeRequired(String),

    /// The subscription's offline grace has lapsed while still offline —
    /// POS runtime is read-only: no new sales, order mutations, or sync
    /// queueing (todo-global-saas-1.md §B). Viewing, data export, and
    /// sign-out remain available; the register reopens automatically once
    /// connectivity returns and a valid subscription is verified.
    #[error("subscription read-only: {0}")]
    SubscriptionReadOnly(String),

    /// System clock rollback detected — possible tampering (ADR #5).
    #[error("system clock tampered: {0}")]
    SystemClockTampered(String),

    /// License or tenant has been explicitly revoked (ADR #58).
    #[error("license revoked: {0}")]
    LicenseRevoked(String),

    /// The caller is not authorized for the requested permission (ADR #35
    /// D3 / spec 0047). Distinct from [`CoreError::Validation`]: a denial is
    /// an authorization outcome, not an input error.
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    /// Structured validation failure raised by the topology compiler
    /// (ADR #34 semantic gates). Carries the stable machine-readable code
    /// and the offending element ids so callers can surface targeted
    /// guidance instead of a single message string.
    #[error("topology validation error: {message}")]
    TopologyValidation {
        /// Stable machine-readable validation code.
        code: String,
        /// Node associated with the failure, when applicable.
        node_id: Option<String>,
        /// Wire associated with the failure, when applicable.
        wire_id: Option<String>,
        /// Port associated with the failure, when applicable.
        port_id: Option<String>,
        /// Human-readable fallback message.
        message: String,
    },

    /// Requested stock deduction exceeds available quantity at the specified
    /// location (ADR-19 §3.3 — translated from SQLite `CHECK (qty >= 0)`
    /// violation + Rust pre-check in
    /// [`Store::adjust_stock_at_location_with_reason`](crate::db::Store::adjust_stock_at_location_with_reason)).
    #[error(
        "insufficient stock for SKU {sku} at location {location_id}: \
         requested delta {requested_delta}, available {available_qty}"
    )]
    InsufficientStockAtLocation {
        /// SKU of the product.
        sku: String,
        /// Location where the insufficiency occurred (FK to `inventory_locations.id`).
        location_id: crate::inventory::LocationId,
        /// The attempted adjustment amount (negative for deductions).
        requested_delta: i64,
        /// The currently available stock at the location.
        available_qty: i64,
    },
}

impl From<modules_currency::CurrencyError> for CoreError {
    fn from(e: modules_currency::CurrencyError) -> Self {
        match e {
            modules_currency::CurrencyError::Db(err) => Self::Db(err),
            modules_currency::CurrencyError::Platform(err) => Self::Platform(err),
            modules_currency::CurrencyError::Validation { field, message } => {
                Self::Validation { field, message }
            }
            modules_currency::CurrencyError::NotFound { entity, id } => {
                Self::NotFound { entity, id }
            }
        }
    }
}

impl From<kasirmu_crypto::CryptoError> for CoreError {
    fn from(e: kasirmu_crypto::CryptoError) -> Self {
        Self::Internal(e.to_string())
    }
}

impl CoreError {
    /// Map a `CoreError` to its [`CoreErrorKind`] discriminator.
    pub fn kind(&self) -> CoreErrorKind {
        match self {
            CoreError::Db(_) => CoreErrorKind::Db,
            CoreError::Platform(_) => CoreErrorKind::Platform,
            CoreError::MoneyOverflow { .. } => CoreErrorKind::MoneyOverflow,
            CoreError::CurrencyMismatch(..) => CoreErrorKind::CurrencyMismatch,
            CoreError::NotFound { .. } => CoreErrorKind::NotFound,
            CoreError::Conflict { .. } => CoreErrorKind::Conflict,
            CoreError::Validation { .. } => CoreErrorKind::Validation,
            CoreError::Internal(_) => CoreErrorKind::Internal,
            CoreError::SubscriptionLimitExceeded(_) => CoreErrorKind::SubscriptionLimitExceeded,
            CoreError::InvalidSubscriptionSignature(_) => {
                CoreErrorKind::InvalidSubscriptionSignature
            }
            CoreError::SubscriptionUpgradeRequired(_) => CoreErrorKind::SubscriptionUpgradeRequired,
            CoreError::SubscriptionReadOnly(_) => CoreErrorKind::SubscriptionReadOnly,
            CoreError::SystemClockTampered(_) => CoreErrorKind::SystemClockTampered,
            CoreError::LicenseRevoked(_) => CoreErrorKind::LicenseRevoked,
            CoreError::PermissionDenied(_) => CoreErrorKind::PermissionDenied,
            CoreError::TopologyValidation { .. } => CoreErrorKind::Validation,
            CoreError::InsufficientStockAtLocation { .. } => {
                CoreErrorKind::InsufficientStockAtLocation
            }
        }
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
