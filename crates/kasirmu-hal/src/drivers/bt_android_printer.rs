//! Android Bluetooth (SPP) receipt printer — ESC/POS over an RFCOMM socket.
//!
//! The Android counterpart of [`crate::drivers::serial_printer`]: same lazy
//! connect, same one-`write`-per-job shape, same ESC/POS body — only the
//! transport differs. Where the OS gives serial a `COM7`/`/dev/rfcomm0`
//! device file, Android only offers the Java `BluetoothSocket`, so this
//! driver holds a [`crate::transport::bt_android::BtRfcommStream`] instead of
//! a `Box<dyn SerialPort>`.
//!
//! The cash drawer needs no driver of its own: the existing
//! [`crate::drivers::drawer::PrinterKickCashDrawer`] wraps any
//! `Arc<dyn ReceiptPrinter>`, so the one Bluetooth link drives printer and
//! drawer both — exactly what the manifest note promised.
//!
//! Identity is the **MAC address**, not a port name: the setup wizard saves
//! `address` into the terminal profile and
//! [`crate::registry::DriverRegistry::register_bt_android_printer`] rebuilds
//! the driver from it at startup.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::printer::ReceiptPrinter;
use crate::transport::bt_android::BtRfcommStream;
use crate::types::DeviceInfo;

use super::escpos;

/// A receipt printer driven over Bluetooth SPP on Android.
pub struct AndroidBtReceiptPrinter {
    address: String,
    stream: Arc<Mutex<Option<BtRfcommStream>>>,
    info: DeviceInfo,
    partial_cut: bool,
}

impl AndroidBtReceiptPrinter {
    /// Create a printer for the paired device at `address` (MAC address).
    ///
    /// Opens nothing: a saved profile pointing at a device that is off or
    /// out of range must not block startup, so the first connect happens on
    /// the first print and its error surfaces there.
    pub fn new(address: impl Into<String>, info: DeviceInfo) -> Self {
        Self {
            address: address.into(),
            stream: Arc::new(Mutex::new(None)),
            info,
            partial_cut: false,
        }
    }

    /// The MAC address this printer connects to.
    #[must_use]
    pub fn address(&self) -> &str {
        &self.address
    }

    /// Use a partial cut instead of a full cut.
    #[must_use]
    pub fn with_partial_cut(mut self, partial: bool) -> Self {
        self.partial_cut = partial;
        self
    }

    /// One driver per bonded Bluetooth device — the setup wizard's picker
    /// list. Never fails: a device without a reachable stack yields an
    /// empty list, and connecting is the first print's job.
    pub fn discover_all() -> Vec<Self> {
        let devices = match crate::transport::bt_android::paired_devices() {
            Ok(d) => d,
            Err(_) => return Vec::new(),
        };
        devices
            .into_iter()
            .map(|d| {
                let info = DeviceInfo::new("AndroidBt", &d.name, &d.address);
                Self::new(d.address, info)
            })
            .collect()
    }

    async fn ensure_connected(&self) -> Result<(), HalError> {
        let mut guard = self.stream.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        // Same blocking-open hazard as the serial printer: an SPP connect to
        // an out-of-range device blocks for seconds, so it runs on a
        // blocking thread rather than stalling a runtime worker.
        let address = self.address.clone();
        let stream = spawn_blocking(move || BtRfcommStream::connect(&address))
            .await
            .map_err(|e| HalError::Bluetooth(format!("bt connect join error: {e}")))??;

        *guard = Some(stream);
        Ok(())
    }

    async fn write_to_stream(&self, data: &[u8]) -> Result<(), HalError> {
        let stream_arc = self.stream.clone();
        let data_owned = data.to_vec();

        spawn_blocking(move || {
            let mut guard = stream_arc.blocking_lock();
            let stream = guard
                .as_mut()
                .ok_or_else(|| HalError::Bluetooth("not connected".into()))?;
            use std::io::Write;
            stream
                .write_all(&data_owned)
                .map_err(|e| HalError::Io(std::io::Error::other(e.to_string())))?;
            stream
                .flush()
                .map_err(|e| HalError::Io(std::io::Error::other(e.to_string())))?;
            Ok(())
        })
        .await
        .map_err(|e| HalError::Bluetooth(format!("bt write join error: {e}")))?
    }
}

#[async_trait]
impl ReceiptPrinter for AndroidBtReceiptPrinter {
    async fn print_receipt(&self, body: &str) -> Result<(), HalError> {
        self.ensure_connected().await?;
        let data = escpos::format_receipt(body);
        self.write_to_stream(&data).await
    }

    async fn print_raw(&self, data: &[u8]) -> Result<(), HalError> {
        self.ensure_connected().await?;
        self.write_to_stream(data).await
    }

    async fn cut(&self) -> Result<(), HalError> {
        self.ensure_connected().await?;
        let data = if self.partial_cut {
            escpos::CUT_PARTIAL.to_vec()
        } else {
            escpos::CUT_FULL.to_vec()
        };
        self.write_to_stream(&data).await
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "bt_android_printer_tests.rs"]
mod tests;
