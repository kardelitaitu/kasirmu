//! Postgres data layer for the oz-api REST handlers (Phase 1.2 of
//! `docs/archived/2026-08-15-unify-auth-and-sync.md`).
/*
last audited 25-07-26 by RSA-Agent (oz-api slice B: pg deep read)
crate: oz-api | status: SAFE | lint: CLEAN
findings: RLS contract exemplary — every tenant-scoped function opens a tx and sets oz.tenant_id LOCAL (12 sites verified; LOCAL scope auto-resets so pooled connections never leak scope); verify_terminal_credentials is a documented pre-tenant read via a scoped discovery role (SET LOCAL ROLE inside read-only tx) with digest comparison in SQL; all SQL parameterized ($n), format! only builds error strings and static SELECT prefixes; API-3 INFO: sale reads unwrap_or(0) tip_minor/service_charge_minor (1211-1212) and enum fallbacks product_type/status (610/1149) silently zero/default on drift (COR-13/25 family)
next: propagate sale money-column read errors (API-3) | perf: PRODUCT_SELECT reuses stock_summary aggregate
*/
//!
//! The desktop/tablet/cloud POS share one SQLite data layer
//! ([`oz_core::Store`]), which cannot be rewritten to Postgres. The cloud
//! server therefore gets a **parallel async data layer** for the REST
//! surface, exactly like `apps/cloud-server/src/sync_store.rs` is for the
//! sync function. Each handler dispatches on `AppState::pg`:
//!
//! - `Some(pool)` → the cloud server's Postgres branch: this module runs the
//!   query against `deadpool_postgres::Pool`.
//! - `None` → local dev / tests / SQLite branch: the existing
//!   `oz_core::Store` path runs unchanged.
//!
//! The SQL is written natively for Postgres (`$n` parameters). The port
//! schema (`20260813_init.pg.sql`) stores boolean-ish columns as `BIGINT`
//! (0/1), so reads go through `pg_bool` and writes pass `i64`. The
//! behaviour mirrors the SQLite `Store` methods the handlers used before:
//! validation errors, unique-constraint conflicts, the `stock_movements` +
//! `stock_summary` + `inventory` ledger writes on product/stock changes, and
//! the sale header + line insert inside one transaction.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use deadpool_postgres::Pool;
use tokio_postgres::error::SqlState;

use oz_core::tax_rate::TaxRate;
use oz_core::{
    Category, Currency, Money, Product, ProductWithDetails, Sale, SaleLine, SaleStatus, Sku,
    TenantPlan, User,
};

use crate::routes::terminals::RegisteredTerminal;

/// Default inventory location UUID (must match the port schema's default).
const CANONICAL_DEFAULT_LOCATION_UUID: &str = "01926b3a-0000-7000-8000-000000000001";

// ── Settings ────────────────────────────────────────────────────────────

/// Read a raw `settings` value from Postgres (`None` when absent).
pub async fn get_setting_pg(pool: &Pool, key: &str) -> Result<Option<String>, String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    let row = client
        .query_opt("SELECT value FROM settings WHERE key = $1", &[&key])
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    Ok(row.map(|r| r.get(0)))
}

/// Upsert a `settings` value into Postgres (same shape the cloud report
/// loop uses, so keys written here are read verbatim by `email_pg`).
pub async fn set_setting_pg(pool: &Pool, key: &str, value: &str) -> Result<(), String> {
    let client = pool.get().await.map_err(|e| e.to_string())?;
    client
        .execute(
            "INSERT INTO settings (key, value, updated_at)
             VALUES ($1, $2, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))
             ON CONFLICT (key) DO UPDATE
               SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
            &[&key, &value],
        )
        .await
        .map_err(|e| format!("DB error: {e}"))?;
    Ok(())
}

/// Scoped settings key — suffix form (`{base}:{tenant}`), matching
/// `email_pg`'s per-tenant keys so the admin endpoint provisions exactly
/// what the report loop reads.
pub fn scoped_setting_key(base: &str, tenant: &str) -> String {
    format!("{base}:{tenant}")
}

/// Error from the Postgres REST data layer, mapped to HTTP statuses the same
/// way the SQLite `Store` errors were.
#[derive(Debug)]
pub enum PgError {
    /// Unique-constraint violation → 409.
    Conflict,
    /// Missing row → 404.
    NotFound,
    /// Input validation failed → 400.
    Validation(String),
    /// Backend / connection failure → 500.
    Db(String),
}

impl std::fmt::Display for PgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PgError::Conflict => write!(f, "resource already exists"),
            PgError::NotFound => write!(f, "not found"),
            PgError::Validation(m) => write!(f, "{m}"),
            PgError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PgError {}

impl PgError {
    /// Convert into an axum [`Response`] with the matching status code.
    pub fn into_response(self) -> Response {
        match self {
            PgError::Conflict => (
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "resource already exists"})),
            )
                .into_response(),
            PgError::NotFound => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not found"})),
            )
                .into_response(),
            PgError::Validation(message) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": message})),
            )
                .into_response(),
            PgError::Db(e) => {
                tracing::error!("postgres REST data layer error: {e}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal error"})),
                )
                    .into_response()
            }
        }
    }
}

/// Read a `BIGINT` boolean-ish column as `bool` (0 → false, else true).
fn pg_bool(row: &tokio_postgres::Row, column: &str) -> Result<bool, PgError> {
    let v: i64 = row
        .try_get(column)
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(v != 0)
}

/// Check whether a Postgres error is a unique-constraint violation.
fn is_unique_violation(e: &tokio_postgres::Error) -> bool {
    e.as_db_error()
        .map(|d| d.code() == &SqlState::UNIQUE_VIOLATION)
        .unwrap_or(false)
}

/// Check whether a Postgres error is a foreign-key violation.
fn is_fk_violation(e: &tokio_postgres::Error) -> bool {
    e.as_db_error()
        .map(|d| d.code() == &SqlState::FOREIGN_KEY_VIOLATION)
        .unwrap_or(false)
}

/// Current UTC timestamp in the same format the SQLite path uses.
fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Bump the per-tenant snapshot version counter (ADR #43 D2).
///
/// Call inside the SAME transaction as the reference-data write (product,
/// tax rate, user). The snapshot handler reads this counter instead of
/// running a 3-table COUNT + MAX(updated_at) stamp query on every cache
/// miss, so a bump here makes the next snapshot revalidation see the
/// change (near-instant propagation) at the cost of one PK upsert.
async fn bump_snapshot_version(
    tx: &tokio_postgres::Transaction<'_>,
    tenant_id: &str,
) -> Result<(), PgError> {
    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO snapshot_versions (tenant_id, version, updated_at) VALUES ($1, 1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET version = snapshot_versions.version + 1, updated_at = EXCLUDED.updated_at",
        &[&tenant_id, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

fn currency_str(currency: &Currency) -> Result<String, PgError> {
    std::str::from_utf8(&currency.0)
        .map(str::to_owned)
        .map_err(|e| PgError::Validation(format!("invalid UTF-8 in currency bytes: {e}")))
}

// RLS contract: every tenant-scoped REST function below opens a transaction
// and sets `oz.tenant_id` as a LOCAL setting (`set_config(..., is_local :=
// true)`) as its first statement. Under the cutover (`scripts/rls-cutover.sql`,
// `FORCE ROW LEVEL SECURITY`) a query on a tenant table fails closed without
// it; the LOCAL scope auto-resets on commit/rollback, so a pooled connection
// never leaks one tenant's scope to the next borrower.

// ── Tenant plans ──────────────────────────────────────────────────────

/// Read a tenant's sync plan, or `None` when the tenant has no row.
pub async fn get_tenant_plan(pool: &Pool, tenant_id: &str) -> Result<Option<TenantPlan>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let row = tx
        .query_opt(
            "SELECT plan FROM tenant_plans WHERE tenant_id = $1",
            &[&tenant_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let result = row
        .map(|r| {
            let plan: String = r.try_get(0).map_err(|e| PgError::Db(e.to_string()))?;
            Ok(TenantPlan::from_db(&plan))
        })
        .transpose();
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    result
}

/// Assign or change a tenant's plan (upsert).
pub async fn set_tenant_plan(
    pool: &Pool,
    tenant_id: &str,
    plan: TenantPlan,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO tenant_plans (tenant_id, plan, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at",
        &[&tenant_id, &plan.as_db_str(), &now_rfc3339()],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

// ── Categories ────────────────────────────────────────────────────────

/// List all categories, ordered by name.
pub async fn list_categories(pool: &Pool) -> Result<Vec<Category>, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let rows = client
        .query(
            "SELECT id, name, colour, icon FROM categories ORDER BY name",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    rows.iter()
        .map(|r| {
            Ok(Category {
                id: r.try_get("id").map_err(|e| PgError::Db(e.to_string()))?,
                name: r.try_get("name").map_err(|e| PgError::Db(e.to_string()))?,
                colour: r
                    .try_get("colour")
                    .map_err(|e| PgError::Db(e.to_string()))?,
                icon: r.try_get("icon").map_err(|e| PgError::Db(e.to_string()))?,
            })
        })
        .collect()
}

// ── Tax rates ─────────────────────────────────────────────────────────

/// Create a tax rate, scoped to `tenant_id`, mirroring `Store::create_tax_rate`
/// including the TAX-02 default-flag swap inside one transaction.
pub async fn create_tax_rate(
    pool: &Pool,
    tenant_id: &str,
    name: &str,
    rate_bps: i64,
    is_default: bool,
    is_inclusive: bool,
) -> Result<TaxRate, PgError> {
    if name.trim().is_empty() {
        return Err(PgError::Validation(
            "tax rate name must not be empty".into(),
        ));
    }
    if rate_bps < 0 {
        return Err(PgError::Validation("rate_bps must be non-negative".into()));
    }

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    if is_default {
        tx.execute(
            "UPDATE tax_rates SET is_default = 0 WHERE is_default = 1",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    }

    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO tax_rates (id, name, rate_bps, is_default, is_inclusive, created_at, updated_at, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        &[
            &id,
            &name.trim(),
            &rate_bps,
            &(is_default as i64),
            &(is_inclusive as i64),
            &now,
            &now,
            &tenant_id,
        ],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(TaxRate {
        id,
        name: name.trim().to_owned(),
        rate_bps,
        is_default,
        is_inclusive,
        created_at: now.clone(),
        updated_at: now,
    })
}
// ── Users ─────────────────────────────────────────────────────────────

/// Create a user, scoped to `tenant_id`, mirroring `Store::create_user`
/// (validation, the role FK check, the default `assignments` row).
pub async fn create_user(
    pool: &Pool,
    tenant_id: &str,
    username: &str,
    pin_hash: &str,
    display_name: &str,
    role_id: &str,
) -> Result<User, PgError> {
    let username = username.trim().to_lowercase();
    if username.is_empty() {
        return Err(PgError::Validation("username must not be empty".into()));
    }
    if username.len() > 100 {
        return Err(PgError::Validation(format!(
            "username must not exceed 100 characters, got {}",
            username.len()
        )));
    }
    if display_name.trim().is_empty() {
        return Err(PgError::Validation("display name must not be empty".into()));
    }
    if display_name.len() > 255 {
        return Err(PgError::Validation(format!(
            "display name must not exceed 255 characters, got {}",
            display_name.len()
        )));
    }

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // The SQLite path surfaces an unknown role as a constraint violation;
    // here we fail closed with a clear validation error instead.
    let role_exists: bool = tx
        .query_one(
            "SELECT EXISTS(SELECT 1 FROM roles WHERE id = $1)",
            &[&role_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .get(0);
    if !role_exists {
        return Err(PgError::Validation(format!(
            "role_id '{role_id}' does not reference an existing role"
        )));
    }

    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    if let Err(e) = tx
        .execute(
            "INSERT INTO users (id, username, pin_hash, display_name, role_id, is_active, created_at, updated_at, tenant_id)
             VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)",
            &[
                &id,
                &username,
                &pin_hash,
                &display_name.trim(),
                &role_id,
                &now,
                &now,
                &tenant_id,
            ],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(PgError::Conflict);
        }
        if is_fk_violation(&e) {
            return Err(PgError::Validation(format!(
                "role_id '{role_id}' does not reference an existing role"
            )));
        }
        return Err(PgError::Db(e.to_string()));
    }

    // Every user gets their single effective assignment (ADR #35 D5).
    tx.execute(
        "INSERT INTO assignments (user_id, role_id, scope_mode, branch_scope, workspace_scope)
         VALUES ($1, $2, 'global', 'all', 'all')",
        &[&id, &role_id],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(User {
        id,
        username,
        pin_hash: pin_hash.to_owned(),
        display_name: display_name.trim().to_owned(),
        role_id: role_id.to_owned(),
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    })
}

// ── Terminals ─────────────────────────────────────────────────────────

/// Register (or rotate the secret of) a sync terminal.
pub async fn register_terminal(
    pool: &Pool,
    terminal_id: &str,
    secret_hash: &str,
    label: &str,
    tenant_id: Option<&str>,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    if let Some(tenant) = tenant_id {
        // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
        // A `None` tenant is a legacy/NULL-tenant row: no GUC can be set, and
        // under FORCE the RLS WITH CHECK rejects the write anyway.
        tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
    }
    tx.execute(
        "INSERT INTO sync_terminals (terminal_id, secret_hash, label, tenant_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (terminal_id) DO UPDATE SET
            secret_hash = excluded.secret_hash,
            label = excluded.label,
            tenant_id = excluded.tenant_id",
        &[
            &terminal_id,
            &secret_hash,
            &label,
            &tenant_id,
            &now_rfc3339(),
        ],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Resolve a terminal from client credentials, or `None` on mismatch.
///
/// RLS exception (pre-tenant by design): this lookup IS the tenant-resolution
/// step — the `oz.tenant_id` GUC is read FROM the terminal row it returns, so
/// it cannot set the GUC first. Under `FORCE ROW LEVEL SECURITY` with the
/// restricted `oz_app` role a bare query returns zero rows. The function
/// therefore scopes the read to the BYPASSRLS `oz_email_discovery` role
/// (when the session user is a member) — the same pattern as the webhook
/// resolver and `active_tenants_pg`, so client-credential minting works
/// post-cutover. Pre-cutover (no discovery role yet) it reads unscoped, as
/// before.
pub async fn verify_terminal_credentials(
    pool: &Pool,
    client_id: &str,
    client_secret: &str,
) -> Result<Option<RegisteredTerminal>, PgError> {
    let digest = crate::routes::terminals::hash_secret(client_secret);
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // Terminal credential verification is a PRE-tenant read: the whole
    // point of the lookup is to learn the tenant_id. After RLS cutover
    // (oz_app + FORCE RLS), a bare read on sync_terminals sees zero rows
    // because current_setting('oz.tenant_id') is NULL. Mirror the
    // active_tenants_pg pattern: if the session user is a member of the
    // BYPASSRLS discovery role, scope the read to it.
    let is_discovery_member: bool = tx
        .query_one(
            "SELECT EXISTS(
                SELECT 1 FROM pg_roles r
                JOIN pg_auth_members m ON m.roleid = r.oid
                WHERE r.rolname = 'oz_email_discovery'
                  AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
             )",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .get(0);
    if is_discovery_member {
        tx.execute("SET LOCAL ROLE oz_email_discovery", &[])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
    }

    let row = tx
        .query_opt(
            "SELECT terminal_id, tenant_id FROM sync_terminals WHERE terminal_id = $1 AND secret_hash = $2",
            &[&client_id, &digest],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let result = row
        .map(|r| {
            Ok(RegisteredTerminal {
                terminal_id: r.try_get(0).map_err(|e| PgError::Db(e.to_string()))?,
                tenant_id: r.try_get(1).map_err(|e| PgError::Db(e.to_string()))?,
            })
        })
        .transpose();
    // Transaction drops here → rollback (read-only) → GUC and role reset.
    result
}

// ── Products ──────────────────────────────────────────────────────────

const PRODUCT_SELECT: &str = "SELECT p.id, p.sku, p.name, p.price_minor, p.currency, \
     p.category_id, p.barcode, p.created_at, p.updated_at, p.price_updated_at, \
     p.track_serial, p.product_type, p.version, \
     p.cost_minor, p.brand, p.rack_location, p.notes, p.unit, \
     p.is_active, p.default_supplier_id, p.popularity_score, p.image_hash, \
     c.name AS category_name, \
     COALESCE((SELECT SUM(ss.qty)::bigint FROM stock_summary ss WHERE ss.item_id = p.id), i.qty) AS stock_qty \
     FROM products p \
     LEFT JOIN categories c ON p.category_id = c.id \
     LEFT JOIN inventory i ON p.id = i.product_id";

/// Build a [`ProductWithDetails`] from a Postgres row (mirrors the SQLite
/// `row_to_product_with_details` mapper, including the `BIGINT` → `bool`
/// conversion for the boolean-ish columns).
fn pg_row_to_product_with_details(
    row: &tokio_postgres::Row,
) -> Result<ProductWithDetails, PgError> {
    let sku_str: String = row.try_get("sku").map_err(|e| PgError::Db(e.to_string()))?;
    let cur_str: String = row
        .try_get("currency")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let barcode_raw: Option<String> = row
        .try_get("barcode")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let product_type_str: String = row
        .try_get("product_type")
        .map_err(|e| PgError::Db(e.to_string()))?;

    let product = Product {
        id: row.try_get("id").map_err(|e| PgError::Db(e.to_string()))?,
        sku: Sku::new(sku_str),
        name: row
            .try_get("name")
            .map_err(|e| PgError::Db(e.to_string()))?,
        price: Money {
            minor_units: row
                .try_get("price_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency: cur_str
                .parse::<Currency>()
                .map_err(|e| PgError::Db(e.to_string()))?,
        },
        category_id: row
            .try_get("category_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        barcode: barcode_raw.and_then(|s| foundation::Barcode::new(&s).ok()),
        created_at: row
            .try_get("created_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        updated_at: row
            .try_get("updated_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        price_updated_at: row
            .try_get("price_updated_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        track_serial: pg_bool(row, "track_serial")?,
        product_type: oz_core::ProductType::parse_str(&product_type_str).unwrap_or_default(),
        version: row
            .try_get("version")
            .map_err(|e| PgError::Db(e.to_string()))?,
        cost_minor: row
            .try_get("cost_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        brand: row
            .try_get("brand")
            .map_err(|e| PgError::Db(e.to_string()))?,
        rack_location: row
            .try_get("rack_location")
            .map_err(|e| PgError::Db(e.to_string()))?,
        notes: row
            .try_get("notes")
            .map_err(|e| PgError::Db(e.to_string()))?,
        unit: row
            .try_get("unit")
            .map_err(|e| PgError::Db(e.to_string()))?,
        is_active: pg_bool(row, "is_active")?,
        default_supplier_id: row
            .try_get("default_supplier_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        image_hash: row.try_get("image_hash").ok(),
    };

    Ok(ProductWithDetails {
        product,
        category_name: row
            .try_get("category_name")
            .map_err(|e| PgError::Db(e.to_string()))?,
        stock_qty: row
            .try_get("stock_qty")
            .map_err(|e| PgError::Db(e.to_string()))?,
        popularity_score: row
            .try_get("popularity_score")
            .map_err(|e| PgError::Db(e.to_string()))?,
        images: Vec::new(), // populated by the list/get loaders
    })
}

/// Load product image assignments for the given product IDs and attach
/// them to the respective `ProductWithDetails` (spec 0046b §3.4).
async fn attach_product_images(
    tx: &tokio_postgres::Transaction<'_>,
    tenant_id: &str,
    products: &mut [ProductWithDetails],
) -> Result<(), PgError> {
    if products.is_empty() {
        return Ok(());
    }
    let ids: Vec<&str> = products.iter().map(|p| p.product.id.as_str()).collect();
    // Build a parameterised query with placeholders
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("${i}")).collect();
    let sql = format!(
        "SELECT product_id, slot, hash, position FROM product_images \
         WHERE product_id IN ({}) ORDER BY slot ASC",
        placeholders.join(", ")
    );
    let stmt = tx
        .prepare(&sql)
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = ids
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();
    let rows = tx
        .query(&stmt, &params)
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut by_product: std::collections::HashMap<
        String,
        Vec<oz_core::db::products::ProductImage>,
    > = std::collections::HashMap::new();
    for row in rows {
        let product_id: String = row
            .try_get("product_id")
            .map_err(|e| PgError::Db(e.to_string()))?;
        let slot: i32 = row
            .try_get("slot")
            .map_err(|e| PgError::Db(e.to_string()))?;
        let hash: String = row
            .try_get("hash")
            .map_err(|e| PgError::Db(e.to_string()))?;
        let position: i32 = row
            .try_get("position")
            .map_err(|e| PgError::Db(e.to_string()))?;
        by_product
            .entry(product_id)
            .or_default()
            .push(oz_core::db::products::ProductImage {
                slot,
                hash,
                position,
            });
    }
    for p in products.iter_mut() {
        if let Some(imgs) = by_product.remove(&p.product.id) {
            p.images = imgs;
        }
    }
    let _ = tenant_id; // RLS scoping already applied on the transaction
    Ok(())
}

/// Compute the `missing_hashes` set-difference for a tenant (spec 0046b
/// §3.4/§3.7): candidate hashes that the tenant references but the cloud's
/// `image_refs` spine has no active (refcount > 0) row for. The desktop
/// pushes exactly these first.
pub async fn list_missing_hashes(
    pool: &Pool,
    tenant_id: &str,
    candidates: &[String],
) -> Result<Vec<String>, PgError> {
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let placeholders: Vec<String> = (1..=candidates.len()).map(|i| format!("${i}")).collect();
    let sql = format!(
        "SELECT hash FROM image_refs WHERE tenant_id = $1 AND hash IN ({}) AND refcount > 0",
        placeholders.join(", ")
    );
    let stmt = tx
        .prepare(&sql)
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
        vec![&tenant_id as &(dyn tokio_postgres::types::ToSql + Sync)];
    for c in candidates {
        params.push(c);
    }
    let rows = tx
        .query(&stmt, &params)
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let present: std::collections::HashSet<String> =
        rows.iter().map(|r| r.get::<_, String>("hash")).collect();
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(candidates
        .iter()
        .filter(|c| !present.contains(*c))
        .cloned()
        .collect())
}

/// List a tenant's products, ordered by name, with category name and stock.
pub async fn list_products(
    pool: &Pool,
    tenant_id: &str,
) -> Result<Vec<ProductWithDetails>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let rows = tx
        .query(
            &format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 ORDER BY p.name"),
            &[&tenant_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut result: Vec<ProductWithDetails> = rows
        .iter()
        .map(pg_row_to_product_with_details)
        .collect::<Result<_, _>>()?;
    attach_product_images(&tx, tenant_id, &mut result).await?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(result)
}

/// Get a single product by SKU (tenant-scoped), including category name and
/// stock. SKUs are unique per tenant, so the lookup must be scoped.
pub async fn get_product(
    pool: &Pool,
    tenant_id: &str,
    sku: &str,
) -> Result<Option<ProductWithDetails>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let row = tx
        .query_opt(
            &format!("{PRODUCT_SELECT} WHERE p.tenant_id = $1 AND p.sku = $2"),
            &[&tenant_id, &sku],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut result = row.map(|r| pg_row_to_product_with_details(&r)).transpose();
    // Attach images for the single product.
    if let Ok(Some(ref mut p)) = result {
        let slice = std::slice::from_mut(p);
        attach_product_images(&tx, tenant_id, slice).await?;
    }
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    result
}

/// Create a product (scoped to `tenant_id`), mirroring the SQLite path:
/// the product row plus — for `initial_stock > 0` — the `inventory`,
/// `stock_movements` ledger, and `stock_summary` rows in one transaction.
#[allow(clippy::too_many_arguments)]
pub async fn create_product(
    pool: &Pool,
    tenant_id: &str,
    sku: &str,
    name: &str,
    price: Money,
    category_id: Option<&str>,
    barcode: Option<&str>,
    initial_stock: i64,
) -> Result<ProductWithDetails, PgError> {
    if sku.trim().is_empty() {
        return Err(PgError::Validation("SKU must not be empty".into()));
    }
    if sku.len() > 50 {
        return Err(PgError::Validation(format!(
            "SKU must not exceed 50 characters, got {}",
            sku.len()
        )));
    }
    if name.trim().is_empty() {
        return Err(PgError::Validation("name must not be empty".into()));
    }
    if price.minor_units < 0 {
        return Err(PgError::Validation("price must be ≥ 0".into()));
    }
    if initial_stock < 0 {
        return Err(PgError::Validation("initial_stock must be ≥ 0".into()));
    }

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    let cur_str = currency_str(&price.currency)?;

    if let Err(e) = tx
        .execute(
            "INSERT INTO products (id, sku, name, price_minor, currency, category_id, barcode, \
             created_at, updated_at, price_updated_at, track_serial, product_type, version, \
             cost_minor, brand, rack_location, notes, unit, is_active, default_supplier_id, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, 0, 'retail', 1, 0, NULL, NULL, NULL, NULL, 1, NULL, $9)",
            &[
                &id,
                &sku.trim(),
                &name.trim(),
                &price.minor_units,
                &cur_str,
                &category_id,
                &barcode,
                &now,
                &tenant_id,
            ],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(PgError::Conflict);
        }
        return Err(PgError::Db(e.to_string()));
    }

    if initial_stock > 0 {
        tx.execute(
            "INSERT INTO inventory (product_id, qty, updated_at) VALUES ($1, $2, $3)",
            &[&id, &initial_stock, &now],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
        let movement_id = uuid::Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO stock_movements (id, item_id, delta, reason, source_terminal_id, source_user_id, created_at)
             VALUES ($1, $2, $3, 'initial-stock', NULL, NULL, $4)",
            &[&movement_id, &id, &initial_stock, &now],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
        tx.execute(
            "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (item_id, location_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
            &[&id, &CANONICAL_DEFAULT_LOCATION_UUID, &initial_stock, &now],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    }

    bump_snapshot_version(&tx, tenant_id).await?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(ProductWithDetails {
        product: Product {
            id,
            sku: Sku::new(sku.trim()),
            name: name.trim().to_owned(),
            price,
            category_id: category_id.map(str::to_owned),
            barcode: barcode.and_then(|s| foundation::Barcode::new(s).ok()),
            created_at: now.clone(),
            updated_at: now.clone(),
            price_updated_at: now,
            track_serial: false,
            product_type: oz_core::ProductType::Retail,
            version: 1,
            cost_minor: 0,
            brand: None,
            rack_location: None,
            notes: None,
            unit: None,
            is_active: true,
            default_supplier_id: None,
            image_hash: None,
        },
        category_name: None,
        stock_qty: if initial_stock > 0 {
            Some(initial_stock)
        } else {
            None
        },
        popularity_score: 0.0,
        images: Vec::new(),
    })
}

/// Outcome of a stock adjustment.
#[derive(Debug, Clone, Copy)]
pub struct StockAdjustment {
    /// Stock before the adjustment.
    pub previous_qty: i64,
    /// Stock after the adjustment.
    pub new_qty: i64,
}

/// Adjust stock by SKU, mirroring the SQLite `adjust_stock` path: read the
/// previous quantity, reject negative stock, and write the `stock_movements`
/// ledger + `inventory` + `stock_summary` rows in one transaction.
///
/// The whole read-modify-write runs inside the transaction with the product
/// row locked (`SELECT … FOR UPDATE`), so concurrent adjustments to the same
/// SKU serialize instead of losing updates — SQLite's single-writer
/// semantics made the read-outside-tx shape safe there, Postgres does not.
pub async fn adjust_stock(
    pool: &Pool,
    tenant_id: &str,
    sku: &str,
    delta: i64,
) -> Result<StockAdjustment, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    // Lock the product row first: every adjustment to this SKU contends on
    // the same row lock, so the inventory read below always sees the latest
    // committed quantity (and the `inventory` row, when missing, is created
    // by the first locker before the second reads it).
    let product_id: Option<String> = tx
        .query_opt(
            "SELECT id FROM products WHERE tenant_id = $1 AND sku = $2 FOR UPDATE",
            &[&tenant_id, &sku],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|r| r.get(0));
    let product_id = match product_id {
        Some(id) => id,
        None => return Err(PgError::NotFound),
    };

    let previous_qty: i64 = tx
        .query_opt(
            "SELECT qty FROM inventory WHERE product_id = $1",
            &[&product_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|r| r.get::<_, i64>(0))
        .unwrap_or(0);

    let new_qty = previous_qty
        .checked_add(delta)
        .filter(|&v| v >= 0)
        .ok_or_else(|| {
            PgError::Validation(format!(
                "adjustment would cause negative stock (previous: {previous_qty}, delta: {delta})"
            ))
        })?;

    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO stock_movements (id, item_id, delta, reason, source_terminal_id, source_user_id, created_at)
         VALUES ($1, $2, $3, NULL, NULL, NULL, $4)",
        &[&uuid::Uuid::now_v7().to_string(), &product_id, &delta, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO inventory (product_id, qty, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (product_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
        &[&product_id, &new_qty, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO stock_summary (item_id, location_id, qty, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (item_id, location_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at",
        &[&product_id, &CANONICAL_DEFAULT_LOCATION_UUID, &new_qty, &now],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;

    Ok(StockAdjustment {
        previous_qty,
        new_qty,
    })
}

// ── Sales ─────────────────────────────────────────────────────────────

/// Persist a sale header + lines in one transaction, mirroring the SQLite
/// `Store::create_sale` (including the same negative-value rejections and
/// the frozen `cost_minor` snapshot on each line). The per-line cost freeze
/// looks the product up within `tenant_id` (SKUs are unique per tenant).
pub async fn create_sale(pool: &Pool, tenant_id: &str, sale: &Sale) -> Result<(), PgError> {
    for line in &sale.lines {
        if line.qty < 0 {
            return Err(PgError::Validation(format!(
                "sale line quantity must be positive, got {}",
                line.qty
            )));
        }
        if line.line_total.minor_units < 0 {
            return Err(PgError::Validation(
                "sale line total must be non-negative".into(),
            ));
        }
        if line.tax_amount.minor_units < 0 {
            return Err(PgError::Validation(
                "sale line tax must be non-negative".into(),
            ));
        }
    }
    if sale.total.minor_units < 0 || sale.subtotal.minor_units < 0 || sale.tax_total.minor_units < 0
    {
        return Err(PgError::Validation(
            "sale totals must be non-negative".into(),
        ));
    }
    if let Some(tendered) = sale.tendered_minor
        && tendered < 0
    {
        return Err(PgError::Validation(
            "tendered amount must be non-negative".into(),
        ));
    }

    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope this transaction to the tenant (LOCAL, auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let cur_str = currency_str(&sale.currency)?;
    let status_str = sale.status.as_stored_str();
    tx.execute(
        // CUR-02 cloud gap: the tender metadata (base currency/total/rate)
        // and tip/service amounts must be written here — `get_sale` below
        // already reads all five columns, so omitting them made every
        // cloud-side sale show NULL tender info and lost the tip/service
        // amounts for reconciliation.
        "INSERT INTO sales (id, total_minor, currency, line_count, status, payment_method, tendered_minor,
                            discount_percent, discount_label, user_id, created_at, updated_at,
                            subtotal_minor, tax_total_minor, customer_id, version, tenant_id,
                            base_currency, base_total_minor, tender_rate_millionths,
                            tip_minor, service_charge_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, $16,
                 $17, $18, $19, $20, $21)",
        &[
            &sale.id,
            &sale.total.minor_units,
            &cur_str,
            &sale.line_count,
            &status_str,
            &sale.payment_method,
            &sale.tendered_minor,
            &sale.discount_percent,
            &sale.discount_label,
            &sale.user_id,
            &sale.created_at,
            &sale.updated_at,
            &sale.subtotal.minor_units,
            &sale.tax_total.minor_units,
            &sale.customer_id,
            &tenant_id,
            &sale.base_currency,
            &sale.base_total_minor,
            &sale.tender_rate_millionths,
            &sale.tip_minor,
            &sale.service_charge_minor,
        ],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;

    for line in &sale.lines {
        let line_cur = currency_str(&line.unit_price.currency)?;
        // Freeze the product cost at write time (ADR #36 reporting) and
        // the product identity (REP-05): renaming a product, moving it
        // between categories, or reusing a deleted sku must never
        // relabel historical revenue in the email reports.
        let (cost_minor, product_id, product_name, category_id): (Option<i64>, Option<String>, Option<String>, Option<String>) = tx
            .query_opt(
                "SELECT cost_minor, id, name, category_id FROM products WHERE tenant_id = $1 AND sku = $2",
                &[&tenant_id, &line.sku],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?
            .map(|r| {
                (
                    Some(r.get::<_, i64>(0)).filter(|&v| v > 0),
                    r.get::<_, Option<String>>(1),
                    r.get::<_, Option<String>>(2),
                    r.get::<_, Option<String>>(3),
                )
            })
            .unwrap_or_default();
        tx.execute(
            // tenant_id is written explicitly (not via column default) so
            // every line row lands in the caller's tenant — the header's
            // set_config scopes RLS, but the column default would still
            // stamp 'default' into the row itself.
            "INSERT INTO sale_lines (id, sale_id, tenant_id, sku, qty, unit_minor, line_minor, currency, line_position,
                                     tax_minor, tax_rate_id, tax_breakdown_json,
                                     serial_number, course, modifiers_json, cost_minor,
                                     product_id, product_name, category_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)",
            &[
                &line.id,
                &line.sale_id,
                &tenant_id,
                &line.sku,
                &line.qty,
                &line.unit_price.minor_units,
                &line.line_total.minor_units,
                &line_cur,
                &line.line_position,
                &line.tax_amount.minor_units,
                &line.tax_rate_id,
                &line.tax_breakdown_json,
                &line.serial_number,
                &line.course,
                &line.modifiers_json,
                &cost_minor,
                &product_id,
                &product_name,
                &category_id,
            ],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    }

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Build a [`SaleLine`] from a Postgres row.
fn pg_row_to_sale_line(row: &tokio_postgres::Row) -> Result<SaleLine, PgError> {
    let cur_str: String = row
        .try_get("currency")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let currency = cur_str
        .parse::<Currency>()
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(SaleLine {
        id: row.try_get("id").map_err(|e| PgError::Db(e.to_string()))?,
        sale_id: row
            .try_get("sale_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        sku: row.try_get("sku").map_err(|e| PgError::Db(e.to_string()))?,
        qty: row.try_get("qty").map_err(|e| PgError::Db(e.to_string()))?,
        unit_price: Money {
            minor_units: row
                .try_get("unit_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        line_total: Money {
            minor_units: row
                .try_get("line_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        line_position: row
            .try_get("line_position")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tax_amount: Money {
            minor_units: row
                .try_get("tax_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        tax_rate_id: row
            .try_get("tax_rate_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tax_breakdown_json: row
            .try_get("tax_breakdown_json")
            .map_err(|e| PgError::Db(e.to_string()))?,
        serial_number: row
            .try_get("serial_number")
            .map_err(|e| PgError::Db(e.to_string()))?,
        course: row
            .try_get("course")
            .map_err(|e| PgError::Db(e.to_string()))?,
        modifiers_json: row
            .try_get("modifiers_json")
            .map_err(|e| PgError::Db(e.to_string()))?,
    })
}

/// Get a single sale by id, including line items.
pub async fn get_sale(pool: &Pool, tenant_id: &str, id: &str) -> Result<Option<Sale>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let sale_row = tx
        .query_opt(
            "SELECT id, total_minor, currency, line_count, status, payment_method, tendered_minor,
                    discount_percent, discount_label, user_id, created_at, updated_at,
                    subtotal_minor, tax_total_minor, customer_id, version,
                    base_currency, base_total_minor, tender_rate_millionths,
                    tip_minor, service_charge_minor
             FROM sales WHERE id = $1",
            &[&id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let Some(sale_row) = sale_row else {
        return Ok(None);
    };
    let cur_str: String = sale_row
        .try_get("currency")
        .map_err(|e| PgError::Db(e.to_string()))?;
    let currency = cur_str
        .parse::<Currency>()
        .map_err(|e| PgError::Db(e.to_string()))?;
    let status_str: String = sale_row
        .try_get("status")
        .map_err(|e| PgError::Db(e.to_string()))?;

    let mut sale = Sale {
        id: sale_row
            .try_get("id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        status: SaleStatus::from_stored_str(&status_str).unwrap_or(SaleStatus::Pending),
        total: Money {
            minor_units: sale_row
                .try_get("total_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        line_count: sale_row
            .try_get("line_count")
            .map_err(|e| PgError::Db(e.to_string()))?,
        currency,
        payment_method: sale_row
            .try_get("payment_method")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tendered_minor: sale_row
            .try_get("tendered_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        discount_percent: sale_row
            .try_get::<_, i64>("discount_percent")
            .map_err(|e| PgError::Db(e.to_string()))?,
        discount_label: sale_row
            .try_get("discount_label")
            .map_err(|e| PgError::Db(e.to_string()))?,
        user_id: sale_row
            .try_get("user_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        created_at: sale_row
            .try_get("created_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        updated_at: sale_row
            .try_get("updated_at")
            .map_err(|e| PgError::Db(e.to_string()))?,
        lines: Vec::new(),
        subtotal: Money {
            minor_units: sale_row
                .try_get("subtotal_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        tax_total: Money {
            minor_units: sale_row
                .try_get("tax_total_minor")
                .map_err(|e| PgError::Db(e.to_string()))?,
            currency,
        },
        customer_id: sale_row
            .try_get("customer_id")
            .map_err(|e| PgError::Db(e.to_string()))?,
        version: sale_row
            .try_get("version")
            .map_err(|e| PgError::Db(e.to_string()))?,
        // CUR-02: multi-currency tender fields (nullable — None for
        // single-currency sales, matching the migration defaults).
        base_currency: sale_row
            .try_get("base_currency")
            .map_err(|e| PgError::Db(e.to_string()))?,
        base_total_minor: sale_row
            .try_get("base_total_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tender_rate_millionths: sale_row
            .try_get("tender_rate_millionths")
            .map_err(|e| PgError::Db(e.to_string()))?,
        tip_minor: sale_row.try_get("tip_minor").unwrap_or(0),
        service_charge_minor: sale_row.try_get("service_charge_minor").unwrap_or(0),
    };

    let line_rows = tx
        .query(
            "SELECT id, sale_id, sku, qty, unit_minor, line_minor, currency, line_position,
                    tax_minor, tax_rate_id, tax_breakdown_json, serial_number, course, modifiers_json
             FROM sale_lines WHERE sale_id = $1 AND tenant_id = $2 ORDER BY line_position",
            &[&id, &tenant_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    for row in &line_rows {
        sale.lines.push(pg_row_to_sale_line(row)?);
    }

    let result = Ok(Some(sale));
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    result
}

/// Transition a sale's status, validating the state machine first.
///
/// The UPDATE is a compare-and-swap (`WHERE id = $1 AND status = $2`) so
/// two concurrent transitions cannot both validate against the same stale
/// status and double-apply (the loser re-reads and reports the current
/// state).
pub async fn update_sale_status(
    pool: &Pool,
    tenant_id: &str,
    id: &str,
    to: SaleStatus,
) -> Result<Sale, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let current_str: Option<String> = tx
        .query_opt("SELECT status FROM sales WHERE id = $1", &[&id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?
        .map(|r| r.get(0));
    let current_str = match current_str {
        Some(s) => s,
        None => return Err(PgError::NotFound),
    };

    let current = SaleStatus::from_stored_str(&current_str)
        .ok_or_else(|| PgError::Validation(format!("invalid stored status: {current_str}")))?;
    if !SaleStatus::can_transition_to(current, to) {
        return Err(PgError::Validation(format!(
            "cannot transition from {current:?} to {to:?}"
        )));
    }

    let now = now_rfc3339();
    let updated = tx
        .execute(
            "UPDATE sales SET status = $1, updated_at = $2, version = version + 1 \
                 WHERE id = $3 AND status = $4",
            &[&to.as_stored_str(), &now, &id, &current_str],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    if updated == 0 {
        // Lost the race to a concurrent transition — re-read to report the
        // status we actually saw, rather than silently succeeding.
        let now_str: Option<String> = tx
            .query_opt("SELECT status FROM sales WHERE id = $1", &[&id])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?
            .map(|r| r.get(0));
        return match now_str {
            None => Err(PgError::NotFound),
            Some(s) => Err(PgError::Validation(format!(
                "cannot transition from {s:?} to {to:?}"
            ))),
        };
    }

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    match get_sale(pool, tenant_id, id).await? {
        Some(sale) => Ok(sale),
        None => Err(PgError::NotFound),
    }
}

// ── Exchange rates ───────────────────────────────────────────────────
//
// ARCH-01-family repair (2026-08-31): the exchange-rate commands existed
// only as Tauri IPC + dev-mock — the cloud had no REST counterpart, so
// web deployments could not read or manage rates at all. The cloud
// `exchange_rates` table is GLOBAL reference data (no `tenant_id`, no
// RLS — same treatment as `categories`/`currencies`), so these handlers
// are tenant-agnostic by schema design.

/// Wire shape mirroring `modules_currency::ExchangeRateRow`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExchangeRateDto {
    /// Row id (UUID v7).
    pub id: String,
    /// ISO-4217 alpha-3 source currency code.
    pub from_currency: String,
    /// ISO-4217 alpha-3 target currency code.
    pub to_currency: String,
    /// Fixed-point rate at 6-decimal scale (strictly positive).
    pub rate_millionths: i64,
    /// Provenance label (`manual`, `api`, …).
    pub source: String,
    /// `YYYY-MM-DD` effective date.
    pub effective_date: String,
    /// RFC-3339 creation timestamp.
    pub created_at: String,
}

const EXCHANGE_RATE_COLS: &str =
    "id, from_currency, to_currency, rate_millionths, source, effective_date, created_at";

fn row_to_exchange_rate(row: &tokio_postgres::Row) -> ExchangeRateDto {
    ExchangeRateDto {
        id: row.get(0),
        from_currency: row.get(1),
        to_currency: row.get(2),
        rate_millionths: row.get(3),
        source: row.get(4),
        effective_date: row.get(5),
        created_at: row.get(6),
    }
}

/// Validate a create-rate request exactly like the desktop/tablet
/// command layer (`validate_create_rate_args`, CUR-05) so the REST and
/// IPC surfaces cannot drift: ISO-4217 codes, distinct pair, strictly
/// positive rate, optional strict `YYYY-MM-DD` effective date.
pub fn validate_exchange_rate_request(
    from_currency: &str,
    to_currency: &str,
    rate_millionths: i64,
    effective_date: Option<&str>,
) -> Result<(), PgError> {
    if from_currency.trim().is_empty() {
        return Err(PgError::Validation(
            "from_currency must not be empty".into(),
        ));
    }
    if to_currency.trim().is_empty() {
        return Err(PgError::Validation("to_currency must not be empty".into()));
    }
    if from_currency.parse::<Currency>().is_err() {
        return Err(PgError::Validation(format!(
            "invalid ISO-4217 from_currency: {from_currency}"
        )));
    }
    if to_currency.parse::<Currency>().is_err() {
        return Err(PgError::Validation(format!(
            "invalid ISO-4217 to_currency: {to_currency}"
        )));
    }
    if from_currency == to_currency {
        return Err(PgError::Validation(
            "from_currency and to_currency must differ".into(),
        ));
    }
    if rate_millionths <= 0 {
        return Err(PgError::Validation(
            "rate_millionths must be strictly positive".into(),
        ));
    }
    if let Some(d) = effective_date {
        // Same parser as the command layer (CUR-05): chrono's %Y-%m-%d,
        // which accepts non-zero-padded forms like "2026-8-1" — REST and
        // IPC must not disagree on what a valid date is.
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| {
            PgError::Validation(format!("effective_date must be YYYY-MM-DD, got {d}"))
        })?;
    }
    Ok(())
}

/// Full rate history, ordered like the local repository (CUR-04):
/// pair-major, newest effective date first WITHIN each pair.
pub async fn list_exchange_rates_pg(pool: &Pool) -> Result<Vec<ExchangeRateDto>, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let rows = client
        .query(
            &format!(
                "SELECT {EXCHANGE_RATE_COLS} FROM exchange_rates
                 ORDER BY from_currency, to_currency, effective_date DESC, created_at DESC"
            ),
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(rows.iter().map(row_to_exchange_rate).collect())
}

/// The CURRENT rate for every pair (CUR-11) — one row per
/// `(from_currency, to_currency)`. `UNIQUE(pair, effective_date)` makes
/// within-pair ties impossible, so the ordering is deterministic without
/// a rowid-style tail (PG has no rowid; ids are UUIDs).
pub async fn list_latest_exchange_rates_pg(pool: &Pool) -> Result<Vec<ExchangeRateDto>, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let rows = client
        .query(
            "SELECT er.id, er.from_currency, er.to_currency, er.rate_millionths,
                    er.source, er.effective_date, er.created_at
             FROM exchange_rates er
             WHERE er.id = (
                 SELECT e2.id FROM exchange_rates e2
                 WHERE e2.from_currency = er.from_currency
                   AND e2.to_currency = er.to_currency
                 ORDER BY e2.effective_date DESC, e2.created_at DESC
                 LIMIT 1
             )
             ORDER BY er.from_currency, er.to_currency",
            &[],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    Ok(rows.iter().map(row_to_exchange_rate).collect())
}

/// The newest rate for one pair, `NotFound` when the pair is unknown
/// (mirrors `get_latest_exchange_rate_scoped`).
pub async fn get_latest_exchange_rate_pg(
    pool: &Pool,
    from_currency: &str,
    to_currency: &str,
) -> Result<ExchangeRateDto, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let row = client
        .query_opt(
            "SELECT id, from_currency, to_currency, rate_millionths, source, effective_date, created_at
             FROM exchange_rates
             WHERE from_currency = $1 AND to_currency = $2
             ORDER BY effective_date DESC, created_at DESC
             LIMIT 1",
            &[&from_currency.to_string(), &to_currency.to_string()],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    row.as_ref()
        .map(row_to_exchange_rate)
        .ok_or(PgError::NotFound)
}

/// Create a rate. Callers must run [`validate_exchange_rate_request`]
/// first; a duplicate `(from, to, effective_date)` maps to 409 and an
/// unseeded currency (FK on `currencies.code`) to 400.
pub async fn create_exchange_rate_pg(
    pool: &Pool,
    from_currency: &str,
    to_currency: &str,
    rate_millionths: i64,
    source: &str,
    effective_date: &str,
) -> Result<ExchangeRateDto, PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let id = uuid::Uuid::now_v7().to_string();
    let now = now_rfc3339();
    let source = if source.trim().is_empty() {
        "manual"
    } else {
        source.trim()
    }
    .to_string();
    let from = from_currency.trim().to_string();
    let to = to_currency.trim().to_string();
    let date = effective_date.to_string();
    if let Err(e) = client
        .execute(
            "INSERT INTO exchange_rates (id, from_currency, to_currency, rate_millionths, source, effective_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
            &[&id, &from, &to, &rate_millionths, &source, &date, &now],
        )
        .await
    {
        if is_unique_violation(&e) {
            return Err(PgError::Conflict);
        }
        // FK violation on currencies(code) — a non-seeded currency.
        if e.code() == Some(&SqlState::FOREIGN_KEY_VIOLATION) {
            return Err(PgError::Validation(
                "from_currency/to_currency must be seeded currencies".into(),
            ));
        }
        return Err(PgError::Db(e.to_string()));
    }
    Ok(ExchangeRateDto {
        id,
        from_currency: from.clone(),
        to_currency: to.clone(),
        rate_millionths,
        source,
        effective_date: date,
        created_at: now,
    })
}

/// Delete a rate by id; `NotFound` when nothing matched (mirrors the
/// scoped IPC command).
pub async fn delete_exchange_rate_pg(pool: &Pool, id: &str) -> Result<(), PgError> {
    let client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let n = client
        .execute(
            "DELETE FROM exchange_rates WHERE id = $1",
            &[&id.to_string()],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    if n == 0 {
        return Err(PgError::NotFound);
    }
    Ok(())
}

// ── Memo cloud-read serving layer (2026-09-07 cloud-read ruling) ─────────
//
// Memos are authored on the desktop (local SQLite, the global identity DB)
// and must display on KDS/tablet terminals whose local `memos` table is
// structurally empty. The ruled design makes cloud Postgres the serving
// layer: the desktop pushes the tenant's COMPLETE memo state (reconciling
// upsert — self-healing, no tombstones), and terminals read their active
// memos from here. All statements run under RLS (`oz.tenant_id`) like the
// rest of this module.

/// One memo + its derived audience, as the desktop pushes it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoSyncRow {
    /// Memo id (UUID v7, desktop-minted).
    pub id: String,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot at publish time.
    pub author_role: String,
    /// Title.
    pub title: String,
    /// Body.
    pub body: String,
    /// Lifecycle status (`draft`/`published`/`expired`/`stopped`/`archived`).
    pub status: String,
    /// Display duration (`12h`/`24h`/`3d`/`7d`/`30d`).
    pub duration: String,
    /// Current revision.
    pub revision: i64,
    /// Publish instant (ISO-8601), if published.
    #[serde(default)]
    pub published_at: Option<String>,
    /// Expiry instant (ISO-8601), if published.
    #[serde(default)]
    pub expires_at: Option<String>,
    /// Early-stop instant, if stopped.
    #[serde(default)]
    pub stopped_at: Option<String>,
    /// Who stopped it.
    #[serde(default)]
    pub stopped_by: Option<String>,
    /// Archival instant — the retention-deletion clock.
    #[serde(default)]
    pub archived_at: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
    /// Last-update timestamp.
    pub updated_at: String,
    /// Targeted location ids; empty ⇒ Organization Memo.
    #[serde(default)]
    pub location_ids: Vec<String>,
    /// The published fan-out: one recipient per target terminal.
    #[serde(default)]
    pub recipients: Vec<MemoRecipientSyncRow>,
}

/// One recipient row of a pushed memo.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemoRecipientSyncRow {
    /// Recipient row id (desktop-minted).
    pub id: String,
    /// The terminal this row addresses.
    pub terminal_id: String,
    /// Delivery state (`pending`/`delivered`/`acknowledged`).
    pub delivery_status: String,
    /// Delivery instant, if delivered.
    #[serde(default)]
    pub delivered_at: Option<String>,
    /// Acknowledgement instant, if acknowledged.
    #[serde(default)]
    pub acknowledged_at: Option<String>,
    /// Who acknowledged.
    #[serde(default)]
    pub acknowledged_by: Option<String>,
}

/// Result of the reconciling memo push.
#[derive(Debug, serde::Serialize)]
pub struct MemoSyncResult {
    /// Memos upserted (the snapshot size).
    pub upserted: i64,
    /// Memo rows deleted because the desktop no longer has them.
    pub deleted: i64,
}

/// Reconcile the tenant's memo state in PG with the desktop's snapshot.
///
/// The snapshot IS the truth: every memo in it is upserted (`ON CONFLICT
/// (id)`), its targeting rows replaced, its recipients upserted, and any PG
/// memo of this tenant NOT present in the snapshot is deleted (its children
/// cascade) — the desktop-side retention delete propagates by omission.
/// Idempotent: pushing the same state twice is a no-op the second time.
/// The memo's CHECK constraints on status/duration reject garbage payloads.
pub async fn sync_memos(
    pool: &Pool,
    tenant_id: &str,
    memos: &[MemoSyncRow],
) -> Result<MemoSyncResult, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    for m in memos {
        tx.execute(
            "INSERT INTO memos (id, tenant_id, author_user_id, author_role, title, body,
                                status, duration, revision, published_at, expires_at,
                                stopped_at, stopped_by, archived_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             ON CONFLICT (id) DO UPDATE SET
                author_user_id = EXCLUDED.author_user_id,
                author_role = EXCLUDED.author_role,
                title = EXCLUDED.title,
                body = EXCLUDED.body,
                status = EXCLUDED.status,
                duration = EXCLUDED.duration,
                revision = EXCLUDED.revision,
                published_at = EXCLUDED.published_at,
                expires_at = EXCLUDED.expires_at,
                stopped_at = EXCLUDED.stopped_at,
                stopped_by = EXCLUDED.stopped_by,
                archived_at = EXCLUDED.archived_at,
                updated_at = EXCLUDED.updated_at",
            &[
                &m.id,
                &tenant_id,
                &m.author_user_id,
                &m.author_role,
                &m.title,
                &m.body,
                &m.status,
                &m.duration,
                &m.revision,
                &m.published_at,
                &m.expires_at,
                &m.stopped_at,
                &m.stopped_by,
                &m.archived_at,
                &m.created_at,
                &m.updated_at,
            ],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

        // Targeting is small and derived: replace the set wholesale so a
        // desktop-side change can never leave a stale row behind.
        tx.execute("DELETE FROM memo_locations WHERE memo_id = $1", &[&m.id])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        for location_id in &m.location_ids {
            tx.execute(
                "INSERT INTO memo_locations (memo_id, location_id, tenant_id) VALUES ($1, $2, $3)",
                &[&m.id, location_id, &tenant_id.to_string()],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        }

        // Recipients are REPLACED too — but only the rows the desktop still
        // has. Acknowledgement state lives here, so an upsert would be
        // wrong in the stop/push race: the snapshot's recipient row (with
        // its current delivery state) IS the newest fact the desktop holds.
        tx.execute("DELETE FROM memo_recipients WHERE memo_id = $1", &[&m.id])
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        for r in &m.recipients {
            tx.execute(
                "INSERT INTO memo_recipients (id, memo_id, terminal_id, delivery_status,
                                             delivered_at, acknowledged_at, acknowledged_by, tenant_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                &[
                    &r.id,
                    &m.id,
                    &r.terminal_id,
                    &r.delivery_status,
                    &r.delivered_at,
                    &r.acknowledged_at,
                    &r.acknowledged_by,
                    &tenant_id.to_string(),
                ],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?;
        }
    }

    // Reconciliation: drop every tenant memo the desktop did not push. The
    // snapshot is the complete non-deleted set, so absence IS the deletion
    // signal (the retention sweep's deletes propagate here naturally).
    let ids: Vec<String> = memos.iter().map(|m| m.id.clone()).collect();
    let deleted = tx
        .execute(
            "DELETE FROM memos WHERE tenant_id = $1 AND NOT (id = ANY($2))",
            &[&tenant_id.to_string(), &ids],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(MemoSyncResult {
        upserted: memos.len() as i64,
        deleted: deleted as i64,
    })
}

/// One active memo served to a terminal, mirroring the banner's read shape.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ActiveMemoPg {
    /// Memo id.
    pub id: String,
    /// Targeted location ids; empty ⇒ Organization Memo.
    pub location_ids: Vec<String>,
    /// Author's user id.
    pub author_user_id: String,
    /// Author's role snapshot.
    pub author_role: String,
    /// Title.
    pub title: String,
    /// Body.
    pub body: String,
    /// Display duration.
    pub duration: String,
    /// Current revision.
    pub revision: i64,
    /// Publish instant.
    pub published_at: Option<String>,
    /// Expiry instant.
    pub expires_at: Option<String>,
    /// This terminal's delivery state.
    pub delivery_status: String,
}

/// Read the memos a terminal should currently display, tenant-scoped by RLS
/// and audience-scoped by the recipient join — the PG twin of
/// `Store::list_active_for_terminal` (Location stacked above Organization,
/// newest-published first, expiry checked in the WHERE so an un-swept row
/// cannot display past its deadline).
pub async fn list_active_memos_for_terminal(
    pool: &Pool,
    tenant_id: &str,
    terminal_id: &str,
    now: &str,
) -> Result<Vec<ActiveMemoPg>, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    // RLS: scope to the tenant (LOCAL setting — auto-resets on commit).
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let rows = tx
        .query(
            "SELECT m.id, m.author_user_id, m.author_role, m.title, m.body,
                    m.duration, m.revision, m.published_at, m.expires_at,
                    r.delivery_status,
                    (SELECT string_agg(ml.location_id, ',')
                     FROM memo_locations ml WHERE ml.memo_id = m.id) AS location_ids_csv
             FROM memos m
             JOIN memo_recipients r ON r.memo_id = m.id
             WHERE m.tenant_id = $1 AND r.terminal_id = $2
               AND m.status = 'published'
               AND (m.expires_at IS NULL OR m.expires_at > $3)
             ORDER BY (EXISTS (SELECT 1 FROM memo_locations ml WHERE ml.memo_id = m.id)) DESC,
                      m.published_at DESC",
            &[
                &tenant_id.to_string(),
                &terminal_id.to_string(),
                &now.to_string(),
            ],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let location_ids_csv: Option<String> = row.get("location_ids_csv");
        out.push(ActiveMemoPg {
            id: row.get("id"),
            location_ids: location_ids_csv
                .map(|csv| {
                    csv.split(',')
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            author_user_id: row.get("author_user_id"),
            author_role: row.get("author_role"),
            title: row.get("title"),
            body: row.get("body"),
            duration: row.get("duration"),
            revision: row.get("revision"),
            published_at: row.get("published_at"),
            expires_at: row.get("expires_at"),
            delivery_status: row.get("delivery_status"),
        });
    }
    Ok(out)
}

#[cfg(test)]
#[path = "pg_tests.rs"]
mod tests;
