/*
last audited 25-07-26 by RSA-Agent (oz-hal slice A: verified)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: clean
next: none | perf: N/A
*/
//! `CashDrawer` — the trait every cash-drawer driver implements.

use async_trait::async_trait;

use crate::error::HalError;
use crate::types::DeviceInfo;

/// A device that opens a cash drawer (via a pulse on the RJ12 kicker).
#[async_trait]
pub trait CashDrawer: Send + Sync {
    /// Pulse the kicker to open the drawer.
    async fn open(&self) -> Result<(), HalError>;

    /// Some drawers report their state (open/closed). The default
    /// implementation returns `Disconnected` because most don't.
    async fn is_open(&self) -> Result<bool, HalError> {
        Err(HalError::Disconnected)
    }

    /// Device identity, used in logs and the setup wizard.
    fn device_info(&self) -> DeviceInfo;
}

#[cfg(test)]
#[path = "cash_drawer_tests.rs"]
mod tests;
