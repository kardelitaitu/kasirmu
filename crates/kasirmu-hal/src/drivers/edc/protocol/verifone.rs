/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: PLANNED stub — all codec methods fail closed via stub_error
next: none until a Verix handler | perf: N/A
*/
//! Verifone SSL / Verix protocol codec — PLANNED (stub).
//!
//! Implements [`ProtocolCodec`] for Verifone terminals (VX520, VX680,
//! P400, VX 820). Verifone uses a custom SSL (Secure Socket Layer —
//! unrelated to TLS) protocol over serial or TCP, with Verix as the
//! application runtime.

use oz_core::Money;

use super::{ProtocolCodec, ProtocolMessage, stub_error};
use crate::error::HalError;

/// Verifone-specific protocol codec.
///
/// **STUB:** every method returns [`HalError::Unsupported`] until the real
/// Verifone SSL/Verix protocol handler is implemented.
#[derive(Debug, Clone, Copy)]
pub struct VerifoneCodec;

impl ProtocolCodec for VerifoneCodec {
    fn vendor(&self) -> &'static str {
        "verifone"
    }

    fn encode_sale(&self, _amount: Money, _reference: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("verifone", "encode_sale"))
    }

    fn encode_refund(&self, _amount: Money, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("verifone", "encode_refund"))
    }

    fn encode_void(&self, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("verifone", "encode_void"))
    }

    fn decode(&self, _wire_data: &[u8]) -> Result<ProtocolMessage, HalError> {
        Err(stub_error("verifone", "decode"))
    }
}
