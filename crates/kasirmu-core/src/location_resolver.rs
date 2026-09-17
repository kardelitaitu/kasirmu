//! Workspace-binding resolution layer (ADR-19 §4).
/*
last audited 25-07-26 by RSA-Agent (kasirmu-core slice C2: location_resolver deep read)
crate: kasirmu-core | status: SAFE | lint: CLEAN
findings: strict ADR-19 priority tree with split-brain detection in both paths; COR-32 LOW-MED: the 30s TTL LOCATION_CACHE has NO production invalidation caller (invalidate_location_cache is test-only) — a workspace rebind can keep deducting from the OLD location for up to 30s; chain resolver stock read .unwrap_or(0) is fail-closed for display (excludes empty locations); multi_count .unwrap_or(0) degrades to canonical default on DB error (COR-25 family); poisoned-mutex silent miss degrades safely to a DB read
next: call invalidate_location_cache() from binding mutators (COR-32) | perf: cache avoids per-cart-open SELECT
*/
//!
//! When a POS workspace needs to deduct stock on sale, it must know *which
//! inventory location* to deduct from. The resolution layer answers that
//! question via a strict priority tree:
//!
//! | Tier | Source | Field |
//! |------|--------|-------|
//! | 1 | Explicit override (cashier FastPIN) | `explicit_override` arg |
//! | 2 | Single-binding | `workspace_instances.bound_location_id` |
//! | 3 | Multi-binding primary | `workspace_inventory_locations.is_primary = 1` |
//! | 4 | Canonical default | `CANONICAL_DEFAULT_LOCATION_UUID` |
//!
//! Performance optimisation: `resolve_primary_location` is read-heavy (called
//! once per cart-open + possibly per `add_line`), so we cache the result per
//! `workspace_instance_id` with a 30-second TTL. The cache is invalidated on
//! workspace switch to force a fresh SELECT from the database.

use rusqlite::params;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::Instant;

use crate::error::CoreError;
use crate::inventory::{CANONICAL_DEFAULT_LOCATION_UUID, LocationId};
use crate::sale_deduction::LocationStock;
use crate::workspace_type::{STORE_POS, WAREHOUSE};
use tracing;

// ── In-memory cache with 30s TTL ────────────────────────────────────

#[derive(Clone)]
struct CachedLocation {
    location_id: LocationId,
    cached_at: Instant,
}

/// Global cache for resolved primary locations, keyed by `workspace_instance_id`.
/// Entries expire after 30 seconds. Call [`invalidate_location_cache`] to clear
/// the entire cache (e.g. on workspace switch).
static LOCATION_CACHE: LazyLock<Mutex<HashMap<String, CachedLocation>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// TTL for cached location resolutions, in seconds.
const CACHE_TTL_SECS: u64 = 30;

/// Check the in-memory cache for a previously-resolved primary location.
/// Returns `None` on cache miss or if the entry has expired (30s TTL).
fn cache_get(workspace_instance_id: &str) -> Option<LocationId> {
    let cache = LOCATION_CACHE.lock().ok()?;
    if let Some(entry) = cache.get(workspace_instance_id)
        && entry.cached_at.elapsed().as_secs() < CACHE_TTL_SECS
    {
        return Some(entry.location_id.clone());
    }
    None
}

/// Store a resolved primary location in the in-memory cache.
fn cache_set(workspace_instance_id: &str, location_id: &LocationId) {
    if let Ok(mut cache) = LOCATION_CACHE.lock() {
        cache.insert(
            workspace_instance_id.to_owned(),
            CachedLocation {
                location_id: location_id.clone(),
                cached_at: Instant::now(),
            },
        );
    }
}

/// Clear the entire location cache. Called on workspace switch so the next
/// `resolve_primary_location` call performs a fresh database SELECT.
pub fn invalidate_location_cache() {
    if let Ok(mut cache) = LOCATION_CACHE.lock() {
        cache.clear();
    }
}

/// An enriched binding that pairs a location ID with its display name and
/// workspace-specific flags (is_primary, allow_negative_stock).
///
/// Returned by [`get_workspace_locations`] for use in front-end location
/// pickers and sale-deduction flows (ADR-19 §10).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WorkspaceLocationBinding {
    /// Inventory location UUID.
    pub location_id: String,
    /// Human-readable location name (from `inventory_locations.name`).
    pub location_name: String,
    /// Whether this is the primary location for stock deductions.
    pub is_primary: bool,
    /// Whether this location allows negative stock.
    pub allow_negative_stock: bool,
}

/// Return the frozen canonical default location UUID as a [`LocationId`].
///
/// ADR-18 §13-36: this UUID is `01926b3a-0000-7000-8000-000000000001` and
/// matches the seed row in migration 078. All legacy single-location callers
/// resolve here transparently.
#[must_use]
pub fn get_default_location_id() -> LocationId {
    LocationId::from(CANONICAL_DEFAULT_LOCATION_UUID)
}

/// Unified workspace-location resolver (ADR-19 §10).
///
/// Resolves the inventory locations bound to a workspace instance,
/// enriched with display names and binding flags. Behaviour differs
/// by workspace type:
///
/// | `type_key` | Resolution strategy |
/// |------------|----------------------|
/// | `store-pos` | `workspace_inventory_locations` table (multi-binding via `set_workspace_inventory_locations`) |
/// | `warehouse` | `workspace_instances.bound_location_id` (single FK); returns all active locations when NULL (admin view) |
/// | other | Returns empty vec |
///
/// # Errors
///
/// Returns [`CoreError::Validation`] if **both** `bound_location_id` is set
/// AND rows exist in `workspace_inventory_locations` (split-brain config).
/// Returns [`CoreError::NotFound`] if the workspace instance does not exist.
pub fn get_workspace_locations(
    conn: &rusqlite::Connection,
    instance_id: &str,
    type_key: &str,
) -> Result<Vec<WorkspaceLocationBinding>, CoreError> {
    // Verify the instance exists and read its bound_location_id.
    let (bound_location_id,): (Option<String>,) = conn
        .query_row(
            "SELECT bound_location_id FROM workspace_instances WHERE id = ?1",
            params![instance_id],
            |row| Ok((row.get(0)?,)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                entity: "workspace_instance",
                id: instance_id.to_owned(),
            },
            other => CoreError::Db(other),
        })?;

    let has_bound = bound_location_id.as_ref().is_some_and(|b| !b.is_empty());

    // Check for multi-binding rows.
    let multi_rows: Vec<(String, bool, bool)> = {
        let mut stmt = conn
            .prepare(
                "SELECT wil.location_id, wil.is_primary, wil.allow_negative_stock \
                 FROM workspace_inventory_locations wil \
                 WHERE wil.instance_id = ?1 \
                 ORDER BY wil.is_primary DESC, wil.sort_order ASC",
            )
            .map_err(CoreError::Db)?;
        let rows = stmt
            .query_map(params![instance_id], |row| {
                let loc_id: String = row.get(0)?;
                let prim: i64 = row.get(1)?;
                let neg: i64 = row.get(2)?;
                Ok((loc_id, prim == 1, neg == 1))
            })
            .map_err(CoreError::Db)?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r.map_err(CoreError::Db)?);
        }
        ids
    };

    // Split-brain detection.
    if has_bound && !multi_rows.is_empty() {
        return Err(CoreError::Validation {
            field: "workspace_binding",
            message: format!(
                "workspace instance {instance_id} has both bound_location_id \
                 and workspace_inventory_locations rows — split-brain config"
            ),
        });
    }

    match type_key {
        STORE_POS => {
            // Multi-binding via workspace_inventory_locations.
            if multi_rows.is_empty() {
                // No explicit bindings — return canonical default.
                let (name,): (String,) = conn
                    .query_row(
                        "SELECT COALESCE(name, 'Default') FROM inventory_locations WHERE id = ?1",
                        params![CANONICAL_DEFAULT_LOCATION_UUID],
                        |row| Ok((row.get(0)?,)),
                    )
                    .unwrap_or(("Default".into(),));
                return Ok(vec![WorkspaceLocationBinding {
                    location_id: CANONICAL_DEFAULT_LOCATION_UUID.to_owned(),
                    location_name: name,
                    is_primary: true,
                    allow_negative_stock: false,
                }]);
            }
            enrich_bindings(conn, &multi_rows)
        }
        WAREHOUSE => {
            if has_bound {
                // Single-binding via bound_location_id.
                let loc_id = bound_location_id.unwrap_or_else(|| {
                    tracing::error!(
                        "location_resolver: has_bound=true but bound_location_id is None — using default"
                    );
                    CANONICAL_DEFAULT_LOCATION_UUID.to_owned()
                });
                let (name,): (String,) = conn
                    .query_row(
                        "SELECT COALESCE(name, '') FROM inventory_locations WHERE id = ?1",
                        params![loc_id],
                        |row| Ok((row.get(0)?,)),
                    )
                    .unwrap_or((loc_id.clone(),));
                Ok(vec![WorkspaceLocationBinding {
                    location_id: loc_id,
                    location_name: name,
                    is_primary: true,
                    allow_negative_stock: multi_rows
                        .first()
                        .map(|(_, _, neg)| *neg)
                        .unwrap_or(false),
                }])
            } else {
                // Unbound warehouse: return ALL active inventory locations.
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, type FROM inventory_locations \
                         WHERE is_active = 1 \
                         ORDER BY name ASC",
                    )
                    .map_err(CoreError::Db)?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok(WorkspaceLocationBinding {
                            location_id: row.get(0)?,
                            location_name: row.get(1)?,
                            is_primary: false,
                            allow_negative_stock: false,
                        })
                    })
                    .map_err(CoreError::Db)?;
                let mut locs = Vec::new();
                for r in rows {
                    locs.push(r.map_err(CoreError::Db)?);
                }
                Ok(locs)
            }
        }
        _ => {
            // Unknown type: return empty (no location binding concept).
            Ok(vec![])
        }
    }
}

/// Enrich raw workspace_inventory_locations rows with location names from
/// the `inventory_locations` table. This is a helper for [`get_workspace_locations`].
fn enrich_bindings(
    conn: &rusqlite::Connection,
    rows: &[(String, bool, bool)],
) -> Result<Vec<WorkspaceLocationBinding>, CoreError> {
    let mut results = Vec::with_capacity(rows.len());
    for (loc_id, is_primary, allow_negative) in rows {
        let name: String = conn
            .query_row(
                "SELECT COALESCE(name, '') FROM inventory_locations WHERE id = ?1",
                params![loc_id],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| loc_id.clone());
        results.push(WorkspaceLocationBinding {
            location_id: loc_id.clone(),
            location_name: name,
            is_primary: *is_primary,
            allow_negative_stock: *allow_negative,
        });
    }
    Ok(results)
}

/// Resolve the primary deduction location for a workspace instance.
///
/// Returns the first non-None value in priority order:
///   1. `explicit_override` (cashier FastPIN override)
///   2. `workspace_instances.bound_location_id` (single-binding)
///   3. `workspace_inventory_locations.is_primary = 1` (multi-binding)
///   4. Canonical default UUID
///
/// # Errors
///
/// Returns [`CoreError::Validation`] if the workspace has **both** a
/// `bound_location_id` set AND rows in `workspace_inventory_locations`
/// (split-brain — ADR-18 §5). Returns [`CoreError::NotFound`] if
/// `workspace_instance_id` does not exist.
pub fn resolve_primary_location(
    conn: &rusqlite::Connection,
    workspace_instance_id: &str,
    explicit_override: Option<&LocationId>,
) -> Result<LocationId, CoreError> {
    // Tier 1: explicit override from cashier FastPIN.
    if let Some(loc) = explicit_override {
        return Ok(loc.clone());
    }

    // Check the in-memory cache (30s TTL). Only applies to non-override paths
    // because overrides are ephemeral and should not pollute the cache.
    if let Some(cached) = cache_get(workspace_instance_id) {
        return Ok(cached);
    }

    // Verify the workspace instance exists.
    let (bound_location_id,): (Option<String>,) = conn
        .query_row(
            "SELECT bound_location_id FROM workspace_instances WHERE id = ?1",
            params![workspace_instance_id],
            |row| Ok((row.get(0)?,)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                entity: "workspace_instance",
                id: workspace_instance_id.to_owned(),
            },
            other => CoreError::Db(other),
        })?;

    // Tier 2: single-binding.
    if let Some(bound) = bound_location_id.filter(|b| !b.is_empty()) {
        let loc = LocationId::from(bound);
        cache_set(workspace_instance_id, &loc);
        return Ok(loc);
    }

    // Check for multi-binding rows.
    let multi_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workspace_inventory_locations WHERE instance_id = ?1",
            params![workspace_instance_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if multi_count > 0 {
        // Tier 3: multi-binding primary.
        let primary: Option<String> = conn
            .query_row(
                "SELECT location_id FROM workspace_inventory_locations \
                 WHERE instance_id = ?1 AND is_primary = 1 \
                 LIMIT 1",
                params![workspace_instance_id],
                |row| row.get(0),
            )
            .ok();

        if let Some(pid) = primary {
            let loc = LocationId::from(pid);
            cache_set(workspace_instance_id, &loc);
            return Ok(loc);
        }

        // Multi-binding with no explicit primary — fall through to canonical
        // default (the admin hasn't finished configuring; don't hard-error).
    }

    // Tier 4: canonical default.
    let loc = get_default_location_id();
    cache_set(workspace_instance_id, &loc);
    Ok(loc)
}

/// Resolve ALL inventory location bindings for a workspace instance.
///
/// Returns all locations in priority order (primary first, then secondaries
/// sorted by `sort_order`). For single-binding workspaces, returns a
/// one-element vec containing `bound_location_id`. For unbound workspaces,
/// returns a one-element vec containing the canonical default.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] if the workspace has both binding
/// mechanisms active (split-brain). Returns [`CoreError::NotFound`] if
/// the workspace instance does not exist.
pub fn resolve_all_locations(
    conn: &rusqlite::Connection,
    workspace_instance_id: &str,
) -> Result<Vec<LocationId>, CoreError> {
    // Verify workspace exists and read single-binding.
    let (bound_location_id,): (Option<String>,) = conn
        .query_row(
            "SELECT bound_location_id FROM workspace_instances WHERE id = ?1",
            params![workspace_instance_id],
            |row| Ok((row.get(0)?,)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                entity: "workspace_instance",
                id: workspace_instance_id.to_owned(),
            },
            other => CoreError::Db(other),
        })?;

    let has_single = bound_location_id.as_ref().is_some_and(|b| !b.is_empty());

    // Check for multi-binding rows.
    let multi_rows: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT location_id FROM workspace_inventory_locations \
                 WHERE instance_id = ?1 \
                 ORDER BY is_primary DESC, sort_order ASC",
            )
            .map_err(CoreError::Db)?;
        let rows = stmt
            .query_map(params![workspace_instance_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(CoreError::Db)?;
        let mut ids = Vec::new();
        for r in rows {
            ids.push(r.map_err(CoreError::Db)?);
        }
        ids
    };

    // Split-brain detection.
    if has_single && !multi_rows.is_empty() {
        return Err(CoreError::Validation {
            field: "workspace_binding",
            message: format!(
                "workspace instance {workspace_instance_id} has both bound_location_id \
                 and workspace_inventory_locations rows — this is a split-brain \
                 configuration (ADR-18 §5)"
            ),
        });
    }

    if has_single {
        if let Some(bound) = bound_location_id {
            return Ok(vec![LocationId::from(bound)]);
        }
        tracing::error!(
            "location_resolver: has_single=true but bound_location_id is None — using default"
        );
        return Ok(vec![get_default_location_id()]);
    }

    if !multi_rows.is_empty() {
        return Ok(multi_rows.into_iter().map(LocationId::from).collect());
    }

    // Unbound — fall back to canonical default.
    Ok(vec![get_default_location_id()])
}

/// Compute a greedy-fill suggestion across the workspace's bound locations
/// for a given SKU and requested quantity.
///
/// **This function never executes deductions.** It is a read-only computation
/// for the cashier UI to show alternative locations with live stock counts.
/// The caller (typically `crate::db::Store::complete_sale`) uses the
/// returned vec to populate `crate::sale_deduction::Shortfall::alternatives`.
///
/// The greedy-fill algorithm walks locations in priority order (primary first,
/// then secondaries by sort_order) and includes each location's stock up to
/// the requested `qty`. Once `qty` units have been covered, remaining locations
/// are skipped. This prevents showing irrelevant locations when the primary
/// already satisfies the demand.
///
/// Each returned entry carries `qty_available` = the location's full live stock
/// (not just the portion that would be deducted), so the cashier sees the total
/// picture when choosing fallback sources.
pub fn resolve_location_chain_for_sku(
    conn: &rusqlite::Connection,
    workspace_instance_id: &str,
    sku: &str,
    qty: i64,
) -> Result<Vec<LocationStock>, CoreError> {
    let location_ids = resolve_all_locations(conn, workspace_instance_id)?;

    // Resolve product_id from SKU.
    let product_id: String = conn
        .query_row(
            "SELECT id FROM products WHERE sku = ?1",
            params![sku],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound {
                entity: "product",
                id: sku.to_owned(),
            },
            other => CoreError::Db(other),
        })?;

    let mut results = Vec::with_capacity(location_ids.len());
    let mut remaining = qty;

    for loc_id in &location_ids {
        if remaining <= 0 {
            break;
        }

        let avail: i64 = conn
            .query_row(
                "SELECT COALESCE(qty, 0) FROM stock_summary \
                 WHERE item_id = ?1 AND location_id = ?2",
                params![product_id, loc_id.as_str()],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if avail > 0 {
            let name: String = conn
                .query_row(
                    "SELECT name FROM inventory_locations WHERE id = ?1",
                    params![loc_id.as_str()],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| loc_id.as_str().to_owned());

            results.push(LocationStock {
                location_id: loc_id.clone(),
                location_name: name,
                qty_available: avail,
            });

            remaining = remaining.saturating_sub(avail);
        }
    }

    Ok(results)
}

#[cfg(test)]
#[path = "location_resolver_tests.rs"]
mod tests;
