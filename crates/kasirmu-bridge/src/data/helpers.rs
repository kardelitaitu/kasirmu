//! Pure helpers the data-management commands share: path derivation and
//! containment, size rendering, the exportable-settings projection, and the two
//! import batch quota gates.
//!
//! Split out of `data.rs` on 2026-09-27. Deliberately contains NO `pub async fn`
//! and no `tx.execute(` call: `data_tests.rs` holds two source scans over
//! `data.rs` whose floors count exactly those (`the_ungated_twin_has_no_import_
//! `counterpart` needs >= 2 async doors; `import_data_propagates_every_row_write`
//! needs >= 9 propagated writes). Keeping this band free of both is what let it
//! move without touching those scans.
//!
//! Main items: [`exportable_settings_rows`], [`gate_import_product_batch`],
//! [`gate_import_user_batch`].

use std::path::Path;

use kasirmu_core::db::Store;
// `IngestPolicyKind` is the TRAIT that provides `admits()`; importing only the
// `IngestPolicy` enum gives `E0599: no method named adm` — see the settings
// split for the same trap.
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};

use crate::error::BridgeError;

/// Derive the default backup target from the live database path.
///
/// The shell supplies `db_path` (the one AppState value this module cannot
/// reach); the derivation itself — swap the extension for `backup.db` and render
/// it — is the original `default_backup_path` body, unchanged.
pub(super) fn default_backup_path(db_path: &Path) -> String {
    let mut path = db_path.to_path_buf();
    path.set_extension("backup.db");
    path.display().to_string()
}

/// C-1: Reject path traversal — ensure the path does not contain `..`
/// segments that could escape the intended directory boundary.
pub(super) fn validate_contained_path(path: &str) -> Result<(), BridgeError> {
    let p = std::path::Path::new(path);
    for component in p.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(BridgeError::Internal(format!(
                "path traversal rejected: '..' not allowed in '{path}'"
            )));
        }
    }
    Ok(())
}

pub(super) fn human_size(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit_idx = 0;
    while size >= 1024.0 && unit_idx < UNITS.len() - 1 {
        size /= 1024.0;
        unit_idx += 1;
    }
    format!("{:.1} {}", size, UNITS[unit_idx])
}

/// Map settings rows to export JSON, dropping every row the sealed
/// [`IngestPolicy::PortablePackage`] refuses (review MED-2): credential
/// secrets, device-bound identities and lifecycle-manager keys.
///
/// An exported-then-restored backup carrying `local_api.secret` would hand two
/// installs the same signing secret, and one carrying `local_api.enabled` or
/// `lan_server.bind` would flip a manager's persisted intent behind its back.
/// Both answers now come from the ONE policy owned by platform-core and
/// re-exported through `kasirmu_core::settings` — this lane holds no key list and
/// no prefix rule of its own, which is precisely how the GUI and CLI lanes
/// drifted apart before the funnel. Outcome here is unchanged from the
/// bridge-local `is_non_exportable_key` this replaced (that predicate ORed the
/// same two rules); what changes is that there is now one rule to point at.
pub fn exportable_settings_rows(rows: Vec<(String, String)>) -> Vec<serde_json::Value> {
    rows.into_iter()
        .filter(|(key, _)| IngestPolicy::PortablePackage.admits(key))
        .map(|(key, value)| serde_json::json!({ "key": key, "value": value }))
        .collect()
}

/// The batch quota gate for `import_data` (W4-S2), extracted so tests
/// drive the exact production decision.
///
/// Counts the payload rows that will CREATE a product — rows whose SKU is
/// not already in the catalog, mirroring the import loop's keying
/// (existing-SKU rows are updates/merges, not new creations; unparseable
/// rows are skipped by the loop and therefore not counted either) — and
/// refuses via `Store::ensure_quota_allows(Products, tier, n)` when the
/// tier's cap would be exceeded. The tier resolves fail-closed to Free
/// when no subscription row exists. Returns the counted new rows.
///
/// A duplicate NEW SKU appearing twice in one payload is counted twice
/// while the loop would insert it once: overcounting fails closed, never
/// open, which is the safe direction for a statutory quota.
pub fn gate_import_product_batch(
    store: &Store<'_>,
    products: &[serde_json::Value],
) -> Result<i64, BridgeError> {
    let tier = store.resolve_tier_fail_closed()?;
    let new_products = products
        .iter()
        .filter_map(|val| serde_json::from_value::<kasirmu_core::Product>(val.clone()).ok())
        .filter(|product| {
            !store
                .conn()
                .query_row(
                    "SELECT 1 FROM products WHERE sku = ?1",
                    rusqlite::params![product.sku.to_string()],
                    |_| Ok(()),
                )
                .is_ok()
        })
        .count() as i64;
    store
        .ensure_quota_allows(
            kasirmu_core::downgrade::QuotaDimension::Products,
            &tier,
            new_products,
        )
        .map_err(BridgeError::from)?;
    Ok(new_products)
}

/// The users-arm quota gate for `import_data` (W6-A / S2.1), mirroring
/// `gate_import_product_batch` exactly.
///
/// Counts the payload rows that will CREATE a user — rows whose id is not
/// already present, mirroring the import loop's keying — and refuses via
/// `Store::ensure_quota_allows(Staff, tier, n)` when the tier's staff cap
/// would be exceeded. The tier resolves fail-closed to Free when no
/// subscription row exists. Returns the counted new rows.
///
/// A duplicate NEW id appearing twice in one payload is counted twice while
/// the loop would insert it once: overcounting fails closed, never open,
/// which is the safe direction for a statutory quota.
pub fn gate_import_user_batch(
    store: &Store<'_>,
    users: &[serde_json::Value],
) -> Result<i64, BridgeError> {
    let tier = store.resolve_tier_fail_closed()?;
    let new_users = users
        .iter()
        .filter_map(|val| serde_json::from_value::<kasirmu_core::User>(val.clone()).ok())
        .filter(|user| {
            !store
                .conn()
                .query_row(
                    "SELECT 1 FROM users WHERE id = ?1",
                    rusqlite::params![user.id],
                    |_| Ok(()),
                )
                .is_ok()
        })
        .count() as i64;
    store
        .ensure_quota_allows(
            kasirmu_core::downgrade::QuotaDimension::Staff,
            &tier,
            new_users,
        )
        .map_err(BridgeError::from)?;
    Ok(new_users)
}
