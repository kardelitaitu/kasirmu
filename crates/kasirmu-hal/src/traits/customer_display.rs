/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! `CustomerDisplay` — a secondary screen that shows the cart total
//! and line count to the customer.
//!
//! Typical hardware is a 2-line × 20-character or 2-line × 16-character
//! LCD/VFD pole display connected over serial (RS-232 or USB-to-serial).
//! The display is updated in real time as items are scanned.

use async_trait::async_trait;

use crate::error::HalError;
use crate::types::DeviceInfo;

/// Data pushed to the customer display whenever the cart changes.
#[derive(Debug, Clone, PartialEq)]
pub struct DisplayContent {
    /// First line — typically the store name or a greeting.
    pub line1: String,
    /// Second line — typically the current total.
    pub line2: String,
}

/// A secondary display that shows cart information to the customer.
///
/// Drivers communicate over serial/USB/HID using the display's native
/// protocol. The trait provides high-level methods for the common
/// operations: clear, show content, set brightness.
#[async_trait]
pub trait CustomerDisplay: Send + Sync {
    /// Connect to the display device.
    async fn connect(&self) -> Result<Box<dyn CustomerDisplay>, HalError>;

    /// Show the given content on the display (two lines).
    /// Implementations should clear the screen first, then write
    /// the two lines at the appropriate positions.
    async fn show(&self, content: &DisplayContent) -> Result<(), HalError>;

    /// Clear the display entirely.
    async fn clear(&self) -> Result<(), HalError>;

    /// Set display brightness (0.0 = off, 1.0 = max).
    /// Returns an error if the display doesn't support brightness control.
    async fn set_brightness(&self, level: f32) -> Result<(), HalError>;

    /// Device identity, used in logs and the setup wizard.
    fn device_info(&self) -> DeviceInfo;
}

#[cfg(test)]
#[path = "customer_display_tests.rs"]
mod tests;
