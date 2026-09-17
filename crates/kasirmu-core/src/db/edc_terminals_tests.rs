//! EDC terminal registry CRUD — validation, normalisation, and row lifecycle.

use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

fn input() -> NewEdcTerminal {
    NewEdcTerminal {
        name: "Front counter EDC".into(),
        connection_type: "wired".into(),
        transport: "serial".into(),
        address: "COM3".into(),
        vendor: Some("ingenico".into()),
        model: Some("iPP320".into()),
        is_active: None,
    }
}

fn wireless() -> NewEdcTerminal {
    NewEdcTerminal {
        name: "Tablet EDC".into(),
        connection_type: "wireless".into(),
        transport: "tcp".into(),
        address: "10.0.0.9:9500".into(),
        vendor: None,
        model: None,
        is_active: None,
    }
}

// ── create ───────────────────────────────────────────────────────────

#[test]
fn create_returns_the_stored_row() {
    let conn = fresh();
    let store = Store::new(&conn);
    let created = store.create_edc_terminal(&input()).expect("create");

    assert!(!created.id.is_empty(), "the database mints the id");
    assert_eq!(created.name, "Front counter EDC");
    assert_eq!(created.connection_type, "wired");
    assert_eq!(created.transport, "serial");
    assert_eq!(created.address, "COM3");
    assert_eq!(created.vendor.as_deref(), Some("ingenico"));
    assert_eq!(created.model.as_deref(), Some("iPP320"));
    assert!(
        created.is_active,
        "a new terminal is active unless told otherwise"
    );
    assert!(!created.created_at.is_empty());
    assert!(!created.updated_at.is_empty());
}

#[test]
fn create_mints_a_distinct_id_per_row() {
    let conn = fresh();
    let store = Store::new(&conn);
    let a = store.create_edc_terminal(&input()).expect("a");
    let b = store.create_edc_terminal(&wireless()).expect("b");
    assert_ne!(a.id, b.id);
    assert_eq!(store.list_edc_terminals().expect("list").len(), 2);
}

#[test]
fn create_persists_so_a_new_connection_sees_it() {
    let conn = fresh();
    let id = Store::new(&conn)
        .create_edc_terminal(&input())
        .expect("create")
        .id;
    drop(conn);
    // Proves the transaction committed rather than being dropped.
    let conn = fresh_with_row(&id);
    let found = Store::new(&conn).get_edc_terminal(&id).expect("read back");
    assert_eq!(found.id, id);
}

fn fresh_with_row(id: &str) -> Connection {
    let conn = fresh();
    conn.execute(
        "INSERT INTO edc_terminals (id, name, connection_type, transport, address)
         VALUES (?1, 'x', 'wired', 'serial', 'COM1')",
        params![id],
    )
    .unwrap();
    conn
}

#[test]
fn create_can_store_an_inactive_terminal() {
    let conn = fresh();
    let store = Store::new(&conn);
    let mut off = input();
    off.is_active = Some(false);
    let created = store.create_edc_terminal(&off).expect("create");
    assert!(!created.is_active);
}

// ── validation ───────────────────────────────────────────────────────

#[test]
fn create_rejects_a_blank_or_whitespace_name() {
    let conn = fresh();
    let store = Store::new(&conn);
    for name in ["", "   ", "\t\n"] {
        let mut bad = input();
        bad.name = name.into();
        assert!(
            matches!(
                store.create_edc_terminal(&bad),
                Err(CoreError::Validation { .. })
            ),
            "{name:?} must not be a terminal name"
        );
    }
    assert!(store.list_edc_terminals().expect("list").is_empty());
}

#[test]
fn create_rejects_an_overlong_name_by_character_not_byte() {
    let conn = fresh();
    let store = Store::new(&conn);
    let mut ok = input();
    ok.name = "é".repeat(120); // 240 bytes, 120 characters
    assert!(store.create_edc_terminal(&ok).is_ok(), "120 chars fits");

    let mut too_long = input();
    too_long.name = "é".repeat(121);
    assert!(matches!(
        store.create_edc_terminal(&too_long),
        Err(CoreError::Validation { .. })
    ));
}

#[test]
fn create_rejects_an_unknown_connection_type() {
    let conn = fresh();
    let store = Store::new(&conn);
    let mut bad = input();
    bad.connection_type = "ethernet".into();
    assert!(matches!(
        store.create_edc_terminal(&bad),
        Err(CoreError::Validation { .. })
    ));
}

#[test]
fn create_rejects_an_unknown_transport() {
    let conn = fresh();
    let store = Store::new(&conn);
    let mut bad = input();
    bad.transport = "parallel".into();
    assert!(matches!(
        store.create_edc_terminal(&bad),
        Err(CoreError::Validation { .. })
    ));
}

#[test]
fn create_rejects_a_transport_that_contradicts_its_connection_type() {
    // The schema CHECKs each column on its own, so both of these would be
    // accepted by SQLite and then produce a terminal the HAL cannot build a
    // driver for. Rejecting here keeps a stored row registrable.
    let conn = fresh();
    let store = Store::new(&conn);

    let mut wired_tcp = input();
    wired_tcp.transport = "tcp".into();
    assert!(
        matches!(
            store.create_edc_terminal(&wired_tcp),
            Err(CoreError::Validation { .. })
        ),
        "a wired terminal cannot be reached over tcp"
    );

    let mut wireless_serial = wireless();
    wireless_serial.transport = "serial".into();
    assert!(
        matches!(
            store.create_edc_terminal(&wireless_serial),
            Err(CoreError::Validation { .. })
        ),
        "a wireless terminal is bluetooth or tcp, not a bare serial line"
    );
}

#[test]
fn every_valid_connection_transport_pair_is_accepted() {
    let conn = fresh();
    let store = Store::new(&conn);
    for (ctype, transport) in [
        ("wired", "serial"),
        ("wired", "usb"),
        ("wireless", "bluetooth"),
        ("wireless", "tcp"),
    ] {
        let mut row = input();
        row.connection_type = ctype.into();
        row.transport = transport.into();
        assert!(
            store.create_edc_terminal(&row).is_ok(),
            "{ctype}+{transport} must be registrable"
        );
    }
}

#[test]
fn create_rejects_an_empty_address() {
    let conn = fresh();
    let store = Store::new(&conn);
    for address in ["", "  "] {
        let mut bad = input();
        bad.address = address.into();
        assert!(
            matches!(
                store.create_edc_terminal(&bad),
                Err(CoreError::Validation { .. })
            ),
            "a transport with nothing to bind is not a terminal"
        );
    }
}

#[test]
fn create_normalises_case_and_surrounding_whitespace() {
    let conn = fresh();
    let store = Store::new(&conn);
    let mut row = input();
    row.name = "  Front  ".into();
    row.connection_type = "WIRED".into();
    row.transport = " Serial ".into();
    row.address = " COM3 ".into();
    row.vendor = Some("  InGeniCo ".into());
    let created = store.create_edc_terminal(&row).expect("create");

    assert_eq!(created.name, "Front");
    assert_eq!(created.connection_type, "wired");
    assert_eq!(created.transport, "serial");
    assert_eq!(created.address, "COM3");
    assert_eq!(created.vendor.as_deref(), Some("ingenico"));
}

#[test]
fn a_blank_vendor_and_model_become_none_not_empty_strings() {
    // An empty string would show up in the setup wizard as a terminal whose
    // vendor is "nothing", which reads differently from an unknown vendor.
    let conn = fresh();
    let store = Store::new(&conn);
    let mut row = input();
    row.vendor = Some("   ".into());
    row.model = Some("".into());
    let created = store.create_edc_terminal(&row).expect("create");
    assert_eq!(created.vendor, None);
    assert_eq!(created.model, None);
}

// ── list ─────────────────────────────────────────────────────────────

#[test]
fn list_active_is_what_the_bootstrap_reads() {
    let conn = fresh();
    let store = Store::new(&conn);
    store.create_edc_terminal(&input()).expect("wired");
    let mut off = wireless();
    off.is_active = Some(false);
    store.create_edc_terminal(&off).expect("inactive");

    assert_eq!(store.list_edc_terminals().expect("all").len(), 2);
    let active = store.list_active_edc_terminals().expect("active");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].connection_type, "wired");
}

#[test]
fn list_is_stable_across_repeated_reads() {
    let conn = fresh();
    let store = Store::new(&conn);
    for _ in 0..3 {
        store.create_edc_terminal(&input()).expect("create");
    }
    let first = store.list_edc_terminals().expect("list");
    let second = store.list_edc_terminals().expect("list");
    let ids: Vec<_> = first.iter().map(|t| t.id.clone()).collect();
    let again: Vec<_> = second.iter().map(|t| t.id.clone()).collect();
    assert_eq!(ids, again, "ordering must not wobble between reads");
}

// ── get ──────────────────────────────────────────────────────────────

#[test]
fn get_a_missing_terminal_is_not_found() {
    let conn = fresh();
    let store = Store::new(&conn);
    assert!(matches!(
        store.get_edc_terminal("nope"),
        Err(CoreError::NotFound { .. })
    ));
}

// ── update ───────────────────────────────────────────────────────────

#[test]
fn update_replaces_in_place_and_keeps_identity() {
    let conn = fresh();
    let store = Store::new(&conn);
    let created = store.create_edc_terminal(&input()).expect("create");

    let mut replacement = wireless();
    replacement.name = "Renamed".into();
    let updated = store
        .update_edc_terminal(&created.id, &replacement)
        .expect("update");

    assert_eq!(updated.id, created.id, "the id is not reassigned");
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.connection_type, "wireless");
    assert_eq!(updated.transport, "tcp");
    assert_eq!(updated.address, "10.0.0.9:9500");
    assert_eq!(
        updated.created_at, created.created_at,
        "created_at belongs to the row, not the last write"
    );
    assert_eq!(store.list_edc_terminals().expect("list").len(), 1);
}

#[test]
fn update_of_a_missing_terminal_errors_and_creates_nothing() {
    let conn = fresh();
    let store = Store::new(&conn);
    assert!(matches!(
        store.update_edc_terminal("ghost", &input()),
        Err(CoreError::NotFound { .. })
    ));
    assert!(
        store.list_edc_terminals().expect("list").is_empty(),
        "an update must never insert"
    );
}

#[test]
fn update_revalidates_just_like_create() {
    let conn = fresh();
    let store = Store::new(&conn);
    let created = store.create_edc_terminal(&input()).expect("create");

    let mut bad = input();
    bad.transport = "tcp".into(); // wired + tcp is contradictory
    assert!(matches!(
        store.update_edc_terminal(&created.id, &bad),
        Err(CoreError::Validation { .. })
    ));

    let still = store.get_edc_terminal(&created.id).expect("unchanged");
    assert_eq!(still.transport, "serial", "a rejected edit must not land");
}

#[test]
fn update_can_deactivate_a_terminal() {
    let conn = fresh();
    let store = Store::new(&conn);
    let created = store.create_edc_terminal(&input()).expect("create");
    let mut off = input();
    off.is_active = Some(false);
    store
        .update_edc_terminal(&created.id, &off)
        .expect("update");
    assert!(
        store
            .list_active_edc_terminals()
            .expect("active")
            .is_empty()
    );
    assert_eq!(store.list_edc_terminals().expect("all").len(), 1);
}

// ── delete ───────────────────────────────────────────────────────────

#[test]
fn delete_removes_the_row() {
    let conn = fresh();
    let store = Store::new(&conn);
    let created = store.create_edc_terminal(&input()).expect("create");
    store.delete_edc_terminal(&created.id).expect("delete");
    assert!(store.list_edc_terminals().expect("list").is_empty());
}

#[test]
fn delete_of_a_missing_terminal_is_not_found() {
    let conn = fresh();
    let store = Store::new(&conn);
    assert!(matches!(
        store.delete_edc_terminal("ghost"),
        Err(CoreError::NotFound { .. })
    ));
}

#[test]
fn delete_only_touches_the_named_row() {
    let conn = fresh();
    let store = Store::new(&conn);
    let a = store.create_edc_terminal(&input()).expect("a");
    let b = store.create_edc_terminal(&wireless()).expect("b");
    store.delete_edc_terminal(&a.id).expect("delete a");
    let rest = store.list_edc_terminals().expect("list");
    assert_eq!(rest.len(), 1);
    assert_eq!(rest[0].id, b.id);
}

// ── the added cross-field rule ───────────────────────────────────────

#[test]
fn each_rejection_names_the_field_the_form_should_highlight() {
    // Validation carries `field` precisely so the UI can mark the right
    // input. A rejection that blames the wrong field is worse than none.
    let conn = fresh();
    let store = Store::new(&conn);
    let cases: Vec<(NewEdcTerminal, &str)> = vec![
        {
            let mut t = input();
            t.name = " ".into();
            (t, "name")
        },
        {
            let mut t = input();
            t.connection_type = "satellite".into();
            (t, "connection_type")
        },
        {
            let mut t = input();
            t.transport = "tcp".into(); // wired + tcp
            (t, "transport")
        },
        {
            let mut t = input();
            t.address = "  ".into();
            (t, "address")
        },
    ];
    for (bad, expected_field) in cases {
        let err = store
            .create_edc_terminal(&bad)
            .expect_err("{bad:?} must be rejected");
        match err {
            CoreError::Validation { field, message } => {
                assert_eq!(field, expected_field, "wrong field blamed: {message}");
                assert!(!message.is_empty());
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }
}

#[test]
fn not_found_carries_the_entity_and_the_id_that_was_asked_for() {
    let conn = fresh();
    let store = Store::new(&conn);
    let err = store
        .get_edc_terminal("abc-123")
        .expect_err("missing row must error");
    assert!(
        matches!(
            &err,
            CoreError::NotFound { entity, id }
                if entity == &"edc_terminal" && id == "abc-123"
        ),
        "{err:?}"
    );
}

#[test]
fn the_pairing_rule_is_the_only_thing_stopping_an_unregistrable_row() {
    // Documents why transport_is_valid exists: the schema would accept both
    // of these, and the HAL would then have a row it cannot turn into a
    // driver, surfacing as a rejected bootstrap entry at startup.
    assert!(transport_is_valid("wired", "serial"));
    assert!(transport_is_valid("wired", "usb"));
    assert!(transport_is_valid("wireless", "bluetooth"));
    assert!(transport_is_valid("wireless", "tcp"));
    assert!(!transport_is_valid("wired", "tcp"));
    assert!(!transport_is_valid("wired", "bluetooth"));
    assert!(!transport_is_valid("wireless", "serial"));
    assert!(!transport_is_valid("wireless", "usb"));
    assert!(!transport_is_valid("carrier-pigeon", "serial"));
}
