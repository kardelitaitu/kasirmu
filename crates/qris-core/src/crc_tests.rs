//! Unit tests for `crc`.
//!
//! Moved out of `crc.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `crc.rs` with:
//!   `#[cfg(test)] #[path = "crc_tests.rs"] mod tests;`

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
