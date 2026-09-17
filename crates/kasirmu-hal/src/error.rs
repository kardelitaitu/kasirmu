/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! Error type for the Hardware Abstraction Layer.
//!
//! Every trait method in `oz-hal` returns `Result<T, HalError>`. The enum
//! is `#[non_exhaustive]` so new failure modes can be added without
//! breaking semver. Drivers convert third-party errors with
//! `.map_err(|e| HalError::Usb(e.to_string()))` at the trait boundary
//! — never leak `rusb`/`btleplug`/`serialport` types past the driver.

use serde::Serialize;
use thiserror::Error;

/// Serializable discriminator for [`HalError`] variants.
///
/// Mirrored on the front-end as `AppError.subKind` so UI code can branch
/// on the specific hardware failure mode without parsing the message string.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HalErrorKind {
    /// Device id not found in the registry.
    NotFound,
    /// Device was disconnected.
    Disconnected,
    /// I/O transport error.
    Io,
    /// USB transport error.
    Usb,
    /// Bluetooth transport error.
    Bluetooth,
    /// Operation timed out.
    Timeout,
    /// Malformed packet or unexpected response.
    Protocol,
    /// Device is busy with a prior request.
    Busy,
    /// Driver present but the operation is not implemented.
    Unsupported,
}

/// Errors that can originate in a HAL driver or the HAL runtime.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum HalError {
    /// The requested device id was not in the registry.
    #[error("device not found: {0}")]
    NotFound(String),

    /// The device was connected but the user/environment disconnected it.
    #[error("device disconnected")]
    Disconnected,

    /// An `std::io::Error` bubbled up from the transport layer.
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),

    /// A USB transport error.
    #[error("usb error: {0}")]
    Usb(String),

    /// A Bluetooth transport error.
    #[error("bluetooth error: {0}")]
    Bluetooth(String),

    /// An operation did not complete within its timeout window.
    #[error("operation timed out after {0} ms")]
    Timeout(u32),

    /// The device returned a malformed packet or unexpected response.
    #[error("protocol error: {0}")]
    Protocol(String),

    /// The device is busy with a previous request.
    #[error("device busy")]
    Busy,

    /// The driver is present but this operation is not implemented — the
    /// fail-closed default for every stubbed device path, so an
    /// unimplemented driver can never silently report success.
    #[error("operation not supported: {0}")]
    Unsupported(String),
}

impl Clone for HalError {
    fn clone(&self) -> Self {
        match self {
            Self::NotFound(s) => Self::NotFound(s.clone()),
            Self::Disconnected => Self::Disconnected,
            Self::Io(e) => Self::Io(std::io::Error::new(e.kind(), e.to_string())),
            Self::Usb(s) => Self::Usb(s.clone()),
            Self::Bluetooth(s) => Self::Bluetooth(s.clone()),
            Self::Timeout(n) => Self::Timeout(*n),
            Self::Protocol(s) => Self::Protocol(s.clone()),
            Self::Busy => Self::Busy,
            Self::Unsupported(s) => Self::Unsupported(s.clone()),
        }
    }
}

impl HalError {
    /// Map a `HalError` to its [`HalErrorKind`] discriminator.
    pub fn kind(&self) -> HalErrorKind {
        match self {
            HalError::NotFound(_) => HalErrorKind::NotFound,
            HalError::Disconnected => HalErrorKind::Disconnected,
            HalError::Io(_) => HalErrorKind::Io,
            HalError::Usb(_) => HalErrorKind::Usb,
            HalError::Bluetooth(_) => HalErrorKind::Bluetooth,
            HalError::Timeout(_) => HalErrorKind::Timeout,
            HalError::Protocol(_) => HalErrorKind::Protocol,
            HalError::Busy => HalErrorKind::Busy,
            HalError::Unsupported(_) => HalErrorKind::Unsupported,
        }
    }
}

#[cfg(test)]
#[path = "error_tests.rs"]
mod tests;
