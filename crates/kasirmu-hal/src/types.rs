/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! Cross-cutting types used by HAL traits, drivers, and the registry.

use serde::{Deserialize, Serialize};

/// A single barcode read from a scanner.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Barcode {
    /// The raw code as ASCII text (e.g., `"012345678905"`).
    pub code: String,
    /// The symbology the scanner reported.
    pub symbology: BarcodeSymbology,
}

impl Barcode {
    /// Construct a barcode with an "unknown" symbology — use this when
    /// the scanner doesn't report the symbology but you trust the read.
    #[must_use]
    pub fn new(code: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            symbology: BarcodeSymbology::Any,
        }
    }
}

/// Barcode symbology, where known. `Any` means the driver couldn't tell
/// (or the symbology is not modelled yet).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum BarcodeSymbology {
    /// Driver did not report a specific symbology.
    Any,
    /// EAN-13 (most retail products).
    Ean13,
    /// UPC-A (US retail).
    UpcA,
    /// Code 128 (logistics).
    Code128,
    /// QR code.
    Qr,
    /// PDF417.
    Pdf417,
}

/// Static device identity, used in logs and the setup wizard.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DeviceInfo {
    /// Vendor / brand (e.g., `"Honeywell"`, `"OZ-POS"` for mocks).
    pub vendor: String,
    /// Model name (e.g., `"Voyager 1450g"`).
    pub model: String,
    /// Serial number, or `"0000-0000"` for mocks.
    pub serial: String,
}

impl DeviceInfo {
    /// Construct a `DeviceInfo` with a single call.
    #[must_use]
    pub fn new(
        vendor: impl Into<String>,
        model: impl Into<String>,
        serial: impl Into<String>,
    ) -> Self {
        Self {
            vendor: vendor.into(),
            model: model.into(),
            serial: serial.into(),
        }
    }

    /// Render as `"<vendor> <model> (<serial>)"` for log lines.
    #[must_use]
    pub fn display(&self) -> String {
        format!("{} {} ({})", self.vendor, self.model, self.serial)
    }
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
