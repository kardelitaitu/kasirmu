use super::*;
use std::path::PathBuf;

fn temp_image_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("oz-local-api-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn resolve_port_defaults_and_validates() {
    let conn = oz_core::migrations::fresh_db();
    assert_eq!(resolve_port(&conn), DEFAULT_PORT);
    oz_core::Settings::set(&conn, SETTINGS_PORT, "8080").unwrap();
    assert_eq!(resolve_port(&conn), 8080);
    // Below the registered range → default.
    oz_core::Settings::set(&conn, SETTINGS_PORT, "80").unwrap();
    assert_eq!(resolve_port(&conn), DEFAULT_PORT);
    // Garbage → default.
    oz_core::Settings::set(&conn, SETTINGS_PORT, "not-a-port").unwrap();
    assert_eq!(resolve_port(&conn), DEFAULT_PORT);
}

#[test]
fn is_enabled_requires_explicit_one() {
    let conn = oz_core::migrations::fresh_db();
    assert!(!is_enabled(&conn), "default is off");
    oz_core::Settings::set(&conn, SETTINGS_ENABLED, "1").unwrap();
    assert!(is_enabled(&conn));
    oz_core::Settings::set(&conn, SETTINGS_ENABLED, "0").unwrap();
    assert!(!is_enabled(&conn));
}

#[test]
fn secret_is_generated_once_and_stable() {
    let conn = oz_core::migrations::fresh_db();
    let first = load_or_create_secret(&conn).unwrap();
    assert_eq!(first.len(), 64, "32 CSPRNG bytes as hex");
    assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
    let second = load_or_create_secret(&conn).unwrap();
    assert_eq!(first, second, "second load must not rotate the secret");
}

#[tokio::test]
async fn rotate_secret_replaces_persisted_value_and_invalidates_old_tokens() {
    let conn = oz_core::migrations::fresh_db();
    let original = load_or_create_secret(&conn).unwrap();
    let rotated = rotate_secret(&conn).unwrap();
    assert_ne!(original, rotated);
    assert_eq!(rotated.len(), 64);
    // Later loads see the rotated value — rotation does not re-fire.
    assert_eq!(load_or_create_secret(&conn).unwrap(), rotated);
    // A token minted under the old key no longer validates against the
    // new one (this is why the UI warns before rotating).
    let stale = mint_token(&original, "stale", Some(1)).unwrap();
    assert!(
        kasirmu_api::auth::validate_token_with_secret(&stale.token, Some(&rotated))
            .await
            .is_err(),
        "rotated secret must invalidate previously minted tokens"
    );
    let fresh = mint_token(&rotated, "fresh", Some(1)).unwrap();
    assert!(
        kasirmu_api::auth::validate_token_with_secret(&fresh.token, Some(&rotated))
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn mint_token_roundtrip_and_clamp() {
    let secret = "a".repeat(32);
    let resp = mint_token(&secret, "my-script", Some(2)).unwrap();
    let claims = kasirmu_api::auth::validate_token_with_secret(&resp.token, Some(&secret))
        .await
        .unwrap();
    assert_eq!(claims.sub, "my-script");

    // Out-of-range expiry is clamped, not rejected.
    let long = mint_token(&secret, "x", Some(999_999)).unwrap();
    let claims = kasirmu_api::auth::validate_token_with_secret(&long.token, Some(&secret))
        .await
        .unwrap();
    let hours = (claims.exp as i64 - claims.iat as i64) / 3600;
    assert_eq!(hours, MAX_TOKEN_HOURS);

    // Blank label falls back.
    let blank = mint_token(&secret, "   ", None).unwrap();
    let claims = kasirmu_api::auth::validate_token_with_secret(&blank.token, Some(&secret))
        .await
        .unwrap();
    assert_eq!(claims.sub, "local-script");
}

#[tokio::test]
async fn minted_token_rejected_under_wrong_secret() {
    let secret = "b".repeat(32);
    let resp = mint_token(&secret, "t", Some(1)).unwrap();
    assert!(
        kasirmu_api::auth::validate_token_with_secret(&resp.token, Some(&"c".repeat(32)))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn server_serves_health_protected_routes_and_stops() {
    let dir = temp_image_dir("serve");
    let db = Arc::new(Mutex::new(oz_core::migrations::fresh_db()));
    let secret = "d".repeat(32);
    let handle = start(
        db.clone(),
        PathBuf::from(":memory:"),
        dir.clone(),
        secret.clone(),
        0, // OS-assigned port
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);

    // Health is public.
    let resp = reqwest::get(format!("{base}/api/v1/health")).await.unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    // Self-documenting OpenAPI: the shared base surface, all scope
    // "both", cloud-only paths absent.
    let resp = reqwest::get(format!("{base}/api/openapi.json"))
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    // MED-4: the route is registered inside router()'s layer scope, so
    // it carries the same security headers as every other endpoint.
    assert_eq!(
        resp.headers()
            .get("x-content-type-options")
            .and_then(|v| v.to_str().ok()),
        Some("nosniff"),
        "local docs route must sit inside the security-headers layer"
    );
    let spec: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(spec["info"]["title"], "OZ-POS Local Terminal API");
    assert_eq!(
        spec["servers"][0]["url"].as_str(),
        Some(format!("http://127.0.0.1:{}", handle.port).as_str())
    );
    assert!(
        spec["paths"]["/api/v1/products"].is_object(),
        "shared surface present"
    );
    assert!(
        spec["paths"]["/api/sync/push"].is_null(),
        "cloud-only path leaked into local spec"
    );
    assert!(
        spec["paths"]["/api/docs"].is_null(),
        "docs UI leaked into local spec"
    );
    for (path, item) in spec["paths"].as_object().unwrap() {
        for (verb, op) in item.as_object().unwrap() {
            if matches!(verb.as_str(), "get" | "post" | "put" | "patch" | "delete") {
                assert_eq!(
                    op["x-oz-scope"].as_str(),
                    Some("both"),
                    "{verb} {path} in the local spec must be scope both"
                );
            }
        }
    }

    // Protected route without a token → 401.
    let resp = reqwest::get(format!("{base}/api/v1/products"))
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);

    // Protected route with a UI-minted token → 200.
    let token = mint_token(&secret, "test-script", Some(1)).unwrap().token;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    // A token forged with the known dev constant is rejected — the
    // per-install secret is the whole point of the stateful middleware.
    let forged = kasirmu_api::auth::create_token("forged", Some(1), None, None)
        .unwrap()
        .token;
    let resp = client
        .get(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {forged}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);

    // Token minting over HTTP requires X-Admin-Key (= the secret).
    let mint = reqwest::Client::new()
        .post(format!("{base}/api/v1/tokens"))
        .json(&serde_json::json!({"label": "no-key"}))
        .send()
        .await
        .unwrap();
    assert_eq!(mint.status(), reqwest::StatusCode::UNAUTHORIZED);
    let mint = reqwest::Client::new()
        .post(format!("{base}/api/v1/tokens"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({"label": "with-key", "expiry_hours": 1}))
        .send()
        .await
        .unwrap();
    assert_eq!(mint.status(), reqwest::StatusCode::OK);

    // Terminal client-credentials minting is OFF on the local surface
    // (review MED-5) — even with a valid admin key, the embedder opted
    // out unconditionally.
    let device = reqwest::Client::new()
        .post(format!("{base}/api/v1/tokens"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({
            "label": "kds-1", "client_id": "kds-1", "client_secret": "whatever"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(device.status(), reqwest::StatusCode::BAD_REQUEST);
    assert_eq!(
        device.json::<serde_json::Value>().await.unwrap()["error"].as_str(),
        Some("terminal_credentials_disabled")
    );

    // Stop → the listener socket dies with the task.
    handle.stop();
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        reqwest::get(format!("{base}/api/v1/health")).await.is_err(),
        "connection must fail after stop"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn start_reports_port_conflict_as_error() {
    let dir = temp_image_dir("conflict");
    let db = Arc::new(Mutex::new(oz_core::migrations::fresh_db()));
    let first = start(
        db.clone(),
        PathBuf::from(":memory:"),
        dir.clone(),
        "e".repeat(32),
        0,
    )
    .await
    .unwrap();
    // Same explicit port twice → the second bind must fail cleanly.
    let taken = first.port;
    let dup = start(
        db,
        PathBuf::from(":memory:"),
        dir.clone(),
        "e".repeat(32),
        taken,
    )
    .await;
    assert!(
        dup.is_err(),
        "re-binding a taken port must error, not panic"
    );
    first.stop();
    let _ = std::fs::remove_dir_all(&dir);
}

// ── Primary-store targeting (review HIGH-1 regression) ─────────────

#[test]
fn primary_store_id_resolves_and_falls_back() {
    let global = oz_core::migrations::fresh_db();
    // Migration 025 seeds 'default' with is_primary = 0 → fallback.
    assert_eq!(primary_store_id(&global), "default");
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    assert_eq!(primary_store_id(&global), "default");
    // A flagged non-default store wins.
    global
        .execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('store-b', 'B', '', '', 'USD', 'UTC', 0, 'x', 'x')",
            [],
        )
        .unwrap();
    global
        .execute(
            "UPDATE locations SET is_primary = 0 WHERE id = 'default'",
            [],
        )
        .unwrap();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'store-b'",
            [],
        )
        .unwrap();
    assert_eq!(primary_store_id(&global), "store-b");
}

#[tokio::test]
async fn serves_the_primary_store_database_not_the_global_one() {
    let tmp = std::env::temp_dir().join(format!("oz-local-api-store-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let global = oz_core::migrations::fresh_db();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    let manager = platform_core::StoreDatabaseManager::new(tmp.clone(), oz_core::migrations::ALL);

    let store_id = primary_store_id(&global);
    let (api_db, api_path) = open_api_store_connection(&manager, &store_id).unwrap();
    assert_eq!(api_path, tmp.join("store-default.sqlite"));

    let secret = "c".repeat(32);
    let handle = start(api_db, api_path, tmp.join("images"), secret.clone(), 0)
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);

    // Create a product through the API (JWT + operator admin key).
    let token = mint_token(&secret, "t", Some(1)).unwrap().token;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({
            "sku": "API-001", "name": "From API",
            "price": {"minor_units": 100, "currency": "USD"}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::CREATED);

    // The write must be visible through the MANAGER's connection — the
    // exact path every scoped Tauri command uses (resolve_scope).
    let ui_conn = manager.open_store("default").unwrap();
    let in_store: i64 = ui_conn
        .lock()
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM products WHERE sku = 'API-001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        in_store, 1,
        "API write must land in the store DB the UI reads"
    );

    // …and must NOT have touched the global identity DB.
    let in_global: i64 = global
        .query_row(
            "SELECT COUNT(*) FROM products WHERE sku = 'API-001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(in_global, 0, "API must not write to the global DB");

    let stopped_port = handle.port;
    handle.stop_async().await;
    // stop_async guarantees the listener is gone: an immediate re-bind
    // of the same port must not race OS socket teardown (review MED-3).
    let again = start(
        Arc::new(Mutex::new(oz_core::migrations::fresh_db())),
        PathBuf::from(":memory:"),
        tmp.join("images2"),
        secret,
        stopped_port,
    )
    .await;
    assert!(
        again.is_ok(),
        "re-bind of the just-stopped port must succeed: {:?}",
        again.err()
    );
    if let Ok(h) = again {
        h.stop_async().await;
    }
    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn resolve_store_id_prefers_configured_and_degrades() {
    let global = oz_core::migrations::fresh_db();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    global
        .execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('store-b', 'B', '', '', 'USD', 'UTC', 0, 'x', 'x')",
            [],
        )
        .unwrap();
    // Unset → primary.
    assert_eq!(resolve_store_id(&global), "default");
    // Configured real store → it.
    oz_core::Settings::set(&global, SETTINGS_STORE, "store-b").unwrap();
    assert_eq!(resolve_store_id(&global), "store-b");
    // Configured but the store was deleted → degrade to primary.
    global
        .execute("DELETE FROM locations WHERE id = 'store-b'", [])
        .unwrap();
    assert_eq!(resolve_store_id(&global), "default");
}

#[tokio::test]
async fn api_writes_land_in_the_audit_log_of_the_served_store() {
    let tmp = std::env::temp_dir().join(format!("oz-local-api-audit-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let global = oz_core::migrations::fresh_db();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    let manager = platform_core::StoreDatabaseManager::new(tmp.clone(), oz_core::migrations::ALL);
    let (api_db, api_path) = open_api_store_connection(&manager, "default").unwrap();

    let secret = "d".repeat(32);
    let sink = StoreAuditSink::new(api_db.clone(), "default".to_string());
    let handle = start_with_audit(
        api_db,
        api_path,
        tmp.join("images"),
        secret.clone(),
        0,
        Some(std::sync::Arc::new(sink)),
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);

    let token = mint_token(&secret, "audit-script", Some(1)).unwrap().token;
    let client = reqwest::Client::new();
    // A successful write and a rejected one — both must be recorded.
    let ok = client
        .post(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({
            "sku": "AUDIT-001", "name": "Audited",
            "price": {"minor_units": 100, "currency": "USD"}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), reqwest::StatusCode::CREATED);
    let bad = client
        .post(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {token}"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({"sku": "AUDIT-001", "name": "dup", "price": {"minor_units": 1, "currency": "USD"}}))
        .send()
        .await
        .unwrap();
    assert!(bad.status().is_client_error(), "duplicate must be rejected");
    // A read must NOT be recorded.
    let read = client
        .get(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(read.status(), reqwest::StatusCode::OK);

    // The sink spawns the INSERT — poll until BOTH outcomes are present
    // (the two rows race each other across spawned tasks).
    let ui_conn = manager.open_store("default").unwrap();
    let mut joined = String::new();
    let mut count = 0usize;
    for _ in 0..50 {
        // (user_id, details) — the label lives in user_id; `details`
        // carries only the numeric status (sanitize keeps it small).
        let rows: Vec<String> = ui_conn
            .lock()
            .unwrap()
            .prepare("SELECT user_id || ' ' || details FROM audit_log WHERE action = 'api.write'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        count = rows.len();
        joined = rows.join("\n");
        if count >= 2 && joined.contains("\"status\":201") && joined.contains("\"status\":4") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(count, 2, "exactly the two writes must be audited");
    assert!(joined.contains("\"status\":201"), "success row: {joined}");
    assert!(joined.contains("\"status\":4"), "failure row: {joined}");
    assert!(joined.contains("audit-script"), "token label recorded");

    handle.stop_async().await;
    let _ = std::fs::remove_dir_all(&tmp);
}

// ── DRIFT PIN — these four spellings against the manager-prefix gate ──────

/// A DRIFT PIN, not a behaviour test, and the half platform-core cannot write:
/// `platform_core::settings::is_manager_owned_key` gates the untrusted ingest
/// lanes on two hardcoded prefix literals (`raw.rs:723-726`), while the
/// `local_api.*` keys this manager actually writes are spelled HERE and are
/// named nowhere below — only [`SETTINGS_SECRET`] has a declared mirror
/// (`platform_core::settings::keys::LOCAL_API_SECRET`, "mirrors
/// `kasirmu_local_api::SETTINGS_SECRET`", keys.rs:215-218). [`SETTINGS_ENABLED`],
/// [`SETTINGS_PORT`] and [`SETTINGS_STORE`] have no name at all down there.
///
/// So if a spelling here moves and the literal does not, the live key of the
/// manager stops being refused at `.ozpkg` and remote-sync ingest, and
/// `managed_key_owner` in the desktop bridge answers `None` for it too: the
/// write carries neither refusal nor label. That is a WIDENED admission, the
/// direction this subsystem does not forgive, and it would be silent. Red the
/// other way as well — retype the literal and these four stop matching it.
///
/// Landed in this crate rather than in platform-core because it is the one
/// that already sees both sides: `oz-local-api` depends on `platform-core
/// (`crates/kasirmu-local-api/Cargo.toml`), and `platform-core` must NOT depend on
/// it. `crates/kasirmu-bridge` and `crates/kasirmu-core` can neither: neither has an
/// `oz-local-api` dependency, and no edge was added to force one.
#[test]
fn drift_pin_local_api_settings_keys_stay_manager_owned() {
    use platform_core::settings::is_manager_owned_key;
    use platform_core::settings::keys as platform_keys;

    for key in [
        SETTINGS_ENABLED,
        SETTINGS_PORT,
        SETTINGS_SECRET,
        SETTINGS_STORE,
    ] {
        assert!(
            is_manager_owned_key(key),
            "{key} is written by the Local API manager but the ingest gate no longer recognises its prefix: the spelling here and the prefix literal in platform-core/settings/raw.rs have drifted apart, so both untrusted lanes now ADMIT this live key and the bridge labels it None. Rename together, or not at all."
        );
    }

    // The one pair that is a declared copy rather than a shared name: if these
    // two stop being the same bytes, the credential deny list and the manager
    // gate cover different rows and neither side says so.
    assert_eq!(
        platform_keys::LOCAL_API_SECRET,
        SETTINGS_SECRET,
        "platform-core mirrors this key by literal, so the mirror and the original must stay byte-identical"
    );
}
