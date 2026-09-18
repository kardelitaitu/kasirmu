use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn store(conn: &Connection) -> Store<'_> {
    Store::new(conn)
}

fn make_terminal(id: &str, name: &str, device_id: &str) -> Terminal {
    Terminal {
        id: id.to_owned(),
        name: name.to_owned(),
        device_id: device_id.to_owned(),
        terminal_secret: Some("secret-ABC".to_string()),
        is_active: true,
        last_seen_at: None,
        metadata: Some("{}".to_string()),
        created_at: "2025-01-01T00:00:00.000Z".to_string(),
        updated_at: "2025-01-01T00:00:00.000Z".to_string(),
    }
}

fn seed_terminals(conn: &Connection) {
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, terminal_secret, is_active, metadata, created_at, updated_at) VALUES
            ('term-1', 'Front Register', 'dev-001', 'secret-1', 1, '{}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('term-2', 'Back Office',    'dev-002', 'secret-2', 1, '{}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
            ('term-3', 'Kiosk',          'dev-003', 'secret-3', 0, '{\"model\":\"kiosk-v2\"}', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');"
    ).unwrap();
}

// ── List ────────────────────────────────────────────────────────

#[test]
fn list_terminals_empty_db() {
    let conn = fresh();
    let terminals = store(&conn).list_terminals().unwrap();
    assert!(terminals.is_empty());
}

#[test]
fn list_terminals_returns_all_ordered_by_name() {
    let conn = fresh();
    seed_terminals(&conn);
    let terminals = store(&conn).list_terminals().unwrap();
    assert_eq!(terminals.len(), 3);
    assert_eq!(terminals[0].name, "Back Office");
    assert_eq!(terminals[1].name, "Front Register");
    assert_eq!(terminals[2].name, "Kiosk");
}

#[test]
fn list_terminals_includes_inactive() {
    let conn = fresh();
    seed_terminals(&conn);
    let terminals = store(&conn).list_terminals().unwrap();
    let kiosk = terminals.iter().find(|t| t.id == "term-3").unwrap();
    assert!(!kiosk.is_active);
    assert_eq!(kiosk.metadata.as_deref(), Some("{\"model\":\"kiosk-v2\"}"));
}

// ── Get ─────────────────────────────────────────────────────────

#[test]
fn get_terminal_found() {
    let conn = fresh();
    seed_terminals(&conn);
    let t = store(&conn).get_terminal("term-1").unwrap().unwrap();
    assert_eq!(t.name, "Front Register");
    assert_eq!(t.device_id, "dev-001");
    assert_eq!(t.terminal_secret.as_deref(), Some("secret-1"));
    assert!(t.is_active);
}

#[test]
fn get_terminal_not_found() {
    let conn = fresh();
    let t = store(&conn).get_terminal("nonexistent").unwrap();
    assert!(t.is_none());
}

#[test]
fn get_terminal_by_device_id_found() {
    let conn = fresh();
    seed_terminals(&conn);
    let t = store(&conn)
        .get_terminal_by_device_id("dev-002")
        .unwrap()
        .unwrap();
    assert_eq!(t.name, "Back Office");
    assert_eq!(t.id, "term-2");
}

#[test]
fn get_terminal_by_device_id_not_found() {
    let conn = fresh();
    let t = store(&conn)
        .get_terminal_by_device_id("unknown-device")
        .unwrap();
    assert!(t.is_none());
}

// ── resolve_terminal_row_id ─────────────────────────────────────
//
// The key translation the memo read/ack depend on: a session carries the
// DEVICE identity (`get_device_id` = hostname) while dependent tables store
// `terminals.id` (a UUID).

#[test]
fn resolve_terminal_row_id_accepts_both_row_id_and_device_id() {
    let conn = fresh();
    seed_terminals(&conn);
    let store = store(&conn);
    assert_eq!(
        store.resolve_terminal_row_id("default", "term-1").unwrap(),
        Some("term-1".to_string()),
        "a row id resolves to itself"
    );
    assert_eq!(
        store.resolve_terminal_row_id("default", "dev-002").unwrap(),
        Some("term-2".to_string()),
        "the hostname a real session carries resolves to the row id"
    );
    assert_eq!(
        store.resolve_terminal_row_id("default", "dev-003").unwrap(),
        Some("term-3".to_string()),
        "an inactive terminal still resolves — activity is not the key"
    );
}

#[test]
fn resolve_terminal_row_id_is_none_for_unknown_or_empty_identity() {
    let conn = fresh();
    seed_terminals(&conn);
    let store = store(&conn);
    assert_eq!(
        store
            .resolve_terminal_row_id("default", "unknown-device")
            .unwrap(),
        None
    );
    // `WorkspaceContext` falls back to "" when `get_device_id` fails, so the
    // empty identity is a real input and must not match anything.
    assert_eq!(store.resolve_terminal_row_id("default", "").unwrap(), None);
    assert_eq!(
        store.resolve_terminal_row_id("default", "   ").unwrap(),
        None
    );
}

#[test]
fn resolve_terminal_row_id_prefers_the_id_over_another_rows_device_id() {
    // Both columns are unique, but not unique *across* each other: an id that
    // spells another row's device_id must resolve to the id's own row, because
    // that is the row a dependent foreign key can point at.
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id) VALUES
            ('x-1', 'By id',  'dev-9'),
            ('x-2', 'By dev', 'x-1');",
    )
    .unwrap();
    assert_eq!(
        store(&conn)
            .resolve_terminal_row_id("default", "x-1")
            .unwrap(),
        Some("x-1".to_string())
    );
}

#[test]
fn resolve_terminal_row_id_does_not_cross_tenants() {
    // Resolving another tenant's terminal would hand the caller an id whose
    // dependent rows cannot exist, i.e. an empty result dressed up as a hit.
    let conn = fresh();
    conn.execute_batch(
        "INSERT INTO terminals (id, name, device_id, tenant_id) VALUES
            ('term-b', 'Other tenant', 'dev-b', 'tenant-b');",
    )
    .unwrap();
    let store = store(&conn);
    assert_eq!(
        store.resolve_terminal_row_id("default", "dev-b").unwrap(),
        None
    );
    assert_eq!(
        store.resolve_terminal_row_id("tenant-b", "dev-b").unwrap(),
        Some("term-b".to_string())
    );
}

// ── ensure_terminal_addressable (memo delivery across the two homes) ──

#[test]
fn ensure_terminal_addressable_inserts_once_and_carries_no_credential() {
    let conn = fresh();
    seed_terminals(&conn);
    conn.execute_batch("INSERT INTO locations (id, name) VALUES ('loc-1', 'Front')")
        .unwrap();
    let store = store(&conn);
    let source = make_terminal("term-9", "Back POS", "dev-009");

    assert!(
        store
            .ensure_terminal_addressable(&source, "default", Some("loc-1"))
            .unwrap(),
        "first call inserts the mirror"
    );
    assert!(
        !store
            .ensure_terminal_addressable(&source, "default", Some("loc-1"))
            .unwrap(),
        "second call is a no-op"
    );

    assert_eq!(store.count_terminals().unwrap(), 4, "exactly one row added");
    let mirrored = store.get_terminal("term-9").unwrap().unwrap();
    assert_eq!(mirrored.device_id, "dev-009");
    assert!(
        mirrored.terminal_secret.is_none(),
        "a credential belongs to the database that minted it"
    );
    // The two things delivery needs: the device resolves to this row, and a
    // Location Memo can reach it through its binding.
    assert_eq!(
        store.resolve_terminal_row_id("default", "dev-009").unwrap(),
        Some("term-9".to_string())
    );
    assert_eq!(
        store.get_terminal_bound_location("term-9").unwrap(),
        Some("loc-1".to_string())
    );
    let tenant: String = conn
        .query_row(
            "SELECT tenant_id FROM terminals WHERE id = 'term-9'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        tenant, "default",
        "written under the tenant the fan-out filters on"
    );
}

#[test]
fn ensure_terminal_addressable_reuses_the_row_that_already_covers_the_device() {
    // Addressability is per DEVICE: the MultiTerminal auto-register path may
    // already have created this device's row under a different id, and a second
    // row would both violate the device_id UNIQUE constraint and split delivery
    // from the read (which resolves by device identity).
    let conn = fresh();
    conn.execute(
        "INSERT INTO terminals (id, name, device_id) VALUES ('global-1', 'Auto', 'dev-1')",
        [],
    )
    .unwrap();
    let store = store(&conn);
    let store_row = make_terminal("store-1", "Settings POS", "dev-1");

    assert!(
        !store
            .ensure_terminal_addressable(&store_row, "default", None)
            .unwrap(),
        "one device never gets two rows"
    );
    assert_eq!(store.count_terminals().unwrap(), 1);
    assert_eq!(
        store.resolve_terminal_row_id("default", "dev-1").unwrap(),
        Some("global-1".to_string()),
        "delivery uses the row that already exists"
    );
}

#[test]
fn get_terminal_bound_location_is_none_for_unknown_and_unbound() {
    let conn = fresh();
    seed_terminals(&conn);
    let store = store(&conn);
    assert_eq!(store.get_terminal_bound_location("term-1").unwrap(), None);
    assert_eq!(store.get_terminal_bound_location("nobody").unwrap(), None);
}

// ── Create ──────────────────────────────────────────────────────

#[test]
fn create_terminal_persists() {
    let conn = fresh();
    let t = make_terminal("term-new", "New Register", "dev-999");
    store(&conn).create_terminal(&t).unwrap();

    let loaded = store(&conn).get_terminal("term-new").unwrap().unwrap();
    assert_eq!(loaded.name, "New Register");
    assert_eq!(loaded.device_id, "dev-999");
    assert_eq!(loaded.terminal_secret.as_deref(), Some("secret-ABC"));
    assert!(loaded.is_active);
}

#[test]
fn create_terminal_with_metadata() {
    let conn = fresh();
    let t = Terminal {
        id: "term-meta".to_string(),
        name: "Meta Terminal".to_string(),
        device_id: "dev-meta".to_string(),
        terminal_secret: Some("sec-meta".to_string()),
        is_active: false,
        last_seen_at: None,
        metadata: Some("{\"location\":\"warehouse\"}".to_string()),
        created_at: "2025-01-01T00:00:00.000Z".to_string(),
        updated_at: "2025-01-01T00:00:00.000Z".to_string(),
    };
    store(&conn).create_terminal(&t).unwrap();

    let loaded = store(&conn).get_terminal("term-meta").unwrap().unwrap();
    assert!(!loaded.is_active);
    assert_eq!(
        loaded.metadata.as_deref(),
        Some("{\"location\":\"warehouse\"}")
    );
}

#[test]
fn create_duplicate_terminal_id_fails() {
    let conn = fresh();
    let t = make_terminal("term-dup", "First", "dev-1");
    store(&conn).create_terminal(&t).unwrap();
    let dup = make_terminal("term-dup", "Second", "dev-2");
    let result = store(&conn).create_terminal(&dup);
    assert!(result.is_err());
}

// ── Update ──────────────────────────────────────────────────────

#[test]
fn update_terminal_basic() {
    let conn = fresh();
    seed_terminals(&conn);

    let updated = Terminal {
        id: "term-1".to_string(),
        name: "Front Register v2".to_string(),
        device_id: "dev-001-new".to_string(),
        terminal_secret: Some("new-secret".to_string()),
        is_active: true,
        last_seen_at: None,
        metadata: Some("{\"version\":2}".to_string()),
        created_at: String::new(),
        updated_at: String::new(),
    };
    store(&conn).update_terminal(&updated).unwrap();

    let loaded = store(&conn).get_terminal("term-1").unwrap().unwrap();
    assert_eq!(loaded.name, "Front Register v2");
    assert_eq!(loaded.device_id, "dev-001-new");
    assert_eq!(loaded.terminal_secret.as_deref(), Some("new-secret"));
    assert_eq!(loaded.metadata.as_deref(), Some("{\"version\":2}"));
    assert!(loaded.updated_at.as_str() > "2025-01-01");
}

#[test]
fn update_terminal_not_found() {
    let conn = fresh();
    let t = make_terminal("nope", "X", "dev-x");
    let err = store(&conn).update_terminal(&t).unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal"));
}

#[test]
fn update_terminal_deactivate() {
    let conn = fresh();
    seed_terminals(&conn);

    let updated = Terminal {
        id: "term-1".to_string(),
        name: "Front Register".to_string(),
        device_id: "dev-001".to_string(),
        terminal_secret: Some("secret-1".to_string()),
        is_active: false,
        last_seen_at: None,
        metadata: Some("{}".to_string()),
        created_at: String::new(),
        updated_at: String::new(),
    };
    store(&conn).update_terminal(&updated).unwrap();

    let loaded = store(&conn).get_terminal("term-1").unwrap().unwrap();
    assert!(!loaded.is_active);
}

// ── Ping ────────────────────────────────────────────────────────

#[test]
fn ping_terminal_updates_timestamps() {
    let conn = fresh();
    seed_terminals(&conn);

    store(&conn).ping_terminal("term-1").unwrap();

    let loaded = store(&conn).get_terminal("term-1").unwrap().unwrap();
    assert!(loaded.last_seen_at.is_some(), "last_seen_at should be set");
    assert!(!loaded.updated_at.is_empty(), "updated_at should be set");
}

#[test]
fn ping_terminal_not_found() {
    let conn = fresh();
    let err = store(&conn).ping_terminal("nonexistent").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { entity, .. } if entity == "terminal"));
}

// ── Delete ──────────────────────────────────────────────────────

#[test]
fn delete_terminal_removes() {
    let conn = fresh();
    seed_terminals(&conn);
    store(&conn).delete_terminal("term-3").unwrap();
    let t = store(&conn).get_terminal("term-3").unwrap();
    assert!(t.is_none());
}

#[test]
fn delete_terminal_not_found() {
    let conn = fresh();
    let err = store(&conn).delete_terminal("nope").unwrap_err();
    assert!(matches!(err, CoreError::NotFound { .. }));
}

// ── Binding ──────────────────────────────────────────────────────

#[test]
fn update_terminal_binding_basic() {
    let conn = fresh();
    seed_terminals(&conn);
    store(&conn)
        .update_terminal_binding("term-1", "default", "instance-1", "sig-abc")
        .unwrap();

    let binding = store(&conn).get_terminal_binding("term-1").unwrap();
    assert_eq!(
        binding,
        Some((
            "default".to_string(),
            "instance-1".to_string(),
            "sig-abc".to_string()
        ))
    );
}

#[test]
fn update_terminal_binding_overwrites() {
    let conn = fresh();
    seed_terminals(&conn);
    store(&conn)
        .update_terminal_binding("term-1", "default", "old-instance", "old-sig")
        .unwrap();
    store(&conn)
        .update_terminal_binding("term-2", "default", "new-instance", "new-sig")
        .unwrap();

    let binding = store(&conn).get_terminal_binding("term-1").unwrap();
    // Should NOT have changed term-2's update affected term-1
    assert_eq!(
        binding,
        Some((
            "default".to_string(),
            "old-instance".to_string(),
            "old-sig".to_string()
        ))
    );

    let binding2 = store(&conn).get_terminal_binding("term-2").unwrap();
    assert_eq!(
        binding2,
        Some((
            "default".to_string(),
            "new-instance".to_string(),
            "new-sig".to_string()
        ))
    );
}

#[test]
fn update_terminal_binding_not_found() {
    let conn = fresh();
    let err = store(&conn).update_terminal_binding("nope", "default", "i", "s");
    assert!(matches!(err, Err(CoreError::NotFound { entity, .. }) if entity == "terminal"));
}

#[test]
fn get_terminal_binding_found() {
    let conn = fresh();
    seed_terminals(&conn);
    store(&conn)
        .update_terminal_binding("term-3", "default", "inst-kiosk", "sig-kiosk")
        .unwrap();

    let binding = store(&conn).get_terminal_binding("term-3").unwrap();
    let (store_id, instance_id, sig) = binding.unwrap();
    assert_eq!(store_id, "default");
    assert_eq!(instance_id, "inst-kiosk");
    assert_eq!(sig, "sig-kiosk");
}

#[test]
fn get_terminal_binding_on_unbound_terminal() {
    let conn = fresh();
    seed_terminals(&conn);
    // term-1 has no binding set
    let binding = store(&conn).get_terminal_binding("term-1").unwrap();
    assert!(binding.is_none(), "unbound terminal should return None");
}

#[test]
fn get_terminal_binding_not_found() {
    let conn = fresh();
    let err = store(&conn).get_terminal_binding("nope");
    assert!(matches!(err, Err(CoreError::NotFound { entity, .. }) if entity == "terminal"));
}

#[test]
fn clear_terminal_binding_removes() {
    let conn = fresh();
    seed_terminals(&conn);
    store(&conn)
        .update_terminal_binding("term-1", "default", "inst", "sig")
        .unwrap();

    // Clear it
    store(&conn).clear_terminal_binding("term-1").unwrap();

    let binding = store(&conn).get_terminal_binding("term-1").unwrap();
    assert!(binding.is_none(), "binding should be cleared");
}

#[test]
fn clear_terminal_binding_not_found() {
    let conn = fresh();
    let err = store(&conn).clear_terminal_binding("nope");
    assert!(matches!(err, Err(CoreError::NotFound { entity, .. }) if entity == "terminal"));
}

// ── Validation ─────────────────────────────────────────────────

#[test]
fn create_terminal_empty_name_rejected() {
    let conn = fresh();
    let t = make_terminal("v1", "", "dev-001");
    let err = store(&conn).create_terminal(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_terminal_whitespace_name_rejected() {
    let conn = fresh();
    let t = make_terminal("v2", "   ", "dev-001");
    let err = store(&conn).create_terminal(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn create_terminal_empty_device_id_rejected() {
    let conn = fresh();
    let t = make_terminal("v3", "Valid Name", "");
    let err = store(&conn).create_terminal(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "device_id"));
}

#[test]
fn update_terminal_empty_name_rejected() {
    let conn = fresh();
    seed_terminals(&conn);
    let mut t = store(&conn).get_terminal("term-1").unwrap().unwrap();
    t.name = "".into();
    let err = store(&conn).update_terminal(&t).unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));
}

#[test]
fn enforce_terminal_quota_allows_within_tier_limit() {
    let conn = fresh();
    let s = store(&conn);
    // 0 terminals: Free allows 1
    assert!(s.enforce_terminal_quota(&SubscriptionTier::Free).is_ok());
    assert!(s.enforce_terminal_quota(&SubscriptionTier::Plus).is_ok());
    assert!(s.enforce_terminal_quota(&SubscriptionTier::Pro).is_ok());
    assert!(
        s.enforce_terminal_quota(&SubscriptionTier::Enterprise)
            .is_ok()
    );
}

#[test]
fn enforce_terminal_quota_blocks_at_limit() {
    let conn = fresh();
    let s = store(&conn);
    s.create_terminal(&make_terminal("t1", "Term 1", "dev-1"))
        .unwrap();

    // 1 terminal: Free (limit 1) is blocked; Plus (limit 2) allows it
    let err_free = s
        .enforce_terminal_quota(&SubscriptionTier::Free)
        .unwrap_err();
    assert!(matches!(
        err_free,
        CoreError::SubscriptionLimitExceeded(msg) if msg.contains("1 registers")
    ));
    assert!(s.enforce_terminal_quota(&SubscriptionTier::Plus).is_ok());

    // 2 terminals: Plus (limit 2) is blocked; Pro (limit 5) allows it
    s.create_terminal(&make_terminal("t2", "Term 2", "dev-2"))
        .unwrap();
    let err_plus = s
        .enforce_terminal_quota(&SubscriptionTier::Plus)
        .unwrap_err();
    assert!(matches!(
        err_plus,
        CoreError::SubscriptionLimitExceeded(msg) if msg.contains("2 registers")
    ));
    assert!(s.enforce_terminal_quota(&SubscriptionTier::Pro).is_ok());
}

#[test]
fn create_terminal_tx_veto_closes_limit_race() {
    // W7-B: mirror of the locations/products veto (9264b8f67). The gate arms
    // the tier; create_terminal consumes it inside its own transaction, so a
    // registration that lands over the cap is refused in-tx and never commits.
    // Filling to the cap happens un-armed on purpose: the pre-tx fast path has
    // its own suites, and this test must pin the door, not the gate.
    let conn = fresh();
    let s = store(&conn);
    let tier = SubscriptionTier::Free;
    let limit = QuotaDimension::PosRegisters.limit_for(&tier).unwrap();
    let baseline = s.count_terminals().unwrap();
    assert!(
        baseline < limit,
        "the fixture must start under the cap (baseline {baseline}, limit {limit})"
    );
    for i in baseline..limit {
        s.create_terminal(&make_terminal(
            &format!("term-{i}"),
            "Register",
            &format!("device-{i}"),
        ))
        .unwrap();
    }
    assert_eq!(s.count_terminals().unwrap(), limit);
    s.arm_creation_quota(QuotaDimension::PosRegisters, tier.clone());
    let err = s
        .create_terminal(&make_terminal("term-over", "Over", "device-over"))
        .unwrap_err();
    assert!(
        matches!(err, CoreError::SubscriptionLimitExceeded(_)),
        "Free at the register cap must be refused in-tx: {err:?}"
    );
    assert_eq!(
        s.count_terminals().unwrap(),
        limit,
        "the over-cap register must not persist"
    );
}
