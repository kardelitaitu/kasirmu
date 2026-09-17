//! Data-management command bodies (Wave F): backup, restore, .kasirpkg export
//! and .kasirpkg import — the tauri-free half of
//! apps/desktop-client/src/commands/data.rs.
//!
//! Key items: the eight wire DTOs, the two quota batch gates
//! (gate_import_product_batch, gate_import_user_batch), the settings redaction
//! rule (exportable_settings_rows), the path-traversal guard
//! (validate_contained_path) and the seven command bodies.
//!
//! Every body is a verbatim port. Filesystem calls stay as written (std::fs on
//! IPC-supplied paths is headless-safe). The only value the shell still supplies
//! is the live database path: default_backup_path derives the backup target from
//! it, so each path-taking command receives `db_path: &Path` from its shim,
//! mirroring the settings-lane precedent. Gate kind and order, the pre-transaction
//! position of both quota gates, the single unchecked_transaction boundary, the
//! settings redaction on both arms and every error string are unchanged.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use kasirmu_core::db::Store;
use kasirmu_core::kasirpkg::{export_kasirpkg, import_kasirpkg};
use kasirmu_core::permissions;
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── DTOs ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
/// Backupstatus.
pub struct BackupStatus {
    /// Last Backup.
    pub last_backup: Option<String>,
    /// Last Backup Size.
    pub last_backup_size: Option<String>,
    // Db Path intentionally omitted — leaks the filesystem path to
    // any IPC caller (M-7: never expose db_path in unauth'd DTOs).
}

#[derive(Debug, Serialize)]
/// Backupresult.
pub struct BackupResult {
    /// Path.
    pub path: String,
    /// Size Bytes.
    pub size_bytes: u64,
}

#[derive(Debug, Deserialize)]
/// Exportdataargs.
pub struct ExportDataArgs {
    /// Types.
    pub types: Vec<String>,
    /// Password.
    pub password: String,
    /// Output Path.
    pub output_path: String,
    /// Date From.
    pub date_from: Option<String>,
    /// Date To.
    pub date_to: Option<String>,
}

#[derive(Debug, Serialize)]
/// Exportdataresult.
pub struct ExportDataResult {
    /// Path.
    pub path: String,
    /// Size Bytes.
    pub size_bytes: u64,
    /// Types.
    pub types: Vec<String>,
}

#[derive(Debug, Deserialize)]
/// Importpreviewargs.
pub struct ImportPreviewArgs {
    /// File Path.
    pub file_path: String,
    /// Password.
    pub password: String,
}

#[derive(Debug, Serialize)]
/// Importpreviewresult.
pub struct ImportPreviewResult {
    /// Store Name.
    pub store_name: String,
    /// App Version.
    pub app_version: String,
    /// ISO-8601 creation timestamp.
    pub created_at: String,
    /// Types.
    pub types: Vec<String>,
    /// Product Count.
    pub product_count: usize,
    /// Category Count.
    pub category_count: usize,
    /// Sale Count.
    pub sale_count: Option<usize>,
    /// Customer Count.
    pub customer_count: Option<usize>,
    /// User Count.
    pub user_count: Option<usize>,
    /// Setting Count.
    pub setting_count: Option<usize>,
}

#[derive(Debug, Deserialize)]
/// Importdataargs.
pub struct ImportDataArgs {
    /// File Path.
    pub file_path: String,
    /// Password.
    pub password: String,
}

#[derive(Debug, Serialize)]
/// Importdataresult.
pub struct ImportDataResult {
    /// Products Imported.
    pub products_imported: usize,
    /// Categories Imported.
    pub categories_imported: usize,
    /// Sales Imported.
    pub sales_imported: usize,
    /// Customers Imported.
    pub customers_imported: usize,
    /// Users Imported.
    pub users_imported: usize,
    /// Settings Imported.
    pub settings_imported: usize,
}

// ── Helpers ───────────────────────────────────────────────────────

/// Derive the default backup target from the live database path.
///
/// The shell supplies `db_path` (the one AppState value this module cannot
/// reach); the derivation itself — swap the extension for `backup.db` and render
/// it — is the original `default_backup_path` body, unchanged.
fn default_backup_path(db_path: &Path) -> String {
    let mut path = db_path.to_path_buf();
    path.set_extension("backup.db");
    path.display().to_string()
}

/// C-1: Reject path traversal — ensure the path does not contain `..`
/// segments that could escape the intended directory boundary.
fn validate_contained_path(path: &str) -> Result<(), BridgeError> {
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

fn human_size(bytes: u64) -> String {
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

// ── Commands ──────────────────────────────────────────────────────

/// Get backup status — UNGATED entry point.
///
/// The shell passes the live database path; the backup target is derived here.
///
/// This command takes no session token, so there is no identity to check and
/// permissions::DATA_EXPORT is not enforced here at all. That is a live path, not
/// a theoretical one: see the reachability note in
/// the data-management screen. One structured event is
/// emitted per ungated call, so a bypass that cannot be closed quietly is at least
/// visible to whoever reads a log. The event carries the operation name and nothing
/// else: no value, no backup path, no token.
pub async fn get_backup_status(db_path: &Path) -> Result<BackupStatus, BridgeError> {
    tracing::warn!(
        event = "backup_ungated_no_session",
        operation = "get_backup_status",
        skipped_permission = permissions::DATA_EXPORT,
        "served backup status with no session identity presented: this command takes no token, so the permission was not checked"
    );
    backup_status_direct(db_path).await
}

/// The body of get_backup_status, without the warning.
///
/// Private on purpose, and this is what makes the event count trustworthy:
/// get_backup_status_scoped calls THIS helper, so a call that did present a
/// session and did enforce the permission never emits backup_ungated_no_session.
/// Nothing outside this file can reach the un-warned path.
async fn backup_status_direct(db_path: &Path) -> Result<BackupStatus, BridgeError> {
    let backup_path = default_backup_path(db_path);
    let (last_backup, last_backup_size) = match std::fs::metadata(&backup_path) {
        Ok(meta) => {
            let modified = meta.modified().ok().map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            });
            let size = Some(human_size(meta.len()));
            (modified, size)
        }
        Err(_) => (None, None),
    };
    Ok(BackupStatus {
        last_backup,
        last_backup_size,
    })
}

/// Create backup — UNGATED entry point.
///
/// Writes a full copy of the database to disk and, unlike
/// create_backup_scoped, checks no permission whatsoever: no token is presented,
/// so there is no identity to authorize. Reachable today from the Data screen
/// with no workspace session; see the note in
/// the data-management screen. One event per ungated call,
/// carrying the operation name only and never the backup path.
pub async fn create_backup(
    ctx: &BridgeCtx<'_>,
    db_path: &Path,
) -> Result<BackupResult, BridgeError> {
    tracing::warn!(
        event = "backup_ungated_no_session",
        operation = "create_backup",
        skipped_permission = permissions::DATA_EXPORT,
        "ran a full database backup with no session identity presented: this command takes no token, so the permission was not checked"
    );
    create_backup_direct(ctx, db_path).await
}

/// The body of create_backup, without the warning. Private for the same reason as
/// backup_status_direct: only the gated twin can reach it without emitting the
/// event.
async fn create_backup_direct(
    ctx: &BridgeCtx<'_>,
    db_path: &Path,
) -> Result<BackupResult, BridgeError> {
    let output = default_backup_path(db_path);
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    store.backup(&output)?;
    let size_bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    Ok(BackupResult {
        path: output,
        size_bytes,
    })
}

/// Export data.
pub async fn export_data(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ExportDataArgs,
) -> Result<ExportDataResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;
    // C-1: Contain output path — reject path traversal.
    validate_contained_path(&args.output_path)?;
    use kasirmu_core::kasirpkg::KasirpkgPayload;

    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);

    let all_types = args.types.is_empty() || args.types.iter().any(|t| t == "all");
    let wants = |name: &str| all_types || args.types.iter().any(|t| t == name);

    let products = if wants("products") {
        let prods = store.list_products()?;
        serde_json::to_value(&prods)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    } else {
        vec![]
    };

    let categories = if wants("categories") {
        let cats = store.list_categories()?;
        serde_json::to_value(&cats)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    } else {
        vec![]
    };

    let sales = if wants("sales") {
        let sales_list = store.list_sales()?;
        Some(
            serde_json::to_value(&sales_list)
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default(),
        )
    } else {
        None
    };

    let customers = if wants("customers") {
        let custs = store.list_customers()?;
        Some(
            serde_json::to_value(&custs)
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default(),
        )
    } else {
        None
    };

    let users = if wants("users") {
        let usrs = store.list_users()?;
        Some(
            serde_json::to_value(&usrs)
                .ok()
                .and_then(|v| v.as_array().cloned())
                .unwrap_or_default(),
        )
    } else {
        None
    };

    let settings = if wants("settings") {
        // Egress reads through the funnelled accessor, NOT through
        // `Settings::load_all`: `load_all` stays deliberately UNFILTERED
        // because `load_features` / `prune_stale_features` read through it,
        // so an egress that assumes it is portable leaks every guarded row.
        // `load_exportable` is `load_all` filtered by
        // [`IngestPolicy::PortablePackage`]; the mapping below is then
        // idempotent, and it still filters on its own because this helper is
        // public surface driven directly by tests.
        let rows = platform_core::settings::Settings::load_exportable(&conn)?;
        Some(exportable_settings_rows(rows))
    } else {
        None
    };

    let mut data_types: Vec<String> = Vec::new();
    if wants("products") {
        data_types.push("products".into());
    }
    if wants("categories") {
        data_types.push("categories".into());
    }
    if wants("sales") {
        data_types.push("sales".into());
    }
    if wants("customers") {
        data_types.push("customers".into());
    }
    if wants("users") {
        data_types.push("users".into());
    }
    if wants("settings") {
        data_types.push("settings".into());
    }

    let payload = KasirpkgPayload {
        products,
        categories,
        sales,
        customers,
        users,
        settings,
    };

    let store_name = store
        .get_store_name()?
        .unwrap_or_else(|| "OZ-POS Store".into());

    let features: HashMap<String, String> = store
        .load_features()
        .map(|reg| reg.to_settings_rows().into_iter().collect())
        .unwrap_or_default();

    let data_types_for_result = data_types.clone();
    let kasirpkg_bytes = export_kasirpkg(
        &args.password,
        &store_name,
        "0.0.1",
        data_types,
        features,
        &payload,
    )?;

    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&args.output_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| BridgeError::Internal(format!("creating directory: {e}")))?;
    }

    std::fs::write(&args.output_path, &kasirpkg_bytes)
        .map_err(|e| BridgeError::Internal(format!("writing export file: {e}")))?;

    let size_bytes = kasirpkg_bytes.len() as u64;
    Ok(ExportDataResult {
        path: args.output_path,
        size_bytes,
        types: data_types_for_result,
    })
}

/// Import preview.
pub async fn import_preview(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ImportPreviewArgs,
) -> Result<ImportPreviewResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;
    // C-1: Contain input path — reject path traversal.
    validate_contained_path(&args.file_path)?;
    let data = std::fs::read(&args.file_path)
        .map_err(|e| BridgeError::Internal(format!("reading file: {e}")))?;
    let (header, payload) = import_kasirpkg(&data, &args.password)?;

    Ok(ImportPreviewResult {
        store_name: header.store_name,
        app_version: header.app_version,
        created_at: header.created_at,
        types: header.data_types,
        product_count: payload.products.len(),
        category_count: payload.categories.len(),
        sale_count: payload.sales.as_ref().map(|s| s.len()),
        customer_count: payload.customers.as_ref().map(|c| c.len()),
        user_count: payload.users.as_ref().map(|u| u.len()),
        setting_count: payload.settings.as_ref().map(|s| s.len()),
    })
}

/// Import data.
pub async fn import_data(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ImportDataArgs,
) -> Result<ImportDataResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;
    // C-1: Contain input path — reject path traversal.
    validate_contained_path(&args.file_path)?;
    let data = std::fs::read(&args.file_path)
        .map_err(|e| BridgeError::Internal(format!("reading file: {e}")))?;
    let (_header, payload) = import_kasirpkg(&data, &args.password)?;

    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);

    // W4-S2: close the batch door — refuse the whole import BEFORE the
    // transaction opens when it would push the catalog past the tier's
    // product cap (a rejected import writes nothing; nothing is
    // partially gated).
    gate_import_product_batch(&store, &payload.products)?;
    // W6-A / S2.1: the users arm rides the same pre-tx batch gate (the
    // Staff dimension is tenant-global like Products). The customers and
    // sales arms stay un-gated BY RULING: QuotaDimension has no Customers
    // or Sales/Transactions variant, and inventing a cap is a schema +
    // entitlements change reserved for the owner — recorded as the S2.1
    // residue, not papered over here.
    gate_import_user_batch(&store, payload.users.as_deref().unwrap_or(&[]))?;

    // Use a transaction for atomic import
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| BridgeError::Internal(format!("starting transaction: {e}")))?;

    let mut products_imported = 0;
    for val in &payload.products {
        if let Ok(product) = serde_json::from_value::<kasirmu_core::Product>(val.clone()) {
            let exists = tx
                .query_row(
                    "SELECT 1 FROM products WHERE sku = ?1",
                    rusqlite::params![product.sku.to_string()],
                    |_| Ok(()),
                )
                .is_ok();
            if exists {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let cur_str = std::str::from_utf8(&product.price.currency.0)
                    .map_err(|e| BridgeError::Internal(format!("invalid currency: {e}")))?;
                tx.execute(
                    "UPDATE products SET name = ?1, price_minor = ?2, currency = ?3, category_id = ?4, barcode = ?5, updated_at = ?6 WHERE sku = ?7",
                    rusqlite::params![product.name, product.price.minor_units, cur_str, product.category_id, product.barcode.as_ref().map(|b| b.as_str()), now, product.sku.to_string()],
                )?;
            } else {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let cur_str = std::str::from_utf8(&product.price.currency.0)
                    .map_err(|e| BridgeError::Internal(format!("invalid currency: {e}")))?;
                tx.execute(
                    "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![product.id, product.sku.to_string(), product.name, product.price.minor_units, cur_str, product.category_id, product.barcode.as_ref().map(|b| b.as_str()), now, now],
                )?;
            }
            products_imported += 1;
        }
    }

    let mut categories_imported = 0;
    for val in &payload.categories {
        if let Ok(cat) = serde_json::from_value::<kasirmu_core::Category>(val.clone()) {
            let colour = if cat.colour.is_empty() {
                "#6366f1"
            } else {
                &cat.colour
            };
            let exists = store
                .conn()
                .query_row(
                    "SELECT 1 FROM categories WHERE id = ?1",
                    rusqlite::params![cat.id],
                    |_| Ok(()),
                )
                .is_ok();
            if !exists {
                let _ = tx.execute(
                    "INSERT INTO categories (id, name, colour, icon) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![cat.id, cat.name, colour, ""],
                );
            } else {
                let _ = tx.execute(
                    "UPDATE categories SET name = ?1, colour = ?2, icon = '' WHERE id = ?3",
                    rusqlite::params![cat.name, colour, cat.id],
                );
            }
            categories_imported += 1;
        }
    }

    let mut sales_imported = 0;
    if let Some(ref sales) = payload.sales {
        for val in sales {
            if let Ok(sale) = serde_json::from_value::<kasirmu_core::Sale>(val.clone()) {
                let exists = store
                    .conn()
                    .query_row(
                        "SELECT 1 FROM sales WHERE id = ?1",
                        rusqlite::params![sale.id],
                        |_| Ok(()),
                    )
                    .is_ok();
                if !exists {
                    // RUST-08: use the tx-aware variant — `store.create_sale`
                    // would open a nested transaction on the same connection
                    // ("cannot start a transaction within a transaction") and
                    // roll the whole import back (same fix as CLI-1).
                    store.create_sale_in_tx(&tx, &sale)?;
                }
                sales_imported += 1;
            }
        }
    }

    let mut customers_imported = 0;
    if let Some(ref customers) = payload.customers {
        for val in customers {
            if let Ok(cust) = serde_json::from_value::<kasirmu_core::Customer>(val.clone()) {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let exists = store
                    .conn()
                    .query_row(
                        "SELECT 1 FROM customers WHERE id = ?1",
                        rusqlite::params![cust.id],
                        |_| Ok(()),
                    )
                    .is_ok();
                let email_str = cust.email.map(|e| e.to_string());
                let phone_str = cust.phone.map(|p| p.to_string());
                if exists {
                    let _ = tx.execute(
                        "UPDATE customers SET name = ?1, email = ?2, phone = ?3, notes = ?4, updated_at = ?5 WHERE id = ?6",
                        rusqlite::params![cust.name, email_str, phone_str, cust.notes, now, cust.id],
                    );
                } else {
                    let _ = tx.execute(
                        "INSERT INTO customers (id, name, email, phone, notes, loyalty_points, total_spent_minor, currency, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![cust.id, cust.name, email_str, phone_str, cust.notes, 0i64, 0i64, "USD", now, now],
                    );
                }
                customers_imported += 1;
            }
        }
    }

    let mut users_imported = 0;
    if let Some(ref users) = payload.users {
        for val in users {
            if let Ok(user) = serde_json::from_value::<kasirmu_core::User>(val.clone()) {
                let exists = store
                    .conn()
                    .query_row(
                        "SELECT 1 FROM users WHERE id = ?1",
                        rusqlite::params![user.id],
                        |_| Ok(()),
                    )
                    .is_ok();
                if exists {
                    let _ = tx.execute(
                        "UPDATE users SET username = ?1, display_name = ?2, role_id = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?6",
                        rusqlite::params![user.username, user.display_name, user.role_id, user.is_active, chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), user.id],
                    );
                } else {
                    // Users from export have no PIN hash; mark as inactive so they must be re-invited
                    let _ = tx.execute(
                        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
                        rusqlite::params![user.id, user.username, "", user.display_name, user.role_id, chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)],
                    );
                }
                users_imported += 1;
            }
        }
    }

    // Ingress is the mirror of the egress above and goes through the SAME
    // sealed policy via the funnelled accessor, never through a raw
    // `Settings::set`: a package written by an older build, hand-edited, or
    // built by whoever knows the shared password must not be able to plant
    // `machine_id` or a credential in this install.
    //
    // `set_with_policy` answers with THREE distinct outcomes and they are not
    // collapsed here: `Ok(false)` is a REFUSAL (nothing was written, the
    // accessor already warned with key + policy and never the value, the batch
    // continues), `Err` is a real SQL failure and aborts the import, and only
    // `Ok(true)` counts as imported.
    let mut settings_imported = 0;
    let mut settings_refused = 0;
    if let Some(ref settings) = payload.settings {
        for val in settings {
            if let Some(key) = val.get("key").and_then(|v| v.as_str())
                && let Some(value) = val.get("value").and_then(|v| v.as_str())
            {
                match platform_core::settings::Settings::set_with_policy(
                    &tx,
                    key,
                    value,
                    IngestPolicy::PortablePackage,
                )? {
                    true => settings_imported += 1,
                    false => settings_refused += 1,
                }
            }
        }
    }
    if settings_refused > 0 {
        // Summary only: counts, never a key and never a value.
        tracing::warn!(
            refused = settings_refused,
            policy = IngestPolicy::PortablePackage.label(),
            "import_data skipped settings rows refused by the portable-package policy"
        );
    }

    tx.commit()
        .map_err(|e| BridgeError::Internal(format!("committing import: {e}")))?;

    Ok(ImportDataResult {
        products_imported,
        categories_imported,
        sales_imported,
        customers_imported,
        users_imported,
        settings_imported,
    })
}

/// Session-scoped variant of [`get_backup_status`].
pub async fn get_backup_status_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    db_path: &Path,
) -> Result<BackupStatus, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::DATA_EXPORT)
        .await?;
    // The direct helper, not the public entry: a call that DID present a session
    // must not emit backup_ungated_no_session.
    backup_status_direct(db_path).await
}

/// Session-scoped variant of [`create_backup`].
pub async fn create_backup_scoped(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    db_path: &Path,
) -> Result<BackupResult, BridgeError> {
    // F-017: enforce per-domain permission on this scoped command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::DATA_EXPORT)
        .await?;
    create_backup_direct(ctx, db_path).await
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod data_tests;
