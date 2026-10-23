//! Conflict rows for the cloud sync store: the `sync_conflicts` surface.
//!
//! Moved verbatim out of [`super::sync_store`](crate::sync_store) by the
//! 2026-09-15 split; the
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
//!
//! O-H10 round-trip contract: detection is offered in two granularities that
//! share one implementation. `detect_conflict` is the single-item form and
//! pays one pool checkout + one transaction + one GUC set for its three
//! statements; `detect_conflicts` is the batch form `push_batch` calls and
//! pays that same constant for the WHOLE page, reading every stored vector
//! with one chunked `IN (…)` statement and writing the survivors the same
//! way. Both run the identical `*_locked` helpers on an already-open,
//! already-scoped transaction, so there is exactly one copy of the detection
//! semantics.

use crate::conflict_resolution::{
    ConflictCandidate, Decision, SyncConflictRow, build_conflict_row, classify, extract_terminal,
};
use platform_sync::crdt::VersionVector;
use rusqlite::{Connection, params};
use serde_json::Value;

use super::{DETECTION_CHUNK, SyncStore};
// ── Conflict rows (sync_conflicts) ────────────────────────────────────────
//
// Every statement below is scoped by tenant_id, matching the rest of this
// store: this is the shared multi-tenant surface, so tenant A must never read
// or resolve tenant B's conflicts. The Postgres arms additionally set the
// `oz.tenant_id` GUC locally inside a transaction so RLS can key on it at
// cutover.

impl SyncStore {
    /// Insert a conflict row.
    ///
    /// Both arms run the same statement detection's single-item path runs
    /// (`SyncStore::insert_conflict_locked_sqlite` /
    /// [`SyncStore::insert_conflict_locked_pg`]), so a row inserted here and a
    /// row inserted by detection cannot drift. The Postgres arm sets the
    /// `oz.tenant_id` GUC once for its own transaction — `sync_conflicts`
    /// has `WITH CHECK (tenant_id = current_setting('oz.tenant_id'))`, so
    /// without it the INSERT is rejected outright.
    ///
    /// No caller in the tree today (detection owns the production path); it
    /// stays because it is the documented single-row seam onto
    /// `sync_conflicts` for the admin surface.
    #[allow(dead_code)]
    pub async fn insert_conflict(&self, row: &SyncConflictRow) -> Result<(), String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                insert_conflict_locked_sqlite_row(&conn, row)
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
                Self::insert_conflict_locked_pg(&tx, row).await?;
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

/// The stored state of one entity — what a push is compared against: the
/// version vector as its stored JSON and the body.
///
/// The vector is carried as JSON rather than a parsed `VersionVector` because
/// the batch read must preserve the single-item form's treatment of an
/// UNPARSEABLE vector, which is "absent" (the `.ok()` on the parse). Parsing
/// at the point of use via [`parse_stored_vector`] keeps that one decision in
/// one place instead of duplicating it per arm.
type StoredState = (Option<String>, Option<String>);

/// One planned step of a batch pass: the state the NEXT item naming the same
/// key must be compared against, and the write that key will carry.
struct PlanStep {
    /// What a later item for this key sees. Seeded from the read, advanced by
    /// every decision that writes, left untouched by a stale one.
    state: StoredState,
    /// The last write planned for this key. `None` means "no write", which a
    /// stale item never turns back into a write and never clears.
    write: Option<EntityWrite>,
}

/// The accumulator of the batch pass, keyed by `(entity_type, entity_id)`.
type Plan = std::collections::HashMap<(String, String), PlanStep>;

/// The write detection decided on for one entity: the merged vector and the
/// body that must be persisted with it.
struct EntityWrite {
    merged: VersionVector,
    payload: String,
}

/// One pushed item as conflict detection sees it: the join key plus the
/// stamped body.
///
/// Mirrors what `push_batch` computes per item before calling detection, so
/// the batch path can resolve every key up front and read them all at once.
///
/// `(entity_type, entity_id)` is BOTH the detection key and the key
/// `sync_entity_vectors` is stored under: `entity_type` is the item's action and
/// `entity_id` is the column id `entity_id_of` resolves from the body — never
/// the queue row id. A batch read that looked for the queue id would find
/// nothing and treat every push as a first one.
pub(crate) struct DetectionInput<'a> {
    /// The item's `action`, which doubles as the `entity_type` join key.
    pub entity_type: &'a str,
    /// The entity the body refers to (`entity_id_of`), not the queue item id.
    pub entity_id: &'a str,
    /// The version vector the peer attached to its body.
    pub vector: &'a VersionVector,
    /// The body verbatim.
    pub payload: &'a str,
}

/// The `(entity_type, entity_id)` join key of one item.
fn key_of(entity_type: &str, entity_id: &str) -> (String, String) {
    (entity_type.to_string(), entity_id.to_string())
}

/// The distinct join keys of a page, in first-appearance order.
///
/// First appearance rather than sorted: the key order decides the statement
/// order, and therefore the `created_at` tie-break the review queue sorts
/// flagged rows on. First appearance is what a per-item loop would have
/// produced.
fn unique_entities(items: &[DetectionInput<'_>]) -> Vec<(String, String)> {
    let mut seen = std::collections::HashSet::with_capacity(items.len());
    let mut keys = Vec::with_capacity(items.len());
    for item in items {
        let key = key_of(item.entity_type, item.entity_id);
        if seen.insert(key.clone()) {
            keys.push(key);
        }
    }
    keys
}

/// The state a push is compared against for one key (absent ⇒ unseen entity).
fn state_of(plan: &Plan, key: &(String, String)) -> StoredState {
    plan.get(key)
        .map(|step| step.state.clone())
        .unwrap_or((None, None))
}

/// Parse a stored vector column exactly as the single-item form does:
/// unparseable is indistinguishable from absent and so reads as "first push".
///
/// That collapse is deliberate and pre-existing — it is what makes the column
/// contract ("`vector` is a JSON-serialised VersionVector") a fail-safe one:
/// a corrupt row cannot manufacture a concurrency verdict.
fn parse_stored_vector(stored: Option<String>) -> Option<VersionVector> {
    stored.and_then(|json| serde_json::from_str(&json).ok())
}

/// Record one item's decision in the plan, so a later item naming the same
/// key is compared against what this one left — which is what a sequential
/// per-item loop would have read back.
fn fold(plan: &mut Plan, key: &(String, String), write: Option<EntityWrite>) {
    let Some(step) = plan.get_mut(key) else {
        return;
    };
    if let Some(write) = write {
        step.state = (
            Some(serde_json::to_string(&write.merged).unwrap_or_else(|_| "{}".to_string())),
            Some(write.payload.clone()),
        );
        // Last planned write wins; a stale item never clears it.
        step.write = Some(write);
    }
}

/// The entities the page must persist, in first-appearance order, with the
/// write each one carries.
fn surviving_entities<'p>(
    entities: &'p [(String, String)],
    plan: &'p Plan,
) -> Vec<(&'p (String, String), &'p EntityWrite)> {
    entities
        .iter()
        .filter_map(|key| {
            plan.get(key)
                .and_then(|step| step.write.as_ref())
                .map(|w| (key, w))
        })
        .collect()
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
    ///
    /// Single-item form: one pool checkout, one transaction, one
    /// `oz.tenant_id` GUC set, and three statements (read vector+body,
    /// optional conflict insert, upsert). [`SyncStore::detect_conflicts`] is
    /// the batch form `push_batch` uses; both run the same `decide` and the
    /// same `*_locked` helpers, so there is one copy of the semantics.
    ///
    /// `push_batch` calls the batch form; this one is the documented
    /// single-row seam and the shape the batch form is proven equivalent to
    /// (see the tests), so it is kept and exercised rather than deleted.
    #[allow(dead_code)]
    pub async fn detect_conflict(
        &self,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
        incoming: &VersionVector,
        incoming_payload: &str,
    ) -> Result<Option<Decision>, String> {
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                // No explicit BEGIN: the helpers take `&Connection` (which
                // `Transaction` derefs to) so one body of code serves both
                // granularities, and detection keeps its historical autocommit
                // semantics here — each statement commits on its own, exactly
                // as when the three old helpers each drove the shared
                // connection directly. The batch form wraps the same helpers
                // in a single transaction instead.
                let (vector, payload) =
                    Self::load_entity_state_locked(&conn, tenant_id, entity_type, entity_id)?;
                let (decision, write) = decide(
                    entity_type,
                    incoming,
                    incoming_payload,
                    vector.clone(),
                    payload.clone(),
                );
                if let Decision::Flag { .. } = decision {
                    let row = conflict_row_for(
                        tenant_id,
                        entity_type,
                        entity_id,
                        incoming,
                        incoming_payload,
                        parse_stored_vector(vector).as_ref(),
                        payload.as_deref(),
                    );
                    insert_conflict_locked_sqlite_row(&conn, &row)?;
                }
                if let Some(write) = write {
                    upsert_entity_embedding_locked_sqlite(
                        &conn,
                        tenant_id,
                        entity_type,
                        entity_id,
                        write,
                    )?;
                }
                Ok(Some(decision))
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                // The RLS contract for the WHOLE transaction: set once, with
                // `is_local := true`, so it covers every statement below and
                // auto-resets at COMMIT/ROLLBACK. No helper below may open its
                // own transaction: a nested one would be scoped to this
                // transaction anyway but would re-pay the round trips O-H10
                // exists to remove.
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let (vector, payload) =
                    Self::load_entity_state_locked_pg(&tx, tenant_id, entity_type, entity_id)
                        .await?;
                let (decision, write) = decide(
                    entity_type,
                    incoming,
                    incoming_payload,
                    vector.clone(),
                    payload.clone(),
                );
                if let Decision::Flag { .. } = decision {
                    let row = conflict_row_for(
                        tenant_id,
                        entity_type,
                        entity_id,
                        incoming,
                        incoming_payload,
                        parse_stored_vector(vector).as_ref(),
                        payload.as_deref(),
                    );
                    Self::insert_conflict_locked_pg(&tx, &row).await?;
                }
                if let Some(write) = write {
                    Self::upsert_entity_embedding_locked_pg(
                        &tx,
                        tenant_id,
                        entity_type,
                        entity_id,
                        write,
                    )
                    .await?;
                }
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(Some(decision))
            }
        }
    }

    /// Batch form of [`SyncStore::detect_conflict`]: detect every item of a
    /// push page, returning one entry per input in input order.
    ///
    /// **O-H10.** The per-item form pays a pool checkout, a transaction and a
    /// `set_config('oz.tenant_id', …)` for each of its three statements, so a
    /// 500-item page cost on the order of 5,000 round trips. This form pays a
    /// *constant* for the page instead:
    ///
    /// - **Postgres:** one checkout + one transaction + one GUC set (3 round
    ///   trips), then one `entity_type = ANY($2) AND entity_id = ANY($3)`
    ///   read per [`DETECTION_CHUNK`] of distinct entities, one `UNNEST`-ed
    ///   insert per chunk of flagged rows, one `UNNEST`-ed upsert per chunk of
    ///   surviving entities, then one COMMIT.
    /// - **SQLite:** the same shape with `IN (…)` and a batched
    ///   `ON CONFLICT … DO UPDATE`, all inside ONE transaction — one fsync
    ///   instead of N.
    ///
    /// The skip contract of the single-item form is preserved verbatim: an
    /// entry is `None` for a body with no vector, and such an item touches no
    /// stored state.
    ///
    /// # Why this is equivalent to N single-item calls
    ///
    /// The decision logic lives in exactly one place — [`decide`], shared with
    /// the single-item form — and the SQL lives in the `*_locked` helpers,
    /// which both call. This form changes only *how often* they are invoked,
    /// never what they compute. Three details make that airtight:
    ///
    /// - **Reads before writes.** The page's reads all happen before any of
    ///   its writes, so an entity named twice in one page would otherwise be
    ///   compared against the pre-read table both times. [`fold`] closes that:
    ///   each item is compared against the *planned* state left by the earlier
    ///   item naming the same key, which is exactly what a sequential loop
    ///   would have read back.
    /// - **A stale item is "overwrite", not "delete".** This path only ever
    ///   inserts/updates, so a stale decision must leave whatever was planned
    ///   for that key in place. The accumulator keeps the last planned write
    ///   per key and drops a key that never got one.
    /// - **Error granularity.** Detection is best-effort and `push_batch`
    ///   logs-and-swallows its errors, so a detection failure costs no pushed
    ///   data either way. A mid-page failure now rolls the page's vector
    ///   advances back instead of keeping the ones before it — that can only
    ///   cause a re-detection, never a lost write.
    ///
    /// # RLS
    ///
    /// One `set_config('oz.tenant_id', $1, true)` per page, on the page's one
    /// transaction, and every statement below runs inside it — the same
    /// control the per-item form applies, applied once where it must hold
    /// once. See the comment at the call site.
    pub async fn detect_conflicts(
        &self,
        tenant_id: &str,
        items: &[DetectionInput<'_>],
    ) -> Result<Vec<Option<Decision>>, String> {
        if items.is_empty() {
            return Ok(Vec::new());
        }
        match self {
            Self::Sqlite(conn) => {
                let conn = conn.lock().await;
                let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
                let decisions = Self::detect_batch_locked_sqlite(&tx, tenant_id, items)?;
                tx.commit().map_err(|e| e.to_string())?;
                Ok(decisions)
            }
            Self::Postgres(pool) => {
                let mut client = pool.get().await.map_err(|e| e.to_string())?;
                let tx = client.transaction().await.map_err(|e| e.to_string())?;
                tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
                    .await
                    .map_err(|e| e.to_string())?;
                let decisions = Self::detect_batch_locked_pg(&tx, tenant_id, items).await?;
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(decisions)
            }
        }
    }

    /// The SQLite batch pass on an already-open, already-scoped transaction.
    ///
    /// Reads the whole page's stored state with chunked `IN (…)` statements,
    /// folds the decisions in input order, then writes the flagged rows and
    /// the surviving entities one batched statement per chunk.
    fn detect_batch_locked_sqlite(
        tx: &rusqlite::Connection,
        tenant_id: &str,
        items: &[DetectionInput<'_>],
    ) -> Result<Vec<Option<Decision>>, String> {
        let entities = unique_entities(items);
        let mut plan: Plan = Plan::with_capacity(entities.len());
        for chunk in entities.chunks(super::DETECTION_CHUNK) {
            for (key, state) in chunk
                .iter()
                .zip(Self::load_states_locked_sqlite(tx, tenant_id, chunk)?)
            {
                plan.insert(key.clone(), PlanStep { state, write: None });
            }
        }

        let mut decisions = Vec::with_capacity(items.len());
        for item in items {
            let key = key_of(item.entity_type, item.entity_id);
            let (stored_vector, stored_payload) = state_of(&plan, &key);
            let (decision, write) = decide(
                item.entity_type,
                item.vector,
                item.payload,
                stored_vector.clone(),
                stored_payload.clone(),
            );
            fold(&mut plan, &key, write);
            decisions.push((decision, stored_vector, stored_payload));
        }

        // Flagged rows in INPUT order, so the insert order — and therefore the
        // created_at tie-break the review queue sorts on — matches a loop.
        let flagged: Vec<SyncConflictRow> = items
            .iter()
            .zip(&decisions)
            .filter(|(_, (decision, _, _))| matches!(decision, Decision::Flag { .. }))
            .map(|(item, (_, stored_vector, stored_payload))| {
                conflict_row_for(
                    tenant_id,
                    item.entity_type,
                    item.entity_id,
                    item.vector,
                    item.payload,
                    parse_stored_vector(stored_vector.clone()).as_ref(),
                    stored_payload.as_deref(),
                )
            })
            .collect();
        SyncStore::insert_conflicts_locked_sqlite(tx, &flagged)?;

        let surviving = surviving_entities(&entities, &plan);
        SyncStore::upsert_entities_locked_sqlite(tx, tenant_id, &surviving)?;
        Ok(decisions.into_iter().map(|(d, _, _)| Some(d)).collect())
    }

    /// The Postgres batch pass on the page's one transaction.
    ///
    /// Same three statement families as the SQLite arm, spelled with
    /// `= ANY($n)` and `UNNEST` so a page costs a constant number of round
    /// trips. Every statement here runs under the GUC the caller set.
    async fn detect_batch_locked_pg(
        tx: &tokio_postgres::Transaction<'_>,
        tenant_id: &str,
        items: &[DetectionInput<'_>],
    ) -> Result<Vec<Option<Decision>>, String> {
        let entities = unique_entities(items);
        let mut plan: Plan = Plan::with_capacity(entities.len());
        for chunk in entities.chunks(super::DETECTION_CHUNK) {
            let (types, ids): (Vec<&str>, Vec<&str>) =
                chunk.iter().map(|(t, i)| (t.as_str(), i.as_str())).unzip();
            let rows = tx
                .query(
                    "SELECT entity_type, entity_id, vector, last_payload
                       FROM sync_entity_vectors
                      WHERE tenant_id = $1
                        AND entity_type = ANY($2)
                        AND entity_id = ANY($3)",
                    &[&tenant_id, &types, &ids],
                )
                .await
                .map_err(|e| e.to_string())?;
            for row in &rows {
                plan.insert(
                    (row.get(0), row.get(1)),
                    PlanStep {
                        state: (Some(row.get(2)), Some(row.get(3))),
                        write: None,
                    },
                );
            }
        }

        let mut decisions = Vec::with_capacity(items.len());
        for item in items {
            let key = key_of(item.entity_type, item.entity_id);
            let (stored_vector, stored_payload) = state_of(&plan, &key);
            let (decision, write) = decide(
                item.entity_type,
                item.vector,
                item.payload,
                stored_vector.clone(),
                stored_payload.clone(),
            );
            fold(&mut plan, &key, write);
            decisions.push((decision, stored_vector, stored_payload));
        }

        let flagged: Vec<SyncConflictRow> = items
            .iter()
            .zip(&decisions)
            .filter(|(_, (decision, _, _))| matches!(decision, Decision::Flag { .. }))
            .map(|(item, (_, stored_vector, stored_payload))| {
                conflict_row_for(
                    tenant_id,
                    item.entity_type,
                    item.entity_id,
                    item.vector,
                    item.payload,
                    parse_stored_vector(stored_vector.clone()).as_ref(),
                    stored_payload.as_deref(),
                )
            })
            .collect();
        insert_conflicts_locked_pg_batch(tx, &flagged).await?;

        let surviving = surviving_entities(&entities, &plan);
        Self::upsert_entities_locked_pg(tx, tenant_id, &surviving).await?;
        Ok(decisions.into_iter().map(|(d, _, _)| Some(d)).collect())
    }
}

/// The decision for one item, shared verbatim by both detection
/// granularities.
///
/// Returns the decision to report and, when the decision advances stored
/// state, the [`EntityWrite`] to persist. Pure: it reads nothing and writes
/// nothing, so batching above it cannot change what it concludes.
///
/// `stored_vector`/`stored_payload` are the state the push is compared
/// against — the table's row in the single-item form, or the planned state of
/// an earlier item naming the same entity in the batch form.
fn decide(
    entity_type: &str,
    incoming: &VersionVector,
    incoming_payload: &str,
    stored_vector: Option<String>,
    stored_payload: Option<String>,
) -> (Decision, Option<EntityWrite>) {
    let empty = VersionVector::new();
    let stored_vector_parsed = parse_stored_vector(stored_vector);
    let stored_vector = stored_vector_parsed.as_ref().unwrap_or(&empty);

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

    if let Decision::Stale = decision {
        // A push older than what is stored adds nothing the server did not
        // already know, so it must neither raise a row nor touch stored state.
        return (decision, None);
    }

    // C19: the payload that persists is the one the DECISION chose, not
    // always the incoming one. `LastWriterWins { winner_is_remote: false }`
    // means the STORED side won this tie-break, and writing
    // `incoming_payload` anyway discarded the winner's body while reporting
    // a successful resolution -- the silent one-side loss the policy table
    // exists to prevent. The vector still observes the incoming event (both
    // sides have now been seen, which is what makes the merge convergent),
    // but the BODY follows the winner.
    let mut merged = stored_vector.clone();
    merged.observe(incoming);
    // C19(a): `AutoMerge` had no arm, so a concurrent stock adjustment --
    // reachable in production, see the test -- fell through to "keep the
    // stored body" and one terminal's delta vanished. The policy's own doc
    // names the intended outcome: "Additive deltas: both sides apply."
    //
    // The merge is computed HERE rather than in the classifier because it
    // needs both payloads, which `classify` deliberately does not open
    // (`MergePolicy::AutoMergeDeltas` never reads them). A merge that cannot
    // be computed -- absent side, unparseable body, no numeric delta, or an
    // overflow -- falls back to the stored body rather than inventing a
    // quantity, so the failure mode stays "lose nothing silently" and never
    // "write a number neither terminal reported".
    let payload_to_store: Option<String> = match decision {
        Decision::LastWriterWins {
            winner_is_remote: true,
            ..
        } => Some(incoming_payload.to_string()),
        Decision::AutoMerge { .. } => {
            merge_additive_deltas(stored_payload.as_deref(), Some(incoming_payload))
                .or_else(|| stored_payload.clone())
        }
        // The stored side won, or the pair is unresolved:
        //   * `LastWriterWins { winner_is_remote: false }` -- the
        //     winner's body must survive; writing the incoming one
        //     silently discards the side the tie-break chose.
        //   * `Flag` -- unresolved, and the review row already carries BOTH
        //     payloads (`local_payload` / `remote_payload`), so overwriting
        //     here would destroy the local side a reviewer compares against.
        _ => stored_payload.clone(),
    };
    // A `None` stored body cannot occur for `LastWriterWins` (the policy
    // needs no payload) or `Flag` (which requires one), but CAN for a
    // first-seen entity where there is no stored side at all: the incoming
    // body is then the only side there is.
    let payload = payload_to_store.unwrap_or_else(|| incoming_payload.to_string());

    (decision, Some(EntityWrite { merged, payload }))
}

/// Build the review row a `Flag` decision persists.
///
/// Both granularities build the row here, so a batched page and a per-item
/// loop produce identical rows. `local_*` means "what the server already
/// held", so the terminal is read from the STORED body, not the incoming one:
/// passing the incoming terminal here would attribute the stored vector to
/// the peer currently overwriting it, and the review UI would name the wrong
/// writer.
fn conflict_row_for(
    tenant_id: &str,
    entity_type: &str,
    entity_id: &str,
    incoming: &VersionVector,
    incoming_payload: &str,
    stored_vector_before: Option<&VersionVector>,
    stored_payload: Option<&str>,
) -> SyncConflictRow {
    let local_terminal_id = stored_payload
        .and_then(extract_terminal)
        .unwrap_or_else(|| "unknown".to_string());
    let empty = VersionVector::new();
    build_conflict_row(
        &uuid::Uuid::now_v7().to_string(),
        tenant_id,
        entity_type,
        entity_id,
        &local_terminal_id,
        stored_vector_before.unwrap_or(&empty),
        incoming,
        stored_payload.unwrap_or(""),
        incoming_payload,
    )
}
impl SyncStore {
    /// Read the stored state a push is compared against: `(vector, body)`.
    ///
    /// One statement, not two. The old pair `load_entity_vector` +
    /// `load_entity_payload` read the SAME row of
    /// `sync_entity_vectors` twice — the row is keyed by
    /// `(tenant_id, entity_type, entity_id)`, so the two reads could never
    /// disagree — and after O-H10 the pair costs a full pool checkout,
    /// transaction and GUC set per item on the Postgres arm. Merging them is
    /// what makes "one round trip per entity per read" true.
    ///
    /// The vector is returned as its stored JSON: parsing happens in
    /// [`parse_stored_vector`], where an unparseable value collapses to
    /// "absent" exactly as the two old helpers' `.ok()` did.
    ///
    /// `conn` is a plain `&Connection` so a [`rusqlite::Transaction`]
    /// (which derefs to one) can be passed in: the single-item form passes the
    /// shared connection, the batch form passes its one transaction, and
    /// neither pays for a statement the other avoids.
    fn load_entity_state_locked(
        conn: &Connection,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<StoredState, String> {
        let row = conn
            .query_row(
                "SELECT vector, last_payload FROM sync_entity_vectors
                      WHERE tenant_id = ?1 AND entity_type = ?2 AND entity_id = ?3",
                params![tenant_id, entity_type, entity_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                },
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?;
        // The old helpers swallowed a read error into "unseen"
        // (`.unwrap_or(None)`). Unseen is what an absent row means, so the two
        // are reported identically here rather than splitting a distinction
        // detection never made.
        Ok(row.unwrap_or_default())
    }

    /// The bulk form of [`SyncStore::load_entity_state_locked`]:
    /// `(vector, body)` for every key in `keys`, in the SAME ORDER.
    ///
    /// One `IN (…)` read for the whole page instead of one per entity.
    ///
    /// The two lists are bound as a CROSS PRODUCT, not paired: a row matches
    /// when its `entity_type` is ANY of the page's types and its `entity_id` is
    /// ANY of the page's ids. For the single-action pages `push_batch` sends
    /// that is exact; for a mixed page it can also surface a row whose type and
    /// id came from different items — an over-read, never a wrong answer, since
    /// the result is filtered to the requested keys before it is returned.
    ///
    /// `keys` must be non-empty and no longer than [`DETECTION_CHUNK`] — the
    /// caller chunks.
    fn load_states_locked_sqlite(
        conn: &Connection,
        tenant_id: &str,
        keys: &[(String, String)],
    ) -> Result<Vec<StoredState>, String> {
        let mut states = vec![(None, None); keys.len()];
        if keys.is_empty() {
            return Ok(states);
        }
        let n = keys.len();
        let (types, ids): (Vec<&str>, Vec<&str>) =
            keys.iter().map(|(t, i)| (t.as_str(), i.as_str())).unzip();
        let type_placeholders = (0..n)
            .map(|i| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        let id_placeholders = (0..n)
            .map(|i| format!("?{}", i + 2 + n))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT entity_type, entity_id, vector, last_payload FROM sync_entity_vectors
              WHERE tenant_id = ?1
                AND entity_type IN ({type_placeholders})
                AND entity_id IN ({id_placeholders})"
        );
        // One source list, built in the SAME order as the placeholders above
        // (tenant, then every type, then every id): `?1` is the tenant, so the
        // two loops must not be swapped and cannot be separated from the SQL.
        let mut values: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(1 + 2 * n);
        values.push(&tenant_id);
        for t in &types {
            values.push(t);
        }
        for i in &ids {
            values.push(i);
        }
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(values), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut by_key: std::collections::HashMap<(String, String), StoredState> =
            std::collections::HashMap::with_capacity(n);
        for row in rows {
            let (t, i, v, p) = row.map_err(|e| e.to_string())?;
            by_key.insert((t, i), (Some(v), Some(p)));
        }
        for (slot, key) in states.iter_mut().zip(keys) {
            if let Some(state) = by_key.remove(key) {
                *slot = state;
            }
        }
        Ok(states)
    }

    /// The Postgres form of [`SyncStore::load_entity_state_locked`], on a
    /// transaction the caller has already scoped with `oz.tenant_id`.
    ///
    /// The GUC is NOT set here — it is set once by the caller for the whole
    /// transaction, and RLS keys on that transaction's setting. Opening a
    /// nested transaction or re-setting the GUC per statement is exactly the
    /// per-item cost O-H10 removes.
    async fn load_entity_state_locked_pg(
        tx: &tokio_postgres::Transaction<'_>,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
    ) -> Result<StoredState, String> {
        let rows = tx
            .query(
                "SELECT vector, last_payload FROM sync_entity_vectors
                  WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3",
                &[&tenant_id, &entity_type, &entity_id],
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(match rows.first() {
            Some(row) => (Some(row.get(0)), Some(row.get(1))),
            None => (None, None),
        })
    }

    /// Upsert the merged vector and chosen body for ONE entity, on a
    /// transaction the caller has already scoped with `oz.tenant_id`.
    ///
    /// RLS `WITH CHECK`: without the GUC this INSERT is rejected outright
    /// ("new row violates row-level security policy"), so the stored vector
    /// never advances and every push looks like the first one. The caller's
    /// single `set_config` covers it.
    async fn upsert_entity_embedding_locked_pg(
        tx: &tokio_postgres::Transaction<'_>,
        tenant_id: &str,
        entity_type: &str,
        entity_id: &str,
        write: EntityWrite,
    ) -> Result<(), String> {
        let json = serde_json::to_string(&write.merged).unwrap_or_else(|_| "{}".to_string());
        tx.execute(
            "INSERT INTO sync_entity_vectors
                (tenant_id, entity_type, entity_id, vector, last_payload)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, entity_type, entity_id)
             DO UPDATE SET vector = excluded.vector,
                           last_payload = excluded.last_payload,
                           updated_at = now()",
            &[&tenant_id, &entity_type, &entity_id, &json, &write.payload],
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    /// The bulk form of [`SyncStore::upsert_entity_embedding_locked_pg`]:
    /// one `INSERT … ON CONFLICT DO UPDATE` over `UNNEST`ed arrays, for
    /// every entity the page resolved.
    ///
    /// Same row set, same `DO UPDATE` clause, same `updated_at = now()` as the
    /// per-entity statement — a batched page and a loop write the same values.
    /// It also pins the whole page's `updated_at` to ONE timestamp, which the
    /// per-item form could not promise anyway (it stamps per statement).
    async fn upsert_entities_locked_pg(
        tx: &tokio_postgres::Transaction<'_>,
        tenant_id: &str,
        entities: &[(&(String, String), &EntityWrite)],
    ) -> Result<(), String> {
        if entities.is_empty() {
            return Ok(());
        }
        let types: Vec<&str> = entities.iter().map(|(k, _)| k.0.as_str()).collect();
        let ids: Vec<&str> = entities.iter().map(|(k, _)| k.1.as_str()).collect();
        let vectors: Vec<String> = entities
            .iter()
            .map(|(_, w)| serde_json::to_string(&w.merged).unwrap_or_else(|_| "{}".to_string()))
            .collect();
        let payloads: Vec<&str> = entities.iter().map(|(_, w)| w.payload.as_str()).collect();
        tx.execute(
            "INSERT INTO sync_entity_vectors
                (tenant_id, entity_type, entity_id, vector, last_payload)
             SELECT $1, * FROM UNNEST($2::text[], $3::text[], $4::text[], $5::text[])
             ON CONFLICT (tenant_id, entity_type, entity_id)
             DO UPDATE SET vector = excluded.vector,
                           last_payload = excluded.last_payload,
                           updated_at = now()",
            &[&tenant_id, &types, &ids, &vectors, &payloads],
        )
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    /// Insert ONE flagged conflict row on an already-scoped transaction.
    async fn insert_conflict_locked_pg(
        tx: &tokio_postgres::Transaction<'_>,
        row: &SyncConflictRow,
    ) -> Result<(), String> {
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
        .map(|_| ())
        .map_err(|e| e.to_string())
    }
}

/// Insert every flagged row of a page with one `UNNEST`ed statement per
/// [`DETECTION_CHUNK`], preserving input order.
///
/// `ON CONFLICT (id) DO NOTHING` is kept verbatim: ids are freshly minted
/// v7 UUIDs, so the clause is defensive, and a batch that re-ran would have to
/// behave exactly like the single insert it replaces.
#[allow(clippy::too_many_arguments)]
async fn insert_conflicts_locked_pg_batch(
    tx: &tokio_postgres::Transaction<'_>,
    rows: &[SyncConflictRow],
) -> Result<(), String> {
    for chunk in rows.chunks(super::DETECTION_CHUNK) {
        let n = chunk.len();
        let mut ids: Vec<&str> = Vec::with_capacity(n);
        let mut tenants: Vec<&str> = Vec::with_capacity(n);
        let mut types: Vec<&str> = Vec::with_capacity(n);
        let mut entities: Vec<&str> = Vec::with_capacity(n);
        let mut terminals: Vec<&str> = Vec::with_capacity(n);
        let mut local_vectors: Vec<&str> = Vec::with_capacity(n);
        let mut remote_vectors: Vec<&str> = Vec::with_capacity(n);
        let mut local_payloads: Vec<&str> = Vec::with_capacity(n);
        let mut remote_payloads: Vec<&str> = Vec::with_capacity(n);
        let mut severities: Vec<&str> = Vec::with_capacity(n);
        for row in chunk {
            ids.push(&row.id);
            tenants.push(&row.tenant_id);
            types.push(&row.entity_type);
            entities.push(&row.entity_id);
            terminals.push(&row.local_terminal_id);
            local_vectors.push(&row.local_vector);
            remote_vectors.push(&row.remote_vector);
            local_payloads.push(&row.local_payload);
            remote_payloads.push(&row.remote_payload);
            severities.push(&row.severity);
        }
        tx.execute(
            "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id,
                    local_terminal_id, local_vector, remote_vector, local_payload,
                    remote_payload, severity, status)
                 SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[],
                                      $5::text[], $6::text[], $7::text[], $8::text[],
                                      $9::text[], $10::text[], $11::text[])
                 ON CONFLICT (id) DO NOTHING",
            &[
                &ids,
                &tenants,
                &types,
                &entities,
                &terminals,
                &local_vectors,
                &remote_vectors,
                &local_payloads,
                &remote_payloads,
                &severities,
                &vec!["open"; n],
            ],
        )
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Insert ONE flagged conflict row on the shared SQLite connection (or a
/// caller's transaction — `Transaction` derefs to `Connection`).
fn insert_conflict_locked_sqlite_row(
    conn: &Connection,
    row: &SyncConflictRow,
) -> Result<(), String> {
    sync_conflicts_chunk_sqlite(std::slice::from_ref(row), conn)
}

/// Insert one chunk of flagged rows ([`DETECTION_CHUNK`] at most) with a
/// single multi-row statement, in the order given.
fn sync_conflicts_chunk_sqlite(rows: &[SyncConflictRow], conn: &Connection) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut tuples: Vec<String> = Vec::with_capacity(rows.len());
    let mut bound: Vec<rusqlite::types::Value> = Vec::with_capacity(rows.len() * 10);
    for (n, row) in rows.iter().enumerate() {
        // NUMBERED placeholders, one block per row: SQLite binds ?N by index,
        // so a repeated ?1..?10 block would bind every tuple to the FIRST row.
        let base = n * 10;
        tuples.push(format!(
            "(?{},?{},?{},?{},?{},?{},?{},?{},?{},?{},'open')",
            base + 1,
            base + 2,
            base + 3,
            base + 4,
            base + 5,
            base + 6,
            base + 7,
            base + 8,
            base + 9,
            base + 10
        ));
        bound.push(rusqlite::types::Value::Text(row.id.clone()));
        bound.push(rusqlite::types::Value::Text(row.tenant_id.clone()));
        bound.push(rusqlite::types::Value::Text(row.entity_type.clone()));
        bound.push(rusqlite::types::Value::Text(row.entity_id.clone()));
        bound.push(rusqlite::types::Value::Text(row.local_terminal_id.clone()));
        bound.push(rusqlite::types::Value::Text(row.local_vector.clone()));
        bound.push(rusqlite::types::Value::Text(row.remote_vector.clone()));
        bound.push(rusqlite::types::Value::Text(row.local_payload.clone()));
        bound.push(rusqlite::types::Value::Text(row.remote_payload.clone()));
        bound.push(rusqlite::types::Value::Text(row.severity.clone()));
    }
    let values = tuples.join(",");
    let sql = format!(
        "INSERT INTO sync_conflicts (id, tenant_id, entity_type, entity_id,
            local_terminal_id, local_vector, remote_vector, local_payload,
            remote_payload, severity, status)
         VALUES {values}
         ON CONFLICT (id) DO NOTHING"
    );
    conn.execute(&sql, rusqlite::params_from_iter(bound.iter()))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Upsert the merged vector and chosen body for ONE entity, on the shared
/// SQLite connection (or a caller's transaction).
fn upsert_entity_embedding_locked_sqlite(
    conn: &Connection,
    tenant_id: &str,
    entity_type: &str,
    entity_id: &str,
    write: EntityWrite,
) -> Result<(), String> {
    let json = serde_json::to_string(&write.merged).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT INTO sync_entity_vectors
        (tenant_id, entity_type, entity_id, vector, last_payload)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (tenant_id, entity_type, entity_id)
     DO UPDATE SET vector = excluded.vector,
                   last_payload = excluded.last_payload,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        params![tenant_id, entity_type, entity_id, json, write.payload],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

impl SyncStore {
    /// Insert every flagged row of a page, all bound parameters of one
    /// [`DETECTION_CHUNK`] at a time, in input order.
    ///
    /// Rows are bound in INPUT order, so the `created_at` tie-break the review
    /// queue sorts on matches a per-item loop.
    fn insert_conflicts_locked_sqlite(
        conn: &Connection,
        rows: &[SyncConflictRow],
    ) -> Result<(), String> {
        for chunk in rows.chunks(DETECTION_CHUNK) {
            if chunk.is_empty() {
                continue;
            }
            sync_conflicts_chunk_sqlite(chunk, conn)?;
        }
        Ok(())
    }

    /// Upsert every surviving entity of a page with one multi-row statement
    /// per [`DETECTION_CHUNK`] (5 bound columns per row, so 500 rows stay far
    /// under SQLite's 32766-parameter cap).
    ///
    /// Same `ON CONFLICT … DO UPDATE` clause as the per-entity statement, so a
    /// batched page writes exactly what a loop writes.
    fn upsert_entities_locked_sqlite(
        conn: &Connection,
        tenant_id: &str,
        entities: &[(&(String, String), &EntityWrite)],
    ) -> Result<(), String> {
        for chunk in entities.chunks(DETECTION_CHUNK) {
            if chunk.is_empty() {
                continue;
            }
            upsert_entities_chunk_sqlite(chunk, conn, tenant_id)?;
        }
        Ok(())
    }
}

/// Upsert one chunk of surviving entities ([`DETECTION_CHUNK`] at most) with a
/// single multi-row statement.
///
/// Same `ON CONFLICT … DO UPDATE` clause as the per-entity statement, so a
/// batched page writes exactly what a loop writes.
fn upsert_entities_chunk_sqlite(
    chunk: &[(&(String, String), &EntityWrite)],
    conn: &Connection,
    tenant_id: &str,
) -> Result<(), String> {
    if chunk.is_empty() {
        return Ok(());
    }
    let row_placeholders = (0..chunk.len())
        .map(|r| {
            let base = r * 5 + 1;
            format!(
                "(?{base},?{},?{},?{},?{})",
                base + 1,
                base + 2,
                base + 3,
                base + 4
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "INSERT INTO sync_entity_vectors
        (tenant_id, entity_type, entity_id, vector, last_payload)
     VALUES {row_placeholders}
     ON CONFLICT (tenant_id, entity_type, entity_id)
     DO UPDATE SET vector = excluded.vector,
                   last_payload = excluded.last_payload,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
    );
    let mut bound: Vec<rusqlite::types::Value> = Vec::with_capacity(chunk.len() * 5);
    for ((entity_type, entity_id), write) in chunk {
        bound.push(rusqlite::types::Value::Text(tenant_id.to_string()));
        bound.push(rusqlite::types::Value::Text(entity_type.clone()));
        bound.push(rusqlite::types::Value::Text(entity_id.clone()));
        bound.push(rusqlite::types::Value::Text(
            serde_json::to_string(&write.merged).unwrap_or_else(|_| "{}".to_string()),
        ));
        bound.push(rusqlite::types::Value::Text(write.payload.clone()));
    }
    conn.execute(&sql, rusqlite::params_from_iter(bound.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
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
/// Merge two `AutoMergeDeltas` bodies by SUMMING their `delta` fields.
///
/// `MergePolicy::AutoMergeDeltas` means "Additive deltas: both sides apply.
/// Stock movements." -- so a concurrent pair must produce the sum, not a
/// winner. The merged body is the STORED one with its `delta` replaced by the
/// sum, which keeps every other field the stored side carried (sku, new_qty,
/// reason, and anything a future producer adds) instead of inventing a shape
/// here.
///
/// The `new_qty` field is deliberately NOT recomputed. Each side's `new_qty` is
/// the quantity that side observed AFTER its own delta, and the two disagree by
/// construction in a concurrent pair -- so any arithmetic on them would be a
/// guess. `delta` is the additive quantity the policy names; the merged `delta`
/// is the one number this function is entitled to state.
///
/// Returns `None` when the merge cannot be computed -- either side absent, a
/// body that is not JSON, a missing or non-integer `delta`, or an `i64`
/// overflow. The caller falls back to the stored body, so the failure mode is
/// "lose nothing silently" rather than "write a quantity neither terminal
/// reported". Nothing on this path unwraps parsed input.
fn merge_additive_deltas(stored: Option<&str>, incoming: Option<&str>) -> Option<String> {
    let stored_value: Value = serde_json::from_str(stored?).ok()?;
    let incoming_value: Value = serde_json::from_str(incoming?).ok()?;
    let stored_delta = stored_value.get("delta")?.as_i64()?;
    let incoming_delta = incoming_value.get("delta")?.as_i64()?;
    let summed = stored_delta.checked_add(incoming_delta)?;

    let mut merged = stored_value.as_object()?.clone();
    merged.insert("delta".to_string(), Value::from(summed));
    serde_json::to_string(&Value::Object(merged)).ok()
}
