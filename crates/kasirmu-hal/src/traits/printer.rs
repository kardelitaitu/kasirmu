/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! `ReceiptPrinter` — the trait every receipt printer driver implements.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::HalError;
use crate::types::DeviceInfo;

/// Paper supply status returned by [`ReceiptPrinter::get_status`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PaperStatus {
    /// Paper is present and sufficient.
    Ok,
    /// Paper is running low (printer reports "near end").
    Low,
    /// Paper is empty / out.
    Empty,
}

/// Printer status snapshot returned by [`ReceiptPrinter::get_status`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterStatus {
    /// Paper supply level.
    pub paper: PaperStatus,
    /// Whether the printer cover is open (e.g. jam access).
    pub cover_open: bool,
    /// Whether the cash drawer kick port reports a drawer open state.
    pub drawer_open: bool,
}

impl PrinterStatus {
    /// Convenience check — returns `true` if the printer is ready to print.
    #[must_use]
    pub fn is_ready(&self) -> bool {
        self.paper == PaperStatus::Ok && !self.cover_open
    }

    /// Convenience check — returns `true` if a critical issue prevents
    /// printing (no paper or cover open).
    #[must_use]
    pub fn has_fault(&self) -> bool {
        self.paper == PaperStatus::Empty || self.cover_open
    }
}

/// A device that prints customer receipts (and kitchen tickets, in the
/// future — that's a separate trait once it has more shape).
#[async_trait]
pub trait ReceiptPrinter: Send + Sync {
    /// Print a receipt. `body` is plain text; the driver is responsible
    /// for converting to the device's native format (ESC/POS, StarPRNT,
    /// etc.) and slicing the paper at the end.
    async fn print_receipt(&self, body: &str) -> Result<(), HalError>;

    /// Print raw bytes directly to the device (e.g. pre-formatted
    /// ESC/POS commands from the receipt builder). The default
    /// implementation converts bytes lossily to a string and delegates
    /// to `print_receipt` — real drivers override this to send the
    /// exact byte sequence.
    async fn print_raw(&self, data: &[u8]) -> Result<(), HalError> {
        let body = String::from_utf8_lossy(data);
        self.print_receipt(&body).await
    }

    /// Feed `n` blank lines after the receipt, then cut. Most drivers
    /// implement this as the standard ESC/POS sequence; a no-op default
    /// is provided for printers that don't expose a cutter.
    async fn cut(&self) -> Result<(), HalError> {
        Ok(())
    }

    /// Query the printer's current status (paper supply, cover, drawer).
    ///
    /// Returns a default `PrinterStatus { paper: Ok, cover.open: false,
    /// drawer_open: false }` for printers that don't expose a status
    /// channel — the caller should check before every print job and
    /// warn the operator when the printer isn't ready.
    async fn get_status(&self) -> Result<PrinterStatus, HalError> {
        Ok(PrinterStatus {
            paper: PaperStatus::Ok,
            cover_open: false,
            drawer_open: false,
        })
    }

    /// Device identity, used in logs and the setup wizard.
    fn device_info(&self) -> DeviceInfo;
}

#[cfg(test)]
#[path = "printer_tests.rs"]
mod tests;
