//! The workspace-CRUD phase of the atomic topology Apply.
//!
//! Extracted from `apply_topology_diff` on 2026-09-27 for two reasons:
//!
//! 1. The caller used to wrap this in a bare `{}` block purely so the
//!    non-`Send` guards (`MutexGuard`, `Store`, `Transaction`) were dropped
//!    before its `ctx.db.lock().await`. A plain `fn` makes that boundary
//!    STRUCTURAL rather than lexical: nothing here is held across an await,
//!    which is exactly what the `Send` requirement needs to see.
//! 2. It is the whole "Workspace CRUD in a single transaction" phase, and it
//!    validates, mutates and commits as one unit — a partial write is a bug,
//!    so keeping it in one function is honest about the boundary.
//!
//! Invariant: every mutation happens inside the single `tx`, and the commit is
//! the LAST statement — a `?` on any row aborts and rolls back the whole batch.

use kasirmu_core::subscription::SubscriptionTier;

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;
use crate::workspaces::CreateInstanceRequest;

use super::super::model::*;

/// Apply the workspace creations/updates/archives of a topology diff in ONE
/// store-DB transaction.
///
/// Returns `Ok(())` once committed; any validation failure or row error returns
/// early and rolls the whole batch back. The caller logs the phase boundary.
pub(super) fn apply_workspace_crud(
    ctx: &BridgeCtx<'_>,
    effective_store_id: &str,
    effective_tier: SubscriptionTier,
    workspace_creations: &[CreateInstanceRequest],
    workspace_updates: &[UpdateInstanceRequest],
    workspace_archives: &[String],
) -> Result<(), BridgeError> {
    let conn = ctx
            .db_manager
            .open_store(&effective_store_id)
            .map_err(|e| {
                // M5 / ruling R3: cause is logged, not returned (path-free error).
                tracing::error!(store = %effective_store_id, error = %e, "topology Apply: opening store db failed for workspace CRUD");
                BridgeError::Internal(format!(
                    "opening store db for store '{}'",
                    effective_store_id
                ))
            })?;
    let db = conn
        .lock()
        .map_err(|e| BridgeError::Internal(format!("store db lock: {e}")))?;
    let store = ctx.store(&db);

    // Preserve the same subscription and entitlement boundary as the
    // standalone workspace-create command. The topology diff must not
    // become an entitlement bypass just because it batches mutations.
    for creation in workspace_creations {
        if creation.id.trim().is_empty()
            || creation.type_key.trim().is_empty()
            || creation.store_id.trim().is_empty()
            || creation.name.trim().is_empty()
        {
            return Err(BridgeError::Invalid(
                "workspace creation requires non-empty id, type_key, store_id, and name".into(),
            ));
        }
        if creation.store_id != effective_store_id {
            tracing::warn!(
                workspace_id = %creation.id,
                creation_store = %creation.store_id,
                effective_store = %effective_store_id,
                "topology Apply: workspace targets a different store"
            );
            return Err(BridgeError::PermissionDenied(format!(
                "workspace '{}' store_id '{}' does not match topology branch store '{}'",
                creation.id, creation.store_id, effective_store_id
            )));
        }
        if !effective_tier.allows_workspace_type(&creation.type_key) {
            return Err(BridgeError::PermissionDenied(format!(
                "subscription tier does not allow workspace type {}",
                creation.type_key
            )));
        }
        if creation
            .purpose_key
            .as_deref()
            .unwrap_or("general")
            .trim()
            .is_empty()
        {
            return Err(BridgeError::Invalid(
                "workspace purpose_key must not be empty".into(),
            ));
        }
    }
    for update in workspace_updates {
        let owner: String = store
                .conn()
                .query_row(
                    "SELECT location_id FROM workspace_instances WHERE id = ?1",
                    rusqlite::params![update.id],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    tracing::warn!(workspace_id = %update.id, "topology Apply: workspace not found in store DB");
                    BridgeError::PermissionDenied(format!(
                        "workspace '{}' not found in store '{}' — it may have been created in a different store",
                        update.id, effective_store_id
                    ))
                })?;
        if owner != effective_store_id {
            tracing::warn!(
                workspace_id = %update.id,
                workspace_store = %owner,
                effective_store = %effective_store_id,
                "topology Apply: workspace ownership mismatch"
            );
            return Err(BridgeError::PermissionDenied(format!(
                "workspace '{}' is in store '{}' but topology targets store '{}'",
                update.id, owner, effective_store_id
            )));
        }
    }
    for archive_id in workspace_archives {
        let owner: String = store
                .conn()
                .query_row(
                    "SELECT location_id FROM workspace_instances WHERE id = ?1",
                    rusqlite::params![archive_id],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    tracing::warn!(workspace_id = %archive_id, "topology Apply: archive target not found in store DB");
                    BridgeError::PermissionDenied(format!(
                        "workspace '{}' not found in store '{}' for archive",
                        archive_id, effective_store_id
                    ))
                })?;
        if owner != effective_store_id {
            tracing::warn!(
                workspace_id = %archive_id,
                workspace_store = %owner,
                effective_store = %effective_store_id,
                "topology Apply: archive target ownership mismatch"
            );
            return Err(BridgeError::PermissionDenied(format!(
                "workspace '{}' is in store '{}' but topology targets store '{}' for archive",
                archive_id, owner, effective_store_id
            )));
        }
    }
    // Quota check: only enforce when new workspaces are actually being
    // created. Topology edits (0 creates, 0 archives) should not be
    // blocked by the quota — the user is reorganizing existing workspaces,
    // not adding new ones. This prevents a tier downgrade from locking
    // the user out of editing their existing topology.
    if !workspace_creations.is_empty()
        && let Some(limit) = effective_tier.max_pos_instances()
    {
        // Only POS registers (store-pos/restaurant-pos) consume the
        // register budget — kds/warehouse/inventory/admin instances must
        // not block legitimate register creation.
        let current = store.count_active_pos_instances(&effective_store_id)?;
        let archived_ids: std::collections::HashSet<&str> =
            workspace_archives.iter().map(String::as_str).collect();
        let archived_active = archived_ids
            .iter()
            .filter(|id| {
                store
                    .conn()
                    .query_row(
                        "SELECT status = 'active' FROM workspace_instances WHERE id = ?1",
                        rusqlite::params![id],
                        |row| row.get::<_, bool>(0),
                    )
                    .unwrap_or(false)
            })
            .count() as i64;
        let projected = current - archived_active + workspace_creations.len() as i64;
        if projected > limit {
            return Err(BridgeError::PermissionDenied(format!(
                "workspace instance quota exceeded: limit {limit}, current {current}, archived {archived_active}, requested {}, projected {projected}",
                workspace_creations.len()
            )));
        }
    }

    // Inside this transaction, all create / update / archive SQL runs
    // *directly* on `tx`. We deliberately do NOT delegate to
    // `Store::create_workspace_instance` here: that method opens its
    // own transaction via `unchecked_transaction`, which issues a raw
    // `BEGIN` that SQLite rejects ("cannot start a transaction within
    // a transaction") when an outer transaction is already open. See
    // `create_workspace_instance_cannot_nest_in_open_transaction` in
    // kasirmu-core. Running the INSERT/UPDATE SQL directly preserves the
    // single-transaction atomicity: if any step fails, the whole
    // batch rolls back.
    let tx = db
        .unchecked_transaction()
        .map_err(|e| BridgeError::Internal(format!("begin transaction: {e}")))?;

    // 1. Create new workspace instances (direct SQL — no nested tx).
    for creation in workspace_creations {
        // Mirrors Store::create_workspace_instance's existence check
        // + INSERT, minus the nested transaction.
        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) > 0 FROM workspace_instances WHERE id = ?1",
                rusqlite::params![creation.id],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if exists {
            return Err(BridgeError::Internal(format!(
                "workspace instance already exists: {}",
                creation.id
            )));
        }
        tx.execute(
                "INSERT INTO workspace_instances \
                 (id, type_key, location_id, name, description, colour, purpose_key, status, last_accessed_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', \
                         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
                rusqlite::params![
                    creation.id,
                    creation.type_key,
                    creation.store_id,
                    creation.name,
                    creation.description.as_deref().unwrap_or(""),
                    creation.colour.as_deref(),
                    creation.purpose_key.as_deref().unwrap_or("general"),
                ],
            )
            .map_err(|e| BridgeError::Internal(format!("create instance {}: {e}", creation.id)))?;
    }

    // 2. Update existing workspace instances (rename only).
    //
    // `update_workspace_instance` uses `self.conn.execute` directly
    // (no nested transaction), so it composes safely inside this tx.
    let tx_store = ctx.store(&tx);
    for update in workspace_updates {
        tx_store.update_workspace_instance(&update.id, &update.name, None, None)?;
        if let Some(purpose_key) = update.purpose_key.as_deref() {
            if purpose_key.trim().is_empty() {
                return Err(BridgeError::Invalid(
                    "workspace purpose_key must not be empty".into(),
                ));
            }
            tx.execute(
                    "UPDATE workspace_instances SET purpose_key = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                    rusqlite::params![update.id, purpose_key],
                )?;
        }
    }

    // 3. Archive workspace instances removed from the canvas.
    //
    // `archive_instance` also uses `self.conn.execute` directly, so
    // it is safe to call within this transaction. A 0-rows-affected
    // archive surfaces as NotFound, which aborts (and rolls back)
    // the whole batch.
    for archive_id in workspace_archives {
        tx_store.archive_instance(archive_id)?;
    }

    tx.commit()
        .map_err(|e| BridgeError::Internal(format!("commit transaction: {e}")))?;
    // db, store, tx, tx_store all drop here when the block ends.

    Ok(())
}
