/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: ProtocolCodec isolates wire format from transport — sound seam, unchanged by the move except the error type. The 25-07-26 audit already called this isolation correct; the only defect was that it returned PaymentError, which lives in the crate that depends on this one. stub_error keeps stub messages consistent.
next: real vendor framing | perf: N/A — all codecs are stubs
*/
//! EDC terminal protocol codecs — PLANNED (stubs).
//!
//! Real EDC terminals do not speak REST. They communicate over
//! serial/USB/Bluetooth using vendor-specific binary framing on top of
//! ISO 8583. This module isolates that wire format from the transport, so
//! a driver deals only with encoded bytes in and decoded
//! [`ProtocolMessage`]s out.
//!
//! Vendors:
//!
//! * [`IngenicoCodec`] — Telium / Telium 2 (iPP320, iPP350, Desk 3500).
//! * [`VerifoneCodec`] — Verifone SSL / Verix (VX520, VX680, P400).
//! * [`PaxCodec`] — PAX DCC (S80, S300, S920, A920).

pub mod ingenico;
pub mod pax;
pub mod verifone;

use oz_core::Money;

use crate::error::HalError;

/// A vendor-specific message that has been decoded from the wire.
#[derive(Debug, Clone)]
pub enum ProtocolMessage {
    /// Terminal is ready to accept a new transaction.
    Ready,
    /// Transaction was authorised by the acquirer.
    Authorised {
        /// Unique transaction identifier assigned by the terminal.
        transaction_id: String,
        /// Authorization code from the acquirer (e.g. `"001234"`).
        auth_code: String,
        /// Card scheme name (e.g. `"VISA"`), if the terminal reported one.
        card_scheme: Option<String>,
        /// Last 4 digits of the card number, if reported.
        card_last4: Option<String>,
    },
    /// Transaction was declined.
    Declined {
        /// Human-readable reason for the decline (e.g. "Insufficient funds").
        reason: Option<String>,
    },
    /// Terminal error / hardware fault.
    Error {
        /// Vendor-specific error code.
        code: u32,
        /// Human-readable error description.
        message: String,
    },
    /// Raw response the caller's state machine interprets itself.
    Raw(Vec<u8>),
}

/// Encodes and decodes a vendor-specific EDC protocol.
///
/// **PLANNED:** every method returns [`HalError::Unsupported`] until the
/// real vendor protocol is implemented.
pub trait ProtocolCodec: Send + Sync {
    /// The vendor name (e.g. `"ingenico"`, `"verifone"`, `"pax"`).
    fn vendor(&self) -> &'static str;

    /// Encode a *sale* command (amount + invoice reference) into the
    /// vendor's wire format for transmission.
    fn encode_sale(&self, amount: Money, reference: &str) -> Result<Vec<u8>, HalError>;

    /// Encode a *refund* command.
    fn encode_refund(&self, amount: Money, transaction_id: &str) -> Result<Vec<u8>, HalError>;

    /// Encode a *void / cancel* command.
    fn encode_void(&self, transaction_id: &str) -> Result<Vec<u8>, HalError>;

    /// Decode a response from the terminal into a structured message.
    fn decode(&self, wire_data: &[u8]) -> Result<ProtocolMessage, HalError>;
}

/// Shared helper: build the "not implemented" error for a vendor method.
///
/// Used by the stub codecs so every unimplemented method reports the same
/// shape of failure.
pub fn stub_error(vendor: &str, method: &str) -> HalError {
    HalError::Unsupported(format!(
        "{vendor} protocol codec `{method}` — PLANNED, not implemented yet"
    ))
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
