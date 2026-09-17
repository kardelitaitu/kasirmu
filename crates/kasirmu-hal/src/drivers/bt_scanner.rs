/*
last audited 25-07-26 by RSA-Agent (oz-hal slice C: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean driver — no unwrap/panic/unsafe
next: none | perf: N/A
*/
//! Bluetooth (SPP / RFCOMM) barcode scanner driver.
//!
//! Implements [`BarcodeScanner`](crate::traits::barcode::BarcodeScanner) over a Bluetooth serial (SPP) connection.
//! Most BT barcode scanners (Honeywell 1450g BT, Zebra DS2278 BT, Datalogic
//! PowerScan BT) use the Serial Port Profile, which appears as a virtual COM
//! port (Windows) or `/dev/rfcomm*` (Linux) after pairing.
//!
//! The user pairs the scanner with the OS, then enters the port name in the
//! setup wizard, or the driver auto-discovers paired BT serial ports.
//!
//! ## Platform notes
//!
//! - **Windows:** Paired BT SPP devices appear as `COM` ports (e.g. `COM7`).
//! - **Linux:** Paired BT SPP devices appear as `/dev/rfcomm0` or similar.
//! - **macOS:** Paired BT SPP devices appear as `/dev/tty.NAME-DevB` or
//!   `/dev/cu.NAME-DevB`.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::barcode::BarcodeScanner;
use crate::transport::serial::{SerialPortInfo, open_port};
use crate::types::{Barcode, DeviceInfo};

/// Default baud rate for Bluetooth SPP barcode scanners.
///
/// Most BT scanners default to 9600 baud in SPP mode. Some high-speed
/// models support 115200; configure via `Self::new()`.
pub const DEFAULT_BAUD: u32 = 9600;

/// A barcode scanner driven through a Bluetooth serial (SPP) connection.
pub struct BtBarcodeScanner {
    port_name: String,
    baud_rate: u32,
    /// Wrapped in `Option` to detect "not connected" vs "disconnected".
    port: Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    info: DeviceInfo,
}

impl BtBarcodeScanner {
    /// Create a new Bluetooth SPP scanner targeting the given port.
    ///
    /// `info` should come from [`probe_bluetooth()`](crate::transport::serial::probe_bluetooth)
    /// or from user configuration.
    pub fn new(info: SerialPortInfo, baud_rate: u32) -> Self {
        let device_info = DeviceInfo::new("Bluetooth", &info.description, &info.port_name);

        Self {
            port_name: info.port_name,
            baud_rate,
            port: Arc::new(Mutex::new(None)),
            info: device_info,
        }
    }

    /// Create a new Bluetooth scanner at the default baud rate (9600).
    pub fn new_default(info: SerialPortInfo) -> Self {
        Self::new(info, DEFAULT_BAUD)
    }

    /// Discover all Bluetooth SPP serial ports and return a driver for each.
    ///
    /// This scans the OS for paired Bluetooth serial devices. Returns an
    /// empty `Vec` if no BT serial ports are found (no hardware, not paired,
    /// or platform doesn't support enumeration).
    pub fn discover_all() -> Vec<Self> {
        let ports = match crate::transport::serial::probe_bluetooth() {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        ports.into_iter().map(Self::new_default).collect()
    }
}

#[async_trait]
impl BarcodeScanner for BtBarcodeScanner {
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

        let mut port = open_port(&self.port_name, self.baud_rate).map_err(|e| {
            HalError::Bluetooth(format!(
                "failed to open BT SPP port {}: {e}",
                self.port_name
            ))
        })?;

        // Set read timeout so poll() doesn't block forever.
        port.set_timeout(std::time::Duration::from_millis(500))
            .map_err(|e| {
                HalError::Bluetooth(format!("BT set_timeout on {}: {e}", self.port_name))
            })?;

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
                .ok_or(HalError::Bluetooth("not connected".into()))?;

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
        .map_err(|e| HalError::Bluetooth(format!("BT poll join error: {e}")))?
    }

    async fn cancel(&self) -> Result<(), HalError> {
        // Serial reads on BT SPP ports have short timeouts; they'll
        // expire naturally without explicit cancellation.
        Ok(())
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "bt_scanner_tests.rs"]
mod tests;
