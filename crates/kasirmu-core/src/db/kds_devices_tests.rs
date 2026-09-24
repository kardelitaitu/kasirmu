//! Tests for KDS device pairing validation (F9 hardening).
//!
//! Coverage: constant-time hash comparison, fail-closed expiry parsing,
//! bare-date tolerance, expired-token rejection. Lives in a sibling file
//! per repo convention (no unit tests in production files).

use super::*;

fn fresh() -> rusqlite::Connection {
    crate::migrations::fresh_db()
}

fn store(conn: &rusqlite::Connection) -> Store<'_> {
    Store::new(conn)
}

const TOKEN_HASH: &str = "a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8";

fn seed_device(conn: &rusqlite::Connection, id: &str, expires_at: &str) {
    // restaurant_pos_id has an FK to terminals(id) — seed the owner first.
    conn.execute(
        "INSERT OR IGNORE INTO terminals (id, name, device_id, is_active) VALUES ('pos-1', 'POS 1', 'dev-pos-1', 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO kds_devices (id, name, restaurant_pos_id, station_ids, pairing_token_hash, pairing_expires_at, created_at, updated_at)
         VALUES (?1, ?2, 'pos-1', '[]', ?3, ?4, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
        rusqlite::params![id, format!("dev-{id}"), TOKEN_HASH, expires_at],
    )
    .unwrap();
}

/// An unparseable (corrupt or tampered) expiry must FAIL CLOSED — the
/// previous `if let Ok(...)` silently skipped the check entirely, letting
/// a malformed value bypass pairing validation.
#[test]
fn validate_pairing_token_fails_closed_on_malformed_expiry() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "not-a-timestamp");

    let err = s.validate_pairing_token(TOKEN_HASH, "dev-1").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "pairing_expires_at"),
        "malformed expiry must be rejected, got: {err:?}"
    );
}

/// A bare `YYYY-MM-DD` value (legacy/fixture shape) is still enforced:
/// parsed as UTC midnight, an already-past bare date is expired.
#[test]
fn validate_pairing_token_rejects_past_bare_date() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2020-01-01");

    let err = s.validate_pairing_token(TOKEN_HASH, "dev-1").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "pairing_expires_at"),
        "past bare date must count as expired, got: {err:?}"
    );
}

/// Hash comparison must still reject a different token.
#[test]
fn validate_pairing_token_rejects_hash_mismatch() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01");

    let other = "b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8a1";
    let err = s.validate_pairing_token(other, "dev-1").unwrap_err();
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "token_hash"),
        "hash mismatch must be rejected, got: {err:?}"
    );
}

/// A non-expired token (far-future bare date) validates.
#[test]
fn validate_pairing_token_accepts_valid_future_expiry() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01");

    assert!(s.validate_pairing_token(TOKEN_HASH, "dev-1").unwrap());
}

/// A nonexistent device returns Ok(false) (documented contract).
#[test]
fn validate_pairing_token_unknown_device_returns_false() {
    let conn = fresh();
    let s = store(&conn);
    assert!(
        !s.validate_pairing_token(TOKEN_HASH, "no-such-device")
            .unwrap()
    );
}

/// RFC 3339 timestamps remain supported alongside the bare-date shape.
#[test]
fn validate_pairing_token_accepts_rfc3339_future_expiry() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");
    assert!(s.validate_pairing_token(TOKEN_HASH, "dev-1").unwrap());
}

// ── Issuing and consuming (the missing halves) ─────────────────────

/// The producer stores only the hash. A leaked database row must not reveal
/// a usable code, and the plaintext must not be recoverable from the row.
#[test]
fn issue_pairing_token_stores_hash_not_plaintext() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");

    let token = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();
    assert!(!token.is_empty());

    let stored: String = conn
        .query_row(
            "SELECT pairing_token_hash FROM kds_devices WHERE id = 'dev-1'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stored, hash_pairing_token(&token));
    assert_ne!(stored, token, "the plaintext must never be stored");
}

/// The issued token verifies against the validator — i.e. producer and
/// validator agree on the hash format. Without this, a generator that hashed
/// differently would pass its own test and fail every real pairing.
#[test]
fn issued_token_validates() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");
    let token = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();

    assert!(s.validate_pairing_token(&hash_pairing_token(&token), "dev-1").unwrap());
}

/// Issuing to an unknown device is refused rather than silently no-op'ing —
/// an UPDATE that matched nothing must not look like success.
#[test]
fn issue_pairing_token_refuses_unknown_device() {
    let conn = fresh();
    let s = store(&conn);
    let err = s
        .issue_pairing_token("nobody", chrono::Duration::minutes(10))
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { .. }), "got: {err:?}");
}

/// The whole point of the repair: a code is redeemable exactly once.
#[test]
fn consume_pairing_token_is_single_use() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");
    let token = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();

    s.consume_pairing_token(&token, "dev-1")
        .expect("the first redemption must succeed");

    // The replay. This is the defect: before consumption existed, the second
    // call answered Ok(()) for the whole TTL because nothing was mutated.
    let err = s
        .consume_pairing_token(&token, "dev-1")
        .expect_err("a redeemed code must never be redeemable again");
    assert!(
        matches!(err, CoreError::Validation { ref message, .. } if message.contains("already been redeemed")),
        "replay must be refused as consumed, got: {err:?}"
    );
}

/// Consumption is recorded, so an operator can tell a spent code from one
/// that was never issued instead of seeing both as a mismatch.
#[test]
fn consume_pairing_token_records_the_redemption() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");
    let token = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();
    s.consume_pairing_token(&token, "dev-1").unwrap();

    let (consumed_at, consumed_by): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT consumed_at, consumed_by_device FROM kds_devices WHERE id = 'dev-1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(consumed_at.is_some(), "consumption must be timestamped");
    assert_eq!(consumed_by.as_deref(), Some("dev-1"));
}

/// Re-issuing clears the consumption, so a device that lost its code can be
/// paired again. Without this the first redemption would brick the device.
#[test]
fn reissue_makes_the_device_pairable_again() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");
    let first = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();
    s.consume_pairing_token(&first, "dev-1").unwrap();

    let second = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();
    assert_ne!(first, second, "re-issuing must mint a fresh token");
    s.consume_pairing_token(&second, "dev-1")
        .expect("a freshly issued code must be redeemable");
}

/// A wrong token must not consume a good one — validation precedes the claim.
#[test]
fn a_wrong_token_does_not_consume_the_real_one() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2099-01-01T00:00:00.000Z");
    let token = s
        .issue_pairing_token("dev-1", chrono::Duration::minutes(10))
        .unwrap();

    assert!(s.consume_pairing_token("wrong-token", "dev-1").is_err());

    s.consume_pairing_token(&token, "dev-1")
        .expect("the real code must still be redeemable after a wrong attempt");
}

/// An expired code is refused, and refused *before* being consumed — so the
/// expiry check cannot be bypassed by ordering.
#[test]
fn consume_refuses_an_expired_token() {
    let conn = fresh();
    let s = store(&conn);
    seed_device(&conn, "dev-1", "2020-01-01T00:00:00.000Z");

    // `consume_pairing_token` takes the PLAINTEXT and hashes it, so seeding a
    // token whose hash matches TOKEN_HASH requires the preimage. Seeding a new
    // device with the token's own hash is what makes the expiry the first
    // check to fail rather than the hash — otherwise the mismatch fires first
    // and this test would pass for the wrong reason.
    let token = "expired-plaintext-token";
    conn.execute(
        "UPDATE kds_devices SET pairing_token_hash = ?1 WHERE id = 'dev-1'",
        rusqlite::params![hash_pairing_token(token)],
    )
    .unwrap();

    let err = s
        .consume_pairing_token(token, "dev-1")
        .expect_err("an expired code must not be redeemable");
    assert!(
        matches!(err, CoreError::Validation { field, .. } if field == "pairing_expires_at"),
        "expiry must be the refusal, got: {err:?}"
    );
}
