//! Unit tests for the `kasirmu_bridge::sync` module (relocated from the desktop
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
        resolved_origin: "https://license.kasir.mu".into(),
        resolved_origin_source: "main".into(),
    };
    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["serverUrl"], "https://sync.example.com");
    assert_eq!(json["hasApiKey"], true);
    assert_eq!(json["enabled"], true);
    // The resolved origin is diagnostics, not a setting: it must reach the UI under
    // its camelCase keys or the settings surface cannot show which tier won.
    assert_eq!(json["resolvedOrigin"], "https://license.kasir.mu");
    assert_eq!(json["resolvedOriginSource"], "main");
}

#[test]
fn sync_settings_no_url_disabled() {
    let s = SyncSettingsDto {
        server_url: None,
        has_api_key: false,
        enabled: false,
        resolved_origin: "https://license.kasir.mu".into(),
        resolved_origin_source: "main".into(),
    };
    let json = serde_json::to_value(&s).unwrap();
    assert!(json["serverUrl"].is_null());
    assert_eq!(json["hasApiKey"], false);
    assert_eq!(json["enabled"], false);
}
// ── The probe fallback is a two-profile pair, not one debug-only test ──
//
// `LOCAL_DEV_SYNC_URL` (`sync.rs:172-173`) exists only under
// `#[cfg(debug_assertions)]`, so this case CANNOT be dropped into the release
// profile: there the fallback is deliberately absent and the same call returns
// `None` (`sync.rs:196-209`). Asserting the debug answer in release would be a
// guaranteed red, not a coverage win.
//
// What was missing was the other half. "Production must never probe a URL the
// operator did not configure" is a security property, and until this pair
// existed it had NO test at all — the only caller test was compiled out of
// exactly the profile the property is about. The release twin below pins it.
//
// Consequence for anyone totalling a run: both profiles now carry one arm of
// this pair, so **debug total − release total is 0**, not the 1 that
// `sync_tests.rs` used to account for on its own. A gap of 1 now means a real
// test is missing from one side; see `todo-open-debt-program.md:111`.
#[cfg(debug_assertions)]
#[test]
fn sync_probe_falls_back_to_cloud_url_when_unconfigured() {
    // With the cloud fallback re-enabled, an unconfigured sync resolves
    // to the cloud server URL so the login-screen indicator works.
    let resolved = resolve_sync_probe_url(None, None, true);
    assert_eq!(resolved.as_deref(), Some("https://license.kasir.mu"));
    assert_eq!(
        resolve_sync_probe_url(None, Some(String::new()), true).as_deref(),
        Some("https://license.kasir.mu")
    );
    // Explicit allow_local_fallback = false still returns None (production).
    assert_eq!(resolve_sync_probe_url(None, None, false), None);
}

/// The release arm of the pair above: an unconfigured sync resolves to
/// NOTHING, even with the fallback flag set.
///
/// `allow_local_fallback` is still passed by every caller in every profile
/// (`sync.rs:193-197`), so the property under test is that release *ignores*
/// it rather than that the flag is absent — a caller that started honouring it
/// in release would make this red while leaving the debug arm green.
#[cfg(not(debug_assertions))]
#[test]
fn sync_probe_does_not_fall_back_to_cloud_url_in_release() {
    assert_eq!(
        resolve_sync_probe_url(None, None, true),
        None,
        "release must not probe a URL the operator did not configure"
    );
    assert_eq!(
        resolve_sync_probe_url(None, Some(String::new()), true),
        None,
        "an empty saved URL is unconfigured, not a fallback trigger"
    );
    // A configured URL still wins in release — this is the behaviour that
    // must survive the fallback being absent.
    assert_eq!(
        resolve_sync_probe_url(Some("https://sync.example.com".into()), None, true).as_deref(),
        Some("https://sync.example.com")
    );
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
    let conn = crate::testing::temp_conn();
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
    let conn = crate::testing::temp_conn();
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
    let conn = crate::testing::temp_conn();
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
    let conn = crate::testing::temp_conn();
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
    let conn = crate::testing::temp_conn();
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
// The second property, added because the cap made it load-bearing, is SCOPE:
// one store's rotation must never reach another store's retained snapshot.
// ---------------------------------------------------------------------------

/// Unique per-test scratch directory standing in for the app-data dir that
/// holds the live databases (tempfile is not a dev-dependency here).
fn unique_backup_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "kasirmu-bridge-sync-backup-{}-{}-{}",
        std::process::id(),
        nanos,
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Create a file in dir and return its path.
fn touch(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, b"whole-database cleartext clone").unwrap();
    path
}

/// A store database file (store-<id>.sqlite, the manager's naming scheme).
fn store_db_in(dir: &std::path::Path, id: &str) -> std::path::PathBuf {
    touch(dir, &format!("store-{id}.sqlite"))
}

/// A pre-pull backup of store_db at timestamp, written to disk.
fn write_backup(store_db: &std::path::Path, timestamp: &str) -> std::path::PathBuf {
    let path = pre_pull_backup_path(store_db, timestamp);
    std::fs::write(&path, b"whole-database cleartext clone").unwrap();
    path
}

/// Every pre-pull backup in dir that belongs to scope_db's family.
fn family(dir: &std::path::Path, scope_db: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .filter(|p| is_pre_pull_backup(scope_db, p))
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn pre_pull_backup_is_named_after_the_store_it_clones() {
    let store = std::path::Path::new("/var/lib/oz/store-7.sqlite");
    let backup = pre_pull_backup_path(store, "20260908121212");
    assert_eq!(backup.parent(), store.parent());
    assert_eq!(
        backup.file_name().unwrap().to_string_lossy(),
        "store-7.sync-pull-20260908121212.backup.db"
    );
    // The live file is never itself a match, and neither is a WAL sibling.
    assert!(!is_pre_pull_backup(store, store));
    assert!(!is_pre_pull_backup(
        store,
        &store.with_extension("sqlite-wal")
    ));
}

#[test]
fn backup_name_matching_is_strict_enough_to_scope_by_store() {
    let store = std::path::Path::new("/var/lib/oz/store-7.sqlite");
    assert!(is_pre_pull_backup(
        store,
        &pre_pull_backup_path(store, "20260101000000")
    ));
    // Another store in the same directory is a different family.
    let other = std::path::Path::new("/var/lib/oz/store-8.sqlite");
    assert!(!is_pre_pull_backup(
        store,
        &pre_pull_backup_path(other, "20260101000000")
    ));
    assert!(is_pre_pull_backup(
        other,
        &pre_pull_backup_path(other, "20260101000000")
    ));
    // Malformed lookalikes: wrong width, non-digits, wrong suffix.
    assert!(!is_pre_pull_backup(
        store,
        &store.with_extension("sync-pull-20260101.backup.db")
    ));
    assert!(!is_pre_pull_backup(
        store,
        &store.with_extension("sync-pull-2026010100000a.backup.db")
    ));
    assert!(!is_pre_pull_backup(
        store,
        &store.with_extension("sync-pull-20260101000000.bak")
    ));
    // A store id that embeds the infix must not widen the family: the extra
    // text sits in the STEM, and the timestamp slot is still exactly 14 digits.
    let tricky = std::path::Path::new("/var/lib/oz/store-sync-pull-9.sqlite");
    assert!(is_pre_pull_backup(
        tricky,
        &pre_pull_backup_path(tricky, "20260101000000")
    ));
    assert!(!is_pre_pull_backup(
        std::path::Path::new("/var/lib/oz/store.sqlite"),
        &pre_pull_backup_path(tricky, "20260101000000")
    ));
}

#[test]
fn successful_pull_removes_the_pre_pull_backup() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    let backup = write_backup(&store, "20260908121212");
    dispose_pre_pull_backup(&main_db, &store, &backup, true);
    assert!(
        !backup.exists(),
        "a pull that did not corrupt the DB must not leave a cleartext clone behind"
    );
    assert!(
        store.exists(),
        "the live database is never a cleanup target"
    );
    assert_eq!(family(&dir, &store), Vec::<String>::new());
}

#[test]
fn failed_pull_retains_the_pre_pull_backup() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    let backup = write_backup(&store, "20260908121212");
    dispose_pre_pull_backup(&main_db, &store, &backup, false);
    assert!(
        backup.exists(),
        "the retained snapshot is the only way back from a half-applied pull"
    );
    assert_eq!(
        family(&dir, &store),
        vec!["store-7.sync-pull-20260908121212.backup.db".to_string()]
    );
}

#[test]
fn a_pile_of_pre_pull_backups_is_capped_at_the_newest_one() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    for ts in ["20260101000000", "20260102000000", "20260103000000"] {
        write_backup(&store, ts);
    }
    let current = write_backup(&store, "20260104000000");
    assert_eq!(family(&dir, &store).len(), 4);

    dispose_pre_pull_backup(&main_db, &store, &current, false);
    assert!(current.exists());
    assert_eq!(
        family(&dir, &store),
        vec!["store-7.sync-pull-20260104000000.backup.db".to_string()],
        "one retained pre-pull backup per database, not one per pull"
    );
}

#[test]
fn a_successful_pull_also_sweeps_orphans_from_earlier_failures() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    write_backup(&store, "20260101000000");
    write_backup(&store, "20260102000000");
    let current = write_backup(&store, "20260103000000");

    dispose_pre_pull_backup(&main_db, &store, &current, true);
    assert_eq!(
        family(&dir, &store),
        vec!["store-7.sync-pull-20260102000000.backup.db".to_string()],
        "at most one recovery point survives, and it is the newest orphan"
    );
}

/// THE CROSS-STORE CASE. Before the backup was named after the store it
/// clones, every store's snapshots shared the main database's name family, so
/// the cap that bounds the pile could also delete store A's retained recovery
/// point while servicing store B. Two stores, each holding a snapshot from a
/// failed pull: neither one's next pull may touch the other's.
#[test]
fn two_stores_do_not_rotate_each_other_out() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store_a = store_db_in(&dir, "a");
    let store_b = store_db_in(&dir, "b");

    // A's pull failed an hour ago; its snapshot is A's only recovery point.
    let a_retained = write_backup(&store_a, "20260105120000");
    // B has two older orphans plus a pull that is failing right now.
    write_backup(&store_b, "20260105100000");
    write_backup(&store_b, "20260105110000");
    let b_current = write_backup(&store_b, "20260105120030");

    // B's failed pull: B rotates itself down to one copy...
    dispose_pre_pull_backup(&main_db, &store_b, &b_current, false);
    // ...and A's snapshot is untouched, despite being OLDER than everything B
    // just deleted. That is the regression this test pins.
    assert!(
        a_retained.exists(),
        "a sweep for store B deleted store A's retained recovery point"
    );
    assert_eq!(
        family(&dir, &store_a),
        vec!["store-a.sync-pull-20260105120000.backup.db".to_string()]
    );
    assert_eq!(
        family(&dir, &store_b),
        vec!["store-b.sync-pull-20260105120030.backup.db".to_string()]
    );

    // And the other direction: A's next pull succeeds, deleting that pull's
    // own copy and leaving B's survivor alone. A's earlier retained snapshot
    // is what the one-copy budget is for, so it stays.
    let a_next = write_backup(&store_a, "20260106090000");
    dispose_pre_pull_backup(&main_db, &store_a, &a_next, true);
    assert!(!a_next.exists(), "A's own superseded copy should be gone");
    assert!(
        b_current.exists(),
        "a sweep for store A deleted store B's retained recovery point"
    );
    assert_eq!(
        family(&dir, &store_a),
        vec!["store-a.sync-pull-20260105120000.backup.db".to_string()]
    );
    assert_eq!(
        family(&dir, &store_b),
        vec!["store-b.sync-pull-20260105120030.backup.db".to_string()]
    );
}

/// The old builds named every snapshot after the shell's main database, for
/// every store. Those files carry no store identity, so they are not a
/// recovery point for anything and are swept outright rather than capped.
#[test]
fn legacy_main_named_backups_are_swept_by_the_next_pull() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    let legacy: Vec<std::path::PathBuf> = ["20260101000000", "20260102000000", "20260103000000"]
        .iter()
        .map(|ts| touch(&dir, &format!("kasir.sync-pull-{ts}.backup.db")))
        .collect();
    // This store's own retained copy from a failed pull under the NEW scheme.
    let a_retained = write_backup(&store, "20260104000000");

    let current = write_backup(&store, "20260105000000");
    dispose_pre_pull_backup(&main_db, &store, &current, true);

    for old in &legacy {
        assert!(!old.exists(), "the legacy pile must be swept, not kept");
    }
    assert!(
        a_retained.exists(),
        "sweeping legacy names is not licence to sweep a store family"
    );
    assert_eq!(
        family(&dir, &store),
        vec!["store-7.sync-pull-20260104000000.backup.db".to_string()]
    );
    assert_eq!(family(&dir, &main_db), Vec::<String>::new());
}

/// If an install's main database were itself named store-<id>.sqlite, the
/// legacy family and the store family are the same family — and the legacy
/// sweep runs with a budget of zero and no protected file. Without the
/// stem guard it would therefore delete the very snapshot this pull failed
/// into and is retaining. The store cap still applies, so the family ends at
/// one copy, not zero.
#[test]
fn the_legacy_sweep_stands_down_when_the_stems_coincide() {
    let dir = unique_backup_dir();
    let store = store_db_in(&dir, "7");
    let main_db = store.clone(); // pathological: main DB *is* this store DB
    let retained = write_backup(&store, "20260104000000");
    let current = write_backup(&store, "20260105000000");

    dispose_pre_pull_backup(&main_db, &store, &current, false);
    assert!(
        current.exists(),
        "the coincident legacy sweep deleted the copy this failed pull is retaining"
    );
    assert!(
        !retained.exists(),
        "the ordinary per-store cap still applies to the shared family"
    );
    assert_eq!(
        family(&dir, &store),
        vec!["store-7.sync-pull-20260105000000.backup.db".to_string()]
    );
}

#[test]
fn rotation_never_touches_files_that_are_not_pre_pull_backups() {
    let dir = unique_backup_dir();
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    let other_db = touch(&dir, "warehouse.db");
    let other_backup = touch(&dir, "warehouse.sync-pull-20260102000000.backup.db");
    let operator_backup = touch(&dir, "warehouse.backup.db");
    let wal = touch(&dir, "store-7.sqlite-wal");
    let lookalike = touch(&dir, "store-7.sync-pull-20260102000000.notes.txt");
    let stale = write_backup(&store, "20260102000000");

    dispose_pre_pull_backup(&main_db, &store, &stale, true);

    assert!(
        !stale.exists(),
        "only this database's pre-pull backups are pruned"
    );
    for kept in [
        &store,
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
    let main_db = touch(&dir, "kasir.db");
    let store = store_db_in(&dir, "7");
    let gone = pre_pull_backup_path(&store, "20260101000000");
    dispose_pre_pull_backup(&main_db, &store, &gone, true);
    dispose_pre_pull_backup(&main_db, &store, &gone, false);
    let nowhere = std::path::Path::new("/nonexistent-kasirmu-bridge-dir/store-7.sqlite");
    dispose_pre_pull_backup(
        nowhere,
        nowhere,
        &pre_pull_backup_path(nowhere, "20260101000000"),
        false,
    );
    assert_eq!(
        prune_pre_pull_backups(nowhere, 1, None),
        Vec::<std::path::PathBuf>::new()
    );
}
