//! Command-level tests for the local API surface. The heavy lifting
//! (bind/serve/mint) is covered in `local_api_tests.rs`; these cover the
//! status projection and setting persistence the IPC layer adds.

use super::*;
use crate::state::AppState;

#[tokio::test]
async fn build_status_reflects_settings_and_slot() {
    let state = AppState::for_test_with_conn(kasirmu_core::migrations::fresh_db());

    // Fresh install: off, not running, default port, no URL.
    let s = build_status(&state).await.unwrap();
    assert!(!s.enabled);
    assert!(!s.running);
    assert_eq!(s.port, local_api::DEFAULT_PORT);
    assert!(s.base_url.is_none());

    // Enabled intent + custom port surface without a running server.
    {
        let db = state.db.lock().await;
        persist_setting(&db, local_api::SETTINGS_ENABLED, "1").unwrap();
        persist_setting(&db, local_api::SETTINGS_PORT, "4010").unwrap();
    }
    let s = build_status(&state).await.unwrap();
    assert!(s.enabled);
    assert!(!s.running);
    assert_eq!(s.port, 4010);
    assert!(s.base_url.is_none());
}

#[tokio::test]
async fn build_status_reports_running_handle() {
    let state = AppState::for_test_with_conn(kasirmu_core::migrations::fresh_db());
    let dir = std::env::temp_dir().join(format!("oz-local-api-cmd-{}", uuid::Uuid::new_v4()));
    let handle = local_api::start(
        state.db.clone(),
        state.db_path.clone(),
        dir.clone(),
        "f".repeat(32),
        0,
    )
    .await
    .unwrap();
    let base_url = handle.base_url.clone();
    *state.local_api.lock().await = Some(handle);

    let s = build_status(&state).await.unwrap();
    assert!(s.running);
    assert_eq!(s.base_url.as_deref(), Some(base_url.as_str()));

    // Stop path mirrors the command's disable branch.
    if let Some(handle) = state.local_api.lock().await.take() {
        handle.stop();
    }
    let s = build_status(&state).await.unwrap();
    assert!(!s.running);
    assert!(s.base_url.is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn mint_uses_persisted_secret_stably() {
    let state = AppState::for_test_with_conn(kasirmu_core::migrations::fresh_db());
    let secret = {
        let db = state.db.lock().await;
        local_api::load_or_create_secret(&db).unwrap()
    };
    let first = local_api::mint_token(&secret, "script-a", Some(1)).unwrap();
    let second_secret = {
        let db = state.db.lock().await;
        local_api::load_or_create_secret(&db).unwrap()
    };
    assert_eq!(
        secret, second_secret,
        "secret must not rotate between mints"
    );
    let second = local_api::mint_token(&second_secret, "script-b", Some(1)).unwrap();
    assert_ne!(first.token_id, second.token_id);
    // Both validate under the same per-install secret.
    for t in [&first.token, &second.token] {
        assert!(
            kasirmu_api::auth::validate_token_with_secret(t, Some(&secret))
                .await
                .is_ok()
        );
    }
}

// ── Lifecycle helpers (run_* bodies, review LOW-7) ─────────────────

/// State wired for real start/stop cycles: fresh global DB (port
/// pre-persisted on the raw connection before wrapping — no lock needed,
/// `blocking_lock` would panic inside the test runtime), isolated store
/// dir, and a probe-bound free port.
fn lifecycle_state() -> (AppState, std::path::PathBuf, u16) {
    let tmp = std::env::temp_dir().join(format!("oz-local-api-life-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let conn = kasirmu_core::migrations::fresh_db();
    kasirmu_core::Settings::set(&conn, local_api::SETTINGS_PORT, &port.to_string()).unwrap();
    let mut state = AppState::for_test_with_conn(conn);
    state.db_manager =
        platform_core::StoreDatabaseManager::new(tmp.clone(), kasirmu_core::migrations::ALL);
    (state, tmp.join("images"), port)
}

#[tokio::test]
async fn enable_disable_cycle_binds_serves_and_persists() {
    let (state, image_dir, port) = lifecycle_state();
    let s = run_set_enabled(&state, image_dir.clone(), true)
        .await
        .unwrap();
    assert!(s.enabled && s.running);
    assert_eq!(
        s.base_url.as_deref(),
        Some(format!("http://127.0.0.1:{port}/api/v1").as_str())
    );

    // The server answers on the configured port.
    let health = reqwest::get(format!("http://127.0.0.1:{port}/api/v1/health")).await;
    assert!(health.is_ok(), "loopback server must accept connections");

    let s = run_set_enabled(&state, image_dir.clone(), false)
        .await
        .unwrap();
    assert!(!s.running);
    assert!(!s.enabled);
    {
        let db = state.db.lock().await;
        assert_eq!(
            kasirmu_core::Settings::get(&db, local_api::SETTINGS_ENABLED).unwrap(),
            Some("0".into())
        );
    }
    let _ = std::fs::remove_dir_all(image_dir.parent().unwrap());
}

#[tokio::test]
async fn enable_is_idempotent_while_running() {
    let (state, image_dir, port) = lifecycle_state();
    let first = run_set_enabled(&state, image_dir.clone(), true)
        .await
        .unwrap();
    let second = run_set_enabled(&state, image_dir.clone(), true)
        .await
        .unwrap();
    assert_eq!(first.base_url, second.base_url);
    assert_eq!(
        second.base_url,
        Some(format!("http://127.0.0.1:{port}/api/v1"))
    );
    let _ = std::fs::remove_dir_all(image_dir.parent().unwrap());
}

#[tokio::test]
async fn enable_with_taken_port_errors_and_stays_off() {
    let (state, image_dir, port) = lifecycle_state();
    // Occupy the configured port before the enable attempt.
    let squatter = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
    let err = run_set_enabled(&state, image_dir.clone(), true).await;
    assert!(err.is_err(), "bind conflict must surface as Err");
    let s = build_status(&state).await.unwrap();
    assert!(
        !s.running && !s.enabled,
        "failed enable must not persist on"
    );
    drop(squatter);
    let _ = std::fs::remove_dir_all(image_dir.parent().unwrap());
}

#[tokio::test]
async fn set_port_restarts_running_server_on_new_port() {
    let (state, image_dir, old_port) = lifecycle_state();
    run_set_enabled(&state, image_dir.clone(), true)
        .await
        .unwrap();
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let new_port = probe.local_addr().unwrap().port();
    drop(probe);

    let s = run_set_port(&state, image_dir.clone(), new_port)
        .await
        .unwrap();
    assert!(s.running);
    assert_eq!(s.port, new_port);
    assert_eq!(
        s.base_url,
        Some(format!("http://127.0.0.1:{new_port}/api/v1"))
    );
    // Old port is gone, new port answers.
    assert!(
        reqwest::get(format!("http://127.0.0.1:{old_port}/api/v1/health"))
            .await
            .is_err()
    );
    assert!(
        reqwest::get(format!("http://127.0.0.1:{new_port}/api/v1/health"))
            .await
            .is_ok()
    );

    // Out-of-range rejected without touching the running server.
    let err = run_set_port(&state, image_dir.clone(), 80)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    assert!(build_status(&state).await.unwrap().running);
    let _ = std::fs::remove_dir_all(image_dir.parent().unwrap());
}

#[tokio::test]
async fn rotate_secret_swaps_key_and_keeps_server_up() {
    let (state, image_dir, port) = lifecycle_state();
    run_set_enabled(&state, image_dir.clone(), true)
        .await
        .unwrap();
    let old_secret = {
        let db = state.db.lock().await;
        local_api::load_or_create_secret(&db).unwrap()
    };

    let s = run_rotate_secret(&state, image_dir.clone()).await.unwrap();
    assert!(
        s.running,
        "rotation must keep the server up on the same port"
    );
    assert_eq!(s.base_url, Some(format!("http://127.0.0.1:{port}/api/v1")));

    let new_secret = {
        let db = state.db.lock().await;
        local_api::load_or_create_secret(&db).unwrap()
    };
    assert_ne!(old_secret, new_secret);
    // A token minted with the old key no longer validates against the
    // rotated persisted secret (the running server now uses the new one).
    let stale = local_api::mint_token(&old_secret, "stale", Some(1)).unwrap();
    assert!(
        kasirmu_api::auth::validate_token_with_secret(&stale.token, Some(&new_secret))
            .await
            .is_err()
    );
    let _ = std::fs::remove_dir_all(image_dir.parent().unwrap());
}

#[tokio::test]
async fn set_store_restarts_server_against_new_target() {
    let (state, image_dir, _port) = lifecycle_state();
    // Register a second store profile on the global DB.
    {
        let db = state.db.lock().await;
        db.execute(
            "INSERT INTO locations (id, name, address, tax_id, currency, timezone, is_primary, created_at, updated_at)
             VALUES ('store-b', 'B', '', '', 'USD', 'UTC', 0, 'x', 'x')",
            [],
        )
        .unwrap();
    }
    run_set_enabled(&state, image_dir.clone(), true)
        .await
        .unwrap();
    assert_eq!(build_status(&state).await.unwrap().store_id, "default");

    let s = run_set_store(&state, image_dir.clone(), "store-b")
        .await
        .unwrap();
    assert!(s.running, "store switch keeps the server up");
    assert_eq!(s.store_id, "store-b");
    // store-b's file exists and is the served DB.
    assert!(
        image_dir
            .parent()
            .unwrap()
            .join("store-store-b.sqlite")
            .exists()
    );

    // Unknown store rejected without touching the running server.
    let err = run_set_store(&state, image_dir.clone(), "ghost")
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    assert_eq!(build_status(&state).await.unwrap().store_id, "store-b");

    // Empty resets to primary.
    let s = run_set_store(&state, image_dir.clone(), "").await.unwrap();
    assert_eq!(s.store_id, "default");
    let _ = std::fs::remove_dir_all(image_dir.parent().unwrap());
}
