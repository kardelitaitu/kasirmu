//! Tests for the tablet subscription commands (capabilities + feature-availability verdicts).
//!
//! Mirror of the desktop subscription_tests.rs slice that gates the shared
//! wire contract: an unknown feature key must fail closed (AppError::Invalid)
//! and a known key's verdict must echo that key in feature.

use super::*;
use rusqlite::Connection;

use oz_core::migrations;

/// A fresh, fully-migrated in-memory identity database.
fn fresh_db() -> Connection {
    migrations::fresh_db()
}

/// An owner user: role-owner's '*' grant holds every gate permission,
/// so the role axis never fires and the other axes stand alone.
fn verdict_with_owner(conn: &Connection, feature: &str) -> FeatureVerdict {
    conn.execute(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-owner', 'Owner', '', '[\"*\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')
         ON CONFLICT(id) DO NOTHING",
        [],
    )
    .unwrap();
    load_feature_verdict(conn, "user-owner", feature).unwrap()
}

#[test]
fn verdict_rejects_unknown_keys_fail_closed() {
    let conn = fresh_db();
    // An unrecognized key must never resolve to available.
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "analytics"),
        Err(AppError::Invalid(_))
    ));
    assert!(matches!(
        load_feature_verdict(&conn, "nobody", "max_stores"),
        Err(AppError::Invalid(_))
    ));
}

#[test]
fn verdict_echoes_feature_key_in_verdict() {
    let conn = fresh_db();
    let v = verdict_with_owner(&conn, "supports_analytics");
    assert_eq!(v.feature, "supports_analytics");

    let v = verdict_with_owner(&conn, "locations");
    assert_eq!(v.feature, "locations");

    let v = verdict_with_owner(&conn, "warehouses");
    assert_eq!(v.feature, "warehouses");
}
