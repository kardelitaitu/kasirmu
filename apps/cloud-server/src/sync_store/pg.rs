//! The Postgres half of [`crate::sync_store`] — the `tokio_postgres` arms of the
//! sync data layer, moved out of `sync_store.rs` with their bodies unchanged.
//! The SQLite mirrors of these functions, [`SyncStore`] itself and the public API
//! stay in `sync_store.rs`, which still owns the [`MULTIROW_CHUNK`] constant this
//! module batches with.
//!
//! Covers the Postgres surface the sync handlers touch: `offline_queue`
//! push/pull, the `products` / `tax_rates` / `users` snapshot queries, and the
//! shared row decoders.
//!
//! # Invariants carried over
//!
//! - Every write/pull path runs in a transaction that sets the `oz.tenant_id` GUC
//!   **locally** (`set_config(..., true)`), so it resets when the transaction ends;
//!   RLS keys on it at cutover.
//! - The multi-row INSERT keeps `ON CONFLICT (id) DO NOTHING RETURNING id` and the
//!   [`MULTIROW_CHUNK`] batching; per-item outcomes are still rebuilt from the
//!   returned-id multiset consumed in input order.
//! - Row-decode failures are fail-loud (SYNC-10): [`pg_pull_items`] bumps
//!   `SYNC_PULL_ROW_DECODE_FAILURES_TOTAL` and the caller answers 500.
//! - `BIGINT`-as-boolean columns go through [`pg_bool`] (0 → false, else true).

use deadpool_postgres::Pool;
use oz_core::offline::{OfflineQueueItem, OfflineQueueStatus, SyncPriority};
use platform_sync::transport::PushOutcome;

use super::MULTIROW_CHUNK;

/// PostgreSQL multi-row fast path for [`SyncStore::push_batch`].
///
/// Same shape as the SQLite fast path but with `$n` numbered placeholders
/// (Postgres has no `?`). Opens and commits its own transaction; a
/// statement failure rolls back (drop) and returns `Err` for the caller's
/// per-item SAVEPOINT fallback.
pub(super) async fn pg_push_batch_multirow(
    pool: &Pool,
    items: &[OfflineQueueItem],
    status: &str,
    tenant_id: &str,
) -> Result<Vec<PushOutcome>, String> {
    let mut client = pool.get().await.map_err(|e| e.to_string())?;
    let tx = client.transaction().await.map_err(|e| e.to_string())?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut results = Vec::with_capacity(items.len());

    for chunk in items.chunks(MULTIROW_CHUNK) {
        let n = chunk.len();
        // Build "($1,...,$9),($10,...,$18),…" numbered placeholders.
        let mut sql = String::from(
            "INSERT INTO offline_queue (id, action, payload, status, retry_count, \
             last_error, created_at, synced_at, tenant_id) VALUES ",
        );
        let mut params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = Vec::with_capacity(n * 9);
        for (r, item) in chunk.iter().enumerate() {
            if r > 0 {
                sql.push(',');
            }
            let base = r * 9;
            sql.push_str(&format!(
                "(${},${},${},${},${},${},${},${},${})",
                base + 1,
                base + 2,
                base + 3,
                base + 4,
                base + 5,
                base + 6,
                base + 7,
                base + 8,
                base + 9
            ));
            params.extend_from_slice(&[
                &item.id,
                &item.action,
                &item.payload,
                &status,
                &item.retry_count,
                &item.last_error,
                &item.created_at,
                &item.synced_at,
                &tenant_id,
            ]);
        }
        sql.push_str(" ON CONFLICT (id) DO NOTHING RETURNING id");

        let rows = tx.query(&sql, &params).await.map_err(|e| e.to_string())?;
        let mut inserted: std::collections::HashMap<String, usize> =
            std::collections::HashMap::with_capacity(n);
        for row in rows {
            let id: String = row.try_get::<_, String>(0).map_err(|e| e.to_string())?;
            *inserted.entry(id).or_insert(0) += 1;
        }

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

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(results)
}

// ── Postgres implementations ──────────────────────────────────────────────

/// Pull rows via Postgres, mirroring the three SQLite query shapes with
/// `$n` placeholders. Row decode failures fail the whole pull (SYNC-10).
///
/// Generic over `deadpool_postgres::GenericClient` so the same code runs on
/// the tenant-scoped transaction (the `oz.tenant_id` GUC from `tenant_tx`)
/// or on a plain pooled client (tests).
pub(super) async fn pg_pull_items(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
    since: Option<&str>,
    cursor: Option<(&str, &str)>,
    limit: i64,
) -> Result<Vec<OfflineQueueItem>, String> {
    const SELECT: &str = "SELECT id, action, payload, status, retry_count, last_error, \
                          created_at, synced_at, tenant_id, priority FROM offline_queue";

    // D1 (ADR #43): prepare each query shape once; the connection-level
    // plan cache makes repeated identical pulls skip re-parsing.
    let rows = if let Some((ts, cid)) = cursor {
        let stmt = client
            .prepare_cached(&format!(
                "{SELECT} WHERE tenant_id = $1 AND created_at >= $2 \
                 AND (created_at > $3 OR (created_at = $3 AND id > $4)) \
                 ORDER BY created_at ASC, id ASC LIMIT $5"
            ))
            .await
            .map_err(|e| e.to_string())?;
        client
            .query(
                &stmt,
                &[&tenant_id, &since.unwrap_or(""), &ts, &cid, &limit],
            )
            .await
            .map_err(|e| e.to_string())?
    } else if let Some(since) = since {
        let stmt = client
            .prepare_cached(&format!(
                "{SELECT} WHERE created_at >= $1 AND tenant_id = $2 \
                 ORDER BY created_at ASC, id ASC LIMIT $3"
            ))
            .await
            .map_err(|e| e.to_string())?;
        client
            .query(&stmt, &[&since, &tenant_id, &limit])
            .await
            .map_err(|e| e.to_string())?
    } else {
        let stmt = client
            .prepare_cached(&format!(
                "{SELECT} WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC LIMIT $2"
            ))
            .await
            .map_err(|e| e.to_string())?;
        client
            .query(&stmt, &[&tenant_id, &limit])
            .await
            .map_err(|e| e.to_string())?
    };

    let mut items = Vec::with_capacity(rows.len());
    for row in &rows {
        match pg_row_to_item(row) {
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

/// Convert a Postgres row to an `OfflineQueueItem`.
///
/// `priority` is `BIGINT` in Postgres (SQLite stored it as `INTEGER` read as
/// `i32`), so it is narrowed through [`SyncPriority::from`] the same way.
fn pg_row_to_item(row: &tokio_postgres::Row) -> Result<OfflineQueueItem, String> {
    let status_str: String = row.try_get("status").map_err(|e| e.to_string())?;
    let priority: i64 = row.try_get("priority").map_err(|e| e.to_string())?;
    Ok(OfflineQueueItem {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        action: row.try_get("action").map_err(|e| e.to_string())?,
        payload: row.try_get("payload").map_err(|e| e.to_string())?,
        status: OfflineQueueStatus::from_stored_str(&status_str)
            .unwrap_or(OfflineQueueStatus::Pending),
        retry_count: row.try_get("retry_count").map_err(|e| e.to_string())?,
        last_error: row.try_get("last_error").map_err(|e| e.to_string())?,
        created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
        synced_at: row.try_get("synced_at").map_err(|e| e.to_string())?,
        tenant_id: row.try_get("tenant_id").map_err(|e| e.to_string())?,
        priority: SyncPriority::from(priority as i32),
    })
}

/// Read a `BIGINT` boolean-ish column as `bool` (0 → false, else true).
fn pg_bool(row: &tokio_postgres::Row, column: &str) -> Result<bool, String> {
    let v: i64 = row.try_get(column).map_err(|e| e.to_string())?;
    Ok(v != 0)
}

pub(super) async fn pg_snapshot_products(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // D1 (ADR #43): prepared statement caching — snapshot_all runs on
    // every cold snapshot miss.
    let stmt = client
        .prepare_cached(
            "SELECT id, sku, name, price_minor, currency, category_id, barcode, created_at, \
             updated_at, price_updated_at, track_serial, store_id, brand, rack_location, notes, \
             unit, is_active FROM products WHERE tenant_id = $1",
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = client
        .query(&stmt, &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        // Build JSON manually, omitting null optional fields.
        // Client uses #[serde(default)] so missing fields deserialize as None.
        // Omitting nulls saves ~30% payload on typical product rows.
        let mut m = serde_json::Map::new();
        m.insert(
            "id".into(),
            serde_json::Value::String(row.try_get("id").map_err(|e| e.to_string())?),
        );
        m.insert(
            "sku".into(),
            serde_json::Value::String(row.try_get("sku").map_err(|e| e.to_string())?),
        );
        m.insert(
            "name".into(),
            serde_json::Value::String(row.try_get("name").map_err(|e| e.to_string())?),
        );
        m.insert(
            "price_minor".into(),
            serde_json::json!(
                row.try_get::<_, i64>("price_minor")
                    .map_err(|e| e.to_string())?
            ),
        );
        m.insert(
            "currency".into(),
            serde_json::Value::String(row.try_get("currency").map_err(|e| e.to_string())?),
        );
        m.insert(
            "track_serial".into(),
            serde_json::json!(pg_bool(row, "track_serial")?),
        );
        m.insert(
            "is_active".into(),
            serde_json::json!(pg_bool(row, "is_active")?),
        );
        // Timestamps — always present.
        m.insert(
            "created_at".into(),
            serde_json::Value::String(row.try_get("created_at").map_err(|e| e.to_string())?),
        );
        m.insert(
            "updated_at".into(),
            serde_json::Value::String(row.try_get("updated_at").map_err(|e| e.to_string())?),
        );
        let price_updated: Option<String> =
            row.try_get("price_updated_at").map_err(|e| e.to_string())?;
        m.insert(
            "price_updated_at".into(),
            serde_json::Value::String(price_updated.unwrap_or_default()),
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
            if let Ok(Some(v)) = row.try_get::<_, Option<String>>(*col) {
                m.insert(key.to_string(), serde_json::Value::String(v));
            }
        }
        out.push(serde_json::Value::Object(m));
    }
    Ok(out)
}

pub(super) async fn pg_snapshot_tax_rates(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    // See sqlite_snapshot_tax_rates: scope and window must travel, or a
    // location-scoped rate arrives unscoped and reads as tenant-global.
    let stmt = client
        .prepare_cached(
            "SELECT id, name, rate_bps, is_default, is_inclusive, created_at, updated_at, \
                    legal_entity_id, location_id, effective_from, effective_to \
             FROM tax_rates WHERE tenant_id = $1",
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = client
        .query(&stmt, &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(
            serde_json::json!({
                "id": row.try_get::<_, String>("id").map_err(|e| e.to_string())?,
                "name": row.try_get::<_, String>("name").map_err(|e| e.to_string())?,
                "rate_bps": row.try_get::<_, i64>("rate_bps").map_err(|e| e.to_string())?,
                "is_default": pg_bool(row, "is_default")?,
                "is_inclusive": pg_bool(row, "is_inclusive")?,
                "created_at": row.try_get::<_, Option<String>>("created_at").map_err(|e| e.to_string())?,
                "updated_at": row.try_get::<_, Option<String>>("updated_at").map_err(|e| e.to_string())?,
                "legal_entity_id": row.try_get::<_, Option<String>>("legal_entity_id").map_err(|e| e.to_string())?,
                "location_id": row.try_get::<_, Option<String>>("location_id").map_err(|e| e.to_string())?,
                "effective_from": row.try_get::<_, Option<String>>("effective_from").map_err(|e| e.to_string())?,
                "effective_to": row.try_get::<_, Option<String>>("effective_to").map_err(|e| e.to_string())?,
            }),
        );
    }
    Ok(out)
}

pub(super) async fn pg_snapshot_users(
    client: &mut impl deadpool_postgres::GenericClient,
    tenant_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let stmt = client
        .prepare_cached(
            "SELECT id, username, display_name, role_id, is_active, created_at, updated_at \
             FROM users WHERE tenant_id = $1",
        )
        .await
        .map_err(|e| e.to_string())?;
    let rows = client
        .query(&stmt, &[&tenant_id])
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(
            serde_json::json!({
                "id": row.try_get::<_, String>("id").map_err(|e| e.to_string())?,
                "username": row.try_get::<_, String>("username").map_err(|e| e.to_string())?,
                "display_name": row.try_get::<_, String>("display_name").map_err(|e| e.to_string())?,
                "role_id": row.try_get::<_, String>("role_id").map_err(|e| e.to_string())?,
                "is_active": pg_bool(row, "is_active")?,
                "created_at": row.try_get::<_, Option<String>>("created_at").map_err(|e| e.to_string())?,
                "updated_at": row.try_get::<_, Option<String>>("updated_at").map_err(|e| e.to_string())?,
            }),
        );
    }
    Ok(out)
}
