use super::*;

#[tokio::test]
async fn ping_returns_pong() {
    assert_eq!(ping().await.unwrap(), "pong");
}

#[tokio::test]
async fn version_has_populated_fields() {
    let v = version().await.unwrap();
    assert!(!v.name.is_empty());
    assert!(!v.version.is_empty());
    assert!(!v.target.is_empty());
}

// ── VersionInfo struct tests ─────────────────────────────────────

#[test]
fn version_info_debug() {
    let v = VersionInfo {
        name: "test-app",
        version: "1.0.0",
        rust_version: "1.80",
        target: "x86_64-linux",
    };
    let debug = format!("{v:?}");
    assert!(debug.contains("test-app"));
    assert!(debug.contains("1.0.0"));
    assert!(debug.contains("x86_64-linux"));
}

#[test]
fn version_info_serde_json() {
    let v = VersionInfo {
        name: "test-app",
        version: "1.0.0",
        rust_version: "1.80",
        target: "x86_64-linux",
    };
    let json = serde_json::to_value(&v).unwrap();
    assert_eq!(json["name"], "test-app");
    assert_eq!(json["version"], "1.0.0");
    assert_eq!(json["target"], "x86_64-linux");
}

#[test]
fn version_info_field_access() {
    let v = VersionInfo {
        name: "kasirmu-mobile",
        version: "0.0.28",
        rust_version: "1.80",
        target: "aarch64-android",
    };
    assert_eq!(v.name, "kasirmu-mobile");
    assert_eq!(v.version, "0.0.28");
    assert_eq!(v.rust_version, "1.80");
    assert_eq!(v.target, "aarch64-android");
}
// ── Build fingerprint (ADR #57 §2.1) ─────────────────────────────

/// Off Android the read must answer `None`, not an error: the server classifies
/// an absent fingerprint as `unknown` (§2.2), which is never a mismatch, so a
/// platform with no APK must not look like a broken client.
#[cfg(not(target_os = "android"))]
#[tokio::test]
async fn build_fingerprint_is_absent_off_android() {
    assert_eq!(
        get_build_fingerprint().await.unwrap(),
        None,
        "a desktop/host build has no APK signing certificate"
    );
}

/// The command must never panic, on any platform. Its `spawn_blocking` join is
/// the only failure mode it can surface, and a panic there would take down the
/// diagnostic surface rather than report absence.
#[tokio::test]
async fn build_fingerprint_never_panics() {
    let _ = get_build_fingerprint().await;
}

// ── Persistent Device Identity & Adoption (todo-android-device-identity) ───────

#[test]
fn resolve_persistent_device_id_fresh_install_generates_stable_id() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    kasirmu_core::migrations::run(&mut conn).unwrap();

    // 1. Fresh install on Android generates a unique persistent ID
    let first = resolve_persistent_device_id(&conn, true).unwrap();
    assert!(first.starts_with("android-"), "device id must start with android- prefix: {first}");
    assert_ne!(first, "unknown-device", "fresh install must NOT use unknown-device");

    // 2. Saved into settings
    let saved = kasirmu_core::Settings::get(&conn, "device.terminal_id").unwrap();
    assert_eq!(saved.as_deref(), Some(first.as_str()));

    // 3. Second boot / call returns the exact same identifier
    let second = resolve_persistent_device_id(&conn, true).unwrap();
    assert_eq!(second, first, "device ID must be stable across boots");
}

#[test]
fn resolve_persistent_device_id_adopts_existing_unknown_device_row() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    kasirmu_core::migrations::run(&mut conn).unwrap();

    // Simulate an already-installed tablet that provisioned as 'unknown-device'
    conn.execute_batch(
        "INSERT INTO locations (id, name) VALUES ('loc-1', 'Main');
         INSERT INTO roles (id, name) VALUES ('owner', 'Owner');
         INSERT INTO users (id, username, pin_hash, display_name, role_id) VALUES ('user-1', 'owner', 'x', 'Owner', 'owner');
         INSERT INTO provisioning (terminal_id, location_id, owner_user_id, mode, home_region)
         VALUES ('unknown-device', 'loc-1', 'user-1', 'local', 'global');"
    ).unwrap();

    // On update, resolving device ID must adopt the single existing row
    let resolved = resolve_persistent_device_id(&conn, true).unwrap();
    assert_eq!(resolved, "unknown-device", "must adopt existing unknown-device row to avoid re-onboarding");

    // Setting is persisted
    let saved = kasirmu_core::Settings::get(&conn, "device.terminal_id").unwrap();
    assert_eq!(saved.as_deref(), Some("unknown-device"));

    // Second call is stable
    let again = resolve_persistent_device_id(&conn, true).unwrap();
    assert_eq!(again, "unknown-device");
}

#[test]
fn resolve_persistent_device_id_respects_existing_setting() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    kasirmu_core::migrations::run(&mut conn).unwrap();

    kasirmu_core::Settings::set(&conn, "device.terminal_id", "preconfigured-tablet-01").unwrap();

    let resolved = resolve_persistent_device_id(&conn, true).unwrap();
    assert_eq!(resolved, "preconfigured-tablet-01");
}

#[tokio::test]
async fn resolve_device_id_caches_in_app_state() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    kasirmu_core::migrations::run(&mut conn).unwrap();
    let state = crate::state::AppState::for_test_with_conn(conn);

    assert!(state.terminal_id.lock().await.is_none());

    let resolved = resolve_device_id(&state).await.unwrap();
    assert!(!resolved.is_empty());

    let cached = state.terminal_id.lock().await.clone();
    assert_eq!(cached.as_deref(), Some(resolved.as_str()));
}

