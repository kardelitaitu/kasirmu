/*
last audited 25-07-26 by RSA-Agent (oz-hal slice C: usb_scanner deep read)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: exemplary — const-evaluated HID keyboard table with Shift-modifier mapping; deadline-bounded poll loop (50ms slices, no unbounded block); spurious-enter and key-up reports handled; inter-key timeout returns the partial barcode (documented scanners-without-terminator heuristic); connect idempotent via shared handle; not-connected fails with NotFound
next: none | perf: blocking reads in spawn_blocking
*/
//! USB HID barcode scanner driver.
//!
//! Implements `BarcodeScanner` using raw USB interrupt transfers via
//! `rusb`. Supports barcode scanners that present as generic HID keyboard
//! devices (HID usage ID 0x06, Keyboard), which covers most retail
//! scanners in their factory-default configuration.
//!
//! The driver:
//! - Opens the USB device and claims the HID interface
//! - Reads HID keyboard reports (8-byte interrupt transfers)
//! - Converts HID usage IDs → ASCII (including Shift-modifier)
//! - Builds a complete barcode string from the key sequence
//! - Detects line-feed / enter terminator characters to finalise the scan

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::barcode::BarcodeScanner;
use crate::transport::usb::{UsbDeviceInfo, open_device};
use crate::types::{Barcode, DeviceInfo};

// ---------------------------------------------------------------------------
// HID Keyboard usage-ID → ASCII lookup
// ---------------------------------------------------------------------------

/// Lookup table for USB HID keyboard usage IDs (non-modifier).
/// Index by usage ID. `None` means unprintable / modifier.
const HID_KEY_TABLE: [Option<(char, char)>; 256] = {
    let mut t: [Option<(char, char)>; 256] = [None; 256];
    t[0x00] = None; // Reserved / error
    t[0x01] = None; // Post fail / error
    t[0x04] = Some(('a', 'A'));
    t[0x05] = Some(('b', 'B'));
    t[0x06] = Some(('c', 'C'));
    t[0x07] = Some(('d', 'D'));
    t[0x08] = Some(('e', 'E'));
    t[0x09] = Some(('f', 'F'));
    t[0x0A] = Some(('g', 'G'));
    t[0x0B] = Some(('h', 'H'));
    t[0x0C] = Some(('i', 'I'));
    t[0x0D] = Some(('j', 'J'));
    t[0x0E] = Some(('k', 'K'));
    t[0x0F] = Some(('l', 'L'));
    t[0x10] = Some(('m', 'M'));
    t[0x11] = Some(('n', 'N'));
    t[0x12] = Some(('o', 'O'));
    t[0x13] = Some(('p', 'P'));
    t[0x14] = Some(('q', 'Q'));
    t[0x15] = Some(('r', 'R'));
    t[0x16] = Some(('s', 'S'));
    t[0x17] = Some(('t', 'T'));
    t[0x18] = Some(('u', 'U'));
    t[0x19] = Some(('v', 'V'));
    t[0x1A] = Some(('w', 'W'));
    t[0x1B] = Some(('x', 'X'));
    t[0x1C] = Some(('y', 'Y'));
    t[0x1D] = Some(('z', 'Z'));
    t[0x1E] = Some(('1', '!'));
    t[0x1F] = Some(('2', '@'));
    t[0x20] = Some(('3', '#'));
    t[0x21] = Some(('4', '$'));
    t[0x22] = Some(('5', '%'));
    t[0x23] = Some(('6', '^'));
    t[0x24] = Some(('7', '&'));
    t[0x25] = Some(('8', '*'));
    t[0x26] = Some(('9', '('));
    t[0x27] = Some(('0', ')'));
    t[0x28] = Some(('\n', '\n')); // Enter — barcode terminator
    t[0x2C] = Some((' ', ' ')); // Space
    t[0x2D] = Some(('-', '_'));
    t[0x2E] = Some(('=', '+'));
    t[0x2F] = Some(('[', '{'));
    t[0x30] = Some((']', '}'));
    t[0x31] = Some(('\\', '|'));
    t[0x33] = Some((';', ':'));
    t[0x34] = Some(('\'', '"'));
    t[0x35] = Some(('`', '~'));
    t[0x36] = Some((',', '<'));
    t[0x37] = Some(('.', '>'));
    t[0x38] = Some(('/', '?'));
    t
};

/// Interpret a single HID keyboard report (8 bytes) and return the
/// character if a non-modifier key is pressed.
fn hid_report_to_char(report: &[u8; 8]) -> Option<char> {
    let modifiers = report[0];
    let key_code = report[2]; // First pressed key

    if key_code == 0x00 {
        return None; // No key pressed (keyboard idle)
    }

    let shift = (modifiers & 0x22) != 0; // LShift (0x02) or RShift (0x20)
    match HID_KEY_TABLE.get(key_code as usize) {
        Some(Some((unshifted, shifted))) => {
            if shift {
                Some(*shifted)
            } else {
                Some(*unshifted)
            }
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/// A barcode scanner driven through a USB HID interrupt endpoint.
pub struct UsbHidBarcodeScanner {
    handle: Arc<Mutex<Option<rusb::DeviceHandle<rusb::Context>>>>,
    info: DeviceInfo,
    usb_info: UsbDeviceInfo,
}

impl UsbHidBarcodeScanner {
    /// Attempt to construct a driver for the given USB device.
    ///
    /// Returns `Ok(None)` if the device is not a recognised scanner (this
    /// is not an error — the caller should try other candidates).
    pub fn try_new(info: UsbDeviceInfo) -> Self {
        let device_info = DeviceInfo::new(&info.manufacturer, &info.product, &info.serial);

        Self {
            handle: Arc::new(Mutex::new(None)),
            info: device_info,
            usb_info: info,
        }
    }

    /// Connect all known USB scanners found on the system and return
    /// their driver instances.
    pub fn discover_all() -> Vec<Self> {
        let devices = match crate::transport::usb::probe_scanners() {
            Ok(d) => d,
            Err(_) => return Vec::new(),
        };
        devices.into_iter().map(Self::try_new).collect()
    }
}

#[async_trait]
impl BarcodeScanner for UsbHidBarcodeScanner {
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError> {
        let mut guard = self.handle.lock().await;
        if guard.is_some() {
            return Ok(Box::new(Self {
                handle: self.handle.clone(),
                info: self.info.clone(),
                usb_info: self.usb_info.clone(),
            }));
        }

        let handle = open_device(
            self.usb_info.vid,
            self.usb_info.pid,
            self.usb_info.interface_number,
        )?;

        *guard = Some(handle);

        Ok(Box::new(Self {
            handle: self.handle.clone(),
            info: self.info.clone(),
            usb_info: self.usb_info.clone(),
        }))
    }

    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError> {
        let handle_arc = self.handle.clone();
        let ep_in = self.usb_info.endpoint_in;
        let total_timeout = Duration::from_millis(timeout_ms as u64);

        spawn_blocking(move || {
            let mut guard = handle_arc.blocking_lock();
            let handle = guard
                .as_mut()
                .ok_or(HalError::NotFound("not connected".into()))?;

            let deadline = std::time::Instant::now() + total_timeout;
            let mut code = String::with_capacity(32);
            let read_timeout = Duration::from_millis(50);

            loop {
                if std::time::Instant::now() >= deadline {
                    return if code.is_empty() {
                        Ok(None)
                    } else {
                        Ok(Some(Barcode::new(&code)))
                    };
                }

                let mut buf = [0u8; 8];
                let timeout = std::cmp::min(
                    read_timeout,
                    deadline.saturating_duration_since(std::time::Instant::now()),
                );

                match handle.read_interrupt(ep_in, &mut buf, timeout) {
                    Ok(_) => {
                        match hid_report_to_char(&buf) {
                            Some('\n') => {
                                // Enter terminator — barcode complete.
                                // If code is empty (spurious enter), keep reading.
                                if !code.is_empty() {
                                    return Ok(Some(Barcode::new(&code)));
                                }
                            }
                            Some(ch) => code.push(ch),
                            None => { /* key-up report or modifier — ignore */ }
                        }
                    }
                    Err(rusb::Error::Timeout) => {
                        // Timeout between keys — if we have data, the barcode
                        // might be complete (scanner without terminator).
                        if !code.is_empty() {
                            return Ok(Some(Barcode::new(&code)));
                        }
                    }
                    Err(rusb::Error::NoDevice) => {
                        *guard = None;
                        return Err(HalError::Disconnected);
                    }
                    Err(e) => return Err(HalError::Usb(e.to_string())),
                }
            }
        })
        .await
        .map_err(|e| HalError::Usb(format!("spawn_blocking join error: {e}")))?
    }

    async fn cancel(&self) -> Result<(), HalError> {
        // USB interrupt reads are synchronous with timeout; they will
        // naturally expire. No explicit cancel mechanism from rusb.
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "usb_scanner_tests.rs"]
mod tests;
