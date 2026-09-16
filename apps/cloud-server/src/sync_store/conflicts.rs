//! Conflict rows for the cloud sync store: the `sync_conflicts` surface.
//!
//! Moved verbatim out of [`super::sync_store`] by the 2026-09-15 split; the
//! parent keeps the dispatch enum, the push/pull/snapshot statement families
//! and the multi-row fast path, while everything that reads, lists, resolves
//! or detects a conflict lives here. Two `impl SyncStore` blocks (the public
//! surface and the SQLite/Postgres helpers) plus the two row mappers.
//!
//! Invariant carried with the code: every statement below is scoped by
//! `tenant_id`, because this is the shared multi-tenant surface — tenant A
//! must never read or resolve tenant B’s conflicts. `detect_conflict` is the
//! single edge back into the parent’s `push_batch`; it is `pub`, so the seam
//! needs no widened visibility.

use crate::conflict_resolution::{
    ConflictCandidate, Decision, SyncConflictRow, build_conflict_row, classify, extract_terminal,
};
use platform_sync::crdt::VersionVector;
use rusqlite::params;

use super::SyncStore;
// ── Conflict rows (sync_conflicts) ────────────────────────────────────────
//
// Every statement below is scoped by tenant_id, matching the rest of this
// store: this is the shared multi-tenant surface, so tenant A must never read
// or resolve tenant B's conflicts. The Postgres arms additionally set the
// `oz.tenant_id` GUC locally inside a transaction so RLS can key on it at
// cutover.

impl SyncStore {
    /// Insert a conflict row.
    pub async fn insert_conflict(&self, row: &SyncConflictRow) -> Result<(), String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.execute(
                    "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id,
                        local_terminal_id, local_vector, remote_vector, local_payload,
                        remote_payload, severity, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'open')
                     ON CONFLICT (id) DO NOTHING",
                    params![
                        row.id,
                        row.tenant_id,
                        row.entity_type,
                        row.entity_id,
                        row.local_terminal_id,
                        row.local_vector,
                        row.remote_vector,
                        row.local_payload,
                        row.remote_payload,
                        row.severity,
                    ],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute(
                    "SELECT set_config('oz.tenant_id', $1, true)",
                    &[&row.tenant_id],
                )
                .await
                .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id,
                        local_terminal_id, local_vector, remote_vector, local_payload,
                        remote_payload, severity, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
                     ON CONFLICT (id) DO NOTHING",
                    &[
                        &row.id,
                        &row.tenant_id,
                        &row.entity_type,
                        &row.entity_id,
                        &row.local_terminal_id,
                        &row.local_vector,
                        &row.remote_vector,
                        &row.local_payload,
                        &row.remote_payload,
                        &row.severity,
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
                tx.commit().await.map_err(|e| e.to_string())
            }
        }
    }

    /// List a tenant's conflicts, newest first, optionally filtered.
    ///
    /// Both filters are applied in SQL rather than in memory so a tenant with
    /// a large backlog does not pay to serialise rows it filtered out.
    pub async fn list_conflicts(
        &self,
        tenant_id: &str,
        status: Option<&str>,
        severity: Option<&str>,
    ) -> Result<Vec<SyncConflictRow>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let mut stmt = conn
                    .prepare(
                        "SELECT id, tenant_id, entity_type, entity_id, local_terminal_id,
                            local_vector, remote_vector, local_payload, remote_payload,
                            severity, status, resolution, resolved_by, resolved_at, created_at
                         FROM sync_conflicts
                         WHERE tenant_id = ?1
                           AND (?2 IS NULL OR status = ?2)
                           AND (?3 IS NULL OR severity = ?3)
                         ORDER BY created_at DESC",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(
                        params![tenant_id, status, severity],
                        conflict_row_from_sqlite,
                    )
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                // RLS on sync_conflicts: without the GUC this returns an
                // empty list, so a reviewer would see a permanently clean
                // queue no matter how many conflicts were recorded.
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let stmt = tx
                    .prepare_cached(
                        "SELECT id, tenant_id, entity_type, entity_id, local_terminal_id,
                            local_vector, remote_vector, local_payload, remote_payload,
                            severity, status, resolution, resolved_by, resolved_at, created_at
                         FROM sync_conflicts
                         WHERE tenant_id = $1
                           AND ($2::text IS NULL OR status = $2)
                           AND ($3::text IS NULL OR severity = $3)
                         ORDER BY created_at DESC",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let rows = tx
                    .query(&stmt, &[&tenant_id, &status, &severity])
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(rows.iter().map(conflict_row_from_pg).collect())
            }
        }
    }

    /// Resolve an open conflict.
    ///
    /// Returns `false` when the id does not exist, belongs to another tenant,
    /// or is already closed — resolving twice must not silently overwrite the
    /// first decision, because the audit trail is the point of the row.
    pub async fn resolve_conflict(
        &self,
        tenant_id: &str,
        id: &str,
        resolution: &str,
        resolved_by: &str,
    ) -> Result<bool, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let changed = conn
                    .execute(
                        "UPDATE sync_conflicts
                            SET status = 'resolved', resolution = ?3, resolved_by = ?4,
                                resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                          WHERE id = ?1 AND tenant_id = ?2 AND status = 'open'",
                        params![id, tenant_id, resolution, resolved_by],
                    )
                    .map_err(|e| e.to_string())?;
                Ok(changed > 0)
            }
            Self::Postgres(pool) => {
                // RLS hides every row without the GUC, so this UPDATE would
                // match nothing and resolve_conflict would report `false`
                // ("unknown or already closed") for every id — the review UI
                // would appear broken rather than unauthorised.
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let stmt = tx
                    .prepare_cached(
                        "UPDATE sync_conflicts
                            SET status = 'resolved', resolution = $3, resolved_by = $4,
                                resolved_at = to_char(now() AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
                          WHERE id = $1 AND tenant_id = $2 AND status = 'open'",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let changed = tx
                    .execute(&stmt, &[&id, &tenant_id, &resolution, &resolved_by])
                    .await
                    .map_err(|e| e.to_string())?;
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(changed > 0)
            }
        }
    }
}

impl SyncStore {
    /// Compare an incoming mutation against the stored vector for its entity and
    /// act on the result.
    ///
    /// This is the call that makes conflict detection real: without it the
    /// classification policy is never exercised and `sync_conflicts` stays empty.
    ///
    /// Returns `None` when the item carries no vector. That is a deliberate skip,
    /// not an error — a peer that predates vector support pushes items without
    /// one, and inventing a vector for it would fabricate a history we cannot
    /// justify. Such items apply as they always have.
    ///
    /// On [`Decision::Flag`] the row is persisted. On every decision except
    /// [`Decision::Stale`] the stored vector is advanced to the pointwise maximum
    /// of both, so the next comparison sees everything observed so far. A stale
    /// item is dropped without touching stored state, because it adds nothing.
    pub async fn detect_conflict(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
        incoming: &VersionVector,
        incoming_payload: &str,
    ) -> Result<Option<Decision>, String> {
        let stored = self
            .load_entity_vector(tenant_id, entity_type, entity_id)
            .await?;
        let stored_payload = self
            .load_entity_payload(tenant_id, entity_type, entity_id)
            .await?;

        let empty = VersionVector::new();
        let stored_vector = stored.as_ref().unwrap_or(&empty);

        // Parse both bodies. An unparseable body is treated as absent rather than
        // as an empty object: the field-wise policy then fails closed and flags,
        // instead of concluding "no fields overlap" from a body it could not read.
        let stored_value: Option<serde_json::Value> = stored_payload
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok());
        let incoming_value: Option<serde_json::Value> = serde_json::from_str(incoming_payload).ok();

        let decision = classify(&ConflictCandidate {
            entity_type,
            stored: stored_vector,
            incoming,
            stored_payload: stored_value.as_ref(),
            incoming_payload: incoming_value.as_ref(),
        });

        match decision {
            Decision::Flag { .. } => {
                // `local_*` means "what the server already held", so the
                // terminal is read from the STORED body, not the incoming
                // one. Passing the incoming terminal here would attribute
                // the stored vector to the peer currently overwriting it,
                // and the review UI would name the wrong writer.
                let local_terminal_id = stored_payload
                    .as_deref()
                    .and_then(extract_terminal)
                    .unwrap_or_else(|| "unknown".to_string());
                let row = build_conflict_row(
                    &uuid::Uuid::now_v7().to_string(),
                    tenant_id,
                    entity_type,
                    entity_id,
                    &local_terminal_id,
                    stored_vector,
                    incoming,
                    stored_payload.as_deref().unwrap_or(""),
                    incoming_payload,
                );
                self.insert_conflict(&row).await?;
            }
            Decision::Stale => return Ok(Some(decision)),
            _ => {}
        }

        if !matches!(decision, Decision::Stale) {
            let mut merged = stored_vector.clone();
            merged.observe(incoming);
            self.save_entity_vector(tenant_id, entity_type, entity_id, &merged, incoming_payload)
                .await?;
        }

        Ok(Some(decision))
    }

    /// Load the stored version vector for an entity (`None` if unseen).
    async fn load_entity_vector(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<Option<VersionVector>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let json: Option<String> = conn
                    .query_row(
                        "SELECT vector FROM sync_entity_vectors
                      WHERE tenant_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
                        params![tenant_id, entity_type, entity_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(None);
                Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
            }
            Self::Postgres(pool) => {
                // RLS is enabled on sync_entity_vectors, so without the
                // tenant GUC this read matches NOTHING — and fails silently,
                // which is indistinguishable from "no vector stored yet".
                // That reads as "first push" forever, so nothing is ever
                // concurrent and no conflict is ever raised.
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let stmt = tx
                    .prepare_cached(
                        "SELECT vector FROM sync_entity_vectors
                      WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let rows = tx
                    .query(
                        &stmt,
                        &[
                            &tenant_id.to_string(),
                            &entity_type.to_string(),
                            &entity_id.to_string(),
                        ],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let json: Option<String> = rows.first().map(|r| r.get(0));
                Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
            }
        }
    }

    /// Load the last payload seen for an entity (`None` if unseen).
    async fn load_entity_payload(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<Option<String>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                Ok(conn
                    .query_row(
                        "SELECT last_payload FROM sync_entity_vectors
                      WHERE tenant_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
                        params![tenant_id, entity_type, entity_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(None))
            }
            Self::Postgres(pool) => {
                // Same RLS requirement as load_entity_vector: an unset GUC
                // makes the stored body invisible, and a missing body makes
                // the field-wise policy fail closed and flag.
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let stmt = tx
                    .prepare_cached(
                        "SELECT last_payload FROM sync_entity_vectors
                      WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3",
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                let rows = tx
                    .query(
                        &stmt,
                        &[
                            &tenant_id.to_string(),
                            &entity_type.to_string(),
                            &entity_id.to_string(),
                        ],
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                Ok(rows.first().map(|r| r.get(0)))
            }
        }
    }

    /// Upsert the merged vector and latest payload for an entity.
    async fn save_entity_vector(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
        vector: &VersionVector,
        payload: &str,
    ) -> Result<(), String> {
        let json = serde_json::to_string(vector).unwrap_or_else(|_| "{}".to_string());
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                conn.execute(
                    "INSERT INTO sync_entity_vectors
                    (tenant_id, entity_type, entity_id, vector, last_payload)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (tenant_id, entity_type, entity_id)
                 DO UPDATE SET vector = excluded.vector,
                               last_payload = excluded.last_payload,
                               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
                    params![tenant_id, entity_type, entity_id, json, payload],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
            }
            Self::Postgres(pool) => {
                // RLS WITH CHECK: without the GUC this INSERT is rejected
                // outright ("new row violates row-level security policy"),
                // so the stored vector never advances and every push looks
                // like the first one.
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                tx.execute(
                    "INSERT INTO sync_entity_vectors
                        (tenant_id, entity_type, entity_id, vector, last_payload)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (tenant_id, entity_type, entity_id)
                     DO UPDATE SET vector = excluded.vector,
                                   last_payload = excluded.last_payload,
                                   updated_at = now()",
                    &[
                        &tenant_id.to_string(),
                        &entity_type.to_string(),
                        &entity_id.to_string(),
                        &json,
                        &payload.to_string(),
                    ],
                )
                .await
                .map_err(|e| e.to_string())?;
                tx.commit().await.map_err(|e| e.to_string())
            }
        }
    }
}

/// Map one SQLite row of `sync_conflicts`.
fn conflict_row_from_sqlite(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncConflictRow> {
    Ok(SyncConflictRow {
        id: row.get(0)?,
        tenant_id: row.get(1)?,
        entity_type: row.get(2)?,
        entity_id: row.get(3)?,
        local_terminal_id: row.get(4)?,
        local_vector: row.get(5)?,
        remote_vector: row.get(6)?,
        local_payload: row.get(7)?,
        remote_payload: row.get(8)?,
        severity: row.get(9)?,
        status: row.get(10)?,
        resolution: row.get(11)?,
        resolved_by: row.get(12)?,
        resolved_at: row.get(13)?,
        created_at: row.get(14)?,
    })
}

/// Map one Postgres row of `sync_conflicts`.
fn conflict_row_from_pg(row: &tokio_postgres::Row) -> SyncConflictRow {
    SyncConflictRow {
        id: row.get(0),
        tenant_id: row.get(1),
        entity_type: row.get(2),
        entity_id: row.get(3),
        local_terminal_id: row.get(4),
        local_vector: row.get(5),
        remote_vector: row.get(6),
        local_payload: row.get(7),
        remote_payload: row.get(8),
        severity: row.get(9),
        status: row.get(10),
        resolution: row.get(11),
        resolved_by: row.get(12),
        resolved_at: row.get(13),
        created_at: row.get(14),
    }
}
