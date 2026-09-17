/*
last audited 25-07-26 by RSA-Agent (oz-hal slice C: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean driver — no unwrap/panic/unsafe
next: none | perf: N/A
*/
//! Serial barcode scanner driver (stub).
//!
//! Implements `BarcodeScanner` via a serial (RS-232 / USB-serial) port.
//! Many barcode scanners (Honeywell, Datalogic, Zebra) support serial
//! communication as an alternative to USB HID.
//!
//! **Stub status:** This driver is functional for common serial scanners
//! that output barcode data terminated by `\r` or `\n`. Per-vendor
//! protocol negotiation (e.g. configuring the scanner's baud rate via
//! serial commands) is not yet implemented — the scanner must be
//! pre-configured to match the baud rate used here.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::barcode::BarcodeScanner;
use crate::transport::serial::{SerialPortInfo, open_port};
use crate::types::{Barcode, DeviceInfo};

/// Common baud rates supported by most serial barcode scanners.
pub const DEFAULT_BAUD: u32 = 9600;

/// A barcode scanner driven through a serial port.
pub struct SerialBarcodeScanner {
    port_name: String,
    baud_rate: u32,
    /// Wrapped in `Option` so we can detect "not connected" vs "disconnected".
    port: Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    info: DeviceInfo,
}

impl SerialBarcodeScanner {
    /// Create a new serial scanner stub targeting the given port.
    pub fn new(info: SerialPortInfo, baud_rate: u32) -> Self {
        let device_info = DeviceInfo::new("serial", &info.description, &info.port_name);

        Self {
            port_name: info.port_name,
            baud_rate,
            port: Arc::new(Mutex::new(None)),
            info: device_info,
        }
    }

    /// Create a new serial scanner at the default baud rate (9600).
    pub fn new_default(info: SerialPortInfo) -> Self {
        Self::new(info, DEFAULT_BAUD)
    }

    /// Discover serial ports connected via a known USB-serial adapter and
    /// return a driver for each one.
    pub fn discover_all() -> Vec<Self> {
        let ports = match crate::transport::serial::probe_ports(true) {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        ports.into_iter().map(Self::new_default).collect()
    }
}

#[async_trait]
impl BarcodeScanner for SerialBarcodeScanner {
    async fn connect(&self) -> Result<Box<dyn BarcodeScanner>, HalError> {
        let mut guard = self.port.lock().await;
        if guard.is_some() {
            return Ok(Box::new(Self {
                port_name: self.port_name.clone(),
                baud_rate: self.baud_rate,
                port: self.port.clone(),
                info: self.info.clone(),
            }));
        }

        let mut port = open_port(&self.port_name, self.baud_rate)?;

        // Enable read timeout so poll() doesn't block forever.
        port.set_timeout(std::time::Duration::from_millis(500))
            .map_err(|e| HalError::Protocol(format!("serial set_timeout: {e}")))?;

        *guard = Some(port);

        Ok(Box::new(Self {
            port_name: self.port_name.clone(),
            baud_rate: self.baud_rate,
            port: self.port.clone(),
            info: self.info.clone(),
        }))
    }

    async fn poll(&mut self, timeout_ms: u32) -> Result<Option<Barcode>, HalError> {
        let port_arc = self.port.clone();

        spawn_blocking(move || {
            let mut guard = port_arc.blocking_lock();
            let port = guard
                .as_mut()
                .ok_or(HalError::NotFound("not connected".into()))?;

            let timeout = std::time::Duration::from_millis(timeout_ms as u64);
            let deadline = std::time::Instant::now() + timeout;

            let mut buf = Vec::with_capacity(64);

            loop {
                if std::time::Instant::now() >= deadline {
                    return if buf.is_empty() {
                        Ok(None)
                    } else {
                        let code = String::from_utf8_lossy(&buf).trim().to_owned();
                        Ok(Some(Barcode::new(code)))
                    };
                }

                let mut byte = [0u8; 1];
                match port.read(&mut byte) {
                    Ok(0) | Err(_) => {
                        if buf.is_empty() {
                            return Ok(None);
                        }
                        let code = String::from_utf8_lossy(&buf).trim().to_owned();
                        return Ok(Some(Barcode::new(code)));
                    }
                    Ok(1) => {
                        if byte[0] == b'\r' || byte[0] == b'\n' {
                            if buf.is_empty() {
                                continue;
                            }
                            let code = String::from_utf8_lossy(&buf).trim().to_owned();
                            return Ok(Some(Barcode::new(code)));
                        }
                        buf.push(byte[0]);
                    }
                    Ok(n) => {
                        for &b in &byte[..n] {
                            if b == b'\r' || b == b'\n' {
                                if buf.is_empty() {
                                    continue;
                                }
                                let code = String::from_utf8_lossy(&buf).trim().to_owned();
                                return Ok(Some(Barcode::new(code)));
                            }
                            buf.push(b);
                        }
                    }
                }
            }
        })
        .await
        .map_err(|e| HalError::Usb(format!("serial poll join error: {e}")))?
    }

    async fn cancel(&self) -> Result<(), HalError> {
        // Serial reads have short timeouts; they'll expire naturally.
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "serial_scanner_tests.rs"]
mod tests;
