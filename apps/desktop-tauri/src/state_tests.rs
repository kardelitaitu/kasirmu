use super::*;

#[test]
fn resolve_session_returns_context_for_valid_token() {
    let state = AppState::for_test();
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "type1".into(),
        None,
        0,
    );
    state
        .session_store
        .write()
        .unwrap()
        .insert("tok-abc".into(), ctx.clone());

    let resolved = state.resolve_session("tok-abc").unwrap();
    assert_eq!(resolved.store_id, "s1");
    assert_eq!(resolved.user_id, "u1");
}

#[test]
fn resolve_session_returns_error_for_unknown_token() {
    let state = AppState::for_test();
    let result = state.resolve_session("nonexistent");
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[test]
fn resolve_session_with_empty_token() {
    let state = AppState::for_test();
    let result = state.resolve_session("");
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[test]
fn resolve_session_rejects_and_removes_expired_token() {
    let state = AppState::for_test();
    let expired = SessionContext::new(
        "u-expired".into(),
        "r1".into(),
        "t1".into(),
        "store-expired".into(),
        "i1".into(),
        "pos".into(),
        Some(1),
        0,
    );
    state
        .session_store
        .write()
        .unwrap()
        .insert("expired-token".into(), expired);

    assert!(matches!(
        state.resolve_session("expired-token"),
        Err(AppError::InvalidSession)
    ));
    assert!(
        !state
            .session_store
            .read()
            .unwrap()
            .contains_key("expired-token")
    );
}

#[test]
fn resolve_scope_isolates_store_databases() {
    let temp_dir = tempfile::tempdir().unwrap();
    let manager =
        StoreDatabaseManager::new(temp_dir.path().to_path_buf(), kasirmu_core::migrations::ALL);
    let state = AppState::for_test_with_db_manager(manager);
    for (token, store_id) in [("token-a", "store-a"), ("token-b", "store-b")] {
        state.session_store.write().unwrap().insert(
            token.into(),
            SessionContext::new(
                "user-1".into(),
                "role-owner".into(),
                "terminal-1".into(),
                store_id.into(),
                "instance-1".into(),
                "pos".into(),
                None,
                0,
            ),
        );
    }

    let (_, store_a) = state.resolve_scope("token-a").unwrap();
    let conn_a = store_a.lock().unwrap();
    conn_a
        .execute_batch(
            "CREATE TABLE scope_probe (value TEXT NOT NULL); INSERT INTO scope_probe VALUES ('A');",
        )
        .unwrap();
    drop(conn_a);

    let (_, store_b) = state.resolve_scope("token-b").unwrap();
    let conn_b = store_b.lock().unwrap();
    let table_count: i64 = conn_b
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'scope_probe'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(table_count, 0, "store B must not see store A data");
}

#[test]
fn resolve_session_returns_full_context() {
    let state = AppState::for_test();
    let ctx = SessionContext::new(
        "user-full".into(),
        "role-manager".into(),
        "term-kitchen".into(),
        "store-main".into(),
        "instance-1".into(),
        "kds".into(),
        None,
        0,
    );
    state
        .session_store
        .write()
        .unwrap()
        .insert("tok-full".into(), ctx);

    let resolved = state.resolve_session("tok-full").unwrap();
    assert_eq!(resolved.user_id, "user-full");
    assert_eq!(resolved.role_id, "role-manager");
    assert_eq!(resolved.terminal_id, "term-kitchen");
    assert_eq!(resolved.store_id, "store-main");
    assert_eq!(resolved.instance_id, "instance-1");
    assert_eq!(resolved.type_key, "kds");
}

#[test]
fn resolve_session_clone_preserves_all_fields() {
    let state = AppState::for_test();
    let ctx = SessionContext::new(
        "u1".into(),
        "r1".into(),
        "t1".into(),
        "s1".into(),
        "i1".into(),
        "type1".into(),
        None,
        0,
    );
    state
        .session_store
        .write()
        .unwrap()
        .insert("tok".into(), ctx.clone());

    let resolved = state.resolve_session("tok").unwrap();
    // Clone should produce identical values
    let cloned = resolved.clone();
    assert_eq!(cloned.store_id, "s1");
    assert_eq!(cloned.user_id, "u1");
    assert_eq!(cloned.type_key, "type1");
}

#[tokio::test]
async fn store_with_tid_creates_store_with_cache() {
    let state = AppState::for_test();
    let tid = state.terminal_id.lock().await.clone();
    let conn = state.db.lock().await;
    let store = state.store_with_tid(&conn, tid);
    let _ = store;
}

#[test]
fn for_test_creates_valid_state() {
    let state = AppState::for_test();
    assert_eq!(state.db_path.to_str(), Some(":memory:"));
    assert!(state.app.is_none());
    assert!(state.plugin_watcher.is_none());
    assert!(state.plugin_hot_reload_task.is_none());
}

// ── PLG-11: hot-reload last-known-good rollback ────────────────────

/// Write a minimal valid plugin directory for integration tests.
fn write_plugin_dir(root: &Path, script: &str) {
    let plugin_dir = root.join("test-plugin");
    std::fs::create_dir_all(&plugin_dir).unwrap();
    std::fs::write(
        plugin_dir.join("plugin.toml"),
        r#"[plugin]
name = "test-plugin"
version = "1.0.0"

[capabilities]
scripts = ["main.lua"]

[permissions]
required_permissions = ["cart:read", "cart:write"]
"#,
    )
    .unwrap();
    std::fs::write(plugin_dir.join("main.lua"), script).unwrap();
}

#[tokio::test]
async fn reload_plugins_keeps_old_runtime_on_failed_reload() {
    // A valid plugin that queues a discount at load time.
    let tmp = tempfile::tempdir().unwrap();
    write_plugin_dir(tmp.path(), "oz.apply_discount(\"cart\", 10)\n");

    let plugins: Arc<Mutex<Option<PluginManager>>> =
        Arc::new(Mutex::new(Some(PluginManager::new(tmp.path()).unwrap())));

    // Corrupt the manifest: the reload must fail and KEEP the old runtime.
    std::fs::write(
        tmp.path().join("test-plugin/plugin.toml"),
        "[plugin]\nname = \"broken",
    )
    .unwrap();
    reload_plugins(&plugins, tmp.path()).await;

    let guard = plugins.lock().await;
    assert!(
        guard.is_some(),
        "failed reload must keep the last-known-good runtime"
    );
    // The old runtime is still live: its plugin's discount (queued at
    // initial load) is still drainable.
    let d = guard.as_ref().unwrap().drain_pending_discounts();
    assert_eq!(d.len(), 1, "old runtime must stay live after failed reload");
}

#[tokio::test]
async fn reload_plugins_replaces_runtime_on_success() {
    let tmp = tempfile::tempdir().unwrap();
    write_plugin_dir(tmp.path(), "oz.apply_discount(\"cart\", 10)\n");

    let plugins: Arc<Mutex<Option<PluginManager>>> =
        Arc::new(Mutex::new(Some(PluginManager::new(tmp.path()).unwrap())));

    // Change the script so a fresh runtime queues a different discount.
    std::fs::write(
        tmp.path().join("test-plugin/main.lua"),
        "oz.apply_discount(\"cart\", 20)\n",
    )
    .unwrap();
    reload_plugins(&plugins, tmp.path()).await;

    let guard = plugins.lock().await;
    let mgr = guard
        .as_ref()
        .expect("successful reload must set a runtime");
    let d = mgr.drain_pending_discounts();
    assert_eq!(d.len(), 1);
    assert_eq!(
        d[0].percent, 20,
        "successful reload must pick up the change"
    );
}
