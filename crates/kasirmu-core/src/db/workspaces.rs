//! Workspace CRUD — workspace types, instances, navigation screens,
//! per-user instance assignments, role-to-type access, and session resolution.
/*
last audited DD-MM-YY by DSH-Agent
crate: kasirmu-core (workspaces) | status: SAFE | lint: CLEAN
findings: ADR #4 resolution chain well built (role-owner bypass -> explicit user instances -> role types), quota enforcement checks the signed entitlement's allowed_types (C3.2), no-nesting caveat documented per RUST-08 with a pinned test; dynamic SQL interpolates only internal param markers (injection-safe); COR-30 FIXED DD-MM-YY — all access-resolution .unwrap_or(false) sites (workspaces_instances.rs + workspaces_lifecycle.rs) now propagate DB errors via ? — the access gate fails closed instead of failing toward the MORE PERMISSIVE tier on a read error (same family as COR-11/25). hardcoded role-id allowlist (8 variants) is fragile if presets change.
next: none | perf: indexed resolution queries
*/
//!
//! ADR #4 Phase 1: Type/Instance Separation
//!
//! A user's effective workspace set is resolved as:
//! 1. `role-owner` with empty `user_location_access` → all instances in store
//! 2. `user_workspace_instances` rows exist → return ONLY those instances
//! 3. Otherwise → fall back to `role_workspace_types` → instances of allowed types

use rusqlite::params;
use serde::Serialize;

use crate::error::CoreError;
#[cfg(test)]
use crate::subscription::{SubscriptionTier, TenantSubscription};

use super::Store;

// ── Legacy DTOs (backward compatible) ────────────────────────────────────

/// DTO for a workspace type row — matches the old `workspaces` table.
/// Kept for backward compatibility during Phase 1 transition.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceRow {
    /// Unique key identifying the workspace.
    pub key: String,
    /// Human-readable display name.
    pub name: String,
    /// Short description of the workspace purpose.
    pub description: String,
    /// Icon identifier for the workspace card.
    pub icon: String,
}

/// DTO for workspace screen data.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceScreenRow {
    /// Key identifying the screen within a workspace.
    pub screen_key: String,
    /// Display order (ascending).
    pub sort_order: i32,
}

// ── New DTOs (ADR #4) ────────────────────────────────────────────────────

/// DTO for a workspace type (UI template).
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceTypeRow {
    /// Unique key — 'restaurant-pos', 'store-pos', 'kds', 'inventory', 'admin'.
    pub key: String,
    /// Human-readable display name.
    pub name: String,
    /// Short description.
    pub description: String,
    /// Layout hint — 'fullscreen' or 'sidebar'.
    pub layout_mode: String,
    /// Icon identifier.
    pub icon: String,
    /// Display order.
    pub sort_order: i32,
    /// Default accent colour (overridable per instance).
    pub accent_colour: String,
}

/// DTO for a workspace instance row.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInstanceRow {
    /// Instance ID — 'default-restaurant-pos', 'ws-dt-cashier-1', etc.
    pub id: String,
    /// FK to workspace_types.key.
    pub type_key: String,
    /// The store this instance belongs to.
    pub store_id: String,
    /// Display name — 'Downtown - Cashier 1'.
    pub name: String,
    /// Description.
    pub description: String,
    /// Optional per-instance accent colour override.
    pub colour: Option<String>,
    /// Controlled business purpose independent from type and display label.
    pub purpose_key: String,
    /// Instance status — 'active', 'quota_suspended', 'archived'.
    pub status: String,
    /// ISO timestamp.
    pub created_at: String,
    /// ISO timestamp.
    pub updated_at: String,
}

/// Comprehensive workspace DTO sent to the frontend.
///
/// Contains the full resolution chain: store → instance → type.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceDto {
    /// Instance ID.
    pub instance_id: String,
    /// Workspace type key (determines UI component).
    pub type_key: String,
    /// Store ID for data scoping.
    pub store_id: String,
    /// Store display name (from locations).
    pub store_name: String,
    /// Controlled business purpose, independent from type, label, and access policy.
    pub purpose_key: String,
    /// Instance display name.
    pub name: String,
    /// Description (from the type).
    pub description: String,
    /// Icon identifier (from the type).
    pub icon: String,
    /// Layout hint — 'fullscreen' or 'sidebar'.
    pub layout_mode: String,
    /// Accent colour (instance override or type default).
    pub colour: Option<String>,
    /// Whether this is the user's default instance.
    pub is_default: bool,
}

/// Input parameters for [`Store::create_workspace_instance_with_purpose`].
///
/// Bundled into a struct so the creator's signature stays under clippy's
/// `too_many_arguments` threshold as it grows.
#[derive(Debug, Clone)]
pub struct CreateWorkspaceInstanceArgs {
    /// Unique workspace instance id.
    pub id: String,
    /// Technical instance type key (e.g. `store-pos`).
    pub type_key: String,
    /// Owning store profile id.
    pub store_id: String,
    /// Human-readable instance name.
    pub name: String,
    /// Optional free-text description.
    pub description: String,
    /// Optional accent colour.
    pub colour: Option<String>,
    /// Controlled business purpose key, independent from the technical
    /// type and the label (`general` is the neutral default).
    pub purpose_key: String,
}

// ── Legacy Queries (backward compatible) ────────────────────────────────

impl Store<'_> {
    /// List all workspace types (the old `list_all_workspaces`).
    /// Maps old `workspaces` table rows to `WorkspaceRow`.
    pub fn list_all_workspace_types(&self) -> Result<Vec<WorkspaceRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT key, name, description, icon
             FROM workspaces
             ORDER BY name",
        )?;
        let rows = stmt.query_map([], Self::map_workspace_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    fn map_workspace_row(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceRow> {
        Ok(WorkspaceRow {
            key: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            icon: row.get(3)?,
        })
    }

    /// Legacy: list workspaces from old tables.
    /// Resolution order:
    /// 1. `role-owner` → all workspaces
    /// 2. If `user_id` is provided and `user_workspaces` has rows
    ///    → return ONLY those workspaces (replace mode)
    /// 3. Otherwise → fall back to `role_workspaces`
    pub fn list_workspaces_legacy(
        &self,
        role_id: &str,
        user_id: Option<&str>,
    ) -> Result<Vec<WorkspaceRow>, CoreError> {
        if role_id == "role-owner"
            || role_id == "role-admin"
            || role_id == "admin"
            || role_id == "role-manager"
            || role_id == "role-staff"
            || role_id == "role-auditor"
            || role_id == "manager"
            || role_id == "auditor"
        {
            return self.list_all_workspace_types();
        }

        if let Some(uid) = user_id {
            let user_keys: Vec<String> = self
                .conn
                .prepare("SELECT ws_key FROM user_workspaces WHERE user_id = ?1")?
                .query_map(params![uid], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();

            if !user_keys.is_empty() {
                let placeholders: Vec<String> = user_keys
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", i + 1))
                    .collect();
                let sql = format!(
                    "SELECT w.key, w.name, w.description, w.icon
                     FROM workspaces w
                     WHERE w.key IN ({})
                     ORDER BY w.name",
                    placeholders.join(", ")
                );
                let mut stmt = self.conn.prepare(&sql)?;
                let param_refs: Vec<&dyn rusqlite::types::ToSql> = user_keys
                    .iter()
                    .map(|k| k as &dyn rusqlite::types::ToSql)
                    .collect();
                let rows = stmt.query_map(param_refs.as_slice(), Self::map_workspace_row)?;
                return rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from);
            }
        }

        self.list_role_workspaces_legacy(role_id)
    }

    fn list_role_workspaces_legacy(&self, role_id: &str) -> Result<Vec<WorkspaceRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT w.key, w.name, w.description, w.icon
             FROM workspaces w
             JOIN role_workspaces rw ON w.key = rw.workspace_key
             WHERE rw.role_id = ?1
             ORDER BY w.name",
        )?;
        let rows = stmt.query_map(params![role_id], Self::map_workspace_row)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Legacy: get screens for a workspace key (old table).
    pub fn list_workspace_screens_legacy(
        &self,
        workspace_key: &str,
    ) -> Result<Vec<WorkspaceScreenRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT screen_key, sort_order
             FROM workspace_screens
             WHERE workspace_key = ?1
             ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([workspace_key], |row| {
            Ok(WorkspaceScreenRow {
                screen_key: row.get(0)?,
                sort_order: row.get(1)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    // Retired (0048 follow-up): the `set_user_workspaces_legacy` /
    // `get_user_workspace_keys_legacy` write path is gone — the assignment
    // model (ADR #35 D5 / spec 0048) supersedes it, and staff CRUD writes
    // `assignments` + dimension rows in the global identity DB. The old
    // `user_workspaces` table is still READ by the legacy listing above and
    // kept for data compatibility; nothing writes it anymore.
}

// ── New Type Queries (ADR #4) ────────────────────────────────────────────

impl Store<'_> {
    /// List all workspace types from the `workspace_types` table.
    pub fn list_workspace_types(&self) -> Result<Vec<WorkspaceTypeRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT key, name, description, layout_mode, icon, sort_order, accent_colour
             FROM workspace_types
             ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WorkspaceTypeRow {
                key: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                layout_mode: row.get(3)?,
                icon: row.get(4)?,
                sort_order: row.get(5)?,
                accent_colour: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }

    /// Get screens for a workspace type.
    pub fn list_workspace_type_screens(
        &self,
        type_key: &str,
    ) -> Result<Vec<WorkspaceScreenRow>, CoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT screen_key, sort_order
             FROM workspace_type_screens
             WHERE type_key = ?1
             ORDER BY sort_order",
        )?;
        let rows = stmt.query_map([type_key], |row| {
            Ok(WorkspaceScreenRow {
                screen_key: row.get(0)?,
                sort_order: row.get(1)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(CoreError::from)
    }
}

#[path = "workspaces_instances.rs"]
mod workspaces_instances;

#[path = "workspaces_lifecycle.rs"]
mod workspaces_lifecycle;

#[cfg(test)]
#[path = "workspaces_tests.rs"]
mod tests;
