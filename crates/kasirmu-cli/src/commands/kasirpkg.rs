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
use serde::Serialize;

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

/// Serialize one export arm into the JSON array [`KasirpkgPayload`] carries —
/// or fail, naming the arm.
///
/// O-M50. The arms used to read
/// `serde_json::to_value(&rows).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()`,
/// which has TWO silent failure modes and reported success through both:
///
/// * `to_value(..)` returned `Err` — e.g. a `Currency` whose three bytes are
///   not UTF-8, which is a REAL failure of its hand-written `Serialize` impl
///   (`foundation/src/money.rs`). A database-resident value made the arm a
///   silently EMPTY array: the package was written, the command exited 0, and
///   it reported an export containing zero products — indistinguishable from a
///   store that has none.
/// * `to_value(..)` returned `Ok` but not an array — unreachable while every
///   arm is a `Vec`, and `unwrap_or_default()` would have hidden the day one
///   stopped being one.
///
/// Both now propagate. The CLI reports failure the way the rest of this crate
/// does (see `main.rs` and `error.rs`): `anyhow::Result` travels out of `run()`,
/// `main` returns it, and the process exits NON-ZERO with Rust's default report
/// on stderr. The `.context` names the arm, so the operator learns which data
/// type failed without a backtrace.
///
/// The serde round-trip stays: the payload is `Vec<serde_json::Value>`, so
/// this helper serializes the rows by REFERENCE (no clone of them) and moves
/// the array in — the deep clone the ledger also names is gone, and
/// `ExportError` is the one thing `serde_json::ArrayFromIter`'s `FromIterator`
/// cannot express.
fn export_arm<T: Serialize>(rows: &[T], arm: &'static str) -> Result<Vec<serde_json::Value>> {
    match serde_json::to_value(rows).with_context(|| format!("serializing {arm} for export"))? {
        serde_json::Value::Array(items) => Ok(items),
        other => Err(anyhow::anyhow!(
            "serializing {arm} for export produced {}, not a JSON array — refusing to write \
             a package that would silently carry zero {arm} rows",
            json_kind(&other)
        )),
    }
}

/// The JSON kind of `value`, for the error message in [`export_arm`]. A bare
/// `{value:?}` would print a whole table into the terminal.
fn json_kind(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "a boolean",
        serde_json::Value::Number(_) => "a number",
        serde_json::Value::String(_) => "a string",
        serde_json::Value::Array(_) => "an array",
        serde_json::Value::Object(_) => "an object",
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
        export_arm(&prods, "products")?
    } else {
        vec![]
    };

    let categories = if wants("categories") {
        let cats = store.list_categories()?;
        export_arm(&cats, "categories")?
    } else {
        vec![]
    };

    let sales = if wants("sales") {
        let sales_list = store.list_sales()?;
        Some(export_arm(&sales_list, "sales")?)
    } else {
        None
    };

    let customers = if wants("customers") {
        let custs = store.list_customers()?;
        Some(export_arm(&custs, "customers")?)
    } else {
        None
    };

    let users = if wants("users") {
        let mut usrs = store.list_users()?;
        // The `pin_hash` column is selected by `Store::list_users` and the
        // `User` struct serializes it, so a wholesale `to_value` would carry
        // every staff account's Argon2 PHC verifier into a file designed to
        // travel between installs. The value is DEAD WEIGHT on import — both
        // import arms write `''` and land the user inactive — so it is blanked
        // rather than omitted: omitting it fails
        // `serde_json::from_value::<User>` (the field has no
        // `#[serde(default)]`), and all three import sites swallow that with
        // `if let Ok(..)`, which would silently skip every user while the
        // command reported success. Blanking keeps the key present and the
        // shape unchanged.
        for u in &mut usrs {
            u.pin_hash.clear();
        }
        Some(export_arm(&usrs, "users")?)
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
        .unwrap_or_else(|| "kasir.mu Store".into());

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

    // O-M49: ONE timestamp for the whole import. Previously every row of
    // every table minted its own `chrono::Utc::now()` RFC-3339 string — up to
    // three per row on the insert paths. That was never a semantic: the value
    // only reaches `created_at` / `updated_at`, which are NOT part of any
    // conflict target (the targets are `categories.id`, `products.sku`,
    // `customers.id` and `users.id`) and are never compared for ordering
    // within an import, since every row here is stamped at the same instant by
    // construction. Hoisting also makes a bulk import's `updated_at` monotone
    // in row order instead of racing the clock row by row.
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    // `i64`, not `usize`: the counters live inside the `if let Ok(..)` arms
    // below, several of them inside statements that borrow `tx` mutably, so
    // they are `Cell`s. `Cell<i64>` needs no `Copy` trick and mirrors the rest
    // of this crate's row counters.
    let total = std::cell::Cell::new(0i64);

    // ══ O-M49: one prepared upsert per row, not probe-then-write ═══════
    //
    // Every arm below used to run TWO statements per row — a `SELECT 1 … WHERE
    // <key>` existence probe and then an INSERT or an UPDATE chosen from its
    // result — against a statement that was re-compiled each time. The
    // conflict behaviour of that shape is REPLACE-ONLY: the INSERT branch ran
    // exactly when the row was absent, and the UPDATE branch wrote a FIXED
    // column list. So a re-import of the same package UPDATES an existing row
    // and never a second row, and each ON CONFLICT arm below preserves the
    // UPDATE branch's column list verbatim — DO UPDATE, never DO NOTHING.
    //
    // Each statement is hoisted out of its loop and prepared ONCE per table,
    // not once per row. The categories/products arms sit in their own scope so
    // their statement is dropped before the next arm prepares its own; the
    // remaining arms keep their statement alive until the end of the block,
    // because `payload.sales` / `.customers` / `.users` are moved out of it.
    //
    // The error contract is unchanged too. A unique-constraint violation
    // aborts the statement with `Err` and never runs the UPDATE branch, so
    // propagating it with `?` matches the pre-change control flow exactly —
    // including the fact that the whole transaction then rolls back.
    //
    // `now` (hoisted above) is bound once per row as an OWNED `String` clone
    // rather than re-formatted; one `Utc::now()` + RFC-3339 format for the
    // whole import instead of up to three per row.

    // ── Categories ──────────────────────────────────────────────
    {
        // Conflict target: `categories.id` (TEXT PRIMARY KEY). NOTE the other
        // unique key on this table is `categories.name` (NOT NULL UNIQUE): a
        // row whose id is new but whose name collides still fails with
        // SQLITE_CONSTRAINT_UNIQUE — same as the old INSERT branch, which had
        // no ON CONFLICT clause at all.
        let mut upsert = tx.prepare_cached(
            "INSERT INTO categories (id, name, colour) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, colour = excluded.colour",
        )?;
        for val in payload.categories {
            if let Ok(cat) = serde_json::from_value::<kasirmu_core::Category>(val) {
                let colour = if cat.colour.is_empty() {
                    "#6366f1"
                } else {
                    cat.colour.as_str()
                };
                upsert.execute(rusqlite::params![cat.id, cat.name, colour])?;
                total.set(total.get() + 1);
            }
        }
    }

    // ── Products ────────────────────────────────────────────────
    {
        // Conflict target: `products.sku`. The PRIMARY KEY is `id` and the
        // per-tenant unique index is `(tenant_id, sku)` — but `sku` carries no
        // unique index of its own any more, so the old `WHERE sku = ?` probe
        // already treated sku as the row identity and the inserted `id` was
        // never checked. DO UPDATE on (tenant_id, sku) keeps that: the import
        // writes only `tenant_id = 'default'` rows (the column is omitted from
        // the INSERT, so its DEFAULT applies), and within that tenant the
        // upsert matches the probe's answer for "the row with this sku".
        //
        // The UPDATE arm writes exactly the four payload columns plus
        // `updated_at` — `id`, `created_at` and the 18 default-only columns
        // are untouched on a re-import, as before. `created_at` therefore comes
        // from EXCLUDED only on the INSERT path; on the DO UPDATE path it is
        // not listed and the stored value survives.
        let mut upsert = tx.prepare_cached(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(tenant_id, sku) DO UPDATE SET
                 name = excluded.name,
                 price_minor = excluded.price_minor,
                 currency = excluded.currency,
                 category_id = excluded.category_id,
                 barcode = excluded.barcode,
                 updated_at = excluded.updated_at",
        )?;
        for val in payload.products {
            if let Ok(product) = serde_json::from_value::<kasirmu_core::Product>(val) {
                // `?` on purpose: a non-UTF-8 currency is still a hard error
                // and still aborts the whole import (RUST-07), and the old
                // code only reached the conversion after the probe succeeded —
                // now it runs unconditionally, one `from_utf8` earlier.
                let cur_str = currency_to_utf8(&product)?;
                upsert.execute(rusqlite::params![
                    product.id,
                    product.sku.to_string(),
                    product.name,
                    product.price.minor_units,
                    cur_str,
                    product.category_id,
                    product.barcode.as_ref().map(|b| b.as_str()),
                    now,
                    now,
                ])?;
                total.set(total.get() + 1);
            }
        }
    }

    // ── Sales ───────────────────────────────────────────────────
    if let Some(sales) = payload.sales {
        // Sales are the ONE type that still probes, and deliberately: the
        // write path is `Store::create_sale_in_tx` (CLI-1), which owns the
        // 22-column INSERT *and* the sale-lines loop behind a money validator.
        // A bare `INSERT … ON CONFLICT` here would have to duplicate that
        // private SQL or silently drop the lines. The skip semantics are also
        // not a conflict target's to decide: a sale already present is NOT
        // updated at all, so this stays DO NOTHING-by-probe rather than
        // DO UPDATE. Removing this probe is a change to `kasirmu-core`'s API,
        // not to this file.
        let mut exists = tx.prepare_cached("SELECT 1 FROM sales WHERE id = ?1")?;
        for val in sales {
            if let Ok(sale) = serde_json::from_value::<kasirmu_core::Sale>(val) {
                if !exists.exists(rusqlite::params![sale.id])? {
                    // CLI-1 fix: use the tx-aware variant — the previous
                    // `store.create_sale` opened a nested transaction on the
                    // same connection ("cannot start a transaction within a
                    // transaction") and rolled the whole import back.
                    store.create_sale_in_tx(&tx, &sale)?;
                }
                total.set(total.get() + 1);
            }
        }
    }

    // ── Customers ───────────────────────────────────────────────
    if let Some(customers) = payload.customers {
        // Conflict target: `customers.id` (TEXT PRIMARY KEY). The only unique
        // index on the table; email/phone/store are merely indexed.
        //
        // The UPDATE arm writes name/email/phone/notes/updated_at and nothing
        // else. `loyalty_points`, `total_spent_minor` and `currency` are
        // written ONLY on the INSERT path (0, 0, 'USD') — a re-import must not
        // zero a live customer's balance. They are therefore absent from the
        // DO UPDATE list, exactly as they were absent from the old UPDATE.
        let mut upsert = tx.prepare_cached(
            "INSERT INTO customers (id, name, email, phone, notes, loyalty_points, total_spent_minor, currency, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 'USD', ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 email = excluded.email,
                 phone = excluded.phone,
                 notes = excluded.notes,
                 updated_at = excluded.updated_at",
        )?;
        for val in customers {
            if let Ok(cust) = serde_json::from_value::<kasirmu_core::Customer>(val) {
                let email_str = cust.email.map(|e| e.to_string());
                let phone_str = cust.phone.map(|p| p.to_string());
                upsert.execute(rusqlite::params![
                    cust.id, cust.name, email_str, phone_str, cust.notes, now, now,
                ])?;
                total.set(total.get() + 1);
            }
        }
    }

    // ── Users ───────────────────────────────────────────────────
    if let Some(users) = payload.users {
        // Conflict target: `users.id` (TEXT PRIMARY KEY). `users.username` is
        // NOT plain-UNIQUE any more — migration 20260815 replaced it with
        // `(tenant_id, username)` — so as with products the row identity the
        // old `WHERE id = ?` probe used is preserved by keying the upsert on
        // id, and a username collision from a DIFFERENT id still errors
        // (SQLITE_CONSTRAINT_UNIQUE) instead of being absorbed — which is what
        // the old INSERT branch did too.
        //
        // TWO column lists, on purpose, and the asymmetry is the OLD
        // asymmetry, not a new one:
        //   * INSERT path writes `pin_hash = ''` and `is_active = 0` — the
        //     exported verifier is NEVER restored and the account lands
        //     inactive (PIN reset required). See the long note below.
        //   * DO UPDATE path does NOT touch either column. It writes
        //     username/display_name/role_id/updated_at only, so an existing
        //     local account keeps its verifier AND its active flag — the old
        //     UPDATE arm wrote exactly this list, so a re-import has never
        //     deactivated a logged-in user and must not start now.
        //
        // The INSERT-path note that used to live here, kept verbatim:
        //
        // The export DOES carry `pin_hash` — the users arm above serializes
        // `Store::list_users()` wholesale, whose SELECT includes the column,
        // and the payload is a pass-through. (A comment here previously
        // claimed the hash was absent from the export; it is not.)
        //
        // The INSERT path deliberately does NOT use the exported value: a
        // fresh install must not inherit another install's credential
        // verifier, so the column is written empty and the account lands
        // INACTIVE.
        //
        // Removing `pin_hash` from the export therefore needs
        // `#[serde(default)]` on `User::pin_hash` FIRST: the field has no
        // default, so `serde_json::from_value::<User>` fails on a row that
        // omits it and every user is silently skipped — pinned by
        // `modules/staff/src/models_tests.rs::user_deserialization_requires_pin_hash`.
        let mut upsert = tx.prepare_cached(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at)
             VALUES (?1, ?2, '', ?3, ?4, 0, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 username = excluded.username,
                 display_name = excluded.display_name,
                 role_id = excluded.role_id,
                 updated_at = excluded.updated_at",
        )?;
        for val in users {
            if let Ok(user) = serde_json::from_value::<kasirmu_core::User>(val) {
                upsert.execute(rusqlite::params![
                    user.id,
                    user.username,
                    user.display_name,
                    user.role_id,
                    now,
                    now,
                ])?;
                total.set(total.get() + 1);
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
    let mut settings_failed = 0usize;
    if let Some(ref settings) = payload.settings {
        for val in settings {
            match importable_settings_row(val) {
                Some((key, value)) => {
                    // CLI-A: a FAILED write must not be counted as imported. The
                    // previous `let _ = Settings::set(...)` discarded the error
                    // and still incremented `total`, so the summary reported a
                    // record the database never received. Every other data type
                    // in this function propagates with `?`; a settings row is
                    // admitted by policy and then may still fail, which is
                    // neither a refusal nor a success.
                    match Settings::set(&tx, key, value) {
                        Ok(()) => total.set(total.get() + 1),
                        Err(e) => {
                            settings_failed += 1;
                            tracing::warn!(
                                key = %key,
                                error = %e,
                                "settings row admitted by policy but failed to write"
                            );
                        }
                    }
                }
                None => settings_skipped += 1,
            }
        }
    }

    tx.commit().context("committing import transaction")?;

    if settings_failed > 0 {
        eprintln!(
            "  {settings_failed} settings row(s) FAILED to write (admitted by policy, rejected by \
             the database) — the import is committed but those rows are missing; see the warnings above."
        );
    }
    if settings_skipped > 0 {
        eprintln!(
            "  {settings_skipped} settings row(s) skipped: secrets, device-bound ids \n             (machine_id, sync_terminal_id, local_api.secret, license.*, \n             gateway keys) and lifecycle-manager keys (local_api.*, lan_server.*) \n             never travel in a portable package (MED-2 / ingest policy)."
        );
    }
    eprintln!("import complete — {} records written.", total.get());
    Ok(())
}

#[cfg(test)]
#[path = "kasirpkg_tests.rs"]
mod tests;
