//! Low-level TLV (Tag–Length–Value) codec for QRIS payloads.
//!
//! QRIS uses a textual TLV format where:
//! - **Tag** = 2 decimal ASCII digits (e.g. `"26"`)
//! - **Length** = 2 decimal ASCII digits giving the byte length of the value
//! - **Value** = UTF-8 string of exactly `length` characters
//!
//! This module is `pub(crate)` — consumers use the higher-level types in
//! [`crate::payload`] and [`crate::builder`].

use crate::error::QrisError;

/// A single parsed TLV field.
#[derive(Debug, Clone)]
pub(crate) struct Tlv {
    /// The 2-digit decimal tag, stored as `u8` (0–99).
    pub tag: u8,
    /// The field value.
    pub value: String,
}

/// Parse a flat QRIS string into a list of top-level TLV fields.
///
/// Does **not** recurse into nested TLV structures (merchant account info,
/// additional data). Use [`parse_nested`] for those.
pub(crate) fn parse_tlvs(payload: &str) -> Result<Vec<Tlv>, QrisError> {
    // QRIS-A: offsets are BYTES, matching `encode_field`. The previous version
    // counted CHARACTERS while the encoder wrote the byte length, so any
    // non-ASCII value (an Indonesian merchant name, an accented store name)
    // made the two disagree and the payload failed to parse at all.
    let bytes = payload.as_bytes();
    let total = bytes.len();
    let mut result = Vec::new();
    let mut pos = 0;

    while pos < total {
        // Need at least tag(2) + len(2) = 4 bytes.
        if pos + 4 > total {
            return Err(QrisError::TooShort {
                needed: pos + 4,
                got: total,
            });
        }

        let tag = parse_two_digits(&bytes[pos..pos + 2]).map_err(|_| QrisError::BadLength {
            tag: 0,
            reason: "tag field is not a 2-digit decimal number",
        })?;
        pos += 2;

        let len = parse_two_digits(&bytes[pos..pos + 2]).map_err(|_| QrisError::BadLength {
            tag,
            reason: "length field is not a 2-digit decimal number",
        })? as usize;
        pos += 2;

        if pos + len > total {
            return Err(QrisError::BadLength {
                tag,
                reason: "length exceeds remaining payload",
            });
        }

        // A byte length that lands mid-codepoint means the payload is not the
        // text it claims to be; refuse it rather than panicking on the slice.
        let value = std::str::from_utf8(&bytes[pos..pos + len])
            .map_err(|_| QrisError::BadLength {
                tag,
                reason: "value is not valid UTF-8 at the declared length",
            })?
            .to_owned();
        result.push(Tlv { tag, value });
        pos += len;
    }

    Ok(result)
}

/// Parse exactly two ASCII decimal digits into a `u8`.
fn parse_two_digits(digits: &[u8]) -> Result<u8, ()> {
    let d0 = digits.first().ok_or(())?.wrapping_sub(b'0');
    let d1 = digits.get(1).ok_or(())?.wrapping_sub(b'0');
    if d0 > 9 || d1 > 9 {
        return Err(());
    }
    Ok(d0 * 10 + d1)
}

/// Parse nested sub-tags inside a Merchant Account Info or Additional Data value.
///
/// Uses the same TLV format as the top level.
pub(crate) fn parse_nested(value: &str) -> Result<Vec<Tlv>, QrisError> {
    parse_tlvs(value)
}

/// Encode a single (tag, value) pair as a QRIS TLV segment.
///
/// QRIS-B: returns `Err` rather than panicking when the value does not fit.
/// The length field is exactly two decimal digits, so 99 BYTES is the hard
/// ceiling — and the previous `assert!` was reachable from safe APIs
/// (`QrisBuilder::build()` → `to_qris_string()`) whose signatures gave the
/// caller no warning that a long merchant name could abort the process.
///
/// The length is the value's BYTE count, which is what the QRIS/EMVCo wire
/// format specifies and what `parse_tlvs` now reads back (QRIS-A).
pub(crate) fn encode_field(tag: u8, value: &str) -> Result<String, QrisError> {
    let len = value.len();
    if len > 99 {
        return Err(QrisError::FieldTooLong { tag, len });
    }
    Ok(format!("{tag:02}{len:02}{value}"))
}

/// Encode a set of sub-tag (tag, value) pairs as a nested TLV value string,
/// then wrap the whole thing as the value of `outer_tag`.
pub(crate) fn encode_nested(
    outer_tag: u8,
    inner_fields: &[(u8, &str)],
) -> Result<String, QrisError> {
    let mut inner = String::new();
    for (t, v) in inner_fields {
        inner.push_str(&encode_field(*t, v)?);
    }
    encode_field(outer_tag, &inner)
}

#[cfg(test)]
#[path = "tlv_tests.rs"]
mod tests;
