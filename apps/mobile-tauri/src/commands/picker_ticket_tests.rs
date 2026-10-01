use super::*;

fn secret() -> Vec<u8> {
    b"test-picker-ticket-secret".to_vec()
}

#[test]
fn roundtrip_returns_user_id() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    let user = verify_picker_ticket(&secret(), &sig, 1_799_900_000);
    assert_eq!(user.as_deref(), Some("user-owner"));
}

#[test]
fn expired_ticket_is_rejected() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    assert_eq!(verify_picker_ticket(&secret(), &sig, 1_800_000_301), None);
}

/// The command layer must not derive a verify timestamp from a DEFAULTED clock.
///
/// `verify_picker_ticket` tests `expiry_ts < now_ts`, so `now_ts = 0` accepts every
/// ticket ever minted. That is a property of the comparison and cannot be pinned
/// from here — a first version of this test asserted exactly that, and PASSED with
/// the comparison deliberately rewritten to `(now_ts != 0 && expiry_ts < now_ts)`,
/// i.e. it was a false green. The invariant that actually changed is the CALLER's:
/// it used to read
/// `SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()`, supplying
/// `0` on an unreadable clock.
///
/// So this asserts over the SOURCE, the technique `apps/cloud-server/src/sync_api_tests.rs`
/// uses for source contracts, because the property is 'the command refuses rather
/// than defaults' — which no behavioural test of a pure function can observe.
/// `include_str!` on the command file makes the coupling explicit: reintroduce the
/// default in `auth.rs` and this fails.
#[test]
fn the_session_command_does_not_verify_a_ticket_against_a_defaulted_clock() {
    let command_source = include_str!("auth.rs");

    // WHITESPACE-INSENSITIVE, and that is not tidiness. The first version of this
    // assertion compared a literal string and PASSED with the defect restored:
    // `cargo fmt` reflows the four-call chain onto separate lines, so the literal
    // never matched and the gate could not see the shape it was written to catch.
    // A source contract must survive the formatter, so whitespace is stripped first.
    let compact: String = command_source
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();

    assert!(
        !compact.contains("duration_since(UNIX_EPOCH).unwrap_or_default()")
            && !compact.contains("duration_since(std::time::UNIX_EPOCH).unwrap_or_default()"),
        "the command must refuse an unreadable clock, not timestamp a ticket as 0"
    );
    assert!(
        command_source.contains("now_unix_secs()"),
        "the command must obtain its timestamp from the fail-closed helper"
    );
}

#[test]
fn forged_ticket_is_rejected() {
    let sig = sign_picker_ticket(b"attacker-secret".as_slice(), "user-owner", 1_800_000_000);
    assert_eq!(verify_picker_ticket(&secret(), &sig, 1_799_900_000), None);
}

#[test]
fn tampered_signature_is_rejected() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    let tampered = format!("{}X", &sig[..sig.len() - 1]);
    assert_eq!(
        verify_picker_ticket(&secret(), &tampered, 1_799_900_000),
        None
    );
}

#[test]
fn tampered_user_id_is_rejected() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    let rest = sig.trim_start_matches("user-owner");
    let rebound = format!("user-cashier{rest}");
    assert_eq!(
        verify_picker_ticket(&secret(), &rebound, 1_799_900_000),
        None
    );
}

#[test]
fn malformed_ticket_is_rejected() {
    assert_eq!(
        verify_picker_ticket(&secret(), "garbage", 1_799_900_000),
        None
    );
    assert_eq!(verify_picker_ticket(&secret(), "", 1_799_900_000), None);
    assert_eq!(
        verify_picker_ticket(&secret(), "user-owner.1800000000", 1_799_900_000),
        None
    );
}

#[test]
fn ttl_constant_matches_window() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    assert_eq!(
        verify_picker_ticket(&secret(), &sig, 1_800_000_000),
        Some("user-owner".to_owned())
    );
    assert_eq!(
        verify_picker_ticket(&secret(), &sig, 1_800_000_000 + 1),
        None
    );
    assert_eq!(PICKER_TICKET_TTL_SECS, 300);
}
