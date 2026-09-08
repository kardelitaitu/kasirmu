//! Cloud sync pull — snapshot fetch and local upsert, extracted from
//! `sync_client.rs` (F-011).
//!
//! Key items:
//! - [`Snapshot`] and its nested section types
//! - `fetch_snapshot_from_server`, `apply_snapshot`, `upsert_products`,
//!   `upsert_tax_rates`, `upsert_users`
//!
//! Invariants: SYNC-06 credential hygiene — users upsert with the
//! SNAPSHOT_PIN_HASH_PLACEHOLDER and pin_hash is omitted from UPDATE;
//! the pull applies in one transaction; `deny_unknown_fields` makes a
//! misbehaving server fail loudly.

use super::*;
use serde::Deserialize;

use crate::db::Store;
use crate::error::CoreError;
// ── Pull (snapshot import) ───────────────────────────────────────────
//
// `pull_snapshot` fetches the server's authoritative copy of the
// reference data (products, tax rates, users) and upserts it into the
// local DB inside a single transaction. Used by the `sync_pull`
// Tauri command when the user clicks "Pull from server" in the Sync
// tab — they want the server to be the new source of truth, and the
// local cache to match.

/// Server snapshot envelope. The server is expected to return the
/// flat column-shape for each row (matching the `products` / `tax_rates`
/// / `users` tables in the migrations) so the client can upsert
/// directly without remapping.
#[derive(Debug, Default, Deserialize)]
pub struct Snapshot {
    /// Products to upsert, keyed by `sku`.
    #[serde(default)]
    pub(crate) products: Vec<SnapshotProduct>,
    /// Tax rates to upsert, keyed by `id`.
    #[serde(default)]
    pub(crate) tax_rates: Vec<SnapshotTaxRate>,
    /// Users to upsert, keyed by `username`.
    #[serde(default)]
    pub(crate) users: Vec<SnapshotUser>,
}

/// Flat product row matching the `products` table columns.
#[derive(Debug, Deserialize)]
pub(crate) struct SnapshotProduct {
    /// Internal row id (UUID v7). If absent, a fresh UUID is generated.
    id: Option<String>,
    /// Stock-keeping unit — UNIQUE column used for the upsert conflict target.
    sku: String,
    /// Display name.
    name: String,
    /// Price in minor units (e.g. cents).
    price_minor: i64,
    /// ISO-4217 currency code.
    currency: String,
    /// Optional category FK.
    category_id: Option<String>,
    /// Optional machine-readable barcode.
    barcode: Option<String>,
    /// ISO-8601 creation timestamp; `None` lets the DB default fill it.
    created_at: Option<String>,
    /// ISO-8601 last-update timestamp; defaults to `now()` on insert.
    updated_at: Option<String>,
    /// ISO-8601 last price-change timestamp; defaults to `now()`.
    price_updated_at: Option<String>,
    /// Whether the product requires serial-number capture at checkout.
    #[serde(default)]
    track_serial: bool,
    /// Store scoping for the soft-scoping layer (migration 069/117).
    ///
    /// `None`/absent means the shared global catalog; `Some(id)` means the
    /// row is visible only to that store. Backward compatible: servers that
    /// omit the field deserialize as `None`, so every pulled row lands in
    /// the global catalog exactly as before.
    #[serde(default)]
    store_id: Option<String>,
    /// Product brand (free text, synced — ADR #36 D2).
    #[serde(default)]
    brand: Option<String>,
    /// Rack position code (synced).
    #[serde(default)]
    rack_location: Option<String>,
    /// Free-text notes (synced).
    #[serde(default)]
    notes: Option<String>,
    /// Unit of measure (synced).
    #[serde(default)]
    unit: Option<String>,
    /// Active/sellable status — synced so retirement propagates to every
    /// store. `cost_minor`, `default_supplier_id`, and `popularity_score` are
    /// deliberately absent (local-only, ADR #36 D2 / ADR #37 D4).
    #[serde(default = "default_true")]
    is_active: bool,
}

/// Flat tax-rate row matching the `tax_rates` table columns.
#[derive(Debug, Deserialize)]
pub(crate) struct SnapshotTaxRate {
    /// Internal row id (UUID v7) — used as the upsert conflict target.
    id: String,
    /// Display name.
    name: String,
    /// Rate in basis points (1 bps = 0.01 %).
    rate_bps: i64,
    /// Whether this is the default tax rate for the store.
    #[serde(default)]
    is_default: bool,
    /// Whether tax is included in the displayed price.
    #[serde(default)]
    is_inclusive: bool,
    /// ISO-8601 creation timestamp.
    created_at: Option<String>,
    /// ISO-8601 last-update timestamp.
    updated_at: Option<String>,
    /// Scope: the legal entity, or `None` when this row is not entity-scoped.
    /// Mirrors `platform_sync::transport::SnapshotTaxRate` — the two structs
    /// are the two ends of one contract and must stay column-for-column.
    ///
    /// `#[serde(default)]` is the back-compat ruling, stated once and pinned by
    /// a test: a payload carrying NONE of the four scope/window keys lands as
    /// the tenant-global legacy row, which is exactly what every row written
    /// before 20260921 is. Absence here is not "unknown scope" and not an
    /// error — it is the pre-scoping shape.
    #[serde(default)]
    legal_entity_id: Option<String>,
    /// Scope: the location, or `None` when this row is not location-scoped.
    /// With the entity column this is one-or-the-other-or-neither;
    /// [`crate::db::tax::TaxRateScope`] is the type that cannot hold both.
    #[serde(default)]
    location_id: Option<String>,
    /// Validity window start, business date `YYYY-MM-DD`; `None` = no lower
    /// bound.
    #[serde(default)]
    effective_from: Option<String>,
    /// Validity window end, business date `YYYY-MM-DD`, EXCLUSIVE; `None` =
    /// does not expire. Carried verbatim rather than re-derived, so the
    /// boundary-day rule stays a single decision made in
    /// `crate::db::tax` and not one per transport.
    #[serde(default)]
    effective_to: Option<String>,
}

/// Placeholder written into `users.pin_hash` for snapshot-imported users.
///
/// SYNC-06: the snapshot contract deliberately carries NO credential
/// material, so `upsert_users` cannot write a real verifier. This sentinel
/// can never match a bcrypt/argon2 verification, so a snapshot-imported
/// user cannot authenticate until a local administrator provisions their
/// PIN through the normal identity-management flow.
///
/// Shared with `platform-sync`'s `import_snapshot` so the sentinel lives
/// in exactly one place.
pub const SNAPSHOT_PIN_HASH_PLACEHOLDER: &str = "!snapshot-no-credential!";

/// Flat user row matching the `users` table columns (minus secrets).
///
/// SYNC-06: `pin_hash` is intentionally absent from the snapshot
/// contract — a sync token with snapshot access must never receive
/// credential-verifier material for tenant users. `deny_unknown_fields`
/// makes the client fail loudly if a (buggy/older) server ever sends a
/// `pin_hash` field instead of silently importing it.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SnapshotUser {
    /// Internal row id (UUID v7).
    pub(crate) id: Option<String>,
    /// Login username — UNIQUE column used for the upsert conflict target.
    pub(crate) username: String,
    /// Display name shown on the POS UI.
    pub(crate) display_name: String,
    /// FK to `roles.id`.
    pub(crate) role_id: String,
    /// Whether this user can log in.
    #[serde(default = "default_true")]
    pub(crate) is_active: bool,
    /// ISO-8601 creation timestamp.
    pub(crate) created_at: Option<String>,
    /// ISO-8601 last-update timestamp.
    pub(crate) updated_at: Option<String>,
}

/// Default `true` for `is_active` so a missing field means "user is active".
fn default_true() -> bool {
    true
}

/// Fetch a snapshot from the server via `GET /api/sync/snapshot` (async).
#[cfg(feature = "sync-http")]
pub async fn fetch_snapshot_from_server(config: &SyncConfig) -> Result<Snapshot, SyncHttpError> {
    let url = format!(
        "{}/api/sync/snapshot",
        config.server_url.trim_end_matches('/')
    );
    // COR-31: this was a bare Client::new(), which has no timeout at all —
    // an unreachable or stalled server parked the sync loop here forever,
    // with no error surfaced and no progress. The sync_client.rs stamp
    // suggested 60s; 120s is used instead because reqwest's timeout also
    // covers the body read, and a snapshot is a bulk payload — the same
    // reasoning behind HTTP_REQUEST_TIMEOUT on the export path. The goal is
    // to turn an unbounded hang into a reported failure, not to be tight:
    // a timeout short enough to cut off a legitimate large pull on a slow
    // shop link would trade one outage for another.
    let mut request = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| SyncHttpError::Network(format!("http client: {e}")))?
        .get(&url)
        .header("Accept", "application/json");

    if let Some(ref key) = config.api_key {
        request = request.header("Authorization", &format!("Bearer {key}"));
    }

    let resp = request
        .send()
        .await
        .map_err(|e| SyncHttpError::Network(e.to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(classify_http_status(status.as_u16(), &body));
    }

    let snapshot: Snapshot = resp
        .json()
        .await
        .map_err(|e| SyncHttpError::Parse(e.to_string()))?;

    Ok(snapshot)
}

/// Stub used when `sync-http` feature is disabled.
#[cfg(not(feature = "sync-http"))]
pub async fn fetch_snapshot_from_server(_config: &SyncConfig) -> Result<Snapshot, SyncHttpError> {
    Err(SyncHttpError::Network(
        "sync-http feature is disabled; cannot pull snapshot from server".into(),
    ))
}

/// Apply a fetched snapshot to the local database inside a single
/// transaction. This is the DB-only phase that runs after the async
/// `fetch_snapshot_from_server` call completes.
pub fn apply_snapshot(store: &Store, snapshot: &Snapshot) -> Result<PullResult, CoreError> {
    let tx = store.conn.unchecked_transaction()?;

    let products_pulled = upsert_products(&tx, &snapshot.products)?;
    let tax_rates_pulled = upsert_tax_rates(&tx, &snapshot.tax_rates)?;
    let users_pulled = upsert_users(&tx, &snapshot.users)?;

    tx.commit()?;

    tracing::info!(
        products = products_pulled,
        tax_rates = tax_rates_pulled,
        users = users_pulled,
        "applied server snapshot to local db"
    );

    Ok(PullResult {
        products_pulled,
        tax_rates_pulled,
        users_pulled,
        error: None,
    })
}

fn upsert_products(
    tx: &rusqlite::Transaction<'_>,
    rows: &[SnapshotProduct],
) -> Result<usize, CoreError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut count = 0usize;
    let mut stmt = tx.prepare(
        "INSERT INTO products (id, sku, name, price_minor, currency,
                               category_id, barcode, created_at, updated_at,
                               price_updated_at, track_serial, store_id,
                               brand, rack_location, notes, unit, is_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                 COALESCE(?8, ?11), COALESCE(?9, ?11), COALESCE(?10, ?11), ?12, ?13,
                 ?14, ?15, ?16, ?17, ?18)
         ON CONFLICT (tenant_id, sku) DO UPDATE SET
             name            = excluded.name,
             price_minor     = excluded.price_minor,
             currency        = excluded.currency,
             category_id     = excluded.category_id,
             barcode         = excluded.barcode,
             updated_at      = COALESCE(excluded.updated_at, ?11),
             price_updated_at = COALESCE(excluded.price_updated_at, ?11),
             track_serial    = excluded.track_serial,
             store_id        = excluded.store_id,
             brand           = excluded.brand,
             rack_location   = excluded.rack_location,
             notes           = excluded.notes,
             unit            = excluded.unit,
             is_active       = excluded.is_active",
    )?;
    for p in rows {
        let id =
            p.id.clone()
                .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        stmt.execute(rusqlite::params![
            id,
            p.sku,
            p.name,
            p.price_minor,
            p.currency,
            p.category_id,
            p.barcode,
            p.created_at,
            p.updated_at,
            p.price_updated_at,
            now,
            p.track_serial as i64,
            p.store_id,
            p.brand,
            p.rack_location,
            p.notes,
            p.unit,
            p.is_active as i64,
        ])?;
        count += 1;
    }
    stmt.finalize()?;
    Ok(count)
}

/// Whether a snapshot tax rate's scope can be honoured in THIS database.
///
/// `true` means the row may be written. Three cases return `false`:
///
/// * the row is scoped to an entity or location that does not exist locally —
///   writing it would fail the FK, and NULLing the scope out instead is the
///   exact bug this function exists to prevent: a rate meant for one location
///   silently becoming the tenant-global answer for every location;
/// * the row is scoped to BOTH (ambiguous — no tier may claim it, so the
///   branch refuses it rather than guessing, matching
///   [`crate::db::tax::TaxRateScope::classify`]).
///
/// Skipping is safe in a way flattening is not: the resolver's answer for "no
/// scoped row matches" is the tenant-global row, which is the same answer the
/// branch had before the pull. Nothing is priced with a rate meant for
/// somewhere else.
fn snapshot_tax_rate_scope_is_applicable(
    tx: &rusqlite::Transaction<'_>,
    rate: &SnapshotTaxRate,
) -> Result<bool, CoreError> {
    let exists = |sql: &str, id: &str| -> Result<bool, CoreError> {
        match tx.query_row(sql, rusqlite::params![id], |_| Ok(())) {
            Ok(()) => Ok(true),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(e) => Err(e.into()),
        }
    };
    match (rate.legal_entity_id.as_deref(), rate.location_id.as_deref()) {
        (None, None) => Ok(true),
        (Some(_), Some(_)) => Ok(false),
        (Some(entity), None) => exists("SELECT 1 FROM legal_entities WHERE id = ?1", entity),
        (None, Some(location)) => exists("SELECT 1 FROM locations WHERE id = ?1", location),
    }
}

fn upsert_tax_rates(
    tx: &rusqlite::Transaction<'_>,
    rows: &[SnapshotTaxRate],
) -> Result<usize, CoreError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut count = 0usize;
    let mut skipped: Vec<String> = Vec::new();
    let mut stmt = tx.prepare(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive,
                                created_at, updated_at,
                                legal_entity_id, location_id,
                                effective_from, effective_to)
         VALUES (?1, ?2, ?3, ?4, ?5,
                 COALESCE(?6, ?8), COALESCE(?7, ?8),
                 ?9, ?10, ?11, ?12)
         ON CONFLICT(id) DO UPDATE SET
             name            = excluded.name,
             rate_bps        = excluded.rate_bps,
             is_default      = excluded.is_default,
             is_inclusive    = excluded.is_inclusive,
             updated_at      = COALESCE(excluded.updated_at, ?8),
             legal_entity_id = excluded.legal_entity_id,
             location_id     = excluded.location_id,
             effective_from  = excluded.effective_from,
             effective_to    = excluded.effective_to",
    )?;
    for r in rows {
        if !snapshot_tax_rate_scope_is_applicable(tx, r)? {
            skipped.push(r.id.clone());
            continue;
        }
        // The four scope/window columns are assigned UNCONDITIONALLY on
        // conflict, deliberately NOT COALESCE(excluded.x, tax_rates.x). The
        // server is the authoritative copy here (that is the whole premise of
        // a pull), so a scope REMOVED at the hub must clear at the branch;
        // COALESCE would keep a stale scope alive forever and the branch would
        // keep applying a location rate it was told to stop scoping.
        stmt.execute(rusqlite::params![
            r.id,
            r.name,
            r.rate_bps,
            r.is_default as i64,
            r.is_inclusive as i64,
            r.created_at,
            r.updated_at,
            now,
            r.legal_entity_id,
            r.location_id,
            r.effective_from,
            r.effective_to,
        ])?;
        count += 1;
    }
    stmt.finalize()?;
    if !skipped.is_empty() {
        tracing::warn!(
            tax_rate_ids = ?skipped,
            count = skipped.len(),
            "snapshot tax rates skipped: their scope target is absent locally, or the              row is scoped to both an entity and a location. Flattening the scope would              make a rate meant for one location answer for every location, so the row is              refused instead and the tenant-global rate keeps applying."
        );
    }
    Ok(count)
}

fn upsert_users(tx: &rusqlite::Transaction<'_>, rows: &[SnapshotUser]) -> Result<usize, CoreError> {
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut count = 0usize;
    // SYNC-06: `pin_hash` is never taken from the snapshot. New rows get a
    // non-verifiable placeholder, and on conflict the EXISTING local hash
    // is preserved (the UPDATE clause deliberately omits `pin_hash`) — a
    // snapshot pull can neither replicate credentials nor lock out an
    // operator who already has a working PIN.
    let mut stmt = tx.prepare(
        "INSERT INTO users (id, username, pin_hash, display_name, role_id,
                            is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                 COALESCE(?7, ?9), COALESCE(?8, ?9))
         ON CONFLICT (tenant_id, username) DO UPDATE SET
             display_name = excluded.display_name,
             role_id      = excluded.role_id,
             is_active    = excluded.is_active,
             updated_at   = COALESCE(excluded.updated_at, ?9)",
    )?;
    for u in rows {
        let id =
            u.id.clone()
                .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
        stmt.execute(rusqlite::params![
            id,                            // ?1
            u.username,                    // ?2
            SNAPSHOT_PIN_HASH_PLACEHOLDER, // ?3 — never a real verifier
            u.display_name,                // ?4
            u.role_id,                     // ?5
            u.is_active as i64,            // ?6
            u.created_at,                  // ?7
            u.updated_at,                  // ?8
            now,                           // ?9 — default for created_at / updated_at
        ])?;
        count += 1;
    }
    stmt.finalize()?;
    Ok(count)
}
