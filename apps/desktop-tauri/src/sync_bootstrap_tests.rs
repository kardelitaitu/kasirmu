use super::*;
use kasirmu_core::migrations;

#[test]
fn should_provision_when_no_url_is_configured() {
    // Fresh install: no settings row at all, sync off — provision.
    assert!(should_auto_provision(None, false, false));
    assert!(should_auto_provision(None, true, false));
}

#[test]
fn should_not_provision_when_a_url_is_already_configured() {
    assert!(!should_auto_provision(
        Some("http://localhost:3099"),
        false,
        true
    ));
    assert!(!should_auto_provision(
        Some("https://cloud.example.com"),
        true,
        true
    ));
}

#[test]
fn should_provision_when_url_is_cleared_even_with_retained_key() {
    // An old key without a target URL is still unconfigured. The local
    // bootstrap must restore the URL and enable sync on startup.
    assert!(should_auto_provision(Some(""), false, true));
    assert!(should_auto_provision(Some("   "), false, true));
}

#[test]
fn should_provision_when_sync_is_enabled_but_url_was_cleared() {
    // Sync on but the URL field is empty — a broken half-configured
    // state. Provisioning repairs it and matches user intent.
    assert!(should_auto_provision(Some(""), true, true));
    assert!(should_auto_provision(Some("   "), true, true));
}

#[test]
fn should_provision_when_empty_url_has_never_had_a_key() {
    // A fresh settings table may contain an empty URL row with sync
    // disabled. Without an API key this is still an unconfigured local
    // install, not an explicit opt-out, so debug bootstrap should heal it.
    assert!(should_auto_provision(Some(""), false, false));
    assert!(should_auto_provision(Some("   "), false, false));
}

#[test]
fn persist_writes_url_key_and_enables_sync() {
    let mut conn = migrations::fresh_db();
    persist_provisioned_sync(&mut conn, LOCAL_SYNC_URL, "jwt-token").unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap().as_deref(),
        Some(LOCAL_SYNC_URL)
    );
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap().as_deref(),
        Some("jwt-token")
    );
    assert!(Settings::is_sync_enabled(&conn).unwrap());
}

#[test]
fn persist_is_idempotent() {
    let mut conn = migrations::fresh_db();
    persist_provisioned_sync(&mut conn, LOCAL_SYNC_URL, "token-a").unwrap();
    persist_provisioned_sync(&mut conn, LOCAL_SYNC_URL, "token-b").unwrap();
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap().as_deref(),
        Some("token-b")
    );
}

#[tokio::test]
async fn orchestrator_pairs_terminal_and_mints_with_client_credentials() {
    // ADR sync-auth-hardening P3: on first run the bootstrap registers
    // the terminal, stores the device secret, and mints its token with
    // client credentials — no admin key, no manual pairing.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let token_body: Arc<tokio::sync::Mutex<Option<String>>> =
        Arc::new(tokio::sync::Mutex::new(None));
    let token_body_server = token_body.clone();
    let task = tokio::spawn(async move {
        let mut echoed_terminal_id = String::new();
        for _ in 0..3 {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let mut buffer = vec![0_u8; 16 * 1024];
            let n = socket.read(&mut buffer).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..n]).into_owned();
            let path = request
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or_default();
            let response = if path == "/health" {
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}"
                    .to_string()
            } else if path == "/api/v1/terminals" {
                // Echo the client-generated terminal id back.
                if let Some(line) = request.lines().rev().find(|l| !l.trim().is_empty())
                    && let Ok(v) = serde_json::from_str::<serde_json::Value>(line)
                {
                    echoed_terminal_id = v["terminal_id"].as_str().unwrap_or_default().to_string();
                }
                let body = format!(
                    "{{\"terminal_id\":\"{echoed_terminal_id}\",\"device_secret\":\"dev-secret-xyz\"}}"
                );
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
            } else {
                *token_body_server.lock().await = Some(request);
                let body = r#"{"token":{"token":"jwt-paired","expires_at":null,"token_id":"t1"}}"#;
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
            };
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });

    let db = Arc::new(Mutex::new(migrations::fresh_db()));
    auto_provision_local_sync_with_url(db.clone(), &url).await;
    task.await.unwrap();

    let conn = db.try_lock().unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap().as_deref(),
        Some(url.as_str())
    );
    assert_eq!(
        Settings::get_sync_api_key(&conn).unwrap().as_deref(),
        Some("jwt-paired")
    );
    assert!(Settings::is_sync_enabled(&conn).unwrap());
    // The device secret was stored so later launches reuse it.
    assert_eq!(
        Settings::get_sync_terminal_secret(&conn)
            .unwrap()
            .as_deref(),
        Some("dev-secret-xyz")
    );
    let terminal_id = Settings::get_sync_terminal_id(&conn)
        .unwrap()
        .expect("terminal id must be persisted");
    // The pairing identity is the device's RESOLVED terminals.id row, not a
    // random UUID: every recipient row the cloud serves keys on a row id, so
    // a claim naming anything else identifies a terminal no row can answer
    // for. This install had no row (a fresh db), so the bootstrap mirrored
    // the hostname in — the same mirror publish_memo performs — and the
    // stored pairing must name exactly that row.
    let store = kasirmu_core::Store::new(&conn);
    assert_eq!(
        store
            .resolve_terminal_row_id(kasirmu_bridge::memo::DEFAULT_TENANT_ID, &terminal_id)
            .unwrap()
            .as_deref(),
        Some(terminal_id.as_str()),
        "the pairing's client_id must resolve to a real terminals.id row"
    );
    assert_ne!(
        terminal_id.len(),
        32,
        "the legacy random-UUID pairing id must be gone for a mirrorable device"
    );
    // And the mirror row's device identity is the hostname, so a session
    // (which carries the hostname) resolves to the SAME row the pairing used.
    let device = kasirmu_bridge::health::get_device_id().await.unwrap();
    assert_eq!(
        store
            .resolve_terminal_row_id(kasirmu_bridge::memo::DEFAULT_TENANT_ID, &device)
            .unwrap()
            .as_deref(),
        Some(terminal_id.as_str()),
        "the device's hostname must resolve to the row the pairing was made under"
    );

    // The token request carried the client credentials, not the admin key.
    let token_request = token_body.lock().await.clone().unwrap();
    assert!(
        token_request.contains("\"client_id\":\"")
            && token_request.contains("\"client_secret\":\"dev-secret-xyz\""),
        "token request did not carry client credentials: {token_request}"
    );
    assert!(
        !token_request.to_ascii_lowercase().contains("x-admin-key"),
        "paired minting must not send the admin key"
    );
}

#[tokio::test]
async fn orchestrator_never_clobbers_existing_configuration() {
    // Safety contract: an install that already has a server URL must
    // be left completely untouched — auto-provision must not overwrite
    // it, flip sync on, or inject a key.
    let db = Arc::new(Mutex::new(migrations::fresh_db()));
    {
        let conn = db.try_lock().unwrap();
        Settings::set_sync_server_url(&conn, "https://prod.example.com").unwrap();
        Settings::set_sync_enabled(&conn, false).unwrap();
    }

    auto_provision_local_sync(db.clone()).await;

    let conn = db.try_lock().unwrap();
    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap().as_deref(),
        Some("https://prod.example.com")
    );
    assert!(!Settings::is_sync_enabled(&conn).unwrap());
    assert!(Settings::get_sync_api_key(&conn).unwrap().is_none());
}

#[tokio::test]
async fn pairing_reuses_the_devices_existing_terminal_row_not_a_mirrored_one() {
    // The device is already registered in the global table (the
    // set_features auto-register path), with the hostname as its device id.
    // The pairing must adopt THAT row's id — not mirror a second row — so the
    // claim names the terminal every other leg (sessions, memos) resolves to.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        for _ in 0..3 {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let mut buffer = vec![0_u8; 16 * 1024];
            let n = socket.read(&mut buffer).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..n]).into_owned();
            let path = request
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or_default()
                .to_owned();
            let (response, is_register) = if path == "/health" {
                (
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}"
                        .to_string(),
                    false,
                )
            } else if path == "/api/v1/terminals" {
                let terminal_id = request
                    .split("\r\n\r\n")
                    .nth(1)
                    .and_then(|b| serde_json::from_str::<serde_json::Value>(b).ok())
                    .and_then(|v| v["terminal_id"].as_str().map(str::to_owned))
                    .unwrap_or_default();
                let body = format!(
                    "{{\"terminal_id\":\"{terminal_id}\",\"device_secret\":\"dev-secret-2\"}}"
                );
                (
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    ),
                    true,
                )
            } else {
                let body =
                    r#"{"token":{"token":"jwt-paired-2","expires_at":null,"token_id":"t2"}}"#;
                (
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    ),
                    false,
                )
            };
            let _ = is_register;
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });

    let db = Arc::new(Mutex::new(migrations::fresh_db()));
    let device = kasirmu_bridge::health::get_device_id().await.unwrap();
    let existing_row_id = {
        let conn = db.try_lock().unwrap();
        let store = kasirmu_core::Store::new(&conn);
        let terminal = kasirmu_core::Terminal::new("Front counter", &device);
        store.create_terminal(&terminal).unwrap();
        terminal.id
    };

    auto_provision_local_sync_with_url(db.clone(), &url).await;
    task.await.unwrap();

    let conn = db.try_lock().unwrap();
    assert_eq!(
        Settings::get_sync_terminal_id(&conn).unwrap().as_deref(),
        Some(existing_row_id.as_str()),
        "the pairing must adopt the device's EXISTING terminals.id row"
    );
    // No second row was created for the same device.
    let store = kasirmu_core::Store::new(&conn);
    let same_device = store
        .resolve_terminal_row_id(kasirmu_bridge::memo::DEFAULT_TENANT_ID, &device)
        .unwrap();
    assert_eq!(same_device.as_deref(), Some(existing_row_id.as_str()));
}

#[tokio::test]
async fn a_stored_pairing_whose_row_no_longer_resolves_is_dropped_and_re_paired() {
    // Re-registration (or a restored DB) can leave a stored pairing whose
    // client_id names no terminals.id row any more. Minting with it would
    // produce claims for a terminal that does not exist — the exact defect
    // the row-id pairing exists to end — so the bootstrap must discard it and
    // pair again under the current row id. The server here echoes whatever
    // id it is sent, so the re-pair is observable in the persisted value.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        for _ in 0..3 {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let mut buffer = vec![0_u8; 16 * 1024];
            let n = socket.read(&mut buffer).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..n]).into_owned();
            let path = request
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or_default()
                .to_owned();
            let response = if path == "/health" {
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}"
                    .to_string()
            } else if path == "/api/v1/terminals" {
                let terminal_id = request
                    .split("\r\n\r\n")
                    .nth(1)
                    .and_then(|b| serde_json::from_str::<serde_json::Value>(b).ok())
                    .and_then(|v| v["terminal_id"].as_str().map(str::to_owned))
                    .unwrap_or_default();
                let body = format!(
                    "{{\"terminal_id\":\"{terminal_id}\",\"device_secret\":\"dev-secret-3\"}}"
                );
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
            } else {
                let body =
                    r#"{"token":{"token":"jwt-paired-3","expires_at":null,"token_id":"t3"}}"#;
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
            };
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });

    let db = Arc::new(Mutex::new(migrations::fresh_db()));
    let device = kasirmu_bridge::health::get_device_id().await.unwrap();
    {
        let conn = db.try_lock().unwrap();
        let store = kasirmu_core::Store::new(&conn);
        let terminal = kasirmu_core::Terminal::new("Front counter", &device);
        store.create_terminal(&terminal).unwrap();
        // The stale pairing: an id that is not any row's id or device_id.
        Settings::set_sync_terminal_id(&conn, "0123456789abcdef0123456789abcdef").unwrap();
        Settings::set_sync_terminal_secret(&conn, "old-secret").unwrap();
    }

    auto_provision_local_sync_with_url(db.clone(), &url).await;
    task.await.unwrap();

    let conn = db.try_lock().unwrap();
    let stored = Settings::get_sync_terminal_id(&conn).unwrap().unwrap();
    assert_ne!(
        stored, "0123456789abcdef0123456789abcdef",
        "the stale pairing must not survive"
    );
    assert_eq!(
        Settings::get_sync_terminal_secret(&conn)
            .unwrap()
            .as_deref(),
        Some("dev-secret-3"),
        "the re-pair must have completed (new secret stored)"
    );
    let store = kasirmu_core::Store::new(&conn);
    assert_eq!(
        store
            .resolve_terminal_row_id(kasirmu_bridge::memo::DEFAULT_TENANT_ID, &stored)
            .unwrap()
            .as_deref(),
        Some(stored.as_str()),
        "the replacement pairing must name a real terminals.id row"
    );
}
