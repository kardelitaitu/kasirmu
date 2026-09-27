//! Postgres data layer for the kasirmu-api REST handlers (Phase 1.2 of
//! `docs/archived/2026-08-15-unify-auth-and-sync.md`).
/*
last audited 25-07-26 by RSA-Agent (kasirmu-api slice B: pg deep read)
crate: kasirmu-api | status: SAFE | lint: CLEAN
findings: RLS contract exemplary — every tenant-scoped function opens a tx and sets oz.tenant_id LOCAL (12 sites verified; LOCAL scope auto-resets so pooled connections never leak scope); verify_terminal_credentials is a documented pre-tenant read via a scoped discovery role (SET LOCAL ROLE inside read-only tx) with digest comparison in SQL; all SQL parameterized ($n), format! only builds error strings and static SELECT prefixes; API-3 INFO: sale reads unwrap_or(0) tip_minor/service_charge_minor (1211-1212) and enum fallbacks product_type/status (610/1149) silently zero/default on drift (COR-13/25 family)
next: propagate sale money-column read errors (API-3) | perf: PRODUCT_SELECT reuses stock_summary aggregate
*/
//!
//! The desktop/tablet/cloud POS share one SQLite data layer
//! ([`kasirmu_core::Store`]), which cannot be rewritten to Postgres. The cloud
//! server therefore gets a **parallel async data layer** for the REST
//! surface, exactly like `apps/cloud-server/src/sync_store.rs` is for the
//! sync function. Each handler dispatches on `AppState::pg`:
//!
//! - `Some(pool)` → the cloud server's Postgres branch: this module runs the
//!   query against `deadpool_postgres::Pool`.
//! - `None` → local dev / tests / SQLite branch: the existing
//!   `kasirmu_core::Store` path runs unchanged.
//!
//! The SQL is written natively for Postgres (`$n` parameters). The port
//! schema (`20260813_init.pg.sql`) stores boolean-ish columns as `BIGINT`
//! (0/1), so reads go through `pg_bool` and writes pass `i64`. The
//! behaviour mirrors the SQLite `Store` methods the handlers used before:
//! validation errors, unique-constraint conflicts, the `stock_movements` +
//! `stock_summary` + `inventory` ledger writes on product/stock changes, and
//! the sale header + line insert inside one transaction.

use deadpool_postgres::Pool;

use kasirmu_core::{Category, Currency, Money, Sale, SaleLine, SaleStatus, TenantPlan};

use crate::routes::terminals::RegisteredTerminal;

mod memos;

// Re-exported so `crate::pg::<Item>` keeps resolving for the route
// handlers and the PG integration suite after the memo split.
pub use memos::{
    ActiveMemoPg, MemoAckResult, MemoRecipientSyncRow, MemoSyncResult, MemoSyncRow, ack_memo,
    list_active_memos_for_terminal, sync_memos,
};

// The shared prologue helpers (constants, `pg_bool`, the violation probes,
// `now_rfc3339`, `bump_snapshot_version`, `currency_str`, the `IN (…)` chunking
// arithmetic) live in `pg/helpers.rs` so a domain section can be lifted out of
// this file without dragging them along. The domain submodules import them from
// `super::helpers` directly; only what THIS file (and its sibling test module,
// through `use super::*`) names is imported here.
mod helpers;
use helpers::{PG_IN_CHUNK, PG_LEAD_PARAMS, PG_MAX_PARAMS, currency_str, now_rfc3339};

// Reached only by `pg_tests.rs` via `use super::*`, so it is imported only in
// test builds — an unconditional import would be unused in the library build.
#[cfg(test)]
use helpers::pg_placeholders;

/// Pin the invariant at COMPILE time: a chunk plus the leading parameters it also
/// binds must stay under the wire ceiling, or the chunking is itself the bug. A
/// `const` assert fails every build, not only a test run someone remembers.
const _: () = assert!(
    PG_IN_CHUNK + PG_LEAD_PARAMS < PG_MAX_PARAMS,
    "PG_IN_CHUNK must stay below PostgreSQL's 65535-parameters-per-statement ceiling"
);

// ── Settings ────────────────────────────────────────────────────────────

#[path = "pg/settings.rs"]
mod settings;
pub use settings::{get_setting_pg, scoped_setting_key, set_setting_pg};

#[path = "pg/error.rs"]
mod error;
pub use error::PgError;

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

#[path = "pg/tax_rates.rs"]
mod tax_rates;
pub use tax_rates::{
    TaxRateWrite, create_tax_rate, create_tax_rate_scoped, update_tax_rate_scoped,
    validate_tax_rate_write,
};

// ── Users ─────────────────────────────────────────────────────────────

#[path = "pg/users.rs"]
mod users;
pub use users::create_user;

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

// ── Products ─────────────────────────────────────────────────────────

#[path = "pg/products.rs"]
mod products;
pub use products::{adjust_stock, create_product, get_product, list_missing_hashes, list_products};

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

// ────────────────────── Sale idempotency guard ───────────────────

/// Verdict of a claim attempt on one (tenant_id, key) slot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaleClaim {
    /// This request holds the slot for the sale id it supplied, so it must go
    /// on and write that sale.
    Held,
    /// An earlier request already holds the slot. The payload is the ORIGINAL
    /// sale id, which the caller reads back and returns as the receipt.
    Replay(String),
}

/// Claim (tenant_id, key) on behalf of sale_id, BEFORE any ledger write.
///
/// Insert-first, then read the row back: a concurrent loser's
/// ON CONFLICT (tenant_id, key) DO NOTHING waits on the winner's unique-index
/// entry, affects zero rows, and then SELECTs the WINNER's sale id. That is why
/// 23505 (unique_violation) never reaches PgError::Db here, and why exactly one
/// of two racing submits answers 201 while the other answers 200 with the same
/// sale body. The key is the client's opaque string, matched by exact equality
/// only; nothing here parses it, and a request with no usable key never calls
/// this function at all.
///
/// RLS: sale_idempotency is a covered table, so the pair runs inside one
/// transaction with set_config('oz.tenant_id', …, true) exactly like every
/// other tenant-scoped helper in this module — one tenant can neither resolve
/// nor block another tenant's slot.
pub async fn claim_sale_idempotency(
    pool: &Pool,
    tenant_id: &str,
    key: &str,
    sale_id: &str,
) -> Result<SaleClaim, PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let claimed = tx
        .execute(
            "INSERT INTO sale_idempotency (tenant_id, key, sale_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, key) DO NOTHING",
            &[&tenant_id, &key, &sale_id],
        )
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;

    let verdict = if claimed == 1 {
        SaleClaim::Held
    } else {
        match tx
            .query_opt(
                "SELECT sale_id FROM sale_idempotency WHERE tenant_id = $1 AND key = $2",
                &[&tenant_id, &key],
            )
            .await
            .map_err(|e| PgError::Db(e.to_string()))?
        {
            Some(row) => SaleClaim::Replay(row.get::<_, String>(0)),
            // A conflicting slot rolled back between the two statements leaves
            // nothing to replay; inventing a sale is not this function's call.
            None => return Err(PgError::Db("idempotency slot vanished mid-race".into())),
        }
    };
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(verdict)
}

/// Drop a slot this request held but could not turn into a sale.
///
/// Called when the create behind a Held claim failed: leaving the slot bound to
/// a sale id that was never written would make every later retry resolve to a
/// receipt with no sale behind it. The delete is narrowed to our own sale_id,
/// so a concurrent winner's slot is never touched.
pub async fn release_sale_idempotency(
    pool: &Pool,
    tenant_id: &str,
    key: &str,
    sale_id: &str,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "DELETE FROM sale_idempotency WHERE tenant_id = $1 AND key = $2 AND sale_id = $3",
        &[&tenant_id, &key, &sale_id],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
}

/// Record an UNGUARDED sale — one whose request carried no usable key — as a
/// row with a NULL key.
///
/// NULL is distinct in a SQL unique index in both engines, so these rows can
/// never resolve or block a later request: an unbounded number of unguarded
/// sales per tenant stays legal, which is the whole point of the nullable
/// column. This is bookkeeping, never a guard, and its failure must not turn an
/// already-written sale into an error response.
pub async fn record_unguarded_sale(
    pool: &Pool,
    tenant_id: &str,
    sale_id: &str,
) -> Result<(), PgError> {
    let mut client = pool.get().await.map_err(|e| PgError::Db(e.to_string()))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute("SELECT set_config('oz.tenant_id', $1, true)", &[&tenant_id])
        .await
        .map_err(|e| PgError::Db(e.to_string()))?;
    tx.execute(
        "INSERT INTO sale_idempotency (tenant_id, key, sale_id) VALUES ($1, NULL, $2)",
        &[&tenant_id, &sale_id],
    )
    .await
    .map_err(|e| PgError::Db(e.to_string()))?;
    tx.commit().await.map_err(|e| PgError::Db(e.to_string()))?;
    Ok(())
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
        // sales.status has no CHECK constraint: a writer from a newer build can
        // store a value from_stored_str does not know. Keep serving the row —
        // failing the whole read over a label costs the sale — but Pending is
        // itself a legitimate stored value, so the fallback is ambiguous between
        // "genuinely pending" and "unmapped status", and the warning is how you
        // tell them apart.
        status: match SaleStatus::from_stored_str(&status_str) {
            Some(s) => s,
            None => {
                // id is TEXT PRIMARY KEY (20260813_init.pg.sql:1006), so this
                // re-read cannot fail.
                let row_id: String = sale_row.try_get("id").unwrap_or_default();
                tracing::warn!(
                    sale_id = %row_id,
                    raw = %status_str,
                    "unmapped sale status on sales row; falling back to Pending"
                );
                SaleStatus::Pending
            }
        },
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
        // CUR-02 charge fields: BIGINT NOT NULL DEFAULT 0 in PG
        // (20260813_init.pg.sql:1028) and INTEGER NOT NULL DEFAULT 0 in SQLite
        // (20260822_sale_charges.sql:5-6), so a failed read here is a type
        // drift, never a legitimate empty tip. Unlike the fallbacks above, 0 is
        // a real answer on a receipt that nothing downstream can tell apart
        // from a drifted read — the one swallow in this set that must fail the
        // read instead of serving a wrong number.
        tip_minor: sale_row
            .try_get("tip_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
        service_charge_minor: sale_row
            .try_get("service_charge_minor")
            .map_err(|e| PgError::Db(e.to_string()))?,
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

#[path = "pg/exchange_rates.rs"]
mod exchange_rates;
pub use exchange_rates::{
    ExchangeRateDto, create_exchange_rate_pg, delete_exchange_rate_pg, get_latest_exchange_rate_pg,
    list_exchange_rates_pg, list_latest_exchange_rates_pg, validate_exchange_rate_request,
};

#[cfg(test)]
#[path = "pg_tests.rs"]
mod tests;
