//! Restaurant table and section command bodies.
//!
//! Wave F: extracted byte-for-byte from
//! `apps/desktop-tauri/src/commands/tables.rs`. Only the mechanical
//! `state.*` → `ctx.*` receiver swaps and `AppError::` → `BridgeError::`
//! renames were applied; the ungated reads (no session gate by design),
//! gate kinds on writes, lock order and count, and all error strings are
//! unchanged.

use kasirmu_core::Table;
use kasirmu_core::db::Store;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

/// List tables for the store resolved from a session token. ADR #7.
pub async fn list_tables_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    section: Option<String>,
) -> Result<Vec<Table>, BridgeError> {
    // ungated-ok: read by design (module header) - floor-plan data, not tenant secrets
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let tables = store.list_tables(section.as_deref())?;
    drop(db);
    Ok(tables)
}

/// Get a table from the store resolved from a session token. ADR #7.
pub async fn get_table_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<Option<Table>, BridgeError> {
    // ungated-ok: read by design (module header)
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let table = store.get_table(id)?;
    drop(db);
    Ok(table)
}

/// List sections for the store resolved from a session token. ADR #7.
pub async fn list_sections_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
) -> Result<Vec<String>, BridgeError> {
    // ungated-ok: read by design (module header) - section names only
    let conn = ctx.resolve_store(session_token)?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let sections = store.list_sections()?;
    drop(db);
    Ok(sections)
}

/// Create a table in the store resolved from a session token. ADR #7.
pub async fn create_table_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    table: Table,
) -> Result<Table, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::TABLES_CREATE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.create_table(&table)?;
    drop(db);
    emit_table_status_changed(ctx, &result);
    Ok(result)
}

/// Update a table in the store resolved from a session token. ADR #7.
pub async fn update_table_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    table: Table,
) -> Result<Table, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::TABLES_EDIT)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let result = store.update_table(&table)?;
    drop(db);
    emit_table_status_changed(ctx, &result);
    Ok(result)
}

/// Delete a table in the store resolved from a session token. ADR #7.
pub async fn delete_table_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
) -> Result<(), BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::TABLES_DELETE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    store.delete_table(id)?;
    drop(db);
    if let Some(emitter) = &ctx.emitter {
        emitter.emit("tables:deleted", serde_json::json!({ "id": id }));
    }
    Ok(())
}

/// Update a table's status in the store resolved from a session token. ADR #7.
pub async fn update_table_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    id: &str,
    status: &str,
) -> Result<Table, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::TABLES_CLOSE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let table = store.update_table_status(id, status)?;
    drop(db);
    emit_table_status_changed(ctx, &table);
    Ok(table)
}

/// Assign an order to a table in the store resolved from a session token. ADR #7.
pub async fn assign_table_order_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    table_id: &str,
    sale_id: &str,
) -> Result<Table, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::TABLES_ASSIGN)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let table = store.assign_table_order(table_id, sale_id)?;
    drop(db);
    emit_table_status_changed(ctx, &table);
    Ok(table)
}

/// Release a table in the store resolved from a session token. ADR #7.
pub async fn release_table_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    table_id: &str,
) -> Result<Table, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::TABLES_CLOSE)
        .await?;
    let conn = ctx
        .db_manager
        .open_store(&session.store_id)
        .map_err(|e| BridgeError::Internal(format!("opening store db: {e}")))?;

    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = Store::new(&db);
    let table = store.release_table(table_id)?;
    drop(db);
    emit_table_status_changed(ctx, &table);
    Ok(table)
}

fn emit_table_status_changed(ctx: &BridgeCtx<'_>, table: &Table) {
    if let Some(emitter) = &ctx.emitter {
        if let Ok(val) = serde_json::to_value(table) {
            emitter.emit("tables:status-changed", val);
        }
    }
}

#[cfg(test)]
#[path = "tables_tests.rs"]
mod tables_tests;
