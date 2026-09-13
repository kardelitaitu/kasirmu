//! Tests for the local payment methods module (slice 6).

use super::*;
use crate::db::Store;
use crate::migrations;
use crate::regional::ConfigScope;

fn store() -> Store<'static> {
    let conn = migrations::fresh_db();
    let conn: &'static rusqlite::Connection = Box::leak(Box::new(conn));
    Store::new(conn)
}

const NOW: &str = "2026-09-26T11:00:00.000Z";

fn seed_location(store: &Store<'_>, location_id: &str, entity: Option<&str>) {
    store
        .conn
        .execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, locale,
                                    is_primary, legal_entity_id, created_at, updated_at)
             VALUES (?1, ?1, '', '', 'IDR', 'UTC', '', 0, ?2,
                     '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            params![location_id, entity],
        )
        .unwrap();
}

fn seed_entity(store: &Store<'_>, entity: &str) {
    store
        .conn
        .execute(
            "INSERT INTO legal_entities (id, tenant_id, name, legal_name,
                    registration_number, tax_id, status, country_code, locale,
                    timezone, currency, created_at, updated_at)
             VALUES (?1, 'default', ?1, '', '', '', 'active', 'ID', '', '', '',
                     '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')",
            params![entity],
        )
        .unwrap();
}

fn rail(code: &str, label: &str, enabled: bool) -> NewPaymentRail {
    NewPaymentRail {
        rail_code: code.into(),
        label: label.into(),
        is_enabled: enabled,
        parameters: "{}".into(),
    }
}

// ── the write path ──────────────────────────────────────────────────

#[test]
fn replace_set_writes_the_full_rail_list() {
    let store = store();
    store
        .replace_local_payment_methods(
            "legal_entity",
            "ent-1",
            &[
                rail("qris", "QRIS", true),
                rail("va-bca", "Virtual Account BCA", true),
                rail("ewallet-ovo", "OVO", false),
            ],
            NOW,
        )
        .unwrap();
    let count: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM local_payment_methods WHERE scope_type = 'legal_entity' AND scope_id = 'ent-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 3);
}

#[test]
fn replace_set_removes_omitted_rails() {
    let store = store();
    store
        .replace_local_payment_methods(
            "legal_entity",
            "ent-1",
            &[rail("qris", "QRIS", true), rail("va-bca", "VA BCA", true)],
            NOW,
        )
        .unwrap();
    // The card edits the whole list: omitting va-bca removes it.
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", true)], NOW)
        .unwrap();
    let count: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM local_payment_methods WHERE scope_id = 'ent-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn write_rejects_credential_shaped_parameter_keys() {
    // Supervisor addition 2, as a test: the parameters bag must never carry
    // gateway credentials — documentation-as-test at the write boundary.
    let store = store();
    let mut r = rail("qris", "QRIS", true);
    r.parameters = r#"{"gateway_credential": "sk_live_steal_me"}"#.into();
    let err = store
        .replace_local_payment_methods("legal_entity", "ent-1", &[r], NOW)
        .unwrap_err();
    assert!(
        matches!(
            err,
            CoreError::Validation {
                field: "parameters",
                ..
            }
        ),
        "got {err:?}"
    );
    // The key-shape check is fragment-based, so the sneaky variants fail too.
    for sneaky in [
        r#"{"apiKey": "k"}"#,
        r#"{"client_token": "t"}"#,
        r#"{"merchant_password": "p"}"#,
        r#"{"PRIVATE_KEY": "k"}"#,
    ] {
        let mut r = rail("qris", "QRIS", true);
        r.parameters = sneaky.into();
        let err = store
            .replace_local_payment_methods("legal_entity", "ent-1", &[r], NOW)
            .unwrap_err();
        assert!(
            matches!(
                err,
                CoreError::Validation {
                    field: "parameters",
                    ..
                }
            ),
            "sneaky {sneaky} must be rejected, got {err:?}"
        );
    }
    // And an unparseable bag fails closed.
    let mut r = rail("qris", "QRIS", true);
    r.parameters = "not json".into();
    assert!(
        store
            .replace_local_payment_methods("legal_entity", "ent-1", &[r], NOW)
            .is_err()
    );
}

#[test]
fn write_rejects_blank_codes_labels_duplicates_and_bad_scope() {
    let store = store();
    let mut r = rail(" ", "QRIS", true);
    assert!(
        store
            .replace_local_payment_methods("legal_entity", "ent-1", &[r.clone()], NOW)
            .is_err()
    );
    r.rail_code = "qris".into();
    r.label = "".into();
    assert!(
        store
            .replace_local_payment_methods("legal_entity", "ent-1", &[r], NOW)
            .is_err()
    );
    let dup = [rail("qris", "QRIS", true), rail("QRIS", "QRIS again", true)];
    assert!(
        store
            .replace_local_payment_methods("legal_entity", "ent-1", &dup, NOW)
            .is_err()
    );
    let single = [rail("qris", "QRIS", true)];
    assert!(
        store
            .replace_local_payment_methods("workspace", "ws-1", &single, NOW)
            .is_err()
    );
}

// ── the read model + inheritance ────────────────────────────────────

#[test]
fn entity_rows_are_the_market_default_with_legal_entity_provenance() {
    let store = store();
    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", Some("ent-1"));
    store
        .replace_local_payment_methods(
            "legal_entity",
            "ent-1",
            &[rail("qris", "QRIS", true), rail("va-bca", "VA BCA", true)],
            NOW,
        )
        .unwrap();
    let rails = store.local_payment_methods_for_location("loc-1").unwrap();
    assert_eq!(rails.len(), 2);
    assert!(rails.iter().all(|r| r.scope == ConfigScope::LegalEntity));
    assert_eq!(rails[0].rail_code, "qris");
}

#[test]
fn location_override_wins_per_rail_with_location_provenance() {
    let store = store();
    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", Some("ent-1"));
    store
        .replace_local_payment_methods(
            "legal_entity",
            "ent-1",
            &[rail("qris", "QRIS", true), rail("va-bca", "VA BCA", true)],
            NOW,
        )
        .unwrap();
    // The site only overrides va-bca.
    store
        .replace_local_payment_methods(
            "location",
            "loc-1",
            &[rail("va-bca", "VA BCA (site)", false)],
            NOW,
        )
        .unwrap();
    let rails = store.local_payment_methods_for_location("loc-1").unwrap();
    assert_eq!(rails.len(), 2);
    let qris = rails.iter().find(|r| r.rail_code == "qris").unwrap();
    let va = rails.iter().find(|r| r.rail_code == "va-bca").unwrap();
    assert_eq!(qris.scope, ConfigScope::LegalEntity);
    assert_eq!(va.scope, ConfigScope::Location);
    assert!(!va.is_enabled);
}

#[test]
fn location_disable_survives_entity_reenable() {
    // Supervisor addition 1: "not offered here" is a FACT. A location-level
    // disable survives when the entity row later re-enables — the location
    // row wins until the LOCATION row is cleared, not until the entity
    // changes.
    let store = store();
    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", Some("ent-1"));

    // Entity: qris enabled.
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", true)], NOW)
        .unwrap();
    // Site disables qris.
    store
        .replace_local_payment_methods("location", "loc-1", &[rail("qris", "QRIS", false)], NOW)
        .unwrap();
    // Entity re-enables (writes the same enabled row again).
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", true)], NOW)
        .unwrap();

    let rails = store.local_payment_methods_for_location("loc-1").unwrap();
    let qris = rails.iter().find(|r| r.rail_code == "qris").unwrap();
    assert!(
        !qris.is_enabled,
        "the location disable must survive the entity re-enable"
    );
    assert_eq!(qris.scope, ConfigScope::Location);

    // It survives until the LOCATION row is cleared — and only then.
    store
        .replace_local_payment_methods("location", "loc-1", &[], NOW)
        .unwrap();
    let rails = store.local_payment_methods_for_location("loc-1").unwrap();
    let qris = rails.iter().find(|r| r.rail_code == "qris").unwrap();
    assert!(qris.is_enabled, "clearing the location row falls through");
    assert_eq!(qris.scope, ConfigScope::LegalEntity);
}

#[test]
fn site_local_rails_pass_through_with_location_provenance() {
    let store = store();
    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", Some("ent-1"));
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", true)], NOW)
        .unwrap();
    // A rail the entity knows nothing about: site-local.
    store
        .replace_local_payment_methods("location", "loc-1", &[rail("cash-only", "Cash", true)], NOW)
        .unwrap();
    let rails = store.local_payment_methods_for_location("loc-1").unwrap();
    assert_eq!(rails.len(), 2);
    let cash = rails.iter().find(|r| r.rail_code == "cash-only").unwrap();
    assert_eq!(cash.scope, ConfigScope::Location);
}

#[test]
fn unlinked_location_answers_an_empty_list() {
    let store = store();
    seed_location(&store, "loc-solo", None);
    assert!(
        store
            .local_payment_methods_for_location("loc-solo")
            .unwrap()
            .is_empty()
    );
    assert!(
        store
            .local_payment_methods_for_location("no-such-location")
            .unwrap()
            .is_empty()
    );
}

// ── THE TIER SEPARATION (constraint b, pinned from both directions) ─

#[test]
fn payment_settings_carry_no_tier_answer() {
    // Direction 1: the read model has no tier field and the module never
    // imports an entitlement — the effective rail DTO exposes only market
    // facts. Compile-time by shape; runtime-pinned by asserting the whole
    // DTO surface contains nothing entitlement-shaped.
    let store = store();
    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", Some("ent-1"));
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", true)], NOW)
        .unwrap();
    let rails = store.local_payment_methods_for_location("loc-1").unwrap();
    let json = serde_json::to_value(&rails).unwrap();
    let serialized = serde_json::to_string(&json).unwrap().to_lowercase();
    for tier_marker in [
        "entitlement",
        "tier",
        "supports_qris",
        "plan",
        "subscription",
        "feature_grant",
    ] {
        assert!(
            !serialized.contains(tier_marker),
            "payment settings must not carry a tier answer: found {tier_marker:?}"
        );
    }
}

#[test]
fn tier_capability_is_not_inferable_from_payment_settings() {
    // Direction 2: the tier answer (supports_qris) does not move when the
    // market surface changes. The two facts live in ENTIRELY different
    // subsystems — the tier source is the license layer (feature grants /
    // entitlements caps DTO), which does not even share this database: the
    // store schema has no entitlements table at all. Flipping a rail must be
    // invisible to anything reading the tier, and no rail write can
    // manufacture one — pinned structurally: the store DB cannot answer the
    // tier question because the table is not there.
    let store = store();
    let has_entitlements_table: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = 'entitlements'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        has_entitlements_table, 0,
        "the tier source (license layer) must not share the store db — \
         payment settings cannot reach it, let alone answer for it"
    );

    seed_entity(&store, "ent-1");
    seed_location(&store, "loc-1", Some("ent-1"));

    // Flipping rails changes nothing outside local_payment_methods.
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", true)], NOW)
        .unwrap();
    store
        .replace_local_payment_methods("legal_entity", "ent-1", &[rail("qris", "QRIS", false)], NOW)
        .unwrap();

    let tables_touched: i64 = store
        .conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE '%entitlement%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        tables_touched, 0,
        "rail writes must never touch (or create) any entitlement store"
    );
}
