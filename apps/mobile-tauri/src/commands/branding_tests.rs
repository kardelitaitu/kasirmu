use super::*;

use kasirmu_core::db::Store;
use kasirmu_core::migrations;
use platform_core::StoreDatabaseManager;
use tauri::Manager as _;

/// Global identity DB with an owner (role-owner carries the `["*"]` grant), a
/// temp-dir store manager, and a session for `store-a` seeded into the store.
fn branding_state() -> (AppState, tempfile::TempDir) {
    let conn = migrations::fresh_db();
    {
        let store = Store::new(&conn);
        store.seed_default_roles().unwrap();
        conn.execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES ('user-owner', 'owner', 'hash', 'Owner', 'role-owner', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }
    let temp_dir = tempfile::tempdir().unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager = StoreDatabaseManager::new(temp_dir.path().to_path_buf(), migrations::ALL);
    state.session_store.write().unwrap().insert(
        "tok".into(),
        kasirmu_core::session::SessionContext::new(
            "user-owner".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-a".into(),
            "ws-a-1".into(),
            "store-pos".into(),
            None,
            0,
        ),
    );
    (state, temp_dir)
}

/// The tablet's scoped logo write and its scoped reader must agree on the
/// database. The desktop (bridge) copy of this pair shipped a split — the
/// setter wrote the global identity DB while the reader, and the two sibling
/// setters, read the session store — so the picked logo never rendered. The
/// tablet copy was already correct; this pins it so the two shells cannot
/// silently diverge again.
#[tokio::test]
async fn scoped_brand_logo_round_trips_through_the_store_db() {
    let (state, _dir) = branding_state();
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::generate_context!())
        .unwrap();

    set_brand_logo_path_scoped("tok".into(), "/logo.png".into(), app.state())
        .await
        .unwrap();

    let settings = get_brand_settings_scoped("tok".into(), app.state())
        .await
        .unwrap();
    assert_eq!(
        settings.logo_path.as_deref(),
        Some("/logo.png"),
        "a logo written through the scoped setter must be read back by the scoped reader"
    );
}

#[test]
fn brand_settings_debug() {
    let dto = BrandSettingsDto {
        primary_colour: "#10b981".into(),
        logo_path: Some("/logo.png".into()),
        store_name: "My Store".into(),
    };
    let debug = format!("{dto:?}");
    assert!(debug.contains("My Store"));
}

#[test]
fn brand_settings_serialize() {
    let dto = BrandSettingsDto {
        primary_colour: "#ff0000".into(),
        logo_path: Some("/logo.png".into()),
        store_name: "Test".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["primary_colour"], "#ff0000");
    assert_eq!(json["logo_path"], "/logo.png");
}

#[test]
fn brand_settings_no_logo_path() {
    let dto = BrandSettingsDto {
        primary_colour: "#000000".into(),
        logo_path: None,
        store_name: "NoLogo".into(),
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert!(json["logo_path"].is_null());
}

#[test]
fn brand_settings_deserialize_no_logo() {
    let json = r##"{"primary_colour":"#10b981","logo_path":null,"store_name":"Store"}"##;
    let dto: BrandSettingsDto = serde_json::from_str(json).unwrap();
    assert_eq!(dto.primary_colour, "#10b981");
    assert!(dto.logo_path.is_none());
}
