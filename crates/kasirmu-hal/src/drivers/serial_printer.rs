/*
last audited 31-08-26 by DSH-Agent (moved from bt_printer.rs; the driver was always serial)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: renamed rather than duplicated. bootstrap.rs used to report a serial printer as rejected because drivers/ had no serial printer, but BtReceiptPrinter contained nothing Bluetooth-specific — it is open_port(name, baud) plus ESC/POS, and registry.rs constructs it from an ordinary serial port enumeration, not from a Bluetooth API. Writing a second 121-line copy would have produced two drivers to keep in step, which is the drift this crate keeps paying for. BtReceiptPrinter survives as a re-export so discovery, tests and the README keep naming the transport they found.
next: none | perf: lazy connect, one spawn_blocking per write; port stays open for the driver's lifetime
*/
//! Serial receipt printer driver — RS-232, USB-serial, and Bluetooth SPP.
//!
//! Implements [`ReceiptPrinter`] over any port the OS exposes as a serial
//! device. That covers three transports an operator can pick in the setup
//! wizard:
//!
//! | Transport | What the OS presents |
//! |---|---|
//! | RS-232 / USB-serial | `COM3`, `/dev/ttyUSB0` |
//! | Bluetooth SPP | `COM7` or `/dev/rfcomm0` after pairing |
//! | Virtual / emulated | any named port |
//!
//! Bluetooth is in this file rather than its own because the Serial Port
//! Profile *is* a serial port to the application: the pairing is the OS's
//! job and the driver only ever sees a name and a baud rate. What differs
//! between the two is how the port was found, so [`crate::registry`] keeps
//! separate registration helpers and this stays one driver.
//!
//! The port is opened lazily on first use and held open afterwards, so a
//! register that prints all day pays one `open` rather than one per receipt.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::printer::ReceiptPrinter;
use crate::transport::serial::open_port;
use crate::types::DeviceInfo;

use super::escpos;

/// Baud rate assumed when a saved profile predates the baud field.
pub const DEFAULT_BAUD: u32 = 9600;

/// A receipt printer driven through a serial port.
pub struct SerialReceiptPrinter {
    port_name: String,
    baud_rate: u32,
    port: Arc<Mutex<Option<Box<dyn serialport::SerialPort + Send>>>>,
    info: DeviceInfo,
    partial_cut: bool,
}

impl SerialReceiptPrinter {
    /// Create a printer for the given serial port and baud rate.
    ///
    /// Opens nothing: a saved profile pointing at a port that is not there
    /// must not block startup, so the first `open` happens on the first
    /// print and its error surfaces there.
    pub fn new(port_name: impl Into<String>, baud_rate: u32, info: DeviceInfo) -> Self {
        Self {
            port_name: port_name.into(),
            baud_rate,
            port: Arc::new(Mutex::new(None)),
            info,
            partial_cut: false,
        }
    }

    /// The port this printer writes to.
    #[must_use]
    pub fn port_name(&self) -> &str {
        &self.port_name
    }

    /// The baud rate this printer was configured with.
    #[must_use]
    pub fn baud_rate(&self) -> u32 {
        self.baud_rate
    }

    /// Use a partial cut instead of a full cut.
    #[must_use]
    pub fn with_partial_cut(mut self, partial: bool) -> Self {
        self.partial_cut = partial;
        self
    }

    async fn ensure_connected(&self) -> Result<(), HalError> {
        let mut guard = self.port.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        let mut port = open_port(&self.port_name, self.baud_rate)?;
        port.set_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| HalError::Protocol(format!("serial set_timeout: {e}")))?;

        *guard = Some(port);
        Ok(())
    }

    async fn write_to_port(&self, data: &[u8]) -> Result<(), HalError> {
        let port_arc = self.port.clone();
        let data_owned = data.to_vec();

        spawn_blocking(move || {
            let mut guard = port_arc.blocking_lock();
            let port = guard
                .as_mut()
                .ok_or(HalError::NotFound("not connected".into()))?;

            use std::io::Write;
            port.write_all(&data_owned).map_err(HalError::Io)?;
            port.flush().map_err(HalError::Io)?;
            Ok(())
        })
        .await
        .map_err(|e| HalError::Protocol(format!("serial write join error: {e}")))?
    }
}

#[async_trait]
impl ReceiptPrinter for SerialReceiptPrinter {
    async fn print_receipt(&self, body: &str) -> Result<(), HalError> {
        self.ensure_connected().await?;
        let data = escpos::format_receipt(body);
        self.write_to_port(&data).await
    }

    async fn print_raw(&self, data: &[u8]) -> Result<(), HalError> {
        self.ensure_connected().await?;
        self.write_to_port(data).await
    }

    async fn cut(&self) -> Result<(), HalError> {
        self.ensure_connected().await?;
        let data = if self.partial_cut {
            escpos::CUT_PARTIAL.to_vec()
        } else {
            escpos::CUT_FULL.to_vec()
        };
        self.write_to_port(&data).await
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "serial_printer_tests.rs"]
mod tests;
