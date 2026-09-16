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
    let mut result = Vec::new();
    let mut pos = 0;
    let chars: Vec<char> = payload.chars().collect();
    let total = chars.len();

    while pos < total {
        // Need at least tag(2) + len(2) = 4 characters
        if pos + 4 > total {
            return Err(QrisError::TooShort {
                needed: pos + 4,
                got: total,
            });
        }

        let tag_str: String = chars[pos..pos + 2].iter().collect();
        let tag = tag_str.parse::<u8>().map_err(|_| QrisError::BadLength {
            tag: 0,
            reason: "tag field is not a 2-digit decimal number",
        })?;
        pos += 2;

        let len_str: String = chars[pos..pos + 2].iter().collect();
        let len = len_str.parse::<usize>().map_err(|_| QrisError::BadLength {
            tag,
            reason: "length field is not a 2-digit decimal number",
        })?;
        pos += 2;

        if pos + len > total {
            return Err(QrisError::BadLength {
                tag,
                reason: "length exceeds remaining payload",
            });
        }

        let value: String = chars[pos..pos + len].iter().collect();
        result.push(Tlv { tag, value });
        pos += len;
    }

    Ok(result)
}

/// Parse nested sub-tags inside a Merchant Account Info or Additional Data value.
///
/// Uses the same TLV format as the top level.
pub(crate) fn parse_nested(value: &str) -> Result<Vec<Tlv>, QrisError> {
    parse_tlvs(value)
}

/// Encode a single (tag, value) pair as a QRIS TLV segment.
///
/// # Panics
/// Panics if `value.len() > 99` — the length field is exactly 2 decimal digits.
pub(crate) fn encode_field(tag: u8, value: &str) -> String {
    assert!(
        value.len() <= 99,
        "QRIS value length must be ≤ 99 characters (tag {:02}, len {})",
        tag,
        value.len()
    );
    format!("{:02}{:02}{}", tag, value.len(), value)
}

/// Encode a set of sub-tag (tag, value) pairs as a nested TLV value string,
/// then wrap the whole thing as the value of `outer_tag`.
pub(crate) fn encode_nested(outer_tag: u8, inner_fields: &[(u8, &str)]) -> String {
    let inner: String = inner_fields
        .iter()
        .map(|(t, v)| encode_field(*t, v))
        .collect();
    encode_field(outer_tag, &inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_simple() {
        let encoded = encode_field(0, "01");
        assert_eq!(encoded, "000201");
        let tlvs = parse_tlvs(&encoded).unwrap();
        assert_eq!(tlvs.len(), 1);
        assert_eq!(tlvs[0].tag, 0);
        assert_eq!(tlvs[0].value, "01");
    }

    #[test]
    fn round_trip_multiple() {
        let mut s = encode_field(0, "01");
        s.push_str(&encode_field(1, "11"));
        let tlvs = parse_tlvs(&s).unwrap();
        assert_eq!(tlvs.len(), 2);
        assert_eq!(tlvs[1].tag, 1);
        assert_eq!(tlvs[1].value, "11");
    }

    #[test]
    fn nested_round_trip() {
        let nested = encode_nested(26, &[(0, "ID.CO.QRIS.WWW"), (2, "ID1020001234567")]);
        let outer = parse_tlvs(&nested).unwrap();
        assert_eq!(outer.len(), 1);
        assert_eq!(outer[0].tag, 26);

        let inner = parse_nested(&outer[0].value).unwrap();
        assert_eq!(inner[0].tag, 0);
        assert_eq!(inner[0].value, "ID.CO.QRIS.WWW");
        assert_eq!(inner[1].tag, 2);
        assert_eq!(inner[1].value, "ID1020001234567");
    }
}
