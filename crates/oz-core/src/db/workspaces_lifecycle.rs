//! Workspace instance lifecycle (ADR #4) — subscription-quota
//! enforcement and instance mutation helpers, extracted from
//! `workspaces.rs` (F-011).
//!
//! Invariants: quota enforcement checks the signed entitlement's
//! allowed_types (C3.2); no-nesting caveat documented per RUST-08.
use rusqlite::params;

use crate::error::CoreError;
use crate::subscription::{QuotaError, SubscriptionTier, TenantSubscription};

use super::Store;
use super::*;
impl Store<'_> {
    /// Enforce subscription quota before creating a workspace instance.
    ///
    /// Checks:
    /// 1. Subscription entitlement allows this workspace type — the signed
    ///    payload's `allowed_types_json` (C3.2: a Plus + restaurant_starter
    ///    bundle lists `kds`), falling back to the tier's static defaults
    /// 2. Per-store register count is within the effective tier's limit
    ///
    /// Called by Tauri commands before delegating to `create_workspace_instance`.
    pub fn enforce_instance_quota(
        &self,
        sub: &TenantSubscription,
        type_key: &str,
        store_id: &str,
    ) -> Result<(), CoreError> {
        let effective = sub.effective_tier();
        // 1. Workspace type must be allowed by this subscription's
        //    entitlement (the signed payload's quota block, not just the
        //    static tier defaults).
        if !sub.allows_workspace_type(type_key) {
            return Err(QuotaError::TypeNotAllowed {
                tier: effective.name().into(),
                type_key: type_key.into(),
            }
            .into());
        }

        // 2. Per-store register limit from the effective tier for POS registers,
        //    or warehouse limit for warehouse instances.
        if type_key == "store-pos" || type_key == "restaurant-pos" {
            if let Some(limit) = effective.max_pos_instances() {
                let current = self.count_active_pos_instances(store_id)?;
                if current >= limit {
                    return Err(QuotaError::RegisterLimit {
                        tier: effective.name().into(),
                        limit,
                        current,
                    }
                    .into());
                }
            }
        } else if type_key == "warehouse" {
            if let Some(limit) = effective.max_warehouses() {
                let current = self.count_active_warehouse_instances(store_id)?;
                if current >= limit {
                    return Err(QuotaError::WarehouseLimit {
                        tier: effective.name().into(),
                        limit,
                        current,
                    }
                    .into());
                }
            }
        }

        Ok(())
    }

    /// Create a new workspace instance.
    ///
    /// Returns `CoreError::Conflict` if an instance with the given
    /// ID already exists.
    ///
    /// **Note:** Callers must verify subscription quota via
    /// `enforce_instance_quota()` before calling this method.
    ///
    /// # Nesting caveat
    ///
    /// This method opens its own transaction via `unchecked_transaction`,
    /// which issues a raw `BEGIN`. SQLite rejects `BEGIN` when a
    /// transaction is already open ("cannot start a transaction within a
    /// transaction"), so this method **cannot be called from inside an
    /// open transaction**. Callers that need to batch multiple mutations
    /// atomically must run the INSERT SQL directly on their outer
    /// transaction (see `apply_topology_diff` in desktop-client, which
    /// does exactly this rather than delegating here). See the
    /// `create_workspace_instance_cannot_nest_in_open_transaction` test.
    pub fn create_workspace_instance(
        &self,
        id: &str,
        type_key: &str,
        store_id: &str,
        name: &str,
        description: &str,
        colour: Option<&str>,
    ) -> Result<WorkspaceInstanceRow, CoreError> {
        self.create_workspace_instance_with_purpose(CreateWorkspaceInstanceArgs {
            id: id.to_string(),
            type_key: type_key.to_string(),
            store_id: store_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            colour: colour.map(str::to_string),
            purpose_key: "general".to_string(),
        })
    }

    /// Create a workspace instance with an explicit controlled business purpose.
    ///
    /// `purpose_key` is independent from the technical `type_key`, editable
    /// instance name, and authorization assignments. The legacy creator above
    /// delegates to this method with the neutral `general` purpose.
    pub fn create_workspace_instance_with_purpose(
        &self,
        args: CreateWorkspaceInstanceArgs,
    ) -> Result<WorkspaceInstanceRow, CoreError> {
        let CreateWorkspaceInstanceArgs {
            id,
            type_key,
            store_id,
            name,
            description,
            colour,
            purpose_key,
        } = args;

        if id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "id",
                message: "workspace instance id must not be empty".into(),
            });
        }
        if type_key.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "type_key",
                message: "type_key must not be empty".into(),
            });
        }
        if store_id.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "store_id",
                message: "store_id must not be empty".into(),
            });
        }
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "workspace instance name must not be empty".into(),
            });
        }
        if purpose_key.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "purpose_key",
                message: "workspace instance purpose_key must not be empty".into(),
            });
        }

        let tx = self.conn.unchecked_transaction()?;

        let exists: bool = tx.query_row(
            "SELECT COUNT(*) > 0 FROM workspace_instances WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;

        if exists {
            return Err(CoreError::Conflict {
                entity: "workspace instance",
                field: "id",
            });
        }

        tx.execute(
            "INSERT INTO workspace_instances (id, type_key, location_id, name, description, colour, purpose_key, status, last_accessed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![id, type_key, store_id, name, description, colour, purpose_key],
        )?;

        tx.commit()?;

        let row: WorkspaceInstanceRow = self.conn.query_row(
            "SELECT id, type_key, location_id, name, description, colour, purpose_key, status, created_at, updated_at
             FROM workspace_instances WHERE id = ?1",
            params![id],
            |row| {
                Ok(WorkspaceInstanceRow {
                    id: row.get(0)?,
                    type_key: row.get(1)?,
                    store_id: row.get(2)?,
                    name: row.get(3)?,
                    description: row.get(4)?,
                    colour: row.get(5)?,
                    purpose_key: row.get(6)?,
                    status: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )?;

        Ok(row)
    }

    /// Touch `last_accessed_at` for a workspace instance (ADR #5).
    ///
    /// Called during session resolution to track most-recently-used
    /// ordering for automatic quota recovery.
    pub fn touch_instance_access(&self, instance_id: &str) -> Result<(), CoreError> {
        self.conn.execute(
            "UPDATE workspace_instances
             SET last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![instance_id],
        )?;
        Ok(())
    }

    /// Restore `QuotaSuspended` instances to `Active` up to the tier's
    /// per-store limit (ADR #5 Phase 3b).
    ///
    /// Called when a tier is upgraded — the new tier allows more
    /// registers per store. Instances are restored in most-recently-used
    /// order (`last_accessed_at DESC`). Already-`Active` instances count
    /// toward the limit. Returns the count of restored instances.
    ///
    /// Wrapped in a transaction to prevent race conditions between the
    /// SELECT count and UPDATE.
    pub fn auto_recover_instances(
        &self,
        store_id: &str,
        tier: &SubscriptionTier,
    ) -> Result<usize, CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        let limit = match tier.max_pos_instances() {
            Some(n) => n,
            None => {
                // Unlimited — restore ALL QuotaSuspended instances.
                let updated = tx.execute(
                    "UPDATE workspace_instances
                     SET status = 'active',
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE location_id = ?1 AND status = 'quota_suspended'",
                    params![store_id],
                )?;
                tx.commit()?;
                if updated > 0 {
                    tracing::info!(
                        store_id = %store_id,
                        restored = %updated,
                        "unlimited tier — all suspended instances restored"
                    );
                }
                return Ok(updated);
            }
        };

        // Count already-active instances (they count toward the limit).
        let active_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM workspace_instances
             WHERE location_id = ?1 AND status = 'active'",
            params![store_id],
            |row| row.get(0),
        )?;

        let slots_available = (limit - active_count).max(0);
        if slots_available == 0 {
            tx.commit()?;
            return Ok(0);
        }

        // Restore the most-recently-used suspended instances.
        let updated = tx.execute(
            "UPDATE workspace_instances
             SET status = 'active',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id IN (
                 SELECT id FROM workspace_instances
                 WHERE location_id = ?1 AND status = 'quota_suspended'
                 ORDER BY last_accessed_at DESC
                 LIMIT ?2
             )",
            params![store_id, slots_available],
        )?;

        tx.commit()?;

        if updated > 0 {
            tracing::info!(
                store_id = %store_id,
                restored = %updated,
                active = %active_count,
                limit = %limit,
                "suspended instances restored after tier upgrade"
            );
        }

        Ok(updated)
    }

    /// Suspend surplus `Active` instances when a tier is downgraded
    /// (ADR #5 Phase 3c).
    ///
    /// If the store has more active instances than the tier allows,
    /// the least-recently-used instances are transitioned to
    /// `QuotaSuspended`. Returns the count of suspended instances.
    ///
    /// Wrapped in a transaction to prevent race conditions between the
    /// SELECT count and UPDATE.
    pub fn suspend_surplus_instances(
        &self,
        store_id: &str,
        tier: &SubscriptionTier,
    ) -> Result<usize, CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        let limit = match tier.max_pos_instances() {
            Some(n) => n,
            None => {
                tx.commit()?;
                return Ok(0); // Unlimited — nothing to suspend
            }
        };

        let active_count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM workspace_instances
             WHERE location_id = ?1 AND status = 'active'",
            params![store_id],
            |row| row.get(0),
        )?;

        let surplus = (active_count - limit).max(0);
        if surplus == 0 {
            tx.commit()?;
            return Ok(0);
        }

        // Suspend the least-recently-used active instances.
        let updated = tx.execute(
            "UPDATE workspace_instances
             SET status = 'quota_suspended',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id IN (
                 SELECT id FROM workspace_instances
                 WHERE location_id = ?1 AND status = 'active'
                 ORDER BY last_accessed_at ASC
                 LIMIT ?2
             )",
            params![store_id, surplus],
        )?;

        tx.commit()?;

        if updated > 0 {
            tracing::info!(
                store_id = %store_id,
                suspended = %updated,
                active_before = %active_count,
                limit = %limit,
                "surplus instances suspended after tier downgrade"
            );
        }

        Ok(updated)
    }

    /// Archive a workspace instance by setting its status to `'archived'`.
    ///
    /// Archived instances are excluded from `list_workspaces` and do not
    /// count toward the active instance quota. Returns
    /// `CoreError::NotFound` if the instance does not exist.
    pub fn archive_instance(&self, instance_id: &str) -> Result<(), CoreError> {
        let affected = self.conn.execute(
            "UPDATE workspace_instances
             SET status = 'archived',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![instance_id],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "workspace instance",
                id: instance_id.to_owned(),
            });
        }
        Ok(())
    }

    /// Update the editable fields of a workspace instance.
    ///
    /// Performs a partial update: `name` is always set, while `description`
    /// and `colour` are only updated when `Some(..)` is supplied. Passing
    /// `None` leaves the existing column value unchanged (COALESCE), so a
    /// caller that only knows the new name will not clobber other fields.
    /// The instance `type_key` and `store_id` are immutable and cannot be
    /// changed here. Returns [`CoreError::NotFound`] when no instance with
    /// the given `id` exists.
    ///
    /// Note: to intentionally clear a colour, callers must go through a
    /// dedicated path — `None` here is "leave as-is", not "clear".
    pub fn update_workspace_instance(
        &self,
        instance_id: &str,
        name: &str,
        description: Option<&str>,
        colour: Option<&str>,
    ) -> Result<(), CoreError> {
        if name.trim().is_empty() {
            return Err(CoreError::Validation {
                field: "name",
                message: "workspace instance name must not be empty".into(),
            });
        }

        let affected = self.conn.execute(
            "UPDATE workspace_instances
             SET name = ?2,
                 description = COALESCE(?3, description),
                 colour = COALESCE(?4, colour),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![instance_id, name, description, colour],
        )?;
        if affected == 0 {
            return Err(CoreError::NotFound {
                entity: "workspace instance",
                id: instance_id.to_owned(),
            });
        }
        Ok(())
    }
}
