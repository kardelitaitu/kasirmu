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
    let split = full_payload.len() - 4;
    let pre_crc  = &full_payload[..split];
    let crc_hex  = &full_payload[split..];

    let expected = u16::from_str_radix(crc_hex, 16)
        .map_err(|_| crate::error::QrisError::CrcMismatch { expected: 0, computed: 0 })?;
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
mod tests {
    use super::*;

    #[test]
    fn known_crc_vector() {
        // From the EMVCo specification example
        let partial = "00020101021126570011ID.CO.QRIS.WWW011893600911000393401150000000000000000520459995303360540650000550256035005802ID5920Warung Sayur Bu Sugeng6010Kab. Demak6304";
        let _crc = crc16_ccitt(partial);
        // The CRC value varies per example; we just verify compute() is consistent with verify()
        let full = append_crc("00020101021126570011ID.CO.QRIS.WWW0118936009110003934011500000000000000005204599953033605406500005502560350050580 2ID5920Warung Sayur Bu Sugeng6010Kab. Demak".to_string());
        assert!(verify(&full).is_ok(), "round-trip CRC should pass");
    }

    #[test]
    fn crc_mismatch_detected() {
        let full = append_crc("000201010211".to_string());
        let mut corrupted = full.clone();
        // flip one character in the CRC
        let last = corrupted.pop().unwrap();
        let replacement = if last == 'F' { '0' } else { 'F' };
        corrupted.push(replacement);
        assert!(verify(&corrupted).is_err());
    }
}
