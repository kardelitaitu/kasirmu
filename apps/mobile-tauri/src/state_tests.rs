use super::*;
use kasirmu_core::session::SessionContext;

#[test]
fn for_test_creates_valid_state() {
    let state = AppState::for_test();
    assert_eq!(state.db_path, std::path::PathBuf::from(":memory:"));
    assert!(state.app.is_none());
    assert!(
        state.db.try_lock().is_ok(),
        "in-memory DB should be accessible"
    );
}

#[test]
fn for_test_with_conn_preserves_connection() {
    let conn = Connection::open_in_memory().unwrap();
    let state = AppState::for_test_with_conn(conn);
    let guard = state.db.try_lock().expect("db mutex should be available");
    // Verify it's a live SQLite connection.
    guard
        .execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES(1);")
        .unwrap();
    let count: i32 = guard
        .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn resolve_session_empty_token_returns_invalid() {
    let state = AppState::for_test();
    let result = state.resolve_session("");
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[test]
fn resolve_session_missing_token_returns_invalid() {
    let state = AppState::for_test();
    let result = state.resolve_session("nonexistent-token");
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[test]
fn resolve_session_expired_token_is_rejected_and_removed() {
    let state = AppState::for_test();
    let ctx = SessionContext {
        user_id: "expired-user".into(),
        store_id: "store-expired".into(),
        role_id: "role-owner".into(),
        terminal_id: "term-1".into(),
        instance_id: "inst-1".into(),
        type_key: "pos".into(),
        expires_at: Some(1),
        created_at: 0,
        restaurant_pos_id: None,
    };
    state
        .session_store
        .write()
        .unwrap()
        .insert("expired-token".into(), ctx);

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
    let test_dir = std::env::temp_dir().join(format!(
        "kasirmu-mobile-scope-test-{}",
        uuid::Uuid::now_v7()
    ));
    let manager = StoreDatabaseManager::new(test_dir.clone(), kasirmu_core::migrations::ALL);
    let state = AppState::for_test_with_db_manager(manager);
    for (token, store_id) in [("token-a", "store-a"), ("token-b", "store-b")] {
        state.session_store.write().unwrap().insert(
            token.into(),
            SessionContext {
                user_id: "user-1".into(),
                store_id: store_id.into(),
                role_id: "role-owner".into(),
                terminal_id: "term-1".into(),
                instance_id: "inst-1".into(),
                type_key: "pos".into(),
                expires_at: None,
                created_at: 0,
                restaurant_pos_id: None,
            },
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
    drop(conn_b);
    drop(state);
    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn resolve_session_valid_token_returns_context() {
    let state = AppState::for_test();
    let ctx = SessionContext {
        user_id: "user-1".into(),
        store_id: "store-1".into(),
        role_id: "role-1".into(),
        terminal_id: "term-1".into(),
        instance_id: "inst-1".into(),
        type_key: "pos".into(),
        expires_at: None,
        created_at: 0,
        restaurant_pos_id: None,
    };
    {
        let mut store = state.session_store.write().unwrap();
        store.insert("valid-token".into(), ctx.clone());
    }
    let result = state.resolve_session("valid-token");
    assert!(result.is_ok());
    let resolved = result.unwrap();
    assert_eq!(resolved.user_id, "user-1");
    assert_eq!(resolved.store_id, "store-1");
}

#[test]
fn resolve_session_returns_clone_not_reference() {
    let state = AppState::for_test();
    let original = SessionContext {
        user_id: "u1".into(),
        store_id: "s1".into(),
        role_id: "r1".into(),
        terminal_id: "t1".into(),
        instance_id: "i1".into(),
        type_key: "pos".into(),
        expires_at: None,
        created_at: 0,
        restaurant_pos_id: None,
    };
    {
        let mut store = state.session_store.write().unwrap();
        store.insert("tok".into(), original.clone());
    }
    let resolved = state.resolve_session("tok").unwrap();
    // Mutating the original in the store should not affect the resolved clone.
    {
        let mut store = state.session_store.write().unwrap();
        if let Some(ctx) = store.get_mut("tok") {
            ctx.user_id = "changed".into();
        }
    }
    assert_eq!(resolved.user_id, "u1");
}
