//! Unit tests for the picker-ticket primitives (test relocation: moved
//! out of `apps/desktop-tauri/src/commands/picker_ticket_tests.rs`).
//!
//! Mounted at the foot of `picker.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `sign_picker_ticket`, `verify_picker_ticket`
//! and `PICKER_TICKET_TTL_SECS` from the bridge module directly — the
//! desktop shim is a pure `pub use` re-export of these same items.

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
    // Ticket valid until t+300; verify at t+301 → expired.
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    assert_eq!(verify_picker_ticket(&secret(), &sig, 1_800_000_301), None);
}

/// `now_ts = 0` accepts EVERY ticket, expired or not — the hazard callers must
/// never create.
///
/// The expiry test is `expiry_ts < now_ts`, so a pre-epoch clock satisfies it for
/// any ticket ever minted. That is not a bug in this function — it takes the clock
/// as a parameter and documents the requirement — but it IS the reason
/// `now_ts` must never be defaulted upstream.
///
/// `auth.rs` read the clock with `.unwrap_or_default()` in exactly this position,
/// which produced 0 on a pre-epoch clock: an expired picker ticket would verify and
/// the caller would mint a session from it. That now goes through a fail-closed
/// helper, and THIS test is the pin on why it must.
///
/// It is written to be the discriminating one: it fails if anyone makes the
/// zero-clock case look safe by changing the comparison, which would silently move
/// the hazard instead of removing it. VERIFIED: guarding the comparison with
/// `|| now_ts == 0` makes this test fail (left `None`, right `Some(user-owner)`).
#[test]
fn a_zero_clock_makes_every_ticket_verify_including_expired_ones() {
    // Expired at a real time: the ordinary test above rejects this at t+301.
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    assert_eq!(
        verify_picker_ticket(&secret(), &sig, 1_800_000_301),
        None,
        "control: this ticket IS expired at a real clock"
    );
    assert_eq!(
        verify_picker_ticket(&secret(), &sig, 0).as_deref(),
        Some("user-owner"),
        "a zero clock accepts the same expired ticket -- which is why no caller may pass 0"
    );
}

#[test]
fn forged_ticket_is_rejected() {
    // Signed with a different secret — must not verify.
    let sig = sign_picker_ticket(b"attacker-secret".as_slice(), "user-owner", 1_800_000_000);
    assert_eq!(verify_picker_ticket(&secret(), &sig, 1_799_900_000), None);
}

#[test]
fn tampered_signature_is_rejected() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    // Flip one hex char in the signature portion.
    let tampered = format!("{}X", &sig[..sig.len() - 1]);
    assert_eq!(
        verify_picker_ticket(&secret(), &tampered, 1_799_900_000),
        None
    );
}

#[test]
fn tampered_user_id_is_rejected() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    // Rebind the ticket to another user by swapping the prefix.
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
    // Only two parts — no signature.
    assert_eq!(
        verify_picker_ticket(&secret(), "user-owner.1800000000", 1_799_900_000),
        None
    );
}

#[test]
fn ttl_constant_matches_window() {
    let sig = sign_picker_ticket(&secret(), "user-owner", 1_800_000_000);
    // Valid exactly at expiry (inclusive boundary).
    assert_eq!(
        verify_picker_ticket(&secret(), &sig, 1_800_000_000),
        Some("user-owner".to_owned())
    );
    // Invalid one second after.
    assert_eq!(
        verify_picker_ticket(&secret(), &sig, 1_800_000_000 + 1),
        None
    );
    assert_eq!(PICKER_TICKET_TTL_SECS, 300);
}
