use super::*;
use kasirmu_bridge::reports::MAX_TOP_PRODUCTS;
use kasirmu_core::db::Store;
use kasirmu_core::permissions;
use kasirmu_core::session::SessionContext;

#[tokio::test]
async fn scoped_report_rejects_invalid_session() {
    let state = AppState::for_test();
    let result = resolve_report_scope(&state, "missing-token", permissions::REPORTS_VIEW).await;
    assert!(matches!(result, Err(AppError::InvalidSession)));
}

#[tokio::test]
async fn scoped_report_denies_user_without_reports_permission() {
    let conn = kasirmu_core::migrations::fresh_db();
    let store = Store::new(&conn);
    store.seed_default_roles().unwrap();
    conn.execute(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
         VALUES ('user-custom', 'custom', 'hash', 'Custom', 'role-custom', 1, '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z')",
        [],
    )
    .unwrap();

    let state = AppState::for_test_with_conn(conn);
    state.session_store.write().unwrap().insert(
        "custom-token".into(),
        SessionContext::new(
            "user-custom".into(),
            "role-owner".into(),
            "terminal-1".into(),
            "store-1".into(),
            "instance-1".into(),
            "pos".into(),
            None,
            0,
        ),
    );

    let result = resolve_report_scope(&state, "custom-token", permissions::REPORTS_VIEW).await;
    assert!(matches!(result, Err(AppError::PermissionDenied(_))));
}

#[test]
fn top_product_limit_accepts_bounded_values() {
    assert!(validate_top_product_limit(1).is_ok());
    assert!(validate_top_product_limit(MAX_TOP_PRODUCTS).is_ok());
}

#[test]
fn top_product_limit_rejects_unbounded_values() {
    for limit in [0, -1, MAX_TOP_PRODUCTS + 1, i64::MAX] {
        assert!(validate_top_product_limit(limit).is_err());
    }
}
