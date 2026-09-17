/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: PLANNED stub — all codec methods fail closed via stub_error
next: none until a Telium handler | perf: N/A
*/
//! Ingenico Telium / Telium 2 protocol codec — PLANNED (stub).
//!
//! Implements [`ProtocolCodec`] for Ingenico terminals (iPP320, iPP350,
//! Desk 3500, Lane 5000). Telium 2 uses a binary framing over serial
//! (RS-232) with a proprietary command set wrapped around ISO 8583
//! messages.

use oz_core::Money;

use super::{ProtocolCodec, ProtocolMessage, stub_error};
use crate::error::HalError;

/// Ingenico-specific protocol codec.
///
/// **STUB:** every method returns [`HalError::Unsupported`] until the real
/// Telium/Telium2 protocol handler is implemented.
#[derive(Debug, Clone, Copy)]
pub struct IngenicoCodec;

impl ProtocolCodec for IngenicoCodec {
    fn vendor(&self) -> &'static str {
        "ingenico"
    }

    fn encode_sale(&self, _amount: Money, _reference: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("ingenico", "encode_sale"))
    }

    fn encode_refund(&self, _amount: Money, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("ingenico", "encode_refund"))
    }

    fn encode_void(&self, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("ingenico", "encode_void"))
    }

    fn decode(&self, _wire_data: &[u8]) -> Result<ProtocolMessage, HalError> {
        Err(stub_error("ingenico", "decode"))
    }
}
