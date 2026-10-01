//! Unit tests for payment gateway CRUD and at-rest encryption.

use super::*;
use crate::migrations;
use rusqlite::Connection;

fn fresh() -> Connection {
    migrations::fresh_db()
}

#[test]
fn upsert_and_get_payment_gateway_roundtrip_with_at_rest_encryption() {
    let conn = fresh();
    let store = Store::new(&conn);

    let input = UpsertPaymentGateway {
        name: "midtrans".into(),
        is_active: true,
        config_json: r#"{"merchantId":"M12345","serverKey":"SB-Mid-server-secret","clientKey":"SB-Mid-client-pub"}"#.into(),
    };

    let created = store
        .upsert_payment_gateway("default", &input, "2026-10-01T12:00:00Z")
        .expect("upsert gateway");

    assert_eq!(created.name, "midtrans");
    assert!(created.is_active);
    assert_eq!(created.tenant_id, "default");
    assert_eq!(created.created_at, "2026-10-01T12:00:00Z");
    assert_eq!(created.updated_at, "2026-10-01T12:00:00Z");

    // Decrypted in-memory config matches input
    let parsed: serde_json::Value = serde_json::from_str(&created.config_json).unwrap();
    assert_eq!(parsed["merchantId"], "M12345");
    assert_eq!(parsed["serverKey"], "SB-Mid-server-secret");

    // Verify raw SQLite row is encrypted and does NOT contain raw secret
    let raw_config: String = conn
        .query_row(
            "SELECT config_json FROM payment_gateways WHERE tenant_id = 'default' AND name = 'midtrans'",
            [],
            |r| r.get(0),
        )
        .expect("raw query");

    assert!(
        !raw_config.contains("SB-Mid-server-secret"),
        "Raw DB row must be encrypted!"
    );
    assert_ne!(raw_config, input.config_json);

    // Fetch via get_payment_gateway
    let loaded = store
        .get_payment_gateway("default", "midtrans")
        .expect("query")
        .expect("found");
    assert_eq!(loaded.id, created.id);
    assert_eq!(loaded.config_json, created.config_json);
}

#[test]
fn upsert_updates_existing_gateway_preserving_id_and_created_at() {
    let conn = fresh();
    let store = Store::new(&conn);

    let input1 = UpsertPaymentGateway {
        name: "stripe".into(),
        is_active: true,
        config_json: r#"{"publishableKey":"pk_live_1","secretKey":"sk_live_1"}"#.into(),
    };
    let first = store
        .upsert_payment_gateway("default", &input1, "2026-10-01T10:00:00Z")
        .expect("create");

    let input2 = UpsertPaymentGateway {
        name: "stripe".into(),
        is_active: false,
        config_json: r#"{"publishableKey":"pk_live_2","secretKey":"sk_live_2"}"#.into(),
    };
    let updated = store
        .upsert_payment_gateway("default", &input2, "2026-10-01T11:00:00Z")
        .expect("update");

    assert_eq!(updated.id, first.id, "ID must be preserved on conflict");
    assert_eq!(
        updated.created_at, "2026-10-01T10:00:00Z",
        "created_at must be preserved"
    );
    assert_eq!(
        updated.updated_at, "2026-10-01T11:00:00Z",
        "updated_at must be updated"
    );
    assert!(!updated.is_active);

    let parsed: serde_json::Value = serde_json::from_str(&updated.config_json).unwrap();
    assert_eq!(parsed["secretKey"], "sk_live_2");
}

#[test]
fn name_is_normalized_case_insensitively() {
    let conn = fresh();
    let store = Store::new(&conn);

    let input = UpsertPaymentGateway {
        name: "MidTrans".into(),
        is_active: true,
        config_json: r#"{"serverKey":"secret"}"#.into(),
    };
    store
        .upsert_payment_gateway("default", &input, "2026-10-01T10:00:00Z")
        .expect("create");

    let loaded = store
        .get_payment_gateway("default", "MIDTRANS")
        .expect("query")
        .expect("found");
    assert_eq!(loaded.name, "midtrans");
}

#[test]
fn list_active_vs_all_gateways() {
    let conn = fresh();
    let store = Store::new(&conn);

    store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "midtrans".into(),
                is_active: true,
                config_json: r#"{"active":true}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap();

    store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "stripe".into(),
                is_active: false,
                config_json: r#"{"active":false}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap();

    let all = store.list_payment_gateways("default").unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].name, "midtrans");
    assert_eq!(all[1].name, "stripe");

    let active = store.list_active_payment_gateways("default").unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].name, "midtrans");
}

#[test]
fn delete_payment_gateway() {
    let conn = fresh();
    let store = Store::new(&conn);

    store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "square".into(),
                is_active: true,
                config_json: r#"{}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap();

    assert!(store.delete_payment_gateway("default", "square").unwrap());
    assert!(!store.delete_payment_gateway("default", "square").unwrap());
    assert!(
        store
            .get_payment_gateway("default", "square")
            .unwrap()
            .is_none()
    );
}

#[test]
fn validation_rejects_malformed_inputs() {
    let conn = fresh();
    let store = Store::new(&conn);

    // Empty name
    let err = store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "   ".into(),
                is_active: true,
                config_json: r#"{}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));

    // Invalid chars in name
    let err = store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "midtrans; DROP TABLE payment_gateways;".into(),
                is_active: true,
                config_json: r#"{}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "name"));

    // Invalid JSON
    let err = store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "midtrans".into(),
                is_active: true,
                config_json: r#"not-valid-json"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "config_json"));

    // Non-object JSON
    let err = store
        .upsert_payment_gateway(
            "default",
            &UpsertPaymentGateway {
                name: "midtrans".into(),
                is_active: true,
                config_json: r#"[1, 2, 3]"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap_err();
    assert!(matches!(err, CoreError::Validation { field, .. } if field == "config_json"));
}

#[test]
fn tenant_isolation() {
    let conn = fresh();
    let store = Store::new(&conn);

    store
        .upsert_payment_gateway(
            "tenant-a",
            &UpsertPaymentGateway {
                name: "midtrans".into(),
                is_active: true,
                config_json: r#"{"merchant":"A"}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap();

    store
        .upsert_payment_gateway(
            "tenant-b",
            &UpsertPaymentGateway {
                name: "midtrans".into(),
                is_active: true,
                config_json: r#"{"merchant":"B"}"#.into(),
            },
            "2026-10-01T10:00:00Z",
        )
        .unwrap();

    let gw_a = store
        .get_payment_gateway("tenant-a", "midtrans")
        .unwrap()
        .unwrap();
    let gw_b = store
        .get_payment_gateway("tenant-b", "midtrans")
        .unwrap()
        .unwrap();

    let parsed_a: serde_json::Value = serde_json::from_str(&gw_a.config_json).unwrap();
    let parsed_b: serde_json::Value = serde_json::from_str(&gw_b.config_json).unwrap();
    assert_eq!(parsed_a["merchant"], "A");
    assert_eq!(parsed_b["merchant"], "B");
}
