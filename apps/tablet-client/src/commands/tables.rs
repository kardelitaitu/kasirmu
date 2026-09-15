use tauri::{State, command};

use oz_core::Table;
use oz_core::db::Store;

use crate::commands::authz::{require_permission_for_session, require_permission_for_user};
use crate::error::AppError;
use crate::state::AppState;

#[command]
/// List tables.
pub async fn list_tables(
    section: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Table>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let tables = store.list_tables(section.as_deref())?;
    drop(db);
    Ok(tables)
}

#[command]
/// Get table.
pub async fn get_table(id: String, state: State<'_, AppState>) -> Result<Option<Table>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let table = store.get_table(&id)?;
    drop(db);
    Ok(table)
}

#[command]
/// Create table.
pub async fn create_table(
    user_id: String,
    args: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::TABLES_CREATE)?;
    let table = store.create_table(&args)?;
    drop(db);
    Ok(table)
}

#[command]
/// Update table.
pub async fn update_table(
    user_id: String,
    table: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::TABLES_EDIT)?;
    let result = store.update_table(&table)?;
    drop(db);
    Ok(result)
}

#[command]
/// Delete table.
pub async fn delete_table(
    user_id: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::TABLES_DELETE)?;
    store.delete_table(&id)?;
    drop(db);
    Ok(())
}

#[command]
/// Update table status.
pub async fn update_table_status(
    user_id: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::TABLES_CLOSE)?;
    let table = store.update_table_status(&id, &status)?;
    drop(db);
    Ok(table)
}

#[command]
/// Assign table order.
pub async fn assign_table_order(
    user_id: String,
    table_id: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::TABLES_ASSIGN)?;
    let table = store.assign_table_order(&table_id, &sale_id)?;
    drop(db);
    Ok(table)
}

#[command]
/// Release table.
pub async fn release_table(
    user_id: String,
    table_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    require_permission_for_user(&store, &user_id, oz_core::permissions::TABLES_CLOSE)?;
    let table = store.release_table(&table_id)?;
    drop(db);
    Ok(table)
}

#[command]
/// List sections.
pub async fn list_sections(state: State<'_, AppState>) -> Result<Vec<String>, AppError> {
    let db = state.db.lock().await;
    let store = Store::new(&db);
    let sections = store.list_sections()?;
    drop(db);
    Ok(sections)
}

/// Session-scoped variant of `list_tables`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_tables_scoped(
    session_token: String,
    section: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Table>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let tables = store.list_tables(section.as_deref())?;
    drop(db);
    Ok(tables)
}

/// Session-scoped variant of `get_table`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn get_table_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<Table>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.get_table(&id)?;
    drop(db);
    Ok(table)
}

// ── Scoped writes (T8: session-derived identity, F-017 parity) ────────
//
// All six scoped writes below declared a required `user_id: String` and gated on
// `require_permission_for_user(&store, &user_id, TABLES_*)`, while every wrapper
// in `ui/src/api/tables.ts` sends only `{ sessionToken, … }` — `create_table_scoped`
// `{sessionToken, table}`, `update_table_scoped` `{sessionToken, table}`,
// `delete_table_scoped` `{sessionToken, id}`, `update_table_status_scoped`
// `{sessionToken, id, status}`, `assign_table_order_scoped`
// `{sessionToken, tableId, saleId}`, `release_table_scoped` `{sessionToken, tableId}`.
// Tauri camelCase-converts outer argument names and passes nothing else, so the
// missing key was a hard rejection (`tauri-2.11.3/src/ipc/command.rs:100`)
// before any body ran — the whole table-management write surface was dead on
// this shell, the third occurrence after settings (T4-1) and terminals (T7-2).
// The actor now comes from the session, matching `oz_bridge::tables`, whose
// twins never took a caller-named id (`crates/oz-bridge/src/tables.rs:64` resolves
// the session and calls `require_session_permission(&session, TABLES_CREATE)`),
// and the check is awaited before the store lock rather than inside it.
//
// The six unscoped variants above still take `user_id` — they are registered in
// neither shell (see T7-4 for the same dead surface in terminals) and touching
// them would re-open the caller-named-actor door the scoped forms just closed.

/// Session-scoped variant of `create_table`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn create_table_scoped(
    session_token: String,
    args: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_CREATE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.create_table(&args)?;
    drop(db);
    Ok(table)
}

/// Session-scoped variant of `update_table`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_table_scoped(
    session_token: String,
    table: Table,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_EDIT).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let result = store.update_table(&table)?;
    drop(db);
    Ok(result)
}

/// Session-scoped variant of `delete_table`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn delete_table_scoped(
    session_token: String,
    id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_DELETE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    store.delete_table(&id)?;
    drop(db);
    Ok(())
}

/// Session-scoped variant of `update_table_status`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn update_table_status_scoped(
    session_token: String,
    id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_CLOSE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.update_table_status(&id, &status)?;
    drop(db);
    Ok(table)
}

/// Session-scoped variant of `assign_table_order`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn assign_table_order_scoped(
    session_token: String,
    table_id: String,
    sale_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_ASSIGN).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.assign_table_order(&table_id, &sale_id)?;
    drop(db);
    Ok(table)
}

/// Session-scoped variant of `release_table`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn release_table_scoped(
    session_token: String,
    table_id: String,
    state: State<'_, AppState>,
) -> Result<Table, AppError> {
    let (session, conn_arc) = state.resolve_scope(&session_token)?;
    require_permission_for_session(&state, &session, oz_core::permissions::TABLES_CLOSE).await?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let table = store.release_table(&table_id)?;
    drop(db);
    Ok(table)
}

/// Session-scoped variant of `list_sections`.
#[allow(clippy::needless_borrow, dropping_references)]
#[command]
pub async fn list_sections_scoped(
    session_token: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let (_session, conn_arc) = state.resolve_scope(&session_token)?;
    let db_guard = conn_arc
        .lock()
        .map_err(|e| AppError::Internal(format!("store db lock: {e}")))?;
    let db = &*db_guard;
    let store = Store::new(&db);
    let sections = store.list_sections()?;
    drop(db);
    Ok(sections)
}

#[cfg(test)]
#[path = "tables_tests.rs"]
mod tests;
