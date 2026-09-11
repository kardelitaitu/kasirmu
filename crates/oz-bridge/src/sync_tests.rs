//! Unit tests for the `oz_bridge::sync` module (relocated from the desktop
//! `commands/sync_tests.rs` mount): DTO wire shapes, the settings/consent
//! contracts, and the `sync_client` loopback wire test. Pure helpers and
//! `&Connection` free functions only — no `BridgeCtx` needed.

use super::*;

use std::sync::Arc;

#[test]
fn sync_settings_serialize() {
    let s = SyncSettingsDto {
        server_url: Some("https://sync.example.com".into()),
        has_api_key: true,
        enabled: true,
    };
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["serverUrl"], "https://sync.example.com");
    assert_eq!(json["hasApiKey"], true);
    assert_eq!(json["enabled"], true);
}

#[test]
fn sync_settings_no_url_disabled() {
    let s = SyncSettingsDto {
        server_url: None,
        has_api_key: false,
        enabled: false,
    };
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["serverUrl"].is_null());
    assert_eq!(json["hasApiKey"], false);
    assert_eq!(json["enabled"], false);
}
#[cfg(debug_assertions)]
#[test]
fn sync_probe_falls_back_to_cloud_url_when_unconfigured() {
    // With the cloud fallback re-enabled, an unconfigured sync resolves
    // to the cloud server URL so the login-screen indicator works.
    let resolved = resolve_sync_probe_url(None, None, true);
    assert_eq!(resolved.as_deref(), Some("https://license.ozpos.my.id"));
    assert_eq!(
        resolve_sync_probe_url(None, Some(String::new()), true).as_deref(),
        Some("https://license.ozpos.my.id")
    );
    // Explicit allow_local_fallback = false still returns None (production).
    assert_eq!(resolve_sync_probe_url(None, None, false), None);
}

#[test]
fn update_sync_settings_deserialize() {
    let json = r#"{"serverUrl":"https://sync.example.com","apiKey":"sk-abc123","enabled":true}"#;
    let args: UpdateSyncSettingsArgs = serde_json::from_str(json).unwrap();
    assert_eq!(args.server_url.unwrap(), "https://sync.example.com");
    assert_eq!(args.api_key.unwrap(), "sk-abc123");
    assert!(args.enabled);
}

#[test]
fn update_sync_settings_deserialize_no_key() {
    let json = r#"{"serverUrl":null,"apiKey":null,"enabled":false}"#;
    let args: UpdateSyncSettingsArgs = serde_json::from_str(json).unwrap();
    assert!(args.server_url.is_none());
    assert!(args.api_key.is_none());
    assert!(!args.enabled);
}

#[test]
fn update_sync_settings_data_clear_url_writes_empty_row() {
    // The UI sends server_url: None when the user clears the field.
    // The command must write an empty row (Some("")) rather than
    // leaving the stale URL (which would keep auto-provision from ever
    // repairing a broken URL) or deleting the row (which would make a
    // cleared + disabled install look like a fresh one and re-trigger
    // provisioning on the next debug launch). THIS app is where the
    // should_auto_provision discriminator runs, so the pin belongs
    // here, not just on the tablet twin.
    let conn = oz_core::migrations::fresh_db();
    Settings::set_sync_server_url(&conn, "https://sync.example.com").unwrap();
    Settings::set_sync_enabled(&conn, false).unwrap();

    let args = UpdateSyncSettingsArgs {
        server_url: None,
        api_key: None,
        enabled: false,
    };
    update_sync_settings_data(&conn, &args).unwrap();

    assert_eq!(
        Settings::get_sync_server_url(&conn).unwrap(),
        Some("".into())
    );
}

#[test]
fn update_sync_settings_debug() {
    let args = UpdateSyncSettingsArgs {
        server_url: Some("https://sync.example.com".into()),
        api_key: None,
        enabled: true,
    };
    let debug = format!("{args:?}");
    assert!(debug.contains("sync.example.com"));
    assert!(debug.contains("true"));
}

#[test]
fn sync_pull_args_deserialize() {
    let json = r#"{"confirmDestructive":true}"#;
    let args: SyncPullArgs = serde_json::from_str(json).unwrap();
    assert!(args.confirm_destructive);
}

#[test]
fn sync_pull_args_deserialize_false() {
    let json = r#"{"confirmDestructive":false}"#;
    let args: SyncPullArgs = serde_json::from_str(json).unwrap();
    assert!(!args.confirm_destructive);
}

#[test]
fn sync_pull_args_missing_consent_fails() {
    // SYNC-03: a payload with no consent key must not silently
    // default to true — serde errors on the missing field.
    let result = serde_json::from_str::<SyncPullArgs>(r#"{}"#);
    assert!(
        result.is_err(),
        "missing confirm_destructive must fail deserialization"
    );
}

#[test]
fn validate_pull_consent_accepts_true() {
    let args = SyncPullArgs {
        confirm_destructive: true,
    };
    assert!(validate_pull_consent(&args).is_ok());
}

#[test]
fn validate_pull_consent_rejects_false() {
    let args = SyncPullArgs {
        confirm_destructive: false,
    };
    let err = validate_pull_consent(&args).unwrap_err();
    assert!(err.to_string().contains("confirm_destructive"));
}

#[test]
fn pull_result_serialize_no_error() {
    let r = PullResult {
        products_pulled: 10,
        tax_rates_pulled: 2,
        users_pulled: 3,
        error: None,
    };
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["products_pulled"], 10);
    assert_eq!(json["tax_rates_pulled"], 2);
    assert_eq!(json["users_pulled"], 3);
    assert!(json["error"].is_null());
}

#[test]
fn pull_result_serialize_with_error() {
    let r = PullResult {
        products_pulled: 0,
        tax_rates_pulled: 0,
        users_pulled: 0,
        error: Some("network unreachable".into()),
    };
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["products_pulled"], 0);
    assert_eq!(json["error"], "network unreachable");
}

#[test]
fn pull_result_deserialize() {
    let json = r#"{"products_pulled":5,"tax_rates_pulled":1,"users_pulled":2,"error":null}"#;
    let r: PullResult = serde_json::from_str(json).unwrap();
    assert_eq!(r.products_pulled, 5);
    assert_eq!(r.tax_rates_pulled, 1);
    assert_eq!(r.users_pulled, 2);
    assert!(r.error.is_none());
}

#[tokio::test]
async fn request_token_sends_admin_key_header_when_provided() {
    // ADR sync-auth-hardening P2: a gated server (OZ_ADMIN_KEY set)
    // only mints tokens when the request carries the matching
    // X-Admin-Key header. Pin the wire contract here.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_url = format!("http://{}", listener.local_addr().unwrap());
    let captured: Arc<tokio::sync::Mutex<Option<String>>> = Arc::new(tokio::sync::Mutex::new(None));
    let captured_server = captured.clone();
    let task = tokio::spawn(async move {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 16 * 1024];
        let n = socket.read(&mut buffer).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..n]).into_owned();
        *captured_server.lock().await = Some(request);
        let body = r#"{"token":{"token":"jwt-1","expires_at":null,"token_id":"u1"}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    });

    let result = sync_client::request_token(&server_url, Some("sekret")).await;
    task.await.unwrap();

    assert!(result.ok, "token request failed: {}", result.status);
    let request = captured.lock().await.clone().unwrap();
    assert!(
        request.to_ascii_lowercase().contains("x-admin-key: sekret"),
        "token request did not carry the admin key: {request}"
    );
}

// ── PostgreSQL sync settings & daemon commands ────────────────

#[test]
fn pg_sync_settings_dto_serialize_camel_case() {
    let dto = PgSyncSettingsDto {
        enabled: true,
        host: Some("db.example.com".into()),
        port: Some("5432".into()),
        dbname: Some("oz_sync".into()),
        user: Some("sync_user".into()),
        has_password: true,
        require_tls: true,
    };
    let json = serde_json::to_value(&dto).unwrap();
    assert_eq!(json["enabled"], true);
    assert_eq!(json["host"], "db.example.com");
    assert_eq!(json["port"], "5432");
    assert_eq!(json["dbname"], "oz_sync");
    assert_eq!(json["user"], "sync_user");
    assert_eq!(json["hasPassword"], true);
    assert_eq!(json["requireTls"], true);
}

#[test]
fn update_pg_sync_settings_args_deserialize() {
    let json = r#"{"enabled":true,"host":"db.example.com","port":"5432","dbname":"oz_sync","user":"sync_user","password":"secret","requireTls":true}"#;
    let args: UpdatePgSyncSettingsArgs = serde_json::from_str(json).unwrap();
    assert!(args.enabled);
    assert_eq!(args.host.as_deref(), Some("db.example.com"));
    assert_eq!(args.port.as_deref(), Some("5432"));
    assert_eq!(args.dbname.as_deref(), Some("oz_sync"));
    assert_eq!(args.user.as_deref(), Some("sync_user"));
    assert_eq!(args.password.as_deref(), Some("secret"));
    assert_eq!(args.require_tls, Some(true));
}

#[test]
fn update_pg_sync_settings_data_roundtrip() {
    let conn = oz_core::migrations::fresh_db();
    let args = UpdatePgSyncSettingsArgs {
        enabled: true,
        host: Some("db.example.com".into()),
        port: Some("5433".into()),
        dbname: Some("oz_sync".into()),
        user: Some("sync_user".into()),
        password: Some("secret".into()),
        require_tls: Some(true),
    };
    update_pg_sync_settings_data(&conn, &args).unwrap();

    let dto = run_get_pg_sync_settings(&conn).unwrap();
    assert!(dto.enabled);
    assert_eq!(dto.host.as_deref(), Some("db.example.com"));
    assert_eq!(dto.port.as_deref(), Some("5433"));
    assert_eq!(dto.dbname.as_deref(), Some("oz_sync"));
    assert_eq!(dto.user.as_deref(), Some("sync_user"));
    assert!(dto.has_password);
    assert!(dto.require_tls);
}

#[test]
fn update_pg_sync_settings_data_disabled_default() {
    let conn = oz_core::migrations::fresh_db();
    let dto = run_get_pg_sync_settings(&conn).unwrap();
    assert!(!dto.enabled);
    assert!(dto.host.is_none());
    assert!(dto.port.is_none());
    assert!(dto.dbname.is_none());
    assert!(dto.user.is_none());
    assert!(!dto.has_password);
    // TLS defaults to off, matching the historical NoTls transport.
    assert!(!dto.require_tls);
}

#[test]
fn update_pg_sync_settings_data_none_clears_optional_fields() {
    let conn = oz_core::migrations::fresh_db();
    update_pg_sync_settings_data(
        &conn,
        &UpdatePgSyncSettingsArgs {
            enabled: true,
            host: Some("db.example.com".into()),
            port: Some("5432".into()),
            dbname: Some("oz_sync".into()),
            user: Some("sync_user".into()),
            password: None,
            require_tls: Some(true),
        },
    )
    .unwrap();
    // A later save with None clears the connection fields (same
    // contract as the HTTP sync URL handling).
    update_pg_sync_settings_data(
        &conn,
        &UpdatePgSyncSettingsArgs {
            enabled: false,
            host: None,
            port: None,
            dbname: None,
            user: None,
            password: None,
            require_tls: None,
        },
    )
    .unwrap();

    let dto = run_get_pg_sync_settings(&conn).unwrap();
    assert!(!dto.enabled);
    assert!(dto.host.is_none());
    assert!(dto.port.is_none());
    assert!(dto.dbname.is_none());
    assert!(dto.user.is_none());
    // require_tls is written on every update; the second save's None
    // defaults to false.
    assert!(!dto.require_tls);
}

#[test]
fn update_pg_sync_settings_data_password_preserved_when_none() {
    let conn = oz_core::migrations::fresh_db();
    update_pg_sync_settings_data(
        &conn,
        &UpdatePgSyncSettingsArgs {
            enabled: true,
            host: None,
            port: None,
            dbname: None,
            user: None,
            password: Some("secret".into()),
            require_tls: None,
        },
    )
    .unwrap();
    // A later save without a password must keep the stored secret —
    // the UI sends None for the untouched masked field, mirroring the
    // HTTP sync API-key handling.
    update_pg_sync_settings_data(
        &conn,
        &UpdatePgSyncSettingsArgs {
            enabled: true,
            host: Some("db.example.com".into()),
            port: None,
            dbname: None,
            user: None,
            password: None,
            require_tls: Some(true),
        },
    )
    .unwrap();

    let dto = run_get_pg_sync_settings(&conn).unwrap();
    assert!(dto.has_password);
    assert!(dto.require_tls);
}
