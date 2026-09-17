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
    assert_eq!(terminal_id.len(), 32);

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
