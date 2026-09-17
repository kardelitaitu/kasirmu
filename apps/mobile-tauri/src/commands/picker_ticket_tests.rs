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
