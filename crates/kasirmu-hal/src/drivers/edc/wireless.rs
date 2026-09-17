/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: PLANNED stub — construction records the target and connects nothing; all ops fail closed with HalError::Unsupported. Changed on the move: `target` was a #[allow(dead_code)] write-only field, now reachable via target()/address() so the configured link is observable and the dead_code allowance is gone. Note WirelessTarget::Network duplicates what drivers/tcp_printer.rs already does for printers — when this driver is implemented it should reuse crate::transport::tcp rather than grow a second socket path.
next: Bluetooth/WiFi protocol handler | perf: N/A
*/
//! Wireless EDC payment terminal driver — STUB (PLANNED).
//!
//! A card-present payment terminal connected over Bluetooth (SPP/LE) or
//! the network (Ingenico APOS, PAX S920, Verifone P400 in wireless mode).
//!
//! **Status: PLANNED — stub only.** Construction records the connection
//! target, but no link is established and every operation returns
//! [`HalError::Unsupported`] until the real handler lands.

use async_trait::async_trait;
use oz_core::Money;

use crate::error::HalError;
use crate::traits::edc::{EdcPaymentResult, EdcTerminal, TerminalStatus};
use crate::types::DeviceInfo;

use super::stub_error;

/// How the wireless EDC terminal is addressed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WirelessTarget {
    /// Bluetooth SPP / LE device address (e.g. a MAC).
    Bluetooth(String),
    /// Network address (e.g. `192.168.1.50:9500`).
    Network(String),
}

impl WirelessTarget {
    /// The address string, whichever transport this target names.
    #[must_use]
    pub fn address(&self) -> &str {
        match self {
            Self::Bluetooth(a) | Self::Network(a) => a,
        }
    }

    /// `true` when this target is reached over the network rather than
    /// Bluetooth.
    #[must_use]
    pub fn is_network(&self) -> bool {
        matches!(self, Self::Network(_))
    }
}

/// A wireless (Bluetooth / network) EDC payment terminal.
///
/// **STUB:** construction records the connection target, but no link is
/// established. See the module docs for the planned implementation.
#[derive(Debug, Clone)]
pub struct WirelessEdcTerminal {
    target: WirelessTarget,
    info: DeviceInfo,
}

impl WirelessEdcTerminal {
    /// Create a new wireless EDC terminal at the given connection target.
    ///
    /// **STUB:** records the target but does not connect.
    #[must_use]
    pub fn new(target: WirelessTarget, info: DeviceInfo) -> Self {
        Self { target, info }
    }

    /// Create a new wireless EDC terminal reached over Bluetooth.
    #[must_use]
    pub fn over_bluetooth(address: impl Into<String>, info: DeviceInfo) -> Self {
        Self::new(WirelessTarget::Bluetooth(address.into()), info)
    }

    /// Create a new wireless EDC terminal reached over the network.
    #[must_use]
    pub fn over_network(address: impl Into<String>, info: DeviceInfo) -> Self {
        Self::new(WirelessTarget::Network(address.into()), info)
    }

    /// How this terminal is addressed.
    #[must_use]
    pub fn target(&self) -> &WirelessTarget {
        &self.target
    }

    /// The configured address, whichever transport the target names.
    #[must_use]
    pub fn address(&self) -> &str {
        self.target.address()
    }
}

#[async_trait]
impl EdcTerminal for WirelessEdcTerminal {
    async fn status(&self) -> Result<TerminalStatus, HalError> {
        Err(stub_error("wireless", "status"))
    }

    async fn authorize(&self, _amount: Money) -> Result<String, HalError> {
        Err(stub_error("wireless", "authorize"))
    }

    async fn capture(&self, _transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        Err(stub_error("wireless", "capture"))
    }

    async fn refund(
        &self,
        _transaction_id: &str,
        _amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError> {
        Err(stub_error("wireless", "refund"))
    }

    async fn void(&self, _transaction_id: &str) -> Result<EdcPaymentResult, HalError> {
        Err(stub_error("wireless", "void"))
    }

    async fn print_receipt(&self, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("wireless", "print_receipt"))
    }

    fn device_info(&self) -> DeviceInfo {
        self.info.clone()
    }
}

#[cfg(test)]
#[path = "wireless_tests.rs"]
mod tests;
