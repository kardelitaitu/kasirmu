/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: PLANNED stub — construction validates nothing and opens nothing; all ops fail closed with HalError::Unsupported. Changed on the move: the port_name/baud_rate fields were #[allow(dead_code)] write-only configuration, so nothing could ever observe what a terminal was pointed at. They now have accessors, which drops the dead_code allowance honestly and lets a setup wizard echo the configured link.
next: serial/USB protocol handler | perf: N/A
*/
//! Wired EDC payment terminal driver — STUB (PLANNED).
//!
//! A card-present payment terminal connected over a serial (RS-232) or
//! USB line (Ingenico iPP320, Verifone VX520, PAX S80 in wired mode).
//!
//! **Status: PLANNED — stub only.** Construction records the port
//! configuration, but no device is opened and every operation returns
//! [`HalError::Unsupported`] until the real protocol handler lands.

use async_trait::async_trait;
use oz_core::Money;

use crate::error::HalError;
use crate::traits::edc::{EdcPaymentResult, EdcTerminal, TerminalStatus};
use crate::types::DeviceInfo;

use super::stub_error;

/// Default baud rate for wired EDC terminals.
///
/// Most EDC terminals default to 9600 baud on serial; high-speed models
/// support 115200. Configurable via [`WiredEdcTerminal::new`].
pub const DEFAULT_BAUD: u32 = 9600;

/// A wired (serial / USB) EDC payment terminal.
///
/// **STUB:** construction records the port and baud rate, but no device is
/// opened. See the module docs for the planned implementation.
#[derive(Debug, Clone)]
pub struct WiredEdcTerminal {
    port_name: String,
    baud_rate: u32,
    info: DeviceInfo,
}

impl WiredEdcTerminal {
    /// Create a new wired EDC terminal targeting the given serial port.
    ///
    /// **STUB:** records the configuration but does not open the port.
    #[must_use]
    pub fn new(port_name: impl Into<String>, baud_rate: u32, info: DeviceInfo) -> Self {
        Self {
            port_name: port_name.into(),
            baud_rate,
            info,
        }
    }

    /// Create a new wired EDC terminal at [`DEFAULT_BAUD`].
    #[must_use]
    pub fn new_default(port_name: impl Into<String>, info: DeviceInfo) -> Self {
        Self::new(port_name, DEFAULT_BAUD, info)
    }

    /// The platform-specific device path this terminal is pointed at
    /// (e.g. `/dev/ttyUSB0`, `COM3`).
    #[must_use]
    pub fn port_name(&self) -> &str {
        &self.port_name
    }

    /// The baud rate this terminal is configured for.
    #[must_use]
    pub fn baud_rate(&self) -> u32 {
        self.baud_rate
    }
}

#[async_trait]
impl EdcTerminal for WiredEdcTerminal {
    async fn status(&self) -> Result<TerminalStatus, HalError> {
        Err(stub_error("wired", "status"))
    }

    async fn authorize(&self, _amount: Money) -> Result<String, HalError> {
        Err(stub_error("wired", "authorize"))
    }

    async fn capture(&self, _transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        Err(stub_error("wired", "capture"))
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError> {
        Err(stub_error("wired", "refund"))
    }

    async fn void(&self, _transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        Err(stub_error("wired", "void"))
    }

    async fn print_receipt(&self, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("wired", "print_receipt"))
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "wired_tests.rs"]
mod tests;
