//! `BridgeError` — the error type returned by every headless bridge operation.
//!
//! This is the tauri-free mirror of `apps/desktop-tauri/src/error.rs::AppError`.
//! The bridge crate never names a UI shell type, so command bodies extracted
//! here compile and run without tauri; each shim converts a `BridgeError`
//! back into `AppError` variant-for-variant, which keeps the on-the-wire
//! `AppErrorDto` shape (and the `ui/src/types/domain.ts` mirror) unchanged.
//!
//! `Core` carries a typed `sub_kind` discriminator so the front end can
//! branch on the specific failure without parsing the message string.

/// Error type for every headless bridge operation; mapped to `AppError` at the shim.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum BridgeError {
    /// Wraps any `kasirmu_core::CoreError` (mirrors `AppError::Core`).
    #[error("core error: {message}")]
    Core {
        /// Typed sub-discriminator mirroring the `CoreError` variant.
        sub_kind: kasirmu_core::CoreErrorKind,
        /// Human-readable message.
        message: String,
    },
    /// Wraps any `kasirmu_hal::HalError` (device not found, USB timeout, …)
    /// (mirrors `AppError::Hardware`).
    #[error("hardware error: {message}")]
    Hardware {
        /// Typed sub-discriminator mirroring the `HalError` variant.
        sub_kind: kasirmu_hal::HalErrorKind,
        /// Human-readable error message.
        message: String,
    },
    /// Invalid request/argument (mirrors `AppError::Invalid`).
    #[error("invalid request: {0}")]
    Invalid(String),
    /// Authorization denial (mirrors `AppError::PermissionDenied`).
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    /// Unknown/expired session token (mirrors `AppError::InvalidSession`).
    #[error("invalid or expired session")]
    InvalidSession,
    /// Structured validation failure raised by the topology compiler
    /// (mirrors `AppError::TopologyValidation`).
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
    /// Catch-all (mirrors `AppError::Internal`).
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<kasirmu_core::CoreError> for BridgeError {
    fn from(e: kasirmu_core::CoreError) -> Self {
        Self::Core {
            sub_kind: e.kind(),
            message: e.to_string(),
        }
    }
}

impl From<modules_currency::CurrencyError> for BridgeError {
    fn from(e: modules_currency::CurrencyError) -> Self {
        let core: kasirmu_core::CoreError = e.into();
        core.into()
    }
}

impl From<rusqlite::Error> for BridgeError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Core {
            sub_kind: kasirmu_core::CoreErrorKind::Db,
            message: format!("sqlite: {e}"),
        }
    }
}

impl From<platform_core::error::PlatformError> for BridgeError {
    fn from(e: platform_core::error::PlatformError) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<kasirmu_hal::HalError> for BridgeError {
    fn from(e: kasirmu_hal::HalError) -> Self {
        Self::Hardware {
            sub_kind: e.kind(),
            message: e.to_string(),
        }
    }
}
