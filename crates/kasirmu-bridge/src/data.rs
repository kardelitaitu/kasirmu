//! Data-management command bodies (Wave F): backup, restore, .kasirpkg export
//! and .kasirpkg import — the tauri-free half of
//! apps/desktop-tauri/src/commands/data.rs.
//!
//! Key items: the wire DTOs, the two quota batch gates
//! (gate_import_product_batch, gate_import_user_batch), the settings redaction
//! rule (exportable_settings_rows), the path-traversal guard
//! (validate_contained_path), the ten command bodies, and the C8 restore
//! surface (list_restore_candidates / restore_prepare / restore_status), which
//! REQUEST a restore by writing `<db>.restore-request.json` for the boot path
//! to consume — it never performs one.
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

use serde::Serialize;

use kasirmu_core::db::{Store, validate_candidate};
// `data_tests.rs` names `BACKUP_GENERATIONS` through `use super::*`; the
// production reader of it moved to `data/restore.rs`, so an unconditional
// import here would be unused in the lib build.
#[cfg(test)]
use kasirmu_core::db::BACKUP_GENERATIONS;
use kasirmu_core::kasirpkg::{export_kasirpkg, import_kasirpkg};
use kasirmu_core::permissions;
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};

use crate::ctx::BridgeCtx;
use crate::error::BridgeError;

// ── DTOs ──────────────────────────────────────────────────────────

pub mod dto;
pub use dto::{
    BackupResult, BackupStatus, ExportDataArgs, ExportDataResult, ImportDataArgs, ImportDataResult,
    ImportPreviewArgs, ImportPreviewResult, ListRestoreCandidatesResult, RestoreCandidate,
    RestorePrepareArgs, RestorePrepareResult, RestoreStatus,
};
// `RestoreRequest` is the on-disk boot-path record: private to the data MODULE
// (not part of the IPC surface), so it is imported for the boot reader rather
// than re-exported.
use dto::RestoreRequest;

// ── Helpers ───────────────────────────────────────────────────────

pub mod helpers;
pub use helpers::{exportable_settings_rows, gate_import_product_batch, gate_import_user_batch};
// The three path/size helpers are private to the data MODULE (not IPC surface),
// so the command bodies below import them rather than re-exporting.
use helpers::{default_backup_path, human_size, validate_contained_path};

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

/// Queue the just-made pre-update backup as a boot restore request (C8 / S6).
///
/// # Why this exists
///
/// The updater takes a backup before it installs (`UpdateBanner` ->`create_backup`)
/// and recorded the path in the `updater.last_backup_path` setting -- which NOTHING
/// reads. So the "safety net" review 14.1 calls decorative was exactly that: a backup
/// on disk that no restore path would ever offer, and a setting no code consults.
/// This writes the SAME request file the boot consumer already understands, so the
/// backup becomes a recovery the operator can actually reach.
///
/// # Why it does not reuse `restore_prepare`
///
/// That function requires a session and `SETTINGS_EDIT`, and the pre-update path runs
/// before login -- the same reason `create_backup` is its own ungated entry point. The
/// difference in authority is deliberate and narrow: `restore_prepare` lets an operator
/// choose ANY candidate, so it demands a typed store-name confirmation; this may only
/// queue the backup the update just wrote, so there is no choice to confirm. It is not
/// exposed over IPC -- nothing in the renderer can reach it.
///
/// # Fails closed on a candidate that is not restorable
///
/// The backup is validated before the request is written. A candidate the boot path
/// would refuse leaves NO request on disk, so a failed update cannot queue a restore
/// that would refuse at the next boot and confuse the operator.
#[allow(dead_code)] // wired by the updater lane; the boot consumer is the reader
pub async fn queue_pre_update_restore_candidate(
    db_path: &Path,
) -> Result<QueueRestoreCandidateResult, BridgeError> {
    let candidate_path = default_backup_path(db_path);
    let candidate = Path::new(&candidate_path);
    if !candidate.is_file() {
        return Err(BridgeError::Invalid(format!(
            "no pre-update backup at '{candidate_path}' to queue"
        )));
    }

    // Validate BEFORE writing, exactly as `restore_prepare` does: a request file
    // must not exist for a candidate the boot path would refuse anyway.
    let report = validate_candidate(candidate).into_result(candidate)?;
    let store_name = candidate_store_name(candidate)?.unwrap_or_default();

    let requested_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let request = RestoreRequest {
        candidate_path: candidate_path.clone(),
        requested_at: requested_at.clone(),
        verdict: verdict_name(report.verdict).to_string(),
        candidate_schema: report.candidate_schema.clone(),
        confirmed_store_name: store_name,
    };
    let request_path = restore_request_path(db_path);
    let bytes = serde_json::to_vec_pretty(&request)
        .map_err(|e| BridgeError::Internal(format!("encoding the restore request: {e}")))?;
    std::fs::write(&request_path, bytes).map_err(|e| {
        BridgeError::Internal(format!(
            "writing the restore request '{}': {e}",
            request_path.display()
        ))
    })?;
    Ok(QueueRestoreCandidateResult {
        candidate_path,
        request_path: request_path.display().to_string(),
        requested_at,
    })
}

/// Result of [`queue_pre_update_restore_candidate`].
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueRestoreCandidateResult {
    /// The backup that was queued.
    pub candidate_path: String,
    /// The request file the boot path will consume.
    pub request_path: String,
    /// ISO-8601 timestamp the request was written at.
    pub requested_at: String,
}

/// Export data, session-gated.
pub async fn export_data(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    args: ExportDataArgs,
) -> Result<ExportDataResult, BridgeError> {
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, kasirmu_core::permissions::SETTINGS_EDIT)
        .await?;
    export_data_direct(ctx, args).await
}

/// A read-only, local-only export twin that takes NO session (ADR #58 §4a Q-A option 3).
///
/// **Why this exists, and why it cannot be a later follow-up.** ADR #58 §2.5 refuses new
/// sessions on a revoked tenant and invalidates live ones. Every export command resolves a
/// session and requires `SETTINGS_EDIT` — that one included — so once §2.5 holds, no export
/// path is reachable AT ALL, and §2.6's promise that a merchant keeps their data becomes a
/// sentence with no mechanism. The ADR is explicit that this twin is a **prerequisite of
/// §2.5's enforcement, not a follow-up to it**: the data is already on the merchant's disk,
/// so withholding it buys no protection while creating legal exposure.
///
/// **The precedent is `create_backup` above**, and it is followed deliberately rather than
/// re-invented: an unauthenticated twin beside its gated sibling, sharing one body, emitting
/// a warning that the permission was not checked. That command is the reason the
/// registration ledger already has a `no_session_resolution` home for this row.
///
/// **What makes this safe where a general unauthenticated command would not be:** it is
/// READ-ONLY and LOCAL-ONLY. It exports; it cannot import, mutate, or reach the network. The
/// failure mode of a mis-scoped export is a merchant reading their own data — the outcome
/// §2.6 exists to produce — whereas the failure mode of a mis-scoped session mask is granting
/// selling rights to a banned tenant.
pub async fn export_data_without_session(
    ctx: &BridgeCtx<'_>,
    args: ExportDataArgs,
) -> Result<ExportDataResult, BridgeError> {
    tracing::warn!(
        event = "export_ungated_no_session",
        operation = "export_data_without_session",
        skipped_permission = permissions::DATA_EXPORT,
        "ran a data export with no session identity presented: this command takes no token, so the permission was not checked"
    );
    export_data_direct(ctx, args).await
}

/// The body of `export_data`, without the gate. Private for the same reason as
/// `create_backup_direct`: only the gated twin can reach the ungated path without emitting the
/// warning, so the two cannot drift into two different exports.
async fn export_data_direct(
    ctx: &BridgeCtx<'_>,
    args: ExportDataArgs,
) -> Result<ExportDataResult, BridgeError> {
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
        let mut usrs = store.list_users()?;
        // GUI arm of the same rule the CLI lane applies (see
        // `crates/kasirmu-cli/src/commands/kasirpkg.rs`): `pin_hash` is
        // selected by `Store::list_users` and serialized by `User`, so it would
        // otherwise ride into every portable package. It is blanked rather than
        // omitted because `User::pin_hash` has no `#[serde(default)]` and all
        // three import arms swallow the resulting deserialization failure with
        // `if let Ok(..)` — omitting the key would silently skip every user.
        for u in &mut usrs {
            u.pin_hash.clear();
        }
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
        .unwrap_or_else(|| "kasir.mu Store".into());

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
                tx.execute(
                    "INSERT INTO categories (id, name, colour, icon) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![cat.id, cat.name, colour, ""],
                )?;
            } else {
                tx.execute(
                    "UPDATE categories SET name = ?1, colour = ?2, icon = '' WHERE id = ?3",
                    rusqlite::params![cat.name, colour, cat.id],
                )?;
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
                    tx.execute(
                        "UPDATE customers SET name = ?1, email = ?2, phone = ?3, notes = ?4, updated_at = ?5 WHERE id = ?6",
                        rusqlite::params![cust.name, email_str, phone_str, cust.notes, now, cust.id],
                    )?;
                } else {
                    tx.execute(
                        "INSERT INTO customers (id, name, email, phone, notes, loyalty_points, total_spent_minor, currency, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![cust.id, cust.name, email_str, phone_str, cust.notes, 0i64, 0i64, "USD", now, now],
                    )?;
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
                    tx.execute(
                        "UPDATE users SET username = ?1, display_name = ?2, role_id = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?6",
                        rusqlite::params![user.username, user.display_name, user.role_id, user.is_active, chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), user.id],
                    )?;
                } else {
                    // The package DOES carry `pin_hash` (the egress arm above
                    // serializes `Store::list_users()` wholesale), but this path
                    // deliberately does not use it — the column is written
                    // empty and the account lands INACTIVE so the member must
                    // be re-invited. (The previous comment claimed the export
                    // had no PIN hash; it does.)
                    //
                    // Stripping it from the export requires `#[serde(default)]`
                    // on `User::pin_hash` first — see the CLI twin of this arm
                    // (`kasirmu-cli/src/commands/kasirpkg.rs`).
                    tx.execute(
                        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
                        rusqlite::params![user.id, user.username, "", user.display_name, user.role_id, chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)],
                    )?;
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

/// Backup to an operator-chosen destination (tablet variant).
///
/// The desktop's `create_backup`/`create_backup_scoped` have no destination:
/// they write wherever `default_backup_path` lands, which on Android is inside
/// the app's private storage where the operator cannot open the file. This
/// variant instead takes `target_path` — on the tablet, the cache path the UI
/// bridged from the `content://` URI the save dialog returned — so the bytes
/// end up somewhere the operator can actually collect. It is the same two-leg
/// cross `export_data` uses, so path traversal is rejected the same way (C-1).
///
/// Gating lives here, not in the shell shim: the session is resolved and
/// `permissions::DATA_EXPORT` enforced, exactly as in `create_backup_scoped`.
pub async fn create_backup_to(
    ctx: &BridgeCtx<'_>,
    session_token: &str,
    target_path: &str,
) -> Result<BackupResult, BridgeError> {
    // F-017: enforce per-domain permission on this command.
    let session = ctx.resolve_session(session_token)?;
    ctx.require_session_permission(&session, permissions::DATA_EXPORT)
        .await?;
    // C-1: Contain output path — reject path traversal. The desktop path the
    // operator chose is benign, but a bridged cache path is constructed by JS
    // and must not escape the app cache via `..`.
    validate_contained_path(target_path)?;
    let conn = ctx.lock_global().await;
    let store = Store::new(&conn);
    store.backup(target_path)?;
    let size_bytes = std::fs::metadata(target_path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupResult {
        path: target_path.to_string(),
        size_bytes,
    })
}

pub mod restore;
pub use restore::{list_restore_candidates, restore_prepare, restore_status};
// The path/name helpers are private to the data MODULE (they take paths, not a
// context), so the remaining command bodies import them rather than
// re-exporting — `pub(super)` items cannot be re-exported (`E0364`).
use restore::{candidate_store_name, restore_request_path, verdict_name};
// `data_tests.rs` names `RESTORE_REQUEST_SUFFIX` through `use super::*` to check
// the derived file name directly; the production boot reader is in
// `data/restore.rs`, so an unconditional import here would be unused.
#[cfg(test)]
use restore::RESTORE_REQUEST_SUFFIX;

#[cfg(test)]
#[path = "data_tests.rs"]
mod data_tests;
