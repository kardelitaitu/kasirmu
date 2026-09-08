use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

/// Move the seeded row onto another tier.
///
/// `fresh_db` seeds a signed, active Free row, and the signature covers
/// `signed_payload` only — never `tier_key` — so rewriting the column keeps
/// the row `loaded` and changes the projected tier. That is what makes this
/// a test of the tier GATE rather than of signature verification.
fn set_tier(conn: &Connection, tier_key: &str) {
    conn.execute(
        "UPDATE tenant_subscription SET tier_key = ?1 WHERE tenant_id = 'default'",
        [tier_key],
    )
    .unwrap();
}

/// Every persisted row, as (user_id, action, outcome, target_id, details).
fn rows(conn: &Connection) -> Vec<(String, String, String, String, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT user_id, action, outcome, COALESCE(target_id,''), COALESCE(details,'{}')
             FROM audit_log ORDER BY created_at ASC",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
    })
    .unwrap()
    .map(|r| r.unwrap())
    .collect()
}

fn single_row(conn: &Connection) -> (String, String, String, String, String) {
    let all = rows(conn);
    assert_eq!(all.len(), 1, "expected exactly one audit row, got {all:?}");
    all.into_iter().next().unwrap()
}

// ── the tier gate ────────────────────────────────────────────────

#[test]
fn paid_tier_records_login_success() {
    let conn = fresh();
    set_tier(&conn, "premium");
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::login_success("user-1", "owner", Some("term-7")),
            false,
        )
        .unwrap();
    assert!(recorded, "a paid tier records");
    let (user_id, action, outcome, target_id, details) = single_row(&conn);
    assert_eq!(user_id, "user-1");
    assert_eq!(action, SECURITY_ACTION_LOGIN);
    assert_eq!(outcome, "success");
    assert_eq!(target_id, "user-1");
    assert!(details.contains("owner"));
    assert!(details.contains("term-7"));
}

#[test]
fn free_tier_records_nothing() {
    // The adopted rule: Free keeps no tenant-facing audit records.
    let conn = fresh();
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::login_success("user-1", "owner", None::<String>),
            false,
        )
        .unwrap();
    assert!(!recorded, "Free is gated out");
    assert!(rows(&conn).is_empty(), "and nothing is written");
}

#[test]
fn one_time_tier_records_nothing() {
    // The deprecated perpetual license resolves as the free quota tier, so
    // it carries no retention entitlement and no security events either.
    let conn = fresh();
    set_tier(&conn, "one_time");
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::login_failed(
                "attacker",
                SECURITY_REASON_BAD_PIN,
                Some("user-1"),
                None::<String>,
            ),
            false,
        )
        .unwrap();
    assert!(!recorded);
    assert!(rows(&conn).is_empty());
}

#[test]
fn every_paid_tier_records() {
    for tier in ["plus", "pro", "premium", "enterprise"] {
        let conn = fresh();
        set_tier(&conn, tier);
        let recorded = store(&conn)
            .record_security_event(
                &SecurityEvent::login_success("user-1", "owner", None::<String>),
                false,
            )
            .unwrap();
        assert!(recorded, "{tier} has a retention window, so it records");
    }
}

#[test]
fn a_tampered_row_still_records_because_silencing_the_audit_is_the_attack() {
    // The fail-open arm. build_entitlements projects Free for an
    // unverifiable row; honouring that projection would let anyone who can
    // write one column turn off the security trail and act un-audited. The
    // skip therefore requires a CONFIRMED Free row, not the fail-closed
    // guess of one.
    let conn = fresh();
    conn.execute(
        "UPDATE tenant_subscription SET signature = ?1 WHERE tenant_id = 'default'",
        ["bm90LWEtcmVhbC1zaWduYXR1cmU="],
    )
    .unwrap();
    let ent = crate::entitlements::build_entitlements(
        &store(&conn),
        crate::availability::UsageCounts::default(),
        false,
    );
    assert!(!ent.loaded, "the row is unreadable");
    assert_eq!(ent.tier, crate::subscription::SubscriptionTier::Free);

    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::login_failed("root", SECURITY_REASON_BAD_PIN, None, Some("term-1")),
            false,
        )
        .unwrap();
    assert!(
        recorded,
        "an unreadable tier must not disable the audit trail"
    );
    assert_eq!(rows(&conn).len(), 1);
}

#[test]
fn a_deleted_subscription_row_still_records() {
    // Same arm, reached by deleting the row instead of corrupting it.
    let conn = fresh();
    conn.execute("DELETE FROM tenant_subscription", []).unwrap();
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::login_success("user-1", "owner", None::<String>),
            false,
        )
        .unwrap();
    assert!(recorded);
    assert_eq!(rows(&conn).len(), 1);
}

// ── the three event kinds ────────────────────────────────────────

#[test]
fn login_failure_records_the_catalog_action_and_classifier() {
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::login_failed(
                "owner",
                SECURITY_REASON_BAD_PIN,
                Some("user-1"),
                Some("term-3"),
            ),
            false,
        )
        .unwrap();
    let (user_id, action, outcome, target_id, details) = single_row(&conn);
    assert_eq!(action, "login.failed", "the value auditCatalog.ts maps");
    assert_eq!(outcome, "failure");
    assert_eq!(user_id, "user-1");
    assert_eq!(target_id, "user-1");
    let json: serde_json::Value = serde_json::from_str(&details).unwrap();
    assert_eq!(json["reason"], "wrong_pin");
    assert_eq!(json["username"], "owner");
    assert_eq!(json["device_id"], "term-3");
}

#[test]
fn unknown_account_targets_the_attempted_username() {
    // No users row exists to point at, so the attempted name is the only
    // identity — and it must land in target_id, not just details, or a
    // brute-force pattern against a non-existent account cannot be grouped.
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::login_failed(
                "ghost",
                SECURITY_REASON_UNKNOWN_USER,
                None,
                Some("term-9"),
            ),
            false,
        )
        .unwrap();
    let (user_id, action, outcome, target_id, _) = single_row(&conn);
    assert_eq!(user_id, SYSTEM_ACTOR);
    assert_eq!(target_id, "ghost");
    assert_eq!(action, SECURITY_ACTION_LOGIN_FAILED);
    assert_eq!(outcome, "failure");
}

#[test]
fn logout_records_for_a_paid_tier() {
    let conn = fresh();
    set_tier(&conn, "plus");
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::logout("user-2", "manager", Some("term-1")),
            false,
        )
        .unwrap();
    assert!(recorded);
    let (_, action, outcome, target_id, _) = single_row(&conn);
    assert_eq!(action, SECURITY_ACTION_LOGOUT);
    assert_eq!(outcome, "success", "a logout is not a failure");
    assert_eq!(target_id, "user-2");
}

#[test]
fn rate_limited_lockout_is_its_own_classifier() {
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::login_failed(
                "owner",
                SECURITY_REASON_RATE_LIMITED,
                None,
                Some("term-1"),
            ),
            false,
        )
        .unwrap();
    let (_, _, _, _, details) = single_row(&conn);
    assert!(details.contains("rate_limited"));
}

// ── invariants of the write path ─────────────────────────────────

#[test]
fn details_never_carry_a_credential() {
    // The recorder accepts no PIN or hash at all, so the only way one gets in
    // is a future call site inventing a field. Pin the shape of the payload
    // instead: exactly the three keys, none of them secret-named.
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::login_failed(
                "owner",
                SECURITY_REASON_BAD_PIN,
                Some("user-1"),
                Some("term-1"),
            ),
            false,
        )
        .unwrap();
    let (_, _, _, _, details) = single_row(&conn);
    let json: serde_json::Value = serde_json::from_str(&details).unwrap();
    let obj = json.as_object().unwrap();
    let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["device_id", "reason", "username"]);
    // The assertion is about KEY names, not substrings: the classifier value
    // "wrong_pin" legitimately names what failed without carrying it.
    for key in obj.keys() {
        for banned in ["pin", "password", "hash", "token", "secret", "credential"] {
            assert!(
                !key.to_lowercase().contains(banned),
                "secret-named key '{key}' reached the audit table"
            );
        }
    }
    // And no value is the PIN the attempt was made with.
    const PIN: &str = "1234";
    for value in obj.values() {
        assert_ne!(
            value.as_str(),
            Some(PIN),
            "a credential reached the audit table"
        );
    }
}

#[test]
fn a_security_row_is_still_immutable() {
    // Written through log_audit, so the append-only triggers apply unchanged:
    // the 20260920 carve-out exempts only DELETE during a sweep, and an
    // UPDATE is blocked with no exception at all.
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::login_success("user-1", "owner", None::<String>),
            false,
        )
        .unwrap();
    let err = conn
        .execute("UPDATE audit_log SET outcome = 'success' WHERE 1=1", [])
        .unwrap_err();
    assert!(err.to_string().contains("immutable"), "got: {err}");
}

#[test]
fn recorded_events_honour_the_retention_window() {
    // The two halves of the baseline meet here: a security event is retained
    // for exactly the tier window and then swept.
    let conn = fresh();
    set_tier(&conn, "plus"); // 90 days
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-old', 'user-1', 'login', 'user', 'user-1', '{}', 'success', '2099-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let deleted = store(&conn)
        .sweep_audit_retention(
            &crate::subscription::SubscriptionTier::Plus,
            "2100-01-01T00:00:00.000Z",
        )
        .unwrap();
    assert_eq!(deleted, 1, "the expired security event is swept");
    assert!(rows(&conn).is_empty());
}

#[test]
fn events_accumulate_one_row_per_event() {
    let conn = fresh();
    set_tier(&conn, "premium");
    let s = store(&conn);
    for i in 0..3 {
        s.record_security_event(
            &SecurityEvent::login_failed(
                format!("user{i}"),
                SECURITY_REASON_BAD_PIN,
                None,
                None::<String>,
            ),
            false,
        )
        .unwrap();
    }
    assert_eq!(rows(&conn).len(), 3);
}

#[test]
fn debug_upgrade_records_on_a_dev_free_row() {
    // Desktop passes debug_upgrade: True for its caps and audit reads. In a
    // debug build that promotes the seeded active Free row to Premium, so the
    // dev machine keeps its security trail; apply_debug_upgrade is
    // cfg!(debug_assertions)-gated, so a release build keeps the Free rule.
    let conn = fresh();
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::login_success("user-1", "owner", None::<String>),
            true,
        )
        .unwrap();
    assert_eq!(recorded, cfg!(debug_assertions));
}
