//! Tests for the regional-configuration commands (slices 2–3).
//!
//! The serde test pins the wire contract at the IPC boundary — the core
//! `RegionalConfig` is the payload, so its snake_case field names and
//! `ConfigScope` scope names are what the front-end receives; changing
//! either is a wire break and must land deliberately. The flow tests exercise
//! the session-scoped path end to end against a real migrated store database —
//! including the entity-level inheritance leg and the ADR #48 IANA
//! pass-through — the `settings:read`/`settings:edit` gates, and the
//! slice-3 write command's core-boundary validation.

use super::*;
use crate::state::AppState;
use kasirmu_core::CoreErrorKind;
use kasirmu_core::migrations;
use kasirmu_core::regional::ConfigScope;
use kasirmu_core::session::SessionContext;
use platform_core::StoreDatabaseManager;
use tauri::Manager;

// ── wire contract (serde at the IPC boundary) ───────────────────────

#[test]
fn regional_config_wire_shape_is_the_core_model_unchanged() {
    let location_layer = kasirmu_core::regional::RegionalLayer::blank(
        ConfigScope::Location,
        "id-ID",
        "Asia/Jayapura",
        "IDR",
        "",
    );
    let entity_layer =
        kasirmu_core::regional::RegionalLayer::blank(ConfigScope::LegalEntity, "", "", "", "ID");
    let config = kasirmu_core::regional::RegionalConfig::resolve(
        "loc-1",
        Some("le-1".into()),
        &[location_layer, entity_layer],
    );
    let v = serde_json::to_value(&config).unwrap();
    // Snake_case field names (the core docs promise these verbatim to later
    // slices) and the ConfigScope serde names — NOT camelCase DTO renames.
    assert_eq!(v["location_id"], "loc-1");
    assert_eq!(v["legal_entity_id"], "le-1");
    assert_eq!(v["country_code"], "ID");
    assert_eq!(v["locale"]["value"], "id-ID");
    assert_eq!(v["locale"]["scope"], "location");
    assert_eq!(v["timezone"]["value"], "Asia/Jayapura");
    assert_eq!(v["timezone"]["scope"], "location");
    assert_eq!(v["currency"]["value"], "IDR");
    assert_eq!(v["currency"]["scope"], "location");
}

#[test]
fn wire_timezones_are_stored_iana_names_not_derived_offsets() {
    // ADR #48: the read model is a faithful pass-through of the stored IANA
    // name — no offset derivation anywhere on this side of the boundary.
    let location_layer =
        kasirmu_core::regional::RegionalLayer::blank(ConfigScope::Location, "", "Asia/Jayapura", "", "");
    let config = kasirmu_core::regional::RegionalConfig::resolve("loc-1", None, &[location_layer]);
    assert_eq!(config.timezone.value, "Asia/Jayapura");
    assert_eq!(config.timezone.scope, ConfigScope::Location);
    let v = serde_json::to_value(&config).unwrap();
    assert_eq!(v["timezone"]["value"], "Asia/Jayapura");
}

// ── scoped flow (real session + real store db) ──────────────────────

/// Seed roles + the owner user (full permissions) into the global DB.
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

/// AppState with a fresh migrated global DB and an isolated store-db dir
/// (mirrors the locations_tests harness).
fn flow_state(conn: rusqlite::Connection) -> AppState {
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    let path = temp_dir.keep();
    state.db_manager = StoreDatabaseManager::new(path, migrations::ALL);
    state
}

fn mock_app(state: AppState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap()
}

fn owner_session(state: &AppState, token: &str) {
    state.session_store.write().unwrap().insert(
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

/// The migrated store db seeds one location `default` linked to legal entity
/// `default:default-legal-entity` whose regional columns are all blank, and
/// the org KV layer is empty — so the resolved config must be exactly: the
/// location's stored UTC/USD sentinels at location provenance, and the
/// built-in locale fallback.
#[tokio::test]
async fn get_regional_config_scoped_resolves_the_seeded_default_location() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let config = get_regional_config_scoped("default".into(), "owner-tok".into(), app.state())
        .await
        .unwrap();

    assert_eq!(config.location_id, "default");
    assert_eq!(
        config.legal_entity_id.as_deref(),
        Some("default:default-legal-entity")
    );
    assert_eq!(config.timezone.value, "UTC");
    assert_eq!(config.timezone.scope, ConfigScope::Location);
    assert_eq!(config.currency.value, "USD");
    assert_eq!(config.currency.scope, ConfigScope::Location);
    assert_eq!(config.locale.value, "en-US");
    assert_eq!(config.locale.scope, ConfigScope::BuiltIn);
    assert_eq!(config.country_code, None);
}

/// Mixed provenance: the location supplies locale+currency, the legal entity
/// supplies the timezone (the location column is blank = inherit) and the
/// market anchor. The stored IANA names come back verbatim (ADR #48).
#[tokio::test]
async fn get_regional_config_scoped_inherits_timezone_from_the_legal_entity() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    {
        let store_conn = state.db_manager.open_store("default").unwrap();
        let store_conn = store_conn.lock().unwrap();
        store_conn
            .execute(
                "UPDATE locations SET locale = 'id-ID', currency = 'IDR', timezone = '' WHERE id = 'default'",
                [],
            )
            .unwrap();
        store_conn
            .execute(
                "UPDATE legal_entities SET timezone = 'Asia/Makassar', country_code = 'ID'
                 WHERE id = 'default:default-legal-entity'",
                [],
            )
            .unwrap();
    }
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let config = get_regional_config_scoped("default".into(), "owner-tok".into(), app.state())
        .await
        .unwrap();

    assert_eq!(config.locale.value, "id-ID");
    assert_eq!(config.locale.scope, ConfigScope::Location);
    assert_eq!(config.currency.value, "IDR");
    assert_eq!(config.currency.scope, ConfigScope::Location);
    assert_eq!(config.timezone.value, "Asia/Makassar");
    assert_eq!(config.timezone.scope, ConfigScope::LegalEntity);
    assert_eq!(config.country_code.as_deref(), Some("ID"));
}

/// An unknown location is a typed NotFound, not an invented default — a
/// typo'd id must not look like an unconfigured one.
#[tokio::test]
async fn get_regional_config_scoped_unknown_location_is_typed_not_found() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let result =
        get_regional_config_scoped("no-such-location".into(), "owner-tok".into(), app.state())
            .await;

    match result {
        Err(AppError::Core { sub_kind, .. }) => {
            assert!(matches!(sub_kind, CoreErrorKind::NotFound), "{sub_kind:?}");
        }
        other => panic!("expected typed NotFound rejection, got: {other:?}"),
    }
}

/// A staff session without `settings:read` must be denied — typed
/// PermissionDenied, not Internal.
#[tokio::test]
async fn get_regional_config_scoped_denies_staff_without_settings_read() {
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
    let state = flow_state(conn);
    state.session_store.write().unwrap().insert(
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
    let app = mock_app(state);

    let result = get_regional_config_scoped("default".into(), "lite-tok".into(), app.state()).await;

    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
// ── slice 3: write command ──────────────────────────────────────────

/// The write command persists through the core validator and returns the
/// freshly resolved config (same contract as the desktop twin; the tablet
/// shell layers only the `settings:edit` session gate).
#[tokio::test]
async fn set_regional_config_scoped_persists_and_returns_the_effective_config() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let config = set_regional_config_scoped(
        "default".into(),
        SetRegionalConfig {
            locale: "id-ID".into(),
            timezone: "Asia/Makassar".into(),
            currency: "idr".into(),
            country_code: "id".into(),
        },
        "owner-tok".into(),
        app.state(),
    )
    .await
    .unwrap();

    assert_eq!(config.locale.value, "id-ID");
    assert_eq!(config.locale.scope, ConfigScope::Location);
    assert_eq!(config.timezone.value, "Asia/Makassar");
    assert_eq!(config.timezone.scope, ConfigScope::Location);
    assert_eq!(config.currency.value, "IDR");
    assert_eq!(config.currency.scope, ConfigScope::Location);
    assert_eq!(config.country_code.as_deref(), Some("ID"));

    // A plain read (slice 2 command) must agree with the write's read-back.
    let again = get_regional_config_scoped("default".into(), "owner-tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(again, config);
}

/// Core validation rejects a timezone outside the ADR #48 contract as a
/// typed Validation error at the IPC boundary — before any column moves.
#[tokio::test]
async fn set_regional_config_scoped_rejects_a_non_contract_timezone_as_validation() {
    let conn = migrations::fresh_db();
    seed_owner(&conn);
    let state = flow_state(conn);
    owner_session(&state, "owner-tok");
    let app = mock_app(state);

    let result = set_regional_config_scoped(
        "default".into(),
        SetRegionalConfig {
            locale: "".into(),
            timezone: "Europe/Berlin".into(),
            currency: "".into(),
            country_code: "".into(),
        },
        "owner-tok".into(),
        app.state(),
    )
    .await;

    match result {
        Err(AppError::Core { sub_kind, .. }) => {
            assert!(
                matches!(sub_kind, CoreErrorKind::Validation),
                "{sub_kind:?}"
            );
        }
        other => panic!("expected typed Validation rejection, got: {other:?}"),
    }

    // The row is untouched — validation runs before the transaction writes.
    let config = get_regional_config_scoped("default".into(), "owner-tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(config.timezone.value, "UTC");
}

/// A session without `settings:edit` is denied — typed PermissionDenied.
#[tokio::test]
async fn set_regional_config_scoped_denies_staff_without_settings_edit() {
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
    let state = flow_state(conn);
    state.session_store.write().unwrap().insert(
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
    let app = mock_app(state);

    let result = set_regional_config_scoped(
        "default".into(),
        SetRegionalConfig {
            locale: "".into(),
            timezone: "UTC".into(),
            currency: "".into(),
            country_code: "".into(),
        },
        "lite-tok".into(),
        app.state(),
    )
    .await;

    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}
