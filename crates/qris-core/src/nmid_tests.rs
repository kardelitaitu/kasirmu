//! Unit tests for `nmid`.
//!
//! Moved out of `nmid.rs` to satisfy the AGENTS.md section 2 rule that unit
//! tests live in a sibling `*_tests.rs` file rather than inside a production
//! `.rs` file. Wired from `nmid.rs` with:
//!   `#[cfg(test)] #[path = "nmid_tests.rs"] mod tests;`

use super::*;

#[test]
fn parse_valid_nmid() {
    let info = NmidInfo::parse("ID1020001234567").unwrap();
    assert_eq!(info.country_code, "ID");
    assert_eq!(info.acquirer_code, "1020");
    assert_eq!(info.merchant_number, "001234567");
    assert_eq!(info.raw, "ID1020001234567");
}

#[test]
fn reject_short_nmid() {
    assert!(NmidInfo::parse("ID102").is_err());
}

#[test]
fn reject_non_id_prefix() {
    assert!(NmidInfo::parse("MY1020001234567").is_err());
}

#[test]
fn reject_non_digit_acquirer() {
    assert!(NmidInfo::parse("IDABCD001234567").is_err());
}

#[test]
fn same_acquirer_check() {
    let a = NmidInfo::parse("ID1020001234567").unwrap();
    let b = NmidInfo::parse("ID1020009876543").unwrap();
    let c = NmidInfo::parse("ID9999001234567").unwrap();
    assert!(a.same_acquirer(&b));
    assert!(!a.same_acquirer(&c));
}
