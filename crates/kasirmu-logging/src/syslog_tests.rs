//! Tests for `syslog.rs` — facility resolution and ident validation.
//!
//! The pure logic (`facility_code` and CString validation) is tested
//! here without touching the FFI: the actual `openlog`/`syslog` calls
//! only happen when `init_syslog` reaches the subscriber setup, which
//! requires a fresh global tracing subscriber (hard to reset in tests).

use super::*;

#[test]
fn known_facilities_resolve_to_distinct_codes() {
    let known = [
        "auth", "authpriv", "cron", "daemon", "ftp", "kern", "local0", "local1", "local2",
        "local3", "local4", "local5", "local6", "local7", "lpr", "mail", "news", "syslog", "user",
        "uucp",
    ];
    let codes: Vec<i32> = known
        .iter()
        .map(|f| facility_code(f).unwrap_or_else(|| panic!("missing facility {f}")))
        .collect();
    let mut unique = codes.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(unique.len(), codes.len(), "facility codes must be unique");
}

#[test]
fn local0_is_a_distinct_facility() {
    assert!(facility_code("local0").is_some());
    assert!(facility_code("local7").is_some());
    assert_ne!(facility_code("local0"), facility_code("local7"));
}

#[test]
fn unknown_facility_is_rejected() {
    assert_eq!(facility_code("unknown"), None);
    assert_eq!(facility_code(""), None);
    assert_eq!(
        facility_code("LOCAL0"),
        None,
        "facility names are case-sensitive"
    );
}

#[test]
fn valid_ident_accepts_plain_strings() {
    let ok = std::ffi::CString::new("oz-pos").is_ok();
    assert!(ok);
    assert!(std::ffi::CString::new("").is_ok());
}

#[test]
fn ident_with_null_byte_is_rejected() {
    assert!(std::ffi::CString::new("oz\0pos").is_err());
    assert!(std::ffi::CString::new("a\0b").is_err());
}
