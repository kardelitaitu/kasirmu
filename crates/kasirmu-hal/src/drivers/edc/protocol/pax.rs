/*
last audited 31-08-26 by DSH-Agent (moved in from oz-payment during the HAL unification)
crate: oz-hal | status: SAFE | lint: CLEAN
findings: PLANNED stub — all codec methods fail closed via stub_error
next: none until a DCC handler | perf: N/A
*/
//! PAX DCC protocol codec — PLANNED (stub).
//!
//! Implements [`ProtocolCodec`] for PAX terminals (S80, S300, S920, A920).
//! PAX uses the DCC (Device Configuration and Communication) protocol over
//! serial, USB, or Bluetooth — a packet-based protocol with a fixed
//! header, command/response structure, and CRC.

use oz_core::Money;

use super::{ProtocolCodec, ProtocolMessage, stub_error};
use crate::error::HalError;

/// PAX-specific protocol codec.
///
/// **STUB:** every method returns [`HalError::Unsupported`] until the real
/// PAX DCC protocol handler is implemented.
#[derive(Debug, Clone, Copy)]
pub struct PaxCodec;

impl ProtocolCodec for PaxCodec {
    fn vendor(&self) -> &'static str {
        "pax"
    }

    fn encode_sale(&self, _amount: Money, _reference: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("pax", "encode_sale"))
    }

    fn encode_refund(&self, _amount: Money, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("pax", "encode_refund"))
    }

    fn encode_void(&self, _transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Err(stub_error("pax", "encode_void"))
    }

    fn decode(&self, _wire_data: &[u8]) -> Result<ProtocolMessage, HalError> {
        Err(stub_error("pax", "decode"))
    }
}
