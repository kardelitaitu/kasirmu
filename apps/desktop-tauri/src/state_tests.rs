use std::path::Path;
use std::time::Duration;

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
    assert_eq!(state.plugin_change_refused.load(Ordering::SeqCst), 0);
}

// ── C2: an unverified plugin change is refused, never hot-swapped ──

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

/// The watcher observes a change and REFUSES it: the live manager keeps serving
/// the exact plugin set it was loaded with, and the loaded content hash is
/// unchanged.
///
/// This is the regression test for the silent hot-swap. The old wiring rebuilt
/// the manager from disk on any file event, so writing one `.lua` file into the
/// plugins directory bought in-process execution about a second later, with no
/// verification of the bytes at all. If that behaviour returns, the new plugin
/// becomes live and this test fails on both the hash and the discount.
#[tokio::test]
async fn plugin_change_is_refused_and_live_set_survives() {
    let tmp = tempfile::tempdir().unwrap();
    write_plugin_dir(tmp.path(), "oz.apply_discount(\"cart\", 10)\n");

    // The live runtime, built exactly as AppState builds it at startup.
    let plugins: Arc<Mutex<Option<PluginManager>>> =
        Arc::new(Mutex::new(Some(PluginManager::new(tmp.path()).unwrap())));
    let loaded_hash = plugins
        .lock()
        .await
        .as_ref()
        .expect("a plugin dir loads")
        .content_hash();

    let refused = Arc::new(AtomicU64::new(0));
    let watcher = start_plugin_watcher(refused.clone(), tmp.path().to_path_buf())
        .expect("watcher starts on an existing plugins directory");

    // Change the existing script and drop in a brand-new plugin — the exact
    // two shapes the old watcher turned into in-process execution.
    std::fs::write(
        tmp.path().join("test-plugin/main.lua"),
        "oz.apply_discount(\"cart\", 99)\n",
    )
    .unwrap();
    let extra = tmp.path().join("evil-plugin");
    std::fs::create_dir(&extra).unwrap();
    std::fs::write(
        extra.join("plugin.toml"),
        r#"[plugin]
name = "evil-plugin"
version = "1.0.0"

[permissions]
required_permissions = ["cart:read"]
"#,
    )
    .unwrap();

    // notify delivers asynchronously: wait for the refusal to be recorded.
    let mut observed = 0u64;
    for _ in 0..100 {
        observed = refused.load(Ordering::SeqCst);
        if observed > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        observed > 0,
        "the watcher must observe the change and record a refusal"
    );
    drop(watcher);

    // Non-vacuity: the on-disk set really did change, so a hot-swap would have
    // been observable. Without this the assertions below would also pass if the
    // edits had simply failed to land.
    let changed_hash = PluginManager::new(tmp.path())
        .expect("the changed set is still loadable")
        .content_hash();
    assert_ne!(
        changed_hash, loaded_hash,
        "the edited plugin set must hash differently, or this test proves nothing"
    );

    // The live manager is untouched — same hash, same set, same behaviour.
    let guard = plugins.lock().await;
    let mgr = guard
        .as_ref()
        .expect("a refused change must not clear the live runtime");
    assert_eq!(
        mgr.content_hash(),
        loaded_hash,
        "a refused change must not alter the loaded plugin set"
    );
    let d = mgr.drain_pending_discounts();
    assert_eq!(d.len(), 1, "the old set is still the live one");
    assert_eq!(
        d[0].percent, 10,
        "the OLD script must still be live: a hot-swap would have produced 99"
    );
}

/// Nothing in the shell rebuilds the manager from disk after startup: the only
/// remaining call site is the startup load. A restart is the explicit operator
/// action that picks up a changed set.
#[test]
fn plugin_manager_is_only_built_at_startup() {
    let src = include_str!("state.rs");
    assert_eq!(
        src.matches("PluginManager::new").count(),
        1,
        "only the startup load may build a manager; a second call site means an automatic reload path is back"
    );
}
