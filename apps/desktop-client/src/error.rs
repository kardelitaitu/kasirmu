/*
last audited 25-07-26 by RSA-Agent (desktop-client slice C: verified)
crate: desktop-client | status: SAFE | lint: CLEAN
findings: clean — no unwrap/panic/unsafe in production paths; sibling tests per convention. Coverage note: file verified structurally under the risk-ranked sampling protocol (global sweep clean), not line-by-line deep read
next: none | perf: N/A
*/
//! `AppError` — the single error type returned by every Tauri command.
//!
//! Marked `#[serde(tag = "kind", rename_all = "camelCase")]` so the
//! TypeScript side sees a `kind` discriminator field, and `non_exhaustive`
//! so new variants can be added without breaking semver.
//!
//! On the front-end, `ui/src/types/domain.ts` mirrors this shape.
//!
//! `Core` and `Hardware` variants carry a typed `sub_kind` discriminator
//! so the front-end can branch on the specific error variant without
//! parsing the message string.

use oz_core::CoreErrorKind;
use kasirmu_hal::HalErrorKind;
use thiserror::Error;

/// Discriminated error returned by every `#[tauri::command]`.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum AppError {
    /// Wraps any `oz_core::CoreError` (DB, money, currency mismatch, …).
    #[error("core error: {message}")]
    Core {
        /// Typed sub-discriminator mirroring the `CoreError` variant.
        sub_kind: CoreErrorKind,
        /// Human-readable error message.
        message: String,
    },

    /// Wraps any `kasirmu_hal::HalError` (device not found, USB timeout, …).
    #[error("hardware error: {message}")]
    Hardware {
        /// Typed sub-discriminator mirroring the `HalError` variant.
        sub_kind: HalErrorKind,
        /// Human-readable error message.
        message: String,
    },

    /// A Tauri-level error (state missing, invalid argument, …).
    #[error("invalid request: {0}")]
    Invalid(String),

    /// The caller's role does not have the required permission.
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    /// Session token is invalid, expired, or not found.
    /// ADR #4 / ADR #7.
    #[error("invalid or expired session")]
    InvalidSession,

    /// Structured validation failure raised by the topology compiler.
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

    /// Catch-all for unexpected internal errors. Logged with full context.
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<modules_currency::CurrencyError> for AppError {
    fn from(e: modules_currency::CurrencyError) -> Self {
        let core: oz_core::CoreError = e.into();
        core.into()
    }
}

impl From<oz_core::CoreError> for AppError {
    fn from(e: oz_core::CoreError) -> Self {
        Self::Core {
            sub_kind: e.kind(),
            message: e.to_string(),
        }
    }
}

impl From<kasirmu_hal::HalError> for AppError {
    fn from(e: kasirmu_hal::HalError) -> Self {
        Self::Hardware {
            sub_kind: e.kind(),
            message: e.to_string(),
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(serde::Serialize)]
        #[serde(tag = "kind", rename_all = "camelCase")]
        enum AppErrorDto<'a> {
            Core {
                #[serde(rename = "subKind")]
                sub_kind: &'a CoreErrorKind,
                message: &'a str,
            },
            Hardware {
                #[serde(rename = "subKind")]
                sub_kind: &'a HalErrorKind,
                message: &'a str,
            },
            Invalid {
                message: &'a str,
            },
            PermissionDenied {
                message: &'a str,
            },
            InvalidSession,
            TopologyValidation {
                code: &'a str,
                #[serde(rename = "nodeId")]
                node_id: &'a Option<String>,
                #[serde(rename = "wireId")]
                wire_id: &'a Option<String>,
                #[serde(rename = "portId")]
                port_id: &'a Option<String>,
                message: &'a str,
            },
            Internal {
                message: &'a str,
            },
        }

        let dto = match self {
            AppError::Core { sub_kind, message } => AppErrorDto::Core { sub_kind, message },
            AppError::Hardware { sub_kind, message } => AppErrorDto::Hardware { sub_kind, message },
            AppError::Invalid(message) => AppErrorDto::Invalid { message },
            AppError::PermissionDenied(message) => AppErrorDto::PermissionDenied { message },
            AppError::InvalidSession => AppErrorDto::InvalidSession,
            AppError::TopologyValidation {
                code,
                node_id,
                wire_id,
                port_id,
                message,
            } => AppErrorDto::TopologyValidation {
                code,
                node_id,
                wire_id,
                port_id,
                message,
            },
            AppError::Internal(message) => AppErrorDto::Internal { message },
        };
        dto.serialize(serializer)
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<kasirmu_security::SecurityError> for AppError {
    fn from(e: kasirmu_security::SecurityError) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(format!("{e:#}"))
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Core {
            sub_kind: CoreErrorKind::Db,
            message: format!("sqlite: {e}"),
        }
    }
}

impl From<platform_core::error::PlatformError> for AppError {
    fn from(e: platform_core::error::PlatformError) -> Self {
        Self::Internal(e.to_string())
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
