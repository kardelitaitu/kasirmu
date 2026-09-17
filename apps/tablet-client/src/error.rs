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
use serde::Serialize;
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

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
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

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
