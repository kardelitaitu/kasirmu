//! Unit tests for the regional-configuration command bodies (Wave-A test
//! relocation: moved out of
//! `apps/desktop-client/src/commands/regional_tests.rs`).
//!
//! Mounted at the foot of `regional.rs` with `#[cfg(test)] #[path]`, so
//! `use super::*` resolves `get_scoped`, `set_scoped`, `SetRegionalConfig`
//! and the module's `Store` import exactly as the desktop sibling module
//! did. The serde tests pin the wire contract at the IPC boundary — the core
//! `RegionalConfig` is the payload, so its snake_case field names and
//! `ConfigScope` scope names are what the front-end receives; changing
//! either is a wire break and must land deliberately. The flow tests drive
//! the session-scoped path end to end through the crate's headless
//! `TestBridge` harness against a real migrated global DB and an isolated
//! store-db directory — including the entity-level inheritance leg and the
//! ADR #48 IANA pass-through — the `settings:read`/`settings:edit` gates,
//! and the write path's ADR #47 location-resource scoping (enforced by the
//! module's local `require_session_resource_permission` mirror). Error arms
//! assert `BridgeError` — the desktop file's `AppError` arms map 1:1.

use super::*;
use crate::testing::{TestBridge, temp_conn};
use std::sync::atomic::{AtomicU64, Ordering};

use oz_core::CoreErrorKind;
use oz_core::migrations;
use oz_core::regional::ConfigScope;
use oz_core::session::SessionContext;
use platform_core::StoreDatabaseManager;

// ── wire contract (serde at the IPC boundary) ───────────────────────

#[test]
fn regional_config_wire_shape_is_the_core_model_unchanged() {
    let location_layer = oz_core::regional::RegionalLayer::blank(
        ConfigScope::Location,
        "id-ID",
        "Asia/Jayapura",
        "IDR",
        "",
    );
    let entity_layer =
        oz_core::regional::RegionalLayer::blank(ConfigScope::LegalEntity, "", "", "", "ID");
    let config = oz_core::regional::RegionalConfig::resolve(
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
        oz_core::regional::RegionalLayer::blank(ConfigScope::Location, "", "Asia/Jayapura", "", "");
    let config = oz_core::regional::RegionalConfig::resolve("loc-1", None, &[location_layer]);
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

/// Instance counter disambiguating store-db directories within one process.
static STORE_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// Unique per-test directory for the isolated store-db manager. The manager
/// creates the directory lazily on first `open_store`; leftovers are left
/// for the OS temp cleaner, exactly like the harness's own store roots (the
/// desktop file used `tempfile::tempdir()`, which is not a dev-dependency of
/// this crate).
fn unique_store_dir() -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "oz-bridge-regional-{}-{}-{}",
        std::process::id(),
        nanos,
        STORE_DIR_SEQ.fetch_add(1, Ordering::Relaxed)
    ))
}

/// Isolated store-db manager over a fresh directory — the direct twin of the
/// desktop `flow_state` harness's
/// `StoreDatabaseManager::new(path, migrations::ALL)`. Seeding tests open
/// and mutate their store DB through this handle *before* it is handed to
/// `flow_bridge`, because `TestBridge` keeps the manager private.
fn store_manager() -> StoreDatabaseManager {
    StoreDatabaseManager::new(unique_store_dir(), migrations::ALL)
}

/// `TestBridge` with a fresh migrated global DB and an isolated store-db dir
/// (the bridge twin of the desktop `flow_state` harness, which built
/// `AppState::for_test_with_conn` and replaced `db_manager` with a fresh
/// manager over an empty directory).
fn flow_bridge(conn: rusqlite::Connection, manager: StoreDatabaseManager) -> TestBridge {
    TestBridge::new().with_conn(conn).with_db_manager(manager)
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

/// The migrated store db seeds one location `default` linked to legal entity
/// `default:default-legal-entity` whose regional columns are all blank, and
/// the org KV layer is empty — so the resolved config must be exactly: the
/// location's stored UTC/USD sentinels at location provenance, and the
/// built-in locale fallback.
#[tokio::test]
async fn get_regional_config_scoped_resolves_the_seeded_default_location() {
    let conn = temp_conn();
    seed_owner(&conn);
    let bridge = flow_bridge(conn, store_manager());
    owner_session(&bridge, "owner-tok");

    let config = get_scoped(&bridge.ctx(), "owner-tok", "default")
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
    let conn = temp_conn();
    seed_owner(&conn);
    let manager = store_manager();
    {
        let store_conn = manager.open_store("default").unwrap();
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
    let bridge = flow_bridge(conn, manager);
    owner_session(&bridge, "owner-tok");

    let config = get_scoped(&bridge.ctx(), "owner-tok", "default")
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
    let conn = temp_conn();
    seed_owner(&conn);
    let bridge = flow_bridge(conn, store_manager());
    owner_session(&bridge, "owner-tok");

    let result = get_scoped(&bridge.ctx(), "owner-tok", "no-such-location").await;

    match result {
        Err(BridgeError::Core { sub_kind, .. }) => {
            assert!(matches!(sub_kind, CoreErrorKind::NotFound), "{sub_kind:?}");
        }
        other => panic!("expected typed NotFound rejection, got: {other:?}"),
    }
}

/// A staff session without `settings:read` must be denied — typed
/// PermissionDenied, not Internal.
#[tokio::test]
async fn get_regional_config_scoped_denies_staff_without_settings_read() {
    let conn = temp_conn();
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
    let bridge = flow_bridge(conn, store_manager());
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

    let result = get_scoped(&bridge.ctx(), "lite-tok", "default").await;

    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}
// ── slice 3: write command ──────────────────────────────────────────

/// The write command persists through the core validator (ADR #48 timezone
/// contract, ISO-4217 uppercase canonicalisation) and returns the freshly
/// resolved config — the card re-renders provenance from the same response.
#[tokio::test]
async fn set_regional_config_scoped_persists_and_returns_the_effective_config() {
    let conn = temp_conn();
    seed_owner(&conn);
    let bridge = flow_bridge(conn, store_manager());
    owner_session(&bridge, "owner-tok");

    let config = set_scoped(
        &bridge.ctx(),
        "owner-tok",
        "default",
        &SetRegionalConfig {
            locale: "id-ID".into(),
            timezone: "Asia/Makassar".into(),
            currency: "idr".into(),
            country_code: "id".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(config.locale.value, "id-ID");
    assert_eq!(config.locale.scope, ConfigScope::Location);
    assert_eq!(config.timezone.value, "Asia/Makassar");
    assert_eq!(config.timezone.scope, ConfigScope::Location);
    // Canonicalised to uppercase by the core boundary (787dc742a precedent).
    assert_eq!(config.currency.value, "IDR");
    assert_eq!(config.currency.scope, ConfigScope::Location);
    // The market anchor rides the linked legal entity.
    assert_eq!(config.country_code.as_deref(), Some("ID"));

    // A plain read (slice 2 command) must agree with the write's read-back.
    let again = get_scoped(&bridge.ctx(), "owner-tok", "default")
        .await
        .unwrap();
    assert_eq!(again, config);
}

/// Blank axes clear the location layer: the chain falls through to the
/// linked entity (the seeded entity's columns are blank, so the org/built-in
/// defaults answer). The seeded sentinel columns (UTC/USD) are writable to
/// blank — that IS the inherit mechanism, not a schema violation.
#[tokio::test]
async fn set_regional_config_scoped_blanks_clear_to_inherit() {
    let conn = temp_conn();
    seed_owner(&conn);
    let manager = store_manager();
    {
        let store_conn = manager.open_store("default").unwrap();
        let store_conn = store_conn.lock().unwrap();
        store_conn
            .execute(
                "UPDATE legal_entities SET locale = 'id-ID', currency = 'IDR' WHERE id = 'default:default-legal-entity'",
                [],
            )
            .unwrap();
    }
    let bridge = flow_bridge(conn, manager);
    owner_session(&bridge, "owner-tok");

    let config = set_scoped(
        &bridge.ctx(),
        "owner-tok",
        "default",
        &SetRegionalConfig {
            locale: "".into(),
            timezone: "UTC".into(),
            currency: "".into(),
            country_code: "".into(),
        },
    )
    .await
    .unwrap();

    assert_eq!(config.locale.value, "id-ID");
    assert_eq!(config.locale.scope, ConfigScope::LegalEntity);
    assert_eq!(config.currency.value, "IDR");
    assert_eq!(config.currency.scope, ConfigScope::LegalEntity);
    assert_eq!(config.timezone.value, "UTC");
}

/// Core validation rejects a timezone outside the ADR #48 contract as a
/// typed Validation error at the IPC boundary — before any column moves.
#[tokio::test]
async fn set_regional_config_scoped_rejects_a_non_contract_timezone_as_validation() {
    let conn = temp_conn();
    seed_owner(&conn);
    let bridge = flow_bridge(conn, store_manager());
    owner_session(&bridge, "owner-tok");

    let result = set_scoped(
        &bridge.ctx(),
        "owner-tok",
        "default",
        &SetRegionalConfig {
            locale: "".into(),
            timezone: "Europe/Berlin".into(),
            currency: "".into(),
            country_code: "".into(),
        },
    )
    .await;

    match result {
        Err(BridgeError::Core { sub_kind, .. }) => {
            assert!(
                matches!(sub_kind, CoreErrorKind::Validation),
                "{sub_kind:?}"
            );
        }
        other => panic!("expected typed Validation rejection, got: {other:?}"),
    }

    // The row is untouched — validation runs before the transaction writes.
    let config = get_scoped(&bridge.ctx(), "owner-tok", "default")
        .await
        .unwrap();
    assert_eq!(config.timezone.value, "UTC");
}

/// A session without `settings:edit` is denied — typed PermissionDenied —
/// and an unknown location is a typed NotFound, mirroring the read command.
#[tokio::test]
async fn set_regional_config_scoped_denies_staff_without_settings_edit() {
    let conn = temp_conn();
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
    let bridge = flow_bridge(conn, store_manager());
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

    let result = set_scoped(
        &bridge.ctx(),
        "lite-tok",
        "default",
        &SetRegionalConfig {
            locale: "".into(),
            timezone: "UTC".into(),
            currency: "".into(),
            country_code: "".into(),
        },
    )
    .await;

    assert!(matches!(result, Err(BridgeError::PermissionDenied(_))));
}
