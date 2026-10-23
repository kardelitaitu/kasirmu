use super::*;
use std::path::PathBuf;

/// The image directory plus its guard.
///
/// The guard must travel with the path: `std::env::temp_dir()` resolved to the
/// machine-level `C:\WINDOWS\TEMP` here, where a create fails with
/// PermissionDenied once anything stale exists, and the bare path left behind
/// was never deleted.
fn temp_image_dir(tag: &str) -> (PathBuf, kasirmu_test_support::ScratchDir) {
    let scratch = kasirmu_test_support::ScratchDir::new(&format!("kasirmu-local-api-{tag}"));
    (scratch.path().to_path_buf(), scratch)
}

#[test]
fn resolve_port_defaults_and_validates() {
    let conn = kasirmu_core::migrations::fresh_db();
    assert_eq!(resolve_port(&conn).unwrap(), DEFAULT_PORT);
    kasirmu_core::Settings::set(&conn, SETTINGS_PORT, "8080").unwrap();
    assert_eq!(resolve_port(&conn).unwrap(), 8080);
    // Below the registered range → default.
    kasirmu_core::Settings::set(&conn, SETTINGS_PORT, "80").unwrap();
    assert_eq!(resolve_port(&conn).unwrap(), DEFAULT_PORT);
    // Garbage → default.
    kasirmu_core::Settings::set(&conn, SETTINGS_PORT, "not-a-port").unwrap();
    assert_eq!(resolve_port(&conn).unwrap(), DEFAULT_PORT);
}

#[test]
fn is_enabled_requires_explicit_one() {
    let conn = kasirmu_core::migrations::fresh_db();
    assert!(!is_enabled(&conn).unwrap(), "default is off");
    kasirmu_core::Settings::set(&conn, SETTINGS_ENABLED, "1").unwrap();
    assert!(is_enabled(&conn).unwrap());
    kasirmu_core::Settings::set(&conn, SETTINGS_ENABLED, "0").unwrap();
    assert!(!is_enabled(&conn).unwrap());
}

// ── MSL-33: a settings READ failure is not a settings VALUE ──

/// `local_api.enabled` decides whether an HTTP surface is exposed at all, so
/// the two readings of the setting must not be confused:
///
/// * `"0"` is a VALUE. The merchant turned it off; the answer is `false`.
/// * A database that cannot answer the read is a FAULT. Answering `false`
///   makes it silent -- the box stays ticked, the API never comes up, and
///   nothing anywhere says why.
///
/// `.unwrap_or(None)` collapsed the two. Renaming the table away fails the
/// read while leaving the connection healthy, so the only variable under test
/// is the swallow.
#[test]
fn a_failed_read_of_the_enabled_flag_is_not_answered_false() {
    let conn = kasirmu_core::migrations::fresh_db();
    conn.execute_batch("ALTER TABLE settings RENAME TO settings_hidden;")
        .unwrap();

    assert!(
        is_enabled(&conn).is_err(),
        "a failed read must not be answered `false` -- that is indistinguishable from the merchant disabling it"
    );
    assert!(
        resolve_port(&conn).is_err(),
        "a failed read must not silently substitute the default port"
    );
}

#[test]
fn secret_is_generated_once_and_stable() {
    let conn = kasirmu_core::migrations::fresh_db();
    let first = load_or_create_secret(&conn).unwrap();
    assert_eq!(first.len(), 64, "32 CSPRNG bytes as hex");
    assert!(first.bytes().all(|b| b.is_ascii_hexdigit()));
    let second = load_or_create_secret(&conn).unwrap();
    assert_eq!(first, second, "second load must not rotate the secret");
}

/// **C14(a): the secret is ciphertext at rest, and a legacy plaintext row is
/// migrated rather than bricked.**
///
/// The two halves pull against each other — the value must stop being cleartext
/// in `settings.value`, *and* every already-shipped install must keep reading the
/// secret it has — and the migration is what reconciles them. So both are
/// asserted here, through the public door rather than by calling the helper.
#[test]
fn secret_is_encrypted_at_rest_and_a_legacy_plaintext_row_migrates() {
    let conn = kasirmu_core::migrations::fresh_db();

    // 1. A generated secret is NOT stored as itself.
    let secret = load_or_create_secret(&conn).unwrap();
    let stored = kasirmu_core::Settings::get(&conn, SETTINGS_SECRET)
        .unwrap()
        .expect("the row exists");
    assert_ne!(
        stored, secret,
        "the secret must not sit in settings.value as cleartext"
    );
    assert_ne!(
        stored.len(),
        64,
        "the stored form must be the ciphertext envelope, not the 64-char hex secret"
    );
    assert!(!stored.bytes().all(|b| b.is_ascii_hexdigit()));
    assert_eq!(
        load_or_create_secret(&conn).unwrap(),
        secret,
        "and it must still read back as the secret"
    );

    // 2. A LEGACY plaintext row — what every shipped install has — is migrated on
    //    the next load, and the caller sees an unchanged value.
    let legacy = "0123456789abcdef".repeat(4); // exactly 64 lowercase hex
    kasirmu_core::Settings::set(&conn, SETTINGS_SECRET, &legacy).unwrap();
    assert_eq!(
        load_or_create_secret(&conn).unwrap(),
        legacy,
        "a legacy plaintext secret must still be returned — this is the case the \
         generic fail-closed reader would have bricked"
    );
    let migrated = kasirmu_core::Settings::get(&conn, SETTINGS_SECRET)
        .unwrap()
        .expect("the row still exists");
    assert_ne!(
        migrated, legacy,
        "the legacy plaintext row must have been re-persisted encrypted"
    );

    // The migration is idempotent: a second boot must not re-encrypt.
    assert_eq!(load_or_create_secret(&conn).unwrap(), legacy);
    assert_eq!(
        kasirmu_core::Settings::get(&conn, SETTINGS_SECRET)
            .unwrap()
            .unwrap(),
        migrated,
        "a second boot must leave an already-encrypted row alone"
    );

    // 3. Rotation writes ciphertext too, and still reads back.
    let rotated = rotate_secret(&conn).unwrap();
    assert_ne!(rotated, legacy);
    assert_eq!(load_or_create_secret(&conn).unwrap(), rotated);
    assert_ne!(
        kasirmu_core::Settings::get(&conn, SETTINGS_SECRET)
            .unwrap()
            .unwrap(),
        rotated
    );
}

#[tokio::test]
async fn rotate_secret_replaces_persisted_value_and_invalidates_old_tokens() {
    let conn = kasirmu_core::migrations::fresh_db();
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
    let (dir, _scratch) = temp_image_dir("serve");
    let db = Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db()));
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
    assert_eq!(spec["info"]["title"], "kasir.mu Local Terminal API");
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
    let (dir, _scratch) = temp_image_dir("conflict");
    let db = Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db()));
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
    let global = kasirmu_core::migrations::fresh_db();
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
    // The guard is bound for the whole test so the store directory outlives
    // every connection the manager hands out below.
    let scratch = kasirmu_test_support::ScratchDir::new("kasirmu-local-api-store");
    let tmp = scratch.path().to_path_buf();
    let global = kasirmu_core::migrations::fresh_db();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    let manager =
        platform_core::StoreDatabaseManager::new(tmp.clone(), kasirmu_core::migrations::ALL);

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
        Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db())),
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
    let global = kasirmu_core::migrations::fresh_db();
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
    kasirmu_core::Settings::set(&global, SETTINGS_STORE, "store-b").unwrap();
    assert_eq!(resolve_store_id(&global), "store-b");
    // Configured but the store was deleted → degrade to primary.
    global
        .execute("DELETE FROM locations WHERE id = 'store-b'", [])
        .unwrap();
    assert_eq!(resolve_store_id(&global), "default");
}

#[tokio::test]
async fn api_writes_land_in_the_audit_log_of_the_served_store() {
    let scratch = kasirmu_test_support::ScratchDir::new("kasirmu-local-api-audit");
    let tmp = scratch.path().to_path_buf();
    let global = kasirmu_core::migrations::fresh_db();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    let manager =
        platform_core::StoreDatabaseManager::new(tmp.clone(), kasirmu_core::migrations::ALL);
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

// ── O-M46: the audit sink's single writer, own connection, counted failures ──

/// A sink's own store file, migrated, exactly as `start` gives the API.
///
/// Returns the directory, the store db path, AND the guard. The guard must
/// travel with the paths: bound inside this function it would drop on return,
/// delete the directory, and leave every later open failing with CannotOpen --
/// which is how this helper failed on its first attempt (the same mistake as
/// kasirmu-core's Scratch::new, one round earlier).
fn audit_store(
    tag: &str,
) -> (
    std::path::PathBuf,
    std::path::PathBuf,
    kasirmu_test_support::ScratchDir,
) {
    let scratch = kasirmu_test_support::ScratchDir::new(&format!("kasirmu-local-api-{tag}"));
    let tmp = scratch.path().to_path_buf();
    let manager =
        platform_core::StoreDatabaseManager::new(tmp.clone(), kasirmu_core::migrations::ALL);
    manager.open_store("default").unwrap();
    (
        tmp,
        manager.checked_store_db_path("default").unwrap(),
        scratch,
    )
}

fn audit_event(path: &str, status: u16) -> kasirmu_api::api_audit::ApiWriteEvent {
    kasirmu_api::api_audit::ApiWriteEvent {
        method: "POST".to_string(),
        path: path.to_string(),
        status,
        token_label: Some("concurrency-script".to_string()),
        terminal_id: None,
    }
}

fn record_events(
    sink: &StoreAuditSink,
    from: usize,
    count: usize,
) -> Vec<kasirmu_api::api_audit::ApiWriteEvent> {
    use kasirmu_api::api_audit::AuditSink;
    let events: Vec<_> = (from..from + count)
        .map(|i| audit_event(&format!("/api/v1/products/SEQ-{i:05}/stock"), 201))
        .collect();
    for event in &events {
        sink.record(event);
    }
    events
}

/// **(a) THE TEST THAT MATTERS: events recorded under concurrency all land.**
///
/// A bounded channel that drops under load — the easy way to make this smell
/// like back-pressure without implementing it — passes every single-producer
/// test and fails here, because this drives far more events than the queue
/// holds from many producers at once and then requires every one of them as a
/// row. The channel's capacity is deliberately not a parameter of the test:
/// the assertion is "nothing recorded is lost", which is the audit contract,
/// not "the burst fits".
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_audit_events_all_land_with_no_lost_rows() {
    let (tmp, path, _store_scratch) = audit_store("audit-concurrency");
    // The budget resets every 60 s on its own; nothing here can pre-charge
    // it, so the burst is sized to fit whatever is left (see below).
    let sink = Arc::new(StoreAuditSink::open(&path, "default".to_string()).unwrap());

    // `log_audit` carries a per-database sliding budget
    // (`kasirmu_core::db::audit::AUDIT_RATE_LIMIT`), so the burst below is sized to
    // fit inside it. That budget is not this test's subject -- and it is enforced upstream
    // of the sink, so a test that overran it would be measuring it instead. (Measured:
    // overrunning it loses rows exactly as designed, which is why the size is declared
    // here rather than guessed.)
    //
    // The budget used to be PROCESS-WIDE, which made these numbers load-bearing across
    // every test in the binary: two tests writing to their own databases still drained
    // one shared counter. It moved into the `settings` table on 2026-10-23
    // (per-database, matching what the limiter is for), so each store now has its own
    // allowance and these sizes are bounded only by this test's own writes. They are kept
    // as they were -- still correct, and re-deriving them would be churn.
    const PRODUCERS: usize = 4;
    // 4 x 30 = 120 events against a 1000-per-minute budget, well inside it.
    const PER_PRODUCER: usize = 30;
    let mut producers = Vec::new();
    for p in 0..PRODUCERS {
        let sink = sink.clone();
        producers.push(tokio::spawn(async move {
            let from = p * PER_PRODUCER;
            // No await point on purpose: a producer that could yield is a
            // producer the queue rarely fills, which is exactly the case a
            // dropping implementation survives.
            record_events(&sink, from, PER_PRODUCER);
        }));
    }
    for producer in producers {
        producer.await.unwrap();
    }
    assert_eq!(
        sink.failure_count(),
        0,
        "no event may be dropped or failed during a saturated burst"
    );
    // NO backlog assertion here. It is a scheduler race: whether the writer
    // has caught up by this line is timing, not contract, and a test that
    // demands a non-empty queue at an arbitrary instant manufactures flakes.
    // The burst is >10x the channel capacity, so saturation is structural,
    // and what this test asserts is the OUTCOME: nothing lost. Saturation of
    // the full channel itself is pinned deterministically by
    // `a_full_channel_blocks_and_still_loses_nothing`.
    sink.flush().await;

    let reader = Connection::open(&path).unwrap();
    let rows: Vec<String> = reader
        .prepare("SELECT details FROM audit_log WHERE action = 'api.write'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert_eq!(
        rows.len(),
        PRODUCERS * PER_PRODUCER,
        "every recorded event must be a row: an audit trail with holes is not a slow audit trail, it is a broken one"
    );

    // Not merely the right COUNT: every individual event is present.
    let joined = rows.join("\\n");
    for i in 0..PRODUCERS * PER_PRODUCER {
        assert!(
            joined.contains(&format!("SEQ-{i:05}")),
            "event {i} is missing from the audit log"
        );
    }

    let _ = std::fs::remove_dir_all(&tmp);
}

/// **THE FULL-CHANNEL POLICY.**
///
/// # What this test used to assert, and why it could not
///
/// It was written to prove "`record` on a full channel blocks until there is
/// room". That property does not exist and cannot be tested, because
/// [`kasirmu_api::api_audit::AuditSink::record`] is a SYNCHRONOUS trait method:
/// there is no legitimate way for it to wait. Blocking the caller stalls a
/// tokio worker; spawning defers to a task nobody awaits; parking in a static
/// leaks. The previous version marked itself `multi_thread` with 4 workers,
/// pinned the single writer inside `Gated::insert`, filled 1024 slots from the
/// runtime thread, and then recorded the 1025th — which parked a drainer task
/// that could never run because the writer it needed was the one being held.
/// It HUNG the suite with no failing test named.
///
/// # What it asserts instead
///
/// The contract that IS observable and DOES matter: a full queue must never
/// LOSE an event. With the writer gated, records past capacity go through the
/// parking path; once the gate opens, every one of them reaches the table.
/// The events are recorded from a blocking thread so the round trip does not
/// need a worker the writer is occupying — which is exactly how production
/// calls it (a request handler off the reactor).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_full_channel_delays_events_and_still_loses_nothing() {
    use kasirmu_api::api_audit::AuditSink;

    /// Holds the writer on its first row until the gate opens.
    struct Gated {
        gate: std::sync::Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
        dir: std::path::PathBuf,
    }

    impl AuditTarget for Gated {
        fn insert(&self, entry: &kasirmu_core::AuditEntry) -> Result<(), String> {
            let (lock, cvar) = &*self.gate;
            let mut open = lock.lock().unwrap();
            while !*open {
                open = cvar.wait(open).unwrap();
            }
            drop(open);
            let conn = Connection::open(&self.dir).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO audit_log (id, user_id, action, target_type, target_id, details, outcome, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    entry.id,
                    entry.user_id,
                    entry.action,
                    entry.target_type,
                    entry.target_id,
                    entry.details,
                    entry.outcome,
                    entry.created_at,
                ],
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        }
    }

    let (tmp, path, _store_scratch) = audit_store("audit-full");
    let gate = std::sync::Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let sink = Arc::new(StoreAuditSink::start_writer(
        Gated {
            gate: gate.clone(),
            dir: path.clone(),
        },
        "default".to_string(),
    ));

    let capacity = sink.tx.max_capacity();

    // BUDGETED against `kasirmu_core::db::audit::AUDIT_RATE_LIMIT` (1000 per 60 s
    // window, PER-DATABASE since 2026-10-23). That limiter returns `Ok(())` WITHOUT
    // writing once the budget is spent, so a test that records more than 1000 rows
    // sees a short table and reports it as sink loss — which is exactly what this
    // test did before (1000 of 1025, looking like 25 dropped events).
    //
    // The earlier fix for that was sizing the test to the budget because the counter
    // was PROCESS-WIDE: every test in the binary spent from one allowance, so the size
    // had to leave room for tests this one could not see. The counter is now per
    // database (it lives in the `settings` table), so 900 is simply 900 writes
    // against this store's own budget. The number is unchanged, and the reason it was
    // chosen is recorded here so nobody re-derives it from a mechanism that is gone.
    const RECORDED: usize = 900;
    assert!(
        RECORDED < capacity,
        "the recorded count must stay under both the channel capacity and the audit rate limit"
    );

    // Record from a BLOCKING thread, i.e. off the reactor. Production does the
    // same (a request handler thread, not a worker), and it is required here:
    // the writer is gated inside `insert`, so recording from a worker while
    // waiting for that writer is the deadlock this test used to hit.
    let record_all = {
        let sink = sink.clone();
        move || {
            for i in 0..RECORDED {
                sink.record(&audit_event(&format!("/api/v1/products/FULL-{i:05}"), 201));
            }
        }
    };
    let recorder = tokio::task::spawn_blocking(record_all);

    // Wait until every recording has been accepted: the gated writer holds one
    // row, so a RECORDED-1 backlog means the producer has finished handing off
    // and `record` never blocked on a channel it could not fill. Bounded, so a
    // regression fails with a message instead of hanging the suite.
    let saturated = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            if sink.backlog() + 1 >= RECORDED {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await;
    assert!(
        saturated.is_ok(),
        "the queue must saturate while the writer is gated; backlog was {}",
        sink.backlog()
    );

    // Open the gate: the writer drains and the recorder works through the
    // rest. `record` past capacity parks the event rather than dropping it.
    {
        let (lock, cvar) = &*gate;
        *lock.lock().unwrap() = true;
        cvar.notify_all();
    }
    tokio::time::timeout(std::time::Duration::from_secs(60), recorder)
        .await
        .expect("every record must complete once the writer drains")
        .expect("the recording thread must not panic");

    sink.flush_inner().await.expect("the writer must drain");
    assert_eq!(sink.failure_count(), 0, "nothing may be counted as lost");

    let reader = Connection::open(&path).unwrap();
    let count: i64 = reader
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'api.write'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        count as usize, RECORDED,
        "a saturated channel must delay its events, never drop one: every recorded event must be a row"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

/// **(c) ordering is preserved for a single producer**, and the writer is
/// genuinely ONE writer.
///
/// Two failure modes this pins:
///
/// * concurrent writers — the previous shape spawned one task per event, so N
///   tasks raced for the connection and the reader saw them in whatever order
///   the scheduler produced. The audit chain hash reads the previous row's
///   hash, so that race is not cosmetic. Here a peak of 2+ writers fails the
///   test outright, which makes "one writer" a measured property rather than a
///   comment.
/// * reordering between enqueue and commit, which the read-back order catches.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_single_producer_keeps_its_order_and_there_is_one_writer() {
    let (tmp, path, _store_scratch) = audit_store("audit-order");
    let sink = StoreAuditSink::open(&path, "default".to_string()).unwrap();
    // Per-SINK census. A process-wide counter cannot answer this question:
    // another test's sink would be indistinguishable from a second writer of
    // ours. `writers_spawned` starts at 1 for a live writer.
    let spawned_at_start = sink.writers_spawned();
    record_events(&sink, 0, 60);
    assert_eq!(sink.failure_count(), 0);
    let spawned_at_end = sink.writers_spawned();
    sink.flush().await;
    assert_eq!(
        spawned_at_start, 1,
        "the sink starts with exactly one writer"
    );
    assert_eq!(
        spawned_at_end, spawned_at_start,
        "a sink must own exactly ONE writer task for its whole life (the per-event spawn is the finding); {spawned_at_end} exist after 60 events"
    );

    // A reader's order. `rowid` is INSERT order on this table, so a
    // sequence number in `target_id` that is not ascending means the writer
    // reordered events it was handed in a fixed order.
    let reader = Connection::open(&path).unwrap();
    let targets: Vec<String> = reader
        .prepare("SELECT target_id FROM audit_log WHERE action = 'api.write' ORDER BY rowid")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    let expected: Vec<String> = (0..60).map(|i| format!("SEQ-{i:05}")).collect();
    assert_eq!(
        targets, expected,
        "a single producer's events must be committed in the order they were recorded"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

/// The audit connection is the sink's OWN: the handler connection stays
/// completely uncontended while an audit burst is being written.
///
/// This is the other half of O-M46. The old sink locked the handlers'
/// `Arc<Mutex<Connection>>` for every INSERT, so this `try_lock` — a
/// handler's view of "is the connection free?" — had to fail during the burst.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn audit_writes_do_not_hold_the_handlers_connection() {
    use kasirmu_api::api_audit::AuditSink;

    let (tmp, path, _store_scratch) = audit_store("audit-own-conn");
    let handlers = Arc::new(Mutex::new(Connection::open(&path).unwrap()));
    let sink = Arc::new(StoreAuditSink::new(handlers.clone(), "default".to_string()));
    for i in 0..50 {
        sink.record(&audit_event(&format!("/api/v1/products/X-{i}"), 201));
    }

    let mut contended = 0;
    for _ in 0..50 {
        if handlers.try_lock().is_err() {
            contended += 1;
        }
        tokio::time::sleep(std::time::Duration::from_millis(1)).await;
    }
    assert_eq!(
        contended, 0,
        "the audit writer must not hold the handlers' connection: an INSERT queued behind it is the finding"
    );

    sink.flush().await;
    drop(sink);
    await_audit_writers().await;
    let read = handlers.lock().await;
    let count: i64 = read
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'api.write'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 50, "and every one of those events still landed");

    let _ = std::fs::remove_dir_all(&tmp);
}

/// **(b) a failing write increments the FAILURE COUNTER instead of only
/// logging.**
///
/// The fault is the one the ledger's symptom describes: the audit table is not
/// there. Renaming it fails the INSERT on a perfectly healthy connection, so
/// the only variable is what the sink does with the error — which used to be
/// `tracing::warn!` and nothing else.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_failing_audit_write_increments_the_failure_counter() {
    use kasirmu_api::api_audit::AuditSink;

    let (tmp, path, _store_scratch) = audit_store("audit-failure");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("ALTER TABLE audit_log RENAME TO audit_log_hidden;")
            .unwrap();
    }
    let sink = Arc::new(StoreAuditSink::open(&path, "default".to_string()).unwrap());
    for i in 0..5 {
        sink.record(&audit_event(&format!("/api/v1/products/F-{i}"), 201));
    }
    sink.flush_inner().await.expect("the writer must drain");
    let failures = sink.failure_count();

    // The counter lives on the sink and is read through `failure_count()`
    // (an `AtomicU64`, shared by the sink and its writer) — the signal a
    // monitor can scrape without parsing logs.
    assert_eq!(
        failures, 5,
        "each failed audit write must be counted, not only logged"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

/// A sink whose writes can never succeed still COUNTS every row it is handed,
/// instead of vanishing into a warn line.
#[test]
fn a_sink_whose_writes_all_fail_counts_every_failure() {
    use kasirmu_api::api_audit::AuditSink;

    let (dir, _scratch) = temp_image_dir("audit-no-conn");
    let handle = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    let failures = handle.block_on(async {
        // A target on which every write fails, driven through the REAL writer
        // and the real `record`, so what is measured is the sink's error path
        // rather than a stand-in for it.
        let sink = StoreAuditSink::start_writer(AlwaysFails, "s".to_string());
        for i in 0..3 {
            sink.record(&audit_event(&format!("/api/v1/products/N-{i}"), 500));
        }
        sink.flush().await;
        sink.failure_count()
    });
    assert_eq!(
        failures, 3,
        "every failed audit write must be counted, not only logged"
    );

    let _ = std::fs::remove_dir_all(&dir);
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
/// manager stops being refused at `.kasirpkg` and remote-sync ingest, and
/// `managed_key_owner` in the desktop bridge answers `None` for it too: the
/// write carries neither refusal nor label. That is a WIDENED admission, the
/// direction this subsystem does not forgive, and it would be silent. Red the
/// other way as well — retype the literal and these four stop matching it.
///
/// Landed in this crate rather than in platform-core because it is the one
/// that already sees both sides: `kasirmu-local-api` depends on `platform-core
/// (`crates/kasirmu-local-api/Cargo.toml`), and `platform-core` must NOT depend on
/// it. `crates/kasirmu-bridge` and `crates/kasirmu-core` can neither: neither has an
/// `kasirmu-local-api` dependency, and no edge was added to force one.
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

// ── C34: the embedded surface must not brick its own next boot ─────────

/// THE HAZARD, END TO END. The store this surface serves IS the app's own
/// file, and `check_tenant_integrity` refuses to boot when any `products`
/// row carries a tenant other than `default`. A token minted over this very
/// surface (the embedded `POST /api/v1/tokens` takes `tenant_id` from the
/// body) could therefore stamp a row that makes the NEXT launch fail.
///
/// Asserts the outcome the guard exists for: the write is refused, no row is
/// left behind, and the served database still passes the boot check.
#[tokio::test]
async fn foreign_tenant_write_is_refused_and_leaves_the_store_bootable() {
    let (tmp, _scratch) = temp_image_dir("c34-foreign");
    let global = kasirmu_core::migrations::fresh_db();
    global
        .execute(
            "UPDATE locations SET is_primary = 1 WHERE id = 'default'",
            [],
        )
        .unwrap();
    let manager =
        platform_core::StoreDatabaseManager::new(tmp.clone(), kasirmu_core::migrations::ALL);
    let (api_db, api_path) = open_api_store_connection(&manager, "default").unwrap();

    let secret = "f".repeat(32);
    let handle = start(
        api_db.clone(),
        api_path,
        tmp.join("images"),
        secret.clone(),
        0,
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);

    // A token carrying a NON-default tenant, minted with this surface's own
    // secret - exactly what an operator script (or the embedded token
    // endpoint's `tenant_id` body field) can produce.
    let foreign =
        kasirmu_api::auth::create_token("foreign", Some(1), Some("tenant-other"), Some(&secret))
            .unwrap()
            .token;
    let client = reqwest::Client::new();
    let refused = client
        .post(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {foreign}"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({
            "sku": "C34-FOREIGN", "name": "Foreign",
            "price": {"minor_units": 100, "currency": "USD"}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        refused.status(),
        reqwest::StatusCode::FORBIDDEN,
        "a non-default tenant claim must not reach a write on the embedded surface"
    );
    assert_eq!(
        refused
            .headers()
            .get("x-content-type-options")
            .and_then(|v| v.to_str().ok()),
        Some("nosniff"),
        "the refusal must carry the same security headers as every other response"
    );
    assert_eq!(
        refused.json::<serde_json::Value>().await.unwrap()["error"].as_str(),
        Some("foreign_tenant_write")
    );

    // Nothing was written: the row must not exist at all.
    {
        let store = api_db.lock().await;
        let planted: i64 = store
            .query_row(
                "SELECT COUNT(*) FROM products WHERE sku = 'C34-FOREIGN'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(planted, 0, "the refused write must leave no row behind");

        // THE POINT OF THE GUARD: the store the app boots from still passes
        // its own tenant integrity check. Without the guard this row would
        // carry tenant 'tenant-other' and the next launch would refuse to
        // start.
        assert!(
            kasirmu_core::db::Store::new(&store)
                .check_tenant_integrity()
                .is_ok(),
            "the served store must still pass the boot check after a refused foreign write"
        );
    }

    // The guard is not a blunt instrument: the SAME request with a token
    // carrying no tenant claim still writes, and lands as 'default'.
    let plain = mint_token(&secret, "plain", Some(1)).unwrap().token;
    let ok = client
        .post(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {plain}"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({
            "sku": "C34-OK", "name": "Fine",
            "price": {"minor_units": 100, "currency": "USD"}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), reqwest::StatusCode::CREATED);
    {
        let store = api_db.lock().await;
        let tenant: String = store
            .query_row(
                "SELECT tenant_id FROM products WHERE sku = 'C34-OK'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tenant, "default");
        assert!(
            kasirmu_core::db::Store::new(&store)
                .check_tenant_integrity()
                .is_ok()
        );
    }

    handle.stop_async().await;
    let _ = std::fs::remove_dir_all(&tmp);
}

/// A READ carrying a foreign claim cannot affect the next boot, so it keeps
/// its exact behaviour - the guard gates writes only, and a GET must not
/// start returning 403 to scripts that already send such a token.
#[tokio::test]
async fn foreign_tenant_read_is_not_gated() {
    let (dir, _scratch) = temp_image_dir("c34-read");
    let db = Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db()));
    let secret = "g".repeat(32);
    let handle = start(
        db,
        PathBuf::from(":memory:"),
        dir.clone(),
        secret.clone(),
        0,
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);

    let foreign =
        kasirmu_api::auth::create_token("foreign", Some(1), Some("tenant-other"), Some(&secret))
            .unwrap()
            .token;
    let resp = reqwest::Client::new()
        .get(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {foreign}"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        reqwest::StatusCode::OK,
        "reads are not gated by the C34 boundary guard"
    );

    handle.stop();
    let _ = std::fs::remove_dir_all(&dir);
}

/// The empty-string claim is the case a naive "non-default" check would miss:
/// the routes resolve the claim with `unwrap_or("default")`, which maps a
/// MISSING claim to the accepted value but passes `Some("")` straight
/// through - and `tenant_id = ''` is rejected by the boot check exactly as a
/// named foreign tenant is. So the empty claim must be refused too.
#[tokio::test]
async fn empty_tenant_claim_is_also_refused() {
    let (dir, _scratch) = temp_image_dir("c34-empty");
    let db = Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db()));
    let secret = "h".repeat(32);
    let handle = start(
        db,
        PathBuf::from(":memory:"),
        dir.clone(),
        secret.clone(),
        0,
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);

    let empty = kasirmu_api::auth::create_token("empty", Some(1), Some(""), Some(&secret))
        .unwrap()
        .token;
    let resp = reqwest::Client::new()
        .post(format!("{base}/api/v1/products"))
        .header("Authorization", format!("Bearer {empty}"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({
            "sku": "C34-EMPTY", "name": "Empty",
            "price": {"minor_units": 100, "currency": "USD"}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        reqwest::StatusCode::FORBIDDEN,
        "an empty tenant claim would stamp tenant_id = '' and brick the next boot"
    );

    handle.stop();
    let _ = std::fs::remove_dir_all(&dir);
}

/// THE INVARIANT THE GUARD MUST NOT BLUNT. `check_tenant_integrity` is the
/// boot check this whole ticket exists to protect, and it must still refuse a
/// store that genuinely carries a foreign-tenant row - whatever put it there
/// (a restore, a sync mishap, a build predating this guard). If the boundary
/// guard ever became a second, weaker implementation of the check, this is
/// what would catch it.
#[test]
fn tenant_integrity_still_refuses_a_genuinely_foreign_store() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = kasirmu_core::db::Store::new(&conn);
    assert!(store.check_tenant_integrity().is_ok(), "clean store boots");

    conn.execute(
        "INSERT INTO products (id, sku, name, price_minor, currency, tenant_id, created_at, updated_at)
         VALUES ('p-c34', 'C34-PLANTED', 'Foreign', 100, 'USD', 'tenant-other', '2026-01-01', '2026-01-01')",
        [],
    )
    .unwrap();

    let err = store.check_tenant_integrity().unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("foreign-tenant") && msg.contains("products"),
        "the boot check must still refuse the foreign row: {msg}"
    );
}

// ── C39: the trap is closed at the mint, not only fenced at the write ──

/// END-TO-END ON THE REAL EMBEDDED SURFACE. The C34 guard refuses a foreign
/// tenant at the WRITE; this proves the token that would carry it can no
/// longer be obtained here at all. Both halves matter: without C39 the trap is
/// merely fenced, and without C34 a token minted elsewhere (a restored store,
/// a token from the cloud) would still reach the stamp.
///
/// The marker is inserted by this crate's own layer, so the assertion is
/// against the assembled server - not against a handler called directly.
#[tokio::test]
async fn embedded_surface_refuses_a_caller_supplied_tenant_at_the_mint() {
    let (dir, _scratch) = temp_image_dir("c39-mint");
    let db = Arc::new(Mutex::new(kasirmu_core::migrations::fresh_db()));
    let secret = "k".repeat(32);
    let handle = start(
        db,
        PathBuf::from(":memory:"),
        dir.clone(),
        secret.clone(),
        0,
    )
    .await
    .unwrap();
    let base = format!("http://127.0.0.1:{}", handle.port);
    let client = reqwest::Client::new();

    // Before C39 this returned 200 and a token whose claim named another
    // tenant - the value the C34 guard later has to catch on the write path.
    let refused = client
        .post(format!("{base}/api/v1/tokens"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({"label": "script", "tenant_id": "tenant-other"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        refused.status(),
        reqwest::StatusCode::BAD_REQUEST,
        "the embedded mint must not issue a token scoped to another tenant"
    );
    assert_eq!(
        refused.json::<serde_json::Value>().await.unwrap()["error"].as_str(),
        Some("tenant_claim_not_supported")
    );

    // The surface still mints the tokens it is FOR - no tenant at all, which
    // is exactly what the UI's `mint_token` sends.
    let ok = client
        .post(format!("{base}/api/v1/tokens"))
        .header("X-Admin-Key", &secret)
        .json(&serde_json::json!({"label": "script"}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        ok.status(),
        reqwest::StatusCode::OK,
        "an ordinary mint on this surface must keep working"
    );

    handle.stop();
    let _ = std::fs::remove_dir_all(&dir);
}
