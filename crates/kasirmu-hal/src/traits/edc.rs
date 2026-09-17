/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: trait is the hardware counterpart of oz-payment's PaymentProcessor; moved so card terminals share the registry, discovery and mandatory-mock convention like every other device class. De-leaked on arrival: the oz-payment version returned PaymentError and a domain PaymentReceipt, which HAL cannot depend on without a cycle. print_receipt now returns raw device bytes, matching ReceiptPrinter::print_raw. NOTE: the module this came from claimed the trait "supports settlement/batch-close operations that online processors don't need" but exposed no such method — the move is faithful, so no settle() was invented here; add it when a real driver needs it.
next: real vendor protocol in drivers/edc | perf: N/A — all methods are stubs returning Unsupported
*/
//! `EdcTerminal` — the trait every card-payment terminal driver implements.
//!
//! An EDC (Electronic Data Capture) terminal is a physical card device
//! (Ingenico, Verifone, PAX) that takes card-present payments by dip, tap
//! or swipe and talks to the acquirer over a vendor binary protocol. The
//! trait models the *device*: status, authorize/capture/refund/void, and
//! the receipt from its built-in printer. Online gateways (Midtrans,
//! Paddle) are a different thing and stay in `oz-payment`.
//!
//! Every method returns [`HalError`]. Drivers that are not yet implemented
//! must fail closed with [`HalError::Unsupported`] rather than report
//! success — the convention inherited from the `oz-payment` stubs.

use async_trait::async_trait;
use oz_core::Money;
use serde::{Deserialize, Serialize};

use crate::error::HalError;
use crate::types::DeviceInfo;

/// Status of a card-payment terminal, as reported by the device itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStatus {
    /// Terminal is idle and ready to accept a transaction.
    Ready,
    /// Terminal is mid-transaction and cannot take another.
    Busy,
    /// Terminal is not reachable (cable unplugged, out of range, off).
    Offline,
    /// Terminal's own receipt printer is out of, or low on, paper.
    PaperError,
    /// Terminal reported a hardware fault.
    Error,
}

impl TerminalStatus {
    /// Convenience check — `true` when a transaction can be started now.
    #[must_use]
    pub fn is_available(self) -> bool {
        self == Self::Ready
    }
}

/// The outcome of a card-present operation on a terminal.
///
/// Named `EdcPaymentResult` rather than `PaymentResult` on purpose: the
/// gateway-side `oz_payment::types::PaymentResult` is a different shape,
/// and the two sharing a name made the EDC type shadow it at every import
/// (PAY-11).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdcPaymentResult {
    /// Whether the card network approved the transaction.
    pub success: bool,
    /// Terminal- or acquirer-assigned transaction id.
    pub transaction_id: Option<String>,
    /// Authorisation code from the card network (e.g. `"001234"`).
    pub auth_code: Option<String>,
    /// Card scheme name (e.g. `"Visa"`, `"Mastercard"`).
    pub card_scheme: Option<String>,
    /// Last four digits of the card, for the receipt.
    pub card_last4: Option<String>,
    /// Human-readable message from the terminal.
    pub message: String,
}

/// A card-present payment terminal attached to the register.
///
/// `authorize` + `capture` are separate because a terminal can hold a
/// funds authorisation without taking the money; [`EdcTerminal::sale`]
/// covers the common case in one call.
#[async_trait]
pub trait EdcTerminal: Send + Sync {
    /// Query the terminal's current status.
    async fn status(&self) -> Result<TerminalStatus, HalError>;

    /// Authorise `amount` against a card, returning the transaction id.
    async fn authorize(&self, amount: Money) -> Result<String, HalError>;

    /// Capture a transaction previously returned by [`Self::authorize`].
    async fn capture(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError>;

    /// Authorize and capture in one operation.
    ///
    /// The default implementation chains [`Self::authorize`] and
    /// [`Self::capture`]; terminals with a native one-step sale override it.
    async fn sale(&self, amount: Money) -> Result<EdcPaymentResult, HalError> {
        let txn_id = self.authorize(amount).await?;
        self.capture(&txn_id).await
    }

    /// Refund a captured transaction. `None` refunds the full amount.
    async fn refund(
        &self,
        transaction_id: &str,
        amount: Option<Money>,
    ) -> Result<EdcPaymentResult, HalError>;

    /// Void a pending authorisation before it is captured.
    async fn void(&self, transaction_id: &str) -> Result<EdcPaymentResult, HalError>;

    /// Print a receipt for a completed transaction on the terminal's own
    /// built-in printer, returning the raw bytes the device was sent.
    ///
    /// Raw bytes rather than a domain receipt object: the terminal's
    /// printer speaks its own protocol, and shaping a customer-facing
    /// receipt is `oz-payment`'s job, not the driver's.
    async fn print_receipt(&self, transaction_id: &str) -> Result<Vec<u8>, HalError>;

    /// Static device identity (vendor, model, serial) for logs and setup.
    fn device_info(&self) -> DeviceInfo;
}

#[cfg(test)]
#[path = "edc_tests.rs"]
mod tests;
