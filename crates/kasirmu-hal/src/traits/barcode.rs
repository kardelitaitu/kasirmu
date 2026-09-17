/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! `BarcodeScanner` — the trait every barcode-reading driver implements.

use async_trait::async_trait;

use crate::error::HalError;
use crate::types::{Barcode, DeviceInfo};

/// A device that produces barcode scans. Implementations may be USB HID,
/// Bluetooth, serial, or a camera-based software scanner.
///
/// Methods are `async` so drivers can hold a `tokio::sync::Mutex` over
/// their transport state without blocking the runtime.
#[async_trait]
pub trait BarcodeScanner: Send + Sync {
    /// Open a connection to the device. Idempotent — calling twice
    /// returns a connection to the same device.
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError>;

    /// Poll for the next scan. Returns `Ok(None)` on timeout (not an
    /// error — the cashier might not scan anything for a while).
    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError>;

    /// Cancel an in-flight `poll`. Called when the user navigates away
    /// from the scan screen.
    async fn cancel(&self) -> Result<(), HalError>;

    /// Device identity, used in logs and the setup wizard.
    fn device_info(&self) -> DeviceInfo;
}
