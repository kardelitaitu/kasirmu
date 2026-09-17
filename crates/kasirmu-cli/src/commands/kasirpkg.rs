//! Encrypted `.kasirpkg` export/import commands.
//!
//! `run_export_kasirpkg` collects the requested data types and writes an
//! Argon2id + AES-256-GCM encrypted package; `run_import_kasirpkg` decrypts
//! and upserts everything inside a single transaction (CLI-1: sale rows
//! go through the tx-aware `Store::create_sale_in_tx`). `currency_to_utf8`
//! decodes a product's currency bytes recoverably (RUST-07).
//!
//! Settings rows are the one data type that is NOT whole-table portable:
//! [`is_portable_settings_key`] gates BOTH arms — the `load_all` egress in
//! `run_export_kasirpkg` and the write in `run_import_kasirpkg` — through the ONE
//! sealed [`IngestPolicy::PortablePackage`], the same policy the desktop
//! bridge and the sync lane now ask. A `.kasirpkg` is carried to another install,
//! so per-install secrets (C-2), machine-bound identities and
//! lifecycle-manager keys must never travel in either direction.

use std::collections::HashMap;

use anyhow::{Context, Result};
use rusqlite::Connection;

use kasirmu_core::Settings;
use kasirmu_core::db::Store;
use kasirmu_core::settings::{IngestPolicy, IngestPolicyKind};

/// The ONE portable-package settings gate for the CLI `.kasirpkg` lane.
///
/// Returns `true` when a settings row may travel in — or be restored from —
/// a portable `.kasirpkg`. Asks the sealed [`IngestPolicy::PortablePackage`]
/// itself, reached through `kasirmu_core`'s re-export: this crate owns NO key list
/// and NO prefix rule, because a hand-copied predicate is exactly how the GUI
/// and CLI lanes drifted apart. The policy refuses `SECRET_KEY_DENY_LIST`
/// (credentials — `local_api.secret`, `sync_terminal_secret`, `license.api_key`,
/// the payment-gateway keys, …), `NON_EXPORTABLE_DEVICE_KEYS` (`machine_id`,
/// `sync_terminal_id`) AND the lifecycle-manager prefixes `local_api.*` /
/// `lan_server.*` — that last group is what the bare predicate this lane used
/// to call did NOT cover.
///
/// WHY THE POLICY AND NOT `Settings::set_with_policy`: `kasirmu-cli` has no
/// `platform-core` dependency edge and `kasirmu_core::Settings` does not yet
/// delegate `load_exportable` / `set_with_policy` / `set_batch_with_policy`,
/// so the funnelled accessors are unreachable from this crate. This boundary
/// is the one-line swap point: when the delegation lands, the egress arm
/// becomes `Settings::load_exportable(conn)` and the ingress arm becomes
/// `Settings::set_batch_with_policy(&tx, &rows, IngestPolicy::PortablePackage)`
/// — same decision, same warn-and-continue, no restructure.
///
/// Deliberately NOT applied inside [`Settings::load_all`]: that accessor is
/// also internal (`Settings::load_features` and `prune_stale_features` read
/// through it), so filtering there would break feature pruning. The gate
/// belongs at this lane's call site.
fn is_portable_settings_key(key: &str) -> bool {
    IngestPolicy::PortablePackage.admits(key)
}

/// Warn for one key the portable-package policy refused at ingress. Names the
/// key and the policy, NEVER the value — the same shape the funnelled
/// accessors use, so a hand-edited package cannot push a credential into the
/// log either.
fn warn_refused_settings_key(key: &str) {
    tracing::warn!(
        key = %key,
        policy = IngestPolicy::PortablePackage.label(),
        "settings key refused by portable-package policy (skipped, import continues)"
    );
}

/// Egress arm: map `load_all` rows to export JSON, dropping every row the
/// portable gate refuses.
fn portable_settings_rows(rows: Vec<(String, String)>) -> Vec<serde_json::Value> {
    rows.into_iter()
        .filter(|(key, _)| is_portable_settings_key(key))
        .map(|(key, value)| serde_json::json!({ "key": key, "value": value }))
        .collect()
}

/// Ingress arm, the mirror of [`portable_settings_rows`]: the row's key and
/// value, or `None` when the row is unreadable or must not be restored.
///
/// A `None` here is a REFUSAL by [`IngestPolicy::PortablePackage`], not an
/// error: the caller warns and continues, exactly as `set_with_policy` does.
fn importable_settings_row(row: &serde_json::Value) -> Option<(&str, &str)> {
    let key = row.get("key").and_then(|v| v.as_str())?;
    let value = row.get("value").and_then(|v| v.as_str())?;
    if is_portable_settings_key(key) {
        Some((key, value))
    } else {
        warn_refused_settings_key(key);
        None
    }
}

/// Export store data to an encrypted .kasirpkg file.
pub(crate) fn run_export_kasirpkg(
    conn: &Connection,
    output: &str,
    types_str: &str,
    password: &str,
) -> Result<()> {
    use kasirmu_core::kasirpkg::{KasirpkgPayload, export_kasirpkg};

    let store = Store::new(conn);

    // Parse which data types to include.
    let all_types = types_str == "all";
    let requested: Vec<String> = if all_types {
        vec![]
    } else {
        types_str
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .collect()
    };

    let wants = |name: &str| all_types || requested.iter().any(|r| r == name);

    eprintln!("exporting data...");

    // Collect data from the database.
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
        // MED-2 invariant, CLI arm: the whole settings table is read, but only
        // portable rows are kept — credentials, device-bound identities and
        // lifecycle-manager keys are dropped by the shared policy gate.
        // `load_all` is UNFILTERED on purpose (`load_features` /
        // `prune_stale_features` read through it), so the filtering has to
        // happen HERE: this is `Settings::load_exportable`'s job, and the line
        // below is where it moves once `kasirmu-core` delegates that accessor.
        let rows = kasirmu_core::Settings::load_all(conn)?;
        let total = rows.len();
        let kept = portable_settings_rows(rows);
        let dropped = total - kept.len();
        if dropped > 0 {
            eprintln!("  {dropped} secret/device-bound settings row(s) withheld from the package");
        }
        Some(kept)
    } else {
        None
    };

    // Collect feature flags for header metadata.
    let reg = store.load_features()?;
    let features: HashMap<String, String> = reg.to_settings_rows().into_iter().collect();

    // Build data_types list.
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

    eprintln!("  encrypting with Argon2id + AES-256-GCM...");
    let kasirpkg_bytes = export_kasirpkg(
        password,
        &store_name,
        "0.0.1",
        data_types,
        features,
        &payload,
    )
    .context("encrypting export")?;

    std::fs::write(output, &kasirpkg_bytes).with_context(|| format!("writing {output}"))?;

    eprintln!("exported to {output} ({} bytes)", kasirpkg_bytes.len());
    Ok(())
}

/// Decode a product's raw currency bytes as UTF-8, returning a recoverable
/// error instead of panicking when an imported `.kasirpkg` carries non-UTF-8
/// currency bytes (RUST-07: recoverable user-supplied input).
pub(crate) fn currency_to_utf8(product: &kasirmu_core::Product) -> Result<String> {
    std::str::from_utf8(&product.price.currency.0)
        .map(|s| s.to_owned())
        .map_err(|e| {
            anyhow::anyhow!(
                "product {} has invalid (non-UTF-8) currency: {e}",
                product.sku
            )
        })
}

/// Import data from an encrypted .kasirpkg file.
pub(crate) fn run_import_kasirpkg(
    conn: &Connection,
    input: &str,
    password: &str,
    dry_run: bool,
) -> Result<()> {
    use kasirmu_core::kasirpkg::import_kasirpkg;

    eprintln!("reading {input}...");
    let data = std::fs::read(input).with_context(|| format!("reading {input}"))?;

    eprintln!("  decrypting...");
    let (header, payload) = import_kasirpkg(&data, password).context("decrypting import file")?;

    // Show metadata.
    println!();
    println!("Store:      {}", header.store_name);
    println!("Version:    {}", header.app_version);
    println!("Created:    {}", header.created_at);
    println!("Types:      {}", header.data_types.join(", "));
    println!("Products:   {}", payload.products.len());
    println!("Categories: {}", payload.categories.len());
    if let Some(sales) = &payload.sales {
        println!("Sales:      {}", sales.len());
    }
    if let Some(customers) = &payload.customers {
        println!("Customers:  {}", customers.len());
    }
    if let Some(users) = &payload.users {
        println!("Users:      {}", users.len());
    }
    if let Some(settings) = &payload.settings {
        println!("Settings:   {}", settings.len());
    }
    println!();

    if dry_run {
        println!("Dry-run mode — no data written.");
        return Ok(());
    }

    // Write data to the database inside a single transaction.
    let store = Store::new(conn);
    let tx = conn
        .unchecked_transaction()
        .context("starting import transaction")?;

    let mut total = 0usize;

    // ── Categories ──────────────────────────────────────────────
    for val in &payload.categories {
        if let Ok(cat) = serde_json::from_value::<kasirmu_core::Category>(val.clone()) {
            let colour = if cat.colour.is_empty() {
                "#6366f1"
            } else {
                &cat.colour
            };
            let exists = tx
                .query_row(
                    "SELECT 1 FROM categories WHERE id = ?1",
                    rusqlite::params![cat.id],
                    |_| Ok(()),
                )
                .is_ok();
            if exists {
                tx.execute(
                    "UPDATE categories SET name = ?1, colour = ?2 WHERE id = ?3",
                    rusqlite::params![cat.name, colour, cat.id],
                )?;
            } else {
                tx.execute(
                    "INSERT INTO categories (id, name, colour) VALUES (?1, ?2, ?3)",
                    rusqlite::params![cat.id, cat.name, colour],
                )?;
            }
            total += 1;
        }
    }

    // ── Products ────────────────────────────────────────────────
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
                let cur_str = currency_to_utf8(&product)?;
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                tx.execute(
                    "UPDATE products SET name = ?1, price_minor = ?2, currency = ?3, category_id = ?4, barcode = ?5, updated_at = ?6 WHERE sku = ?7",
                    rusqlite::params![product.name, product.price.minor_units, cur_str, product.category_id, product.barcode.as_ref().map(|b| b.as_str()), now, product.sku.to_string()],
                )?;
            } else {
                let cur_str = currency_to_utf8(&product)?;
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                tx.execute(
                    "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    rusqlite::params![product.id, product.sku.to_string(), product.name, product.price.minor_units, cur_str, product.category_id, product.barcode.as_ref().map(|b| b.as_str()), now, now],
                )?;
            }
            total += 1;
        }
    }

    // ── Sales ───────────────────────────────────────────────────
    if let Some(ref sales) = payload.sales {
        for val in sales {
            if let Ok(sale) = serde_json::from_value::<kasirmu_core::Sale>(val.clone()) {
                let exists = tx
                    .query_row(
                        "SELECT 1 FROM sales WHERE id = ?1",
                        rusqlite::params![sale.id],
                        |_| Ok(()),
                    )
                    .is_ok();
                if !exists {
                    // CLI-1 fix: use the tx-aware variant — the previous
                    // `store.create_sale` opened a nested transaction on the
                    // same connection ("cannot start a transaction within a
                    // transaction") and rolled the whole import back.
                    store.create_sale_in_tx(&tx, &sale)?;
                }
                total += 1;
            }
        }
    }

    // ── Customers ───────────────────────────────────────────────
    if let Some(ref customers) = payload.customers {
        for val in customers {
            if let Ok(cust) = serde_json::from_value::<kasirmu_core::Customer>(val.clone()) {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let exists = tx
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
                         VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 'USD', ?6, ?7)",
                        rusqlite::params![cust.id, cust.name, email_str, phone_str, cust.notes, now, now],
                    )?;
                }
                total += 1;
            }
        }
    }

    // ── Users ───────────────────────────────────────────────────
    if let Some(ref users) = payload.users {
        for val in users {
            if let Ok(user) = serde_json::from_value::<kasirmu_core::User>(val.clone()) {
                let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                let exists = tx
                    .query_row(
                        "SELECT 1 FROM users WHERE id = ?1",
                        rusqlite::params![user.id],
                        |_| Ok(()),
                    )
                    .is_ok();
                if exists {
                    tx.execute(
                        "UPDATE users SET username = ?1, display_name = ?2, role_id = ?3, updated_at = ?4 WHERE id = ?5",
                        rusqlite::params![user.username, user.display_name, user.role_id, now, user.id],
                    )?;
                } else {
                    // PIN hash not included in export; imported users are inactive
                    tx.execute(
                        "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
                         VALUES (?1, ?2, '', ?3, ?4, 0, ?5, ?6)",
                        rusqlite::params![user.id, user.username, user.display_name, user.role_id, now, now],
                    )?;
                }
                total += 1;
            }
        }
    }

    // ── Settings ────────────────────────────────────────────────
    // Symmetric with the export arm above: a package written by an OLDER
    // build (or hand-edited, or built by an attacker who knows the shared
    // password) still carries credentials, device ids and manager-owned keys,
    // and restoring one must not silently swap this install's signing secret,
    // license key or machine fingerprint. Every row is therefore admitted or
    // refused by [`IngestPolicy::PortablePackage`] inside
    // [`importable_settings_row`] BEFORE any write is attempted — a refused
    // row writes NOTHING and the batch continues; only an admitted row
    // reaches `Settings::set`. No raw `Settings::set` on this path is ever
    // reached by a key the policy would refuse.
    let mut settings_skipped = 0usize;
    if let Some(ref settings) = payload.settings {
        for val in settings {
            match importable_settings_row(val) {
                Some((key, value)) => {
                    let _ = Settings::set(&tx, key, value);
                    total += 1;
                }
                None => settings_skipped += 1,
            }
        }
    }

    tx.commit().context("committing import transaction")?;

    if settings_skipped > 0 {
        eprintln!(
            "  {settings_skipped} settings row(s) skipped: secrets, device-bound ids \n             (machine_id, sync_terminal_id, local_api.secret, license.*, \n             gateway keys) and lifecycle-manager keys (local_api.*, lan_server.*) \n             never travel in a portable package (MED-2 / ingest policy)."
        );
    }
    eprintln!("import complete — {total} records written.");
    Ok(())
}

#[cfg(test)]
#[path = "kasirpkg_tests.rs"]
mod tests;
