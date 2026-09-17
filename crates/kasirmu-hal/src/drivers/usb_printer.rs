/*
last audited 25-07-26 by RSA-Agent (oz-hal slice B: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean driver — no unwrap/panic/unsafe, sibling tests per convention
next: none | perf: N/A
*/
//! USB receipt printer driver (stub).
//!
//! Implements `ReceiptPrinter` via USB bulk-out transfers. Supports
//! standard ESC/POS commands for text printing and paper cutting.
//!
//! **Stub status:** This driver sends plain text wrapped in minimal
//! ESC/POS formatting. Advanced features (character encoding selection,
//! barcode printing, logo upload, NV graphics) are not yet implemented.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::task::spawn_blocking;

use crate::error::HalError;
use crate::traits::printer::ReceiptPrinter;
use crate::transport::usb::UsbDeviceInfo;
use crate::types::DeviceInfo;

use super::escpos;

/// A receipt printer driven through a USB bulk OUT endpoint.
pub struct UsbReceiptPrinter {
    handle: Arc<Mutex<Option<rusb::DeviceHandle<rusb::Context>>>>,
    info: DeviceInfo,
    usb_info: UsbDeviceInfo,
    /// Whether to use a partial cut instead of a full cut.
    partial_cut: bool,
}

impl UsbReceiptPrinter {
    /// Attempt to create a driver for the given USB printer info.
    pub fn try_new(info: UsbDeviceInfo) -> Self {
        let device_info = DeviceInfo::new(&info.manufacturer, &info.product, &info.serial);

        Self {
            handle: Arc::new(Mutex::new(None)),
            info: device_info,
            usb_info: info,
            partial_cut: false,
        }
    }

    /// Set whether to use partial cut instead of full cut.
    pub fn with_partial_cut(mut self, partial: bool) -> Self {
        self.partial_cut = partial;
        self
    }

    /// Discover all known USB receipt printers.
    pub fn discover_all() -> Vec<Self> {
        let devices = match crate::transport::usb::probe_printers() {
            Ok(d) => d,
            Err(_) => return Vec::new(),
        };
        devices.into_iter().map(Self::try_new).collect()
    }

    async fn ensure_connected(&self) -> Result<(), HalError> {
        let mut guard = self.handle.lock().await;
        if guard.is_some() {
            return Ok(());
        }
        let handle = crate::transport::usb::open_device(
            self.usb_info.vid,
            self.usb_info.pid,
            self.usb_info.interface_number,
        )?;
        *guard = Some(handle);
        Ok(())
    }

    async fn write_to_endpoint(&self, data: &[u8]) -> Result<(), HalError> {
        self.ensure_connected().await?;

        let handle_arc = self.handle.clone();
        let ep_out = self
            .usb_info
            .endpoint_out
            .ok_or(HalError::NotFound("no OUT endpoint on printer".into()))?;

        let data_owned = data.to_vec();
        let timeout = Duration::from_secs(5);

        spawn_blocking(move || {
            let mut guard = handle_arc.blocking_lock();
            let handle = guard
                .as_mut()
                .ok_or(HalError::NotFound("not connected".into()))?;

            handle
                .write_bulk(ep_out, &data_owned, timeout)
                .map_err(|e| {
                    if matches!(e, rusb::Error::NoDevice) {
                        *guard = None;
                        HalError::Disconnected
                    } else {
                        HalError::Usb(e.to_string())
                    }
                })?;

            Ok(())
        })
        .await
        .map_err(|e| HalError::Usb(format!("write_bulk join error: {e}")))?
    }
}

#[async_trait]
impl ReceiptPrinter for UsbReceiptPrinter {
    async fn print_receipt(&self, body: &str) -> Result<(), HalError> {
        let data = escpos::format_receipt(body);
        self.write_to_endpoint(&data).await
    }

    async fn print_raw(&self, data: &[u8]) -> Result<(), HalError> {
        self.write_to_endpoint(data).await
    }

    async fn cut(&self) -> Result<(), HalError> {
        self.ensure_connected().await?;
        let cut_cmd = if self.partial_cut {
            escpos::CUT_PARTIAL
        } else {
            escpos::CUT_FULL
        };
        self.write_to_endpoint(cut_cmd).await
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "usb_printer_tests.rs"]
mod tests;
