/*
last audited 2026-09-29 by Antigravity
crate: kasirmu-hal | status: NEW | lint: CLEAN
findings: concrete implementation of ProtocolCodec for the loopback terminal simulator.
Implements standard POS binary framing with STX, length, command, payload, ETX, and LRC checksum.
Validates frame boundaries, truncation, and corruption to allow realistic protocol simulation before
vendor-specific binaries arrive.
next: vendor-specific codecs (pax, ingenico, verifone)
perf: zero-copy where possible; stack-allocated headers
*/
//! Loopback EDC protocol codec with standard POS binary framing.
//!
//! Real EDC terminals communicate over serial/USB/network using binary
//! framing on top of transaction data. This module provides a complete,
//! fully functional [`ProtocolCodec`] implementation for the loopback simulator:
//!
//! ```text
//! +------+--------+--------+-----+---------------+------+-----+
//! | STX  | LEN_HI | LEN_LO | CMD | PAYLOAD ...   | ETX  | LRC |
//! | 0x02 | 1 byte | 1 byte | 1 B | N bytes       | 0x03 | 1 B |
//! +------+--------+--------+-----+---------------+------+-----+
//! ```
//!
//! where:
//! - `STX` (0x02): Start of text.
//! - `LEN`: 2-byte big-endian length of the body (`CMD + PAYLOAD + ETX`).
//! - `CMD`: 1-byte command identifier (e.g. 0x01 = Sale, 0x81 = Sale Response).
//! - `PAYLOAD`: Command-specific payload.
//! - `ETX` (0x03): End of text.
//! - `LRC`: Longitudinal Redundancy Check — XOR of all bytes from `CMD` up to and
//!   including `ETX`.

use kasirmu_core::Money;

use super::{ProtocolCodec, ProtocolMessage};
use crate::error::HalError;

/// Start-of-text marker for POS framing.
pub const STX: u8 = 0x02;
/// End-of-text marker for POS framing.
pub const ETX: u8 = 0x03;

/// Sale request command byte.
pub const CMD_SALE_REQ: u8 = 0x01;
/// Refund request command byte.
pub const CMD_REFUND_REQ: u8 = 0x02;
/// Void request command byte.
pub const CMD_VOID_REQ: u8 = 0x03;
/// Status request command byte.
pub const CMD_STATUS_REQ: u8 = 0x00;

/// Status response command byte.
pub const CMD_STATUS_RESP: u8 = 0x80;
/// Sale response command byte.
pub const CMD_SALE_RESP: u8 = 0x81;
/// Refund response command byte.
pub const CMD_REFUND_RESP: u8 = 0x82;
/// Void response command byte.
pub const CMD_VOID_RESP: u8 = 0x83;

/// A fully functional protocol codec for loopback and simulator terminals.
#[derive(Debug, Clone, Copy, Default)]
pub struct LoopbackCodec;

impl LoopbackCodec {
    /// Calculate the Longitudinal Redundancy Check (LRC) over a slice of bytes.
    ///
    /// Computes the cumulative bitwise XOR of all input bytes.
    #[must_use]
    pub fn calculate_lrc(bytes: &[u8]) -> u8 {
        bytes.iter().fold(0u8, |acc, &b| acc ^ b)
    }

    /// Construct a complete framed packet with STX, Length, Body (CMD + Payload + ETX), and LRC.
    #[must_use]
    pub fn encode_frame(cmd: u8, payload: &[u8]) -> Vec<u8> {
        let mut body = Vec::with_capacity(1 + payload.len() + 1);
        body.push(cmd);
        body.extend_from_slice(payload);
        body.push(ETX);

        let len = body.len() as u16;
        let lrc = Self::calculate_lrc(&body);

        let mut frame = Vec::with_capacity(1 + 2 + body.len() + 1);
        frame.push(STX);
        frame.extend_from_slice(&len.to_be_bytes());
        frame.extend_from_slice(&body);
        frame.push(lrc);
        frame
    }

    /// Encode an approved sale response frame for testing and simulation.
    #[must_use]
    pub fn encode_sale_approved(
        transaction_id: &str,
        auth_code: &str,
        card_scheme: &str,
        card_last4: &str,
    ) -> Vec<u8> {
        let payload = format!("00|{transaction_id}|{auth_code}|{card_scheme}|{card_last4}");
        Self::encode_frame(CMD_SALE_RESP, payload.as_bytes())
    }

    /// Encode a declined sale response frame for testing and simulation.
    #[must_use]
    pub fn encode_sale_declined(reason: &str) -> Vec<u8> {
        let payload = format!("05|{reason}");
        Self::encode_frame(CMD_SALE_RESP, payload.as_bytes())
    }

    /// Encode a hardware fault error frame for testing and simulation.
    #[must_use]
    pub fn encode_error(code: u32, message: &str) -> Vec<u8> {
        let payload = format!("99|{code}|{message}");
        Self::encode_frame(CMD_SALE_RESP, payload.as_bytes())
    }

    /// Encode a ready status response frame.
    #[must_use]
    pub fn encode_ready() -> Vec<u8> {
        Self::encode_frame(CMD_STATUS_RESP, b"READY")
    }
}

impl ProtocolCodec for LoopbackCodec {
    fn vendor(&self) -> &'static str {
        "loopback"
    }

    fn encode_sale(&self, amount: Money, reference: &str) -> Result<Vec<u8>, HalError> {
        let payload = format!("{}|{}", amount.minor_units, reference);
        Ok(Self::encode_frame(CMD_SALE_REQ, payload.as_bytes()))
    }

    fn encode_refund(&self, amount: Money, transaction_id: &str) -> Result<Vec<u8>, HalError> {
        let payload = format!("{}|{}", amount.minor_units, transaction_id);
        Ok(Self::encode_frame(CMD_REFUND_REQ, payload.as_bytes()))
    }

    fn encode_void(&self, transaction_id: &str) -> Result<Vec<u8>, HalError> {
        Ok(Self::encode_frame(CMD_VOID_REQ, transaction_id.as_bytes()))
    }

    fn decode(&self, wire_data: &[u8]) -> Result<ProtocolMessage, HalError> {
        if wire_data.len() < 6 {
            return Err(HalError::Protocol(format!(
                "loopback frame too short: minimum 6 bytes required, got {}",
                wire_data.len()
            )));
        }

        if wire_data[0] != STX {
            return Err(HalError::Protocol(format!(
                "invalid loopback framing: expected STX (0x02), got 0x{:02X}",
                wire_data[0]
            )));
        }

        let body_len = u16::from_be_bytes([wire_data[1], wire_data[2]]) as usize;
        let expected_total_len = 1 + 2 + body_len + 1; // STX + LEN + BODY + LRC

        if wire_data.len() < expected_total_len {
            return Err(HalError::Protocol(format!(
                "loopback frame truncated: expected {expected_total_len} bytes, got {}",
                wire_data.len()
            )));
        }

        let body = &wire_data[3..3 + body_len];
        if body.is_empty() || body[body.len() - 1] != ETX {
            return Err(HalError::Protocol(
                "invalid loopback framing: body does not terminate with ETX (0x03)".into(),
            ));
        }

        let received_lrc = wire_data[3 + body_len];
        let calculated_lrc = Self::calculate_lrc(body);
        if received_lrc != calculated_lrc {
            return Err(HalError::Protocol(format!(
                "loopback LRC checksum mismatch: expected 0x{calculated_lrc:02X}, got 0x{received_lrc:02X}"
            )));
        }

        let cmd = body[0];
        let payload_bytes = &body[1..body.len() - 1]; // strip CMD and ETX
        let payload_str = std::str::from_utf8(payload_bytes).map_err(|e| {
            HalError::Protocol(format!("loopback payload is not valid UTF-8: {e}"))
        })?;

        match cmd {
            CMD_STATUS_RESP => Ok(ProtocolMessage::Ready),
            CMD_SALE_RESP | CMD_REFUND_RESP | CMD_VOID_RESP => {
                let parts: Vec<&str> = payload_str.split('|').collect();
                match parts.first().copied().unwrap_or("") {
                    "00" => {
                        let transaction_id = parts.get(1).copied().unwrap_or("").to_owned();
                        let auth_code = parts.get(2).copied().unwrap_or("").to_owned();
                        let card_scheme = parts
                            .get(3)
                            .copied()
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned);
                        let card_last4 = parts
                            .get(4)
                            .copied()
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned);
                        Ok(ProtocolMessage::Authorised {
                            transaction_id,
                            auth_code,
                            card_scheme,
                            card_last4,
                        })
                    }
                    "05" => {
                        let reason = parts.get(1).copied().map(str::to_owned);
                        Ok(ProtocolMessage::Declined { reason })
                    }
                    "99" => {
                        let code = parts.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(999);
                        let message = parts.get(2).copied().unwrap_or("unknown fault").to_owned();
                        Ok(ProtocolMessage::Error { code, message })
                    }
                    _ => Ok(ProtocolMessage::Raw(wire_data.to_vec())),
                }
            }
            _ => Ok(ProtocolMessage::Raw(wire_data.to_vec())),
        }
    }
}
