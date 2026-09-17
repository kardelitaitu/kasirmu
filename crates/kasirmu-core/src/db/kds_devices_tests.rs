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
