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

// ---------------------------------------------------------------------------
// Pre-pull backup lifecycle (the *.sync-pull-<ts>.backup.db pile).
//
// The property under test is the DISPOSITION, not the deletion: a pull that
// succeeded leaves no recovery point behind, a pull that failed leaves exactly
// one, and neither case leaves a directory of whole-database cleartext clones.
// ---------------------------------------------------------------------------

/// Unique per-test scratch directory standing in for the app-data dir that
/// holds the live database (tempfile is not a dev-dependency here).
fn unique_backup_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "oz-bridge-sync-backup-{}-{}-{}",
        std::process::id(),
        nanos,
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A live database file plus one pre-pull backup of it. Returns (db, backup).
fn db_with_backup(
    dir: &std::path::Path,
    timestamp: &str,
) -> (std::path::PathBuf, std::path::PathBuf) {
    let db = dir.join("oz-pos.db");
    std::fs::write(&db, b"live database").unwrap();
    let backup = pre_pull_backup_path(&db, timestamp);
    std::fs::write(&backup, b"whole-database cleartext clone").unwrap();
    (db, backup)
}

/// Every pre-pull backup currently in `dir`, newest first.
fn surviving_backups(dir: &std::path::Path, db: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| is_pre_pull_backup(db, p))
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names.reverse();
    names
}

#[test]
fn pre_pull_backup_path_is_a_sibling_of_the_live_db() {
    let db = std::path::Path::new("/var/lib/oz/oz-pos.db");
    let backup = pre_pull_backup_path(db, "20260908121212");
    assert_eq!(backup.parent(), db.parent());
    assert_eq!(
        backup.file_name().unwrap().to_string_lossy(),
        "oz-pos.sync-pull-20260908121212.backup.db"
    );
    // The live file is never itself a match, and neither is a WAL sibling.
    assert!(!is_pre_pull_backup(db, db));
    assert!(!is_pre_pull_backup(db, &db.with_extension("db-wal")));
}

#[test]
fn is_pre_pull_backup_scopes_to_one_database() {
    let db = std::path::Path::new("/var/lib/oz/oz-pos.db");
    assert!(is_pre_pull_backup(
        db,
        &pre_pull_backup_path(db, "20260101000000")
    ));
    // A different database's backup in the same directory must not be touched.
    let other = std::path::Path::new("/var/lib/oz/other.db");
    assert!(!is_pre_pull_backup(
        db,
        &pre_pull_backup_path(other, "20260101000000")
    ));
    assert!(is_pre_pull_backup(
        other,
        &pre_pull_backup_path(other, "20260101000000")
    ));
    // Truncated / wrong-suffix lookalikes are rejected.
    assert!(!is_pre_pull_backup(
        db,
        &db.with_extension("sync-pull-.backup.db")
    ));
    assert!(!is_pre_pull_backup(
        db,
        &db.with_extension("sync-pull-20260101000000.bak")
    ));
}

#[test]
fn successful_pull_removes_the_pre_pull_backup() {
    let dir = unique_backup_dir();
    let (db, backup) = db_with_backup(&dir, "20260908121212");
    dispose_pre_pull_backup(&db, &backup, true);
    assert!(
        !backup.exists(),
        "a pull that did not corrupt the DB must not leave a cleartext clone behind"
    );
    assert!(db.exists(), "the live database is never a cleanup target");
    assert_eq!(surviving_backups(&dir, &db), Vec::<String>::new());
}

#[test]
fn failed_pull_retains_the_pre_pull_backup() {
    let dir = unique_backup_dir();
    let (db, backup) = db_with_backup(&dir, "20260908121212");
    dispose_pre_pull_backup(&db, &backup, false);
    assert!(
        backup.exists(),
        "the retained snapshot is the only way back from a half-applied pull"
    );
    assert_eq!(
        surviving_backups(&dir, &db),
        vec!["oz-pos.sync-pull-20260908121212.backup.db".to_string()]
    );
}

#[test]
fn a_pile_of_pre_pull_backups_is_capped_at_the_newest_one() {
    let dir = unique_backup_dir();
    let (db, _) = db_with_backup(&dir, "20260101000000");
    // Two older orphans from earlier failed pulls, then this pull's copy.
    for ts in ["20260102000000", "20260103000000"] {
        std::fs::write(pre_pull_backup_path(&db, ts), b"stale clone").unwrap();
    }
    let current = pre_pull_backup_path(&db, "20260104000000");
    std::fs::write(&current, b"this pull's clone").unwrap();
    assert_eq!(surviving_backups(&dir, &db).len(), 4);

    // Failure: this pull's copy survives, the three older ones do not.
    dispose_pre_pull_backup(&db, &current, false);
    assert!(current.exists());
    assert_eq!(
        surviving_backups(&dir, &db),
        vec!["oz-pos.sync-pull-20260104000000.backup.db".to_string()],
        "one retained pre-pull backup per database, not one per pull"
    );
}

#[test]
fn a_successful_pull_also_sweeps_orphans_from_earlier_failures() {
    let dir = unique_backup_dir();
    let (db, _) = db_with_backup(&dir, "20260101000000");
    for ts in ["20260102000000", "20260103000000"] {
        std::fs::write(pre_pull_backup_path(&db, ts), b"stale clone").unwrap();
    }
    let current = pre_pull_backup_path(&db, "20260104000000");
    std::fs::write(&current, b"this pull's clone").unwrap();

    dispose_pre_pull_backup(&db, &current, true);
    let survivors = surviving_backups(&dir, &db);
    assert!(!survivors.contains(&"oz-pos.sync-pull-20260104000000.backup.db".to_string()));
    assert_eq!(
        survivors,
        vec!["oz-pos.sync-pull-20260103000000.backup.db".to_string()],
        "at most one recovery point survives, and it is the newest orphan"
    );
}

#[test]
fn rotation_never_touches_files_that_are_not_pre_pull_backups() {
    let dir = unique_backup_dir();
    let (db, _) = db_with_backup(&dir, "20260101000000");
    let other_db = dir.join("warehouse.db");
    std::fs::write(&other_db, b"another till").unwrap();
    let other_backup = pre_pull_backup_path(&other_db, "20260102000000");
    std::fs::write(&other_backup, b"someone else's snapshot").unwrap();
    let operator_backup = dir.join("warehouse.backup.db");
    std::fs::write(&operator_backup, b"operator backup command").unwrap();
    let wal = dir.join("oz-pos.db-wal");
    std::fs::write(&wal, b"wal").unwrap();
    let lookalike = dir.join("oz-pos.sync-pull-20260102000000.notes.txt");
    std::fs::write(&lookalike, b"unrelated").unwrap();
    let stale = pre_pull_backup_path(&db, "20260102000000");
    std::fs::write(&stale, b"this one goes").unwrap();

    dispose_pre_pull_backup(&db, &stale, true);

    assert!(
        !stale.exists(),
        "only this database's pre-pull backups are pruned"
    );
    for kept in [
        &db,
        &other_db,
        &other_backup,
        &operator_backup,
        &wal,
        &lookalike,
    ] {
        assert!(kept.exists(), "cleanup must not delete {kept:?}");
    }
}

#[test]
fn disposal_survives_a_missing_or_unlistable_directory() {
    // A backup that was already removed (or never created because the pull
    // failed before Phase 3) must not turn into a second error, and a db path
    // with no readable parent must not panic.
    let dir = unique_backup_dir();
    let db = dir.join("oz-pos.db");
    let gone = pre_pull_backup_path(&db, "20260101000000");
    dispose_pre_pull_backup(&db, &gone, true);
    dispose_pre_pull_backup(&db, &gone, false);
    let nowhere = std::path::Path::new("/nonexistent-oz-bridge-dir/oz-pos.db");
    dispose_pre_pull_backup(
        nowhere,
        &pre_pull_backup_path(nowhere, "20260101000000"),
        false,
    );
    assert_eq!(
        prune_pre_pull_backups(nowhere, 1, None),
        Vec::<std::path::PathBuf>::new()
    );
}
