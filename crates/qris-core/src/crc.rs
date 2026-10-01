//! CRC-16/CCITT checksum used by the QRIS specification.
//!
//! Parameters: polynomial `0x1021`, initial value `0xFFFF`,
//! no input/output reflection, no final XOR.

/// Compute CRC-16/CCITT over the given byte string.
///
/// The QRIS spec requires that the CRC covers everything from the start of the
/// payload up to and **including** the tag/length prefix `"6304"`, but **not**
/// including the four hex digits of the CRC value itself.
pub(crate) fn crc16_ccitt(input: &str) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for byte in input.bytes() {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// Append the CRC field (`"6304XXXX"`) to a partial QRIS string.
///
/// `partial` must contain all fields except the CRC itself. This function
/// appends `"6304"` (tag + length), computes the CRC over the result, then
/// appends the four uppercase hex digits.
pub(crate) fn append_crc(mut partial: String) -> String {
    partial.push_str("6304");
    let crc = crc16_ccitt(&partial);
    partial.push_str(&format!("{crc:04X}"));
    partial
}

/// Verify the CRC of a complete QRIS string.
///
/// The last eight characters of a well-formed payload are `"6304XXXX"` where
/// `XXXX` is the four-character uppercase hex CRC.
pub(crate) fn verify(full_payload: &str) -> Result<(), crate::error::QrisError> {
    if full_payload.len() < 8 {
        return Err(crate::error::QrisError::TooShort {
            needed: 8,
            got: full_payload.len(),
        });
    }
    // QRIS-C: the four CRC characters are four BYTES, and slicing a `str` at a
    // byte index panics when it is not a char boundary. A payload whose last
    // four bytes land mid-codepoint (any non-ASCII text near the end) used to
    // abort `is_valid_qris`/`parse` instead of returning `false`/`Err`.
    let split = full_payload.len() - 4;
    let (pre_crc, crc_hex) = match full_payload.split_at_checked(split) {
        Some(pair) => pair,
        None => {
            return Err(crate::error::QrisError::CrcMismatch {
                expected: 0,
                computed: 0,
            });
        }
    };

    let expected =
        u16::from_str_radix(crc_hex, 16).map_err(|_| crate::error::QrisError::CrcMismatch {
            expected: 0,
            computed: 0,
        })?;
    let computed = crc16_ccitt(pre_crc);

    if expected != computed {
        Err(crate::error::QrisError::CrcMismatch { expected, computed })
    } else {
        Ok(())
    }
}

/// Compute and return the 4-character uppercase hex CRC for a partial payload.
///
/// This is the public-facing variant exposed via [`crate::compute_crc`].
pub fn compute(partial: &str) -> String {
    let mut input = partial.to_string();
    input.push_str("6304");
    let crc = crc16_ccitt(&input);
    format!("{crc:04X}")
}

#[cfg(test)]
#[path = "crc_tests.rs"]
mod tests;
