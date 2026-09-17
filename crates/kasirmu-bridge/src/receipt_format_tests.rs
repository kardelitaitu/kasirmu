//! Tests for the receipt format commands (receipt-format axis).

use super::*;
use crate::testing::TestBridge;
use kasirmu_core::db::receipt_formats::ReceiptSource;
use kasirmu_core::migrations;
use kasirmu_core::session::SessionContext;

fn seed_owner(conn: &rusqlite::Connection) {
    let store = Store::new(conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();
}

fn flow_state(conn: rusqlite::Connection) -> TestBridge {
    TestBridge::new().with_conn(conn)
}

fn owner_session(bridge: &TestBridge, token: &str) {
    bridge.sessions().write().unwrap().insert(
        token.to_string(),
        SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );
}

#[tokio::test]
async fn read_falls_back_to_legacy_keys_with_legacy_provenance() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let bridge = flow_state(conn);
    owner_session(&bridge, "owner-tok");
    // Legacy keys live in the STORE db (the one resolve_scope opens), not
    // the global db.
    {
        let store_conn = bridge.db_manager().open_store("default").unwrap();
        let guard = store_conn.lock().unwrap();
        platform_core::settings::Settings::set(&guard, "receipt.footer", "legacy footer").unwrap();
    }
    {
        let store_conn = bridge.db_manager().open_store("default").unwrap();
        let guard = store_conn.lock().unwrap();
        platform_core::settings::Settings::set(&guard, "receipt.paper_width", "narrow").unwrap();
    }

    let eff = get_receipt_format_scoped(
        &bridge.ctx(),
        Some("term-1".into()),
        Some("loc-1".into()),
        "owner-tok",
    )
    .await
    .unwrap();

    assert_eq!(eff.content_source, ReceiptSource::Legacy);
    assert_eq!(eff.content.as_ref().unwrap().footer_text, "legacy footer");
    assert_eq!(eff.layout.paper_width_mm, Some(58));
    assert_eq!(eff.layout_source, ReceiptSource::Legacy);
}

#[tokio::test]
async fn layout_write_scopes_to_the_store_location_and_readback_agrees() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let bridge = flow_state(conn);
    owner_session(&bridge, "owner-tok");

    let eff = set_receipt_layout_scoped(
        &bridge.ctx(),
        &ReceiptLayoutArgs {
            paper_width_mm: Some(58),
            margin_top_mm: Some(2),
            margin_bottom_mm: Some(1),
            margin_left_mm: Some(0),
            margin_right_mm: Some(0),
            show_logo: Some(false),
            print_copies: Some(2),
            show_table_number: Some(false),
            footer_note: Some("counter copy".into()),
        },
        "loc-1",
        "owner-tok",
    )
    .await
    .unwrap();

    assert_eq!(eff.layout_source, ReceiptSource::Workspace);
    assert_eq!(eff.layout.paper_width_mm, Some(58));
    assert_eq!(eff.layout.print_copies, Some(2));

    // Readback agrees with the write's read-back.
    let again = get_receipt_format_scoped(&bridge.ctx(), None, Some("loc-1".into()), "owner-tok")
        .await
        .unwrap();
    assert_eq!(again.layout.paper_width_mm, Some(58));
}

#[tokio::test]
async fn layout_write_rejects_nonsense_width_as_validation() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let bridge = flow_state(conn);
    owner_session(&bridge, "owner-tok");

    let result = set_receipt_layout_scoped(
        &bridge.ctx(),
        &ReceiptLayoutArgs {
            paper_width_mm: Some(500),
            margin_top_mm: None,
            margin_bottom_mm: None,
            margin_left_mm: None,
            margin_right_mm: None,
            show_logo: None,
            print_copies: None,
            show_table_number: None,
            footer_note: None,
        },
        "loc-1",
        "owner-tok",
    )
    .await;

    match result {
        Err(BridgeError::Core { sub_kind, .. }) => {
            assert!(
                matches!(sub_kind, kasirmu_core::CoreErrorKind::Validation),
                "{sub_kind:?}"
            );
        }
        other => panic!("expected typed Validation rejection, got: {other:?}"),
    }
}

#[tokio::test]
async fn denies_staff_without_settings_edit() {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
    }
    conn.execute_batch(
        "INSERT INTO roles (id, name, description, permissions, created_at, updated_at)
         VALUES ('role-lite', 'Lite', 'Limited', '[\"sales:view\"]', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
         INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-lite', 'lite', 'hash', 'Lite User', 'role-lite', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');",
    )
    .unwrap();
    let bridge = flow_state(conn);
    bridge.sessions().write().unwrap().insert(
        "lite-tok".into(),
        SessionContext::new(
            "user-lite".into(),
            "role-lite".into(),
            "terminal-1".into(),
            "default".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    let result = set_receipt_layout_scoped(
        &bridge.ctx(),
        &ReceiptLayoutArgs {
            paper_width_mm: Some(80),
            margin_top_mm: None,
            margin_bottom_mm: None,
            margin_left_mm: None,
            margin_right_mm: None,
            show_logo: None,
            print_copies: None,
            show_table_number: None,
            footer_note: None,
        },
        "loc-1",
        "lite-tok",
    )
    .await;

    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}

#[tokio::test]
async fn content_write_targets_the_linked_entity_and_readback_agrees() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let bridge = flow_state(conn);
    owner_session(&bridge, "owner-tok");
    // Content resolves through the store's primary location row. The
    // migrations seed location 'default' with its own legal entity; make
    // it primary so the write path resolves that entity (no FK gymnastics).
    {
        let store_conn = bridge.db_manager().open_store("default").unwrap();
        let guard = store_conn.lock().unwrap();
        guard
            .execute(
                "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
                [],
            )
            .unwrap();
    }

    let eff = set_receipt_content_scoped(
        &bridge.ctx(),
        &ReceiptContentArgs {
            required_fields: vec!["store_name".into(), "tax_id".into(), "total".into()],
            footer_text: "statutory footer".into(),
            show_tax: true,
            show_currency: false,
            decimal_separator: "comma".into(),
        },
        "owner-tok",
    )
    .await
    .unwrap();

    assert_eq!(eff.content_source, ReceiptSource::Entity);
    assert_eq!(
        eff.content.as_ref().unwrap().footer_text,
        "statutory footer"
    );
    assert_eq!(eff.content.as_ref().unwrap().required_fields.len(), 3);

    // Readback agrees with the write's read-back.
    let again = get_receipt_format_scoped(&bridge.ctx(), None, None, "owner-tok")
        .await
        .unwrap();
    assert_eq!(again.content_source, ReceiptSource::Entity);
    assert_eq!(again.content.as_ref().unwrap().decimal_separator, "comma");
}

#[tokio::test]
async fn content_write_fails_closed_without_a_linked_entity() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let bridge = flow_state(conn);
    owner_session(&bridge, "owner-tok");

    let result = set_receipt_content_scoped(
        &bridge.ctx(),
        &ReceiptContentArgs {
            required_fields: vec![],
            footer_text: "orphan".into(),
            show_tax: true,
            show_currency: false,
            decimal_separator: "dot".into(),
        },
        "owner-tok",
    )
    .await;

    assert!(result.is_err());
}
