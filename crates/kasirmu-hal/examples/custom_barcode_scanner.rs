//! Example: Custom Barcode Scanner Driver
//!
//! This is a minimal, complete example of implementing a custom HAL driver
//! for OZ-POS. It shows how to:
//!
//! 1. Implement the `BarcodeScanner` trait from `oz-hal`
//! 2. Use `DeviceInfo` for driver identity
//! 3. Handle connection lifecycle (connect, poll, cancel)
//! 4. Follow the mock-testable pattern
//!
//! ## How to use this example
//!
//! 1. Copy this file into your own crate
//! 2. Add `oz-hal` as a dependency: `oz-hal = { path = "../oz-pos/crates/oz-hal" }`
//! 3. Implement your actual hardware communication (USB, serial, etc.)
//! 4. Register your driver via `DriverRegistry`
//!
//! ## Testing your driver
//!
//! The mock in `oz-hal/src/drivers/mock.rs` shows the test pattern.
//! Your driver should follow the same trait so tests can swap it in:
//!
//! ```rust,ignore
//! // In your test:
//! let scanner = MyScanner::new();
//! scanner.push(Barcode::new("TEST123")); // queue a test scan
//! let result = scanner.poll(0).await?;
//! assert_eq!(result.unwrap().code, "TEST123");
//! ```

use async_trait::async_trait;
use kasirmu_hal::error::HalError;
use kasirmu_hal::traits::barcode::BarcodeScanner;
use kasirmu_hal::types::{Barcode, DeviceInfo};

/// A custom barcode scanner that reads from a USB HID device.
///
/// This example shows the minimal structure: the struct holds the
/// device identity and any connection state. Real drivers would
/// hold a USB handle, serial port, or Bluetooth socket.
pub struct CustomBarcodeScanner {
    /// Device identity — reported to the UI and used for driver matching.
    info: DeviceInfo,
    /// Whether the device is currently connected.
    connected: bool,
}

impl CustomBarcodeScanner {
    /// Create a new scanner with the given vendor/product/serial.
    ///
    /// The `DeviceInfo` fields are used by the `DriverRegistry` to
    /// match this driver to a physical device.
    pub fn new(vendor: &str, model: &str, serial: &str) -> Self {
        Self {
            info: DeviceInfo::new(vendor, model, serial),
            connected: false,
        }
    }
}

#[async_trait]
impl BarcodeScanner for CustomBarcodeScanner {
    /// Connect to the physical device.
    ///
    /// In a real driver, this would open a USB endpoint, serial port,
    /// or Bluetooth socket. Return `HalError::Disconnected` if the
    /// device is not reachable.
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError> {
        // In a real driver:
        //   1. Open the USB endpoint / serial port
        //   2. Send any initialization commands
        //   3. Verify the device responds
        // For this example, we simulate a successful connection.
        let mut scanner =
            CustomBarcodeScanner::new(&self.info.vendor, &self.info.model, &self.info.serial);
        scanner.connected = true;
        Ok(Box::new(scanner))
    }

    /// Poll for a scanned barcode.
    ///
    /// Returns `Ok(None)` if no barcode is available within the
    /// timeout. Returns `Ok(Some(barcode))` when a scan is read.
    ///
    /// In a real driver, this would read from the USB interrupt
    /// endpoint or serial buffer.
    async fn poll(&mut self, _timeout_ms: u32) -> Result<Option<Barcode>, HalError> {
        if !self.connected {
            return Err(HalError::Disconnected);
        }

        // In a real driver:
        //   1. Read from the USB HID endpoint
        //   2. Parse the barcode data (may include prefix/suffix chars)
        //   3. Return Barcode::new(parsed_data)
        // For this example, return no scan available.
        Ok(None)
    }

    /// Cancel any in-progress scan and release the device.
    ///
    /// In a real driver, this would close the USB endpoint or
    /// flush any pending reads.
    async fn cancel(&self) -> Result<(), HalError> {
        // In a real driver:
        //   1. Cancel any pending USB transfers
        //   2. Optionally close the device
        Ok(())
    }

    /// Return the device identity for UI display and driver matching.
    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

// ── Main (example binary entry point) ─────────────────────────────

fn main() {
    println!("Custom Barcode Scanner — example HAL driver for OZ-POS");
    println!("This example demonstrates the BarcodeScanner trait pattern.");
    println!("Run `cargo test -p oz-hal --example custom_barcode_scanner` to run the tests.");
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn new_scanner_has_correct_device_info() {
        let scanner = CustomBarcodeScanner::new("ACME", "ScanPro-2000", "SN12345");
        let info = scanner.device_info();
        assert_eq!(info.vendor, "ACME");
        assert_eq!(info.model, "ScanPro-2000");
        assert_eq!(info.serial, "SN12345");
    }

    #[tokio::test]
    async fn connect_returns_connected_scanner() {
        let scanner = CustomBarcodeScanner::new("ACME", "ScanPro", "001");
        let result = scanner.connect().await;
        assert!(result.is_ok());

        let connected = result.unwrap();
        assert_eq!(connected.device_info().vendor, "ACME");
    }

    #[tokio::test]
    async fn poll_returns_none_when_no_scan_available() {
        let mut scanner = CustomBarcodeScanner::new("ACME", "ScanPro", "001");
        scanner.connected = true;

        let result = scanner.poll(100).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn poll_returns_error_when_disconnected() {
        let mut scanner = CustomBarcodeScanner::new("ACME", "ScanPro", "001");
        // Scanner is not connected.

        let result = scanner.poll(100).await;
        assert!(matches!(result, Err(HalError::Disconnected)));
    }

    #[tokio::test]
    async fn cancel_succeeds() {
        let scanner = CustomBarcodeScanner::new("ACME", "ScanPro", "001");
        let result = scanner.cancel().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn scanner_implements_trait() {
        // Verify the scanner can be used as a trait object.
        fn accept_scanner(_s: &dyn BarcodeScanner) {}
        let scanner = CustomBarcodeScanner::new("ACME", "ScanPro", "001");
        accept_scanner(&scanner);
    }
}
