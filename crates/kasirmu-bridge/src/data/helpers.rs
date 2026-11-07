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
//! [`gate_import_user_batch`], and `export_date_window` (module-private).

use std::path::Path;

use chrono::NaiveDate;

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

/// The inclusive day window an export may be restricted to (BR-C3).
///
/// Both ends are `NaiveDate`s, not the caller's strings, so the comparison in
/// [`created_at_in_window`] can never quietly compare a calendar day against a
/// full timestamp: the parse happens once, at the boundary, and a bad bound is
/// REFUSED there rather than discovered per row.
#[derive(Debug)]
pub(super) struct ExportDateWindow {
    /// Earliest day kept, inclusive. `None` leaves the start unbounded.
    pub(super) from: Option<NaiveDate>,
    /// Latest day kept, inclusive. `None` leaves the end unbounded.
    pub(super) to: Option<NaiveDate>,
}

/// The only accepted bound shape. `Sales.created_at` is stored as RFC-3339
/// text whose first ten characters are exactly this, which is what makes the
/// prefix compare in [`created_at_in_window`] a date compare.
const EXPORT_DATE_FORM: &str = "%Y-%m-%d";

/// Build the optional export window from the two wire arguments.
///
/// Returns `Ok(None)` when neither bound is present, so an ordinary export takes
/// exactly the path it took before this window existed. Any present bound must
/// parse as `YYYY-MM-DD`; a malformed one is an `Invalid` error rather than a
/// silently dropped filter, because "ignore the bound I cannot read" is the
/// defect this window closes. An inverted window is refused too — it can only
/// produce an empty package while the caller believes it asked for a slice.
pub(super) fn export_date_window(
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Option<ExportDateWindow>, BridgeError> {
    if from.is_none() && to.is_none() {
        return Ok(None);
    }
    let parse = |raw: &str, field: &str| -> Result<NaiveDate, BridgeError> {
        NaiveDate::parse_from_str(raw.trim(), EXPORT_DATE_FORM).map_err(|_| {
            BridgeError::Invalid(format!(
                "{field} must be a calendar date in YYYY-MM-DD form, got {raw:?}"
            ))
        })
    };
    let from = from.map(|raw| parse(raw, "date_from")).transpose()?;
    let to = to.map(|raw| parse(raw, "date_to")).transpose()?;
    if let (Some(start), Some(end)) = (from, to)
        && start > end
    {
        return Err(BridgeError::Invalid(format!(
            "date_from ({start}) is after date_to ({end}), so the export window is empty"
        )));
    }
    Ok(Some(ExportDateWindow { from, to }))
}

/// Does a sale's `created_at` fall inside `window`?
///
/// `created_at` is RFC-3339 text (`2026-01-15T10:23:45Z`), so its first ten
/// characters are the calendar day and comparing that prefix as a day is exact —
/// no timezone arithmetic, and no assumption that the caller's bound carries a
/// time of day. Both ends are INCLUSIVE: `date_to` names the last day kept, which
/// is what a merchant reading "to 31 January" expects; a naive string compare
/// would instead drop every sale on that day.
///
/// A timestamp too short to carry a day is KEPT. That is the conservative
/// direction on purpose: this filter's failure mode is an export that quietly
/// omits rows, and a row the operator can see in the package is a bug report, one
/// that never arrived is not.
pub(super) fn created_at_in_window(created_at: &str, window: &ExportDateWindow) -> bool {
    if window.from.is_none() && window.to.is_none() {
        return true;
    }
    let day = created_at
        .get(..10)
        .and_then(|prefix| NaiveDate::parse_from_str(prefix, EXPORT_DATE_FORM).ok());
    let Some(day) = day else {
        return true;
    };
    window.from.is_none_or(|start| day >= start) && window.to.is_none_or(|end| day <= end)
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
    let mut existing_skus = std::collections::HashSet::new();
    {
        let mut stmt = store
            .conn()
            .prepare_cached("SELECT sku FROM products")
            .map_err(|e| BridgeError::Internal(format!("loading existing skus: {e}")))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| BridgeError::Internal(format!("querying existing skus: {e}")))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| BridgeError::Internal(format!("reading existing sku: {e}")))?
        {
            existing_skus.insert(row.get::<_, String>(0)?);
        }
    }
    let new_products = products
        .iter()
        .filter_map(|val| serde_json::from_value::<kasirmu_core::Product>(val.clone()).ok())
        .filter(|product| !existing_skus.contains(product.sku.as_str()))
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
    let mut existing_users = std::collections::HashSet::new();
    {
        let mut stmt = store
            .conn()
            .prepare_cached("SELECT id FROM users")
            .map_err(|e| BridgeError::Internal(format!("loading existing users: {e}")))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| BridgeError::Internal(format!("querying existing users: {e}")))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| BridgeError::Internal(format!("reading existing user id: {e}")))?
        {
            existing_users.insert(row.get::<_, String>(0)?);
        }
    }
    let new_users = users
        .iter()
        .filter_map(|val| serde_json::from_value::<kasirmu_core::User>(val.clone()).ok())
        .filter(|user| !existing_users.contains(&user.id))
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
