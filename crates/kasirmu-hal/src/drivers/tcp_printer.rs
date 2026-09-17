/*
last audited 25-07-26 by RSA-Agent (oz-hal slice B: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean driver — no unwrap/panic/unsafe, sibling tests per convention
next: none | perf: N/A
*/
//! TCP / network receipt printer driver.
//!
//! Implements `ReceiptPrinter` over raw TCP (port 9100). Many POS
//! printers support this directly: Epson TM-i series, Star mC-Print3,
//! Bixolon SRP-350plus, etc. The printer receives the data as-is and
//! interprets it as ESC/POS commands.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::net::TcpStream;
use tokio::sync::Mutex;

use crate::error::HalError;
use crate::traits::printer::ReceiptPrinter;
use crate::transport::tcp;
use crate::types::DeviceInfo;

use super::escpos;

/// A receipt printer driven through a raw TCP (port 9100) connection.
pub struct TcpReceiptPrinter {
    addr: String,
    stream: Arc<Mutex<Option<TcpStream>>>,
    info: DeviceInfo,
    partial_cut: bool,
}

impl TcpReceiptPrinter {
    /// Create a new TCP printer targetting the given address.
    ///
    /// `addr` can be an IP (`"192.168.1.100"`) or hostname
    /// (`"printer.local"`). Port 9100 is used unless specified as
    /// `"host:port"`.
    pub fn new(addr: impl Into<String>, info: DeviceInfo) -> Self {
        Self {
            addr: addr.into(),
            stream: Arc::new(Mutex::new(None)),
            info,
            partial_cut: false,
        }
    }

    /// Set whether to use a partial cut instead of full cut.
    pub fn with_partial_cut(mut self, partial: bool) -> Self {
        self.partial_cut = partial;
        self
    }

    async fn ensure_connected(&self) -> Result<(), HalError> {
        let mut guard = self.stream.lock().await;
        if guard.is_some() {
            return Ok(());
        }

        let stream = tcp::connect(&self.addr).await?;
        *guard = Some(stream);
        Ok(())
    }

    /// Write `data` to the cached stream. If the write fails — which is
    /// the symptom of a stale/dropped connection (printer rebooted,
    /// network blip, idle TCP timeout) — the cached stream is discarded
    /// and a fresh connection is established for a single retry. Without
    /// this the driver is permanently stuck on a dead socket: the next
    /// `ensure_connected` still sees `guard.is_some()` and never
    /// reconnects, so every subsequent print silently fails or errors.
    async fn write_to_stream(&self, data: &[u8]) -> Result<(), HalError> {
        let mut guard = self.stream.lock().await;

        // First attempt: write to the cached stream (if any).
        if let Some(stream) = guard.as_mut() {
            match tcp::write_all(stream, data).await {
                Ok(()) => return Ok(()),
                // A write error likely means the cached connection is
                // dead. Drop it and fall through to reconnect + retry.
                Err(_e) => {
                    *guard = None;
                }
            }
        }

        // Reconnect and retry once. This also covers the first-ever
        // write when no stream is cached (though ensure_connected
        // normally handles that in the caller).
        let mut stream = tcp::connect(&self.addr).await?;
        match tcp::write_all(&mut stream, data).await {
            Ok(()) => {
                // Cache the healthy stream for future writes.
                *guard = Some(stream);
                Ok(())
            }
            // If the retry also failed, `guard` stays None so the next
            // call tries a fresh connect rather than reusing a bad stream.
            Err(e) => Err(e),
        }
    }
}

#[async_trait]
impl ReceiptPrinter for TcpReceiptPrinter {
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
#[path = "tcp_printer_tests.rs"]
mod tests;
