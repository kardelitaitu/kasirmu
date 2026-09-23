use super::*;
use crate::migrations;
use rusqlite::Connection;

/// A provisioned store database.
///
/// ADR #56 §2.6 stopped the baseline migration seeding the `Default Store`
/// location, the five `default-*` workspaces and the BOOTSTRAP_FREE
/// subscription — `provision_device` creates them now, in one transaction.
/// These tests exercise layers BELOW provisioning, so they run against what
/// provisioning produces. See `migrations::seed_provisioned_baseline`.
fn fresh() -> Connection {
    let conn = migrations::fresh_db();
    migrations::seed_provisioned_baseline(&conn);
    conn
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
fn org_switch_records_the_target_org() {
    let conn = fresh();
    set_tier(&conn, "premium");
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::org_switch("user-3", "owner", Some("term-1"), "org-a"),
            false,
        )
        .unwrap();
    assert!(recorded);
    let (user_id, action, outcome, target_id, _) = single_row(&conn);
    assert_eq!(action, SECURITY_ACTION_ORG_SWITCH);
    assert_eq!(outcome, "success", "a completed switch is not a failure");
    assert_eq!(user_id, "user-3", "the actor is the switching operator");
    assert_eq!(target_id, "org-a", "the org entered lands in target_id");
}

#[test]
fn org_switch_joins_the_readable_security_class() {
    // The allowlist rule from the module notes: an action missing from
    // SECURITY_ACTIONS is written but never readable. This pins org.switch
    // into the readable class so a later refactor cannot strand it.
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::org_switch("user-3", "owner", None::<String>, "org-a"),
            false,
        )
        .unwrap();
    let (items, total, _) = store(&conn)
        .list_security_events(None, None, None, None, 50)
        .unwrap();
    assert_eq!(total, 1, "org.switch must be readable as a security event");
    assert_eq!(items[0].action, SECURITY_ACTION_ORG_SWITCH);
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

// ── administrative security events (staff create / update / PIN) ─

#[test]
fn staff_create_records_actor_and_subject_apart() {
    // The house convention: user_id is WHO DID IT, target_id is WHO IT WAS
    // DONE TO — the same split staff.identity.read already uses. A trail
    // that recorded only the created account could not answer "who made
    // this admin?".
    let conn = fresh();
    set_tier(&conn, "premium");
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::staff_change(
                "user-admin",
                "user-new",
                "jdoe",
                SECURITY_ACTION_USER_CREATE,
                SECURITY_REASON_ACCOUNT_CREATED,
            ),
            false,
        )
        .unwrap();
    assert!(recorded);
    let (user_id, action, outcome, target_id, details) = single_row(&conn);
    assert_eq!(user_id, "user-admin", "actor");
    assert_eq!(target_id, "user-new", "subject");
    assert_eq!(action, "user.create", "already in auditCatalog.ts");
    assert_eq!(outcome, "success");
    let json: serde_json::Value = serde_json::from_str(&details).unwrap();
    assert_eq!(
        json["username"], "jdoe",
        "the subject's name, not the actor's"
    );
    assert_eq!(json["reason"], "account_created");
}

#[test]
fn pin_rotation_is_a_user_update_with_its_own_classifier() {
    // No new action string is invented: the catalog has no pin key, so the
    // rotation rides user.update and stays separable through its reason.
    let conn = fresh();
    set_tier(&conn, "premium");
    store(&conn)
        .record_security_event(
            &SecurityEvent::staff_change(
                "user-admin",
                "user-target",
                "cashier",
                SECURITY_ACTION_USER_UPDATE,
                SECURITY_REASON_PIN_ROTATED,
            ),
            false,
        )
        .unwrap();
    let (_, action, _, target_id, details) = single_row(&conn);
    assert_eq!(action, "user.update");
    assert_eq!(target_id, "user-target");
    assert!(details.contains("pin_rotated"), "got {details}");
}

#[test]
fn confirmed_free_still_excludes_staff_events() {
    // The gate is the recorder's, not the event kind's — a staff change on a
    // confirmed Free tenant writes nothing, exactly like a login.
    let conn = fresh();
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::staff_change(
                "user-admin",
                "user-new",
                "jdoe",
                SECURITY_ACTION_USER_CREATE,
                SECURITY_REASON_ACCOUNT_CREATED,
            ),
            false,
        )
        .unwrap();
    assert!(!recorded);
    assert!(rows(&conn).is_empty());
}

#[test]
fn tampered_row_still_records_staff_events() {
    // Fail-open applies to the administrative class too: corrupting the
    // subscription row must not silence "who created an admin account".
    let conn = fresh();
    conn.execute(
        "UPDATE tenant_subscription SET signature = ?1 WHERE tenant_id = 'default'",
        ["broken"],
    )
    .unwrap();
    let recorded = store(&conn)
        .record_security_event(
            &SecurityEvent::staff_change(
                "user-x",
                "user-new",
                "backdoor",
                SECURITY_ACTION_USER_CREATE,
                SECURITY_REASON_ACCOUNT_CREATED,
            ),
            false,
        )
        .unwrap();
    assert!(recorded);
    assert_eq!(rows(&conn).len(), 1);
}

// ── the security-events read path ────────────────────────────────

/// Seed one of every interesting action, then read back.
fn seed_mixed(conn: &rusqlite::Connection) {
    let s = store(conn);
    s.record_security_event(
        &SecurityEvent::login_success("user-1", "owner", None::<String>),
        false,
    )
    .unwrap();
    s.record_security_event(
        &SecurityEvent::login_failed("attacker", SECURITY_REASON_BAD_PIN, None, Some("term-1")),
        false,
    )
    .unwrap();
    s.record_security_event(
        &SecurityEvent::staff_change(
            "user-1",
            "user-2",
            "jdoe",
            SECURITY_ACTION_USER_CREATE,
            SECURITY_REASON_ACCOUNT_CREATED,
        ),
        false,
    )
    .unwrap();
    // Business rows: must never surface on the security read.
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-biz-1','user-1','sale.void','sale','s-1','{}','success','2099-01-01T00:00:00.000Z'),
                ('aud-biz-2','user-1','api.write','product','p-1','{}','success','2099-01-01T00:00:01.000Z')",
        [],
    )
    .unwrap();
}

#[test]
fn list_security_events_returns_only_the_security_class() {
    let conn = fresh();
    set_tier(&conn, "premium");
    seed_mixed(&conn);
    let (items, total, has_more) = store(&conn)
        .list_security_events(None, None, None, None, 50)
        .unwrap();
    assert_eq!(total, 3, "three security rows, not five audit rows");
    assert_eq!(items.len(), 3);
    assert!(!has_more);
    let actions: Vec<&str> = items.iter().map(|e| e.action.as_str()).collect();
    for a in actions {
        assert!(
            SECURITY_ACTIONS.contains(&a),
            "non-security action leaked: {a}"
        );
    }
    assert!(
        !items
            .iter()
            .any(|e| e.action == "sale.void" || e.action == "api.write"),
        "business rows must not surface"
    );
}

#[test]
fn list_security_events_is_the_complement_of_the_business_page() {
    // The general audit page still sees everything, including the security
    // rows — the restriction is on the new surface, not a hiding rule.
    let conn = fresh();
    set_tier(&conn, "premium");
    seed_mixed(&conn);
    let (all, all_total, _) = store(&conn)
        .list_audit_entries_filtered(None, None, None, None, 50)
        .unwrap();
    assert_eq!(all_total, 5);
    assert_eq!(all.len(), 5);
}

#[test]
fn list_security_events_filters_by_outcome_and_query() {
    let conn = fresh();
    set_tier(&conn, "premium");
    seed_mixed(&conn);
    let (fails, fail_total, _) = store(&conn)
        .list_security_events(Some("failure"), None, None, None, 50)
        .unwrap();
    assert_eq!(fail_total, 1);
    assert_eq!(fails[0].action, SECURITY_ACTION_LOGIN_FAILED);

    // The query surface is action / target_type / target_id / user_id — it
    // deliberately does NOT grep the details blob, so this matches the
    // SUBJECT ID in target_id rather than the username carried in details.
    let (hits, hit_total, _) = store(&conn)
        .list_security_events(None, Some("user-2"), None, None, 50)
        .unwrap();
    assert_eq!(hit_total, 1, "only the staff row points at that subject");
    assert_eq!(hits[0].action, SECURITY_ACTION_USER_CREATE);
}

#[test]
fn list_security_events_walks_the_keyset_cursor() {
    let conn = fresh();
    set_tier(&conn, "premium");
    seed_mixed(&conn);
    let (page1, total, has_more) = store(&conn)
        .list_security_events(None, None, None, None, 2)
        .unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(total, 3);
    assert!(has_more);
    let last = &page1[1];
    let (page2, _, _) = store(&conn)
        .list_security_events(None, None, Some(&last.created_at), Some(&last.id), 2)
        .unwrap();
    assert_eq!(page2.len(), 1, "the remainder fits one page");
    let seen: Vec<&str> = page1
        .iter()
        .chain(page2.iter())
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(
        seen.len(),
        3,
        "no row skipped or repeated across the cursor"
    );
}

#[test]
fn an_empty_action_allow_list_matches_nothing() {
    // Defensive arm of the shared page builder: a caller that hands over an
    // empty set must get zero rows, never an unfiltered dump of the whole
    // audit table (and never a SQL syntax error from `action IN ()`).
    let conn = fresh();
    set_tier(&conn, "premium");
    seed_mixed(&conn);
    let (items, total, _) = store(&conn)
        .list_audit_entries_page(None, None, None, None, 50, Some(&[]))
        .unwrap();
    assert_eq!(total, 0);
    assert!(items.is_empty());
}

#[test]
fn every_security_action_is_readable_back() {
    // The write set and the read allow-list cannot drift: for each action in
    // SECURITY_ACTIONS, record it and assert the read returns it. Adding a
    // constant without listing it here (or vice versa) fails this test.
    let conn = fresh();
    set_tier(&conn, "premium");
    let s = store(&conn);
    for action in SECURITY_ACTIONS {
        let event = match *action {
            SECURITY_ACTION_LOGIN => {
                SecurityEvent::login_success("user-1", "owner", None::<String>)
            }
            SECURITY_ACTION_LOGIN_FAILED => SecurityEvent::login_failed(
                "owner",
                SECURITY_REASON_BAD_PIN,
                Some("user-1"),
                None::<String>,
            ),
            SECURITY_ACTION_LOGOUT => SecurityEvent::logout("user-1", "owner", None::<String>),
            _ => SecurityEvent::staff_change(
                "user-1",
                "user-2",
                "jdoe",
                action,
                SECURITY_REASON_PROFILE_CHANGED,
            ),
        };
        s.record_security_event(&event, false).unwrap();
    }
    let (items, total, _) = s.list_security_events(None, None, None, None, 50).unwrap();
    assert_eq!(total as usize, SECURITY_ACTIONS.len());
    assert_eq!(items.len(), SECURITY_ACTIONS.len());
}

#[test]
fn security_events_are_swept_like_every_other_row() {
    // The staff-management rows obey the same retention schedule; nothing here
    // is exempt from the sweep.
    let conn = fresh();
    set_tier(&conn, "plus");
    conn.execute(
        "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
         VALUES ('aud-old-create','user-admin','user.create','user','user-x','{}','success','2099-01-01T00:00:00.000Z')",
        [],
    )
    .unwrap();
    let deleted = store(&conn)
        .sweep_audit_retention(
            &crate::subscription::SubscriptionTier::Plus,
            "2100-01-01T00:00:00.000Z",
        )
        .unwrap();
    assert_eq!(deleted, 1);
}
