//! The SQLite arms of the cloud sync store: every statement that runs against
//! the local `rusqlite` connection, kept behind one seam so the parent stays
//! dispatch only. Moved verbatim out of [`super`] by the 2026-09-15 split.
//!
//! Seven helpers: the multi-row push fast path, the three pull shapes with
//! their fail-loud row decode (SYNC-10), and the three snapshot readers. The
//! parent calls five of them, which is why exactly those five are
//! `pub(super)`; the other two stay private to this module.
//!
//! Carried invariants: every statement is tenant-scoped, and every write runs
//! inside a `rusqlite` transaction — the multi-row path opens its own, so a
//! statement error rolls back and lets the caller fall back to the per-item
//! SAVEPOINT loop. `MULTIROW_CHUNK` stays the parent's and is read via
//! `use super::`, needing no widened visibility.

use oz_core::offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};
use platform_sync::transport::PushOutcome;
use rusqlite::{Connection, params};

use super::MULTIROW_CHUNK;

// ── Multi-row push fast path ────────────────────────────────────────────

/// SQLite multi-row fast path for [`SyncStore::push_batch`].
///
/// Builds one `INSERT … VALUES (…),(…),… ON CONFLICT (id) DO NOTHING
/// RETURNING id` statement per [`MULTIROW_CHUNK`] rows, so a whole push page
/// costs a handful of statements instead of N. Duplicate ids within the
/// batch are skipped by `DO NOTHING` (the first occurrence wins) and
/// reported as `Rejected` via a returned-id multiset consumed in input
/// order — preserving the exact per-item semantics of the old loop.
///
/// Opens and commits its own transaction; on any statement error the
/// transaction is rolled back (drop) and `Err` is returned so the caller
/// can fall back to the per-item loop.
pub(super) fn sqlite_push_batch_multirow(
    conn: &Connection,
    items: &[OfflineQueueItem],
    status: &str,
    tenant_id: &str,
) -> Result<Vec<PushOutcome>, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(items.len());

    for chunk in items.chunks(MULTIROW_CHUNK) {
        let n = chunk.len();
        let values = vec!["(?,?,?,?,?,?,?,?,?)"; n].join(",");
        let sql = format!(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, \
             last_error, created_at, synced_at, tenant_id) VALUES {values} \
             ON CONFLICT (id) DO NOTHING RETURNING id"
        );

        let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(n * 9);
        for item in chunk {
            params.push(rusqlite::types::Value::Text(item.id.clone()));
            params.push(rusqlite::types::Value::Text(item.action.clone()));
            params.push(rusqlite::types::Value::Text(item.payload.clone()));
            params.push(rusqlite::types::Value::Text(status.to_string()));
            params.push(rusqlite::types::Value::Integer(item.retry_count));
            params.push(match &item.last_error {
                Some(e) => rusqlite::types::Value::Text(e.clone()),
                None => rusqlite::types::Value::Null,
            });
            params.push(rusqlite::types::Value::Text(item.created_at.clone()));
            params.push(match &item.synced_at {
                Some(s) => rusqlite::types::Value::Text(s.clone()),
                None => rusqlite::types::Value::Null,
            });
            params.push(rusqlite::types::Value::Text(tenant_id.to_string()));
        }

        let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
        let mut inserted: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(n);
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let id = row.map_err(|e| e.to_string())?;
            *inserted.entry(id).or_insert(0) += 1;
        }

        // Consume returned-id counts in input order: the first occurrence
        // of a duplicate was the one inserted, later ones are Rejected.
        let mut remaining = inserted;
        for item in chunk {
            match remaining.get_mut(&item.id) {
                Some(count) if *count > 0 => {
                    *count -= 1;
                    results.push(PushOutcome::Accepted);
                }
                _ => results.push(PushOutcome::Rejected {
                    reason: format!("duplicate id: {}", item.id),
                }),
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(results)
}

// ── SQLite implementations ────────────────────────────────────────────────
//
// These are faithful copies of the SQL that previously lived inline in the
// handlers (sync_api.rs). Behaviour — including SYNC-10's fail-loud row
// decode and the metric increment — is preserved exactly.

/// Pull rows via SQLite, preserving the three query shapes (cursor / since /
/// bare) and the fail-loud row decode (SYNC-10).
pub(super) fn sqlite_pull_items(
    conn: &Connection,
    tenant_id: &str,
    since: Option<&str>,
    cursor: Option<(&str, &str)>,
    limit: i64,
) -> Result<Vec<OfflineQueueItem>, String> {
    const SELECT: &str = "SELECT id, action, payload, status, retry_count, last_error, \
                          created_at, synced_at, tenant_id, priority FROM offline_queue";

    let rows: Vec<rusqlite::Result<OfflineQueueItem>> = if let Some((ts, cid)) = cursor {
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE tenant_id = ?1 AND created_at >= ?2 \
                 AND (created_at > ?3 OR (created_at = ?3 AND id > ?4)) \
                 ORDER BY created_at ASC, id ASC LIMIT ?5"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_map(
            params![tenant_id, since.unwrap_or(""), ts, cid, limit],
            sqlite_row_to_item,
        )
        .map_err(|e| e.to_string())?
        .collect()
    } else if let Some(since) = since {
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE created_at >= ?1 AND tenant_id = ?2 \
                 ORDER BY created_at ASC, id ASC LIMIT ?3"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_map(params![since, tenant_id, limit], sqlite_row_to_item)
            .map_err(|e| e.to_string())?
            .collect()
    } else {
        let mut stmt = conn
            .prepare(&format!(
                "{SELECT} WHERE tenant_id = ?1 ORDER BY created_at ASC, id ASC LIMIT ?2"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_map(params![tenant_id, limit], sqlite_row_to_item)
            .map_err(|e| e.to_string())?
            .collect()
    };

    sqlite_collect_pull_rows(rows.into_iter(), tenant_id)
}

/// Collect SQLite pull rows, failing loudly on decode errors (SYNC-10).
fn sqlite_collect_pull_rows(
    rows: impl Iterator<Item = rusqlite::Result<OfflineQueueItem>>,
    tenant_id: &str,
) -> Result<Vec<OfflineQueueItem>, String> {
    let mut items = Vec::with_capacity(rows.size_hint().0);
    for row in rows {
        match row {
            Ok(item) => items.push(item),
            Err(e) => {
                crate::metrics::SYNC_PULL_ROW_DECODE_FAILURES_TOTAL.inc();
                tracing::error!(tenant_id, error = %e, "pull: row decode failed — returning 500");
                return Err(format!("offline_queue row decode failed: {e}"));
            }
        }
    }
    Ok(items)
}

/// Convert a SQLite row to an `OfflineQueueItem`.
fn sqlite_row_to_item(row: &rusqlite::Row) -> rusqlite::Result<OfflineQueueItem> {
    let status_str: String = row.get("status")?;
    Ok(OfflineQueueItem {
        id: row.get("id")?,
        action: row.get("action")?,
        payload: row.get("payload")?,
        status: OfflineQueueStatus::from_stored_str(&status_str)
            .unwrap_or(OfflineQueueStatus::Pending),
        retry_count: row.get("retry_count")?,
        last_error: row.get("last_error")?,
        created_at: row.get("created_at")?,
        synced_at: row.get("synced_at")?,
        tenant_id: row.get("tenant_id")?,
        priority: row
            .get::<_, i32>("priority")
            .map(SyncPriority::from)
            .unwrap_or(SyncPriority::Normal),
    })
}

pub(super) fn sqlite_snapshot_products(
    conn: &Connection,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, \
             updated_at, price_updated_at, track_serial, store_id, brand, rack_location, notes, \
             unit, is_active FROM products WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![tenant_id], |row| {
        // Build JSON manually, omitting null optional fields.
        // Client uses #[serde(default)] so missing fields deserialize as None.
        // Omitting nulls saves ~30% payload on typical product rows.
        let mut m = serde_json::Map::new();
        m.insert("id".into(), serde_json::Value::String(row.get("id")?));
        m.insert("sku".into(), serde_json::Value::String(row.get("sku")?));
        m.insert("name".into(), serde_json::Value::String(row.get("name")?));
        m.insert(
            "price_minor".into(),
            serde_json::json!(row.get::<_, i64>("price_minor")?),
        );
        m.insert(
            "currency".into(),
            serde_json::Value::String(row.get("currency")?),
        );
        m.insert(
            "track_serial".into(),
            serde_json::json!(row.get::<_, bool>("track_serial")?),
        );
        m.insert(
            "is_active".into(),
            serde_json::json!(row.get::<_, bool>("is_active")?),
        );
        // Timestamps — always present.
        m.insert(
            "created_at".into(),
            serde_json::Value::String(row.get("created_at")?),
        );
        m.insert(
            "updated_at".into(),
            serde_json::Value::String(row.get("updated_at")?),
        );
        m.insert(
            "price_updated_at".into(),
            serde_json::Value::String(row.get("price_updated_at")?),
        );
        // Optional fields — only insert if non-null.
        for (key, col) in &[
            ("category_id", "category_id"),
            ("barcode", "barcode"),
            ("store_id", "store_id"),
            ("brand", "brand"),
            ("rack_location", "rack_location"),
            ("notes", "notes"),
            ("unit", "unit"),
        ] {
            if let Ok(Some(v)) = row.get::<_, Option<String>>(*col) {
                m.insert(key.to_string(), serde_json::Value::String(v));
            }
        }
        Ok(serde_json::Value::Object(m))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("product row decode failed: {e}"))
}

pub(super) fn sqlite_snapshot_tax_rates(
    conn: &Connection,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // Scope + validity window travel with the rate. A scoped row emitted
    // WITHOUT its scope arrives at the branch as NULL scope, and NULL scope IS
    // the tenant-global answer — one location's rate would then price every
    // location that pulled it. Absence is not neutral in this table, so the
    // columns are explicit here and the client maps a missing key to
    // tenant-global (which is what every pre-20260921 row already is).
    let mut stmt = conn
        .prepare(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at, \
                    legal_entity_id, location_id, effective_from, effective_to \
             FROM tax_rates WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![tenant_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>("id")?,
            "name": row.get::<_, String>("name")?,
            "rate_bps": row.get::<_, i64>("rate_bps")?,
            "is_default": row.get::<_, bool>("is_default")?,
            "is_inclusive": row.get::<_, bool>("is_inclusive")?,
            "created_at": row.get::<_, Option<String>>("created_at")?,
            "updated_at": row.get::<_, Option<String>>("updated_at")?,
            "legal_entity_id": row.get::<_, Option<String>>("legal_entity_id")?,
            "location_id": row.get::<_, Option<String>>("location_id")?,
            "effective_from": row.get::<_, Option<String>>("effective_from")?,
            "effective_to": row.get::<_, Option<String>>("effective_to")?
        }))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("tax rate row decode failed: {e}"))
}

pub(super) fn sqlite_snapshot_users(
    conn: &Connection,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, username, display_name, role_id, is_active, created_at, updated_at \
             FROM users WHERE tenant_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![tenant_id], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>("id")?,
            "username": row.get::<_, String>("username")?,
            "display_name": row.get::<_, String>("display_name")?,
            "role_id": row.get::<_, String>("role_id")?,
            "is_active": row.get::<_, bool>("is_active")?,
            "created_at": row.get::<_, Option<String>>("created_at")?,
            "updated_at": row.get::<_, Option<String>>("updated_at")?
        }))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("user row decode failed: {e}"))
}
