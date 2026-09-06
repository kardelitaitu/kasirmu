//! Workspace instance queries (ADR #4) — instance listing, access
//! resolution, creation, and admin listing, extracted from
//! `workspaces.rs` (F-011).
//!
//! Split across two `impl Store` blocks: the access-resolution and
//! create/list surface lives here alongside the admin variant of
//! `list_all_instances`.
//!
//! Invariants: ADR #4 resolution chain (role-owner bypass -> explicit
//! user instances -> role types); quota enforcement checks the signed
//! entitlement's allowed_types (C3.2).
use rusqlite::params;

use crate::error::CoreError;
use crate::subscription::TenantSubscription;

use super::Store;
use super::*;

// ── New Instance Queries (ADR #4) ────────────────────────────────────────

impl Store<'_> {
    /// List workspace instances accessible to a given role and user
    /// within a specific store.
    ///
    /// Resolution order (ADR #4 Phase 1):
    /// 1. `role-owner` → all active instances in this store
    /// 2. If `user_id` has `user_workspace_instances` rows → only those
    /// 3. Otherwise → fall back to `role_workspace_types` → instances of
    ///    allowed types in this store
    ///
    /// When `tier` is provided (ADR #5), results are additionally filtered
    /// to only include instances whose `type_key` is allowed by the
    /// subscription tier.
    pub fn list_workspaces(
        &self,
        role_id: &str,
        user_id: Option<&str>,
        store_id: &str,
    ) -> Result<Vec<WorkspaceDto>, CoreError> {
        let results = self.list_workspaces_inner(role_id, user_id, store_id)?;
        Ok(results)
    }

    /// List workspace instances with subscription tier entitlement
    /// filtering (ADR #5).
    ///
    /// Same resolution as `list_workspaces` but additionally filters
    /// out instances whose `type_key` is not allowed by the subscription's
    /// entitlement — the signed payload's `allowed_types_json`, falling
    /// back to the tier's static defaults (C3.2: a Plus + restaurant_starter
    /// bundle lists `kds`, so a bundle subscriber sees its KDS workspace).
    pub fn list_workspaces_with_entitlement(
        &self,
        role_id: &str,
        user_id: Option<&str>,
        store_id: &str,
        sub: &TenantSubscription,
    ) -> Result<Vec<WorkspaceDto>, CoreError> {
        let mut results = self.list_workspaces_inner(role_id, user_id, store_id)?;
        results.retain(|dto| sub.allows_workspace_type(&dto.type_key));
        Ok(results)
    }

    /// Inner resolution without entitlement filtering.
    fn list_workspaces_inner(
        &self,
        role_id: &str,
        user_id: Option<&str>,
        store_id: &str,
    ) -> Result<Vec<WorkspaceDto>, CoreError> {
        // 0. Multi-store enforcement (user_location_access) applies to every role,
        //    not just the owner-bypass roles. If the user has store-access rows
        //    and this store is not among them, fail closed — even staff fallback
        //    resolution (user_workspace_instances or role_workspace_types) must
        //    not leak instances from unassigned stores.
        if let Some(uid) = user_id {
            let has_store_access_rows: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM user_location_access WHERE user_id = ?1",
                params![uid],
                |row| row.get(0),
            )?;

            if has_store_access_rows {
                let store_accessible: bool = self
                    .conn
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM user_location_access WHERE user_id = ?1 AND location_id = ?2",
                        params![uid, store_id],
                        |row| row.get(0),
                    )?;

                if !store_accessible {
                    return Ok(vec![]); // User has no access to this store
                }
            }
        }

        // 1. Owner bypass — all active instances in store.
        //
        // Staff is deliberately NOT in this bypass: it falls through to the
        // explicit `user_workspace_instances` assignment (step 2) and the
        // `role_workspace_types` fallback (step 3), so a staff user only ever
        // sees workspaces assigned to them — never the full store listing.
        if role_id == "role-owner"
            || role_id == "role-admin"
            || role_id == "admin"
            || role_id == "role-manager"
            || role_id == "role-auditor"
            || role_id == "manager"
            || role_id == "auditor"
        {
            return self.list_store_instances(store_id, user_id);
        }

        // 2. Check for explicit user-level instance assignment.
        if let Some(uid) = user_id {
            let instance_ids: Vec<String> = self
                .conn
                .prepare(
                    "SELECT instance_id
                     FROM user_workspace_instances
                     WHERE user_id = ?1",
                )?
                .query_map(params![uid], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();

            if !instance_ids.is_empty() {
                return self.list_instances_by_ids(&instance_ids, store_id, uid);
            }
        }

        // 3. Fall back to role-based type access.
        self.list_store_instances_by_role(role_id, store_id, user_id)
    }

    /// Build the base SELECT/FROM/JOIN for workspace instance DTO queries.
    ///
    /// The returned SQL includes a `LEFT JOIN user_workspace_instances uwi`
    /// with `uwi.user_id = {user_id_param}` — the caller provides the
    /// correct parameter placeholder (e.g. `"?1"`, `"?2"`) based on where
    /// the user ID sits in their parameter array.
    fn instance_dto_sql(user_id_param: &str) -> String {
        format!(
            "SELECT wi.id, wi.type_key, wi.location_id,
                    COALESCE(sp.name, wi.location_id) AS store_name,
                    wi.purpose_key,
                    wi.name, wt.description, wt.icon, wt.layout_mode,
                    COALESCE(wi.colour, wt.accent_colour) AS colour,
                    COALESCE(uwi.is_default, 0) AS is_default
             FROM workspace_instances wi
             JOIN workspace_types wt ON wi.type_key = wt.key
             LEFT JOIN locations sp ON wi.location_id = sp.id
             LEFT JOIN user_workspace_instances uwi
               ON uwi.instance_id = wi.id AND uwi.user_id = {user_id_param}"
        )
    }

    /// Map a row to a WorkspaceDto.
    fn map_instance_dto(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceDto> {
        Ok(WorkspaceDto {
            instance_id: row.get(0)?,
            type_key: row.get(1)?,
            store_id: row.get(2)?,
            store_name: row.get(3)?,
            purpose_key: row.get(4)?,
            name: row.get(5)?,
            description: row.get(6)?,
            icon: row.get(7)?,
            layout_mode: row.get(8)?,
            colour: row.get(9)?,
            is_default: row.get::<_, i32>(10)? != 0,
        })
    }

    /// Get all active instances in a store.
    fn list_store_instances(
        &self,
        store_id: &str,
        user_id: Option<&str>,
    ) -> Result<Vec<WorkspaceDto>, CoreError> {
        let uid = user_id.unwrap_or("");
        let sql = format!(
            "{} WHERE wi.location_id = ?1 AND wi.status = 'active' ORDER BY wt.sort_order, wi.name",
            Self::instance_dto_sql("?2")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![store_id, uid], Self::map_instance_dto)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Get specific instances by IDs, scoped to a store.
    fn list_instances_by_ids(
        &self,
        instance_ids: &[String],
        store_id: &str,
        user_id: &str,
    ) -> Result<Vec<WorkspaceDto>, CoreError> {
        let placeholders: Vec<String> = instance_ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 3))
            .collect();
        // Params: ?1 = user_id, ?2 = store_id, ?3.. = instance_ids
        let sql = format!(
            "{} WHERE wi.id IN ({}) AND wi.location_id = ?2 AND wi.status = 'active' ORDER BY wt.sort_order, wi.name",
            Self::instance_dto_sql("?1"),
            placeholders.join(", ")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        param_values.push(Box::new(user_id.to_string()));
        param_values.push(Box::new(store_id.to_string()));
        for id in instance_ids {
            param_values.push(Box::new(id.clone()));
        }
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), Self::map_instance_dto)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Get instances via role_workspace_types for a given store.
    fn list_store_instances_by_role(
        &self,
        role_id: &str,
        store_id: &str,
        user_id: Option<&str>,
    ) -> Result<Vec<WorkspaceDto>, CoreError> {
        let uid = user_id.unwrap_or("");
        let sql = format!(
            "{} JOIN role_workspace_types rwt ON wt.key = rwt.type_key
             WHERE wi.location_id = ?1 AND rwt.role_id = ?2 AND wi.status = 'active'
             ORDER BY wt.sort_order, wi.name",
            Self::instance_dto_sql("?3")
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![store_id, role_id, uid], Self::map_instance_dto)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Get a single workspace instance by ID.
    ///
    /// When `user_id` is provided, `is_default` is computed from
    /// `user_workspace_instances`. Otherwise it is always `false`.
    pub fn get_workspace_instance(
        &self,
        instance_id: &str,
        user_id: Option<&str>,
    ) -> Result<WorkspaceDto, CoreError> {
        let uid = user_id.unwrap_or("");
        let mut stmt = self.conn.prepare(
            "SELECT wi.id, wi.type_key, wi.location_id,
                    COALESCE(sp.name, wi.location_id) AS store_name,
                    wi.purpose_key,
                    wi.name, wt.description, wt.icon, wt.layout_mode,
                    COALESCE(wi.colour, wt.accent_colour) AS colour,
                    COALESCE((SELECT is_default FROM user_workspace_instances
                              WHERE user_id = ?2 AND instance_id = wi.id), 0) AS is_default
             FROM workspace_instances wi
             JOIN workspace_types wt ON wi.type_key = wt.key
             LEFT JOIN locations sp ON wi.location_id = sp.id
             WHERE wi.id = ?1
               AND wi.status = 'active'",
        )?;
        stmt.query_row(params![instance_id, uid], |row| {
            Ok(WorkspaceDto {
                instance_id: row.get(0)?,
                type_key: row.get(1)?,
                store_id: row.get(2)?,
                store_name: row.get(3)?,
                purpose_key: row.get(4)?,
                name: row.get(5)?,
                description: row.get(6)?,
                icon: row.get(7)?,
                layout_mode: row.get(8)?,
                colour: row.get(9)?,
                is_default: row.get::<_, i32>(10)? != 0,
            })
        })
        .map_err(CoreError::from)
    }

    /// Count active (non-archived, non-suspended) workspace instances
    /// in the given store.
    pub fn count_active_instances(&self, store_id: &str) -> Result<i64, CoreError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM workspace_instances
             WHERE location_id = ?1 AND status NOT IN ('archived', 'quota_suspended')",
            params![store_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Count active POS-register instances (store-pos / restaurant-pos) in
    /// the given store.
    ///
    /// The tier's `max_pos_instances` limit governs POS **registers** only —
    /// kds, warehouse, inventory and admin workspaces are separate
    /// workspace types and must not consume the register budget. The
    /// subscription quota gates (creation + topology Apply) use this count,
    /// never the all-types `count_active_instances`, so a legacy non-POS
    /// instance cannot block legitimate register creation.
    pub fn count_active_pos_instances(&self, store_id: &str) -> Result<i64, CoreError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM workspace_instances
             WHERE location_id = ?1
               AND type_key IN ('store-pos', 'restaurant-pos')
               AND status NOT IN ('archived', 'quota_suspended')",
            params![store_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

impl Store<'_> {
    /// List all workspace instances in a store (admin use, no access control).
    pub fn list_all_instances(
        &self,
        store_id: &str,
    ) -> Result<Vec<WorkspaceInstanceRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, type_key, location_id, name, description, colour, purpose_key, status, created_at, updated_at
             FROM workspace_instances
             WHERE location_id = ?1
             ORDER BY name",
        )?;
        let rows = stmt.query_map(params![store_id], |row| {
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
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    // ── User-Instance Assignment ──────────────────────────────────────

    /// Replace all instance assignments for a user.
    ///
    /// Passing an empty `instance_ids` clears all assignments, causing
    /// the user to fall back to role-based type access.
    pub fn set_user_workspace_instances<'b>(
        &self,
        user_id: &str,
        instance_ids: impl IntoIterator<Item = &'b str>,
        default_instance_id: Option<&str>,
    ) -> Result<(), CoreError> {
        let tx = self.conn.unchecked_transaction()?;

        tx.execute(
            "DELETE FROM user_workspace_instances WHERE user_id = ?1",
            params![user_id],
        )?;

        for id in instance_ids {
            let is_default = if Some(id) == default_instance_id {
                1
            } else {
                0
            };
            tx.execute(
                "INSERT OR IGNORE INTO user_workspace_instances
                 (user_id, instance_id, is_default)
                 VALUES (?1, ?2, ?3)",
                params![user_id, id, is_default],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// Get the explicit instance IDs assigned to a user.
    pub fn get_user_workspace_instance_ids(&self, user_id: &str) -> Result<Vec<String>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT instance_id
             FROM user_workspace_instances
             WHERE user_id = ?1
             ORDER BY instance_id",
        )?;
        let rows = stmt.query_map(params![user_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Verify that a user has access to a specific workspace instance.
    ///
    /// This is the server-side authorization gate `create_session` calls in
    /// both desktop and tablet clients (ADR #4 / ADR #7). It FAILS CLOSED:
    ///
    /// 0. The caller identity is bound to the database — the user must
    ///    exist, be active, and the claimed `role_id` must equal the user's
    ///    actual role. A claimed role is never trusted for the privilege
    ///    checks below; otherwise any caller who knew an owner's user id
    ///    could mint a session as that owner (privilege escalation) in any
    ///    store's active instance (cross-store session minting).
    /// 1. Owner/admin role keys — instance must exist and be active (with
    ///    `user_location_access` check for multi-store mode)
    /// 2. `user_workspace_instances` — direct assignment for this user
    /// 3. `role_workspace_types` — role grants access to the instance's type
    ///
    /// Returns `Ok(true)` if the user may create a session against this
    /// instance, `Ok(false)` if access is denied. Denials (unknown user,
    /// inactive user, forged role, missing instance) all return `Ok(false)`
    /// so the caller surfaces one uniform "no access" error without
    /// revealing which identity records exist.
    pub fn verify_instance_access(
        &self,
        claimed_role_id: &str,
        user_id: &str,
        instance_id: &str,
        store_id: &str,
    ) -> Result<bool, CoreError> {
        // 0. Bind the caller identity to the database. Every later branch
        // uses the REAL role resolved from `users`, never the claim.
        let Some(user) = self.get_user(user_id)? else {
            return Ok(false); // unknown identity — fail closed
        };
        if !user.is_active {
            return Ok(false); // deactivated account — fail closed
        }
        if user.role_id != claimed_role_id {
            return Ok(false); // forged role claim — fail closed
        }
        let role_id = &user.role_id;

        // 0. Multi-store enforcement (user_location_access) applies to every role,
        //    not just the owner-bypass roles. If the user has store-access rows
        //    and this store is not among them, fail closed — staff fallback
        //    resolution must not open a session in an unassigned store.
        let has_store_access: bool = self.conn.query_row(
            "SELECT COUNT(*) > 0 FROM user_location_access WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        )?;
        if has_store_access {
            let store_accessible: bool = self.conn.query_row(
                "SELECT COUNT(*) > 0 FROM user_location_access WHERE user_id = ?1 AND location_id = ?2",
                params![user_id, store_id],
                |row| row.get(0),
            )?;
            if !store_accessible {
                return Ok(false);
            }
        }

        // 1. Owner/admin bypass.
        // Staff is deliberately NOT in this bypass: access resolves through
        // explicit `user_workspace_instances` (step 2) or `role_workspace_types`
        // (step 3) so a staff user can only open assigned workspaces.
        if role_id == "role-owner"
            || role_id == "role-admin"
            || role_id == "admin"
            || role_id == "role-manager"
            || role_id == "role-auditor"
            || role_id == "manager"
            || role_id == "auditor"
        {
            // Instance must exist and be active in this store.
            let exists: bool = self
                .conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM workspace_instances WHERE id = ?1 AND location_id = ?2 AND status = 'active'",
                    params![instance_id, store_id],
                    |row| row.get(0),
                )?;
            return Ok(exists);
        }

        // 2. Check for explicit user-level instance assignment.
        let has_explicit: bool = self
            .conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM user_workspace_instances WHERE user_id = ?1 AND instance_id = ?2",
                params![user_id, instance_id],
                |row| row.get(0),
            )?;

        if has_explicit {
            return Ok(true);
        }

        // 3. Fall back to role-based type access.
        let has_role_access: bool = self.conn.query_row(
            "SELECT COUNT(*) > 0 FROM workspace_instances wi
                 JOIN role_workspace_types rwt ON wi.type_key = rwt.type_key
                 WHERE wi.id = ?1
                   AND wi.location_id = ?2
                   AND wi.status = 'active'
                   AND rwt.role_id = ?3",
            params![instance_id, store_id, role_id],
            |row| row.get(0),
        )?;

        Ok(has_role_access)
    }
}
